// @ts-nocheck
// ── i18n Translation Sandbox ──────────────────────────────────────────────────
// In-memory playground to browse/edit every translatable key (1-click, auto-saved
// to a sandbox — never the live app), preview them as toasts AND Tasky tooltips,
// pick any text straight from the app, highlight hardcoded (non-i18n) text like
// devtools, create new languages, and export a finished .json.

import { invoke } from '../../core/api.js';
import { claimDockSpace, releaseDockSpace, makeDock } from '../../ui/dock-space.js';
import { getAllTranslations, getLang, t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml, escAttr } from '../../core/utils.js';

let _allTrans: Record<string, Record<string, string>> = {};
let _allKeys: string[] = [];
let _baseLang = 'en';
let _sandbox: Record<string, string> = {};
let _selectedKey: string | null = null;
let _usageCache: Record<string, any[]> = {};
let _diskParsed: Record<string, any> = {};        // raw parsed lang files (preserve order + _info/_synonyms)
let _filter = 'all';                              // all | missing
let _modal: HTMLElement | null = null;
let _hcData: any[] = [];
let _hcLoaded = false;

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
    let h: any;
    return ((...a: any[]) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }) as T;
}
const debouncedRenderList = debounce(() => renderList(), 160);
const debouncedRenderHardcoded = debounce(() => renderHardcoded(), 160);

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
        await loadData();
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        switchTab('keys');
        renderList();
        if (localStorage.getItem(I18N_DOCK_KEY) === 'right') toggleDockMode(modal, true);
    });

    modal.addEventListener('click', (e) => { if (e.target === modal && !_overlayMode) closeModal(); });
    modal.querySelector('[data-close="modal-i18n-sandbox"]')?.addEventListener('click', closeModal);

    modal.querySelectorAll('.i18n-sb-tab').forEach(tab =>
        tab.addEventListener('click', () => switchTab((tab as HTMLElement).dataset.i18nTab || 'keys')));

    // Delegated key-row click (one listener, not one-per-row on every render).
    document.getElementById('i18n-key-list')?.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest('.i18n-key-row') as HTMLElement | null;
        if (row?.dataset.key) selectKey(row.dataset.key);
    });

    // Tools
    document.getElementById('i18n-pick-screen')?.addEventListener('click', () => togglePickMode());
    document.getElementById('i18n-highlight-hc')?.addEventListener('click', () => toggleHighlight());
    document.getElementById('i18n-overlay-toggle')?.addEventListener('click', () => toggleOverlayMode(modal));
    document.getElementById('i18n-dock-toggle')?.addEventListener('click', () => toggleDockMode(modal));
    document.getElementById('i18n-new-lang')?.addEventListener('click', promptNewLanguage);

    // Filters — debounce the search so we don't rebuild the (large) key list on
    // every keystroke (prevents typing lag with 1500+ keys).
    document.getElementById('i18n-search')?.addEventListener('input', debouncedRenderList);
    document.getElementById('i18n-base-lang')?.addEventListener('change', (e) => {
        _baseLang = (e.target as HTMLSelectElement).value;
        renderList();
        if (_selectedKey) renderDetail(_selectedKey);
    });
    modal.querySelectorAll('.i18n-sb-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            _filter = (chip as HTMLElement).dataset.i18nFilter || 'all';
            modal.querySelectorAll('.i18n-sb-chip').forEach(c => c.classList.toggle('active', c === chip));
            renderList();
        });
    });

    // Jump to the next untranslated key (wraps) — the fastest way to finish a language.
    document.getElementById('i18n-next-missing')?.addEventListener('click', selectNextMissing);

    // Floating-window opacity (only visible in overlay mode; persisted).
    const opRange = document.getElementById('i18n-ovl-opacity-range') as HTMLInputElement | null;
    if (opRange) {
        opRange.value = localStorage.getItem('bmm_i18n_overlay_opacity') || '100';
        opRange.addEventListener('input', () => {
            localStorage.setItem('bmm_i18n_overlay_opacity', opRange.value);
            const panel = _modal?.querySelector('.modal') as HTMLElement | null;
            if (panel && _overlayMode) panel.style.opacity = String(Number(opRange.value) / 100);
        });
    }

    // Hardcoded tab
    document.getElementById('i18n-hc-search')?.addEventListener('input', debouncedRenderHardcoded);
    document.getElementById('i18n-hc-kind')?.addEventListener('change', renderHardcoded);
    document.getElementById('i18n-hc-rescan')?.addEventListener('click', () => { _hcLoaded = false; loadHardcoded(true); });

    document.getElementById('i18n-reset')?.addEventListener('click', () => {
        if (Object.keys(_sandbox).length === 0) { toast(t('i18n.nothingToReset') || 'Sandbox is already empty', 'info'); return; }
        _sandbox = {};
        updateDirty(); renderList();
        if (_selectedKey) renderDetail(_selectedKey);
        toast(t('i18n.resetDone') || 'Sandbox reset', 'success');
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
        toast(on
            ? (t('i18n.testOn') || 'Sandbox is LIVE app-wide — everything now speaks your draft')
            : (t('i18n.testOff') || 'Back to the real translations'), on ? 'warning' : 'info', 2600);
    });
}

/** Header progress: how complete the selected language is (translated / total). */
function updateProgress(missing: number): void {
    const fill = document.getElementById('i18n-progress-fill');
    const txt = document.getElementById('i18n-progress-txt');
    if (!fill || !txt) return;
    const total = _allKeys.filter(k => !isObjKey(k) && !isSectionKey(k)).length;
    const done = Math.max(0, total - missing);
    const pct = total ? Math.round((done / total) * 100) : 100;
    (fill as HTMLElement).style.width = pct + '%';
    (fill as HTMLElement).style.background = pct >= 100 ? 'var(--success)' : pct >= 60 ? 'var(--accent)' : 'var(--danger)';
    txt.textContent = `${_baseLang.toUpperCase()} · ${done}/${total} (${pct}%)`;
}

/** Jump to the next missing key after the current selection (wraps around). */
function selectNextMissing(): void {
    const isMissing = (k: string) => !isObjKey(k) && !isSectionKey(k) && !valueFor(k, _baseLang).trim();
    const start = _selectedKey ? _allKeys.indexOf(_selectedKey) + 1 : 0;
    for (let i = 0; i < _allKeys.length; i++) {
        const k = _allKeys[(start + i) % _allKeys.length];
        if (isMissing(k)) {
            selectKey(k);
            document.querySelector(`.i18n-key-row[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ block: 'center' });
            return;
        }
    }
    toast(t('i18n.noMissing') || 'No missing keys — this language is complete.', 'success');
}

function switchTab(name: string): void {
    if (!_modal) return;
    _modal.querySelectorAll('.i18n-sb-tab').forEach(tb =>
        tb.classList.toggle('active', (tb as HTMLElement).dataset.i18nTab === name));
    _modal.querySelectorAll('.i18n-sb-panel').forEach(p =>
        p.classList.toggle('active', (p as HTMLElement).dataset.i18nPanel === name));
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
    if (!langs.includes(_baseLang)) _baseLang = getLang() || langs[0] || 'en';

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
    if (kc) kc.textContent = String(_allKeys.length);
}

function refreshLangSelect(): void {
    const sel = document.getElementById('i18n-base-lang') as HTMLSelectElement;
    if (!sel) return;
    const langs = Object.keys(_allTrans).sort();
    sel.innerHTML = langs.map(l =>
        `<option value="${escAttr(l)}"${l === _baseLang ? ' selected' : ''}>${escHtml(l.toUpperCase())}</option>`).join('');
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
function renderList(): void {
    const listEl = document.getElementById('i18n-key-list');
    const statsEl = document.getElementById('i18n-stats');
    if (!listEl) return;

    const q = ((document.getElementById('i18n-search') as HTMLInputElement)?.value || '').toLowerCase().trim();

    let shown = 0, missing = 0;
    const rows: string[] = [];
    for (const key of _allKeys) {
        const isObj = isObjKey(key);
        const val = valueFor(key, _baseLang);
        const isMissing = !isObj && !val.trim();
        if (isMissing) missing++;
        if (_filter === 'missing' && !isMissing) continue;
        if (q && !key.toLowerCase().includes(q) && !val.toLowerCase().includes(q)) continue;
        shown++;
        // Section dividers render as labels
        if (isSectionKey(key) && _filter !== 'missing') {
            rows.push(`<div class="i18n-key-section">${escHtml(String(rawVal(key, _baseLang) || key).replace(/^-+\s*|\s*-+$/g, ''))}</div>`);
            continue;
        }
        const edited = _sandbox[key] !== undefined;
        const preview = val.replace(/\s+/g, ' ').trim();
        rows.push(`
            <div class="i18n-key-row${key === _selectedKey ? ' active' : ''}${edited ? ' edited' : ''}${isMissing ? ' missing' : ''}" data-key="${escAttr(key)}">
                <div class="i18n-key-row-key">${escHtml(key)}${isObj ? '<span class="i18n-key-tag obj">{ }</span>' : ''}</div>
                <div class="i18n-key-row-val">${isMissing ? (t('i18n.missing') || '⚠ missing') : escHtml(preview)}</div>
            </div>`);
        if (rows.length > 1500) break;
    }

    listEl.innerHTML = rows.join('') ||
        `<div class="i18n-sb-empty" style="height:auto;margin-top:30px;">${t('i18n.noResults') || 'No keys match'}</div>`;
    if (statsEl) statsEl.innerHTML =
        `<b>${_allKeys.length}</b> ${t('i18n.keys') || 'keys'} · ${shown} ${t('i18n.shown') || 'shown'} · <span style="color:${missing ? 'var(--danger)' : 'var(--text-muted)'}">${missing} ${t('i18n.missingWord') || 'missing'}</span> · ${_baseLang.toUpperCase()}`;
    updateProgress(missing);

    // Row clicks use a single delegated listener (attached once in init), so we
    // don't bind 1500 listeners on every render — that was the list's main lag.
}

function selectKey(key: string): void {
    if (!_allKeys.includes(key)) { _allKeys.push(key); _allKeys.sort(); }
    _selectedKey = key;
    switchTab('keys');
    renderList();
    renderDetail(key);
    requestAnimationFrame(() => {
        document.querySelector(`.i18n-key-row[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
        const ta = document.getElementById('i18n-edit-value') as HTMLTextAreaElement;
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    });
}

// ── Detail / editor ───────────────────────────────────────────────────────────
async function renderDetail(key: string): Promise<void> {
    const detail = document.getElementById('i18n-detail');
    if (!detail) return;

    const langs = Object.keys(_allTrans).sort();
    const baseVal = valueFor(key, _baseLang);
    const edited = _sandbox[key] !== undefined;
    const isObj = isObjKey(key);

    const refsHtml = langs.filter(l => l !== _baseLang).map(l => {
        const v = valueFor(key, l);
        return `<div class="i18n-ref-row">
            <span class="i18n-ref-lang">${escHtml(l.toUpperCase())}</span>
            <span class="i18n-ref-val${v ? '' : ' missing'}">${v ? escHtml(v) : (t('i18n.missing') || '⚠ missing')}</span>
        </div>`;
    }).join('');

    detail.innerHTML = `
        <div class="i18n-detail-head">
            <code class="i18n-detail-key" id="i18n-copy-key" data-tooltip="${t('i18n.copyKey') || 'Copy key'}">${escHtml(key)}</code>
            ${isObj ? `<span class="i18n-kind-badge" style="color:var(--accent);border-color:rgba(124,131,253,0.4);">JSON</span>` : ''}
            ${edited ? `<span class="i18n-edited-badge">${t('i18n.edited') || 'edited'}</span>` : ''}
        </div>

        <label class="i18n-detail-label">${(t('i18n.editValue') || 'Value')} · ${escHtml(_baseLang.toUpperCase())}${isObj ? ' · JSON' : ''}
            <span class="i18n-autosave-hint" id="i18n-autosave">${t('i18n.autoSaved') || 'auto-saved to sandbox'}</span>
        </label>
        <textarea id="i18n-edit-value" class="i18n-edit-area${isObj ? ' mono' : ''}" rows="${isObj ? 8 : 3}" placeholder="${t('i18n.emptyValue') || '(empty — type a translation)'}">${escHtml(baseVal)}</textarea>

        <div class="i18n-detail-actions">
            <button class="btn btn-sm i18n-toast-btn" id="i18n-test-toast">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:5px;"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
                <span data-i18n="i18n.testToast">Show as toast</span>
            </button>
            <button class="btn btn-sm i18n-tip-btn" id="i18n-test-tip">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:5px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span data-i18n="i18n.testTip">Show as tooltip</span>
            </button>
            <button class="btn btn-ghost btn-sm" id="i18n-preview-live">${t('i18n.previewLive') || 'Preview live'}</button>
            ${edited ? `<button class="btn btn-ghost btn-sm" id="i18n-revert-edit">${t('i18n.revert') || 'Revert'}</button>` : ''}
        </div>

        <div class="i18n-detail-section">
            <div class="i18n-detail-section-title">${t('i18n.otherLangs') || 'Other languages'}</div>
            ${refsHtml || `<span class="i18n-sb-muted">${t('i18n.noOtherLangs') || 'No other languages loaded'}</span>`}
        </div>

        <div class="i18n-detail-section">
            <div class="i18n-detail-section-title">${t('i18n.usedIn') || 'Used in'} <span id="i18n-usage-count" class="i18n-sb-muted"></span></div>
            <div id="i18n-usage-list" class="i18n-sb-muted">${t('common.loading') || 'Loading…'}</div>
        </div>`;

    document.getElementById('i18n-copy-key')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(key);
        toast(t('i18n.keyCopied') || 'Key copied', 'success', 1500);
    });

    const ta = document.getElementById('i18n-edit-value') as HTMLTextAreaElement;
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
        clearTimeout(deb);
        deb = setTimeout(() => { updateDirty(); renderListPreviewOnly(key); }, 250);
    });

    document.getElementById('i18n-revert-edit')?.addEventListener('click', () => {
        delete _sandbox[key]; updateDirty(); renderList(); renderDetail(key);
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
        toast(t('i18n.previewApplied') || 'Live preview applied to visible elements', 'info', 2000);
    });

    // Usage
    const usageEl = document.getElementById('i18n-usage-list');
    const countEl = document.getElementById('i18n-usage-count');
    let usages = _usageCache[key];
    if (!usages) {
        try { usages = await invoke('find_i18n_usages', { key }); _usageCache[key] = usages; }
        catch { usages = []; }
    }
    if (!usageEl) return;
    if (!usages.length) {
        usageEl.innerHTML = `<span class="i18n-sb-muted">${t('i18n.noUsage') || 'No usage found in source (may be built dynamically)'}</span>`;
        if (countEl) countEl.textContent = '';
        return;
    }
    const byFile: Record<string, any[]> = {};
    usages.forEach((u: any) => { (byFile[u.file] ||= []).push(u); });
    if (countEl) countEl.textContent = `(${usages.length} · ${Object.keys(byFile).length} ${t('i18n.files') || 'file(s)'})`;
    usageEl.innerHTML = Object.entries(byFile).map(([file, list]) => `
        <div class="i18n-usage-file">
            <div class="i18n-usage-file-name">${escHtml(file)} <span class="i18n-sb-muted">(${list.length})</span></div>
            ${list.slice(0, 8).map(u => `
                <div class="i18n-usage-line" data-loc="${escAttr(file + ':' + u.line)}" data-tooltip="${t('i18n.copyLoc') || 'Click to copy file:line'}">
                    <span class="i18n-usage-ln">L${u.line}</span>
                    ${/toast\s*\(/.test(u.snippet || '') ? `<span class="i18n-usage-toast-tag">toast</span>` : ''}
                    ${/showTaskyHelp\s*\(/.test(u.snippet || '') ? `<span class="i18n-usage-toast-tag" style="color:var(--cyan);background:rgba(6,182,212,0.15);">tooltip</span>` : ''}
                    <span class="i18n-usage-snip">${escHtml(u.snippet)}</span>
                </div>`).join('')}
            ${list.length > 8 ? `<div class="i18n-sb-muted" style="padding:4px 0 0;">+${list.length - 8} ${t('i18n.more') || 'more…'}</div>` : ''}
        </div>`).join('');
    usageEl.querySelectorAll('.i18n-usage-line').forEach(el => {
        el.addEventListener('click', () => {
            navigator.clipboard?.writeText((el as HTMLElement).dataset.loc || '');
            toast(`${t('i18n.locCopied') || 'Copied'}: ${(el as HTMLElement).dataset.loc}`, 'success', 1800);
        });
    });
}

/** Shows a hardcoded (no-key) string picked from the app in the detail panel. */
async function showHardcodedDetail(text: string): Promise<void> {
    switchTab('keys');
    _selectedKey = null;
    renderList();
    const detail = document.getElementById('i18n-detail');
    if (!detail) return;
    detail.innerHTML = `
        <div class="i18n-detail-head"><span class="i18n-kind-badge" style="color:var(--amber);border-color:rgba(245,158,11,0.4);">${t('i18n.hardcoded') || 'Hardcoded'}</span></div>
        <div class="i18n-hc-picked-text">${escHtml(text)}</div>
        <p class="i18n-sb-muted" style="line-height:1.6;margin:6px 0 16px;">${t('i18n.hcPickedHint') || 'This text has no i18n key. Find it in the source below, then add a t(\'…\') key there.'}</p>
        <div id="i18n-hc-picked-loc" class="i18n-sb-muted">${t('common.loading') || 'Locating in source…'}</div>
        <div class="i18n-detail-actions" style="margin-top:16px;">
            <button class="btn btn-secondary btn-sm" id="i18n-hc-copy-text">${t('i18n.copyText') || 'Copy text'}</button>
        </div>`;
    document.getElementById('i18n-hc-copy-text')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(text); toast(t('i18n.copied') || 'Copied', 'success', 1500);
    });
    // locate in scan data
    if (!_hcLoaded) await loadHardcoded(false, true);
    const norm = text.trim().toLowerCase();
    const hits = _hcData.filter(h => (h.text || '').trim().toLowerCase() === norm)
        .concat(_hcData.filter(h => (h.text || '').trim().toLowerCase().includes(norm) && (h.text || '').trim().toLowerCase() !== norm)).slice(0, 12);
    const locEl = document.getElementById('i18n-hc-picked-loc');
    if (!locEl) return;
    if (!hits.length) {
        locEl.innerHTML = `<span class="i18n-sb-muted">${t('i18n.hcNotLocated') || 'Not found in static source (built dynamically).'}</span>`;
        return;
    }
    locEl.innerHTML = `<div class="i18n-detail-section-title">${t('i18n.usedIn') || 'Found in'}</div>` + hits.map(h => `
        <div class="i18n-usage-line" data-loc="${escAttr(h.file + ':' + h.line)}" data-tooltip="${t('i18n.copyLoc') || 'Click to copy file:line'}">
            <span class="i18n-usage-ln">${escHtml(h.file)}:${h.line}</span>
            <span class="i18n-usage-snip">${escHtml(h.snippet)}</span>
        </div>`).join('');
    locEl.querySelectorAll('.i18n-usage-line').forEach(el => el.addEventListener('click', () => {
        navigator.clipboard?.writeText((el as HTMLElement).dataset.loc || '');
        toast(`${t('i18n.locCopied') || 'Copied'}: ${(el as HTMLElement).dataset.loc}`, 'success', 1800);
    }));
}

function renderListPreviewOnly(key: string): void {
    const row = document.querySelector(`.i18n-key-row[data-key="${CSS.escape(key)}"]`) as HTMLElement;
    if (!row) { renderList(); return; }
    const val = valueFor(key, _baseLang);
    const valEl = row.querySelector('.i18n-key-row-val');
    if (valEl) valEl.textContent = val || (t('i18n.missing') || '⚠ missing');
    row.classList.toggle('edited', _sandbox[key] !== undefined);
    row.classList.toggle('missing', !val);
}

function updateDirty(): void {
    const el = document.getElementById('i18n-dirty-count');
    const n = Object.keys(_sandbox).length;
    if (el) el.textContent = n ? `${n} ${t('i18n.unsavedEdits') || 'unsaved sandbox edit(s)'}` : '';
}

// ── Hardcoded scanner tab ───────────────────────────────────────────────────────
async function loadHardcoded(force: boolean, quiet = false): Promise<void> {
    if (_hcLoaded && !force) return;
    const listEl = document.getElementById('i18n-hc-list');
    if (listEl && !quiet) listEl.innerHTML = `<div class="i18n-sb-empty" style="height:auto;margin-top:40px;">${t('common.loading') || 'Scanning source…'}</div>`;
    try { _hcData = await invoke('find_hardcoded_strings', { filter: '' }) || []; }
    catch { _hcData = []; }
    _hcLoaded = true;
    const c = document.getElementById('i18n-tabcount-hc');
    if (c) c.textContent = String(_hcData.length);
    if (!quiet) renderHardcoded();
}

function renderHardcoded(): void {
    const listEl = document.getElementById('i18n-hc-list');
    if (!listEl) return;
    const q = ((document.getElementById('i18n-hc-search') as HTMLInputElement)?.value || '').toLowerCase().trim();
    const kind = (document.getElementById('i18n-hc-kind') as HTMLSelectElement)?.value || 'all';
    let filtered = _hcData;
    if (kind !== 'all') filtered = filtered.filter(h => kind === 'ts' ? (h.kind === 'ts' || h.kind === 'js') : h.kind === kind);
    if (q) filtered = filtered.filter(h => (h.text || '').toLowerCase().includes(q) || (h.file || '').toLowerCase().includes(q));

    if (!filtered.length) {
        listEl.innerHTML = `<div class="i18n-sb-empty" style="height:auto;margin-top:40px;">${
            _hcData.length ? (t('i18n.noResults') || 'No matches') : (t('i18n.hcNone') || 'No hardcoded text found 🎉')}</div>`;
        return;
    }
    const kindColor: Record<string, string> = { toast: 'var(--amber)', html: 'var(--cyan)', js: 'var(--accent)', ts: 'var(--accent)' };
    listEl.innerHTML = filtered.slice(0, 600).map(h => `
        <div class="i18n-hc-item" data-loc="${escAttr(h.file + ':' + h.line)}" data-text="${escAttr(h.text)}">
            <div class="i18n-hc-item-top">
                <span class="i18n-hc-kind" style="color:${kindColor[h.kind] || 'var(--text-muted)'};border-color:${kindColor[h.kind] || 'var(--text-muted)'}40;">${escHtml(h.kind)}</span>
                <span class="i18n-hc-text">${escHtml(h.text)}</span>
            </div>
            <div class="i18n-hc-loc"><span class="i18n-hc-file">${escHtml(h.file)}</span><span class="i18n-hc-ln">L${h.line}</span></div>
        </div>`).join('') +
        (filtered.length > 600 ? `<div class="i18n-sb-muted" style="padding:10px;text-align:center;">+${filtered.length - 600} ${t('i18n.more') || 'more…'}</div>` : '');
    listEl.querySelectorAll('.i18n-hc-item').forEach(el => el.addEventListener('click', () => {
        navigator.clipboard?.writeText((el as HTMLElement).dataset.loc || '');
        toast(`${t('i18n.locCopied') || 'Copied'}: ${(el as HTMLElement).dataset.loc}`, 'success', 1800);
    }));
}

// ── Pick text from the running app (any text, i18n or hardcoded) ─────────────────
let _pickMode = false;
function setHover(el: HTMLElement | null) {
    document.querySelectorAll('.i18n-pick-hover').forEach(e => e.classList.remove('i18n-pick-hover'));
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
        if (!_overlayMode && _modal) toggleOverlayMode(_modal, true);
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
        if (!_overlayMode && _modal) toggleOverlayMode(_modal, true);
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
        makeDraggable(panel, modal.querySelector('.i18n-sb-header') as HTMLElement);
        observeResize(panel);
    } else {
        if (_ro) { _ro.disconnect(); _ro = null; }   // stop before clearing styles (avoid saving reset size)
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
function saveGeom(panel: HTMLElement): void {
    const r = panel.getBoundingClientRect();
    localStorage.setItem(OVL_KEY, JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height }));
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

