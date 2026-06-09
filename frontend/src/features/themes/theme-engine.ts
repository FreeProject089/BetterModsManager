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

function buildVarsCSS(theme: BmmTheme): string {
    const merged = { ...(theme.vars || {}), ...deriveChannels(theme.vars || {}) };
    const global = theme.vars ? Object.entries(merged)
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
    const isLight = theme.mode === 'light';

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
function startPatchObserver(theme: BmmTheme): void {
    if (_patchObserver) { _patchObserver.disconnect(); _patchObserver = null; }
    const vars = theme.vars || {};
    const accent = vars['--bmm-accent'];
    const isLight = theme.mode === 'light';
    // Always patch when a theme is active (even just an accent change), so that
    // ALL hardcoded inline colours follow the theme → 100% customisable.
    const hasOverrides = Object.keys(vars).length > 0;
    if (!hasOverrides) return;

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
    let scheduled = false;
    _patchObserver = new MutationObserver(muts => {
        // Coalesce bursts of mutations into one pass per frame (perf)
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            for (const m of muts) {
                if (m.type === 'childList') {
                    m.addedNodes.forEach(n => {
                        if (n.nodeType === 1) patchAll(n as Element);
                    });
                } else if (m.type === 'attributes' && m.attributeName === 'style') {
                    patchEl(m.target as HTMLElement);
                }
            }
        });
    });
    _patchObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
}

function buildFontsCSS(theme: BmmTheme): string {
    if (!theme.fonts?.length) return '';
    return theme.fonts.map(f => {
        const src = f.data ? `url("${f.data}")` : f.url ? `url("${f.url}")` : '';
        if (!src) return '';
        return `@font-face { font-family: '${f.family}'; src: ${src}; font-weight: ${f.weight || 'normal'}; font-style: ${f.style || 'normal'}; font-display: swap; }`;
    }).join('\n');
}

// ── Custom elements — survive re-renders via MutationObserver ─────────────────
function applyCustomElements(theme: BmmTheme): void {
    if (_customElementObserver) { _customElementObserver.disconnect(); _customElementObserver = null; }
    if (!theme.custom_elements?.length) return;

    const injectAll = () => {
        const currentPage = document.body.getAttribute(DATA_PAGE_ATTR) || '';
        for (const ce of theme.custom_elements!) {
            if (ce.scope && ce.scope !== currentPage) continue;
            const host = document.querySelector(ce.target);
            if (!host) continue;
            if (host.querySelector(`[data-bmm-ce="${ce.id}"]`)) continue; // already injected
            const div = document.createElement('div');
            div.dataset.bmmCe = ce.id;
            // sanitise: no <script> tags allowed in imported themes
            div.innerHTML = ce.html.replace(/<script[\s\S]*?<\/script>/gi, '');
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
    applyCustomElements(theme);
    applyAssets(theme);
    startPatchObserver(theme);
    // Disable all animations (intro/exit, Tasky spin, transitions) when speed = 0
    const speed = (theme.vars || {})['--bmm-anim-speed'];
    document.body.classList.toggle('bmm-no-anim', speed === '0' || speed === '0.0');
    // Flag light themes so CSS can fix hover/dropdown contrast that hardcodes light text.
    document.body.classList.toggle('bmm-theme-light', theme.mode === 'light');
    if (theme.id !== '__preview__') localStorage.setItem(ACTIVE_KEY, theme.id);
}

/** Apply image/video assets: replace the corner mascot, the boot loader mascot,
 *  and the app logo if the theme provides them (base64 data-URI or URL). */
function applyAssets(theme: BmmTheme): void {
    const a = theme.assets || {};
    const setImg = (sel: string, val?: string, defaultSrc?: string) => {
        const el = document.querySelector(sel) as HTMLImageElement | null;
        if (!el) return;
        if (val) { if (!el.dataset.bmmOrig) el.dataset.bmmOrig = el.src; el.src = val; }
        else if (el.dataset.bmmOrig) { el.src = el.dataset.bmmOrig; }   // restore default
    };
    setImg('#app-mascot', a.mascot);          // corner Tasky
    setImg('#loader-img', a.mascot || a.loader); // spinning boot Tasky
    // App logo (sidebar)
    if (a.logo) document.documentElement.style.setProperty('--bmm-nav-logo-url', `url("${a.logo}")`);
}

/** Remove all theme overrides and revert to BMM default. */
export function resetTheme(): void {
    _activeTheme = null;
    getOrCreate(STYLE_VARS_ID).textContent  = '';
    getOrCreate(STYLE_CSS_ID).textContent   = '';
    getOrCreate(STYLE_FONTS_ID).textContent = '';
    getOrCreate(STYLE_PATCH_ID).textContent = '';
    removeCustomElements();
    if (_patchObserver) { _patchObserver.disconnect(); _patchObserver = null; }
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
    const activeId = localStorage.getItem(ACTIVE_KEY);
    if (!activeId) return;

    // Quick restore from cache in localStorage to avoid IPC delay
    const cached = localStorage.getItem(`bmm_theme_cache_${activeId}`);
    if (cached) {
        try { applyTheme(JSON.parse(cached)); } catch {}
    }

    // Then do the authoritative load from disk
    try {
        const themes = await loadInstalledThemes();
        const theme = themes.find(t => t.id === activeId);
        if (theme) {
            applyTheme(theme);
            localStorage.setItem(`bmm_theme_cache_${activeId}`, JSON.stringify(theme));
        } else {
            resetTheme();
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
}

export async function exportTheme(id: string): Promise<void> {
    try {
        await invoke('export_theme', { themeId: id });
        toast(t('themes.exported') || 'Theme exported', 'success');
    } catch (e) { toast(String(e), 'error'); }
}

// ── Built-in themes ────────────────────────────────────────────────────────────
// Helper to generate accent-rgb components from a hex colour string
function rgb(hex: string): { r: string; g: string; b: string } {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? { r: String(parseInt(m[1], 16)), g: String(parseInt(m[2], 16)), b: String(parseInt(m[3], 16)) } : { r: '59', g: '130', b: '246' };
}
function accentVars(hex: string, dimOpacity = 0.18, borderOpacity = 0.4): Record<string, string> {
    const { r, g, b } = rgb(hex);
    return {
        '--bmm-accent':        hex,
        '--bmm-accent-dim':    `rgba(${r},${g},${b},${dimOpacity})`,
        '--bmm-accent-r':      r, '--bmm-accent-g': g, '--bmm-accent-b': b,
        '--bmm-border-accent': `rgba(${r},${g},${b},${borderOpacity})`,
        '--bmm-accent-glow':   `0 0 20px rgba(${r},${g},${b},0.35)`,
    };
}

/** Light-mode surface overrides — inverts white-alpha glass tints to black-alpha. */
function lightSurfaces(): Record<string, string> {
    return {
        '--bmm-surface-r': '0', '--bmm-surface-g': '0', '--bmm-surface-b': '0',
        '--bmm-s02': 'rgba(0,0,0,0.02)', '--bmm-s03': 'rgba(0,0,0,0.03)',
        '--bmm-s04': 'rgba(0,0,0,0.04)', '--bmm-s05': 'rgba(0,0,0,0.05)',
        '--bmm-s06': 'rgba(0,0,0,0.06)', '--bmm-s07': 'rgba(0,0,0,0.07)',
        '--bmm-s08': 'rgba(0,0,0,0.08)', '--bmm-s09': 'rgba(0,0,0,0.09)',
        '--bmm-s10': 'rgba(0,0,0,0.10)', '--bmm-s12': 'rgba(0,0,0,0.12)',
        '--bmm-s15': 'rgba(0,0,0,0.15)', '--bmm-s20': 'rgba(0,0,0,0.20)',
        '--bmm-glass-bg': 'rgba(0,0,0,0.03)', '--bmm-glass-border': 'rgba(0,0,0,0.08)',
        '--bmm-bg-hover': 'rgba(0,0,0,0.045)',
        '--bmm-color-scheme': 'light',
    };
}

export const BUILTIN_THEMES: BmmTheme[] = [
    // 1. BMM Default (blue)
    {
        id: 'bmm-default', name: 'BMM Default', author: 'BMM Team',
        description: 'The original BMM dark blue theme.', vars: {},
    },
    // 2. Sombre (Discord-style soft dark)
    {
        id: 'bmm-sombre', name: 'Sombre', author: 'BMM Team',
        description: 'Soft dark grey like Discord, blurple accent.',
        vars: {
            '--bmm-bg-base': '#1a1a1e', '--bmm-bg-elevated': '#232328',
            '--bmm-bg-sidebar': '#161619', '--bmm-bg-titlebar': '#141417',
            '--bmm-titlebar-bg': '#141417', '--bmm-loader-bg': '#141417',
            '--bmm-text-primary': '#dbdee1', '--bmm-text-secondary': '#b5bac1',
            '--bmm-text-muted': '#80848e', '--bmm-cyan': '#00a8fc',
            '--bmm-success': '#23a559', '--bmm-warning': '#f0b232', '--bmm-danger': '#f23f43',
            ...accentVars('#5865f2'),
        },
    },
    // 3. Void / Noir (pure black, monochrome grey-white accent — NO blue)
    {
        id: 'bmm-void', name: 'Void / Noir', author: 'BMM Team',
        description: 'Pure black, monochrome grey-white accent, hairline borders.',
        vars: {
            '--bmm-bg-base': '#000000', '--bmm-bg-elevated': '#0b0b0d',
            '--bmm-bg-sidebar': '#060607', '--bmm-bg-titlebar': '#000000',
            '--bmm-titlebar-bg': '#000000', '--bmm-loader-bg': '#000000',
            '--bmm-border': 'rgba(255,255,255,0.055)', '--bmm-border-hover': 'rgba(255,255,255,0.16)',
            '--bmm-text-primary': '#f5f5f7', '--bmm-text-secondary': '#a1a1a8',
            '--bmm-text-muted': '#55555c', '--bmm-radius-card': '12px',
            '--bmm-card-glow': '0 0 0 1px rgba(255,255,255,0.03)',
            // Grey-white accent — dark text on the light accent so buttons stay readable.
            '--bmm-btn-primary-text': '#0a0a0a',
            '--bmm-cyan': '#d4d4d8',
            ...accentVars('#d4d4d8'),
        },
    },
    // 4. Full White (bright, dark text)
    {
        id: 'bmm-white', name: 'Full White', author: 'BMM Team',
        description: 'Pure white interface with strong dark text for readability.',
        mode: 'light',
        vars: {
            '--bmm-bg-base': '#ffffff', '--bmm-bg-elevated': '#ffffff', '--bmm-bg-overlay': '#ffffff',
            '--bmm-bg-sidebar': '#f4f4f6', '--bmm-bg-titlebar': '#ececef',
            '--bmm-titlebar-bg': '#ececef', '--bmm-loader-bg': '#ffffff',
            '--bmm-border': 'rgba(0,0,0,0.13)', '--bmm-border-hover': 'rgba(0,0,0,0.24)',
            '--bmm-text-primary': '#000000', '--bmm-text-secondary': '#27272a',
            '--bmm-text-muted': '#52525b', '--bmm-success': '#15803d',
            '--bmm-warning': '#b45309', '--bmm-danger': '#dc2626', '--bmm-cyan': '#075985',
            '--bmm-tasky-bubble-bg': 'rgba(255,255,255,0.96)', '--bmm-tasky-bubble-text': '#000000',
            '--bmm-shadow-card': '0 2px 12px rgba(0,0,0,0.08)',
            ...lightSurfaces(),
            ...accentVars('#1d4ed8'),
        },
    },
    // 5. Discord (authentic Discord dark palette)
    {
        id: 'bmm-discord', name: 'Discord', author: 'BMM Team',
        description: 'The authentic Discord dark look — layered greys & blurple.',
        vars: {
            '--bmm-bg-base': '#313338', '--bmm-bg-elevated': '#2b2d31',
            '--bmm-bg-sidebar': '#1e1f22', '--bmm-bg-titlebar': '#1e1f22',
            '--bmm-titlebar-bg': '#1e1f22', '--bmm-loader-bg': '#1e1f22',
            '--bmm-border': 'rgba(255,255,255,0.06)', '--bmm-border-hover': 'rgba(255,255,255,0.13)',
            '--bmm-text-primary': '#f2f3f5', '--bmm-text-secondary': '#b5bac1',
            '--bmm-text-muted': '#949ba4', '--bmm-cyan': '#00a8fc',
            '--bmm-success': '#23a559', '--bmm-warning': '#f0b232', '--bmm-danger': '#f23f43',
            '--bmm-radius-btn': '8px', '--bmm-radius-card': '8px',
            ...accentVars('#5865f2'),
        },
    },
    // 6. Orange / Noir (black with a vivid orange accent)
    {
        id: 'bmm-orange', name: 'Orange / Noir', author: 'BMM Team',
        description: 'Deep black with a bold, warm orange accent.',
        vars: {
            '--bmm-bg-base': '#0a0a0a', '--bmm-bg-elevated': '#161614',
            '--bmm-bg-sidebar': '#000000', '--bmm-bg-titlebar': '#000000',
            '--bmm-titlebar-bg': '#000000', '--bmm-loader-bg': '#000000',
            '--bmm-border': 'rgba(255,255,255,0.07)', '--bmm-border-hover': 'rgba(255,140,26,0.35)',
            '--bmm-text-primary': '#f6f1ea', '--bmm-text-secondary': '#b3aa9f',
            '--bmm-text-muted': '#6c655c', '--bmm-radius-card': '12px',
            '--bmm-cyan': '#ff8c1a', '--bmm-warning': '#ffb340',
            '--bmm-card-glow': '0 0 22px rgba(255,106,0,0.08)',
            // Dark text on the bright orange buttons for contrast.
            '--bmm-btn-primary-text': '#1a0d00',
            ...accentVars('#ff6a00'),
        },
    },
    // 7. Spotify Green
    {
        id: 'bmm-spotify', name: 'Spotify Green', author: 'BMM Team',
        description: 'Spotify-style near-black with that iconic green accent.',
        vars: {
            '--bmm-bg-base': '#121212', '--bmm-bg-elevated': '#181818',
            '--bmm-bg-sidebar': '#000000', '--bmm-bg-titlebar': '#0a0a0a',
            '--bmm-titlebar-bg': '#0a0a0a', '--bmm-loader-bg': '#000000',
            '--bmm-border': 'rgba(255,255,255,0.07)', '--bmm-text-primary': '#ffffff',
            '--bmm-text-secondary': '#b3b3b3', '--bmm-text-muted': '#6a6a6a',
            '--bmm-cyan': '#1ED760', '--bmm-success': '#1ED760',
            '--bmm-radius-card': '12px', '--bmm-radius-btn': '500px',
            ...accentVars('#1ED760'),
        },
    },
];
