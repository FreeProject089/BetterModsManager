// Delegated replacements for inline `on…=` attributes.
//
// WHY THIS EXISTS
//
// Every `onclick="…"` written into generated HTML only runs because script-src still
// carries `'unsafe-inline'`. That same permission is what lets an injected
// `<img src=x onerror=…>` execute — and in a Tauri app, script execution reaches
// `window.__TAURI__` and the whole command surface. The handlers are not the
// vulnerability; they are the reason the permission that IS the vulnerability cannot be
// removed.
//
// Delegation rather than per-element listeners: this frontend builds its UI by assigning
// innerHTML, so elements are replaced constantly and any listener attached to one dies
// with it. A listener on `document` survives every re-render and costs one handler for
// the whole app rather than one per node.
//
// Attach once, at startup, before anything renders.

/** Tooltip help, replacing 126 `onmouseenter="window.showTaskyHelp(…)"` /
 *  `onmouseleave="window.hideTaskyHelp()"` pairs.
 *
 *  Markup becomes `data-tasky="<key>"` with an optional `data-tasky-icon="<icon>"`.
 *
 *  `mouseenter`/`mouseleave` do NOT bubble, which is why this listens for
 *  `mouseover`/`mouseout` — the bubbling pair — and then filters. Without the
 *  `relatedTarget` check below, moving the pointer between a child and its parent inside
 *  the same element would fire a spurious out-then-in and make the tooltip flicker.
 */
function bindTasky(): void {
    const closestTasky = (t: EventTarget | null): HTMLElement | null =>
        t instanceof Element ? t.closest<HTMLElement>('[data-tasky],[data-tasky-from]') : null;

    document.addEventListener('mouseover', (e) => {
        const el = closestTasky(e.target);
        if (!el) return;
        // Still inside the same [data-tasky]? Then nothing was entered.
        if (closestTasky((e as MouseEvent).relatedTarget) === el) return;
        // `data-tasky-from="path"` reads the key out of another data attribute on the same
        // element, which is what the inline `showTaskyHelp(this.dataset.path, …)` calls did.
        // Delegation gave that back for free: `el` here IS the element the attribute is on.
        const from = el.dataset.taskyFrom;
        const key = from ? el.dataset[from] : el.dataset.tasky;
        if (!key) return;
        // The third argument is showTaskyHelp's `isLiteral`: the key is the text itself
        // rather than a translation id. A file path is literal; a message id is not.
        (window as any).showTaskyHelp?.(key, el.dataset.taskyIcon || 'info', el.dataset.taskyLiteral === '1');
    });

    document.addEventListener('mouseout', (e) => {
        const el = closestTasky(e.target);
        if (!el) return;
        if (closestTasky((e as MouseEvent).relatedTarget) === el) return;  // moved within it
        (window as any).hideTaskyHelp?.();
    });
}

/** Image fallbacks, replacing `onerror="this.style.display='none'"` and friends.
 *
 *  Markup becomes `data-onerror="hide"` (hides the image) or `data-onerror="hide-parent"`
 *  with `data-onerror-target="<selector>"` (hides an ancestor — used where an empty
 *  gallery should disappear rather than leave a hole).
 *
 *  Registered with `capture: true` because `error` on an <img> does not bubble; it only
 *  reaches `document` on the capture phase. Getting that wrong is silent — the image just
 *  stays broken — so it is worth stating rather than discovering.
 */
function bindImageFallback(): void {
    document.addEventListener('error', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLElement)) return;
        const mode = el.dataset.onerror;
        if (!mode) return;
        if (mode === 'hide') {
            el.style.display = 'none';
        } else if (mode === 'hide-parent') {
            const sel = el.dataset.onerrorTarget;
            const target = sel ? el.closest<HTMLElement>(sel) : el.parentElement;
            if (target) target.style.display = 'none';
        }
    }, true);
}

/** Click actions of the uniform `window.fn('arg', …)` shape.
 *
 *  Markup becomes `data-act="fnName"` plus `data-act-args='["a","b"]'` (JSON), and
 *  `data-act-stop="1"` where the inline version called `event.stopPropagation()`.
 *
 *  Only functions already published on `window` are callable, and only by name — there is
 *  no expression evaluation here. That is the whole point: an attribute that used to be a
 *  snippet of JavaScript becomes a name and a list of strings.
 */
function bindActions(): void {
    document.addEventListener('click', (e) => {
        const el = (e.target instanceof Element) ? e.target.closest<HTMLElement>('[data-act]') : null;
        if (!el) return;
        const name = el.dataset.act;
        if (!name) return;
        if (el.dataset.actStop) e.stopPropagation();
        let args: unknown[] = [];
        const raw = el.dataset.actArgs;
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                args = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
                // A malformed arg list calls the function with none rather than throwing:
                // the alternative is an unhandled error from a click, which tells the user
                // nothing and hides the rest of the page's behaviour.
                args = [];
            }
        }
        const fn = (window as any)[name];
        if (typeof fn === 'function') fn(...args);
    });
}

let attached = false;

/** Call once at startup. Idempotent — a second call is a no-op rather than a second set
 *  of listeners, because double-firing a click action is worse than not attaching. */
export function initInlineActions(): void {
    if (attached) return;
    attached = true;
    bindTasky();
    bindImageFallback();
    bindActions();
}
