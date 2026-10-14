// popout-window.ts — the pop-out window's side (frontend/popout.html). See ui/popout.ts.
//
// This window runs none of the panel's code and boots none of BMM: it shows the markup the main
// window sends, styled with the main window's own stylesheets and tokens, and sends back the
// clicks, values and keys, which the main window replays on the real panel. The panel answers
// by changing, and the new markup arrives here a moment later.
//
// Each new markup is morphed into the copy on screen, not swapped in, so what lives only in this
// window survives it: the field being typed in stays the same element (its caret, a selection,
// an open colour picker) and lists keep their scroll.

import {
    popoutEvent, isPopoutId, geomKey, pathOf, defang,
    type ThemePayload, type HtmlPayload, type PopoutAction,
} from './popout-shared.js';

type TauriEvent = { listen: (e: string, cb: (ev: { payload: any }) => void) => Promise<() => void>; emit: (e: string, p?: unknown) => Promise<void> };

const TEXTY = 'textarea, select, input:not([type]), input[type="text"], input[type="search"], input[type="number"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"], input[type="color"], input[type="range"], input[type="date"], input[type="time"], [contenteditable=""], [contenteditable="true"]';

function start(): void {
    const T = (window as any).__TAURI__;
    const ev: TauriEvent | undefined = T?.event;
    const id = new URLSearchParams(location.search).get('id');
    const host = document.getElementById('po-host');
    if (!ev || !isPopoutId(id) || !host) return;
    const win = T?.window?.getCurrentWindow?.();
    const send = (what: 'act' | 'back' | 'close' | 'ready', p?: unknown) => ev.emit(popoutEvent(id, what), p).catch(() => undefined);
    const $ = (s: string) => document.getElementById(s);

    let root: HTMLElement | null = null;
    let lastHtml = '';
    let gotHtml = false;

    // ── Theme ────────────────────────────────────────────────────────────────
    const ownHtmlClass = 'po-doc';
    const applyTheme = (p: ThemePayload) => {
        const de = document.documentElement;
        for (const a of Array.from(de.attributes)) if (a.name !== 'lang' && !(a.name in p.htmlAttrs)) de.removeAttribute(a.name);
        for (const [k, v] of Object.entries(p.htmlAttrs || {})) {
            if (/^on/i.test(k)) continue;
            de.setAttribute(k, v);
        }
        de.classList.add(ownHtmlClass);
        document.body.className = `${p.bodyClass || ''} po-body`;
        const want = new Set((p.links || []).filter((h) => !/^\s*(javascript|data):/i.test(h)));
        document.querySelectorAll<HTMLLinkElement>('link[data-po]').forEach((l) => {
            if (!want.has(l.getAttribute('href') || '')) l.remove(); else want.delete(l.getAttribute('href') || '');
        });
        const own = document.getElementById('po-own-css');
        for (const href of want) {
            const l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = href;
            l.dataset.po = '';
            document.head.insertBefore(l, own);
        }
        let st = document.getElementById('po-inline-css');
        if (!st) {
            st = document.createElement('style');
            st.id = 'po-inline-css';
            document.head.insertBefore(st, own);
        }
        if (st.textContent !== p.styles) st.textContent = p.styles || '';
        const L = p.labels || ({} as ThemePayload['labels']);
        document.title = L.title || 'BMM';
        const title = $('po-title');
        if (title) title.textContent = L.title || '';
        const label = (bid: string, text: string, icon: string) => {
            const b = $(bid);
            if (!b) return;
            b.setAttribute('aria-label', text);
            b.title = text;
            if (icon && b.dataset.icon !== icon) { b.innerHTML = icon; b.dataset.icon = icon; }
        };
        label('po-back', L.back || 'Back to BMM', p.icons?.back || '');
        label('po-min', L.minimize || 'Minimise', p.icons?.minimize || '');
        label('po-close', L.close || 'Close', p.icons?.close || '');
        $('po-bar')?.setAttribute('aria-label', L.detached || '');
    };

    // ── Markup ───────────────────────────────────────────────────────────────
    // The new markup is MORPHED into the copy on screen rather than swapped in: an element
    // that is still there stays the same element, so the field being typed in keeps its
    // focus, caret and selection (an open colour picker too), and lists keep their scroll.
    const render = (p: HtmlPayload) => {
        const key = p.html + JSON.stringify(p.anc);
        if (key === lastHtml) return;
        lastHtml = key;
        gotHtml = true;

        const tpl = document.createElement('template');
        tpl.innerHTML = p.html;
        defang(tpl.content);
        const next = tpl.content.firstElementChild as HTMLElement | null;
        if (!next) return;
        // The ancestors, as boxes that do not draw (display: contents), so selectors written
        // against them (`#app-window-outer .x`, `.modal-overlay .modal`) still match.
        const fresh = document.createElement('div');
        let inner: HTMLElement = fresh;
        for (const a of p.anc || []) {
            if (!/^[a-z][a-z0-9-]*$/.test(a.tag)) continue;
            const el = document.createElement(a.tag);
            if (a.id) el.id = a.id;
            if (a.cls) el.className = a.cls;
            el.classList.add('po-anc');
            inner.appendChild(el);
            inner = el;
        }
        inner.appendChild(next);
        morphChildren(host, fresh, document.activeElement);
        root = host.querySelector('[data-po-panel]');
        root?.querySelectorAll('[data-po-indeterminate]').forEach((el) => { (el as HTMLInputElement).indeterminate = true; });
    };

    // ── What you do here goes to the panel ──────────────────────────────────
    const at = (el: Element | null) => (root && el ? pathOf(root, el) : null);
    document.addEventListener('click', (e) => {
        const target = e.target as Element | null;
        if (!target || !root || !root.contains(target)) return;
        // Fields take their own clicks (focus, caret, the colour picker, a native list); what
        // they change is sent as input / change instead.
        if (target.closest(TEXTY)) return;
        e.preventDefault();
        const p = at(target);
        if (p) void send('act', { k: 'click', p } satisfies PopoutAction);
    }, true);
    const onValue = (k: 'input' | 'change') => (e: Event) => {
        const el = e.target as HTMLElement | null;
        if (!el || !root || !root.contains(el)) return;
        const p = at(el);
        if (!p) return;
        const a: PopoutAction = { k, p };
        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) a.c = el.checked;
        else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) a.v = el.value;
        else if (el.isContentEditable) a.v = el.textContent || '';
        void send('act', a);
    };
    document.addEventListener('input', onValue('input'), true);
    document.addEventListener('change', onValue('change'), true);
    document.addEventListener('submit', (e) => {
        e.preventDefault();
        const p = at(e.target as Element);
        if (p) void send('act', { k: 'submit', p } satisfies PopoutAction);
    }, true);
    document.addEventListener('keydown', (e) => {
        const named = ['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Delete'].includes(e.key) || /^F\d{1,2}$/.test(e.key);
        if (!named && !e.ctrlKey && !e.metaKey) return;
        // Copy, paste, select-all and undo in a field belong to the field.
        if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x', 'z', 'y'].includes(e.key.toLowerCase())) return;
        const target = e.target as Element | null;
        const el = target && root && root.contains(target) ? target : root;
        if (!el) return;
        // Enter on a button is its click, already sent.
        if (e.key === 'Enter' && target?.closest('button, a, summary')) return;
        const p = at(el);
        if (!p) return;
        if (e.key !== 'Enter' || !target?.closest('textarea')) e.preventDefault();
        void send('act', {
            k: 'key', p, key: e.key, code: e.code,
            mods: { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey },
        } satisfies PopoutAction);
    }, true);

    // ── The window itself ────────────────────────────────────────────────────
    $('po-back')?.addEventListener('click', async () => { saveGeom(); await send('back'); void win?.destroy?.(); });
    $('po-close')?.addEventListener('click', async () => { saveGeom(); await send('close'); void win?.destroy?.(); });
    $('po-min')?.addEventListener('click', () => { void win?.minimize?.(); });
    $('po-grip')?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        void win?.startResizeDragging?.('SouthEast');
    });

    // Size and place, per panel, for next time. There is no « moved » event in a page: the
    // position is read on a slow tick and on the way out.
    const saveGeom = () => {
        const g = { x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight };
        if (g.w < 200 || g.h < 160) return;
        try { localStorage.setItem(geomKey(id), JSON.stringify(g)); } catch { /* no storage: the default place next time */ }
    };
    let last = '';
    setInterval(() => {
        const now = `${window.screenX},${window.screenY},${window.innerWidth},${window.innerHeight}`;
        if (now !== last) { last = now; saveGeom(); }
    }, 1000);
    window.addEventListener('pagehide', saveGeom);

    void Promise.all([
        ev.listen(popoutEvent(id, 'theme'), (e) => applyTheme(e.payload as ThemePayload)),
        ev.listen(popoutEvent(id, 'html'), (e) => render(e.payload as HtmlPayload)),
    ]).then(() => send('ready'));
    // Nobody answered (the main window reloaded, or the panel is gone): this window has nothing
    // to show and nothing to send to, so it does not stay open as an empty frame.
    setTimeout(() => { if (!gotHtml) void win?.destroy?.(); }, 4000);
}

/** Make `from`'s children look like `to`'s, keeping every element whose place and tag did
 *  not change. `to` is consumed. */
function morphChildren(from: Element, to: Element, active: Element | null): void {
    const a = Array.from(from.childNodes);
    const b = Array.from(to.childNodes);
    for (let i = 0; i < b.length; i++) {
        const x = a[i];
        const y = b[i];
        if (!x) { from.appendChild(y); continue; }
        if (x.nodeType !== y.nodeType || (x instanceof Element && (x.tagName !== (y as Element).tagName || inputType(x) !== inputType(y as Element)))) {
            from.replaceChild(y, x);
            continue;
        }
        if (x instanceof Element) morphElement(x, y as Element, active);
        else if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
    }
    for (let i = a.length - 1; i >= b.length; i--) a[i].remove();
}

function inputType(el: Element): string { return el instanceof HTMLInputElement ? el.type : ''; }

function morphElement(x: Element, y: Element, active: Element | null): void {
    const focused = x === active;
    for (const at of Array.from(y.attributes)) {
        if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
    }
    for (const at of Array.from(x.attributes)) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
    // What the attributes no longer drive once a field has been touched: its live value. The
    // field you are in keeps yours (what you typed is on its way to the panel already).
    if (x instanceof HTMLInputElement && !focused) {
        if (x.type === 'checkbox' || x.type === 'radio') x.checked = y.hasAttribute('checked');
        else if (x.type !== 'file' && x.value !== (y.getAttribute('value') ?? '')) x.value = y.getAttribute('value') ?? '';
    }
    if (x instanceof HTMLTextAreaElement) {
        if (!focused && x.value !== (y.textContent ?? '')) x.value = y.textContent ?? '';
        if (x.defaultValue !== (y.textContent ?? '')) x.defaultValue = y.textContent ?? '';
        return;
    }
    if (x instanceof HTMLOptionElement) x.selected = y.hasAttribute('selected');
    morphChildren(x, y, active);
}

if (typeof document !== 'undefined' && document.getElementById('po-host')) start();
