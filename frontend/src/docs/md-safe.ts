// Markdown that somebody else wrote, on its way into this window.
//
// `withGlobalTauri` is on, so anything that executes in this webview can call every Tauri
// command the app exposes: read files, spawn processes, write to a profile. update-notes.ts
// says so beside its own sanitiser — "an unsanitised post = potential RCE" — and that
// sanitiser is on the Community path only.
//
// md-lite had none. Its two trusted inputs (bundled pages, and the article bodies written in
// docs-hub.ts) are ours, and its third is not: a PLUGIN's own documentation is a Markdown file
// that arrives with the plugin. `renderDocMarkdown` returned any source starting with `<`
// verbatim — the backward-compatible path that exists for those HTML article bodies — and
// `plugin-assets.ts` put the result straight into `innerHTML`. A README beginning with
// `<img src=x onerror=…>` therefore ran, with the whole backend behind it.
//
// So: rendering is UNTRUSTED by default and the two places that hand it our own HTML say so.
import { escHtml } from '../core/utils.js';
import { isBehaviourAttr } from '../core/inline-actions.js';

/**
 * Remove the attributes the app's document-level listeners act on (`data-act`, `data-click-proxy`,
 * `data-hover`…) from EVERY DOMPurify pass — this one and the Community/notes one in
 * update-notes.ts. Both keep `data-*` because the renderers carry their own state in it, and
 * DOMPurify hooks are global to the instance, so one hook covers both.
 *
 * Why it matters: `data-act="fn"` + `data-act-args` makes a click call `window.fn(...)` with the
 * author's arguments. Sanitised foreign markup is not allowed to decide what the app calls.
 *
 * Installed when this module loads (rich-markdown.ts imports it, so before the first render of
 * either kind) and again, idempotently, from sanitizeDocHtml.
 */
let _behaviourHooked = false;
export function guardPurifyBehaviourAttrs(): void {
    const DP = (globalThis as any).DOMPurify;
    if (_behaviourHooked || !DP || typeof DP.addHook !== 'function') return;
    _behaviourHooked = true;
    DP.addHook('uponSanitizeAttribute', (_node: unknown, data: { attrName: string; keepAttr: boolean }) => {
        if (isBehaviourAttr(data.attrName)) data.keepAttr = false;
    });
}
guardPurifyBehaviourAttrs();

/**
 * Tags the doc renderer legitimately produces. Anything else goes.
 *
 * `button` is on the list because md-lite emits buttons for every outward link — the app
 * opens them itself rather than letting the webview navigate. `style` and `form` are off it
 * for the reasons the Community sanitiser gives.
 */
const ALLOW_TAGS = [
    'a', 'b', 'blockquote', 'br', 'button', 'code', 'col', 'colgroup', 'dd', 'del', 'details',
    'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
    'i', 'img', 'kbd', 'li', 'mark', 'nav', 'ol', 'p', 'pre', 'section', 'small', 'span',
    'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time',
    'tr', 'u', 'ul', 'video', 'source', 'audio',
];

/** Attributes those tags may carry. `data-*` is allowed separately, by the hook below. */
const ALLOW_ATTR = [
    'alt', 'class', 'colspan', 'controls', 'datetime', 'dir', 'height', 'href', 'id', 'lang',
    'loading', 'open', 'rel', 'rowspan', 'span', 'src', 'start', 'style', 'target', 'title',
    'type', 'width', 'role', 'tabindex', 'aria-label', 'aria-hidden', 'aria-expanded',
    'aria-selected', 'aria-controls', 'aria-labelledby', 'hidden',
];

let _hooked = false;

// ── Diagrams through the sanitiser ─────────────────────────────────────────────────────────
//
// DOMPurify drops any attribute whose value holds `-->` (its guard against comment-based mXSS),
// and `-->` is the arrow of every flowchart: through the sanitiser, md-lite's `data-mermaid`
// came out empty and every sanitised render (a plugin's documentation, an order list's notes)
// lost its diagrams. The source is not HTML (mermaid reads it, in strict mode for anything
// untrusted: md-mermaid.ts `drawDiagrams({ strict: true })`), so it goes AROUND the sanitiser:
// taken out before, put back after, on the very element md-lite built for it.

/** md-lite's diagram block, exactly as md-lite writes it (md-lite.ts, the mermaid fence and
 *  `:::mermaid`). Only this shape is stashed: the class is the first attribute, the source the
 *  second. */
const DIAGRAM_ATTR = /(<div class="dh-mermaid") data-mermaid="([^"]*)"/g;

/**
 * Take every diagram source out of md-lite's markup, leaving a reference that only this call
 * knows (`nonce`: a reference written by the document itself matches nothing and is dropped).
 * The sources stay attribute-escaped; a raw `<`, `>` or `'` that did not come from md-lite's
 * escaping is escaped here, so nothing put back can read as markup.
 */
export function stashDiagrams(html: string, nonce: string): { html: string; sources: string[] } {
    const sources: string[] = [];
    const out = String(html || '').replace(DIAGRAM_ATTR, (_m, head: string, src: string) => {
        sources.push(src.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;'));
        return `${head} data-mermaid-ref="${nonce}:${sources.length - 1}"`;
    });
    return { html: out, sources };
}

/**
 * Put the sources back on the sanitised markup: on a `dh-mermaid` block carrying this call's
 * reference, and nowhere else. Every other `data-mermaid-ref` (forged, or orphaned) goes.
 */
export function restoreDiagrams(html: string, sources: string[], nonce: string): string {
    const esc = nonce.replace(/[^\w-]/g, '');
    const ref = new RegExp(`(<div class="dh-mermaid") data-mermaid-ref="${esc}:(\\d+)"`, 'g');
    return String(html || '')
        .replace(ref, (_m, head: string, i: string) => {
            const src = sources[Number(i)];
            return src === undefined ? head : `${head} data-mermaid="${src}"`;
        })
        .replace(/(<[a-z][^<>]*?)\sdata-mermaid-ref="[^"]*"/gi, '$1');
}

function diagramNonce(): string {
    try {
        const a = new Uint32Array(2);
        globalThis.crypto.getRandomValues(a);
        return `m${a[0].toString(36)}${a[1].toString(36)}`;
    } catch {
        return `m${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    }
}

/**
 * Sanitise rendered documentation HTML.
 *
 * Fails CLOSED. If DOMPurify is not loaded — a stripped build, a script that did not arrive —
 * the answer is the source as escaped text, not the source. The Community sanitiser returns
 * its input unchanged in that case, which is the right trade for OUR posts and the wrong one
 * for a file that came with a plugin.
 */
export function sanitizeDocHtml(html: string): string {
    const DP = (globalThis as any).DOMPurify;
    if (!DP || typeof DP.sanitize !== 'function') {
        return `<pre class="dh-unsafe">${escHtml(html)}</pre>`;
    }
    guardPurifyBehaviourAttrs();
    if (!_hooked) {
        _hooked = true;
        DP.addHook('afterSanitizeAttributes', (node: any) => {
            if (!node?.getAttribute) return;
            // Every URL the document carries, checked here rather than trusted from the
            // renderer: this function also runs over raw HTML the renderer never built.
            for (const attr of ['href', 'src']) {
                const raw = node.getAttribute(attr);
                if (raw == null) continue;
                if (!safeDocUrl(raw)) node.removeAttribute(attr);
            }
            // `style` survives because cards and badges carry a colour. Its VALUE did not
            // survive anything: `position:fixed;inset:0` covers the window, no script needed.
            const style = node.getAttribute('style');
            if (style && /expression\s*\(|javascript\s*:|position\s*:\s*(fixed|sticky)|url\s*\(\s*['"]?\s*(?:javascript|data:text\/html)/i.test(style)) {
                node.removeAttribute('style');
            }
            if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
                node.setAttribute('rel', 'noopener noreferrer');
            }
        });
    }
    // Diagram sources around the sanitiser (see stashDiagrams), then back on their blocks.
    const nonce = diagramNonce();
    const { html: stashed, sources } = stashDiagrams(html, nonce);
    const clean = String(DP.sanitize(stashed, {
        ALLOWED_TAGS: ALLOW_TAGS,
        ALLOWED_ATTR: ALLOW_ATTR,
        ALLOW_DATA_ATTR: true,
        FORBID_TAGS: ['script', 'style', 'form', 'input', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
        FORBID_ATTR: ['srcset', 'formaction', 'ping'],
    }));
    return restoreDiagrams(clean, sources, nonce);
}

/**
 * Is this a URL a documentation page may point at?
 *
 * Exported because md-lite's own link rules need the same answer, and two answers to "may a
 * document link here" is one too many.
 *
 * Control characters go first: a browser strips them before reading the scheme, which is what
 * makes `java\tscript:alert(1)` a working URL and invisible to a check on the raw string.
 */
export function safeDocUrl(raw: string): boolean {
    const url = String(raw ?? '').replace(/[\s\u0000-\u001f\u007f]/g, '');
    if (!url) return false;
    if (url.startsWith('#') || url.startsWith('?')) return true;
    // Protocol-relative. In this app there is no origin to be relative TO, so it is either a
    // mistake or a trick.
    if (url.startsWith('//')) return false;
    if (url.startsWith('/')) return true;
    const colon = url.indexOf(':');
    const slash = url.search(/[/?#]/);
    // No scheme: an ordinary relative path.
    if (colon < 0 || (slash > -1 && slash < colon)) return true;
    return /^(https?|mailto|tel|bmm|asset|https?\+tauri):/i.test(url);
}
