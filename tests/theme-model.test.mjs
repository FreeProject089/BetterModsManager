// The .bmmtheme model (features/themes/theme-model.ts) against the COMPILED module: parsing,
// validation, migration from the old format, the renamed built-in ids, the WCAG contrast
// maths and its fixes, variants, and the undo history.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/themes/theme-model.js')).href);
const {
  THEME_FORMAT, canonicalThemeId, BUILTIN_ID_ALIASES, isSafeThemeId, isSafeCssValue, sanitizeVars,
  validateTheme, migrateTheme, parseThemeText, slugThemeId, sameTheme,
  parseColor, toHex, contrastRatio, wcagGrade, fixForeground, checkContrast, resolveToken,
  generatePalette, deriveVariant, isLightTheme, rootVars, deriveChannels, textOnFill,
  ThemeHistory, TOKEN_CATALOG, TOKEN_GROUPS, BASIC_GROUPS, isInternalToken, tokenSlug,
  BRAND_MARKS, brandMark, brandMascotSrc, brandBadgeSrc, BRAND_BADGE_PATH, BRAND_LOGO_SRC, BRAND_LOGO_TILE_SRC,
} = M;

const BUILTIN_DIR = join(ROOT, 'frontend/assets/builtin-themes');
const builtins = readdirSync(BUILTIN_DIR).filter((f) => f.endsWith('.json'))
  .map((f) => ({ f, th: JSON.parse(readFileSync(join(BUILTIN_DIR, f), 'utf8')) }));

describe('parse and validate', () => {
  test('a good file parses, migrates to the current format and keeps unknown keys', () => {
    const r = parseThemeText(JSON.stringify({ id: 'mine', name: 'Mine', vars: { '--bmm-accent': '#ff0000' }, x_tool: { a: 1 } }));
    assert.equal(r.ok, true);
    assert.equal(r.theme.format_version, THEME_FORMAT);
    assert.deepEqual(r.theme.x_tool, { a: 1 });
    assert.ok(r.issues.some((i) => i.code === 'unknownKept' && i.path === 'x_tool' && i.level === 'info'));
  });
  test('broken JSON and non-objects are errors, not throws', () => {
    assert.equal(parseThemeText('{nope').ok, false);
    assert.equal(parseThemeText('{nope').issues[0].code, 'json');
    assert.equal(parseThemeText('[1,2]').issues[0].code, 'notObject');
    assert.equal(parseThemeText('﻿{"id":"a","name":"A"}').ok, true, 'a BOM is tolerated');
  });
  test('ids must be one plain folder name', () => {
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', 'C:x', ' a', 'x'.repeat(81)]) assert.equal(isSafeThemeId(bad), false, bad);
    for (const ok of ['bmm-indigo', 'my-theme-2', 'Thème clair']) assert.equal(isSafeThemeId(ok), true, ok);
    assert.equal(validateTheme({ id: '../evil', name: 'x' })[0].code, 'idUnsafe');
    assert.equal(validateTheme({ name: 'x' })[0].code, 'idMissing');
  });
  test('a token value that would close the :root block is an error and is never applied', () => {
    const evil = 'red; } body { display:none';
    assert.equal(isSafeCssValue(evil), false);
    assert.equal(isSafeCssValue('url("data:image/png;base64,AAAA")'), true, 'a ; inside quotes is fine');
    assert.equal(isSafeCssValue('rgba(0,0,0,0.5)'), true);
    assert.equal(isSafeCssValue('</style><script>'), false);
    const issues = validateTheme({ id: 'a', name: 'A', vars: { '--bmm-accent': evil } });
    assert.ok(issues.some((i) => i.code === 'varUnsafe' && i.level === 'error'));
    assert.deepEqual(sanitizeVars({ '--bmm-accent': evil, '--ok': ' #fff ', 'no-dashes': '#000' }), { '--ok': '#fff' });
  });
  test('shape problems are reported per path, worst first', () => {
    const issues = validateTheme({ id: 'a', name: 'A', mode: 'dim', element_overrides: [{ selector: '.x', props: {} }, { nope: 1 }], vars: { '--x': 3 } });
    assert.ok(issues.some((i) => i.path === 'element_overrides[1]'));
    assert.ok(issues.some((i) => i.code === 'modeInvalid'));
    assert.ok(issues.some((i) => i.code === 'varNotText'));
    const levels = issues.map((i) => i.level);
    assert.deepEqual(levels, [...levels].sort((a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)));
  });
  test('a file from a newer format is read and flagged, its version left alone', () => {
    const r = parseThemeText(JSON.stringify({ id: 'a', name: 'A', format_version: THEME_FORMAT + 1 }));
    assert.equal(r.ok, true);
    assert.equal(r.theme.format_version, THEME_FORMAT + 1);
    assert.ok(r.issues.some((i) => i.code === 'formatNewer'));
  });
});

describe('migration (v1 → v2), never losing anything', () => {
  const v1 = { id: 'old', vars: { 'bmm-accent': '#123456', '--bmm-anim-speed': 0, '--bmm-radius-card': '4px' }, mode: 'sepia', custom_elements: [{ id: 'c', target: '#x', html: '<b>hi</b>' }], pages: { library: { css: 'a{}' } }, mystery: [1, 2, 3] };
  const m = migrateTheme(v1);
  test('stamps the format and reports what it changed', () => {
    assert.equal(m.from, 1);
    assert.equal(m.theme.format_version, THEME_FORMAT);
    for (const c of ['varPrefix', 'varText', 'modeDropped', 'nameFromId', 'formatStamped']) assert.ok(m.changes.includes(c), c);
  });
  test('repairs what it can without guessing', () => {
    assert.equal(m.theme.vars['--bmm-accent'], '#123456');
    assert.equal(m.theme.vars['--bmm-anim-speed'], '0');
    assert.equal(m.theme.name, 'old');
    assert.equal(m.theme.mode, undefined);
  });
  test('keeps every other key and does not touch the input', () => {
    assert.deepEqual(m.theme.custom_elements, v1.custom_elements);
    assert.deepEqual(m.theme.pages, v1.pages);
    assert.deepEqual(m.theme.mystery, [1, 2, 3]);
    assert.equal(v1.vars['bmm-accent'], '#123456', 'input untouched');
    assert.equal(v1.format_version, undefined);
  });
  test('an up-to-date theme comes back unchanged', () => {
    const cur = { id: 'a', name: 'A', format_version: THEME_FORMAT, vars: { '--bmm-accent': '#fff' } };
    const again = migrateTheme(cur);
    assert.deepEqual(again.changes, []);
    assert.ok(sameTheme(again.theme, cur));
  });
  test('every shipped built-in is valid with no error', () => {
    for (const { f, th } of builtins) {
      const issues = validateTheme(migrateTheme(th).theme).filter((i) => i.level !== 'info');
      assert.deepEqual(issues, [], f);
    }
  });
});

describe('brand mark: Tasky or the BMM logo', () => {
  test('no field is Tasky, as every theme was before the field existed', () => {
    assert.deepEqual([...BRAND_MARKS], ['tasky', 'logo', 'badge']);
    assert.equal(brandMark({ id: 'a', name: 'A' }), 'tasky');
    assert.equal(brandMark(null), 'tasky');
    assert.equal(brandMark({ brand: 'logo' }), 'tasky', 'a string is not the object form');
    assert.equal(brandMascotSrc({ id: 'a', name: 'A' }), undefined);
  });
  test('the logo picks the tile on a dark canvas and the bare logo on a light one', () => {
    assert.equal(brandMark({ brand: { mark: 'logo' } }), 'logo');
    assert.equal(brandMascotSrc({ brand: { mark: 'logo' } }), BRAND_LOGO_TILE_SRC);
    assert.equal(brandMascotSrc({ brand: { mark: 'logo' }, mode: 'light' }), BRAND_LOGO_SRC);
    assert.equal(brandMascotSrc({ brand: { mark: 'logo' }, vars: { '--bmm-bg-base': '#f4f4f4' } }), BRAND_LOGO_SRC);
    for (const src of [BRAND_LOGO_SRC, BRAND_LOGO_TILE_SRC]) {
      assert.ok(readdirSync(join(ROOT, 'frontend', dirname(src))).includes(src.split('/').pop()), `${src} ships`);
    }
  });
  test('the badge is the theme accent with an ink that reads on it, baked into a data: URL', () => {
    const svg = (src) => decodeURIComponent(src.replace(/^data:image\/svg\+xml,/, ''));
    const def = brandMascotSrc({ brand: { mark: 'badge' } });
    assert.match(def, /^data:image\/svg\+xml,/);
    assert.match(svg(def), /rx="7" fill="#3b82f6"/, 'default accent');
    assert.ok(svg(def).includes(BRAND_BADGE_PATH));
    // A pale accent with white on-accent text: the ink flips to one that reads.
    const pale = svg(brandBadgeSrc({ vars: { '--bmm-accent': '#ffcc00', '--bmm-text-on-accent': '#ffffff' } }));
    assert.match(pale, /fill="#ffcc00"/);
    assert.doesNotMatch(pale, /<path fill="#ffffff"/);
    // A value that is not a plain colour never reaches the markup.
    const odd = svg(brandBadgeSrc({ vars: { '--bmm-accent': 'red" onload="y' } }));
    assert.doesNotMatch(odd, /onload/);
  });
  test('validation: a known field, a warning for a bad value, never an error', () => {
    const ok = validateTheme({ id: 'a', name: 'A', brand: { mark: 'logo' } });
    assert.ok(!ok.some((i) => i.path.startsWith('brand')), 'brand is a BMM field');
    const bad = validateTheme({ id: 'a', name: 'A', brand: { mark: 'mascot' } });
    assert.ok(bad.some((i) => i.code === 'brandMark' && i.level === 'warning'));
    const notObj = validateTheme({ id: 'a', name: 'A', brand: 'logo' });
    assert.ok(notObj.some((i) => i.code === 'notObjectField' && i.path === 'brand'));
  });
  test('migration keeps the field as it is', () => {
    const m = migrateTheme({ id: 'a', name: 'A', brand: { mark: 'logo', extra: 1 } });
    assert.deepEqual(m.theme.brand, { mark: 'logo', extra: 1 });
  });
  test('the issue code is translated in both languages', () => {
    for (const lang of ['en', 'fr']) {
      const d = JSON.parse(readFileSync(join(ROOT, `frontend/Lang/${lang}.json`), 'utf8'));
      for (const k of ['themes.ed.issue.brandMark', 'themes.ed.brandMark', 'themes.ed.brandMarkTasky', 'themes.ed.brandMarkLogo', 'themes.ed.brandMarkBadge', 'themes.ed.brandMarkHint']) {
        assert.ok(d[k], `${lang}: ${k}`);
      }
    }
  });
  test('built-ins: sober ones wear the logo, playful ones keep Tasky', () => {
    const mark = Object.fromEntries(builtins.map(({ th }) => [th.id, brandMark(th)]));
    assert.equal(mark['bmm-charcoal'], 'badge');
    for (const id of ['bmm-sombre', 'bmm-void', 'bmm-white', 'bmm-indigo', 'bmm-arctic', 'bmm-cobalt', 'bmm-logo']) {
      assert.equal(mark[id], 'logo', id);
    }
    for (const id of ['bmm-default', 'bmm-orange', 'bmm-neon', 'bmm-brutal', 'bmm-clay', 'bmm-sakura']) {
      assert.equal(mark[id], 'tasky', id);
    }
  });
});

describe('built-in ids: neutral names, old ids still work', () => {
  const ids = builtins.map((b) => b.th.id);
  test('no shipped built-in id or name copies another product', () => {
    const brands = /discord|spotify|claude|anthropic|nord\b|vscode|vs code|visual studio|macos|apple|windows|github|slack|notion/i;
    for (const { f, th } of builtins) {
      assert.doesNotMatch(th.id, brands, f);
      assert.doesNotMatch(th.name, brands, f);
      assert.doesNotMatch(th.description || '', brands, f);
      assert.doesNotMatch(f, brands, f);
    }
  });
  test('every old id maps to a built-in that ships', () => {
    for (const [old, now] of Object.entries(BUILTIN_ID_ALIASES)) {
      assert.ok(ids.includes(now), `${old} → ${now} ships`);
      assert.ok(!ids.includes(old), `${old} no longer ships`);
      assert.equal(canonicalThemeId(old), now);
    }
  });
  test('other ids pass through untouched', () => {
    assert.equal(canonicalThemeId('bmm-void'), 'bmm-void');
    assert.equal(canonicalThemeId(' my-theme '), 'my-theme');
    assert.equal(canonicalThemeId(null), '');
  });
  test('the Rust side carries the same table (app and MCP bridge)', () => {
    for (const f of ['src-tauri/src/commands/themes.rs', 'src-tauri/src/mcp/state_bridge.rs']) {
      const rs = readFileSync(join(ROOT, f), 'utf8');
      const rows = [...rs.matchAll(/\("(bmm-[a-z]+)",\s*"(bmm-[a-z]+)"\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
      assert.deepEqual(rows, Object.entries(BUILTIN_ID_ALIASES).map(([a, b]) => `${a}>${b}`).sort(), f);
    }
  });
  test('file names follow the ids', () => {
    for (const { f, th } of builtins) assert.ok(f.endsWith(`${th.id}.bmmtheme.json`), f);
  });
});

describe('colour maths', () => {
  test('parses the colour spellings themes use', () => {
    assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual(parseColor('#00000080').a, 0.502);
    assert.deepEqual(parseColor('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30, a: 0.5 });
    assert.deepEqual(parseColor('rgb(10 20 30 / 50%)'), { r: 10, g: 20, b: 30, a: 0.5 });
    assert.equal(parseColor('var(--x)'), null);
    assert.equal(parseColor('linear-gradient(red, blue)'), null);
    assert.equal(toHex(parseColor('#AbC')), '#aabbcc');
  });
  test('WCAG ratios match the reference values', () => {
    assert.equal(Math.round(contrastRatio(parseColor('#000'), parseColor('#fff')) * 100) / 100, 21);
    assert.equal(Math.round(contrastRatio(parseColor('#777'), parseColor('#fff')) * 100) / 100, 4.48);
    assert.equal(wcagGrade(7.1), 'AAA');
    assert.equal(wcagGrade(4.5), 'AA');
    assert.equal(wcagGrade(3.2), 'AA-large');
    assert.equal(wcagGrade(2.9), 'fail');
  });
  test('a fix reaches the target and moves the colour as little as it can', () => {
    const bg = parseColor('#ffffff');
    const fixed = fixForeground(parseColor('#9ca3af'), bg, 4.5);
    assert.ok(contrastRatio(parseColor(fixed), bg) >= 4.5, fixed);
    assert.notEqual(fixed, '#000000', 'darkened, not thrown to black');
    const dark = parseColor('#111827');
    const fx2 = fixForeground(parseColor('#374151'), dark, 4.5);
    assert.ok(contrastRatio(parseColor(fx2), dark) >= 4.5, fx2);
  });
  test('text on a fill picks white or near-black, whichever reads', () => {
    assert.equal(textOnFill('#1d4ed8'), '#ffffff');
    assert.equal(textOnFill('#facc15'), '#111111');
  });
});

describe('contrast checks', () => {
  test('the default look resolves every pair, and a light theme without text gets readable text', () => {
    const res = checkContrast((k) => resolveToken({}, k, false));
    assert.ok(res.every((r) => r.ratio !== null));
    const lightVars = { '--bmm-bg-base': '#f5f6f8', '--bmm-bg-elevated': '#ffffff', '--bmm-bg-sidebar': '#ffffff' };
    const light = checkContrast((k) => resolveToken(lightVars, k, true));
    assert.ok(light.find((r) => r.pair.id === 'text-card').pass);
  });
  test('a failing pair comes with a fix that passes', () => {
    const vars = { '--bmm-bg-elevated': '#ffffff', '--bmm-bg-base': '#ffffff', '--bmm-text-secondary': '#d1d5db' };
    const row = checkContrast((k) => resolveToken(vars, k, true)).find((r) => r.pair.id === 'secondary-card');
    assert.equal(row.pass, false);
    assert.ok(row.fix);
    const after = checkContrast((k) => resolveToken({ ...vars, '--bmm-text-secondary': row.fix }, k, true)).find((r) => r.pair.id === 'secondary-card');
    assert.equal(after.pass, true);
  });
  test('a translucent fill is judged as painted over the app background', () => {
    const vars = { '--bmm-bg-base': '#000000', '--bmm-toast-bg': 'rgba(255,255,255,0.1)', '--bmm-toast-text': '#ffffff' };
    const row = checkContrast((k) => resolveToken(vars, k, false)).find((r) => r.pair.id === 'toast');
    assert.ok(row.ratio > 10, String(row.ratio));
  });
  test('var() references and followers resolve', () => {
    assert.equal(resolveToken({ '--bmm-text-primary': 'var(--bmm-accent)', '--bmm-accent': '#ff0000' }, '--bmm-text-primary'), '#ff0000');
    assert.equal(resolveToken({ '--bmm-bg-elevated': '#222222' }, '--bmm-toast-bg'), '#222222');
  });
  test('every shipped built-in keeps its main text readable', () => {
    for (const { f, th } of builtins) {
      const light = isLightTheme(th);
      const res = checkContrast((k) => resolveToken(th.vars || {}, k, light));
      for (const id of ['text-base', 'text-card']) {
        const r = res.find((x) => x.pair.id === id);
        assert.ok(r.pass, `${f}: ${id} ${r.ratio}`);
      }
    }
  });
});

describe('palettes and variants', () => {
  test('a generated palette is internally readable, dark and light', () => {
    for (const light of [false, true]) {
      const p = generatePalette('#e11d48', light);
      assert.equal(p.mode, light ? 'light' : 'dark');
      const res = checkContrast((k) => resolveToken(p.vars, k, light));
      for (const id of ['text-base', 'text-card', 'secondary-card', 'nav']) {
        assert.ok(res.find((r) => r.pair.id === id).pass, `${light ? 'light' : 'dark'} ${id}`);
      }
    }
  });
  test('a variant flips the surfaces, keeps the accent and the rest', () => {
    const dark = { id: 'mine', name: 'Mine', vars: { '--bmm-accent': '#e11d48', '--bmm-bg-base': '#050505', '--bmm-radius-card': '2px', '--bmm-font-sans': 'Georgia, serif' }, global_css: '.x{}' };
    const v = deriveVariant(dark, 'light');
    assert.equal(v.mode, 'light');
    assert.equal(isLightTheme(v), true);
    assert.equal(v.vars['--bmm-accent'], '#e11d48');
    assert.equal(v.vars['--bmm-radius-card'], '2px');
    assert.equal(v.vars['--bmm-font-sans'], 'Georgia, serif');
    assert.equal(v.global_css, '.x{}');
    assert.equal(v.variant_of, 'mine');
    assert.equal(v.id, '');
    assert.equal(dark.vars['--bmm-bg-base'], '#050505', 'the source is untouched');
  });
  test('light detection: declared mode first, then the base background', () => {
    assert.equal(isLightTheme({ mode: 'dark', vars: { '--bmm-bg-base': '#fff' } }), false);
    assert.equal(isLightTheme({ vars: { '--bmm-bg-base': '#fafafa' } }), true);
    assert.equal(isLightTheme({ vars: { '--bmm-bg-base': 'rgb(250,250,250)' } }), true);
    assert.equal(isLightTheme({}), false);
  });
  test('rootVars adds channels and the light text fallback, drops unsafe values', () => {
    const r = rootVars({ mode: 'light', vars: { '--bmm-accent': '#102030', '--bmm-bg-base': '#fff', '--evil': 'a;}b{' } });
    assert.equal(r['--bmm-accent-r'], '16');
    assert.equal(r['--bmm-accent-dim'], 'rgba(16, 32, 48, 0.18)');
    assert.equal(r['--bmm-text-primary'], '#16181d');
    assert.equal(r['--evil'], undefined);
    assert.deepEqual(deriveChannels({ '--bmm-accent': '#102030', '--bmm-accent-r': '1' })['--bmm-accent-r'], undefined);
  });
});

describe('undo history', () => {
  test('undo and redo walk the snapshots; a new change clears redo', () => {
    const h = new ThemeHistory();
    h.reset({ v: 0 });
    h.record({ v: 1 }, null, 0);
    h.record({ v: 2 }, null, 10);
    assert.deepEqual(h.undo(), { v: 1 });
    assert.deepEqual(h.undo(), { v: 0 });
    assert.equal(h.undo(), null);
    assert.deepEqual(h.redo(), { v: 1 });
    h.record({ v: 9 }, null, 20);
    assert.equal(h.canRedo, false);
  });
  test('a run on the same field is one step; an unchanged state is not recorded', () => {
    const h = new ThemeHistory(200, 900);
    h.reset({ c: '#000' });
    h.record({ c: '#111' }, 'accent', 1000);
    h.record({ c: '#222' }, 'accent', 1500);
    h.record({ c: '#333' }, 'accent', 2000);
    assert.equal(h.record({ c: '#333' }, 'accent', 2100), false);
    assert.deepEqual(h.undo(), { c: '#000' });
    h.record({ c: '#444' }, 'accent', 9000);
    h.record({ c: '#555' }, 'accent', 99999);
    assert.deepEqual(h.undo(), { c: '#444' }, 'too far apart: two steps');
  });
  test('the history is capped', () => {
    const h = new ThemeHistory(3);
    h.reset(0);
    for (let i = 1; i <= 10; i++) h.record(i, null, i * 10000);
    let n = 0;
    while (h.undo() !== null) n++;
    assert.equal(n, 3);
  });
});

describe('token catalogue', () => {
  test('keys are unique, groups known, Basics cover the four families', () => {
    const keys = TOKEN_CATALOG.map((t) => t.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const t of TOKEN_CATALOG) assert.ok(TOKEN_GROUPS.includes(t.group), t.key);
    for (const g of BASIC_GROUPS) assert.ok(TOKEN_CATALOG.some((t) => t.basic === g), g);
  });
  test('every catalogue token is declared in tokens.css or read with a fallback, and none is internal', () => {
    const css = readFileSync(join(ROOT, 'frontend/css/tokens.css'), 'utf8');
    const allCss = readdirSync(join(ROOT, 'frontend/css')).filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(ROOT, 'frontend/css', f), 'utf8')).join('\n');
    for (const t of TOKEN_CATALOG) {
      assert.equal(isInternalToken(t.key), false, t.key);
      // Declared, or not declared but read as var(--x, fallback): a token the app actually uses.
      assert.ok(css.includes(`${t.key}:`) || allCss.includes(`var(${t.key},`), `${t.key} is used`);
    }
    assert.equal(isInternalToken('--bmm-brand-mm'), true);
    assert.equal(isInternalToken('--bmm-accent-r'), true);
    assert.equal(isInternalToken('--bmm-s05'), true);
  });
  test('every catalogue token has its label and description in both languages', () => {
    for (const lang of ['en', 'fr']) {
      const d = JSON.parse(readFileSync(join(ROOT, `frontend/Lang/${lang}.json`), 'utf8'));
      for (const t of TOKEN_CATALOG) {
        assert.ok(d[`themes.tok.${tokenSlug(t.key)}`], `${lang}: themes.tok.${tokenSlug(t.key)}`);
        assert.ok(d[`themes.tok.${tokenSlug(t.key)}.desc`], `${lang}: themes.tok.${tokenSlug(t.key)}.desc`);
      }
    }
  });
  test('slugs for new ids avoid the taken ones', () => {
    assert.equal(slugThemeId('Mon Thème !'), 'mon-theme');
    assert.equal(slugThemeId('Mine', ['mine', 'mine-2']), 'mine-3');
    assert.equal(slugThemeId(''), 'theme');
  });
});
