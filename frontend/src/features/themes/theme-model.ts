// theme-model.ts — the .bmmtheme document, with no DOM in it.
//
// Everything the theme editor and the theme engine need to KNOW about a theme, as opposed to
// what they do with the page: the file format and its version, reading a file someone handed
// you (parse, validate, migrate), the ids of the built-in themes and the old ids they replaced,
// the token catalogue the editor shows, colour maths for the WCAG contrast checks and their
// fixes, the palette generator, light/dark variants and the undo history.
//
// Kept free of imports on purpose: the node tests load the compiled module directly
// (tests/theme-model.test.mjs), and the engine and the editor both build on it, so a rule
// written here is the same rule in both.

// ── The document ───────────────────────────────────────────────────────────────────────────

/** The format this build writes. A file without `format_version` is version 1. */
export const THEME_FORMAT = 2;

export interface ThemeDoc {
    id: string;
    name: string;
    format_version?: number;
    author?: string;
    version?: string;
    description?: string;
    mode?: 'dark' | 'light';
    vars?: Record<string, string>;
    [key: string]: unknown;
}

/** Every top-level key BMM itself reads or writes. Anything else in a file is somebody's own
 *  data (a newer BMM, a tool, a catalogue): kept as it is, never dropped. */
export const KNOWN_THEME_KEYS: readonly string[] = [
    'id', 'name', 'format_version', 'author', 'version', 'description', 'preview', 'vars', 'fonts',
    'assets', 'global_css', 'pages', 'element_overrides', 'custom_elements', 'html_swaps', 'mode',
    'catalog_url', 'download_url', '_src', 'bmm_min_version', 'based_on', 'variant_of', 'brand',
    // Stamped by the backend on built-in rows; harmless, and not the theme author's.
    '_hidden', '_builtin',
];

// ── Built-in ids ───────────────────────────────────────────────────────────────────────────

/**
 * Built-in themes whose id named another product. The themes are the same; only the id moved.
 *
 * Every place an id comes IN goes through canonicalThemeId: the active theme saved in
 * localStorage and active_theme.txt, the hidden-presets list, the installer's handoff, a
 * scheduler task, a `bmm://theme/apply` link, an MCP call. So a choice made under the old id
 * keeps working and is rewritten the next time it is saved. The same table lives in Rust
 * (commands/themes.rs, LEGACY_BUILTIN_IDS) for the files the backend reads itself.
 */
export const BUILTIN_ID_ALIASES: Readonly<Record<string, string>> = {
    'bmm-discord': 'bmm-indigo',
    'bmm-spotify': 'bmm-neon',
    'bmm-claude': 'bmm-clay',
    'bmm-nord': 'bmm-arctic',
    'bmm-vscode': 'bmm-charcoal',
    'bmm-macos': 'bmm-cobalt',
};

/** The current id for `id`: an old built-in id becomes its new one, anything else is returned
 *  trimmed and otherwise untouched. */
export function canonicalThemeId(id: unknown): string {
    const s = String(id ?? '').trim();
    return Object.prototype.hasOwnProperty.call(BUILTIN_ID_ALIASES, s) ? BUILTIN_ID_ALIASES[s] : s;
}

// ── Brand mark ─────────────────────────────────────────────────────────────────────────────

/**
 * What a theme shows where BMM shows its mascot: Tasky (the default, and what every theme
 * without the field keeps), the BMM logo (the one in the app icon) or the compact « BMM » badge
 * (the letters on a 7 px-rounded tile in the theme's accent).
 *
 * `brand.mark` is a top-level object rather than an asset so a theme can pick the logo
 * without embedding a picture, and so it can grow (a sidebar mark, say) without a new key.
 * A theme's own `assets.mascot` still wins: it is the more specific choice. Format v2 is
 * unchanged: a file without `brand` is Tasky, as it always was, and an older BMM keeps the
 * field as an unknown one.
 */
export const BRAND_MARKS = ['tasky', 'logo', 'badge'] as const;
export type BrandMark = typeof BRAND_MARKS[number];

/** The logo on its own (ink and yellow): reads on a light canvas. */
export const BRAND_LOGO_SRC = 'assets/brand/bmm-logo.svg';
/** The logo on its pale rounded tile, as in the .ico: reads on any canvas, dark ones included. */
export const BRAND_LOGO_TILE_SRC = 'assets/brand/bmm-logo-tile.svg';

export function brandMark(theme: { brand?: unknown } | null | undefined): BrandMark {
    const b = theme?.brand;
    return isObj(b) && (b.mark === 'logo' || b.mark === 'badge') ? b.mark : 'tasky';
}

/** « BMM » in Bricolage Grotesque ExtraBold (OFL), outlined and centred on a 48-unit tile: the
 *  same letters as assets/brand/bmm-badge-*.svg and the narrow-layout mark in index.html. */
export const BRAND_BADGE_PATH = 'M4.3 29.3V18.74H8.86Q9.86 18.74 10.65 18.91Q11.44 19.08 12 19.42Q12.56 19.76 12.86 20.3Q13.15 20.84 13.15 21.57Q13.15 22.2 12.89 22.66Q12.62 23.12 12.06 23.41Q11.5 23.7 10.58 23.8V24.07Q12.11 24.16 12.85 24.8Q13.58 25.44 13.58 26.53Q13.58 27.46 13.09 28.07Q12.59 28.68 11.63 28.99Q10.67 29.3 9.26 29.3ZM6.77 27.25H9.17Q10.14 27.25 10.61 26.97Q11.07 26.69 11.07 26.08Q11.07 25.41 10.51 25.08Q9.95 24.74 8.8 24.74H6.77ZM6.77 23.17H8.45Q9.58 23.17 10.11 22.86Q10.64 22.55 10.64 21.92Q10.64 21.32 10.15 21.04Q9.66 20.76 8.67 20.76H6.77ZM15.38 29.3V18.74H19.23L21.98 26.34H22.06L24.75 18.74H28.43V29.3H26L26.14 21.36H25.97L22.91 29.3H20.8L17.81 21.36H17.63L17.78 29.3ZM30.66 29.3V18.74H34.51L37.26 26.34H37.34L40.03 18.74H43.71V29.3H41.28L41.42 21.36H41.25L38.19 29.3H36.08L33.09 21.36H32.91L33.06 29.3Z';

/** A colour that can go into an SVG attribute as it is: hex, rgb()/hsl(), or a name. */
const svgColour = (v: string | null | undefined, fallback: string): string =>
    v && /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/-]+\)|[a-z]+)$/i.test(v.trim()) ? v.trim() : fallback;

/** The badge for this theme as a data: URL: its accent fills the tile, and the letters take
 *  --bmm-text-on-accent when that reads on the accent (3:1, large bold text), else the ink
 *  that does. An <img> cannot see the page's CSS variables, so the colours are baked in. */
export function brandBadgeSrc(theme: { mode?: unknown; vars?: Record<string, string> } | null | undefined): string {
    const vars = sanitizeVars(theme?.vars);
    const light = isLightTheme(theme);
    const tile = svgColour(resolveToken(vars, '--bmm-accent', light), '#3b82f6');
    let ink = svgColour(resolveToken(vars, '--bmm-text-on-accent', light), '#ffffff');
    const ct = parseColor(tile), ci = parseColor(ink);
    if (!ct || !ci || contrastRatio(ct, ci) < 3) ink = textOnFill(tile);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">'
        + '<rect width="48" height="48" rx="7" fill="' + tile + '"/>'
        + '<path fill="' + ink + '" d="' + BRAND_BADGE_PATH + '"/></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/** The picture that stands in for Tasky under this theme, or undefined to keep Tasky. */
export function brandMascotSrc(theme: { brand?: unknown; mode?: unknown; vars?: Record<string, string> } | null | undefined): string | undefined {
    const mark = brandMark(theme);
    if (mark === 'badge') return brandBadgeSrc(theme);
    if (mark !== 'logo') return undefined;
    return isLightTheme(theme) ? BRAND_LOGO_SRC : BRAND_LOGO_TILE_SRC;
}

// ── Issues ─────────────────────────────────────────────────────────────────────────────────

export type IssueLevel = 'error' | 'warning' | 'info';
export interface ThemeIssue {
    level: IssueLevel;
    /** Stable code; the UI translates `themes.ed.issue.<code>`. */
    code: string;
    /** Where: `id`, `vars.--bmm-accent`, `element_overrides[2]`… */
    path: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A theme id that is one plain folder name (the backend stores themes/<id>/theme.json). */
export function isSafeThemeId(id: unknown): boolean {
    if (typeof id !== 'string') return false;
    const s = id.trim();
    if (!s || s.length > 80 || s !== id) return false;
    if (s === '.' || s === '..' || s.includes('..')) return false;
    return !/[\\/:*?"<>|\u0000-\u001f]/.test(s);
}

/**
 * Whether a token value can be written into a `:root { … }` block without ending it.
 *
 * A value is untrusted text from a shared file. `red; } body { display:none` would close the
 * declaration and the rule and start a rule of its own. `;` and braces are fine inside quotes
 * or parentheses (`url("data:image/png;base64,…")` has one), so this is a small scanner rather
 * than a character test.
 */
export function isSafeCssValue(v: unknown): boolean {
    if (typeof v !== 'string') return false;
    if (/<\/?style/i.test(v)) return false;
    let quote = '';
    let depth = 0;
    for (let i = 0; i < v.length; i++) {
        const c = v[i];
        if (quote) {
            if (c === '\\') { i++; continue; }
            if (c === quote) quote = '';
            continue;
        }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '(') { depth++; continue; }
        if (c === ')') { depth = Math.max(0, depth - 1); continue; }
        if (depth === 0 && (c === ';' || c === '{' || c === '}')) return false;
    }
    return !quote && depth === 0;
}

const VAR_NAME = /^--[A-Za-z0-9_-]+$/;

/** The vars that can be applied: valid names, safe string values. */
export function sanitizeVars(vars: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!isObj(vars)) return out;
    for (const [k, v] of Object.entries(vars)) {
        if (!VAR_NAME.test(k) || !isSafeCssValue(v)) continue;
        out[k] = (v as string).trim();
    }
    return out;
}

/** Everything wrong with a theme document, worst first. Never throws, never changes it. */
export function validateTheme(input: unknown): ThemeIssue[] {
    const out: ThemeIssue[] = [];
    if (!isObj(input)) return [{ level: 'error', code: 'notObject', path: '' }];
    const th = input;
    if (typeof th.id !== 'string' || !th.id.trim()) out.push({ level: 'error', code: 'idMissing', path: 'id' });
    else if (!isSafeThemeId(th.id)) out.push({ level: 'error', code: 'idUnsafe', path: 'id' });
    if (typeof th.name !== 'string' || !th.name.trim()) out.push({ level: 'warning', code: 'nameMissing', path: 'name' });
    const fv = th.format_version;
    if (fv !== undefined && (typeof fv !== 'number' || !Number.isInteger(fv) || fv < 1)) {
        out.push({ level: 'warning', code: 'formatInvalid', path: 'format_version' });
    } else if (typeof fv === 'number' && fv > THEME_FORMAT) {
        out.push({ level: 'warning', code: 'formatNewer', path: 'format_version' });
    }
    if (th.mode !== undefined && th.mode !== 'dark' && th.mode !== 'light') {
        out.push({ level: 'warning', code: 'modeInvalid', path: 'mode' });
    }
    for (const k of ['author', 'version', 'description', 'global_css', 'preview', 'catalog_url', 'download_url']) {
        if (th[k] !== undefined && typeof th[k] !== 'string') out.push({ level: 'warning', code: 'notText', path: k });
    }
    if (th.vars !== undefined) {
        if (!isObj(th.vars)) out.push({ level: 'error', code: 'varsNotObject', path: 'vars' });
        else {
            for (const [k, v] of Object.entries(th.vars)) {
                if (!VAR_NAME.test(k)) out.push({ level: 'warning', code: 'varName', path: `vars.${k}` });
                else if (typeof v !== 'string') out.push({ level: 'warning', code: 'varNotText', path: `vars.${k}` });
                else if (!isSafeCssValue(v)) out.push({ level: 'error', code: 'varUnsafe', path: `vars.${k}` });
            }
        }
    }
    const listOf = (key: string, ok: (x: Record<string, unknown>) => boolean) => {
        const v = th[key];
        if (v === undefined) return;
        if (!Array.isArray(v)) { out.push({ level: 'warning', code: 'notList', path: key }); return; }
        v.forEach((x, i) => { if (!isObj(x) || !ok(x)) out.push({ level: 'warning', code: 'entryInvalid', path: `${key}[${i}]` }); });
    };
    listOf('element_overrides', (x) => typeof x.selector === 'string' && isObj(x.props));
    listOf('custom_elements', (x) => typeof x.target === 'string' && typeof x.html === 'string');
    listOf('html_swaps', (x) => typeof x.selector === 'string' && typeof x.html === 'string');
    listOf('fonts', (x) => typeof x.family === 'string');
    if (th.brand !== undefined) {
        if (!isObj(th.brand)) out.push({ level: 'warning', code: 'notObjectField', path: 'brand' });
        else if (th.brand.mark !== undefined && !(BRAND_MARKS as readonly unknown[]).includes(th.brand.mark)) {
            out.push({ level: 'warning', code: 'brandMark', path: 'brand.mark' });
        }
    }
    for (const k of ['assets', 'pages']) {
        if (th[k] !== undefined && !isObj(th[k])) out.push({ level: 'warning', code: 'notObjectField', path: k });
    }
    for (const k of Object.keys(th)) {
        if (!KNOWN_THEME_KEYS.includes(k)) out.push({ level: 'info', code: 'unknownKept', path: k });
    }
    const rank: Record<IssueLevel, number> = { error: 0, warning: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export interface Migration {
    theme: ThemeDoc;
    /** The version the input said it was (1 when it said nothing). */
    from: number;
    /** What was changed, as codes (`themes.ed.mig.<code>`). Empty: nothing to do. */
    changes: string[];
}

/**
 * Bring a theme document to the current format. Non-destructive: it works on a copy, keeps
 * every key it does not know, and only repairs what it can repair without guessing.
 *
 * v1 → v2: `format_version` is stamped; token names written without their leading `--`
 * (`bmm-accent`) get it; numbers and booleans in `vars` become text (CSS is text, and a raw
 * number used to be written as-is); an invalid `mode` is dropped (it is auto-detected); a
 * missing name falls back to the id.
 *
 * A file from a NEWER format is read best-effort and its version is left alone, so saving it
 * here does not claim it was written by an older BMM than the one that made it.
 */
export function migrateTheme(input: unknown): Migration {
    const src: Record<string, unknown> = isObj(input) ? JSON.parse(JSON.stringify(input)) : {};
    const changes: string[] = [];
    const fv = typeof src.format_version === 'number' && Number.isInteger(src.format_version) && src.format_version >= 1
        ? src.format_version : 1;

    if (isObj(src.vars)) {
        const vars: Record<string, unknown> = {};
        for (const [k0, v0] of Object.entries(src.vars)) {
            let k = k0.trim();
            if (/^bmm-[A-Za-z0-9_-]+$/.test(k)) { k = `--${k}`; if (!changes.includes('varPrefix')) changes.push('varPrefix'); }
            let v = v0;
            if (typeof v === 'number' || typeof v === 'boolean') { v = String(v); if (!changes.includes('varText')) changes.push('varText'); }
            // A later spelling of the same token wins over an earlier one, as JSON itself would.
            vars[k] = v;
        }
        src.vars = vars;
    } else if (src.vars !== undefined && src.vars !== null && !isObj(src.vars)) {
        // Not an object: there is nothing to keep from it, and the engine cannot apply it.
        delete src.vars;
        changes.push('varsDropped');
    } else if (src.vars === null) {
        delete src.vars;
    }
    if (src.mode !== undefined && src.mode !== 'dark' && src.mode !== 'light') {
        delete src.mode;
        changes.push('modeDropped');
    }
    if ((typeof src.name !== 'string' || !src.name.trim()) && typeof src.id === 'string' && src.id.trim()) {
        src.name = src.id;
        changes.push('nameFromId');
    }
    if (fv < THEME_FORMAT) {
        src.format_version = THEME_FORMAT;
        changes.push('formatStamped');
    }
    return { theme: src as ThemeDoc, from: fv, changes };
}

export interface ParsedTheme {
    ok: boolean;
    theme: ThemeDoc | null;
    issues: ThemeIssue[];
    migration: Migration | null;
}

/** Read a theme file's text: JSON, then migration, then validation of the result. */
export function parseThemeText(text: string): ParsedTheme {
    let raw: unknown;
    try { raw = JSON.parse(String(text ?? '').replace(/^﻿/, '')); }
    catch { return { ok: false, theme: null, issues: [{ level: 'error', code: 'json', path: '' }], migration: null }; }
    if (!isObj(raw)) return { ok: false, theme: null, issues: [{ level: 'error', code: 'notObject', path: '' }], migration: null };
    const migration = migrateTheme(raw);
    const issues = validateTheme(migration.theme);
    return { ok: !issues.some((i) => i.level === 'error'), theme: migration.theme, issues, migration };
}

/** A new id for `name` that none of `taken` uses. */
export function slugThemeId(name: string, taken: Iterable<string> = []): string {
    const used = new Set(taken);
    const base = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'theme';
    if (!used.has(base)) return base;
    for (let n = 2; n < 10000; n++) {
        const id = `${base}-${n}`;
        if (!used.has(id)) return id;
    }
    return `${base}-${Date.now().toString(36)}`;
}

/** Two documents that say the same thing (key order aside). */
export function sameTheme(a: unknown, b: unknown): boolean {
    const norm = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(norm);
        if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
        return v;
    };
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

// ── Colour maths ───────────────────────────────────────────────────────────────────────────

export interface Rgba { r: number; g: number; b: number; a: number; }

const NAMED: Record<string, Rgba> = {
    white: { r: 255, g: 255, b: 255, a: 1 },
    black: { r: 0, g: 0, b: 0, a: 1 },
    transparent: { r: 0, g: 0, b: 0, a: 0 },
};
/** The dark text BMM puts on a light fill (#111111). */
const NEAR_BLACK: Rgba = { r: 17, g: 17, b: 17, a: 1 };

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (commas or spaces, `/ alpha`, %), three names.
 *  Anything else (var(), gradients, hsl()) is null: the caller resolves it first. */
export function parseColor(input: unknown): Rgba | null {
    const s = String(input ?? '').trim().toLowerCase();
    if (!s) return null;
    if (NAMED[s]) return { ...NAMED[s] };
    let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (m) {
        let h = m[1];
        if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
        const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
        return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 };
    }
    m = s.match(/^rgba?\(\s*([^)]*)\)$/);
    if (m) {
        const parts = m[1].split(/[\s,/]+/).filter(Boolean);
        if (parts.length < 3) return null;
        const ch = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
        const r = ch(parts[0]), g = ch(parts[1]), b = ch(parts[2]);
        let a = 1;
        if (parts[3] !== undefined) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
        if ([r, g, b, a].some((x) => !Number.isFinite(x))) return null;
        const c = (x: number) => Math.max(0, Math.min(255, x));
        return { r: c(r), g: c(g), b: c(b), a: Math.max(0, Math.min(1, a)) };
    }
    return null;
}

export function toHex(c: { r: number; g: number; b: number }): string {
    return '#' + [c.r, c.g, c.b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
}

/** `fg` painted over an opaque `bg`. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
    const a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

/** WCAG 2.x relative luminance (0 black … 1 white). */
export function relativeLuminance(c: { r: number; g: number; b: number }): number {
    const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio, 1 … 21. */
export function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
    const la = relativeLuminance(a), lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type WcagGrade = 'AAA' | 'AA' | 'AA-large' | 'fail';
export function wcagGrade(ratio: number): WcagGrade {
    if (ratio >= 7) return 'AAA';
    if (ratio >= 4.5) return 'AA';
    if (ratio >= 3) return 'AA-large';
    return 'fail';
}

export function rgbToHsl(c: { r: number; g: number; b: number }): [number, number, number] {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
    }
    return [h * 360, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
    const hh = (((h % 360) + 360) % 360) / 360;
    const ss = Math.max(0, Math.min(100, s)) / 100;
    const ll = Math.max(0, Math.min(100, l)) / 100;
    const hue2rgb = (p: number, q: number, t0: number) => {
        let t = t0;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    let r: number, g: number, b: number;
    if (ss === 0) { r = g = b = ll; }
    else {
        const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
        const p = 2 * ll - q;
        r = hue2rgb(p, q, hh + 1 / 3); g = hue2rgb(p, q, hh); b = hue2rgb(p, q, hh - 1 / 3);
    }
    return toHex({ r: r * 255, g: g * 255, b: b * 255 });
}

/**
 * The colour closest to `fg` (same hue and saturation, lightness moved as little as possible)
 * that reaches `target` against `bg`. Tries both directions and keeps the smaller move; when
 * neither gets there, the better of black and white.
 */
export function fixForeground(fg: Rgba, bg: Rgba, target: number): string {
    if (contrastRatio(fg, bg) >= target) return toHex(fg);
    const [h, s, l] = rgbToHsl(fg);
    let best: { hex: string; d: number } | null = null;
    for (const dir of [-1, 1]) {
        for (let step = 1; step <= 100; step++) {
            const nl = l + dir * step;
            if (nl < 0 || nl > 100) break;
            const hex = hslToHex(h, s, nl);
            if (contrastRatio(parseColor(hex)!, bg) >= target) {
                if (!best || step < best.d) best = { hex, d: step };
                break;
            }
        }
    }
    if (best) return best.hex;
    const white = NAMED.white, black = NAMED.black;
    return contrastRatio(white, bg) >= contrastRatio(black, bg) ? '#ffffff' : '#000000';
}

// ── Tokens ─────────────────────────────────────────────────────────────────────────────────

export type TokenType = 'color' | 'size' | 'font' | 'image' | 'number' | 'text';
/** The four families of the Basics view. */
export type BasicGroup = 'background' | 'surface' | 'text' | 'accent';

export interface TokenDef {
    key: string;
    type: TokenType;
    /** Group in the full list (`themes.ed.grp.<group>`). */
    group: string;
    /** Shown in Basics too, under this family. */
    basic?: BasicGroup;
    /** English fallback; the UI reads `themes.tok.<slug>` first. */
    label: string;
    desc: string;
}

/** `--bmm-text-on-accent` → `text-on-accent`: the i18n slug of a token. */
export const tokenSlug = (key: string): string => key.replace(/^--(bmm-)?/, '');

/**
 * The tokens the editor explains. The full list also shows every other `--bmm-*` declared in
 * tokens.css (read at run time), so this is the curated part, not a second registry of what
 * exists: a token added to tokens.css shows up without being added here.
 */
export const TOKEN_CATALOG: readonly TokenDef[] = [
    // Background
    { key: '--bmm-bg-base', type: 'color', group: 'background', basic: 'background', label: 'App background', desc: 'The outermost background, behind every page.' },
    { key: '--bmm-bg-sidebar', type: 'color', group: 'background', basic: 'background', label: 'Sidebar', desc: 'The left navigation column.' },
    { key: '--bmm-bg-titlebar', type: 'color', group: 'background', label: 'Title bar', desc: 'The window bar at the top.' },
    { key: '--bmm-titlebar-bg', type: 'color', group: 'background', label: 'Title bar (exact)', desc: 'The title bar as painted; accepts a translucent colour.' },
    { key: '--bmm-loader-bg', type: 'color', group: 'background', label: 'Start-up screen', desc: 'Behind the boot and exit animation.' },
    // Surfaces
    { key: '--bmm-bg-elevated', type: 'color', group: 'surface', basic: 'surface', label: 'Cards and panels', desc: 'Cards, panels, dialogs and menus.' },
    { key: '--bmm-bg-overlay', type: 'color', group: 'surface', label: 'Glass surface', desc: 'Glass cards and dialogs. Follows Cards and panels unless set.' },
    { key: '--bmm-bg-hover', type: 'color', group: 'surface', basic: 'surface', label: 'Hover', desc: 'Rows, menu items and buttons under the pointer.' },
    { key: '--bmm-bg-active', type: 'color', group: 'surface', label: 'Selected', desc: 'The selected or pressed state.' },
    { key: '--bmm-surface-r', type: 'number', group: 'surface', label: 'Surface tint red', desc: 'Red channel (0 to 255) of the tint every translucent surface is made of. 255 on dark themes, 0 on light ones.' },
    { key: '--bmm-surface-g', type: 'number', group: 'surface', label: 'Surface tint green', desc: 'Green channel of the surface tint.' },
    { key: '--bmm-surface-b', type: 'number', group: 'surface', label: 'Surface tint blue', desc: 'Blue channel of the surface tint.' },
    { key: '--bmm-glass-bg', type: 'color', group: 'surface', label: 'Glass fill', desc: 'Fill of frosted-glass panels.' },
    { key: '--bmm-glass-border', type: 'color', group: 'surface', label: 'Glass edge', desc: 'Edge of frosted-glass panels.' },
    { key: '--bmm-color-scheme', type: 'text', group: 'surface', label: 'Native controls', desc: 'light or dark: scrollbars and the system parts of form fields.' },
    // Borders
    { key: '--bmm-border', type: 'color', group: 'borders', basic: 'surface', label: 'Border', desc: 'The thin line around cards and fields.' },
    { key: '--bmm-border-hover', type: 'color', group: 'borders', label: 'Border on hover', desc: 'The same line under the pointer.' },
    { key: '--bmm-border-accent', type: 'color', group: 'borders', label: 'Focus border', desc: 'Focused and active elements.' },
    // Text
    { key: '--bmm-text-primary', type: 'color', group: 'text', basic: 'text', label: 'Main text', desc: 'Titles and everything that matters.' },
    { key: '--bmm-text-secondary', type: 'color', group: 'text', basic: 'text', label: 'Secondary text', desc: 'Descriptions and labels.' },
    { key: '--bmm-text-muted', type: 'color', group: 'text', basic: 'text', label: 'Faint text', desc: 'Hints, placeholders and metadata.' },
    { key: '--bmm-text-on-accent', type: 'color', group: 'text', basic: 'text', label: 'Text on accent', desc: 'Text sitting on an accent fill: main buttons, badges.' },
    // Accent and status
    { key: '--bmm-accent', type: 'color', group: 'accent', basic: 'accent', label: 'Accent', desc: 'The highlight fill: main buttons, the selected item, switches.' },
    { key: '--bmm-btn-primary-bg', type: 'color', group: 'accent', label: 'Main button fill', desc: 'Main buttons. Follows the accent unless set.' },
    { key: '--bmm-success', type: 'color', group: 'accent', basic: 'accent', label: 'Success', desc: 'Done, enabled, verified.' },
    { key: '--bmm-warning', type: 'color', group: 'accent', basic: 'accent', label: 'Warning', desc: 'Caution and pending states.' },
    { key: '--bmm-danger', type: 'color', group: 'accent', basic: 'accent', label: 'Danger', desc: 'Errors, deletions, conflicts.' },
    { key: '--bmm-info', type: 'color', group: 'accent', label: 'Information', desc: 'Information badges and notes.' },
    { key: '--bmm-cyan', type: 'color', group: 'accent', label: 'Cyan', desc: 'Second highlight: paths, some badges.' },
    { key: '--bmm-purple', type: 'color', group: 'accent', label: 'Purple', desc: 'Third highlight: links to actions, plugin tags.' },
    { key: '--bmm-amber', type: 'color', group: 'accent', label: 'Amber', desc: 'A softer caution tone used by some badges and charts.' },
    // Typography
    { key: '--bmm-font-sans', type: 'font', group: 'type', label: 'Interface font', desc: 'The font of the whole interface.' },
    { key: '--bmm-font-mono', type: 'font', group: 'type', label: 'Code font', desc: 'Code, paths and hashes.' },
    { key: '--bmm-font-size-base', type: 'size', group: 'type', label: 'Base text size', desc: 'For example 13px.' },
    // Shape
    { key: '--bmm-radius-card', type: 'size', group: 'shape', label: 'Card corners', desc: 'Corner radius of cards, for example 14px. 0 is square.' },
    { key: '--bmm-radius-btn', type: 'size', group: 'shape', label: 'Button corners', desc: 'Corner radius of buttons.' },
    { key: '--bmm-radius-input', type: 'size', group: 'shape', label: 'Field corners', desc: 'Corner radius of text fields and lists.' },
    { key: '--bmm-radius-chip', type: 'size', group: 'shape', label: 'Chip corners', desc: 'Corner radius of chips and pills.' },
    { key: '--bmm-radius-badge', type: 'size', group: 'shape', label: 'Badge corners', desc: 'Corner radius of small labels.' },
    // Effects
    { key: '--bmm-shadow-card', type: 'text', group: 'effects', label: 'Card shadow', desc: 'Shadow under cards (a CSS box-shadow).' },
    { key: '--bmm-shadow-modal', type: 'text', group: 'effects', label: 'Dialog shadow', desc: 'Shadow under dialogs.' },
    { key: '--bmm-card-glow', type: 'text', group: 'effects', label: 'Card glow', desc: 'Extra glow around cards. 0 0 0 transparent is none.' },
    { key: '--bmm-card-hover-lift', type: 'size', group: 'effects', label: 'Card lift on hover', desc: 'How far cards rise on hover, for example -2px. 0 is none.' },
    { key: '--bmm-anim-speed', type: 'number', group: 'effects', label: 'Animation speed', desc: '1 is normal, 0 turns animations off.' },
    // Notifications and tooltips
    { key: '--bmm-toast-bg', type: 'color', group: 'notify', label: 'Notification fill', desc: 'Behind the small notifications.' },
    { key: '--bmm-toast-text', type: 'color', group: 'notify', label: 'Notification text', desc: 'Text of the notifications.' },
    { key: '--bmm-toast-border', type: 'color', group: 'notify', label: 'Notification border', desc: 'Edge of the notifications.' },
    { key: '--bmm-tasky-bubble-bg', type: 'color', group: 'notify', label: 'Tooltip fill', desc: 'Behind Tasky\'s help bubbles.' },
    { key: '--bmm-tasky-bubble-text', type: 'color', group: 'notify', label: 'Tooltip text', desc: 'Text of the help bubbles.' },
    { key: '--bmm-tasky-bubble-border', type: 'color', group: 'notify', label: 'Tooltip border', desc: 'Edge of the help bubbles.' },
    { key: '--bmm-tasky-bubble-radius', type: 'size', group: 'notify', label: 'Tooltip corners', desc: 'Corner radius of the help bubbles.' },
    // Wallpaper and pictures
    { key: '--bmm-app-bg-image', type: 'image', group: 'images', label: 'Wallpaper', desc: 'A picture behind the whole app: url("…") or none.' },
    { key: '--bmm-app-bg-size', type: 'text', group: 'images', label: 'Wallpaper fit', desc: 'cover, contain or a size such as 800px.' },
    { key: '--bmm-app-bg-position', type: 'text', group: 'images', label: 'Wallpaper position', desc: 'center, top, or a pair such as 50% 20%.' },
    { key: '--bmm-app-bg-blur', type: 'size', group: 'images', label: 'Wallpaper blur', desc: 'For example 8px.' },
    { key: '--bmm-app-bg-opacity', type: 'number', group: 'images', label: 'Wallpaper opacity', desc: 'From 0 (hidden) to 1.' },
    { key: '--bmm-nav-logo-h', type: 'size', group: 'images', label: 'Sidebar logo height', desc: 'Height of the sidebar logo when the theme brings one.' },
    { key: '--bmm-mascot-w', type: 'size', group: 'images', label: 'Tasky size', desc: 'Width of the corner mascot, for example 110px.' },
    { key: '--bmm-loader-img', type: 'image', group: 'images', label: 'Start-up picture', desc: 'The picture shown while BMM starts.' },
    { key: '--bmm-intro-duration', type: 'size', group: 'images', label: 'Start-up fade', desc: 'Length of the start and exit fade, for example 0.65s.' },
    // Diagrams and charts
    { key: '--bmm-diagram-node', type: 'color', group: 'charts', label: 'Diagram boxes', desc: 'Fill of the boxes in the help diagrams.' },
    { key: '--bmm-diagram-node-border', type: 'color', group: 'charts', label: 'Diagram box edges', desc: 'Edge of the diagram boxes.' },
    { key: '--bmm-diagram-node-text', type: 'color', group: 'charts', label: 'Diagram text', desc: 'Text inside the diagram boxes.' },
    { key: '--bmm-chart-cpu', type: 'color', group: 'charts', label: 'CPU line', desc: 'The processor line on the performance graph.' },
    { key: '--bmm-chart-ram', type: 'color', group: 'charts', label: 'Memory line', desc: 'The memory line on the performance graph.' },
    { key: '--bmm-chart-disk-read', type: 'color', group: 'charts', label: 'Disk read line', desc: 'Disk reads on the input/output graph.' },
    { key: '--bmm-chart-disk-write', type: 'color', group: 'charts', label: 'Disk write line', desc: 'Disk writes on the input/output graph.' },
];

/** Group order in the full list. `other` collects what tokens.css declares beyond the catalogue. */
export const TOKEN_GROUPS: readonly string[] = ['background', 'surface', 'borders', 'text', 'accent', 'type', 'shape', 'effects', 'notify', 'images', 'charts', 'other'];
export const BASIC_GROUPS: readonly BasicGroup[] = ['background', 'surface', 'text', 'accent'];

/** Tokens that are not a theme's to set: the derived channels (written for you), the fixed
 *  wordmark, the surface wash scale. Hidden from the full list. */
export function isInternalToken(key: string): boolean {
    return /^--bmm-brand-/.test(key)
        || /^--bmm-s\d\d$/.test(key)
        || /^--bmm-(accent|cyan|success|warning|danger|info|purple)-(r|g|b|dim)$/.test(key)
        || !/^--bmm-/.test(key);
}

/** What type a token we know nothing about probably is, from its default value. */
export function guessTokenType(key: string, value: string): TokenType {
    if (parseColor(value) || /^rgba?\(/i.test(value.trim())) return 'color';
    if (/url\(|^none$/i.test(value.trim()) && /img|image/.test(key)) return 'image';
    if (/^-?\d+(\.\d+)?(px|rem|em|%|s|ms)$/.test(value.trim())) return 'size';
    if (/^-?\d+(\.\d+)?$/.test(value.trim())) return 'number';
    if (/font/.test(key)) return 'font';
    return 'text';
}

/** Default values of the tokens the contrast checks read, as tokens.css ships them (dark). */
export const DEFAULT_TOKENS: Readonly<Record<string, string>> = {
    '--bmm-bg-base': '#0a0e17',
    '--bmm-bg-elevated': '#111827',
    '--bmm-bg-sidebar': '#0d1117',
    '--bmm-bg-titlebar': '#080c14',
    '--bmm-accent': '#3b82f6',
    '--bmm-success': '#10b981',
    '--bmm-warning': '#f59e0b',
    '--bmm-danger': '#ef4444',
    '--bmm-info': '#3b82f6',
    '--bmm-text-primary': '#f1f5f9',
    '--bmm-text-secondary': '#94a3b8',
    '--bmm-text-muted': '#475569',
    '--bmm-text-on-accent': '#ffffff',
    '--bmm-tasky-bubble-bg': 'rgba(15, 23, 42, 0.7)',
    '--bmm-tasky-bubble-text': '#e2e8f0',
};
/** Tokens that follow another one unless set (tokens.css: `--a: var(--b)`). */
export const TOKEN_FOLLOWS: Readonly<Record<string, string>> = {
    '--bmm-bg-overlay': '--bmm-bg-elevated',
    '--bmm-toast-bg': '--bmm-bg-elevated',
    '--bmm-toast-text': '--bmm-text-primary',
    '--bmm-btn-primary-bg': '--bmm-accent',
    '--bmm-diagram-node': '--bmm-bg-elevated',
    '--bmm-diagram-node-text': '--bmm-text-primary',
};

/** Text tokens a light theme gets when it sets none (the engine writes the same). */
export const LIGHT_TEXT_FALLBACK: Readonly<Record<string, string>> = {
    '--bmm-text-primary': '#16181d',
    '--bmm-text-secondary': '#4b5563',
    '--bmm-text-muted': '#6b7280',
};

function _lum255(r: number, g: number, b: number): number { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

/** Whether a theme is light: its `mode` when it says, otherwise its base background. */
export function isLightTheme(theme: { mode?: unknown; vars?: Record<string, string> } | null | undefined): boolean {
    if (!theme) return false;
    if (theme.mode === 'light') return true;
    if (theme.mode === 'dark') return false;
    const c = parseColor(theme.vars?.['--bmm-bg-base'] || '');
    return c ? _lum255(c.r, c.g, c.b) > 0.5 : false;
}

/**
 * The value a token ends up with under `vars`, without a page: the theme's own value (a
 * `var(--x)` in it followed), else the token it follows, else the light text fallback, else
 * the shipped default. For the contrast checks in the tests and wherever there is no DOM to
 * ask; the editor asks its preview stage instead, which knows every rule.
 */
export function resolveToken(vars: Record<string, string>, key: string, light = false, depth = 0): string | null {
    if (depth > 8) return null;
    const own = vars[key];
    if (own !== undefined && own !== '') {
        const ref = own.trim().match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*(.+))?\)$/);
        if (ref) return resolveToken(vars, ref[1], light, depth + 1) ?? (ref[2] ? ref[2].trim() : null);
        return own.trim();
    }
    if (TOKEN_FOLLOWS[key]) return resolveToken(vars, TOKEN_FOLLOWS[key], light, depth + 1);
    if (light && LIGHT_TEXT_FALLBACK[key]) return LIGHT_TEXT_FALLBACK[key];
    return DEFAULT_TOKENS[key] ?? null;
}

// ── Contrast checks ────────────────────────────────────────────────────────────────────────

export interface ContrastPair {
    id: string;
    fg: string;
    bg: string;
    /** Ratio to reach. 4.5 for reading text, 3 for faint hints and status colours. */
    min: number;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
    { id: 'text-base', fg: '--bmm-text-primary', bg: '--bmm-bg-base', min: 4.5 },
    { id: 'text-card', fg: '--bmm-text-primary', bg: '--bmm-bg-elevated', min: 4.5 },
    { id: 'secondary-card', fg: '--bmm-text-secondary', bg: '--bmm-bg-elevated', min: 4.5 },
    { id: 'muted-card', fg: '--bmm-text-muted', bg: '--bmm-bg-elevated', min: 3 },
    { id: 'nav', fg: '--bmm-text-secondary', bg: '--bmm-bg-sidebar', min: 4.5 },
    { id: 'on-accent', fg: '--bmm-text-on-accent', bg: '--bmm-btn-primary-bg', min: 4.5 },
    { id: 'toast', fg: '--bmm-toast-text', bg: '--bmm-toast-bg', min: 4.5 },
    { id: 'tooltip', fg: '--bmm-tasky-bubble-text', bg: '--bmm-tasky-bubble-bg', min: 4.5 },
    { id: 'danger', fg: '--bmm-danger', bg: '--bmm-bg-elevated', min: 3 },
    { id: 'success', fg: '--bmm-success', bg: '--bmm-bg-elevated', min: 3 },
];

export interface ContrastResult {
    pair: ContrastPair;
    /** null: one of the two colours is not a plain colour (an image, a gradient). */
    ratio: number | null;
    grade: WcagGrade | null;
    pass: boolean;
    /** The value to give `pair.fg` so the pair passes (only when it does not). */
    fix: string | null;
}

/**
 * Run the checks. `resolve(key)` returns the colour a token resolves to (text). A translucent
 * background is laid over the app background first, the way it is painted.
 */
export function checkContrast(resolve: (key: string) => string | null, pairs: readonly ContrastPair[] = CONTRAST_PAIRS): ContrastResult[] {
    const base = parseColor(resolve('--bmm-bg-base')) || { r: 10, g: 14, b: 23, a: 1 };
    const opaqueBase = base.a < 1 ? composite(base, { r: 0, g: 0, b: 0, a: 1 }) : base;
    return pairs.map((pair) => {
        const fg0 = parseColor(resolve(pair.fg));
        const bg0 = parseColor(resolve(pair.bg));
        if (!fg0 || !bg0) return { pair, ratio: null, grade: null, pass: true, fix: null };
        const bg = bg0.a < 1 ? composite(bg0, opaqueBase) : bg0;
        const fg = fg0.a < 1 ? composite(fg0, bg) : fg0;
        const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
        const pass = ratio >= pair.min;
        let fix: string | null = null;
        if (!pass) {
            if (pair.id === 'on-accent') {
                // Text on an accent: black or white is the honest answer before any tint.
                const w = contrastRatio(NAMED.white, bg), k = contrastRatio(NEAR_BLACK, bg);
                fix = w >= pair.min ? '#ffffff' : k >= pair.min ? '#111111' : fixForeground(fg, bg, pair.min);
            } else {
                fix = fixForeground(fg, bg, pair.min);
            }
        }
        return { pair, ratio, grade: wcagGrade(ratio), pass, fix };
    });
}

// ── Palettes and variants ──────────────────────────────────────────────────────────────────

function accentVars(hex: string): Record<string, string> {
    const c = parseColor(hex) || { r: 59, g: 130, b: 246, a: 1 };
    const r = Math.round(c.r), g = Math.round(c.g), b = Math.round(c.b);
    return {
        '--bmm-accent': toHex(c),
        '--bmm-accent-dim': `rgba(${r},${g},${b},0.18)`,
        '--bmm-accent-r': String(r), '--bmm-accent-g': String(g), '--bmm-accent-b': String(b),
        '--bmm-border-accent': `rgba(${r},${g},${b},0.4)`,
        '--bmm-accent-glow': `0 0 20px rgba(${r},${g},${b},0.35)`,
    };
}

/** The readable text colour on an accent: white, or near-black when white fails. */
export function textOnFill(fill: string): string {
    const c = parseColor(fill);
    if (!c) return '#ffffff';
    const w = contrastRatio(NAMED.white, c);
    return w >= 4.5 || w >= contrastRatio(NEAR_BLACK, c) ? '#ffffff' : '#111111';
}

/** A whole coherent palette from one accent colour, dark or light. */
export function generatePalette(accent: string, light: boolean): { vars: Record<string, string>; mode: 'dark' | 'light' } {
    const c = parseColor(accent) || { r: 59, g: 130, b: 246, a: 1 };
    const [h, s] = rgbToHsl(c);
    const tint = Math.min(s, 22);
    const vars: Record<string, string> = { ...accentVars(toHex(c)), '--bmm-text-on-accent': textOnFill(toHex(c)) };
    if (light) {
        Object.assign(vars, {
            '--bmm-bg-base': hslToHex(h, tint * 0.5, 95),
            '--bmm-bg-elevated': '#ffffff',
            '--bmm-bg-overlay': '#ffffff',
            '--bmm-bg-sidebar': hslToHex(h, tint * 0.4, 99),
            '--bmm-bg-titlebar': hslToHex(h, tint * 0.4, 97),
            '--bmm-titlebar-bg': hslToHex(h, tint * 0.4, 97),
            '--bmm-loader-bg': hslToHex(h, tint * 0.5, 95),
            '--bmm-text-primary': hslToHex(h, 12, 12),
            '--bmm-text-secondary': hslToHex(h, 8, 30),
            '--bmm-text-muted': hslToHex(h, 6, 42),
            '--bmm-border': 'rgba(0,0,0,0.1)', '--bmm-border-hover': 'rgba(0,0,0,0.18)',
            '--bmm-bg-hover': 'rgba(0,0,0,0.045)',
            '--bmm-surface-r': '0', '--bmm-surface-g': '0', '--bmm-surface-b': '0',
            '--bmm-color-scheme': 'light',
            '--bmm-card-glow': '0 0 0 transparent', '--bmm-card-hover-lift': '0px',
            '--bmm-shadow-card': '0 1px 3px rgba(0,0,0,0.06)',
            '--bmm-tasky-bubble-bg': 'rgba(255,255,255,0.92)',
            '--bmm-tasky-bubble-text': hslToHex(h, 12, 12),
        });
        return { vars, mode: 'light' };
    }
    Object.assign(vars, {
        '--bmm-bg-base': hslToHex(h, tint, 7),
        '--bmm-bg-elevated': hslToHex(h, tint, 11),
        '--bmm-bg-overlay': hslToHex(h, tint, 12),
        '--bmm-bg-sidebar': hslToHex(h, tint, 5),
        '--bmm-bg-titlebar': hslToHex(h, tint, 4),
        '--bmm-titlebar-bg': hslToHex(h, tint, 4),
        '--bmm-loader-bg': hslToHex(h, tint, 4),
        '--bmm-text-primary': hslToHex(h, 10, 96),
        '--bmm-text-secondary': hslToHex(h, 8, 72),
        '--bmm-text-muted': hslToHex(h, 6, 52),
        '--bmm-border': 'rgba(255,255,255,0.08)', '--bmm-border-hover': 'rgba(255,255,255,0.16)',
        '--bmm-bg-hover': 'rgba(255,255,255,0.05)',
        '--bmm-surface-r': '255', '--bmm-surface-g': '255', '--bmm-surface-b': '255',
        '--bmm-color-scheme': 'dark',
    });
    return { vars, mode: 'dark' };
}

/** The tokens that decide whether a theme is light or dark: a variant regenerates these and
 *  keeps every other choice (accent, status colours, fonts, corners, effects, pictures). */
const SURFACE_TOKENS = /^--bmm-(bg-(base|elevated|overlay|sidebar|titlebar|hover|active)|titlebar-bg|loader-bg|text-(primary|secondary|muted|on-accent)|border(-hover)?|surface-[rgb]|color-scheme|glass-(bg|border)|shadow-card|card-glow|card-hover-lift|toast-(bg|text|border)|tasky-bubble-(bg|text)|s\d\d)$/;

/**
 * The same theme in the other mode: its accent and personality kept, its surfaces and text
 * rebuilt for `target`. Returns a document with no id; the caller names and saves it.
 */
export function deriveVariant(theme: ThemeDoc, target: 'dark' | 'light'): ThemeDoc {
    const vars = { ...(theme.vars || {}) };
    const accent = resolveToken(vars, '--bmm-accent', isLightTheme(theme)) || '#3b82f6';
    for (const k of Object.keys(vars)) if (SURFACE_TOKENS.test(k)) delete vars[k];
    const pal = generatePalette(accent, target === 'light');
    for (const [k, v] of Object.entries(pal.vars)) {
        // The accent channels and glow come with the palette; the accent itself stays as set.
        if (k === '--bmm-accent' && theme.vars?.['--bmm-accent']) continue;
        if (!SURFACE_TOKENS.test(k) && vars[k] !== undefined && !/^--bmm-accent-/.test(k)) continue;
        vars[k] = v;
    }
    const out: ThemeDoc = JSON.parse(JSON.stringify({ ...theme, vars, mode: pal.mode }));
    out.id = '';
    out.variant_of = theme.id || undefined;
    if (out.variant_of === undefined) delete out.variant_of;
    return out;
}

// ── Channels the engine writes ─────────────────────────────────────────────────────────────

/** For a colour token set as #rrggbb, its -r/-g/-b channels and -dim tint, unless the theme
 *  writes them itself. Alphas are tokens.css's own, so a derived tint is the default's. */
export function deriveChannels(vars: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    const names: Array<[string, number]> = [
        ['accent', 0.18], ['cyan', 0.18], ['success', 0.15],
        ['warning', 0.15], ['danger', 0.15], ['purple', 0.18], ['info', 0.15],
    ];
    for (const [n, dimAlpha] of names) {
        const hex = vars[`--bmm-${n}`];
        if (hex && /^#[0-9a-fA-F]{6}$/.test(hex.trim())) {
            const c = parseColor(hex.trim())!;
            const r = String(c.r), g = String(c.g), b = String(c.b);
            if (vars[`--bmm-${n}-r`] === undefined) out[`--bmm-${n}-r`] = r;
            if (vars[`--bmm-${n}-g`] === undefined) out[`--bmm-${n}-g`] = g;
            if (vars[`--bmm-${n}-b`] === undefined) out[`--bmm-${n}-b`] = b;
            if (vars[`--bmm-${n}-dim`] === undefined) out[`--bmm-${n}-dim`] = `rgba(${r}, ${g}, ${b}, ${dimAlpha})`;
        }
    }
    return out;
}

/** The declarations a theme puts on :root: its safe vars, the light text fallback when it is
 *  light and sets none, and the derived channels. */
export function rootVars(theme: { mode?: unknown; vars?: Record<string, string> }): Record<string, string> {
    const vars = sanitizeVars(theme.vars || {});
    if (isLightTheme({ mode: theme.mode, vars })) {
        for (const [k, v] of Object.entries(LIGHT_TEXT_FALLBACK)) if (vars[k] === undefined) vars[k] = v;
    }
    return { ...vars, ...deriveChannels(vars) };
}

// ── Undo / redo ────────────────────────────────────────────────────────────────────────────

/**
 * Undo history of snapshots. `record` after each change; a run of changes to the same thing
 * (typing in one field, dragging one colour) is merged into one step when `mergeKey` repeats
 * within `mergeMs`, so one undo takes back the whole drag and not one pixel of it.
 */
export class ThemeHistory<T> {
    private past: string[] = [];
    private future: string[] = [];
    private present = 'null';
    private lastKey: string | null = null;
    private lastAt = 0;
    constructor(private readonly limit = 200, private readonly mergeMs = 900) {}

    reset(state: T): void {
        this.past = [];
        this.future = [];
        this.present = JSON.stringify(state ?? null);
        this.lastKey = null;
    }

    /** Record `state` as the new present. Returns false when nothing changed. */
    record(state: T, mergeKey: string | null = null, now = Date.now()): boolean {
        const next = JSON.stringify(state ?? null);
        if (next === this.present) return false;
        const merge = mergeKey !== null && mergeKey === this.lastKey && now - this.lastAt <= this.mergeMs && this.past.length > 0;
        if (!merge) {
            this.past.push(this.present);
            if (this.past.length > this.limit) this.past.shift();
        }
        this.present = next;
        this.future = [];
        this.lastKey = mergeKey;
        this.lastAt = now;
        return true;
    }

    get canUndo(): boolean { return this.past.length > 0; }
    get canRedo(): boolean { return this.future.length > 0; }

    undo(): T | null {
        const prev = this.past.pop();
        if (prev === undefined) return null;
        this.future.push(this.present);
        this.present = prev;
        this.lastKey = null;
        return JSON.parse(prev);
    }

    redo(): T | null {
        const next = this.future.pop();
        if (next === undefined) return null;
        this.past.push(this.present);
        this.present = next;
        this.lastKey = null;
        return JSON.parse(next);
    }
}
