// Syntax highlighting for rendered markdown, in one place.
//
// Prism is vendored (assets/vendor/prism.min.js) and loaded with `data-manual`, so it never
// walks the document on its own — nothing is highlighted until someone asks. That matters in
// BMM: markdown arrives from release notes, the community blog, app descriptions and the
// bundled documentation, and each is injected into the DOM at a different moment.
//
// One exported function rather than a MutationObserver: the call sites are few and greppable,
// and an observer watching the whole document to catch a handful of code blocks is a cost paid
// on every DOM change for a benefit that shows up rarely.

/** Highlight every `<code class="language-…">` inside `root`.
 *
 *  Safe to call on anything: no Prism, no code blocks, or a language Prism does not know are
 *  all no-ops — an unknown language is left as plain text rather than throwing. Already
 *  highlighted blocks are skipped, so calling it twice on the same container costs nothing. */
export function highlightIn(root: ParentNode | null | undefined): void {
    if (!root) return;
    const Prism = (globalThis as any).Prism;
    if (!Prism?.highlightElement) return;
    const blocks = (root as ParentNode).querySelectorAll?.('code[class*="language-"]:not([data-hl])');
    if (!blocks?.length) return;
    blocks.forEach((el) => {
        (el as HTMLElement).dataset.hl = '1';
        try { Prism.highlightElement(el, false); } catch { /* leave the code as plain text */ }
    });
}

// Re-highlight after a theme switch.
//
// The token colours are all var(--bmm-*), so in principle a theme change should just repaint
// them. In practice I could not get already-highlighted blocks to pick up a changed token in a
// test harness — a freshly created element with the same classes took the new value while the
// existing one kept the old, and the minimal isolated case propagated correctly, so I never
// explained the difference. Rather than ship a claim I cannot back, this makes the question
// moot: highlighting is cheap and idempotent (Prism rebuilds from textContent), so redoing it
// on a theme change guarantees the right colours whatever the cause was.
//
// Debounced because the theme editor re-applies a preview on every keystroke.
if (typeof window !== 'undefined') {
    let t: number | null = null;
    window.addEventListener('bmm:theme-applied', () => {
        if (t != null) window.clearTimeout(t);
        t = window.setTimeout(() => {
            document.querySelectorAll<HTMLElement>('code[data-hl]').forEach((el) => { delete el.dataset.hl; });
            highlightIn(document);
        }, 220);
    });
}
