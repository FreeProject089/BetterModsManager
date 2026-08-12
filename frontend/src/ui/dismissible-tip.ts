// dismissible-tip.ts — a help banner the user can put away, and get back.
//
// A tip banner earns its space exactly once. After that it is a permanent block of
// text explaining something you already know, sitting above the thing you actually
// came to use. Hiding it has to be possible, and un-hiding it has to be findable —
// a dismissal with no way back is a feature you can only use wrong once.
//
// The mapper grew this first. When the server repo needed the same thing, copying
// the ~15 lines would have made it the second of an eventual three, each free to
// drift in its storage key, its default and its show/hide semantics. One function
// instead: a caller names its elements and its key, and any later change — an
// animation, a keyboard affordance, syncing the state across views — lands once.

export function wireDismissibleTip(opts: {
    /** The banner itself. */
    bannerId: string;
    /** The × inside it. */
    closeId: string;
    /** The pill that brings it back. */
    showId: string;
    /** Where the preference lives. */
    storageKey: string;
}): void {
    const banner = document.getElementById(opts.bannerId);
    const close = document.getElementById(opts.closeId);
    const show = document.getElementById(opts.showId);
    if (!banner) return;

    // `hidden` rather than a class: it is the attribute that means this, so it also
    // takes the element out of the accessibility tree instead of merely un-painting
    // it. A screen reader should not still be reading a tip the user dismissed.
    const apply = (hide: boolean) => {
        banner.hidden = hide;
        if (show) show.hidden = !hide;
    };

    // A read that throws (private mode, a locked-down profile) must not leave the
    // banner in an undefined state — the visible default is "shown", which is also
    // the right answer for a user we know nothing about yet.
    try { apply(localStorage.getItem(opts.storageKey) === '1'); } catch { apply(false); }

    close?.addEventListener('click', () => {
        try { localStorage.setItem(opts.storageKey, '1'); } catch { /* preference only */ }
        apply(true);
    });
    show?.addEventListener('click', () => {
        try { localStorage.removeItem(opts.storageKey); } catch { /* preference only */ }
        apply(false);
    });
}
