// laya-hub.ts — the one « Laya » card in Settings, and the dialog behind it.
//
// Laya used to be three Settings cards in a row (the AI card, « Réponses de Laya », « API Laya
// locale »), each long, which read as Laya spread all over the page. Now Settings shows one
// short card — the master state and one line per part — and « Gérer Laya » opens a dialog.
//
// The dialog is organised by what a person wants to do, not by which module owns the setting:
//   · Aperçu            — is Laya on (the one switch), is its model there, where it runs, what
//                         leaves this PC; then what it does for you; the engines behind « Avancé ».
//   · Exigence          — how sure Laya must be (presets first, fine numbers behind « Avancé »).
//   · Mes tâches        — the user's own labels (ai-tuning.ts renders this pane too).
//   · Pour les programmes — the local API.
// The cards are mounted once, into the dialog's panes, and re-render there on their own.
//
// The summary card keeps the old AI card's id, so a saved card order, the Ask index and the
// command palette still find it where they did.
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { ensureAiCss } from './ai-shared.js';
import { installFocusTrap, ownsFocus } from '../../ui/focus-trap.js';
import { initCollapsibleSettingsCards } from '../../ui/settings-fold.js';
import { MODAL_CLOSE_SVG } from '../../ui/modal-shell.js';
import { uiIcon } from '../../ui/icons.js';

const CARD_ID = 'settings-ai-section';

const IC = (uiIcon('ai', 16));

type Tab = 'general' | 'answers' | 'tasks' | 'api';
const TABS: Tab[] = ['general', 'answers', 'tasks', 'api'];
/** Where each tab's figures are read from, in the mounted cards (their own pills). */
const SOURCE: Record<Tab, string> = { general: '#ai-statusline', answers: '#lt-pill', tasks: '#lt-tasks-pill', api: '#ai-api-pill' };

let _overlay: HTMLElement | null = null;
let _opener: HTMLElement | null = null;
let _tab: Tab = 'general';

function tabName(tab: Tab): string {
    switch (tab) {
        case 'general': return t('ai.hub.tabGeneral');
        case 'answers': return t('ai.hub.tabAnswers');
        case 'tasks': return t('ai.hub.tabTasks');
        default: return t('ai.hub.tabApi');
    }
}

function textOf(sel: string): string {
    return (_overlay?.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
}

// ── The dialog ───────────────────────────────────────────────────────────────

function overlay(): HTMLElement {
    if (_overlay && _overlay.isConnected) return _overlay;
    const o = document.createElement('div');
    o.className = 'modal-overlay ai-overlay';
    o.id = 'modal-laya';
    // The house anatomy: icon tile, title + one-line state, the on/off chip, the ×; the tabs
    // as a segmented rail in the toolbar band; the panes scroll in the body.
    o.innerHTML = `
      <div class="modal bms modal--lg modal--tall laya-modal" role="dialog" aria-modal="true" aria-labelledby="laya-title">
        <div class="modal-header">
          <div class="bms-icon" aria-hidden="true">${IC}</div>
          <div class="bms-titles">
            <h2 class="modal-title" id="laya-title"></h2>
            <p class="bms-sub" id="laya-sub"></p>
          </div>
          <div class="bms-head-end"><span class="bms-chip" id="laya-head-chip"><span class="bms-dot"></span><span></span></span></div>
          <button type="button" class="modal-close" id="laya-close">${MODAL_CLOSE_SVG}</button>
        </div>
        <div class="modal-toolbar laya-toolbar">
          <div class="bms-tabs laya-tabs" role="tablist">
            ${TABS.map((k) => `<button type="button" class="bms-tab laya-tab" role="tab" id="laya-tab-${k}" data-tab="${k}" aria-controls="laya-pane-${k}"></button>`).join('')}
          </div>
        </div>
        <div class="modal-body laya-body">
          ${TABS.map((k) => `<div class="laya-pane" role="tabpanel" id="laya-pane-${k}" aria-labelledby="laya-tab-${k}" hidden></div>`).join('')}
        </div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o) close(); });
    o.querySelector('#laya-close')?.addEventListener('click', close);
    o.querySelectorAll<HTMLButtonElement>('.laya-tab').forEach((b) => b.addEventListener('click', () => select(b.dataset.tab as Tab)));
    // Arrow keys (and Home / End) move along the tabs, as a tablist does.
    o.querySelector('.laya-tabs')?.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        const i = TABS.indexOf(_tab);
        let to = -1;
        if (k === 'ArrowRight') to = (i + 1) % TABS.length;
        else if (k === 'ArrowLeft') to = (i + TABS.length - 1) % TABS.length;
        else if (k === 'Home') to = 0;
        else if (k === 'End') to = TABS.length - 1;
        if (to < 0) return;
        e.preventDefault();
        select(TABS[to], true);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && o.classList.contains('open') && ownsFocus(o)) close(); });
    installFocusTrap(o, () => o.classList.contains('open') && ownsFocus(o));
    _overlay = o;
    paintShell();
    return o;
}

/** The dialog's own words (title, state line, tabs, close); the panes hold the cards. */
function paintShell(): void {
    const o = _overlay;
    if (!o) return;
    const title = o.querySelector('#laya-title');
    if (title) title.textContent = t('ai.hub.title');
    o.querySelector('#laya-close')?.setAttribute('aria-label', t('common.close'));
    o.querySelector('.laya-tabs')?.setAttribute('aria-label', t('ai.hub.tabsAria'));
    for (const k of TABS) {
        const b = o.querySelector(`#laya-tab-${k}`);
        if (b) b.textContent = tabName(k);
    }
    paintHead();
    select(_tab);
}

/** Header: what the dialog is for, and the on/off chip read from the Overview card. */
function paintHead(): void {
    const o = _overlay;
    if (!o) return;
    const sub = o.querySelector('#laya-sub');
    if (sub) sub.textContent = t('ai.hub.lead');
    const pill = o.querySelector('#ai-pill');
    const chip = o.querySelector<HTMLElement>('#laya-head-chip');
    if (chip) {
        chip.hidden = !pill;
        chip.className = `bms-chip${pill?.classList.contains('ai-pill-on') ? ' bms-chip--ok' : ''}`;
        const label = chip.querySelector('span:last-child');
        if (label) label.textContent = (pill?.textContent || '').trim();
    }
}

function select(tab: Tab, focus = false): void {
    const o = _overlay;
    if (!o || !TABS.includes(tab)) return;
    _tab = tab;
    for (const k of TABS) {
        const b = o.querySelector<HTMLButtonElement>(`#laya-tab-${k}`);
        const on = k === tab;
        b?.classList.toggle('is-on', on);
        b?.setAttribute('aria-selected', String(on));
        b?.setAttribute('tabindex', on ? '0' : '-1');
        const pane = o.querySelector<HTMLElement>(`#laya-pane-${k}`);
        if (pane) pane.hidden = !on;
    }
    const body = o.querySelector<HTMLElement>('.laya-body');
    if (body) body.scrollTop = 0;
    if (focus) o.querySelector<HTMLElement>(`#laya-tab-${tab}`)?.focus();
}

export function openLaya(tab?: Tab): void {
    const o = overlay();
    if (tab) select(tab);
    _opener = document.activeElement as HTMLElement | null;
    paintHead();
    o.classList.add('open');
    o.querySelector<HTMLElement>(`#laya-tab-${_tab}`)?.focus();
}

function close(): void {
    if (!_overlay?.classList.contains('open')) return;
    _overlay.classList.remove('open');
    // The summary is redrawn here, which replaces the button that opened the dialog: hand
    // focus back to its new copy (same data-open, or « Gérer Laya »).
    const key = _opener?.closest('#' + CARD_ID) ? (_opener.dataset.open || '') : null;
    paintCard();
    const back = key === null ? _opener
        : document.querySelector<HTMLElement>(key ? `#${CARD_ID} [data-open="${key}"]` : `#${CARD_ID} #laya-open`);
    _opener = null;
    try { if (back?.isConnected) back.focus(); } catch { /* nothing to return to */ }
}

// ── The Settings card ────────────────────────────────────────────────────────

function paintCard(): void {
    const card = document.getElementById(CARD_ID);
    if (!card) return;
    const pill = _overlay?.querySelector('#ai-pill');
    const on = !!pill?.classList.contains('ai-pill-on');
    const rows = TABS.map((k) => {
        const v = textOf(SOURCE[k]) || t('ai.settings.unavailable');
        return `<button type="button" class="laya-sum-row" data-open="${k}"><b>${escHtml(tabName(k))}</b><span>${escHtml(v)}</span></button>`;
    }).join('');
    card.innerHTML = `
      <h3 class="card-title ai-card-title"><span class="laya-sum-ic" aria-hidden="true">${IC}</span><span>${escHtml(t('ai.hub.title'))}</span>
        ${pill ? `<span class="ai-pill${on ? ' ai-pill-on' : ''}">${escHtml(pill.textContent || '')}</span>` : ''}</h3>
      <p class="ai-muted">${escHtml(t('ai.hub.lead'))}</p>
      <div class="laya-sum">${rows}</div>
      <div class="ai-actions">
        <button type="button" class="btn btn-primary btn-sm" id="laya-open" aria-haspopup="dialog">${escHtml(t('ai.hub.manage'))}</button>
      </div>`;
    card.querySelector('#laya-open')?.addEventListener('click', () => openLaya());
    card.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => openLaya(b.dataset.open as Tab)));
    // Redrawn whole: fold again, or the card loses its chevron (see ai-settings.ts refold).
    try { initCollapsibleSettingsCards(); } catch { /* no Settings view */ }
}

/** The summary card (after Privacy), the dialog, and the cards in its panes. */
export async function mountLayaHub(): Promise<void> {
    // The debug menu's « Laya » section (features/ai/laya-debug.ts): registered once, at the
    // same boot step as this card; a no-op until the debug menu exposes its registry.
    void import('./laya-debug.js').then((m) => m.registerLayaDebug()).catch(() => {});
    const host = document.querySelector('#view-settings .settings-sections');
    if (!host) return;
    ensureAiCss();
    let card = document.getElementById(CARD_ID);
    if (!card) {
        card = document.createElement('div');
        card.className = 'glass-card ai-card laya-hub';
        card.id = CARD_ID;
        const after = document.getElementById('settings-privacy-section');
        if (after && after.parentElement === host) after.insertAdjacentElement('afterend', card);
        else host.appendChild(card);
    }
    const o = overlay();
    const pane = (k: Tab) => o.querySelector<HTMLElement>(`#laya-pane-${k}`) as HTMLElement;
    try { await (await import('./ai-settings.js')).mountAiSettings(pane('general')); } catch (e) { /* card shows nothing */ }
    try { await (await import('./ai-tuning.js')).mountLayaTuning(pane('answers'), pane('tasks')); } catch (e) { /* idem */ }
    try { await (await import('../settings/ai-api-card.js')).mountAiApiCard(pane('api')); } catch (e) { /* idem */ }
    paintCard();
    paintHead();
    if (!(card as any)._layaWired) {
        (card as any)._layaWired = true;
        // The cards repaint on their own (a save, an install, the API starting): follow them,
        // batched, so the summary and the header never show a state the dialog no longer does.
        let pending = false;
        new MutationObserver(() => {
            if (pending) return;
            pending = true;
            queueMicrotask(() => { pending = false; paintCard(); paintHead(); });
        }).observe(o.querySelector('.laya-body') as HTMLElement, { childList: true, subtree: true, characterData: true });
        document.addEventListener('langChanged', () => { paintShell(); paintCard(); });
    }
}
