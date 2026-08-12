// gen-icon-pack.mjs — build the lazy-loaded icon pack assets from the npm data
// packages (installed with --no-save; re-run after `npm i --no-save lucide simple-icons`
// to refresh).
//
//   node scripts/gen-icon-pack.mjs
//
// Outputs (fetched on demand by frontend/src/ui/icon-pack.ts — NEVER imported at
// boot, the boot-weight guard stays untouched):
//   frontend/assets/icons/lucide.json        { kebab-name: iconNode[] }   (stroke icons)
//   frontend/assets/icons/simple-icons.json  { slug: {t: title, h: hex, p: path} } (brand glyphs)
//
// Formats are the libraries' own: lucide's iconNode arrays ([tag, attrs][]) and
// simple-icons' single 24x24 filled path. The renderer builds the <svg> at use time,
// so the JSON stays data, not markup.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OUT = path.resolve('frontend/assets/icons');
fs.mkdirSync(OUT, { recursive: true });

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').toLowerCase();

// ── Lucide ───────────────────────────────────────────────────────────────────
const lucide = require('lucide');
const lucideIcons = lucide.icons || lucide;
const lu = {};
for (const [name, node] of Object.entries(lucideIcons)) {
    if (!Array.isArray(node)) continue;
    lu[kebab(name)] = node;
}
fs.writeFileSync(path.join(OUT, 'lucide.json'), JSON.stringify(lu));

// ── Simple Icons ─────────────────────────────────────────────────────────────
const si = require('simple-icons');
const so = {};
for (const [key, icon] of Object.entries(si)) {
    if (!icon || typeof icon !== 'object' || !icon.path || !icon.slug) continue;
    so[icon.slug] = { t: icon.title, h: icon.hex, p: icon.path };
}
// The full pack is 4.6 MB — far too much to pull in just to paint one 9px brand
// glyph on a tag. It ships in TWO forms:
//   simple-icons.json      the whole map, loaded ONLY when the picker's Brands
//                          tab opens (a deliberate user action)
//   si/<first-char>.json   ~36 shards, so rendering a stored 'si:github' ref
//                          fetches ~150 KB instead of 4.6 MB
fs.writeFileSync(path.join(OUT, 'simple-icons.json'), JSON.stringify(so));
const shardDir = path.join(OUT, 'si');
fs.rmSync(shardDir, { recursive: true, force: true });
fs.mkdirSync(shardDir, { recursive: true });
const shards = {};
for (const [slug, icon] of Object.entries(so)) {
    const k = /^[a-z]/.test(slug) ? slug[0] : '_';
    (shards[k] ||= {})[slug] = icon;
}
for (const [k, map] of Object.entries(shards)) {
    fs.writeFileSync(path.join(shardDir, `${k}.json`), JSON.stringify(map));
}
const shardKb = Object.keys(shards).map(k => fs.statSync(path.join(shardDir, `${k}.json`)).size);
console.log(`simple-icons shards: ${Object.keys(shards).length} files, largest ${Math.round(Math.max(...shardKb) / 1024)} KB`);

const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
console.log(`lucide.json: ${Object.keys(lu).length} icons, ${kb('lucide.json')} KB`);
console.log(`simple-icons.json: ${Object.keys(so).length} brands, ${kb('simple-icons.json')} KB`);
