// @ts-nocheck
// ── BMM Theme Engine ──────────────────────────────────────────────────────────
// Applies a .bmmtheme to the running app by injecting <style> blocks and
// font-face declarations. Never modifies source files — fully reversible.
// Works on static AND dynamically-generated content via CSS variable cascading.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BmmTheme {
    id: string;
    name: string;
    author?: string;
    version?: string;
    description?: string;
    preview?: string;           // base64 PNG or URL
    vars?: Record<string, string>;       // --bmm-* overrides
    fonts?: FontDef[];
    assets?: Record<string, string>;     // key → base64 or URL
    global_css?: string;
    pages?: Record<string, PageTheme>;   // view id → per-page overrides
    element_overrides?: ElementOverride[];
    custom_elements?: CustomElement[];
    html_swaps?: HtmlSwap[];    // replace matching elements' innerHTML (e.g. icon SVG)
    mode?: 'dark' | 'light';    // triggers contrast patches for light themes
    catalog_url?: string;       // origin catalog (for attribution)
    bmm_min_version?: string;
}

interface FontDef {
    family: string;
    file?: string;      // relative path in archive
    url?: string;       // remote URL
    data?: string;      // base64 data-URI
    weight?: string;
    style?: string;
}

interface PageTheme {
    vars?: Record<string, string>;
    css?: string;
}

interface ElementOverride {
    selector: string;
    props: Record<string, string>;
}

export interface HtmlSwap {
    selector: string;
    html: string;       // sanitised markup that replaces matching elements' innerHTML
}

interface CustomElement {
    id: string;
    target: string;         // CSS selector of the host element
    position: 'prepend' | 'append' | 'before' | 'after';
    html: string;
    css?: string;
    scope?: string;         // view id — only shown on this page; '' = all pages
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STYLE_VARS_ID    = 'bmm-theme-vars';
const STYLE_CSS_ID     = 'bmm-theme-css';
const STYLE_FONTS_ID   = 'bmm-theme-fonts';
const STYLE_PATCH_ID   = 'bmm-theme-patch';  // overrides for JS-generated inline styles
const DATA_PAGE_ATTR   = 'data-page';
const ACTIVE_KEY       = 'bmm_active_theme';
const THEMES_DIR_KEY   = 'bmm_themes_installed';

let _activeTheme: BmmTheme | null = null;
let _customElementObserver: MutationObserver | null = null;
let _patchObserver: MutationObserver | null = null;
let _htmlSwapObserver: MutationObserver | null = null;
let _assetObserver: MutationObserver | null = null;

// ── Internal helpers ──────────────────────────────────────────────────────────
function getOrCreate(id: string): HTMLStyleElement {
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement('style');
        el.id = id;
        document.head.appendChild(el);
    }
    return el;
}

/** For any --bmm-<name> hex the theme sets, auto-emit --bmm-<name>-r/g/b
 *  channel tokens so rgba(var(--bmm-<name>-r),…) tints follow the theme.   */
function deriveChannels(vars: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    const names = ['accent', 'cyan', 'success', 'warning', 'danger', 'purple'];
    for (const n of names) {
        const hex = vars[`--bmm-${n}`];
        if (hex && /^#[0-9a-fA-F]{6}$/.test(hex.trim())) {
            const { r, g, b } = rgb(hex.trim());
            if (vars[`--bmm-${n}-r`] === undefined) out[`--bmm-${n}-r`] = String(r);
            if (vars[`--bmm-${n}-g`] === undefined) out[`--bmm-${n}-g`] = String(g);
            if (vars[`--bmm-${n}-b`] === undefined) out[`--bmm-${n}-b`] = String(b);
        }
    }
    return out;
}

// A light theme that only overrides backgrounds (e.g. a hand-tweaked single
// token, or a community theme authored before text tokens existed) otherwise
// falls through to BMM's DARK-mode text-token defaults from tokens.css — near-
// white text on the new light background. The DOM contrast enforcer patches
// this everywhere it runs, but it deliberately never touches the theme editor's
// own chrome (`#bmm-theme-editor` is excluded), so THAT surface showed the bug
// unmitigated: some text (using tokens the theme DID set) turned dark
// correctly, the rest (relying on unset text tokens) stayed stuck light-on-
// light. Filling the gap here — at the CSS-variable level — fixes it
// everywhere at once, editor included, instead of chasing DOM edge cases.
const LIGHT_TEXT_FALLBACK: Record<string, string> = {
    '--bmm-text-primary': '#16181d',
    '--bmm-text-secondary': '#4b5563',
    '--bmm-text-muted': '#6b7280',
};
function buildVarsCSS(theme: BmmTheme): string {
    const vars = { ...(theme.vars || {}) };
    if (isLightTheme(theme)) {
        for (const [k, v] of Object.entries(LIGHT_TEXT_FALLBACK)) {
            if (vars[k] === undefined) vars[k] = v;
        }
    }
    const merged = { ...vars, ...deriveChannels(vars) };
    const global = Object.keys(merged).length ? Object.entries(merged)
        .map(([k, v]) => `  ${k}: ${v};`).join('\n') : '';

    const perPage = theme.pages ? Object.entries(theme.pages)
        .filter(([, p]) => p.vars)
        .map(([page, p]) => {
            const pvars = Object.entries(p.vars!).map(([k, v]) => `  ${k}: ${v};`).join('\n');
            return `#view-${page}, body[data-page="${page}"] {\n${pvars}\n}`;
        }).join('\n') : '';

    return `:root {\n${global}\n}\n${perPage}`;
}

function buildCSSBlock(theme: BmmTheme): string {
    let css = theme.global_css || '';

    if (theme.pages) {
        for (const [page, p] of Object.entries(theme.pages)) {
            if (p.css) css += `\n#view-${page} {\n${p.css}\n}`;
        }
    }

    if (theme.element_overrides) {
        for (const o of theme.element_overrides) {
            const props = Object.entries(o.props).map(([k, v]) => `  ${k}: ${v} !important;`).join('\n');
            css += `\n${o.selector} {\n${props}\n}`;
        }
    }

    if (theme.custom_elements) {
        for (const ce of theme.custom_elements) {
            if (ce.css) css += `\n/* custom-element: ${ce.id} */\n${ce.css}`;
        }
    }

    return css;
}

/** Build CSS that fights hardcoded inline styles on JS-generated content.
 *  Uses attribute-contains selectors + !important to override inline colors
 *  when the accent or background tokens differ from BMM defaults.           */
function buildPatchCSS(theme: BmmTheme): string {
    const vars = theme.vars || {};
    const accent = vars['--bmm-accent'];
    const bgBase = vars['--bmm-bg-base'];
    const bgElev = vars['--bmm-bg-elevated'];
    const textPrimary = vars['--bmm-text-primary'];
    const textSecondary = vars['--bmm-text-secondary'];
    const textMuted = vars['--bmm-text-muted'];
    const danger  = vars['--bmm-danger'];
    const success = vars['--bmm-success'];
    const warning = vars['--bmm-warning'];
    const cyan    = vars['--bmm-cyan'];
    const isLight = isLightTheme(theme);

    let css = '';

    // Override inline styles with hardcoded accent (#3b82f6 and rgba variants)
    // by injecting high-specificity rules via attribute selectors.
    // The [style*="..."] selector matches any element whose style attribute
    // contains that substring — it wins over inline styles with !important.
    if (accent && accent !== '#3b82f6') {
        css += `
/* ── Accent inline style patch ────────────────────────── */
[style*="#3b82f6"] { color: var(--bmm-accent) !important; }
[style*="59, 130, 246"] { color: var(--bmm-accent) !important; }
/* border / background accent patches */
[style*="border-color:#3b82f6"],[style*="border-color: #3b82f6"] { border-color: var(--bmm-accent) !important; }
[style*="background:#3b82f6"],[style*="background-color:#3b82f6"] { background: var(--bmm-accent) !important; }
`;
    }
    if (bgBase && bgBase !== '#0a0e17') {
        css += `
[style*="#0a0e17"],[style*="background: #0a0e17"] { background: var(--bmm-bg-base) !important; }`;
    }
    if (bgElev && bgElev !== '#111827') {
        css += `
[style*="#111827"],[style*="background: #111827"],[style*="background-color: #111827"] { background: var(--bmm-bg-elevated) !important; }`;
    }
    if (danger  && danger  !== '#ef4444') {
        css += `[style*="#ef4444"],[style*="239, 68, 68"] { color: var(--bmm-danger) !important; }\n`;
    }
    if (success && success !== '#10b981') {
        css += `[style*="#10b981"],[style*="16, 185, 129"] { color: var(--bmm-success) !important; }\n`;
    }
    if (warning && warning !== '#f59e0b') {
        css += `[style*="#f59e0b"],[style*="245, 158, 11"] { color: var(--bmm-warning) !important; }\n`;
    }
    if (cyan    && cyan    !== '#06b6d4') {
        css += `[style*="#06b6d4"],[style*="6, 182, 212"] { color: var(--bmm-cyan) !important; }\n`;
    }

    // Light mode: force dark text on elements that have hardcoded light text colors
    if (isLight) {
        css += `
/* ── Light mode global text contrast patch ─────────────── */
body { color: var(--bmm-text-primary) !important; }
[style*="color: rgba(255, 255, 255"],
[style*="color:rgba(255,255,255"],
[style*="color: #f1f5f9"],
[style*="color: white"],
[style*="color:white"] {
    color: var(--bmm-text-primary) !important;
}
[style*="color: #94a3b8"],[style*="color:#94a3b8"] { color: var(--bmm-text-secondary) !important; }
[style*="color: #475569"],[style*="color:#475569"] { color: var(--bmm-text-muted) !important; }
[style*="background: rgba(255, 255, 255, 0.03)"],
[style*="background:rgba(255,255,255,0.03)"],
[style*="background: rgba(255, 255, 255, 0.04)"],
[style*="background: rgba(255, 255, 255, 0.05)"],
[style*="background: rgba(255, 255, 255, 0.06)"],
[style*="background: rgba(255, 255, 255, 0.08)"] {
    background: rgba(0,0,0,0.04) !important;
}
[style*="border: 1px solid rgba(255, 255, 255"],
[style*="border:1px solid rgba(255,255,255"] {
    border-color: rgba(0,0,0,0.12) !important;
}
`;
    }
    return css;
}

/** Patch JS-generated inline styles in real-time via MutationObserver.
 *  When elements appear with hardcoded colours, swap them to CSS variables. */
/** Whether a theme is effectively LIGHT. The declared `mode` wins; when absent
 *  (typical for user-made themes cloned from a dark base), it is AUTO-DETECTED
 *  from the base background's luminance — so light custom themes get the same
 *  contrast patches + enforcer as the built-in light themes, and their texts
 *  never stay stuck white-on-white. */
export function isLightTheme(theme: BmmTheme | null | undefined): boolean {
    if (!theme) return false;
    if (theme.mode === 'light') return true;
    if (theme.mode === 'dark') return false;
    const bg = theme.vars?.['--bmm-bg-base'] || '';
    const m = bg.match(/#([0-9a-fA-F]{6})/);
    if (m) {
        const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
        return _lum(r, g, b) > 0.5;
    }
    const rgb = _parseRgb(bg);
    if (rgb) return _lum(rgb[0], rgb[1], rgb[2]) > 0.5;
    return false;
}

// ── Light-mode contrast enforcer ──────────────────────────────────────────────
// Many components hardcode dark-theme light text colours (incomplete token
// migration). On light themes that text is invisible. This walks text-bearing
// elements and, when their computed text colour is too light AND they sit on a
// light background, rewrites the colour to the theme token (theme-safe — the
// token flips back to light if a dark theme is later applied). Dark-background
// components (code blocks, devtools…) keep their light text because we check the
// effective background first.
const CONTRAST_ATTR = 'data-bmm-contrast';
const CONTRAST_KEY  = 'bmm_contrast_enforce';   // 'false' = user disabled it

/** Whether the automatic light-theme contrast enforcer is enabled (default on). */
export function isContrastEnforced(): boolean {
    return localStorage.getItem(CONTRAST_KEY) !== 'false';
}
/** Remove every inline colour the enforcer applied (restore original styling).
 *  Elements that HAD an inline colour before the enforcer overwrote it get that
 *  exact value back (stored in data attrs at enforce time) — so disabling the
 *  enforcer or resetting the theme returns texts to their true original look. */
function clearAllEnforced(): void {
    document.querySelectorAll(`[${CONTRAST_ATTR}]`).forEach(node => {
        const el = node as HTMLElement;
        const restore = (prop: string, saved?: string) => {
            el.style.removeProperty(prop);
            if (saved) {
                const [val, pr] = saved.split('||');
                try { el.style.setProperty(prop, val, pr || ''); } catch {}
            }
        };
        restore('color', el.dataset.bmmContrastOrigC);
        restore('background-color', el.dataset.bmmContrastOrigB);
        delete el.dataset.bmmContrastOrigC;
        delete el.dataset.bmmContrastOrigB;
        el.removeAttribute(CONTRAST_ATTR);
    });
}
/** Debounced full-document enforce — used by live preview so the pass runs ~300ms
 *  after the last change instead of on every keystroke. */
let _enforceTimer: number | null = null;
function _scheduleEnforce(): void {
    if (_enforceTimer !== null) clearTimeout(_enforceTimer);
    _enforceTimer = window.setTimeout(() => {
        _enforceTimer = null;
        try { enforceLightContrast(document); } catch {}
    }, 300);
}
/** Save the element's own inline value (if any) before the enforcer overwrites it. */
function _saveOrig(el: HTMLElement, prop: 'color' | 'background-color'): void {
    const key = prop === 'color' ? 'bmmContrastOrigC' : 'bmmContrastOrigB';
    if (el.dataset[key] !== undefined) return;                    // already saved
    const val = el.style.getPropertyValue(prop);
    if (val) el.dataset[key] = `${val}||${el.style.getPropertyPriority(prop)}`;
}
/** Turn the contrast enforcer on/off and apply the change immediately. */
export function setContrastEnforced(on: boolean): void {
    localStorage.setItem(CONTRAST_KEY, on ? 'true' : 'false');
    if (!on) clearAllEnforced();
    else if (isLightTheme(_activeTheme)) enforceLightContrast(document);
}
function _lum(r: number, g: number, b: number): number {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function _parseRgb(s: string): [number, number, number, number] | null {
    const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i);
    if (!m) return null;
    return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
}
function _effectiveBgLum(el: HTMLElement): number {
    let node: HTMLElement | null = el;
    let hops = 0;
    while (node && hops++ < 12) {
        const c = _parseRgb(getComputedStyle(node).backgroundColor);
        if (c && c[3] > 0.5) return _lum(c[0], c[1], c[2]);
        node = node.parentElement;
    }
    return 1; // reached the (light) page background
}
// Tags / class fragments that must KEEP their own (often dark) background.
const _BG_SKIP_TAGS = new Set(['PRE', 'CODE', 'BUTTON', 'A', 'SVG', 'IMG', 'CANVAS', 'VIDEO', 'INPUT', 'TEXTAREA', 'SELECT']);
function _saturation(r: number, g: number, b: number): number {
    return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}
function enforceLightContrast(root: Element | Document): void {
    if (!isLightTheme(_activeTheme)) return;
    if (!isContrastEnforced()) return;
    // Elements the user is explicitly styling via the pick tool must win — never
    // let the enforcer's inline !important fight an element_override.
    const ovSelectors = (_activeTheme.element_overrides || [])
        .map(o => o.selector).filter(Boolean);
    const ovSel = ovSelectors.join(',');
    const isOverridden = (el: HTMLElement) => {
        if (!ovSel) return false;
        try { return el.matches(ovSel) || !!el.closest(ovSel); } catch { return false; }
    };
    const scan = (el: HTMLElement) => {
      try {
        if (!el || el.nodeType !== 1) return;
        if (el.closest('#bmm-theme-editor, #bte-elov, .bmm-csel-menu, #app-loader')) return;
        if (isOverridden(el)) return;
        const cls = el.className && typeof el.className === 'string' ? el.className : '';
        const isChip = /badge|btn|tag|pill|chip|toggle|dot|avatar|method|status/i.test(cls);
        const cs = getComputedStyle(el);

        // 1) Solid, low-saturation DARK surface backgrounds → elevated token.
        //    (Spares accent buttons/badges via saturation + class checks, and dark
        //     code blocks / media via tag checks.)
        if (!_BG_SKIP_TAGS.has(el.tagName) && !isChip) {
            const bg = _parseRgb(cs.backgroundColor);
            if (bg && bg[3] >= 0.85) {
                const bgLum = _lum(bg[0], bg[1], bg[2]);
                if (bgLum < 0.16 && _saturation(bg[0], bg[1], bg[2]) < 0.16) {
                    _saveOrig(el, 'background-color');
                    el.style.setProperty('background-color', 'var(--bmm-bg-elevated)', 'important');
                    el.setAttribute(CONTRAST_ATTR, 'bg');
                }
            }
        }

        // 1b) SVG icons whose colour (currentColor stroke/fill) is light AND sit on a
        //     light background → retint to a readable token. Coloured icons (accent,
        //     success…) are dark-ish so spared; icons on dark/coloured bg are skipped.
        if (el.tagName === 'svg' || el.tagName === 'SVG') {
            const sc = _parseRgb(cs.color);
            if (sc && _lum(sc[0], sc[1], sc[2]) > 0.6 && _effectiveBgLum(el) > 0.5) {
                _saveOrig(el, 'color');
                el.style.setProperty('color', 'var(--bmm-text-secondary)', 'important');
                el.setAttribute(CONTRAST_ATTR, 'svg');
            }
            return;
        }

        // 2) Light text sitting on a light background → dark text token.
        // Judged by the REAL WCAG contrast ratio instead of a crude "very light
        // text" threshold, so pale greys and washed-out mid-tones are caught too —
        // every text gets detected, not just near-white ones. Form fields count as
        // text-bearing even though their value isn't a text child node.
        const isFormField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
        let hasText = isFormField;
        if (!hasText) {
            for (const n of el.childNodes) {
                if (n.nodeType === 3 && (n.textContent || '').trim()) { hasText = true; break; }
            }
        }
        if (!hasText) return;
        const col = _parseRgb(cs.color);
        if (!col) return;
        const bgL = _effectiveBgLum(el);
        if (bgL <= 0.5) return; // sits on a dark surface — its colours are its own
        const txtL = _lum(col[0], col[1], col[2]);
        const ratio = (Math.max(bgL, txtL) + 0.05) / (Math.min(bgL, txtL) + 0.05);
        // Saturated (accent) colours keep their hue with a laxer bar — links, badges,
        // status text; plain/grey text is held to a readable minimum.
        const minRatio = _saturation(col[0], col[1], col[2]) > 0.35 ? 2.2 : 3.2;
        if (ratio < minRatio) {
            // Near-white text needs the strongest fix; failing mid-greys just darken.
            _saveOrig(el, 'color');
            el.style.setProperty('color', txtL > 0.55 ? 'var(--bmm-text-primary)' : 'var(--bmm-text-secondary)', 'important');
            el.setAttribute(CONTRAST_ATTR, '1');
        }
      } catch { /* never let one element abort the whole contrast pass */ }
    };
    const r = root as any;
    try {
        if (r.nodeType === 1) scan(r as HTMLElement);
        r.querySelectorAll?.('*').forEach((e: Element) => scan(e as HTMLElement));
    } catch { /* defensive */ }
}

function startPatchObserver(theme: BmmTheme): void {
    if (_patchObserver) { _patchObserver.disconnect(); _patchObserver = null; }
    const vars = theme.vars || {};
    const accent = vars['--bmm-accent'];
    const isLight = isLightTheme(theme);
    // Always patch when a theme is active (even just an accent change), so that
    // ALL hardcoded inline colours follow the theme → 100% customisable.
    // Light themes keep the observer alive even WITHOUT var overrides: the
    // contrast enforcer must still cover dynamically-added DOM.
    const hasOverrides = Object.keys(vars).length > 0;
    if (!hasOverrides && !isLight) return;

    // ── Comprehensive hardcoded → token map (covers every common BMM colour) ──
    const patches: [RegExp, string][] = [
        // Accent blue (hex + rgba, all opacities)
        [/#3b82f6/gi, 'var(--bmm-accent)'],
        [/#60a5fa/gi, 'var(--bmm-accent)'],   // lighter accent shade
        [/#2563eb/gi, 'var(--bmm-accent)'],   // darker accent shade
        [/rgba\(\s*59,\s*130,\s*246\s*,\s*([0-9.]+)\s*\)/gi, 'rgba(var(--bmm-accent-r),var(--bmm-accent-g),var(--bmm-accent-b),$1)'],
        [/rgba\(\s*96,\s*165,\s*250\s*,\s*([0-9.]+)\s*\)/gi, 'rgba(var(--bmm-accent-r),var(--bmm-accent-g),var(--bmm-accent-b),$1)'],
        // Cyan
        [/#06b6d4/gi, 'var(--bmm-cyan)'],
        [/#00c2ff/gi, 'var(--bmm-cyan)'],
        // Success green
        [/#10b981/gi, 'var(--bmm-success)'],
        [/#22c55e/gi, 'var(--bmm-success)'],
        [/#34d399/gi, 'var(--bmm-success)'],
        // Warning amber
        [/#f59e0b/gi, 'var(--bmm-warning)'],
        [/#fbbf24/gi, 'var(--bmm-warning)'],
        [/#f97316/gi, 'var(--bmm-warning)'],
        // Danger red
        [/#ef4444/gi, 'var(--bmm-danger)'],
        [/#f87171/gi, 'var(--bmm-danger)'],
        [/#ff6b6b/gi, 'var(--bmm-danger)'],
        // Purple
        [/#a78bfa/gi, 'var(--bmm-purple)'],
        [/#8b5cf6/gi, 'var(--bmm-purple)'],
        // Backgrounds
        [/#0a0e17/gi, 'var(--bmm-bg-base)'],
        [/#111827/gi, 'var(--bmm-bg-elevated)'],
        // Text colours
        [/#f1f5f9/gi, 'var(--bmm-text-primary)'],
        [/#94a3b8/gi, 'var(--bmm-text-secondary)'],
        [/#475569/gi, 'var(--bmm-text-muted)'],
        // White-alpha surfaces → token surfaces (works for both dark & light)
        [/rgba\(\s*255,\s*255,\s*255\s*,\s*([0-9.]+)\s*\)/gi, 'rgba(var(--bmm-surface-r),var(--bmm-surface-g),var(--bmm-surface-b),$1)'],
    ];

    const lightExtra: [RegExp, string][] = isLight ? [
        // Hardcoded light text → primary dark text (covers white/255 text on light bg).
        // Browsers normalise style.color='#fff'/'white' to rgb(255, 255, 255), so we
        // must catch the rgb() form too (set by JS onmouseover handlers).
        [/color:\s*white\b/gi, 'color:var(--bmm-text-primary)'],
        [/color:\s*#fff\b/gi, 'color:var(--bmm-text-primary)'],
        [/color:\s*#ffffff\b/gi, 'color:var(--bmm-text-primary)'],
        [/color:\s*rgb\(\s*255,\s*255,\s*255\s*\)/gi, 'color:var(--bmm-text-primary)'],
        [/color:\s*rgba\(\s*255,\s*255,\s*255[^)]*\)/gi, 'color:var(--bmm-text-primary)'],
        // Other very-light hardcoded text colours commonly used for "bright" hover
        [/color:\s*#f(1f5f9|8fafc|9fafb)\b/gi, 'color:var(--bmm-text-primary)'],
        [/color:\s*#e(2e8f0|5e7eb)\b/gi, 'color:var(--bmm-text-secondary)'],
    ] : [];

    const allPatches = [...patches, ...lightExtra];

    const patchEl = (el: HTMLElement) => {
        if (!el.style?.cssText) return;
        if (el.id?.startsWith('bmm-theme') || el.closest('#bmm-theme-editor') || el.closest('#bte-elov')) return;
        let txt = el.style.cssText;
        let changed = false;
        for (const [re, rep] of allPatches) {
            const next = txt.replace(re, rep);
            if (next !== txt) { txt = next; changed = true; }
        }
        if (changed) el.style.cssText = txt;
    };

    const patchAll = (root: Element | Document) => {
        (root as Element).querySelectorAll?.('[style]').forEach(el => patchEl(el as HTMLElement));
        if ((root as HTMLElement).style?.cssText) patchEl(root as HTMLElement);
    };

    patchAll(document);
    // (The full-document contrast pass is triggered from applyTheme — immediate on
    // real theme switches, debounced during live preview. Here we only keep the
    // observer that handles NEW dom nodes.)
    let scheduled = false;
    let pendingRoots: Element[] = [];
    _patchObserver = new MutationObserver(muts => {
        // Coalesce bursts of mutations into one pass per frame (perf)
        for (const m of muts) {
            if (m.type === 'childList') {
                m.addedNodes.forEach(n => { if (n.nodeType === 1) pendingRoots.push(n as Element); });
            } else if (m.type === 'attributes' && m.attributeName === 'style') {
                patchEl(m.target as HTMLElement);
            }
        }
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            const roots = pendingRoots; pendingRoots = [];
            for (const r of roots) {
                patchAll(r);
                if (isLight) enforceLightContrast(r);
            }
        });
    });
    _patchObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
}

function buildFontsCSS(theme: BmmTheme): string {
    if (!theme.fonts?.length) return '';
    // Escape quotes/backslashes in attacker-controlled strings before splicing into
    // a CSS text node — this is stylesheet text (not innerHTML/eval), so it can't
    // run script, but an unescaped quote could still break out of the font-family
    // value and append arbitrary extra CSS rules.
    const cssStr = (s: string) => String(s ?? '').replace(/[\\']/g, '\\$&').replace(/\r?\n/g, ' ');
    const cssUrl = (s: string) => String(s ?? '').replace(/["\\]/g, '\\$&').replace(/\r?\n/g, ' ');
    return theme.fonts.map(f => {
        const src = f.data ? `url("${cssUrl(f.data)}")` : f.url ? `url("${cssUrl(f.url)}")` : '';
        if (!src) return '';
        return `@font-face { font-family: '${cssStr(f.family)}'; src: ${src}; font-weight: ${f.weight || 'normal'}; font-style: ${f.style || 'normal'}; font-display: swap; }`;
    }).join('\n');
}

/** Remove the contrast-enforcer's inline colours from elements the user targets
 *  with an element_override, so the override CSS (also !important) takes effect. */
function clearEnforcedOnOverrides(theme: BmmTheme): void {
    const sels = (theme.element_overrides || []).map(o => o.selector).filter(Boolean);
    if (!sels.length) return;
    document.querySelectorAll(`[${CONTRAST_ATTR}]`).forEach(node => {
        const el = node as HTMLElement;
        for (const s of sels) {
            try {
                if (el.matches(s) || el.closest(s)) {
                    el.style.removeProperty('color');
                    el.style.removeProperty('background-color');
                    el.removeAttribute(CONTRAST_ATTR);
                    break;
                }
            } catch { /* invalid selector */ }
        }
    });
}

// ── HTML sanitization ──────────────────────────────────────────────────────────
// Themes are files a user can import/share (custom_elements + html_swaps both
// inject raw HTML via innerHTML). Stripping only <script> tags is NOT enough —
// `<img src=x onerror="...">`, `<a href="javascript:...">`, `<svg onload="...">`
// etc. all execute without ever using a <script> tag. This walks the parsed DOM
// (via a template element — never innerHTML'd onto a live node before cleaning)
// and removes dangerous elements/attributes before the caller ever inserts it.
const SANITIZE_DROP_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM']);
function sanitizeHtml(html: string): string {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html ?? '');
    const walk = (root: DocumentFragment | Element) => {
        // Snapshot first — removing/mutating nodes while iterating a live NodeList skips siblings.
        const all = Array.from(root.querySelectorAll('*'));
        for (const el of all) {
            if (!root.contains(el)) continue; // already removed along with a dropped ancestor
            if (SANITIZE_DROP_TAGS.has(el.tagName)) { el.remove(); continue; }
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
                if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'formaction')
                    && /^\s*(javascript|data:text\/html|vbscript):/i.test(attr.value)) {
                    el.removeAttribute(attr.name);
                }
            }
        }
    };
    walk(tpl.content);
    return tpl.innerHTML;
}

// ── HTML swaps — replace matching elements' innerHTML (e.g. swap an icon's SVG) ─
const SWAP_ATTR = 'data-bmm-swap';
function applyHtmlSwaps(theme: BmmTheme): void {
    if (_htmlSwapObserver) { _htmlSwapObserver.disconnect(); _htmlSwapObserver = null; }
    // Restore any previously-swapped elements not covered by the new theme.
    document.querySelectorAll(`[${SWAP_ATTR}]`).forEach(el => {
        const e = el as HTMLElement;
        if (e.dataset.bmmSwapOrig !== undefined) e.innerHTML = e.dataset.bmmSwapOrig;
        e.removeAttribute(SWAP_ATTR);
        delete e.dataset.bmmSwapOrig;
    });
    const swaps = (theme.html_swaps || []).filter(s => s.selector && s.html);
    if (!swaps.length) return;

    const applyAll = () => {
        for (const s of swaps) {
            let nodes: NodeListOf<Element>;
            try { nodes = document.querySelectorAll(s.selector); } catch { continue; }
            nodes.forEach(node => {
                const el = node as HTMLElement;
                if (el.closest('#bmm-theme-editor, #bte-elov')) return;
                if (el.getAttribute(SWAP_ATTR) === s.selector) return;   // already swapped
                if (el.dataset.bmmSwapOrig === undefined) el.dataset.bmmSwapOrig = el.innerHTML;
                el.innerHTML = sanitizeHtml(s.html);
                el.setAttribute(SWAP_ATTR, s.selector);
            });
        }
    };
    applyAll();
    _htmlSwapObserver = new MutationObserver(() => applyAll());
    _htmlSwapObserver.observe(document.body, { childList: true, subtree: true });
}

// ── Custom elements — survive re-renders via MutationObserver ─────────────────
// A custom element's HTML goes through sanitizeHtml, which strips EVERY on* attribute — as
// it must, since theme HTML is untrusted. That silently broke the editor's own deeplink
// buttons: it handed you `onclick="window.__bmmDeeplink(…)"` snippets that were removed on
// the way in, so the button applied fine and then did nothing at all. Declare the intent in
// a data attribute instead (data-* survives sanitising) and run it from one delegated
// listener here, which also means no inline script ever executes.
let _ceDeeplinkBound = false;
function bindCustomElementDeeplinks(): void {
    if (_ceDeeplinkBound) return;
    _ceDeeplinkBound = true;
    document.addEventListener('click', (e) => {
        const el = (e.target as HTMLElement)?.closest?.('[data-bmm-deeplink]') as HTMLElement | null;
        if (!el) return;
        const url = el.getAttribute('data-bmm-deeplink') || '';
        if (!/^bmm:\/\//i.test(url)) return;   // only ever our own scheme
        e.preventDefault();
        try { (window as any).__bmmDeeplink?.(url); } catch { /* ignore */ }
    });
}

function applyCustomElements(theme: BmmTheme): void {
    if (_customElementObserver) { _customElementObserver.disconnect(); _customElementObserver = null; }
    if (!theme.custom_elements?.length) return;
    bindCustomElementDeeplinks();

    const injectAll = () => {
        const currentPage = document.body.getAttribute(DATA_PAGE_ATTR) || '';
        for (const ce of theme.custom_elements!) {
            if (ce.scope && ce.scope !== currentPage) continue;
            const host = document.querySelector(ce.target);
            if (!host) continue;
            if (host.querySelector(`[data-bmm-ce="${ce.id}"]`)) continue; // already injected
            const div = document.createElement('div');
            div.dataset.bmmCe = ce.id;
            div.innerHTML = sanitizeHtml(ce.html);
            if (ce.position === 'prepend') host.prepend(div);
            else if (ce.position === 'append') host.append(div);
            else if (ce.position === 'before') host.before(div);
            else host.after(div);
        }
    };

    injectAll();
    _customElementObserver = new MutationObserver(injectAll);
    _customElementObserver.observe(document.body, { childList: true, subtree: true });
}

function removeCustomElements(): void {
    if (_customElementObserver) { _customElementObserver.disconnect(); _customElementObserver = null; }
    document.querySelectorAll('[data-bmm-ce]').forEach(el => el.remove());
}

// ── Public API ─────────────────────────────────────────────────────────────────
/** Apply a theme object to the running app instantly. */
export function applyTheme(theme: BmmTheme): void {
    _activeTheme = theme;
    getOrCreate(STYLE_VARS_ID).textContent  = buildVarsCSS(theme);
    getOrCreate(STYLE_CSS_ID).textContent   = buildCSSBlock(theme);
    getOrCreate(STYLE_FONTS_ID).textContent = buildFontsCSS(theme);
    getOrCreate(STYLE_PATCH_ID).textContent = buildPatchCSS(theme);
    try { applyCustomElements(theme); } catch {}
    try { applyHtmlSwaps(theme); } catch {}
    try { applyAssets(theme); } catch {}
    try { startPatchObserver(theme); } catch {}
    // Let element_overrides win: strip the enforcer's inline !important colours
    // from any element the user is explicitly styling via the pick tool.
    try { clearEnforcedOnOverrides(theme); } catch {}
    // When the new theme is NOT a light theme (or the enforcer is off), wipe EVERY
    // inline contrast colour a previous light theme injected. Without this, already
    // rendered dynamic elements (mod/profile cards) keep their stale light-mode
    // colours after a Discard / Revert-all / preset / generator switch until they
    // happen to re-render — exactly the "need to refresh to look right" bug.
    try { if (!isLightTheme(theme) || !isContrastEnforced()) clearAllEnforced(); } catch {}
    // Light theme + enforcer on → contrast pass on EVERY apply (no "toggle the
    // setting off/on to see it" dance). Real switches run immediately; live-preview
    // applies are debounced so editor keystrokes stay snappy.
    try {
        if (isLightTheme(theme) && isContrastEnforced()) {
            if (theme.id === '__preview__') _scheduleEnforce();
            else enforceLightContrast(document);
        }
    } catch {}
    // Disable all animations (intro/exit, Tasky spin, transitions) when speed = 0
    const speed = (theme.vars || {})['--bmm-anim-speed'];
    document.body.classList.toggle('bmm-no-anim', speed === '0' || speed === '0.0');
    // Flag light themes so CSS can fix hover/dropdown contrast that hardcodes light text.
    document.body.classList.toggle('bmm-theme-light', isLightTheme(theme));
    if (theme.id !== '__preview__') localStorage.setItem(ACTIVE_KEY, theme.id);
    // Anything that BAKES a token value in at render time — mermaid writes its palette into the
    // SVG it produces — cannot follow a theme through CSS alone and has to be told.
    try { window.dispatchEvent(new CustomEvent('bmm:theme-applied', { detail: { id: theme.id } })); } catch {}
}

/** Apply image/video assets: replace the corner mascot, the boot loader mascot,
 *  and the app logo if the theme provides them (base64 data-URI or URL). */
// Every Tasky image across BMM: corner mascot, boot loader, close/outro animation,
// settings card icon, docs tooltip, tutorial hub, power mascots.
const MASCOT_SELECTORS = [
    '#app-mascot', '#loader-img', '#ld-logo', '#vhs-tasky-img',
    '#settings-tasky-icon', '#tasky-mascot-img', '.tut-hub-mascot', '.bh-pow-mascot',
    '.tut-avatar img', '.tut-min-mascot', '.tut-finish-mascot',
];
function applyAssets(theme: BmmTheme): void {
    const a = theme.assets || {};
    const mascot = a.mascot;
    const setImg = (sel: string, val?: string) => {
        document.querySelectorAll(sel).forEach(node => {
            const el = node as HTMLImageElement;
            if (val) { if (!el.dataset.bmmOrig) el.dataset.bmmOrig = el.src; el.src = val; }
            else if (el.dataset.bmmOrig) { el.src = el.dataset.bmmOrig; }   // restore default
        });
    };
    const applyMascot = () => {
        setImg('#loader-img', mascot || a.loader);
        for (const sel of MASCOT_SELECTORS) if (sel !== '#loader-img') setImg(sel, mascot);
    };
    applyMascot();
    // Re-apply to mascots created later (e.g. the tutorial hub opens on demand).
    if (_assetObserver) { _assetObserver.disconnect(); _assetObserver = null; }
    if (mascot || a.loader) {
        _assetObserver = new MutationObserver(() => applyMascot());
        _assetObserver.observe(document.body, { childList: true, subtree: true });
    }
    // App logo (sidebar)
    if (a.logo) document.documentElement.style.setProperty('--bmm-nav-logo-url', `url("${a.logo}")`);
    else document.documentElement.style.removeProperty('--bmm-nav-logo-url');
}

/** Remove all theme overrides and revert to BMM default. */
export function resetTheme(): void {
    _activeTheme = null;
    getOrCreate(STYLE_VARS_ID).textContent  = '';
    getOrCreate(STYLE_CSS_ID).textContent   = '';
    getOrCreate(STYLE_FONTS_ID).textContent = '';
    getOrCreate(STYLE_PATCH_ID).textContent = '';
    removeCustomElements();
    applyHtmlSwaps({ id: '', name: '' } as BmmTheme);   // restores swapped elements
    // Restore every swapped image (mascot, loader, corner art…) back to its true
    // original src, and drop the custom nav logo. Without this, resetting after a
    // theme that swapped the mascot left the swapped image on screen forever —
    // applyAssets() with no assets is exactly what undoes applyAssets(theme).
    try { applyAssets({ id: '', name: '' } as BmmTheme); } catch {}
    if (_patchObserver) { _patchObserver.disconnect(); _patchObserver = null; }
    // Wipe enforcer inline colours + reset the body flags, otherwise dynamic
    // elements keep stale light-theme styling until they re-render.
    if (_enforceTimer !== null) { clearTimeout(_enforceTimer); _enforceTimer = null; }
    clearAllEnforced();
    document.body.classList.remove('bmm-theme-light', 'bmm-no-anim');
    document.documentElement.style.removeProperty('--bmm-nav-logo-url');
    localStorage.removeItem(ACTIVE_KEY);
}

/** Live-preview a partial theme without persisting. */
export function previewTheme(partial: Partial<BmmTheme>): void {
    applyTheme({ id: '__preview__', name: 'Preview', ...(_activeTheme || {}), ...partial });
}

/** Returns the currently active theme or null. */
export function getActiveTheme(): BmmTheme | null { return _activeTheme; }

// ── data-page tracking (enables per-page CSS scoping) ─────────────────────────
export function initDataPage(): void {
    const setPage = () => {
        const active = document.querySelector('.view.active-view') as HTMLElement | null;
        if (active) {
            const id = active.id.replace('view-', '');
            document.body.setAttribute(DATA_PAGE_ATTR, id);
        }
    };
    // Set on init + observe nav clicks
    setPage();
    document.addEventListener('click', (e) => {
        const nav = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
        if (nav) setTimeout(setPage, 50);
    });
    // Also watch active-view class changes
    new MutationObserver(setPage).observe(document.body, { subtree: true, attributeFilter: ['class'] });
}

// ── Persistence — restore theme at boot (before first render) ─────────────────
let _installedThemes: Record<string, BmmTheme> = {};

export async function loadInstalledThemes(): Promise<BmmTheme[]> {
    try {
        const raw: string = await invoke('list_installed_themes');
        const list: BmmTheme[] = JSON.parse(raw || '[]');
        _installedThemes = {};
        for (const t of list) _installedThemes[t.id] = t;
        return list;
    } catch {
        return [];
    }
}

export function getInstalledThemes(): BmmTheme[] {
    return Object.values(_installedThemes);
}

export function getCachedTheme(id: string): BmmTheme | undefined {
    return _installedThemes[id];
}

/** Called at app boot — restores the last active theme synchronously from
 *  localStorage (fast, no IPC) so there is no visible flash. */
export async function restoreThemeAtBoot(): Promise<void> {
    initDataPage();
    // Load the built-in presets from the bundled folder FIRST so every later
    // BUILTIN_THEMES lookup (here + the theme editor) resolves correctly.
    await loadBuiltinThemes();
    const activeId = localStorage.getItem(ACTIVE_KEY);

    // Apply the active theme fast (no flash): a built-in from the loaded set, or a
    // cached custom theme from localStorage.
    const builtin = activeId ? BUILTIN_THEMES.find(b => b.id === activeId) : null;
    if (builtin) {
        applyTheme(builtin);
    } else if (activeId) {
        const cached = localStorage.getItem(`bmm_theme_cache_${activeId}`);
        if (cached) { try { applyTheme(JSON.parse(cached)); } catch {} }
    }

    // ALWAYS pull the installed (imported / catalogue) themes from disk into the
    // in-memory map — even when the active theme is a built-in or unset — so they
    // survive a restart and show up in every selector (settings, catalogue, editor).
    try {
        const themes = await loadInstalledThemes();
        // If the active theme is a custom one, restore it authoritatively from disk.
        if (activeId && !builtin) {
            const theme = themes.find(t => t.id === activeId);
            if (theme) {
                applyTheme(theme);
                localStorage.setItem(`bmm_theme_cache_${activeId}`, JSON.stringify(theme));
            } else if (!BUILTIN_THEMES.some(b => b.id === activeId)) {
                resetTheme();
            }
        }
    } catch {}
}

export async function installTheme(theme: BmmTheme): Promise<void> {
    await invoke('install_theme', { themeJson: JSON.stringify(theme) });
    _installedThemes[theme.id] = theme;
    localStorage.setItem(`bmm_theme_cache_${theme.id}`, JSON.stringify(theme));
}

export async function deleteTheme(id: string): Promise<void> {
    await invoke('delete_theme', { themeId: id });
    delete _installedThemes[id];
    localStorage.removeItem(`bmm_theme_cache_${id}`);
    if (_activeTheme?.id === id) resetTheme();
}

export async function activateTheme(id: string): Promise<void> {
    const theme = _installedThemes[id];
    if (!theme) { toast(t('themes.notFound') || 'Theme not found', 'error'); return; }
    applyTheme(theme);
    await invoke('set_active_theme', { themeId: id }).catch(() => {});
    try { (window as any).bmmTrack?.('feature', { name: 'theme.apply' }); } catch {}
}

export async function exportTheme(id: string): Promise<void> {
    try {
        // Pass the theme JSON as a fallback so built-in presets (which live in the
        // bundled folder, not the installed-themes dir) can be exported too.
        const known = BUILTIN_THEMES.find(b => b.id === id) || _installedThemes[id]
            || (_activeTheme?.id === id ? _activeTheme : null);
        const themeJson = known ? JSON.stringify(known) : null;
        await invoke('export_theme', { themeId: id, themeJson });
        toast(t('themes.exported') || 'Theme exported', 'success');
    } catch (e) { toast(String(e), 'error'); }
}

// ── Built-in themes ────────────────────────────────────────────────────────────
// Helper to generate accent-rgb components from a hex colour string
function rgb(hex: string): { r: string; g: string; b: string } {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? { r: String(parseInt(m[1], 16)), g: String(parseInt(m[2], 16)), b: String(parseInt(m[3], 16)) } : { r: '59', g: '130', b: '246' };
}

/** Built-in theme presets. NOT hardcoded — loaded from the bundled
 *  `builtin-themes/` resource folder (one .json per preset) by loadBuiltinThemes().
 *  Add/remove a file there to change the set; the quick presets and the Installed
 *  list pick it up automatically. */
export let BUILTIN_THEMES: BmmTheme[] = [];

/** Load built-in presets from disk. Awaited early at boot (before the active theme
 *  is applied) so synchronous BUILTIN_THEMES lookups resolve correctly. */
export async function loadBuiltinThemes(): Promise<void> {
    try {
        const raw = await invoke('list_builtin_themes') as string;
        const arr = JSON.parse(raw || '[]');
        BUILTIN_THEMES = Array.isArray(arr) ? arr : [];
    } catch (e) {
        console.error('[BMM] Failed to load built-in themes:', e);
        BUILTIN_THEMES = [];
    }
}
