// settings-link.ts — every « go to Settings » button goes through here.
//
// There were seventeen copies of the same two lines: click #nav-settings, then 250 ms later
// scrollIntoView on #settings-identity-card. Each copy was a chance to break, and they did:
//   · switching views resets the content area's scroll AFTER the view is shown, so a scroll
//     issued on a timer could land and be undone, and the reader arrived at the top of a very
//     long page with nothing to say why;
//   · a card hidden from the layout (card-order.ts), filtered out by the Settings search or
//     folded (settings-fold.ts) has no box to scroll to, so the jump went nowhere;
//   · two catalogue screens passed no destination at all, and « Manage keys » did nothing.
// One function, one rule: show the view, make the target visible, scroll, then CHECK that it is
// on screen, and retry while it is not.
//
// core/, DOM only: no ui/ import (the dep-graph gate counts core -> ui edges). Every target is
// an id written as a literal at the call site, so tests/settings-links.test.mjs can check that
// it still exists in the markup.

/** The keyring row of Settings → Identity & API: where identity keys are listed and made. */
export const KEYRING_TARGET = 'sic-keyring-list';

export interface SettingsLinkOptions {
    /** Id of a closed <details> to open once there (for example the « Create one… » fold). */
    open?: string;
    /** Id of a control to focus once there. */
    focus?: string;
}

function settingsCardOf(el: HTMLElement): HTMLElement | null {
    return el.closest('#view-settings .settings-sections > .glass-card') as HTMLElement | null;
}

/** Undo whatever hides `el` on the Settings page, for this visit only. */
function reveal(el: HTMLElement): void {
    const card = settingsCardOf(el);
    if (card) {
        // Hidden from the layout: shown for this visit, the saved layout untouched.
        card.classList.add('stg-card-peek');
        // Filtered out by the Settings search: the search is cleared, the way the search's own
        // clear button does it, so the index and the page agree again.
        if (card.classList.contains('stg-filtered-out')) {
            const input = document.getElementById('settings-search') as HTMLInputElement | null;
            if (input) {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        // Folded: unfolded through its own chevron, so the fold state is saved as usual.
        if (card.classList.contains('bmm-collapsed')) {
            (card.querySelector('.bmm-fold-chevron') as HTMLElement | null)?.click();
        }
    }
    // A target in a pane that is not shown, or behind « More options » (ui/settings-tabs.ts).
    el.dispatchEvent(new CustomEvent('bmm:reveal', { bubbles: true }));
    // A target inside a closed <details> has no box either.
    for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) {
        (d as HTMLDetailsElement).open = true;
    }
}

function onScreen(el: HTMLElement): boolean {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    // A detached or display:none element reports a rect of zeros; `top === 0` is not « at the
    // top of the screen ».
    return r.height > 0 && r.bottom > 40 && r.top < window.innerHeight - 40;
}

/**
 * Open Settings and bring `target` (any id inside the Settings view, a card or a row) into
 * view. Without a target, only the view is opened.
 */
export function goToSettings(target?: string, opts: SettingsLinkOptions = {}): void {
    const nav = (document.getElementById('nav-settings')
        || document.querySelector('.nav-item[data-view="settings"]')) as HTMLElement | null;
    const view = document.getElementById('view-settings');
    if (!view?.classList.contains('active')) nav?.click();
    if (!target) return;

    let tries = 0;
    let revealed = false;
    let landed = false;
    const step = () => {
        const el = document.getElementById(target);
        const shown = !!view?.classList.contains('active');
        if (el && shown) {
            if (!revealed) {
                reveal(el);
                if (opts.open) {
                    const d = document.getElementById(opts.open) as HTMLDetailsElement | null;
                    if (d && 'open' in d) d.open = true;
                }
                revealed = true;
            }
            // Instant, not smooth: a smooth ride is still moving when the check below runs, and
            // the page is long enough for the ride to be the slow part.
            // A target taller than most of the screen (a whole list) starts at the top, not with
            // its middle in view and its heading far above.
            el.scrollIntoView({ block: el.getBoundingClientRect().height > window.innerHeight * 0.6 ? 'start' : 'center' });
            if (onScreen(el)) {
                if (!landed) {
                    landed = true;
                    const card = settingsCardOf(el) || el;
                    card.classList.remove('stg-flash');
                    void card.offsetWidth;
                    card.classList.add('stg-flash');
                    setTimeout(() => card.classList.remove('stg-flash'), 1200);
                    if (opts.focus) (document.getElementById(opts.focus) as HTMLElement | null)?.focus({ preventScroll: true });
                    // Checked once more after the view switch's own scroll reset has had its turn.
                    setTimeout(step, 150);
                }
                return;
            }
        }
        if (++tries < 40) setTimeout(step, 100);
        else console.warn(`[settings-link] "${target}" never became visible on the Settings page.`);
    };
    setTimeout(step, 0);
}

/**
 * « Manage keys »: Settings → Identity & API, on the keyring row. With an empty ring the
 * « Create one… » fold is opened, because making a key is the only thing to do there.
 */
export function openKeyManager(): void {
    goToSettings('sic-keyring-list');
    void import('./identity-key.js')
        .then((kr) => kr.listKeyring())
        .then((v) => {
            if (v.keys.length) return;
            const make = document.getElementById('sic-make') as HTMLDetailsElement | null;
            if (make) make.open = true;
        })
        .catch(() => { /* the row itself says why the ring could not be read */ });
}
