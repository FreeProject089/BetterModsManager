// @ts-nocheck
// ── BMM Theme Editor ──────────────────────────────────────────────────────────
// Floating drag+resize panel. Four tabs:
//   Simple   → colour/font/size token editor + presets
//   Elements → add custom HTML/CSS elements anywhere in BMM
//   Advanced → full CSS per page
//   Installed→ manage + import + export themes

import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml, escAttr } from '../../core/utils.js';
import {
    applyTheme, previewTheme, resetTheme, getActiveTheme,
    installTheme, exportTheme, getInstalledThemes,
    activateTheme, deleteTheme, BUILTIN_THEMES,
} from './theme-engine.js';
import type { BmmTheme, CustomElement } from './theme-engine.js';

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
    { key:'--bmm-bg-sidebar',    label:'Sidebar',           type:'color', group:'Background', desc:'Background of the left navigation sidebar.', mdn:'background-color' },
    { key:'--bmm-bg-titlebar',   label:'Title bar',         type:'color', group:'Background', desc:'Top window bar colour (where the logo & window buttons are).', mdn:'background-color' },
    { key:'--bmm-titlebar-bg',   label:'Title bar (exact)', type:'color', group:'Background', desc:'Exact title-bar background (supports rgba for transparency).', mdn:'background' },
    { key:'--bmm-loader-bg',     label:'Boot screen',       type:'color', group:'Background', desc:'Background of the startup loading screen.', mdn:'background-color' },
    { key:'--bmm-app-bg-image',  label:'Wallpaper',         type:'image', group:'Background', desc:'A full-app background image (wallpaper). Pick or paste a URL.', mdn:'background-image' },
    { key:'--bmm-app-bg-blur',   label:'Wallpaper blur',    type:'size',  group:'Background', desc:'Blur applied to the wallpaper, e.g. 8px.', mdn:'filter' },
    { key:'--bmm-app-bg-opacity',label:'Wallpaper opacity', type:'size',  group:'Background', desc:'Wallpaper opacity from 0 (hidden) to 1 (full).', mdn:'opacity' },

    // Accent
    { key:'--bmm-accent',        label:'Accent',            type:'color', group:'Accent', desc:'The main highlight colour — buttons, active items, links.', mdn:'color' },
    { key:'--bmm-cyan',          label:'Cyan / teal',       type:'color', group:'Accent', desc:'Secondary highlight (paths, info badges).', mdn:'color' },
    { key:'--bmm-success',       label:'Success',           type:'color', group:'Accent', desc:'Colour for success / enabled / verified states.', mdn:'color' },
    { key:'--bmm-warning',       label:'Warning',           type:'color', group:'Accent', desc:'Colour for warnings and caution states.', mdn:'color' },
    { key:'--bmm-danger',        label:'Danger',            type:'color', group:'Accent', desc:'Colour for errors, delete actions and conflicts.', mdn:'color' },
    { key:'--bmm-purple',        label:'Purple',            type:'color', group:'Accent', desc:'Tertiary accent (deeplinks, plugin tags).', mdn:'color' },

    // Borders
    { key:'--bmm-border',        label:'Border',            type:'color', group:'Borders', desc:'Default subtle border around cards & inputs.', mdn:'border-color' },
    { key:'--bmm-border-accent', label:'Border accent',     type:'color', group:'Borders', desc:'Border colour for focused / active elements.', mdn:'border-color' },

    // Text
    { key:'--bmm-text-primary',  label:'Text primary',      type:'color', group:'Text', desc:'Main text colour — titles and important text.', mdn:'color' },
    { key:'--bmm-text-secondary',label:'Text secondary',    type:'color', group:'Text', desc:'Secondary text — descriptions and labels.', mdn:'color' },
    { key:'--bmm-text-muted',    label:'Text muted',        type:'color', group:'Text', desc:'Dimmed text — hints, placeholders, metadata.', mdn:'color' },

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
    { key:'--bmm-anim-speed',      label:'Animation speed',  type:'size',  group:'Effects', desc:'Global animation multiplier. 1 = normal, 0 = instant (disable).', mdn:'animation' },
    { key:'--bmm-intro-duration',  label:'Intro/exit speed', type:'size',  group:'Effects', desc:'Boot loader fade duration, e.g. 0.65s.', mdn:'transition' },

    // Buttons (granular — change a button kind without touching the global accent)
    { key:'--bmm-btn-primary-bg',     label:'Primary button bg',    type:'color', group:'Buttons', desc:'Background of primary (main action) buttons. Defaults to the accent.', mdn:'background-color' },
    { key:'--bmm-btn-primary-text',   label:'Primary button text',  type:'color', group:'Buttons', desc:'Text colour of primary buttons.', mdn:'color' },
    { key:'--bmm-btn-secondary-bg',   label:'Secondary button bg',  type:'color', group:'Buttons', desc:'Background of secondary buttons.', mdn:'background-color' },
    { key:'--bmm-btn-secondary-text', label:'Secondary button text',type:'color', group:'Buttons', desc:'Text colour of secondary buttons.', mdn:'color' },
    { key:'--bmm-btn-ghost-text',     label:'Ghost button text',    type:'color', group:'Buttons', desc:'Text colour of borderless ghost buttons.', mdn:'color' },
    { key:'--bmm-btn-danger-bg',      label:'Danger button bg',     type:'color', group:'Buttons', desc:'Background of destructive (delete) buttons.', mdn:'background-color' },
    { key:'--bmm-btn-danger-text',    label:'Danger button text',   type:'color', group:'Buttons', desc:'Text colour of destructive buttons.', mdn:'color' },

    // DevTools
    { key:'--bmm-devtools-bg',     label:'DevTools background', type:'color', group:'DevTools', desc:'Background of the BMM DevTools panel.', mdn:'background-color' },
    { key:'--bmm-devtools-accent', label:'DevTools accent',    type:'color', group:'DevTools', desc:'Accent colour of the DevTools panel.', mdn:'color' },
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
let _tab: 'simple'|'elements'|'advanced'|'installed' = 'simple';
let _pickMode: 'token'|'target'|null = null;   // token=edit token, target=pick element host
let _pickTargetCb: ((sel: string) => void) | null = null;
let _advPage = 'global';
let _editingCeId: string | null = null;
let _ro: ResizeObserver | null = null;
const OVL_KEY = 'bmm_theme_editor_geom';
const MIN_W = 420, MIN_H = 360;

// ── Init ───────────────────────────────────────────────────────────────────────
export function initThemeEditor(): void {
    document.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('[data-open-theme-editor]')) openEditor();
    });
    document.addEventListener('bmm:theme-editor', () => openEditor());
    (window as any).openThemeEditor = openEditor;
}

export function openEditor(): void {
    if (!_panel) buildPanel();
    _panel!.style.display = 'flex';
    _draft = JSON.parse(JSON.stringify(getActiveTheme() || {}));
    renderTab(_tab);
    if (!_draft.custom_elements) _draft.custom_elements = [];
}

function closeEditor(): void {
    _panel && (_panel.style.display = 'none');
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
                <button class="bte-tool" id="bte-pick-token" title="${t('themes.pickElement')||'Pick element to edit token'}">${ICON.eyedropper(14)}</button>
                <button class="bte-tool" id="bte-reset" title="${t('common.reset')||'Reset'}">${ICON.reset(13)}</button>
                <button class="bte-close" id="bte-close">${ICON.close(14)}</button>
            </div>
        </div>
        <div class="bte-tabs">
            <button class="bte-tab active" data-bte-tab="simple">Simple</button>
            <button class="bte-tab" data-bte-tab="elements">+ Elements</button>
            <button class="bte-tab" data-bte-tab="advanced">CSS</button>
            <button class="bte-tab" data-bte-tab="installed">Installed</button>
        </div>
        <div class="bte-body" id="bte-body"></div>
        <div class="bte-footer">
            <span class="bte-dirty" id="bte-dirty"></span>
            <div class="bte-footer-actions">
                <button class="btn btn-ghost btn-sm" id="bte-discard">${t('themes.discard')||'Discard'}</button>
                <button class="btn btn-secondary btn-sm" id="bte-save">${t('themes.saveTheme')||'Save'}</button>
                <button class="btn btn-ghost btn-sm" id="bte-share" title="${t('themes.share')||'Copy share link'}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                    ${t('themes.share')||'Share'}
                </button>
                <button class="btn btn-accent btn-sm" id="bte-export" title="${t('themes.export')||'Export'} .bmmtheme">${t('themes.export')||'Export'}</button>
            </div>
        </div>`;

    const host = document.getElementById('app-window-outer') || document.body;
    host.appendChild(_panel);
    applyGeom();
    makeDraggable(_panel, _panel.querySelector('#bte-header') as HTMLElement);
    if (!_ro) { _ro = new ResizeObserver(() => saveGeom()); _ro.observe(_panel!); }

    _panel.querySelector('#bte-close')!.addEventListener('click', closeEditor);
    _panel.querySelector('#bte-pick-token')!.addEventListener('click', () => togglePickToken());
    _panel.querySelector('#bte-reset')!.addEventListener('click', confirmReset);
    _panel.querySelector('#bte-save')!.addEventListener('click', saveTheme);
    _panel.querySelector('#bte-share')!.addEventListener('click', shareTheme);
    _panel.querySelector('#bte-export')!.addEventListener('click', doExport);
    _panel.querySelector('#bte-discard')!.addEventListener('click', () => {
        _draft = {}; _draft.custom_elements = []; previewTheme({}); renderTab(_tab);
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

function renderTab(tab: string): void {
    const body = document.getElementById('bte-body');
    if (!body) return;
    if (tab === 'simple')    { body.innerHTML = buildSimpleTab();   wireSimple(); }
    else if (tab === 'elements') { body.innerHTML = buildElementsTab(); wireElements(); }
    else if (tab === 'advanced') { body.innerHTML = buildAdvTab();    wireAdv(); }
    else if (tab === 'installed'){ body.innerHTML = buildInstalledTab(); wireInstalled(); }
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
];

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

// Friendly per-group descriptions + icons
const GROUP_INFO: Record<string, { icon: string; desc: string }> = {
    'Background':     { icon: '🎨', desc: 'Colours behind the whole app, cards and bars.' },
    'Accent':         { icon: '✨', desc: 'Highlight colours — buttons, active items, states.' },
    'Borders':        { icon: '▢',  desc: 'Outlines around cards, inputs and panels.' },
    'Text':           { icon: '🅰', desc: 'Text colours for different levels of importance.' },
    'Typography':     { icon: '🔤', desc: 'Fonts and base text size of the whole interface.' },
    'Shape':          { icon: '⬭',  desc: 'How rounded cards, buttons and inputs are.' },
    'Tasky Tooltips': { icon: '💬', desc: 'The little helper bubbles that pop up on hover.' },
    'Effects':        { icon: '🌟', desc: 'Glows, shadows, hover lift and animation speed.' },
    'Buttons':        { icon: '🔘', desc: 'Recolour each button kind on its own, without touching the accent.' },
    'DevTools':       { icon: '🛠', desc: 'The developer tools overlay (F12).' },
};

const MDN_BASE = 'https://developer.mozilla.org/en-US/docs/Web/CSS/';

function buildSimpleTab(): string {
    const groups: Record<string, Token[]> = {};
    for (const tok of TOKENS) (groups[tok.group] ||= []).push(tok);
    const vars = _draft.vars || {};

    const presets = BUILTIN_THEMES.map(bt => `
        <button class="bte-preset" data-preset-id="${bt.id}"
            onmouseenter="window.showTaskyHelp('${escJs(bt.description||bt.name)}','info',true)" onmouseleave="window.hideTaskyHelp()">
            <span class="bte-preset-dot" style="background:${bt.vars?.['--bmm-accent']||'var(--bmm-accent)'}"></span>
            ${escHtml(bt.name)}
        </button>`).join('');

    // ── Assets quick section (mascot / wallpaper / logo) ──
    const assets = (_draft.assets || {}) as Record<string, string>;
    const assetRow = (key: string, label: string, accept: string, desc: string, isVideo = false) => `
        <div class="bte-asset-row">
            <div class="bte-asset-info">
                <span class="bte-asset-label"
                    onmouseenter="window.showTaskyHelp('${escJs(desc)}','image',true)" onmouseleave="window.hideTaskyHelp()">${escHtml(label)}</span>
                ${assets[key] ? `<span class="bte-asset-set">✓ set</span>` : `<span class="bte-asset-none">default</span>`}
            </div>
            <div class="bte-asset-actions">
                <button class="btn btn-xs btn-secondary bte-asset-pick" data-asset="${key}" data-accept="${accept}" data-video="${isVideo}">${t('themes.choose')||'Choose…'}</button>
                ${assets[key] ? `<button class="btn btn-xs btn-ghost bte-asset-clear" data-asset="${key}">✕</button>` : ''}
            </div>
        </div>`;

    const assetsHtml = `
        <div class="bte-group">
            <div class="bte-group-title">🖼 ${t('themes.assets')||'Assets (images / video)'}</div>
            <p class="bte-group-desc">${t('themes.assetsDesc')||'Replace BMM built-in images. Files are embedded into your theme.'}</p>
            ${assetRow('mascot', t('themes.assetMascot')||'Tasky mascot', 'image/*', 'Replace the floating Tasky mascot AND the spinning boot loader Tasky.')}
            ${assetRow('logo',   t('themes.assetLogo')||'Sidebar logo', 'image/*', 'Replace the BMM logo in the sidebar.')}
            ${assetRow('wallpaper', t('themes.assetWallpaper')||'App wallpaper', 'image/*,video/*', 'A full-app background image. Set blur & opacity in the Background group.', true)}
        </div>`;

    const groupsHtml = Object.entries(groups).map(([grp, tokens]) => {
        const info = GROUP_INFO[grp] || { icon: '', desc: '' };
        return `
        <div class="bte-group">
            <div class="bte-group-title">${info.icon} ${escHtml(grp)}</div>
            ${info.desc ? `<p class="bte-group-desc">${escHtml(info.desc)}</p>` : ''}
            ${tokens.map(tok => {
                const custom = vars[tok.key] || '';
                const ph = pickerHex(tok.key, custom);
                const liveLabel = custom ? '' : `<span class="bte-token-live">${escHtml(currentLabel(tok.key, tok.type))}</span>`;
                const mdnLink = tok.mdn ? `<a class="bte-mdn" href="${MDN_BASE}${tok.mdn}" target="_blank" title="MDN: ${tok.mdn}" onmouseenter="window.showTaskyHelp('${escJs('Open the MDN documentation for the CSS property: ' + tok.mdn)}','info',true)" onmouseleave="window.hideTaskyHelp()">?</a>` : '';
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
                return `<div class="bte-token-row${custom ? ' has-custom' : ''}">
                    <label class="bte-token-lbl"
                        onmouseenter="window.showTaskyHelp('${escJs(tok.desc)}','info',true)" onmouseleave="window.hideTaskyHelp()">${escHtml(tok.label)} ${mdnLink}</label>
                    <div class="bte-token-ctrl">
                        ${inp}
                        ${custom ? `<button class="bte-token-revert" data-var="${tok.key}" title="Reset to default">↩</button>` : liveLabel}
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }).join('');

    return `
        <div class="bte-intro" onmouseenter="window.showTaskyHelp('Hover any label to see what it does. Click ? for the MDN docs. Pick a preset to start fast, then tweak.','info',true)" onmouseleave="window.hideTaskyHelp()">
            ${t('themes.simpleIntro')||'Pick a preset, then tweak anything. Hover labels for help, click ? for MDN docs.'}
        </div>
        <div class="bte-section-title">${t('themes.quickPresets')||'Quick presets'}</div>
        <div class="bte-presets">${presets}</div>
        <div class="bte-sep"></div>
        ${assetsHtml}
        ${groupsHtml}`;
}

function wireSimple(): void {
    _panel?.querySelectorAll('.bte-var-inp').forEach(inp => {
        inp.addEventListener('input', () => {
            const k = (inp as HTMLInputElement).dataset.var!;
            const v = (inp as HTMLInputElement).value;
            if (!_draft.vars) _draft.vars = {};
            if (v.trim() === '') {
                delete _draft.vars[k];
            } else {
                _draft.vars[k] = v.trim();
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
            if (!_draft.vars) _draft.vars = {};
            _draft.vars[k] = hex;
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
            if (_draft.vars) delete _draft.vars[(btn as HTMLElement).dataset.var!];
            previewTheme(_draft); renderTab('simple');
        });
    });
    _panel?.querySelectorAll('.bte-img-clear').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!_draft.vars) _draft.vars = {};
            _draft.vars[(btn as HTMLElement).dataset.var!] = 'none';
            previewTheme(_draft); renderTab('simple');
        });
    });
    _panel?.querySelectorAll('.bte-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = (btn as HTMLElement).dataset.presetId!;
            const p = BUILTIN_THEMES.find(b => b.id === id);
            if (p) { _draft = { ..._draft, vars: { ...p.vars }, custom_elements: _draft.custom_elements }; previewTheme(_draft); renderTab('simple'); }
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
    if (!m || !_draft.vars) return;
    _draft.vars['--bmm-accent-r'] = String(parseInt(m[1], 16));
    _draft.vars['--bmm-accent-g'] = String(parseInt(m[2], 16));
    _draft.vars['--bmm-accent-b'] = String(parseInt(m[3], 16));
}

// ═══════════════════════════════════════════════════════════════════
// ELEMENTS TAB — add / edit custom HTML elements anywhere in BMM
// ═══════════════════════════════════════════════════════════════════
// Ready-made HTML templates so users don't have to write HTML from scratch.
const CE_TEMPLATES: { label: string; icon: string; html: string }[] = [
    { label: 'Button', icon: '🔘',
      html: `<button class="btn btn-sm btn-primary" onclick="window.__bmmDeeplink('bmm://restart')">My button</button>` },
    { label: 'Banner', icon: '📢',
      html: `<div style="padding:10px 14px;border-radius:10px;background:var(--bmm-accent-dim);color:var(--bmm-text-primary);font-weight:600;">👋 My custom banner</div>` },
    { label: 'Badge', icon: '🏷️',
      html: `<span style="padding:3px 9px;border-radius:999px;background:var(--bmm-accent);color:#fff;font-size:11px;font-weight:700;">NEW</span>` },
    { label: 'Note', icon: '📝',
      html: `<p style="margin:8px 0;color:var(--bmm-text-secondary);font-size:13px;">My note text…</p>` },
    { label: 'Image', icon: '🖼️',
      html: `<img src="https://placekitten.com/120/60" alt="" style="border-radius:10px;max-width:100%;">` },
    { label: 'Link', icon: '🔗',
      html: `<a href="#" onclick="window.__bmmDeeplink('bmm://repo/sync?url=URL');return false;" style="color:var(--bmm-accent);font-weight:600;">My link →</a>` },
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
                <button class="bte-icon-btn bte-ce-edit" data-ce-id="${escAttr(ce.id)}" title="${t('common.edit')||'Edit'}">${ICON.edit(13)}</button>
                <button class="bte-icon-btn danger bte-ce-del" data-ce-id="${escAttr(ce.id)}" title="${t('common.delete')||'Delete'}">${ICON.trash(13)}</button>
            </div>
        </div>`).join('') : `<div class="bte-empty" style="margin:14px 0;">${t('themes.noCe')||'No custom elements yet — add one below.'}</div>`;

    const isEdit = _editingCeId != null;
    const editing = isEdit ? ces.find(c => c.id === _editingCeId) : null;

    return `
        <div class="bte-intro" onmouseenter="window.showTaskyHelp('${escJs(t('themes.ceTaskyHelp')||'Add your own buttons, banners or widgets anywhere in BMM. Choose WHERE (1), pick a template, then tweak the HTML (2).')}','info',true)" onmouseleave="window.hideTaskyHelp()">
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
            <p class="bte-adv-tip" style="margin:4px 0 0;">${t('themes.ceDeeplinkTip')||'For BMM actions, use'} <code>onclick="window.__bmmDeeplink('bmm://…')"</code></p>

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
                    `<button class="bte-dl-chip" data-snippet='<button class="btn btn-xs btn-accent" onclick="window.__bmmDeeplink(&apos;${dl}&apos;)">${lbl}</button>'>${escHtml(lbl as string)}</button>`
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
        {id:'global', label:'Global (all pages)'}, ...PAGE_OPTIONS,
    ].map(p => `<option value="${p.id}"${p.id===_advPage?' selected':''}>${escHtml(p.label)}</option>`).join('');
    const css = _advPage==='global' ? (_draft.global_css||'') : (_draft.pages?.[_advPage]?.css||'');
    return `
        <div class="bte-adv-bar">
            <select id="bte-adv-page" class="bte-adv-sel">${pageOpts}</select>
            <span class="bte-adv-hint">Scoped to selected page</span>
        </div>
        <p class="bte-adv-tip">Use <code>var(--bmm-*)</code> for theming-safe values. CSS is scoped to <code>#view-${_advPage==='global'?'…':_advPage}</code>.</p>
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
                    <div class="bte-installed-accent" style="background:${th.vars?.['--bmm-accent']||'var(--bmm-accent)'}"></div>
                    <div class="bte-installed-info">
                        <div class="bte-installed-name">${escHtml(th.name)}${isBuiltin?'<span class="bte-builtin-tag">built-in</span>':''}</div>
                        ${th.description ? `<div class="bte-installed-author">${escHtml(th.description)}</div>` : ''}
                    </div>
                    <div class="bte-installed-actions">
                        <button class="btn btn-xs${isActive?' btn-accent':' btn-ghost'} bte-activate" data-id="${th.id}">${isActive?'✓ Active':'Apply'}</button>
                        ${!isBuiltin?`<button class="btn btn-xs btn-ghost bte-export-theme" data-id="${th.id}">Export</button>`:''}
                        ${!isBuiltin?`<button class="btn btn-xs btn-danger bte-delete-theme" data-id="${th.id}">✕</button>`:''}
                    </div>
                </div>`;
            }).join('')}
        </div>
        <div class="bte-install-bar">
            <button class="btn btn-sm btn-ghost" id="bte-import-file">${t('themes.import')||'⬆ Import .bmmtheme'}</button>
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
    _panel?.querySelector('#bte-import-file')?.addEventListener('click', importFile);
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
    document.addEventListener('keydown', onPickEsc, true);
}

function onPickEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopPick(); }
}

function stopPick(): void {
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
    stopPick();
    // No mapped token → let the user recolour this element directly via an override.
    if (!guessedToken) {
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

/** Floating per-element editor: edit ANY CSS of any element via an
 *  element_override — colours through quick pickers, everything else through a
 *  free-form CSS box. Writes into _draft.element_overrides. Fully reversible.  */
function openElementOverrideEditor(el: HTMLElement): void {
    stopPick();                               // guarantee pick mode is fully off
    document.getElementById('bte-elov')?.remove();
    const cs = getComputedStyle(el);
    if (!_draft.element_overrides) _draft.element_overrides = [];

    let selector = buildSelectorFor(el);
    let ov = _draft.element_overrides.find(o => o.selector === selector);
    if (!ov) { ov = { selector, props: {} }; _draft.element_overrides.push(ov); }

    const pop = document.createElement('div');
    pop.id = 'bte-elov';
    pop.className = 'bte-elov';
    const row = (label: string, prop: string, cur: string) => `
        <label class="bte-elov-row">
            <span>${label}</span>
            <input type="color" data-prop="${prop}" value="${rgbToHex(cur)}">
            <button class="bte-elov-clear" data-prop="${prop}" title="${t('themes.clear')||'Clear'}">✕</button>
        </label>`;
    pop.innerHTML = `
        <div class="bte-elov-head">
            <strong>${t('themes.overrideElement')||'Edit this element'}</strong>
            <button class="bte-elov-close">✕</button>
        </div>
        <label class="bte-elov-sellabel">${t('themes.selector')||'Selector'}
            <input class="bte-elov-selinput" type="text" value="${escAttr(selector)}" spellcheck="false">
        </label>
        ${row(t('themes.text')||'Text', 'color', cs.color)}
        ${row(t('themes.background')||'Background', 'background-color', cs.backgroundColor)}
        ${row(t('themes.border')||'Border', 'border-color', cs.borderColor)}
        <label class="bte-elov-csslabel">${t('themes.customCss')||'Custom CSS (any property)'}</label>
        <textarea class="bte-elov-css" spellcheck="false" placeholder="border-radius: 12px;&#10;padding: 8px 14px;&#10;box-shadow: 0 4px 20px #000;&#10;font-size: 15px;">${escHtml(propsToCss(ov.props))}</textarea>
        <p class="bte-elov-hint">${t('themes.overrideHint')||'Affects every element matching this selector. Live preview.'}</p>`;
    document.body.appendChild(pop);

    const r = el.getBoundingClientRect();
    pop.style.left = Math.min(r.left, window.innerWidth - 300) + 'px';
    pop.style.top = Math.min(r.bottom + 8, window.innerHeight - 360) + 'px';

    const cssBox = pop.querySelector('.bte-elov-css') as HTMLTextAreaElement;
    const refreshBox = () => { cssBox.value = propsToCss(ov!.props); };
    const cleanupEmpty = () => {
        if (Object.keys(ov!.props).length === 0)
            _draft.element_overrides = _draft.element_overrides!.filter(o => o !== ov);
    };

    // Quick colour pickers → write a single prop, keep the CSS box in sync.
    pop.querySelectorAll('input[type=color]').forEach(inp => {
        inp.addEventListener('input', () => {
            ov!.props[(inp as HTMLElement).dataset.prop!] = (inp as HTMLInputElement).value;
            refreshBox(); previewTheme(_draft); updateDirty();
        });
    });
    pop.querySelectorAll('.bte-elov-clear').forEach(btn => {
        btn.addEventListener('click', () => {
            delete ov!.props[(btn as HTMLElement).dataset.prop!];
            refreshBox(); cleanupEmpty(); previewTheme(_draft); updateDirty();
        });
    });

    // Free-form CSS box is the full source of truth for the props map.
    cssBox.addEventListener('input', () => {
        ov!.props = cssToProps(cssBox.value);
        // keep override alive while typing even if momentarily empty
        if (!_draft.element_overrides!.includes(ov!)) _draft.element_overrides!.push(ov!);
        previewTheme(_draft); updateDirty();
    });

    // Editable selector — retarget the same override (e.g. broaden to all buttons).
    const selInput = pop.querySelector('.bte-elov-selinput') as HTMLInputElement;
    selInput.addEventListener('change', () => {
        const next = selInput.value.trim();
        if (next) { ov!.selector = next; selector = next; previewTheme(_draft); updateDirty(); }
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

async function saveTheme(): Promise<void> {
    const cur = getActiveTheme();
    const name = cur?.name !== 'Preview' ? cur?.name : undefined;
    const entered = name || await btePrompt(t('themes.enterName')||'Theme name:', 'My Theme');
    if (entered === null) return;                       // user cancelled
    const finalName = (entered || 'My Theme').trim();
    const finalId = (cur?.id && cur.id !== '__preview__') ? cur.id : finalName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const theme: BmmTheme = { id: finalId, name: finalName, author: 'You', version: '1.0.0', ...(_draft as any) };
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
    const path = await pickFile([{ name: 'BMM Theme', extensions: ['bmmtheme', 'zip', 'json'] }]);
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
    const r = _panel.getBoundingClientRect();
    localStorage.setItem(OVL_KEY, JSON.stringify({ left:r.left, top:r.top, width:r.width, height:r.height }));
}

function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
    if (!handle || (handle as any)._bteDrag) return;
    (handle as any)._bteDrag = true;
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('button,input,select,textarea')) return;
        e.preventDefault();
        const r = panel.getBoundingClientRect();
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        const move = (ev: MouseEvent) => {
            panel.style.left = `${Math.max(0, Math.min(innerWidth-80, ev.clientX-ox))}px`;
            panel.style.top  = `${Math.max(0, Math.min(innerHeight-40, ev.clientY-oy))}px`;
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveGeom(); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
}
