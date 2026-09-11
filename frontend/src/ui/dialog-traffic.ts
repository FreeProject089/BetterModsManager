// dialog-traffic.ts — "is anything already on screen?", asked in one place.
//
// Three different files had their own answer and all three were wrong in a different way.
// Ko-fi looked for `#onboarding-overlay` and nothing else. The BetterCommunity screen looked
// for a list of selectors, at a moment 900 ms BEFORE it opened. Onboarding did not look at
// all — which is how reporting a crash after a factory reset ended with the welcome tour
// painted over the report you were in the middle of writing.
//
// VISIBILITY, NOT PRESENCE. BMM's dialogs are markup that always exists and is shown by adding
// `.open`; some are built once and kept. So `querySelector('.modal')` finds a dialog that was
// closed ten minutes ago, and a check written that way never lets anything open again — a
// failure that looks exactly like the feature being broken. `getClientRects()` answers the
// question actually being asked, for `display:none`, for detached nodes, and for the
// hand-built overlays with inline styles. It is also the reason `offsetParent` is not used:
// that is null for every `position:fixed` element, which is all of these.
//
// Adding a dialog to this list is a one-line change; forgetting to is the bug that keeps
// happening, so the selector is broad on purpose and matches by role as well as by id.

/** Everything that counts as "a dialog is up". Broad on purpose — see the note above. */
const DIALOG_SELECTOR = [
    '.modal-overlay',        // every static modal in index.html (shown with .open)
    '#onboarding-overlay',   // the first-run tour
    '.ptb-modal',            // the PTB-mode notice
    '#upd-card',             // the update-notes card
    '#bc-link-modal',        // the account pairing code
    '#bc-discord-modal',     // the Discord pairing code
    '#kofi-overlay',         // the Ko-fi nudge
    '[role="dialog"]',       // anything that says so itself
].join(', ');

function onScreen(el: Element): boolean {
    // Cheap and honest: zero rects covers display:none, a detached node, and an ancestor that
    // is hidden. A layout read, but this runs a handful of times at boot, not in a loop.
    return (el as HTMLElement).getClientRects().length > 0;
}

/** The dialog currently on screen, or null. `except` skips one you are about to open. */
export function dialogOnScreen(except?: Element | null): HTMLElement | null {
    for (const el of Array.from(document.querySelectorAll(DIALOG_SELECTOR))) {
        if (except && (el === except || el.contains(except) || except.contains(el))) continue;
        if (onScreen(el)) return el as HTMLElement;
    }
    return null;
}

/** Is anything up? */
export function isDialogOnScreen(except?: Element | null): boolean {
    return dialogOnScreen(except) !== null;
}

/**
 * Resolve once nothing is on screen.
 *
 * For the things that must happen but must not interrupt — the first-run tour is the case
 * that produced this: skipping it would leave a new install with no tour at all, so it waits
 * its turn instead. A MutationObserver rather than a poll, because a dialog closes by having
 * its class or its inline style changed and both are attribute mutations; the interval is a
 * belt-and-braces fallback for a close that happens without touching this subtree.
 *
 * `timeoutMs` is a ceiling, not a promise of a clear screen: after it, the caller proceeds
 * anyway. Waiting forever would be its own bug — a dialog somebody left open would silently
 * mean the tour never runs, and nobody would ever find out why.
 */
export function whenDialogsClear(timeoutMs = 5 * 60_000): Promise<void> {
    if (!isDialogOnScreen()) return Promise.resolve();
    return new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
            if (done) return;
            done = true;
            obs.disconnect();
            window.clearInterval(tick);
            window.clearTimeout(cap);
            resolve();
        };
        const check = (): void => { if (!isDialogOnScreen()) finish(); };
        const obs = new MutationObserver(check);
        obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        const tick = window.setInterval(check, 500);
        const cap = window.setTimeout(finish, timeoutMs);
    });
}
