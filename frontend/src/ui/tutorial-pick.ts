// Point at a thing, get a selector.
//
// A tutorial step highlights an element by CSS selector, and typing one by hand means opening
// devtools, finding the node, and guessing which part of its class list is stable. That is a
// developer's task in a feature meant for anybody who can write a lesson.
//
// So: a pick mode. Hover outlines what is under the cursor, a label names the selector that
// would be produced, and a click returns it. Escape or a right-click cancels.
//
// WHAT MAKES A GOOD SELECTOR HERE
//
// Not the shortest one — the most STABLE one. A tutorial runs on somebody else's install,
// where the mod list holds different rows and the third card is a different card. So the
// ranking is: an id, then a data-* hook, then a class that looks structural, and only then a
// positional path — which is offered with a warning, because it is the one that breaks.

const OVERLAY_ID = 'tut-pick-layer';

/** Classes that describe STATE or a moment, not the thing itself. A selector built on one of
 *  these matches while the app happens to be in that state and stops the second it is not. */
// Prefixes are PREFIXES, whole words are whole words. Written as one anchored alternation
// this read as "the class is exactly `is-`", so `is-active` sailed through and the picker
// offered `.is-active` for a card — a selector that matches while the app happens to be in
// that state and stops the moment it is not. Caught by pointing at a probe element, not by
// re-reading the regex.
const VOLATILE = /^(is|has|js|aria|state)-|^(active|open|selected|disabled|hidden|show|hide|on|off|done|doing|here|busy|loading|error|warn|ok|current|expanded|collapsed|dragging|hover|focus|visible)$/;

/** How stable a selector looks, for the hint shown while picking. */
export type PickQuality = 'id' | 'hook' | 'class' | 'positional';

export interface PickResult { selector: string; quality: PickQuality }

/**
 * The best selector for one element.
 *
 * Returns the quality alongside it so the caller can say plainly when the answer is the weak
 * kind — a positional path is not wrong, it is fragile, and the person choosing it should know
 * that before they ship a lesson built on it.
 */
export function selectorFor(el: Element): PickResult {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return { selector: `#${el.id}`, quality: 'id' };

    // A data-* hook is a decision somebody made about this element, which is exactly what a
    // tutorial wants to hang on.
    for (const attr of ['data-view', 'data-tab', 'data-action', 'data-testid', 'data-close']) {
        const v = el.getAttribute(attr);
        if (v && /^[\w.:-]+$/.test(v)) return { selector: `[${attr}="${v}"]`, quality: 'hook' };
    }

    const classes = Array.from(el.classList).filter((c) => !VOLATILE.test(c) && /^[a-z][\w-]*$/i.test(c));
    if (classes.length) {
        // The most specific single class that is unique on the page. Combining two classes
        // narrows the match but also makes it brittle: any of them being dropped breaks it.
        for (const c of classes) {
            if (document.querySelectorAll(`.${c}`).length === 1) return { selector: `.${c}`, quality: 'class' };
        }
        // Not unique — anchor it to the nearest ancestor that is.
        for (let p = el.parentElement; p; p = p.parentElement) {
            if (p.id && /^[A-Za-z][\w-]*$/.test(p.id)) {
                const sel = `#${p.id} .${classes[0]}`;
                if (document.querySelectorAll(sel).length === 1) return { selector: sel, quality: 'class' };
                break;
            }
        }
        return { selector: `.${classes[0]}`, quality: 'class' };
    }

    // Nothing nameable. A positional path, and the caller is told what it is.
    const parts: string[] = [];
    for (let n: Element | null = el; n && n !== document.body && parts.length < 4; n = n.parentElement) {
        const parent = n.parentElement;
        if (!parent) break;
        const idx = Array.from(parent.children).indexOf(n) + 1;
        parts.unshift(`${n.tagName.toLowerCase()}:nth-child(${idx})`);
        if (parent.id) { parts.unshift(`#${parent.id}`); break; }
    }
    return { selector: parts.join(' > '), quality: 'positional' };
}

/**
 * Enter pick mode. Resolves with the chosen selector, or null if cancelled.
 *
 * The layer is `position: absolute` inside the app frame rather than fixed on <body>: the
 * frame carries `contain: paint`, so a fixed layer on the body escapes the rounded window and
 * dims the desktop. Same rule as every other hand-built overlay in this app.
 */
export function pickElement(hint: string, cancelLabel: string): Promise<PickResult | null> {
    return new Promise((resolve) => {
        document.getElementById(OVERLAY_ID)?.remove();
        const frame = document.getElementById('app-window-outer') || document.body;

        const layer = document.createElement('div');
        layer.id = OVERLAY_ID;
        const box = document.createElement('div');
        box.className = 'tut-pick-box';
        const tip = document.createElement('div');
        tip.className = 'tut-pick-tip';
        const bar = document.createElement('div');
        bar.className = 'tut-pick-bar';
        bar.textContent = hint;
        const esc = document.createElement('span');
        esc.className = 'tut-pick-esc';
        esc.textContent = cancelLabel;
        bar.append(esc);
        layer.append(box, tip, bar);
        frame.append(layer);

        let current: Element | null = null;

        const finish = (r: PickResult | null) => {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('contextmenu', onCancel, true);
            layer.remove();
            resolve(r);
        };

        const onMove = (e: MouseEvent) => {
            // The layer must not find ITSELF under the cursor.
            layer.style.pointerEvents = 'none';
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el || el === current || layer.contains(el)) return;
            current = el;
            const r = el.getBoundingClientRect();
            const f = frame.getBoundingClientRect();
            box.style.cssText = `left:${r.left - f.left}px; top:${r.top - f.top}px; width:${r.width}px; height:${r.height}px;`;
            const { selector, quality } = selectorFor(el);
            tip.textContent = selector;
            tip.dataset.quality = quality;
            tip.style.cssText = `left:${r.left - f.left}px; top:${Math.max(0, r.top - f.top - 22)}px;`;
        };

        const onClick = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const el = document.elementFromPoint(e.clientX, e.clientY);
            finish(el && !layer.contains(el) ? selectorFor(el) : null);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
        const onCancel = (e: Event) => { e.preventDefault(); finish(null); };

        // Capture phase throughout: the app is full of its own click handlers, and a pick
        // must never also press the button it is pointing at.
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('contextmenu', onCancel, true);
    });
}
