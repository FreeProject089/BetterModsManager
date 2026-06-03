// @ts-nocheck
// ── i18n Translation Sandbox ──────────────────────────────────────────────────
// A safe, in-memory playground to browse every translatable key, edit values,
// see where each key is used in the source, and export a finished .json.
// NOTHING here touches the live app translations — edits live in `_sandbox` only.

import { invoke } from '../../core/api.js';
import { getAllTranslations, getLang, t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml, escAttr } from '../../core/utils.js';

let _allTrans: Record<string, Record<string, string>> = {};
let _allKeys: string[] = [];
let _baseLang = 'en';
let _sandbox: Record<string, string> = {};   // edited values (key -> new value), in-memory only
let _selectedKey: string | null = null;
let _usageCache: Record<string, any[]> = {};
let _initialized = false;

export function initI18nSandbox(): void {
    const openBtn = document.getElementById('btn-open-i18n-sandbox');
    const modal = document.getElementById('modal-i18n-sandbox');
    if (!openBtn || !modal) return;

    // Relocate the modal into #app-window-outer (the app's stacking context) so
    // its backdrop both covers the window AND actually captures clicks. Appending
    // to <body> puts it behind app-window-outer's stacking context (click-through).
    const host = document.getElementById('app-window-outer') || document.body;
    if (modal.parentElement !== host) host.appendChild(modal);

    const closeModal = () => {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    };

    openBtn.addEventListener('click', async () => {
        await loadData();
        modal.classList.add('open');
        document.body.style.overflow = 'hidden'; // lock page scroll behind the modal
        renderList();
        injectOverlayControls(modal);
    });

    // Backdrop + close button
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    modal.querySelector('[data-close="modal-i18n-sandbox"]')?.addEventListener('click', closeModal);

    document.getElementById('i18n-search')?.addEventListener('input', renderList);
    document.getElementById('i18n-only-missing')?.addEventListener('change', renderList);
    document.getElementById('i18n-base-lang')?.addEventListener('change', (e) => {
        _baseLang = (e.target as HTMLSelectElement).value;
        renderList();
        if (_selectedKey) renderDetail(_selectedKey);
    });

    document.getElementById('i18n-reset')?.addEventListener('click', () => {
        if (Object.keys(_sandbox).length === 0) { toast(t('i18n.nothingToReset') || 'Sandbox is already empty', 'info'); return; }
        _sandbox = {};
        updateDirty();
        renderList();
        if (_selectedKey) renderDetail(_selectedKey);
        toast(t('i18n.resetDone') || 'Sandbox reset', 'success');
    });

    document.getElementById('i18n-export')?.addEventListener('click', exportSandbox);

    _initialized = true;
}

async function loadData(): Promise<void> {
    // Merge in-app loaded translations with all on-disk language files
    _allTrans = JSON.parse(JSON.stringify(getAllTranslations() || {}));
    try {
        const disk: Record<string, string> = await invoke('get_all_languages_content');
        for (const [lang, raw] of Object.entries(disk)) {
            try {
                const parsed = JSON.parse(raw);
                _allTrans[lang] = { ..._allTrans[lang], ...parsed };
            } catch {}
        }
    } catch {}

    // Base lang default: current lang, fallback en, fallback first
    const langs = Object.keys(_allTrans);
    if (!langs.includes(_baseLang)) _baseLang = getLang() || langs[0] || 'en';

    // Union of all keys across all languages (so missing keys are visible)
    const keySet = new Set<string>();
    for (const dict of Object.values(_allTrans)) {
        for (const k of Object.keys(dict)) {
            if (k.startsWith('_')) continue; // skip _synonyms etc.
            keySet.add(k);
        }
    }
    _allKeys = Array.from(keySet).sort();

    // Populate base-lang selector
    const sel = document.getElementById('i18n-base-lang') as HTMLSelectElement;
    if (sel) {
        sel.innerHTML = langs.sort().map(l => `<option value="${escAttr(l)}"${l === _baseLang ? ' selected' : ''}>${escHtml(l.toUpperCase())}</option>`).join('');
    }
}

function valueFor(key: string, lang: string): string {
    if (lang === _baseLang && _sandbox[key] !== undefined) return _sandbox[key];
    return (_allTrans[lang] && _allTrans[lang][key]) ?? '';
}

function renderList(): void {
    const listEl = document.getElementById('i18n-key-list');
    const statsEl = document.getElementById('i18n-stats');
    if (!listEl) return;

    const q = ((document.getElementById('i18n-search') as HTMLInputElement)?.value || '').toLowerCase().trim();
    const onlyMissing = (document.getElementById('i18n-only-missing') as HTMLInputElement)?.checked;

    let shown = 0, missing = 0;
    const rows: string[] = [];
    for (const key of _allKeys) {
        const val = valueFor(key, _baseLang);
        const isMissing = !val;
        if (isMissing) missing++;
        if (onlyMissing && !isMissing) continue;
        if (q && !key.toLowerCase().includes(q) && !val.toLowerCase().includes(q)) continue;
        shown++;
        const edited = _sandbox[key] !== undefined;
        rows.push(`
            <div class="i18n-key-row${key === _selectedKey ? ' active' : ''}" data-key="${escAttr(key)}"
                 style="padding:7px 10px;border-radius:7px;cursor:pointer;margin-bottom:2px;border-left:3px solid ${edited ? 'var(--amber)' : (isMissing ? 'var(--danger)' : 'transparent')};${key === _selectedKey ? 'background:rgba(6,182,212,0.12);' : ''}">
                <div style="font-size:11px;font-weight:600;color:var(--text-primary);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(key)}</div>
                <div style="font-size:10px;color:${isMissing ? 'var(--danger)' : 'var(--text-muted)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${isMissing ? (t('i18n.missing') || '⚠ missing') : escHtml(val)}</div>
            </div>`);
        if (rows.length > 600) break; // cap render
    }

    listEl.innerHTML = rows.join('') || `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:12px;">${t('i18n.noResults') || 'No keys match'}</div>`;
    if (statsEl) statsEl.textContent = `${_allKeys.length} keys · ${shown} shown · ${missing} missing in ${_baseLang.toUpperCase()}`;

    listEl.querySelectorAll('.i18n-key-row').forEach(row => {
        row.addEventListener('click', () => {
            _selectedKey = (row as HTMLElement).dataset.key!;
            renderList();
            renderDetail(_selectedKey);
        });
    });
}

async function renderDetail(key: string): Promise<void> {
    const detail = document.getElementById('i18n-detail');
    if (!detail) return;

    const langs = Object.keys(_allTrans).sort();
    const baseVal = valueFor(key, _baseLang);

    // Other-language reference values
    const refsHtml = langs.filter(l => l !== _baseLang).map(l => {
        const v = valueFor(key, l);
        return `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;">
            <span style="font-weight:700;color:var(--cyan);min-width:34px;">${escHtml(l.toUpperCase())}</span>
            <span style="color:${v ? 'var(--text-secondary)' : 'var(--danger)'};">${v ? escHtml(v) : (t('i18n.missing') || '⚠ missing')}</span>
        </div>`;
    }).join('');

    detail.innerHTML = `
        <div style="margin-bottom:14px;">
            <code style="font-size:13px;color:var(--cyan);font-weight:700;word-break:break-all;">${escHtml(key)}</code>
        </div>
        <label class="form-label" style="font-size:11px;">${(t('i18n.editValue') || 'Value')} (${escHtml(_baseLang.toUpperCase())})</label>
        <textarea id="i18n-edit-value" class="form-input" rows="3" style="width:100%;font-size:13px;margin:6px 0 4px;">${escHtml(baseVal)}</textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:18px;flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" id="i18n-apply-edit">${t('i18n.applyEdit') || 'Apply to sandbox'}</button>
            ${_sandbox[key] !== undefined ? `<button class="btn btn-ghost btn-sm" id="i18n-revert-edit">${t('i18n.revert') || 'Revert'}</button><span style="font-size:11px;color:var(--amber);">${t('i18n.edited') || 'edited'}</span>` : ''}
            <button class="btn btn-ghost btn-sm" id="i18n-test-toast">🔔 ${t('i18n.testToast') || 'Test as toast'}</button>
            <button class="btn btn-ghost btn-sm" id="i18n-preview-live" style="margin-left:auto;">${t('i18n.previewLive') || 'Preview live'}</button>
        </div>

        <div style="margin-bottom:18px;">
            <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px;">${t('i18n.otherLangs') || 'Other languages'}</div>
            ${refsHtml || `<span style="font-size:12px;color:var(--text-muted);">${t('i18n.noOtherLangs') || 'No other languages loaded'}</span>`}
        </div>

        <div>
            <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                ${t('i18n.usedIn') || 'Used in'} <span id="i18n-usage-count" style="font-size:10px;color:var(--text-muted);"></span>
            </div>
            <div id="i18n-usage-list" style="font-size:11px;color:var(--text-muted);">${t('common.loading') || 'Loading…'}</div>
        </div>`;

    // Edit handlers
    document.getElementById('i18n-apply-edit')?.addEventListener('click', () => {
        const v = (document.getElementById('i18n-edit-value') as HTMLTextAreaElement).value;
        _sandbox[key] = v;
        updateDirty();
        renderList();
        renderDetail(key);
        toast(t('i18n.appliedSandbox') || 'Applied to sandbox (not saved)', 'success', 2000);
    });
    document.getElementById('i18n-revert-edit')?.addEventListener('click', () => {
        delete _sandbox[key];
        updateDirty();
        renderList();
        renderDetail(key);
    });
    document.getElementById('i18n-test-toast')?.addEventListener('click', () => {
        // Use the current textarea value (sandbox-in-progress) if present
        const v = (document.getElementById('i18n-edit-value') as HTMLTextAreaElement)?.value;
        if (v !== undefined && v !== '') { _sandbox[key] = _sandbox[key] ?? undefined; }
        const saved = _sandbox[key];
        if (v) _sandbox[key] = v;
        testToastForKey(key);
        if (saved === undefined && v) delete _sandbox[key]; // don't persist just from testing
    });
    document.getElementById('i18n-preview-live')?.addEventListener('click', () => {
        // Temporarily apply to the DOM via data-i18n elements (visual only, not persisted)
        const v = (document.getElementById('i18n-edit-value') as HTMLTextAreaElement).value;
        document.querySelectorAll(`[data-i18n="${CSS.escape(key)}"]`).forEach(el => { (el as HTMLElement).textContent = v; });
        toast(t('i18n.previewApplied') || 'Live preview applied to visible elements', 'info', 2000);
    });

    // Load usage from backend
    const usageEl = document.getElementById('i18n-usage-list');
    const countEl = document.getElementById('i18n-usage-count');
    let usages = _usageCache[key];
    if (!usages) {
        try { usages = await invoke('find_i18n_usages', { key }); _usageCache[key] = usages; }
        catch { usages = []; }
    }
    if (!usageEl) return;
    if (!usages.length) {
        usageEl.innerHTML = `<span style="color:var(--text-muted);">${t('i18n.noUsage') || 'No usage found in source (may be built dynamically)'}</span>`;
        if (countEl) countEl.textContent = '';
        return;
    }
    // Group by file
    const byFile: Record<string, any[]> = {};
    usages.forEach(u => { (byFile[u.file] ||= []).push(u); });
    if (countEl) countEl.textContent = `(${usages.length} in ${Object.keys(byFile).length} file${Object.keys(byFile).length > 1 ? 's' : ''})`;
    usageEl.innerHTML = Object.entries(byFile).map(([file, list]) => `
        <div style="margin-bottom:8px;background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.06);border-radius:7px;padding:8px 10px;">
            <div style="font-size:11px;font-weight:600;color:var(--cyan);font-family:var(--font-mono);margin-bottom:4px;word-break:break-all;">${escHtml(file)} <span style="color:var(--text-muted);font-weight:400;">(${list.length})</span></div>
            ${list.slice(0, 6).map(u => `<div style="font-size:10px;color:var(--text-secondary);font-family:var(--font-mono);padding:2px 0;border-top:1px solid rgba(255,255,255,0.03);"><span style="color:var(--text-muted);">L${u.line}</span> ${escHtml(u.snippet)}</div>`).join('')}
            ${list.length > 6 ? `<div style="font-size:10px;color:var(--text-muted);margin-top:3px;">+${list.length - 6} more…</div>` : ''}
        </div>`).join('');
}

function updateDirty(): void {
    const el = document.getElementById('i18n-dirty-count');
    const n = Object.keys(_sandbox).length;
    if (el) el.textContent = n ? `${n} ${t('i18n.unsavedEdits') || 'unsaved sandbox edit(s)'}` : '';
}

// ── Overlay / incrustation mode ───────────────────────────────────────────────
// Detaches the panel into a small, draggable floating window so you can edit a
// key while looking at the real UI behind it. Toggled from the header.
let _overlayMode = false;

function injectOverlayControls(modal: HTMLElement): void {
    if (modal.querySelector('#i18n-overlay-toggle')) return;
    const header = modal.querySelector('.modal-header');
    const closeBtn = header?.querySelector('.modal-close');
    if (!header || !closeBtn) return;

    const btn = document.createElement('button');
    btn.id = 'i18n-overlay-toggle';
    btn.className = 'modal-close';
    btn.title = t('i18n.overlayMode') || 'Overlay mode (float & drag over BMM)';
    btn.style.marginRight = '4px';
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>`;
    header.insertBefore(btn, closeBtn);
    btn.addEventListener('click', () => toggleOverlayMode(modal));
}

function toggleOverlayMode(modal: HTMLElement): void {
    _overlayMode = !_overlayMode;
    const panel = modal.querySelector('.modal') as HTMLElement;
    if (!panel) return;

    if (_overlayMode) {
        modal.classList.add('i18n-overlay-active');
        // backdrop becomes click-through; panel becomes a floating, draggable window
        modal.style.background = 'transparent';
        modal.style.pointerEvents = 'none';
        modal.style.backdropFilter = 'none';
        document.body.style.overflow = ''; // allow interacting with BMM behind
        panel.style.pointerEvents = 'auto';
        panel.style.position = 'fixed';
        panel.style.left = '60px';
        panel.style.top = '60px';
        panel.style.width = 'min(620px, 80vw)';
        panel.style.height = 'min(70vh, 600px)';
        panel.style.resize = 'both';
        panel.style.boxShadow = '0 20px 60px rgba(0,0,0,.6)';
        makeDraggable(panel, modal.querySelector('.modal-header') as HTMLElement);
        toast(t('i18n.overlayOn') || 'Overlay mode — drag the header, BMM is clickable behind', 'info', 3000);
    } else {
        modal.classList.remove('i18n-overlay-active');
        modal.style.background = '';
        modal.style.pointerEvents = '';
        modal.style.backdropFilter = '';
        document.body.style.overflow = 'hidden';
        panel.style.position = '';
        panel.style.left = panel.style.top = panel.style.width = panel.style.height = '';
        panel.style.resize = '';
        panel.style.boxShadow = '';
    }
}

function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
    if (!handle || (handle as any)._i18nDrag) return;
    (handle as any)._i18nDrag = true;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) return; // don't drag from buttons
        if (!_overlayMode) return;
        e.preventDefault();
        const rect = panel.getBoundingClientRect();
        const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
        const move = (ev: MouseEvent) => {
            panel.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - offX))}px`;
            panel.style.top  = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - offY))}px`;
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
}

/** Fire a real toast with the (sandbox) value of a key, so you can preview how
 *  it looks in context — and test params like {name}. */
function testToastForKey(key: string): void {
    let val = (_baseLang && _sandbox[key] !== undefined) ? _sandbox[key] : valueFor(key, _baseLang);
    if (!val) { toast(t('i18n.noValueToTest') || 'No value to test for this key', 'warning'); return; }
    // Fill {placeholders} with sample text so the toast renders cleanly
    val = val.replace(/\{(\w+)\}/g, (_m, p) => `[${p}]`);
    const kind = /error|fail|danger|invalid/i.test(key) ? 'error'
        : /warn|caution/i.test(key) ? 'warning'
        : /success|done|saved|complete/i.test(key) ? 'success' : 'info';
    toast(val, kind, 4000);
}

function exportSandbox(): void {
    // Build full dict for base lang = original values overridden by sandbox edits
    const base = { ...(_allTrans[_baseLang] || {}) };
    for (const [k, v] of Object.entries(_sandbox)) base[k] = v;
    // Strip internal keys
    const out: Record<string, string> = {};
    Object.keys(base).sort().forEach(k => { if (!k.startsWith('_')) out[k] = base[k]; });

    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${_baseLang}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('i18n.exported') || `Exported ${_baseLang}.json`, 'success');
}
