/**
 * gen-update-manifest.mjs
 * ──────────────────────────────────────────────────────────────────────────────
 * Generates update-manifest.json for BMM incremental updates.
 *
 * The Rust autoupdate.rs code resolves the install root as:
 *   resource_dir().pop()   →  {install_dir}/
 * and then writes updated files to:
 *   {install_dir}/{manifest.files[].path}
 *
 * Tauri bundles loose resources inside _up_/, so installed paths must start
 * with "_up_/" to reach the actual files on the user's machine.
 *
 * Usage:
 *   node scripts/gen-update-manifest.mjs
 *   node scripts/gen-update-manifest.mjs --version 1.2.3   (override version)
 *   node scripts/gen-update-manifest.mjs --installer Release/BMM-Setup.exe --require-installer
 *                                         (the release: also list the signed full installer)
 *
 * Output:
 *   dist/release-assets-v{version}/
 *     ├── update-manifest.json    ← upload to GitHub Release
 *     ├── lang-en.json            ← upload to GitHub Release
 *     ├── lang-fr.json            ← upload to GitHub Release
 *     └── lang-template.json      ← upload to GitHub Release
 */

import { createHash }                                         from 'crypto';
import { readFileSync, writeFileSync, mkdirSync,
         copyFileSync, statSync, existsSync, readdirSync }    from 'fs';
import { join, dirname, basename }                            from 'path';
import { fileURLToPath }                                      from 'url';

// ── Paths ────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

// ── Version ──────────────────────────────────────────────────────────────────
const tauriConf = JSON.parse(
    readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')
);

// Allow a --version override, accepting either `--version=1.2.3` or `--version 1.2.3`.
const argv       = process.argv.slice(2);
const eqArg      = argv.find(a => a.startsWith('--version='))?.split('=')[1];
const spaceArg   = (() => { const i = argv.indexOf('--version'); return i >= 0 ? argv[i + 1] : undefined; })();
const versionArg = eqArg ?? spaceArg;
// Tauri v2 moved the version to the top level of tauri.conf.json (it used to live under
// `package.version` in v1); fall back to the old location for safety.
const VERSION    = versionArg ?? tauriConf.version ?? tauriConf.package?.version;
if (!VERSION) {
    console.error('[gen-update-manifest] No version found — pass --version <x.y.z> or set "version" in src-tauri/tauri.conf.json.');
    process.exit(1);
}
const TAG        = `v${VERSION}`;

// ── GitHub config ─────────────────────────────────────────────────────────────
const GITHUB_REPO = 'FreeProject089/BetterModsManager';

// ── Files to track ────────────────────────────────────────────────────────────
// Each entry:
//   source        – path relative to project root (the file to hash/copy)
//   installedPath – path relative to BMM install root (used by Rust updater)
//   assetName     – filename to use as GitHub Release asset
//
// To add more trackable files (e.g. after moving JS to loose resources):
//   { source: 'frontend/js/app.js', installedPath: '_up_/frontend/js/app.js', assetName: 'app.js' }
//
const TRACKED_FILES = [
    {
        source:        'frontend/Lang/en.json',
        installedPath: '_up_/frontend/Lang/en.json',
        assetName:     'lang-en.json',
    },
    {
        source:        'frontend/Lang/fr.json',
        installedPath: '_up_/frontend/Lang/fr.json',
        assetName:     'lang-fr.json',
    },
    {
        source:        'frontend/Lang/template.json',
        installedPath: '_up_/frontend/Lang/template.json',
        assetName:     'lang-template.json',
    },
    {
        source:        'frontend/assets/links.json',
        installedPath: '_up_/frontend/assets/links.json',
        assetName:     'links.json',
    },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function humanSize(bytes) {
    if (bytes < 1024)       return `${bytes} B`;
    if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
}

// ── Output dir ────────────────────────────────────────────────────────────────
const OUT_DIR = join(ROOT, 'dist', `release-assets-v${VERSION}`);
mkdirSync(OUT_DIR, { recursive: true });

// ── Generate manifest ─────────────────────────────────────────────────────────
console.log(`\n🔧 BMM Update Manifest Generator`);
console.log(`   Version : ${VERSION}`);
console.log(`   Repo    : ${GITHUB_REPO}`);
console.log(`   Tag     : ${TAG}`);
console.log(`   Output  : dist/release-assets-v${VERSION}/\n`);

const manifestFiles = [];
let ok = 0, skipped = 0;

for (const entry of TRACKED_FILES) {
    const srcPath = join(ROOT, entry.source);

    if (!existsSync(srcPath)) {
        console.warn(`   ⚠  SKIP (not found): ${entry.source}`);
        skipped++;
        continue;
    }

    const buffer      = readFileSync(srcPath);
    const hash        = sha256(buffer);
    const size        = statSync(srcPath).size;
    const downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/${TAG}/${entry.assetName}`;

    // Copy file to release-assets dir under its asset name
    copyFileSync(srcPath, join(OUT_DIR, entry.assetName));

    manifestFiles.push({
        path:         entry.installedPath,
        sha256:       hash,
        download_url: downloadUrl,
        size,
    });

    console.log(`   ✓  ${entry.source}`);
    console.log(`      sha256 : ${hash}`);
    console.log(`      size   : ${humanSize(size)}`);
    console.log(`      asset  : ${entry.assetName}\n`);
    ok++;
}

// ── The full installer: BetterInstaller's BMM-Setup.exe, and nothing else ─────
// Listed in the manifest's `installers` with its SHA-256: BMM's full-installer fallback
// (autoupdate.rs, download_and_install_update) runs an installer only when the SIGNED manifest
// lists it and the downloaded bytes have that hash. Without an entry every copy that was not
// installed by BetterInstaller is told « this release publishes no signed update manifest ».
//
// It is named explicitly (`--installer Release/BMM-Setup.exe`, see `npm run release:assets`),
// never found by scanning. This used to scan target/release/bundle/{nsis,msi}: `npm run build`
// stopped bundling (--no-bundle), so those folders only held a STALE setup from an older build,
// and the v1.0.1 manifest listed « Better Mod Manager_1.0.0_x64-setup.exe ». A release must
// also carry ONE installer asset: BMM 0.9.11 has no version guard and runs the first .msi/.exe
// it finds on the release, so a second one is a second program it may launch.
//
// `--require-installer` fails when no installer was given (the release path); a plain
// `npm run build` writes the incremental part only.
const installerArgs = [];
argv.forEach((a, i) => {
    if (a === '--installer' && argv[i + 1]) installerArgs.push(argv[i + 1]);
    else if (a.startsWith('--installer=')) installerArgs.push(a.slice('--installer='.length));
});
const requireInstaller = argv.includes('--require-installer');
const installers = [];

if (installerArgs.length > 1) {
    console.error('[gen-update-manifest] One installer per release (BMM-Setup.exe): got ' + installerArgs.join(', '));
    process.exit(1);
}
for (const rel of installerArgs) {
    const src = join(ROOT, rel);
    const name = basename(src);
    if (name !== 'BMM-Setup.exe') {
        console.error(`[gen-update-manifest] The release installer must be BMM-Setup.exe, not ${name}`);
        process.exit(1);
    }
    if (!existsSync(src)) {
        console.error(`[gen-update-manifest] ${rel} does not exist: run npm run build:installer first`);
        process.exit(1);
    }
    const buffer = readFileSync(src);
    copyFileSync(src, join(OUT_DIR, name));
    installers.push({
        path:         name,
        sha256:       sha256(buffer),
        download_url: `https://github.com/${GITHUB_REPO}/releases/download/${TAG}/${name}`,
        size:         buffer.length,
    });
    console.log(`   📦 Installer copied and listed: ${name} (${humanSize(buffer.length)})`);
}
if (requireInstaller && !installers.length) {
    console.error('[gen-update-manifest] --require-installer: pass --installer Release/BMM-Setup.exe');
    process.exit(1);
}
// A setup left in the output folder by an earlier run would be uploaded with the rest.
for (const f of readdirSync(OUT_DIR)) {
    const lower = f.toLowerCase();
    if ((lower.endsWith('.exe') || lower.endsWith('.msi')) && !installers.some(i => i.path === f)) {
        console.error(`[gen-update-manifest] dist/release-assets-v${VERSION}/${f} is not this release's installer: delete it`);
        process.exit(1);
    }
}

// ── Write manifest ────────────────────────────────────────────────────────────
const manifest = { version: VERSION, files: manifestFiles, ...(installers.length ? { installers } : {}) };
const manifestPath = join(OUT_DIR, 'update-manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`✅  Manifest generated: ${ok} file(s) tracked, ${skipped} skipped`);
console.log(`\n📋  Upload ALL of the following to your GitHub Release (${TAG}):`);
console.log(`\n    Required (incremental update):`);
for (const f of manifestFiles) {
    const name = f.download_url.split('/').pop();
    console.log(`      - ${name}`);
}
console.log(`      - update-manifest.json`);
if (installers.length) {
    console.log(`\n    Required (full-install fallback, listed in the signed manifest):`);
    for (const i of installers) console.log(`      - ${i.path}`);
}
console.log(`\n    All files are in: dist/release-assets-v${VERSION}/`);
console.log(`${'─'.repeat(60)}\n`);
