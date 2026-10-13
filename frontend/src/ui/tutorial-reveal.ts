// Getting a tutorial step's target in front of the reader — or saying, in words, where it is.
//
// The lesson used to light up a selector and hope. When the control was on a tab nobody had
// opened, under a dialog left over from the previous step, or under the guide itself, the
// reader got a floating « Caché derrière un panneau » pill and no way forward. This module
// answers two questions, for the engine (tutorial-engine.ts) and nothing else:
//
//   reveal(el)   make the element visible when that is SAFE: open the tab or <details> it
//                sits in, close a dialog that covers it when that dialog holds no edits,
//                scroll it into view. Nothing it does loses a keystroke.
//   coverAt(el)  what, if anything, is painted on top of it right now (a hit test at its
//                centre, so it agrees with what the reader sees, whatever the z-index story).
//
// What it never does: force a closed dialog open by adding a class. A dialog shown without
// its real opener has none of its content initialised, which is worse than not showing it.
// The engine says where the control is instead, with a « Show me » that retries.

/** Overlays that are dialogs: the house shell and the older generic one. */
const OVERLAY = '.modal-overlay, .modal-generic-overlay';

/** On screen: a box, displayed, visible. */
export function isShown(el: Element | null | undefined): el is HTMLElement {
    if (!el || !(el as HTMLElement).isConnected) return false;
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el as HTMLElement);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if ((el as HTMLElement).offsetParent === null && cs.position !== 'fixed') return false;
    return true;
}

/** An overlay is open when it is drawn — whichever class its opener happens to use. */
export function isOpenOverlay(el: Element | null | undefined): boolean {
    if (!el) return false;
    const h = el as HTMLElement;
    const cs = getComputedStyle(h);
    if (cs.display === 'none') return false;
    // The generic overlays stay laid out when closed (display:flex, visibility:hidden,
    // opacity 0, pointer-events none) so they can fade in: measuring them says nothing.
    if (cs.visibility === 'hidden' || (cs.pointerEvents === 'none' && parseFloat(cs.opacity) === 0)) return false;
    const r = h.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

/** The dialog's own title, for a sentence that names it. */
export function dialogTitle(overlay: Element | null | undefined): string {
    const t = overlay?.querySelector('.modal-title, .modal-header h2, .modal-header h3, h2, h3');
    return (t?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** True when closing this dialog would throw away something the reader typed or picked. */
export function isDirty(overlay: Element): boolean {
    for (const node of Array.from(overlay.querySelectorAll('input, textarea, select'))) {
        const f = node as HTMLInputElement;
        if (f.disabled) continue;
        const type = (f.getAttribute('type') || 'text').toLowerCase();
        if (['hidden', 'button', 'submit', 'reset', 'image', 'file'].includes(type)) continue;
        if (f.tagName === 'SELECT') {
            const s = f as unknown as HTMLSelectElement;
            const opts = Array.from(s.options);
            if (s.multiple) {
                if (opts.some((o) => o.selected !== o.defaultSelected)) return true;
                continue;
            }
            // A single select with no `selected` option in its markup shows the first one:
            // that is its untouched state, not a choice the reader made.
            const def = opts.findIndex((o) => o.defaultSelected);
            if (s.selectedIndex !== (def >= 0 ? def : (opts.length ? 0 : -1))) return true;
            continue;
        }
        if (type === 'checkbox' || type === 'radio') {
            if (f.checked !== f.defaultChecked) return true;
            continue;
        }
        if (f.value !== f.defaultValue) return true;
    }
    return false;
}

/** The dialog's close control, preferring the shell's own so its cleanup runs. */
function closeControl(overlay: Element): HTMLElement | null {
    return overlay.querySelector<HTMLElement>('.modal-close, [data-close], .modal-header .btn-close, [data-action="close"]');
}

/** Close a dialog the way its own × would. Returns whether it is gone. */
export function closeDialog(overlay: HTMLElement): boolean {
    const btn = closeControl(overlay);
    if (btn) btn.click();
    else {
        overlay.classList.remove('open', 'active');
        overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    return !isOpenOverlay(overlay);
}

/** The tab (or pill, or link) that shows `panel`, when one is on screen. */
export function controllerFor(panel: HTMLElement): HTMLElement | null {
    const sels: string[] = [];
    const id = panel.id;
    if (id) {
        const q = CSS.escape(id);
        sels.push(`[aria-controls="${q}"]`, `[data-target="#${q}"]`, `a[href="#${q}"]`, `[data-tab="${q}"]`);
        // `apps-pane-browse` / `laya-panel-x` / `x-tab-content`: the tab is `apps-tab-browse`
        // or carries data-tab="browse".
        const m = /^(.*?)-(?:pane|panel|tabpanel|content)-(.+)$/.exec(id) || /^(.*?)-(.+?)-(?:pane|panel|content)$/.exec(id);
        if (m) sels.push(`#${CSS.escape(`${m[1]}-tab-${m[2]}`)}`, `[data-tab="${CSS.escape(m[2])}"]`);
    }
    const labelled = panel.getAttribute('aria-labelledby');
    if (labelled) sels.push(`#${CSS.escape(labelled.split(/\s+/)[0])}`);
    // data-repo-panel="host" ↔ data-repo-tab="host" (and -pane), the house pairing.
    for (const a of Array.from(panel.attributes)) {
        const m = /^data-([\w-]+?)-(?:panel|pane)$/.exec(a.name) || (/^data-(?:panel|pane)$/.test(a.name) ? ['', ''] : null);
        if (!m || !a.value) continue;
        const v = CSS.escape(a.value);
        sels.push(m[1] ? `[data-${m[1]}-tab="${v}"]` : `[data-tab="${v}"]`);
    }
    for (const sel of sels) {
        let list: Element[] = [];
        try { list = Array.from(document.querySelectorAll(sel)); } catch { continue; }
        const hit = list.find((c) => c !== panel && !panel.contains(c) && isShown(c));
        if (hit) return hit as HTMLElement;
    }
    return null;
}

/** Hidden ancestors between `el` and the document, outermost first. */
function hiddenChain(el: HTMLElement): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || n.hidden || cs.visibility === 'hidden'
            || (n.tagName === 'DETAILS' && !(n as HTMLDetailsElement).open && !el.closest('summary'))) out.unshift(n);
    }
    return out;
}

export type Where =
    | { kind: 'ok' }
    | { kind: 'missing' }
    | { kind: 'closed-dialog'; title: string }
    | { kind: 'tab'; label: string }
    | { kind: 'covered-dialog'; title: string; overlay: HTMLElement; dirty: boolean }
    | { kind: 'covered-guide' }
    | { kind: 'covered-other' }
    | { kind: 'sidebar' }
    | { kind: 'offscreen'; dir: 'up' | 'down' | 'left' | 'right' };

/** What sits on top of `el`'s centre: nothing, the guide, the sidebar, a dialog, or other. */
export function coverAt(el: HTMLElement, guide: HTMLElement | null): Where {
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
    const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 24), 0), window.innerHeight - 1);
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return { kind: 'ok' };
    // Highlights, the ghost cursor and its caption are the tutorial's own paint.
    if (hit.closest('#tut-hl-layer, .tut-highlight, #tut-ghost-cursor, #tut-ghost-caption, .tut-ghost-pulse')) return { kind: 'ok' };
    if (guide && guide.contains(hit)) return { kind: 'covered-guide' };
    const ov = hit.closest(OVERLAY) as HTMLElement | null;
    if (ov && !ov.contains(el)) return { kind: 'covered-dialog', title: dialogTitle(ov), overlay: ov, dirty: isDirty(ov) };
    if (hit.closest('.sidebar')) return { kind: 'sidebar' };
    // A label or icon the target wraps differently than its box suggests is still the target.
    if (el.closest('label')?.contains(hit)) return { kind: 'ok' };
    return { kind: 'covered-other' };
}

/** The tab label a hidden panel belongs to, if the tab can be found. */
function tabLabel(panel: HTMLElement): string {
    const c = controllerFor(panel);
    return (c?.textContent || c?.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * Make `el` visible when it can be done without losing anything. Returns what is still in the
 * way, or { kind: 'ok' }. `ownDialog` is the step's own modal (modal_selector): never closed.
 */
export function reveal(el: HTMLElement, guide: HTMLElement | null, ownDialog: Element | null = null): Where {
    // 1. A closed dialog cannot be opened from here (see the header) — say which one.
    const host = el.closest(OVERLAY) as HTMLElement | null;
    if (host && !isOpenOverlay(host)) return { kind: 'closed-dialog', title: dialogTitle(host) };

    // 2. Hidden tabs and <details>: open them outermost first, at most a few levels. Five, not
    //    three: a control in Server Repo's « Advanced tools » sits under its tab, the area, its
    //    tool and sometimes one of the tool's own sections.
    for (let pass = 0; pass < 5 && !isShown(el); pass++) {
        const chain = hiddenChain(el);
        if (!chain.length) break;
        const outer = chain[0];
        if (outer.tagName === 'DETAILS') { (outer as HTMLDetailsElement).open = true; continue; }
        const tab = controllerFor(outer);
        if (!tab) return { kind: 'tab', label: '' };
        tab.click();
        if (!isShown(el) && hiddenChain(el)[0] === outer) return { kind: 'tab', label: tabLabel(outer) };
    }
    if (!isShown(el)) return { kind: 'missing' };

    // 3. In view.
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) {
        try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* detached */ }
    }

    // 4. A leftover dialog on top: close it if that loses nothing; otherwise ask.
    const cover = coverAt(el, guide);
    if (cover.kind === 'covered-dialog') {
        const own = ownDialog ? (ownDialog.closest(OVERLAY) as HTMLElement | null) : null;
        if (cover.overlay === own) return cover;
        if (!cover.dirty && closeDialog(cover.overlay)) return coverAt(el, guide);
    }
    return cover;
}
