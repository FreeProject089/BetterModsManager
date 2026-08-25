/**
 * layer.ts — what z-index a thing opened FROM something else needs.
 *
 * The rule every one of these bugs breaks is the same: a picker or a dialog opened from a
 * modal must sit above the modal that opened it. Hard-coding a number gets this right once
 * and then rots, because the numbers in this app are not one scale:
 *
 *     .modal-generic-overlay   10000     the icon picker
 *     .modal-overlay           11000     ordinary modals
 *     .tut-hub-overlay       2000000     the tutorial hub, deliberately above everything
 *                                        so a lesson's spotlight can cover the whole app
 *     .tutc-overlay          2000100     the tutorial creator, opened from the hub
 *
 * A picker written against 10000 is correct from a settings page and invisible from the
 * tutorial creator — and the symptom is not "it is behind something", it is "the button
 * does nothing", because what you see is the dim of a panel you cannot reach.
 *
 * So: measure. Read the highest z-index actually painted right now and go above it. The
 * answer is right from wherever the caller happened to be, including from screens that do
 * not exist yet.
 */

/** Overlays that stack. Anything positioned with a real z-index counts. */
const CANDIDATES = '.modal-overlay, .modal-generic-overlay, .tut-hub-overlay, [data-layer]';

/**
 * The z-index to sit above everything currently on screen.
 *
 * `floor` is the value the element would have had on its own, so a caller opened from
 * nothing keeps its normal place in the stack rather than being pushed to the top of the
 * app by a helper it only called defensively.
 */
export function topLayerZ(floor = 11000): number {
    let max = floor;
    for (const n of document.querySelectorAll<HTMLElement>(CANDIDATES)) {
        // Skip what is not actually painted: a closed overlay left in the DOM would
        // otherwise keep raising every dialog opened after it.
        if (!n.isConnected || n.offsetParent === null && getComputedStyle(n).position !== 'fixed') continue;
        const z = Number.parseInt(getComputedStyle(n).zIndex, 10);
        if (Number.isFinite(z) && z > max) max = z;
    }
    // A gap rather than +1: an overlay's own children (a dropdown inside it, a tooltip)
    // often take a small offset from their parent, and landing between them is worse than
    // landing below them.
    return max + 100;
}

/** Put `el` above everything on screen right now. Returns the value used. */
export function raiseAboveAll(el: HTMLElement, floor?: number): number {
    const z = topLayerZ(floor);
    el.style.zIndex = String(z);
    return z;
}
