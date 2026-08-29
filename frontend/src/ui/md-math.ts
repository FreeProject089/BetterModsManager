// `$$E = mc^2$$`, typeset.
//
// The website has done this since it shipped and BMM rendered the dollar signs, so a post
// written once and read in two places lost its formulas in exactly one of them — the app.
//
// Two rules, both taken from the website rather than reinvented:
//
//   · `$$…$$` ONLY. Single-dollar maths is deliberately off, because this app quotes prices
//     and "$5 and $10" would otherwise be typeset as a formula — silently, since a price does
//     not error, it becomes italic nonsense.
//   · A formula that will not parse renders as what the author typed. KaTeX's own error
//     message in the middle of a paragraph is worse than the source: the author can fix the
//     source, and nobody can fix a message.
//
// Both renderers emit the same placeholder and this does the typesetting afterwards, which is
// the same shape as the lucide masks and the schedule cards: a string renderer cannot await a
// 272 KB script, and should not try.
import { escHtml, escAttr } from '../core/utils.js';

/** Does this document have any maths at all? Nothing is loaded when the answer is no. */
export const HAS_MATH = /\$\$[\s\S]+?\$\$/;

/**
 * `$$…$$` → a placeholder carrying the source.
 *
 * The TeX rides in an attribute rather than in the text: it is full of characters that mean
 * something to a markdown parser, and every one of them would be interpreted between here and
 * the DOM.
 */
export function markMath(src: string): string {
    if (!src || !HAS_MATH.test(src)) return src;
    return src.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => {
        const t = String(tex).trim();
        // Display when it stands alone on its lines, inline when it sits in a sentence — the
        // same distinction the website draws, and the reason a formula in a paragraph does not
        // suddenly become a centred block.
        const block = /\n/.test(tex);
        // The VISIBLE fallback is folded onto one line while the attribute keeps the source
        // exactly. Two reasons, both structural: md-lite splits its input by lines and a
        // multi-line placeholder would be cut in half, and `marked` would read the blank line
        // inside a display formula as a paragraph break.
        return `<span class="doc-math${block ? ' doc-math-block' : ''}" data-tex="${escAttr(t)}">${escHtml(t.replace(/\s*\n\s*/g, ' '))}</span>`;
    });
}

/**
 * Typeset every placeholder inside `host`.
 *
 * Safe to call on a subtree with none: it loads nothing when there is nothing to typeset,
 * which is what keeps a 272 KB script off a page that mentions no formulas.
 */
export async function typesetMath(host: HTMLElement | null): Promise<void> {
    if (!host) return;
    const nodes = [...host.querySelectorAll<HTMLElement>('.doc-math[data-tex]')].filter((el) => !el.dataset.done);
    if (!nodes.length) return;
    let katex: any = null;
    try {
        const { ensureKatex } = await import('./lazy-vendor.js');
        katex = await ensureKatex();
    } catch {
        // Offline, or the file is missing from this build: the source text stays on screen,
        // which is the same answer the website gives when its lazy import fails.
        return;
    }
    if (!katex?.renderToString) return;
    for (const el of nodes) {
        const tex = el.dataset.tex || '';
        el.dataset.done = '1';
        try {
            el.innerHTML = katex.renderToString(tex, {
                displayMode: el.classList.contains('doc-math-block'),
                throwOnError: false,
                output: 'html',
            });
        } catch {
            // Left exactly as the author wrote it.
        }
    }
}

/**
 * Typeset whatever appears, wherever it appears.
 *
 * `renderMarkdown` returns a STRING, and seven different screens drop that string into a
 * different element — a community article, a comment, its live preview, two release-note
 * modals, an app's description. Calling the typesetter from each of them is seven places to
 * remember and one to forget, which is the shape of defect this codebase keeps paying for.
 *
 * So the rule lives once, at the document. It does nothing until a `.doc-math` actually turns
 * up, and `typesetMath` is idempotent, so the hydrator calling it directly costs nothing.
 */
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    let pending = 0;
    const sweep = () => {
        pending = 0;
        void typesetMath(document.body);
    };
    new MutationObserver((records) => {
        if (pending) return;
        // Only when something that could BE a formula was added. Every keystroke in an editor
        // mutates this tree; walking it each time would be a real cost for an empty answer.
        const worth = records.some((r) => [...r.addedNodes].some((n) => n instanceof HTMLElement
            && (n.classList?.contains('doc-math') || n.querySelector?.('.doc-math[data-tex]'))));
        if (!worth) return;
        pending = requestAnimationFrame(sweep);
    }).observe(document.documentElement, { childList: true, subtree: true });
}
