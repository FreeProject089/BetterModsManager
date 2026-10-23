// What a tutorial step's "selector" means, in ONE place.
//
// Official tutorials name elements by a bare word (`btn-add-mod`): an id first, then a class.
// The creator's element picker produces real CSS (`#btn-add-mod`, `[data-view="apps"]`,
// `#lo-list .lo-row`). The engine used to understand only the first form: a picked `#x` was
// looked up as the id "#x" (nothing) and then as the class selector `.#x` — which THROWS — so
// a custom step built with the picker never lit up. Both forms resolve here, for the engine,
// the creator's live check and its preview alike.
//
// Import-free, so the parsing half loads in node for the tests.

/** A bare id-or-class word, the official tutorials' form. */
export const isBareName = (sel: string): boolean => /^[A-Za-z_][\w-]*$/.test(sel.trim());

/** Whether `sel` parses as a selector here (bare names always do). */
export function selectorSyntaxOk(sel: string): boolean {
    const s = sel.trim();
    if (!s) return false;
    if (isBareName(s)) return true;
    if (typeof document === 'undefined') return true;
    try { document.createDocumentFragment().querySelector(s); return true; } catch { return false; }
}

/** Every element `sel` names right now: a bare name as an id, else as a class; anything else
 *  as CSS. Never throws — a typo is "nothing", not an exception in the middle of a lesson. */
export function resolveTargets(sel: string): Element[] {
    const s = sel.trim();
    if (!s) return [];
    if (isBareName(s)) {
        const byId = document.getElementById(s);
        if (byId) return [byId];
        return Array.from(document.querySelectorAll(`.${s}`));
    }
    try { return Array.from(document.querySelectorAll(s)); } catch { return []; }
}
