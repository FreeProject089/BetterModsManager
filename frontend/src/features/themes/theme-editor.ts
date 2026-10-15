// ── BMM Theme Editor ──────────────────────────────────────────────────────────────────────
//
// One panel, three areas:
//   · left, the sections: Basics (background, surfaces, text, accent, the mode, a palette from
//     one colour, starting points), All tokens (every --bmm-* token, searchable), Pictures,
//     Elements (per-element styles, the pick tool, your own HTML), CSS, and Library (your
//     themes and the built-ins: edit, apply, export, import);
//   · right, a preview of real BMM components (the same classes the app uses) painted with the
//     DRAFT only, in a sandbox: the draft's tokens are scoped to the preview, so editing does
//     not repaint the app, or this panel, until you ask for it (« Apply to BMM as I edit »);
//     under it, the WCAG contrast checks of the draft, each with its ratio and a fix;
//   · a footer: validation of the file format, unsaved state, File (import, export, copy,
//     share), Save as new and Save.
//
// What stays the same: the panel floats, docks to the side (ui/dock-space.ts) and pops out
// into a window of its own (ui/popout.ts), which mirrors the markup and replays clicks, input
// and keys. That is why every interaction here is a click, an input or a key on an element
// inside the panel, why prompts and confirmations are drawn INSIDE the panel (a dialog
// mounted elsewhere would not reach the popped-out window), and why the preview is plain
// markup styled by a <style> in <head> (styles are sent to the window too).
//
// The document rules (format, validation, migration, ids, contrast, palettes, variants, undo)
// live in theme-model.ts, which the engine and the tests share.

import { claimDockSpace, releaseDockSpace, makeDock } from '../../ui/dock-space.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { invoke } from '../../core/api.js';
import { escHtml, escAttr } from '../../core/utils.js';
import {
    applyTheme, resetTheme, getActiveTheme, getCachedTheme,
    installTheme, getInstalledThemes, deleteTheme, BUILTIN_THEMES,
    isContrastEnforced, setContrastEnforced, loadInstalledThemes,
} from './theme-engine.js';
import type { BmmTheme, CustomElement, ElementOverride } from './theme-engine.js';
import {
    THEME_FORMAT, TOKEN_CATALOG, TOKEN_GROUPS, BASIC_GROUPS, tokenSlug, isInternalToken, guessTokenType,
    validateTheme, migrateTheme, parseThemeText, slugThemeId, isSafeCssValue, rootVars,
    parseColor, toHex, checkContrast, resolveToken, generatePalette, deriveVariant, isLightTheme,
    ThemeHistory, canonicalThemeId, brandMark, brandMascotSrc,
} from './theme-model.js';
import type { TokenDef, ThemeIssue, ContrastResult } from './theme-model.js';
import { learnMore } from '../../core/learn-more.js';
import { uiIcon } from '../../ui/icons.js';
import { popoutButtonHtml, wirePopout, type PopoutSpec } from '../../ui/popout.js';

type Draft = BmmTheme & { [key: string]: any };
type Section = 'basics' | 'tokens' | 'pictures' | 'elements' | 'css' | 'library' | 'preview';

// ── Text helpers ───────────────────────────────────────────────────────────────────────────

/** t() returns the key itself on a miss; a dynamic key (a token, a group) falls back to the
 *  catalogue's English instead of drawing its own name. */
function tx(key: string, fallback: string): string {
    const s = t(key);
    return s && s !== key ? s : fallback;
}

/** A colour for an inline style that the engine's inline-colour patches cannot match: they
 *  look for `#3b82f6` and `59, 130, 246`, which a swatch of the default accent would contain. */
function cssColor(v: string): string {
    const c = parseColor(v);
    if (!c) return 'transparent';
    return `rgb(${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)} / ${c.a})`;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));

// ── State ──────────────────────────────────────────────────────────────────────────────────

let _panel: HTMLElement | null = null;
let _draft: Draft = { id: '', name: '' };
/** The theme this draft was opened from, and whether it is one of the user's own. */
let _baseId: string | null = null;
let _baseIsUser = false;
/** The theme that was on the app when the editor opened (to put back after a live preview). */
let _appTheme: BmmTheme | null = null;
/** JSON of the draft as last opened or saved: unsaved = different from this. */
let _savedJson = '';
let _section: Section = 'basics';
let _search = '';
let _onlyChanged = false;
let _cssPage = 'global';
let _editingCeId: string | null = null;
let _narrow = false;
let _sheetResolve: ((v: string | null) => void) | null = null;
let _contrastFailing = 0;
const _history = new ThemeHistory<Draft>(200, 900);

const LIVE_KEY = 'bmm.themeEditor.live';
const GEOM_KEY = 'bmm_theme_editor_geom';
const MIN_W = 420, MIN_H = 360;
const NARROW_AT = 780;

function isLive(): boolean {
    try { return localStorage.getItem(LIVE_KEY) === '1'; } catch { return false; }
}

// ── Init ───────────────────────────────────────────────────────────────────────────────────

export function initThemeEditor(): void {
    document.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-open-theme-editor]')) openEditor();
    });
    document.addEventListener('bmm:theme-editor', () => openEditor());
    // Built with t() strings: a language switch rebuilds the shell, the draft is kept.
    document.addEventListener('langChanged', () => {
        if (!_panel) return;
        const wasOpen = _panel.style.display !== 'none';
        _panel.remove();
        _panel = null;
        buildPanel();
        if (wasOpen && _panel) { (_panel as HTMLElement).style.display = 'flex'; renderAll(); }
    });
    (window as any).openThemeEditor = openEditor;
}

/**
 * Open the editor on `themeId` (an installed or built-in theme), or on the active theme.
 * An id that resolves to nothing falls back to the active theme rather than an empty editor.
 */
export function openEditor(themeId?: string): void {
    if (!_panel) buildPanel();
    const wasOpen = !!_panel && _panel.style.display !== 'none';
    _panel!.style.display = 'flex';
    if (localStorage.getItem(BTE_DOCK_KEY) === 'right') setDock(true);
    if (wasOpen && !themeId) return;   // already editing: keep the draft
    const id = themeId ? canonicalThemeId(themeId) : '';
    const wanted = (id && (getCachedTheme(id) || BUILTIN_THEMES.find((b) => b.id === id))) || getActiveTheme();
    _appTheme = getActiveTheme() ? clone(getActiveTheme()) : null;
    loadDraft(wanted ? clone(wanted) as Draft : { id: '', name: '' });
}

function loadDraft(theme: Draft): void {
    const th = migrateTheme(theme).theme as unknown as Draft;
    if (th.id === '__preview__') { th.id = ''; }
    _draft = th;
    _baseId = th.id || null;
    _baseIsUser = !!th.id && !BUILTIN_THEMES.some((b) => b.id === th.id) && getInstalledThemes().some((x) => x.id === th.id);
    if (!_draft.name) _draft.name = tx('themes.ed.untitled', 'My theme');
    _savedJson = JSON.stringify(_draft);
    _history.reset(_draft);
    _editingCeId = null;
    renderAll();
    if (isLive()) liveApply();
}

// ── Dock / float / pop out ────────────────────────────────────────────────────────────────

const BTE_DOCK_KEY = 'bmm.themeEditor.dock';
const BTE_DOCKW_KEY = 'bmm.themeEditor.dockW';
const _dock = makeDock({ id: 'theme-editor', storageKey: BTE_DOCKW_KEY, cssVar: '--bte-dock-w', min: 340, def: 460 });

function isDocked(): boolean { return document.body.classList.contains('bte-docked'); }

function setDock(on: boolean): void {
    if (!_panel) return;
    document.body.classList.toggle('bte-docked', on);
    localStorage.setItem(BTE_DOCK_KEY, on ? 'right' : 'float');
    if (on) {
        // The shared owner decides how much room there is; 0 means none, and docking anyway is
        // exactly the « panel covers the app » it exists to prevent.
        const w = claimDockSpace('theme-editor', _dock.width());
        if (!w) {
            document.body.classList.remove('bte-docked');
            localStorage.setItem(BTE_DOCK_KEY, 'float');
            toast(t('themes.dockNoRoom'), 'info', 2600);
            return;
        }
        document.body.style.setProperty('--bte-dock-w', `${w}px`);
        Object.assign(_panel.style, { position: '', left: '', top: '', width: '', height: '', resize: '' });
    } else {
        releaseDockSpace('theme-editor');
        document.body.style.removeProperty('--bte-dock-w');
        applyGeom();
        _panel.style.display = 'flex';
    }
    _panel.querySelector('#bte-dock')?.classList.toggle('active', on);
    updateNarrow();
}

document.addEventListener('bmm:dock:no-room', (e) => {
    const ids = (e as CustomEvent).detail?.ids as string[] | undefined;
    if (ids && !ids.includes('theme-editor')) return;
    if (isDocked()) setDock(false);
});

function closeEditor(): void {
    if (_panel) _panel.style.display = 'none';
    if (isDocked()) { document.body.classList.remove('bte-docked'); releaseDockSpace('theme-editor'); }
    stopPick();
    document.getElementById('bte-elov')?.remove();
    // Anything previewed on the app and not saved (live editing, an element being styled or
    // placed) goes back to what the app wore before.
    if (getActiveTheme()?.id === '__preview__') restoreApp();
}

/** The close button: unsaved work is asked about, in the panel. */
async function requestClose(): Promise<void> {
    if (isDirty()) {
        const choice = await sheet({
            message: t('themes.ed.closeDirty'),
            actions: [
                { id: 'keep', label: t('themes.ed.keepEditing') },
                { id: 'discard', label: t('themes.discard'), tone: 'danger' },
            ],
        });
        if (choice !== 'discard') return;
        loadDraft(clone(_baseId ? (getCachedTheme(_baseId) || BUILTIN_THEMES.find((b) => b.id === _baseId) || _draft) : _draft) as Draft);
        restoreApp();
    }
    closeEditor();
}

const BTE_POPOUT: PopoutSpec = {
    id: 'theme-editor',
    title: () => t('themes.editorTitle'),
    panel: () => _panel,
    isOpen: () => !!_panel && _panel.isConnected && _panel.style.display !== 'none',
    prepare: () => { if (isDocked()) setDock(false); },
    close: () => closeEditor(),
    dragOut: () => !isDocked(),
};

// ── The shell ──────────────────────────────────────────────────────────────────────────────

const SECTIONS: Array<{ id: Section; icon: Parameters<typeof uiIcon>[0]; key: string }> = [
    { id: 'basics', icon: 'palette', key: 'themes.ed.secBasics' },
    { id: 'tokens', icon: 'sliders', key: 'themes.ed.secTokens' },
    { id: 'pictures', icon: 'image', key: 'themes.ed.secPictures' },
    { id: 'elements', icon: 'layers', key: 'themes.ed.secElements' },
    { id: 'css', icon: 'code', key: 'themes.ed.secCss' },
    { id: 'library', icon: 'folders', key: 'themes.ed.secLibrary' },
    { id: 'preview', icon: 'eye', key: 'themes.ed.secPreview' },
];

function buildPanel(): void {
    _panel = document.createElement('div');
    _panel.id = 'bmm-theme-editor';
    _panel.setAttribute('role', 'dialog');
    _panel.setAttribute('aria-label', t('themes.editorTitle'));
    _panel.innerHTML = `
        <div class="bte-header" id="bte-header">
            <span class="bte-logo" aria-hidden="true">${uiIcon('palette', 16)}</span>
            <input class="bte-name" id="bte-name" type="text" spellcheck="false" maxlength="80"
                aria-label="${escAttr(t('themes.ed.nameLabel'))}" data-bte-field="name">
            <span class="bte-mode-chip" id="bte-mode-chip"></span>
            <div class="bte-header-actions">
                <button class="bte-tool" type="button" id="bte-undo" data-bte="undo" aria-label="${escAttr(t('themes.ed.undo'))}" data-tooltip="${escAttr(t('themes.ed.undoTip'))}">${uiIcon('undo', 16)}</button>
                <button class="bte-tool" type="button" id="bte-redo" data-bte="redo" aria-label="${escAttr(t('themes.ed.redo'))}" data-tooltip="${escAttr(t('themes.ed.redoTip'))}">${uiIcon('redo', 16)}</button>
                <span class="bte-hsep" aria-hidden="true"></span>
                <button class="bte-tool" type="button" id="bte-pick-token" data-bte="pick" aria-label="${escAttr(t('themes.pickElement'))}" data-tooltip="${escAttr(t('themes.pickElement'))}">${uiIcon('pick', 16)}</button>
                <button class="bte-tool" type="button" id="bte-reset" data-bte="reset" aria-label="${escAttr(t('common.reset'))}" data-tooltip="${escAttr(t('themes.ed.resetTip'))}">${uiIcon('reset', 16)}</button>
                ${learnMore('making-themes', { compact: true, className: 'bte-tool' })}
                ${popoutButtonHtml('bte-tool', 'theme-editor')}
                <button class="bte-tool" type="button" id="bte-dock" data-bte="dock" data-popout-hide aria-label="${escAttr(t('themes.dockToggle'))}" data-tooltip="${escAttr(t('themes.dockToggle'))}">${uiIcon('panel-right', 16)}</button>
                <button class="bte-tool bte-close" type="button" id="bte-close" data-bte="close" aria-label="${escAttr(t('common.close'))}">${uiIcon('close', 16)}</button>
            </div>
        </div>
        <div class="bte-main">
            <nav class="bte-rail" aria-label="${escAttr(t('themes.ed.sections'))}">
                ${SECTIONS.map((s) => `<button type="button" class="bte-rail-btn${s.id === 'preview' ? ' bte-only-narrow' : ''}" data-bte="section" data-section="${s.id}">${uiIcon(s.icon, 16)}<span>${escHtml(t(s.key))}</span></button>`).join('')}
            </nav>
            <div class="bte-side" id="bte-side"></div>
            <div class="bte-view" id="bte-view">
                <div class="bte-view-bar">
                    <span class="bte-view-title">${escHtml(t('themes.ed.previewTitle'))}</span>
                    <label class="bte-check" data-tooltip="${escAttr(t('themes.ed.liveTip'))}">
                        <input type="checkbox" id="bte-live" data-bte-field="live"> <span>${escHtml(t('themes.ed.live'))}</span>
                    </label>
                </div>
                <div class="bte-stage-wrap" id="bte-stage-wrap"></div>
                <section class="bte-contrast" id="bte-contrast" aria-label="${escAttr(t('themes.ed.contrastTitle'))}"></section>
            </div>
        </div>
        <div class="bte-sheet" id="bte-sheet" hidden></div>
        <div class="bte-footer">
            <button type="button" class="bte-status" id="bte-status" data-bte="issues"></button>
            <span class="bte-dirty" id="bte-dirty"></span>
            <div class="bte-footer-actions">
                <span class="bte-file-menu-wrap">
                    <button class="btn btn-ghost btn-sm" type="button" id="bte-file-menu-btn" data-bte="file-menu" aria-haspopup="true">${uiIcon('more', 16)} ${escHtml(t('themes.fileMenu'))}</button>
                    <span class="bte-file-menu" id="bte-file-menu" hidden>
                        <button class="btn btn-ghost btn-sm" type="button" id="bte-import-file" data-bte="import">${uiIcon('import', 16)} ${escHtml(t('themes.ed.importFile'))}</button>
                        <button class="btn btn-ghost btn-sm" type="button" id="bte-export" data-bte="export">${uiIcon('export', 16)} ${escHtml(t('themes.ed.exportFile'))}</button>
                        <button class="btn btn-ghost btn-sm" type="button" id="bte-copy-json" data-bte="copy-json">${uiIcon('copy', 16)} ${escHtml(t('themes.ed.copyJson'))}</button>
                        <button class="btn btn-ghost btn-sm" type="button" id="bte-share" data-bte="share">${uiIcon('share', 16)} ${escHtml(t('themes.ed.shareLink'))}</button>
                    </span>
                </span>
                <button class="btn btn-ghost btn-sm" type="button" id="bte-save-as" data-bte="save-as" data-tooltip="${escAttr(t('themes.saveAsHint'))}">${escHtml(t('themes.ed.saveAsNew'))}</button>
                <button class="btn btn-primary btn-sm" type="button" id="bte-save" data-bte="save">${uiIcon('save', 16)} <span id="bte-save-label">${escHtml(t('themes.saveTheme'))}</span></button>
            </div>
        </div>`;

    const host = document.getElementById('app-window-outer') || document.body;
    host.appendChild(_panel);
    applyGeom();
    makeDraggable(_panel, _panel.querySelector('#bte-header') as HTMLElement);
    wirePopout(BTE_POPOUT, _panel, _panel.querySelector('#bte-header') as HTMLElement);
    _dock.plantGrip(_panel, isDocked);
    new ResizeObserver(() => { saveGeom(); updateNarrow(); }).observe(_panel);

    _panel.addEventListener('click', onClick);
    _panel.addEventListener('input', onInput);
    _panel.addEventListener('change', onChange);
    _panel.addEventListener('keydown', onKey);
    document.addEventListener('click', (e) => {
        const menu = _panel?.querySelector('#bte-file-menu') as HTMLElement | null;
        if (menu && !menu.hidden && !(e.target as HTMLElement).closest?.('.bte-file-menu-wrap')) menu.hidden = true;
    });
}

/** Below NARROW_AT the preview stops being a column and becomes a section of its own. */
function updateNarrow(): void {
    if (!_panel) return;
    const w = _panel.getBoundingClientRect().width;
    if (!w) return;   // hidden, or shown in its own window: keep what it was
    const narrow = w < NARROW_AT;
    if (narrow === _narrow && _panel.classList.contains('bte-narrow') === narrow) return;
    _narrow = narrow;
    _panel.classList.toggle('bte-narrow', narrow);
    if (!narrow && _section === 'preview') { _section = 'basics'; renderSide(); }
    syncRail();
}

function syncRail(): void {
    _panel?.querySelectorAll<HTMLElement>('.bte-rail-btn').forEach((b) => {
        const on = b.dataset.section === _section;
        b.classList.toggle('active', on);
        b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    _panel?.classList.toggle('bte-show-preview', _section === 'preview');
}

// ── Rendering ──────────────────────────────────────────────────────────────────────────────

function renderAll(): void {
    if (!_panel) return;
    const name = _panel.querySelector('#bte-name') as HTMLInputElement | null;
    if (name && document.activeElement !== name) name.value = _draft.name || '';
    const live = _panel.querySelector('#bte-live') as HTMLInputElement | null;
    if (live) live.checked = isLive();
    // The stage first: every row reads its current value from it.
    renderStage();
    renderSide();
    renderChrome();
}

/** Everything that follows the draft without rebuilding the section: preview, contrast,
 *  status, undo state, the mode chip. */
function refresh(): void {
    paintStage();
    renderContrast();
    renderChrome();
    if (isLive()) liveApply();
}

function renderChrome(): void {
    if (!_panel) return;
    const light = isLightTheme(_draft);
    const chip = _panel.querySelector('#bte-mode-chip');
    if (chip) chip.textContent = light ? t('themes.modeLight') : t('themes.modeDark');
    (_panel.querySelector('#bte-undo') as HTMLButtonElement).disabled = !_history.canUndo;
    (_panel.querySelector('#bte-redo') as HTMLButtonElement).disabled = !_history.canRedo;
    const dirty = isDirty();
    const d = _panel.querySelector('#bte-dirty');
    if (d) d.textContent = dirty ? t('themes.ed.unsaved') : '';
    const lbl = _panel.querySelector('#bte-save-label');
    if (lbl) lbl.textContent = _baseIsUser ? t('themes.saveTheme') : t('themes.ed.saveAsNew');
    (_panel.querySelector('#bte-save-as') as HTMLElement).hidden = !_baseIsUser;
    renderStatus();
}

function renderStatus(): void {
    const el = _panel?.querySelector('#bte-status') as HTMLElement | null;
    if (!el) return;
    const issues = validateTheme(draftForSave()).filter((i) => i.level !== 'info');
    const errors = issues.filter((i) => i.level === 'error').length;
    el.className = `bte-status ${errors ? 'is-error' : issues.length ? 'is-warn' : 'is-ok'}`;
    el.innerHTML = `${uiIcon(errors ? 'error' : issues.length ? 'warning' : 'success', 14)}<span>${escHtml(
        errors ? t('themes.ed.statusErrors', { n: String(errors) })
            : issues.length ? t('themes.ed.statusWarnings', { n: String(issues.length) })
                : t('themes.ed.statusOk', { v: String(THEME_FORMAT) }))}</span>`;
}

function renderSide(): void {
    const side = _panel?.querySelector('#bte-side') as HTMLElement | null;
    if (!side) return;
    syncRail();
    const scroll = side.scrollTop;
    const sec = _section === 'preview' ? 'basics' : _section;
    if (sec === 'basics') side.innerHTML = buildBasics();
    else if (sec === 'tokens') side.innerHTML = buildTokens();
    else if (sec === 'pictures') side.innerHTML = buildPictures();
    else if (sec === 'elements') side.innerHTML = buildElements();
    else if (sec === 'css') side.innerHTML = buildCss();
    else if (sec === 'library') side.innerHTML = buildLibrary();
    side.scrollTop = scroll;
    if (sec === 'tokens') renderTokenList();
}

// ── Token rows ─────────────────────────────────────────────────────────────────────────────

let _defaults: Record<string, string> | null = null;

/** Every custom property tokens.css declares on :root, as written there. Read from the live
 *  stylesheet so a token added to tokens.css appears here and in the preview by itself. */
function tokenDefaults(): Record<string, string> {
    if (_defaults && Object.keys(_defaults).length) return _defaults;
    const out: Record<string, string> = {};
    for (const sheet of Array.from(document.styleSheets)) {
        const href = (sheet as CSSStyleSheet).href || '';
        if (!/tokens\.css(\?|$)/.test(href)) continue;
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const r of Array.from(rules)) {
            if (!(r instanceof CSSStyleRule) || r.selectorText.trim() !== ':root') continue;
            for (let i = 0; i < r.style.length; i++) {
                const p = r.style[i];
                if (p.startsWith('--')) out[p] = r.style.getPropertyValue(p).trim();
            }
        }
    }
    _defaults = out;
    return out;
}

function tokenDef(key: string): TokenDef {
    const known = TOKEN_CATALOG.find((x) => x.key === key);
    if (known) return known;
    const def = tokenDefaults()[key] || '';
    return { key, type: guessTokenType(key, def), group: 'other', label: key.replace(/^--bmm-/, ''), desc: '' };
}

const tokLabel = (d: TokenDef) => tx(`themes.tok.${tokenSlug(d.key)}`, d.label);
const tokDesc = (d: TokenDef) => tx(`themes.tok.${tokenSlug(d.key)}.desc`, d.desc);

/** What a token resolves to in the preview right now (the draft over the defaults). */
function resolved(key: string): string {
    const stage = _panel?.querySelector('.bte-stage') as HTMLElement | null;
    if (stage) {
        const v = getComputedStyle(stage).getPropertyValue(key).trim();
        if (v) return v;
    }
    return resolveToken(_draft.vars || {}, key, isLightTheme(_draft)) || tokenDefaults()[key] || '';
}

const FONT_PRESETS: Array<[string, string]> = [
    ["'Inter', system-ui, sans-serif", 'Inter'],
    ['system-ui, sans-serif', 'System UI'],
    ["'Segoe UI', sans-serif", 'Segoe UI'],
    ["'Roboto', sans-serif", 'Roboto'],
    ["'Poppins', sans-serif", 'Poppins'],
    ["'Montserrat', sans-serif", 'Montserrat'],
    ["'Nunito', sans-serif", 'Nunito'],
    ["'Orbitron', sans-serif", 'Orbitron'],
    ['Georgia, serif', 'Georgia'],
];
const MONO_PRESETS: Array<[string, string]> = [
    ["'JetBrains Mono', 'Fira Code', monospace", 'JetBrains Mono'],
    ["'Fira Code', monospace", 'Fira Code'],
    ["'Cascadia Code', monospace", 'Cascadia Code'],
    ['Consolas, monospace', 'Consolas'],
    ["'Courier New', monospace", 'Courier New'],
];

let _rowSeq = 0;
function tokenRow(d: TokenDef, opts: { showKey?: boolean; showDesc?: boolean } = {}): string {
    const own = _draft.vars?.[d.key];
    const set = own !== undefined && own !== '';
    const cur = resolved(d.key);
    const id = `bte-f${++_rowSeq}`;
    const label = tokLabel(d);
    const desc = tokDesc(d);
    let ctl = '';
    const textInput = (cls = '') => `<input id="${id}" class="bte-input${cls}" type="text" spellcheck="false" data-tok="${escAttr(d.key)}" value="${escAttr(own || '')}" placeholder="${escAttr(cur)}">`;
    if (d.type === 'color') {
        const c = parseColor(cur);
        ctl = `<span class="bte-swatch-wrap">
                <span class="bte-swatch" style="background:${cssColor(cur)}"></span>
                <input class="bte-color" type="color" data-tok-color="${escAttr(d.key)}" value="${c ? toHex(c) : '#000000'}" aria-label="${escAttr(t('themes.ed.pickColour', { name: label }))}">
            </span>${textInput(' bte-input-color')}`;
    } else if (d.type === 'font') {
        const presets = d.key === '--bmm-font-mono' ? MONO_PRESETS : FONT_PRESETS;
        ctl = `<select class="bte-input bte-select" data-tok-font="${escAttr(d.key)}" aria-label="${escAttr(t('themes.ed.fontPreset', { name: label }))}">
                <option value="">${escHtml(t('themes.ed.fontDefault'))}</option>
                ${presets.map(([v, n]) => `<option value="${escAttr(v)}"${own === v ? ' selected' : ''}>${escHtml(n)}</option>`).join('')}
            </select>${textInput()}`;
    } else {
        ctl = textInput();
    }
    return `<div class="bte-row${set ? ' is-set' : ''}" data-row="${escAttr(d.key)}">
        <div class="bte-row-head">
            <label for="${id}" class="bte-row-label">${escHtml(label)}</label>
            ${opts.showKey ? `<code class="bte-row-key">${escHtml(d.key)}</code>` : ''}
            <span class="bte-row-tools">
                <button type="button" class="bte-mini" data-bte="reveal" data-key="${escAttr(d.key)}" aria-label="${escAttr(t('themes.revealTip'))}" data-tooltip="${escAttr(t('themes.revealTip'))}">${uiIcon('eye', 14)}</button>
                <button type="button" class="bte-mini bte-row-reset" data-bte="tok-reset" data-key="${escAttr(d.key)}" aria-label="${escAttr(t('themes.resetToDefault'))}" data-tooltip="${escAttr(t('themes.resetToDefault'))}"${set ? '' : ' hidden'}>${uiIcon('reset', 14)}</button>
            </span>
        </div>
        ${opts.showDesc && desc ? `<p class="bte-row-desc">${escHtml(desc)}</p>` : ''}
        <div class="bte-row-ctl">${ctl}</div>
    </div>`;
}

/** After a value changed, bring its row up to date without rebuilding the list (focus and
 *  the caret stay where they are). */
function syncRow(key: string): void {
    _panel?.querySelectorAll<HTMLElement>(`.bte-row[data-row="${CSS.escape(key)}"]`).forEach((row) => {
        const own = _draft.vars?.[key];
        const set = own !== undefined && own !== '';
        row.classList.toggle('is-set', set);
        const reset = row.querySelector('.bte-row-reset') as HTMLElement | null;
        if (reset) reset.hidden = !set;
        const cur = resolved(key);
        const sw = row.querySelector('.bte-swatch') as HTMLElement | null;
        if (sw) sw.style.background = cssColor(cur);
        const txt = row.querySelector<HTMLInputElement>('input[data-tok]');
        if (txt) {
            if (document.activeElement !== txt) txt.value = own || '';
            txt.placeholder = cur;
        }
        const col = row.querySelector<HTMLInputElement>('input[data-tok-color]');
        const c = parseColor(cur);
        if (col && c && document.activeElement !== col) col.value = toHex(c);
    });
}

function syncAllRows(): void {
    _panel?.querySelectorAll<HTMLElement>('.bte-row[data-row]').forEach((r) => syncRow(r.dataset.row!));
}

// ── Basics ─────────────────────────────────────────────────────────────────────────────────

function buildBasics(): string {
    const light = isLightTheme(_draft);
    const starters = BUILTIN_THEMES.map((b) => {
        const bg = b.vars?.['--bmm-bg-base'] || '#0a0e17';
        const ac = b.vars?.['--bmm-accent'] || '#3b82f6';
        return `<button type="button" class="bte-starter" data-bte="starter" data-id="${escAttr(b.id)}" data-tooltip="${escAttr(b.description || b.name)}">
            <span class="bte-starter-sw" style="background:${cssColor(bg)}"><span style="background:${cssColor(ac)}"></span></span>
            <span class="bte-starter-name">${escHtml(b.name)}</span>
        </button>`;
    }).join('');
    const accent = parseColor(resolved('--bmm-accent'));
    const groups = BASIC_GROUPS.map((g) => `
        <section class="bte-group">
            <h3 class="bte-group-title">${escHtml(t(`themes.ed.basic.${g}`))}</h3>
            ${TOKEN_CATALOG.filter((d) => d.basic === g).map((d) => tokenRow(d, { showDesc: true })).join('')}
        </section>`).join('');
    return `
        <div class="bte-block">
            <h3 class="bte-group-title">${escHtml(t('themes.ed.mode'))}</h3>
            <div class="bte-seg" role="group" aria-label="${escAttr(t('themes.ed.mode'))}">
                <button type="button" class="bte-seg-btn${light ? '' : ' active'}" data-bte="mode" data-mode="dark" aria-pressed="${!light}">${escHtml(t('themes.modeDark'))}</button>
                <button type="button" class="bte-seg-btn${light ? ' active' : ''}" data-bte="mode" data-mode="light" aria-pressed="${light}">${escHtml(t('themes.modeLight'))}</button>
            </div>
            <p class="bte-hint">${escHtml(t('themes.ed.modeHint'))}</p>
            <label class="bte-check" data-tooltip="${escAttr(t('themes.contrastHint'))}">
                <input type="checkbox" data-bte-field="enforcer"${isContrastEnforced() ? ' checked' : ''}> <span>${escHtml(t('themes.contrastToggle'))}</span>
            </label>
        </div>
        <div class="bte-block">
            <h3 class="bte-group-title">${escHtml(t('themes.ed.generate'))}</h3>
            <div class="bte-gen">
                <input type="color" id="bte-gen-colour" value="${accent ? toHex(accent) : '#3b82f6'}" aria-label="${escAttr(t('themes.genHint'))}">
                <button type="button" class="btn btn-secondary btn-sm" data-bte="generate">${uiIcon('generate', 16)} ${escHtml(light ? t('themes.genLight') : t('themes.genDark'))}</button>
            </div>
            <p class="bte-hint">${escHtml(t('themes.ed.generateHint'))}</p>
        </div>
        <div class="bte-block">
            <h3 class="bte-group-title">${escHtml(t('themes.ed.startFrom'))}</h3>
            <div class="bte-starters">${starters}</div>
            <p class="bte-hint">${escHtml(t('themes.ed.startFromHint'))}</p>
        </div>
        ${groups}`;
}

// ── All tokens ─────────────────────────────────────────────────────────────────────────────

function allTokenKeys(): string[] {
    const keys = new Set<string>(TOKEN_CATALOG.map((d) => d.key));
    for (const k of Object.keys(tokenDefaults())) if (!isInternalToken(k)) keys.add(k);
    // A token the draft sets that tokens.css does not know (a newer BMM, a typo) is shown
    // too: it is in the file, so it has to be editable and removable.
    for (const k of Object.keys(_draft.vars || {})) if (!isInternalToken(k)) keys.add(k);
    return [...keys];
}

function buildTokens(): string {
    return `
        <div class="bte-search-row">
            <span class="bte-search">${uiIcon('search', 14)}
                <input type="search" id="bte-tok-search" data-bte-field="search" value="${escAttr(_search)}" placeholder="${escAttr(t('themes.ed.searchTokens'))}" aria-label="${escAttr(t('themes.ed.searchTokens'))}">
            </span>
            <label class="bte-check"><input type="checkbox" data-bte-field="only-changed"${_onlyChanged ? ' checked' : ''}> <span>${escHtml(t('themes.ed.onlyChanged'))}</span></label>
        </div>
        <div id="bte-tok-list"></div>`;
}

function renderTokenList(): void {
    const box = _panel?.querySelector('#bte-tok-list') as HTMLElement | null;
    if (!box) return;
    const q = _search.trim().toLowerCase();
    const defs = allTokenKeys().map(tokenDef).filter((d) => {
        if (_onlyChanged && !(_draft.vars?.[d.key])) return false;
        if (!q) return true;
        return [d.key, tokLabel(d), tokDesc(d)].some((s) => s.toLowerCase().includes(q));
    });
    if (!defs.length) { box.innerHTML = `<p class="bte-empty">${escHtml(t('themes.ed.noTokenMatch'))}</p>`; return; }
    box.innerHTML = TOKEN_GROUPS.map((g) => {
        const rows = defs.filter((d) => d.group === g);
        if (!rows.length) return '';
        const set = rows.filter((d) => _draft.vars?.[d.key]).length;
        return `<details class="bte-group bte-fold" open>
            <summary class="bte-group-title">${escHtml(t(`themes.ed.grp.${g}`))}${set ? `<span class="bte-count">${set}</span>` : ''}</summary>
            ${rows.map((d) => tokenRow(d, { showKey: true, showDesc: !!q })).join('')}
        </details>`;
    }).join('');
}

// ── Pictures ───────────────────────────────────────────────────────────────────────────────

function buildPictures(): string {
    const assets = (_draft.assets || {}) as Record<string, string>;
    const row = (key: string, label: string, desc: string, accept: string) => `
        <div class="bte-asset">
            <div class="bte-asset-text">
                <span class="bte-row-label">${escHtml(label)}</span>
                <span class="bte-row-desc">${escHtml(desc)}</span>
            </div>
            <span class="bte-asset-state${assets[key] ? ' is-set' : ''}">${escHtml(assets[key] ? t('themes.ed.assetSetShort') : t('themes.assetDefault'))}</span>
            <button type="button" class="btn btn-secondary btn-sm" data-bte="asset-pick" data-asset="${key}" data-accept="${accept}">${escHtml(t('themes.choose'))}</button>
            ${assets[key] ? `<button type="button" class="bte-mini" data-bte="asset-clear" data-asset="${key}" aria-label="${escAttr(t('themes.clear'))}">${uiIcon('close', 14)}</button>` : ''}
        </div>`;
    // Tasky, the BMM logo or the BMM badge wherever the mascot appears (brand.mark). A picture
    // of your own (the mascot row below) wins over all three.
    const mark = brandMark(_draft);
    const markBtn = (m: string, label: string) =>
        `<button type="button" class="bte-seg-btn${mark === m ? ' active' : ''}" data-bte="brand-mark" data-mark="${m}" aria-pressed="${mark === m}">${escHtml(label)}</button>`;
    return `
        <div class="bte-block">
            <h3 class="bte-group-title">${escHtml(t('themes.ed.brandMark'))}</h3>
            <div class="bte-seg" role="group" aria-label="${escAttr(t('themes.ed.brandMark'))}">
                ${markBtn('tasky', t('themes.ed.brandMarkTasky'))}${markBtn('logo', t('themes.ed.brandMarkLogo'))}${markBtn('badge', t('themes.ed.brandMarkBadge'))}
            </div>
            <p class="bte-hint">${escHtml(t('themes.ed.brandMarkHint'))}</p>
        </div>
        <p class="bte-hint">${escHtml(t('themes.assetsDesc'))}</p>
        <section class="bte-group">
            ${row('mascot', t('themes.assetMascot'), t('themes.assetMascotDesc'), 'image/*')}
            ${row('logo', t('themes.assetLogo'), t('themes.assetLogoDesc'), 'image/*')}
            ${row('wallpaper', t('themes.assetWallpaper'), t('themes.assetWallpaperDesc'), 'image/*,video/*')}
        </section>
        <section class="bte-group">
            <h3 class="bte-group-title">${escHtml(t('themes.ed.grp.images'))}</h3>
            ${TOKEN_CATALOG.filter((d) => d.group === 'images').map((d) => tokenRow(d, { showDesc: true })).join('')}
        </section>`;
}

// ── Elements: per-element styles and your own HTML ─────────────────────────────────────────

const PAGE_OPTIONS = [
    { id: 'library', label: 'Library' }, { id: 'profiles', label: 'Profiles' },
    { id: 'modpacks', label: 'Modpacks' }, { id: 'mapper', label: 'Mapper' },
    { id: 'repo', label: 'Server Repo' }, { id: 'plugins', label: 'Plugins & API' },
    { id: 'apps', label: 'App Catalog' }, { id: 'docs', label: 'Help & Other' },
    { id: 'settings', label: 'Settings' }, { id: 'credits', label: 'Credits' },
    { id: 'community', label: 'BetterCommunity' }, { id: 'modlist', label: '.MM Lists' },
];

/** Shared elements that can be restyled without hunting for them with the pick tool. */
const TARGETS: Array<{ label: string; sel: string }> = [
    { label: 'Buttons', sel: '.btn' }, { label: 'Primary buttons', sel: '.btn-primary' },
    { label: 'Secondary buttons', sel: '.btn-secondary' }, { label: 'Ghost buttons', sel: '.btn-ghost' },
    { label: 'Danger buttons', sel: '.btn-danger' }, { label: 'Text fields', sel: '.form-input, .input' },
    { label: 'Dropdowns', sel: '.bmm-csel-trigger' }, { label: 'Dropdown menus', sel: '.bmm-csel-menu' },
    { label: 'Switches', sel: '.toggle-slider, .bmm-switch-track' }, { label: 'Cards', sel: '.glass-card' },
    { label: 'Mod cards', sel: '.mod-card' }, { label: 'Dialogs', sel: '.modal-overlay .modal' },
    { label: 'Dialog headers', sel: '.modal-header' }, { label: 'Notifications', sel: '.toast' },
    { label: 'Search boxes', sel: '.search-box' }, { label: 'Filter pills', sel: '.filter-btn' },
    { label: 'Progress bars', sel: '.progress-bar' }, { label: 'Tasky tooltip', sel: '.tasky-speech-bubble' },
    { label: 'Title bar', sel: '.titlebar' }, { label: 'Sidebar', sel: '.sidebar' },
    { label: 'Nav items', sel: '.nav-item' }, { label: 'Active nav item', sel: '.nav-item.active' },
    { label: 'Page titles', sel: '.view-title' }, { label: 'Card titles', sel: '.card-title' },
    ...PAGE_OPTIONS.map((p) => ({ label: p.label, sel: `#view-${p.id}` })),
];

/** Ready-made HTML the user is handed to edit (the words are THEIR placeholders, see
 *  check-hardcoded-text's ALLOW list). */
const CE_TEMPLATES: Array<{ key: string; html: string }> = [
    { key: 'button', html: '<button class="btn btn-sm btn-primary" data-bmm-deeplink="bmm://restart">My button</button>' },
    { key: 'banner', html: '<div style="padding:10px 14px;border-radius:10px;background:var(--bmm-accent-dim);color:var(--bmm-text-primary);font-weight:600;">My custom banner</div>' },
    { key: 'badge', html: '<span style="padding:3px 9px;border-radius:999px;background:var(--bmm-accent);color:var(--bmm-text-on-accent);font-size:11px;font-weight:700;">NEW</span>' },
    { key: 'note', html: '<p style="margin:8px 0;color:var(--bmm-text-secondary);font-size:13px;">My note text…</p>' },
    { key: 'link', html: '<a href="#" data-bmm-deeplink="bmm://repo/sync?url=URL" style="color:var(--bmm-accent);font-weight:600;">My link →</a>' },
];

function posLabel(p: string): string {
    return ({ append: t('themes.posAppend'), prepend: t('themes.posPrepend'), before: t('themes.posBefore'), after: t('themes.posAfter') } as Record<string, string>)[p] || p;
}

function buildElements(): string {
    const ovs: ElementOverride[] = _draft.element_overrides || [];
    const ces: CustomElement[] = _draft.custom_elements || [];
    const editing = _editingCeId ? ces.find((c) => c.id === _editingCeId) || null : null;
    const pageOpts = [`<option value="">${escHtml(t('themes.allPages'))}</option>`, ...PAGE_OPTIONS.map((p) =>
        `<option value="${p.id}"${(editing?.scope || '') === p.id ? ' selected' : ''}>${escHtml(p.label)}</option>`)].join('');
    return `
        <section class="bte-group">
            <h3 class="bte-group-title">${escHtml(t('themes.ed.elStyles'))}</h3>
            <p class="bte-hint">${escHtml(t('themes.ed.elStylesHint'))}</p>
            <button type="button" class="btn btn-secondary btn-sm" data-bte="pick">${uiIcon('pick', 16)} ${escHtml(t('themes.ed.pickOnScreen'))}</button>
            ${ovs.length ? `<ul class="bte-list">${ovs.map((o) => `
                <li class="bte-list-row">
                    <code class="bte-list-main">${escHtml(o.selector)}</code>
                    <span class="bte-list-meta">${Object.keys(o.props || {}).length} ${escHtml(t('themes.props'))}</span>
                    <button type="button" class="bte-mini" data-bte="ov-edit" data-sel="${escAttr(o.selector)}" aria-label="${escAttr(t('common.edit'))}">${uiIcon('edit', 14)}</button>
                    <button type="button" class="bte-mini" data-bte="ov-del" data-sel="${escAttr(o.selector)}" aria-label="${escAttr(t('common.delete'))}">${uiIcon('delete', 14)}</button>
                </li>`).join('')}</ul>` : ''}
            <details class="bte-fold">
                <summary class="bte-sub">${escHtml(t('themes.modalsTargets'))}</summary>
                <div class="bte-chips">${TARGETS.map((x) => `<button type="button" class="bte-chip" data-bte="target" data-sel="${escAttr(x.sel)}">${escHtml(x.label)}</button>`).join('')}</div>
            </details>
        </section>
        <section class="bte-group">
            <h3 class="bte-group-title">${escHtml(t('themes.ceYour'))}</h3>
            <p class="bte-hint">${escHtml(t('themes.ceIntro'))}</p>
            ${ces.length ? `<ul class="bte-list">${ces.map((c) => `
                <li class="bte-list-row">
                    <code class="bte-list-main">${escHtml(c.target)}</code>
                    <span class="bte-list-meta">${escHtml(posLabel(c.position))} · ${escHtml(c.scope || t('themes.allPages'))}</span>
                    <button type="button" class="bte-mini" data-bte="ce-edit" data-id="${escAttr(c.id)}" aria-label="${escAttr(t('common.edit'))}">${uiIcon('edit', 14)}</button>
                    <button type="button" class="bte-mini" data-bte="ce-del" data-id="${escAttr(c.id)}" aria-label="${escAttr(t('common.delete'))}">${uiIcon('delete', 14)}</button>
                </li>`).join('')}</ul>` : `<p class="bte-empty">${escHtml(t('themes.noCe'))}</p>`}
            <div class="bte-form">
                <h4 class="bte-sub">${escHtml(editing ? t('common.edit') : t('themes.ceAdd'))}</h4>
                <label class="bte-field-label" for="bte-ce-target">${escHtml(t('themes.ceWhere'))}</label>
                <div class="bte-inline">
                    <input id="bte-ce-target" class="bte-input" type="text" spellcheck="false" placeholder="#view-library .view-header" value="${escAttr(editing?.target || '')}">
                    <button type="button" class="btn btn-ghost btn-sm" data-bte="ce-pick" aria-label="${escAttr(t('themes.cePickSpot'))}" data-tooltip="${escAttr(t('themes.cePickSpot'))}">${uiIcon('pick', 16)}</button>
                </div>
                <div class="bte-grid2">
                    <label class="bte-field-label">${escHtml(t('themes.cePosition'))}
                        <select id="bte-ce-pos" class="bte-input bte-select">${['append', 'prepend', 'before', 'after'].map((p) => `<option value="${p}"${(editing?.position || 'append') === p ? ' selected' : ''}>${escHtml(posLabel(p))}</option>`).join('')}</select>
                    </label>
                    <label class="bte-field-label">${escHtml(t('themes.ceScope'))}
                        <select id="bte-ce-scope" class="bte-input bte-select">${pageOpts}</select>
                    </label>
                </div>
                <label class="bte-field-label" for="bte-ce-html">${escHtml(t('themes.ceWhat'))}</label>
                <div class="bte-chips">${CE_TEMPLATES.map((x) => `<button type="button" class="bte-chip" data-bte="ce-tpl" data-tpl="${escAttr(x.html)}">${escHtml(t(`themes.ed.tpl.${x.key}`))}</button>`).join('')}</div>
                <textarea id="bte-ce-html" class="bte-input bte-code" rows="4" spellcheck="false" placeholder="${escAttr(t('themes.ceHtmlPh'))}">${escHtml(editing?.html || '')}</textarea>
                <p class="bte-hint">${escHtml(t('themes.ceDeeplinkTip'))} <code>data-bmm-deeplink="bmm://…"</code></p>
                <label class="bte-field-label" for="bte-ce-css">${escHtml(t('themes.ceCss'))}</label>
                <textarea id="bte-ce-css" class="bte-input bte-code" rows="2" spellcheck="false">${escHtml(editing?.css || '')}</textarea>
                <div class="bte-inline bte-end">
                    ${editing ? `<button type="button" class="btn btn-ghost btn-sm" data-bte="ce-cancel">${escHtml(t('common.cancel'))}</button>` : ''}
                    <button type="button" class="btn btn-primary btn-sm" data-bte="ce-commit">${uiIcon('add', 16)} ${escHtml(editing ? t('themes.ceSaveChanges') : t('themes.ceAddBtn'))}</button>
                </div>
            </div>
        </section>`;
}

// ── CSS ────────────────────────────────────────────────────────────────────────────────────

function buildCss(): string {
    const css = _cssPage === 'global' ? (_draft.global_css || '') : (_draft.pages?.[_cssPage]?.css || '');
    return `
        <label class="bte-field-label">${escHtml(t('themes.editScope'))}
            <select class="bte-input bte-select" data-bte-field="css-page">
                <option value="global"${_cssPage === 'global' ? ' selected' : ''}>${escHtml(t('themes.advGlobal'))}</option>
                ${PAGE_OPTIONS.map((p) => `<option value="${p.id}"${p.id === _cssPage ? ' selected' : ''}>${escHtml(p.label)}</option>`).join('')}
            </select>
        </label>
        <p class="bte-hint">${escHtml(t('themes.ed.cssHint'))} <code>${escHtml(_cssPage === 'global' ? ':root, body…' : `#view-${_cssPage}`)}</code></p>
        <textarea class="bte-input bte-code bte-css-box" data-bte-field="css" spellcheck="false" rows="18" placeholder="/* CSS */">${escHtml(css)}</textarea>`;
}

// ── Library ────────────────────────────────────────────────────────────────────────────────

function buildLibrary(): string {
    const active = getActiveTheme();
    const mine = getInstalledThemes().filter((x) => !BUILTIN_THEMES.some((b) => b.id === x.id));
    const item = (th: BmmTheme, builtin: boolean) => {
        const bg = th.vars?.['--bmm-bg-base'] || '#0a0e17';
        const ac = th.vars?.['--bmm-accent'] || '#3b82f6';
        const on = active?.id === th.id;
        const editing = _baseId === th.id;
        return `<li class="bte-lib-row${editing ? ' is-editing' : ''}">
            <span class="bte-starter-sw" style="background:${cssColor(bg)}"><span style="background:${cssColor(ac)}"></span></span>
            <span class="bte-lib-text">
                <span class="bte-lib-name">${escHtml(th.name || th.id)}${on ? `<span class="bte-tag">${escHtml(t('themes.active'))}</span>` : ''}${editing ? `<span class="bte-tag">${escHtml(t('themes.ed.editingTag'))}</span>` : ''}</span>
                ${th.description ? `<span class="bte-lib-desc">${escHtml(th.description)}</span>` : ''}
            </span>
            <span class="bte-lib-actions">
                <button type="button" class="btn btn-ghost btn-xs" data-bte="lib-edit" data-id="${escAttr(th.id)}">${escHtml(t('themes.edit'))}</button>
                <button type="button" class="btn btn-ghost btn-xs" data-bte="lib-apply" data-id="${escAttr(th.id)}"${on ? ' disabled' : ''}>${escHtml(t('themes.apply'))}</button>
                <button type="button" class="bte-mini" data-bte="lib-export" data-id="${escAttr(th.id)}" aria-label="${escAttr(t('themes.exportBtn'))}" data-tooltip="${escAttr(t('themes.exportBtn'))}">${uiIcon('export', 14)}</button>
                ${builtin
                    ? `<button type="button" class="bte-mini" data-bte="lib-hide" data-id="${escAttr(th.id)}" aria-label="${escAttr(t('themes.uninstall'))}" data-tooltip="${escAttr(t('themes.uninstall'))}">${uiIcon('eye-off', 14)}</button>`
                    : `<button type="button" class="bte-mini" data-bte="lib-delete" data-id="${escAttr(th.id)}" aria-label="${escAttr(t('common.delete'))}" data-tooltip="${escAttr(t('common.delete'))}">${uiIcon('delete', 14)}</button>`}
            </span>
        </li>`;
    };
    return `
        <div class="bte-inline">
            <button type="button" class="btn btn-secondary btn-sm" data-bte="import">${uiIcon('import', 16)} ${escHtml(t('themes.ed.importFile'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-bte="catalogue">${uiIcon('store', 16)} ${escHtml(t('themes.catalogue'))}</button>
        </div>
        <section class="bte-group">
            <h3 class="bte-group-title">${escHtml(t('themes.mine'))}</h3>
            ${mine.length ? `<ul class="bte-list">${mine.map((x) => item(x, false)).join('')}</ul>` : `<p class="bte-empty">${escHtml(t('themes.ed.noOwn'))}</p>`}
        </section>
        <section class="bte-group">
            <h3 class="bte-group-title">${escHtml(t('themes.defaultThemes'))}</h3>
            <ul class="bte-list">${BUILTIN_THEMES.map((x) => item(x, true)).join('')}</ul>
        </section>`;
}

// ── Preview stage ──────────────────────────────────────────────────────────────────────────

const STAGE_STYLE_ID = 'bte-stage-style';

/**
 * The sandbox: two rules in one <style>. The first gives the stage every token tokens.css
 * declares, at its default — so the preview starts from BMM's base look, not from whatever
 * theme the app is wearing, and the tokens defined from other tokens (borders from the
 * surface tint, notifications from the card colour…) are recomputed INSIDE the stage. The
 * second, more specific, carries the draft's own values (rootVars: the same declarations the
 * engine writes on :root). Nothing leaves the stage.
 */
function paintStage(): void {
    let el = document.getElementById(STAGE_STYLE_ID) as HTMLStyleElement | null;
    if (!el) { el = document.createElement('style'); el.id = STAGE_STYLE_ID; document.head.appendChild(el); }
    const decl = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `  ${k}: ${v};`).join('\n');
    const vars = rootVars(_draft);
    el.textContent = `#bmm-theme-editor .bte-stage {\n${decl(tokenDefaults())}\n}\n`
        + `#bmm-theme-editor .bte-stage.bte-stage--draft {\n${decl(vars)}\n}\n`;
    const stage = _panel?.querySelector('.bte-stage') as HTMLElement | null;
    stage?.classList.toggle('bte-stage--light', isLightTheme(_draft));
    // The stage's own pictures follow the draft's assets.
    // An embedded picture of the theme's own wins; else the BMM logo when the draft asks for it.
    const mascot = (_draft.assets as Record<string, string> | undefined)?.mascot;
    const img = _panel?.querySelector('.bte-pv-mascot') as HTMLImageElement | null;
    if (img) img.src = mascot && /^(data:image\/|https?:)/i.test(mascot) ? mascot : (brandMascotSrc(_draft) || 'assets/Tasky.png');
}

function renderStage(): void {
    const wrap = _panel?.querySelector('#bte-stage-wrap') as HTMLElement | null;
    if (!wrap) return;
    const p = (k: string) => escHtml(t(`themes.ed.pv.${k}`));
    const nav = (icon: Parameters<typeof uiIcon>[0], label: string, active = false) =>
        `<span class="nav-item${active ? ' active' : ''}"><span class="nav-icon">${uiIcon(icon, 16)}</span><span>${label}</span></span>`;
    const mod = (name: string, meta: string, badge: string, on: boolean) => `
        <div class="bte-pv-mod">
            <span class="bte-pv-mod-ic">${uiIcon('mod', 16)}</span>
            <span class="bte-pv-mod-text"><span class="bte-pv-mod-name">${escHtml(name)}</span><span class="bte-pv-mod-meta">${meta}</span></span>
            ${badge}
            <span class="bmm-switch" aria-hidden="true"><input type="checkbox" tabindex="-1"${on ? ' checked' : ''}><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></span>
        </div>`;
    wrap.innerHTML = `
        <div class="bte-stage bte-stage--draft" aria-label="${escAttr(t('themes.ed.previewTitle'))}" role="group">
            <div class="bte-pv-titlebar"><span class="bte-pv-brand">Better Mod Manager</span><span class="bte-pv-win" aria-hidden="true"><i></i><i></i><i></i></span></div>
            <div class="bte-pv-body">
                <div class="bte-pv-side">
                    ${nav('mod', p('library'), true)}${nav('profile', p('profiles'))}${nav('server', p('repo'))}${nav('settings', p('settings'))}
                </div>
                <div class="bte-pv-main">
                    <div class="bte-pv-head">
                        <span class="bte-pv-title">${p('library')}</span>
                        <span class="search-box bte-pv-search">${uiIcon('search', 14)}<input class="form-input" type="text" tabindex="-1" placeholder="${escAttr(t('themes.ed.pv.search'))}"></span>
                    </div>
                    <div class="bte-pv-filters">
                        <span class="filter-btn active">${p('all')}</span><span class="filter-btn">${p('enabled')}</span><span class="filter-btn">${p('updates')}</span>
                    </div>
                    <div class="glass-card bte-pv-card">
                        ${mod('Better Trees', p('meta1'), `<span class="kit-badge kit-badge-success">${p('enabled')}</span>`, true)}
                        ${mod('HD Textures', p('meta2'), `<span class="kit-badge kit-badge-warning">${p('update')}</span>`, true)}
                        ${mod('Quiet Nights', p('meta3'), `<span class="kit-badge kit-badge-danger">${p('conflict')}</span>`, false)}
                    </div>
                    <div class="bte-pv-buttons">
                        <span class="btn btn-primary btn-sm">${uiIcon('play', 14)} ${p('launch')}</span>
                        <span class="btn btn-secondary btn-sm">${p('secondary')}</span>
                        <span class="btn btn-ghost btn-sm">${p('ghost')}</span>
                        <span class="btn btn-danger btn-sm">${p('delete')}</span>
                    </div>
                    <div class="bte-pv-row">
                        <div class="bte-pv-dialog">
                            <div class="bte-pv-dialog-head"><span class="bte-pv-dialog-title">${p('dialogTitle')}</span><span class="bte-pv-dialog-sub">${p('dialogSub')}</span></div>
                            <div class="bte-pv-dialog-body">
                                <span class="bte-pv-label">${p('field')}</span>
                                <input class="form-input" type="text" tabindex="-1" value="${escAttr(t('themes.ed.pv.fieldValue'))}">
                                <span class="bte-pv-muted">${p('hint')}</span>
                            </div>
                            <div class="bte-pv-dialog-foot"><span class="btn btn-ghost btn-sm">${p('cancel')}</span><span class="btn btn-primary btn-sm">${p('save')}</span></div>
                        </div>
                        <div class="bte-pv-stack">
                            <div class="toast toast-success">${uiIcon('success', 16)}<span>${p('toastOk')}</span></div>
                            <div class="toast toast-warning">${uiIcon('warning', 16)}<span>${p('toastWarn')}</span></div>
                            <div class="bte-pv-bubble">${p('tip')}</div>
                        </div>
                    </div>
                </div>
            </div>
            <img class="bte-pv-mascot" src="assets/Tasky.png" alt="" draggable="false">
        </div>`;
    paintStage();
    renderContrast();
}

// ── Contrast ───────────────────────────────────────────────────────────────────────────────

function contrastRows(): ContrastResult[] {
    return checkContrast((k) => resolved(k) || null);
}

function renderContrast(): void {
    const box = _panel?.querySelector('#bte-contrast') as HTMLElement | null;
    if (!box) return;
    const rows = contrastRows();
    const failing = rows.filter((r) => !r.pass);
    const gradeLabel = (r: ContrastResult) => r.grade === 'fail' ? t('themes.ed.gradeFail') : r.grade === 'AA-large' ? t('themes.ed.gradeLarge') : r.grade || '';
    // Folded while everything passes (the preview gets the room), opened by a failure; a fold
    // the user opened or closed stays as they left it.
    const prev = box.querySelector('details');
    const open = failing.length > _contrastFailing ? true : prev ? prev.open : failing.length > 0;
    _contrastFailing = failing.length;
    box.innerHTML = `<details class="bte-contrast-fold"${open ? ' open' : ''}>
        <summary class="bte-contrast-head">
            <span class="bte-view-title">${uiIcon('contrast', 14)} ${escHtml(t('themes.ed.contrastTitle'))}</span>
            <span class="bte-contrast-sum${failing.length ? ' is-fail' : ''}">${escHtml(t('themes.ed.contrastSum', { ok: String(rows.length - failing.length), n: String(rows.length) }))}</span>
            ${failing.length ? `<button type="button" class="btn btn-secondary btn-xs" data-bte="fix-all">${escHtml(t('themes.ed.fixAll'))}</button>` : ''}
        </summary>
        <ul class="bte-contrast-list">
            ${rows.map((r) => {
                const fg = resolved(r.pair.fg), bg = resolved(r.pair.bg);
                return `<li class="bte-cr${r.pass ? '' : ' is-fail'}">
                    <span class="bte-cr-sample" style="color:${cssColor(fg)};background:${cssColor(bg)}" aria-hidden="true">Aa</span>
                    <span class="bte-cr-text">
                        <span class="bte-cr-name">${escHtml(t(`themes.ed.pair.${r.pair.id}`))}</span>
                        <span class="bte-cr-need">${escHtml(t('themes.ed.needs', { n: String(r.pair.min) }))}</span>
                    </span>
                    <span class="bte-cr-ratio">${r.ratio === null ? '—' : `${r.ratio.toFixed(2)}:1`}</span>
                    <span class="bte-grade bte-grade--${r.pass ? 'ok' : 'bad'}">${escHtml(r.ratio === null ? t('themes.ed.gradeNa') : gradeLabel(r))}</span>
                    ${r.fix ? `<button type="button" class="btn btn-ghost btn-xs" data-bte="fix" data-key="${escAttr(r.pair.fg)}" data-value="${escAttr(r.fix)}" data-tooltip="${escAttr(t('themes.ed.fixTip', { v: r.fix }))}">${escHtml(t('themes.ed.fix'))}</button>` : ''}
                </li>`;
            }).join('')}
        </ul></details>`;
}

// ── Draft changes ──────────────────────────────────────────────────────────────────────────

function isDirty(): boolean {
    return JSON.stringify(_draft) !== _savedJson;
}

/** Record the change, then bring the preview and chrome up to date. */
function changed(mergeKey: string | null = null, rerender = false): void {
    _history.record(_draft, mergeKey);
    paintStage();   // before the rows: they read their values from the stage
    if (rerender) renderSide();
    refresh();
}

function setVar(key: string, value: string, mergeKey: string | null = key): boolean {
    const v = value.trim();
    if (v && !isSafeCssValue(v)) return false;
    if (!_draft.vars) _draft.vars = {};
    if (!v) delete _draft.vars[key];
    else _draft.vars[key] = v;
    // The accent's channels follow it when the theme carries them (older themes wrote them).
    if (key === '--bmm-accent') {
        const c = parseColor(v);
        for (const ch of ['r', 'g', 'b'] as const) {
            if (_draft.vars[`--bmm-accent-${ch}`] !== undefined) {
                if (c) _draft.vars[`--bmm-accent-${ch}`] = String(Math.round(c[ch]));
                else delete _draft.vars[`--bmm-accent-${ch}`];
            }
        }
    }
    changed(mergeKey);
    syncRow(key);
    return true;
}

function liveApply(): void {
    applyTheme({ ...(clone(_draft) as BmmTheme), id: '__preview__' });
}

function restoreApp(): void {
    if (_appTheme) applyTheme(clone(_appTheme));
    else resetTheme();
}

/** The draft as it would be written: current format, an id, a name. */
function draftForSave(): Draft {
    const d = migrateTheme(_draft).theme as unknown as Draft;
    if (!d.id) d.id = 'unsaved';
    return d;
}

// ── Events ─────────────────────────────────────────────────────────────────────────────────

function onClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-bte]');
    if (!btn || !_panel?.contains(btn)) return;
    const act = btn.dataset.bte!;
    const id = btn.dataset.id || '';
    switch (act) {
        case 'section': _section = btn.dataset.section as Section; renderSide(); break;
        case 'undo': undoRedo(true); break;
        case 'redo': undoRedo(false); break;
        case 'pick': togglePickToken(); break;
        case 'reset': void confirmReset(); break;
        case 'dock': setDock(!isDocked()); break;
        case 'close': void requestClose(); break;
        case 'issues': void showIssues(); break;
        case 'file-menu': {
            e.stopPropagation();
            const menu = _panel.querySelector('#bte-file-menu') as HTMLElement;
            menu.hidden = !menu.hidden;
            break;
        }
        case 'import': closeMenu(); void importFile(); break;
        case 'export': closeMenu(); void exportDraft(); break;
        case 'copy-json': closeMenu(); void copyJson(); break;
        case 'share': closeMenu(); void shareTheme(); break;
        case 'save': void save(false); break;
        case 'save-as': void save(true); break;
        case 'reveal': revealToken(btn.dataset.key!); break;
        case 'tok-reset': setVar(btn.dataset.key!, '', null); break;
        case 'mode': switchMode(btn.dataset.mode as 'dark' | 'light'); break;
        case 'generate': {
            const colour = (_panel.querySelector('#bte-gen-colour') as HTMLInputElement)?.value || '#3b82f6';
            const pal = generatePalette(colour, isLightTheme(_draft));
            _draft.vars = { ...(_draft.vars || {}), ...pal.vars };
            _draft.mode = pal.mode;
            changed(null, true);
            toast(t('themes.genDone'), 'success', 1800);
            break;
        }
        case 'starter': {
            const b = BUILTIN_THEMES.find((x) => x.id === id);
            if (!b) break;
            // The look of the starting point; your name, pictures, elements and CSS stay.
            _draft.vars = clone(b.vars || {});
            if (b.mode) _draft.mode = b.mode; else delete _draft.mode;
            changed(null, true);
            break;
        }
        case 'fix': setVar(btn.dataset.key!, btn.dataset.value!, null); renderContrast(); break;
        case 'fix-all': {
            e.preventDefault();   // it sits in the fold's summary: fixing must not fold it
            for (let pass = 0; pass < 3; pass++) {
                const bad = contrastRows().filter((r) => !r.pass && r.fix);
                if (!bad.length) break;
                if (!_draft.vars) _draft.vars = {};
                for (const r of bad) _draft.vars[r.pair.fg] = r.fix!;
                paintStage();
            }
            changed(null, true);
            break;
        }
        case 'brand-mark': {
            // Tasky is the default, so it is written as no field at all: a theme that never
            // touched this stays byte-for-byte what it was. Other keys under `brand` are kept.
            const brand = { ...((_draft.brand as Record<string, unknown> | undefined) || {}) };
            const m = btn.dataset.mark;
            if (m === 'logo' || m === 'badge') brand.mark = m; else delete brand.mark;
            if (Object.keys(brand).length) _draft.brand = brand as BmmTheme['brand']; else delete _draft.brand;
            changed(null, true);
            break;
        }
        case 'asset-pick': pickAsset(btn.dataset.asset!, btn.dataset.accept || 'image/*'); break;
        case 'asset-clear': {
            const key = btn.dataset.asset!;
            if (_draft.assets) delete (_draft.assets as Record<string, string>)[key];
            if (key === 'wallpaper' && _draft.vars?.['--bmm-app-bg-image']?.startsWith('url("data:')) delete _draft.vars['--bmm-app-bg-image'];
            changed(null, true);
            break;
        }
        case 'target': openElementOverrideEditor(document.body, btn.dataset.sel!); break;
        case 'ov-edit': openElementOverrideEditor(document.body, btn.dataset.sel!.replace(/:(hover|active)$/, '')); break;
        case 'ov-del':
            _draft.element_overrides = (_draft.element_overrides || []).filter((o) => o.selector !== btn.dataset.sel);
            changed(null, true);
            break;
        case 'ce-pick':
            toast(t('themes.pickTarget'), 'info', 2500);
            startPickTarget((sel) => {
                const inp = _panel?.querySelector('#bte-ce-target') as HTMLInputElement | null;
                if (inp) { inp.value = sel; previewElement(); }
            });
            break;
        case 'ce-tpl': {
            const ta = _panel.querySelector('#bte-ce-html') as HTMLTextAreaElement | null;
            if (!ta) break;
            const html = btn.dataset.tpl || '';
            ta.value = ta.value.trim() ? `${ta.value.trimEnd()}\n${html}` : html;
            previewElement();
            break;
        }
        case 'ce-edit': _editingCeId = id; renderSide(); break;
        case 'ce-del':
            _draft.custom_elements = (_draft.custom_elements || []).filter((c) => c.id !== id);
            document.querySelectorAll(`[data-bmm-ce="${CSS.escape(id)}"]`).forEach((n) => n.remove());
            changed(null, true);
            break;
        case 'ce-cancel': _editingCeId = null; renderSide(); if (isLive()) liveApply(); break;
        case 'ce-commit': commitElement(); break;
        case 'catalogue': (window as any).openThemeCatalog?.(); break;
        case 'lib-edit': void editFromLibrary(id); break;
        case 'lib-apply': void applyFromLibrary(id); break;
        case 'lib-export': void exportById(id); break;
        case 'lib-delete': void deleteFromLibrary(id); break;
        case 'lib-hide': void hideBuiltin(id); break;
    }
}

function closeMenu(): void {
    const menu = _panel?.querySelector('#bte-file-menu') as HTMLElement | null;
    if (menu) menu.hidden = true;
}

function onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (!_panel?.contains(el)) return;
    if (el.dataset.tok) {
        const ok = setVar(el.dataset.tok, el.value);
        el.classList.toggle('is-invalid', !ok);
        el.setAttribute('aria-invalid', ok ? 'false' : 'true');
        return;
    }
    if (el.dataset.tokColor) {
        setVar(el.dataset.tokColor, el.value);
        const txt = el.closest('.bte-row')?.querySelector<HTMLInputElement>('input[data-tok]');
        if (txt) txt.value = el.value;
        return;
    }
    switch (el.dataset.bteField) {
        case 'name': _draft.name = el.value; changed('name'); break;
        case 'search': _search = el.value; renderTokenList(); break;
        case 'css': {
            const v = (el as unknown as HTMLTextAreaElement).value;
            if (_cssPage === 'global') _draft.global_css = v;
            else {
                if (!_draft.pages) _draft.pages = {};
                (_draft.pages as any)[_cssPage] = { ...((_draft.pages as any)[_cssPage] || {}), css: v };
            }
            changed(`css:${_cssPage}`);
            break;
        }
    }
    if (el.id === 'bte-ce-target' || el.id === 'bte-ce-html' || el.id === 'bte-ce-css') previewElement();
}

function onChange(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (!_panel?.contains(el)) return;
    if (el.dataset.tokFont) {
        if (el.value) setVar(el.dataset.tokFont, el.value, null);
        const txt = el.closest('.bte-row')?.querySelector<HTMLInputElement>('input[data-tok]');
        if (txt) txt.value = el.value || txt.value;
        return;
    }
    switch (el.dataset.bteField) {
        case 'live': {
            try { localStorage.setItem(LIVE_KEY, el.checked ? '1' : '0'); } catch { /* the toggle still works for this session */ }
            if (el.checked) liveApply(); else restoreApp();
            break;
        }
        case 'enforcer': setContrastEnforced(el.checked); break;
        case 'only-changed': _onlyChanged = el.checked; renderTokenList(); break;
        case 'css-page': _cssPage = el.value; renderSide(); break;
    }
    if (el.id === 'bte-ce-pos' || el.id === 'bte-ce-scope') previewElement();
}

function onKey(e: KeyboardEvent): void {
    if (_sheetResolve && e.key === 'Escape') { e.preventDefault(); closeSheet(null); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const tag = (e.target as HTMLElement)?.tagName;
    // A text area keeps its own undo (CSS, HTML): ours would undo the whole theme instead.
    if (tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRedo(true); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); undoRedo(false); }
    else if (k === 's') { e.preventDefault(); void save(false); }
}

function undoRedo(undo: boolean): void {
    const next = undo ? _history.undo() : _history.redo();
    if (!next) return;
    _draft = next;
    const name = _panel?.querySelector('#bte-name') as HTMLInputElement | null;
    if (name) name.value = _draft.name || '';
    paintStage();
    renderSide();
    refresh();
}

function switchMode(mode: 'dark' | 'light'): void {
    if ((mode === 'light') === isLightTheme(_draft)) return;
    // The same theme in the other mode: surfaces and text rebuilt, accent and the rest kept.
    const v = deriveVariant(_draft as any, mode) as unknown as Draft;
    v.id = _draft.id;
    if (_draft.variant_of === undefined) delete v.variant_of;
    _draft = v;
    changed(null, true);
    toast(t('themes.ed.modeSwitched'), 'info', 2200);
}

// ── Inline sheet (prompts and confirmations inside the panel) ──────────────────────────────

interface SheetOpts {
    message: string;
    input?: string;
    detail?: string;
    actions: Array<{ id: string; label: string; tone?: 'primary' | 'danger' }>;
}

/** Ask in the panel itself, so it works docked, floating and popped out. Resolves with the
 *  chosen action id (or the typed text for an `ok` with an input), null when dismissed. */
function sheet(o: SheetOpts): Promise<string | null> {
    const box = _panel?.querySelector('#bte-sheet') as HTMLElement | null;
    if (!box) return Promise.resolve(null);
    if (_sheetResolve) closeSheet(null);
    box.innerHTML = `
        <p class="bte-sheet-msg">${escHtml(o.message)}</p>
        ${o.detail ? `<div class="bte-sheet-detail">${o.detail}</div>` : ''}
        ${o.input !== undefined ? `<input class="bte-input" id="bte-sheet-input" type="text" spellcheck="false" value="${escAttr(o.input)}">` : ''}
        <div class="bte-inline bte-end">
            <button type="button" class="btn btn-ghost btn-sm" data-sheet="">${escHtml(t('common.cancel'))}</button>
            ${o.actions.map((a) => `<button type="button" class="btn ${a.tone === 'danger' ? 'btn-danger' : a.tone === 'primary' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-sheet="${escAttr(a.id)}">${escHtml(a.label)}</button>`).join('')}
        </div>`;
    box.hidden = false;
    box.setAttribute('role', 'alertdialog');
    const input = box.querySelector('#bte-sheet-input') as HTMLInputElement | null;
    (input || box.querySelector<HTMLElement>('[data-sheet]:last-child'))?.focus();
    input?.select();
    return new Promise((resolve) => {
        _sheetResolve = resolve;
        box.onclick = (ev) => {
            const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-sheet]');
            if (!b) return;
            const id = b.dataset.sheet || '';
            closeSheet(id ? (input && id === 'ok' ? input.value : id) : null);
        };
        if (input) input.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); closeSheet(input.value); } };
    });
}

function closeSheet(v: string | null): void {
    const box = _panel?.querySelector('#bte-sheet') as HTMLElement | null;
    if (box) { box.hidden = true; box.innerHTML = ''; box.onclick = null; }
    const r = _sheetResolve;
    _sheetResolve = null;
    r?.(v);
}

async function confirmReset(): Promise<void> {
    const choice = await sheet({
        message: t('themes.ed.resetQuestion'),
        actions: [
            { id: 'revert', label: t('themes.ed.resetRevert') },
            { id: 'default', label: t('themes.ed.resetDefault'), tone: 'danger' },
        ],
    });
    if (choice === 'revert') {
        _draft = JSON.parse(_savedJson);
        changed(null, true);
    } else if (choice === 'default') {
        _draft = { id: _draft.id, name: _draft.name } as Draft;
        changed(null, true);
    }
}

async function showIssues(): Promise<void> {
    const issues = validateTheme(draftForSave()).filter((i) => i.level !== 'info');
    const kept = validateTheme(draftForSave()).filter((i) => i.code === 'unknownKept');
    const list = [...issues, ...kept].map((i: ThemeIssue) =>
        `<li class="bte-issue bte-issue--${i.level}"><code>${escHtml(i.path || '—')}</code> ${escHtml(tx(`themes.ed.issue.${i.code}`, i.code))}</li>`).join('');
    await sheet({
        message: issues.length ? t('themes.ed.issuesTitle') : t('themes.ed.statusOk', { v: String(THEME_FORMAT) }),
        detail: list ? `<ul class="bte-issues">${list}</ul>` : `<p class="bte-hint">${escHtml(t('themes.ed.formatExplained', { v: String(THEME_FORMAT) }))}</p>`,
        actions: [],
    });
}

// ── Save, import, export, share ────────────────────────────────────────────────────────────

function takenIds(): string[] {
    return [...BUILTIN_THEMES.map((b) => b.id), ...getInstalledThemes().map((x) => x.id)];
}

/** Save over the theme being edited when it is one of yours; otherwise (a built-in, a new
 *  draft, or « Save as new ») ask for a name and write a new theme next to the others. */
async function save(asNew: boolean): Promise<void> {
    const errors = validateTheme({ ..._draft, id: _draft.id || 'unsaved' }).filter((i) => i.level === 'error');
    if (errors.length) { await showIssues(); return; }
    let theme: Draft;
    if (!asNew && _baseIsUser && _baseId) {
        theme = { ...clone(_draft), id: _baseId, name: (_draft.name || '').trim() || _baseId };
    } else {
        const builtin = !!_baseId && BUILTIN_THEMES.some((b) => b.id === _baseId);
        const def = builtin || asNew ? t('themes.ed.copyName', { name: _draft.name || '' }) : (_draft.name || tx('themes.ed.untitled', 'My theme'));
        const name = await sheet({ message: t('themes.enterName'), input: def, actions: [{ id: 'ok', label: t('themes.ed.saveAsNew'), tone: 'primary' }] });
        if (name === null) return;
        const finalName = name.trim() || tx('themes.ed.untitled', 'My theme');
        theme = { ...clone(_draft), id: slugThemeId(finalName, takenIds()), name: finalName };
        if (!theme.author) theme.author = t('themes.ed.you');
        if (!theme.version) theme.version = '1.0.0';
        if (builtin && !theme.based_on) theme.based_on = _baseId;
    }
    try {
        await installTheme(theme as BmmTheme);
        const saved = migrateTheme(theme).theme as unknown as Draft;
        applyTheme(clone(saved) as BmmTheme);
        await invoke('set_active_theme', { themeId: saved.id }).catch(() => {});
        _appTheme = clone(saved) as BmmTheme;
        _draft = saved;
        _baseId = saved.id;
        _baseIsUser = true;
        _savedJson = JSON.stringify(_draft);
        _history.record(_draft, null);
        toast(`${t('themes.saved')}: ${saved.name}`, 'success');
        const nameEl = _panel?.querySelector('#bte-name') as HTMLInputElement | null;
        if (nameEl) nameEl.value = saved.name;
        renderSide();
        renderChrome();
    } catch (e) { toast(String(e), 'error'); }
}

async function exportDraft(): Promise<void> {
    const d = draftForSave();
    if (d.id === 'unsaved') d.id = slugThemeId(d.name || 'theme', []);
    try {
        await invoke('export_theme', { themeId: d.id, themeJson: JSON.stringify(d, null, 2) });
        toast(t('themes.exported'), 'success');
    } catch (e) { toast(String(e), 'error'); }
}

async function exportById(id: string): Promise<void> {
    const th = getCachedTheme(id) || BUILTIN_THEMES.find((b) => b.id === id);
    if (!th) return;
    try {
        await invoke('export_theme', { themeId: id, themeJson: JSON.stringify(migrateTheme(th).theme, null, 2) });
        toast(t('themes.exported'), 'success');
    } catch (e) { toast(String(e), 'error'); }
}

async function copyJson(): Promise<void> {
    try {
        await navigator.clipboard.writeText(JSON.stringify(draftForSave(), null, 2));
        toast(t('themes.ed.jsonCopied'), 'success', 1800);
    } catch (e) { toast(String(e), 'error'); }
}

/**
 * A link that installs the theme: `bmm://theme/import-inline?data=<base64 JSON>`. A theme
 * carrying pictures is too big for a link, so it is exported as a file instead.
 */
export async function shareTheme(): Promise<void> {
    const d = draftForSave();
    if (d.id === 'unsaved') { toast(t('themes.saveFirst'), 'warning'); return; }
    try {
        const json = JSON.stringify(d);
        const encoded = btoa(unescape(encodeURIComponent(json)));
        if (encoded.length > 8000) {
            toast(t('themes.shareTooLarge'), 'info', 3000);
            await exportDraft();
            return;
        }
        await navigator.clipboard.writeText(`bmm://theme/import-inline?data=${encoded}`);
        toast(t('themes.shareCopied'), 'success', 4000);
    } catch (e) { toast(String(e), 'error'); }
}

/** Import a .bmmtheme / .json: read, migrate, validate, install, then open it here. The
 *  backend never writes over a different theme with the same id (themes.rs import_id). */
async function importFile(): Promise<void> {
    const { pickFile } = await import('../../core/api.js');
    const path = await pickFile([
        { name: 'BMM Theme (.bmmtheme / .json)', extensions: ['bmmtheme', 'zip', 'json'] },
        { name: 'All files', extensions: ['*'] },
    ]);
    if (!path) return;
    try {
        const raw: string = await invoke('import_theme', { path });
        const parsed = parseThemeText(raw);
        if (!parsed.ok || !parsed.theme) {
            const list = parsed.issues.filter((i) => i.level === 'error').map((i) => `${i.path} ${tx(`themes.ed.issue.${i.code}`, i.code)}`).join(', ');
            toast(t('themes.importFailed', { list }), 'error', 5000);
            return;
        }
        await installTheme(parsed.theme as unknown as BmmTheme);
        await loadInstalledThemes();
        toast(`${t('themes.imported')}: ${parsed.theme.name}`, 'success');
        loadDraft(clone(parsed.theme) as unknown as Draft);
    } catch (e) { toast(String(e), 'error'); }
}

async function editFromLibrary(id: string): Promise<void> {
    if (isDirty()) {
        const c = await sheet({ message: t('themes.ed.switchDirty'), actions: [{ id: 'go', label: t('themes.ed.switchAnyway'), tone: 'danger' }] });
        if (c !== 'go') return;
    }
    const th = getCachedTheme(id) || BUILTIN_THEMES.find((b) => b.id === id);
    if (th) { _section = 'basics'; loadDraft(clone(th) as Draft); }
}

async function applyFromLibrary(id: string): Promise<void> {
    const th = getCachedTheme(id) || BUILTIN_THEMES.find((b) => b.id === id);
    if (!th) return;
    applyTheme(clone(th));
    await invoke('set_active_theme', { themeId: id }).catch(() => {});
    _appTheme = clone(th);
    renderSide();
}

async function deleteFromLibrary(id: string): Promise<void> {
    const c = await sheet({ message: t('themes.confirmDelete'), actions: [{ id: 'del', label: t('common.delete'), tone: 'danger' }] });
    if (c !== 'del') return;
    await deleteTheme(id);
    if (_baseId === id) { _baseIsUser = false; _baseId = null; }
    renderSide();
    renderChrome();
}

async function hideBuiltin(id: string): Promise<void> {
    const c = await sheet({ message: t('themes.confirmHideBuiltin'), actions: [{ id: 'hide', label: t('themes.uninstall') }] });
    if (c !== 'hide') return;
    try {
        await invoke('set_builtin_hidden', { themeId: id, hidden: true });
        const { loadBuiltinThemes } = await import('./theme-engine.js');
        await loadBuiltinThemes();
        toast(t('themes.uninstalled'), 'success');
    } catch (e) { toast(String(e), 'error'); }
    renderSide();
}

/** Pictures are embedded (data: URI, 4 MB at most) so a shared theme carries them. */
function pickAsset(key: string, accept: string): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) { toast(t('themes.assetTooBig'), 'warning', 4000); return; }
        const reader = new FileReader();
        reader.onload = () => {
            const uri = String(reader.result || '');
            if (!_draft.assets) _draft.assets = {};
            (_draft.assets as Record<string, string>)[key] = uri;
            if (key === 'wallpaper' && /^data:image\//i.test(uri)) {
                if (!_draft.vars) _draft.vars = {};
                _draft.vars['--bmm-app-bg-image'] = `url("${uri}")`;
            }
            changed(null, true);
            toast(t('themes.assetSet'), 'success', 1500);
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

// ── Custom elements ────────────────────────────────────────────────────────────────────────

function readElementForm(): CustomElement | null {
    const q = (s: string) => _panel?.querySelector(s) as HTMLInputElement | null;
    const target = q('#bte-ce-target')?.value.trim() || '';
    const html = (q('#bte-ce-html') as unknown as HTMLTextAreaElement | null)?.value || '';
    if (!target) return null;
    return {
        id: _editingCeId || '__ce_preview__',
        target,
        position: (q('#bte-ce-pos')?.value || 'append') as CustomElement['position'],
        scope: q('#bte-ce-scope')?.value || '',
        html,
        css: (q('#bte-ce-css') as unknown as HTMLTextAreaElement | null)?.value || '',
    };
}

/** Show the element being written in the app (temporary, nothing is recorded). */
function previewElement(): void {
    const ce = readElementForm();
    if (!ce || !ce.html) { if (isLive()) liveApply(); return; }
    const list = [...(_draft.custom_elements || []).filter((c) => c.id !== _editingCeId), ce];
    applyTheme({ ...(clone(isLive() ? _draft : (_appTheme || { id: '', name: '' })) as BmmTheme), id: '__preview__', custom_elements: list });
}

function commitElement(): void {
    const ce = readElementForm();
    if (!ce) { toast(t('themes.ceNeedsTarget'), 'warning'); return; }
    if (!_draft.custom_elements) _draft.custom_elements = [];
    if (_editingCeId) {
        const i = _draft.custom_elements.findIndex((c) => c.id === _editingCeId);
        if (i >= 0) _draft.custom_elements[i] = { ...ce, id: _editingCeId };
    } else {
        _draft.custom_elements.push({ ...ce, id: `ce-${Date.now().toString(36)}` });
    }
    _editingCeId = null;
    if (!isLive()) restoreApp();
    changed(null, true);
    toast(t('themes.ceAdded'), 'success', 1500);
}

// ── Pick on screen ─────────────────────────────────────────────────────────────────────────
// Right-click or middle-click selects, so left-click keeps the app usable while you look for
// the element. Esc cancels. Shift + right-click opens the precise per-element editor.

let _pickMode: 'token' | 'target' | null = null;
let _pickTargetCb: ((sel: string) => void) | null = null;

function togglePickToken(): void {
    if (_pickMode === 'token') { stopPick(); return; }
    stopPick();
    _pickMode = 'token';
    _panel?.querySelector('#bte-pick-token')?.classList.add('active');
    beginPick('token', onPickTokenClick);
}

function startPickTarget(cb: (sel: string) => void): void {
    stopPick();
    _pickMode = 'target';
    _pickTargetCb = cb;
    beginPick('target', onPickTargetClick);
}

function beginPick(kind: 'token' | 'target', handler: (e: MouseEvent) => void): void {
    document.body.classList.add('bte-picking');
    document.addEventListener('mouseover', onPickHover, true);
    document.addEventListener('contextmenu', handler, true);
    document.addEventListener('auxclick', handler, true);
    document.addEventListener('keydown', onPickEsc, true);
    document.getElementById('bte-pick-hint')?.remove();
    const hint = document.createElement('div');
    hint.id = 'bte-pick-hint';
    hint.className = 'bte-pick-hint';
    hint.innerHTML = `<span class="bte-pick-hint-key">${escHtml(t('themes.pickRight'))}</span>
        <span class="bte-pick-hint-or">${escHtml(t('common.or'))}</span>
        <span class="bte-pick-hint-key">${escHtml(t('themes.pickMiddle'))}</span>
        <span class="bte-pick-hint-txt">${escHtml(kind === 'token' ? t('themes.pickHintToken') : t('themes.pickHintTarget'))}</span>
        ${kind === 'token' ? `<span class="bte-pick-hint-alt">${escHtml(t('themes.pickHintShift'))}</span>` : ''}
        <span class="bte-pick-hint-esc">Esc</span>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(hint);
    toast(kind === 'token' ? t('themes.pickOn') : t('themes.pickTarget'), 'info', 3000);
}

function stopPick(): void {
    document.getElementById('bte-pick-hint')?.remove();
    _pickMode = null;
    _pickTargetCb = null;
    document.body.classList.remove('bte-picking');
    document.removeEventListener('mouseover', onPickHover, true);
    for (const h of [onPickTokenClick, onPickTargetClick]) {
        document.removeEventListener('contextmenu', h, true);
        document.removeEventListener('auxclick', h, true);
    }
    document.removeEventListener('keydown', onPickEsc, true);
    document.querySelectorAll('.bte-pick-highlight').forEach((n) => n.classList.remove('bte-pick-highlight'));
    _panel?.querySelector('#bte-pick-token')?.classList.remove('active');
}

function onPickEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopPick(); }
}

const isPickGesture = (e: MouseEvent) => e.type === 'contextmenu' || (e.type === 'auxclick' && e.button === 1);
const isPickExcluded = (el: HTMLElement | null) => !!el?.closest?.('#bte-elov, #bmm-theme-editor');

function onPickHover(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    if (isPickExcluded(el)) return;
    document.querySelectorAll('.bte-pick-highlight').forEach((n) => n.classList.remove('bte-pick-highlight'));
    el?.classList.add('bte-pick-highlight');
}

/** The colour token whose value on the app right now is this colour, if one is. */
function tokenForColour(colour: string): string | null {
    const want = parseColor(colour);
    if (!want || want.a === 0) return null;
    const root = getComputedStyle(document.documentElement);
    for (const d of TOKEN_CATALOG) {
        if (d.type !== 'color') continue;
        const c = parseColor(root.getPropertyValue(d.key).trim());
        if (c && Math.round(c.r) === Math.round(want.r) && Math.round(c.g) === Math.round(want.g)
            && Math.round(c.b) === Math.round(want.b) && Math.abs(c.a - want.a) < 0.02) return d.key;
    }
    return null;
}

function onPickTokenClick(e: MouseEvent): void {
    if (!isPickGesture(e)) return;
    const el = e.target as HTMLElement;
    if (isPickExcluded(el)) return;
    e.preventDefault(); e.stopPropagation();
    const cs = getComputedStyle(el);
    const guess = tokenForColour(cs.backgroundColor) || tokenForColour(cs.color) || tokenForColour(cs.borderTopColor);
    const precise = e.shiftKey;
    stopPick();
    if (!guess || precise) { openElementOverrideEditor(el); return; }
    _section = 'tokens';
    _search = guess;
    _onlyChanged = false;
    renderSide();
    const row = _panel?.querySelector(`.bte-row[data-row="${CSS.escape(guess)}"]`) as HTMLElement | null;
    if (row) {
        row.scrollIntoView({ block: 'center' });
        row.classList.add('bte-row-flash');
        setTimeout(() => row.classList.remove('bte-row-flash'), 1400);
    }
    toast(`${t('themes.pickHint')}: ${tokLabel(tokenDef(guess))}`, 'info', 2200);
}

function onPickTargetClick(e: MouseEvent): void {
    if (!isPickGesture(e)) return;
    const el = e.target as HTMLElement;
    if (isPickExcluded(el)) return;
    e.preventDefault(); e.stopPropagation();
    const cb = _pickTargetCb;
    stopPick();
    cb?.(buildSelectorFor(el));
}

/** A selector that resolves to this element: its id, else a short class path under the
 *  nearest element with an id. */
function buildSelectorFor(el: HTMLElement): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const seg = (node: HTMLElement): string => {
        const tag = node.tagName.toLowerCase();
        const cls = Array.from(node.classList).filter((c) => !c.startsWith('bmm-') && !c.startsWith('bte-') && c !== 'active');
        if (cls.length) return tag + '.' + cls.slice(0, 2).map((c) => CSS.escape(c)).join('.');
        const parent = node.parentElement;
        if (parent) {
            const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
            if (same.length > 1) return `${tag}:nth-of-type(${same.indexOf(node) + 1})`;
        }
        return tag;
    };
    const parts: string[] = [];
    let cur: HTMLElement | null = el;
    let root = '';
    for (let depth = 0; cur && cur !== document.body && depth < 5; depth++) {
        if (cur.id) { root = `#${CSS.escape(cur.id)} `; break; }
        parts.unshift(seg(cur));
        cur = cur.parentElement;
    }
    const built = (root + parts.join(' > ')).trim();
    try { if (document.querySelector(built) === el) return built; } catch { /* fall through */ }
    const view = el.closest('[id^="view-"]') as HTMLElement | null;
    return (view ? `#${view.id} ` : '') + el.tagName.toLowerCase();
}

/** Show what a token paints: every element on screen currently drawn in its colour flashes. */
function revealToken(key: string): void {
    const want = getComputedStyle(document.documentElement).getPropertyValue(key).trim();
    if (!want) { toast(t('themes.revealNone'), 'info', 1800); return; }
    const probe = document.createElement('span');
    probe.style.color = want;
    document.body.appendChild(probe);
    const target = getComputedStyle(probe).color;
    probe.remove();
    document.querySelectorAll('.bte-reveal-flash').forEach((n) => n.classList.remove('bte-reveal-flash'));
    const props = ['backgroundColor', 'color', 'borderTopColor', 'borderLeftColor', 'outlineColor'] as const;
    const all = document.querySelectorAll<HTMLElement>('.app-shell *');
    let hits = 0;
    for (let i = 0; i < all.length && i < 4000 && hits < 60; i++) {
        const el = all[i];
        if (el.closest('#bmm-theme-editor, #bte-elov')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (props.some((p) => cs[p] === target)) { el.classList.add('bte-reveal-flash'); hits++; }
    }
    if (!hits) { toast(t('themes.revealNone'), 'info', 1800); return; }
    toast(`${hits} ${t('themes.revealHits')}`, 'info', 2200);
    setTimeout(() => document.querySelectorAll('.bte-reveal-flash').forEach((n) => n.classList.remove('bte-reveal-flash')), 2600);
}

// ── Per-element editor (floats over the app, next to the element) ─────────────────────────

function rgbToHex(col: string): string {
    const c = parseColor(col);
    return c ? toHex(c) : '#000000';
}
const propsToCss = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${k}: ${v};`).join('\n');
function cssToProps(css: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const decl of css.split(/;(?![^(]*\))/)) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const k = decl.slice(0, i).trim(), v = decl.slice(i + 1).trim();
        if (k && v && isSafeCssValue(v)) out[k] = v;
    }
    return out;
}

/** Edit any CSS of every element matching a selector, per state (normal, hover, active):
 *  quick colour pickers, a gradient builder, a picture, a replacement icon, free CSS. Writes
 *  `element_overrides` (and `html_swaps` for the icon). */
function openElementOverrideEditor(el0: HTMLElement, forcedSel?: string): void {
    stopPick();
    document.getElementById('bte-elov')?.remove();
    let el = el0;
    if (forcedSel && (!el || el === document.body)) el = (document.querySelector(forcedSel) as HTMLElement) || document.body;
    const cs = getComputedStyle(el);
    let base = forcedSel || buildSelectorFor(el);
    let state = '';
    let ov!: ElementOverride;
    const bind = () => {
        if (!_draft.element_overrides) _draft.element_overrides = [];
        const sel = base + state;
        ov = _draft.element_overrides.find((o) => o.selector === sel)
            || (_draft.element_overrides.push({ selector: sel, props: {} }), _draft.element_overrides[_draft.element_overrides.length - 1]);
    };
    bind();
    const commit = (key = `ov:${base}${state}`) => {
        _draft.element_overrides = (_draft.element_overrides || []).filter((o) => o === ov || Object.keys(o.props).length > 0);
        changed(key);
        if (!isLive()) applyTheme({ ...(clone(_draft) as BmmTheme), id: '__preview__' });
    };

    const pop = document.createElement('div');
    pop.id = 'bte-elov';
    pop.className = 'bte-elov';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', t('themes.overrideElement'));
    const colourRow = (label: string, prop: string) => `
        <label class="bte-elov-row"><span>${escHtml(label)}</span>
            <input type="color" data-prop="${prop}">
            <button type="button" class="bte-mini" data-clear="${prop}" aria-label="${escAttr(t('themes.clear'))}">${uiIcon('close', 14)}</button>
        </label>`;
    pop.innerHTML = `
        <div class="bte-elov-head"><strong>${uiIcon('pick', 14)} ${escHtml(t('themes.overrideElement'))}</strong>
            <button type="button" class="bte-mini bte-elov-close" aria-label="${escAttr(t('common.close'))}">${uiIcon('close', 14)}</button></div>
        <div class="bte-elov-body">
            <label class="bte-field-label">${escHtml(t('themes.selector'))}
                <input class="bte-input bte-elov-sel" type="text" spellcheck="false" value="${escAttr(base)}"></label>
            <div class="bte-seg">${[['', t('themes.stateNormal')], [':hover', t('themes.stateHover')], [':active', t('themes.stateActive')]].map(([s, l]) =>
                `<button type="button" class="bte-seg-btn${s === state ? ' active' : ''}" data-state="${s}">${escHtml(l)}</button>`).join('')}</div>
            ${colourRow(t('themes.text'), 'color')}
            ${colourRow(t('themes.background'), 'background-color')}
            ${colourRow(t('themes.border'), 'border-color')}
            <div class="bte-elov-grad">
                <span>${escHtml(t('themes.gradient'))}</span>
                <input type="color" class="bte-g1" value="#3b82f6" aria-label="${escAttr(t('themes.gradColor1'))}">
                <input type="color" class="bte-g2" value="#8b5cf6" aria-label="${escAttr(t('themes.gradColor2'))}">
                <select class="bte-input bte-select bte-gdir" aria-label="${escAttr(t('themes.gradDirection'))}">
                    <option value="135deg">↘</option><option value="90deg">→</option><option value="180deg">↓</option><option value="45deg">↗</option><option value="circle">◉</option>
                </select>
                <select class="bte-input bte-select bte-gtarget" aria-label="${escAttr(t('themes.gradTarget'))}">
                    <option value="background">${escHtml(t('themes.gradTargetBg'))}</option>
                    <option value="text">${escHtml(t('themes.gradTargetText'))}</option>
                    <option value="border">${escHtml(t('themes.gradTargetBorder'))}</option>
                </select>
                <button type="button" class="btn btn-secondary btn-xs bte-gapply">${escHtml(t('themes.applyGradient'))}</button>
            </div>
            <div class="bte-inline">
                <button type="button" class="btn btn-secondary btn-xs bte-img">${escHtml(t('themes.replaceImage'))}</button>
                <button type="button" class="bte-mini bte-img-clear" aria-label="${escAttr(t('themes.clear'))}">${uiIcon('close', 14)}</button>
            </div>
            <label class="bte-field-label">${escHtml(t('themes.replaceIcon'))}
                <textarea class="bte-input bte-code bte-elov-svg" rows="2" spellcheck="false"></textarea></label>
            <label class="bte-field-label">${escHtml(t('themes.customCss'))}
                <textarea class="bte-input bte-code bte-elov-css" rows="4" spellcheck="false"></textarea></label>
            <p class="bte-hint">${escHtml(t('themes.overrideHint'))}</p>
        </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(pop);
    const M = 8;
    const r = el.getBoundingClientRect();
    const pw = pop.offsetWidth || 320, ph = pop.offsetHeight || 440;
    let top = r.bottom + M;
    if (top + ph > innerHeight - M) top = r.top - ph - M >= M ? r.top - ph - M : top;
    pop.style.left = `${Math.max(M, Math.min(r.left, innerWidth - pw - M))}px`;
    pop.style.top = `${Math.max(M, Math.min(top, innerHeight - ph - M))}px`;

    const cssBox = pop.querySelector('.bte-elov-css') as HTMLTextAreaElement;
    const fill = () => {
        cssBox.value = propsToCss(ov.props);
        pop.querySelectorAll<HTMLInputElement>('input[data-prop]').forEach((inp) => {
            const prop = inp.dataset.prop!;
            const computed = prop === 'color' ? cs.color : prop === 'background-color' ? cs.backgroundColor : cs.borderTopColor;
            inp.value = rgbToHex(ov.props[prop] || computed);
        });
    };
    fill();
    pop.querySelectorAll<HTMLInputElement>('input[data-prop]').forEach((inp) => inp.addEventListener('input', () => {
        ov.props[inp.dataset.prop!] = inp.value; cssBox.value = propsToCss(ov.props); commit();
    }));
    pop.querySelectorAll<HTMLElement>('[data-clear]').forEach((b) => b.addEventListener('click', () => {
        delete ov.props[b.dataset.clear!]; fill(); commit();
    }));
    const GRAD: Record<string, (g: string) => Record<string, string>> = {
        background: (g) => ({ background: g }),
        text: (g) => ({ 'background-image': g, 'background-clip': 'text', '-webkit-background-clip': 'text', color: 'transparent', '-webkit-text-fill-color': 'transparent' }),
        border: (g) => ({ 'border-image': `${g} 1`, 'border-style': 'solid', 'border-width': '2px' }),
    };
    pop.querySelector('.bte-gapply')?.addEventListener('click', () => {
        const c1 = (pop.querySelector('.bte-g1') as HTMLInputElement).value, c2 = (pop.querySelector('.bte-g2') as HTMLInputElement).value;
        const dir = (pop.querySelector('.bte-gdir') as HTMLSelectElement).value;
        const g = dir === 'circle' ? `radial-gradient(circle, ${c1}, ${c2})` : `linear-gradient(${dir}, ${c1}, ${c2})`;
        for (const make of Object.values(GRAD)) for (const k of Object.keys(make('x'))) delete ov.props[k];
        Object.assign(ov.props, (GRAD[(pop.querySelector('.bte-gtarget') as HTMLSelectElement).value] || GRAD.background)(g));
        fill(); commit();
    });
    pop.querySelector('.bte-img')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
            const f = input.files?.[0];
            if (!f) return;
            if (f.size > 4 * 1024 * 1024) { toast(t('themes.assetTooBig'), 'warning', 4000); return; }
            const rd = new FileReader();
            rd.onload = () => {
                Object.assign(ov.props, { 'background-image': `url("${rd.result}")`, 'background-size': 'contain', 'background-repeat': 'no-repeat', 'background-position': 'center' });
                fill(); commit();
            };
            rd.readAsDataURL(f);
        };
        input.click();
    });
    pop.querySelector('.bte-img-clear')?.addEventListener('click', () => {
        for (const p of ['background-image', 'background-size', 'background-repeat', 'background-position']) delete ov.props[p];
        fill(); commit();
    });
    cssBox.addEventListener('input', () => { ov.props = cssToProps(cssBox.value); commit(); });
    const svgBox = pop.querySelector('.bte-elov-svg') as HTMLTextAreaElement;
    svgBox.value = (_draft.html_swaps || []).find((s) => s.selector === base)?.html || '';
    svgBox.addEventListener('input', () => {
        const html = svgBox.value.trim();
        const list = (_draft.html_swaps || []).filter((s) => s.selector !== base);
        if (html) list.push({ selector: base, html });
        _draft.html_swaps = list;
        commit(`swap:${base}`);
    });
    pop.querySelectorAll<HTMLElement>('[data-state]').forEach((b) => b.addEventListener('click', () => {
        state = b.dataset.state || '';
        pop.querySelectorAll('[data-state]').forEach((x) => x.classList.toggle('active', x === b));
        bind(); fill();
    }));
    const selInput = pop.querySelector('.bte-elov-sel') as HTMLInputElement;
    selInput.addEventListener('change', () => {
        const next = selInput.value.trim();
        if (!next) return;
        for (const o of _draft.element_overrides || []) {
            if (o.selector === base) o.selector = next;
            else if (o.selector.startsWith(`${base}:`)) o.selector = next + o.selector.slice(base.length);
        }
        base = next; bind(); commit();
    });
    pop.querySelector('.bte-elov-close')?.addEventListener('click', () => {
        _draft.element_overrides = (_draft.element_overrides || []).filter((o) => Object.keys(o.props).length > 0);
        pop.remove();
        if (_section === 'elements') renderSide();
        refresh();
    });
    const head = pop.querySelector('.bte-elov-head') as HTMLElement;
    head.addEventListener('mousedown', (md) => {
        if ((md.target as HTMLElement).closest('button')) return;
        md.preventDefault();
        const sx = md.clientX, sy = md.clientY, ox = pop.offsetLeft, oy = pop.offsetTop;
        const move = (mm: MouseEvent) => {
            pop.style.left = `${Math.max(0, Math.min(ox + mm.clientX - sx, innerWidth - pop.offsetWidth))}px`;
            pop.style.top = `${Math.max(0, Math.min(oy + mm.clientY - sy, innerHeight - 40))}px`;
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
}

// ── Float geometry ─────────────────────────────────────────────────────────────────────────

function applyGeom(): void {
    if (!_panel) return;
    let g: any = {};
    try { g = JSON.parse(localStorage.getItem(GEOM_KEY) || '{}'); } catch { /* defaults */ }
    // The editor shows a preview beside the controls now: it opens wide by default.
    const w = Math.max(MIN_W, Math.min(Number(g.width) || 1000, innerWidth - 20));
    const h = Math.max(MIN_H, Math.min(Number(g.height) || 660, innerHeight - 20));
    const l = Math.max(0, Math.min(Number.isFinite(g.left) ? g.left : (innerWidth - w) / 2, innerWidth - w));
    // The whole panel on screen, footer included: a remembered top from a taller window is pulled up.
    const top = Math.max(0, Math.min(Number.isFinite(g.top) ? g.top : 50, innerHeight - h));
    Object.assign(_panel.style, {
        position: 'fixed', left: `${l}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`,
        minWidth: `${MIN_W}px`, minHeight: `${MIN_H}px`, zIndex: '999998', resize: 'both', overflow: 'hidden',
        display: 'none',
    });
}

function saveGeom(): void {
    if (!_panel || isDocked()) return;
    const r = _panel.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    localStorage.setItem(GEOM_KEY, JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height }));
}

function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if (isDocked()) return;
        if ((e.target as HTMLElement).closest('button,input,select,textarea,a')) return;
        e.preventDefault();
        const r = panel.getBoundingClientRect();
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        const cb = (panel.offsetParent as HTMLElement) || document.documentElement;
        const move = (ev: MouseEvent) => {
            const pr = cb.getBoundingClientRect();
            panel.style.left = `${Math.max(0, Math.min(pr.width - 140, ev.clientX - ox - pr.left))}px`;
            panel.style.top = `${Math.max(0, Math.min(pr.height - 52, ev.clientY - oy - pr.top))}px`;
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveGeom(); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
}
