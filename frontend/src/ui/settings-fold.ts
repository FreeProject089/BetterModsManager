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

/** Idempotent — safe to call multiple times (e.g. after settings re-renders).
 *  Handles cards whose `.card-title` is a direct child AND cards whose title sits in a
 *  header row (e.g. title + a badge), by folding around the title's direct-child header. */
export function initCollapsibleSettingsCards(): void {
    const view = document.getElementById('view-settings');
    if (!view) return;

    view.querySelectorAll('.glass-card').forEach((el) => {
        const card = el as HTMLElement;
        if (card.querySelector(':scope > .bmm-fold-head')) return; // already processed (once)

        // The card's OWN title (not a nested glass-card's).
        const title = Array.from(card.querySelectorAll('.card-title'))
            .find((t) => (t as HTMLElement).closest('.glass-card') === card) as HTMLElement | undefined;
        if (!title) return;

        // The direct child of the card that contains the title = the row we keep visible
        // when collapsed (it may be the title itself, or a header wrapping title + a badge).
        let head: HTMLElement = title;
        while (head.parentElement && head.parentElement !== card) head = head.parentElement;
        if (head.parentElement !== card) return; // title isn't in this card's own subtree

        head.classList.add('bmm-fold-head');
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
        // Click the header row (but not interactive controls / a nested card in it).
        head.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            if (t.closest('a, input, select, textarea')) return;
            if (t.closest('button:not(.bmm-fold-chevron)')) return;
            if (t.closest('.glass-card') !== card) return; // ignore clicks inside a nested card
            toggle();
        });
    });
}
