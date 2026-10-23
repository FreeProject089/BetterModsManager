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
import { MODAL_CLOSE_SVG } from '../../ui/modal-shell.js';

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

const svg = (inner: string, size = 16): string => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const IC_SPARK = svg('<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>');
const IC_FILE = svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>', 13);
const IC_BOOK = svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>', 14);
const IC_CHECK = svg('<path d="M20 6L9 17l-5-5"/>', 20);
const IC_ALERT = svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>', 20);
const IC_ARROW = svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 14);
const IC_CHEV = svg('<path d="M9 6l6 6-6 6"/>', 14);

/** The confidence chip's tone: high reads as settled, low as « check this ». */
function confTone(c: number): string {
    const p = pct(c);
    return p >= 80 ? 'is-high' : p >= 50 ? 'is-mid' : 'is-low';
}

export async function openAiSuggest(mod: any, opts: OpenOpts = {}): Promise<void> {
    ensureAiCss();
    const o = overlay();
    const tagName = opts.tagName || ((id: string) => id);
    const view = await loadAiView();
    const settings = view?.settings || null;
    const block = providerBlock(settings as any, 'mod');
    // « Rédaction »: a local server (nothing leaves this PC) or the user's remote API.
    const canDraft = !!settings?.enabled && (settings.generative === 'external' || settings.generative === 'local') && settings.description_drafts !== false;
    let rows: SuggestionRow[] = [];
    // « Réponses de Laya »: percent bars on or off (the Rust side sends the user's choice).
    let showProbs = true;
    let busy = false;

    // The house anatomy: icon tile, title + one line (« nothing is written until you apply »), ×.
    const head = `
      <div class="modal-header">
        <div class="bms-icon" aria-hidden="true">${IC_SPARK}</div>
        <div class="bms-titles">
          <h2 class="modal-title" id="ais-title">${escHtml(t('ai.suggest.title', { name: String(mod.name || '') }))}</h2>
          <p class="bms-sub">${escHtml(t('ai.suggest.lead'))}</p>
        </div>
        <button type="button" class="modal-close" id="ais-close" aria-label="${escAttr(t('common.close'))}">${MODAL_CLOSE_SVG}</button>
      </div>`;

    /** Who read the mod (a chip), and what left this PC (a second chip, once it is known). */
    const providerLine = (extra: { sent?: string | null; offline?: boolean } = {}): string => {
        const chips: string[] = [];
        if (!block) {
            const which = settings?.classifier === 'embedded' ? t('ai.src.embedded') : settings?.classifier === 'local' ? t('ai.src.laya') : t('ai.src.bettercommunity');
            chips.push(`<span class="bms-chip bms-chip--accent">${IC_SPARK}${escHtml(t('ai.suggest.withProvider', { provider: which }))}</span>`);
        } else {
            chips.push(`<span class="bms-chip">${IC_FILE}${escHtml(t('ai.suggest.filesOnly'))}</span>`);
        }
        if (extra.sent) chips.push(`<span class="bms-chip bms-chip--warn"><span class="bms-dot"></span>${escHtml(t('ai.sug3.sentChip'))}</span>`);
        else if (extra.offline || block) chips.push(`<span class="bms-chip bms-chip--ok"><span class="bms-dot"></span>${escHtml(t('ai.hub2.private'))}</span>`);
        const why = block ? `<span class="ai-sug-why">${escHtml(reasonText(block))}</span>` : '';
        return `<div class="ai-sug-chips">${chips.join('')}</div>${why}`;
    };

    const render = (state: 'loading' | 'ready' | 'error', extra: { notes?: string[]; sent?: string | null; read?: string[]; sources?: any[]; error?: string; offline?: boolean } = {}) => {
        // The dialog is redrawn whole on every tick of a row. What had the focus gets it back
        // afterwards: without this, Space on a row's checkbox dropped the focus to the page
        // behind, and a keyboard user had to Tab in from the top for every row.
        const had = document.activeElement as HTMLElement | null;
        const keep = had && o.contains(had) ? (had.dataset.row ? `input[data-row="${CSS.escape(had.dataset.row)}"]` : had.id ? `#${CSS.escape(had.id)}` : '') : '';
        const applicable = rows.filter((r) => r.applicable);
        const hints = rows.filter((r) => !r.applicable);
        const nChecked = rows.filter((r) => r.checked).length;
        const allOn = applicable.length > 0 && applicable.every((r) => r.checked);
        // « Details »: what was read, what was sent, the notes. A styled disclosure, not raw text.
        const details: string[] = [];
        if ((extra.notes || []).length) details.push(`<ul class="ai-notes">${(extra.notes || []).map((n) => `<li>${escHtml(reasonText(n))}</li>`).join('')}</ul>`);
        const srcs = (extra.sources || []).slice(0, 12);
        if (srcs.length) details.push(`<div class="bms-label">${escHtml(t('ai.suggest.read'))}</div><ul class="ai-srclist">${srcs.map((x: any) => `<li><code>${escHtml(String(x.file || ''))}</code> <span class="ai-muted">${escHtml(x.listed_only ? t('ai.sug2.listed') : [String(x.kind || ''), String(x.encoding || '')].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>`);
        else if ((extra.read || []).length) details.push(`<div class="bms-label">${escHtml(t('ai.suggest.read'))}</div><p class="ai-sug-detail">${escHtml((extra.read || []).slice(0, 8).join(', '))}</p>`);
        if (extra.sent) details.push(`<div class="bms-label">${escHtml(t('ai.suggest.sentSummary'))}</div><pre class="ai-sug-pre">${escHtml(extra.sent)}</pre>`);
        else if (extra.offline) details.push(`<p class="ai-sug-detail">${escHtml(t('ai.emb.offline'))}</p>`);
        details.push(`<div class="ai-sug-docs"><button type="button" class="btn btn-ghost btn-sm" id="ais-docs">${IC_BOOK}<span>${escHtml(t('ai.docsLink'))}</span></button></div>`);
        const hasDraft = rows.some((r) => r.note === 'draft');
        const body = state === 'loading'
            ? `<div class="bms-empty ai-sug-loading" role="status"><span class="ai-dot" aria-hidden="true"></span><span class="bms-empty-t">${escHtml(wantDraft ? t('ai.sug2.drafting') : t('ai.suggest.loading'))}</span></div>`
            : state === 'error'
                ? `<div class="bms-empty ai-sug-error" role="alert"><span class="bms-empty-ic" aria-hidden="true">${IC_ALERT}</span><span class="bms-empty-t">${escHtml(t('ai.sug3.errorT'))}</span><span class="ai-err">${escHtml(extra.error || '')}</span></div>`
                : `${applicable.length
                    ? `<section class="ai-sug-sec" aria-labelledby="ais-rows-h">
                        <div class="ai-sug-sec-h"><span class="bms-label" id="ais-rows-h">${escHtml(t('ai.sug3.rowsTitle', { n: String(applicable.length) }))}</span></div>
                        <div class="ai-rows" role="list">${applicable.map(rowHtml).join('')}</div>
                      </section>`
                    : `<div class="bms-empty ai-sug-empty"><span class="bms-empty-ic" aria-hidden="true">${IC_CHECK}</span><span class="bms-empty-t">${escHtml(t('ai.sug3.emptyT'))}</span><span>${escHtml(t('ai.sug3.emptyB'))}</span></div>`}
                   ${hints.length ? `<section class="ai-sug-sec ai-hints" aria-labelledby="ais-hints-h">
                        <div class="ai-sug-sec-h"><span class="bms-label" id="ais-hints-h">${escHtml(t('ai.suggest.hints'))}</span></div>
                        <ul class="ai-hint-list">${hints.map(hintHtml).join('')}</ul>
                      </section>` : ''}
                   ${hasDraft ? `<p class="ai-sug-note">${escHtml(t('ai.sug2.draftNote'))}</p>` : ''}
                   <details class="ai-sug-more"><summary>${IC_CHEV}<span>${escHtml(t('ai.sug2.details'))}</span></summary><div class="ai-sug-more-in">${details.join('')}</div></details>`;
        o.innerHTML = `
        <div class="modal bms modal--lg ai-modal ai-sug" role="dialog" aria-modal="true" aria-labelledby="ais-title">
          ${head}
          <div class="modal-body ai-body">
            <div class="ai-provider">${providerLine(state === 'ready' ? extra : {})}
              ${canDraft && state !== 'loading' && !wantDraft ? `<button type="button" class="btn btn-secondary btn-sm" id="ais-draft">${IC_SPARK}<span>${escHtml(t('ai.sug2.draftBtn'))}</span></button>` : ''}</div>
            ${offerInstall(view) ? installPromptHtml(view) : ''}
            ${body}
          </div>
          <div class="modal-footer ai-foot">
            <div class="modal-footer-start">
              ${state === 'ready' && applicable.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" id="ais-all">${escHtml(allOn ? t('ai.sug3.none') : t('ai.lib.tickAll'))}</button>` : ''}
              <span class="modal-footer-note" id="ais-count">${escHtml(t('ai.suggest.selected', { n: String(nChecked) }))}</span>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="ais-cancel">${escHtml(t('common.cancel'))}</button>
            <button type="button" class="btn btn-primary btn-sm" id="ais-apply" ${nChecked && !busy ? '' : 'disabled'}>${escHtml(t('ai.suggest.apply'))}</button>
          </div>
        </div>`;
        o.querySelector('#ais-close')?.addEventListener('click', close);
        o.querySelector('#ais-cancel')?.addEventListener('click', close);
        o.querySelector('#ais-docs')?.addEventListener('click', () => { close(); openAiDocs(); });
        // First use: « Laya is not installed — Install ». Installed, the dialog starts over with it.
        wireInstallPrompt(o, () => { close(); void openAiSuggest(mod, opts); });
        // « Rédiger une description »: one click, one request to the user's generator.
        o.querySelector('#ais-draft')?.addEventListener('click', () => { wantDraft = true; void run(); });
        o.querySelectorAll<HTMLInputElement>('input[data-row]').forEach((cb) => {
            cb.addEventListener('change', () => {
                rows = toggleRow(rows, cb.dataset.row || '', cb.checked);
                render('ready', last);
            });
        });
        o.querySelector('#ais-all')?.addEventListener('click', () => {
            for (const r of applicable) rows = toggleRow(rows, r.key, !allOn);
            render('ready', last);
        });
        o.querySelector('#ais-apply')?.addEventListener('click', () => void apply());
        const again = keep ? o.querySelector<HTMLElement>(keep) : null;
        if (again && !(again as HTMLButtonElement).disabled) again.focus();
        else if (keep || !o.contains(document.activeElement)) o.querySelector<HTMLElement>('#ais-close')?.focus();
    };

    /** One suggestion: a selectable card. Field, where it came from, how sure; then now → proposed. */
    const rowHtml = (r: SuggestionRow): string => {
        const multi = r.field === 'description';
        const showCur = r.field !== 'tags' && r.field !== 'links';
        const cur = showCur
            ? `<span class="ai-sug-cur"><span class="ai-sug-k">${escHtml(t('ai.sug3.now'))}</span><span class="ai-sug-v${r.current ? '' : ' is-empty'}">${escHtml((r.current || '').slice(0, 200)) || escHtml(t('ai.sug3.empty'))}</span></span>
               <span class="ai-sug-arrow" aria-hidden="true">${IC_ARROW}</span>` : '';
        return `
        <label class="ai-row${r.checked ? ' is-on' : ''}${showCur ? '' : ' is-add'}" role="listitem">
          <input type="checkbox" data-row="${escAttr(r.key)}" ${r.checked ? 'checked' : ''} aria-label="${escAttr(fieldLabel(r.field))}">
          <span class="ai-row-main">
            <span class="ai-row-head"><b class="ai-row-field">${escHtml(fieldLabel(r.field))}</b>
              <span class="ai-src ai-src-${escAttr(r.source)}">${escHtml(sourceLabel(r.source))}</span>
              ${r.uncertain ? `<span class="ai-src ai-src-unsure" title="${escAttr(t('ai.lt.guessTip'))}">${escHtml(t('ai.lt.guessBadge'))}</span>` : ''}
              ${r.note === 'draft' ? `<span class="ai-src ai-src-draft">${escHtml(t('ai.suggest.draftBadge'))}</span>` : ''}
              ${showProbs ? `<span class="ai-conf ${confTone(r.confidence)}" title="${escAttr(t('ai.suggest.confidence'))}">${pct(r.confidence)}%</span>` : ''}
            </span>
            <span class="ai-sug-change">
              ${cur}
              <span class="ai-sug-new"><span class="ai-sug-k">${escHtml(t('ai.sug3.next'))}</span><span class="ai-value${multi ? ' ai-value-multi' : ''}">${escHtml(r.display)}</span></span>
            </span>
            ${r.origin ? `<span class="ai-origin" title="${escAttr(r.origin)}">${escHtml(r.origin)}</span>` : ''}
          </span>
        </label>`;
    };
    const hintHtml = (r: SuggestionRow): string => `
        <li class="ai-hint"><b>${escHtml(fieldLabel(r.field))}</b>
          <span class="ai-hint-v">${escHtml(r.field === 'nsfw' ? (r.value === true ? t('ai.suggest.nsfwYes') : t('ai.suggest.nsfwNo')) : r.display)}</span>
          <span class="ai-src ai-src-${escAttr(r.source)}">${escHtml(sourceLabel(r.source))}</span>
          ${showProbs ? `<span class="ai-conf ${confTone(r.confidence)}">${pct(r.confidence)}%</span>` : ''}</li>`;

    let wantDraft = false;
    let last: { notes?: string[]; sent?: string | null; read?: string[]; sources?: any[]; offline?: boolean } = {};

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
            showProbs = res?.tuning?.showProbs !== false;
            // « Appliquer sans demander »: in this dialog, Laya's tags come pre-ticked (never a
            // guess); Apply stays the user's click.
            if (res?.tuning?.autoApply) for (const r of rows) if (r.field === 'tags' && r.applicable && !r.uncertain && (r.source === 'laya' || r.source === 'embedded')) rows = toggleRow(rows, r.key, true);
            last = { notes: res?.notes || [], sent: res?.sentText || null, read: res?.sourcesRead || [], sources: res?.sources || [], offline: !!res?.offline };
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
