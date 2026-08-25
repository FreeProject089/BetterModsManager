// dismissible-tip.ts — a help banner the user can put away, and get back.
//
// (importing t: the × injected below needs an accessible name, and an aria-label is one
// of the two places the hardcoded-text checker cannot see a missing translation.)
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

import { t } from '../core/i18n.js';

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

/** Where a single tip's "put away" preference lives. One shape, so the restore can find them. */
const TIP_KEY = (id: string) => `bmm_tip_${id}`;

/**
 * Give every `.bmm-tip[data-tip-id]` on the page its own ×.
 *
 * The Settings switch hides ALL tips or none, which is the wrong granularity for the only
 * thing people actually want: this one box, the one explaining something they read three
 * weeks ago, gone — while the tips on screens they have not learnt yet stay. A tip earns
 * its space once; after that it is a paragraph between you and the control you came for.
 *
 * The button is injected rather than written into the markup 25 times, so a new callout
 * becomes dismissible by carrying one attribute.
 *
 * Idempotent: safe to call again after a view re-renders.
 */
export function wireTipDismissal(root: ParentNode = document): void {
    const tips = Array.from(root.querySelectorAll('.bmm-tip[data-tip-id]')) as HTMLElement[];
    for (const tip of tips) {
        const id = tip.dataset.tipId || '';
        if (!id) continue;
        let hidden = false;
        try { hidden = localStorage.getItem(TIP_KEY(id)) === '1'; } catch { /* default: shown */ }
        // display:none is already used by some callouts for their own reasons (the repo-sync
        // hint starts hidden and is shown by its own code). Marking dismissal with a CLASS
        // instead means putting a tip away can never fight that logic, and un-hiding it
        // cannot accidentally reveal something the app meant to keep hidden.
        tip.classList.toggle('tip-dismissed', hidden);

        if (tip.querySelector(':scope > .bmm-tip-close')) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bmm-tip-close';
        btn.setAttribute('aria-label', t('settings.tipHide'));
        btn.dataset.i18nTooltip = 'settings.tipHide';
        btn.dataset.tooltip = t('settings.tipHide');
        btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        btn.addEventListener('click', () => {
            try { localStorage.setItem(TIP_KEY(id), '1'); } catch { /* preference only */ }
            tip.classList.add('tip-dismissed');
        });
        tip.appendChild(btn);
    }
}

/**
 * Bring back every tip that was put away, one at a time or by the banner helper above.
 *
 * A dismissal with no way back is a feature you can only use wrong once — and with the ×
 * spread across a dozen screens, "go and find each one again" is not a way back.
 */
export function restoreAllTips(): number {
    let n = 0;
    try {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith('bmm_tip_'));
        for (const k of keys) { localStorage.removeItem(k); n++; }
    } catch { return 0; }
    for (const el of Array.from(document.querySelectorAll('.tip-dismissed'))) {
        el.classList.remove('tip-dismissed');
    }
    // The banner form (mapper, server repo, the conflict legend) hides with `hidden` and
    // pairs with a "show it again" pill, so both halves have to be put back too.
    for (const el of Array.from(document.querySelectorAll('[data-tip-banner]'))) {
        (el as HTMLElement).hidden = false;
    }
    for (const el of Array.from(document.querySelectorAll('[data-tip-restore]'))) {
        (el as HTMLElement).hidden = true;
    }
    return n;
}
