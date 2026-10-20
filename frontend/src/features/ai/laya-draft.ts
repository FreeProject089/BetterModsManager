// laya-draft.ts — « Rédaction »: drafting with the user's writer (a local server such as LM Studio
// or Ollama, or their own online API).
//
// Three entry points, one tool:
//   · the « Drafting » tab of the Laya dialog (mountDraftPane): a workbench — describe a mod from
//     its own files, release notes from a changelog, summarise the enabled mods, translate EN↔FR,
//     shorten, clarify — whose result is copied or reused;
//   · openDraft({ field }): the same tool for one text field, with a diff against what the field
//     holds and Replace / Insert at the cursor / Add at the end, then Undo next to the field;
//   · installDraftHooks(): a small « Draft with Laya » button under the description fields that
//     benefit from it (modpack, catalogue entry, feedback, order-list notes, plugin), shown only
//     when a writer is set up. Any textarea can opt in with data-laya-draft="<preset>".
//
// What is sent is shown before anything is sent (« What will be sent »: the exact messages Rust
// builds, the address, the model, how much personal data was masked). The answer streams in and
// can be stopped. Nothing is written into a field until the user clicks Apply. The prompts, the
// gate (master switch, the drafting toggle, a configured writer) and the network are Rust's
// (commands/ai_gen.rs). The built-in Laya model classifies, it does not write: without a writer
// this tool says so and points at Providers.
import { invoke, listen } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { openModal, type ModalHandle } from '../../ui/modal-shell.js';
import { uiIcon } from '../../ui/icons.js';
import { ensureAiCss, loadAiView, reasonText, type AiView } from './ai-shared.js';
import type { AiSettings } from './ai-model.js';
import {
    DRAFT_PRESETS, PRESET_INPUT, applyDraft, clipTo, defaultMode, diffStats, missingInput, modListText,
    normalizeBase, presetOfUrl, wordDiff, type ApplyMode, type DraftPreset,
} from './ai-gen-model.js';

type Field = HTMLTextAreaElement | HTMLInputElement;

export interface DraftOptions {
    /** The field the draft goes into (dialog mode). */
    field?: Field | null;
    preset?: DraftPreset;
    /** i18n key naming the field (« Modpack description »). */
    label?: string;
    context?: string;
    modId?: string;
}

let _seq = 0;

/** Open the Laya dialog on a tab. laya-hub.ts listens: an event, not an import (the hub imports this module). */
function openHub(tab: string): void {
    document.dispatchEvent(new CustomEvent('bmm:open-laya', { detail: { tab } }));
}
let _view: AiView | null = null;
let _viewAt = 0;

async function view(fresh = false): Promise<AiView | null> {
    if (fresh || !_view || Date.now() - _viewAt > 20_000) { _view = await loadAiView(); _viewAt = Date.now(); }
    return _view;
}

/** Why drafting cannot run now (an i18n key), or null when a writer is ready. */
export function setupGap(s: AiSettings | null | undefined, st: any): string | null {
    if (!s) return 'ai.settings.unavailable';
    if (st?.killSwitch) return 'ai.reason.killed';
    if (!s.enabled) return 'ai.draft.gapOff';
    if (!s.generative || s.generative === 'off') return 'ai.draft.gapWriter';
    if (!s.description_drafts) return 'ai.draft.gapToggle';
    const model = s.generative === 'local' ? s.gen_local_model : s.external_model;
    if (!String(model || '').trim()) return 'ai.draft.gapModel';
    return null;
}

function writerChips(s: AiSettings | null): string {
    if (!s || !s.generative || s.generative === 'off') return '';
    if (s.generative === 'local') {
        const name = t(`ai.gen.preset.${presetOfUrl(s.gen_local_url || '')}`);
        return `<span class="bms-chip bms-chip--ok"><span class="bms-dot"></span>${escHtml(t('ai.gen.writerChip', { v: `${name} · ${s.gen_local_model || '?'}` }))}</span>
            <span class="bms-chip bms-chip--ok"><span class="bms-dot"></span>${escHtml(t('ai.draft.staysLocal'))}</span>`;
    }
    let host = s.external_url;
    try { host = new URL(normalizeBase(s.external_url)).host; } catch { /* as typed */ }
    return `<span class="bms-chip"><span class="bms-dot"></span>${escHtml(t('ai.gen.writerChip', { v: `${host} · ${s.external_model || '?'}` }))}</span>
        <span class="bms-chip bms-chip--warn"><span class="bms-dot"></span>${escHtml(t('ai.draft.sentTo', { host }))}</span>`;
}

function errorText(code: string, detail?: string | null): string {
    const known = ['refused', 'timeout', 'unreachable', 'wrong_path', 'bad_response', 'no_models', 'model_error'];
    const base = known.includes(code) ? t(`ai.gen.code.${code}`) : code.startsWith('http_') ? t('ai.gen.code.http', { status: code.slice(5) }) : reasonText(code);
    const hint = code === 'model_error' || code === 'http_404' || code === 'http_400' ? ` ${t('ai.draft.hintModel')}` : code === 'refused' ? ` ${t('ai.gen.hintRefused')}` : '';
    return `${base}${detail ? ` (${detail})` : ''}${hint}`;
}

function gateText(raw: string): string {
    if (raw.startsWith('ai.draft.') || raw.startsWith('ai.url.')) return t(raw);
    if (raw === 'mod_not_found') return t('ai.draft.modNotFound');
    return reasonText(raw);
}

// ── The tool ─────────────────────────────────────────────────────────────────

interface Ctl {
    root: HTMLElement;
    result: () => string;
    original: () => string;
    busy: () => boolean;
    stop: () => void;
    refresh: () => Promise<void>;
}

function markup(p: string, mode: 'pane' | 'dialog', o: DraftOptions, s: AiSettings | null, st: any): string {
    const gap = setupGap(s, st);
    const presets = DRAFT_PRESETS;
    const cur = o.preset || (mode === 'dialog' ? 'clarify' : 'describe_mod');
    const chip = (id: DraftPreset) => `<button type="button" class="ai-chipbtn${id === cur ? ' is-on' : ''}" role="radio" aria-checked="${id === cur}" data-ld-preset="${id}">${escHtml(t(`ai.draft.p.${id}`))}</button>`;
    const seg = (name: string, vals: string[], def: string) => `<div class="ai-chipbtns" role="radiogroup" aria-label="${escAttr(t(`ai.draft.${name}`))}">${vals.map((v) => `<button type="button" class="ai-chipbtn${v === def ? ' is-on' : ''}" role="radio" aria-checked="${v === def}" data-ld-${name}="${v}">${escHtml(t(`ai.draft.${name}.${v}`))}</button>`).join('')}</div>`;
    const fieldText = o.field ? o.field.value : '';
    return `
      <div class="ld" data-mode="${mode}">
        <div class="ld-top">
          <div class="ld-chips" data-ld="target">${writerChips(s)}</div>
          <div class="ld-setup" data-ld="setup" ${gap ? '' : 'hidden'}>
            <p class="ld-setup-msg" data-ld="gap">${gap ? escHtml(t(gap)) : ''}</p>
            <button type="button" class="btn btn-primary btn-sm" data-ld="goSetup">${escHtml(t('ai.draft.setUp'))}</button>
          </div>
        </div>
        <div class="ai-chipbtns ld-presets" role="radiogroup" aria-label="${escAttr(t('ai.draft.presetsAria'))}">${presets.map(chip).join('')}</div>
        <p class="ai-muted ld-preset-hint" data-ld="presetHint">${escHtml(t(`ai.draft.ph.${cur}`))}</p>
        <div class="ld-grid">
          <div class="ld-in">
            <div class="ld-row" data-ld="modRow" hidden>
              <label class="ai-lbl" for="${p}-mod">${escHtml(t('ai.draft.mod'))}</label>
              <select class="form-input" id="${p}-mod" data-ld="mod"><option value="">${escHtml(t('ai.draft.modPick'))}</option></select>
            </div>
            <label class="ai-lbl" for="${p}-text" data-ld="textLabel">${escHtml(t('ai.draft.text'))}</label>
            <textarea class="form-input ld-ta" id="${p}-text" data-ld="text" rows="${mode === 'dialog' ? 5 : 6}" spellcheck="true" placeholder="${escAttr(t('ai.draft.textPh'))}">${escHtml(fieldText)}</textarea>
            <label class="ai-lbl" for="${p}-ctx">${escHtml(t('ai.draft.context'))}</label>
            <textarea class="form-input ld-ta" id="${p}-ctx" data-ld="context" rows="3" spellcheck="false" placeholder="${escAttr(t('ai.draft.contextPh'))}">${escHtml(o.context || '')}</textarea>
            <div class="ld-row ld-row--end"><button type="button" class="btn btn-ghost btn-sm" data-ld="useMods" hidden>${uiIcon('list', 14)}<span>${escHtml(t('ai.draft.useMods'))}</span></button></div>
            <label class="ai-lbl" for="${p}-instr">${escHtml(t('ai.draft.instr'))}</label>
            <input class="form-input" id="${p}-instr" data-ld="instr" maxlength="500" autocomplete="off" placeholder="${escAttr(t('ai.draft.instrPh'))}">
            <div class="ld-row">
              <label class="ai-lbl" for="${p}-lang">${escHtml(t('ai.draft.lang'))}</label>
              <select class="form-input ld-lang" id="${p}-lang" data-ld="lang">
                <option value="">${escHtml(t('ai.draft.langAuto'))}</option>
                <option value="en">${escHtml(t('ai.draft.langEn'))}</option>
                <option value="fr">${escHtml(t('ai.draft.langFr'))}</option>
              </select>
            </div>
            <details class="ai-more ld-adv"><summary>${escHtml(t('ai.draft.advanced'))}</summary>
              <div class="ld-advrow"><span class="ai-lbl">${escHtml(t('ai.draft.length'))}</span>${seg('length', ['short', 'medium', 'long'], 'medium')}</div>
              <div class="ld-advrow"><span class="ai-lbl">${escHtml(t('ai.draft.creativity'))}</span>${seg('creativity', ['precise', 'balanced', 'creative'], 'balanced')}</div>
            </details>
            <details class="ai-more ld-sent" data-ld="sentBox"><summary>${escHtml(t('ai.draft.sentTitle'))}</summary><div data-ld="sent"><p class="ai-muted">${escHtml(t('ai.draft.sentLoading'))}</p></div></details>
          </div>
          <div class="ld-outcol">
            <div class="ld-outbar">
              <div class="bms-tabs ld-tabs" role="tablist">
                <button type="button" class="bms-tab is-on" role="tab" aria-selected="true" data-ld-tab="result">${escHtml(t('ai.draft.tabResult'))}</button>
                <button type="button" class="bms-tab" role="tab" aria-selected="false" data-ld-tab="diff">${escHtml(t('ai.draft.tabDiff'))}</button>
              </div>
              <span class="ai-muted ld-status" data-ld="status" aria-live="polite"></span>
            </div>
            <div class="ld-out" data-ld="out" tabindex="0" role="region" aria-label="${escAttr(t('ai.draft.tabResult'))}"><span class="ld-empty">${escHtml(t('ai.draft.outEmpty'))}</span></div>
            <div class="ld-out ld-diff" data-ld="diff" tabindex="0" role="region" aria-label="${escAttr(t('ai.draft.tabDiff'))}" hidden></div>
            <div class="ld-outactions">
              <button type="button" class="btn btn-primary btn-sm" data-ld="go">${uiIcon('play', 14)}<span>${escHtml(t('ai.draft.generate'))}</span></button>
              <button type="button" class="btn btn-ghost btn-sm" data-ld="stop" hidden>${uiIcon('stop', 14)}<span>${escHtml(t('ai.draft.stop'))}</span></button>
              ${mode === 'pane' ? `<span class="ld-spacer"></span>
              <button type="button" class="btn btn-ghost btn-sm" data-ld="copy" disabled>${uiIcon('copy', 14)}<span>${escHtml(t('common.copy'))}</span></button>
              <button type="button" class="btn btn-ghost btn-sm" data-ld="reuse" disabled>${uiIcon('replace', 14)}<span>${escHtml(t('ai.draft.reuse'))}</span></button>
              <button type="button" class="btn btn-ghost btn-sm" data-ld="undo" hidden>${uiIcon('undo', 14)}<span>${escHtml(t('ai.draft.undo'))}</span></button>` : ''}
            </div>
          </div>
        </div>
      </div>`;
}

function wireTool(root: HTMLElement, o: DraftOptions, onSetup: () => void): Ctl {
    const $ = <T extends HTMLElement = HTMLElement>(k: string) => root.querySelector<T>(`[data-ld="${k}"]`);
    let preset: DraftPreset = (root.querySelector<HTMLElement>('[data-ld-preset].is-on')?.dataset.ldPreset as DraftPreset) || 'clarify';
    let length = 'medium';
    let creativity = 'balanced';
    let result = '';
    let running: string | null = null;
    let original = o.field ? o.field.value : '';
    let undoText: string | null = null;
    let mods: any[] | null = null;
    const text = $<HTMLTextAreaElement>('text')!;
    const ctx = $<HTMLTextAreaElement>('context')!;
    const instr = $<HTMLInputElement>('instr')!;
    const lang = $<HTMLSelectElement>('lang')!;
    const modSel = $<HTMLSelectElement>('mod');
    const out = $('out')!;
    const diff = $('diff')!;
    const status = (msg: string, tone: '' | 'ok' | 'err' = '') => { const s = $('status'); if (s) { s.textContent = msg; s.className = `ai-muted ld-status${tone ? ` ai-${tone}` : ''}`; } };

    const request = () => ({
        preset, text: text.value, context: ctx.value, modId: preset === 'describe_mod' ? (modSel?.value || o.modId || null) : null,
        instructions: instr.value, lang: lang.value, length, creativity,
    });

    const loadMods = async () => {
        if (mods) return mods;
        try { mods = (await invoke('get_mods')) as any[]; } catch { mods = []; }
        if (modSel && Array.isArray(mods)) {
            const sorted = [...mods].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            modSel.insertAdjacentHTML('beforeend', sorted.slice(0, 2000).map((m) => `<option value="${escAttr(String(m.id))}"${String(m.id) === o.modId ? ' selected' : ''}>${escHtml(String(m.name || m.id))}</option>`).join(''));
        }
        return mods;
    };

    const paintPreset = () => {
        root.querySelectorAll<HTMLButtonElement>('[data-ld-preset]').forEach((b) => { const on = b.dataset.ldPreset === preset; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
        const hint = $('presetHint'); if (hint) hint.textContent = t(`ai.draft.ph.${preset}`);
        const modRow = $('modRow');
        if (modRow) modRow.hidden = preset !== 'describe_mod';
        if (preset === 'describe_mod' && modRow && !modRow.hidden) void loadMods();
        const useMods = $('useMods'); if (useMods) useMods.hidden = preset !== 'summarize_list';
        const tl = $('textLabel'); if (tl) tl.textContent = t(preset === 'describe_mod' ? 'ai.draft.textCurrent' : PRESET_INPUT[preset] === 'context' ? 'ai.draft.textOptional' : 'ai.draft.text');
        schedulePreview();
    };

    // « What will be sent »: the exact messages, fetched while the box is open.
    let pvTimer = 0;
    const preview = async () => {
        const box = $<HTMLDetailsElement>('sentBox');
        const host = $('sent');
        if (!box?.open || !host) return;
        try {
            const r: any = await invoke('ai_draft_preview', { request: request() });
            const tg = r?.target || {};
            const b = r?.built || {};
            const where = tg.kind === 'local' ? t('ai.draft.goesLocal', { host: tg.host || '', model: tg.model || '' }) : t('ai.draft.goesExternal', { host: tg.host || '', model: tg.model || '' });
            const notes = [b.masked ? t('ai.draft.masked', { n: String(b.masked) }) : '', b.truncated ? t('ai.draft.cut') : ''].filter(Boolean);
            host.innerHTML = `<p class="ai-muted ld-where${tg.kind === 'local' ? ' ai-ok' : ''}"></p>${notes.map(() => '<p class="ai-muted ld-note"></p>').join('')}
                <p class="ai-lbl">${escHtml(t('ai.draft.sentSystem'))}</p><pre class="ld-pre" data-k="sys"></pre>
                <p class="ai-lbl">${escHtml(t('ai.draft.sentUser'))}</p><pre class="ld-pre" data-k="user"></pre>`;
            (host.querySelector('.ld-where') as HTMLElement).textContent = where;
            host.querySelectorAll<HTMLElement>('.ld-note').forEach((el, i) => { el.textContent = notes[i]; });
            (host.querySelector('[data-k="sys"]') as HTMLElement).textContent = String(b.system || '');
            (host.querySelector('[data-k="user"]') as HTMLElement).textContent = String(b.user || '');
        } catch (e) {
            host.innerHTML = `<p class="ai-muted ai-err"></p>`;
            (host.firstElementChild as HTMLElement).textContent = gateText(String((e as Error)?.message || e));
        }
    };
    const schedulePreview = () => { window.clearTimeout(pvTimer); pvTimer = window.setTimeout(() => void preview(), 350); };

    const showTab = (tab: 'result' | 'diff') => {
        root.querySelectorAll<HTMLButtonElement>('[data-ld-tab]').forEach((b) => { const on = b.dataset.ldTab === tab; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); });
        out.hidden = tab !== 'result';
        diff.hidden = tab !== 'diff';
        if (tab === 'diff') paintDiff();
    };
    const paintDiff = () => {
        const parts = wordDiff(original, result);
        diff.textContent = '';
        if (!result) { diff.innerHTML = `<span class="ld-empty">${escHtml(t('ai.draft.outEmpty'))}</span>`; return; }
        for (const part of parts) {
            const el = document.createElement(part.op === 'eq' ? 'span' : part.op === 'add' ? 'ins' : 'del');
            if (part.op !== 'eq') el.className = part.op === 'add' ? 'ld-add' : 'ld-del';
            el.textContent = part.text;
            diff.appendChild(el);
        }
        const st = diffStats(parts);
        const tab = root.querySelector<HTMLElement>('[data-ld-tab="diff"]');
        if (tab) tab.textContent = t('ai.draft.tabDiffN', { a: String(st.added), r: String(st.removed) });
    };

    const setBusy = (on: boolean) => {
        const go = $<HTMLButtonElement>('go'); const stop = $<HTMLButtonElement>('stop');
        if (go) { go.disabled = on; const l = go.querySelector('span'); if (l) l.textContent = t(result && !on ? 'ai.draft.again' : 'ai.draft.generate'); }
        if (stop) stop.hidden = !on;
        root.classList.toggle('is-busy', on);
        const has = !!result.trim() && !on;
        for (const k of ['copy', 'reuse']) { const b = $<HTMLButtonElement>(k); if (b) b.disabled = !has; }
        root.dispatchEvent(new CustomEvent('ld-state', { detail: { busy: on, has } }));
    };

    const generate = async () => {
        if (running) return;
        const req = request();
        const miss = missingInput(preset, req.text, req.context, !!req.modId, req.instructions);
        if (miss) { status(t(miss), 'err'); return; }
        const id = `d${Date.now().toString(36)}${(_seq++).toString(36)}`;
        running = id;
        result = '';
        original = preset === 'describe_mod' || PRESET_INPUT[preset] === 'text' ? text.value : (o.field ? o.field.value : text.value);
        out.textContent = '';
        out.classList.add('is-live');
        showTab('result');
        setBusy(true);
        status(t('ai.draft.writing'));
        const unlisten = await listen('ai-draft-chunk', (p: any) => {
            if (!p || p.id !== id) return;
            result += String(p.delta || '');
            out.textContent = result;
            out.scrollTop = out.scrollHeight;
        });
        try {
            const r: any = await invoke('ai_draft_stream', { requestId: id, request: req });
            if (r?.ok) {
                result = String(r.text ?? result);
                out.textContent = result || '';
                if (!result.trim()) status(t('ai.draft.emptyAnswer'), 'err');
                else status(r.cancelled ? t('ai.draft.stopped') : r.truncated ? t('ai.draft.truncated') : t('ai.draft.done'), r.cancelled ? '' : 'ok');
            } else {
                status(errorText(String(r?.error || 'unknown'), r?.detail), 'err');
            }
        } catch (e) {
            status(gateText(String((e as Error)?.message || e)), 'err');
        } finally {
            unlisten();
            running = null;
            out.classList.remove('is-live');
            if (!result) out.innerHTML = `<span class="ld-empty">${escHtml(t('ai.draft.outEmpty'))}</span>`;
            setBusy(false);
        }
    };
    const stop = () => { if (running) void invoke('ai_draft_cancel', { requestId: running }); };

    root.querySelectorAll<HTMLButtonElement>('[data-ld-preset]').forEach((b) => b.addEventListener('click', () => { preset = b.dataset.ldPreset as DraftPreset; paintPreset(); }));
    root.querySelectorAll<HTMLButtonElement>('[data-ld-length]').forEach((b) => b.addEventListener('click', () => {
        length = b.dataset.ldLength || 'medium';
        root.querySelectorAll<HTMLButtonElement>('[data-ld-length]').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
        schedulePreview();
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-ld-creativity]').forEach((b) => b.addEventListener('click', () => {
        creativity = b.dataset.ldCreativity || 'balanced';
        root.querySelectorAll<HTMLButtonElement>('[data-ld-creativity]').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
        schedulePreview();
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-ld-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.ldTab as 'result' | 'diff')));
    for (const el of [text, ctx, instr]) el.addEventListener('input', schedulePreview);
    lang.addEventListener('change', schedulePreview);
    modSel?.addEventListener('change', schedulePreview);
    $<HTMLDetailsElement>('sentBox')?.addEventListener('toggle', () => void preview());
    $('go')?.addEventListener('click', () => void generate());
    $('stop')?.addEventListener('click', stop);
    $('goSetup')?.addEventListener('click', onSetup);
    // Ctrl+Enter writes, from any field of the tool.
    root.addEventListener('keydown', (e) => { const k = e as KeyboardEvent; if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) { e.preventDefault(); void generate(); } });
    $('useMods')?.addEventListener('click', async () => {
        const list = await loadMods();
        const txt = modListText(list || []);
        if (!txt) { status(t('ai.draft.noMods'), 'err'); return; }
        ctx.value = txt;
        schedulePreview();
    });
    $('copy')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(result); status(t('ai.draft.copied'), 'ok'); } catch { status(t('ai.draft.copyFailed'), 'err'); }
    });
    $('reuse')?.addEventListener('click', () => {
        undoText = text.value;
        text.value = result;
        const u = $('undo'); if (u) u.hidden = false;
        status(t('ai.draft.reused'));
        schedulePreview();
    });
    $('undo')?.addEventListener('click', () => {
        if (undoText == null) return;
        text.value = undoText;
        undoText = null;
        const u = $('undo'); if (u) u.hidden = true;
        schedulePreview();
    });
    paintPreset();

    return {
        root,
        result: () => result,
        original: () => original,
        busy: () => !!running,
        stop,
        refresh: async () => {
            const v = await view(true);
            const gap = setupGap(v?.settings, v?.status);
            const tg = $('target'); if (tg) tg.innerHTML = writerChips(v?.settings || null);
            const setup = $('setup'); if (setup) setup.hidden = !gap;
            const g = $('gap'); if (g) g.textContent = gap ? t(gap) : '';
        },
    };
}

// ── The Laya dialog's « Drafting » tab ──────────────────────────────────────

let _pane: Ctl | null = null;

export async function mountDraftPane(host: HTMLElement): Promise<void> {
    ensureAiCss();
    let card = document.getElementById('laya-drafting-card');
    if (!card) {
        card = document.createElement('div');
        card.className = 'ai-card laya-pane-card';
        card.id = 'laya-drafting-card';
        host.appendChild(card);
    }
    const v = await view(true);
    const paint = () => {
        const s = v?.settings || null;
        const gap = setupGap(s, v?.status);
        (card as HTMLElement).innerHTML = `
          <header class="laya-page-h">
            <h3 class="card-title">${escHtml(t('ai.draft.paneTitle'))}</h3>
            <p class="ai-muted" id="ai-draft-summary">${escHtml(gap ? t(gap) : t('ai.draft.paneReady'))}</p>
          </header>
          ${markup(`ldp${_seq++}`, 'pane', { preset: 'describe_mod' }, s, v?.status)}`;
        _pane = wireTool((card as HTMLElement).querySelector('.ld') as HTMLElement, {}, () => openHub('providers'));
    };
    paint();
    if (!(card as any)._ldWired) {
        (card as any)._ldWired = true;
        // A save in Overview / Providers: the writer may have changed. Update the status only, so
        // what the user typed here stays.
        document.addEventListener('bmm:ai-card-rendered', () => {
            void _pane?.refresh().then(async () => {
                const vv = await view();
                const gap = setupGap(vv?.settings, vv?.status);
                const sum = document.getElementById('ai-draft-summary');
                if (sum) sum.textContent = gap ? t(gap) : t('ai.draft.paneReady');
            });
        });
        document.addEventListener('langChanged', () => { if (card?.isConnected && !_pane?.busy()) void view(true).then(() => paint()); });
    }
}

// ── One field ────────────────────────────────────────────────────────────────

/** Draft into one text field: preview, diff, Replace / Insert / Add at the end, then Undo next to it. */
export async function openDraft(o: DraftOptions): Promise<void> {
    ensureAiCss();
    const v = await view(true);
    const s = v?.settings || null;
    const field = o.field || null;
    let ctl: Ctl | null = null;
    let handle: ModalHandle | null = null;
    const cur = field?.value || '';
    const preset = o.preset || 'clarify';
    const mode0 = defaultMode(preset, cur);
    const modeOpt = (m: ApplyMode) => `<option value="${m}"${m === mode0 ? ' selected' : ''}>${escHtml(t(`ai.draft.mode.${m}`))}</option>`;
    handle = openModal({
        title: t('ai.draft.title'),
        subtitle: o.label ? t('ai.draft.for', { field: t(o.label) }) : t('ai.draft.lead'),
        icon: uiIcon('ai', 18),
        size: 'xl',
        tall: true,
        className: 'ld-modal',
        closeLabel: t('common.close'),
        body: markup(`ldd${_seq++}`, 'dialog', { ...o, preset }, s, v?.status),
        footer: field ? `<span class="ld-foot-note ai-muted" data-ld="foot"></span>
            <button type="button" class="btn btn-ghost" data-ld="cancel">${escHtml(t('common.cancel'))}</button>
            <select class="form-input ld-mode" data-ld="mode" aria-label="${escAttr(t('ai.draft.modeAria'))}">${(['replace', 'insert', 'append'] as ApplyMode[]).map(modeOpt).join('')}</select>
            <button type="button" class="btn btn-primary" data-ld="apply" disabled>${escHtml(t('ai.draft.apply'))}</button>`
            : `<button type="button" class="btn btn-ghost" data-ld="cancel">${escHtml(t('common.close'))}</button>`,
        initialFocus: '[data-ld="go"]',
        onClose: () => { ctl?.stop(); },
    });
    const root = handle.body.querySelector('.ld') as HTMLElement;
    ctl = wireTool(root, { ...o, preset }, () => { handle?.close(); openHub('providers'); });
    const apply = handle.q<HTMLButtonElement>('[data-ld="apply"]');
    root.addEventListener('ld-state', (e) => { if (apply) apply.disabled = !(e as CustomEvent).detail?.has; });
    handle.q('[data-ld="cancel"]')?.addEventListener('click', () => handle?.close());
    apply?.addEventListener('click', () => {
        if (!field || !ctl) return;
        const mode = (handle?.q<HTMLSelectElement>('[data-ld="mode"]')?.value || 'replace') as ApplyMode;
        const prev = field.value;
        const next = applyDraft(prev, ctl.result(), mode, field.selectionStart ?? -1, field.selectionEnd ?? -1);
        const clip = clipTo(next.value, field.maxLength);
        field.value = clip.value;
        // The field's owner listens for these, as if the user had typed.
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        handle?.close();
        try { field.focus(); field.setSelectionRange(Math.min(next.caret, clip.value.length), Math.min(next.caret, clip.value.length)); } catch { /* an input type without a selection */ }
        offerUndo(field, prev, clip.clipped);
    });
}

/** « Draft applied · Undo » under the field for a while. */
function offerUndo(field: Field, prev: string, clipped: boolean): void {
    const row = chipRow(field);
    const undo = row?.querySelector<HTMLButtonElement>('.ld-undo');
    const note = row?.querySelector<HTMLElement>('.ld-chipnote');
    if (!row || !undo) return;
    undo.hidden = false;
    if (note) { note.hidden = false; note.textContent = clipped ? t('ai.draft.appliedClipped') : t('ai.draft.applied'); }
    const applied = field.value;
    let timer = 0;
    const done = () => { undo.hidden = true; if (note) note.hidden = true; undo.onclick = null; window.clearTimeout(timer); };
    undo.onclick = () => {
        // Only while the field still holds the draft: Undo never throws away what was typed since.
        if (field.value === applied) {
            field.value = prev;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
        }
        done();
        field.focus();
    };
    timer = window.setTimeout(done, 30_000);
}

// ── « Draft with Laya » under some fields ───────────────────────────────────

interface Hook { sel: string; preset: DraftPreset; label: string }
const HOOKS: Hook[] = [
    { sel: '#mp-desc', preset: 'summarize_list', label: 'ai.draft.field.modpack' },
    { sel: '#cr-desc, #cr-description', preset: 'clarify', label: 'ai.draft.field.catalog' },
    { sel: '#fbm-desc', preset: 'clarify', label: 'ai.draft.field.feedback' },
    { sel: '#olmn-src', preset: 'summarize_list', label: 'ai.draft.field.orderNotes' },
    { sel: '#pc-desc', preset: 'clarify', label: 'ai.draft.field.plugin' },
];

function hookFor(el: Element): Hook | null {
    const attr = (el as HTMLElement).dataset?.layaDraft;
    if (attr !== undefined) return { sel: '', preset: (DRAFT_PRESETS as string[]).includes(attr) ? attr as DraftPreset : 'clarify', label: (el as HTMLElement).dataset.layaDraftLabel || '' };
    return HOOKS.find((h) => el.matches(h.sel)) || null;
}

function chipRow(field: Field): HTMLElement | null {
    const next = field.nextElementSibling as HTMLElement | null;
    return next?.classList.contains('ld-chiprow') ? next : null;
}

let _hooked = false;
/** Once, at boot: a focused description field gets its « Draft with Laya » button when a writer is set up. */
export function installDraftHooks(): void {
    if (_hooked || typeof document === 'undefined') return;
    _hooked = true;
    document.addEventListener('focusin', (e) => {
        const el = e.target as Field | null;
        if (!el || !(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) || el.readOnly || el.disabled) return;
        if (el.closest('.ld')) return;
        const hook = hookFor(el);
        if (!hook || chipRow(el)) return;
        void view().then((v) => {
            if (setupGap(v?.settings, v?.status) || chipRow(el) || !el.isConnected) return;
            ensureAiCss();
            const row = document.createElement('div');
            row.className = 'ld-chiprow';
            row.innerHTML = `<button type="button" class="ld-chip">${uiIcon('ai', 14)}<span>${escHtml(t('ai.draft.chip'))}</span></button>
                <span class="ai-muted ld-chipnote" hidden></span>
                <button type="button" class="ld-chip ld-undo" hidden>${uiIcon('undo', 14)}<span>${escHtml(t('ai.draft.undo'))}</span></button>`;
            el.insertAdjacentElement('afterend', row);
            row.querySelector('.ld-chip:not(.ld-undo)')?.addEventListener('click', () => void openDraft({ field: el, preset: hook.preset, label: hook.label || undefined }));
        });
    });
}
