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

// Allow --version flag override
const versionArg = process.argv.find(a => a.startsWith('--version='))?.split('=')[1];
const VERSION    = versionArg ?? tauriConf.package.version;
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

// ── Write manifest ────────────────────────────────────────────────────────────
const manifest = { version: VERSION, files: manifestFiles };
const manifestPath = join(OUT_DIR, 'update-manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// ── Also copy the NSIS installer if it exists ─────────────────────────────────
const nsisDir   = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const msiDir    = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'msi');
let   installer = null;

for (const dir of [nsisDir, msiDir]) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith('.exe') || f.endsWith('.msi'));
    if (files.length > 0) {
        const src  = join(dir, files[0]);
        const dest = join(OUT_DIR, files[0]);
        copyFileSync(src, dest);
        installer = files[0];
        console.log(`   📦 Installer copied: ${files[0]} (${humanSize(statSync(src).size)})`);
        break;
    }
}

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
if (installer) {
    console.log(`\n    Required (full-install fallback):`);
    console.log(`      - ${installer}`);
}
console.log(`\n    All files are in: dist/release-assets-v${VERSION}/`);
console.log(`${'─'.repeat(60)}\n`);
