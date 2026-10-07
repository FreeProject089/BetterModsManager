// ai-library.ts — Mod Library → « Analyser la bibliothèque ».
//
// The per-mod « Suggest » (ai-suggest.ts), for many mods in one pass: Rust reads each mod's own
// files (README*, *.md, *.txt, changelog, version files, manifest variants, in folders and in
// .zip archives; 7z/rar are listed, not read), then — only if the user turned AI on — lets Laya
// rank tags from THEIR vocabulary (`ai_analyze_library`, commands/ai.rs → ai_hybrid.rs). Never a
// generated draft in a batch: that stays a click in the per-mod dialog.
//
// Nothing is written. The result is a review list, one mod per row, each field unticked; the
// user ticks and clicks « Appliquer » on a mod, which sends exactly those fields to
// `ai_apply_mod_metadata` (validated again in Rust).
import { invoke, listen } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { rowsFromSuggestions, toggleRow, buildFields, pct, providerBlock, type SuggestionRow, type AiSuggestion } from './ai-model.js';
import { ensureAiCss, loadAiView, sourceLabel, fieldLabel, reasonText } from './ai-shared.js';
import { installFocusTrap, ownsFocus } from '../../ui/focus-trap.js';

export interface LibraryOpts {
    /** The library as the page holds it (id, name, description, tags…). */
    getMods: () => any[];
    tagName: (id: string) => string;
    /** A mod was updated by « Appliquer » (the Rust copy of it). */
    onApplied: (mod: any, res: any) => void;
}

interface Item { id: string; name: string; rows: SuggestionRow[]; notes: string[]; done: boolean; error?: string }

const IC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>';

let _overlay: HTMLElement | null = null;
let _opener: HTMLElement | null = null;
let _running = false;

function overlay(): HTMLElement {
    if (_overlay && _overlay.isConnected) return _overlay;
    const o = document.createElement('div');
    o.className = 'modal-overlay ai-overlay';
    o.id = 'modal-ai-library';
    (document.getElementById('app-window-outer') || document.body).appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o && !_running) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && o.classList.contains('open') && ownsFocus(o) && !_running) close(); });
    installFocusTrap(o, () => o.classList.contains('open') && ownsFocus(o));
    _overlay = o;
    return o;
}

function close(): void {
    if (!_overlay?.classList.contains('open')) return;
    _overlay.classList.remove('open');
    const back = _opener; _opener = null;
    try { if (back?.isConnected) back.focus(); } catch { /* nothing to return to */ }
}

/** A mod the batch should look at first: no description, or no tag. */
export function isIncomplete(m: any): boolean {
    return !String(m?.description || '').trim() || !(Array.isArray(m?.tags) && m.tags.length);
}

export async function openAnalyzeLibrary(opts: LibraryOpts): Promise<void> {
    ensureAiCss();
    const o = overlay();
    if (!o.classList.contains('open')) {
        const a = document.activeElement as HTMLElement | null;
        _opener = a && a !== document.body && !o.contains(a) ? a : null;
    }
    const view = await loadAiView();
    const block = providerBlock(view?.settings as any, 'mod');
    const mods = opts.getMods() || [];
    const incomplete = mods.filter(isIncomplete);
    let items: Item[] = [];
    let summary = '';

    const shell = (body: string, foot: string) => {
        o.innerHTML = `
        <div class="modal bms modal--lg ai-modal ai-lib" role="dialog" aria-modal="true" aria-labelledby="ail-title">
          <div class="modal-header">
            <div class="bms-icon" aria-hidden="true">${IC}</div>
            <h2 class="modal-title" id="ail-title">${escHtml(t('ai.lib.title'))}</h2>
            <button type="button" class="modal-close" id="ail-close" aria-label="${escAttr(t('common.close'))}" ${_running ? 'disabled' : ''}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <div class="modal-body ai-body">${body}</div>
          <div class="modal-footer ai-foot">${foot}</div>
        </div>`;
        o.querySelector('#ail-close')?.addEventListener('click', () => { if (!_running) close(); });
    };

    // ── 1. What to analyse ────────────────────────────────────────────────
    const start = () => {
        shell(`
            <p class="ai-lead">${escHtml(t('ai.lib.lead'))}</p>
            <div class="ai-lib-opts">
              <label class="ai-check"><input type="radio" name="ail-scope" value="incomplete" ${incomplete.length ? 'checked' : 'disabled'}> <span>${escHtml(t('ai.lib.scopeIncomplete', { n: String(incomplete.length) }))}</span></label>
              <label class="ai-check"><input type="radio" name="ail-scope" value="all" ${incomplete.length ? '' : 'checked'}> <span>${escHtml(t('ai.lib.scopeAll', { n: String(mods.length) }))}</span></label>
              <label class="ai-check"><input type="checkbox" id="ail-laya" ${block ? 'disabled' : 'checked'}> <span>${escHtml(t('ai.lib.useLaya'))}${block ? ` <span class="ai-muted">(${escHtml(reasonText(block))})</span>` : ''}</span></label>
            </div>`,
            `<span class="ai-muted ai-foot-note">${escHtml(t('ai.lib.nothingWritten'))}</span>
             <button type="button" class="btn btn-ghost btn-sm" id="ail-cancel">${escHtml(t('common.cancel'))}</button>
             <button type="button" class="btn btn-primary btn-sm" id="ail-go" ${mods.length ? '' : 'disabled'}>${escHtml(t('ai.lib.go'))}</button>`);
        o.querySelector('#ail-cancel')?.addEventListener('click', close);
        o.querySelector('#ail-go')?.addEventListener('click', () => {
            const scope = (o.querySelector<HTMLInputElement>('input[name="ail-scope"]:checked')?.value) || 'all';
            const laya = !!o.querySelector<HTMLInputElement>('#ail-laya')?.checked && !block;
            void run(scope === 'incomplete' ? incomplete.map((m) => String(m.id)) : null, laya);
        });
        o.querySelector<HTMLElement>('#ail-go')?.focus();
    };

    // ── 2. The run, with its progress ─────────────────────────────────────
    const run = async (ids: string[] | null, laya: boolean) => {
        const total = ids ? ids.length : mods.length;
        _running = true;
        shell(`
            <div class="ai-lib-progress">
              <progress id="ail-bar" max="${Math.max(1, total)}" value="0"></progress>
              <div class="ai-muted" id="ail-count" aria-live="polite">${escHtml(t('ai.lib.progress', { done: '0', total: String(total) }))}</div>
            </div>`,
            `<button type="button" class="btn btn-ghost btn-sm" id="ail-stop">${escHtml(t('ai.lib.stop'))}</button>`);
        o.querySelector('#ail-stop')?.addEventListener('click', () => {
            void invoke('ai_analyze_cancel');
            const b = o.querySelector<HTMLButtonElement>('#ail-stop');
            if (b) { b.disabled = true; b.textContent = t('ai.lib.stopping'); }
        });
        const stop = await listen('ai-analyze-progress', (p: any) => {
            const bar = o.querySelector<HTMLProgressElement>('#ail-bar');
            const c = o.querySelector('#ail-count');
            if (bar) { bar.max = Math.max(1, Number(p?.total) || total); bar.value = Number(p?.done) || 0; }
            if (c) c.textContent = t('ai.lib.progress', { done: String(p?.done ?? 0), total: String(p?.total ?? total) });
        });
        try {
            const r: any = await invoke('ai_analyze_library', { modIds: ids, useProviders: laya, draft: false });
            const byId = new Map<string, any>(mods.map((m) => [String(m.id), m]));
            items = (r?.items || []).map((it: any) => {
                const m = byId.get(String(it.modId)) || { id: it.modId, name: it.name };
                return { id: String(it.modId), name: String(m.name || it.name || it.modId), rows: rowsFromSuggestions((it.suggestions || []) as AiSuggestion[], m, opts.tagName), notes: it.notes || [], done: false };
            }).filter((it: Item) => it.rows.some((r) => r.applicable));
            // « Réponses de Laya » for the library: percent bars, and « apply without asking »
            // for Laya's tags (never a guess kept under the threshold, never a file's value).
            const tune = (r?.items || [])[0]?.tuning || {};
            showProbs = tune.showProbs !== false;
            autoApply = !!tune.autoApply;
            summary = r?.cancelled ? t('ai.lib.summaryStopped', { n: String(items.length), ms: String(Math.round((r?.ms || 0) / 100) / 10) }) : t('ai.lib.summary', { n: String(items.length), total: String(r?.total ?? total), s: String(Math.round((r?.ms || 0) / 100) / 10) });
        } catch (e) {
            summary = reasonText(String((e as Error)?.message || e));
            items = [];
        } finally {
            stop();
            _running = false;
        }
        review();
        if (autoApply) {
            for (const it of items) {
                let any = false;
                for (const r of it.rows) {
                    if (r.field === 'tags' && r.applicable && !r.uncertain && (r.source === 'laya' || r.source === 'embedded')) { it.rows = toggleRow(it.rows, r.key, true); any = true; }
                }
                if (any) await apply(it.id);
            }
        }
    };
    let showProbs = true;
    let autoApply = false;

    // ── 3. Review: per mod, per field ────────────────────────────────────
    const rowHtml = (it: Item, r: SuggestionRow) => `
        <label class="ai-row${r.checked ? ' is-on' : ''}${r.applicable ? '' : ' is-hint'}">
          <input type="checkbox" data-mod="${escAttr(it.id)}" data-row="${escAttr(r.key)}" ${r.checked ? 'checked' : ''} ${r.applicable && !it.done ? '' : 'disabled'} aria-label="${escAttr(fieldLabel(r.field))}">
          <span class="ai-row-main">
            <span class="ai-row-head"><b>${escHtml(fieldLabel(r.field))}</b>
              <span class="ai-src ai-src-${escAttr(r.source)}">${escHtml(sourceLabel(r.source))}</span>
              <span class="ai-origin">${escHtml(r.origin)}</span>
              ${showProbs ? `<span class="ai-conf" title="${escAttr(t('ai.suggest.confidence'))}">${pct(r.confidence)}%</span>` : ''}
              ${r.uncertain ? `<span class="ai-src ai-src-unsure">${escHtml(t('ai.lt.guessBadge'))}</span>` : ''}</span>
            <span class="ai-value${r.field === 'description' ? ' ai-value-multi' : ''}">${escHtml(r.display)}</span>
          </span>
        </label>`;
    const itemHtml = (it: Item) => {
        const n = it.rows.filter((r) => r.checked).length;
        const shown = it.rows.filter((r) => r.applicable);
        return `
        <details class="ai-lib-item${it.done ? ' is-done' : ''}" data-item="${escAttr(it.id)}" ${openIds.has(it.id) ? 'open' : ''}>
          <summary><span class="ai-lib-name">${escHtml(it.name)}</span>
            <span class="ai-muted">${it.done ? escHtml(t('ai.lib.applied')) : escHtml(t('ai.lib.nSugg', { n: String(shown.length) }))}</span></summary>
          <div class="ai-rows">${shown.map((r) => rowHtml(it, r)).join('')}</div>
          ${it.error ? `<div class="ai-error">${escHtml(it.error)}</div>` : ''}
          ${it.done ? '' : `<div class="ai-lib-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-all="${escAttr(it.id)}">${escHtml(t('ai.lib.tickAll'))}</button>
            <button type="button" class="btn btn-primary btn-sm" data-apply="${escAttr(it.id)}" ${n ? '' : 'disabled'}>${escHtml(t('ai.lib.apply', { n: String(n) }))}</button></div>`}
        </details>`;
    };
    const openIds = new Set<string>();
    const review = () => {
        const list = items.length
            ? `<div class="ai-lib-list">${items.map(itemHtml).join('')}</div>`
            : `<div class="ai-empty">${escHtml(t('ai.lib.none'))}</div>`;
        shell(`<div class="ai-muted ai-lib-summary">${escHtml(summary)}</div>${list}`,
            `<span class="ai-muted ai-foot-note">${escHtml(t('ai.lib.nothingWritten'))}</span>
             <button type="button" class="btn btn-ghost btn-sm" id="ail-again">${escHtml(t('ai.lib.again'))}</button>
             <button type="button" class="btn btn-primary btn-sm" id="ail-done">${escHtml(t('common.close'))}</button>`);
        o.querySelector('#ail-done')?.addEventListener('click', close);
        o.querySelector('#ail-again')?.addEventListener('click', start);
        o.querySelectorAll<HTMLDetailsElement>('details[data-item]').forEach((d) => d.addEventListener('toggle', () => { const id = d.dataset.item || ''; if (d.open) openIds.add(id); else openIds.delete(id); }));
        o.querySelectorAll<HTMLInputElement>('input[data-row]').forEach((cb) => cb.addEventListener('change', () => {
            const it = items.find((x) => x.id === cb.dataset.mod);
            if (!it) return;
            it.rows = toggleRow(it.rows, cb.dataset.row || '', cb.checked);
            repaintItem(it);
        }));
        o.querySelectorAll<HTMLButtonElement>('[data-all]').forEach((b) => b.addEventListener('click', () => {
            const it = items.find((x) => x.id === b.dataset.all);
            if (!it) return;
            // One value per scalar field: toggleRow keeps the first one ticked, the others off.
            for (const r of it.rows) if (r.applicable && !it.rows.some((x) => x.checked && x.field === r.field && x.key !== r.key && r.field !== 'tags' && r.field !== 'links')) it.rows = toggleRow(it.rows, r.key, true);
            repaintItem(it);
        }));
        o.querySelectorAll<HTMLButtonElement>('[data-apply]').forEach((b) => b.addEventListener('click', () => void apply(b.dataset.apply || '')));
    };
    const repaintItem = (it: Item) => {
        openIds.add(it.id);
        review();
        o.querySelector<HTMLElement>(`details[data-item="${CSS.escape(it.id)}"] summary`)?.focus();
    };
    const apply = async (id: string) => {
        const it = items.find((x) => x.id === id);
        if (!it) return;
        const fields = buildFields(it.rows);
        if (!Object.keys(fields).length) return;
        try {
            const res: any = await invoke('ai_apply_mod_metadata', { modId: id, fields });
            it.done = true;
            it.error = undefined;
            opts.onApplied(res?.mod, res);
        } catch (e) {
            it.error = String((e as Error)?.message || e);
        }
        repaintItem(it);
    };

    o.classList.add('open');
    start();
}

/** The icon button beside « Check for updates » in the library toolbar. */
export function mountAnalyzeButton(opts: LibraryOpts): void {
    if (document.getElementById('btn-lib-ai-analyze')) return;
    const anchor = document.getElementById('btn-lib-check-updates');
    if (!anchor) return;
    ensureAiCss();
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'btn-lib-ai-analyze';
    b.className = 'btn btn-icon btn-ghost btn-compact-toggle';
    b.innerHTML = IC;
    const label = () => { b.title = t('ai.lib.button'); b.setAttribute('aria-label', t('ai.lib.button')); };
    label();
    document.addEventListener('langChanged', label);
    b.addEventListener('click', () => { void openAnalyzeLibrary(opts); });
    anchor.insertAdjacentElement('afterend', b);
}
