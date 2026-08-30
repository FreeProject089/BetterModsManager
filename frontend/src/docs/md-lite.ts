// md-lite — a small Markdown renderer that speaks the SAME GitBook-style directive syntax as
// BCWEB's md.jsx, without pulling the whole React + remark/unified stack into the Tauri frontend.
//
// Supported (a practical subset of the BCWEB set):
//   # / ## / ### / ####            headings
//   **bold**  *italic*  `code`      inline
//   [text](url)                     links (external → new tab)
//   - / *  and  1.                  unordered / ordered lists
//   > quote                         blockquote
//   ```lang … ```                   fenced code
//   :::note|tip|warning|danger|info|success[Title] … :::   callouts (GitBook-style)
//   :::steps  +  :::step[Title] … :::                      numbered steps
//   :::columns  +  :::column … :::                         responsive columns
//   :::details[Summary] … :::                              collapsible
//   | a | b |  +  |---|---|         GFM tables (scroll inside their own wrapper)
//   :::replay{src="…" title="…"} … :::                     inline .bmmreplay player (rrweb)
//   :::tabs  +  :::tab{title="…"} … :::                    one panel at a time
//   :::schedule[Title]{tz=Europe/Paris} … :::              a repeating schedule, in ONE zone
//   :time[2026-09-01T20:00]{tz=…}                          one instant, in the reader's zone
//
// Output classes match BCWEB's (`doc-callout`, `doc-steps`, …) so the two stay visually kin.
// Authoring docs in this format is optional — an article body that already starts with '<' is
// treated as raw HTML and passed through untouched (backward compatible).

// One import in a file that had none: the zone arithmetic, shared with rich-markdown.ts
// rather than copied. Daylight saving is written wrong in three obvious ways, and a second
// copy is a second one to get wrong.
//
// No dictionary, deliberately — this file still cannot speak the reader's language, and the
// schedule's one sentence is filled in by hydrateDocPage, exactly like the recording cards.
import { readInstant } from '../core/tz.js';
// Marked before anything else reads the text: a formula containing a colon would otherwise be
// read as a directive and typeset as nothing. See md-math.ts.
import { markMath } from '../ui/md-math.js';
import { replaceEmoji } from '../core/emoji.js';
// Rendering is untrusted by default — see md-safe.ts for what that costs and why.
import { sanitizeDocHtml, safeDocUrl } from './md-safe.js';

const CALLOUT_KIND: Record<string, string> = {
  note: 'info', info: 'info', hint: 'tip', tip: 'tip', success: 'success', check: 'success',
  warning: 'warning', caution: 'warning', danger: 'danger', error: 'danger',
};
// Inline SVG, not emoji. The glyphs (ℹ 💡 ✓ ⚠ ⛔) rendered in whatever emoji font the OS
// happened to supply: 💡 and ⛔ came out full-colour and off-palette, at a size that ignored
// the 19px badge, while ℹ and ⚠ stayed monochrome — so five callouts drawn the same way did
// not look like one family. These use currentColor, so they take the severity colour the
// title already carries and follow a theme change for free.
//
// 16-wide viewBox on a 19px badge, stroke-based to match the app's icon language.
const ico = (d: string): string =>
  `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor"`
  + ` stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CALLOUT_ICON: Record<string, string> = {
  info:    ico('<circle cx="8" cy="8" r="6.6"/><path d="M8 7.4v3.6"/><path d="M8 5.1h.01"/>'),
  tip:     ico('<path d="M6.1 11.2a4.2 4.2 0 1 1 3.8 0"/><path d="M6.3 12.6h3.4"/><path d="M6.7 14.2h2.6"/>'),
  success: ico('<circle cx="8" cy="8" r="6.6"/><path d="M5.2 8.2l2 2 3.6-4"/>'),
  warning: ico('<path d="M7.1 2.6 1.6 12a1 1 0 0 0 .9 1.5h11a1 1 0 0 0 .9-1.5L8.9 2.6a1 1 0 0 0-1.8 0Z"/><path d="M8 6.4v2.9"/><path d="M8 11.6h.01"/>'),
  danger:  ico('<circle cx="8" cy="8" r="6.6"/><path d="M4.6 4.6l6.8 6.8"/>'),
};
const CALLOUT_TITLE: Record<string, string> = {
  info: 'Note', tip: 'Tip', success: 'Success', warning: 'Warning', danger: 'Careful',
};

// Two escapes, because they answer different questions. Both escape the quote — leaving `"` alone
// let the first quote in a diagram source close its attribute early, and since mermaid labels are
// written A["Label"], 54 of the 56 bundled diagrams reached mermaid truncated to a few characters
// and silently fell back to the placeholder.
//
// escRaw is for a VERBATIM payload — a diagram source, a URL — stashed in an attribute and read
// back with getAttribute(). It must decode to exactly what went in, so every & is escaped.
function escRaw(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// esc is for PROSE, where an entity the author typed is markup they meant. The site's markdown
// uses &nbsp; and &amp; deliberately (mkdocs renders them); escaping the & again shipped a
// literal "4&nbsp;Mo" onto the page.
function esc(s: string): string {
  return s.replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,9};|#\d{1,6};|#x[0-9a-fA-F]{1,5};)/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// One sheet of paper with a folded corner. Used by the `:::file` card and by the inline
// `:file[…]` chip — written once, because two copies of an icon drift into two icons.
const FILE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

/** `{href=… size=sm outline}` on an INLINE leaf. The block form has its own parser. */
function leafAttrs(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  const re = /([\w-]+)(?:=("[^"]*"|'[^']*'|[^\s}]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out[m[1]] = (m[2] || '').replace(/^["']|["']$/g, '');
  return out;
}

/**
 * The one link rule this file follows, applied to every inline leaf that can carry an href.
 *
 * Nothing here produces an `<a href>`, deliberately, and for the same reason the `[text](url)`
 * rule above does not: this markup renders INSIDE the app. A real href makes the webview try
 * to navigate — blocked by the CSP, and it would replace the app if it were not. So an outward
 * link is a button the docs-hub click handler already knows how to open, and a directive with
 * no destination is a plain span rather than something that looks pressable and is not.
 */
function docLinkish(a: Record<string, string>, inner: string, cls: string, style: string): string {
  const raw = a.href || a.url || a.link || '';
  // A refused URL is dropped rather than shown: the tail of this function put it in a
  // `title`, so `javascript:alert(1)` was still on the page as a tooltip — harmless to a
  // browser and exactly the kind of thing a reader should never be handed.
  const href = safeDocUrl(raw) ? raw : '';
  if (!href) return `<span class="${cls}"${style}>${inner}</span>`;
  if (/^doc-page:/i.test(href)) return `<button type="button" class="${cls} dh-xref"${style} data-docpage="${escRaw(href.slice(9))}">${inner}</button>`;
  if (/^doc:/i.test(href)) return `<button type="button" class="${cls} dh-xref"${style} data-art="${escRaw(href.slice(4))}">${inner}</button>`;
  if (/^bmm:\/\//i.test(href)) return `<button type="button" class="${cls}"${style} data-deeplink="${escRaw(href)}">${inner}</button>`;
  if (/^#/.test(href)) return `<button type="button" class="${cls}"${style} data-anchor="${escRaw(href.slice(1))}">${inner}</button>`;
  if (/^(https?:|mailto:)/i.test(href)) return `<button type="button" class="${cls}"${style} data-ext="${escRaw(href)}">${inner}</button>`;
  return `<span class="${cls}"${style} title="${escRaw(href)}">${inner}</span>`;
}

// ── inline ───────────────────────────────────────────────────────────────────────
function inline(s: string): string {
  // A comment that sits at the END of a line rather than on its own — the block rule only catches
  // the ones that start a line. Dropped first, so it cannot swallow a backtick span.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Protect inline code first, then escape, then apply the rest.
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return ` ${codes.length - 1} `; });
  // The maths placeholders `markMath` already inserted are HTML, and the next line escapes
  // everything — so a formula reached the reader as `&lt;span class="doc-math"…`. Protected
  // the same way inline code is, and restored at the end.
  const maths: string[] = [];
  s = s.replace(/<span class="doc-math[^>]*>[\s\S]*?<\/span>/g, (m) => { maths.push(m); return `${maths.length - 1}`; });
  // Every leaf below is rendered from the SOURCE — before esc() runs — because an attribute
  // is full of characters esc() rewrites: `href="…"` would arrive as `href=&quot;…&quot;` and
  // parse as nothing, and an `&` in a URL would become `&amp;`. So each one is stashed the way
  // the maths spans are, and restored at the end.
  const keep = (h: string): string => { maths.push(h); return `${maths.length - 1}`; };
  // `:icon[rocket]` / `:icon[simple:discord]` — the website's inline icons.
  //
  // A lucide name becomes an empty span carrying the NAME; hydrateMdLite turns it into a CSS
  // mask, so the glyph takes the colour of the sentence around it. A flat <img> would be black
  // on a dark page. Brand marks come pre-coloured, so they stay images.
  s = s.replace(/:icon\[([^\]]+)\](?:\{[^}]*\})?/g, (_m, raw) => {
    const n = String(raw).trim().toLowerCase().replace(/[^a-z0-9:-]/g, '');
    const brand = n.match(/^(?:simple|si):(.+)$/);
    if (brand) return keep(`<img class="doc-icon" src="https://cdn.simpleicons.org/${brand[1]}" alt="" loading="lazy">`);
    return keep(`<span class="doc-icon doc-icon-mask" data-lucide="${n}"></span>`);
  });
  // `:button[Label]{href=… size=sm outline}` / `:btn[…]`. A button with nowhere to go renders
  // as a span rather than a dead link — the same rule the website applies, and the reason a
  // shape that looks pressable is never a lie here.
  s = s.replace(/:(?:button|btn)\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, txt, rawAttrs) => {
    const a = leafAttrs(rawAttrs);
    const size = a.size === 'sm' || a.size === 'lg' ? a.size : 'md';
    const cls = `doc-btn doc-btn-${size}${a.outline != null ? ' doc-btn-outline' : ''}`;
    const style = a.color ? ` style="--btn:${escRaw(a.color)}"` : '';
    return keep(docLinkish(a, esc(txt), cls, style));
  });
  // `:link[read this]{color=#0a7 href=…}` — a link that is a colour rather than THE link colour.
  s = s.replace(/:link\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, txt, rawAttrs) => {
    const a = leafAttrs(rawAttrs);
    return keep(docLinkish(a, esc(txt), 'doc-link-c', a.color ? ` style="--lnk:${escRaw(a.color)}"` : ''));
  });
  // `:badge[New]{color=#0a7}` / `:tag[…]` — a coloured chip.
  s = s.replace(/:(?:badge|tag)\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, txt, rawAttrs) => {
    const a = leafAttrs(rawAttrs);
    return keep(`<span class="doc-badge"${a.color ? ` style="--bc:${escRaw(a.color)}"` : ''}>${esc(txt)}</span>`);
  });
  // `:ref[…]` / `:card[…]` / `:file[…]` written INSIDE a sentence. Alone on its line the same
  // directive becomes a full card — see promoteLeaves. Mid-paragraph it becomes a chip, because
  // a card with a cover image in the middle of a sentence is not a card.
  s = s.replace(/(^|[^:]):(file|ref|card)\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, before, kind, txt, rawAttrs) => {
    const a = leafAttrs(rawAttrs);
    const ico = kind === 'file' ? FILE_SVG : '';
    return before + keep(docLinkish(a, ico + esc(txt), 'doc-btn doc-btn-sm doc-btn-outline', ''));
  });
  s = esc(s);
  // The mkdocs spelling of the same thing: `++ctrl+k++`, from pymdownx.keys.
  //
  // BMM Docs is published twice — as a website by mkdocs, and bundled into this app — and the
  // two did not answer to the same vocabulary. Ten `++esc++` in the pages drew keycaps on the
  // site and printed as `++esc++` here, in the very files that ALSO use `:kbd[…]`.
  //
  // Before the `:kbd` rule, because both produce the same markup and this one has the simpler
  // shape. Escaped text cannot reach it: `+` is not touched by esc().
  s = s.replace(/\+\+([a-z0-9][a-z0-9+.-]*)\+\+/gi, (_m, keys) => {
    const parts = String(keys).split('+').filter(Boolean);
    if (!parts.length) return _m;
    // Capitalised the way a keycap is read, and the way pymdownx.keys prints it on the
    // website: `Ctrl`, `Esc`, `Shift` — but `F5`, `F10` and a single letter stay upper.
    // `ctrl` is written lowercase in a source file and nobody has a key with that on it.
    const cap = (k: string) => (k.length === 1 || /^f\d+$/i.test(k)
      ? k.toUpperCase()
      : k[0].toUpperCase() + k.slice(1).toLowerCase());
    return `<span class="dh-kbd">${parts.map((k) => `<kbd>${esc(cap(k))}</kbd>`).join('+')}</span>`;
  });
  // Keyboard keys — `:kbd[Ctrl+K]` → styled <kbd> per key (BCWEB-style).
  s = s.replace(/:kbd\[([^\]]+)\]/g, (_m, keys) => {
    const parts = String(keys).split(/\s*\+\s*|\s+/).filter(Boolean);
    return `<span class="dh-kbd">${parts.map((k) => `<kbd>${k}</kbd>`).join('+')}</span>`;
  });
  // One instant — `:time[2026-09-01T20:00]{tz=Europe/Paris}` — read in the reader's own zone.
  // Attributes survive esc(): it escapes & < > " ', and a zone name has none of them.
  s = s.replace(/:(?:time|at)\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, raw, rawAttrs) => {
    const tz = (String(rawAttrs || '').match(/(?:tz|timezone)=([^\s}]+)/) || [])[1] || '';
    const r = readInstant(String(raw).trim(), tz);
    // What the author typed, never "Invalid Date".
    if (!r.ok) return `<span class="doc-time">${esc(String(raw))}</span>`;
    return `<time class="doc-time" datetime="${escRaw(r.iso)}" title="${escRaw(tz ? `${raw} ${tz}` : String(raw))}">`
      + `${esc(r.shown)}<span class="doc-time-zone">${esc(r.here)}</span></time>`;
  });
  // ***both*** before **bold**, or the bold rule eats the first two stars and leaves a stray one.
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<i>$2</i>');
  // Images first, or the link rule below turns "![alt](src)" into "!" plus a link.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, src) =>
    `<img class="dh-md-img" src="${escRaw(src)}" alt="${esc(alt)}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) => {
    // `[label](doc:article-id)` → an in-app cross-link that opens another docs article.
    if (/^doc:/i.test(url)) return `<button type="button" class="dh-xref" data-art="${escRaw(url.slice(4))}">${txt}</button>`;
    // `doc-page:features/themes` — a link between BUNDLED doc pages, rewritten by sync-docs
    // from the site's own relative .md links so they resolve in-app instead of 404ing.
    if (/^doc-page:/i.test(url)) return `<button type="button" class="dh-xref" data-docpage="${escRaw(url.slice(9))}">${txt}</button>`;
    // Nothing below produces a navigable href, deliberately. This markup renders INSIDE the app:
    // an <a href> to the web makes the webview try to navigate (blocked by the CSP, and it would
    // replace the app if it were not), and a relative href points at a route that does not exist.
    // Every outward link is therefore a button the app handles — see docs-hub's click handler.
    if (/^https?:\/\//i.test(url)) return `<button type="button" class="dh-link dh-link-ext" data-ext="${escRaw(url)}">${txt}</button>`;
    if (/^bmm:\/\//i.test(url)) return `<button type="button" class="dh-link" data-deeplink="${escRaw(url)}">${txt}</button>`;
    if (/^#/.test(url)) return `<button type="button" class="dh-link" data-anchor="${escRaw(url.slice(1))}">${txt}</button>`;
    if (/^mailto:/i.test(url)) return `<button type="button" class="dh-link dh-link-ext" data-ext="${escRaw(url)}">${txt}</button>`;
    // A relative path that is not a doc route (a site asset that was not bundled), or a URL
    // the policy refuses: show the text, drop the dead link rather than shipping something
    // that navigates the app into nothing — or somewhere it should not go.
    return `<span class="dh-link-dead" title="${escRaw(safeDocUrl(url) ? url : '')}">${txt}</span>`;
  });
  s = s.replace(/ (\d+) /g, (_m, i) => `<code>${esc(codes[+i])}</code>`);
  // Back to markup, after everything that escapes has run.
  s = s.replace(/(\d+)/g, (_m, i) => maths[+i]);
  return s;
}

// Parse a directive opener line: `:::name[Label]{a="b" c}` → {name, label, attrs} or null.
function parseDirective(line: string): { name: string; label: string; attrs: Record<string, string> } | null {
  const m = /^:::+\s*([a-z][\w-]*)\s*(\[[^\]]*\])?\s*(\{[^}]*\})?\s*$/i.exec(line.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  const label = m[2] ? m[2].slice(1, -1) : '';
  const attrs: Record<string, string> = {};
  if (m[3]) {
    const body = m[3].slice(1, -1);
    const re = /([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = re.exec(body))) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
  }
  return { name, label, attrs };
}
const isFence = (line: string) => /^:::+\s*$/.test(line.trim());

let tabSeq = 0;

/** Take the 4-space-indented block that follows an mkdocs admonition or tab marker, dedented.
 *  Blank lines belong to the block; the first non-blank line at column 0 ends it. */
function takeIndented(lines: string[], start: number): { lines: string[]; next: number } {
  const body: string[] = [];
  let i = start;
  while (i < lines.length && !lines[i].trim()) i++;          // skip the blank after the marker
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) { body.push(''); continue; }
    if (!/^(\s{4}|\t)/.test(l)) break;
    body.push(l.replace(/^(\s{4}|\t)/, ''));
  }
  while (body.length && !body[body.length - 1].trim()) body.pop();
  return { lines: body, next: i };
}

// ── block renderer ─────────────────────────────────────────────────────────────
function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  const flushPara: string[] = [];
  const flushP = () => { if (flushPara.length) { out.push(`<p>${inline(flushPara.join(' '))}</p>`); flushPara.length = 0; } };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    // fenced code
    if (/^```/.test(t)) {
      flushP();
      const lang = t.replace(/^```/, '').trim();
      const buf: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++;
      if (lang.toLowerCase() === 'mermaid') {
        // Handed to the app, which renders it with the mermaid already vendored for the
        // interactive diagrams. The source is kept in the element so a failed render can fall
        // back to showing it rather than an empty box.
        out.push(`<div class="dh-mermaid" data-mermaid="${escRaw(buf.join('\n'))}"><div class="dh-mermaid-ph">◇ diagram</div></div>`);
        continue;
      }
      // `language-x` on the <code> is what Prism looks for; data-lang stays because the CSS
      // badge reads it. An unknown language is harmless — Prism leaves it as plain text.
      const cls = lang ? ` class="language-${escRaw(lang.toLowerCase())}"` : '';
      out.push(`<pre class="dh-code"${lang ? ` data-lang="${escRaw(lang)}"` : ''}><code${cls}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // mkdocs admonition:  !!! warning "Title"  + a 4-space indented body.
    // The site's pages are full of these, and they carry the warnings that matter most, so
    // dropping them to plain paragraphs would quietly flatten the emphasis.
    // The title accepts BACKSLASH-ESCAPED quotes, as mkdocs does. `[^"]*` stopped at the first
    // inner quote, so a title like "\"Conflict rules\" = the order" matched nothing and the
    // whole admonition rendered as literal `!!! note ...` text. Measured across the bundled
    // docs: 1 of 166 admonitions — small, but it was the loudest kind of broken.
    const adm = /^(!!!|\?\?\?\+?)\s+([a-z-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*$/i.exec(t);
    if (adm) {
      flushP();
      i++;
      const body = takeIndented(lines, i);
      i = body.next;
      const kind = CALLOUT_KIND[adm[2].toLowerCase()] || 'info';
      // Un-escape what the regex allowed through: \" becomes ", \\ becomes \.
      const title = adm[3] !== undefined ? adm[3].replace(/\\(.)/g, '$1') : (CALLOUT_TITLE[kind] || '');
      const collapsible = adm[1].startsWith('???');
      const inner = renderBlocks(body.lines);
      out.push(collapsible
        ? `<details class="doc-details"${adm[1] === '???+' ? ' open' : ''}><summary>${esc(title)}</summary><div class="doc-details-body">${inner}</div></details>`
        : `<div class="doc-callout doc-callout-${kind}"><div class="doc-callout-title"><span class="doc-callout-ico">${CALLOUT_ICON[kind] || CALLOUT_ICON.info}</span>${esc(title)}</div><div class="doc-callout-body">${inner}</div></div>`);
      continue;
    }

    // mkdocs content tabs:  === "Label"  + indented body, repeated.
    if (/^===\s+"/.test(t)) {
      flushP();
      const tabs: { label: string; html: string }[] = [];
      while (i < lines.length) {
        const m = /^===\s+"([^"]*)"\s*$/.exec(lines[i].trim());
        if (!m) break;
        i++;
        const body = takeIndented(lines, i);
        i = body.next;
        tabs.push({ label: m[1], html: renderBlocks(body.lines) });
      }
      const id = 'tb' + (++tabSeq);
      out.push(
        `<div class="dh-tabs" data-tabs>` +
        `<div class="dh-tabs-bar" role="tablist">${tabs.map((tb, n) => `<button type="button" class="dh-tab${n === 0 ? ' on' : ''}" data-tab="${id}-${n}" role="tab">${esc(tb.label)}</button>`).join('')}</div>` +
        tabs.map((tb, n) => `<div class="dh-tabpane${n === 0 ? ' on' : ''}" data-pane="${id}-${n}" role="tabpanel">${tb.html}</div>`).join('') +
        `</div>`);
      continue;
    }

    // container directive
    const dir = parseDirective(line);
    if (dir && !isFence(line)) {
      flushP();
      // collect until the matching closing fence (nesting-aware)
      const buf: string[] = []; let depth = 1; i++;
      while (i < lines.length) {
        const l = lines[i];
        if (parseDirective(l) && !isFence(l)) depth++;
        else if (isFence(l)) { depth--; if (depth === 0) { i++; break; } }
        buf.push(l); i++;
      }
      out.push(renderDirective(dir, buf));
      continue;
    }

    // ::toc — built in renderDocMarkdown, where the whole document is in view. An empty one
    // (a page with no headings) leaves nothing behind rather than an empty titled box.
    if (/^::toc(\[[^\]]*\])?$/.test(t)) { flushP(); if (pendingToc) out.push(pendingToc); i++; continue; }

    // heading
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) { flushP(); out.push(`<h${h[1].length === 1 ? 3 : h[1].length + 1}>${inline(h[2])}</h${h[1].length === 1 ? 3 : h[1].length + 1}>`); i++; continue; }

    // blockquote
    if (/^>\s?/.test(t)) {
      flushP(); const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // tables (GFM) — a header row followed by a |---|:--:|---:| separator. Needed because the
    // reference articles (actions, API/deeplinks) are long lookup tables: prose can't carry them.
    if (t.includes('|') && i + 1 < lines.length
        && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(lines[i + 1].trim())) {
      flushP();
      const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(t);
      const align = cells(lines[i + 1]).map((s) => (/^:-+:$/.test(s) ? ' style="text-align:center"' : /-+:$/.test(s) ? ' style="text-align:right"' : ''));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(cells(lines[i])); i++; }
      const th = head.map((c, n) => `<th${align[n] || ''}>${inline(c)}</th>`).join('');
      const tb = rows.map((r) => `<tr>${head.map((_h, n) => `<td${align[n] || ''}>${inline(r[n] ?? '')}</td>`).join('')}</tr>`).join('');
      // The wrapper is what scrolls — a wide table must never widen the article itself.
      out.push(`<div class="dh-table-wrap"><table class="dh-table"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
      continue;
    }

    // An HTML comment. The site's markdown carries author notes in these ("TODO(content): this
    // screen needs a capture before it can be documented honestly"), and every other markdown
    // renderer drops them — mkdocs does. md-lite escaped the `<`, so the notes were printed into
    // the page as body text.
    if (/^<!--/.test(t)) {
      flushP();
      while (i < lines.length && !lines[i].includes('-->')) i++;
      i++;                                     // and the line that closes it
      continue;
    }

    // A bare anchor on its own line, which sync-docs writes for a heading that pins an explicit
    // id (`## Conflicts {#conflicts}`). The app derives ids by slugifying the heading TEXT, so
    // without this the site's own #conflicts links would land nowhere.
    const anchorOnly = /^<a id="([\w-]+)"><\/a>$/.exec(t);
    if (anchorOnly) { flushP(); out.push(`<a id="${anchorOnly[1]}" class="dh-anchor"></a>`); i++; continue; }

    // The site's recording embed: `<div class="bmm-replay" data-src=… data-title=…></div>`,
    // possibly spread over several lines. It is raw HTML in the markdown, so without this rule
    // the reader saw the tag printed as text. sync-docs has already rewritten it: data-src is
    // present only when the file was really bundled, and data-page says where it lives on the
    // site so the app can offer that instead of a player with nothing to play.
    if (/^<div\s+class="bmm-replay"/.test(t)) {
      flushP();
      const buf: string[] = [];
      while (i < lines.length) { buf.push(lines[i]); if (lines[i].includes('</div>')) { i++; break; } i++; }
      const block = buf.join(' ');
      const at = (n: string) => (new RegExp(`data-${n}="([^"]*)"`).exec(block) || [, ''])[1]!;
      const src = at('src');                      // the bundled copy, when there is one
      const remote = at('remote');                // the same asset on the website
      const kind = /\.(mp4|webm)$/i.test(src || remote) ? 'video' : 'replay';
      const title = at('title') || (kind === 'video' ? 'Clip' : 'Session replay');
      // Always a play button. Whether the bytes are on disk or come off the website is the
      // app's problem, not something the reader should have to see in the affordance.
      out.push(`<button type="button" class="dh-clip" data-kind="${kind}"`
        + ` data-clip="${escRaw(src)}" data-clip-remote="${escRaw(remote)}"`
        + ` data-clip-page="${escRaw(at('page'))}">`
        + `<span class="dh-clip-play" aria-hidden="true">▶</span>`
        + `<span class="dh-clip-txt"><span class="dh-clip-title">${esc(title)}</span>`
        + `<span class="dh-clip-sub" data-clip-sub></span></span></button>`);
      continue;
    }

    // thematic break — the site uses --- to separate sections; without this it printed as text.
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(t)) { flushP(); out.push('<hr class="dh-hr">'); i++; continue; }

    // lists
    if (/^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) {
      flushP();
      const ordered = /^\d+\.\s+/.test(t);
      const isItem = (l: string) => /^[-*]\s+/.test(l.trim()) || /^\d+\.\s+/.test(l.trim());
      const raw: string[] = [];
      while (i < lines.length && isItem(lines[i])) {
        raw.push(lines[i].trim().replace(/^([-*]|\d+\.)\s+/, ''));
        i++;
        // A wrapped item continues on the following lines until a blank line, a new item, or
        // any other block starts. Without this, the rest of a long bullet fell out of the list
        // and became a paragraph of its own — which is what broke the bullets on screen.
        while (i < lines.length) {
          const c = lines[i];
          if (!c.trim() || isItem(c)) break;
          if (/^(#{1,6}\s|>|```|!!!|\?\?\?|===\s|:::|\||(\*{3,}|-{3,}|_{3,})$)/.test(c.trim())) break;
          raw[raw.length - 1] += ' ' + c.trim();
          i++;
        }
      }
      const items = raw.map((x) => inline(x));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${x}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    // blank → paragraph break
    if (!t) { flushP(); i++; continue; }

    flushPara.push(t); i++;
  }
  flushP();
  return out.join('');
}

function renderDirective(dir: { name: string; label: string; attrs: Record<string, string> }, body: string[]): string {
  const { name, label, attrs } = dir;
  const inner = () => renderBlocks(body);

  if (CALLOUT_KIND[name]) {
    const kind = CALLOUT_KIND[name];
    const title = label || CALLOUT_TITLE[kind] || '';
    return `<div class="doc-callout doc-callout-${kind}"><div class="doc-callout-title"><span class="doc-callout-ico">${CALLOUT_ICON[kind] || 'ℹ'}</span>${esc(title)}</div><div class="doc-callout-body">${inner()}</div></div>`;
  }
  // ── Roadmap / progress tracker ──────────────────────────────────────────────
  //
  // BCWEB renders `:::roadmap` with `:::stage` children as a tracker. BMM knew neither name,
  // and an unknown directive falls through to "render the body plainly" — so a roadmap posted
  // on the site arrived in the app as a loose pile of bullet points with the stage labels
  // dissolved into it. Same document, two applications, two different meanings.
  //
  // Static only: no `src=` fetch. The remote form is for a page that can poll; a bundled doc
  // is read offline, and a tracker that silently shows nothing offline is worse than one that
  // shows what the document itself says.
  if (name === 'roadmap' || name === 'progress') {
    const title = label || attrs.title || '';
    // `inner()` has already turned each :::stage into a .doc-stage block.
    return `<div class="doc-roadmap">${title ? `<div class="doc-roadmap-title">${esc(title)}</div>` : ''}${inner()}</div>`;
  }
  if (name === 'stage' || name === 'phase') {
    // done · doing/active/wip · planned — anything else is planned, because a state we do not
    // recognise must not read as finished.
    const raw = String(attrs.state || attrs.status || '').toLowerCase();
    const state = raw === 'done' || raw === 'shipped' || raw === 'complete' ? 'done'
      : (raw === 'doing' || raw === 'active' || raw === 'wip' || raw === 'progress') ? 'doing' : 'planned';
    const pct = state === 'done' ? 100 : Math.max(0, Math.min(100, parseInt(attrs.percent || '', 10) || 0));
    const word = state === 'done' ? '✓' : state === 'doing' ? '◐' : '○';
    return `<div class="doc-stage doc-stage-${state}">`
      + `<div class="doc-stage-head"><span class="doc-stage-dot">${word}</span>`
      + `<span class="doc-stage-label">${esc(label || attrs.title || '')}</span>`
      + (pct ? `<span class="doc-stage-pct">${pct}%</span>` : '')
      + `</div>`
      + (pct ? `<div class="doc-stage-bar"><i style="width:${pct}%"></i></div>` : '')
      + `<div class="doc-stage-body">${inner()}</div></div>`;
  }
  if (name === 'steps') {
    // children are :::step blocks — renderBlocks already turned each into a .doc-step div
    return `<div class="doc-steps">${inner()}</div>`;
  }
  if (name === 'step') {
    return `<div class="doc-step"><div class="doc-step-title">${esc(label)}</div><div class="doc-step-body">${inner()}</div></div>`;
  }
  // ── Tabs ────────────────────────────────────────────────────────────────────
  //
  // What a documentation page needs most and could not say: "pick the one that is yours".
  // Without it, a page with a Windows, a macOS and a Linux path prints all three and asks the
  // reader to find theirs — which is the same reason the website grew this block first.
  //
  // The titles are read back OFF the rendered panels rather than declared again in the bar. A
  // label written twice is a label that drifts from the content it names.
  if (name === 'tabs') {
    const titles: string[] = [];
    const body = inner().replace(/<div class="doc-tab" data-title="([^"]*)">/g, (_m, title) => {
      const i = titles.length;
      titles.push(title);
      return `<div class="doc-tab${i === 0 ? ' is-on' : ''}" data-title="${title}" role="tabpanel">`;
    });
    // `:::tabs` around ordinary content: render the content. An empty strip above it would be
    // worse than no strip.
    if (!titles.length) return body;
    // Titles come back already escaped — they were read out of an attribute written above.
    // Escaping them again would put `&amp;` in front of the reader.
    const bar = titles.map((title, i) => `<button type="button" role="tab" class="doc-tabs-btn${i === 0 ? ' is-on' : ''}"`
      + ` data-tab="${i}" aria-selected="${i === 0 ? 'true' : 'false'}">${title || String(i + 1)}</button>`).join('');
    return `<div class="doc-tabs"><div class="doc-tabs-bar" role="tablist">${bar}</div>${body}</div>`;
  }
  if (name === 'tab') {
    return `<div class="doc-tab" data-title="${escRaw(label || attrs.title || attrs.name || '')}">${inner()}</div>`;
  }
  // ── A repeating schedule, in ONE zone ───────────────────────────────────────
  //
  // The rows are NOT converted, and that is the answer rather than a missing feature.
  // "Monday 09:00 Europe/Paris" is 09:00 in Paris every week of the year; what moves across a
  // daylight-saving boundary is how far that is from the reader. A converted row would be
  // right today and wrong in March with nothing on the page admitting it — so the zone is
  // named on the card, and the difference is computed for RIGHT NOW and says so.
  if (name === 'schedule' || name === 'hours') {
    const tz = String(attrs.tz || attrs.timezone || '').trim();
    const title = label || attrs.title || '';
    // The title and the note are left for hydrateDocPage: both are sentences in the reader's
    // language, and this file has no dictionary. An empty note element with the zone on it is
    // enough for it to work from — and if hydration never runs, an empty <p> is a blank line
    // rather than a wrong hour.
    return `<div class="doc-schedule"><div class="doc-schedule-head">`
      + `<span class="doc-schedule-title"${title ? '' : ' data-sched-title'}>${esc(title)}</span>`
      + (tz ? `<span class="doc-schedule-tz">${esc(tz)}</span>` : '')
      + `</div><div class="doc-schedule-body">${inner()}</div>`
      + (tz ? `<p class="doc-schedule-note" data-sched-note="${escRaw(tz)}"></p>` : '')
      + `</div>`;
  }
  // ── Cards, references and downloads ─────────────────────────────────────────
  //
  // All three fell through to "render the body plainly", which is the fallback for a directive
  // this file has never heard of. So a page of link cards arrived as a run-on paragraph and a
  // download block as its own filename — no frame, no button, and no error either.
  if (name === 'cards') return `<div class="doc-cards">${inner()}</div>`;
  if (name === 'card' || name === 'ref') {
    const title = label || attrs.title || '';
    const href = attrs.href || attrs.link || attrs.url || '';
    // A cover image, a video or a flat colour — whichever the author gave, at most one.
    const media = attrs.image
      ? `<div class="doc-card-media" style="background-image:url('${escRaw(attrs.image)}')"></div>`
      : attrs.video ? `<video class="doc-card-media" src="${escRaw(attrs.video)}" controls></video>`
      : attrs.color ? `<div class="doc-card-media" style="background:${escRaw(attrs.color)}"></div>` : '';
    const head = title
      ? docLinkish({ href }, esc(title), 'doc-card-title', '')
      : '';
    return `<div class="doc-card">${media}${head}<div class="doc-card-body">${inner()}</div></div>`;
  }
  if (name === 'file') {
    // A download row: `:::file[setup.exe]{href=… size="12 MB"}`. The button is the app's own
    // external-open handler, not an <a download> — the webview cannot save a file itself.
    const fname = label || attrs.name || attrs.title || 'file';
    const size = attrs.size || '';
    const href = attrs.href || attrs.url || attrs.link || '';
    // The word on the button is left empty for hydrateMdLite, exactly like the schedule card's
    // heading: this file has no dictionary, and an English "Open" on a French page is worse
    // than a button that fills itself in a moment later.
    const action = href ? docLinkish({ href }, '<span data-md-open></span>', 'doc-file-btn', '') : '';
    return `<div class="doc-file"><span class="doc-file-ico">${FILE_SVG}</span>`
      + `<span class="doc-file-info"><span class="doc-file-name">${esc(fname)}</span>`
      + (size ? `<span class="doc-file-size">${esc(size)}</span>` : '')
      + `</span>${action}</div>`;
  }
  // `:::center` / `:::left` / `:::right` — the alignment the website offers. Written as a class
  // rather than an inline style so a theme can override it; three classes, one per direction.
  if (name === 'center' || name === 'left' || name === 'right') {
    return `<div class="doc-align doc-align-${name}">${inner()}</div>`;
  }
  if (name === 'columns' || name === 'row') return `<div class="doc-columns">${inner()}</div>`;
  if (name === 'column' || name === 'col') return `<div class="doc-column">${inner()}</div>`;
  if (name === 'details' || name === 'collapse') {
    return `<details class="doc-details"><summary>${esc(label || 'Details')}</summary><div class="doc-details-body">${inner()}</div></details>`;
  }
  if (name === 'replay' || name === 'bmmreplay') {
    // The app opens this itself, so a refused URL must not reach the attribute the click
    // handler reads. A player is a thing that follows a link.
    const raw = attrs.src || '';
    const src = safeDocUrl(raw) ? raw : '';
    return `<figure class="dh-media"><button class="dh-replay" data-replay="${escRaw(src)}">▶ <span>${esc(label || attrs.title || 'Play recording')}</span></button></figure>`;
  }
  // unknown directive → render its body plainly so nothing is lost
  return inner();
}

/** Render markdown-with-directives to HTML. A body that already looks like HTML is passed
 *  through unchanged, so existing HTML article bodies keep working. */
/**
 * `:ref[Doc]{href=…}` alone on a line becomes `:::ref[Doc]{href=…}`.
 *
 * The website runs container, leaf and TEXT directives through ONE switch, so there the two
 * spellings are the same thing. Here they were two code paths and only one existed, so the
 * shorter spelling — the one people actually type — reached the reader as its own source.
 *
 * Only when it is the whole line. Inside a sentence `inline()` renders a chip instead, because
 * a card with a cover image mid-paragraph is not a card.
 */
function promoteLeaves(src: string): string {
  return src.replace(/^[ \t]*:(file|ref|card)\[([^\]]*)\](\{[^}]*\})?[ \t]*$/gm,
    (_m, name, label, at) => `:::${name}[${label}]${at || ''}\n:::`);
}

/**
 * `::toc` → "On this page", built from the headings that follow it.
 *
 * The links are `data-anchor` buttons, which docs-hub already resolves by slugifying heading
 * TEXT — the same path an in-page link from the site takes. Writing a second slug function
 * here would be a second one to keep in step with the first, and the anchor trap in this
 * codebase has always been exactly that: an id and a link to it computed in two places.
 */
function tableOfContents(src: string): string {
  if (!/^\s*::toc\b/m.test(src)) return src;
  const heads: { level: number; text: string }[] = [];
  for (const line of src.split('\n')) {
    const h = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (h) heads.push({ level: h[1].length, text: h[2].replace(/[*_`]/g, '').trim() });
  }
  // No headings: the directive disappears rather than leaving an empty box titled "On this page".
  const nav = heads.length
    ? `<nav class="doc-toc"><div class="doc-toc-title" data-md-toc-title></div>`
      + heads.map((h) => `<button type="button" class="doc-toc-item doc-toc-l${h.level}" data-anchor="${escRaw(slugForAnchor(h.text))}">${esc(h.text)}</button>`).join('')
      + `</nav>`
    : '';
  // Kept in a module variable rather than substituted into the markdown: the source is about
  // to be split into lines and every paragraph is escaped, so a <nav> spliced in here reaches
  // the reader as its own tags. The block parser below emits it instead.
  pendingToc = nav;
  return src;
}

/** The rendered "On this page", waiting for the `::toc` line that asked for it. */
let pendingToc = '';

/** docs-hub's slug, which is mkdocs'. Kept identical so the button finds the heading. */
function slugForAnchor(s: string): string {
  return s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

export function renderDocMarkdown(src: string, opts: { trusted?: boolean } = {}): string {
  if (!src) return '';
  // UNTRUSTED unless a caller says otherwise, and the default is the safe one on purpose: a
  // new call site added next year is safe by construction rather than by somebody remembering.
  //
  // The raw-HTML passthrough below exists for the article bodies written in docs-hub.ts, which
  // are ours and are HTML. It was reached by ANY source starting with `<` — including a
  // plugin's README, whose output goes straight into innerHTML in a webview where
  // `withGlobalTauri` is on. That is the whole backend behind an `onerror`.
  const trusted = opts.trusted === true;
  if (trusted && /^\s*</.test(src)) return src;   // our own HTML article bodies
  // Emoji LAST, on the rendered output: a shortcode inside a directive's attributes is not a
  // shortcode, and by here every directive has been consumed.
  const prepared = tableOfContents(promoteLeaves(markMath(src.replace(/\r\n?/g, '\n'))));
  const html = replaceEmoji(renderBlocks(prepared.split('\n')));
  return trusted ? html : sanitizeDocHtml(html);
}
