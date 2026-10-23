// Vendor a Prism bundle for BMM: core plus the languages that actually appear in what the app
// renders. No CDN — BMM works offline and every dependency lives in frontend/assets/vendor/.
//
// Languages chosen from what the surfaces really contain: the bundled docs (bash, bat,
// powershell, json), release notes and the community blog (arbitrary, so the common web set),
// and the plugin panel (json, js, http). Anything not in the list still renders — Prism leaves
// an unknown language alone rather than failing.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = 'E:/Travaille/CodageAutres/Better Project/BetterModsManager';
const SRC = join(ROOT, 'node_modules/prismjs');
const OUT = join(ROOT, 'frontend/assets/vendor/prism.min.js');

// Order matters: a language that extends another must come after it.
const LANGS = [
  'markup', 'css', 'clike', 'javascript',      // Prism's own defaults
  'json', 'json5', 'yaml', 'toml', 'ini',
  'bash', 'batch', 'powershell',
  'typescript', 'jsx', 'tsx',
  'rust', 'python', 'diff', 'markdown', 'regex', 'sql', 'http',
];

const parts = [readFileSync(join(SRC, 'components/prism-core.min.js'), 'utf8')];
const missing = [];
for (const l of LANGS) {
  const f = join(SRC, `components/prism-${l}.min.js`);
  if (!existsSync(f)) { missing.push(l); continue; }
  parts.push(readFileSync(f, 'utf8'));
}

const header = `/* Prism ${JSON.parse(readFileSync(join(SRC, 'package.json'), 'utf8')).version} — vendored by scripts, do not edit.
   Core + ${LANGS.length - missing.length} languages. Rebuild: node scripts/vendor-prism.mjs
   Theming is BMM's own (css/prism-bmm.css), driven by --bmm-* tokens, so highlighting follows
   the active theme instead of shipping a fixed palette. */
`;
writeFileSync(OUT, header + parts.join('\n'), 'utf8');
const kb = (readFileSync(OUT).length / 1024).toFixed(1);
console.log(`wrote ${OUT.split('/').pop()} — ${kb} KB, core + ${LANGS.length - missing.length} languages`);
if (missing.length) console.log(`  not shipped by prismjs: ${missing.join(', ')}`);
