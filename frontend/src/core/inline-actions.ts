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
 *  Markup becomes `data-onerror="hide"` (hides the image), `data-onerror="hide-parent"`
 *  with `data-onerror-target="<selector>"` (hides an ancestor — used where an empty
 *  gallery should disappear rather than leave a hole), `data-onerror="text"` with
 *  `data-onerror-text="FR"` (replaces the image with a short text badge), or
 *  `data-onerror="swap-next"` (hides the image and shows the placeholder beside it).
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
        } else if (mode === 'text') {
            // A flag image that fails becomes its country code in small caps. Three sites
            // spelled this out inline with three copies of the same style string; the style
            // lives here now, so it can only be one thing.
            const span = document.createElement('span');
            span.style.fontSize = '10px';
            span.style.fontWeight = '700';
            // textContent, not innerHTML: this is the one place a fallback could reintroduce
            // markup, and the value comes from data the app did not necessarily author.
            span.textContent = el.dataset.onerrorText || '';
            el.replaceWith(span);
        } else if (mode === 'swap-next') {
            // Hide the broken image and reveal the placeholder that already sits next to it.
            el.style.display = 'none';
            const next = el.nextElementSibling;
            if (next instanceof HTMLElement) next.style.display = 'flex';
        }
    }, true);
}

/** Style-only hover, replacing 54 `onmouseover="this.style.background='x'"` handlers and
 *  their matching `onmouseout`.
 *
 *  Markup becomes `data-hover="background:x"` and `data-hover-out="background:y"`, each a
 *  plain list of CSS declarations. `data-focus` / `data-blur` and `data-press` /
 *  `data-press-out` are the same thing for the focus and pressed states.
 *
 *  This is a BRIDGE, not the destination. Twenty-five of these sites carry twenty distinct
 *  value pairs, so real `:hover` rules would have meant twenty near-identical classes for
 *  twenty-five usages — a worse trade than it looks. What this buys is the removal of 54
 *  handlers that each require `script-src 'unsafe-inline'`, which is the actual blocker.
 *  Moving them into stylesheets, where hover has belonged all along, is a refactor that can
 *  happen afterwards and cannot happen before.
 */
function bindHoverStyles(): void {
    const apply = (el: HTMLElement, decls: string | undefined) => {
        if (!decls) return;
        for (const part of decls.split(';')) {
            const i = part.indexOf(':');
            if (i < 1) continue;
            const prop = part.slice(0, i).trim();
            const value = part.slice(i + 1).trim();
            // setProperty rather than assigning cssText: cssText would wipe every other
            // inline style on the element, and most of these elements carry a full inline
            // style attribute already.
            if (prop) el.style.setProperty(prop, value);
        }
    };
    const closestHover = (t: EventTarget | null): HTMLElement | null =>
        t instanceof Element ? t.closest<HTMLElement>('[data-hover],[data-hover-out]') : null;

    // Same relatedTarget filtering as the tooltips, and for the same reason: mouseover and
    // mouseout fire again when the pointer crosses between an element and its own child.
    document.addEventListener('mouseover', (e) => {
        const el = closestHover(e.target);
        if (!el || closestHover((e as MouseEvent).relatedTarget) === el) return;
        apply(el, el.dataset.hover);
    });
    document.addEventListener('mouseout', (e) => {
        const el = closestHover(e.target);
        if (!el || closestHover((e as MouseEvent).relatedTarget) === el) return;
        apply(el, el.dataset.hoverOut);
    });

    // `focus`/`blur` do not bubble either — `focusin`/`focusout` are the bubbling pair, and
    // they need no relatedTarget filtering because focus is on exactly one element at a time.
    document.addEventListener('focusin', (e) => {
        const el = e.target;
        if (el instanceof HTMLElement) apply(el, el.dataset.focus);
    });
    document.addEventListener('focusout', (e) => {
        const el = e.target;
        if (el instanceof HTMLElement) apply(el, el.dataset.blur);
    });

    // The press effect. `mousedown`/`mouseup` bubble on their own, so no pair-swap is
    // needed — only the closest() walk, because the press can land on an icon inside
    // the button.
    const closestPress = (t: EventTarget | null): HTMLElement | null =>
        t instanceof Element ? t.closest<HTMLElement>('[data-press]') : null;
    document.addEventListener('mousedown', (e) => {
        const el = closestPress(e.target);
        if (el) apply(el, el.dataset.press);
    });
    // On document, not on the element: releasing the button after dragging the pointer off
    // it fires mouseup elsewhere, and the inline version left the element stuck pressed.
    document.addEventListener('mouseup', () => {
        document.querySelectorAll<HTMLElement>('[data-press-out]').forEach((el) => {
            apply(el, el.dataset.pressOut);
        });
    });
}

/** Click actions of the uniform `window.fn('arg', …)` shape.
 *
 *  Markup becomes `data-act="fnName"` plus `data-act-args='["a","b"]'` (JSON),
 *  `data-act-stop="1"` where the inline version called `event.stopPropagation()`, and
 *  `data-act-prevent="1"` for `event.preventDefault()`. `data-act-change` and
 *  `data-act-input` are the same for those two events.
 *
 *  A name that is not on `window` calls nothing, exactly as the `window.fn && window.fn()`
 *  guards in the old markup did.
 *
 *  Only functions already published on `window` are callable, and only by name — there is
 *  no expression evaluation here. That is the whole point: an attribute that used to be a
 *  snippet of JavaScript becomes a name and a list of strings.
 */
function bindActions(): void {
    // The handlers that passed `this` or `event` were the ones a delegate seemed unable to
    // replace — which was backwards: the delegate holds BOTH. `data-act-with` names what to
    // prepend to the argument list, from a closed vocabulary of three, so an attribute still
    // cannot express anything but a choice among known values.
    const contextArgs = (el: HTMLElement, e: Event): unknown[] =>
        (el.dataset.actWith || '').split(',').map((w) => w.trim()).filter(Boolean).map((w) => {
            if (w === 'event') return e;
            if (w === 'element') return el;
            if (w === 'next') return el.nextElementSibling;
            return undefined;
        });

    const run = (el: HTMLElement, e: Event, name: string, rawArgs: string | undefined) => {
        if (el.dataset.actStop) e.stopPropagation();
        if (el.dataset.actPrevent) e.preventDefault();
        let args: unknown[] = [];
        if (rawArgs) {
            try {
                const parsed = JSON.parse(rawArgs);
                args = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
                // A malformed arg list calls the function with none rather than throwing:
                // the alternative is an unhandled error from a click, which tells the user
                // nothing and hides the rest of the page's behaviour.
                args = [];
            }
        }
        const fn = (window as any)[name];
        if (typeof fn === 'function') fn(...contextArgs(el, e), ...args);
    };

    // `change`, for the select/checkbox handlers. A separate attribute rather than reusing
    // `data-act`: a checkbox fires click AND change, so one attribute serving both would
    // call the function twice.
    document.addEventListener('change', (e) => {
        const el = (e.target instanceof Element) ? e.target.closest<HTMLElement>('[data-act-change]') : null;
        if (el?.dataset.actChange) run(el, e, el.dataset.actChange, el.dataset.actChangeArgs);
    }, true);
    document.addEventListener('input', (e) => {
        const el = (e.target instanceof Element) ? e.target.closest<HTMLElement>('[data-act-input]') : null;
        if (el?.dataset.actInput) run(el, e, el.dataset.actInput, el.dataset.actInputArgs);
    }, true);

    // CAPTURE, not bubble. `data-act-stop` replaces an inline
    // `onclick="fn(); event.stopPropagation()"`, whose whole job was to keep a click on a
    // button from also reaching the card behind it. A delegated listener on `document`
    // during the BUBBLE phase runs after the event has already visited every ancestor, so
    // stopPropagation() there stops nothing that had not already happened — verified: the
    // outer element still saw the click. Capture runs document -> target, so stopping there
    // is the only place a delegate can honour it.
    document.addEventListener('click', (e) => {
        const el = (e.target instanceof Element) ? e.target.closest<HTMLElement>('[data-act]') : null;
        if (!el) return;
        const name = el.dataset.act;
        if (!name) return;
        run(el, e, name, el.dataset.actArgs);
    }, true);
}

/** The handlers that called no function at all — they poked the DOM directly.
 *
 *  Each is one fixed behaviour named by an attribute, so the markup states an intent
 *  ("close this modal") instead of carrying a fragment of DOM code.
 */
function bindDomBehaviours(): void {
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        // Forward the click to a real control elsewhere — used by menu entries that stand in
        // for a hidden button, so the button keeps being the single implementation.
        const proxy = t.closest<HTMLElement>('[data-click-proxy]');
        if (proxy) {
            e.preventDefault();
            document.querySelector<HTMLElement>(proxy.dataset.clickProxy || '')?.click();
            return;
        }

        // Close a modal by dropping the `open` class, BMM's convention throughout.
        const close = t.closest<HTMLElement>('[data-close-modal]');
        if (close) {
            document.querySelector<HTMLElement>(close.dataset.closeModal || '')?.classList.remove('open');
            return;
        }

        // Remove the nearest matching ancestor — for the modals built and thrown away rather
        // than toggled.
        const rm = t.closest<HTMLElement>('[data-remove-closest]');
        if (rm) rm.closest<HTMLElement>(rm.dataset.removeClosest || '')?.remove();
    });

    // Copy to the clipboard, with the brief green flash the inline versions did by hand.
    // The value rides in an attribute rather than being interpolated into a JS string —
    // which is what made a hash or a path a code-injection surface in the first place.
    document.addEventListener('click', (e) => {
        const el = (e.target instanceof Element) ? e.target.closest<HTMLElement>('[data-copy]') : null;
        if (!el) return;
        void navigator.clipboard.writeText(el.dataset.copy || '').then(() => {
            const flash = el.dataset.copyFlash;
            if (flash === 'tick') {
                const before = el.textContent;
                el.textContent = '✓';
                setTimeout(() => { el.textContent = before; }, 800);
            } else if (flash) {
                const before = el.style.background;
                el.style.background = flash;
                setTimeout(() => { el.style.background = before; }, 800);
            }
        });
    });

    // A password field's reveal toggle.
    document.addEventListener('click', (e) => {
        const el = (e.target instanceof Element) ? e.target.closest<HTMLElement>('[data-toggle-password]') : null;
        if (!el) return;
        const input = document.querySelector<HTMLInputElement>(el.dataset.togglePassword || '');
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
    });

    // Click the backdrop of an overlay to close it. The `e.target === el` test is the whole
    // point: without it, every click INSIDE the dialog closes the dialog.
    document.addEventListener('click', (e) => {
        const el = e.target;
        if (el instanceof HTMLElement && el.dataset.backdropClose !== undefined) {
            el.classList.remove('open');
        }
    });

    // Toggle a class on the parent — the disclosure arrows.
    document.addEventListener('click', (e) => {
        const el = (e.target instanceof Element) ? e.target.closest<HTMLElement>('[data-toggle-parent]') : null;
        if (el) el.parentElement?.classList.toggle(el.dataset.toggleParent || 'open');
    });

    // Open the element's CURRENT data-url in the system browser. Read at click time, not
    // baked into the attribute, because links.json rewrites data-url after load.
    document.addEventListener('click', (e) => {
        const el = (e.target instanceof Element) ? e.target.closest<HTMLElement>('[data-open-url]') : null;
        if (el?.dataset.url) (window as any).openExternal?.(el.dataset.url);
    });

    // Forms that exist only to group fields and must never navigate.
    document.addEventListener('submit', (e) => {
        if (e.target instanceof HTMLElement && e.target.matches('[data-no-submit]')) e.preventDefault();
    });
}

/** Build the attributes for a delegated click action, correctly escaped.
 *
 *  Replaces `${actAttrs('fn', a, b)}`, and fixes what that spelling could not
 *  do safely: it interpolated values into a JAVASCRIPT string inside an HTML attribute, so
 *  a value containing a quote closed the string and the rest of it ran — with
 *  `'unsafe-inline'` in force, as code. 20 of the 26 sites did this with no escaping at
 *  all, on values like a mod id that come from a folder name.
 *
 *  Here the values never enter a script context: JSON.stringify handles quotes and
 *  backslashes inside the value, and the only character left to worry about is the `'`
 *  that delimits the attribute.
 *
 *  Usage in a template:  `<button ${actAttrs('openThing', id)}>`
 */
export function actAttrs(fn: string, ...args: unknown[]): string {
    const json = JSON.stringify(args).replace(/'/g, '&#39;').replace(/</g, '&lt;');
    return `data-act="${fn}" data-act-args='${json}'`;
}

/** Same, for the sites whose inline version ended in `event.stopPropagation()`. */
export function actAttrsStop(fn: string, ...args: unknown[]): string {
    return `${actAttrs(fn, ...args)} data-act-stop="1"`;
}

let attached = false;

/** Call once at startup. Idempotent — a second call is a no-op rather than a second set
 *  of listeners, because double-firing a click action is worse than not attaching. */
export function initInlineActions(): void {
    if (attached) return;
    attached = true;
    bindTasky();
    bindHoverStyles();
    bindImageFallback();
    bindActions();
    bindDomBehaviours();
}
