// ai-ask.ts — « Ask Laya »: a question box that answers from what EXISTS in BMM.
//
// Opened from the command palette (Ctrl+K → « Ask Laya »), the docs hub and the library search.
// The question goes to Rust (`ai_ask`, commands/ask_core.rs), which searches BMM's own
// documentation, the palette's commands, the Settings cards this page sends along, the user's
// mods, profiles and their scanned FILE lists — and, when the AI switch is on and the built-in
// model is installed, lets Laya route the question and rank the top candidates.
//
// What comes back is a list of things, never prose: a doc section quoted with its « Open »,
// a setting to go to, a command to run, the mods (and the files) that answer « which mod
// modifies engine.ogg? », the pairs of mods that provide the same files. Offline, always.
import { invoke } from '../../core/api.js';
import { noteAskClick } from '../../core/laya-telemetry.js';
import { t, getLang } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { groupHits, topPick, rankedModIds, type AskAnswer, type AskHit } from './ai-model.js';
import { ensureAiCss, loadAiView, offerInstall, installPromptHtml, wireInstallPrompt, reasonText } from './ai-shared.js';
import { installFocusTrap, ownsFocus } from '../../ui/focus-trap.js';

let _overlay: HTMLElement | null = null;
let _opener: HTMLElement | null = null;
let _seq = 0;

const IC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>';

function overlay(): HTMLElement {
    if (_overlay && _overlay.isConnected) return _overlay;
    const o = document.createElement('div');
    o.className = 'modal-overlay ai-overlay';
    o.id = 'modal-ai-ask';
    (document.getElementById('app-window-outer') || document.body).appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && o.classList.contains('open') && ownsFocus(o)) close(); });
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

/** The Settings cards, as index entries: their title and their visible labels. */
function settingsEntries(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    document.querySelectorAll<HTMLElement>('#view-settings .settings-sections > .glass-card').forEach((card, i) => {
        const title = (card.querySelector('.card-title')?.textContent || '').replace(/\s+/g, ' ').trim();
        if (!title) return;
        const text = (card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 900);
        out.push({ k: 'setting', lang: getLang() === 'fr' ? 'fr' : 'en', id: `setting:${card.id || i}`, t: title, x: text, kw: 'setting settings reglage parametre', a: { setting: card.id || String(i) } });
    });
    return out;
}

/** Do what a result points at. */
export function runAskAction(a: any): void {
    const w = window as any;
    if (!a) return;
    noteAskClick(a);   // telemetry, Laya category: the result's KIND only
    if (a.page) { w.openDocsPage?.(String(a.page), a.anchor ? String(a.anchor) : undefined); return; }
    if (a.article) { w.openDocsArticleById?.(String(a.article)); return; }
    if (a.command) { document.dispatchEvent(new CustomEvent('bmm:command:run', { detail: { id: String(a.command) } })); return; }
    if (a.mod) { document.dispatchEvent(new CustomEvent('bmm:search:open-mod', { detail: { id: String(a.mod), name: String(a.name || '') } })); return; }
    if (a.profile) { document.dispatchEvent(new CustomEvent('bmm:search:open-profile', { detail: { id: String(a.profile) } })); return; }
    if (a.setting != null) {
        (document.querySelector('.nav-item[data-view="settings"]') as HTMLElement | null)?.click();
        const id = String(a.setting);
        setTimeout(() => {
            const card = document.getElementById(id) || document.querySelectorAll<HTMLElement>('#view-settings .settings-sections > .glass-card')[Number(id)];
            card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 80);
    }
}

function actionLabel(kind: string): string {
    switch (kind) {
        case 'command': return t('ai.ask.run');
        case 'setting': return t('ai.ask.goto');
        case 'mod': return t('ai.ask.openMod');
        default: return t('ai.ask.open');
    }
}

function groupLabel(kind: string): string {
    switch (kind) {
        case 'doc': return t('ai.ask.gDoc');
        case 'setting': return t('ai.ask.gSetting');
        case 'command': return t('ai.ask.gCommand');
        case 'mod': return t('ai.ask.gMod');
        case 'profile': return t('ai.ask.gProfile');
        default: return kind;
    }
}

function intentLabel(intent: string): string {
    switch (intent) {
        case 'docs': return t('ai.ask.iDocs');
        case 'setting': return t('ai.ask.iSetting');
        case 'files': return t('ai.ask.iFiles');
        case 'conflicts': return t('ai.ask.iConflicts');
        case 'mods': return t('ai.ask.iMods');
        case 'command': return t('ai.ask.iCommand');
        default: return intent;
    }
}

function offText(why: string): string {
    switch (why) {
        case 'ai_off': return t('ai.ask.offAi');
        case 'no_model': return t('ai.ask.offModel');
        case 'killed': return t('ai.reason.killed');
        case 'feature_off': return t('ai.ask.offFeature');
        default: return '';
    }
}

export async function openAskLaya(question = ''): Promise<void> {
    ensureAiCss();
    const o = overlay();
    _opener = document.activeElement as HTMLElement | null;
    const view = await loadAiView();
    const vs = view?.settings;
    // « Rédiger une réponse » is offered only when the user set up a generator and allowed it here.
    const canWrite = !!vs?.enabled && !view?.status?.killSwitch && (vs.generative === 'local' || vs.generative === 'external') && !!vs.ask_generate;
    let hits: AskHit[] = [];
    let lastReq: any = null;
    o.innerHTML = `
      <div class="modal bms modal--lg ai-modal ai-ask" role="dialog" aria-modal="true" aria-labelledby="aia-title">
        <div class="modal-header">
          <div class="bms-icon" aria-hidden="true">${IC}</div>
            <h2 class="modal-title" id="aia-title">${escHtml(t('ai.ask.title'))}</h2>
          <button type="button" class="modal-close" id="aia-close" aria-label="${escAttr(t('common.close'))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="modal-body ai-body">
          <p class="ai-lead">${escHtml(t('ai.ask.lead'))}</p>
          <form class="ai-ask-form" id="aia-form">
            <input id="aia-q" class="form-input" type="search" maxlength="300" autocomplete="off" spellcheck="false"
              placeholder="${escAttr(t('ai.ask.placeholder'))}" aria-label="${escAttr(t('ai.ask.title'))}" value="${escAttr(question)}">
            <button type="submit" class="btn btn-primary btn-sm">${escHtml(t('ai.ask.go'))}</button>
          </form>
          <div id="aia-out" aria-live="polite"></div>
        </div>
        <div class="modal-footer ai-foot"><span class="ai-muted">${escHtml(canWrite && vs?.generative === 'external' ? t('ai.ask2.footRemote') : t('ai.ask.offline'))}</span></div>
      </div>`;
    o.classList.add('open');
    const input = o.querySelector<HTMLInputElement>('#aia-q');
    const out = o.querySelector<HTMLElement>('#aia-out');
    o.querySelector('#aia-close')?.addEventListener('click', close);
    input?.focus();

    const paint = (a: AskAnswer, layaOff: string) => {
        if (!out) return;
        hits = a.hits || [];
        const top = topPick(a);
        const hitHtml = (h: AskHit, i: number) => `
          <div class="ai-ask-hit" role="listitem">
            <div class="ai-ask-hit-main">
              <div class="ai-ask-hit-title">${escHtml(h.title)}</div>
              ${h.snippet ? `<div class="ai-ask-snip">${escHtml(h.snippet)}</div>` : ''}
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-hit="${i}">${escHtml(actionLabel(h.kind))}</button>
          </div>`;
        const files = (a.files || []).map((f) => `
          <div class="ai-ask-hit" role="listitem">
            <div class="ai-ask-hit-main">
              <div class="ai-ask-hit-title">${escHtml(f.mod_name)} ${f.enabled ? `<span class="ai-pill ai-pill-on">${escHtml(t('ai.ask.enabled'))}</span>` : ''}</div>
              <ul class="ai-ask-files">${f.files.slice(0, 6).map((x) => `<li><code>${escHtml(x)}</code></li>`).join('')}${f.total > 6 ? `<li class="ai-muted">${escHtml(t('ai.ask.more', { n: String(f.total - 6) }))}</li>` : ''}</ul>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-mod="${escAttr(f.mod_id)}" data-name="${escAttr(f.mod_name)}">${escHtml(t('ai.ask.openMod'))}</button>
          </div>`).join('');
        const conflicts = (a.conflicts || []).map((c) => `
          <div class="ai-ask-hit" role="listitem">
            <div class="ai-ask-hit-main">
              <div class="ai-ask-hit-title">${escHtml(c.a_name)} ↔ ${escHtml(c.b_name)}
                <span class="ai-muted">${escHtml(t('ai.ask.nFiles', { n: String(c.count) }))}</span>
                ${c.both_enabled ? `<span class="ai-pill ai-pill-on">${escHtml(t('ai.ask.bothOn'))}</span>` : ''}</div>
              <ul class="ai-ask-files">${c.sample.slice(0, 3).map((x) => `<li><code>${escHtml(x)}</code></li>`).join('')}</ul>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-mod="${escAttr(c.a_id)}" data-name="${escAttr(c.a_name)}">${escHtml(t('ai.ask.openMod'))}</button>
          </div>`).join('');
        const groups = groupHits(a).map((g) => `
          <div class="ai-sub">${escHtml(groupLabel(g.kind))}</div>
          <div class="ai-ask-list" role="list">${g.hits.map((h) => hitHtml(h, hits.indexOf(h))).join('')}</div>`).join('');
        const empty = !hits.length && !(a.files || []).length && !(a.conflicts || []).length;
        const off = offText(layaOff);
        out.innerHTML = `
          <div class="ai-ask-meta">
            <span class="ai-pill">${escHtml(intentLabel(a.intent))}</span>
            <span class="ai-muted">${escHtml(a.laya ? t('ai.ask.byLaya') : t('ai.ask.byRules'))} · ${escHtml(String(a.ms))} ms</span>
            ${canWrite && !empty ? `<button type="button" class="btn btn-ghost btn-sm ai-ask-write" id="aia-write">${IC}<span>${escHtml(t('ai.ask2.write'))}</span></button>` : ''}
          </div>
          <div id="aia-written" aria-live="polite"></div>
          ${off ? `<div class="ai-muted">${escHtml(off)}</div>` : ''}
          ${layaOff === 'no_model' && offerInstall(view) ? installPromptHtml(view) : ''}
          ${a.low_confidence ? `<div class="ai-warn">${escHtml(t('ai.ask.low'))}</div>` : ''}
          ${top ? `<div class="ai-sub">${escHtml(t('ai.ask.best'))}</div><div class="ai-ask-list ai-ask-top" role="list">${hitHtml(top, hits.indexOf(top))}</div>` : ''}
          ${files ? `<div class="ai-sub">${escHtml(t('ai.ask.files'))}</div><div class="ai-ask-list" role="list">${files}</div>` : ''}
          ${conflicts ? `<div class="ai-sub">${escHtml(t('ai.ask.conflicts'))}</div><div class="ai-ask-list" role="list">${conflicts}</div>` : ''}
          ${groups}
          ${empty ? `<div class="ai-empty">${escHtml(t('ai.ask.none'))}</div>` : ''}`;
        out.querySelectorAll<HTMLButtonElement>('[data-hit]').forEach((b) => b.addEventListener('click', () => { const h = hits[Number(b.dataset.hit)]; close(); runAskAction(h?.action); }));
        out.querySelectorAll<HTMLButtonElement>('[data-mod]').forEach((b) => b.addEventListener('click', () => { close(); runAskAction({ mod: b.dataset.mod, name: b.dataset.name }); }));
        wireInstallPrompt(out, () => { void ask(); });
        out.querySelector('#aia-write')?.addEventListener('click', () => void write());
    };

    /** The written answer: the generator's wording of the sources found, each sentence cited. */
    const write = async () => {
        const box = out?.querySelector<HTMLElement>('#aia-written');
        const btn = out?.querySelector<HTMLButtonElement>('#aia-write');
        if (!box || !lastReq) return;
        if (btn) btn.disabled = true;
        const ticket = _seq;
        box.innerHTML = `<div class="ai-loading"><span class="ai-dot"></span>${escHtml(t('ai.ask2.writing'))}</div>`;
        try {
            const r: any = await invoke('ai_ask_written', { request: lastReq });
            if (ticket !== _seq || !o.classList.contains('open')) return;
            const w = r?.written;
            if (!w) {
                box.innerHTML = `<div class="ai-muted ai-ask-nowrite">${escHtml(t('ai.ask2.none'))} ${escHtml(reasonText(String(r?.writtenOff || '')))}</div>`;
                return;
            }
            const cites: any[] = Array.isArray(w.cites) ? w.cites : [];
            const byN = new Map<number, any>(cites.map((c) => [Number(c.n), c]));
            // Escaped first; only « [n] » of a REAL source becomes a link.
            const text = escHtml(String(w.text || '')).replace(/\[(\d{1,2})\]/g, (m, n) => byN.has(Number(n)) ? `<button type="button" class="ai-cite" data-cite="${Number(n)}" title="${escAttr(String(byN.get(Number(n))?.title || ''))}">${Number(n)}</button>` : '');
            const who = w.provider === 'local' ? t('ai.ask2.byLocal', { model: String(w.model || '') }) : t('ai.ask2.byRemote', { model: String(w.model || '') });
            box.innerHTML = `
              <div class="ai-ask-written">
                <div class="ai-ask-wtext">${text}</div>
                <div class="ai-muted ai-ask-wmeta"><span class="ai-src ai-src-draft">${escHtml(t('ai.ask2.badge'))}</span> ${escHtml(who)}${w.laya != null ? ` · ${escHtml(t('ai.ask2.checked', { p: String(Math.round(Number(w.laya) * 100)) }))}` : ''}</div>
                <ol class="ai-ask-cites">${cites.map((c) => `<li value="${Number(c.n)}"><button type="button" class="ai-link" data-cite="${Number(c.n)}">${escHtml(String(c.title || ''))}</button></li>`).join('')}</ol>
              </div>`;
            box.querySelectorAll<HTMLButtonElement>('[data-cite]').forEach((b) => b.addEventListener('click', () => {
                const c = byN.get(Number(b.dataset.cite));
                if (!c) return;
                close();
                runAskAction(c.action);
            }));
        } catch (e) {
            box.innerHTML = `<div class="ai-error">${escHtml(reasonText(String((e as Error)?.message || e)))}</div>`;
        } finally {
            if (btn) btn.disabled = false;
        }
    };

    const ask = async () => {
        const q = (input?.value || '').trim();
        if (!q || !out) return;
        const ticket = ++_seq;
        out.innerHTML = `<div class="ai-loading"><span class="ai-dot"></span>${escHtml(t('ai.ask.loading'))}</div>`;
        try {
            lastReq = { question: q, lang: getLang() === 'fr' ? 'fr' : 'en', scope: 'all', limit: 10, extra: settingsEntries() };
            const r: any = await invoke('ai_ask', { request: lastReq });
            if (ticket !== _seq || !o.classList.contains('open')) return;
            paint(r.answer as AskAnswer, String(r.layaOff || ''));
        } catch (e) {
            if (ticket === _seq && out) out.innerHTML = `<div class="ai-error">${escHtml(String((e as Error)?.message || e))}</div>`;
        }
    };
    o.querySelector('#aia-form')?.addEventListener('submit', (e) => { e.preventDefault(); void ask(); });
    if (question) void ask();
}

/** Library search « smart » ranking: the ids of the mods that answer `query`, best first. */
export async function smartRankMods(query: string): Promise<string[] | null> {
    const q = query.trim();
    if (q.length < 2) return null;
    try {
        const r: any = await invoke('ai_ask', { request: { question: q, lang: getLang() === 'fr' ? 'fr' : 'en', scope: 'mods', limit: 30, extra: [] } });
        return rankedModIds(r?.answer);
    } catch { return null; }
}

const SMART_KEY = 'bmm.ai.smartSearch';

/**
 * The « smart » toggle beside the library's search box. Off (default): the box filters by name
 * and tag name, as always. On: the query is also matched against descriptions and tags by the
 * offline index (and ranked by Laya when AI is on), and the list follows that order.
 */
export function mountSmartSearch(input: HTMLInputElement, rerender: () => void): void {
    const box = input.closest('.search-box') || input.parentElement;
    if (!box || box.querySelector('.ai-smart-toggle')) return;
    ensureAiCss();
    let on = false;
    try { on = localStorage.getItem(SMART_KEY) === '1'; } catch { /* private mode */ }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ai-smart-toggle';
    b.innerHTML = IC;
    const label = () => { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.title = (on ? t('ai.ask.smartOn') : t('ai.ask.smartOff')); b.setAttribute('aria-label', t('ai.ask.smart')); };
    label();
    box.appendChild(b);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seq = 0;
    const run = () => {
        if (timer) clearTimeout(timer);
        const q = input.value.toLowerCase();
        void import('./ai-smart-state.js').then(async (st) => {
            if (!on || q.trim().length < 2) { st.setSmartRank(null, ''); rerender(); return; }
            timer = setTimeout(async () => {
                const ticket = ++seq;
                const ids = await smartRankMods(q);
                if (ticket !== seq || input.value.toLowerCase() !== q) return;
                st.setSmartRank(ids, q);
                rerender();
            }, 250);
        });
    };
    b.addEventListener('click', () => {
        on = !on;
        try { localStorage.setItem(SMART_KEY, on ? '1' : '0'); } catch { /* private mode */ }
        label();
        run();
    });
    input.addEventListener('input', run);
    // A QUESTION typed in the library search (« which mod adds the F-16 sounds? ») + Enter opens
    // « Ask Laya » on it: the answer can be a file, a conflict or a doc page, not only a mod.
    input.addEventListener('keydown', (e) => {
        const q = input.value.trim();
        if (e.key !== 'Enter' || !(q.includes('?') || q.split(/\s+/).length >= 4)) return;
        e.preventDefault();
        void openAskLaya(q);
    });
}
