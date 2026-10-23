// popout-shared.ts — what the main window (ui/popout.ts) and a pop-out window
// (ui/popout-window.ts, frontend/popout.html) agree on. Imports nothing: the pop-out window
// must not boot any of BMM.
//
// The protocol, all Tauri events named `bmm://popout/<id>/<what>`:
//   ready  window → main   the window is listening; send it everything
//   theme  main → window   stylesheets, inline styles, <html>/<body> attributes, labels
//   html   main → window   the panel's markup (values baked in) and its ancestors' names
//   act    window → main   a click / input / change / key, on the element at a child-index path
//   back   window → main   « put it back into BMM's window » (the window then destroys itself)
//   close  window → main   « close the panel » (same, then the panel's own close runs)
// and `bmm://popout-closed` (Rust, payload the id) once the window is destroyed, however.

export const POPOUT_CLOSED_EVENT = 'bmm://popout-closed';

export function popoutEvent(id: string, what: 'ready' | 'theme' | 'html' | 'act' | 'back' | 'close'): string {
    return `bmm://popout/${id}/${what}`;
}

/** The ids are slugs (Rust refuses anything else: commands/popout.rs valid_id). */
export function isPopoutId(id: string | null | undefined): id is string {
    return !!id && /^[a-z0-9-]{1,40}$/.test(id);
}

/** Where the window remembers its place, per panel. Same origin, so both windows read it. */
export function geomKey(id: string): string { return `bmm.popout.geom.${id}`; }

export interface PopoutGeom { x: number; y: number; w: number; h: number }

export function readGeom(id: string): PopoutGeom | null {
    try {
        const g = JSON.parse(localStorage.getItem(geomKey(id)) || 'null');
        if (g && [g.x, g.y, g.w, g.h].every((n) => Number.isFinite(n)) && g.w >= 200 && g.h >= 160) return g;
    } catch { /* corrupt or no storage: the default place */ }
    return null;
}

export interface Ancestor { tag: string; id: string; cls: string }

export interface ThemePayload {
    links: string[];                  // stylesheet hrefs, as written in the main window
    styles: string;                   // every inline <style> of the main window, concatenated
    htmlAttrs: Record<string, string>;
    bodyClass: string;
    labels: { title: string; back: string; close: string; minimize: string; detached: string };
    icons: { back: string; close: string; minimize: string };
}

export interface HtmlPayload { html: string; anc: Ancestor[] }

export interface PopoutAction {
    k: 'click' | 'input' | 'change' | 'key' | 'submit';
    p: number[];
    v?: string;
    c?: boolean;
    key?: string;
    code?: string;
    mods?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
}

/** The element's position under `root` as child indices, or null when it is not under it. */
export function pathOf(root: Element, el: Element | null): number[] | null {
    const p: number[] = [];
    let n: Element | null = el;
    while (n && n !== root) {
        const parent: Element | null = n.parentElement;
        if (!parent) return null;
        p.unshift(Array.prototype.indexOf.call(parent.children, n));
        n = parent;
    }
    return n === root ? p : null;
}

export function atPath(root: Element, p: number[]): Element | null {
    let n: Element | null = root;
    for (const i of p) {
        if (!n || !Number.isInteger(i) || i < 0) return null;
        n = n.children[i] || null;
    }
    return n;
}

/** Strip what must never run in the pop-out: scripts (kept as an inert <template> so the
 *  child indices stay the same on both sides), inline handlers, javascript: URLs. The page's
 *  CSP refuses inline script anyway; this is the second lock. */
export function defang(root: ParentNode): void {
    root.querySelectorAll('script').forEach((s) => s.replaceWith(document.createElement('template')));
    root.querySelectorAll('*').forEach((el) => {
        for (const a of Array.from(el.attributes)) {
            const n = a.name.toLowerCase();
            if (n.startsWith('on')) el.removeAttribute(a.name);
            else if ((n === 'href' || n === 'src' || n === 'action' || n === 'formaction' || n === 'xlink:href')
                && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
        }
    });
}
