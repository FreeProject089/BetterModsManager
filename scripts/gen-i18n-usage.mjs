// Where is a translation key used? — the index behind « Used in » in the Translation studio.
//
// The studio cannot read the source at run time (a packaged app has no src/ folder), so the
// places are extracted here, once, into frontend/assets/i18n-usage.gen.json:
//
//   { "<key>": [ [file, line, kind, view, anchor], ... ] }
//
//   file    path under frontend/ (index.html or src/...)
//   line    1-based
//   kind    "h" markup (data-i18n, data-i18n-placeholder/-title/-tooltip in index.html),
//           "a" the same attributes written inside a template string in a .ts file,
//           "t" a literal t('key') call
//   view    the app view that shows it (library, profiles, settings...), "" when it is shared
//           chrome or a dialog, "?" when the file does not say
//   anchor  markup: the nearest id above the line (a settings card, a pane, a dialog);
//           code: the function the call sits in
//
// Keys built at run time (t(`prefix.${x}`)) cannot be found by a scan and are not listed; the
// studio finds those on screen instead. At most CAP places are kept per key, the first ones.
//
// Run:            node scripts/gen-i18n-usage.mjs
// Verify (CI):    node scripts/gen-i18n-usage.mjs --check

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONT = path.join(ROOT, 'frontend');
const OUT = path.join(FRONT, 'assets/i18n-usage.gen.json');
const CAP = 12;

// File -> view. First match wins. Automations live in Plugins & API since 1.0.3.
const VIEW_BY_PATH = [
  [/features\/settings\/(sched|scheduler)/, 'plugins'],
  [/features\/settings\/|ui\/settings|ui\/(security|style)-modal|features\/themes|features\/bench|features\/debug|features\/dev\//, 'settings'],
  [/features\/mods\/(modlist|modpack)/, 'modlist'],
  [/features\/mods\//, 'library'],
  [/features\/profiles\//, 'profiles'],
  [/features\/repo\//, 'repo'],
  [/features\/(plugins|catalogs)\//, 'plugins'],
  [/features\/apps\//, 'apps'],
  [/features\/community\//, 'community'],
  [/features\/mapper\//, 'mapper'],
  [/^src\/docs\//, 'docs'],
  [/ui\/navbar-customize|ui\/(modal|launch|onboarding|tutorial|titlebar|activity|notification)/, ''],
  [/^src\/(core|ui)\//, ''],
];
const viewOf = (rel) => { for (const [re, v] of VIEW_BY_PATH) if (re.test(rel)) return v; return '?'; };

function walk(d, out = []) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(n)) out.push(p);
  }
  return out;
}

const idx = {};
const add = (key, row) => {
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) return;
  const list = (idx[key] ||= []);
  if (list.length < CAP) list.push(row);
};

// ── markup ────────────────────────────────────────────────────────────────
{
  const lines = fs.readFileSync(path.join(FRONT, 'index.html'), 'utf8').split(/\r?\n/);
  let view = '';
  let viewIndent = -1;
  let anchor = '';
  lines.forEach((ln, i) => {
    const open = ln.match(/^(\s*)<section class="view[^"]*" id="view-([a-z-]+)"/);
    if (open) { view = open[2]; viewIndent = open[1].length; anchor = ''; }
    else if (view && new RegExp(`^\\s{${viewIndent}}</section>`).test(ln)) { view = ''; anchor = ''; }
    const ids = [...ln.matchAll(/\sid="([A-Za-z][\w-]*)"/g)].map((m) => m[1]);
    if (ids.length) anchor = ids[0];
    for (const m of ln.matchAll(/data-i18n(?:-placeholder|-title|-tooltip|-aria-label)?="([^"]+)"/g)) {
      add(m[1], ['index.html', i + 1, 'h', view, ids[0] || anchor]);
    }
  });
}

// ── code ──────────────────────────────────────────────────────────────────
for (const f of walk(path.join(FRONT, 'src')).sort()) {
  const rel = path.relative(FRONT, f).replace(/\\/g, '/');
  const view = viewOf(rel);
  let fn = '';
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((ln, i) => {
    const d = ln.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/) || ln.match(/^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (d) fn = d[1];
    for (const m of ln.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'\s*[,)]/g)) add(m[1], [rel, i + 1, 't', view, fn]);
    for (const m of ln.matchAll(/data-i18n(?:-placeholder|-title|-tooltip|-aria-label)?="([A-Za-z0-9_.-]+)"/g)) add(m[1], [rel, i + 1, 'a', view, fn]);
  });
}

const sorted = Object.fromEntries(Object.keys(idx).sort().map((k) => [k, idx[k]]));
const text = JSON.stringify(sorted) + '\n';

// The check ignores line numbers: they are a hint for « Go there » and a copyable file:line, and
// comparing them would turn this gate red on every edit that moves a line in any of ~400 files.
// A key that appears, disappears or moves to another file, view or function still fails it.
const withoutLines = (s) => {
  try {
    const j = JSON.parse(s);
    for (const k of Object.keys(j)) j[k] = j[k].map(([f, , kind, v, a]) => [f, kind, v, a]);
    return JSON.stringify(j);
  } catch { return ''; }
};

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (withoutLines(cur) !== withoutLines(text)) {
    console.error('✗ frontend/assets/i18n-usage.gen.json is out of date (a t() call or a data-i18n moved).');
    console.error('  Run: node scripts/gen-i18n-usage.mjs');
    process.exit(1);
  }
  console.log(`✓ i18n usage index is current (${Object.keys(sorted).length} keys)`);
} else {
  fs.writeFileSync(OUT, text);
  console.log(`i18n usage index: ${Object.keys(sorted).length} keys, ${(text.length / 1024).toFixed(0)} KB -> ${path.relative(ROOT, OUT)}`);
}
