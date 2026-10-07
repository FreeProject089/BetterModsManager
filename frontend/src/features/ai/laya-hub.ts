// laya-hub.ts — the one « Laya » card in Settings, and the dialog behind it.
//
// Laya used to be three Settings cards in a row (the AI card, « Réponses de Laya », « API Laya
// locale »), each long, which read as Laya spread all over the page. Now Settings shows one
// short card — the master state and one line per part — and « Gérer Laya » opens a dialog with
// the three as tabs. The cards themselves are unchanged: they are mounted once, into the
// dialog's panes, and re-render there exactly as they did on the page.
//
// The summary card keeps the old AI card's id, so a saved card order, the Ask index and the
// command palette still find it where they did.
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { ensureAiCss } from './ai-shared.js';
import { installFocusTrap, ownsFocus } from '../../ui/focus-trap.js';
import { initCollapsibleSettingsCards } from '../../ui/settings-fold.js';

const CARD_ID = 'settings-ai-section';

const IC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>';

type Tab = 'general' | 'answers' | 'api';
const TABS: Tab[] = ['general', 'answers', 'api'];
/** Where each tab's figures are read from, in the mounted cards (their own pills). */
const SOURCE: Record<Tab, string> = { general: '#ai-statusline', answers: '#lt-pill', api: '#ai-api-pill' };

let _overlay: HTMLElement | null = null;
let _opener: HTMLElement | null = null;
let _tab: Tab = 'general';

function tabName(tab: Tab): string {
    return tab === 'general' ? t('ai.hub.tabGeneral') : tab === 'answers' ? t('ai.hub.tabAnswers') : t('ai.hub.tabApi');
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
    o.innerHTML = `
      <div class="modal ai-modal laya-modal" role="dialog" aria-modal="true" aria-labelledby="laya-title">
        <div class="modal-header">
          <h3 class="modal-title ai-title" id="laya-title">${IC}<span></span></h3>
          <button type="button" class="modal-close" id="laya-close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="laya-tabs" role="tablist">
          ${TABS.map((k) => `<button type="button" class="laya-tab" role="tab" id="laya-tab-${k}" data-tab="${k}" aria-controls="laya-pane-${k}"></button>`).join('')}
        </div>
        <div class="modal-body laya-body">
          ${TABS.map((k) => `<div class="laya-pane" role="tabpanel" id="laya-pane-${k}" aria-labelledby="laya-tab-${k}" hidden></div>`).join('')}
        </div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o) close(); });
    o.querySelector('#laya-close')?.addEventListener('click', close);
    o.querySelectorAll<HTMLButtonElement>('.laya-tab').forEach((b) => b.addEventListener('click', () => select(b.dataset.tab as Tab)));
    // Arrow keys move along the tabs, as a tablist does.
    o.querySelector('.laya-tabs')?.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
        e.preventDefault();
        const i = TABS.indexOf(_tab);
        select(TABS[(i + (k === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length], true);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && o.classList.contains('open') && ownsFocus(o)) close(); });
    installFocusTrap(o, () => o.classList.contains('open') && ownsFocus(o));
    _overlay = o;
    paintShell();
    return o;
}

/** The dialog's own words (title, tabs, close); the panes hold the cards and are left alone. */
function paintShell(): void {
    const o = _overlay;
    if (!o) return;
    const title = o.querySelector('#laya-title span');
    if (title) title.textContent = t('ai.hub.title');
    o.querySelector('#laya-close')?.setAttribute('aria-label', t('common.close'));
    o.querySelector('.laya-tabs')?.setAttribute('aria-label', t('ai.hub.tabsAria'));
    for (const k of TABS) {
        const b = o.querySelector(`#laya-tab-${k}`);
        if (b) b.textContent = tabName(k);
    }
    select(_tab);
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
    if (focus) o.querySelector<HTMLElement>(`#laya-tab-${tab}`)?.focus();
}

export function openLaya(tab?: Tab): void {
    const o = overlay();
    if (tab) select(tab);
    _opener = document.activeElement as HTMLElement | null;
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
      <h3 class="card-title ai-card-title">${IC}<span>${escHtml(t('ai.hub.title'))}</span>
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

/** The summary card (after Privacy), the dialog, and the three cards in its panes. */
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
    try { await (await import('./ai-tuning.js')).mountLayaTuning(pane('answers')); } catch (e) { /* idem */ }
    try { await (await import('../settings/ai-api-card.js')).mountAiApiCard(pane('api')); } catch (e) { /* idem */ }
    paintCard();
    if (!(card as any)._layaWired) {
        (card as any)._layaWired = true;
        // The cards repaint on their own (a save, an install, the API starting): follow them,
        // batched, so the summary never shows a state the dialog no longer does.
        let pending = false;
        new MutationObserver(() => {
            if (pending) return;
            pending = true;
            queueMicrotask(() => { pending = false; paintCard(); });
        }).observe(o.querySelector('.laya-body') as HTMLElement, { childList: true, subtree: true, characterData: true });
        document.addEventListener('langChanged', () => { paintShell(); paintCard(); });
    }
}
