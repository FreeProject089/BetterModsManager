// settings-fold.ts — make the Settings "glass cards" collapsible to cut visual clutter.
//
// Non-invasive: instead of editing every card's markup, we enhance each top-level
// `#view-settings .glass-card` that has a direct `.card-title` — inject a chevron,
// toggle a `bmm-collapsed` class, and remember the state per card in localStorage.

const KEY_PREFIX = 'bmm_fold_';

const CHEVRON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

/** Stable per-card key: prefer the card id, else the title's i18n key, else its text. */
function cardKey(card: HTMLElement, title: HTMLElement): string {
    const id = card.id
        || title.querySelector('[data-i18n]')?.getAttribute('data-i18n')
        || (title.textContent || '').trim().slice(0, 48);
    return KEY_PREFIX + id;
}

/** Idempotent — safe to call multiple times (e.g. after settings re-renders). */
export function initCollapsibleSettingsCards(): void {
    const view = document.getElementById('view-settings');
    if (!view) return;

    view.querySelectorAll('.glass-card').forEach((el) => {
        const card = el as HTMLElement;
        const title = card.querySelector(':scope > .card-title') as HTMLElement | null;
        if (!title || title.querySelector('.bmm-fold-chevron')) return; // need a direct title, once

        card.classList.add('bmm-foldable');
        const key = cardKey(card, title);

        const chev = document.createElement('button');
        chev.type = 'button';
        chev.className = 'bmm-fold-chevron';
        chev.setAttribute('aria-label', 'Collapse / expand');
        chev.innerHTML = CHEVRON;
        title.appendChild(chev);

        if (localStorage.getItem(key) === '1') card.classList.add('bmm-collapsed');

        const toggle = () => {
            const collapsed = card.classList.toggle('bmm-collapsed');
            try { localStorage.setItem(key, collapsed ? '1' : '0'); } catch { /* ignore */ }
        };
        // Click the chevron, or the title background (but not interactive controls in it).
        title.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            if (t.closest('a, input, select, textarea') ||
                t.closest('button:not(.bmm-fold-chevron)')) return;
            toggle();
        });
    });
}
