// ai-settings.ts — the "AI (optional)" card in Settings.
//
// Built here and slotted in after the Privacy card, because index.html is not this feature's
// file. Off by default; the master switch off means no AI network call anywhere (enforced in
// Rust, commands/ai_core.rs — this card only edits the settings and explains them).
//
// Keys are write-only from here: the field sends a key to `ai_set_secret` and is emptied; the
// card only ever learns WHERE a key is stored (DPAPI / keyring / this session only), never
// the key.
import { invoke, listen } from '../../core/api.js';
import { confirmAction } from '../../ui/verify.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { fmtBytes, embState, fmtSpeed, fmtEta, parseNoSpace, type AiSettings, type EmbLive, type EmbState } from './ai-model.js';
import { ensureAiCss, loadAiView, reasonText, bcAuthArgs, openAiDocs, type AiView } from './ai-shared.js';
import { initCollapsibleSettingsCards } from '../../ui/settings-fold.js';
import { uiIcon } from '../../ui/icons.js';
import { GEN_PRESETS, normalizeBase, presetOfUrl, probeKeys, sortModels, pickModel, type Probe } from './ai-gen-model.js';

// Lives in the « Laya » dialog (laya-hub.ts); Settings keeps one summary card.
const CARD_ID = 'laya-general-card';
const PROV_ID = 'laya-providers-card';
const PRIV_ID = 'laya-privacy-card';

const IC = (uiIcon('ai', 20));
/** A book: the « How AI works in BMM » link-button. */
const DOC_IC = uiIcon('book', 14);

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

/** Put the three cards (once) in the Laya dialog's panes — Overview, Providers, Privacy — then fill them. */
export async function mountAiSettings(host: HTMLElement, providersHost?: HTMLElement | null, privacyHost?: HTMLElement | null): Promise<void> {
    ensureAiCss();
    const make = (id: string, where: HTMLElement | null | undefined): HTMLElement | null => {
        if (!where) return null;
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.className = 'ai-card laya-pane-card';
            el.id = id;
            where.appendChild(el);
        }
        return el;
    };
    const general = make(CARD_ID, host) as HTMLElement;
    _cards = { general, providers: make(PROV_ID, providersHost), privacy: make(PRIV_ID, privacyHost) };
    const view = await loadAiView();
    render(view);
    if (!(general as any)._aiLangWired) {
        (general as any)._aiLangWired = true;
        document.addEventListener('langChanged', () => { if (general.isConnected) void loadAiView().then((v) => render(v)); });
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

/** « LM Studio · qwen2.5-7b » / « api.openai.com · gpt-4o-mini » / « Off »: who writes the drafts. */
export function writerLine(s: AiSettings): string {
    if (s.generative === 'local') {
        const p = presetOfUrl(s.gen_local_url || '');
        const name = t(`ai.gen.preset.${p}`);
        return s.gen_local_model ? `${name} · ${s.gen_local_model}` : name;
    }
    if (s.generative === 'external') {
        let host = '';
        try { host = new URL(normalizeBase(s.external_url)).host; } catch { host = s.external_url; }
        return s.external_model ? `${host} · ${s.external_model}` : host;
    }
    return t('ai.gen.writerOff');
}

/** One feature toggle: a short label and a one-line hint. */
function toggle(id: string, on: boolean, label: string, hint: string, disabled = false): string {
    return `<label class="ai-toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span><b>${escHtml(label)}</b><small>${escHtml(hint)}</small></span></label>`;
}

/** The status line + Save at the foot of a card (each card that edits settings has one). */
function actionsRow(statusId: string, testable: boolean, on: boolean): string {
    return `<div class="ai-actions">
        <span class="ai-muted ai-status-line" id="${statusId}" aria-live="polite"></span>
        ${testable ? `<button type="button" class="btn btn-ghost btn-sm" id="ai-test" ${on ? '' : 'disabled'}>${escHtml(t('ai.settings.test'))}</button>` : ''}
        <button type="button" class="btn btn-primary btn-sm" data-ai-save>${escHtml(t('common.save'))}</button>
      </div>`;
}

/** The three cards this module fills: Overview, Providers, Privacy (panes of the Laya dialog). */
interface Cards { general: HTMLElement; providers: HTMLElement | null; privacy: HTMLElement | null }
let _cards: Cards | null = null;
/** The last « Find models » / « Test connection » result, kept across redraws (and shown in Privacy → diagnostics). */
let _probe: Probe | null = null;
let _probeKind: 'local' | 'external' = 'local';

function render(view: AiView | null): void {
    const cards = _cards;
    if (!cards) return;
    const s: AiSettings | null = view?.settings || null;
    const st = view?.status || {};
    if (!s) {
        cards.general.innerHTML = `<h3 class="card-title ai-card-title">${IC}<span>${escHtml(t('ai.settings.title'))}</span></h3><p class="ai-muted">${escHtml(t('ai.settings.unavailable'))}</p>`;
        if (cards.providers) cards.providers.innerHTML = '';
        if (cards.privacy) cards.privacy.innerHTML = '';
        refold();
        return;
    }
    const killed = !!st.killSwitch;
    const on = !!s.enabled && !killed;
    const pill = killed ? t('ai.settings.pillKilled') : on ? t('ai.settings.pillOn') : t('ai.settings.pillOff');
    const cls = s.classifier || 'off';
    const gen = s.generative || 'off';
    const emb = embState0(st);
    const modelOn = emb === 'installed' || emb === 'loaded';
    const modelWord = modelOn ? (emb === 'loaded' ? t('ai.emb.stLoaded') : t('ai.emb.installed')) : t('ai.emb.absent');
    const leaves = on && !st?.offline;
    const heroTitle = killed ? t('ai.hub2.heroKilled') : on ? t('ai.hub2.heroOn') : t('ai.hub2.heroOff');
    const writer = writerLine(s);
    cards.general.dataset.headModel = modelWord;
    cards.general.dataset.headWriter = writer;
    cards.general.innerHTML = `
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
          <span class="bms-chip${gen !== 'off' ? ' bms-chip--ok' : ''}"><span class="bms-dot"></span>${escHtml(t('ai.gen.writerChip', { v: writer }))}</span>
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
            ${toggle('ai-f-draft', s.description_drafts, t('ai.gen.fDraft'), t('ai.gen.fDraftHint'))}
            ${toggle('ai-f-askgen', !!s.ask_generate, t('ai.set2.fAskGen'), t('ai.set2.fAskGenHint'))}
          </div>
        </section>
        <section class="laya-sec" aria-labelledby="ai-emb-h">
          <header class="laya-sec-h">
            <h4 class="laya-sec-title" id="ai-emb-h">${escHtml(t('ai.gen.embTitle'))}</h4>
            <p class="laya-sec-lead">${escHtml(t('ai.gen.embLead'))}</p>
          </header>
          <div id="ai-emb-wrap">${embeddedHtml(st)}</div>
        </section>
      </div>
      ${actionsRow('ai-status', false, on)}`;
    if (cards.providers) cards.providers.innerHTML = providersHtml(s, st, on);
    if (cards.privacy) cards.privacy.innerHTML = privacyHtml(s, st, on);
    wire(s, st);
    refold();
    // Other features add their own block to this card (the local API): the card is redrawn
    // whole, so they are told each time.
    try { document.dispatchEvent(new CustomEvent('bmm:ai-card-rendered', { detail: { card: cards.general } })); } catch { /* no DOM events */ }
}

/** Providers: who sorts (the classifier) and who writes (« Rédaction »), with model lists and a connection test. */
function providersHtml(s: AiSettings, st: any, on: boolean): string {
    const opt = (v: string, cur: string, label: string) => `<option value="${escAttr(v)}"${v === cur ? ' selected' : ''}>${escHtml(label)}</option>`;
    const cls = s.classifier || 'off';
    const gen = s.generative || 'off';
    const genUrl = s.gen_local_url || GEN_PRESETS[1].url;
    const preset = presetOfUrl(genUrl);
    const kind = (v: string, label: string, hint: string) => `<label class="ai-seg-opt"><input type="radio" name="ai-gen-kind" value="${v}" ${gen === v ? 'checked' : ''}><span><b>${escHtml(label)}</b><small>${escHtml(hint)}</small></span></label>`;
    const presetBtn = (p: typeof GEN_PRESETS[number]) => `<button type="button" class="ai-chipbtn${preset === p.id ? ' is-on' : ''}" data-gen-preset="${p.id}" aria-pressed="${preset === p.id}">${escHtml(t(`ai.gen.preset.${p.id}`))}</button>`;
    return `
      <header class="laya-page-h">
        <h3 class="card-title">${escHtml(t('ai.gen.provTitle'))}</h3>
        <p class="ai-muted" id="ai-prov-summary">${escHtml(t('ai.gen.provSummary', { cls: classifierName(cls), gen: writerLine(s) }))}</p>
      </header>
      <section class="laya-sec" aria-labelledby="ai-gen-h">
        <header class="laya-sec-h">
          <h4 class="laya-sec-title" id="ai-gen-h">${escHtml(t('ai.gen.writerTitle'))}</h4>
          <p class="laya-sec-lead">${escHtml(t('ai.gen.writerLead'))}</p>
        </header>
        <div class="ai-seg" role="radiogroup" aria-labelledby="ai-gen-h">
          ${kind('off', t('ai.gen.kindOff'), t('ai.gen.kindOffHint'))}
          ${kind('local', t('ai.gen.kindLocal'), t('ai.gen.kindLocalHint'))}
          ${kind('external', t('ai.gen.kindExternal'), t('ai.gen.kindExternalHint'))}
        </div>
        <div class="ai-genbox" id="ai-genlocal-block" ${gen === 'local' ? '' : 'hidden'}>
          <div class="ai-chipbtns" role="group" aria-label="${escAttr(t('ai.gen.serverAria'))}">${GEN_PRESETS.map(presetBtn).join('')}</div>
          <div class="ai-grid">
            <label class="ai-lbl" for="ai-gen-url">${escHtml(t('ai.gen.address'))}</label>
            <span class="ai-keyrow"><input id="ai-gen-url" class="form-input" value="${escAttr(genUrl)}" spellcheck="false" autocomplete="off">
            <button type="button" class="btn btn-ghost btn-sm" id="ai-gen-find">${escHtml(t('ai.set2.findModels'))}</button></span>
            <span></span><small class="ai-hint1" id="ai-gen-uses"></small>
            <label class="ai-lbl" for="ai-gen-model">${escHtml(t('ai.gen.model'))}</label>
            <input id="ai-gen-model" class="form-input" value="${escAttr(s.gen_local_model || '')}" placeholder="${escAttr(t('ai.gen.modelPh'))}" spellcheck="false" autocomplete="off">
          </div>
          <div class="ai-models" id="ai-gen-models" role="radiogroup" aria-label="${escAttr(t('ai.gen.modelsAria'))}" hidden></div>
          <div class="ai-warn" id="ai-gen-warn" hidden></div>
          <details class="ai-more"><summary>${escHtml(t('ai.set2.howTo'))}</summary><p class="ai-muted">${escHtml(t('ai.gen.howLocal'))}</p></details>
        </div>
        <div class="ai-genbox" id="ai-ext-block" ${gen === 'external' ? '' : 'hidden'}>
          <div class="ai-grid">
            <label class="ai-lbl" for="ai-ext-url">${escHtml(t('ai.settings.externalUrl'))}</label>
            <span class="ai-keyrow"><input id="ai-ext-url" class="form-input" value="${escAttr(s.external_url)}" placeholder="${escAttr(t('ai.settings.externalUrlPh'))}" spellcheck="false" autocomplete="off">
            <button type="button" class="btn btn-ghost btn-sm" id="ai-ext-find" ${on ? '' : 'disabled'}>${escHtml(t('ai.set2.findModels'))}</button></span>
            <label class="ai-lbl" for="ai-ext-model">${escHtml(t('ai.gen.model'))}</label>
            <input id="ai-ext-model" class="form-input" value="${escAttr(s.external_model)}" spellcheck="false" autocomplete="off">
            <label class="ai-lbl" for="ai-ext-key">${escHtml(t('ai.settings.externalKey'))}</label>
            <span class="ai-keyrow"><input id="ai-ext-key" type="password" class="form-input" autocomplete="off" placeholder="${escAttr(t('ai.settings.keyPh'))}">
            <button type="button" class="btn btn-ghost btn-sm" data-save-key="external_key">${escHtml(t('ai.settings.saveKey'))}</button></span>
            <span></span><span class="ai-muted" id="ai-ext-key-where">${escHtml(keyWhere(st.keys?.external || ''))}</span>
          </div>
          <div class="ai-models" id="ai-ext-models" role="radiogroup" aria-label="${escAttr(t('ai.gen.modelsAria'))}" hidden></div>
          <div class="ai-warn">${escHtml(t('ai.set2.extWarn'))}</div>
        </div>
        <div class="ai-probe" id="ai-gen-report" aria-live="polite" hidden></div>
        <div class="ai-actions ai-actions--inline" ${gen === 'off' ? 'hidden' : ''} id="ai-gen-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="ai-gen-test">${escHtml(t('ai.gen.test'))}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="ai-gen-try">${escHtml(t('ai.gen.tryDraft'))}</button>
        </div>
      </section>
      <section class="laya-sec" aria-labelledby="ai-cls-h">
        <header class="laya-sec-h">
          <h4 class="laya-sec-title" id="ai-cls-h">${escHtml(t('ai.gen.clsTitle'))}</h4>
          <p class="laya-sec-lead">${escHtml(t('ai.gen.clsLead'))}</p>
        </header>
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
        <div class="ai-genbox" id="ai-bc-block" ${cls === 'bettercommunity' ? '' : 'hidden'}>
          <label class="ai-check"><input type="checkbox" id="ai-bc-consent" ${s.bc_consent ? 'checked' : ''}> <span>${escHtml(t('ai.settings.bcConsent'))}</span></label>
          <details class="ai-more"><summary>${escHtml(t('ai.set2.whatSent'))}</summary><p class="ai-muted">${escHtml(t('ai.settings.bcWhat'))}</p></details>
        </div>
        <div class="ai-genbox" id="ai-local-block" ${cls === 'local' ? '' : 'hidden'}>
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
      </section>
      ${actionsRow('ai-status-prov', true, on)}`;
}

/** Privacy: what leaves this PC with the current setup, the full list, and the last connection check. */
function privacyHtml(s: AiSettings, st: any, on: boolean): string {
    const lines: string[] = [];
    if (!on) lines.push(t('ai.gen.privOff'));
    else {
        lines.push(s.classifier === 'bettercommunity' ? t('ai.gen.privClsBc') : s.classifier === 'local' ? t('ai.gen.privClsLocal') : t('ai.gen.privClsNone'));
        lines.push(s.generative === 'external' ? t('ai.gen.privGenExt', { v: writerLine(s) }) : s.generative === 'local' ? t('ai.gen.privGenLocal') : t('ai.gen.privGenNone'));
    }
    const leaves = on && !st?.offline;
    return `
      <header class="laya-page-h">
        <h3 class="card-title">${escHtml(t('ai.gen.privTitle'))}</h3>
        <p class="ai-muted" id="ai-privacy-summary">${escHtml(leaves ? t('ai.hub2.mayLeave') : on ? t('ai.hub2.private') : t('ai.hub2.nothingSent'))}</p>
      </header>
      <section class="laya-sec">
        <ul class="ai-list ai-list--now">${lines.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul>
      </section>
      <section class="laya-sec" aria-labelledby="ai-sent-h">
        <header class="laya-sec-h"><h4 class="laya-sec-title" id="ai-sent-h">${escHtml(t('ai.gen.privAllTitle'))}</h4></header>
        <p class="ai-muted">${escHtml(t('ai.set2.aboutLaya'))}</p>
        ${s.installer_choice != null ? `<p class="ai-muted">${escHtml(s.installer_choice ? t('ai.settings.installerOn') : t('ai.settings.installerOff'))}</p>` : ''}
        <ul class="ai-list">
          <li>${escHtml(t('ai.settings.sent0'))}</li>
          <li>${escHtml(t('ai.settings.sent1'))}</li>
          <li>${escHtml(t('ai.settings.sent2'))}</li>
          <li>${escHtml(t('ai.set2.sentGen'))}</li>
          <li>${escHtml(t('ai.gen.sentDraft'))}</li>
          <li>${escHtml(t('ai.settings.sent3'))}</li>
          <li>${escHtml(t('ai.settings.sent4'))}</li>
        </ul>
        <div><button type="button" class="btn btn-ghost btn-sm ai-docs-btn" id="ai-docs">${DOC_IC}<span>${escHtml(t('ai.docsLink'))}</span></button></div>
      </section>
      <section class="laya-sec" aria-labelledby="ai-diag-h">
        <header class="laya-sec-h">
          <h4 class="laya-sec-title" id="ai-diag-h">${escHtml(t('ai.gen.diagTitle'))}</h4>
          <p class="laya-sec-lead">${escHtml(t('ai.gen.diagLead'))}</p>
        </header>
        <div id="ai-diag-steps">${_probe ? stepsHtml(_probe) : `<p class="ai-muted">${escHtml(t('ai.gen.diagNone'))}</p>`}</div>
      </section>`;
}

function clsHint(v: string): string {
    switch (v) {
        case 'embedded': return t('ai.set2.clsEmbeddedHint');
        case 'local': return t('ai.set2.clsLocalHint');
        case 'bettercommunity': return t('ai.set2.clsBcHint');
        default: return t('ai.set2.clsOffHint');
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

/** Ids are unique across the three cards: look in all of them. */
function q<T extends HTMLElement = HTMLElement>(id: string): T | null {
    const c = _cards;
    if (!c) return null;
    for (const root of [c.general, c.providers, c.privacy]) {
        const el = root?.querySelector<T>('#' + id);
        if (el) return el;
    }
    return null;
}

function read(base: AiSettings): AiSettings {
    const checked = (id: string) => !!q<HTMLInputElement>(id)?.checked;
    const val = (id: string) => (q<HTMLInputElement>(id)?.value || '').trim();
    const kind = (_cards?.providers?.querySelector<HTMLInputElement>('input[name="ai-gen-kind"]:checked')?.value) || base.generative || 'off';
    return {
        ...base,
        enabled: checked('ai-enabled'),
        classifier: val('ai-classifier') || base.classifier || 'off',
        generative: kind,
        bc_consent: checked('ai-bc-consent'),
        local_url: val('ai-local-url') || base.local_url || 'http://127.0.0.1:8000',
        local_allow_remote: checked('ai-local-remote'),
        external_url: val('ai-ext-url'),
        external_model: val('ai-ext-model'),
        gen_local_url: val('ai-gen-url') || base.gen_local_url || GEN_PRESETS[1].url,
        gen_local_model: val('ai-gen-model'),
        mod_suggest: checked('ai-f-mod'),
        report_triage: checked('ai-f-report'),
        description_drafts: checked('ai-f-draft'),
        ask: checked('ai-f-ask'),
        ask_generate: checked('ai-f-askgen'),
    };
}

function say(msg: string, tone: '' | 'ok' | 'err' = ''): void {
    const c = _cards;
    if (!c) return;
    for (const root of [c.general, c.providers]) {
        root?.querySelectorAll<HTMLElement>('.ai-status-line').forEach((el) => { el.textContent = msg; el.className = `ai-muted ai-status-line${tone ? ` ai-${tone}` : ''}`; });
    }
}

// ── The probe report ────────────────────────────────────────────────────────

function stepName(step: string): string {
    return t(`ai.gen.step.${['address', 'models', 'lmstudio', 'ollama', 'chat'].includes(step) ? step : 'models'}`);
}

/** The steps, one line each: what was asked, where, and how it went. */
function stepsHtml(p: Probe): string {
    const rows = (p.steps || []).map((s) => {
        const res = s.ok ? t('ai.gen.stepOk', { ms: String(s.ms) }) : s.error ? stepError(s.error, s.status) : '';
        return `<li class="ai-step${s.ok ? ' is-ok' : s.optional ? ' is-opt' : ' is-bad'}">
            <span class="ai-step-dot" aria-hidden="true"></span>
            <span class="ai-step-k">${escHtml(stepName(s.step))}</span>
            <code class="ai-step-url">${escHtml(s.url)}</code>
            <span class="ai-step-v">${escHtml(res)}${s.detail ? ` · ${escHtml(s.detail)}` : ''}</span>
          </li>`;
    }).join('');
    return `<ol class="ai-steps">${rows}</ol>`;
}

function stepError(code: string, status: number | null): string {
    if (code.startsWith('ai.url.')) return t(code);
    if (code.startsWith('http_')) return t('ai.gen.code.http', { status: String(status ?? code.slice(5)) });
    const known = ['refused', 'timeout', 'unreachable', 'wrong_path', 'bad_response', 'no_models', 'model_error'];
    return known.includes(code) ? t(`ai.gen.code.${code}`) : code;
}

function paintProbe(p: Probe | null, busy = false): void {
    const box = q('ai-gen-report');
    if (!box) return;
    if (busy) {
        box.hidden = false;
        box.className = 'ai-probe is-busy';
        box.innerHTML = `<p class="ai-probe-head"><span class="ai-dot" aria-hidden="true"></span>${escHtml(t('ai.gen.probing'))}</p>`;
        return;
    }
    if (!p) { box.hidden = true; return; }
    const k = probeKeys(p);
    const server = p.server ? t(`ai.gen.server.${['lmstudio', 'ollama', 'openai'].includes(p.server) ? p.server : 'openai'}`) : '';
    box.hidden = false;
    box.className = `ai-probe is-${k.tone}`;
    const changed = p.typed && normalizeBase(p.typed) !== p.typed ? `<p class="ai-muted">${escHtml(t('ai.gen.usedBase', { base: p.base }))}</p>` : '';
    box.innerHTML = `
      <p class="ai-probe-head">${escHtml(t(k.head, k.vars))}${server ? ` <span class="bms-chip">${escHtml(server)}</span>` : ''}</p>
      ${k.hint ? `<p class="ai-muted">${escHtml(t(k.hint, k.vars))}</p>` : ''}
      ${!p.ok && k.vars.detail ? `<p class="ai-muted ai-probe-said">${escHtml(t('ai.gen.serverSays', { detail: k.vars.detail }))}</p>` : ''}
      ${changed}
      <details class="ai-more"><summary>${escHtml(t('ai.gen.details'))}</summary>${stepsHtml(p)}</details>`;
    const diag = q('ai-diag-steps');
    if (diag) diag.innerHTML = stepsHtml(p);
}

/** The model rows: click one to use it. Loaded first; an embedding model cannot write and says so. */
function paintModels(listId: string, inputId: string, p: Probe | null): void {
    const list = q(listId);
    const input = q<HTMLInputElement>(inputId);
    if (!list) return;
    const models = p ? sortModels(p.models || []) : [];
    if (!models.length) { list.hidden = true; list.innerHTML = ''; return; }
    const cur = input?.value.trim() || '';
    list.hidden = false;
    list.innerHTML = models.slice(0, 40).map((m) => {
        const badges = [
            m.loaded === true ? `<span class="bms-chip bms-chip--ok">${escHtml(t('ai.gen.loaded'))}</span>` : '',
            m.kind === 'embedding' ? `<span class="bms-chip">${escHtml(t('ai.gen.embedding'))}</span>` : '',
        ].join('');
        const sel = m.id === cur;
        return `<button type="button" class="ai-model${sel ? ' is-on' : ''}" role="radio" aria-checked="${sel}" data-model="${escAttr(m.id)}" ${m.kind === 'embedding' ? 'disabled' : ''}>
            <span class="ai-model-dot" aria-hidden="true"></span><span class="ai-model-id">${escHtml(m.id)}</span>${badges}</button>`;
    }).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-model]').forEach((b) => b.addEventListener('click', () => {
        if (input) input.value = b.dataset.model || '';
        list.querySelectorAll('.ai-model').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
        say(t('ai.lt.unsaved'));
    }));
}

function wire(s: AiSettings, st: any): void {
    const c = _cards;
    if (!c) return;
    const save = async (): Promise<boolean> => {
        try {
            const v = await invoke('ai_save_settings', { settings: read(s) }) as AiView;
            render(v);
            say(t('ai.settings.saved'), 'ok');
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
    for (const root of [c.general, c.providers]) {
        root?.addEventListener('change', (e) => {
            const el = e.target as HTMLElement | null;
            if (!el || el.id === 'ai-enabled' || el.matches('input[type="password"]')) return;
            say(t('ai.lt.unsaved'));
        });
        root?.querySelectorAll<HTMLButtonElement>('[data-ai-save]').forEach((b) => b.addEventListener('click', () => { void save(); }));
    }
    q<HTMLSelectElement>('ai-classifier')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        q('ai-bc-block')?.toggleAttribute('hidden', v !== 'bettercommunity');
        q('ai-local-block')?.toggleAttribute('hidden', v !== 'local');
        const h = q('ai-cls-hint'); if (h) h.textContent = clsHint(v);
    });
    c.providers?.querySelectorAll<HTMLInputElement>('input[name="ai-gen-kind"]').forEach((r) => r.addEventListener('change', () => {
        const v = r.value;
        q('ai-ext-block')?.toggleAttribute('hidden', v !== 'external');
        q('ai-genlocal-block')?.toggleAttribute('hidden', v !== 'local');
        q('ai-gen-actions')?.toggleAttribute('hidden', v === 'off');
        paintProbe(null);
    }));
    // A hint while typing: the same rules Rust applies on save.
    const checkUrl = async (input: string, warnId: string, kind: 'local' | 'gen_local', remoteBox?: string) => {
        const warn = q(warnId);
        if (!warn) return;
        let url = q<HTMLInputElement>(input)?.value || '';
        if (kind === 'gen_local') url = normalizeBase(url);
        try {
            const r: any = await invoke('ai_check_url', { url, kind, allowRemote: remoteBox ? !!q<HTMLInputElement>(remoteBox)?.checked : false });
            warn.hidden = r?.warning !== 'remote';
            warn.textContent = r?.warning === 'remote' ? t('ai.settings.remoteWarn') : '';
        } catch (e) {
            warn.hidden = false;
            warn.textContent = reasonText(String((e as Error)?.message || e));
        }
    };
    q('ai-local-url')?.addEventListener('change', () => void checkUrl('ai-local-url', 'ai-local-warn', 'local', 'ai-local-remote'));
    q('ai-local-remote')?.addEventListener('change', () => void checkUrl('ai-local-url', 'ai-local-warn', 'local', 'ai-local-remote'));
    // « Will use http://127.0.0.1:1234/v1 »: the address as Rust will read it.
    const uses = () => {
        const out = q('ai-gen-uses');
        const raw = q<HTMLInputElement>('ai-gen-url')?.value || '';
        const base = normalizeBase(raw);
        if (out) out.textContent = base && base !== raw.trim().replace(/\/+$/, '') ? t('ai.gen.willUse', { base }) : t('ai.gen.addressHint');
        const p = presetOfUrl(raw);
        c.providers?.querySelectorAll<HTMLButtonElement>('[data-gen-preset]').forEach((b) => { const onP = b.dataset.genPreset === p; b.classList.toggle('is-on', onP); b.setAttribute('aria-pressed', String(onP)); });
    };
    uses();
    q('ai-gen-url')?.addEventListener('input', uses);
    q('ai-gen-url')?.addEventListener('change', () => void checkUrl('ai-gen-url', 'ai-gen-warn', 'gen_local'));
    c.providers?.querySelectorAll<HTMLButtonElement>('[data-gen-preset]').forEach((b) => b.addEventListener('click', () => {
        const p = GEN_PRESETS.find((x) => x.id === b.dataset.genPreset);
        const input = q<HTMLInputElement>('ai-gen-url');
        if (!p || !input) return;
        if (p.url) input.value = p.url; else { input.focus(); input.select(); }
        uses();
        paintProbe(null);
        paintModels('ai-gen-models', 'ai-gen-model', null);
        say(t('ai.lt.unsaved'));
    }));
    // « Find models » / « Test connection »: the TYPED address, nothing saved first. Rust
    // normalises it, lists the models (LM Studio's and Ollama's own lists too) and says which
    // step failed. The local probe works with the master switch off: nothing leaves the PC.
    const runProbe = async (kind: 'local' | 'external', chat: boolean) => {
        const url = q<HTMLInputElement>(kind === 'local' ? 'ai-gen-url' : 'ai-ext-url')?.value || '';
        const modelInput = q<HTMLInputElement>(kind === 'local' ? 'ai-gen-model' : 'ai-ext-model');
        const btns = ['ai-gen-find', 'ai-ext-find', 'ai-gen-test'].map((id) => q<HTMLButtonElement>(id)).filter(Boolean) as HTMLButtonElement[];
        btns.forEach((b) => { b.disabled = true; });
        paintProbe(null, true);
        try {
            const p = await invoke('ai_gen_probe', { url, kind, model: modelInput?.value.trim() || null, chat }) as Probe;
            _probe = p;
            _probeKind = kind;
            if (modelInput && p.models?.length) modelInput.value = pickModel(p.models, modelInput.value, p.suggested);
            if (kind === 'local' && p.base) { const u = q<HTMLInputElement>('ai-gen-url'); if (u && p.ok) { u.value = p.base; uses(); } }
            paintModels(kind === 'local' ? 'ai-gen-models' : 'ai-ext-models', kind === 'local' ? 'ai-gen-model' : 'ai-ext-model', p);
            paintProbe(p);
            if (p.ok) say(t('ai.gen.saveToKeep'));
        } catch (e) {
            paintProbe(null);
            say(reasonText(String((e as Error)?.message || e)), 'err');
        } finally {
            btns.forEach((b) => { b.disabled = false; });
            const ext = q<HTMLButtonElement>('ai-ext-find'); if (ext && !(s.enabled && !st?.killSwitch)) ext.disabled = true;
        }
    };
    q('ai-gen-find')?.addEventListener('click', () => void runProbe('local', false));
    q('ai-ext-find')?.addEventListener('click', () => void runProbe('external', false));
    q('ai-gen-test')?.addEventListener('click', () => {
        const kind = (c.providers?.querySelector<HTMLInputElement>('input[name="ai-gen-kind"]:checked')?.value) === 'external' ? 'external' : 'local';
        void runProbe(kind, true);
    });
    q('ai-gen-try')?.addEventListener('click', async () => {
        if (!(await save())) return;
        // laya-hub.ts listens (an event, not an import: the hub already imports this module).
        document.dispatchEvent(new CustomEvent('bmm:open-laya', { detail: { tab: 'drafting' } }));
    });
    // A probe from before the redraw (a Save) stays on screen.
    if (_probe) {
        paintModels(_probeKind === 'local' ? 'ai-gen-models' : 'ai-ext-models', _probeKind === 'local' ? 'ai-gen-model' : 'ai-ext-model', _probe);
        paintProbe(_probe);
    }
    c.providers?.querySelectorAll<HTMLButtonElement>('[data-save-key]').forEach((b) => {
        b.addEventListener('click', async () => {
            const name = b.dataset.saveKey || '';
            const input = q<HTMLInputElement>(name === 'local_key' ? 'ai-local-key' : 'ai-ext-key');
            const value = input?.value || '';
            if (input) input.value = '';
            // Save the URL first: Rust binds the key to the SAVED provider address, and a later
            // change of address clears it.
            if (!(await save())) return;
            try {
                const where = String(await invoke('ai_set_secret', { name, value }));
                const out = q(name === 'local_key' ? 'ai-local-key-where' : 'ai-ext-key-where');
                if (out) out.textContent = keyWhere(where);
            } catch (e) {
                say(reasonText(String((e as Error)?.message || e)), 'err');
            }
        });
    });
    wireEmbedded(c.general, st);
    q('ai-docs')?.addEventListener('click', () => openAiDocs());
    q('ai-test')?.addEventListener('click', async () => {
        const cur = read(s);
        const targets: string[] = [];
        if (cur.classifier === 'local' || cur.classifier === 'bettercommunity' || cur.classifier === 'embedded') targets.push(cur.classifier);
        if (cur.generative === 'external' || cur.generative === 'local') targets.push('generator');
        if (!targets.length) { say(t('ai.reason.noProvider'), 'err'); return; }
        if (!(await save())) return;
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
        say(lines.join(' · '));
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
    const refresh = async () => { const v = await loadAiView(); if (card.isConnected) render(v); };
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
            if (card.isConnected) render(v);
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
        if (!(await confirmAction({ title: t('ai.emb.removeTitle'), message: t('ai.emb.removeConfirm'), confirmLabel: t('ai.emb.remove'), tone: 'danger' }))) return;
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
