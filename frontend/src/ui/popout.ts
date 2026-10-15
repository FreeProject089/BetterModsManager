// popout.ts — a floating panel taken out of BMM's window into an OS window of its own.
//
// Some panels float and drag (the theme editor, the translation sandbox in overlay mode, the
// task debugger), but only inside BMM's window, so the panel you want beside the app ends up
// over it. « Pop out » (a button in the panel's header, or dragging the header past the edge of
// the window) opens it in a window of its own, like the benchmark's mini monitor.
//
// The panel's code does not move. It stays in this window, hidden (`.bmm-popped-out`), and
// keeps doing everything: the pop-out window (popout.html, ui/popout-window.ts) shows a copy of
// its markup, re-sent whenever it changes, and sends back what you do there — a click, a value
// typed, a key — which is replayed here on the same element. So a popped-out panel behaves like
// the panel, state included, with no second copy of the logic to keep in step, and it follows
// the theme because the window is sent the same stylesheets and tokens.
//
// What does not cross: pointer drags inside the panel (reordering, resizing a splitter) and
// canvases that redraw continuously (sent as a still image). The panels that pop out were
// chosen for being forms and lists.
//
// The window remembers its size and place per panel (popout-shared.ts geomKey). Closing it
// with « Back to BMM », its close button, Alt+F4 or the taskbar puts the panel back where it was.

import { t } from '../core/i18n.js';
import { uiIcon } from './icons.js';
import {
    POPOUT_CLOSED_EVENT, popoutEvent, isPopoutId, readGeom, atPath, defang,
    type Ancestor, type ThemePayload, type HtmlPayload, type PopoutAction,
} from './popout-shared.js';

export interface PopoutSpec {
    /** Slug: the window is `popout-<id>`. */
    id: string;
    /** The window's title. */
    title: () => string;
    /** The element that pops out. */
    panel: () => HTMLElement | null;
    /** Still open in BMM? When the panel's own logic closes it, the window goes too. */
    isOpen: () => boolean;
    /** Get the panel ready to be hidden here (undock it, leave a full-screen mode…). */
    prepare?: () => void;
    /** Close the panel itself (the window's close button). */
    close: () => void;
    /** Whether dragging the header out of the window pops it out right now (default: yes).
     *  For a panel whose header only drags in one of its modes. */
    dragOut?: () => boolean;
    /** The panel is back in BMM's window (however the pop-out went away), for a panel that
     *  has to place itself again (the tutorial guide re-docks where the reader had it). */
    restored?: () => void;
}

interface Live {
    spec: PopoutSpec;
    panel: HTMLElement;
    off: Array<() => void>;
    observers: MutationObserver[];
    watchdog: number;
    htmlTimer: number | null;
    themeTimer: number | null;
    lastHtml: string;
    lastTheme: string;
}

const HIDDEN = 'bmm-popped-out';
const live = new Map<string, Live>();
let _closedWired = false;

/** Pop-out windows exist in the app only, not in the browser preview. */
export function canPopOut(): boolean { return !!(window as any).__TAURI__?.core?.invoke; }

/** The bridge directly, not core/api.ts: this module is imported by modules the node tests load,
 *  and api.ts wants a window at import time. */
function invoke(cmd: string, args: Record<string, unknown>, _o?: { quiet?: boolean }): Promise<unknown> {
    const inv = (window as any).__TAURI__?.core?.invoke;
    return inv ? inv(cmd, args) : Promise.reject(new Error('no Tauri bridge'));
}

export function isPoppedOut(id: string): boolean { return live.has(id); }

type TauriEvent = { listen: (e: string, cb: (ev: { payload: any }) => void) => Promise<() => void>; emit: (e: string, p?: unknown) => Promise<void> };
function tauriEvent(): TauriEvent | null { return ((window as any).__TAURI__?.event as TauriEvent) || null; }

/**
 * The header button that pops a panel out, for the panel's own header markup. It starts
 * `hidden` (the browser preview has no window to open) and wirePopout shows it in the app.
 */
export function popoutButtonHtml(cls: string, id: string): string {
    const label = t('popout.open');
    return `<button type="button" class="${cls} bmm-popout-btn" data-popout="${id}" hidden aria-label="${label}" data-tooltip="${label}">${uiIcon('pop-out', 14)}</button>`;
}

/** Show the pop-out button(s) of a panel and wire them, plus « drag the header out of the
 *  window ». Idempotent per element. */
export function wirePopout(spec: PopoutSpec, root: HTMLElement, handle?: HTMLElement | null): void {
    if (!canPopOut()) return;
    root.querySelectorAll<HTMLElement>(`[data-popout="${spec.id}"]`).forEach((b) => {
        if ((b as any)._popoutWired) return;
        (b as any)._popoutWired = true;
        b.hidden = false;
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); void popOut(spec); });
    });
    if (handle && !(handle as any)._popoutDrag) {
        (handle as any)._popoutDrag = true;
        watchDragOut(spec, handle);
    }
}

/**
 * Dragging the header past the window's edge pops the panel out where the mouse is let go.
 * The panel's own drag code keeps the panel inside the window; this only watches the pointer,
 * which the webview keeps reporting outside the window while the button is held.
 */
function watchDragOut(spec: PopoutSpec, handle: HTMLElement): void {
    const EDGE = 24;
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('button, input, select, textarea, label, a, [contenteditable]')) return;
        const panel = spec.panel();
        if (!panel || live.has(spec.id) || (spec.dragOut && !spec.dragOut())) return;
        let out = false;
        const move = (ev: MouseEvent) => {
            const now = ev.clientX < -EDGE || ev.clientY < -EDGE || ev.clientX > innerWidth + EDGE || ev.clientY > innerHeight + EDGE;
            if (now !== out) { out = now; panel.classList.toggle('bmm-popout-armed', out); }
        };
        const up = (ev: MouseEvent) => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mouseup', up, true);
            panel.classList.remove('bmm-popout-armed');
            if (out) void popOut(spec, { x: ev.screenX - 60, y: ev.screenY - 14 });
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', up, true);
    });
}

/** Open `spec`'s panel in its own window (or bring that window forward). False when it could not. */
export async function popOut(spec: PopoutSpec, at?: { x: number; y: number }): Promise<boolean> {
    if (!canPopOut() || !isPopoutId(spec.id)) return false;
    if (live.has(spec.id)) {
        await invoke('open_popout_window', { id: spec.id, title: spec.title(), x: null, y: null, width: 640, height: 560 }, { quiet: true }).catch(() => undefined);
        return true;
    }
    const ev = tauriEvent();
    if (!ev) return false;
    try { spec.prepare?.(); } catch (e) { console.warn('[popout] prepare', e); }
    const panel = spec.panel();
    if (!panel || !spec.isOpen()) return false;

    // Size: what it was last time, or the panel as it is now plus the window's title bar.
    const r = panel.getBoundingClientRect();
    const saved = readGeom(spec.id);
    const w = Math.round(saved?.w || Math.max(420, r.width));
    const h = Math.round(saved?.h || Math.max(360, r.height + 36));
    let x: number | null = saved ? saved.x : Math.round(window.screenX + r.left);
    let y: number | null = saved ? saved.y : Math.round(window.screenY + r.top);
    if (at) { x = Math.round(at.x); y = Math.round(at.y); }

    const L: Live = { spec, panel, off: [], observers: [], watchdog: 0, htmlTimer: null, themeTimer: null, lastHtml: '', lastTheme: '' };
    live.set(spec.id, L);
    wireClosed();
    try {
        L.off.push(await ev.listen(popoutEvent(spec.id, 'ready'), () => { L.lastHtml = ''; L.lastTheme = ''; sendTheme(L); sendHtml(L); }));
        L.off.push(await ev.listen(popoutEvent(spec.id, 'act'), (e) => applyAction(L, e.payload as PopoutAction)));
        L.off.push(await ev.listen(popoutEvent(spec.id, 'back'), () => restore(spec.id)));
        L.off.push(await ev.listen(popoutEvent(spec.id, 'close'), () => { restore(spec.id); try { spec.close(); } catch (err) { console.warn('[popout] close', err); } }));
    } catch (e) {
        console.warn('[popout] events', e);
        restore(spec.id);
        return false;
    }

    // The copy follows the panel, and the window follows the theme.
    const mo = new MutationObserver(() => queueHtml(L));
    mo.observe(panel, { subtree: true, childList: true, attributes: true, characterData: true });
    const themeMo = new MutationObserver(() => queueTheme(L));
    themeMo.observe(document.documentElement, { attributes: true });
    themeMo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    themeMo.observe(document.head, { childList: true, subtree: true, characterData: true });
    L.observers.push(mo, themeMo);
    // The panel's own code closed it (or rebuilt it): the window goes too.
    L.watchdog = window.setInterval(() => {
        if (!panel.isConnected || !spec.isOpen()) closeWindow(spec.id);
    }, 400);

    panel.classList.add(HIDDEN);
    try {
        await invoke('open_popout_window', { id: spec.id, title: spec.title(), x, y, width: w, height: h }, { quiet: true });
    } catch (e) {
        console.warn('[popout] open', e);
        restore(spec.id);
        return false;
    }
    return true;
}

/** Close the window and put the panel back. */
export function closeWindow(id: string): void {
    restore(id);
    void invoke('close_popout_window', { id }, { quiet: true }).catch(() => undefined);
}

function restore(id: string): void {
    const L = live.get(id);
    if (!L) return;
    live.delete(id);
    L.observers.forEach((o) => o.disconnect());
    L.off.forEach((f) => { try { f(); } catch { /* already gone */ } });
    clearInterval(L.watchdog);
    if (L.htmlTimer !== null) clearTimeout(L.htmlTimer);
    if (L.themeTimer !== null) clearTimeout(L.themeTimer);
    L.panel.classList.remove(HIDDEN);
    try { L.spec.restored?.(); } catch (e) { console.warn('[popout] restored', e); }
}

function wireClosed(): void {
    if (_closedWired) return;
    const ev = tauriEvent();
    if (!ev) return;
    _closedWired = true;
    void ev.listen(POPOUT_CLOSED_EVENT, (e) => { if (typeof e.payload === 'string') restore(e.payload); });
}

// ── Main → window ────────────────────────────────────────────────────────────

function queueHtml(L: Live): void {
    if (L.htmlTimer !== null) return;
    L.htmlTimer = window.setTimeout(() => { L.htmlTimer = null; sendHtml(L); }, 60);
}
function queueTheme(L: Live): void {
    if (L.themeTimer !== null) return;
    L.themeTimer = window.setTimeout(() => { L.themeTimer = null; sendTheme(L); }, 120);
}

function sendHtml(L: Live): void {
    if (!live.has(L.spec.id)) return;
    const payload: HtmlPayload = { html: serialize(L.panel), anc: ancestors(L.panel) };
    const key = payload.html + JSON.stringify(payload.anc);
    if (key === L.lastHtml) return;
    L.lastHtml = key;
    void tauriEvent()?.emit(popoutEvent(L.spec.id, 'html'), payload).catch(() => undefined);
}

function sendTheme(L: Live): void {
    if (!live.has(L.spec.id)) return;
    const htmlAttrs: Record<string, string> = {};
    for (const a of Array.from(document.documentElement.attributes)) htmlAttrs[a.name] = a.value;
    const payload: ThemePayload = {
        links: Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
            .filter((l) => !l.disabled).map((l) => l.getAttribute('href') || '').filter((h) => h && !/^\s*javascript:/i.test(h)),
        styles: Array.from(document.querySelectorAll('style')).map((s) => s.textContent || '').join('\n'),
        htmlAttrs,
        bodyClass: document.body.className,
        labels: {
            title: L.spec.title(),
            back: t('popout.back'),
            close: t('common.close'),
            minimize: t('popout.minimize'),
            detached: t('popout.detached'),
        },
        icons: { back: uiIcon('pop-in', 16), close: uiIcon('close', 16), minimize: uiIcon('remove', 16) },
    };
    const key = JSON.stringify(payload);
    if (key === L.lastTheme) return;
    L.lastTheme = key;
    void tauriEvent()?.emit(popoutEvent(L.spec.id, 'theme'), payload).catch(() => undefined);
}

/** The panel's ancestors up to <body>, so selectors written against them still match there. */
function ancestors(panel: HTMLElement): Ancestor[] {
    const out: Ancestor[] = [];
    for (let a = panel.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
        out.unshift({ tag: a.tagName.toLowerCase(), id: a.id, cls: a.className && typeof a.className === 'string' ? a.className : '' });
    }
    return out;
}

/** The panel's markup with what markup does not carry baked in: field values, checked boxes,
 *  chosen options, open <details>, canvases as pictures. */
function serialize(panel: HTMLElement): string {
    const clone = panel.cloneNode(true) as HTMLElement;
    const fields = (n: Element) => Array.from(n.querySelectorAll('input, textarea, select'));
    const src = fields(panel), dst = fields(clone);
    src.forEach((el, i) => {
        const c = dst[i];
        if (!c) return;
        if (el instanceof HTMLInputElement) {
            if (el.type === 'checkbox' || el.type === 'radio') {
                if (el.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked');
            } else if (el.type !== 'file' && el.type !== 'password') {
                c.setAttribute('value', el.value);
            }
            if (el.indeterminate) c.setAttribute('data-po-indeterminate', '');
        } else if (el instanceof HTMLTextAreaElement) {
            c.textContent = el.value;
        } else if (el instanceof HTMLSelectElement) {
            Array.from(el.options).forEach((o, j) => {
                const co = (c as HTMLSelectElement).options[j];
                if (!co) return;
                if (o.selected) co.setAttribute('selected', ''); else co.removeAttribute('selected');
            });
        }
    });
    const canvases = Array.from(panel.querySelectorAll('canvas'));
    const cc = Array.from(clone.querySelectorAll('canvas'));
    canvases.forEach((cv, i) => {
        const c = cc[i];
        if (!c || cv.width * cv.height > 2_000_000) return;
        try {
            const img = document.createElement('img');
            img.src = cv.toDataURL();
            for (const a of ['class', 'style', 'width', 'height']) { const v = c.getAttribute(a); if (v !== null) img.setAttribute(a, v); }
            c.replaceWith(img);
        } catch { /* a tainted canvas stays blank */ }
    });
    clone.classList.remove(HIDDEN, 'bmm-popout-armed');
    clone.setAttribute('data-po-panel', '');
    defang(clone);
    return clone.outerHTML;
}

// ── Window → main ────────────────────────────────────────────────────────────

function applyAction(L: Live, a: PopoutAction): void {
    if (!a || !Array.isArray(a.p)) return;
    const el = atPath(L.panel, a.p);
    if (!el) return;
    switch (a.k) {
        case 'click': click(el); break;
        case 'input':
        case 'change': setValue(el, a, a.k); break;
        case 'key': key(el, a); break;
        case 'submit': {
            const form = el.closest('form');
            if (form) form.requestSubmit();
            break;
        }
    }
    // Values set from code are not mutations: send what it looks like now either way.
    queueHtml(L);
}

function click(el: Element): void {
    // A link would navigate THIS window if nothing handles it. Whatever handles links here
    // (in-app docs, the external opener) runs first; the last bubbling listener stops the rest.
    const a = el.closest('a[href]');
    if (a && !(a.getAttribute('href') || '').startsWith('#')) {
        window.addEventListener('click', (e) => e.preventDefault(), { once: true });
    }
    if (el instanceof HTMLElement) el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

function setValue(el: Element, a: PopoutAction, type: 'input' | 'change'): void {
    if (el instanceof HTMLInputElement) {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!a.c;
        else if (el.type !== 'file' && typeof a.v === 'string') el.value = a.v;
    } else if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        if (typeof a.v === 'string') el.value = a.v;
    } else if (el instanceof HTMLElement && el.isContentEditable && typeof a.v === 'string') {
        el.textContent = a.v;
    }
    el.dispatchEvent(new Event(type, { bubbles: true }));
}

function key(el: Element, a: PopoutAction): void {
    if (!a.key) return;
    const init: KeyboardEventInit = {
        key: a.key, code: a.code || '', bubbles: true, cancelable: true,
        ctrlKey: !!a.mods?.ctrl, shiftKey: !!a.mods?.shift, altKey: !!a.mods?.alt, metaKey: !!a.mods?.meta,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
}
