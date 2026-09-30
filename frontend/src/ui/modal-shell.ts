// modal-shell.ts — one way to behave for every dialog: Escape closes the TOP one, Tab stays
// inside it, the focus goes in when it opens and comes back where it was when it closes.
//
// The look lives in css/modal-shell.css (linked once, at boot, by initModals). This module is
// the behaviour half, in two sizes:
//
//   · bindModal(overlay, { onClose }) — for a dialog a feature builds itself. The feature keeps
//     its own close function (it usually has cleanup to run); this only decides WHEN to call
//     it and puts the focus back afterwards.
//   · installGlobalModalKeys() — for the static modals in index.html that never had any of it:
//     a Tab trap on whichever house overlay is on top, and an accessible name on close buttons
//     that were a bare "×". No Escape here: a static modal may need its own cleanup to run, and
//     closing it behind the feature's back is how state leaks (see modals.ts, confirmCustom).
//
// Import-light on purpose (focus-trap only), so the pure part (`topmostOf`) loads in node.

import { focusStops, wrapIndex, ownsFocus } from './focus-trap.js';

const CSS_ID = 'modal-shell-css';

/** Link css/modal-shell.css once. Appended after the static stylesheets, so the polish layer
 *  wins over main.css at equal specificity and loses to any feature rule that is stricter. */
export function ensureModalShellCss(): void {
    if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/modal-shell.css';
    document.head.appendChild(link);
}

/**
 * Which of several stacked layers is on top: the highest z-index, and among equals the one
 * later in the document (it paints last). `layers` is [zIndex, documentOrder]. Pure.
 */
export function topmostOf(layers: Array<[number, number]>): number {
    let best = -1;
    for (let i = 0; i < layers.length; i++) {
        if (best < 0) { best = i; continue; }
        const [z, o] = layers[i];
        const [bz, bo] = layers[best];
        if (z > bz || (z === bz && o > bo)) best = i;
    }
    return best;
}

/** The open house overlays that are actually painted (both families: .modal-overlay and the
 *  older .modal-generic-overlay the mapper and the pickers use). */
function openOverlays(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('.modal-overlay, .modal-generic-overlay')].filter((o) => {
        if (!o.isConnected) return false;
        const cs = getComputedStyle(o);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && o.getClientRects().length > 0;
    });
}

/** The overlay on top right now, or null. */
export function topOverlay(): HTMLElement | null {
    const list = openOverlays();
    const i = topmostOf(list.map((o, n) => [Number.parseInt(getComputedStyle(o).zIndex, 10) || 0, n]));
    return i < 0 ? null : list[i];
}

export interface BindOptions {
    /** The feature's own close. Called by Escape (when this overlay is on top). */
    onClose: () => void;
    /** What takes the focus on open. Default: the first control in the dialog body, else the
     *  close button. */
    initialFocus?: HTMLElement | null;
}

/**
 * Give a feature-built dialog the house behaviour. Returns `release`, to call from the
 * feature's close: it removes the listeners and puts the focus back where it was.
 * Calling bindModal twice on one overlay releases the first binding.
 */
const bound = new WeakMap<HTMLElement, () => void>();
export function bindModal(overlay: HTMLElement, opts: BindOptions): () => void {
    bound.get(overlay)?.();
    const dialog = overlay.querySelector<HTMLElement>('.modal') || overlay;
    const back = document.activeElement as HTMLElement | null;
    dialog.setAttribute('role', dialog.getAttribute('role') || 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = dialog.querySelector<HTMLElement>('.bms-title, .modal-title, h2, h3');
    if (title && !dialog.hasAttribute('aria-labelledby') && !dialog.hasAttribute('aria-label')) {
        if (!title.id) title.id = `${overlay.id || 'bms'}-title`;
        dialog.setAttribute('aria-labelledby', title.id);
    }

    const onTop = () => overlay.isConnected && topOverlay() === overlay;
    const onKey = (e: KeyboardEvent) => {
        if (e.defaultPrevented || !onTop()) return;
        if (e.key === 'Escape') {
            // A custom select or a menu open inside the dialog closes first; it stops the event.
            e.preventDefault();
            opts.onClose();
            return;
        }
        if (e.key !== 'Tab' || !ownsFocus(dialog)) return;
        const stops = focusStops(dialog);
        if (!stops.length) { e.preventDefault(); return; }
        const outside = !dialog.contains(document.activeElement);
        const to = wrapIndex(stops.length, outside ? -1 : stops.indexOf(document.activeElement as HTMLElement), e.shiftKey);
        if (to < 0) return;
        e.preventDefault();
        stops[to].focus();
    };
    document.addEventListener('keydown', onKey);

    requestAnimationFrame(() => {
        if (!overlay.isConnected || dialog.contains(document.activeElement)) return;
        const first = opts.initialFocus
            || focusStops(dialog.querySelector<HTMLElement>('.modal-body') || dialog)[0]
            || dialog.querySelector<HTMLElement>('.modal-close');
        first?.focus({ preventScroll: true });
    });

    let done = false;
    const release = () => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey);
        bound.delete(overlay);
        if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
    };
    bound.set(overlay, release);
    return release;
}

/**
 * The static modals: Tab stays in the top overlay, and a close button that is only "×" gets a
 * name. Installed once from initModals.
 */
let globalKeys = false;
export function installGlobalModalKeys(closeLabel: () => string): void {
    if (globalKeys || typeof document === 'undefined') return;
    globalKeys = true;
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || e.defaultPrevented) return;
        const top = topOverlay();
        // Bound dialogs trap themselves (a WeakMap, not a data- attribute: markup from a page or a
        // plugin could carry the attribute and switch the trap off); an overlay without a
        // .modal is a feature's own shell.
        if (!top || bound.has(top)) return;
        const dialog = top.querySelector<HTMLElement>('.modal');
        if (!dialog || !ownsFocus(dialog)) return;
        const stops = focusStops(dialog);
        if (!stops.length) return;
        const outside = !dialog.contains(document.activeElement);
        const to = wrapIndex(stops.length, outside ? -1 : stops.indexOf(document.activeElement as HTMLElement), e.shiftKey);
        if (to < 0) return;
        e.preventDefault();
        stops[to].focus();
    });
    // Name the bare "×" buttons as they appear (static ones now, built ones when opened).
    const name = (root: ParentNode) => root.querySelectorAll<HTMLElement>('.modal-close:not([aria-label])').forEach((b) => {
        if (!b.getAttribute('title')) b.setAttribute('aria-label', closeLabel() || 'Close');
    });
    name(document);
    document.addEventListener('focusin', (e) => {
        const ov = (e.target as HTMLElement | null)?.closest?.('.modal-overlay');
        if (ov) name(ov);
    });
}
