// ai-settings.ts — the "AI (optional)" card in Settings.
//
// Built here and slotted in after the Privacy card, because index.html is not this feature's
// file. Off by default; the master switch off means no AI network call anywhere (enforced in
// Rust, commands/ai_core.rs — this card only edits the settings and explains them).
//
// Keys are write-only from here: the field sends a key to `ai_set_secret` and is emptied; the
// card only ever learns WHERE a key is stored (DPAPI / keyring / this session only), never
// the key.
import { invoke, listen, askConfirm } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { fmtBytes, embState, fmtSpeed, fmtEta, parseNoSpace, type AiSettings, type EmbLive, type EmbState } from './ai-model.js';
import { ensureAiCss, loadAiView, reasonText, bcAuthArgs, openAiDocs, type AiView } from './ai-shared.js';
import { initCollapsibleSettingsCards } from '../../ui/settings-fold.js';

// Lives in the « Laya » dialog (laya-hub.ts); Settings keeps one summary card.
const CARD_ID = 'laya-general-card';

const IC = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>';
/** A book: the « How AI works in BMM » link-button. */
const DOC_IC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>';

/**
 * The « Laya intégré » box. ONE state at a time (ai-model.ts `embState`): absent → downloading
 * (speed, time left, mirror, Pause / Cancel) → verifying → unpacking → installed / loaded; a
 * partial download offers Resume; a pack from an older pin offers Update; not enough disk says
 * so before anything is fetched; an error keeps Retry and Open folder next to its reason.
 */
let _live: EmbLive = {};
let _prog: any = null;

function embState0(st: any): EmbState {
    return embState(st?.embedded || {}, _live, !!st?.killSwitch);
}

function embeddedHtml(st: any): string {
    const e = st?.embedded || {};
    const state = embState0(st);
    const host = (() => { try { return new URL(String((e.mirrors || [])[0] || 'https://github.com')).host; } catch { return 'github.com'; } })();
    const on = state === 'installed' || state === 'loaded';
    const pillText: Record<EmbState, string> = {
        killed: t('ai.emb.stKilled'), absent: t('ai.emb.absent'), partial: t('ai.emb.stPaused'), outdated: t('ai.emb.stOutdated'),
        no_space: t('ai.emb.stNoSpace'), downloading: t('ai.emb.stDownloading'), verifying: t('ai.emb.stVerifying'),
        unpacking: t('ai.emb.stUnpacking'), installed: t('ai.emb.installed'), loaded: t('ai.emb.stLoaded'), error: t('ai.emb.stError'),
    };
    const pill = `<span class="ai-pill${on ? ' ai-pill-on' : ''}" id="ai-emb-pill" data-state="${escAttr(state)}">${escHtml(pillText[state])}</span>`;
    const size = fmtBytes(e.downloadBytes);
    const disk = e.freeBytes != null ? t('ai.emb.disk', { need: fmtBytes(e.neededBytes), free: fmtBytes(e.freeBytes) }) : t('ai.emb.diskNeed', { need: fmtBytes(e.neededBytes) });
    const lines: string[] = [];
    const btn = (id: string, label: string, primary = false) => `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-ghost'} btn-sm" id="${id}">${escHtml(label)}</button>`;
    const buttons: string[] = [];
    switch (state) {
        case 'killed':
            lines.push(t('ai.settings.killedNote'));
            break;
        case 'absent':
            lines.push(t('ai.emb.installHint', { host }), disk);
            buttons.push(btn('ai-emb-install', t('ai.emb.install', { size }), true));
            break;
        case 'partial':
            lines.push(t('ai.emb.resume', { got: fmtBytes(e.partialBytes) }), disk);
            buttons.push(btn('ai-emb-install', t('ai.emb.resumeBtn'), true), btn('ai-emb-discard', t('ai.emb.discard')));
            break;
        case 'outdated':
            lines.push(t('ai.emb.outdatedHint', { size }), disk);
            buttons.push(btn('ai-emb-install', t('ai.emb.update', { size }), true));
            break;
        case 'no_space':
            lines.push(t('ai.emb.noSpace', { need: fmtBytes(e.neededBytes), free: fmtBytes(e.freeBytes) }));
            buttons.push(btn('ai-emb-recheck', t('ai.emb.recheck')), btn('ai-emb-folder', t('ai.emb.openFolder')));
            break;
        case 'downloading':
        case 'verifying':
        case 'unpacking':
            buttons.push(state === 'downloading' ? btn('ai-emb-pause', t('ai.emb.pause')) : '', btn('ai-emb-cancel', t('common.cancel')));
            break;
        case 'error':
            lines.push(_live.error || '');
            buttons.push(btn('ai-emb-install', t('ai.emb.retry'), true), btn('ai-emb-folder', t('ai.emb.openFolder')));
            break;
        case 'installed':
        case 'loaded':
            lines.push(t('ai.emb.where', { size: fmtBytes(e.sizeBytes), dir: String(e.dir || '') }) + ' · ' + (e.source === 'install' ? t('ai.emb.fromInstaller') : t('ai.emb.fromUser')));
            if (state === 'loaded') lines.push(t('ai.emb.loaded'));
            buttons.push(btn('ai-emb-test', t('ai.emb.test'), true), btn('ai-emb-folder', t('ai.emb.openFolder')));
            if (e.removable) buttons.push(btn('ai-emb-remove', t('ai.emb.remove')));
            break;
    }
    const busy = state === 'downloading' || state === 'verifying' || state === 'unpacking';
    return `
      <div class="ai-block" id="ai-emb-block" data-state="${escAttr(state)}">
        <div class="ai-sub">${escHtml(t('ai.emb.title'))} ${pill}</div>
        ${lines.filter(Boolean).map((l) => `<div class="ai-muted${state === 'error' || state === 'no_space' ? ' ai-err' : ''}">${escHtml(l)}</div>`).join('')}
        <progress id="ai-emb-progress" max="1" value="0" ${busy ? '' : 'hidden'}></progress>
        <div class="ai-muted ai-emb-live" id="ai-emb-live" aria-live="polite" ${busy ? '' : 'hidden'}></div>
        <div class="ai-actions">${buttons.join('')}<span class="ai-muted" id="ai-emb-status" aria-live="polite"></span></div>
      </div>`;
}

/** The live line under the bar: « 120 MB / 327 MB · 8 MB/s · 0:26 left · github.com ». */
function liveText(p: any): string {
    if (!p) return '';
    if (p.phase === 'verify') return t('ai.emb.checking');
    if (p.phase === 'unpack') return t('ai.emb.unpacking');
    const parts = [t('ai.emb.progress', { got: fmtBytes(p.received), total: fmtBytes(p.total) })];
    const sp = fmtSpeed(p.bytesPerSec);
    if (sp) parts.push(sp);
    const eta = fmtEta(p.etaSecs);
    if (eta) parts.push(t('ai.emb.eta', { eta }));
    if (p.host) parts.push(p.mirror > 0 ? t('ai.emb.mirror', { host: p.host }) : p.host);
    return parts.join(' · ');
}

function keyWhere(where: string): string {
    switch (where) {
        case 'dpapi': return t('ai.key.dpapi');
        case 'keyring': return t('ai.key.keyring');
        case 'memory': return t('ai.key.memory');
        default: return t('ai.key.none');
    }
}

/** Put the card (once) in `host` — a pane of the Laya dialog — then fill it. */
export async function mountAiSettings(host: HTMLElement): Promise<void> {
    ensureAiCss();
    let card = document.getElementById(CARD_ID);
    if (!card) {
        card = document.createElement('div');
        card.className = 'ai-card laya-pane-card';
        card.id = CARD_ID;
        host.appendChild(card);
    }
    const view = await loadAiView();
    render(card, view);
    if (!(card as any)._aiLangWired) {
        (card as any)._aiLangWired = true;
        document.addEventListener('langChanged', () => { if (card?.isConnected) void loadAiView().then((v) => render(card as HTMLElement, v)); });
    }
}

/** « Classement : Laya intégré · Rédaction : locale · Rien ne quitte ce PC » — the card's one-line status. */
function classifierName(c: string): string {
    switch (c) {
        case 'embedded': return t('ai.set2.clsEmbedded');
        case 'local': return t('ai.set2.clsLocal');
        case 'bettercommunity': return t('ai.set2.clsBc');
        default: return t('ai.set2.none');
    }
}
function generatorName(g: string): string {
    switch (g) {
        case 'local': return t('ai.set2.genLocal');
        case 'external': return t('ai.set2.genExternal');
        default: return t('ai.set2.none');
    }
}
export function statusLine(s: AiSettings, st: any): string {
    if (st?.killSwitch) return t('ai.set2.stKilled');
    if (!s.enabled) return t('ai.set2.stOff');
    const parts = [t('ai.set2.stCls', { v: classifierName(s.classifier) }), t('ai.set2.stGen', { v: generatorName(s.generative) })];
    parts.push(st?.offline ? t('ai.set2.stOffline') : t('ai.set2.stOnline'));
    return parts.join(' · ');
}

/** One feature toggle: a short label and a one-line hint. */
function toggle(id: string, on: boolean, label: string, hint: string, disabled = false): string {
    return `<label class="ai-toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span><b>${escHtml(label)}</b><small>${escHtml(hint)}</small></span></label>`;
}

function render(card: HTMLElement, view: AiView | null): void {
    const s: AiSettings | null = view?.settings || null;
    const st = view?.status || {};
    if (!s) {
        card.innerHTML = `<h3 class="card-title ai-card-title">${IC}<span>${escHtml(t('ai.settings.title'))}</span></h3><p class="ai-muted">${escHtml(t('ai.settings.unavailable'))}</p>`;
        refold();
        return;
    }
    const killed = !!st.killSwitch;
    const on = !!s.enabled && !killed;
    const pill = killed ? t('ai.settings.pillKilled') : on ? t('ai.settings.pillOn') : t('ai.settings.pillOff');
    const opt = (v: string, cur: string, label: string) => `<option value="${escAttr(v)}"${v === cur ? ' selected' : ''}>${escHtml(label)}</option>`;
    const cls = s.classifier || 'off';
    const gen = s.generative || 'off';
    // The overview's chips: the model, and what leaves this PC (the same rule as the status line).
    const emb = embState0(st);
    const modelOn = emb === 'installed' || emb === 'loaded';
    const modelWord = modelOn ? (emb === 'loaded' ? t('ai.emb.stLoaded') : t('ai.emb.installed')) : t('ai.emb.absent');
    const leaves = on && !st?.offline;
    const heroTitle = killed ? t('ai.hub2.heroKilled') : on ? t('ai.hub2.heroOn') : t('ai.hub2.heroOff');
    // A setup that is not the default (another engine, a writing model) is shown open: hiding
    // what is in use would be the wrong kind of simple.
    const custom = (cls !== 'embedded' && cls !== 'off') || gen !== 'off';
    card.innerHTML = `
      <section class="laya-hero${on ? ' is-on' : ''}" aria-labelledby="ai-hero-title">
        <div class="laya-hero-main">
          <div class="laya-hero-ic" aria-hidden="true">${IC}</div>
          <div class="laya-hero-text">
            <h3 class="laya-hero-title" id="ai-hero-title">${escHtml(heroTitle)}</h3>
            <div class="ai-statusline" id="ai-statusline">${escHtml(statusLine(s, st))}</div>
          </div>
          <label class="bmm-switch laya-hero-switch" title="${escAttr(t('ai.set2.master'))}">
            <input type="checkbox" id="ai-enabled" ${s.enabled ? 'checked' : ''} ${killed ? 'disabled' : ''} aria-label="${escAttr(t('ai.set2.master'))}" aria-describedby="ai-hero-hint">
            <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
          </label>
        </div>
        <div class="laya-hero-chips">
          <span class="ai-pill${on ? ' ai-pill-on' : ''}" id="ai-pill" hidden>${escHtml(pill)}</span>
          <span class="bms-chip${modelOn ? ' bms-chip--ok' : ''}"><span class="bms-dot"></span>${escHtml(t('ai.hub2.model', { state: modelWord }))}</span>
          <span class="bms-chip${on ? (leaves ? ' bms-chip--warn' : ' bms-chip--ok') : ''}"><span class="bms-dot"></span>${escHtml(on ? (leaves ? t('ai.hub2.mayLeave') : t('ai.hub2.private')) : t('ai.hub2.nothingSent'))}</span>
        </div>
        <p class="laya-hero-hint" id="ai-hero-hint">${escHtml(t('ai.set2.masterHint'))}</p>
        ${killed ? `<div class="ai-warn">${escHtml(t('ai.settings.killedNote'))}</div>` : ''}
      </section>
      <div class="ai-settings-body${s.enabled ? '' : ' is-off'}" id="ai-body">
        <section class="laya-sec" aria-labelledby="ai-does-h">
          <header class="laya-sec-h">
            <h4 class="laya-sec-title" id="ai-does-h">${escHtml(t('ai.hub2.doesTitle'))}</h4>
            <p class="laya-sec-lead">${escHtml(t('ai.hub2.doesLead'))}</p>
          </header>
          <div class="ai-toggles">
            ${toggle('ai-f-mod', s.mod_suggest, t('ai.set2.fMod'), t('ai.set2.fModHint'))}
            ${toggle('ai-f-report', s.report_triage, t('ai.set2.fReport'), t('ai.set2.fReportHint'))}
            ${toggle('ai-f-ask', s.ask !== false, t('ai.set2.fAsk'), t('ai.set2.fAskHint'))}
            ${toggle('ai-f-draft', s.description_drafts, t('ai.set2.fDraft'), t('ai.set2.fDraftHint'))}
            ${toggle('ai-f-askgen', !!s.ask_generate, t('ai.set2.fAskGen'), t('ai.set2.fAskGenHint'))}
          </div>
        </section>
        <section class="laya-sec" aria-labelledby="ai-where-h">
          <header class="laya-sec-h">
            <h4 class="laya-sec-title" id="ai-where-h">${escHtml(t('ai.hub2.whereTitle'))}</h4>
            <p class="laya-sec-lead">${escHtml(t('ai.hub2.whereLead'))}</p>
          </header>
          <div id="ai-emb-wrap" ${cls === 'embedded' || cls === 'off' ? '' : 'hidden'}>${embeddedHtml(st)}</div>
          <details class="ai-more laya-adv" id="ai-adv"${custom ? ' open' : ''}>
            <summary>${escHtml(t('ai.hub2.advanced'))}</summary>
            <div class="ai-prov">
              <div class="ai-grid">
                <label class="ai-lbl" for="ai-classifier">${escHtml(t('ai.set2.cls'))}</label>
                <select id="ai-classifier" class="form-input">
                  ${opt('embedded', cls, t('ai.set2.clsEmbedded'))}
                  ${opt('local', cls, t('ai.set2.clsLocal'))}
                  ${opt('bettercommunity', cls, t('ai.set2.clsBc'))}
                  ${opt('off', cls, t('ai.set2.clsOff'))}
                </select>
                <span></span><small class="ai-hint1" id="ai-cls-hint">${escHtml(clsHint(cls))}</small>
              </div>
              <div class="ai-block" id="ai-bc-block" ${cls === 'bettercommunity' ? '' : 'hidden'}>
                <label class="ai-check"><input type="checkbox" id="ai-bc-consent" ${s.bc_consent ? 'checked' : ''}> <span>${escHtml(t('ai.settings.bcConsent'))}</span></label>
                <details class="ai-more"><summary>${escHtml(t('ai.set2.whatSent'))}</summary><p class="ai-muted">${escHtml(t('ai.settings.bcWhat'))}</p></details>
              </div>
              <div class="ai-block" id="ai-local-block" ${cls === 'local' ? '' : 'hidden'}>
                <div class="ai-grid">
                  <label class="ai-lbl" for="ai-local-url">${escHtml(t('ai.settings.localUrl'))}</label>
                  <input id="ai-local-url" class="form-input" value="${escAttr(s.local_url)}" spellcheck="false" autocomplete="off">
                  <label class="ai-lbl" for="ai-local-key">${escHtml(t('ai.set2.key'))}</label>
                  <span class="ai-keyrow"><input id="ai-local-key" type="password" class="form-input" autocomplete="off" placeholder="${escAttr(t('ai.settings.keyPh'))}">
                  <button type="button" class="btn btn-ghost btn-sm" data-save-key="local_key">${escHtml(t('ai.settings.saveKey'))}</button></span>
                  <span></span><span class="ai-muted" id="ai-local-key-where">${escHtml(keyWhere(st.keys?.local || ''))}</span>
                </div>
                <label class="ai-check"><input type="checkbox" id="ai-local-remote" ${s.local_allow_remote ? 'checked' : ''}> <span>${escHtml(t('ai.settings.localRemote'))}</span></label>
                <div class="ai-warn" id="ai-local-warn" hidden></div>
                <details class="ai-more"><summary>${escHtml(t('ai.set2.howTo'))}</summary><p class="ai-muted">${escHtml(t('ai.settings.localWhat'))}</p></details>
              </div>
            </div>
            <div class="ai-prov">
              <div class="ai-grid">
                <label class="ai-lbl" for="ai-generative">${escHtml(t('ai.set2.gen'))}</label>
                <select id="ai-generative" class="form-input">
                  ${opt('off', gen, t('ai.set2.genOff'))}
                  ${opt('local', gen, t('ai.set2.genLocalOpt'))}
                  ${opt('external', gen, t('ai.set2.genExternalOpt'))}
                </select>
                <span></span><small class="ai-hint1" id="ai-gen-hint">${escHtml(genHint(gen))}</small>
              </div>
              <div class="ai-block" id="ai-genlocal-block" ${gen === 'local' ? '' : 'hidden'}>
                <div class="ai-grid">
                  <label class="ai-lbl" for="ai-gen-url">${escHtml(t('ai.settings.localUrl'))}</label>
                  <input id="ai-gen-url" class="form-input" value="${escAttr(s.gen_local_url || 'http://127.0.0.1:11434/v1')}" spellcheck="false" autocomplete="off">
                  <label class="ai-lbl" for="ai-gen-model">${escHtml(t('ai.settings.externalModel'))}</label>
                  <span class="ai-keyrow"><input id="ai-gen-model" class="form-input" list="ai-gen-models" value="${escAttr(s.gen_local_model || '')}" placeholder="llama3.1:8b" spellcheck="false" autocomplete="off">
                  <button type="button" class="btn btn-ghost btn-sm" id="ai-gen-find">${escHtml(t('ai.set2.findModels'))}</button></span>
                  <datalist id="ai-gen-models"></datalist>
                </div>
                <div class="ai-warn" id="ai-gen-warn" hidden></div>
                <details class="ai-more"><summary>${escHtml(t('ai.set2.howTo'))}</summary><p class="ai-muted">${escHtml(t('ai.set2.genLocalHow'))}</p></details>
              </div>
              <div class="ai-block" id="ai-ext-block" ${gen === 'external' ? '' : 'hidden'}>
                <div class="ai-grid">
                  <label class="ai-lbl" for="ai-ext-url">${escHtml(t('ai.settings.externalUrl'))}</label>
                  <input id="ai-ext-url" class="form-input" value="${escAttr(s.external_url)}" placeholder="${escAttr(t('ai.settings.externalUrlPh'))}" spellcheck="false" autocomplete="off">
                  <label class="ai-lbl" for="ai-ext-model">${escHtml(t('ai.settings.externalModel'))}</label>
                  <input id="ai-ext-model" class="form-input" value="${escAttr(s.external_model)}" spellcheck="false" autocomplete="off">
                  <label class="ai-lbl" for="ai-ext-key">${escHtml(t('ai.settings.externalKey'))}</label>
                  <span class="ai-keyrow"><input id="ai-ext-key" type="password" class="form-input" autocomplete="off" placeholder="${escAttr(t('ai.settings.keyPh'))}">
                  <button type="button" class="btn btn-ghost btn-sm" data-save-key="external_key">${escHtml(t('ai.settings.saveKey'))}</button></span>
                  <span></span><span class="ai-muted" id="ai-ext-key-where">${escHtml(keyWhere(st.keys?.external || ''))}</span>
                </div>
                <div class="ai-warn">${escHtml(t('ai.set2.extWarn'))}</div>
              </div>
            </div>
          </details>
        </section>
        <details class="ai-more" id="ai-learn">
          <summary>${escHtml(t('ai.set2.more'))}</summary>
          <p class="ai-muted">${escHtml(t('ai.set2.aboutLaya'))}</p>
          ${s.installer_choice != null ? `<p class="ai-muted">${escHtml(s.installer_choice ? t('ai.settings.installerOn') : t('ai.settings.installerOff'))}</p>` : ''}
          <ul class="ai-list">
            <li>${escHtml(t('ai.settings.sent0'))}</li>
            <li>${escHtml(t('ai.settings.sent1'))}</li>
            <li>${escHtml(t('ai.settings.sent2'))}</li>
            <li>${escHtml(t('ai.set2.sentGen'))}</li>
            <li>${escHtml(t('ai.settings.sent3'))}</li>
            <li>${escHtml(t('ai.settings.sent4'))}</li>
          </ul>
          <button type="button" class="btn btn-ghost btn-sm ai-docs-btn" id="ai-docs">${DOC_IC}<span>${escHtml(t('ai.docsLink'))}</span></button>
        </details>
      </div>
      <div class="ai-actions">
        <span class="ai-muted" id="ai-status" aria-live="polite"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="ai-test" ${on ? '' : 'disabled'}>${escHtml(t('ai.settings.test'))}</button>
        <button type="button" class="btn btn-primary btn-sm" id="ai-save">${escHtml(t('common.save'))}</button>
      </div>`;
    wire(card, s, st);
    refold();
    // Other features add their own block to this card (the local API): the card is redrawn
    // whole, so they are told each time.
    try { document.dispatchEvent(new CustomEvent('bmm:ai-card-rendered', { detail: { card } })); } catch { /* no DOM events */ }
}

function clsHint(v: string): string {
    switch (v) {
        case 'embedded': return t('ai.set2.clsEmbeddedHint');
        case 'local': return t('ai.set2.clsLocalHint');
        case 'bettercommunity': return t('ai.set2.clsBcHint');
        default: return t('ai.set2.clsOffHint');
    }
}
function genHint(v: string): string {
    switch (v) {
        case 'local': return t('ai.set2.genLocalHint');
        case 'external': return t('ai.set2.genExternalHint');
        default: return t('ai.set2.genOffHint');
    }
}

/**
 * The card is redrawn whole (on Save, on a language switch, after an install). Settings folds
 * its cards ONCE, by adding a header row with a chevron: redrawn, the card had lost it — no
 * chevron, the header no longer folded, and a card that was folded at the time showed nothing
 * at all (main.css hides every child but the header), with no way to unfold it. Fold again.
 */
function refold(): void {
    try { initCollapsibleSettingsCards(); } catch { /* the page without a Settings view */ }
}

function read(card: HTMLElement, base: AiSettings): AiSettings {
    const q = <T extends HTMLElement>(id: string) => card.querySelector<T>('#' + id);
    const checked = (id: string) => !!q<HTMLInputElement>(id)?.checked;
    const val = (id: string) => (q<HTMLInputElement>(id)?.value || '').trim();
    return {
        ...base,
        enabled: checked('ai-enabled'),
        classifier: val('ai-classifier') || 'off',
        generative: val('ai-generative') || 'off',
        bc_consent: checked('ai-bc-consent'),
        local_url: val('ai-local-url') || 'http://127.0.0.1:8000',
        local_allow_remote: checked('ai-local-remote'),
        external_url: val('ai-ext-url'),
        external_model: val('ai-ext-model'),
        gen_local_url: val('ai-gen-url') || 'http://127.0.0.1:11434/v1',
        gen_local_model: val('ai-gen-model'),
        mod_suggest: checked('ai-f-mod'),
        report_triage: checked('ai-f-report'),
        description_drafts: checked('ai-f-draft'),
        ask: checked('ai-f-ask'),
        ask_generate: checked('ai-f-askgen'),
    };
}

function wire(card: HTMLElement, s: AiSettings, st: any): void {
    const q = <T extends HTMLElement>(id: string) => card.querySelector<T>('#' + id);
    const status = q('ai-status');
    const say = (msg: string, tone: '' | 'ok' | 'err' = '') => { if (status) { status.textContent = msg; status.className = `ai-muted${tone ? ` ai-${tone}` : ''}`; } };
    const save = async (): Promise<boolean> => {
        try {
            const v = await invoke('ai_save_settings', { settings: read(card, s) }) as AiView;
            render(card, v);
            const st = card.querySelector('#ai-status');
            if (st) { st.textContent = t('ai.settings.saved'); st.className = 'ai-muted ai-ok'; }
            return true;
        } catch (e) {
            say(reasonText(String((e as Error)?.message || e)), 'err');
            return false;
        }
    };
    // The master switch saves at once: turning AI OFF must not wait for a second click.
    q<HTMLInputElement>('ai-enabled')?.addEventListener('change', () => { void save(); });
    // Everything else waits for Save: say so as soon as something changed, so a toggle flipped
    // and the dialog closed is not mistaken for a saved one.
    card.querySelector('#ai-body')?.addEventListener('change', (e) => {
        const el = e.target as HTMLElement | null;
        if (!el || el.matches('input[type="password"]')) return;
        say(t('ai.lt.unsaved'));
    });
    q<HTMLSelectElement>('ai-classifier')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        q('ai-bc-block')?.toggleAttribute('hidden', v !== 'bettercommunity');
        q('ai-local-block')?.toggleAttribute('hidden', v !== 'local');
        q('ai-emb-wrap')?.toggleAttribute('hidden', !(v === 'embedded' || v === 'off'));
        const h = q('ai-cls-hint'); if (h) h.textContent = clsHint(v);
    });
    q<HTMLSelectElement>('ai-generative')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        q('ai-ext-block')?.toggleAttribute('hidden', v !== 'external');
        q('ai-genlocal-block')?.toggleAttribute('hidden', v !== 'local');
        const h = q('ai-gen-hint'); if (h) h.textContent = genHint(v);
    });
    // A hint while typing: the same rules Rust applies on save.
    const checkUrl = async (input: string, warnId: string, kind: 'local' | 'gen_local', remoteBox?: string) => {
        const warn = q(warnId);
        if (!warn) return;
        try {
            const r: any = await invoke('ai_check_url', { url: q<HTMLInputElement>(input)?.value || '', kind, allowRemote: remoteBox ? !!q<HTMLInputElement>(remoteBox)?.checked : false });
            warn.hidden = r?.warning !== 'remote';
            warn.textContent = r?.warning === 'remote' ? t('ai.settings.remoteWarn') : '';
        } catch (e) {
            warn.hidden = false;
            warn.textContent = reasonText(String((e as Error)?.message || e));
        }
    };
    q('ai-local-url')?.addEventListener('change', () => void checkUrl('ai-local-url', 'ai-local-warn', 'local', 'ai-local-remote'));
    q('ai-local-remote')?.addEventListener('change', () => void checkUrl('ai-local-url', 'ai-local-warn', 'local', 'ai-local-remote'));
    q('ai-gen-url')?.addEventListener('change', () => void checkUrl('ai-gen-url', 'ai-gen-warn', 'gen_local'));
    // « Trouver les modèles »: save, then ask the local server for its model list (GET /models).
    q('ai-gen-find')?.addEventListener('click', async () => {
        if (!(await save())) return;
        const c = document.getElementById(CARD_ID) || card;
        const out = c.querySelector<HTMLElement>('#ai-status');
        try {
            const r: any = await invoke('ai_test_connection', { target: 'gen_local' });
            const models: string[] = Array.isArray(r?.models) ? r.models : [];
            const dl = c.querySelector('#ai-gen-models');
            if (dl) dl.innerHTML = models.map((m) => `<option value="${escAttr(m)}"></option>`).join('');
            const input = c.querySelector<HTMLInputElement>('#ai-gen-model');
            if (input && !input.value && models[0]) input.value = models[0];
            if (out) { out.textContent = models.length ? t('ai.set2.modelsFound', { n: String(models.length) }) : t('ai.set2.modelsNone'); out.className = 'ai-muted ai-ok'; }
        } catch (e) {
            if (out) { out.textContent = reasonText(String((e as Error)?.message || e)); out.className = 'ai-muted ai-err'; }
        }
    });
    card.querySelectorAll<HTMLButtonElement>('[data-save-key]').forEach((b) => {
        b.addEventListener('click', async () => {
            const name = b.dataset.saveKey || '';
            const input = q<HTMLInputElement>(name === 'local_key' ? 'ai-local-key' : 'ai-ext-key');
            const value = input?.value || '';
            if (input) input.value = '';
            // Save the URL first: Rust binds the key to the SAVED provider address, and a later
            // change of address clears it.
            if (!(await save())) return;
            const c = document.getElementById(CARD_ID) || card;
            try {
                const where = String(await invoke('ai_set_secret', { name, value }));
                const out = c.querySelector(name === 'local_key' ? '#ai-local-key-where' : '#ai-ext-key-where');
                if (out) out.textContent = keyWhere(where);
            } catch (e) {
                const out = c.querySelector<HTMLElement>('#ai-status');
                if (out) { out.textContent = reasonText(String((e as Error)?.message || e)); out.className = 'ai-muted ai-err'; }
            }
        });
    });
    q('ai-save')?.addEventListener('click', () => { void save(); });
    wireEmbedded(card, st);
    q('ai-docs')?.addEventListener('click', () => openAiDocs());
    q('ai-test')?.addEventListener('click', async () => {
        const cur = read(card, s);
        const targets: string[] = [];
        if (cur.classifier === 'local' || cur.classifier === 'bettercommunity' || cur.classifier === 'embedded') targets.push(cur.classifier);
        if (cur.generative === 'external' || cur.generative === 'local') targets.push('generator');
        if (!targets.length) { say(t('ai.reason.noProvider'), 'err'); return; }
        if (!(await save())) return;
        const st = (document.getElementById(CARD_ID) || card).querySelector<HTMLElement>('#ai-status');
        const lines: string[] = [];
        for (const target of targets) {
            const name = target === 'generator' ? t('ai.set2.gen') : classifierName(target);
            try {
                const auth = target === 'bettercommunity' ? await bcAuthArgs(cur) : {};
                const r: any = await invoke('ai_test_connection', { target, ...auth });
                lines.push(t('ai.settings.testOk', { target: name, ms: String(r?.latencyMs ?? '?') }));
            } catch (e) {
                lines.push(`${name}: ${reasonText(String((e as Error)?.message || e))}`);
            }
        }
        if (st) { st.textContent = lines.join(' · '); st.className = 'ai-muted'; }
    });
}

/** Install (download, verify, unpack), pause, cancel, test and remove the built-in model. Rust does the work. */
function wireEmbedded(card: HTMLElement, st: any): void {
    const q = <T extends HTMLElement>(id: string) => card.querySelector<T>('#' + id);
    const say = (msg: string, tone: '' | 'ok' | 'err' = '') => { const o = q('ai-emb-status'); if (o) { o.textContent = msg; o.className = `ai-muted${tone ? ` ai-${tone}` : ''}`; } };
    const repaint = (status: any) => {
        const block = q('ai-emb-block');
        if (!block) return;
        block.outerHTML = embeddedHtml(status);
        wireEmbedded(card, status);
        paintLive(card);
    };
    const refresh = async () => { const v = await loadAiView(); if (card.isConnected) render(card, v); };
    q('ai-emb-install')?.addEventListener('click', async () => {
        _live = { phase: 'download' };
        _prog = null;
        repaint(st);
        const stop = await listen('ai-embedded-progress', (p: any) => {
            const phase = p?.phase === 'verify' || p?.phase === 'unpack' ? p.phase : 'download';
            const changed = phase !== _live.phase;
            _live = { phase };
            _prog = p;
            if (changed) repaint(st); else paintLive(card);
        });
        try {
            await invoke('ai_embedded_install');
            stop();
            _live = {}; _prog = null;
            await refresh();
            const o = card.querySelector('#ai-emb-status');
            if (o) { o.textContent = t('ai.emb.done'); o.className = 'ai-muted ai-ok'; }
        } catch (e) {
            stop();
            const raw = String((e as Error)?.message || e);
            _prog = null;
            if (raw === 'cancelled') { _live = {}; await refresh(); return; }
            const ns = parseNoSpace(raw);
            _live = { error: ns ? t('ai.emb.noSpace', { need: fmtBytes(ns.needed), free: fmtBytes(ns.free) }) : reasonText(raw) };
            const v = await loadAiView();
            if (card.isConnected) render(card, v);
        }
    });
    q('ai-emb-pause')?.addEventListener('click', () => { void invoke('ai_embedded_cancel', { discard: false }); });
    q('ai-emb-cancel')?.addEventListener('click', () => { void invoke('ai_embedded_cancel', { discard: true }); });
    q('ai-emb-discard')?.addEventListener('click', async () => { await invoke('ai_embedded_cancel', { discard: true }); await refresh(); });
    q('ai-emb-recheck')?.addEventListener('click', () => { _live = {}; void refresh(); });
    q('ai-emb-folder')?.addEventListener('click', () => {
        const e = st?.embedded || {};
        const dir = String(e.folder || e.dir || "");
        if (dir) void invoke("open_folder", { path: dir }).catch(() => say(dir));
    });
    q('ai-emb-test')?.addEventListener('click', async () => {
        const b = q<HTMLButtonElement>('ai-emb-test');
        if (b) b.disabled = true;
        say(t('ai.emb.testing'));
        try {
            const r: any = await invoke('ai_embedded_test');
            const vars = {
                tag: String(r?.tag || '?'), tagP: String(Math.round((Number(r?.tagP) || 0) * 100)),
                lang: String(r?.language || '?'), ms: String(r?.answerMs ?? '?'), load: String(r?.loadMs ?? 0),
            };
            const line = r?.ok ? t('ai.emb.testOk', vars) : t('ai.emb.testOdd', vars);
            say(line, r?.ok ? 'ok' : 'err');
        } catch (e) { say(reasonText(String((e as Error)?.message || e)), 'err'); }
        if (b) b.disabled = false;
    });
    q('ai-emb-remove')?.addEventListener('click', async () => {
        if (!(await askConfirm(t('ai.emb.removeConfirm')))) return;
        try {
            const r: any = await invoke('ai_embedded_remove');
            await refresh();
            const o = card.querySelector('#ai-emb-status');
            if (o) o.textContent = (r?.pendingRestart || []).length ? t('ai.emb.pending') : t('ai.emb.removed');
        } catch (e) { say(reasonText(String((e as Error)?.message || e)), 'err'); }
    });
}

/** Bar + live line, without redrawing the buttons (so a click on Pause is never lost). */
function paintLive(card: HTMLElement): void {
    const bar = card.querySelector<HTMLProgressElement>('#ai-emb-progress');
    const line = card.querySelector<HTMLElement>('#ai-emb-live');
    if (!_prog) return;
    const total = Number(_prog.total) || 0;
    if (bar && total > 0) {
        if (_prog.phase === 'download') { bar.max = total; bar.value = Number(_prog.received) || 0; } else bar.removeAttribute('value');
    }
    if (line) line.textContent = liveText(_prog);
}
