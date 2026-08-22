// @ts-nocheck
// ── BMM Theme Editor ──────────────────────────────────────────────────────────
// Floating drag+resize panel. Four tabs:
//   Simple   → colour/font/size token editor + presets
//   Elements → add custom HTML/CSS elements anywhere in BMM
//   Advanced → full CSS per page
//   Installed→ manage + import + export themes
import { claimDockSpace, releaseDockSpace, makeDock } from '../../ui/dock-space.js';

import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { invoke } from '../../core/api.js';
import { escHtml, escAttr } from '../../core/utils.js';
import {
    applyTheme, previewTheme, resetTheme, getActiveTheme,
    installTheme, exportTheme, getInstalledThemes,
    activateTheme, deleteTheme, BUILTIN_THEMES,
    isContrastEnforced, setContrastEnforced,
} from './theme-engine.js';
import type { BmmTheme, CustomElement, HtmlSwap } from './theme-engine.js';

// ── Icons (lucide outline set, consistent across the editor) ────────────────────
const ICON = {
    eyedropper: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L21 6l-3 3-3-3Z"/></svg>`,
    reset: (s = 13) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
    close: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    palette: (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="var(--bmm-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"/></svg>`,
    plus: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    trash: (s = 13) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    edit: (s = 13) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>`,
};

/** Escape a string for safe use inside a single-quoted JS string that itself
 *  lives in a double-quoted HTML attribute (e.g. onmouseenter="fn('TEXT')").
 *  escAttr alone does NOT escape apostrophes, which breaks the JS string for
 *  translated text like "n'importe où".                                       */
function escJs(s: string): string {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/[\r\n]+/g, ' ');
}

// ── Token catalogue ────────────────────────────────────────────────────────────
// desc = friendly explanation (shown in Tasky tooltip). mdn = CSS property doc.
interface Token { key: string; label: string; type: 'color'|'size'|'font'|'image'; group: string; desc: string; mdn?: string; }
const TOKENS: Token[] = [
    // Background
    { key:'--bmm-bg-base',       label:'App background',    type:'color', group:'Background', desc:'The outermost background colour behind everything.', mdn:'background-color' },
    { key:'--bmm-bg-elevated',   label:'Cards & panels',    type:'color', group:'Background', desc:'Background of cards, panels, modals and dropdowns.', mdn:'background-color' },
    { key:'--bmm-bg-overlay',    label:'Glass surface',     type:'color', group:'Background', desc:'The translucent surface used by glass cards and modals.', mdn:'background-color' },
    { key:'--bmm-bg-hover',      label:'Hover surface',     type:'color', group:'Background', desc:'Background of anything under the cursor (rows, nav items, buttons).', mdn:'background-color' },
    { key:'--bmm-bg-active',     label:'Active surface',    type:'color', group:'Background', desc:'Background of the selected / pressed state.', mdn:'background-color' },
    { key:'--bmm-bg-sidebar',    label:'Sidebar',           type:'color', group:'Background', desc:'Background of the left navigation sidebar.', mdn:'background-color' },
    { key:'--bmm-bg-titlebar',   label:'Title bar',         type:'color', group:'Background', desc:'Top window bar colour (where the logo & window buttons are).', mdn:'background-color' },
    { key:'--bmm-titlebar-bg',   label:'Title bar (exact)', type:'color', group:'Background', desc:'Exact title-bar background (supports rgba for transparency).', mdn:'background' },
    { key:'--bmm-loader-bg',     label:'Boot / exit screen',type:'color', group:'Background', desc:'Background of the startup & close screen.', mdn:'background-color' },
    { key:'--bmm-app-bg-image',  label:'Wallpaper',         type:'image', group:'Background', desc:'A full-app background image (wallpaper). Pick or paste a URL.', mdn:'background-image' },
    { key:'--bmm-app-bg-size',   label:'Wallpaper fit',     type:'size',  group:'Background', desc:'How the wallpaper fills the window: cover, contain, or a size like 800px. Applies to a video wallpaper too.', mdn:'background-size' },
    { key:'--bmm-app-bg-position', label:'Wallpaper position', type:'size', group:'Background', desc:'Which part of the wallpaper stays visible: center, top, or a pair like 50% 20%. Applies to a video wallpaper too.', mdn:'background-position' },
    { key:'--bmm-app-bg-blur',   label:'Wallpaper blur',    type:'size',  group:'Background', desc:'Blur applied to the wallpaper, e.g. 8px.', mdn:'filter' },
    { key:'--bmm-app-bg-opacity',label:'Wallpaper opacity', type:'size',  group:'Background', desc:'Wallpaper opacity from 0 (hidden) to 1 (full).', mdn:'opacity' },

    // Accent
    { key:'--bmm-accent',        label:'Accent',            type:'color', group:'Accent', desc:'The main highlight colour — buttons, active items, links.', mdn:'color' },
    { key:'--bmm-cyan',          label:'Cyan / teal',       type:'color', group:'Accent', desc:'Secondary highlight (paths, info badges).', mdn:'color' },
    { key:'--bmm-success',       label:'Success',           type:'color', group:'Accent', desc:'Colour for success / enabled / verified states.', mdn:'color' },
    { key:'--bmm-warning',       label:'Warning',           type:'color', group:'Accent', desc:'Colour for warnings and caution states.', mdn:'color' },
    { key:'--bmm-danger',        label:'Danger',            type:'color', group:'Accent', desc:'Colour for errors, delete actions and conflicts.', mdn:'color' },
    { key:'--bmm-purple',        label:'Purple',            type:'color', group:'Accent', desc:'Tertiary accent (deeplinks, plugin tags).', mdn:'color' },
    { key:'--bmm-info',          label:'Info',              type:'color', group:'Accent', desc:'Informational badges and callouts.', mdn:'color' },
    { key:'--bmm-amber',         label:'Amber',             type:'color', group:'Accent', desc:'Softer caution tone, used by some badges and charts.', mdn:'color' },

    // Borders
    { key:'--bmm-border',        label:'Border',            type:'color', group:'Borders', desc:'Default subtle border around cards & inputs.', mdn:'border-color' },
    { key:'--bmm-border-hover',  label:'Border hover',      type:'color', group:'Borders', desc:'Border colour when the cursor is over a card or input.', mdn:'border-color' },
    { key:'--bmm-border-accent', label:'Border accent',     type:'color', group:'Borders', desc:'Border colour for focused / active elements.', mdn:'border-color' },

    // Text
    { key:'--bmm-text-primary',  label:'Text primary',      type:'color', group:'Text', desc:'Main text colour — titles and important text.', mdn:'color' },
    { key:'--bmm-text-secondary',label:'Text secondary',    type:'color', group:'Text', desc:'Secondary text — descriptions and labels.', mdn:'color' },
    { key:'--bmm-text-muted',    label:'Text muted',        type:'color', group:'Text', desc:'Dimmed text — hints, placeholders, metadata.', mdn:'color' },
    { key:'--bmm-text-on-accent',label:'Text on accent',    type:'color', group:'Text', desc:'Text sitting on an accent-coloured fill (primary buttons, badges).', mdn:'color' },

    // Typography
    { key:'--bmm-font-sans',     label:'UI font',           type:'font',  group:'Typography', desc:'The font used everywhere in the interface.', mdn:'font-family' },
    { key:'--bmm-font-mono',     label:'Monospace font',    type:'font',  group:'Typography', desc:'Font for code, paths and hashes.', mdn:'font-family' },
    { key:'--bmm-font-size-base',label:'Base text size',    type:'size',  group:'Typography', desc:'Base font size (e.g. 13px) — scales the whole UI.', mdn:'font-size' },

    // Shape
    { key:'--bmm-radius-card',   label:'Card roundness',    type:'size',  group:'Shape', desc:'Corner radius of cards (e.g. 14px). 0 = square.', mdn:'border-radius' },
    { key:'--bmm-radius-btn',    label:'Button roundness',  type:'size',  group:'Shape', desc:'Corner radius of buttons.', mdn:'border-radius' },
    { key:'--bmm-radius-input',  label:'Input roundness',   type:'size',  group:'Shape', desc:'Corner radius of text inputs and selects.', mdn:'border-radius' },

    // Tasky tooltip
    { key:'--bmm-tasky-bubble-bg',     label:'Tooltip background', type:'color', group:'Tasky Tooltips', desc:'Background of the Tasky helper tooltips (rgba for glass).', mdn:'background' },
    { key:'--bmm-tasky-bubble-text',   label:'Tooltip text',       type:'color', group:'Tasky Tooltips', desc:'Text colour inside Tasky tooltips.', mdn:'color' },
    { key:'--bmm-tasky-bubble-border', label:'Tooltip border',     type:'color', group:'Tasky Tooltips', desc:'Border colour of Tasky tooltips.', mdn:'border-color' },
    { key:'--bmm-tasky-bubble-radius', label:'Tooltip roundness',  type:'size',  group:'Tasky Tooltips', desc:'Corner radius of the tooltip bubble.', mdn:'border-radius' },

    // Effects & animation
    { key:'--bmm-card-glow',       label:'Card glow',        type:'size',  group:'Effects', desc:'Extra glow shadow on cards, e.g. 0 0 20px rgba(...). Use "0 0 0 transparent" for none.', mdn:'box-shadow' },
    { key:'--bmm-card-hover-lift', label:'Card hover lift',  type:'size',  group:'Effects', desc:'How far cards rise on hover, e.g. -2px. 0 = no lift.', mdn:'transform' },
    { key:'--bmm-shadow-card',     label:'Card shadow',      type:'size',  group:'Effects', desc:'Drop shadow under cards.', mdn:'box-shadow' },
    { key:'--bmm-shadow-modal',    label:'Modal shadow',     type:'size',  group:'Effects', desc:'Drop shadow under modals.', mdn:'box-shadow' },

    // Buttons. Only --bmm-btn-primary-bg is actually consumed by the stylesheets; the six
    // other btn-* tokens used to sit here and changed nothing at all when edited, which made
    // the whole editor feel broken. Primary button TEXT is --bmm-text-on-accent (Text group).
    { key:'--bmm-btn-primary-bg',     label:'Primary button bg',    type:'color', group:'Buttons', desc:'Background of primary (main action) buttons. Defaults to the accent.', mdn:'background-color' },

    // Surfaces — the switch that makes a theme light or dark everywhere at once.
    { key:'--bmm-surface-r',     label:'Surface tint R',    type:'size',  group:'Surfaces', desc:'Red channel (0-255) of the translucent surface tint. Set all three to 0 for a light theme.', mdn:'background-color' },
    { key:'--bmm-surface-g',     label:'Surface tint G',    type:'size',  group:'Surfaces', desc:'Green channel (0-255) of the translucent surface tint.', mdn:'background-color' },
    { key:'--bmm-surface-b',     label:'Surface tint B',    type:'size',  group:'Surfaces', desc:'Blue channel (0-255) of the translucent surface tint.', mdn:'background-color' },
    { key:'--bmm-glass-bg',      label:'Glass background',  type:'color', group:'Surfaces', desc:'Background of frosted-glass panels.', mdn:'background-color' },
    { key:'--bmm-glass-border',  label:'Glass border',      type:'color', group:'Surfaces', desc:'Border of frosted-glass panels.', mdn:'border-color' },
    { key:'--bmm-color-scheme',  label:'Native controls',   type:'size',  group:'Surfaces', desc:'"light" or "dark" — drives native scrollbars and select popups.', mdn:'color-scheme' },

    // Toasts
    { key:'--bmm-toast-bg',      label:'Toast background',  type:'color', group:'Toasts', desc:'Background of the notification toasts.', mdn:'background-color' },
    { key:'--bmm-toast-border',  label:'Toast border',      type:'color', group:'Toasts', desc:'Border colour of toasts.', mdn:'border-color' },
    { key:'--bmm-toast-text',    label:'Toast text',        type:'color', group:'Toasts', desc:'Text colour inside toasts.', mdn:'color' },

    // Intro / Outro (boot loader + close animation). The boot background lives in the
    // Background group as "Boot / exit screen" — it was duplicated here, so two rows edited
    // the same variable and both showed a "customised" badge.
    { key:'--bmm-nav-logo-h',    label:'Sidebar logo height', type:'size', group:'Background', desc:'Height of the sidebar logo block when a theme supplies a logo image, e.g. 52px.', mdn:'height' },
    { key:'--bmm-mascot-w',      label:'Tasky size',        type:'size',  group:'Intro & Outro', desc:'Width of the floating Tasky mascot, e.g. 110px.', mdn:'width' },
    { key:'--bmm-loader-img',    label:'Boot mascot image',    type:'image', group:'Intro & Outro', desc:'Image shown spinning while BMM starts (url or pick a file).', mdn:'background-image' },
    { key:'--bmm-intro-duration',label:'Intro/exit speed',     type:'size',  group:'Intro & Outro', desc:'Boot/exit fade duration, e.g. 0.65s. Lower = faster.', mdn:'transition' },
    { key:'--bmm-anim-speed',    label:'Animation speed',      type:'size',  group:'Intro & Outro', desc:'Global animation multiplier. 1 = normal, 0 = instant (disable all).', mdn:'animation' },

    // Diagrams (Help & other flowcharts)
    { key:'--bmm-diagram-node',        label:'Node fill',     type:'color', group:'Diagrams', desc:'Fill colour of the boxes/nodes in the interactive diagrams.', mdn:'fill' },
    { key:'--bmm-diagram-node-border', label:'Node border',   type:'color', group:'Diagrams', desc:'Border colour of diagram nodes.', mdn:'stroke' },
    { key:'--bmm-diagram-node-text',   label:'Node text',     type:'color', group:'Diagrams', desc:'Text colour inside diagram nodes.', mdn:'color' },

    // Benchmark charts
    { key:'--bmm-chart-cpu',        label:'CPU line',          type:'color', group:'Charts', desc:'Colour of the CPU line on the performance graph.', mdn:'color' },
    { key:'--bmm-chart-ram',        label:'RAM line',          type:'color', group:'Charts', desc:'Colour of the RAM line on the performance graph.', mdn:'color' },
    { key:'--bmm-chart-disk-read',  label:'Disk read line',    type:'color', group:'Charts', desc:'Colour of the disk-read line on the I/O graph.', mdn:'color' },
    { key:'--bmm-chart-disk-write', label:'Disk write line',   type:'color', group:'Charts', desc:'Colour of the disk-write line on the I/O graph.', mdn:'color' },

    // NOTE: there is deliberately no DevTools group. --bmm-devtools-bg / -accent have zero
    // var() references anywhere — the DevTools panel is intentionally always dark (debug.css
    // is even exempt from the colour lint), so those rows only ever pretended to do something.
    { key:'--bmm-radius-chip',   label:'Chip roundness',    type:'size',  group:'Shape', desc:'Corner radius of small chips and pills.', mdn:'border-radius' },
];

// Curated font presets for the Typography dropdowns
const FONT_PRESETS = [
    { label: 'Inter (default)',  value: "'Inter', system-ui, sans-serif" },
    { label: 'System UI',        value: 'system-ui, sans-serif' },
    { label: 'Segoe UI',         value: "'Segoe UI', sans-serif" },
    { label: 'Roboto',           value: "'Roboto', sans-serif" },
    { label: 'Poppins',          value: "'Poppins', sans-serif" },
    { label: 'Montserrat',       value: "'Montserrat', sans-serif" },
    { label: 'Nunito',           value: "'Nunito', sans-serif" },
    { label: 'Orbitron (techno)',value: "'Orbitron', sans-serif" },
    { label: 'Comic Sans',       value: "'Comic Sans MS', cursive" },
    { label: 'Georgia (serif)',  value: "Georgia, serif" },
];
const MONO_PRESETS = [
    { label: 'JetBrains Mono (default)', value: "'JetBrains Mono', 'Fira Code', monospace" },
    { label: 'Fira Code',     value: "'Fira Code', monospace" },
    { label: 'Cascadia Code', value: "'Cascadia Code', monospace" },
    { label: 'Consolas',      value: "Consolas, monospace" },
    { label: 'Courier New',   value: "'Courier New', monospace" },
];

// colour → likely token map for smart-pick
const COLOR_TO_TOKEN: [RegExp, string][] = [
    [/^rgb\(10,\s*14,\s*23\)/,    '--bmm-bg-base'],
    [/^rgb\(17,\s*24,\s*39\)/,    '--bmm-bg-elevated'],
    [/^rgb\(59,\s*130,\s*246\)/,  '--bmm-accent'],
    [/^rgb\(6,\s*182,\s*212\)/,   '--bmm-cyan'],
    [/^rgb\(16,\s*185,\s*129\)/,  '--bmm-success'],
    [/^rgb\(239,\s*68,\s*68\)/,   '--bmm-danger'],
    [/^rgb\(245,\s*158,\s*11\)/,  '--bmm-warning'],
    [/^rgb\(241,\s*245,\s*249\)/,  '--bmm-text-primary'],
    [/^rgb\(148,\s*163,\s*184\)/, '--bmm-text-secondary'],
];

function computedColorToToken(color: string): string|null {
    for (const [re, tok] of COLOR_TO_TOKEN) if (re.test(color)) return tok;
    return null;
}

// ── State ──────────────────────────────────────────────────────────────────────
let _panel: HTMLElement | null = null;
let _draft: Partial<BmmTheme> = {};
let _origTheme: BmmTheme | null = null;   // snapshot of the theme active when the editor opened (for Discard)
let _tab: 'simple'|'elements'|'advanced'|'installed' = 'simple';
let _pickMode: 'token'|'target'|null = null;   // token=edit token, target=pick element host
let _pickTargetCb: ((sel: string) => void) | null = null;
let _advPage = 'global';
let _editingCeId: string | null = null;

/** The global vars object the Simple tab writes to. */
function targetVars(create = true): Record<string, string> | undefined {
    if (create && !_draft.vars) _draft.vars = {};
    return _draft.vars;
}
let _ro: ResizeObserver | null = null;
const OVL_KEY = 'bmm_theme_editor_geom';
const MIN_W = 420, MIN_H = 360;

// ── Init ───────────────────────────────────────────────────────────────────────
export function initThemeEditor(): void {
    document.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('[data-open-theme-editor]')) openEditor();
    });
    document.addEventListener('bmm:theme-editor', () => openEditor());
    // The panel is built once with inline t() strings, so a language switch would
    // otherwise leave it in the old language until a full refresh. Rebuild it
    // (and re-render the current tab) whenever the language changes.
    document.addEventListener('langChanged', () => {
        if (!_panel) return;
        const wasOpen = _panel.style.display !== 'none';
        _panel.remove();
        _panel = null;
        buildPanel();
        if (wasOpen && _panel) {
            (_panel as HTMLElement).style.display = 'flex';
            renderTab(_tab);
        }
    });
    (window as any).openThemeEditor = openEditor;
}

export function openEditor(): void {
    if (!_panel) buildPanel();
    _panel!.style.display = 'flex';
    if (localStorage.getItem(BTE_DOCK_KEY) === 'right') _bteSetDock(true);
    _draft = JSON.parse(JSON.stringify(getActiveTheme() || {}));
    _origTheme = getActiveTheme() ? JSON.parse(JSON.stringify(getActiveTheme())) : null;
    renderTab(_tab);
    if (!_draft.custom_elements) _draft.custom_elements = [];
}

// ── Dock mode: the editor as a side panel ────────────────────────────────────
// Field ask: "qu'on puisse aussi le passer en mode sidebar". Same shape as the
// tutorial dock: a body class, the app shell padded aside, width draggable and
// persisted. Float geometry is untouched — undocking restores it via applyGeom().
const BTE_DOCK_KEY  = 'bmm.themeEditor.dock';
const BTE_DOCKW_KEY = 'bmm.themeEditor.dockW';

const _bteDock = makeDock({
    id: 'theme-editor', storageKey: BTE_DOCKW_KEY, cssVar: '--bte-dock-w', min: 340, def: 430,
});

function _bteDocked(): boolean { return document.body.classList.contains('bte-docked'); }

function _bteSetDock(on: boolean): void {
    if (!_panel) return;
    document.body.classList.toggle('bte-docked', on);
    localStorage.setItem(BTE_DOCK_KEY, on ? 'right' : 'float');
    if (on) {
        // The owner decides, not us: it clamps against the band the app needs and
        // returns 0 when the window simply cannot spare the width. Docking anyway
        // is exactly the "panel covers content" the user reported.
        const w = claimDockSpace('theme-editor', _bteDock.width());
        if (!w) {
            document.body.classList.remove('bte-docked');
            localStorage.setItem(BTE_DOCK_KEY, 'float');
            toast(t('themes.dockNoRoom') || 'Window too narrow to dock — staying floating', 'info', 2600);
            return;
        }
        document.body.style.setProperty('--bte-dock-w', `${w}px`);
        // The inline float geometry would beat any stylesheet — clear it; the CSS
        // dock rules take over. Float geometry itself survives in localStorage.
        Object.assign(_panel.style, { position: '', left: '', top: '', width: '', height: '', resize: '' });
    } else {
        // Undocking must GIVE THE SPACE BACK, or the app shell keeps the padding it was
        // granted and the layout stays squeezed with no panel in it. releaseDockSpace was
        // already imported and never called: _bteShellPad is a leftover from a rename that
        // missed two sites, and @ts-nocheck let it ship as a ReferenceError in production.
        releaseDockSpace('theme-editor');
        document.body.style.removeProperty('--bte-dock-w');
        applyGeom();
        _panel.style.display = 'flex';
    }
    const btn = _panel.querySelector('#bte-dock');
    btn?.classList.toggle('active', on);
}

// The window can shrink under the dock. When the shared owner runs out of room it
// says so, and a docked editor returns to floating instead of covering the app.
document.addEventListener('bmm:dock:no-room', (e) => {
    const ids = (e as CustomEvent).detail?.ids as string[] | undefined;
    if (ids && !ids.includes('theme-editor')) return;   // someone else's loss
    if (_bteDocked()) _bteSetDock(false);
});

function _btePlantDockResize(panel: HTMLElement): void {
    _bteDock.plantGrip(panel, _bteDocked);
}

function closeEditor(): void {
    _panel && (_panel.style.display = 'none');
    if (_bteDocked()) { document.body.classList.remove('bte-docked'); releaseDockSpace('theme-editor'); }
    stopPick();
}

// ── Panel ─────────────────────────────────────────────────────────────────────
function buildPanel(): void {
    _panel = document.createElement('div');
    _panel.id = 'bmm-theme-editor';
    _panel.innerHTML = `
        <div class="bte-header" id="bte-header">
            <div class="bte-logo">${ICON.palette(17)}</div>
            <span class="bte-title">${t('themes.editorTitle')||'Theme Editor'}</span>
            <div class="bte-header-actions">
                <button class="bte-tool" id="bte-dock" data-tooltip="${t('themes.dockToggle')||'Dock to the side / float'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/></svg></button>
                <button class="bte-tool" id="bte-pick-token" data-tooltip="${t('themes.pickElement')||'Pick element to edit token'}">${ICON.eyedropper(14)}</button>
                <button class="bte-tool" id="bte-reset" data-tooltip="${t('common.reset')||'Reset'}">${ICON.reset(13)}</button>
                <button class="bte-close" id="bte-close">${ICON.close(14)}</button>
            </div>
        </div>
        <div class="bte-tabs">
            <button class="bte-tab active" data-bte-tab="simple">${t('themes.tabSimple')||'Simple'}</button>
            <button class="bte-tab" data-bte-tab="elements">${t('themes.tabElements')||'+ Elements'}</button>
            <button class="bte-tab" data-bte-tab="advanced">${t('themes.tabCss')||'CSS'}</button>
            <button class="bte-tab" data-bte-tab="installed">${t('themes.tabInstalled')||'Installed'}</button>
        </div>
        <div class="bte-body" id="bte-body"></div>
        <div class="bte-footer">
            <span class="bte-dirty" id="bte-dirty"></span>
            <div class="bte-footer-actions">
                <!-- Grouped by intent, with the primary action last (where the eye lands).
                     Export used to carry btn-accent while Save was only btn-secondary, so the
                     loudest button in a theme EDITOR was the one that writes a file to disk,
                     not the one that keeps your work. -->
                <!-- The three file operations live in ONE menu. Side by side they made a
                     six-button footer that wrapped into two cramped rows in a narrow modal
                     (field screenshot) — and none of the three is frequent enough to earn
                     permanent surface. Same ids inside, so every handler survives. -->
                <span class="bte-file-menu-wrap">
                    <button class="btn btn-ghost btn-sm" id="bte-file-menu-btn">${t('themes.fileMenu')||'File'} ▾</button>
                    <span class="bte-file-menu" id="bte-file-menu" hidden>
                        <button class="btn btn-ghost btn-sm" id="bte-import-file">${t('themes.import')||'Import .bmmtheme / .json'}</button>
                        <button class="btn btn-ghost btn-sm" id="bte-share">${t('themes.share')||'Share'}</button>
                        <button class="btn btn-ghost btn-sm" id="bte-export">${t('themes.export')||'Export'} .bmmtheme</button>
                    </span>
                </span>
                <span class="bte-fsep" aria-hidden="true"></span>
                <span class="bte-fgroup">
                    <button class="btn btn-ghost btn-sm bte-danger" id="bte-discard">${t('themes.discard')||'Discard'}</button>
                    <button class="btn btn-ghost btn-sm" id="bte-save-as" data-tooltip="${t('themes.saveAsHint')||'Save as a new theme'}">${t('themes.saveAs')||'Save as…'}</button>
                    <button class="btn btn-accent btn-sm" id="bte-save">${t('themes.saveTheme')||'Save'}</button>
                </span>
            </div>
        </div>`;

    const host = document.getElementById('app-window-outer') || document.body;
    host.appendChild(_panel);
    applyGeom();
    makeDraggable(_panel, _panel.querySelector('#bte-header') as HTMLElement);
    if (!_ro) { _ro = new ResizeObserver(() => saveGeom()); _ro.observe(_panel!); }

    // Delegated: the tabs re-render on every edit, so per-row listeners would be
    // re-bound (and leaked) constantly.
    _panel.addEventListener('click', (e) => {
        const lbl = (e.target as HTMLElement).closest('.bte-token-reveal') as HTMLElement | null;
        if (lbl?.dataset.reveal) { e.preventDefault(); revealToken(lbl.dataset.reveal); }
    });
    _panel.querySelector('#bte-close')!.addEventListener('click', closeEditor);
    _panel.querySelector('#bte-dock')!.addEventListener('click', () => _bteSetDock(!_bteDocked()));
    _btePlantDockResize(_panel);

    // The File menu: opens upward (the footer is at the modal's bottom), closes on any
    // choice or outside click.
    {
        const btn = _panel.querySelector('#bte-file-menu-btn') as HTMLElement | null;
        const menu = _panel.querySelector('#bte-file-menu') as HTMLElement | null;
        if (btn && menu) {
            btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
            menu.addEventListener('click', () => { menu.hidden = true; });
            document.addEventListener('click', () => { menu.hidden = true; });
        }
    }
    _panel.querySelector('#bte-pick-token')!.addEventListener('click', () => togglePickToken());
    _panel.querySelector('#bte-reset')!.addEventListener('click', confirmReset);
    _panel.querySelector('#bte-save')!.addEventListener('click', saveTheme);
    _panel.querySelector('#bte-save-as')!.addEventListener('click', saveThemeAs);
    _panel.querySelector('#bte-share')!.addEventListener('click', shareTheme);
    _panel.querySelector('#bte-export')!.addEventListener('click', doExport);
    _panel.querySelector('#bte-import-file')?.addEventListener('click', importFile);
    _panel.querySelector('#bte-discard')!.addEventListener('click', () => {
        // Truly drop every unsaved change: restore the theme that was active on open.
        if (_origTheme) {
            _draft = JSON.parse(JSON.stringify(_origTheme));
            applyTheme(JSON.parse(JSON.stringify(_origTheme)));
        } else {
            _draft = { custom_elements: [] };
            resetTheme();
        }
        renderTab(_tab);
        toast(t('themes.discarded')||'Changes discarded', 'info', 1500);
    });
    _panel.querySelectorAll('.bte-tab').forEach(tab =>
        tab.addEventListener('click', () => {
            _tab = (tab as HTMLElement).dataset.bteTab as any;
            _panel!.querySelectorAll('.bte-tab').forEach(t => t.classList.toggle('active', t === tab));
            previewTheme(_draft);   // drop any transient element-preview before leaving
            renderTab(_tab);
        })
    );
}

/** Key a collapsible group by its (stable) heading text — the markup has no id. */
function groupKey(g: Element): string {
    return (g.querySelector('.bte-group-title')?.textContent || '').trim();
}

function renderTab(tab: string): void {
    const body = document.getElementById('bte-body');
    if (!body) return;

    // Every edit re-renders the whole tab with innerHTML — that is how this panel works, and
    // it is fine, EXCEPT that it silently threw away the user's place: tweak one colour and
    // you were bounced back to the top of the list with every group you had opened closed
    // again. In a panel whose entire job is adjusting dozens of values in a row, that made it
    // feel broken. Snapshot the view state and put it back after the rebuild.
    const scroll = body.scrollTop;
    const open = new Set<string>();
    body.querySelectorAll('.bte-group.open').forEach((g) => { const k = groupKey(g); if (k) open.add(k); });
    const act = document.activeElement as HTMLElement | null;
    const actId = act && body.contains(act) ? act.id : '';

    if (tab === 'simple')    { body.innerHTML = buildSimpleTab();   wireSimple(); }
    else if (tab === 'elements') { body.innerHTML = buildElementsTab(); wireElements(); }
    else if (tab === 'advanced') { body.innerHTML = buildAdvTab();    wireAdv(); }
    else if (tab === 'installed'){ body.innerHTML = buildInstalledTab(); wireInstalled(); }

    if (open.size) {
        body.querySelectorAll('.bte-group').forEach((g) => {
            if (open.has(groupKey(g))) g.classList.add('open');
        });
    }
    body.scrollTop = scroll;
    if (actId) {
        const again = body.querySelector<HTMLElement>(`#${(window as any).CSS?.escape ? CSS.escape(actId) : actId}`);
        try { again?.focus({ preventScroll: true }); } catch { /* not focusable any more */ }
    }
    updateDirty();
}

// ═══════════════════════════════════════════════════════════════════
// SIMPLE TAB
// ═══════════════════════════════════════════════════════════════════
const PAGE_OPTIONS = [
    {id:'library',label:'Library'},{id:'profiles',label:'Profiles'},
    {id:'modpacks',label:'Modpacks'},{id:'mapper',label:'Mapper'},
    {id:'repo',label:'Server Repo'},{id:'plugins',label:'Plugins & API'},
    {id:'apps',label:'App Catalog'},{id:'docs',label:'Help & Other'},
    {id:'settings',label:'Settings'},{id:'credits',label:'Credits'},
    // Were missing: both are real views in index.html (#view-community, #view-modlist), so a
    // per-page override simply could not be scoped to them.
    {id:'community',label:'BetterCommunity'},{id:'modlist',label:'.MM Lists'},
];

// Comprehensive, categorised list of unique elements you can recolour/edit
// directly (opens the element editor for that selector — no need to pick).
const TARGET_GROUPS: { cat: string; items: { label: string; sel: string }[] }[] = [
    { cat: 'Buttons & inputs', items: [
        { label: 'All buttons',        sel: '.btn' },
        { label: 'Primary buttons',    sel: '.btn-primary' },
        { label: 'Secondary buttons',  sel: '.btn-secondary' },
        { label: 'Ghost buttons',      sel: '.btn-ghost' },
        { label: 'Accent buttons',     sel: '.btn-accent' },
        { label: 'Danger buttons',     sel: '.btn-danger' },
        { label: 'Text inputs',        sel: '.input, input[type=text], textarea' },
        { label: 'Form inputs',        sel: '.form-input' },
        { label: 'Form labels',        sel: '.form-label' },
        { label: 'Dropdowns',          sel: '.bmm-csel-trigger' },
        { label: 'Dropdown menus',     sel: '.bmm-csel-menu' },
        { label: 'Toggles',            sel: '.toggle-slider, .bmm-switch-track' },
        { label: 'Toggle knob',        sel: '.bmm-switch-thumb' },
    ]},
    { cat: 'Surfaces', items: [
        { label: 'Cards',              sel: '.glass-card' },
        { label: 'Mod cards',          sel: '.mod-card' },
        { label: 'Generic modals',     sel: '.modal-card, .modal.glass' },
        { label: 'Modal headers',      sel: '.modal-header' },
        { label: 'Modal body',         sel: '.modal-body' },
        { label: 'Modal footer',       sel: '.modal-footer' },
        { label: 'Toasts',             sel: '.toast' },
        { label: 'Badges',             sel: '.badge' },
        { label: 'Search box',         sel: '.search-box' },
        { label: 'Progress bars',      sel: '.progress-bar' },
        { label: 'Tasky tooltip',      sel: '.tasky-speech-bubble' },
        { label: 'Scrollbars',         sel: '*::-webkit-scrollbar-thumb' },
    ]},
    { cat: 'Layout', items: [
        { label: 'Title bar',          sel: '.titlebar' },
        { label: 'Sidebar',            sel: '.sidebar' },
        { label: 'Nav items',          sel: '.nav-item' },
        { label: 'Active nav item',    sel: '.nav-item.active' },
        { label: 'Page titles',        sel: '.view-title' },
        { label: 'Section titles',     sel: '.card-title' },
    ]},
    { cat: 'Library toolbar', items: [
        { label: 'Filter bar',         sel: '.filter-bar, .lib-header-shell' },
        { label: 'Search box',         sel: '.filter-bar .search-box' },
        { label: 'Filter pills',       sel: '.filter-bar .filter-btn' },
        { label: 'Active filter pill', sel: '.filter-bar .filter-btn.active' },
        { label: 'Filter dropdowns',   sel: '.filter-bar .profile-select' },
        { label: 'Action tab',         sel: '.lib-actions-tab .view-actions' },
        { label: 'Action buttons',     sel: '.view-action-util' },
        { label: 'Profile selector',   sel: '.profile-select-icon-wrap' },
    ]},
    { cat: 'Pages', items: PAGE_OPTIONS.map(p => ({ label: p.label, sel: `#view-${p.id}` })) },
    // Per-page unique elements (things not covered by the shared classes above)
    { cat: 'Library', items: [
        { label: 'Mod card',           sel: '#view-library .mod-card' },
        { label: 'Mod name',           sel: '#view-library .mod-name' },
        { label: 'Filter pills',       sel: '#view-library .lib-filter-btn, #view-library .filter-btn' },
        { label: 'Search bar',         sel: '#view-library .input, #view-library input[type=text]' },
        { label: 'Toggle switches',    sel: '#view-library .mod-toggle-track' },
    ]},
    { cat: 'Profiles', items: [
        { label: 'Profile card',       sel: '#view-profiles .glass-card' },
        { label: 'Path boxes',         sel: '#view-profiles .profile-card-paths' },
        { label: 'Action buttons',     sel: '#view-profiles .btn' },
        { label: 'Active badge',       sel: '#view-profiles .badge' },
    ]},
    { cat: 'Server Repo', items: [
        { label: 'Tabs (Sync/Host)',   sel: '#view-repo .repo-tab, #view-repo .tab-btn' },
        { label: 'Step cards',         sel: '#view-repo .glass-card' },
        { label: 'Profile rows',       sel: '#view-repo .repo-profile-row, #view-repo .profile-row' },
        { label: 'Inputs',             sel: '#view-repo .input, #view-repo input[type=text]' },
    ]},
    { cat: '.MM Lists', items: [
        { label: 'Format cards',       sel: '#view-modpacks .glass-card' },
        { label: 'Export panel',       sel: '#view-modpacks .mm-export-card, #view-modpacks .export-card' },
        { label: 'Inputs',             sel: '#view-modpacks .input, #view-modpacks input[type=text]' },
    ]},
    { cat: 'Plugins & API', items: [
        { label: 'Plugin cards',       sel: '#view-plugins .plug-card' },
        { label: 'Endpoint rows',      sel: '#view-plugins .plug-ep-row, #view-plugins .plug-endpoint' },
        { label: 'Method badges',      sel: '#view-plugins [class*="plug-method"]' },
        { label: 'Code blocks',        sel: '#view-plugins pre, #view-plugins code' },
        { label: 'Perm chips',         sel: '#view-plugins .plug-perm-id, #view-plugins .plug-perm' },
    ]},
    { cat: 'App Catalog', items: [
        { label: 'App cards',          sel: '#view-apps .app-card, #view-apps .glass-card' },
        { label: 'Install buttons',    sel: '#view-apps .btn-primary, #view-apps .btn-accent' },
        { label: 'Category pills',     sel: '#view-apps .app-cat-pill, #view-apps .cat-pill' },
    ]},
    { cat: 'Help & other', items: [
        { label: 'FAQ accordions',     sel: '#view-docs .faq-accordion' },
        { label: 'Search bar',         sel: '#view-docs .input, #view-docs input[type=text]' },
        { label: 'Doc cards',          sel: '#view-docs .glass-card' },
        { label: 'Diagram nodes',      sel: '.mermaid-container g.node rect' },
    ]},
    { cat: 'Settings', items: [
        { label: 'Setting cards',      sel: '#view-settings .glass-card' },
        { label: 'Toggles',            sel: '#view-settings .toggle-slider' },
        { label: 'Section titles',     sel: '#view-settings .card-title' },
    ]},
    { cat: 'Modals', items: [
        { label: 'All modals',         sel: '.modal-overlay .modal' },
        { label: 'Modal headers',      sel: '.modal-header, .modal-title' },
        { label: 'Modal close btn',    sel: '.modal-close' },
        { label: 'Tutorial hub',       sel: '.tut-hub-shell' },
        { label: 'Tutorial hub rows',  sel: '.tut-hub-row, .tut-hub-part' },
        { label: 'Tutorial step panel',sel: '.tut-engine-panel' },
        { label: 'Update / release',   sel: '#upd-card' },
        { label: 'Update notes',       sel: '#modal-update-notes .ptb-modal-card' },
        { label: 'Update sources',     sel: '#mod-update-config-overlay .modal' },
        { label: 'Scheduler card',     sel: '#settings-scheduler-section' },
        { label: 'Scheduler modal',    sel: '#modal-scheduler .modal' },
        { label: 'Scheduler sidebar',  sel: '.sched-side' },
        { label: 'Scheduler steps',    sel: '.sched-step' },
        { label: 'Scheduler action cards', sel: '.sched-act-card' },
        { label: 'Scheduler kind tiles',   sel: '.sched-kind-ic, .sched-act-icon' },
        { label: 'Scheduler branches', sel: '.sched-branch' },
        { label: 'Scheduler toolbar',  sel: '.sched-tools' },
        { label: 'Scheduler trigger cards', sel: '.sched-tr-card' },
        { label: 'Scheduler history',  sel: '.sched-history' },
        { label: 'Scheduler chips',    sel: '.sched-chip' },
        { label: 'Card-order bar',     sel: '.cardorder-bar' },
        { label: 'Docs browser',       sel: '.ptb-modal-card' },
        { label: 'Theme catalog',      sel: '.btc-modal, .btc-card' },
        { label: 'TOS / Privacy',      sel: '#modal-tos .modal, #modal-privacy .modal' },
        { label: 'Settings cards',     sel: '#view-settings .glass-card' },
        { label: 'Storage manager',    sel: '#modal-storage .modal' },
        { label: 'Benchmark',          sel: '#modal-advanced-perf-overlay .modal' },
        { label: 'Benchmark cards',    sel: '#modal-advanced-perf-overlay .glass-card' },
        { label: 'Benchmark tabs',     sel: '#perf-tabs .perf-tab' },
        { label: 'Benchmark segments', sel: '#perf-bench-view .bench-seg' },
        { label: 'Benchmark chips',    sel: '#perf-bench-view .bench-chip' },
        { label: 'Mini-monitor',       sel: '#bmm-mini-monitor' },
        { label: 'Ko-fi reminder',     sel: '.kofi-card' },
        { label: 'Onboarding card',    sel: '.onboarding-card' },
        { label: 'Translation sandbox',sel: '#modal-i18n-sandbox .modal' },
        { label: 'Add-mod modal',      sel: '#modal-add-mod .modal' },
        { label: 'Export data modal',  sel: '.exp-opt-list' },
        // The rest of the real modals in index.html. They all exist and are themable —
        // they were simply never listed, so the only way to restyle them was to hunt them
        // down with the eyedropper while they happened to be open.
        { label: 'Profiles (new/edit)',sel: '#modal-new-profile .modal, #modal-edit-profile .modal' },
        { label: 'Delete confirmations', sel: '#modal-delete-mod .modal, #modal-delete-profile .modal' },
        { label: 'Generic confirm',    sel: '#modal-confirm-generic .modal' },
        { label: 'Conflicts',          sel: '#modal-conflict-warning .modal, #modal-global-conflicts .modal, #modal-conflict-tree .modal, #modal-conflict-file-selector .modal' },
        { label: 'Activation warning', sel: '#modal-activation-warning .modal' },
        { label: 'Duplicate folder',   sel: '#modal-duplicate-folder-warning .modal' },
        { label: 'Integrity',          sel: '#modal-integrity .modal' },
        { label: 'Mod tags',           sel: '#modal-mod-tags .modal' },
        { label: 'Archive explorer',   sel: '#modal-archive-explorer .modal' },
        { label: 'History',            sel: '#modal-history .modal, #modal-history-detail .modal' },
        { label: 'Repo browser',       sel: '#modal-repo-browser .modal' },
        { label: 'Repo hub',           sel: '#modal-repo-hub .modal' },
        { label: 'Repo update',        sel: '#modal-repo-update .modal' },
        { label: 'Repo history',       sel: '#modal-repo-history .modal' },
        { label: 'Repo sync summary',  sel: '#modal-repo-sync-summary .modal' },
        { label: 'Repo verify detail', sel: '#modal-repo-verify-detail .modal' },
        { label: 'Mapper dialogs',     sel: '#modal-mapper-input .modal, #modal-mapper-confirm .modal' },
        { label: 'Launch packs',       sel: '#modal-launchpack .modal, #modal-launchpack-delete .modal' },
        { label: 'App picker',         sel: '#modal-app-picker .modal' },
        { label: 'Server panel',       sel: '#modal-server .modal' },
        { label: 'Crash report',       sel: '#modal-crash-report .modal' },
        { label: 'BetaHub feedback',   sel: '#modal-betahub-feedback .modal, #modal-betahub-bugreport .modal' },
        { label: 'Diagram viewer',     sel: '#modal-docs-diagram .modal' },
        { label: 'Licence',            sel: '#modal-license .modal' },
        { label: 'Credits — contributor', sel: '#modal-contributor-detail .modal' },
        { label: 'Credits — tech stack',  sel: '#modal-stack .modal' },
        { label: 'Theme editor',       sel: '#bmm-theme-editor' },
        { label: 'Theme editor popup', sel: '#bte-elov, .bte-confirm-box' },
    ]},
];
// Every per-page category also gets generic Buttons / Button text / Icons /
// Titles / Texts chips scoped to that page, so each page is fully editable.
{
    const PAGE_CAT_TO_ID: Record<string, string> = {
        'Library': 'library', 'Profiles': 'profiles', 'Server Repo': 'repo',
        '.MM Lists': 'modpacks', 'Plugins & API': 'plugins', 'App Catalog': 'apps',
        'Help & other': 'docs', 'Settings': 'settings',
    };
    for (const g of TARGET_GROUPS) {
        const pid = PAGE_CAT_TO_ID[g.cat];
        if (!pid) continue;
        g.items.push(
            { label: 'Buttons',     sel: `#view-${pid} .btn, #view-${pid} button` },
            { label: 'Button text', sel: `#view-${pid} .btn` },
            { label: 'Icons',       sel: `#view-${pid} svg` },
            { label: 'Titles',      sel: `#view-${pid} h1, #view-${pid} h2, #view-${pid} h3, #view-${pid} .card-title` },
            { label: 'Texts',       sel: `#view-${pid} p, #view-${pid} span, #view-${pid} label` },
        );
    }
}

/** Read the CURRENT computed value of a CSS variable from :root.
 *  This is what is actually applied on screen right now. */
function computedVar(key: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(key).trim();
}

/** Return the best hex colour for the native colour picker.
 *  Priority: draft override → computed CSS var → fallback */
function pickerHex(key: string, draftVal: string, fallback = '#3b82f6'): string {
    const v = draftVal || computedVar(key) || '';
    const m = v.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
    return m ? `#${m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]}` : fallback;
}

/** Label for the "current value" shown when no custom override is set. */
function currentLabel(key: string, type: Token['type']): string {
    const cv = computedVar(key);
    if (!cv) return '—';
    if (type === 'color') return cv.slice(0, 28) + (cv.length > 28 ? '…' : '');
    return cv.slice(0, 30) + (cv.length > 30 ? '…' : '');
}

// ── Auto-palette: generate a full coherent theme from one accent colour ─────────
function _hexToRgb(hex: string): [number, number, number] {
    const m = hex.replace('#', '');
    const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0];
}
function _rgbToHexN(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
}
function _hexToHsl(hex: string): [number, number, number] {
    let [r, g, b] = _hexToRgb(hex).map(x => x / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
    }
    return [h * 360, s * 100, l * 100];
}
function _hslToHex(h: number, s: number, l: number): string {
    h /= 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
    const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    let r: number, g: number, b: number;
    if (s === 0) { r = g = b = l; }
    else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q; r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3); }
    return _rgbToHexN(r * 255, g * 255, b * 255);
}
function _accentVarsLocal(hex: string): Record<string, string> {
    const [r, g, b] = _hexToRgb(hex);
    return {
        '--bmm-accent': hex, '--bmm-accent-dim': `rgba(${r},${g},${b},0.18)`,
        '--bmm-accent-r': String(r), '--bmm-accent-g': String(g), '--bmm-accent-b': String(b),
        '--bmm-border-accent': `rgba(${r},${g},${b},0.4)`,
        '--bmm-accent-glow': `0 0 20px rgba(${r},${g},${b},0.35)`,
    };
}
/** Build a full, coherent theme palette from a single accent colour. */
function genPalette(accent: string, light: boolean): Partial<BmmTheme> {
    const [h, s] = _hexToHsl(accent);
    const bgSat = Math.min(s, 22);            // tint backgrounds subtly with the accent hue
    const vars: Record<string, string> = { ..._accentVarsLocal(accent) };
    if (light) {
        Object.assign(vars, {
            '--bmm-bg-base': _hslToHex(h, bgSat * 0.5, 95),
            '--bmm-bg-elevated': '#ffffff',
            '--bmm-bg-overlay': '#ffffff',
            '--bmm-bg-sidebar': _hslToHex(h, bgSat * 0.4, 99),
            '--bmm-bg-titlebar': _hslToHex(h, bgSat * 0.4, 97),
            '--bmm-titlebar-bg': _hslToHex(h, bgSat * 0.4, 97),
            '--bmm-loader-bg': _hslToHex(h, bgSat * 0.5, 95),
            '--bmm-text-primary': _hslToHex(h, 12, 12),
            '--bmm-text-secondary': _hslToHex(h, 8, 30),
            '--bmm-text-muted': _hslToHex(h, 6, 48),
            '--bmm-border': 'rgba(0,0,0,0.1)', '--bmm-border-hover': 'rgba(0,0,0,0.18)',
            '--bmm-surface-r': '0', '--bmm-surface-g': '0', '--bmm-surface-b': '0',
            '--bmm-color-scheme': 'light',
            '--bmm-card-glow': '0 0 0 transparent', '--bmm-card-hover-lift': '0px',
            '--bmm-shadow-card': '0 1px 3px rgba(0,0,0,0.06)',
        });
        return { vars, mode: 'light' };
    }
    Object.assign(vars, {
        '--bmm-bg-base': _hslToHex(h, bgSat, 7),
        '--bmm-bg-elevated': _hslToHex(h, bgSat, 11),
        '--bmm-bg-sidebar': _hslToHex(h, bgSat, 5),
        '--bmm-bg-titlebar': _hslToHex(h, bgSat, 4),
        '--bmm-titlebar-bg': _hslToHex(h, bgSat, 4),
        '--bmm-loader-bg': _hslToHex(h, bgSat, 4),
        '--bmm-text-primary': _hslToHex(h, 10, 96),
        '--bmm-text-secondary': _hslToHex(h, 8, 70),
        '--bmm-text-muted': _hslToHex(h, 6, 45),
        '--bmm-border': 'rgba(255,255,255,0.08)', '--bmm-border-hover': 'rgba(255,255,255,0.16)',
        '--bmm-surface-r': '255', '--bmm-surface-g': '255', '--bmm-surface-b': '255',
        '--bmm-color-scheme': 'dark',
    });
    return { vars, mode: 'dark' };
}

/** A unified, revertable list of every change in the current draft: token tweaks,
 *  fonts/sizes, custom element overrides and assets. Lets the user review and
 *  undo changes one by one instead of hunting through the groups.            */
function buildChangesPanel(): string {
    const labelOf = (key: string) => TOKENS.find(tk => tk.key === key)?.label || key.replace('--bmm-', '');
    const rows: string[] = [];
    for (const [k, v] of Object.entries(_draft.vars || {})) {
        // skip the auto-derived rgb channel tokens (noise)
        if (/-(r|g|b)$/.test(k) && /^\d+$/.test(String(v))) continue;
        const isColor = /^#|rgb/i.test(String(v));
        const sw = isColor ? `<span class="bte-chg-swatch" style="background:${escAttr(String(v))}"></span>` : '';
        rows.push(`<div class="bte-chg-row" data-chg="var" data-key="${escAttr(k)}">
            ${sw}<span class="bte-chg-name">${escHtml(labelOf(k))}</span>
            <code class="bte-chg-val">${escHtml(String(v).slice(0, 22))}</code>
            <button class="bte-chg-revert" data-tooltip="${t('themes.revert')||'Revert'}">↩</button>
        </div>`);
    }
    for (const o of (_draft.element_overrides || [])) {
        rows.push(`<div class="bte-chg-row" data-chg="ov" data-key="${escAttr(o.selector)}">
            <span class="bte-chg-name">${gi('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>')} <code>${escHtml(o.selector.slice(0, 30))}</code></span>
            <span class="bte-chg-val">${Object.keys(o.props).length} ${t('themes.props')||'props'}</span>
            <button class="bte-chg-revert" data-tooltip="${t('themes.revert')||'Revert'}">↩</button>
        </div>`);
    }
    for (const k of Object.keys(_draft.assets || {})) {
        rows.push(`<div class="bte-chg-row" data-chg="asset" data-key="${escAttr(k)}">
            <span class="bte-chg-name">${gi('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>')} ${escHtml(k)}</span>
            <span class="bte-chg-val">${t('themes.custom')||'custom'}</span>
            <button class="bte-chg-revert" data-tooltip="${t('themes.revert')||'Revert'}">↩</button>
        </div>`);
    }
    for (const s of (_draft.html_swaps || [])) {
        rows.push(`<div class="bte-chg-row" data-chg="swap" data-key="${escAttr(s.selector)}">
            <span class="bte-chg-name">${gi('<path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/>')} <code>${escHtml(s.selector.slice(0, 30))}</code></span>
            <span class="bte-chg-val">${t('themes.iconSwap')||'icon'}</span>
            <button class="bte-chg-revert" data-tooltip="${t('themes.revert')||'Revert'}">↩</button>
        </div>`);
    }
    if (_draft.global_css) {
        rows.push(`<div class="bte-chg-row" data-chg="globalcss" data-key="">
            <span class="bte-chg-name">⌨ ${t('themes.customCssLabel')||'Custom CSS'}</span>
            <span class="bte-chg-val"></span>
            <button class="bte-chg-revert" data-tooltip="${t('themes.revert')||'Revert'}">↩</button>
        </div>`);
    }
    if (!rows.length) return '';
    return `
        <div class="bte-group bte-changes open">
            <div class="bte-group-head" role="button">
                <span class="bte-group-title">${gi('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>')} ${t('themes.yourChanges')||'Your changes'}</span>
                <span class="bte-group-badge">${rows.length}</span>
                <button class="bte-chg-revert-all" data-tooltip="${t('themes.revertAll')||'Revert all'}">${t('themes.revertAll')||'Revert all'}</button>
                <svg class="bte-group-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </div>
            <div class="bte-group-body">${rows.join('')}</div>
        </div>`;
}

// Friendly per-group descriptions + icons
/** Small lucide-style group icon (monochrome, follows currentColor — no emoji). */
const gi = (paths: string) =>
    `<svg class="bte-gi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const GROUP_INFO: Record<string, { icon: string; desc: string }> = {
    'Background':     { icon: gi('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>'), desc: 'Colours behind the whole app, cards and bars.' },
    'Accent':         { icon: gi('<path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/>'), desc: 'Highlight colours — buttons, active items, states.' },
    'Borders':        { icon: gi('<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/>'), desc: 'Outlines around cards, inputs and panels.' },
    'Text':           { icon: gi('<path d="M4 7V5h16v2M9 19h6M12 5v14"/>'), desc: 'Text colours for different levels of importance.' },
    'Typography':     { icon: gi('<path d="M4 7V5h16v2M9 19h6M12 5v14"/>'), desc: 'Fonts and base text size of the whole interface.' },
    'Shape':          { icon: gi('<path d="M12 2 2 7l10 5 10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>'), desc: 'How rounded cards, buttons and inputs are.' },
    'Tasky Tooltips': { icon: gi('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'), desc: 'The little helper bubbles that pop up on hover.' },
    'Effects':        { icon: gi('<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'), desc: 'Glows, shadows, hover lift and animation speed.' },
    'Intro & Outro':  { icon: gi('<polygon points="5 3 19 12 5 21 5 3"/>'), desc: 'The startup/close screen — background, boot mascot image and speed.' },
    'Buttons':        { icon: gi('<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="8" cy="12" r="2"/>'), desc: 'Recolour each button kind on its own, without touching the accent.' },
    'Charts':         { icon: gi('<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/>'), desc: 'Line colours of the performance / benchmark graphs.' },
    'Diagrams':       { icon: gi('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M7 10v4h7"/>'), desc: 'Node colours of the interactive flowcharts (Help & other).' },
    'DevTools':       { icon: gi('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2z"/>'), desc: 'The developer tools overlay (F12).' },
    // These two existed as GROUPS but never got an entry here, so their section headers
    // rendered blank — no icon, no explanation (field screenshot). Every group used by a
    // token above MUST have a row in this table; the guard in buildSimpleTab asserts it.
    'Surfaces':       { icon: gi('<rect x="2" y="4" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/>'), desc: 'The translucent tint every panel is built from — the light/dark switch of a theme.' },
    'Toasts':         { icon: gi('<rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 17.5h7"/>'), desc: 'The small notification popups — background, text and border.' },
};

const MDN_BASE = 'https://developer.mozilla.org/en-US/docs/Web/CSS/';

function buildSimpleTab(): string {
    // A token's group with no GROUP_INFO entry renders a blank header — exactly how
    // Surfaces and Toasts shipped iconless. Console-error it so it cannot be quiet.
    for (const f of TOKENS) {
        if (!GROUP_INFO[f.group]) console.error(`[theme-editor] group "${f.group}" has no GROUP_INFO entry — blank header`);
    }
    const groups: Record<string, Token[]> = {};
    for (const tok of TOKENS) (groups[tok.group] ||= []).push(tok);
    const vars = _draft.vars || {};

    const presets = BUILTIN_THEMES.map(bt => `
        <button class="bte-preset" data-preset-id="${bt.id}"
            data-tasky="${escJs(bt.description||bt.name)}" data-tasky-literal="1">
            <span class="bte-preset-dot" style="background:${bt.vars?.['--bmm-accent']||'var(--bmm-accent)'}"></span>
            ${escHtml(bt.name)}
        </button>`).join('');

    // ── Assets quick section (mascot / wallpaper / logo) ──
    const assets = (_draft.assets || {}) as Record<string, string>;
    const assetRow = (key: string, label: string, accept: string, desc: string, isVideo = false) => `
        <div class="bte-asset-row">
            <div class="bte-asset-info">
                <span class="bte-asset-label"
                    data-tasky="${escJs(desc)}" data-tasky-icon="image" data-tasky-literal="1">${escHtml(label)}</span>
                ${assets[key] ? `<span class="bte-asset-set">✓ ${t('themes.assetSet')||'set'}</span>` : `<span class="bte-asset-none">${t('themes.assetDefault')||'default'}</span>`}
            </div>
            <div class="bte-asset-actions">
                <button class="btn btn-xs btn-secondary bte-asset-pick" data-asset="${key}" data-accept="${accept}" data-video="${isVideo}">${t('themes.choose')||'Choose…'}</button>
                ${assets[key] ? `<button class="btn btn-xs btn-ghost bte-asset-clear" data-asset="${key}">✕</button>` : ''}
            </div>
        </div>`;

    // Collapsible like every other group. Open by default if any asset is set.
    const assetsCount = ['mascot', 'logo', 'wallpaper'].filter(k => assets[k]).length;
    const assetsHtml = `
        <div class="bte-group${assetsCount ? ' open' : ''}">
            <button class="bte-group-head" type="button">
                <span class="bte-group-title">${gi('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>')} ${t('themes.assets')||'Assets (images / video)'}</span>
                ${assetsCount ? `<span class="bte-group-badge">${assetsCount}</span>` : ''}
                <svg class="bte-group-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div class="bte-group-body">
                <p class="bte-group-desc">${t('themes.assetsDesc')||'Replace BMM built-in images. Files are embedded into your theme.'}</p>
                ${assetRow('mascot', t('themes.assetMascot')||'Tasky mascot', 'image/*', t('themes.assetMascotDesc')||'Replace the floating Tasky mascot AND the spinning boot loader Tasky.')}
                ${assetRow('logo',   t('themes.assetLogo')||'Sidebar logo', 'image/*', t('themes.assetLogoDesc')||'Replace the BMM logo in the sidebar.')}
                ${assetRow('wallpaper', t('themes.assetWallpaper')||'App wallpaper', 'image/*,video/*', t('themes.assetWallpaperDesc')||'A full-app background image. Set blur & opacity in the Background group.', true)}
            </div>
        </div>`;

    // Collapse all groups by default except the two most-used, so the panel isn't
    // an overwhelming wall of fields. Groups with a customised token start open.
    const OPEN_BY_DEFAULT = new Set(['Background', 'Accent']);
    const groupsHtml = Object.entries(groups).map(([grp, tokens]) => {
        const info = GROUP_INFO[grp] || { icon: '', desc: '' };
        const customCount = tokens.filter(tk => vars[tk.key]).length;
        const open = OPEN_BY_DEFAULT.has(grp) || customCount > 0;
        return `
        <div class="bte-group${open ? ' open' : ''}">
            <button class="bte-group-head" type="button">
                <span class="bte-group-title">${info.icon} ${escHtml(grp)}</span>
                ${customCount ? `<span class="bte-group-badge">${customCount}</span>` : ''}
                <svg class="bte-group-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div class="bte-group-body">
            ${info.desc ? `<p class="bte-group-desc">${escHtml(info.desc)}</p>` : ''}
            ${customCount ? `<button class="bte-group-reset" data-group="${escAttr(grp)}" data-tooltip="${escAttr(t('themes.resetGroupHint')||'Reset every field in this section to its default')}">${ICON.reset(11)} ${(t('themes.resetGroup')||'Reset this section')} (${customCount})</button>` : ''}
            ${tokens.map(tok => {
                const custom = vars[tok.key] || '';
                const ph = pickerHex(tok.key, custom);
                const liveLabel = custom ? '' : `<span class="bte-token-live">${escHtml(currentLabel(tok.key, tok.type))}</span>`;
                const mdnLink = tok.mdn ? `<a class="bte-mdn" href="${MDN_BASE}${tok.mdn}" target="_blank" data-tooltip="MDN: ${tok.mdn}" onmouseenter="window.showTaskyHelp('${escJs('Open the MDN documentation for the CSS property: ' + tok.mdn)}','info',true)">?</a>` : '';
                let inp = '';
                if (tok.type === 'color') {
                    inp = `<div class="bte-color-wrap">
                        <input type="color" class="bte-color-native" data-var="${tok.key}" value="${ph}">
                        <input type="text" class="bte-color-text bte-var-inp" data-var="${tok.key}" value="${escHtml(custom)}" placeholder="${escHtml(currentLabel(tok.key, tok.type))}">
                    </div>`;
                } else if (tok.type === 'image') {
                    inp = `<div class="bte-img-wrap">
                        <input type="text" class="bte-var-inp" data-var="${tok.key}" value="${escHtml(custom)}" placeholder="${escHtml(currentLabel(tok.key, tok.type))}">
                        ${custom ? `<button class="bte-img-clear" data-var="${tok.key}">✕</button>` : ''}
                    </div>`;
                } else if (tok.type === 'font') {
                    const presets = tok.key === '--bmm-font-mono' ? MONO_PRESETS : FONT_PRESETS;
                    inp = `<select class="bte-font-sel bte-var-inp" data-var="${tok.key}" style="width:160px;">
                        <option value="">— ${escHtml(currentLabel(tok.key, tok.type).split(',')[0])} —</option>
                        ${presets.map(f => `<option value="${escAttr(f.value)}"${custom===f.value?' selected':''}>${escHtml(f.label)}</option>`).join('')}
                    </select>`;
                } else {
                    inp = `<input type="text" class="bte-var-inp" data-var="${tok.key}" value="${escHtml(custom)}" placeholder="${escHtml(currentLabel(tok.key, tok.type))}">`;
                }
                return `<div class="bte-token-row${custom ? ' has-custom' : ''}" data-token="${escAttr(tok.key)}">
                    <label class="bte-token-lbl bte-token-reveal" data-reveal="${escAttr(tok.key)}"
                        data-tooltip="${escAttr(t('themes.revealTip') || 'Click: show me what this paints')}"
                        data-tasky="${escJs(tok.desc)}" data-tasky-literal="1">${escHtml(tok.label)} ${mdnLink}</label>
                    <div class="bte-token-ctrl">
                        ${inp}
                        ${custom ? `<button class="bte-token-revert" data-var="${tok.key}" data-tooltip="${t('themes.resetToDefault')||'Reset to default'}">↩</button>` : liveLabel}
                    </div>
                </div>`;
            }).join('')}
            </div>
        </div>`;
    }).join('');

    return `
        <div class="bte-intro" data-tasky="Hover any label to see what it does. Click ? for the MDN docs. Pick a preset to start fast, then tweak." data-tasky-literal="1">
            ${t('themes.simpleIntro')||'Pick a preset, then tweak anything. Hover labels for help, click ? for MDN docs.'}
        </div>
        ${buildChangesPanel()}
        <div class="bte-section-title">${t('themes.quickPresets')||'Quick presets'}</div>
        <div class="bte-presets">${presets}</div>
        <div class="bte-gen-row">
            <input type="color" id="bte-gen-color" value="${pickerHex('--bmm-accent', _draft.vars?.['--bmm-accent']||'')}" data-tooltip="${escAttr(t('themes.genHint')||'Pick a colour to generate a full matching theme')}">
            <button class="btn btn-secondary btn-sm" id="bte-gen-dark">${t('themes.genDark')||'Generate dark'}</button>
            <button class="btn btn-secondary btn-sm" id="bte-gen-light">${t('themes.genLight')||'Generate light'}</button>
        </div>
        <label class="bte-contrast-toggle" data-tooltip="${escAttr(t('themes.contrastHint')||'Auto-darkens light text/surfaces on light themes. Turn off for full manual control.')}">
            <input type="checkbox" id="bte-contrast-toggle" ${isContrastEnforced() ? 'checked' : ''}>
            <span>${t('themes.contrastToggle')||'Auto contrast on light themes'}</span>
        </label>
        <div class="bte-sep"></div>
        <div class="bte-group">
            <button class="bte-group-head" type="button">
                <span class="bte-group-title">${gi('<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18"/>')} ${t('themes.modalsTargets')||'Modals & shared elements'}</span>
                <svg class="bte-group-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div class="bte-group-body">
                <p class="bte-group-desc">${t('themes.modalsHint')||'Click any element to edit it directly (colours, hover, CSS) — no need to open it first.'}</p>
                ${TARGET_GROUPS.map(g => `
                    <div class="bte-target-cat">${escHtml(g.cat)}</div>
                    <div class="bte-targets">
                        ${g.items.map(m => `<button class="bte-target-chip" data-sel="${escAttr(m.sel)}">${escHtml(m.label)}</button>`).join('')}
                    </div>
                `).join('')}
            </div>
        </div>
        ${assetsHtml}
        ${groupsHtml}`;
}

function wireSimple(): void {
    // Collapsible token groups
    _panel?.querySelectorAll('.bte-group-head').forEach(head => {
        head.addEventListener('click', () => head.parentElement?.classList.toggle('open'));
    });
    // Reset every override within one group at once
    _panel?.querySelectorAll('.bte-group-reset').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const grp = (btn as HTMLElement).dataset.group || '';
            if (!_draft.vars) return;
            for (const tok of TOKENS) {
                if (tok.group === grp) delete _draft.vars[tok.key];
            }
            previewTheme(_draft); renderTab('simple');
        });
    });
    // Change tracker — revert individual changes or all at once
    _panel?.querySelectorAll('.bte-chg-revert').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const row = (btn as HTMLElement).closest('.bte-chg-row') as HTMLElement;
            const type = row?.dataset.chg, key = row?.dataset.key || '';
            if (type === 'var' && _draft.vars) delete _draft.vars[key];
            else if (type === 'ov' && _draft.element_overrides)
                _draft.element_overrides = _draft.element_overrides.filter(o => o.selector !== key);
            else if (type === 'asset' && _draft.assets) {
                delete _draft.assets[key];
                if (key === 'wallpaper' && _draft.vars) _draft.vars['--bmm-app-bg-image'] = 'none';
            }
            else if (type === 'swap' && _draft.html_swaps)
                _draft.html_swaps = _draft.html_swaps.filter(s => s.selector !== key);
            else if (type === 'globalcss') _draft.global_css = '';
            previewTheme(_draft); renderTab('simple');
        });
    });
    _panel?.querySelector('.bte-chg-revert-all')?.addEventListener('click', async e => {
        e.stopPropagation();
        if (!await bteConfirm(t('themes.revertAllConfirm')||'Revert ALL unsaved changes?', { danger: true, okLabel: t('themes.revertAll')||'Revert all' })) return;
        // Truly revert: restore the theme that was active when the editor opened.
        if (_origTheme) {
            _draft = JSON.parse(JSON.stringify(_origTheme));
            applyTheme(JSON.parse(JSON.stringify(_origTheme)));
        } else {
            _draft = { custom_elements: [] };
            resetTheme();
        }
        renderTab('simple');
    });
    // Auto-contrast enforcer on/off
    _panel?.querySelector('#bte-contrast-toggle')?.addEventListener('change', e => {
        const on = (e.target as HTMLInputElement).checked;
        setContrastEnforced(on);
        toast(on ? (t('themes.contrastOn')||'Auto contrast enabled')
                 : (t('themes.contrastOff')||'Auto contrast disabled'), 'info', 1800);
    });
    // Auto-palette: generate a full theme from the chosen colour
    const genFrom = (light: boolean) => {
        const color = (_panel?.querySelector('#bte-gen-color') as HTMLInputElement)?.value || '#3b82f6';
        const p = genPalette(color, light);
        _draft = { ..._draft, vars: { ...p.vars }, mode: p.mode, custom_elements: _draft.custom_elements };
        previewTheme(_draft); renderTab('simple');
        toast(t('themes.genDone')||'Theme generated — tweak anything below', 'success', 2000);
    };
    _panel?.querySelector('#bte-gen-dark')?.addEventListener('click', () => genFrom(false));
    _panel?.querySelector('#bte-gen-light')?.addEventListener('click', () => genFrom(true));
    // Modal / shared-element target chips → open the override editor for that selector
    _panel?.querySelectorAll('.bte-target-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            openElementOverrideEditor(document.body, (chip as HTMLElement).dataset.sel!);
        });
    });
    _panel?.querySelectorAll('.bte-var-inp').forEach(inp => {
        inp.addEventListener('input', () => {
            const k = (inp as HTMLInputElement).dataset.var!;
            const v = (inp as HTMLInputElement).value;
            const tv = targetVars()!;
            if (v.trim() === '') {
                delete tv[k];
            } else {
                tv[k] = v.trim();
                syncAccentRgb(k, v.trim());
            }
            previewTheme(_draft); updateDirty();
        });
    });
    _panel?.querySelectorAll('.bte-color-native').forEach(inp => {
        inp.addEventListener('input', () => {
            const k = (inp as HTMLInputElement).dataset.var!;
            const hex = (inp as HTMLInputElement).value;
            const txt = _panel!.querySelector(`.bte-color-text[data-var="${CSS.escape(k)}"]`) as HTMLInputElement|null;
            if (txt) txt.value = hex;
            const tv = targetVars()!;
            tv[k] = hex;
            syncAccentRgb(k, hex);
            previewTheme(_draft); updateDirty();
        });
        // Clicking the native picker when no custom value → set it to current hex
        inp.addEventListener('click', () => {
            const k = (inp as HTMLInputElement).dataset.var!;
            if (!(_draft.vars?.[k])) {
                (inp as HTMLInputElement).value = pickerHex(k, '');
            }
        });
    });
    _panel?.querySelectorAll('.bte-token-revert').forEach(btn => {
        btn.addEventListener('click', () => {
            const tv = targetVars(false);
            if (tv) delete tv[(btn as HTMLElement).dataset.var!];
            previewTheme(_draft); renderTab('simple');
        });
    });
    _panel?.querySelectorAll('.bte-img-clear').forEach(btn => {
        btn.addEventListener('click', () => {
            targetVars()![(btn as HTMLElement).dataset.var!] = 'none';
            previewTheme(_draft); renderTab('simple');
        });
    });
    _panel?.querySelectorAll('.bte-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = (btn as HTMLElement).dataset.presetId!;
            const p = BUILTIN_THEMES.find(b => b.id === id);
            // Carry over the preset's `mode` too — without it, light presets (Full
            // White…) never trigger body.bmm-theme-light or the light contrast patches.
            if (p) { _draft = { ..._draft, vars: { ...p.vars }, mode: p.mode, custom_elements: _draft.custom_elements }; previewTheme(_draft); renderTab('simple'); }
        });
    });

    // ── Asset pickers (image / video → base64 data-URI embedded in theme) ──
    _panel?.querySelectorAll('.bte-asset-pick').forEach(btn => {
        btn.addEventListener('click', () => pickAsset(
            (btn as HTMLElement).dataset.asset!,
            (btn as HTMLElement).dataset.accept || 'image/*',
            (btn as HTMLElement).dataset.video === 'true',
        ));
    });
    _panel?.querySelectorAll('.bte-asset-clear').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = (btn as HTMLElement).dataset.asset!;
            if (_draft.assets) delete _draft.assets[key];
            // wallpaper also clears the CSS var
            if (key === 'wallpaper' && _draft.vars) _draft.vars['--bmm-app-bg-image'] = 'none';
            previewTheme(_draft); renderTab('simple');
        });
    });
}

/** Open a hidden file input, read the chosen image/video as a base64 data-URI,
 *  store it in the theme's assets, and apply it live. */
/** Open a file picker, read the chosen image as a base64 data-URI (≤4 MB). */
function readImageFile(cb: (dataUri: string) => void): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) {
            toast(t('themes.assetTooBig') || 'File too large (max 4 MB for embedding). Use a URL instead.', 'warning', 4000);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => cb(reader.result as string);
        reader.readAsDataURL(file);
    };
    input.click();
}

function pickAsset(key: string, accept: string, isVideo: boolean): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) {
            toast(t('themes.assetTooBig') || 'File too large (max 4 MB for embedding). Use a URL instead.', 'warning', 4000);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const dataUri = reader.result as string;
            if (!_draft.assets) _draft.assets = {};
            _draft.assets[key] = dataUri;
            // wallpaper → also set the CSS var (images only; video wallpaper handled separately)
            if (key === 'wallpaper' && !isVideo) {
                if (!_draft.vars) _draft.vars = {};
                _draft.vars['--bmm-app-bg-image'] = `url("${dataUri}")`;
            }
            previewTheme(_draft);
            renderTab('simple');
            toast(t('themes.assetSet') || 'Asset applied', 'success', 1500);
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

function syncAccentRgb(k: string, v: string): void {
    if (k !== '--bmm-accent') return;
    const m = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return;
    const tv = targetVars()!;
    tv['--bmm-accent-r'] = String(parseInt(m[1], 16));
    tv['--bmm-accent-g'] = String(parseInt(m[2], 16));
    tv['--bmm-accent-b'] = String(parseInt(m[3], 16));
}

// ═══════════════════════════════════════════════════════════════════
// ELEMENTS TAB — add / edit custom HTML elements anywhere in BMM
// ═══════════════════════════════════════════════════════════════════
// Ready-made HTML templates so users don't have to write HTML from scratch.
const CE_TEMPLATES: { label: string; icon: string; html: string }[] = [
    { label: 'Button', icon: gi('<rect x="2" y="7" width="20" height="10" rx="5"/>'),
      html: `<button class="btn btn-sm btn-primary" data-bmm-deeplink="bmm://restart">My button</button>` },
    { label: 'Banner', icon: gi('<path d="M3 11 21 5v14L3 13v-2z"/>'),
      html: `<div style="padding:10px 14px;border-radius:10px;background:var(--bmm-accent-dim);color:var(--bmm-text-primary);font-weight:600;">My custom banner</div>` },
    { label: 'Badge', icon: gi('<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>'),
      html: `<span style="padding:3px 9px;border-radius:999px;background:var(--bmm-accent);color:var(--bmm-text-on-accent);font-size:11px;font-weight:700;">NEW</span>` },
    { label: 'Note', icon: gi('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
      html: `<p style="margin:8px 0;color:var(--bmm-text-secondary);font-size:13px;">My note text…</p>` },
    { label: 'Image', icon: gi('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
      html: `<img src="https://placehold.co/120x60" alt="" style="border-radius:10px;max-width:100%;">` },
    { label: 'Link', icon: gi('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
      html: `<a href="#" data-bmm-deeplink="bmm://repo/sync?url=URL" style="color:var(--bmm-accent);font-weight:600;">My link →</a>` },
];

function buildElementsTab(): string {
    const ces: CustomElement[] = _draft.custom_elements || [];
    const pageOpts = ['(all pages)', ...PAGE_OPTIONS.map(p => p.label)].map((l, i) =>
        `<option value="${i===0?'':PAGE_OPTIONS[i-1]?.id||''}">${escHtml(l)}</option>`).join('');

    const posLabels: Record<string,string> = {
        append:  t('themes.posAppend')||'Inside, at the end',
        prepend: t('themes.posPrepend')||'Inside, at the start',
        before:  t('themes.posBefore')||'Just before it',
        after:   t('themes.posAfter')||'Just after it',
    };

    const list = ces.length ? ces.map(ce => `
        <div class="bte-ce-row" data-ce-id="${escAttr(ce.id)}">
            <div class="bte-ce-row-info">
                <code class="bte-ce-selector">${escHtml(ce.target)}</code>
                <span class="bte-ce-pos">${escHtml(posLabels[ce.position]||ce.position)}</span>
                ${ce.scope ? `<span class="bte-ce-scope">${escHtml(ce.scope)}</span>` : `<span class="bte-ce-scope">${t('themes.allPages')||'all pages'}</span>`}
            </div>
            <div class="bte-ce-row-preview">${escHtml(ce.html.replace(/<[^>]+>/g, '').trim().slice(0, 50)) || '⟨html⟩'}</div>
            <div class="bte-ce-row-actions">
                <button class="bte-icon-btn bte-ce-edit" data-ce-id="${escAttr(ce.id)}" data-tooltip="${t('common.edit')||'Edit'}">${ICON.edit(13)}</button>
                <button class="bte-icon-btn danger bte-ce-del" data-ce-id="${escAttr(ce.id)}" data-tooltip="${t('common.delete')||'Delete'}">${ICON.trash(13)}</button>
            </div>
        </div>`).join('') : `<div class="bte-empty" style="margin:14px 0;">${t('themes.noCe')||'No custom elements yet — add one below.'}</div>`;

    const isEdit = _editingCeId != null;
    const editing = isEdit ? ces.find(c => c.id === _editingCeId) : null;

    return `
        <div class="bte-intro" onmouseenter="window.showTaskyHelp('${escJs(t('themes.ceTaskyHelp')||'Add your own buttons, banners or widgets anywhere in BMM. Choose WHERE (1), pick a template, then tweak the HTML (2).')}','info',true)">
            ${t('themes.ceIntro')||'Add your own buttons, banners, badges or widgets anywhere in BMM. Pick a spot, choose a template, done.'}
        </div>

        ${ces.length ? `<div class="bte-section-title">${t('themes.ceYour')||'Your elements'} (${ces.length})</div>
        <div class="bte-ce-list">${list}</div>
        <div class="bte-sep"></div>` : ''}

        <div class="bte-section-title">${isEdit ? `${t('common.edit')||'Edit'}` : (t('themes.ceAdd')||'Add an element')}</div>

        <div class="bte-ce-form">
            <!-- STEP 1: WHERE -->
            <div class="bte-step"><span class="bte-step-n">1</span>${t('themes.ceWhere')||'Where should it go?'}</div>
            <button class="btn btn-secondary btn-sm bte-ce-pickbtn" id="bte-ce-pick-target">
                ${ICON.eyedropper(14)} <span>${t('themes.cePickSpot')||'Click a spot in BMM'}</span>
            </button>
            <div class="bte-ce-form-row" style="margin-top:8px;">
                <label class="bte-ce-lbl">${t('themes.ceSelector')||'…or type a CSS selector'}</label>
                <input id="bte-ce-target" class="bte-var-inp" placeholder="#view-library .view-header" value="${escHtml(editing?.target||'')}">
            </div>
            <div class="bte-ce-form-grid">
                <div class="bte-ce-form-row">
                    <label class="bte-ce-lbl">${t('themes.cePosition')||'Placement'}</label>
                    <select id="bte-ce-pos" class="bte-adv-sel">
                        ${['append','prepend','before','after'].map(p =>
                            `<option value="${p}"${(editing?.position||'append')===p?' selected':''}>${escHtml(posLabels[p])}</option>`).join('')}
                    </select>
                </div>
                <div class="bte-ce-form-row">
                    <label class="bte-ce-lbl">${t('themes.ceScope')||'Show on'}</label>
                    <select id="bte-ce-scope" class="bte-adv-sel">${pageOpts}</select>
                </div>
            </div>

            <!-- STEP 2: WHAT -->
            <div class="bte-step" style="margin-top:14px;"><span class="bte-step-n">2</span>${t('themes.ceWhat')||'What to show?'}</div>
            <div class="bte-ce-templates">
                ${CE_TEMPLATES.map(tpl =>
                    `<button class="bte-tpl-chip" data-tpl="${escAttr(tpl.html)}"><span>${tpl.icon}</span>${escHtml(tpl.label)}</button>`).join('')}
            </div>
            <textarea id="bte-ce-html" class="bte-adv-textarea" style="min-height:84px;margin-top:8px;" placeholder="${escAttr(t('themes.ceHtmlPh')||'Pick a template above, or write your own HTML here…')}">${escHtml(editing?.html||'')}</textarea>
            <p class="bte-adv-tip" style="margin:4px 0 0;">${t('themes.ceDeeplinkTip')||'For BMM actions, use'} <code>data-bmm-deeplink="bmm://…"</code></p>

            <div class="bte-deeplink-quick">
                <div class="bte-ce-lbl" style="margin-bottom:4px;">${t('themes.ceActions')||'Insert an action'}</div>
                ${[
                    ['Enable mod','bmm://mod/enable?id=MOD_ID'],
                    ['Disable mod','bmm://mod/disable?id=MOD_ID'],
                    ['Switch profile','bmm://profile/activate?id=PROF_ID'],
                    ['Sync repo','bmm://repo/sync?url=URL'],
                    ['Apply plugin','bmm://plugin/activate?id=PLUG_ID'],
                    ['Launch app','bmm://app/launch?id=APP_ID'],
                    ['Restart BMM','bmm://restart'],
                ].map(([lbl, dl]) =>
                    `<button class="bte-dl-chip" data-snippet='<button class="btn btn-xs btn-accent" data-bmm-deeplink="${dl}">${lbl}</button>'>${escHtml(lbl as string)}</button>`
                ).join('')}
            </div>

            <label class="bte-ce-lbl" style="margin-top:12px;">${t('themes.ceCss')||'Extra CSS (optional)'}</label>
            <textarea id="bte-ce-css" class="bte-adv-textarea" style="min-height:54px;" placeholder="/* e.g. margin-top: 8px; */">${escHtml(editing?.css||'')}</textarea>

            <div style="display:flex;gap:8px;margin-top:12px;">
                ${isEdit ? `<button class="btn btn-ghost btn-sm" id="bte-ce-cancel">${t('common.cancel')||'Cancel'}</button>` : ''}
                <button class="btn btn-accent btn-sm" id="bte-ce-add">${ICON.plus(13)} ${isEdit ? (t('themes.ceSaveChanges')||'Save changes') : (t('themes.ceAddBtn')||'Add element')}</button>
            </div>
        </div>`;
}

// expose deeplink helper for custom element buttons
(window as any).__bmmDeeplink = (url: string) => {
    window.dispatchEvent(new CustomEvent('bmm-deeplink', { detail: url }));
    // Also try direct navigation: fire the same deep link handler
    const evt = new CustomEvent('bmm:process-deeplink', { detail: { url } });
    document.dispatchEvent(evt);
};

function wireElements(): void {
    // Select scope option matching current editing
    if (_editingCeId) {
        const editing = (_draft.custom_elements || []).find(c => c.id === _editingCeId);
        if (editing) {
            const scopeSel = _panel?.querySelector('#bte-ce-scope') as HTMLSelectElement;
            if (scopeSel) scopeSel.value = editing.scope || '';
        }
    }

    // Add / save
    _panel?.querySelector('#bte-ce-add')?.addEventListener('click', commitElement);
    _panel?.querySelector('#bte-ce-cancel')?.addEventListener('click', () => {
        _editingCeId = null; previewTheme(_draft); renderTab('elements');
    });

    // Pick target
    _panel?.querySelector('#bte-ce-pick-target')?.addEventListener('click', () => {
        toast(t('themes.pickTarget')||'Click any element in BMM to use it as target', 'info', 2500);
        startPickTarget((selector) => {
            const el = _panel?.querySelector('#bte-ce-target') as HTMLInputElement|null;
            if (el) { el.value = selector; el.dispatchEvent(new Event('input')); }
        });
    });

    // Edit / delete existing
    _panel?.querySelectorAll('.bte-ce-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            _editingCeId = (btn as HTMLElement).dataset.ceId!;
            renderTab('elements');
        });
    });
    _panel?.querySelectorAll('.bte-ce-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = (btn as HTMLElement).dataset.ceId!;
            if (!_draft.custom_elements) return;
            _draft.custom_elements = _draft.custom_elements.filter(c => c.id !== id);
            document.querySelectorAll(`[data-bmm-ce="${id}"]`).forEach(e => e.remove());
            previewTheme(_draft); renderTab('elements');
        });
    });

    // Ready-made templates → fill the HTML textarea
    _panel?.querySelectorAll('.bte-tpl-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const ta = _panel?.querySelector('#bte-ce-html') as HTMLTextAreaElement|null;
            if (!ta) return;
            const html = (chip as HTMLElement).dataset.tpl || '';
            ta.value = ta.value.trim() ? ta.value.trimEnd() + '\n' + html : html;
            ta.dispatchEvent(new Event('input'));
            ta.focus();
        });
    });

    // Deeplink snippets → insert into HTML textarea at the cursor
    _panel?.querySelectorAll('.bte-dl-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const ta = _panel?.querySelector('#bte-ce-html') as HTMLTextAreaElement|null;
            if (!ta) return;
            const snippet = (chip as HTMLElement).dataset.snippet || '';
            const decoded = snippet.replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            ta.setRangeText(decoded, ta.selectionStart, ta.selectionEnd, 'end');
            ta.dispatchEvent(new Event('input'));
            ta.focus();
        });
    });

    // Live preview while typing the element
    ['#bte-ce-html', '#bte-ce-css', '#bte-ce-target', '#bte-ce-pos', '#bte-ce-scope'].forEach(sel => {
        _panel?.querySelector(sel)?.addEventListener('input', livePreviewElement);
    });
}

/** Show the element being built live (temporary, not committed) so the user
 *  sees their custom element appear before clicking Add. */
function livePreviewElement(): void {
    const target = (_panel?.querySelector('#bte-ce-target') as HTMLInputElement)?.value.trim();
    const html   = (_panel?.querySelector('#bte-ce-html')   as HTMLTextAreaElement)?.value || '';
    if (!target || !html) { previewTheme(_draft); return; }
    const pos   = (_panel?.querySelector('#bte-ce-pos')   as HTMLSelectElement)?.value as CustomElement['position'];
    const scope = (_panel?.querySelector('#bte-ce-scope') as HTMLSelectElement)?.value || '';
    const css   = (_panel?.querySelector('#bte-ce-css')   as HTMLTextAreaElement)?.value || '';
    const preview = { ..._draft, custom_elements: [
        ...(_draft.custom_elements || []).filter(c => c.id !== _editingCeId),
        { id: _editingCeId || '__ce_preview__', target, position: pos, scope, html, css },
    ] };
    previewTheme(preview);
}

function commitElement(): void {
    const target   = (_panel?.querySelector('#bte-ce-target') as HTMLInputElement)?.value.trim();
    const pos      = (_panel?.querySelector('#bte-ce-pos')    as HTMLSelectElement)?.value as CustomElement['position'];
    const scope    = (_panel?.querySelector('#bte-ce-scope')  as HTMLSelectElement)?.value || '';
    const html     = (_panel?.querySelector('#bte-ce-html')   as HTMLTextAreaElement)?.value || '';
    const css      = (_panel?.querySelector('#bte-ce-css')    as HTMLTextAreaElement)?.value || '';
    if (!target) { toast(t('themes.ceNeedsTarget')||'Enter a target selector', 'warning'); return; }

    if (!_draft.custom_elements) _draft.custom_elements = [];
    if (_editingCeId) {
        const idx = _draft.custom_elements.findIndex(c => c.id === _editingCeId);
        if (idx >= 0) _draft.custom_elements[idx] = { id: _editingCeId, target, position: pos, scope, html, css };
    } else {
        const id = `ce-${Date.now()}`;
        _draft.custom_elements.push({ id, target, position: pos, scope, html, css });
    }
    _editingCeId = null;
    previewTheme(_draft);
    renderTab('elements');
    toast(t('themes.ceAdded')||'Element added', 'success', 1500);
}

// ═══════════════════════════════════════════════════════════════════
// ADVANCED TAB
// ═══════════════════════════════════════════════════════════════════
function buildAdvTab(): string {
    const pageOpts = [
        {id:'global', label:t('themes.advGlobal')||'Global (all pages)'}, ...PAGE_OPTIONS,
    ].map(p => `<option value="${p.id}"${p.id===_advPage?' selected':''}>${escHtml(p.label)}</option>`).join('');
    const css = _advPage==='global' ? (_draft.global_css||'') : (_draft.pages?.[_advPage]?.css||'');
    return `
        <div class="bte-adv-bar">
            <select id="bte-adv-page" class="bte-adv-sel">${pageOpts}</select>
            <span class="bte-adv-hint">${t('themes.advScoped')||'Scoped to selected page'}</span>
        </div>
        <p class="bte-adv-tip">${t('themes.advTip')||'Use'} <code>var(--bmm-*)</code> ${t('themes.advTip2')||'for theming-safe values. CSS is scoped to'} <code>#view-${_advPage==='global'?'…':_advPage}</code>.</p>
        <textarea id="bte-adv-css" class="bte-adv-textarea" style="flex:1;" placeholder="/* CSS */">${escHtml(css)}</textarea>`;
}

function wireAdv(): void {
    _panel?.querySelector('#bte-adv-page')?.addEventListener('change', e => {
        _advPage = (e.target as HTMLSelectElement).value; renderTab('advanced');
    });
    const ta = _panel?.querySelector('#bte-adv-css') as HTMLTextAreaElement|null;
    if (!ta) return;
    let deb: any;
    ta.addEventListener('input', () => {
        clearTimeout(deb);
        deb = setTimeout(() => {
            const val = ta.value;
            if (_advPage === 'global') {
                _draft.global_css = val;
            } else {
                if (!_draft.pages) _draft.pages = {};
                if (!_draft.pages[_advPage]) _draft.pages[_advPage] = {};
                _draft.pages[_advPage].css = val;
            }
            previewTheme(_draft); updateDirty();
        }, 200);
    });
}

// ═══════════════════════════════════════════════════════════════════
// INSTALLED TAB
// ═══════════════════════════════════════════════════════════════════
function buildInstalledTab(): string {
    const themes = getInstalledThemes();
    const active = getActiveTheme();
    const all = [...BUILTIN_THEMES, ...themes.filter(t => !BUILTIN_THEMES.some(b => b.id === t.id))];
    if (!all.length) return `<div class="bte-empty">${t('themes.noInstalled')||'No themes installed.'}</div>`;
    return `
        <div class="bte-installed-list">
            ${all.map(th => {
                const isActive = active?.id === th.id;
                const isBuiltin = BUILTIN_THEMES.some(b => b.id === th.id);
                return `<div class="bte-installed-item${isActive?' active':''}">
                    <div class="bte-installed-swatch" style="background:${th.vars?.['--bmm-bg-base']||'#0a0e17'};border-color:${th.mode==='light'?'rgba(0,0,0,0.18)':'rgba(255,255,255,0.18)'}">
                        <span class="bte-installed-dot" style="background:${th.vars?.['--bmm-accent']||'#3b82f6'}"></span>
                    </div>
                    <div class="bte-installed-info">
                        <div class="bte-installed-name">${escHtml(th.name)}${isBuiltin?`<span class="bte-builtin-tag">${t('themes.builtin')||'built-in'}</span>`:''}</div>
                        ${th.description ? `<div class="bte-installed-author">${escHtml(th.description)}</div>` : ''}
                    </div>
                    <div class="bte-installed-actions">
                        <button class="btn btn-xs${isActive?' btn-accent':' btn-ghost'} bte-activate" data-id="${th.id}">${isActive?`✓ ${t('themes.active')||'Active'}`:(t('themes.apply')||'Apply')}</button>
                        ${!isBuiltin?`<button class="btn btn-xs btn-ghost bte-export-theme" data-id="${th.id}">${t('themes.export')||'Export'}</button>`:''}
                        ${!isBuiltin
                            ? `<button class="btn btn-xs btn-danger bte-delete-theme" data-id="${th.id}">✕</button>`
                            : `<button class="btn btn-xs btn-ghost bte-hide-builtin" data-id="${th.id}" data-tooltip="${escAttr(t('themes.uninstall')||'Uninstall')}">${t('themes.uninstall')||'Uninstall'}</button>`}
                    </div>
                </div>`;
            }).join('')}
        </div>
        <div class="bte-install-bar">
            <button class="btn btn-sm btn-secondary" id="bte-open-catalog">${t('themes.catalogue')||'Browse catalogue'}</button>
        </div>`;
}

function wireInstalled(): void {
    _panel?.querySelectorAll('.bte-activate').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = (btn as HTMLElement).dataset.id!;
            const builtin = BUILTIN_THEMES.find(b => b.id === id);
            if (builtin) { applyTheme(builtin); localStorage.setItem('bmm_active_theme', id); }
            else await activateTheme(id);
            renderTab('installed');
        });
    });
    _panel?.querySelectorAll('.bte-export-theme').forEach(btn => {
        btn.addEventListener('click', () => exportTheme((btn as HTMLElement).dataset.id!));
    });
    _panel?.querySelectorAll('.bte-delete-theme').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!await bteConfirm(t('themes.confirmDelete')||'Remove this theme?', { danger: true, okLabel: t('common.delete')||'Delete' })) return;
            await deleteTheme((btn as HTMLElement).dataset.id!);
            renderTab('installed');
        });
    });
    // Built-in presets are HIDDEN, not deleted — re-enable them anytime from the
    // Theme Catalogue ("Reinstall"). This keeps the presets recoverable.
    _panel?.querySelectorAll('.bte-hide-builtin').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = (btn as HTMLElement).dataset.id!;
            if (!await bteConfirm(t('themes.confirmHideBuiltin')||'Hide this default theme? You can reinstall it from the Theme Catalogue.', { okLabel: t('themes.uninstall')||'Uninstall' })) return;
            try {
                await invoke('set_builtin_hidden', { themeId: id, hidden: true });
                const { loadBuiltinThemes } = await import('./theme-engine.js');
                await loadBuiltinThemes();
                toast(t('themes.uninstalled')||'Theme hidden', 'success');
            } catch (e) { toast(String(e), 'error'); }
            renderTab('installed');
        });
    });
    _panel?.querySelector('#bte-open-catalog')?.addEventListener('click', () => (window as any).openThemeCatalog?.());
}

// ═══════════════════════════════════════════════════════════════════
// SMART PICK — click element → highlight matching token in Simple tab
// ═══════════════════════════════════════════════════════════════════
// Selection uses RIGHT-click or MIDDLE-click so the user can still LEFT-click to
// navigate normally while picking. Esc cancels.
function togglePickToken(): void {
    if (_pickMode === 'token') { stopPick(); return; }
    stopPick();
    _pickMode = 'token';
    _panel?.querySelector('#bte-pick-token')?.classList.add('active');
    document.body.classList.add('bte-picking');
    document.addEventListener('mouseover', onPickHover, true);
    document.addEventListener('contextmenu', onPickTokenClick, true);
    document.addEventListener('auxclick', onPickTokenClick, true);
    showPickHint('token');
    document.addEventListener('keydown', onPickEsc, true);
    toast(t('themes.pickOn')||'Right-click (or middle-click) any element to edit it. Esc to cancel.', 'info', 3500);
}

function startPickTarget(cb: (selector: string) => void): void {
    stopPick();
    _pickMode = 'target';
    _pickTargetCb = cb;
    document.body.classList.add('bte-picking');
    document.addEventListener('mouseover', onPickHover, true);
    document.addEventListener('contextmenu', onPickTargetClick, true);
    document.addEventListener('auxclick', onPickTargetClick, true);
    showPickHint('target');
    document.addEventListener('keydown', onPickEsc, true);
}

function onPickEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopPick(); }
}

/** The on-screen pick hint.
 *
 *  Selection is right-click / middle-click ON PURPOSE — left-click has to keep
 *  working so the app stays usable while you hunt for an element. But nothing said
 *  so, so the picker read as broken. It also carries the way into the precise
 *  editor, which used to appear only when no token could be guessed. */
function showPickHint(kind: 'token' | 'target'): void {
    document.getElementById('bte-pick-hint')?.remove();
    const hint = document.createElement('div');
    hint.id = 'bte-pick-hint';
    hint.className = 'bte-pick-hint';
    hint.innerHTML = `
        <span class="bte-pick-hint-key">${t('themes.pickRight') || 'Clic droit'}</span>
        <span class="bte-pick-hint-or">${t('common.or') || 'ou'}</span>
        <span class="bte-pick-hint-key">${t('themes.pickMiddle') || 'clic molette'}</span>
        <span class="bte-pick-hint-txt">${kind === 'token'
            ? (t('themes.pickHintToken') || 'sur un élément pour trouver son token')
            : (t('themes.pickHintTarget') || 'sur un élément pour le cibler')}</span>
        ${kind === 'token' ? `<span class="bte-pick-hint-alt">${t('themes.pickHintShift') || 'Maj + clic droit : éditer cet élément précisément'}</span>` : ''}
        <span class="bte-pick-hint-esc">Échap</span>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(hint);
}

/** Show me what this token actually paints.
 *
 *  Field ask: "qu'on puisse cliquer sur un des trucs dans le theme editor et que ça
 *  nous l'affiche en clair". A token name means nothing until you see the pixels it
 *  owns, so clicking a row's label flashes every live element currently painted
 *  with that value.
 *
 *  Matching is by COMPUTED VALUE, not by rule: a var can be consumed through any
 *  number of intermediate custom properties, and only the resolved colour is
 *  reliably comparable. The walk is capped and reads only the properties the token
 *  could plausibly drive, so it stays a click and not a freeze. */
function revealToken(tokenKey: string): void {
    const want = getComputedStyle(document.documentElement).getPropertyValue(tokenKey).trim();
    if (!want) { toast(t('themes.revealNone') || 'Nothing on screen uses this yet', 'info', 1800); return; }
    const probe = document.createElement('span');
    probe.style.color = want;
    document.body.appendChild(probe);
    const target = getComputedStyle(probe).color;
    probe.remove();

    document.querySelectorAll('.bte-reveal-flash').forEach(e => e.classList.remove('bte-reveal-flash'));
    const PROPS = ['backgroundColor', 'color', 'borderTopColor', 'borderLeftColor', 'outlineColor'] as const;
    const all = document.querySelectorAll<HTMLElement>('.app-shell *');
    let hits = 0;
    for (let i = 0; i < all.length && i < 4000 && hits < 60; i++) {
        const el = all[i];
        if (el.closest('#bmm-theme-editor, #bte-elov')) continue;   // not the tool itself
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;                  // invisible: nothing to show
        const cs = getComputedStyle(el);
        for (const prop of PROPS) {
            if (cs[prop] === target) { el.classList.add('bte-reveal-flash'); hits++; break; }
        }
    }
    if (!hits) { toast(t('themes.revealNone') || 'Nothing on screen uses this yet', 'info', 1800); return; }
    const first = document.querySelector('.bte-reveal-flash') as HTMLElement | null;
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast(`${hits} ${t('themes.revealHits') || 'element(s) painted by this token'}`, 'info', 2200);
    setTimeout(() => document.querySelectorAll('.bte-reveal-flash').forEach(e => e.classList.remove('bte-reveal-flash')), 2600);
}

function stopPick(): void {
    document.getElementById('bte-pick-hint')?.remove();
    _pickMode = null;
    _pickTargetCb = null;
    document.body.classList.remove('bte-picking');
    document.removeEventListener('mouseover', onPickHover, true);
    document.removeEventListener('contextmenu', onPickTokenClick, true);
    document.removeEventListener('contextmenu', onPickTargetClick, true);
    document.removeEventListener('auxclick', onPickTokenClick, true);
    document.removeEventListener('auxclick', onPickTargetClick, true);
    document.removeEventListener('keydown', onPickEsc, true);
    document.querySelectorAll('.bte-pick-highlight').forEach(e => e.classList.remove('bte-pick-highlight'));
    _panel?.querySelector('#bte-pick-token')?.classList.remove('active');
}

/** True only for the selection gesture: right-click (contextmenu) or
 *  middle-click (auxclick button 1). Ignores left/other auxclicks.            */
function isPickGesture(e: MouseEvent): boolean {
    if (e.type === 'contextmenu') return true;
    if (e.type === 'auxclick' && e.button === 1) return true;
    return false;
}

/** Elements that must stay interactive during a pick (the picker's own UI). */
function isPickExcluded(el: HTMLElement | null): boolean {
    return !!el?.closest?.('#bte-elov, #bte-confirm');
}

function onPickHover(e: MouseEvent): void {
    const tgt = e.target as HTMLElement;
    if (isPickExcluded(tgt)) return;
    document.querySelectorAll('.bte-pick-highlight').forEach(e => e.classList.remove('bte-pick-highlight'));
    tgt?.classList.add('bte-pick-highlight');
}

function onPickTokenClick(e: MouseEvent): void {
    if (!isPickGesture(e)) return;
    const _t = e.target as HTMLElement;
    if (isPickExcluded(_t)) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.target as HTMLElement;
    const cs = getComputedStyle(el);
    // Guess which token to highlight based on computed colour
    let guessedToken: string|null = null;
    for (const prop of ['backgroundColor', 'color', 'borderColor']) {
        const col = cs[prop as keyof CSSStyleDeclaration] as string;
        guessedToken = computedColorToToken(col);
        if (guessedToken) break;
    }
    const wantsPrecise = e.shiftKey;
    stopPick();
    // The precise editor used to be reachable ONLY when no token could be guessed,
    // so on any element the guesser recognised it looked like it had disappeared.
    // Shift is the explicit way in, and it always works.
    if (!guessedToken || wantsPrecise) {
        openElementOverrideEditor(el);
        return;
    }
    // Switch to simple tab
    _tab = 'simple';
    _panel?.querySelectorAll('.bte-tab').forEach(t => t.classList.toggle('active', (t as HTMLElement).dataset.bteTab === 'simple'));
    renderTab('simple');
    // Scroll to matching token row + flash it
    if (guessedToken) {
        const row = _panel?.querySelector(`.bte-token-row:has([data-var="${CSS.escape(guessedToken)}"])`) as HTMLElement|null;
        if (row) {
            row.scrollIntoView({ block: 'center', behavior: 'smooth' });
            row.classList.add('bte-token-highlight');
            setTimeout(() => row.classList.remove('bte-token-highlight'), 1400);
        }
        toast(`${t('themes.pickHint')||'Token'}: ${guessedToken}`, 'info', 2000);
    } else {
        toast(t('themes.pickNoToken')||'No specific token found — check Background / Text groups', 'info', 2000);
    }
}

/** Build a stable-ish CSS selector from id, nearest view, or class chain. */
function buildSelectorFor(el: HTMLElement): string {
    if (el.id) return `#${el.id}`;
    // Build a precise path: from the element up to the nearest id/view ancestor,
    // using meaningful classes or :nth-of-type so the EXACT element is targeted.
    const seg = (node: HTMLElement): string => {
        let s = node.tagName.toLowerCase();
        const cls = Array.from(node.classList)
            .filter(c => !c.startsWith('bmm-') && c !== 'bte-pick-highlight' && c !== 'active' && c !== 'bte-picking');
        if (cls.length) return s + '.' + cls.slice(0, 2).map(c => CSS.escape(c)).join('.');
        const parent = node.parentElement;
        if (parent) {
            const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
            if (sameTag.length > 1) s += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
        return s;
    };
    const parts: string[] = [];
    let cur: HTMLElement | null = el;
    let root = '';
    let depth = 0;
    while (cur && cur !== document.body && depth < 5) {
        if (cur.id) { root = `#${cur.id} `; break; }
        parts.unshift(seg(cur));
        if (cur.id?.startsWith('view-')) { root = ''; break; }
        cur = cur.parentElement;
        depth++;
        if (cur && cur.id) { root = `#${cur.id} `; break; }
    }
    const built = (root + parts.join(' > ')).trim();
    // Verify it resolves to the same element; fall back to a simpler selector.
    try { if (document.querySelector(built) === el) return built; } catch {}
    const view = el.closest('[id^="view-"]') as HTMLElement|null;
    return (view ? `#${view.id} ` : '') + el.tagName.toLowerCase();
}

function onPickTargetClick(e: MouseEvent): void {
    if (!isPickGesture(e)) return;
    const _t = e.target as HTMLElement;
    if (isPickExcluded(_t)) return;
    e.preventDefault(); e.stopPropagation();
    const selector = buildSelectorFor(e.target as HTMLElement);
    const cb = _pickTargetCb;     // capture BEFORE stopPick() nulls it
    stopPick();
    cb?.(selector);
}

/** Convert an rgb()/rgba() computed colour to #rrggbb for <input type=color>. */
function rgbToHex(col: string): string {
    const m = col.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return '#000000';
    return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

/** Serialize an override's props to a CSS declaration block. */
function propsToCss(props: Record<string, string>): string {
    return Object.entries(props).map(([k, v]) => `${k}: ${v};`).join('\n');
}
/** Parse a CSS declaration block ("prop: value;" lines) back into a props map. */
function cssToProps(css: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const decl of css.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const k = decl.slice(0, i).trim();
        const v = decl.slice(i + 1).trim();
        if (k && v) out[k] = v;
    }
    return out;
}

/** Best hex for a colour <input>: the override value if any, else computed. */
function colorInputHex(propVal: string | undefined, computed: string): string {
    const v = (propVal || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map(c => c + c).join('');
    if (/\d+,\s*\d+,\s*\d+/.test(v)) return rgbToHex(v);
    return rgbToHex(computed);
}

/** Floating per-element editor: edit ANY CSS of any element via an
 *  element_override — including its :hover and :active states — through quick
 *  colour pickers and a free-form CSS box. Writes into _draft.element_overrides. */
function openElementOverrideEditor(el: HTMLElement, forcedSel?: string): void {
    stopPick();                               // guarantee pick mode is fully off
    document.getElementById('bte-elov')?.remove();
    // When targeting by selector (modal picker) the element may not be mounted yet —
    // fall back to <body> just for reading computed colours.
    if (forcedSel && (!el || el === document.body)) {
        el = (document.querySelector(forcedSel) as HTMLElement) || document.body;
    }
    const cs = getComputedStyle(el);
    if (!_draft.element_overrides) _draft.element_overrides = [];

    let base = forcedSel || buildSelectorFor(el);
    let state = '';                            // '' | ':hover' | ':active'
    let ov!: ElementOverride;

    const bindOv = () => {
        // _draft may have been replaced (Discard / Revert all) while the popup is
        // open — always re-ensure the array exists before dereferencing it.
        if (!_draft.element_overrides) _draft.element_overrides = [];
        const sel = base + state;
        ov = _draft.element_overrides.find(o => o.selector === sel)
          || (_draft.element_overrides.push({ selector: sel, props: {} }),
              _draft.element_overrides[_draft.element_overrides.length - 1]);
    };
    bindOv();

    const STATES: [string, string][] = [
        ['',        t('themes.stateNormal')||'Normal'],
        [':hover',  t('themes.stateHover')||'Hover'],
        [':active', t('themes.stateActive')||'Active'],
    ];

    const pop = document.createElement('div');
    pop.id = 'bte-elov';
    pop.className = 'bte-elov';
    const row = (label: string, prop: string) => `
        <label class="bte-elov-row">
            <span>${label}</span>
            <input type="color" data-prop="${prop}" value="#000000">
            <button class="bte-elov-clear" data-prop="${prop}" data-tooltip="${t('themes.clear')||'Clear'}">✕</button>
        </label>`;
    pop.innerHTML = `
        <div class="bte-elov-head">
            <span class="bte-elov-grip" data-tooltip="${t('themes.dragMove')||'Drag to move'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>
            <strong>${ICON.eyedropper(14)} ${t('themes.overrideElement')||'Edit this element'}</strong>
            <button class="bte-elov-close" data-tooltip="${t('common.close')||'Close'}">${ICON.close(13)}</button>
        </div>
        <div class="bte-elov-body">
            <label class="bte-elov-sellabel">${t('themes.selector')||'Selector'}
                <input class="bte-elov-selinput" type="text" value="${escAttr(base)}" spellcheck="false">
            </label>
            <div class="bte-elov-states">
                ${STATES.map(([s, lbl]) => `<button class="bte-elov-state${s===state?' active':''}" data-state="${s}">${escHtml(lbl)}</button>`).join('')}
            </div>
            <p class="bte-elov-statehint">${t('themes.stateHoverHint')||'Edit how the element looks on hover / when clicked.'}</p>
            ${row(t('themes.text')||'Text', 'color')}
            ${row(t('themes.background')||'Background', 'background-color')}
            ${row(t('themes.border')||'Border', 'border-color')}
            <div class="bte-elov-gradient">
                <span class="bte-elov-grad-label">${t('themes.gradient')||'Gradient'}</span>
                <input type="color" class="bte-grad-c1" value="#3b82f6" data-tooltip="${t('themes.gradColor1')||'Start colour'}">
                <input type="color" class="bte-grad-c2" value="#8b5cf6" data-tooltip="${t('themes.gradColor2')||'End colour'}">
                <select class="bte-grad-dir" data-tooltip="${t('themes.gradDirection')||'Direction'}">
                    <option value="135deg">↘</option>
                    <option value="90deg">→</option>
                    <option value="180deg">↓</option>
                    <option value="45deg">↗</option>
                    <option value="0deg">↑</option>
                    <option value="circle">◉</option>
                </select>
                <button class="btn btn-secondary btn-xs bte-grad-apply">${t('themes.applyGradient')||'Apply'}</button>
                <button class="btn btn-ghost btn-xs bte-grad-clear" data-tooltip="${t('themes.clear')||'Clear'}">✕</button>
            </div>
            <div class="bte-elov-imgrow">
                <button class="btn btn-secondary btn-xs bte-elov-img">${t('themes.replaceImage')||'Set / replace image'}</button>
                <button class="btn btn-ghost btn-xs bte-elov-img-clear" data-tooltip="${t('themes.clear')||'Clear'}">✕</button>
            </div>
            <label class="bte-elov-csslabel">${t('themes.replaceIcon')||'Replace icon (paste SVG)'}</label>
            <textarea class="bte-elov-svg" spellcheck="false" placeholder='<svg viewBox="0 0 24 24" ...>…</svg>'></textarea>
            <label class="bte-elov-csslabel">${t('themes.customCss')||'Custom CSS (any property)'}</label>
            <textarea class="bte-elov-css" spellcheck="false" placeholder="border-radius: 12px;&#10;padding: 8px 14px;&#10;box-shadow: 0 4px 20px #000;&#10;font-size: 15px;"></textarea>
            <p class="bte-elov-hint">${t('themes.overrideHint')||'Affects every element matching this selector. Live preview.'}</p>
        </div>`;
    document.body.appendChild(pop);

    // Spawn fully inside the viewport so the drag grip / header is ALWAYS reachable
    // (previously a short window pushed `top` negative → header off-screen). Cap the
    // height to the viewport first, then measure the real popup box and clamp both
    // axes; prefer placing below the picked element, flip above if it would overflow.
    const M = 8;
    pop.style.maxHeight = `calc(100vh - ${M * 2}px)`;
    pop.style.overflowY = 'auto';
    const r  = el.getBoundingClientRect();
    const pw = pop.offsetWidth  || 320;
    const ph = pop.offsetHeight || 440;
    let left = r.left;
    let top  = r.bottom + M;
    if (top + ph > window.innerHeight - M) {
        // not enough room below → try above the element, else just clamp
        const above = r.top - ph - M;
        top = above >= M ? above : top;
    }
    left = Math.max(M, Math.min(left, window.innerWidth  - pw - M));
    top  = Math.max(M, Math.min(top,  window.innerHeight - ph - M));
    pop.style.left = left + 'px';
    pop.style.top  = top + 'px';

    const cssBox = pop.querySelector('.bte-elov-css') as HTMLTextAreaElement;
    const stateHint = pop.querySelector('.bte-elov-statehint') as HTMLElement;
    const cleanupEmpty = () => {
        _draft.element_overrides = (_draft.element_overrides || []).filter(o => Object.keys(o.props).length > 0);
    };
    const refresh = () => {
        cssBox.value = propsToCss(ov.props);
        pop.querySelectorAll('input[type=color][data-prop]').forEach(inp => {
            const prop = (inp as HTMLElement).dataset.prop!;
            const computed = prop === 'color' ? cs.color : prop === 'background-color' ? cs.backgroundColor : cs.borderColor;
            (inp as HTMLInputElement).value = colorInputHex(ov.props[prop], computed);
        });
        stateHint.style.display = state ? 'block' : 'none';
    };
    refresh();

    // Quick colour pickers → write a single prop, keep the CSS box in sync.
    // (Scoped to [data-prop] so the gradient builder's colour inputs are excluded.)
    pop.querySelectorAll('input[type=color][data-prop]').forEach(inp => {
        inp.addEventListener('input', () => {
            ov.props[(inp as HTMLElement).dataset.prop!] = (inp as HTMLInputElement).value;
            cssBox.value = propsToCss(ov.props); previewTheme(_draft); updateDirty();
        });
    });

    // Gradient builder → writes a `background` prop (linear or radial).
    const gradApply = pop.querySelector('.bte-grad-apply');
    gradApply?.addEventListener('click', () => {
        const c1 = (pop.querySelector('.bte-grad-c1') as HTMLInputElement)?.value || '#3b82f6';
        const c2 = (pop.querySelector('.bte-grad-c2') as HTMLInputElement)?.value || '#8b5cf6';
        const dir = (pop.querySelector('.bte-grad-dir') as HTMLSelectElement)?.value || '135deg';
        const grad = dir === 'circle'
            ? `radial-gradient(circle, ${c1}, ${c2})`
            : `linear-gradient(${dir}, ${c1}, ${c2})`;
        ov.props['background'] = grad;
        cssBox.value = propsToCss(ov.props); previewTheme(_draft); updateDirty();
    });
    pop.querySelector('.bte-grad-clear')?.addEventListener('click', () => {
        delete ov.props['background'];
        cssBox.value = propsToCss(ov.props); previewTheme(_draft); updateDirty();
    });
    pop.querySelectorAll('.bte-elov-clear').forEach(btn => {
        btn.addEventListener('click', () => {
            delete ov.props[(btn as HTMLElement).dataset.prop!];
            refresh(); previewTheme(_draft); updateDirty();
        });
    });

    // Free-form CSS box is the full source of truth for the current state's props.
    cssBox.addEventListener('input', () => {
        ov.props = cssToProps(cssBox.value);
        if (!_draft.element_overrides) _draft.element_overrides = [];
        if (!_draft.element_overrides.includes(ov)) _draft.element_overrides.push(ov);
        previewTheme(_draft); updateDirty();
    });

    // Set / replace image: embeds a picked image as a background on the element
    // (works to swap an icon or drop an image anywhere). Hides child SVG so an
    // icon is fully replaced.
    pop.querySelector('.bte-elov-img')?.addEventListener('click', () => {
        readImageFile((dataUri) => {
            ov.props['background-image'] = `url("${dataUri}")`;
            ov.props['background-size'] = 'contain';
            ov.props['background-repeat'] = 'no-repeat';
            ov.props['background-position'] = 'center';
            refresh(); previewTheme(_draft); updateDirty();
            toast(t('themes.assetSet')||'Image applied', 'success', 1500);
        });
    });
    pop.querySelector('.bte-elov-img-clear')?.addEventListener('click', () => {
        ['background-image', 'background-size', 'background-repeat', 'background-position'].forEach(p => delete ov.props[p]);
        refresh(); previewTheme(_draft); updateDirty();
    });

    // Replace content (paste SVG) — stored as an html_swap on the base selector.
    const svgBox = pop.querySelector('.bte-elov-svg') as HTMLTextAreaElement;
    svgBox.value = (_draft.html_swaps || []).find(s => s.selector === base)?.html || '';
    svgBox.addEventListener('input', () => {
        if (!_draft.html_swaps) _draft.html_swaps = [];
        const html = svgBox.value.trim();
        const existing = _draft.html_swaps.find(s => s.selector === base);
        if (!html) {
            _draft.html_swaps = _draft.html_swaps.filter(s => s.selector !== base);
        } else if (existing) {
            existing.html = html;
        } else {
            _draft.html_swaps.push({ selector: base, html });
        }
        previewTheme(_draft); updateDirty();
    });

    // State tabs (Normal / Hover / Active)
    pop.querySelectorAll('.bte-elov-state').forEach(btn => {
        btn.addEventListener('click', () => {
            state = (btn as HTMLElement).dataset.state!;
            pop.querySelectorAll('.bte-elov-state').forEach(b => b.classList.toggle('active', b === btn));
            bindOv(); refresh();
        });
    });

    // Editable base selector — retarget ALL states of this element at once.
    const selInput = pop.querySelector('.bte-elov-selinput') as HTMLInputElement;
    selInput.addEventListener('change', () => {
        const next = selInput.value.trim();
        if (!next) return;
        // Rename every override that belongs to the old base (normal + states).
        for (const o of (_draft.element_overrides || [])) {
            if (o.selector === base) o.selector = next;
            else if (o.selector.startsWith(base + ':')) o.selector = next + o.selector.slice(base.length);
        }
        base = next; bindOv(); previewTheme(_draft); updateDirty();
    });

    pop.querySelector('.bte-elov-close')?.addEventListener('click', () => { cleanupEmpty(); pop.remove(); });

    // Draggable by its header so it can never get stuck off-screen / under the panel.
    const head = pop.querySelector('.bte-elov-head') as HTMLElement;
    head.style.cursor = 'move';
    head.addEventListener('mousedown', (md: MouseEvent) => {
        if ((md.target as HTMLElement).closest('.bte-elov-close')) return;
        md.preventDefault();
        const sx = md.clientX, sy = md.clientY;
        const ox = pop.offsetLeft, oy = pop.offsetTop;
        const move = (mm: MouseEvent) => {
            pop.style.left = Math.max(0, Math.min(ox + mm.clientX - sx, window.innerWidth - pop.offsetWidth)) + 'px';
            pop.style.top  = Math.max(0, Math.min(oy + mm.clientY - sy, window.innerHeight - 40)) + 'px';
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
}

// ═══════════════════════════════════════════════════════════════════
// SAVE / EXPORT / IMPORT / RESET
// ═══════════════════════════════════════════════════════════════════
/** In-app text prompt (native prompt() is unreliable in the Tauri webview). */
function btePrompt(message: string, def = ''): Promise<string|null> {
    return new Promise(resolve => {
        document.getElementById('bte-confirm')?.remove();
        const ov = document.createElement('div');
        ov.id = 'bte-confirm';
        ov.className = 'bte-confirm-overlay';
        ov.innerHTML = `
            <div class="bte-confirm-box">
                <p class="bte-confirm-msg">${escHtml(message)}</p>
                <input class="bte-confirm-input" type="text" value="${escAttr(def)}" spellcheck="false">
                <div class="bte-confirm-actions">
                    <button class="btn btn-ghost btn-sm" data-act="no">${t('common.cancel')||'Cancel'}</button>
                    <button class="btn btn-accent btn-sm" data-act="yes">${t('common.ok')||'OK'}</button>
                </div>
            </div>`;
        (document.getElementById('app-window-outer') || document.body).appendChild(ov);
        const inp = ov.querySelector('.bte-confirm-input') as HTMLInputElement;
        const done = (val: string|null) => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(val); };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); done(null); }
            if (e.key === 'Enter')  { e.preventDefault(); done(inp.value); }
        };
        document.addEventListener('keydown', onKey, true);
        ov.querySelector('[data-act=no]')!.addEventListener('click', () => done(null));
        ov.querySelector('[data-act=yes]')!.addEventListener('click', () => done(inp.value));
        ov.addEventListener('mousedown', e => { if (e.target === ov) done(null); });
        inp.focus(); inp.select();
    });
}

function _slugId(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme';
    return `${base}-${Date.now().toString(36).slice(-4)}`;
}

/** Save: update the current USER theme in place; for built-ins or fresh drafts,
 *  fall through to "Save as new" so built-ins are never overwritten.          */
async function saveTheme(): Promise<void> {
    const cur = getActiveTheme();
    const isBuiltin = !!cur && BUILTIN_THEMES.some(b => b.id === cur.id);
    if (!cur || cur.id === '__preview__' || isBuiltin) { await saveThemeAs(); return; }
    // _draft spread FIRST, then pin identity so it can't be overridden.
    const theme: BmmTheme = { ...(_draft as any), id: cur.id, name: cur.name, author: cur.author || 'You', version: cur.version || '1.0.0' };
    await installTheme(theme);
    applyTheme(theme);
    toast(`${t('themes.saved')||'Saved'}: ${cur.name}`, 'success');
    updateDirty();
    renderTab('installed');
}

/** Always create a NEW theme (lets you keep many themes side by side). */
async function saveThemeAs(): Promise<void> {
    const cur = getActiveTheme();
    const isBuiltin = !!cur && BUILTIN_THEMES.some(b => b.id === cur.id);
    const def = (cur && cur.name && cur.name !== 'Preview')
        ? (isBuiltin ? `${cur.name} (copy)` : cur.name)
        : 'My Theme';
    const entered = await btePrompt(t('themes.enterName')||'Theme name:', def);
    if (entered === null) return;
    const finalName = (entered || 'My Theme').trim();
    const theme: BmmTheme = { ...(_draft as any), id: _slugId(finalName), name: finalName, author: 'You', version: '1.0.0' };
    await installTheme(theme);
    applyTheme(theme);
    toast(`${t('themes.saved')||'Saved'}: ${finalName}`, 'success');
    updateDirty();
    renderTab('installed');
}

async function doExport(): Promise<void> {
    const a = getActiveTheme();
    if (!a || a.id === '__preview__') { toast(t('themes.saveFirst')||'Save first', 'warning'); return; }
    await exportTheme(a.id);
}

/** Generate a shareable deeplink — anyone can click it to install the theme.
 *  Since we can't host files directly, we encode the theme JSON as a gzipped
 *  base64 blob in a data-URI-style scheme and let the receiver decode it.
 *  For small themes this fits in a URL; for larger ones we show the export flow. */
export async function shareTheme(): Promise<void> {
    const a = getActiveTheme();
    if (!a || a.id === '__preview__') { toast(t('themes.saveFirst')||'Save first', 'warning'); return; }
    try {
        const json = JSON.stringify({ id: a.id, name: a.name, author: a.author,
            vars: a.vars, global_css: a.global_css, pages: a.pages,
            element_overrides: a.element_overrides, custom_elements: a.custom_elements });
        const encoded = btoa(unescape(encodeURIComponent(json)));
        if (encoded.length > 8000) {
            // Too large for a URL — fall back to file export
            toast(t('themes.shareTooLarge')||'Theme too large for a URL — exporting as file instead', 'info', 3000);
            await exportTheme(a.id);
            return;
        }
        const deeplink = `bmm://theme/import-inline?data=${encoded}`;
        await navigator.clipboard.writeText(deeplink);
        toast(t('themes.shareCopied')||'Share link copied! Anyone can paste it in BMM → Deeplink', 'success', 4000);
    } catch (e) { toast(String(e), 'error'); }
}

async function importFile(): Promise<void> {
    const { pickFile } = await import('../../core/api.js');
    const path = await pickFile([
        { name: 'BMM Theme (.bmmtheme / .json)', extensions: ['bmmtheme', 'zip', 'json'] },
        { name: 'All files', extensions: ['*'] },
    ]);
    if (!path) return;
    try {
        const { invoke } = await import('../../core/api.js');
        const raw: string = await invoke('import_theme', { path });
        const theme = JSON.parse(raw);
        await installTheme(theme);
        toast(`${t('themes.imported')||'Imported'}: ${theme.name}`, 'success');
        renderTab('installed');
    } catch (e) { toast(String(e), 'error'); }
}

/** In-app confirm dialog. The native window.confirm() does NOT block reliably
 *  in the Tauri webview (it returns immediately), so actions ran without waiting.
 *  This promise-based dialog actually waits for the user's choice.            */
function bteConfirm(message: string, opts: { danger?: boolean; okLabel?: string } = {}): Promise<boolean> {
    return new Promise(resolve => {
        document.getElementById('bte-confirm')?.remove();
        const ov = document.createElement('div');
        ov.id = 'bte-confirm';
        ov.className = 'bte-confirm-overlay';
        ov.innerHTML = `
            <div class="bte-confirm-box">
                <p class="bte-confirm-msg">${escHtml(message)}</p>
                <div class="bte-confirm-actions">
                    <button class="btn btn-ghost btn-sm" data-act="no">${t('common.cancel')||'Cancel'}</button>
                    <button class="btn ${opts.danger ? 'btn-danger' : 'btn-accent'} btn-sm" data-act="yes">${opts.okLabel || t('common.confirm') || 'Confirm'}</button>
                </div>
            </div>`;
        (document.getElementById('app-window-outer') || document.body).appendChild(ov);
        const done = (val: boolean) => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(val); };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); done(false); }
            if (e.key === 'Enter')  { e.preventDefault(); done(true); }
        };
        document.addEventListener('keydown', onKey, true);
        ov.querySelector('[data-act=no]')!.addEventListener('click', () => done(false));
        ov.querySelector('[data-act=yes]')!.addEventListener('click', () => done(true));
        ov.addEventListener('mousedown', e => { if (e.target === ov) done(false); });
        (ov.querySelector('[data-act=yes]') as HTMLElement).focus();
    });
}

async function confirmReset(): Promise<void> {
    if (!await bteConfirm(t('themes.confirmReset')||'Reset to BMM default? Your unsaved changes will be lost.', { danger: true, okLabel: t('common.reset')||'Reset' })) return;
    _draft = { custom_elements: [] };
    resetTheme(); renderTab(_tab); updateDirty();
}

function updateDirty(): void {
    const n = Object.keys(_draft.vars||{}).length +
              (_draft.global_css ? 1 : 0) +
              Object.keys(_draft.pages||{}).length +
              (_draft.custom_elements?.length || 0);
    const el = document.getElementById('bte-dirty');
    if (el) el.textContent = n ? `${n} ${t('themes.unsaved')||'unsaved change(s)'}` : '';
}

// ═══════════════════════════════════════════════════════════════════
// DRAG / RESIZE / GEOMETRY
// ═══════════════════════════════════════════════════════════════════
function applyGeom(): void {
    if (!_panel) return;
    let g: any = {};
    try { g = JSON.parse(localStorage.getItem(OVL_KEY)||'{}'); } catch {}
    const w = Math.max(MIN_W, Math.min(Number(g.width) || 440, innerWidth - 20));
    const h = Math.max(MIN_H, Math.min(Number(g.height) || 580, innerHeight - 20));
    const l = Math.max(0, Math.min(Number.isFinite(g.left) ? g.left : innerWidth - w - 20, innerWidth - w));
    const top = Math.max(0, Math.min(Number.isFinite(g.top) ? g.top : 60, innerHeight - 60));
    Object.assign(_panel.style, {
        position:'fixed', left:`${l}px`, top:`${top}px`,
        width:`${w}px`, height:`${h}px`,
        minWidth:`${MIN_W}px`, minHeight:`${MIN_H}px`,
        zIndex:'999998', resize:'both', overflow:'hidden',
        display:'none',
    });
}

function saveGeom(): void {
    if (!_panel) return;
    // Docked size is the dock's own preference — never let it overwrite the
    // float geometry (the ResizeObserver fires for dock width drags too).
    if (_bteDocked()) return;
    const r = _panel.getBoundingClientRect();
    localStorage.setItem(OVL_KEY, JSON.stringify({ left:r.left, top:r.top, width:r.width, height:r.height }));
}

function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
    if (!handle || (handle as any)._bteDrag) return;
    (handle as any)._bteDrag = true;
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if (_bteDocked()) return;                    // a dock does not drag
        if ((e.target as HTMLElement).closest('button,input,select,textarea')) return;
        e.preventDefault();
        const r = panel.getBoundingClientRect();
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        // Clamp against the actual containing block. The panel lives in
        // #app-window-outer which (transparent, decoration-less window) can carry
        // a transform — so window.innerHeight is the wrong reference and let the
        // panel slide fully off the bottom. Use the offset parent's rect and always
        // keep the header (~HDR px) on screen so it stays grabbable.
        const cb = (panel.offsetParent as HTMLElement) || document.documentElement;
        const HDR = 52, KEEPX = 140;
        const move = (ev: MouseEvent) => {
            const pr = cb.getBoundingClientRect();
            const left = ev.clientX - ox - pr.left;
            const top  = ev.clientY - oy - pr.top;
            panel.style.left = `${Math.max(0, Math.min(pr.width  - KEEPX, left))}px`;
            panel.style.top  = `${Math.max(0, Math.min(pr.height - HDR,  top))}px`;
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveGeom(); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
}
