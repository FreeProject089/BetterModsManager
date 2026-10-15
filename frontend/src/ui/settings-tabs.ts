// settings-tabs.ts — a Settings card split into a few named panes, and « More options » folds.
//
// « Interface & notifications » holds four unrelated blocks (notifications, Tasky, sound, the
// library toolbar). Stacked, they were a long run of look-alike switches; as panes, one block is
// on screen at a time and the segmented control above names the others. The rarely used rows of
// a pane sit behind « More options » (.stg-more-row), so the first screen of each pane is short.
//
// Markup (index.html): `.stg-tabs[role=tablist] > .stg-tab[role=tab][aria-controls]` and
// `.stg-pane[role=tabpanel]` siblings. Nothing else changes: rows keep their ids and listeners,
// and every stored setting is read and written where it was.
//
// Two things must still reach a row in a pane that is not shown:
//   · the Settings search, which shows every pane and every « more » row while it lasts
//     (CSS on `.stg-searching`, settings-page.css);
//   · a jump to a row (goToSettings, the palette's in-page hits), which fires `bmm:reveal` on the
//     target; the pane holding it is selected and its « more » rows unfolded.

import { t } from '../core/i18n.js';

const LS = 'bmm_stg_tab_';
let _wired = false;

function storeKey(list: HTMLElement): string {
    const card = list.closest('.glass-card') as HTMLElement | null;
    return LS + (card?.dataset.cardKey || card?.id || list.id || 'card');
}

function select(tab: HTMLElement, focus = false, remember = true): void {
    const list = tab.closest('.stg-tabs') as HTMLElement | null;
    if (!list) return;
    for (const other of Array.from(list.querySelectorAll<HTMLElement>('.stg-tab'))) {
        const on = other === tab;
        other.setAttribute('aria-selected', on ? 'true' : 'false');
        other.tabIndex = on ? 0 : -1;
        const pane = document.getElementById(other.getAttribute('aria-controls') || '');
        pane?.classList.toggle('is-active', on);
    }
    if (focus) tab.focus();
    if (remember) { try { localStorage.setItem(storeKey(list), tab.id); } catch { /* private mode */ } }
}

function setMore(pane: HTMLElement, open: boolean): void {
    pane.classList.toggle('is-more', open);
    const btn = pane.querySelector<HTMLElement>('.stg-more-toggle');
    if (!btn) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    const key = open ? 'settings.fewerOptions' : 'settings.moreOptions';
    btn.setAttribute('data-i18n', key);
    btn.textContent = t(key);
}

/** Select the pane that holds `el`, and unfold its « more » rows if `el` is one of them. */
function revealIn(el: HTMLElement): void {
    const pane = el.closest('.stg-pane') as HTMLElement | null;
    if (!pane) return;
    if (!pane.classList.contains('is-active')) {
        const tab = document.getElementById(pane.getAttribute('aria-labelledby') || '');
        if (tab) select(tab, false, false);
    }
    if (el.closest('.stg-more-row') && !pane.classList.contains('is-more')) setMore(pane, true);
}

/** Idempotent. Restores each card's last pane, then wires clicks, arrow keys and reveals. */
export function initSettingsTabs(): void {
    document.querySelectorAll<HTMLElement>('#view-settings .stg-tabs').forEach((list) => {
        let saved = '';
        try { saved = localStorage.getItem(storeKey(list)) || ''; } catch { /* private mode */ }
        const tab = saved ? list.querySelector<HTMLElement>(`#${CSS.escape(saved)}`) : null;
        if (tab) select(tab, false, false);
    });
    if (_wired) return;
    _wired = true;

    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        const tab = target?.closest?.('#view-settings .stg-tab') as HTMLElement | null;
        if (tab) { select(tab); return; }
        const more = target?.closest?.('#view-settings .stg-more-toggle') as HTMLElement | null;
        if (more) {
            const pane = more.closest('.stg-pane') as HTMLElement | null;
            if (pane) setMore(pane, !pane.classList.contains('is-more'));
        }
    });
    // The tablist pattern: Left/Right (and Home/End) move between panes.
    document.addEventListener('keydown', (e) => {
        const tab = (e.target as HTMLElement | null)?.closest?.('#view-settings .stg-tab') as HTMLElement | null;
        if (!tab) return;
        const tabs = Array.from(tab.closest('.stg-tabs')?.querySelectorAll<HTMLElement>('.stg-tab') || []);
        const i = tabs.indexOf(tab);
        let next = -1;
        if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault();
        select(tabs[next], true);
    });
    document.addEventListener('bmm:reveal', (e) => {
        const el = e.target as HTMLElement | null;
        if (el?.closest?.('#view-settings')) revealIn(el);
    });
    document.addEventListener('langChanged', () => {
        document.querySelectorAll<HTMLElement>('#view-settings .stg-pane').forEach((p) => {
            if (p.querySelector('.stg-more-toggle')) setMore(p, p.classList.contains('is-more'));
        });
    });
}
