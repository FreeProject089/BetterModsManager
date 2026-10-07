// laya-explain-md.ts — « Expliquer » (the crash manager) shown as B.MD, safely.
//
// The explanation is written by a model from a crash log: UNTRUSTED text, as foreign as a
// plugin's README. It goes through the same path as one (`plugin-assets.ts`): md-lite's
// untrusted render, which runs DOMPurify over the result and fails closed (escaped text) when
// DOMPurify is missing. On top of that, nothing in it may FETCH anything: directives (embeds,
// replays, files, cards) are dropped from the source, an image is reduced to its alt text, and
// any media tag left in the HTML is removed. Links stay as md-lite renders them for untrusted
// text (`javascript:` and the like are refused by `safeDocUrl`).
import { renderDocMarkdown } from '../../docs/md-lite.js';

/** The model's text as B.MD source a crash explanation may use: prose, lists, emphasis, code. */
export function explainSource(text: string): string {
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .slice(0, 4000)
        // Block and leaf directives (`:::card`, `:::replay`, `::toc`…): not prose, may fetch.
        .split('\n').filter((l) => !/^\s*::/.test(l)).join('\n')
        // Inline directives (`:button[…]{…}`, `:icon[…]`): their label only.
        .replace(/(^|[^\w:]):[a-z][\w-]*\[([^\]\n]*)\](\{[^}\n]*\})?/gi, '$1$2')
        // Images: their alt text.
        .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
        // Raw markup never renders as markup here: md-lite escapes it, this makes it plain
        // (`>` stays: it is a quote in B.MD and harmless without a `<`).
        .replace(/</g, '‹');
}

/** The HTML of an explanation: untrusted md-lite render, then no media tag survives. */
export function explainHtml(text: string): string {
    const src = explainSource(text);
    if (!src.trim()) return '';
    return renderDocMarkdown(src)
        .replace(/<(img|video|audio|source|iframe|object|embed)\b[^>]*>/gi, '')
        .replace(/<\/(video|audio|iframe|object)>/gi, '');
}
