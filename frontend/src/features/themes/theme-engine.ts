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

function buildVarsCSS(theme: BmmTheme): string {
    const global = theme.vars ? Object.entries(theme.vars)
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
        // Hardcoded light text → primary dark text (covers white/255 text on light bg)
        [/color:\s*white\b/gi, 'color:var(--bmm-text-primary)'],
        [/color:\s*#fff\b/gi, 'color:var(--bmm-text-primary)'],
        [/color:\s*#ffffff\b/gi, 'color:var(--bmm-text-primary)'],
        [/color:\s*rgba\(\s*255,\s*255,\s*255[^)]*\)/gi, 'color:var(--bmm-text-primary)'],
    ] : [];

    const allPatches = [...patches, ...lightExtra];

    const patchEl = (el: HTMLElement) => {
        if (!el.style?.cssText) return;
        if (el.id?.startsWith('bmm-theme') || el.closest('#bmm-theme-editor')) return;
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

export const BUILTIN_THEMES: BmmTheme[] = [
    // ── 1. Default (BMM blue) ──────────────────────────────────────────────────
    {
        id: 'bmm-default', name: 'BMM Default', author: 'BMM Team',
        description: 'The original BMM dark blue theme.', vars: {},
    },

    // ── 2. Void — absolute black ───────────────────────────────────────────────
    {
        id: 'bmm-void', name: 'Void', author: 'BMM Team',
        description: 'Pure black base, electric blue accent.',
        vars: {
            '--bmm-bg-base':      '#000000',
            '--bmm-bg-elevated':  '#080808',
            '--bmm-bg-sidebar':   '#040404',
            '--bmm-bg-titlebar':  '#000000',
            '--bmm-border':       'rgba(255,255,255,0.04)',
            '--bmm-text-muted':   '#404040',
            ...accentVars('#4f8ef7'),
        },
    },

    // ── 3. Midnight — very dark, purple ───────────────────────────────────────
    {
        id: 'bmm-midnight', name: 'Midnight', author: 'BMM Team',
        description: 'Near-black with deep purple accent.',
        vars: {
            '--bmm-bg-base':     '#07070f',
            '--bmm-bg-elevated': '#0d0d1c',
            '--bmm-bg-sidebar':  '#05050c',
            '--bmm-border':      'rgba(255,255,255,0.05)',
            ...accentVars('#8b5cf6'),
        },
    },

    // ── 4. Dracula ─────────────────────────────────────────────────────────────
    {
        id: 'bmm-dracula', name: 'Dracula', author: 'BMM Team',
        description: 'Classic Dracula colour scheme.',
        vars: {
            '--bmm-bg-base':       '#282a36',
            '--bmm-bg-elevated':   '#21222c',
            '--bmm-bg-sidebar':    '#1e1f29',
            '--bmm-bg-titlebar':   '#191a23',
            '--bmm-border':        'rgba(98,114,164,0.2)',
            '--bmm-text-primary':  '#f8f8f2',
            '--bmm-text-secondary':'#bd93f9',
            '--bmm-text-muted':    '#6272a4',
            '--bmm-success':       '#50fa7b',
            '--bmm-warning':       '#f1fa8c',
            '--bmm-danger':        '#ff5555',
            '--bmm-cyan':          '#8be9fd',
            ...accentVars('#bd93f9'),
        },
    },

    // ── 5. Tokyo Night ─────────────────────────────────────────────────────────
    {
        id: 'bmm-tokyo', name: 'Tokyo Night', author: 'BMM Team',
        description: 'Blue-purple dark theme inspired by Tokyo nights.',
        vars: {
            '--bmm-bg-base':       '#1a1b2e',
            '--bmm-bg-elevated':   '#16213e',
            '--bmm-bg-sidebar':    '#0f3460',
            '--bmm-bg-titlebar':   '#0d0d1a',
            '--bmm-border':        'rgba(122,162,247,0.12)',
            '--bmm-text-primary':  '#c0caf5',
            '--bmm-text-secondary':'#9aa5ce',
            '--bmm-text-muted':    '#565f89',
            '--bmm-success':       '#9ece6a',
            '--bmm-warning':       '#e0af68',
            '--bmm-danger':        '#f7768e',
            '--bmm-cyan':          '#7dcfff',
            ...accentVars('#7aa2f7'),
        },
    },

    // ── 6. Nord ────────────────────────────────────────────────────────────────
    {
        id: 'bmm-nord', name: 'Nord', author: 'BMM Team',
        description: 'Arctic, north-bluish colour palette.',
        vars: {
            '--bmm-bg-base':       '#2e3440',
            '--bmm-bg-elevated':   '#3b4252',
            '--bmm-bg-sidebar':    '#252b37',
            '--bmm-bg-titlebar':   '#242932',
            '--bmm-border':        'rgba(76,86,106,0.4)',
            '--bmm-text-primary':  '#eceff4',
            '--bmm-text-secondary':'#e5e9f0',
            '--bmm-text-muted':    '#4c566a',
            '--bmm-success':       '#a3be8c',
            '--bmm-warning':       '#ebcb8b',
            '--bmm-danger':        '#bf616a',
            '--bmm-cyan':          '#88c0d0',
            ...accentVars('#81a1c1'),
        },
    },

    // ── 7. Catppuccin Mocha ────────────────────────────────────────────────────
    {
        id: 'bmm-catppuccin', name: 'Catppuccin Mocha', author: 'BMM Team',
        description: 'Soothing pastel theme — Mocha flavour.',
        vars: {
            '--bmm-bg-base':       '#1e1e2e',
            '--bmm-bg-elevated':   '#181825',
            '--bmm-bg-sidebar':    '#11111b',
            '--bmm-bg-titlebar':   '#0d0d17',
            '--bmm-border':        'rgba(108,112,134,0.2)',
            '--bmm-text-primary':  '#cdd6f4',
            '--bmm-text-secondary':'#bac2de',
            '--bmm-text-muted':    '#6c7086',
            '--bmm-success':       '#a6e3a1',
            '--bmm-warning':       '#f9e2af',
            '--bmm-danger':        '#f38ba8',
            '--bmm-cyan':          '#89dceb',
            ...accentVars('#cba6f7'),
        },
    },

    // ── 8. Gruvbox Dark ────────────────────────────────────────────────────────
    {
        id: 'bmm-gruvbox', name: 'Gruvbox Dark', author: 'BMM Team',
        description: 'Retro groove — warm earthy tones.',
        vars: {
            '--bmm-bg-base':       '#282828',
            '--bmm-bg-elevated':   '#3c3836',
            '--bmm-bg-sidebar':    '#1d2021',
            '--bmm-bg-titlebar':   '#1d2021',
            '--bmm-border':        'rgba(102,92,84,0.35)',
            '--bmm-text-primary':  '#ebdbb2',
            '--bmm-text-secondary':'#d5c4a1',
            '--bmm-text-muted':    '#665c54',
            '--bmm-success':       '#b8bb26',
            '--bmm-warning':       '#fabd2f',
            '--bmm-danger':        '#fb4934',
            '--bmm-cyan':          '#83a598',
            ...accentVars('#fe8019'),
        },
    },

    // ── 9. Rose Pine ───────────────────────────────────────────────────────────
    {
        id: 'bmm-rosepine', name: 'Rosé Pine', author: 'BMM Team',
        description: 'All natural pine, faux fur and gold.',
        vars: {
            '--bmm-bg-base':       '#191724',
            '--bmm-bg-elevated':   '#1f1d2e',
            '--bmm-bg-sidebar':    '#16141f',
            '--bmm-bg-titlebar':   '#0f0d17',
            '--bmm-border':        'rgba(110,106,134,0.2)',
            '--bmm-text-primary':  '#e0def4',
            '--bmm-text-secondary':'#908caa',
            '--bmm-text-muted':    '#6e6a86',
            '--bmm-success':       '#31748f',
            '--bmm-warning':       '#f6c177',
            '--bmm-danger':        '#eb6f92',
            '--bmm-cyan':          '#9ccfd8',
            ...accentVars('#c4a7e7'),
        },
    },

    // ── 10. Ember — warm orange ────────────────────────────────────────────────
    {
        id: 'bmm-ember', name: 'Ember', author: 'BMM Team',
        description: 'Warm dark with glowing orange accent.',
        vars: {
            '--bmm-bg-base':     '#120d08',
            '--bmm-bg-elevated': '#1c1208',
            '--bmm-bg-sidebar':  '#0e0a06',
            '--bmm-cyan':        '#fbbf24',
            '--bmm-cyan-dim':    'rgba(251,191,36,0.18)',
            ...accentVars('#f97316'),
        },
    },

    // ── 11. Ocean — teal ───────────────────────────────────────────────────────
    {
        id: 'bmm-ocean', name: 'Ocean', author: 'BMM Team',
        description: 'Deep navy, teal & cyan.',
        vars: {
            '--bmm-bg-base':     '#081620',
            '--bmm-bg-elevated': '#0d2030',
            '--bmm-bg-sidebar':  '#071218',
            ...accentVars('#06b6d4'),
        },
    },

    // ── 12. Neon Green ────────────────────────────────────────────────────────
    {
        id: 'bmm-neongreen', name: 'Neon Green', author: 'BMM Team',
        description: 'Black base with electric green terminal accent.',
        vars: {
            '--bmm-bg-base':       '#0a0f0a',
            '--bmm-bg-elevated':   '#0d140d',
            '--bmm-bg-sidebar':    '#080c08',
            '--bmm-text-primary':  '#e0ffe0',
            '--bmm-text-secondary':'#a0d0a0',
            '--bmm-text-muted':    '#406040',
            '--bmm-border':        'rgba(0,255,65,0.1)',
            ...accentVars('#00ff41'),
        },
    },

    // ── 13. Solarized Dark ────────────────────────────────────────────────────
    {
        id: 'bmm-solarized', name: 'Solarized Dark', author: 'BMM Team',
        description: 'Classic Solarized dark colour scheme.',
        vars: {
            '--bmm-bg-base':       '#002b36',
            '--bmm-bg-elevated':   '#073642',
            '--bmm-bg-sidebar':    '#00212b',
            '--bmm-bg-titlebar':   '#001a22',
            '--bmm-border':        'rgba(7,54,66,0.7)',
            '--bmm-text-primary':  '#fdf6e3',
            '--bmm-text-secondary':'#eee8d5',
            '--bmm-text-muted':    '#586e75',
            '--bmm-success':       '#859900',
            '--bmm-warning':       '#b58900',
            '--bmm-danger':        '#dc322f',
            '--bmm-cyan':          '#2aa198',
            ...accentVars('#268bd2'),
        },
    },

    // ── 14. Light Clean ───────────────────────────────────────────────────────
    {
        id: 'bmm-light', name: 'Light', author: 'BMM Team',
        description: 'Bright and clean light mode with dark text.',
        mode: 'light',
        vars: {
            '--bmm-bg-base':       '#f8fafc',
            '--bmm-bg-elevated':   '#ffffff',
            '--bmm-bg-overlay':    'rgba(255,255,255,0.95)',
            '--bmm-bg-sidebar':    '#f1f5f9',
            '--bmm-bg-titlebar':   '#e2e8f0',
            '--bmm-bg-hover':      'rgba(0,0,0,0.04)',
            '--bmm-bg-active':     'rgba(37,99,235,0.1)',
            '--bmm-border':        'rgba(0,0,0,0.1)',
            '--bmm-border-hover':  'rgba(0,0,0,0.18)',
            '--bmm-border-accent': 'rgba(37,99,235,0.4)',
            '--bmm-text-primary':  '#0f172a',
            '--bmm-text-secondary':'#334155',
            '--bmm-text-muted':    '#64748b',
            '--bmm-danger':        '#dc2626',
            '--bmm-success':       '#15803d',
            '--bmm-warning':       '#b45309',
            '--bmm-cyan':          '#0284c7',
            // Invert the surface overlay tint → all rgba(255,255,255,0.x) cards
            // become rgba(0,0,0,0.x) which reads correctly on a white background
            '--bmm-surface-r': '0', '--bmm-surface-g': '0', '--bmm-surface-b': '0',
            // Pre-built surfaces (need to redefine because CSS vars can't reference
            // other custom props from the same rule in all engines reliably)
            '--bmm-s02': 'rgba(0,0,0,0.02)', '--bmm-s03': 'rgba(0,0,0,0.03)',
            '--bmm-s04': 'rgba(0,0,0,0.04)', '--bmm-s05': 'rgba(0,0,0,0.05)',
            '--bmm-s06': 'rgba(0,0,0,0.06)', '--bmm-s07': 'rgba(0,0,0,0.07)',
            '--bmm-s08': 'rgba(0,0,0,0.08)', '--bmm-s09': 'rgba(0,0,0,0.09)',
            '--bmm-s10': 'rgba(0,0,0,0.10)', '--bmm-s12': 'rgba(0,0,0,0.12)',
            '--bmm-s15': 'rgba(0,0,0,0.15)', '--bmm-s20': 'rgba(0,0,0,0.20)',
            '--bmm-glass-bg':     'rgba(0,0,0,0.03)',
            '--bmm-glass-border': 'rgba(0,0,0,0.08)',
            ...accentVars('#2563eb'),
        },
    },
];
