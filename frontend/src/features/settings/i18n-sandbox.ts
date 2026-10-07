// @ts-nocheck
// ── i18n Translation Sandbox ──────────────────────────────────────────────────
// In-memory playground to browse/edit every translatable key (auto-saved to a sandbox, never
// the live app), preview them as toasts AND Tasky tooltips, pick any text straight from the
// app, find hardcoded (non-i18n) text, create new languages, and export a finished .json.
//
// Layout (css/i18n-sandbox.css): the toolbar band holds the two tabs and the SOURCE → TARGET
// pair; the body is a list | editor split. The editor shows the source text beside the target
// field, so translating is reading one and typing the other, not hunting for the English in a
// list under the field. The hardcoded tab groups its findings by file and offers a key for
// each one (an existing key with the same text first, else a suggested name).

import { invoke } from '../../core/api.js';
import { claimDockSpace, releaseDockSpace, makeDock } from '../../ui/dock-space.js';
import { getAllTranslations, getLang, t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { uiIcon } from '../../ui/icons.js';

let _allTrans: Record<string, Record<string, string>> = {};
let _allKeys: string[] = [];
let _baseLang = 'en';                             // the TARGET: the language being edited
let _refLang = 'en';                              // the SOURCE: shown beside it, read-only
let _sandbox: Record<string, string> = {};
let _selectedKey: string | null = null;
let _usageCache: Record<string, any[]> = {};
let _diskParsed: Record<string, any> = {};        // raw parsed lang files (preserve order + _info/_synonyms)
let _filter = 'all';                              // all | missing | edited | same
let _visible: string[] = [];                      // the keys the list shows, in order (keyboard)
let _modal: HTMLElement | null = null;
let _hcData: any[] = [];
let _hcLoaded = false;
let _hcKind = 'all';
let _hcSel = -1;                                  // index into _hcData
let _hcVisible: number[] = [];
const _hcFolded = new Set<string>();
const SRC_KEY = 'bmm.i18nsb.source';
const TGT_KEY = 'bmm.i18nsb.target';
const CSS_ID = 'i18n-sandbox-css';

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
    let h: any;
    return ((...a: any[]) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }) as T;
}
const debouncedRenderList = debounce(() => renderList(), 140);
const debouncedRenderHardcoded = debounce(() => renderHardcoded(), 140);
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };

/** The dialog's content styles. Linked on first open: the sandbox is a developer tool, not
 *  something every boot should pay for. */
function ensureCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/i18n-sandbox.css';
    document.head.appendChild(link);
}

export function initI18nSandbox(): void {
    const openBtn = document.getElementById('btn-open-i18n-sandbox');
    const modal = document.getElementById('modal-i18n-sandbox');
    if (!openBtn || !modal) return;
    _modal = modal;

    const host = document.getElementById('app-window-outer') || document.body;
    if (modal.parentElement !== host) host.appendChild(modal);

    const closeModal = () => {
        if (_pickMode) togglePickMode(false);
        if (_hlMode) toggleHighlight(false);
        if (_overlayMode) toggleOverlayMode(modal, false);
        if (_dockMode) toggleDockMode(modal, false, false);   // keep the preference
        // The live-test overlay dies with the sandbox. A draft that kept speaking after
        // its editor closed would be indistinguishable from the app's real text — the
        // exact confusion a sandbox exists to prevent.
        const live = document.getElementById('i18n-test-live') as HTMLInputElement | null;
        if (live?.checked) {
            live.checked = false;
            void import('../../core/i18n.js').then((m) => m.setSandboxOverlay(null));
        }
        modal.classList.remove('open');
        document.body.style.overflow = '';
    };

    openBtn.addEventListener('click', async () => {
        ensureCss();
        await loadData();
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        switchTab('keys');
        renderList();
        updateDirty();
        if (lsGet(I18N_DOCK_KEY) === 'right') toggleDockMode(modal, true);
        requestAnimationFrame(() => (document.getElementById('i18n-search') as HTMLInputElement | null)?.focus({ preventScroll: true }));
    });

    modal.addEventListener('click', (e) => { if (e.target === modal && !_overlayMode) closeModal(); });
    modal.querySelector('[data-close="modal-i18n-sandbox"]')?.addEventListener('click', closeModal);

    modal.querySelectorAll<HTMLElement>('[data-i18n-tab]').forEach((tab) =>
        tab.addEventListener('click', () => switchTab(tab.dataset.i18nTab || 'keys')));
    // Arrow keys move between the two tabs, the way a tablist does.
    modal.querySelector('.i18x-toolbar [role="tablist"]')?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const tabs = [...modal.querySelectorAll<HTMLElement>('[data-i18n-tab]')];
        const at = tabs.indexOf(document.activeElement as HTMLElement);
        if (at < 0) return;
        e.preventDefault();
        const next = tabs[(at + 1) % tabs.length];
        next.focus();
        switchTab(next.dataset.i18nTab || 'keys');
    });

    // ── Keys list: click selects, the keyboard walks it ──
    const list = document.getElementById('i18n-key-list');
    list?.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest('.i18x-krow') as HTMLElement | null;
        if (row?.dataset.key) selectKey(row.dataset.key, { focusEditor: true });
    });
    list?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && _selectedKey) { e.preventDefault(); focusEditor(); return; }
        const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? 12 : e.key === 'PageUp' ? -12 : 0;
        if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            const k = e.key === 'Home' ? _visible[0] : _visible[_visible.length - 1];
            if (k) selectKey(k, { focusEditor: false });
            return;
        }
        if (!step) return;
        e.preventDefault();
        moveSelection(step, false);
    });

    // Tools
    document.getElementById('i18n-pick-screen')?.addEventListener('click', () => togglePickMode());
    document.getElementById('i18n-highlight-hc')?.addEventListener('click', () => toggleHighlight());
    document.getElementById('i18n-overlay-toggle')?.addEventListener('click', () => toggleOverlayMode(modal));
    document.getElementById('i18n-dock-toggle')?.addEventListener('click', () => toggleDockMode(modal));
    document.getElementById('i18n-new-lang')?.addEventListener('click', promptNewLanguage);

    // Filters — debounce the search so we don't rebuild the (large) key list on
    // every keystroke (prevents typing lag with 1500+ keys).
    const search = document.getElementById('i18n-search') as HTMLInputElement | null;
    search?.addEventListener('input', debouncedRenderList);
    search?.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' || !_visible.length) return;
        e.preventDefault();
        selectKey(_selectedKey && _visible.includes(_selectedKey) ? _selectedKey : _visible[0], { focusEditor: false });
        list?.focus({ preventScroll: true });
    });
    const onLang = () => {
        lsSet(SRC_KEY, _refLang); lsSet(TGT_KEY, _baseLang);
        refreshLangSelect();
        renderList();
        if (_selectedKey) renderDetail(_selectedKey);
    };
    document.getElementById('i18n-base-lang')?.addEventListener('change', (e) => {
        _baseLang = (e.target as HTMLSelectElement).value;
        onLang();
    });
    document.getElementById('i18n-ref-lang')?.addEventListener('change', (e) => {
        _refLang = (e.target as HTMLSelectElement).value;
        onLang();
    });
    document.getElementById('i18n-swap-langs')?.addEventListener('click', () => {
        [_refLang, _baseLang] = [_baseLang, _refLang];
        onLang();
    });
    document.getElementById('i18n-filter-seg')?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i18n-filter]');
        if (!b) return;
        _filter = b.dataset.i18nFilter || 'all';
        renderList();
    });

    // Jump to the next untranslated key (wraps) — the fastest way to finish a language.
    document.getElementById('i18n-next-missing')?.addEventListener('click', selectNextMissing);

    // Ctrl+F finds in the tab that is showing.
    modal.addEventListener('keydown', (e: KeyboardEvent) => {
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return;
        const hc = !document.querySelector('[data-i18n-panel="hardcoded"]')?.hasAttribute('hidden');
        const box = document.getElementById(hc ? 'i18n-hc-search' : 'i18n-search') as HTMLInputElement | null;
        if (!box) return;
        e.preventDefault();
        box.focus(); box.select();
    });

    // Floating-window opacity (only visible in overlay mode; persisted).
    const opRange = document.getElementById('i18n-ovl-opacity-range') as HTMLInputElement | null;
    if (opRange) {
        opRange.value = lsGet('bmm_i18n_overlay_opacity') || '100';
        opRange.addEventListener('input', () => {
            lsSet('bmm_i18n_overlay_opacity', opRange.value);
            const panel = _modal?.querySelector('.modal') as HTMLElement | null;
            if (panel && _overlayMode) panel.style.opacity = String(Number(opRange.value) / 100);
        });
    }

    // ── Hardcoded tab ──
    document.getElementById('i18n-hc-search')?.addEventListener('input', debouncedRenderHardcoded);
    document.getElementById('i18n-hc-search')?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'ArrowDown' || !_hcVisible.length) return;
        e.preventDefault();
        selectHc(_hcVisible.includes(_hcSel) ? _hcSel : _hcVisible[0]);
        document.getElementById('i18n-hc-list')?.focus({ preventScroll: true });
    });
    document.getElementById('i18n-hc-kind')?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
        if (!b) return;
        _hcKind = b.dataset.kind || 'all';
        renderHardcoded();
    });
    document.getElementById('i18n-hc-rescan')?.addEventListener('click', () => { _hcLoaded = false; loadHardcoded(true); });
    const hcList = document.getElementById('i18n-hc-list');
    hcList?.addEventListener('click', (e) => {
        const head = (e.target as HTMLElement).closest<HTMLElement>('.i18x-hcfile-head');
        if (head?.dataset.file) { toggleFold(head.dataset.file); return; }
        const row = (e.target as HTMLElement).closest<HTMLElement>('.i18x-hcrow');
        if (row?.dataset.i) selectHc(Number(row.dataset.i));
    });
    hcList?.addEventListener('keydown', (e: KeyboardEvent) => {
        const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? 12 : e.key === 'PageUp' ? -12 : 0;
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && _hcSel >= 0) {
            const file = _hcData[_hcSel]?.file;
            if (file && (e.key === 'ArrowLeft') !== _hcFolded.has(file)) { e.preventDefault(); toggleFold(file); }
            return;
        }
        if (e.key === 'Enter' && _hcSel >= 0) { e.preventDefault(); copyLoc(_hcData[_hcSel]); return; }
        if (!step || !_hcVisible.length) return;
        e.preventDefault();
        const at = _hcVisible.indexOf(_hcSel);
        const to = at < 0 ? 0 : Math.max(0, Math.min(_hcVisible.length - 1, at + step));
        selectHc(_hcVisible[to]);
    });

    document.getElementById('i18n-reset')?.addEventListener('click', () => {
        if (Object.keys(_sandbox).length === 0) { toast(t('i18n.nothingToReset'), 'info'); return; }
        _sandbox = {};
        updateDirty(); renderList();
        if (_selectedKey) renderDetail(_selectedKey);
        toast(t('i18n.resetDone'), 'success');
    });
    document.getElementById('i18n-export')?.addEventListener('click', exportSandbox);

    // ── Test in app ─────────────────────────────────────────────────────────────
    // The one thing "Preview live" could not do. That button rewrites visible
    // data-i18n elements — but most of BMM's text goes through t() in TS-rendered
    // markup, which a DOM rewrite can never reach. This toggle slips the sandbox over
    // the dictionary INSIDE t() (core/i18n.ts), so every toast, panel and re-render
    // speaks your draft until you switch it off or close the sandbox.
    document.getElementById('i18n-test-live')?.addEventListener('change', async (e) => {
        const on = (e.target as HTMLInputElement).checked;
        const { setSandboxOverlay } = await import('../../core/i18n.js');
        setSandboxOverlay(on ? { ..._sandbox } : null);
        toast(on ? t('i18n.testOn') : t('i18n.testOff'), on ? 'warning' : 'info', 2600);
    });
}

// ── Status of a key, for the TARGET language ─────────────────────────────────────
function isMissingKey(k: string): boolean { return !isObjKey(k) && !isSectionKey(k) && !valueFor(k, _baseLang).trim(); }
function isSameKey(k: string): boolean {
    if (_refLang === _baseLang || isObjKey(k) || isSectionKey(k)) return false;
    const v = valueFor(k, _baseLang).trim();
    return !!v && v === valueFor(k, _refLang).trim();
}
function statusOf(k: string): 'missing' | 'edited' | 'same' | 'ok' {
    if (_sandbox[k] !== undefined) return 'edited';
    if (isMissingKey(k)) return 'missing';
    if (isSameKey(k)) return 'same';
    return 'ok';
}

/** Header progress: how complete the target language is (translated / total). */
function updateProgress(missing: number): void {
    const fill = document.getElementById('i18n-progress-fill');
    const txt = document.getElementById('i18n-progress-txt');
    if (!fill || !txt) return;
    const total = _allKeys.filter(k => !isObjKey(k) && !isSectionKey(k)).length;
    const done = Math.max(0, total - missing);
    const pct = total ? Math.round((done / total) * 100) : 100;
    (fill as HTMLElement).style.width = pct + '%';
    fill.className = pct >= 100 ? 'is-done' : pct >= 60 ? '' : 'is-low';
    txt.textContent = t('i18n.progress').replace('{lang}', _baseLang.toUpperCase()).replace('{done}', String(done)).replace('{total}', String(total)).replace('{pct}', String(pct));
}

/** Jump to the next missing key after the current selection (wraps around). */
function selectNextMissing(): void {
    const start = _selectedKey ? _allKeys.indexOf(_selectedKey) + 1 : 0;
    for (let i = 0; i < _allKeys.length; i++) {
        const k = _allKeys[(start + i) % _allKeys.length];
        if (isMissingKey(k)) {
            if (!_visible.includes(k)) {
                // The filter or the search hides it: show the gaps, so the row it lands on exists.
                _filter = 'missing';
                const box = document.getElementById('i18n-search') as HTMLInputElement | null;
                if (box) box.value = '';
            }
            selectKey(k, { focusEditor: true });
            return;
        }
    }
    toast(t('i18n.noMissing'), 'success');
}

function switchTab(name: string): void {
    if (!_modal) return;
    _modal.querySelectorAll<HTMLElement>('[data-i18n-tab]').forEach((tb) => {
        const on = tb.dataset.i18nTab === name;
        tb.setAttribute('aria-selected', String(on));
        tb.tabIndex = on ? 0 : -1;
    });
    _modal.querySelectorAll<HTMLElement>('[data-i18n-panel]').forEach((p) => { p.hidden = p.dataset.i18nPanel !== name; });
    _modal.querySelectorAll<HTMLElement>('[data-i18x-for]').forEach((p) => { p.hidden = p.dataset.i18xFor !== name; });
    if (name === 'hardcoded') loadHardcoded(false);
}

async function loadData(): Promise<void> {
    _allTrans = JSON.parse(JSON.stringify(getAllTranslations() || {}));
    try {
        const disk: Record<string, string> = await invoke('get_all_languages_content');
        for (const [lang, raw] of Object.entries(disk)) {
            try {
                const parsed = JSON.parse(raw);
                _diskParsed[lang] = parsed;                       // keep raw structure + order
                _allTrans[lang] = { ..._allTrans[lang], ...parsed };
            } catch {}
        }
    } catch {}

    const langs = Object.keys(_allTrans);
    const want = lsGet(TGT_KEY);
    _baseLang = want && langs.includes(want) ? want : (langs.includes(_baseLang) ? _baseLang : (getLang() || langs[0] || 'en'));
    const src = lsGet(SRC_KEY);
    _refLang = src && langs.includes(src) ? src : (langs.includes('en') && _baseLang !== 'en' ? 'en' : (langs.find((l) => l !== _baseLang) || _baseLang));

    // ALL keys (including _info, _synonyms, __SECTION__ …) — preserve base file order,
    // then append any keys only present in other languages.
    const ordered: string[] = [];
    const seen = new Set<string>();
    const baseSrc = _diskParsed[_baseLang] || _allTrans[_baseLang] || {};
    for (const k of Object.keys(baseSrc)) { if (!seen.has(k)) { seen.add(k); ordered.push(k); } }
    for (const dict of Object.values(_allTrans)) {
        for (const k of Object.keys(dict)) { if (!seen.has(k)) { seen.add(k); ordered.push(k); } }
    }
    _allKeys = ordered;

    refreshLangSelect();
    const kc = document.getElementById('i18n-tabcount-keys');
    if (kc) kc.textContent = String(_allKeys.filter((k) => !isSectionKey(k)).length);
}

function refreshLangSelect(): void {
    const langs = Object.keys(_allTrans).sort();
    for (const [id, cur] of [['i18n-base-lang', _baseLang], ['i18n-ref-lang', _refLang]] as const) {
        const sel = document.getElementById(id) as HTMLSelectElement | null;
        if (!sel) continue;
        sel.innerHTML = langs.map(l =>
            `<option value="${escAttr(l)}"${l === cur ? ' selected' : ''}>${escHtml(l.toUpperCase())}</option>`).join('');
        sel.value = cur;
    }
}

function rawVal(key: string, lang: string): any { return (_allTrans[lang] || {})[key]; }
function displayStr(v: any): string {
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v, null, 2);
    return String(v);
}
function isObjKey(key: string): boolean { return typeof rawVal(key, _baseLang) === 'object' && rawVal(key, _baseLang) !== null; }
function isSectionKey(key: string): boolean { return key.startsWith('__SECTION'); }
/** String shown in the editor / list for the base language (sandbox-aware). */
function baseDisplay(key: string): string {
    if (_sandbox[key] !== undefined) return _sandbox[key];
    return displayStr(rawVal(key, _baseLang));
}
function originalDisplay(key: string): string { return displayStr(rawVal(key, _baseLang)); }
/** Display string for any language (sandbox only affects base lang). */
function valueFor(key: string, lang: string): string {
    if (lang === _baseLang) return baseDisplay(key);
    return displayStr(rawVal(key, lang));
}

// ── Key list ──────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = { missing: 'i18n.filterMissing', edited: 'i18n.filterEdited', same: 'i18n.filterSame', ok: 'i18n.translated' };

function renderList(): void {
    const listEl = document.getElementById('i18n-key-list');
    const statsEl = document.getElementById('i18n-stats');
    if (!listEl) return;

    const q = ((document.getElementById('i18n-search') as HTMLInputElement)?.value || '').toLowerCase().trim();
    const counts = { all: 0, missing: 0, edited: 0, same: 0 };
    let missingAll = 0;
    let capped = 0;
    const rows: string[] = [];
    _visible = [];
    for (const key of _allKeys) {
        if (isSectionKey(key)) {
            // Section dividers only make sense in the unfiltered, unsearched list.
            if (_filter === 'all' && !q) rows.push(`<div class="i18x-ksec" role="presentation">${escHtml(String(rawVal(key, _baseLang) || key).replace(/^-+\s*|\s*-+$/g, ''))}</div>`);
            continue;
        }
        const st = statusOf(key);
        if (isMissingKey(key)) missingAll++;
        const val = valueFor(key, _baseLang);
        if (q && !key.toLowerCase().includes(q) && !val.toLowerCase().includes(q) && !valueFor(key, _refLang).toLowerCase().includes(q)) continue;
        counts.all++;
        if (isMissingKey(key)) counts.missing++;
        if (st === 'edited') counts.edited++;
        if (st === 'same') counts.same++;
        if (_filter === 'missing' && !isMissingKey(key)) continue;
        if (_filter === 'edited' && st !== 'edited') continue;
        if (_filter === 'same' && st !== 'same') continue;
        if (rows.length > 1500) { capped++; continue; }
        _visible.push(key);
        const isObj = isObjKey(key);
        const preview = isMissingKey(key) ? valueFor(key, _refLang).replace(/\s+/g, ' ').trim() : val.replace(/\s+/g, ' ').trim();
        rows.push(`
            <div class="i18x-krow is-${st}" role="option" data-key="${escAttr(key)}" aria-selected="${key === _selectedKey}">
                <span class="i18x-dot" title="${escAttr(t(STATUS_LABEL[st]))}"></span>
                <span class="i18x-k">${escHtml(key)}${isObj ? '<span class="i18x-tag">{ }</span>' : ''}</span>
                <span class="i18x-v${isMissingKey(key) ? ' is-src' : ''}">${escHtml(preview)}</span>
            </div>`);
    }

    if (capped) rows.push(`<div class="i18x-capped">${escHtml(t('i18n.listCapped').replace('{n}', String(capped)))}</div>`);
    listEl.innerHTML = rows.join('') || `<div class="bms-empty">
        <div class="bms-empty-t">${escHtml(t('i18n.noResults'))}</div>
        ${q || _filter !== 'all' ? `<button type="button" class="btn btn-ghost btn-sm" id="i18n-clear-filters">${escHtml(t('i18n.clearFilters'))}</button>` : ''}
    </div>`;
    document.getElementById('i18n-clear-filters')?.addEventListener('click', () => {
        const box = document.getElementById('i18n-search') as HTMLInputElement | null;
        if (box) box.value = '';
        _filter = 'all';
        renderList();
        box?.focus();
    });
    _modal?.querySelectorAll<HTMLElement>('#i18n-filter-seg [data-i18n-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.i18nFilter === _filter)));
    _modal?.querySelectorAll<HTMLElement>('#i18n-filter-seg [data-fn]').forEach((n) => { n.textContent = String(counts[n.dataset.fn as keyof typeof counts] ?? ''); });
    if (statsEl) statsEl.innerHTML = `<span><b>${_visible.length}</b> ${escHtml(t('i18n.shown'))}</span><span class="i18x-kbdmini">${escHtml(t('i18n.kbdShort'))}</span>`;
    updateProgress(missingAll);
}

/** Mark the selected row without rebuilding a 1500-row list. */
function markSelected(key: string | null, scroll = true): void {
    const listEl = document.getElementById('i18n-key-list');
    if (!listEl) return;
    listEl.querySelector('.i18x-krow[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    if (!key) return;
    const row = listEl.querySelector<HTMLElement>(`.i18x-krow[data-key="${CSS.escape(key)}"]`);
    row?.setAttribute('aria-selected', 'true');
    if (row) {
        row.id = 'i18x-active-row';
        listEl.setAttribute('aria-activedescendant', row.id);
        listEl.querySelectorAll('#i18x-active-row').forEach((r) => { if (r !== row) r.removeAttribute('id'); });
        if (scroll) row.scrollIntoView({ block: 'nearest' });
    }
}

function selectKey(key: string, opts: { focusEditor?: boolean } = {}): void {
    if (!_allKeys.includes(key)) { _allKeys.push(key); _allKeys.sort(); }
    _selectedKey = key;
    switchTab('keys');
    if (!_visible.includes(key)) renderList();
    markSelected(key);
    renderDetail(key);
    if (opts.focusEditor !== false) requestAnimationFrame(focusEditor);
}

function focusEditor(): void {
    const ta = document.getElementById('i18n-edit-value') as HTMLTextAreaElement | null;
    if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

/** Previous / next visible key. From the editor the focus stays in the editor. */
function moveSelection(step: number, fromEditor: boolean): void {
    if (!_visible.length) return;
    const at = _selectedKey ? _visible.indexOf(_selectedKey) : -1;
    const to = at < 0 ? 0 : Math.max(0, Math.min(_visible.length - 1, at + step));
    if (_visible[to] === _selectedKey) return;
    selectKey(_visible[to], { focusEditor: fromEditor });
}

// ── Detail / editor ───────────────────────────────────────────────────────────
/** The key's state as chips: missing / edited / same as source / translated, and JSON. */
function chipsFor(key: string): string {
    const chip = (cls: string, label: string) => `<span class="bms-chip ${cls}"><span class="bms-dot"></span>${escHtml(label)}</span>`;
    const missing = isMissingKey(key), edited = _sandbox[key] !== undefined, same = isSameKey(key);
    return [
        missing ? chip('bms-chip--danger', t('i18n.filterMissing')) : '',
        edited ? chip('bms-chip--warn', t('i18n.edited')) : '',
        same ? chip('', t('i18n.filterSame')) : '',
        !missing && !same ? chip('bms-chip--ok', t('i18n.translated')) : '',
        isObjKey(key) ? '<span class="bms-chip bms-chip--accent">JSON</span>' : '',
    ].join('');
}

const placeholders = (s: string) => new Set([...(s || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

async function renderDetail(key: string): Promise<void> {
    const detail = document.getElementById('i18n-detail');
    if (!detail) return;

    const langs = Object.keys(_allTrans).sort();
    const baseVal = valueFor(key, _baseLang);
    const sameLang = _refLang === _baseLang;
    const srcVal = sameLang ? originalDisplay(key) : valueFor(key, _refLang);
    const st = statusOf(key);
    const isObj = isObjKey(key);
    const at = _visible.indexOf(key);

    const others = langs.filter(l => l !== _baseLang && l !== _refLang);
    const refsHtml = others.map(l => {
        const v = valueFor(key, l);
        return `<div class="i18x-ref"><span class="i18x-langtag">${escHtml(l.toUpperCase())}</span>
            <span class="i18x-ref-v${v ? '' : ' is-missing'}">${v ? escHtml(v) : escHtml(t('i18n.missing'))}</span></div>`;
    }).join('');

    const chips = chipsFor(key);

    detail.innerHTML = `
        <div class="i18x-ed-head">
            <button type="button" class="i18x-keyname" id="i18n-copy-key" data-tooltip="${escAttr(t('i18n.copyKey'))}">
                <code>${escHtml(key)}</code>
                ${uiIcon('copy', 12)}
            </button>
            <div class="i18x-ed-nav">
                <span class="i18x-pos">${at >= 0 ? `${at + 1} / ${_visible.length}` : ''}</span>
                <button type="button" class="i18x-iconbtn" id="i18n-prev-key" data-tooltip="${escAttr(t('i18n.prevKey'))}"${at <= 0 ? ' disabled' : ''}>${uiIcon('chevron-up', 14)}</button>
                <button type="button" class="i18x-iconbtn" id="i18n-next-key" data-tooltip="${escAttr(t('i18n.nextKey'))}"${at < 0 || at >= _visible.length - 1 ? ' disabled' : ''}>${uiIcon('chevron-down', 14)}</button>
            </div>
        </div>
        <div class="i18x-chips" id="i18n-chips">${chips}</div>

        <div class="i18x-pair">
            <section class="i18x-side is-source">
                <header class="i18x-side-h">
                    <span class="i18x-langtag">${escHtml(_refLang.toUpperCase())}</span>
                    <span class="bms-label">${escHtml(sameLang ? t('i18n.original') : t('i18n.source'))}</span>
                    <button type="button" class="btn btn-ghost btn-xs" id="i18n-use-source"${srcVal ? '' : ' disabled'}>${escHtml(t('i18n.useSource'))}</button>
                </header>
                <div class="i18x-srctext${isObj ? ' is-mono' : ''}${srcVal ? '' : ' is-empty'}"${_refLang !== getLang() ? ` lang="${escAttr(_refLang)}"` : ''}>${srcVal ? escHtml(srcVal) : escHtml(t('i18n.missing'))}</div>
            </section>
            <section class="i18x-side is-target">
                <header class="i18x-side-h">
                    <span class="i18x-langtag is-target">${escHtml(_baseLang.toUpperCase())}</span>
                    <label class="bms-label" for="i18n-edit-value">${escHtml(t('i18n.target'))}</label>
                    <span class="i18x-autosave" id="i18n-autosave">${escHtml(t('i18n.autoSaved'))}</span>
                </header>
                <textarea id="i18n-edit-value" class="i18x-ta${isObj ? ' is-mono' : ''}" rows="${isObj ? 9 : 4}" spellcheck="true" lang="${escAttr(_baseLang)}" placeholder="${escAttr(t('i18n.emptyValue'))}">${escHtml(baseVal)}</textarea>
                <div class="i18x-ta-foot" id="i18n-ta-foot"></div>
            </section>
        </div>

        <div class="i18x-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="i18n-test-toast">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
                <span>${escHtml(t('i18n.testToast'))}</span>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="i18n-test-tip">
                ${uiIcon('message', 12)}
                <span>${escHtml(t('i18n.testTip'))}</span>
            </button>
            <button type="button" class="btn btn-ghost btn-sm" id="i18n-preview-live">${escHtml(t('i18n.previewLive'))}</button>
            <span class="bms-spacer"></span>
            ${st === 'edited' ? `<button type="button" class="btn btn-ghost btn-sm" id="i18n-revert-edit">${escHtml(t('i18n.revert'))}</button>` : ''}
        </div>

        ${others.length ? `<details class="i18x-sec" open>
            <summary><span class="bms-label">${escHtml(t('i18n.otherLangs'))}</span><span class="i18x-n">${others.length}</span></summary>
            <div class="i18x-refs">${refsHtml}</div>
        </details>` : ''}

        <details class="i18x-sec" open>
            <summary><span class="bms-label">${escHtml(t('i18n.usedIn'))}</span><span class="i18x-n" id="i18n-usage-count"></span></summary>
            <div id="i18n-usage-list" class="i18x-usage"><span class="i18x-muted">${escHtml(t('common.loading'))}</span></div>
        </details>`;

    const ta = document.getElementById('i18n-edit-value') as HTMLTextAreaElement;
    const foot = () => {
        const el = document.getElementById('i18n-ta-foot');
        if (!el || !ta) return;
        // The {placeholders} the source has and the target lost (or invented): the one mistake
        // that renders as a raw "{n}" in a toast.
        const ps = placeholders(srcVal), pt = placeholders(ta.value);
        const lost = [...ps].filter((p) => !pt.has(p));
        const extra = ta.value.trim() ? [...pt].filter((p) => !ps.has(p) && srcVal) : [];
        el.innerHTML = [
            ...lost.map((p) => `<span class="bms-chip bms-chip--danger">${escHtml(t('i18n.phMissing').replace('{name}', `{${p}}`))}</span>`),
            ...extra.map((p) => `<span class="bms-chip bms-chip--warn">${escHtml(t('i18n.phExtra').replace('{name}', `{${p}}`))}</span>`),
            `<span class="i18x-len">${escHtml(t('i18n.chars').replace('{n}', String(ta.value.length)).replace('{src}', String(srcVal.length)))}</span>`,
        ].join('');
    };
    foot();

    document.getElementById('i18n-copy-key')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(key);
        toast(t('i18n.keyCopied'), 'success', 1500);
    });
    document.getElementById('i18n-prev-key')?.addEventListener('click', () => moveSelection(-1, true));
    document.getElementById('i18n-next-key')?.addEventListener('click', () => moveSelection(1, true));
    document.getElementById('i18n-use-source')?.addEventListener('click', () => {
        if (!ta) return;
        ta.value = srcVal;
        ta.dispatchEvent(new Event('input'));
        focusEditor();
    });

    let deb: any;
    ta?.addEventListener('input', () => {
        const v = ta.value;
        if (v === originalDisplay(key)) delete _sandbox[key]; else _sandbox[key] = v;
        // Live test on → the app follows every keystroke's committed value.
        if ((document.getElementById('i18n-test-live') as HTMLInputElement | null)?.checked) {
            void import('../../core/i18n.js').then((m) => m.setSandboxOverlay({ ..._sandbox }));
        }
        const hint = document.getElementById('i18n-autosave');
        if (hint) { hint.classList.add('flash'); setTimeout(() => hint.classList.remove('flash'), 400); }
        foot();
        clearTimeout(deb);
        deb = setTimeout(() => {
            updateDirty();
            renderListPreviewOnly(key);
            const c = document.getElementById('i18n-chips');
            if (c) c.innerHTML = chipsFor(key);
            updateProgress(_allKeys.reduce((n, k) => n + (isMissingKey(k) ? 1 : 0), 0));
        }, 250);
    });
    ta?.addEventListener('keydown', (e: KeyboardEvent) => {
        // Alt+Up / Alt+Down: the previous / next key without leaving the field.
        if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            moveSelection(e.key === 'ArrowDown' ? 1 : -1, true);
            return;
        }
        // Escape leaves the field for the list; it does not close the whole sandbox.
        if (e.key === 'Escape') {
            e.preventDefault();
            document.getElementById('i18n-key-list')?.focus({ preventScroll: true });
        }
    });

    document.getElementById('i18n-revert-edit')?.addEventListener('click', () => {
        delete _sandbox[key]; updateDirty(); renderList(); markSelected(key); renderDetail(key);
    });
    document.getElementById('i18n-test-toast')?.addEventListener('click', () => testToastForKey(key));
    // Tooltip preview: shown ONLY while hovering the button, hidden the instant you leave it.
    const tipBtn = document.getElementById('i18n-test-tip');
    tipBtn?.addEventListener('mouseenter', () => showTooltipForKey(key));
    tipBtn?.addEventListener('mouseleave', () => (window as any).hideTaskyHelp?.());
    tipBtn?.addEventListener('click', (e) => { e.preventDefault(); showTooltipForKey(key); });
    document.getElementById('i18n-preview-live')?.addEventListener('click', () => {
        const v = (document.getElementById('i18n-edit-value') as HTMLTextAreaElement).value;
        document.querySelectorAll(`[data-i18n="${CSS.escape(key)}"]`).forEach(el => { (el as HTMLElement).textContent = v; });
        toast(t('i18n.previewApplied'), 'info', 2000);
    });

    // Usage
    const usageEl = document.getElementById('i18n-usage-list');
    const countEl = document.getElementById('i18n-usage-count');
    let usages = _usageCache[key];
    if (!usages) {
        try { usages = await invoke('find_i18n_usages', { key }); _usageCache[key] = usages; }
        catch { usages = []; }
    }
    if (!usageEl || _selectedKey !== key) return;
    if (!usages.length) {
        usageEl.innerHTML = `<span class="i18x-muted">${escHtml(t('i18n.noUsage'))}</span>`;
        if (countEl) countEl.textContent = '0';
        return;
    }
    const byFile: Record<string, any[]> = {};
    usages.forEach((u: any) => { (byFile[u.file] ||= []).push(u); });
    if (countEl) countEl.textContent = String(usages.length);
    usageEl.innerHTML = Object.entries(byFile).map(([file, list]) => `
        <div class="i18x-ufile">
            <div class="i18x-ufile-name" title="${escAttr(file)}">${escHtml(file)} <span class="i18x-n">${list.length}</span></div>
            ${list.slice(0, 8).map(u => `
                <button type="button" class="i18x-uline" data-loc="${escAttr(file + ':' + u.line)}" data-tooltip="${escAttr(t('i18n.copyLoc'))}">
                    <span class="i18x-uln">L${u.line}</span>
                    ${/toast\s*\(/.test(u.snippet || '') ? `<span class="i18x-utag">toast</span>` : ''}
                    ${/showTaskyHelp\s*\(/.test(u.snippet || '') ? `<span class="i18x-utag is-tip">tooltip</span>` : ''}
                    <span class="i18x-usnip">${escHtml(u.snippet)}</span>
                </button>`).join('')}
            ${list.length > 8 ? `<div class="i18x-muted">+${list.length - 8} ${escHtml(t('i18n.more'))}</div>` : ''}
        </div>`).join('');
    usageEl.querySelectorAll<HTMLElement>('.i18x-uline').forEach(el => {
        el.addEventListener('click', () => {
            navigator.clipboard?.writeText(el.dataset.loc || '');
            toast(`${t('i18n.locCopied')}: ${el.dataset.loc}`, 'success', 1800);
        });
    });
}

function renderListPreviewOnly(key: string): void {
    const row = document.querySelector(`.i18x-krow[data-key="${CSS.escape(key)}"]`) as HTMLElement;
    if (!row) { renderList(); markSelected(key, false); return; }
    const val = valueFor(key, _baseLang);
    const valEl = row.querySelector('.i18x-v');
    if (valEl) { valEl.textContent = val.replace(/\s+/g, ' ').trim() || valueFor(key, _refLang); valEl.classList.toggle('is-src', !val.trim()); }
    const st = statusOf(key);
    row.className = `i18x-krow is-${st}`;
    row.querySelector('.i18x-dot')?.setAttribute('title', t(STATUS_LABEL[st]));
}

function updateDirty(): void {
    const el = document.getElementById('i18n-dirty-count');
    const n = Object.keys(_sandbox).length;
    if (!el) return;
    el.hidden = !n;
    el.innerHTML = n ? `<span class="bms-dot"></span>${escHtml(`${n} ${t('i18n.unsavedEdits')}`)}` : '';
}

// ── Hardcoded scanner tab ───────────────────────────────────────────────────────
async function loadHardcoded(force: boolean, quiet = false): Promise<void> {
    if (_hcLoaded && !force) return;
    const listEl = document.getElementById('i18n-hc-list');
    if (listEl && !quiet) listEl.innerHTML = `<div class="bms-empty"><div class="bms-empty-t">${escHtml(t('i18n.hcScanning'))}</div></div>`;
    try { _hcData = await invoke('find_hardcoded_strings', { filter: '' }) || []; }
    catch { _hcData = []; }
    _hcLoaded = true;
    _hcSel = -1;
    const c = document.getElementById('i18n-tabcount-hc');
    if (c) c.textContent = String(_hcData.length);
    if (!quiet) { renderHardcoded(); renderHcDetail(null); }
}

const kindOf = (h: any) => (h.kind === 'js' ? 'ts' : h.kind);

function renderHardcoded(): void {
    const listEl = document.getElementById('i18n-hc-list');
    if (!listEl) return;
    const q = ((document.getElementById('i18n-hc-search') as HTMLInputElement)?.value || '').toLowerCase().trim();
    const kc: Record<string, number> = { all: 0, html: 0, ts: 0, toast: 0 };
    const byFile = new Map<string, number[]>();
    _hcData.forEach((h, i) => {
        if (q && !(h.text || '').toLowerCase().includes(q) && !(h.file || '').toLowerCase().includes(q)) return;
        const k = kindOf(h);
        kc.all++; kc[k] = (kc[k] || 0) + 1;
        if (_hcKind !== 'all' && k !== _hcKind) return;
        if (!byFile.has(h.file)) byFile.set(h.file, []);
        byFile.get(h.file)!.push(i);
    });
    _modal?.querySelectorAll<HTMLElement>('#i18n-hc-kind [data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === _hcKind)));
    _modal?.querySelectorAll<HTMLElement>('#i18n-hc-kind [data-kn]').forEach((n) => { n.textContent = String(kc[n.dataset.kn || ''] || 0); });

    _hcVisible = [];
    const stats = document.getElementById('i18n-hc-stats');
    if (!byFile.size) {
        listEl.innerHTML = `<div class="bms-empty">
            <div class="bms-empty-t">${escHtml(_hcData.length ? t('i18n.noResults') : t('i18n.hcNone'))}</div>
            ${_hcData.length ? '' : `<div>${escHtml(t('i18n.hcHint'))}</div>`}
        </div>`;
        if (stats) stats.textContent = '';
        return;
    }
    const files = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    let shown = 0;
    listEl.innerHTML = files.map(([file, idx]) => {
        const folded = _hcFolded.has(file);
        const base = file.replace(/^.*[/\\]/, '');
        const dir = file.slice(0, file.length - base.length);
        const rows = folded ? '' : idx.slice(0, 200).map((i) => {
            _hcVisible.push(i);
            shown++;
            const h = _hcData[i];
            return `<div class="i18x-hcrow" role="option" data-i="${i}" aria-selected="${i === _hcSel}">
                <span class="i18x-kind is-${escAttr(kindOf(h))}">${escHtml(kindOf(h))}</span>
                <span class="i18x-hctext">${escHtml(h.text)}</span>
                <span class="i18x-uln">L${h.line}</span>
            </div>`;
        }).join('');
        return `<div class="i18x-hcfile">
            <button type="button" class="i18x-hcfile-head" data-file="${escAttr(file)}" aria-expanded="${!folded}" title="${escAttr(file)}">
                <svg class="i18x-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
                <span class="i18x-hcfile-name"><span class="i18x-hcfile-dir">${escHtml(dir)}</span>${escHtml(base)}</span>
                <span class="i18x-n">${idx.length}</span>
            </button>
            ${rows}
        </div>`;
    }).join('');
    const total = files.reduce((n, [, idx]) => n + idx.length, 0);
    if (stats) stats.innerHTML = `<span><b>${total}</b> ${escHtml(t('i18n.hcFindings'))} · ${escHtml(t('i18n.hcFiles').replace('{n}', String(files.length)))}</span>`;
    if (shown && _hcSel >= 0 && !_hcVisible.includes(_hcSel)) renderHcDetail(null);
}

function toggleFold(file: string): void {
    if (_hcFolded.has(file)) _hcFolded.delete(file); else _hcFolded.add(file);
    renderHardcoded();
    document.querySelector<HTMLElement>(`.i18x-hcfile-head[data-file="${CSS.escape(file)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function selectHc(i: number): void {
    _hcSel = i;
    const listEl = document.getElementById('i18n-hc-list');
    listEl?.querySelector('.i18x-hcrow[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    const row = listEl?.querySelector<HTMLElement>(`.i18x-hcrow[data-i="${i}"]`);
    row?.setAttribute('aria-selected', 'true');
    row?.scrollIntoView({ block: 'nearest' });
    const h = _hcData[i];
    renderHcDetail(h ? { text: h.text, hits: [h], kind: kindOf(h) } : null);
}

function copyLoc(h: any): void {
    if (!h) return;
    const loc = `${h.file}:${h.line}`;
    navigator.clipboard?.writeText(loc);
    toast(`${t('i18n.locCopied')}: ${loc}`, 'success', 1800);
}

/** A key for a string that has none: an existing key with the very same text first (the
 *  string is already translated somewhere), else `<area>.<firstWords>`. */
function suggestKey(text: string, file: string): { key: string; existing: boolean } {
    const norm = text.trim().toLowerCase();
    const en = { ...(_diskParsed.en || {}), ...(_allTrans.en || {}) };
    for (const [k, v] of Object.entries(en)) {
        if (typeof v === 'string' && !k.startsWith('_') && v.trim().toLowerCase() === norm) return { key: k, existing: true };
    }
    const base = (file || '').replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '').replace(/[-_.](\w)/g, (_m, c) => c.toUpperCase());
    const area = !base || base === 'index' ? 'ui' : base.charAt(0).toLowerCase() + base.slice(1);
    const words = text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 4);
    const slug = words.map((w, i) => (i ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'text';
    return { key: `${area}.${slug.slice(0, 32)}`, existing: false };
}

/** Put a found string on screen: the first element outside the sandbox whose own text
 *  matches, scrolled into view and outlined for a moment. */
function findOnScreen(text: string): boolean {
    const norm = text.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!norm) return false;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walk.nextNode())) {
        const p = n.parentElement;
        if (!p || _modal?.contains(p) || p.closest('script,style,template')) continue;
        if (!(n.textContent || '').replace(/\s+/g, ' ').toLowerCase().includes(norm)) continue;
        if (!p.getClientRects().length) continue;
        p.scrollIntoView({ block: 'center', behavior: 'smooth' });
        p.classList.add('i18x-flash');
        setTimeout(() => p.classList.remove('i18x-flash'), 2600);
        return true;
    }
    return false;
}

function renderHcDetail(f: { text: string; hits: any[]; kind?: string; picked?: boolean } | null): void {
    const el = document.getElementById('i18n-hc-detail');
    if (!el) return;
    if (!f) {
        el.innerHTML = `<div class="i18x-start">
            <div class="bms-label">${escHtml(t('i18n.tabHardcoded'))}</div>
            <p class="i18x-muted">${escHtml(t('i18n.hcHint'))}</p>
            <p class="i18x-muted">${escHtml(t('i18n.hcPick'))}</p>
        </div>`;
        return;
    }
    const first = f.hits[0];
    const sug = suggestKey(f.text, first?.file || '');
    const isHtml = (first?.kind || f.kind) === 'html' || /\.html?$/i.test(first?.file || '');
    const call = isHtml ? `data-i18n="${sug.key}"` : `t('${sug.key}')`;
    el.innerHTML = `
        <div class="i18x-chips">
            <span class="bms-chip bms-chip--warn"><span class="bms-dot"></span>${escHtml(t('i18n.hardcoded'))}</span>
            ${f.kind ? `<span class="i18x-kind is-${escAttr(f.kind)}">${escHtml(f.kind)}</span>` : ''}
            ${f.picked ? `<span class="bms-chip">${escHtml(t('i18n.pickedHc'))}</span>` : ''}
        </div>
        <blockquote class="i18x-quote">${escHtml(f.text)}</blockquote>

        <div class="i18x-block">
            <div class="bms-label">${escHtml(sug.existing ? t('i18n.hcReuse') : t('i18n.hcSuggested'))}</div>
            <div class="i18x-sugg">
                <code class="i18x-sugg-key">${escHtml(sug.key)}</code>
                <button type="button" class="btn btn-secondary btn-xs" data-copy="${escAttr(sug.key)}">${escHtml(t('i18n.copyKey'))}</button>
                <button type="button" class="btn btn-ghost btn-xs" data-copy="${escAttr(call)}">${escHtml(isHtml ? t('i18n.copyAttr') : t('i18n.copyCall'))}</button>
            </div>
        </div>

        <div class="i18x-block">
            <div class="bms-label">${escHtml(t('i18n.hcLocated'))}</div>
            ${f.hits.length ? f.hits.map((h) => `
                <button type="button" class="i18x-loc" data-loc="${escAttr(h.file + ':' + h.line)}" data-tooltip="${escAttr(t('i18n.copyLoc'))}">
                    <span class="i18x-loc-file">${escHtml(h.file)}<span class="i18x-uln">:${h.line}</span></span>
                    ${h.snippet ? `<code class="i18x-loc-snip">${escHtml(h.snippet)}</code>` : ''}
                </button>`).join('') : `<p class="i18x-muted">${escHtml(t('i18n.hcNotLocated'))}</p>`}
        </div>

        <div class="i18x-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="i18n-hc-find">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M3 12h3M18 12h3M12 3v3M12 18v3"/></svg>
                <span>${escHtml(t('i18n.hcFind'))}</span>
            </button>
            <button type="button" class="btn btn-ghost btn-sm" data-copy="${escAttr(f.text)}">${escHtml(t('i18n.copyText'))}</button>
        </div>`;
    el.querySelectorAll<HTMLElement>('[data-copy]').forEach((b) => b.addEventListener('click', () => {
        navigator.clipboard?.writeText(b.dataset.copy || '');
        toast(t('i18n.copied'), 'success', 1400);
    }));
    el.querySelectorAll<HTMLElement>('.i18x-loc').forEach((b) => b.addEventListener('click', () => {
        navigator.clipboard?.writeText(b.dataset.loc || '');
        toast(`${t('i18n.locCopied')}: ${b.dataset.loc}`, 'success', 1800);
    }));
    document.getElementById('i18n-hc-find')?.addEventListener('click', () => {
        if (findOnScreen(f.text)) {
            // Floating, so the app underneath can be seen; the outline fades on its own.
            if (_modal && !_overlayMode && !_dockMode) toggleOverlayMode(_modal, true);
            toast(t('i18n.hcFound'), 'success', 1600);
        } else toast(t('i18n.hcNotOnScreen'), 'info', 2600);
    });
}

/** A hardcoded string picked from the app: the hardcoded tab, with where the scan found it. */
async function showHardcodedDetail(text: string): Promise<void> {
    switchTab('hardcoded');
    if (!_hcLoaded) await loadHardcoded(false, true);
    renderHardcoded();
    const norm = text.trim().toLowerCase();
    const hits = _hcData.filter(h => (h.text || '').trim().toLowerCase() === norm)
        .concat(_hcData.filter(h => (h.text || '').trim().toLowerCase().includes(norm) && (h.text || '').trim().toLowerCase() !== norm)).slice(0, 12);
    _hcSel = hits.length ? _hcData.indexOf(hits[0]) : -1;
    if (_hcSel >= 0) {
        const row = document.querySelector<HTMLElement>(`.i18x-hcrow[data-i="${_hcSel}"]`);
        row?.setAttribute('aria-selected', 'true');
        row?.scrollIntoView({ block: 'nearest' });
    }
    renderHcDetail({ text, hits, kind: hits[0] ? kindOf(hits[0]) : undefined, picked: true });
}

// ── Pick text from the running app (any text, i18n or hardcoded) ─────────────────
let _pickMode = false;
/** The element currently outlined by pick mode. Kept so the class can be removed from ONE
 *  node instead of asking the document who has it. */
let _hoverEl: HTMLElement | null = null;

function setHover(el: HTMLElement | null) {
    // This runs on every mouseover while pick or highlight mode is on — continuously, as the
    // pointer crosses each element under it. It used to open with
    // `document.querySelectorAll('.i18n-pick-hover')`, a full-document query over ~3900
    // elements per pointer move, which is what made the sandbox feel heavy the whole time it
    // was open. One reference and an early return do the same work in constant time.
    if (el === _hoverEl) return;
    _hoverEl?.classList.remove('i18n-pick-hover');
    _hoverEl = el;
    if (el) el.classList.add('i18n-pick-hover');
}
function nearestTextEl(target: HTMLElement): HTMLElement | null {
    // Prefer an i18n element; otherwise the closest element that directly holds text.
    const i18nEl = target.closest('[data-i18n],[data-i18n-placeholder],[data-i18n-title],[data-i18n-tooltip]') as HTMLElement | null;
    if (i18nEl) return i18nEl;
    let el: HTMLElement | null = target;
    while (el && !_modal?.contains(el)) {
        if (Array.from(el.childNodes).some(n => n.nodeType === 3 && (n.textContent || '').trim().length > 1)) return el;
        el = el.parentElement;
    }
    return target;
}
function onPickHover(e: MouseEvent) {
    if (_modal?.contains(e.target as Node)) { setHover(null); return; }
    setHover(nearestTextEl(e.target as HTMLElement));
}
function onPickClick(e: MouseEvent) {
    if (_modal?.contains(e.target as Node)) return;
    const el = nearestTextEl(e.target as HTMLElement);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    const key = el.getAttribute('data-i18n') || el.getAttribute('data-i18n-placeholder') || el.getAttribute('data-i18n-title') || el.getAttribute('data-i18n-tooltip');
    if (key) { selectKey(key); toast(`${t('i18n.picked') || 'Picked'}: ${key}`, 'success', 1500); }
    else {
        const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
        if (txt) { showHardcodedDetail(txt); toast(t('i18n.pickedHc') || 'Hardcoded text picked', 'warning', 1800); }
    }
}
function togglePickMode(force?: boolean): void {
    _pickMode = force !== undefined ? force : !_pickMode;
    document.getElementById('i18n-pick-screen')?.classList.toggle('active', _pickMode);
    if (_pickMode) {
        if (_hlMode) toggleHighlight(false);
        // Only float it if it is neither floating NOR docked. Both presentations already
        // leave the app clickable underneath (dock mode sets pointer-events:none on the
        // backdrop too), and toggleOverlayMode CANCELS dock mode — so this used to rip a
        // docked sandbox out of its dock every time pick mode started.
        if (!_overlayMode && !_dockMode && _modal) toggleOverlayMode(_modal, true);
        document.body.classList.add('i18n-picking');
        document.addEventListener('mouseover', onPickHover, true);
        document.addEventListener('click', onPickClick, true);
        toast(t('i18n.pickOn') || 'Pick mode — click any text in BMM to edit its key', 'info', 3500);
    } else {
        if (!_hlMode) {
            document.body.classList.remove('i18n-picking');
            document.removeEventListener('mouseover', onPickHover, true);
            document.removeEventListener('click', onPickClick, true);
        }
        setHover(null);
    }
}

// ── Highlight hardcoded text on screen (devtools-style) ──────────────────────────
let _hlMode = false;
function auditHardcodedScreen(): void {
    document.querySelectorAll('.i18n-hc-mark').forEach(e => e.classList.remove('i18n-hc-mark'));
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node: any) => {
            const p = node.parentElement;
            if (!p) return NodeFilter.FILTER_REJECT;
            if (_modal?.contains(p)) return NodeFilter.FILTER_REJECT;          // skip the tool itself
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'path'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
            const txt = (node.textContent || '').trim();
            if (txt.length < 2 || !/[A-Za-zÀ-ÿ]{2,}/.test(txt)) return NodeFilter.FILTER_REJECT;
            if (p.closest('[data-i18n],[data-i18n-placeholder],[data-i18n-title],[data-i18n-tooltip]')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    } as any);
    let n: any, count = 0;
    while ((n = walk.nextNode())) {
        const p = n.parentElement;
        if (p && !p.classList.contains('i18n-hc-mark')) { p.classList.add('i18n-hc-mark'); count++; }
    }
    return count;
}
function toggleHighlight(force?: boolean): void {
    _hlMode = force !== undefined ? force : !_hlMode;
    document.getElementById('i18n-highlight-hc')?.classList.toggle('active', _hlMode);
    if (_hlMode) {
        if (_pickMode) togglePickMode(false);
        if (!_overlayMode && !_dockMode && _modal) toggleOverlayMode(_modal, true);   // same as pick mode
        const count = auditHardcodedScreen();
        document.body.classList.add('i18n-picking');                 // also enable click-to-open
        document.addEventListener('mouseover', onPickHover, true);
        document.addEventListener('click', onPickClick, true);
        toast(`${t('i18n.hlOn') || 'Highlighting hardcoded text'} (${count}) — ${t('i18n.hlClickHint') || 'click one to open it'}`, 'info', 3500);
    } else {
        document.querySelectorAll('.i18n-hc-mark').forEach(e => e.classList.remove('i18n-hc-mark'));
        if (!_pickMode) {
            document.body.classList.remove('i18n-picking');
            document.removeEventListener('mouseover', onPickHover, true);
            document.removeEventListener('click', onPickClick, true);
        }
        setHover(null);
    }
}

// ── Overlay / floating, draggable & resizable across all of BMM ─────────────────
let _overlayMode = false;
let _savedPanelStyle = '';   // the panel's original inline style, restored on overlay exit
const OVL_KEY = 'bmm_i18n_overlay_geom';
// ── Dock mode: the sandbox as a side panel ───────────────────────────────────
// Same shape as the theme editor's dock: body class + app shell padded aside +
// draggable, persisted width. The backdrop goes click-through so the app stays
// usable while translating against it — that is the point of docking it.
let _dockMode = false;
let _savedDockStyle: string | null = null;
const I18N_DOCK_KEY = 'bmm.i18nsb.dock';
const I18N_DOCKW_KEY = 'bmm.i18nsb.dockW';

const _i18nDock = makeDock({
    id: 'i18n-sandbox', storageKey: I18N_DOCKW_KEY, cssVar: '--i18nsb-w', min: 380, def: 460,
});

function _i18nShellPad(w: number | null): void {
    // Shared owner — see ui/dock-space.ts (docking the theme editor AND the
    // sandbox used to leave one of them covering the app).
    if (w) claimDockSpace('i18n-sandbox', w); else releaseDockSpace('i18n-sandbox');
}

function toggleDockMode(modal: HTMLElement, force?: boolean, remember = true): void {
    const next = force !== undefined ? force : !_dockMode;
    if (next === _dockMode) return;
    const panel = modal.querySelector('.modal') as HTMLElement;
    if (!panel) return;
    if (next && _overlayMode) toggleOverlayMode(modal, false);   // one float mode at a time
    _dockMode = next;
    document.getElementById('i18n-dock-toggle')?.classList.toggle('active', next);
    document.body.classList.toggle('i18nsb-docked', next);
    // `remember` is false when closeModal is unwinding the styles: closing while
    // docked used to WRITE 'off', so the preference the open handler restores was
    // destroyed by the very act of closing and dock mode never actually persisted.
    if (remember) localStorage.setItem(I18N_DOCK_KEY, next ? 'right' : 'off');
    if (next) {
        _savedDockStyle = panel.getAttribute('style') || '';
        panel.setAttribute('style', '');                          // CSS owns the dock
        modal.style.background = 'transparent';
        modal.style.pointerEvents = 'none';
        modal.style.backdropFilter = 'none';
        document.body.style.overflow = '';
        const w = claimDockSpace('i18n-sandbox', _i18nDock.width());
        if (!w) {
            // No room: undo what we just set and stay a modal rather than cover the app.
            _dockMode = false;
            document.body.classList.remove('i18nsb-docked');
            if (_savedDockStyle !== null) { panel.setAttribute('style', _savedDockStyle); _savedDockStyle = null; }
            modal.style.background = ''; modal.style.pointerEvents = ''; modal.style.backdropFilter = '';
            document.body.style.overflow = 'hidden';
            document.getElementById('i18n-dock-toggle')?.classList.remove('active');
            toast(t('i18n.dockNoRoom') || 'Window too narrow to dock — staying a window', 'info', 2600);
            return;
        }
        document.body.style.setProperty('--i18nsb-w', `${w}px`);
        _i18nPlantDockResize(panel);
    } else {
        if (_savedDockStyle !== null) { panel.setAttribute('style', _savedDockStyle); _savedDockStyle = null; }
        modal.style.background = '';
        modal.style.pointerEvents = '';
        modal.style.backdropFilter = '';
        // Docking cleared the modal's scroll lock on purpose (the app must stay
        // usable); coming back to the full-screen modal has to take it again, or
        // the page scrolls behind the backdrop.
        if (modal.classList.contains('open')) document.body.style.overflow = 'hidden';
        document.body.style.removeProperty('--i18nsb-w');
        _i18nShellPad(null);
    }
}

document.addEventListener('bmm:dock:no-room', (e) => {
    const ids = (e as CustomEvent).detail?.ids as string[] | undefined;
    if (ids && !ids.includes('i18n-sandbox')) return;    // someone else's loss
    if (_dockMode && _modal) toggleDockMode(_modal, false, false);
});

function _i18nPlantDockResize(panel: HTMLElement): void {
    _i18nDock.plantGrip(panel, () => _dockMode);
}

function toggleOverlayMode(modal: HTMLElement, force?: boolean): void {
    if ((force === undefined || force) && _dockMode) toggleDockMode(modal, false);
    _overlayMode = force !== undefined ? force : !_overlayMode;
    const panel = modal.querySelector('.modal') as HTMLElement;
    document.getElementById('i18n-overlay-toggle')?.classList.toggle('active', _overlayMode);
    if (!panel) return;

    const MIN_W = 420, MIN_H = 320;
    if (_overlayMode) {
        // Snapshot the panel's ORIGINAL inline style (width:96%; max-width:1080px;
        // height:88vh; …). Overlay mode overwrites those with fixed px sizes; on exit
        // we must put the originals back, otherwise clearing to '' collapses the
        // panel to content size and it stays small. (Was the resize bug.)
        _savedPanelStyle = panel.getAttribute('style') || '';
        modal.classList.add('i18n-overlay-active');
        modal.style.background = 'transparent';
        modal.style.pointerEvents = 'none';
        modal.style.backdropFilter = 'none';
        document.body.style.overflow = '';
        panel.style.pointerEvents = 'auto';
        panel.style.position = 'fixed';
        // Kill the .glass backdrop-blur while floating — re-blurring the whole app
        // behind the panel on every drag frame is the main source of drag lag.
        panel.style.backdropFilter = 'none';
        (panel.style as any).webkitBackdropFilter = 'none';
        panel.style.willChange = 'left, top';
        // The modal is normally centered via transform/margin/animation — neutralise
        // those so fixed left/top place it exactly (otherwise it jumps/clips on 1st open).
        panel.style.transform = 'none';
        panel.style.transition = 'none';
        panel.style.animation = 'none';
        panel.style.margin = '0';
        panel.style.maxWidth = 'none';
        panel.style.maxHeight = 'none';
        panel.style.resize = 'none';   // use our custom 8-direction handles instead
        panel.style.overflow = 'hidden';
        panel.style.minWidth = MIN_W + 'px';
        panel.style.minHeight = MIN_H + 'px';
        panel.style.boxShadow = '0 24px 70px -10px rgba(0,0,0,.7), 0 8px 24px rgba(0,0,0,.4)';
        addResizeHandles(panel, MIN_W, MIN_H);
        // restore saved geometry, clamped to min sizes and inside the containing block
        // (not innerWidth/innerHeight — the panel's offsetParent may carry a transform).
        let geom: any = {};
        try { geom = JSON.parse(localStorage.getItem(OVL_KEY) || '{}'); } catch {}
        const cbRect = ((panel.offsetParent as HTMLElement) || document.documentElement).getBoundingClientRect();
        const cbW = cbRect.width || innerWidth, cbH = cbRect.height || innerHeight;
        const w = Math.max(MIN_W, Math.min(Number(geom.width) || Math.min(680, cbW * 0.8), cbW - 20));
        const h = Math.max(MIN_H, Math.min(Number(geom.height) || Math.min(660, cbH * 0.78), cbH - 20));
        const left = Math.max(0, Math.min(Number.isFinite(geom.left) ? geom.left : 60, cbW - w));
        const top  = Math.max(0, Math.min(Number.isFinite(geom.top) ? geom.top : 60, cbH - 60));
        panel.style.width = w + 'px';
        panel.style.height = h + 'px';
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        // Saved floating opacity (the slider in the header controls it live).
        const savedOp = Number(localStorage.getItem('bmm_i18n_overlay_opacity') || '100');
        panel.style.opacity = String(Math.min(100, Math.max(35, savedOp)) / 100);
        makeDraggable(panel, modal.querySelector('.modal-header') as HTMLElement);
        observeResize(panel);
    } else {
        if (_ro) { _ro.disconnect(); _ro = null; }   // stop before clearing styles (avoid saving reset size)
        cancelGeomSave();                           // and drop any write still waiting to fire
        removeResizeHandles(panel);
        modal.classList.remove('i18n-overlay-active');
        modal.style.background = '';
        modal.style.pointerEvents = '';
        modal.style.backdropFilter = '';
        if (modal.classList.contains('open')) document.body.style.overflow = 'hidden';
        // Restore the panel's original inline style verbatim — this brings back the
        // full-size width/height/max-width and removes every overlay override at once.
        panel.setAttribute('style', _savedPanelStyle);
        if (_pickMode) togglePickMode(false);
        if (_hlMode) toggleHighlight(false);
    }
}
let _ro: ResizeObserver | null = null;
function observeResize(panel: HTMLElement): void {
    if (_ro) return;
    _ro = new ResizeObserver(() => saveGeom(panel));
    _ro.observe(panel);
}

/** Custom 8-direction resize handles (CSS `resize:both` only gives the SE corner).
 *  Each handle drags one or two edges; the panel stays clamped to the viewport. */
function addResizeHandles(panel: HTMLElement, minW: number, minH: number): void {
    removeResizeHandles(panel);
    const dirs = ['n','s','e','w','ne','nw','se','sw'];
    for (const dir of dirs) {
        const h = document.createElement('div');
        h.className = 'i18n-rsz i18n-rsz-' + dir;
        h.dataset.dir = dir;
        h.addEventListener('mousedown', (md: MouseEvent) => {
            md.preventDefault(); md.stopPropagation();
            const r = panel.getBoundingClientRect();
            const startX = md.clientX, startY = md.clientY;
            const x0 = r.left, y0 = r.top, w0 = r.width, h0 = r.height;
            const move = (mm: MouseEvent) => {
                const dx = mm.clientX - startX, dy = mm.clientY - startY;
                let nx = x0, ny = y0, nw = w0, nh = h0;
                if (dir.includes('e')) nw = Math.max(minW, w0 + dx);
                if (dir.includes('s')) nh = Math.max(minH, h0 + dy);
                if (dir.includes('w')) { nw = Math.max(minW, w0 - dx); nx = x0 + (w0 - nw); }
                if (dir.includes('n')) { nh = Math.max(minH, h0 - dy); ny = y0 + (h0 - nh); }
                // clamp against the containing block (not innerWidth/innerHeight —
                // the panel's offsetParent may carry a transform, like the theme editor).
                const cb = (panel.offsetParent as HTMLElement) || document.documentElement;
                const cbRect = cb.getBoundingClientRect();
                nx = Math.max(0, Math.min(nx, cbRect.width - 80));
                ny = Math.max(0, Math.min(ny, cbRect.height - 40));
                nw = Math.min(nw, cbRect.width - nx);
                nh = Math.min(nh, cbRect.height - ny);
                panel.style.left = nx + 'px'; panel.style.top = ny + 'px';
                panel.style.width = nw + 'px'; panel.style.height = nh + 'px';
            };
            const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveGeom(panel); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
        panel.appendChild(h);
    }
}
function removeResizeHandles(panel: HTMLElement): void {
    panel.querySelectorAll('.i18n-rsz').forEach(h => h.remove());
}
/** Remember the panel's geometry — debounced.
 *
 *  Called from a ResizeObserver, so it fired once per frame for the whole of a drag-resize.
 *  MEASURED before claiming a win: a localStorage write here costs 0.018 ms, so the old
 *  per-frame version was NOT the lag anyone felt — that was setHover's full-document query.
 *  The debounce stays because writing once at the end is simply the right shape, and it
 *  brings the two guards below with it; it is not a performance fix and should not be
 *  remembered as one.
 */
let _geomTimer: number | null = null;
function saveGeom(panel: HTMLElement): void {
    if (_geomTimer !== null) clearTimeout(_geomTimer);
    _geomTimer = window.setTimeout(() => {
        _geomTimer = null;
        // Re-read at flush time rather than closing over a stale rect: what matters is where
        // the panel ENDED, not where it was when the last frame fired.
        const r = panel.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;   // detached or mid-teardown: not a real size
        try {
            localStorage.setItem(OVL_KEY, JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height }));
        } catch { /* storage full or unavailable: a forgotten window position is not worth an error */ }
    }, 250);
}

/** Cancel a pending geometry write. Called when the observer is disconnected, so a flush
 *  cannot land after the styles have been reset and save the collapsed size. */
function cancelGeomSave(): void {
    if (_geomTimer !== null) { clearTimeout(_geomTimer); _geomTimer = null; }
}
function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
    if (!handle || (handle as any)._i18nDrag) return;
    (handle as any)._i18nDrag = true;
    handle.classList.add('i18n-drag-handle');
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        // Anything interactive in the header must keep working while floating. The guard
        // used to cover buttons only, so mousedown on the opacity slider (an <input
        // type="range"> living in this same header) was swallowed by preventDefault() and
        // dragged the whole window instead of moving the thumb — the control was simply
        // unusable in overlay mode. `label` matters too: the slider is wrapped in one.
        if ((e.target as HTMLElement).closest('button, input, select, textarea, label, a, [contenteditable]')) return;
        if (e.button !== 0) return;   // left-drag only; right/middle keep their own meaning
        if (!_overlayMode) return;
        e.preventDefault();
        const rect = panel.getBoundingClientRect();
        const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
        // Clamp against the containing block (like the theme editor) so the panel
        // can never be dragged fully off-screen, even inside a transformed ancestor.
        const cb = (panel.offsetParent as HTMLElement) || document.documentElement;
        const move = (ev: MouseEvent) => {
            const cbRect = cb.getBoundingClientRect();
            panel.style.left = `${Math.max(0, Math.min(cbRect.width - 80, ev.clientX - offX - cbRect.left))}px`;
            panel.style.top  = `${Math.max(0, Math.min(cbRect.height - 40, ev.clientY - offY - cbRect.top))}px`;
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveGeom(panel); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
}

// ── New language ─────────────────────────────────────────────────────────────────
function promptNewLanguage(): void {
    if (!_modal) return;
    if (_modal.querySelector('.i18n-newlang-pop')) return;
    const pop = document.createElement('div');
    pop.className = 'i18n-newlang-pop';
    pop.innerHTML = `
        <div class="i18n-newlang-card">
            <div class="i18n-newlang-title">${t('i18n.newLangTitle') || 'Create a new language'}</div>
            <label class="i18n-newlang-lbl">${t('i18n.newLangCode') || 'Language code (e.g. de, es, pt-br)'}</label>
            <input id="i18n-nl-code" class="i18n-edit-area" style="height:auto;" placeholder="de" autocomplete="off">
            <label class="i18n-newlang-check"><input type="checkbox" id="i18n-nl-copy" checked> ${t('i18n.newLangCopy') || 'Seed from'} <b>${_baseLang.toUpperCase()}</b></label>
            <div class="i18n-newlang-actions">
                <button class="btn btn-ghost btn-sm" id="i18n-nl-cancel">${t('common.cancel') || 'Cancel'}</button>
                <button class="btn btn-secondary btn-sm" id="i18n-nl-create">${t('i18n.create') || 'Create'}</button>
            </div>
        </div>`;
    _modal.querySelector('.modal')?.appendChild(pop);
    const close = () => pop.remove();
    pop.addEventListener('click', (e) => { if (e.target === pop) close(); });
    document.getElementById('i18n-nl-cancel')?.addEventListener('click', close);
    const codeInput = document.getElementById('i18n-nl-code') as HTMLInputElement;
    codeInput?.focus();
    document.getElementById('i18n-nl-create')?.addEventListener('click', async () => {
        const code = (codeInput.value || '').trim().toLowerCase();
        if (!code) { toast(t('i18n.newLangNeedCode') || 'Enter a language code', 'warning'); return; }
        if (_allTrans[code]) { toast(t('i18n.newLangExists') || 'That language already exists', 'error'); return; }
        const copy = (document.getElementById('i18n-nl-copy') as HTMLInputElement)?.checked;
        try {
            const json: string = await invoke('create_language_file', { code, copyFrom: copy ? _baseLang : null });
            _allTrans[code] = JSON.parse(json || '{}');
            _baseLang = code;
            refreshLangSelect();
            renderList();
            close();
            toast(`${t('i18n.newLangCreated') || 'Created language'} ${code.toUpperCase()}`, 'success');
        } catch (err) {
            toast(String(err), 'error');
        }
    });
}

// ── Previews ─────────────────────────────────────────────────────────────────────
function currentEditValue(key: string): string {
    let val = (document.getElementById('i18n-edit-value') as HTMLTextAreaElement)?.value;
    if (val === undefined || val === '') val = valueFor(key, _baseLang);
    return val;
}
function testToastForKey(key: string): void {
    let val = currentEditValue(key);
    if (!val) { toast(t('i18n.noValueToTest') || 'No value to test for this key', 'warning'); return; }
    val = val.replace(/\{(\w+)\}/g, (_m, p) => `[${p}]`);
    const kind = /error|fail|danger|invalid/i.test(key) ? 'error'
        : /warn|caution/i.test(key) ? 'warning'
        : /success|done|saved|complete/i.test(key) ? 'success' : 'info';
    toast(val, kind, 4000);
}
function showTooltipForKey(key: string): void {
    let val = currentEditValue(key);
    if (!val) { return; }
    val = val.replace(/\{(\w+)\}/g, (_m, p) => `[${p}]`);
    // show as a Tasky tooltip (literal text so we preview the sandbox value).
    // Stays visible only while hovering the button — hidden on mouseleave.
    (window as any).showTaskyHelp?.(val, 'info', true);
}

/** Build the complete output object for the base lang: full original file content
 *  (preserving order, _info, _synonyms, __SECTION__ …) with sandbox edits applied. */
function buildExportObject(): Record<string, any> {
    const source = _diskParsed[_baseLang] || _allTrans[_baseLang] || {};
    const out: Record<string, any> = {};
    for (const k of Object.keys(source)) out[k] = source[k];          // preserve order + everything
    for (const k of Object.keys(_sandbox)) {                          // apply edits / new keys
        const orig = source[k];
        const s = _sandbox[k];
        if (orig && typeof orig === 'object') {                       // object key edited as JSON
            try { out[k] = JSON.parse(s); } catch { out[k] = orig; }
        } else { out[k] = s; }
    }
    return out;
}

function exportSandbox(): void {
    const out = buildExportObject();
    const json = JSON.stringify(out, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${_baseLang}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${t('i18n.exported') || 'Exported'} ${_baseLang}.json (${Object.keys(out).length} ${t('i18n.keys') || 'keys'})`, 'success');
}

