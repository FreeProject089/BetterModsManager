// focus-trap.ts — keep Tab inside a dialog that says aria-modal="true".
//
// A dialog that declares itself modal and lets Tab walk out of it onto the title bar and the
// sidebar behind is lying to a keyboard or screen-reader user: the focus lands on controls they
// cannot see and are told do not exist. The launch deck carries its own trap; the views added
// after it (the activation order, …) share this one.
//
// Import-free, so the pure part (`wrapIndex`) loads in plain node for the tests.

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab (or Shift+Tab) goes from position `current` in a list of `count` stops, or -1 when
 * the browser should be left to do it (focus stays inside without help). `current` is -1 when
 * the focus is not on one of the stops at all — outside the dialog, or on its non-focusable
 * body — and then the first (or, backwards, the last) stop takes it.
 */
export function wrapIndex(count: number, current: number, backwards: boolean): number {
    if (count <= 0) return -1;
    if (current < 0) return backwards ? count - 1 : 0;
    if (backwards && current === 0) return count - 1;
    if (!backwards && current === count - 1) return 0;
    return -1;
}

/** The stops Tab can reach inside `root`, in document order, skipping hidden ones. */
export function focusStops(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);
}

/**
 * Whether `root` should own the keyboard now: the focus is in it, or on the page behind it
 * (the body, the sidebar) — not inside ANOTHER dialog opened over it (a confirmation, a
 * picker), which owns its own keys.
 */
export function ownsFocus(root: HTMLElement): boolean {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || root.contains(a)) return true;
    return !a.closest('.modal-overlay, [role="dialog"], [aria-modal="true"]');
}

/**
 * Trap Tab inside `root` while `active()` says so. Returns the function that removes the trap.
 * Capture phase on the document, so a Tab that starts outside the dialog (focus lost to the body
 * after a re-render) is brought back in rather than continuing through the page.
 */
export function installFocusTrap(root: HTMLElement, active: () => boolean = () => root.isConnected): () => void {
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Tab' || e.defaultPrevented) return;
        let on = false;
        try { on = active(); } catch { on = false; }
        if (!on) return;
        const stops = focusStops(root);
        if (!stops.length) { e.preventDefault(); return; }
        const current = stops.indexOf(document.activeElement as HTMLElement);
        const outside = !root.contains(document.activeElement);
        const to = wrapIndex(stops.length, outside ? -1 : current, e.shiftKey);
        if (to < 0) return;
        e.preventDefault();
        stops[to].focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
}
