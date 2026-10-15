// ── Translation studio ─────────────────────────────────────────────────────────────────────
// The place to translate BMM: every key of every language, edited against a source language,
// with the drafts kept apart from the live app until they are exported.
//
// It replaced the « translation sandbox » (a full-screen dialog with a floating mode bolted
// on). The studio is a floating window from the start, built for a NARROW window: on the side
// of the screen whose text it translates, or popped out into an OS window of its own
// (ui/popout.ts, the theme editor's mechanism). Its layout follows its own width, not the
// app's (container queries in css/translation-studio.css):
//
//   narrow   head (drag) · language pair · per-language progress · tabs
//            key list (search, Missing / Changed / Same / All) on top, editor under it
//   wide     the same, the list on the left and the editor on the right
//
// The editor shows the source text, the target field, the {variables} of the source as chips
// (click one to insert it; each turns red while the target lacks it), a preview with the
// variables filled in, and the other languages. « Live in the app » slips the drafts of the
// target language under t() (core/i18n.ts setSandboxOverlay), so the whole app speaks them
// until it is switched off or the studio closes.
//
// Drafts are per language and are kept in this browser (localStorage), so closing the studio
// loses nothing. Nothing reaches the Lang files: « Export .json » downloads the complete file
// (order, _info, _synonyms and sections kept, drafts applied), exactly as the sandbox did.
// « Import » reads a .json back: for a language BMM has, its differences become drafts; an
// unknown language is installed as a new one (import_language_data, the share-link path).
//
// Every user action goes through ONE delegated listener per event type on the root, keyed by
// data-ts attributes: the pop-out window replays clicks, values and keys on the same elements,
// so delegation is what makes the popped-out copy behave like the panel.
//
// Old entry points keep working: the Settings button (#btn-open-i18n-sandbox), the tutorial,
// window.openI18nSandbox and the palette's « sandbox » keyword all open the studio.

import { invoke } from '../../core/api.js';
import { getAllTranslations, getLang, getLanguages, t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { uiIcon } from '../../ui/icons.js';
import { popoutButtonHtml, wirePopout, isPoppedOut, closeWindow, type PopoutSpec } from '../../ui/popout.js';

/** ui/app.ts's toast, through the window: importing app.ts from here closes a module cycle
 *  (app → profiles → mods/settings → this → app). */
const toast = (message: string, type = 'info', ms?: number): void => { (window as any).toast?.(message, type, ms); };

type Filter = 'all' | 'missing' | 'changed' | 'same';
type Tab = 'keys' | 'scan';
type Status = 'missing' | 'changed' | 'same' | 'ok';

const ROOT_ID = 'bmm-translation-studio';
const CSS_ID = 'translation-studio-css';
const POPOUT_ID = 'translation-studio';
const LS = {
    src: 'bmm.tstudio.source',
    tgt: 'bmm.tstudio.target',
    drafts: 'bmm.tstudio.drafts.v1',
    geom: 'bmm.tstudio.geom',
    filter: 'bmm.tstudio.filter',
} as const;
const LIST_CAP = 1200;
const MIN_W = 360, MIN_H = 420;

let _root: HTMLElement | null = null;
let _loaded = false;
/** Every language as loaded: the app's dictionaries overlaid with the files on disk. */
let _trans: Record<string, Record<string, any>> = {};
/** The parsed files on disk, kept for their order and their non-string entries. */
let _disk: Record<string, Record<string, any>> = {};
/** All keys, in the file order of the first language, then any found only elsewhere. */
let _keys: string[] = [];
/** The keys whose values count for progress: strings, no section dividers, no `_meta`. */
let _countable: string[] = [];
let _src = 'en';
let _tgt = 'fr';
let _drafts: Record<string, Record<string, string>> = {};
let _sel: string | null = null;
let _filter: Filter = 'all';
let _tab: Tab = 'keys';
let _visible: string[] = [];
let _query = '';
let _live = false;
let _revertArmed = 0;
let _usage: Record<string, Array<{ file: string; line: number; snippet: string }>> = {};
// Untranslated-text scan (find_hardcoded_strings)
let _hc: Array<{ file: string; line: number; text: string; kind: string; snippet?: string }> = [];
let _hcLoaded = false;
let _hcKind = 'all';
let _hcSel = -1;
let _hcQuery = '';
// On-screen picking
let _pick = false;
let _hoverEl: HTMLElement | null = null;

const lsGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* storage off: the session keeps it */ } };

function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
    let h: ReturnType<typeof setTimeout> | undefined;
    return (...a: A) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
}

function ensureCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/translation-studio.css';
    document.head.appendChild(link);
}

// ── Data ─────────────────────────────────────────────────────────────────────────────────

const isSection = (k: string) => k.startsWith('__SECTION');
const isMeta = (k: string) => k.startsWith('_') && !isSection(k);
const rawVal = (k: string, lang: string): any => (_trans[lang] || {})[k];
const isObj = (k: string) => { const v = rawVal(k, _tgt) ?? rawVal(k, _src); return v !== null && typeof v === 'object'; };
function show(v: any): string {
    if (v === undefined || v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
}
/** The value on disk (no draft). */
const diskStr = (k: string, lang: string) => show(rawVal(k, lang));
/** The value as the studio shows it: the draft when there is one. */
function valueOf(k: string, lang: string): string {
    const d = _drafts[lang]?.[k];
    return d !== undefined ? d : diskStr(k, lang);
}
const draftsOf = (lang: string) => (_drafts[lang] ||= {});
const draftCount = (lang: string) => Object.keys(_drafts[lang] || {}).length;

function statusOf(k: string): Status {
    if (_drafts[_tgt]?.[k] !== undefined) return 'changed';
    if (!isObj(k) && !valueOf(k, _tgt).trim()) return 'missing';
    if (_src !== _tgt && !isObj(k)) {
        const v = valueOf(k, _tgt).trim();
        if (v && v === valueOf(k, _src).trim()) return 'same';
    }
    return 'ok';
}
const isMissing = (k: string) => !isObj(k) && !valueOf(k, _tgt).trim();

function saveDrafts(): void {
    // Empty languages are dropped so the store does not grow with every target ever opened.
    const out: Record<string, Record<string, string>> = {};
    for (const [lang, map] of Object.entries(_drafts)) if (Object.keys(map).length) out[lang] = map;
    lsSet(LS.drafts, JSON.stringify(out));
}
const saveDraftsSoon = debounce(saveDrafts, 400);

function loadDrafts(): void {
    try {
        const raw = JSON.parse(lsGet(LS.drafts) || '{}');
        _drafts = {};
        if (raw && typeof raw === 'object') {
            for (const [lang, map] of Object.entries(raw)) {
                if (!map || typeof map !== 'object') continue;
                const clean: Record<string, string> = {};
                for (const [k, v] of Object.entries(map as Record<string, unknown>)) if (typeof v === 'string') clean[k] = v;
                _drafts[lang] = clean;
            }
        }
    } catch { _drafts = {}; }
}

async function loadData(): Promise<void> {
    _trans = JSON.parse(JSON.stringify(getAllTranslations() || {}));
    _disk = {};
    try {
        const files = await invoke('get_all_languages_content');
        if (files && typeof files === 'object' && !Array.isArray(files)) {
            for (const [lang, raw] of Object.entries(files as Record<string, string>)) {
                try {
                    const parsed = JSON.parse(raw);
                    _disk[lang] = parsed;
                    _trans[lang] = { ...(_trans[lang] || {}), ...parsed };
                } catch { /* a broken file is skipped, the others still load */ }
            }
        }
    } catch { /* browser preview, or no Lang folder: the app's own dictionaries are used */ }
    const langs = Object.keys(_trans).filter((l) => l !== 'template');
    for (const l of Object.keys(_trans)) if (!langs.includes(l)) delete _trans[l];

    const wantT = lsGet(LS.tgt), wantS = lsGet(LS.src);
    _tgt = wantT && langs.includes(wantT) ? wantT : (langs.includes(getLang()) && getLang() !== 'en' ? getLang() : (langs.find((l) => l !== 'en') || langs[0] || 'en'));
    _src = wantS && langs.includes(wantS) && wantS !== _tgt ? wantS : (langs.includes('en') && _tgt !== 'en' ? 'en' : (langs.find((l) => l !== _tgt) || _tgt));

    const order = langs.includes('en') ? ['en', ...langs.filter((l) => l !== 'en')] : langs;
    const seen = new Set<string>();
    _keys = [];
    for (const l of order) {
        for (const k of Object.keys(_disk[l] || _trans[l] || {})) if (!seen.has(k)) { seen.add(k); _keys.push(k); }
    }
    _countable = _keys.filter((k) => !isSection(k) && !isMeta(k) && typeof (rawVal(k, 'en') ?? rawVal(k, _src)) !== 'object');
    const f = lsGet(LS.filter) as Filter | null;
    if (f && ['all', 'missing', 'changed', 'same'].includes(f)) _filter = f;
    loadDrafts();
    _loaded = true;
}

function langName(code: string): string {
    const info = (_disk[code] || _trans[code] || {})._info;
    if (info && typeof info === 'object' && typeof info.name === 'string' && info.name.trim()) return info.name.trim();
    const known = getLanguages().find((l: any) => l.code === code) as any;
    return known?.name || code.toUpperCase();
}

/** Done / total for one language, drafts included. */
function progressOf(lang: string): { done: number; total: number; pct: number } {
    const total = _countable.length;
    let done = 0;
    for (const k of _countable) if (valueOf(k, lang).trim()) done++;
    return { done, total, pct: total ? Math.floor((done / total) * 100) : 100 };
}

// ── Open / close ─────────────────────────────────────────────────────────────────────────

export async function openTranslationStudio(focusKey?: string): Promise<void> {
    ensureCss();
    if (!_root) build();
    if (!_loaded) await loadData();
    const root = _root!;
    root.hidden = false;
    root.classList.add('is-open');
    renderAll();
    if (focusKey) selectKey(focusKey, true);
    else requestAnimationFrame(() => (root.querySelector('#tst-search') as HTMLInputElement | null)?.focus({ preventScroll: true }));
}

export function closeTranslationStudio(): void {
    if (!_root) return;
    if (_pick) setPick(false);
    if (_live) setLive(false, true);
    if (isPoppedOut(POPOUT_ID)) closeWindow(POPOUT_ID);
    saveDrafts();
    _root.classList.remove('is-open');
    _root.hidden = true;
}

const isOpen = () => !!_root && !_root.hidden;

/** Kept for the Settings button and anything that called the sandbox by its old name. */
export function initTranslationStudio(): void {
    const btn = document.getElementById('btn-open-i18n-sandbox');
    if (btn && !(btn as any)._tstWired) {
        (btn as any)._tstWired = true;
        btn.addEventListener('click', () => { void openTranslationStudio(); });
    }
    (window as any).openTranslationStudio = (key?: string) => openTranslationStudio(typeof key === 'string' ? key : undefined);
    (window as any).openI18nSandbox = (window as any).openTranslationStudio;
}

// ── Shell ────────────────────────────────────────────────────────────────────────────────

const POPOUT: PopoutSpec = {
    id: POPOUT_ID,
    title: () => t('tstudio.title'),
    panel: () => _root,
    isOpen: () => isOpen(),
    close: () => closeTranslationStudio(),
};

function build(): void {
    const root = document.createElement('section');
    root.id = ROOT_ID;
    root.className = 'tst';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-labelledby', 'tst-title');
    root.innerHTML = `
        <header class="tst-head" id="tst-head">
            <span class="tst-logo" aria-hidden="true">${uiIcon('languages', 16)}</span>
            <div class="tst-titles">
                <h2 class="tst-title" id="tst-title">${escHtml(t('tstudio.title'))}</h2>
                <div class="tst-sub" id="tst-sub"></div>
            </div>
            <div class="tst-head-tools">
                <button type="button" class="tst-tool" id="tst-pick" data-ts="pick" aria-pressed="false" aria-label="${escAttr(t('tstudio.pick'))}" data-tooltip="${escAttr(t('tstudio.pickTip'))}">${uiIcon('pick', 16)}</button>
                ${popoutButtonHtml('tst-tool', POPOUT_ID)}
                <button type="button" class="tst-tool" data-ts="close" aria-label="${escAttr(t('common.close'))}" data-tooltip="${escAttr(t('common.close'))}">${uiIcon('close', 16)}</button>
            </div>
        </header>

        <div class="tst-langbar">
            <label class="tst-lang">
                <span class="tst-lang-cap">${escHtml(t('i18n.source'))}</span>
                <select id="tst-source" class="tst-select" data-ts-field="source"></select>
            </label>
            <button type="button" class="tst-iconbtn" data-ts="swap" aria-label="${escAttr(t('i18n.swapLangs'))}" data-tooltip="${escAttr(t('i18n.swapLangs'))}">${uiIcon('arrow-right', 14)}</button>
            <label class="tst-lang">
                <span class="tst-lang-cap">${escHtml(t('i18n.target'))}</span>
                <select id="tst-target" class="tst-select" data-ts-field="target"></select>
            </label>
            <button type="button" class="tst-iconbtn" id="tst-new-lang" data-ts="new-lang" aria-label="${escAttr(t('tstudio.newLang'))}" data-tooltip="${escAttr(t('tstudio.newLang'))}">${uiIcon('add', 14)}</button>
        </div>
        <div class="tst-progress" id="tst-progress" role="list" aria-label="${escAttr(t('tstudio.progressLabel'))}"></div>

        <div class="tst-tabs" role="tablist">
            <button type="button" class="tst-tab" role="tab" data-ts="tab" data-tab="keys" aria-selected="true">${uiIcon('key', 14)}<span>${escHtml(t('tstudio.tabKeys'))}</span></button>
            <button type="button" class="tst-tab" role="tab" data-ts="tab" data-tab="scan" aria-selected="false">${uiIcon('code', 14)}<span>${escHtml(t('tstudio.tabScan'))}</span><span class="tst-count" id="tst-scan-count"></span></button>
        </div>

        <div class="tst-body" id="tst-body">
            <div class="tst-split" data-panel="keys">
                <div class="tst-listpane">
                    <div class="tst-searchrow">
                        <label class="tst-search">
                            ${uiIcon('search', 14)}
                            <input id="tst-search" type="search" class="form-input" spellcheck="false" autocomplete="off" data-ts-field="search" placeholder="${escAttr(t('i18n.searchPh'))}" aria-label="${escAttr(t('i18n.searchPh'))}">
                        </label>
                        <button type="button" class="tst-iconbtn" data-ts="next-missing" aria-label="${escAttr(t('i18n.nextMissing'))}" data-tooltip="${escAttr(t('i18n.nextMissing'))}">${uiIcon('chevron-right', 14)}</button>
                    </div>
                    <div class="tst-filters" role="group" id="tst-filters" aria-label="${escAttr(t('tstudio.filterLabel'))}"></div>
                    <div class="tst-list" id="tst-list" role="listbox" tabindex="0" aria-label="${escAttr(t('tstudio.tabKeys'))}"></div>
                </div>
                <div class="tst-editor" id="tst-editor"></div>
            </div>
            <div class="tst-split" data-panel="scan" hidden>
                <div class="tst-listpane">
                    <div class="tst-searchrow">
                        <label class="tst-search">
                            ${uiIcon('search', 14)}
                            <input id="tst-hc-search" type="search" class="form-input" spellcheck="false" autocomplete="off" data-ts-field="hc-search" placeholder="${escAttr(t('i18n.hcSearchPh'))}" aria-label="${escAttr(t('i18n.hcSearchPh'))}">
                        </label>
                        <button type="button" class="tst-iconbtn" data-ts="hc-rescan" aria-label="${escAttr(t('i18n.hcRescan'))}" data-tooltip="${escAttr(t('i18n.hcRescan'))}">${uiIcon('refresh', 14)}</button>
                    </div>
                    <div class="tst-filters" role="group" id="tst-hc-kinds" aria-label="${escAttr(t('tstudio.filterLabel'))}"></div>
                    <div class="tst-list" id="tst-hc-list" role="listbox" tabindex="0" aria-label="${escAttr(t('tstudio.tabScan'))}"></div>
                </div>
                <div class="tst-editor" id="tst-hc-detail"></div>
            </div>
            <div class="tst-sheet" id="tst-sheet" hidden></div>
        </div>

        <footer class="tst-foot">
            <label class="tst-live" data-tooltip="${escAttr(t('tstudio.liveTip'))}">
                <span class="plug-toggle"><input type="checkbox" id="tst-live" data-ts-field="live"><span class="plug-toggle-slider"></span></span>
                <span>${escHtml(t('tstudio.live'))}</span>
            </label>
            <span class="tst-drafts" id="tst-drafts"></span>
            <span class="tst-spacer"></span>
            <button type="button" class="btn btn-ghost btn-sm" data-ts="import">${uiIcon('import', 14)}<span>${escHtml(t('tstudio.import'))}</span></button>
            <button type="button" class="btn btn-primary btn-sm" id="tst-export" data-ts="export">${uiIcon('export', 14)}<span>${escHtml(t('i18n.export'))}</span></button>
        </footer>
        <input type="file" id="tst-import-file" accept=".json,application/json" hidden data-popout-hide>`;

    (document.getElementById('app-window-outer') || document.body).appendChild(root);
    _root = root;
    applyGeom();

    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKey);
    const head = root.querySelector('#tst-head') as HTMLElement;
    makeDraggable(root, head);
    wirePopout(POPOUT, root, head);
    new ResizeObserver(() => saveGeomSoon()).observe(root);
}

// ── Geometry: a floating window that remembers where it was ─────────────────────────────

function applyGeom(): void {
    if (!_root) return;
    const host = (_root.offsetParent as HTMLElement) || _root.parentElement || document.documentElement;
    const hr = host.getBoundingClientRect();
    const W = hr.width || innerWidth, H = hr.height || innerHeight;
    let g: any = {};
    try { g = JSON.parse(lsGet(LS.geom) || '{}'); } catch { g = {}; }
    // First open: a tall, narrow window on the right, where it covers the least.
    const w = Math.max(MIN_W, Math.min(Number(g.width) || 460, W - 16));
    const h = Math.max(MIN_H, Math.min(Number(g.height) || Math.min(720, H - 48), H - 16));
    const left = Math.max(0, Math.min(Number.isFinite(g.left) ? g.left : W - w - 24, W - 120));
    const top = Math.max(0, Math.min(Number.isFinite(g.top) ? g.top : 24, H - 60));
    Object.assign(_root.style, { width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px` });
}

const saveGeomSoon = debounce(() => {
    if (!_root || _root.hidden || isPoppedOut(POPOUT_ID)) return;
    const r = _root.getBoundingClientRect();
    const host = ((_root.offsetParent as HTMLElement) || document.documentElement).getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    lsSet(LS.geom, JSON.stringify({ left: r.left - host.left, top: r.top - host.top, width: r.width, height: r.height }));
}, 250);


// ── Rendering ────────────────────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(id: string) => (_root?.querySelector(`#${id}`) as T | null);

function renderAll(): void {
    renderLangs();
    renderTabs();
    renderFilters();
    renderList();
    if (_sel) renderEditor(); else renderEditorEmpty();
    renderFoot();
}

function renderLangs(): void {
    const langs = Object.keys(_trans).sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));
    for (const [id, cur] of [['tst-source', _src], ['tst-target', _tgt]] as const) {
        const sel = $<HTMLSelectElement>(id);
        if (!sel) continue;
        sel.innerHTML = langs.map((l) => `<option value="${escAttr(l)}"${l === cur ? ' selected' : ''}>${escHtml(`${l.toUpperCase()} · ${langName(l)}`)}</option>`).join('');
        sel.value = cur;
    }
    renderProgress();
}

function renderProgress(): void {
    const box = $('tst-progress');
    const sub = $('tst-sub');
    const langs = Object.keys(_trans).sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));
    const all = langs.map((l) => ({ l, ...progressOf(l) }));
    if (box) {
        box.innerHTML = all.map(({ l, pct, done, total }) => `
            <button type="button" class="tst-prog${l === _tgt ? ' is-target' : ''}${pct >= 100 ? ' is-done' : pct < 60 ? ' is-low' : ''}" role="listitem" data-ts="set-target" data-lang="${escAttr(l)}"
                aria-label="${escAttr(t('tstudio.progressOf', { lang: langName(l), pct: String(pct) }))}" data-tooltip="${escAttr(t('tstudio.progressTip', { done: String(done), total: String(total) }))}">
                <span class="tst-prog-code">${escHtml(l.toUpperCase())}</span>
                <span class="tst-prog-bar"><span style="width:${pct}%"></span></span>
                <span class="tst-prog-pct">${pct}%</span>
            </button>`).join('');
    }
    if (sub) {
        const me = all.find((x) => x.l === _tgt);
        sub.textContent = me ? t('tstudio.sub', { lang: langName(_tgt), done: String(me.done), total: String(me.total) }) : '';
    }
}
const renderProgressSoon = debounce(renderProgress, 300);

function renderTabs(): void {
    _root?.querySelectorAll<HTMLElement>('[data-ts="tab"]').forEach((b) => {
        const on = b.dataset.tab === _tab;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
    });
    _root?.querySelectorAll<HTMLElement>('.tst-split').forEach((p) => { p.hidden = p.dataset.panel !== _tab; });
    const c = $('tst-scan-count');
    if (c) c.textContent = _hcLoaded ? String(_hc.length) : '';
}

const FILTERS: Array<{ id: Filter; key: string }> = [
    { id: 'missing', key: 'i18n.filterMissing' },
    { id: 'changed', key: 'tstudio.filterChanged' },
    { id: 'same', key: 'i18n.filterSameShort' },
    { id: 'all', key: 'i18n.filterAll' },
];

function counts(): Record<Filter, number> {
    const c: Record<Filter, number> = { all: 0, missing: 0, changed: 0, same: 0 };
    for (const k of _keys) {
        if (isSection(k) || isMeta(k) || !matches(k)) continue;
        c.all++;
        const st = statusOf(k);
        if (isMissing(k)) c.missing++;
        if (st === 'changed') c.changed++;
        if (st === 'same') c.same++;
    }
    return c;
}

function renderFilters(c = counts()): void {
    const box = $('tst-filters');
    if (!box) return;
    box.innerHTML = FILTERS.map((f) => `
        <button type="button" class="tst-chip is-${f.id}" data-ts="filter" data-filter="${f.id}" aria-pressed="${f.id === _filter}"${f.id === 'same' ? ` data-tooltip="${escAttr(t('i18n.filterSameTip'))}"` : ''}>
            <span>${escHtml(t(f.key))}</span><span class="tst-chip-n">${c[f.id]}</span>
        </button>`).join('');
}

function matches(k: string): boolean {
    if (!_query) return true;
    const q = _query;
    return k.toLowerCase().includes(q) || valueOf(k, _tgt).toLowerCase().includes(q) || valueOf(k, _src).toLowerCase().includes(q);
}

function oneLine(s: string): string { return s.replace(/\s+/g, ' ').trim(); }

function renderList(): void {
    const list = $('tst-list');
    if (!list) return;
    const c = counts();
    renderFilters(c);
    const rows: string[] = [];
    _visible = [];
    let capped = 0;
    for (const k of _keys) {
        if (isSection(k)) {
            if (_filter === 'all' && !_query) rows.push(`<div class="tst-sec" role="presentation">${escHtml(String(rawVal(k, 'en') ?? rawVal(k, _tgt) ?? k).replace(/^-+\s*|\s*-+$/g, ''))}</div>`);
            continue;
        }
        if (isMeta(k) || !matches(k)) continue;
        const st = statusOf(k);
        if (_filter === 'missing' && !isMissing(k)) continue;
        if (_filter === 'changed' && st !== 'changed') continue;
        if (_filter === 'same' && st !== 'same') continue;
        if (_visible.length >= LIST_CAP) { capped++; continue; }
        _visible.push(k);
        const miss = isMissing(k);
        const preview = oneLine(miss ? valueOf(k, _src) : valueOf(k, _tgt));
        rows.push(`<div class="tst-row is-${st}" role="option" id="tst-row-${_visible.length - 1}" data-ts="row" data-key="${escAttr(k)}" aria-selected="${k === _sel}">
            <span class="tst-dot" aria-hidden="true"></span>
            <span class="tst-row-k">${escHtml(k)}${isObj(k) ? '<span class="tst-tag">{ }</span>' : ''}</span>
            <span class="tst-row-v${miss ? ' is-src' : ''}">${escHtml(preview)}</span>
        </div>`);
    }
    if (capped) rows.push(`<div class="tst-capped">${escHtml(t('i18n.listCapped', { n: String(capped) }))}</div>`);
    list.innerHTML = rows.join('') || `<div class="tst-empty">
        <p>${escHtml(_filter === 'missing' && !_query ? t('tstudio.allTranslated', { lang: langName(_tgt) }) : t('i18n.noResults'))}</p>
        ${_query || _filter !== 'all' ? `<button type="button" class="btn btn-ghost btn-sm" data-ts="clear-filters">${escHtml(t('i18n.clearFilters'))}</button>` : ''}
    </div>`;
    markSelected(false);
}
const renderListSoon = debounce(renderList, 140);

function markSelected(scroll = true): void {
    const list = $('tst-list');
    if (!list) return;
    list.querySelectorAll('.tst-row[aria-selected="true"]').forEach((r) => r.setAttribute('aria-selected', 'false'));
    if (!_sel) { list.removeAttribute('aria-activedescendant'); return; }
    const row = list.querySelector<HTMLElement>(`.tst-row[data-key="${CSS.escape(_sel)}"]`);
    if (!row) return;
    row.setAttribute('aria-selected', 'true');
    list.setAttribute('aria-activedescendant', row.id);
    if (scroll) row.scrollIntoView({ block: 'nearest' });
}

function updateRow(k: string): void {
    const row = $('tst-list')?.querySelector<HTMLElement>(`.tst-row[data-key="${CSS.escape(k)}"]`);
    if (!row) return;
    const st = statusOf(k);
    row.className = `tst-row is-${st}`;
    const v = row.querySelector('.tst-row-v');
    const miss = isMissing(k);
    if (v) { v.textContent = oneLine(miss ? valueOf(k, _src) : valueOf(k, _tgt)); v.classList.toggle('is-src', miss); }
}

function renderEditorEmpty(): void {
    const ed = $('tst-editor');
    if (!ed) return;
    ed.innerHTML = `<div class="tst-start">
        <h3 class="tst-start-t">${escHtml(t('tstudio.startTitle'))}</h3>
        <ol class="tst-steps">
            <li>${escHtml(t('tstudio.start1'))}</li>
            <li>${escHtml(t('tstudio.start2'))}</li>
            <li>${escHtml(t('tstudio.start3'))}</li>
        </ol>
        <p class="tst-hint">${escHtml(t('tstudio.kbd'))}</p>
        <button type="button" class="btn btn-secondary btn-sm" data-ts="next-missing">${uiIcon('chevron-right', 14)}<span>${escHtml(t('i18n.nextMissing'))}</span></button>
    </div>`;
}

const VAR_RE = /\{(\w+)\}/g;
const varsOf = (s: string) => [...new Set([...(s || '').matchAll(VAR_RE)].map((m) => m[1]))];
const tagsOf = (s: string) => ((s || '').match(/<\/?[a-z][^>]*>/gi) || []).map((x) => x.toLowerCase().replace(/\s.*$/, '').replace(/>$/, ''));

/** What is wrong with the target, as chips: lost or invented variables, tags, emptiness. */
function issues(k: string): Array<{ tone: 'danger' | 'warn'; text: string }> {
    const src = valueOf(k, _src), tgt = valueOf(k, _tgt);
    if (isObj(k)) {
        if (_drafts[_tgt]?.[k] === undefined) return [];
        try { JSON.parse(tgt); return []; } catch { return [{ tone: 'danger', text: t('tstudio.badJson') }]; }
    }
    const out: Array<{ tone: 'danger' | 'warn'; text: string }> = [];
    if (!tgt.trim()) return out;
    const sv = varsOf(src), tv = varsOf(tgt);
    for (const v of sv) if (!tv.includes(v)) out.push({ tone: 'danger', text: t('i18n.phMissing', { name: `{${v}}` }) });
    if (src.trim()) for (const v of tv) if (!sv.includes(v)) out.push({ tone: 'warn', text: t('i18n.phExtra', { name: `{${v}}` }) });
    const st = tagsOf(src).sort().join(), tt = tagsOf(tgt).sort().join();
    if (st !== tt) out.push({ tone: 'warn', text: t('tstudio.tagsDiffer') });
    if (/^\s|\s$/.test(src) !== /^\s|\s$/.test(tgt)) out.push({ tone: 'warn', text: t('tstudio.spaceDiffers') });
    return out;
}

/** The target with its variables filled by their names, as chips: what a reader will see. */
function previewHtml(s: string): string {
    if (!s.trim()) return `<span class="tst-muted">${escHtml(t('i18n.emptyValue'))}</span>`;
    return escHtml(s).replace(/\{(\w+)\}/g, (_m, n) => `<span class="tst-pv-var">${escHtml(n)}</span>`).replace(/\n/g, '<br>');
}

function statusChip(k: string): string {
    const st = statusOf(k);
    const label = st === 'missing' ? t('i18n.filterMissing') : st === 'changed' ? t('tstudio.filterChanged') : st === 'same' ? t('i18n.filterSame') : t('i18n.translated');
    return `<span class="tst-status is-${st}"><span class="tst-dot" aria-hidden="true"></span>${escHtml(label)}</span>`;
}

function renderEditor(): void {
    const ed = $('tst-editor');
    const k = _sel;
    if (!ed || !k) return;
    const src = _src === _tgt ? diskStr(k, _src) : valueOf(k, _src);
    const tgt = valueOf(k, _tgt);
    const obj = isObj(k);
    const at = _visible.indexOf(k);
    const changed = _drafts[_tgt]?.[k] !== undefined;
    const others = Object.keys(_trans).filter((l) => l !== _src && l !== _tgt).sort();
    const sv = varsOf(src);

    ed.innerHTML = `
        <div class="tst-ed-head">
            <button type="button" class="tst-keyname" data-ts="copy-key" data-tooltip="${escAttr(t('i18n.copyKey'))}"><code>${escHtml(k)}</code>${uiIcon('copy', 12)}</button>
            <span class="tst-ed-nav">
                <span class="tst-pos">${at >= 0 ? `${at + 1} / ${_visible.length}` : ''}</span>
                <button type="button" class="tst-iconbtn tst-iconbtn--sm" data-ts="prev" aria-label="${escAttr(t('i18n.prevKey'))}" data-tooltip="${escAttr(t('i18n.prevKey'))}"${at <= 0 ? ' disabled' : ''}>${uiIcon('chevron-up', 14)}</button>
                <button type="button" class="tst-iconbtn tst-iconbtn--sm" data-ts="next" aria-label="${escAttr(t('i18n.nextKey'))}" data-tooltip="${escAttr(t('i18n.nextKey'))}"${at < 0 || at >= _visible.length - 1 ? ' disabled' : ''}>${uiIcon('chevron-down', 14)}</button>
            </span>
        </div>
        <div class="tst-ed-status" id="tst-ed-status">${statusChip(k)}</div>

        <section class="tst-block">
            <div class="tst-block-h">
                <span class="tst-langtag">${escHtml(_src.toUpperCase())}</span>
                <span class="tst-cap">${escHtml(_src === _tgt ? t('i18n.original') : t('i18n.source'))}</span>
                <button type="button" class="btn btn-ghost btn-xs" data-ts="use-source"${src ? '' : ' disabled'}>${escHtml(t('i18n.useSource'))}</button>
            </div>
            <div class="tst-src${obj ? ' is-mono' : ''}${src ? '' : ' is-empty'}" lang="${escAttr(_src)}">${src ? escHtml(src) : escHtml(t('i18n.missing'))}</div>
        </section>

        ${sv.length ? `<div class="tst-vars" id="tst-vars" aria-label="${escAttr(t('tstudio.vars'))}">
            <span class="tst-cap">${escHtml(t('tstudio.vars'))}</span>
            ${sv.map((v) => `<button type="button" class="tst-var" data-ts="insert-var" data-var="${escAttr(v)}" data-tooltip="${escAttr(t('tstudio.insertVar'))}">{${escHtml(v)}}</button>`).join('')}
        </div>` : ''}

        <section class="tst-block is-target">
            <div class="tst-block-h">
                <span class="tst-langtag is-target">${escHtml(_tgt.toUpperCase())}</span>
                <label class="tst-cap" for="tst-value">${escHtml(t('i18n.target'))}</label>
                ${changed ? `<button type="button" class="btn btn-ghost btn-xs" data-ts="revert">${escHtml(t('i18n.revert'))}</button>` : ''}
            </div>
            <textarea id="tst-value" class="tst-ta${obj ? ' is-mono' : ''}" rows="${obj ? 8 : 4}" spellcheck="true" lang="${escAttr(_tgt)}" data-ts-field="value" placeholder="${escAttr(t('i18n.emptyValue'))}">${escHtml(tgt)}</textarea>
            <div class="tst-checks" id="tst-checks"></div>
        </section>

        ${obj ? '' : `<section class="tst-preview">
            <div class="tst-block-h"><span class="tst-cap">${escHtml(t('tstudio.preview'))}</span></div>
            <div class="tst-pv" id="tst-pv" lang="${escAttr(_tgt)}">${previewHtml(tgt)}</div>
            <div class="tst-pv-actions">
                <button type="button" class="btn btn-ghost btn-xs" data-ts="test-toast">${uiIcon('bell', 12)}<span>${escHtml(t('i18n.testToast'))}</span></button>
                <button type="button" class="btn btn-ghost btn-xs" data-ts="find-in-app">${uiIcon('eye', 12)}<span>${escHtml(t('tstudio.findInApp'))}</span></button>
            </div>
        </section>`}

        ${others.length ? `<details class="tst-more">
            <summary>${escHtml(t('i18n.otherLangs'))}<span class="tst-count">${others.length}</span></summary>
            <div class="tst-refs">${others.map((l) => {
                const v = valueOf(k, l);
                return `<div class="tst-ref"><span class="tst-langtag">${escHtml(l.toUpperCase())}</span><span class="tst-ref-v${v ? '' : ' is-missing'}" lang="${escAttr(l)}">${escHtml(v || t('i18n.missing'))}</span></div>`;
            }).join('')}</div>
        </details>` : ''}

        <details class="tst-more" id="tst-usage-box" data-key="${escAttr(k)}">
            <summary data-ts="usage">${escHtml(t('i18n.usedIn'))}<span class="tst-count" id="tst-usage-count"></span></summary>
            <div class="tst-usage" id="tst-usage"></div>
        </details>`;
    renderChecks();
}

function renderChecks(): void {
    const box = $('tst-checks');
    const k = _sel;
    if (!box || !k) return;
    const ta = $<HTMLTextAreaElement>('tst-value');
    const tgt = ta ? ta.value : valueOf(k, _tgt);
    const tv = varsOf(tgt);
    // The variable chips turn green once the target has them.
    _root?.querySelectorAll<HTMLElement>('#tst-vars .tst-var').forEach((b) => b.classList.toggle('is-ok', tv.includes(b.dataset.var || '')));
    const list = issues(k);
    const src = valueOf(k, _src);
    box.innerHTML = list.map((i) => `<span class="tst-issue is-${i.tone}">${uiIcon(i.tone === 'danger' ? 'error' : 'warning', 12)}${escHtml(i.text)}</span>`).join('')
        + (list.length || !tgt.trim() ? '' : `<span class="tst-issue is-ok">${uiIcon('check', 12)}${escHtml(t('tstudio.checksOk'))}</span>`)
        + `<span class="tst-len">${escHtml(t('i18n.chars', { n: String(tgt.length), src: String(src.length) }))}</span>`;
    const pv = $('tst-pv');
    if (pv) pv.innerHTML = previewHtml(tgt);
    const st = $('tst-ed-status');
    if (st) st.innerHTML = statusChip(k);
}

function renderFoot(): void {
    const d = $('tst-drafts');
    const n = draftCount(_tgt);
    if (d) {
        d.innerHTML = n ? `<span class="tst-drafts-n">${escHtml(t('tstudio.drafts', { n: String(n), lang: _tgt.toUpperCase() }))}</span>
            <button type="button" class="btn btn-ghost btn-xs${_revertArmed ? ' is-armed' : ''}" data-ts="revert-all">${escHtml(_revertArmed ? t('tstudio.revertAllConfirm', { n: String(n) }) : t('tstudio.revertAll'))}</button>` : '';
    }
    const live = $<HTMLInputElement>('tst-live');
    if (live) live.checked = _live;
}

// ── Selection ────────────────────────────────────────────────────────────────────────────

function selectKey(k: string, focus: boolean): void {
    if (!_keys.includes(k)) { toast(t('tstudio.unknownKey', { key: k }), 'warning'); return; }
    if (_tab !== 'keys') { _tab = 'keys'; renderTabs(); }
    _sel = k;
    if (!_visible.includes(k)) {
        // The filter or the search hides it: show everything, so the row it lands on exists.
        _filter = 'all'; _query = '';
        const box = $<HTMLInputElement>('tst-search');
        if (box) box.value = '';
        renderList();
    }
    markSelected();
    renderEditor();
    if (focus) requestAnimationFrame(focusValue);
}

function focusValue(): void {
    const ta = $<HTMLTextAreaElement>('tst-value');
    if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function move(step: number, focus: boolean): void {
    if (!_visible.length) return;
    const at = _sel ? _visible.indexOf(_sel) : -1;
    const to = at < 0 ? 0 : Math.max(0, Math.min(_visible.length - 1, at + step));
    if (_visible[to] !== _sel) selectKey(_visible[to], focus);
}

function nextMissing(): void {
    const start = _sel ? _keys.indexOf(_sel) + 1 : 0;
    for (let i = 0; i < _keys.length; i++) {
        const k = _keys[(start + i) % _keys.length];
        if (!isSection(k) && !isMeta(k) && isMissing(k)) {
            if (_filter !== 'missing' && _filter !== 'all') { _filter = 'missing'; lsSet(LS.filter, _filter); renderList(); }
            selectKey(k, true);
            return;
        }
    }
    toast(t('i18n.noMissing'), 'success');
}

// ── Editing ──────────────────────────────────────────────────────────────────────────────

function setValue(k: string, v: string): void {
    if (v === diskStr(k, _tgt)) delete draftsOf(_tgt)[k]; else draftsOf(_tgt)[k] = v;
    saveDraftsSoon();
    if (_live) pushLive();
    renderChecks();
    updateRow(k);
    renderFoot();
    renderProgressSoon();
}

function insertVar(name: string): void {
    const ta = $<HTMLTextAreaElement>('tst-value');
    if (!ta || !_sel) return;
    const token = `{${name}}`;
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
    ta.value = ta.value.slice(0, a) + token + ta.value.slice(b);
    ta.setSelectionRange(a + token.length, a + token.length);
    ta.focus({ preventScroll: true });
    setValue(_sel, ta.value);
}

function revertAll(): void {
    const n = draftCount(_tgt);
    if (!n) return;
    if (!_revertArmed) {
        // Two steps instead of a dialog: the confirmation has to work in the popped-out copy too.
        _revertArmed = window.setTimeout(() => { _revertArmed = 0; renderFoot(); }, 3500);
        renderFoot();
        return;
    }
    clearTimeout(_revertArmed);
    _revertArmed = 0;
    _drafts[_tgt] = {};
    saveDrafts();
    if (_live) pushLive();
    renderList();
    if (_sel) renderEditor();
    renderFoot();
    renderProgress();
    toast(t('tstudio.reverted', { n: String(n) }), 'success');
}

// ── Live in the app ──────────────────────────────────────────────────────────────────────

function pushLive(): void {
    void import('../../core/i18n.js').then((m) => m.setSandboxOverlay(_live ? { ...(_drafts[_tgt] || {}) } : null));
}
function setLive(on: boolean, quiet = false): void {
    _live = on;
    pushLive();
    renderFoot();
    if (quiet) return;
    if (on && _tgt !== getLang()) toast(t('tstudio.liveOtherLang', { lang: _tgt.toUpperCase(), app: getLang().toUpperCase() }), 'warning', 4200);
    else toast(on ? t('tstudio.liveOn') : t('tstudio.liveOff'), on ? 'warning' : 'info', 2600);
}

function testToast(k: string): void {
    const v = (($<HTMLTextAreaElement>('tst-value')?.value) ?? valueOf(k, _tgt)).trim();
    if (!v) { toast(t('i18n.noValueToTest'), 'warning'); return; }
    const kind = /error|fail|danger|invalid/i.test(k) ? 'error' : /warn|caution/i.test(k) ? 'warning' : /success|done|saved|complete/i.test(k) ? 'success' : 'info';
    toast(v.replace(VAR_RE, (_m, p) => `[${p}]`), kind, 4000);
}

/** Outline every element of the app that shows this key right now. */
function findInApp(k: string): void {
    const sel = ['data-i18n', 'data-i18n-placeholder', 'data-i18n-title', 'data-i18n-tooltip'].map((a) => `[${a}="${CSS.escape(k)}"]`).join(',');
    const hits = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => !_root?.contains(el) && el.getClientRects().length);
    if (!hits.length) { toast(t('tstudio.notOnScreen'), 'info', 2600); return; }
    hits[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    for (const el of hits) {
        el.classList.add('tst-flash');
        setTimeout(() => el.classList.remove('tst-flash'), 2600);
    }
    toast(t('tstudio.foundOnScreen', { n: String(hits.length) }), 'success', 1800);
}

// ── Usage (find_i18n_usages) ─────────────────────────────────────────────────────────────

async function loadUsage(k: string): Promise<void> {
    const box = $('tst-usage');
    const count = $('tst-usage-count');
    if (!box) return;
    let list = _usage[k];
    if (!list) {
        box.innerHTML = `<span class="tst-muted">${escHtml(t('common.loading'))}</span>`;
        try { list = (await invoke('find_i18n_usages', { key: k })) || []; } catch { list = []; }
        if (!Array.isArray(list)) list = [];
        _usage[k] = list;
    }
    if (_sel !== k) return;
    if (count) count.textContent = String(list.length);
    if (!list.length) { box.innerHTML = `<span class="tst-muted">${escHtml(t('i18n.noUsage'))}</span>`; return; }
    box.innerHTML = list.slice(0, 30).map((u) => `
        <button type="button" class="tst-uline" data-ts="copy-loc" data-loc="${escAttr(`${u.file}:${u.line}`)}" data-tooltip="${escAttr(t('i18n.copyLoc'))}">
            <span class="tst-ufile">${escHtml(u.file.replace(/^.*[/\\]/, ''))}<span class="tst-uln">:${u.line}</span></span>
            <code class="tst-usnip">${escHtml(u.snippet || '')}</code>
        </button>`).join('') + (list.length > 30 ? `<span class="tst-muted">+${list.length - 30} ${escHtml(t('i18n.more'))}</span>` : '');
}

// ── Untranslated text (hardcoded strings) ────────────────────────────────────────────────

const kindOf = (h: { kind: string }) => (h.kind === 'js' ? 'ts' : h.kind);

async function loadScan(force: boolean): Promise<void> {
    if (_hcLoaded && !force) return renderScan();
    const list = $('tst-hc-list');
    if (list) list.innerHTML = `<div class="tst-empty"><p>${escHtml(t('i18n.hcScanning'))}</p></div>`;
    try { _hc = (await invoke('find_hardcoded_strings', { filter: '' })) || []; } catch { _hc = []; }
    if (!Array.isArray(_hc)) _hc = [];
    _hcLoaded = true;
    _hcSel = -1;
    renderTabs();
    renderScan();
    renderScanDetail();
}

function renderScan(): void {
    const list = $('tst-hc-list');
    const kinds = $('tst-hc-kinds');
    if (!list) return;
    const q = _hcQuery;
    const kc: Record<string, number> = { all: 0, html: 0, ts: 0, toast: 0 };
    const shown: number[] = [];
    _hc.forEach((h, i) => {
        if (q && !(h.text || '').toLowerCase().includes(q) && !(h.file || '').toLowerCase().includes(q)) return;
        const k = kindOf(h);
        kc.all++; kc[k] = (kc[k] || 0) + 1;
        if (_hcKind === 'all' || k === _hcKind) shown.push(i);
    });
    if (kinds) {
        kinds.innerHTML = [['all', t('i18n.filterAll')], ['html', 'HTML'], ['ts', 'TS'], ['toast', t('i18n.filterToasts')]].map(([id, label]) => `
            <button type="button" class="tst-chip" data-ts="hc-kind" data-kind="${id}" aria-pressed="${id === _hcKind}"><span>${escHtml(label)}</span><span class="tst-chip-n">${kc[id] || 0}</span></button>`).join('');
    }
    if (!shown.length) {
        list.innerHTML = `<div class="tst-empty"><p>${escHtml(_hc.length ? t('i18n.noResults') : t('i18n.hcNone'))}</p>${_hc.length ? '' : `<p class="tst-muted">${escHtml(t('i18n.hcHint'))}</p>`}</div>`;
        return;
    }
    let file = '';
    const rows: string[] = [];
    for (const i of shown.slice(0, 600)) {
        const h = _hc[i];
        if (h.file !== file) { file = h.file; rows.push(`<div class="tst-sec" role="presentation" title="${escAttr(file)}">${escHtml(file.replace(/^.*[/\\]/, ''))}</div>`); }
        rows.push(`<div class="tst-row is-hc" role="option" data-ts="hc-row" data-i="${i}" aria-selected="${i === _hcSel}">
            <span class="tst-kind is-${escAttr(kindOf(h))}">${escHtml(kindOf(h))}</span>
            <span class="tst-row-k is-text">${escHtml(h.text)}</span>
            <span class="tst-uln">L${h.line}</span>
        </div>`);
    }
    list.innerHTML = rows.join('');
}

/** A key for a string that has none: an existing key with the very same text first. */
function suggestKey(text: string, file: string): { key: string; existing: boolean } {
    const norm = text.trim().toLowerCase();
    for (const [k, v] of Object.entries(_trans.en || {})) {
        if (typeof v === 'string' && !k.startsWith('_') && v.trim().toLowerCase() === norm) return { key: k, existing: true };
    }
    const base = (file || '').replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '').replace(/[-_.](\w)/g, (_m, c) => c.toUpperCase());
    const area = !base || base === 'index' ? 'ui' : base.charAt(0).toLowerCase() + base.slice(1);
    const words = text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 4);
    const slug = words.map((w, i) => (i ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'text';
    return { key: `${area}.${slug.slice(0, 32)}`, existing: false };
}

function renderScanDetail(picked?: string): void {
    const el = $('tst-hc-detail');
    if (!el) return;
    const h = _hcSel >= 0 ? _hc[_hcSel] : null;
    const text = picked ?? h?.text;
    if (!text) {
        el.innerHTML = `<div class="tst-start"><h3 class="tst-start-t">${escHtml(t('tstudio.tabScan'))}</h3><p class="tst-hint">${escHtml(t('i18n.hcHint'))}</p><p class="tst-hint">${escHtml(t('i18n.hcPick'))}</p></div>`;
        return;
    }
    const hits = picked ? _hc.filter((x) => (x.text || '').trim().toLowerCase() === picked.trim().toLowerCase()).slice(0, 8) : [h!];
    const sug = suggestKey(text, hits[0]?.file || '');
    const isHtml = (hits[0]?.kind || '') === 'html' || /\.html?$/i.test(hits[0]?.file || '');
    const call = isHtml ? `data-i18n="${sug.key}"` : `t('${sug.key}')`;
    el.innerHTML = `
        <blockquote class="tst-quote">${escHtml(text)}</blockquote>
        <section class="tst-block">
            <div class="tst-block-h"><span class="tst-cap">${escHtml(sug.existing ? t('i18n.hcReuse') : t('i18n.hcSuggested'))}</span></div>
            <code class="tst-sugg">${escHtml(sug.key)}</code>
            <div class="tst-pv-actions">
                <button type="button" class="btn btn-secondary btn-xs" data-ts="copy" data-copy="${escAttr(sug.key)}">${escHtml(t('i18n.copyKey'))}</button>
                <button type="button" class="btn btn-ghost btn-xs" data-ts="copy" data-copy="${escAttr(call)}">${escHtml(isHtml ? t('i18n.copyAttr') : t('i18n.copyCall'))}</button>
                ${sug.existing ? `<button type="button" class="btn btn-ghost btn-xs" data-ts="open-key" data-key="${escAttr(sug.key)}">${escHtml(t('tstudio.openKey'))}</button>` : ''}
            </div>
        </section>
        <section class="tst-block">
            <div class="tst-block-h"><span class="tst-cap">${escHtml(t('i18n.hcLocated'))}</span></div>
            ${hits.length ? hits.map((x) => `<button type="button" class="tst-uline" data-ts="copy-loc" data-loc="${escAttr(`${x.file}:${x.line}`)}" data-tooltip="${escAttr(t('i18n.copyLoc'))}">
                <span class="tst-ufile">${escHtml(x.file)}<span class="tst-uln">:${x.line}</span></span>${x.snippet ? `<code class="tst-usnip">${escHtml(x.snippet)}</code>` : ''}</button>`).join('') : `<p class="tst-hint">${escHtml(t('i18n.hcNotLocated'))}</p>`}
        </section>
        <div class="tst-pv-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-ts="hc-find" data-text="${escAttr(text)}">${uiIcon('eye', 14)}<span>${escHtml(t('i18n.hcFind'))}</span></button>
        </div>`;
}

function findTextOnScreen(text: string): boolean {
    const norm = text.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!norm) return false;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walk.nextNode())) {
        const p = n.parentElement;
        if (!p || _root?.contains(p) || p.closest('script,style,template')) continue;
        if (!(n.textContent || '').replace(/\s+/g, ' ').toLowerCase().includes(norm) || !p.getClientRects().length) continue;
        p.scrollIntoView({ block: 'center', behavior: 'smooth' });
        p.classList.add('tst-flash');
        setTimeout(() => p.classList.remove('tst-flash'), 2600);
        return true;
    }
    return false;
}

// ── Pick a text in the app ───────────────────────────────────────────────────────────────

function nearestTextEl(target: HTMLElement): HTMLElement | null {
    const i18nEl = target.closest('[data-i18n],[data-i18n-placeholder],[data-i18n-title],[data-i18n-tooltip]') as HTMLElement | null;
    if (i18nEl) return i18nEl;
    for (let el: HTMLElement | null = target; el && !_root?.contains(el); el = el.parentElement) {
        if (Array.from(el.childNodes).some((c) => c.nodeType === 3 && (c.textContent || '').trim().length > 1)) return el;
    }
    return target;
}
function setHover(el: HTMLElement | null): void {
    if (el === _hoverEl) return;
    _hoverEl?.classList.remove('tst-pick-hover');
    _hoverEl = el;
    el?.classList.add('tst-pick-hover');
}
function onPickHover(e: MouseEvent): void {
    if (_root?.contains(e.target as Node)) { setHover(null); return; }
    setHover(nearestTextEl(e.target as HTMLElement));
}
function onPickClick(e: MouseEvent): void {
    if (_root?.contains(e.target as Node)) return;
    const el = nearestTextEl(e.target as HTMLElement);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    setPick(false);
    const key = el.getAttribute('data-i18n') || el.getAttribute('data-i18n-placeholder') || el.getAttribute('data-i18n-title') || el.getAttribute('data-i18n-tooltip');
    if (key) { selectKey(key, true); return; }
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!txt) return;
    // Text the app renders through t() has no attribute: look its value up before calling it hardcoded.
    const norm = txt.toLowerCase();
    const lang = getLang();
    const hit = _keys.find((k) => !isMeta(k) && !isSection(k) && valueOf(k, lang).trim().toLowerCase() === norm);
    if (hit) { selectKey(hit, true); return; }
    _tab = 'scan';
    renderTabs();
    void loadScan(false).then(() => { _hcSel = -1; renderScanDetail(txt); });
    toast(t('i18n.pickedHc'), 'warning', 1800);
}
function setPick(on: boolean): void {
    _pick = on;
    $('tst-pick')?.setAttribute('aria-pressed', String(on));
    $('tst-pick')?.classList.toggle('is-on', on);
    document.body.classList.toggle('tst-picking', on);
    if (on) {
        document.addEventListener('mouseover', onPickHover, true);
        document.addEventListener('click', onPickClick, true);
        toast(t('i18n.pickOn'), 'info', 3200);
    } else {
        document.removeEventListener('mouseover', onPickHover, true);
        document.removeEventListener('click', onPickClick, true);
        setHover(null);
    }
}

// ── New language ─────────────────────────────────────────────────────────────────────────

function openSheet(html: string): HTMLElement | null {
    const sh = $('tst-sheet');
    if (!sh) return null;
    sh.innerHTML = html;
    sh.hidden = false;
    requestAnimationFrame(() => (sh.querySelector('input, select') as HTMLElement | null)?.focus({ preventScroll: true }));
    return sh;
}
function closeSheet(): void { const sh = $('tst-sheet'); if (sh) { sh.hidden = true; sh.innerHTML = ''; } }

function newLanguageSheet(): void {
    const langs = Object.keys(_trans).sort();
    openSheet(`
        <div class="tst-sheet-in" role="group" aria-labelledby="tst-nl-title">
            <h3 class="tst-sheet-t" id="tst-nl-title">${escHtml(t('tstudio.nlTitle'))}</h3>
            <p class="tst-hint">${escHtml(t('tstudio.nlIntro'))}</p>
            <label class="tst-field"><span class="tst-cap">${escHtml(t('tstudio.nlCode'))}</span>
                <input id="tst-nl-code" class="form-input" maxlength="12" autocomplete="off" spellcheck="false" placeholder="de" data-ts-field="nl-code"></label>
            <label class="tst-field"><span class="tst-cap">${escHtml(t('tstudio.nlName'))}</span>
                <input id="tst-nl-name" class="form-input" maxlength="40" autocomplete="off" placeholder="Deutsch"></label>
            <fieldset class="tst-field tst-radios">
                <legend class="tst-cap">${escHtml(t('tstudio.nlStart'))}</legend>
                <label><input type="radio" name="tst-nl-seed" value="" checked> ${escHtml(t('tstudio.nlEmpty'))}</label>
                <label><input type="radio" name="tst-nl-seed" value="copy"> ${escHtml(t('tstudio.nlCopy'))}
                    <select id="tst-nl-from" class="tst-select">${langs.map((l) => `<option value="${escAttr(l)}"${l === _src ? ' selected' : ''}>${escHtml(l.toUpperCase())}</option>`).join('')}</select></label>
            </fieldset>
            <p class="tst-nl-err" id="tst-nl-err" role="alert"></p>
            <div class="tst-sheet-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-ts="sheet-cancel">${escHtml(t('common.cancel'))}</button>
                <button type="button" class="btn btn-primary btn-sm" data-ts="nl-create">${escHtml(t('i18n.create'))}</button>
            </div>
        </div>`);
}

async function createLanguage(): Promise<void> {
    const code = (($<HTMLInputElement>('tst-nl-code')?.value) || '').trim().toLowerCase();
    const name = (($<HTMLInputElement>('tst-nl-name')?.value) || '').trim();
    const seed = (_root?.querySelector('input[name="tst-nl-seed"]:checked') as HTMLInputElement | null)?.value || '';
    const from = seed === 'copy' ? ($<HTMLSelectElement>('tst-nl-from')?.value || null) : null;
    const err = $('tst-nl-err');
    const fail = (m: string) => { if (err) err.textContent = m; };
    if (!/^[a-z]{2,3}([-_][a-z0-9]{2,8})?$/.test(code)) { fail(t('tstudio.nlBadCode')); return; }
    if (_trans[code]) { fail(t('i18n.newLangExists')); return; }
    try {
        const seeded: string = await invoke('create_language_file', { code, copyFrom: from });
        // The seed carries its source's _info (« English »): the new file gets its own name.
        let obj: Record<string, any> = {};
        try { obj = JSON.parse(seeded || '{}'); } catch { obj = {}; }
        const info = { name: name || code.toUpperCase(), flag: code.split(/[-_]/)[0], suffix: `_${code.toUpperCase()}` };
        obj = { _info: info, ...Object.fromEntries(Object.entries(obj).filter(([k]) => k !== '_info')) };
        await invoke('import_language_data', { code, content: JSON.stringify(obj, null, 2) });
        closeSheet();
        _loaded = false;
        lsSet(LS.tgt, code);
        lsSet(LS.src, from || (_trans.en ? 'en' : _src));
        await loadData();
        _tgt = code;
        _sel = null;
        renderAll();
        toast(t('tstudio.nlCreated', { lang: info.name }), 'success');
    } catch (e) {
        fail(String(e));
    }
}

// ── Import / export ──────────────────────────────────────────────────────────────────────

/** The complete file of the target: its order and everything in it, drafts applied. */
function buildExport(lang: string): Record<string, any> {
    const source = _disk[lang] || _trans[lang] || {};
    const out: Record<string, any> = {};
    for (const k of Object.keys(source)) out[k] = source[k];
    for (const [k, s] of Object.entries(_drafts[lang] || {})) {
        const orig = source[k];
        if (orig && typeof orig === 'object') {
            try { out[k] = JSON.parse(s); } catch { out[k] = orig; }
        } else out[k] = s;
    }
    return out;
}

function exportTarget(): void {
    const out = buildExport(_tgt);
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${_tgt}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('tstudio.exported', { file: `${_tgt}.json`, n: String(Object.keys(out).length) }), 'success');
}

async function importFile(file: File): Promise<void> {
    let data: Record<string, any>;
    const text = await file.text();
    try { data = JSON.parse(text); } catch { toast(t('tstudio.importBad'), 'error'); return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { toast(t('tstudio.importBad'), 'error'); return; }
    const stem = file.name.replace(/\.json$/i, '').toLowerCase();
    const code = /^[a-z]{2,3}([-_][a-z0-9]{2,8})?$/.test(stem) ? stem : _tgt;
    if (code === 'template') { toast(t('tstudio.importBad'), 'error'); return; }
    if (!_trans[code]) {
        // A language BMM does not have: installed as it is, like the Settings import.
        try {
            await invoke('import_language_data', { code, content: text });
            _loaded = false;
            lsSet(LS.tgt, code);
            await loadData();
            _tgt = code;
            renderAll();
            toast(t('tstudio.importInstalled', { lang: code.toUpperCase() }), 'success');
        } catch (e) { toast(String(e), 'error'); }
        return;
    }
    // A language BMM has: what differs from its file becomes drafts, to review before export.
    const drafts = draftsOf(code);
    let n = 0;
    for (const [k, v] of Object.entries(data)) {
        if (isSection(k)) continue;
        const s = show(v);
        if (s === diskStr(k, code)) { delete drafts[k]; continue; }
        drafts[k] = s;
        if (!_keys.includes(k)) _keys.push(k);
        n++;
    }
    saveDrafts();
    _tgt = code;
    lsSet(LS.tgt, code);
    _filter = n ? 'changed' : _filter;
    renderAll();
    toast(n ? t('tstudio.imported', { n: String(n), lang: code.toUpperCase() }) : t('tstudio.importSame'), n ? 'success' : 'info');
}

async function copy(text: string, msg: string): Promise<void> {
    try { await navigator.clipboard?.writeText(text); toast(msg, 'success', 1500); } catch { toast(text, 'info', 3000); }
}

// ── Events (delegated: the pop-out window replays them on the same elements) ─────────────

function onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-ts]');
    if (!el || !_root?.contains(el)) return;
    const k = _sel;
    switch (el.dataset.ts) {
        case 'close': closeTranslationStudio(); break;
        case 'pick': setPick(!_pick); break;
        case 'swap': [_src, _tgt] = [_tgt, _src]; onLangChange(); break;
        case 'set-target': if (el.dataset.lang && el.dataset.lang !== _tgt) { if (el.dataset.lang === _src) _src = _tgt; _tgt = el.dataset.lang; onLangChange(); } break;
        case 'new-lang': newLanguageSheet(); break;
        case 'sheet-cancel': closeSheet(); break;
        case 'nl-create': void createLanguage(); break;
        case 'tab': _tab = (el.dataset.tab as Tab) || 'keys'; renderTabs(); if (_tab === 'scan') void loadScan(false); break;
        case 'filter': _filter = (el.dataset.filter as Filter) || 'all'; lsSet(LS.filter, _filter); renderList(); break;
        case 'clear-filters': {
            _filter = 'all'; _query = '';
            const box = $<HTMLInputElement>('tst-search');
            if (box) box.value = '';
            renderList();
            break;
        }
        case 'row': if (el.dataset.key) selectKey(el.dataset.key, true); break;
        case 'next-missing': nextMissing(); break;
        case 'prev': move(-1, true); break;
        case 'next': move(1, true); break;
        case 'copy-key': if (k) void copy(k, t('i18n.keyCopied')); break;
        case 'use-source': {
            const ta = $<HTMLTextAreaElement>('tst-value');
            if (ta && k) { ta.value = _src === _tgt ? diskStr(k, _src) : valueOf(k, _src); setValue(k, ta.value); focusValue(); }
            break;
        }
        case 'insert-var': if (el.dataset.var) insertVar(el.dataset.var); break;
        case 'revert': if (k) { delete draftsOf(_tgt)[k]; saveDrafts(); if (_live) pushLive(); updateRow(k); renderEditor(); renderFoot(); renderProgressSoon(); } break;
        case 'revert-all': revertAll(); break;
        case 'test-toast': if (k) testToast(k); break;
        case 'find-in-app': if (k) findInApp(k); break;
        case 'usage': if (k) setTimeout(() => { if ((_root?.querySelector('#tst-usage-box') as HTMLDetailsElement | null)?.open) void loadUsage(k); }, 0); break;
        case 'copy-loc': void copy(el.dataset.loc || '', `${t('i18n.locCopied')}: ${el.dataset.loc}`); break;
        case 'copy': void copy(el.dataset.copy || '', t('i18n.copied')); break;
        case 'open-key': if (el.dataset.key) selectKey(el.dataset.key, true); break;
        case 'hc-kind': _hcKind = el.dataset.kind || 'all'; renderScan(); break;
        case 'hc-rescan': void loadScan(true); break;
        case 'hc-row': {
            _hcSel = Number(el.dataset.i);
            $('tst-hc-list')?.querySelectorAll('.tst-row[aria-selected="true"]').forEach((r) => r.setAttribute('aria-selected', 'false'));
            el.setAttribute('aria-selected', 'true');
            renderScanDetail();
            break;
        }
        case 'hc-find': if (findTextOnScreen(el.dataset.text || '')) toast(t('i18n.hcFound'), 'success', 1600); else toast(t('i18n.hcNotOnScreen'), 'info', 2600); break;
        case 'import': $<HTMLInputElement>('tst-import-file')?.click(); break;
        case 'export': exportTarget(); break;
    }
}

function onInput(e: Event): void {
    const el = e.target as HTMLElement;
    switch (el.dataset.tsField) {
        case 'value': if (_sel) setValue(_sel, (el as HTMLTextAreaElement).value); break;
        case 'search': _query = (el as HTMLInputElement).value.toLowerCase().trim(); renderListSoon(); break;
        case 'hc-search': _hcQuery = (el as HTMLInputElement).value.toLowerCase().trim(); renderScan(); break;
    }
}

function onChange(e: Event): void {
    const el = e.target as HTMLElement;
    if (el.id === 'tst-import-file') {
        const f = (el as HTMLInputElement).files?.[0];
        (el as HTMLInputElement).value = '';
        if (f) void importFile(f);
        return;
    }
    switch (el.dataset.tsField) {
        case 'source': _src = (el as HTMLSelectElement).value; if (_src === _tgt) _tgt = Object.keys(_trans).find((l) => l !== _src) || _tgt; onLangChange(); break;
        case 'target': {
            const v = (el as HTMLSelectElement).value;
            if (v === _src) _src = _tgt;
            _tgt = v;
            onLangChange();
            break;
        }
        case 'live': setLive((el as HTMLInputElement).checked); break;
    }
}

function onLangChange(): void {
    lsSet(LS.src, _src); lsSet(LS.tgt, _tgt);
    if (_live) pushLive();
    renderLangs();
    renderList();
    if (_sel) renderEditor(); else renderEditorEmpty();
    renderFoot();
}

function onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const box = $<HTMLInputElement>(_tab === 'scan' ? 'tst-hc-search' : 'tst-search');
        if (box) { e.preventDefault(); box.focus(); box.select(); }
        return;
    }
    if (el.id === 'tst-value') {
        if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1, true); }
        else if (e.key === 'Escape') { e.preventDefault(); $('tst-list')?.focus({ preventScroll: true }); }
        return;
    }
    if (el.id === 'tst-search' && e.key === 'ArrowDown' && _visible.length) {
        e.preventDefault();
        selectKey(_sel && _visible.includes(_sel) ? _sel : _visible[0], false);
        $('tst-list')?.focus({ preventScroll: true });
        return;
    }
    if (el.id === 'tst-list') {
        if (e.key === 'Enter' && _sel) { e.preventDefault(); focusValue(); return; }
        if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); const k = e.key === 'Home' ? _visible[0] : _visible[_visible.length - 1]; if (k) selectKey(k, false); return; }
        const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? 10 : e.key === 'PageUp' ? -10 : 0;
        if (step) { e.preventDefault(); move(step, false); }
        return;
    }
    if (e.key === 'Escape') {
        if (!$('tst-sheet')?.hidden) { e.preventDefault(); closeSheet(); }
        else if (_pick) { e.preventDefault(); setPick(false); }
    }
}

// The pick mode is the one thing that listens outside the studio: Escape anywhere ends it.
document.addEventListener('keydown', (e) => { if (_pick && e.key === 'Escape') setPick(false); });

/** The head drags the window inside BMM's frame. Kept last in the file: it is the one document-level
 *  listener here, and it reads nothing from the markup. */
function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('button, input, select, textarea, label, a')) return;
        e.preventDefault();
        const r = panel.getBoundingClientRect();
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        const cb = (panel.offsetParent as HTMLElement) || document.documentElement;
        panel.classList.add('is-dragging');
        const onDragMove = (ev: MouseEvent) => {
            const pr = cb.getBoundingClientRect();
            panel.style.left = `${Math.max(0, Math.min(pr.width - 120, ev.clientX - ox - pr.left))}px`;
            panel.style.top = `${Math.max(0, Math.min(pr.height - 48, ev.clientY - oy - pr.top))}px`;
        };
        const onDragEnd = () => {
            panel.classList.remove('is-dragging');
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
            saveGeomSoon();
        };
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
    });
}

/** For the node tests. */
export const _studioForTests = { varsOf, tagsOf, suggestKey, buildExport };
