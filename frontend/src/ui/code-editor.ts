// Syntax colours in a plain <textarea>.
//
// A textarea cannot hold coloured text — it renders its value as one run of plain characters,
// and that is exactly why it works so well: native undo, IME, selection, find-in-page, screen
// readers, and the browser's own caret. Swapping it for a contenteditable div buys colour and
// loses all of that.
//
// So the textarea STAYS, and a highlighted mirror sits directly behind it: the same text,
// tokenised by Prism, positioned so every character lands on the same pixel. The textarea's
// own text goes transparent; its caret does not. What you edit is still a textarea; what you
// see is the mirror.
//
// HOW THE TWO ARE KEPT IN STEP is the whole design, and the obvious approach is the wrong
// one. Copying the textarea's computed font, padding, line-height and tab-size onto the
// mirror as inline styles LOOKS right and did not work: the inline attribute was present and
// correct — `font-size: 13px`, `padding: 8px 12px` — while the element computed 14px and zero
// padding, and adding `!important` changed nothing. I never explained it, and a mechanism I
// cannot explain is not one to build on.
//
// What is used instead needs no explanation: the mirror is given THE SAME CSS CLASSES as the
// textarea, so the same stylesheet rules produce the same metrics by construction. Measured
// across font, size, weight, letter-spacing, line-height, padding, tab-size, box-sizing and
// border width: identical on every one. Only `white-space` differs — a textarea soft-wraps by
// default and a div does not — and that single difference is fixed in the stylesheet, where a
// reader can see it, rather than in twenty-two lines of JavaScript.
//
// The rule this leaves behind: nothing here or in .code-hl-mirror may set a font, a padding,
// a line-height or a tab-size. The moment one of them does, the colours slide off the words.

import { highlightIn } from './code-highlight.js';

export interface CodeEditorHandle {
    /** Re-read the textarea and repaint. Must be called after setting `.value` from code —
     *  assigning to `value` fires no `input` event, so nothing repaints and the mirror keeps
     *  showing the previous document. This is the one way to get this wrong. */
    refresh(): void;
    /** Remove the mirror and put the textarea back where it was. */
    detach(): void;
}

/**
 * Give one textarea a highlighted backdrop.
 *
 * Degrades to an ordinary textarea if anything is missing — no Prism, not a textarea, already
 * attached. Colour is a convenience; being able to type is not.
 */
export function attachHighlight(ta: HTMLTextAreaElement | null, language: string): CodeEditorHandle | null {
    if (!ta || ta.tagName !== 'TEXTAREA') return null;
    if (!(globalThis as any).Prism?.highlightElement) return null;
    if (ta.dataset.hlAttached) return null;   // idempotent: the editor is re-opened on every edit
    ta.dataset.hlAttached = '1';

    const wrap = document.createElement('div');
    wrap.className = 'code-hl-wrap';

    // A DIV, not a PRE. Prism.highlightElement REWRITES the className of a <pre> parent,
    // stamping `language-x` onto the very element whose classes are load-bearing here.
    const mirror = document.createElement('div');
    // The textarea's own classes first — that is what makes the metrics match — then ours.
    mirror.className = `${ta.className} code-hl-mirror`;
    mirror.setAttribute('aria-hidden', 'true');   // the textarea is the accessible copy
    const code = document.createElement('code');
    code.className = `language-${language}`;
    mirror.append(code);

    ta.parentNode?.insertBefore(wrap, ta);
    wrap.append(mirror, ta);

    const sync = () => {
        mirror.scrollTop = ta.scrollTop;
        mirror.scrollLeft = ta.scrollLeft;
    };
    const paint = () => {
        // The trailing space is load-bearing: a value ending in a newline leaves the mirror's
        // last line empty, an empty last line has no height, and the mirror ends up one line
        // shorter than the textarea — so the last line drifts out of alignment when scrolled.
        code.textContent = ta.value + (ta.value.endsWith('\n') ? ' ' : '');
        delete (code as HTMLElement).dataset.hl;
        highlightIn(mirror);
        sync();
    };

    // Debounced: highlighting re-tokenises the whole document, and a fast typist would pay for
    // it on every keystroke. Typing itself is never debounced — the characters appear at once,
    // only their colours arrive a frame later.
    let timer: number | null = null;
    const onInput = () => {
        sync();
        if (timer != null) window.clearTimeout(timer);
        timer = window.setTimeout(paint, 90);
    };
    ta.addEventListener('input', onInput);
    ta.addEventListener('scroll', sync);
    // The textarea is user-resizable (resize: vertical), so the mirror has to follow or it
    // stops covering the area being typed into.
    const ro = new ResizeObserver(sync);
    ro.observe(ta);

    paint();

    return {
        refresh: paint,
        detach() {
            if (timer != null) window.clearTimeout(timer);
            ro.disconnect();
            ta.removeEventListener('input', onInput);
            ta.removeEventListener('scroll', sync);
            delete ta.dataset.hlAttached;
            wrap.parentNode?.insertBefore(ta, wrap);
            wrap.remove();
        },
    };
}
