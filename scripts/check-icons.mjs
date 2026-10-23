#!/usr/bin/env node
// One icon family, one glyph per meaning — the mechanical half of frontend/src/ui/icons.ts.
//
// Until Oct 2026 BMM drew ~1 100 icons as inline SVG strings copied from Feather with five
// stroke widths (1.8 to 3); delete was three different bins, refresh four different arrows,
// Import and Export both wore the same tray arrow (in both directions, depending on the screen),
// and a dozen icon-only buttons were a bare "✕", "✎" or "▶" in whatever font the webview had.
// None of that fails a build or a test: it only makes the app harder to scan.
//
// What fails:
//   registry  a glyph in icons.ts that is not byte-for-byte its Lucide source in
//             assets/icons/lucide.json (or a brand path that is not its Simple Icons source);
//             a URL in icons.ts (UI glyphs are bundled: no CDN, see core/icon-cdn.ts).
//   names     uiIcon('x') / uiIconEl('x') / brandIcon('x') or data-icon="x" naming nothing;
//             a literal size off the scale (12 14 16 18 20 24 32 40 48).
//   html      a data-icon <svg> whose inner markup is not the registry's (`--fix` rewrites it),
//             or that is not stroke 2 / currentColor / aria-hidden-or-labelled.
//   stroke    any other inline 24×24 stroke glyph with a stroke-width other than 2.
//   emoji     a button whose whole content is a symbol (✕ × ✎ ▶ ⏸ ↩ 🗑 …) or starts with an
//             emoji; an EN/FR string that starts with an emoji (a string cannot carry a glyph
//             that matches the rest of the app — put a uiIcon() next to it).
//   a11y      an icon-only <button> in index.html with no name source (aria-label, title,
//             data-i18n-title, data-i18n-tooltip or data-tasky — core/i18n.ts mirrors the last
//             two into aria-label — or .modal-close, which modal-shell.ts labels).
//
// Usage: node scripts/check-icons.mjs [--fix] [--report]

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FE = join(ROOT, 'frontend');
const FIX = process.argv.includes('--fix');
const REPORT = process.argv.includes('--report');
const rel = (p) => relative(ROOT, p).split(sep).join('/');
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

// ── registry ────────────────────────────────────────────────────────────────────────────────
const ICONS_TS = join(FE, 'src/ui/icons.ts');
const iconsSrc = readFileSync(ICONS_TS, 'utf8');
const lucide = JSON.parse(readFileSync(join(FE, 'assets/icons/lucide.json'), 'utf8'));
const simple = JSON.parse(readFileSync(join(FE, 'assets/icons/simple-icons.json'), 'utf8'));
const block = (name) => {
    const a = iconsSrc.indexOf(`const ${name} = {`);
    const b = iconsSrc.indexOf('} as const;', a);
    if (a < 0 || b < 0) { fail(rel(ICONS_TS), `${name} table not found`); return ''; }
    return iconsSrc.slice(a, b);
};
const ENTRY = /^\s+'?([a-z0-9-]+)'?: \['([a-z0-9-]+)', '([^']*)'\],$/gm;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const renderLucide = (nodes) => nodes.map(([tag, a]) => '<' + tag
    + Object.keys(a).filter((k) => k !== 'key').map((k) => ` ${k}="${esc(a[k])}"`).join('') + '/>').join('');
const GLYPHS = new Map();
for (const [, name, src, markup] of block('GLYPHS').matchAll(ENTRY)) {
    if (GLYPHS.has(name)) fail(rel(ICONS_TS), `duplicate icon name "${name}"`);
    GLYPHS.set(name, markup);
    if (!lucide[src]) fail(rel(ICONS_TS), `"${name}" names Lucide glyph "${src}", which assets/icons/lucide.json does not have`);
    else if (renderLucide(lucide[src]) !== markup) fail(rel(ICONS_TS), `"${name}" is not the Lucide "${src}" glyph (hand-edited path?)`);
}
const BRANDS = new Map();
for (const [, name, slug, path] of block('BRANDS').matchAll(ENTRY)) {
    BRANDS.set(name, path);
    if (!simple[slug]) fail(rel(ICONS_TS), `brand "${name}" names Simple Icons "${slug}", which is not bundled`);
    else if (simple[slug].p !== path) fail(rel(ICONS_TS), `brand "${name}" is not the Simple Icons "${slug}" path`);
}
if (GLYPHS.size < 50) fail(rel(ICONS_TS), `only ${GLYPHS.size} glyphs parsed — the probe is broken`);
if (/https?:\/\//.test(iconsSrc.replace(/^\s*\/\/.*$/gm, ''))) fail(rel(ICONS_TS), 'a URL in the registry: UI glyphs are bundled, never fetched');

// ── files ───────────────────────────────────────────────────────────────────────────────────
const SKIP_DIRS = [join(FE, 'src/docs/diagrams')];   // diagram drawings, not UI glyphs
const SKIP_FILES = new Set([ICONS_TS, join(FE, 'src/ui/icon-pack.ts')]);
const tsFiles = [];
(function walk(d) {
    for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) { if (!SKIP_DIRS.includes(p)) walk(p); continue; }
        if (p.endsWith('.ts') && !p.endsWith('.d.ts') && !SKIP_FILES.has(p)) tsFiles.push(p);
    }
})(join(FE, 'src'));
const HTML = join(FE, 'index.html');
let html = readFileSync(HTML, 'utf8');
const lineOf = (s, i) => s.slice(0, i).split('\n').length;
const SCALE = new Set([12, 14, 16, 18, 20, 24, 32, 40, 48]);

// ── names + sizes in TS ─────────────────────────────────────────────────────────────────────
let calls = 0;
for (const f of tsFiles) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\b(uiIcon|uiIconEl|brandIcon)\(\s*'([a-z0-9-]+)'\s*(?:,\s*(\d+))?/g)) {
        calls++;
        const table = m[1] === 'brandIcon' ? BRANDS : GLYPHS;
        if (!table.has(m[2])) fail(`${rel(f)}:${lineOf(s, m.index)}`, `${m[1]}('${m[2]}') — no such icon in ui/icons.ts`);
        if (m[3] && !SCALE.has(+m[3])) fail(`${rel(f)}:${lineOf(s, m.index)}`, `${m[1]}('${m[2]}', ${m[3]}) — size off the scale`);
    }
}

// ── index.html data-icon glyphs ─────────────────────────────────────────────────────────────
let htmlIcons = 0, fixed = 0;
html = html.replace(/(<svg\b[^>]*\bdata-icon="([a-z0-9-]+)"[^>]*>)([\s\S]*?)(<\/svg>)/g, (whole, open, name, inner, close, off) => {
    htmlIcons++;
    const at = `${rel(HTML)}:${lineOf(html, off)}`;
    const want = GLYPHS.get(name);
    if (!want) { fail(at, `data-icon="${name}" — no such icon in ui/icons.ts`); return whole; }
    if (!new RegExp(`class="ic ic-${name}\\b`).test(open)) fail(at, `data-icon="${name}" must carry class="ic ic-${name} …"`);
    if (!/stroke-width="2"/.test(open) || !/stroke="currentColor"/.test(open) || !/viewBox="0 0 24 24"/.test(open)) fail(at, `data-icon="${name}" is not stroke 2 / currentColor / 24×24`);
    if (!/aria-hidden="true"|aria-label="/.test(open)) fail(at, `data-icon="${name}" is neither aria-hidden nor labelled`);
    const w = (open.match(/\bwidth="(\d+)"/) || [])[1];
    if (w && !SCALE.has(+w)) fail(at, `data-icon="${name}" width ${w} is off the scale`);
    if (inner === want) return whole;
    if (FIX) { fixed++; return open + want + close; }
    fail(at, `data-icon="${name}" markup differs from the registry (run: node scripts/check-icons.mjs --fix)`);
    return whole;
});
if (FIX && fixed) { writeFileSync(HTML, html); console.log(`  rewrote ${fixed} data-icon glyph(s) in index.html`); }

// ── stroke width on the remaining inline glyphs ─────────────────────────────────────────────
let legacy = 0;
for (const f of [HTML, ...tsFiles]) {
    const s = f === HTML ? html : readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<svg\b[^>]*>/g)) {
        const o = m[0];
        if (/data-icon=/.test(o) || !/viewBox="0 0 24 24"/.test(o) || !/fill="none"/.test(o) || !/\bstroke="/.test(o)) continue;
        legacy++;
        const sw = (o.match(/stroke-width="([^"$]+)"/) || [])[1];
        if (sw && sw !== '2') fail(`${rel(f)}:${lineOf(s, m.index)}`, `inline glyph with stroke-width="${sw}" — the family is stroke 2 (better: uiIcon())`);
    }
}

// ── emoji / symbols as icons ────────────────────────────────────────────────────────────────
const EMO = /\p{Extended_Pictographic}/u;
const SYMBOL_ONLY = /^(?:✕|×|✖|✎|✏️?|↩|↪|▶|⏸|⏹|🗑️?|⟳|↻|⬇|⬆|⚙️?|🔍|📁|📂|📋|🔗)$/u;
for (const f of [HTML, ...tsFiles]) {
    const s = f === HTML ? html : readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<button\b[^>]*>([^<]{0,40}(?:<(?!\/button)[^<]*){0,6})<\/button>/g)) {
        const txt = m[1].replace(/\$\{[^}]*\}/g, '').replace(/<[^>]*>/g, '').trim();
        if (!txt) continue;
        if (SYMBOL_ONLY.test(txt) || EMO.test([...txt][0] || '')) fail(`${rel(f)}:${lineOf(s, m.index)}`, `button drawn with a text symbol "${txt.slice(0, 12)}" — use uiIcon()`);
    }
}
for (const lang of ['en', 'fr']) {
    const p = join(FE, 'Lang', `${lang}.json`);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    for (const [k, v] of Object.entries(j)) {
        if (typeof v === 'string' && EMO.test([...v.trim()][0] || '')) fail(rel(p), `"${k}" starts with an emoji — strings carry words, the glyph goes next to them (uiIcon)`);
    }
}

// ── icon-only buttons need a name (index.html) ──────────────────────────────────────────────
let iconOnly = 0;
for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const [, attrs, body] = m;
    if (!/<svg|<img/.test(body)) continue;
    const txt = body.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, '').trim();
    if (txt || /\bdata-i18n="/.test(attrs)) continue;
    iconOnly++;
    if (/aria-label=|aria-labelledby=|\btitle=|data-i18n-title=|data-i18n-tooltip=|data-tasky=|aria-hidden="true"|class="[^"]*\bmodal-close\b/.test(attrs)) continue;
    fail(`${rel(HTML)}:${lineOf(html, m.index)}`, 'icon-only button with no accessible name (aria-label, title, data-i18n-tooltip or data-tasky)');
}

if (REPORT) {
    console.log(`registry: ${GLYPHS.size} glyphs + ${BRANDS.size} brands`);
    console.log(`uses: ${calls} uiIcon()/brandIcon() calls in TS, ${htmlIcons} data-icon glyphs in index.html`);
    console.log(`inline glyphs still hand-written (stroke-checked): ${legacy}; icon-only buttons in index.html: ${iconOnly}`);
}
if (errors.length) {
    console.error(`✗ check-icons: ${errors.length} problem(s)`);
    for (const e of errors.slice(0, 80)) console.error('  ' + e);
    if (errors.length > 80) console.error(`  … and ${errors.length - 80} more`);
    process.exit(1);
}
console.log(`✓ check-icons: ${GLYPHS.size} glyphs, ${calls} TS call sites, ${htmlIcons} index.html glyphs — one family, stroke 2, no symbol buttons`);
