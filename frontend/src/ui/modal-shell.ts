// modal-shell.ts — one way to look and behave for every dialog: Escape closes the TOP one, Tab
// stays inside it, the focus goes in when it opens and comes back where it was when it closes.
//
// The look lives in css/modal-shell.css (linked statically from index.html; re-linked here if a
// page forgot it). This module is the behaviour half, in three sizes:
//
//   · openModal({ title, body, footer, size, … }) — builds the canonical anatomy (header with
//     icon tile / title / subtitle / close, scrolling body, sticky footer), mounts it inside the
//     app frame above whatever is open, and wires Escape, the Tab trap, backdrop click, focus in
//     and focus back. Returns a handle with close(). New dialogs use this.
//   · bindModal(overlay, { onClose }) — for a dialog a feature builds itself. The feature keeps
//     its own close function (it usually has cleanup to run); this only decides WHEN to call
//     it and puts the focus back afterwards.
//   · installGlobalModalKeys() — for the static modals in index.html: a Tab trap on whichever
//     house overlay is on top, Escape that presses the top dialog's OWN close control (so the
//     feature's cleanup runs exactly as if the × had been clicked), focus moved in on open and
//     returned on close, and an accessible name on close buttons that were a bare "×".
//
// Import-light on purpose (focus-trap and layer only), so the pure parts (`topmostOf`,
// `modalClassName`) load in node.

import { focusStops, wrapIndex, ownsFocus } from './focus-trap.js';
import { raiseAboveAll } from './layer.js';
import { uiIcon } from './icons.js';

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

/** Whether a control takes typed text (an input that is not a box, a radio, a slider or a
 *  button; a textarea; an editable region). Pure on its three facts, for the tests. */
export function isTextEntry(tag: string, type: string | null, editable: boolean): boolean {
    if (editable) return true;
    const t = tag.toLowerCase();
    if (t === 'textarea') return true;
    if (t !== 'input') return false;
    return !/^(checkbox|radio|range|color|file|button|submit|reset|image|hidden)$/i.test(type || 'text');
}

// How the last interaction came: a dialog opened by a click must not land the caret in its
// first text field (the field lights up as if someone had picked it); one opened from the
// keyboard should, so the user can type at once. A dialog that wants its field focused either
// way says so (initialFocus) or focuses it itself.
let lastWasPointer = false;
if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', () => { lastWasPointer = true; }, true);
    document.addEventListener('keydown', () => { lastWasPointer = false; }, true);
}

/** What takes the focus when `host` opens and nobody chose: its first control (body first,
 *  then the ×) — unless that is a text field and the dialog was opened with the pointer, when
 *  the dialog itself takes it (no ring, Tab then enters the field). */
function openingFocus(host: HTMLElement): HTMLElement | null {
    const first = focusStops(host.querySelector<HTMLElement>('.modal-body') || host)[0]
        || host.querySelector<HTMLElement>('.modal-close');
    if (!first || !lastWasPointer) return first;
    if (!isTextEntry(first.tagName, first.getAttribute('type'), first.isContentEditable)) return first;
    if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');
    return host;
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
        const first = opts.initialFocus || openingFocus(dialog);
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

/** Whether an overlay is on screen right now (connected, displayed, not faded out). */
function isPainted(o: HTMLElement): boolean {
    if (!o.isConnected) return false;
    const cs = getComputedStyle(o);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && o.getClientRects().length > 0;
}

/** The control that closes `overlay` the way a click would: the header's ×, else any close
 *  control the dialog declares. Null when the dialog has none (it must then be answered). */
export function closeControlOf(overlay: HTMLElement): HTMLElement | null {
    const sel = '.modal-header .modal-close, .modal-close, [data-close], [data-close-modal]';
    for (const c of overlay.querySelectorAll<HTMLElement>(sel)) {
        if (c.closest('.modal-overlay, .modal-generic-overlay') !== overlay) continue; // a nested dialog's
        if ((c as HTMLButtonElement).disabled || c.getClientRects().length === 0) continue;
        return c;
    }
    return null;
}

type Watched = HTMLElement & { __bmsWatched?: boolean };

/**
 * The static modals (and any built dialog that did not call bindModal): Tab stays in the top
 * overlay, Escape presses its own close control, the focus goes in on open and comes back on
 * close, and a close button that is only "×" gets a name. Installed once from initModals.
 */
let globalKeys = false;
export function installGlobalModalKeys(closeLabel: () => string): void {
    if (globalKeys || typeof document === 'undefined') return;
    globalKeys = true;
    // Name the bare "×" buttons as they appear (static ones now, built ones when opened).
    const name = (root: ParentNode): void => {
        root.querySelectorAll<HTMLElement>('.modal-close:not([aria-label])').forEach((b) => {
            if (!b.getAttribute('title') && !/\w/.test(b.textContent || '')) b.setAttribute('aria-label', closeLabel() || 'Close');
        });
    };

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

    // Escape. The top dialog is read BEFORE anyone handles the key (window, capture) and acted on
    // AFTER everyone has (window, bubble): a feature that closes its own dialog on Escape, stops
    // the event, or opens a "discard changes?" question over it, wins — and the dialog under it
    // is never closed by the same key press. Only an Escape nobody answered presses the ×.
    let escTop: HTMLElement | null = null;
    window.addEventListener('keydown', (e) => {
        escTop = e.key === 'Escape' && !e.defaultPrevented ? topOverlay() : null;
    }, true);
    window.addEventListener('keydown', (e) => {
        const top = escTop;
        escTop = null;
        if (e.key !== 'Escape' || e.defaultPrevented || !top || bound.has(top)) return;
        if (top.getAttribute('data-prevent-close') === 'true') return;
        if (!isPainted(top) || topOverlay() !== top) return;
        const close = closeControlOf(top);
        if (!close) return;
        e.preventDefault();
        close.click();
    });

    // Focus in on open, focus back on close — for every overlay nobody bound.
    const back = new WeakMap<HTMLElement, HTMLElement | null>();
    const zWas = new WeakMap<HTMLElement, string>();
    const opened = (o: HTMLElement): void => {
        if (bound.has(o) || back.has(o)) return;
        const a = document.activeElement as HTMLElement | null;
        back.set(o, a && !o.contains(a) ? a : null);
        // Opened FROM another dialog (a confirmation asked by a built dialog that sits at
        // 11000+), a static overlay at its stylesheet z of 5000 would open BEHIND the dialog
        // that asked — the question invisible, the click answered by nobody. It goes on top
        // for as long as it is open, and gets its own value back when it closes.
        const own = Number.parseInt(getComputedStyle(o).zIndex, 10) || 0;
        const others = openOverlays().filter((x) => x !== o);
        const highest = Math.max(0, ...others.map((x) => Number.parseInt(getComputedStyle(x).zIndex, 10) || 0));
        if (others.length && highest >= own) {
            zWas.set(o, o.style.zIndex);
            raiseAboveAll(o, own);
        }
        const dialog = o.querySelector<HTMLElement>('.modal');
        if (dialog) {
            if (!dialog.getAttribute('role')) dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            const title = dialog.querySelector<HTMLElement>('.modal-title, .bms-title');
            if (title && !dialog.hasAttribute('aria-labelledby') && !dialog.hasAttribute('aria-label')) {
                if (!title.id) title.id = `${o.id || 'bms-' + Math.random().toString(36).slice(2, 8)}-title`;
                dialog.setAttribute('aria-labelledby', title.id);
            }
        }
        name(o);
        requestAnimationFrame(() => {
            if (!isPainted(o) || o.contains(document.activeElement)) return;
            const host = dialog || o;
            openingFocus(host)?.focus({ preventScroll: true });
        });
    };
    const closed = (o: HTMLElement): void => {
        if (!back.has(o)) return;
        const to = back.get(o);
        back.delete(o);
        if (zWas.has(o)) { o.style.zIndex = zWas.get(o) || ''; zWas.delete(o); }
        const a = document.activeElement as HTMLElement | null;
        const lost = !a || a === document.body || !a.isConnected || o.contains(a);
        if (lost && to && to.isConnected && to !== document.body) to.focus({ preventScroll: true });
    };
    const watch = (o: Watched): void => {
        if (o.__bmsWatched) return;
        o.__bmsWatched = true;
        new MutationObserver(() => {
            if (o.classList.contains('open') && isPainted(o)) opened(o); else closed(o);
        }).observe(o, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        if (o.classList.contains('open') && isPainted(o)) opened(o);
    };
    const OVERLAY = '.modal-overlay, .modal-generic-overlay';
    document.querySelectorAll<HTMLElement>(OVERLAY).forEach(watch);
    // Dialogs built later land in the frame (or, for the few that must, on <body>): watch the
    // direct children of both, never the whole tree (class changes elsewhere are constant).
    const roots = [document.body, document.getElementById('app-window-outer')].filter(Boolean) as HTMLElement[];
    const mo = new MutationObserver((recs) => {
        for (const r of recs) {
            r.addedNodes.forEach((n) => { if (n instanceof HTMLElement && n.matches(OVERLAY)) watch(n); });
            r.removedNodes.forEach((n) => { if (n instanceof HTMLElement && n.matches(OVERLAY)) closed(n); });
        }
    });
    for (const r of roots) mo.observe(r, { childList: true });

    name(document);
    document.addEventListener('focusin', (e) => {
        const ov = (e.target as HTMLElement | null)?.closest?.('.modal-overlay');
        if (ov) name(ov);
    });
}

// ── openModal: the canonical dialog, built ───────────────────────────────────────────────────

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
export type ModalTone = 'accent' | 'danger' | 'warn' | 'ok';

/** The × every dialog uses (an icon, not a glyph: "×" sits on the font's baseline and drifts
 *  from theme to theme). */
export const MODAL_CLOSE_SVG = (uiIcon('close', 16));

/** The class list of the card for a size / extra classes. Pure. */
export function modalClassName(size: ModalSize = 'md', extra = '', tall = false): string {
    return ['modal', 'bms', `modal--${size}`, tall ? 'modal--tall' : '', extra].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export interface ModalOptions {
    /** Text, never HTML. */
    title: string;
    /** Text, never HTML. */
    subtitle?: string;
    /** Trusted SVG markup for the icon tile (omit for no tile). */
    icon?: string;
    tone?: ModalTone;
    size?: ModalSize;
    /** Keep a fixed height (lists, trees, editors) instead of growing with the content. */
    tall?: boolean;
    /** Extra classes on the card: the feature's own hook for its CONTENT rules. */
    className?: string;
    /** Id on the overlay. */
    id?: string;
    /** Body content: a node, or TRUSTED markup (escape what you interpolate). */
    body?: Node | string;
    /** Footer content; omit or null for no footer. Primary action last. */
    footer?: Node | string | null;
    /** Header actions, between the title and the close button. */
    headerEnd?: Node;
    /** Escape, × and a backdrop click close it. Default true. False = it must be answered. */
    dismissible?: boolean;
    /** Close on a click on the dim. Default: same as dismissible. */
    backdropClose?: boolean;
    /** Called once after it closed, whatever closed it. */
    onClose?: () => void;
    /** Selector inside the dialog, or an element, that takes the focus on open. */
    initialFocus?: string | HTMLElement;
    /** Accessible name of the × button. */
    closeLabel?: string;
}

export interface ModalHandle {
    overlay: HTMLElement;
    dialog: HTMLElement;
    header: HTMLElement;
    body: HTMLElement;
    footer: HTMLElement | null;
    /** Close and remove it (idempotent). */
    close: () => void;
    /** `querySelector` scoped to the dialog. */
    q: <T extends HTMLElement = HTMLElement>(sel: string) => T | null;
}

function put(el: HTMLElement, content: Node | string | undefined | null): void {
    if (content == null) return;
    if (typeof content === 'string') el.innerHTML = content;
    else el.appendChild(content);
}

export interface HeaderOptions {
    title: string;
    subtitle?: string;
    icon?: string;
    tone?: ModalTone;
    headerEnd?: Node;
    id?: string;
    closeLabel?: string;
    /** Called by the × (omit to wire the click yourself). */
    onClose?: () => void;
    /** Draw the ×. Default true. */
    closable?: boolean;
}

/**
 * The canonical header band on its own, for a dialog a feature builds node by node:
 * [icon tile] title (+ subtitle) [actions] ×. Text only — the title and subtitle are set with
 * textContent.
 */
export function buildModalHeader(opts: HeaderOptions): HTMLElement {
    const header = document.createElement('div');
    header.className = 'modal-header';
    if (opts.icon) {
        const tile = document.createElement('div');
        tile.className = `bms-icon${opts.tone && opts.tone !== 'accent' ? ` bms-icon--${opts.tone}` : ''}`;
        tile.setAttribute('aria-hidden', 'true');
        tile.innerHTML = opts.icon;
        header.appendChild(tile);
    }
    const titles = document.createElement('div');
    titles.className = 'bms-titles';
    const h = document.createElement('h2');
    h.className = 'modal-title';
    h.id = `${opts.id || 'bms-' + Math.random().toString(36).slice(2, 8)}-title`;
    h.textContent = opts.title;
    titles.appendChild(h);
    if (opts.subtitle) {
        const sub = document.createElement('p');
        sub.className = 'bms-sub';
        sub.textContent = opts.subtitle;
        titles.appendChild(sub);
    }
    header.appendChild(titles);
    if (opts.headerEnd) {
        const end = document.createElement('div');
        end.className = 'bms-head-end';
        end.appendChild(opts.headerEnd);
        header.appendChild(end);
    }
    if (opts.closable !== false) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'modal-close';
        x.setAttribute('aria-label', opts.closeLabel || 'Close');
        x.innerHTML = MODAL_CLOSE_SVG;
        if (opts.onClose) x.addEventListener('click', opts.onClose);
        header.appendChild(x);
    }
    return header;
}

/** Build the canonical dialog, mount it inside the app frame above everything open, and wire it. */
export function openModal(opts: ModalOptions): ModalHandle {
    ensureModalShellCss();
    const dismissible = opts.dismissible !== false;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    if (opts.id) overlay.id = opts.id;

    const dialog = document.createElement('div');
    dialog.className = modalClassName(opts.size, opts.className, opts.tall);
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const header = buildModalHeader({ ...opts, id: opts.id, onClose: dismissible ? () => close() : undefined, closable: dismissible });
    const h = header.querySelector<HTMLElement>('.modal-title')!;
    dialog.setAttribute('aria-labelledby', h.id);

    const body = document.createElement('div');
    body.className = 'modal-body';
    put(body, opts.body);

    let footer: HTMLElement | null = null;
    if (opts.footer != null) {
        footer = document.createElement('div');
        footer.className = 'modal-footer';
        put(footer, opts.footer);
    }
    dialog.append(header, body);
    if (footer) dialog.appendChild(footer);
    overlay.appendChild(dialog);

    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
    raiseAboveAll(overlay);

    let done = false;
    let release: () => void = () => {};
    const close = (): void => {
        if (done) return;
        done = true;
        release();
        overlay.remove();
        try { opts.onClose?.(); } catch (err) { console.error('[modal] onClose', err); }
    };
    const initial = typeof opts.initialFocus === 'string'
        ? dialog.querySelector<HTMLElement>(opts.initialFocus)
        : opts.initialFocus || null;
    // Not dismissible: Escape does nothing, but the trap and the focus return still apply.
    release = bindModal(overlay, { onClose: () => { if (dismissible) close(); }, initialFocus: initial });
    if (opts.backdropClose ?? dismissible) {
        // Both ends of the click on the dim: a drag that starts in a field and ends outside it
        // is a text selection, not a request to throw the form away.
        let downOnDim = false;
        overlay.addEventListener('mousedown', (e) => { downOnDim = e.target === overlay; });
        overlay.addEventListener('click', (e) => { if (downOnDim && e.target === overlay) close(); downOnDim = false; });
    }
    return { overlay, dialog, header, body, footer, close, q: <T extends HTMLElement = HTMLElement>(sel: string) => dialog.querySelector<T>(sel) };
}
