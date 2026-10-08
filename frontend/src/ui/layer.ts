/**
 * layer.ts — what z-index a thing opened FROM something else needs.
 *
 * The rule every one of these bugs breaks is the same: a picker or a dialog opened from a
 * modal must sit above the modal that opened it. Hard-coding a number gets this right once
 * and then rots, because the numbers in this app are not one scale:
 *
 *     .modal-generic-overlay   10000     the icon picker
 *     .modal-overlay            5000     ordinary modals (modal-shell.css), raised on open
 *     .tut-hub-overlay       2000000     older tutorial hub family (the hub is a house dialog
 *                                        now; kept so a stale build still counts)
 *     [data-layer]               any     anything that opts in
 *
 * (The lesson's coach card, .tut-engine-panel at 2000100, is deliberately NOT a candidate:
 * it is not a dialog, and a dialog the lesson asks you to open must not leap over it.)
 *
 * A picker written against 10000 is correct from a settings page and invisible from the
 * tutorial creator — and the symptom is not "it is behind something", it is "the button
 * does nothing", because what you see is the dim of a panel you cannot reach.
 *
 * So: measure. Read the highest z-index actually painted right now and go above it. The
 * answer is right from wherever the caller happened to be, including from screens that do
 * not exist yet.
 *
 * THE BUG THIS FILE WAS REWRITTEN FOR (Oct 2026): the tutorial creator opened BEHIND the
 * tutorial hub. Two causes, one shape. The creator was a `.modal-overlay` relying on a
 * `.tutc-overlay { z-index: 2000100 }` rule in main.css, and modal-shell.css — linked after
 * main.css — sets `.modal-overlay { z-index: 5000 }` at the same specificity, so the creator
 * painted at 5000 under a hub at 2000000. And the shell's own "opened from another dialog →
 * raise it" pass compared only against other `.modal-overlay`s, so a layer of another family
 * (the hub) did not count as "something open". A stylesheet number is not a stacking model;
 * `paintedLayerZ` below counts every family, and every dialog is raised against it.
 */

/** Overlays that stack. Anything positioned with a real z-index counts. */
export const LAYER_CANDIDATES = '.modal-overlay, .modal-generic-overlay, .tut-hub-overlay, [data-layer]';

/** Whether a layer is painted right now. `getClientRects()` is empty for a display:none
 *  subtree AND works for position:fixed (whose offsetParent is always null — the previous
 *  test let every closed fixed overlay count). */
function painted(n: HTMLElement): boolean {
    if (!n.isConnected || n.getClientRects().length === 0) return false;
    const cs = getComputedStyle(n);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/**
 * The highest z-index among the layers painted right now, ignoring `exclude` (and anything
 * inside it — a dialog's own dropdown must not lift the dialog). 0 when nothing is open.
 */
export function paintedLayerZ(exclude?: Element | null): number {
    let max = 0;
    if (typeof document === 'undefined') return max;
    for (const n of document.querySelectorAll<HTMLElement>(LAYER_CANDIDATES)) {
        if (exclude && (n === exclude || exclude.contains(n))) continue;
        if (!painted(n)) continue;
        const z = Number.parseInt(getComputedStyle(n).zIndex, 10);
        if (Number.isFinite(z) && z > max) max = z;
    }
    return max;
}

/**
 * Pure: the z-index a layer whose own value is `own` needs, given the highest other painted
 * layer `highest`. Null when it already paints on top. A gap rather than +1: an overlay's own
 * children (a dropdown inside it, a tooltip) often take a small offset from their parent, and
 * landing between them is worse than landing below them.
 */
export function zToTop(own: number, highest: number): number | null {
    return highest >= own ? highest + 100 : null;
}

/**
 * The z-index to sit above everything currently on screen.
 *
 * `floor` is the value the element would have had on its own, so a caller opened from
 * nothing keeps its normal place in the stack rather than being pushed to the top of the
 * app by a helper it only called defensively.
 */
export function topLayerZ(floor = 11000, exclude?: Element | null): number {
    return Math.max(floor, paintedLayerZ(exclude)) + 100;
}

/** Put `el` above everything on screen right now (itself excluded). Returns the value used. */
export function raiseAboveAll(el: HTMLElement, floor?: number): number {
    const z = topLayerZ(floor, el);
    el.style.zIndex = String(z);
    return z;
}
