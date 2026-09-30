// ai-suggest.ts — "Suggest" in the mod detail panel.
//
// Reads the mod's own files (always, offline), then — only if the user turned AI on and chose
// a provider — asks it to rank tags from THEIR vocabulary and to hint the language. Every row
// shows where it came from (file / folder / Laya / BetterCommunity / API) and how sure it is.
// Nothing is ticked, nothing is written: "Apply" sends exactly the ticked fields to
// `ai_apply_mod_metadata`, which validates them again in Rust.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { rowsFromSuggestions, toggleRow, buildFields, pct, providerBlock, type SuggestionRow, type AiSuggestion, type ModView } from './ai-model.js';
import { ensureAiCss, loadAiView, sourceLabel, fieldLabel, reasonText, bcAuthArgs, openAiDocs, offerInstall, installPromptHtml, wireInstallPrompt } from './ai-shared.js';
import { installFocusTrap, ownsFocus } from '../../ui/focus-trap.js';

interface OpenOpts {
    /** Called with the updated mod once fields were applied. */
    onApplied?: (res: { applied: string[]; skippedTags: string[]; mod: any }) => void;
    /** Resolve a tag id to its name (the caller holds the tag list). */
    tagName?: (id: string) => string;
}

let _overlay: HTMLElement | null = null;
/** Where the focus was when the dialog opened: it goes back there on close. */
let _opener: HTMLElement | null = null;

function overlay(): HTMLElement {
    if (_overlay && _overlay.isConnected) return _overlay;
    const o = document.createElement('div');
    o.className = 'modal-overlay ai-overlay';
    o.id = 'modal-ai-suggest';
    (document.getElementById('app-window-outer') || document.body).appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && o.classList.contains('open') && ownsFocus(o)) close(); });
    // A modal dialog: Tab stays in it.
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

const IC_SPARK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>';

export async function openAiSuggest(mod: any, opts: OpenOpts = {}): Promise<void> {
    ensureAiCss();
    const o = overlay();
    const tagName = opts.tagName || ((id: string) => id);
    const view = await loadAiView();
    const settings = view?.settings || null;
    const block = providerBlock(settings as any, 'mod');
    const canDraft = !!settings?.enabled && settings.generative === 'external' && settings.description_drafts !== false;
    let rows: SuggestionRow[] = [];
    let busy = false;

    const head = `
      <div class="modal-header">
        <h3 class="modal-title ai-title" id="ais-title">${IC_SPARK}<span>${escHtml(t('ai.suggest.title', { name: String(mod.name || '') }))}</span></h3>
        <button type="button" class="modal-close" id="ais-close" aria-label="${escAttr(t('common.close'))}">&times;</button>
      </div>`;

    const providerLine = (): string => {
        if (!block) {
            const which = settings?.classifier === 'embedded' ? t('ai.src.embedded') : settings?.classifier === 'local' ? t('ai.src.laya') : t('ai.src.bettercommunity');
            return `<span class="ai-pill ai-pill-on">${escHtml(t('ai.suggest.withProvider', { provider: which }))}</span>`;
        }
        return `<span class="ai-pill">${escHtml(t('ai.suggest.filesOnly'))}</span> <span class="ai-muted">${escHtml(reasonText(block))}</span>`;
    };

    const render = (state: 'loading' | 'ready' | 'error', extra: { notes?: string[]; sent?: string | null; read?: string[]; error?: string; offline?: boolean } = {}) => {
        // The dialog is redrawn whole on every tick of a row. What had the focus gets it back
        // afterwards: without this, Space on a row's checkbox dropped the focus to the page
        // behind, and a keyboard user had to Tab in from the top for every row.
        const had = document.activeElement as HTMLElement | null;
        const keep = had && o.contains(had) ? (had.dataset.row ? `input[data-row="${CSS.escape(had.dataset.row)}"]` : had.id ? `#${CSS.escape(had.id)}` : '') : '';
        const applicable = rows.filter((r) => r.applicable);
        const hints = rows.filter((r) => !r.applicable);
        const nChecked = rows.filter((r) => r.checked).length;
        const body = state === 'loading'
            ? `<div class="ai-loading"><span class="ai-dot"></span>${escHtml(t('ai.suggest.loading'))}</div>`
            : state === 'error'
                ? `<div class="ai-error">${escHtml(extra.error || '')}</div>`
                : `${applicable.length ? `<div class="ai-rows" role="list">${applicable.map(rowHtml).join('')}</div>` : `<div class="ai-empty">${escHtml(t('ai.suggest.none'))}</div>`}
                   ${hints.length ? `<div class="ai-hints"><div class="ai-sub">${escHtml(t('ai.suggest.hints'))}</div>${hints.map(hintHtml).join('')}</div>` : ''}
                   ${(extra.notes || []).length ? `<ul class="ai-notes">${(extra.notes || []).map((n) => `<li>${escHtml(reasonText(n))}</li>`).join('')}</ul>` : ''}
                   ${(extra.read || []).length ? `<div class="ai-muted ai-read">${escHtml(t('ai.suggest.read'))} ${escHtml((extra.read || []).slice(0, 8).join(', '))}</div>` : ''}
                   ${extra.offline && !extra.sent ? `<div class="ai-muted">${escHtml(t('ai.emb.offline'))}</div>` : ''}
                   ${extra.sent ? `<details class="ai-sent"><summary>${escHtml(t('ai.suggest.sentSummary'))}</summary><pre>${escHtml(extra.sent)}</pre></details>` : ''}`;
        o.innerHTML = `
        <div class="modal ai-modal" role="dialog" aria-modal="true" aria-labelledby="ais-title">
          ${head}
          <div class="modal-body ai-body">
            <p class="ai-lead">${escHtml(t('ai.suggest.lead'))}</p>
            <div class="ai-provider">${providerLine()}
              <button type="button" class="ai-link" id="ais-docs">${escHtml(t('ai.docsLink'))}</button></div>
            ${offerInstall(view) ? installPromptHtml(view) : ''}
            ${canDraft ? `<label class="ai-check"><input type="checkbox" id="ais-draft"> <span>${escHtml(t('ai.suggest.draft'))}</span></label>` : ''}
            ${body}
          </div>
          <div class="modal-footer ai-foot">
            <span class="ai-muted" id="ais-count">${escHtml(t('ai.suggest.selected', { n: String(nChecked) }))}</span>
            <button type="button" class="btn btn-ghost btn-sm" id="ais-cancel">${escHtml(t('common.cancel'))}</button>
            <button type="button" class="btn btn-primary btn-sm" id="ais-apply" ${nChecked && !busy ? '' : 'disabled'}>${escHtml(t('ai.suggest.apply'))}</button>
          </div>
        </div>`;
        o.querySelector('#ais-close')?.addEventListener('click', close);
        o.querySelector('#ais-cancel')?.addEventListener('click', close);
        o.querySelector('#ais-docs')?.addEventListener('click', () => { close(); openAiDocs(); });
        // First use: « Laya is not installed — Install ». Installed, the dialog starts over with it.
        wireInstallPrompt(o, () => { close(); void openAiSuggest(mod, opts); });
        const draftBox = o.querySelector<HTMLInputElement>('#ais-draft');
        if (draftBox) {
            draftBox.checked = wantDraft;
            draftBox.addEventListener('change', () => { wantDraft = draftBox.checked; if (wantDraft) void run(); });
        }
        o.querySelectorAll<HTMLInputElement>('input[data-row]').forEach((cb) => {
            cb.addEventListener('change', () => {
                rows = toggleRow(rows, cb.dataset.row || '', cb.checked);
                render('ready', last);
            });
        });
        o.querySelector('#ais-apply')?.addEventListener('click', () => void apply());
        const again = keep ? o.querySelector<HTMLElement>(keep) : null;
        if (again && !(again as HTMLButtonElement).disabled) again.focus();
        else if (keep || !o.contains(document.activeElement)) o.querySelector<HTMLElement>('#ais-close')?.focus();
    };

    const rowHtml = (r: SuggestionRow): string => {
        const multi = r.field === 'description';
        const cur = r.current && r.field !== 'tags' && r.field !== 'links'
            ? `<div class="ai-current"><span>${escHtml(t('ai.suggest.current'))}</span> ${escHtml(r.current.slice(0, 200)) || '—'}</div>` : '';
        return `
        <label class="ai-row${r.checked ? ' is-on' : ''}" role="listitem">
          <input type="checkbox" data-row="${escAttr(r.key)}" ${r.checked ? 'checked' : ''} aria-label="${escAttr(fieldLabel(r.field))}">
          <span class="ai-row-main">
            <span class="ai-row-head"><b>${escHtml(fieldLabel(r.field))}</b>
              <span class="ai-src ai-src-${escAttr(r.source)}">${escHtml(sourceLabel(r.source))}</span>
              <span class="ai-origin">${escHtml(r.origin)}</span>
              <span class="ai-conf" title="${escAttr(t('ai.suggest.confidence'))}">${pct(r.confidence)}%</span>
              ${r.note === 'draft' ? `<span class="ai-src ai-src-draft">${escHtml(t('ai.suggest.draftBadge'))}</span>` : ''}
            </span>
            <span class="ai-value${multi ? ' ai-value-multi' : ''}">${escHtml(r.display)}</span>
            ${cur}
          </span>
        </label>`;
    };
    const hintHtml = (r: SuggestionRow): string => `
        <div class="ai-hint"><b>${escHtml(fieldLabel(r.field))}</b>
          <span>${escHtml(r.field === 'nsfw' ? (r.value === true ? t('ai.suggest.nsfwYes') : t('ai.suggest.nsfwNo')) : r.display)}</span>
          <span class="ai-src ai-src-${escAttr(r.source)}">${escHtml(sourceLabel(r.source))}</span>
          <span class="ai-conf">${pct(r.confidence)}%</span></div>`;

    let wantDraft = false;
    let last: { notes?: string[]; sent?: string | null; read?: string[]; offline?: boolean } = {};

    const run = async (): Promise<void> => {
        if (busy) return;
        busy = true;
        render('loading');
        try {
            const auth = block ? {} : await bcAuthArgs(settings);
            const res: any = await invoke('ai_suggest_mod_metadata', {
                modId: mod.id,
                useProviders: !block || (wantDraft && canDraft),
                draft: wantDraft && canDraft,
                ...auth,
            });
            const view: ModView = mod;
            rows = rowsFromSuggestions((res?.suggestions || []) as AiSuggestion[], view, tagName);
            last = { notes: res?.notes || [], sent: res?.sentText || null, read: res?.sourcesRead || [], offline: !!res?.offline };
            busy = false;
            render('ready', last);
        } catch (e) {
            busy = false;
            render('error', { error: String((e as Error)?.message || e) });
        }
    };

    const apply = async (): Promise<void> => {
        const fields = buildFields(rows);
        if (!Object.keys(fields).length || busy) return;
        busy = true;
        const btn = o.querySelector<HTMLButtonElement>('#ais-apply');
        if (btn) btn.disabled = true;
        try {
            const res: any = await invoke('ai_apply_mod_metadata', { modId: mod.id, fields });
            close();
            opts.onApplied?.(res);
        } catch (e) {
            const count = o.querySelector('#ais-count');
            if (count) { count.textContent = String((e as Error)?.message || e); count.className = 'ai-error'; }
            if (btn) btn.disabled = false;
        } finally {
            busy = false;
        }
    };

    if (!o.classList.contains('open')) {
        const a = document.activeElement as HTMLElement | null;
        _opener = a && a !== document.body && !o.contains(a) ? a : null;
    }
    o.classList.add('open');
    await run();
}
