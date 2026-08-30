// Shared "rich markdown" pre-processor. BMM renders markdown with `marked`, which
// doesn't understand the GitBook-style remark-directive blocks the BCWEB site uses
// (`:::note`, `::::cards`, `:badge[]`, `:icon[]`, `:kbd[]`, `::toc`…). This down-
// converts them to constructs `marked` (+ our post-processing) renders, so the SAME
// markdown displays the SAME way in the Community blog AND the Release/Update notes —
// cards, columns, collapsibles, coloured icons and the table of contents included.
import { escHtml, escAttr } from '../core/utils.js';
import { t } from '../core/i18n.js';
// Written once and imported twice: md-lite renders the same two blocks for the bundled
// documentation, and a second copy of daylight-saving arithmetic is a second copy to get
// wrong — in a way that shows up as an hour on a page nobody checks against a clock.
import { readInstant, zoneDelta } from '../core/tz.js';
// Maths is marked FIRST, before any directive rule runs: a formula containing a colon
// would otherwise be read as a directive and typeset as nothing.
import { markMath } from './md-math.js';
import { replaceEmoji } from '../core/emoji.js';
// One answer to "may a document link here", shared with the documentation renderer. Two
// answers to that question is one too many, and this file had none.
import { safeDocUrl } from '../docs/md-safe.js';
// The two icon CDNs, in one place with a switch — see core/icon-cdn.ts.
import { lucideIconUrl, brandIconUrl } from '../core/icon-cdn.js';

const CALLOUT_ALERT: Record<string, string> = {
  // `check` and `error` are the site's aliases for success and danger. They were absent
  // here, so a post using either rendered its body with no callout around it at all — not a
  // wrong colour, no box: the text simply lost its frame on the way into the app.
  note: 'NOTE', info: 'NOTE', tip: 'TIP', hint: 'TIP', success: 'TIP', check: 'TIP',
  warning: 'WARNING', caution: 'CAUTION', danger: 'CAUTION', error: 'CAUTION', important: 'IMPORTANT', callout: 'NOTE', custom: 'NOTE',
};

/**
 * Brand buttons. The same eight the site draws, and deliberately no more: Patreon and Steam
 * have no mark here either, and a coloured button with a hole where the logo goes is worse
 * than one that is only the colour.
 *
 * The logo is requested in white on a filled button and in the brand colour on an outline
 * one, because a brand-coloured logo on its own brand ground is invisible — which is what
 * asking the icon helper for it would have produced.
 */
const BUTTON_BRANDS: Record<string, { color: string; slug: string }> = {
  youtube: { color: '#ff0033', slug: 'youtube' },
  discord: { color: '#5865f2', slug: 'discord' },
  kofi: { color: '#ff5e5b', slug: 'kofi' },
  github: { color: '#24292f', slug: 'github' },
  twitch: { color: '#9146ff', slug: 'twitch' },
  x: { color: '#000000', slug: 'x' },
  reddit: { color: '#ff4500', slug: 'reddit' },
  telegram: { color: '#26a5e4', slug: 'telegram' },
};
const BUTTON_SIZES = new Set(['sm', 'md', 'lg']);
// One sheet of paper with a folded corner, used by the `:::file` card and by the inline
// `:file[…]` chip. Written once because two copies of an icon drift into two icons.
const FILE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

/**
 * How far the reader is from `tz`, RIGHT NOW.
 *
 * "Right now" is not hedging. The difference changes twice a year and this markdown is
 * rendered once, so a sentence that did not say when it was computed would quietly become
 * false on a Sunday in March.
 */
function zoneNote(tz: string): string {
  const { dir, here, span } = zoneDelta(tz);
  if (dir === 'none') return '';
  if (dir === 'same') return t('md.sched.same', { here, tz });
  return t(dir === 'ahead' ? 'md.sched.ahead' : 'md.sched.behind', { here, tz, span });
}

/**
 * One instant, in the reader's own zone.
 *
 * The date is what makes this exact: it settles which side of a daylight-saving change the
 * time falls on. That is precisely why a weekly `:::schedule` row is NOT converted.
 *
 * A value that cannot be parsed is shown as written rather than as "Invalid Date" — a reader
 * should see what the author typed, not the failure of a parser.
 */
function docTime(raw: string, a: Record<string, string>): string {
  if (!raw) return '';
  const tz = String(a.tz || a.timezone || '').trim();
  const r = readInstant(raw, tz);
  // Shown as written rather than as "Invalid Date" — a reader should see what the author
  // typed, not the failure of a parser.
  if (!r.ok) return `<span class="doc-time">${escHtml(raw)}</span>`;
  return `<time class="doc-time" datetime="${escAttr(r.iso)}"`
    + ` title="${escAttr(tz ? `${raw} ${tz}` : raw)}">${escHtml(r.shown)}`
    + `<span class="doc-time-zone">${escHtml(r.here)}</span></time>`;
}

// Step markers. The same four alphabets md.jsx uses on the website, so the same source
// numbers identically in both — a procedure that reads "1. 2. 3." in the blog and
// "A. B. C." in the app would be two documents, not one.
//
// Past the end of an alphabet it falls back to the number rather than wrapping to A
// again, which would silently repeat a marker.
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
export function stepMarker(kind: string, n: number): string {
  if (kind === 'a' || kind === 'alpha') return n <= 26 ? String.fromCharCode(64 + n) : String(n);
  if (kind === 'i' || kind === 'roman') return ROMAN[n - 1] || String(n);
  if (kind === 'dot' || kind === 'none' || kind === 'bullet') return '•';
  return String(n);
}

function parseDirAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  const re = /([\w-]+)=("[^"]*"|'[^']*'|[^\s}]+)/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  return out;
}

// Heading → anchor slug, kept in sync with the id injection in update-notes.ts so the
// generated ::toc links actually jump.
export function headingSlug(s: string): string {
  return String(s).toLowerCase().trim().replace(/[^\wà-ÿ\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'section';
}

// Render a snippet of (already directive-expanded) markdown to HTML using the global
// `marked`, so card / column / collapsible bodies show real formatting instead of raw
// text. Falls back to an escaped string if marked isn't loaded yet.
function mdInline(s: string): string {
  const m = (globalThis as any).marked;
  try { return (m && typeof m.parse === 'function') ? m.parse(s) : escHtml(s); }
  catch { return escHtml(s); }
}

// Inline icon like the site: lucide names render as a CSS-mask over the lucide-static
// CDN svg so they INHERIT the surrounding text colour (an <img> would be flat black);
// `simple:brand` uses the Simple Icons CDN (already brand-coloured). Both are https,
// which the webview CSP's `img-src https:` allows.
// NOTE: the lucide mask is carried on a data-lucide attribute (not an inline style),
// so the HTML sanitiser can't strip it; renderMarkdown's DOMPurify hook turns it back
// into a real mask style AFTER sanitisation (see applyMaskIcons in update-notes.ts).
export function iconImg(name: string): string {
  const n = String(name || '').trim().toLowerCase();
  const simple = n.match(/^(?:simple|si):(.+)$/);
  if (simple) {
    const url = brandIconUrl(simple[1]);
    // Remote icons off: the generic glyph rather than a broken image. A hole where a logo
    // should be reads as the app being broken.
    if (!url) return `<span class="md-inline-icon md-inline-icon--mask" data-lucide="circle"></span>`;
    return `<img class="md-inline-icon" src="${escAttr(url)}" alt="" loading="lazy">`;
  }
  return `<span class="md-inline-icon md-inline-icon--mask" data-lucide="${escAttr(n.replace(/[^a-z0-9-]/g, ''))}"></span>`;
}

export interface ExpandOpts { baseUrl?: string; }

/** The three states a tracker item can be in, and the words people write for each. Anything
 *  unrecognised is `planned` — never `done`, because a typo must not report work as finished. */
function itemState(raw: string): 'done' | 'progress' | 'planned' {
    const v = String(raw || '').toLowerCase();
    if (v === 'done' || v === 'shipped' || v === 'complete') return 'done';
    if (v === 'progress' || v === 'doing' || v === 'active' || v === 'wip') return 'progress';
    return 'planned';
}

/**
 * The `{"categories":[…]}` tracker the website draws, drawn the same way here.
 *
 * Returns '' when the JSON is not a tracker — a malformed block then falls back to being
 * printed, which is ugly and honest, rather than to an empty box that looks like "no work
 * planned".
 *
 * A `done` item counts as 100 whatever its percent says: a finished line with a half-full bar
 * is the kind of detail nobody reports and everybody notices.
 */
function renderTracker(json: string, title: string): string {
    let data: any;
    try { data = JSON.parse(json); } catch { return ''; }
    const cats = Array.isArray(data?.categories) ? data.categories : null;
    if (!cats?.length) return '';

    let done = 0; let active = 0; let planned = 0; let sum = 0; let n = 0;
    const catHtml = cats.map((c: any) => {
        const items = Array.isArray(c?.items) ? c.items : [];
        const rows = items.map((it: any) => {
            const st = itemState(it?.status);
            const pct = st === 'done' ? 100 : Math.max(0, Math.min(100, Number(it?.percent) || 0));
            if (st === 'done') done++; else if (st === 'progress') active++; else planned++;
            sum += pct; n++;
            const mark = st === 'done' ? '✓' : st === 'progress' ? '◐' : '○';
            return `<div class="community-track-item community-track-${st}">`
                + `<span class="community-track-mark" aria-hidden="true">${mark}</span>`
                + `<span class="community-track-label">${escHtml(String(it?.label ?? ''))}</span>`
                + `<span class="community-track-bar"><i style="width:${pct}%"></i></span>`
                + `<span class="community-track-pct">${pct}%</span>`
                + `</div>`;
        }).join('');
        // The category's own figure is the mean of its items — stated, not guessed: a heading
        // percentage that came from nowhere is the first thing a reader stops trusting.
        const own = items.length
            ? Math.round(items.reduce((a: number, it: any) => a + (itemState(it?.status) === 'done' ? 100 : (Number(it?.percent) || 0)), 0) / items.length)
            : 0;
        return `<div class="community-track-cat">`
            + `<div class="community-track-cathead"><span>${escHtml(String(c?.name ?? ''))}</span><span class="community-track-pct">${own}%</span></div>`
            + `<div class="community-track-catbar"><i style="width:${own}%"></i></div>`
            + rows + `</div>`;
    }).join('');

    const overall = n ? Math.round(sum / n) : 0;
    return `<div class="community-tracker">`
        + `<div class="community-tracker-head">`
        + `<span class="community-tracker-title">${escHtml(title || 'Roadmap')}</span>`
        + `<span class="community-tracker-sum"><b>${overall}%</b> overall · ${done} done · ${active} active · ${planned} planned</span>`
        + `</div>${catHtml}</div>`;
}

/**
 * `:::stage` children → the JSON `renderTracker` reads.
 *
 * The website builds this from its own mdast and BMM has to build it from lines, but the SHAPE
 * has to be identical or the same post renders two different roadmaps — which it did: the app
 * fell through to its compact phase rows, with no overall percentage and no category bars.
 *
 * The rules are the site's, deliberately, down to the awkward one:
 *   · a stage's items are the bullets under it,
 *   · each item INHERITS the stage's status and percent (a stage is the unit of progress here,
 *     not the line),
 *   · `done` is 100 by definition, and
 *   · a stage with no bullets is dropped rather than drawn empty.
 */
function stagesToTrackerJson(inner: string[]): string {
    const cats: { name: string; items: any[] }[] = [];
    let cur: { name: string; items: any[] } | null = null;
    let status = 'planned';
    let pct = 0;
    let depth = 0;
    for (const line of inner) {
        const open = line.match(/^(:{3,})(stage|phase)(\[[^\]]*\])?(\{[^}]*\})?\s*$/i);
        if (open && depth === 0) {
            const a = parseDirAttrs(open[4] ? open[4].slice(1, -1) : '');
            const raw = String(a.state || a.status || '').toLowerCase();
            status = ['done', 'shipped', 'complete'].includes(raw) ? 'done'
                : ['doing', 'active', 'wip', 'progress', 'in-progress'].includes(raw) ? 'progress' : 'planned';
            pct = status === 'done' ? 100 : Math.max(0, Math.min(100, parseInt(a.percent, 10) || 0));
            cur = { name: open[3] ? open[3].slice(1, -1) : String(a.title || ''), items: [] };
            cats.push(cur);
            depth = 1;
            continue;
        }
        if (/^:{3,}[\w-]/.test(line)) { depth++; continue; }
        if (/^:{3,}\s*$/.test(line)) { if (depth > 0) depth--; if (depth === 0) cur = null; continue; }
        const li = line.match(/^\s*[-*+]\s+(.+)$/);
        if (li && cur) cur.items.push({ label: li[1].trim(), status, percent: pct });
    }
    const kept = cats.filter((c) => c.items.length);
    return kept.length ? JSON.stringify({ categories: kept }) : '';
}

export function expandDocBlocks(md: string, opts: ExpandOpts = {}, _top = true): string {
  const baseUrl = (opts.baseUrl || '').replace(/\/+$/, '');
  // Relative site URL → absolute, and a URL the app would refuse to follow → nothing.
  //
  // Every href and media src in this file goes through here, which is why the check is
  // here and not at nine call sites. Each of those sites already handles an empty URL —
  // a button with nowhere to go renders as a span rather than a dead link — so refusing
  // one lands in a path that already exists.
  const abs = (u: string) => {
    if (!u) return '';
    if (!safeDocUrl(u)) return '';
    return (u.startsWith('/') && baseUrl) ? `${baseUrl}${u}` : u;
  };
  let s = md || '';

  s = markMath(s);

  // ::toc → a "On this page" summary built from the ## / ### headings (top level only).
  if (_top && /^\s*::toc\b/m.test(s)) {
    const heads: { level: number; text: string }[] = [];
    for (const line of s.split('\n')) {
      const h = line.match(/^(#{2,3})\s+(.+?)\s*$/);
      if (h) heads.push({ level: h[1].length, text: h[2].replace(/[*_`]/g, '').trim() });
    }
    const toc = heads.length
      ? `<nav class="md-toc"><div class="md-toc-title">On this page</div>${heads.map((h) => `<a class="md-toc-item md-toc-l${h.level}" href="#${headingSlug(h.text)}">${escHtml(h.text)}</a>`).join('')}</nav>`
      : '';
    s = s.replace(/^\s*::toc(\[[^\]]*\])?\s*$/gm, toc);
  } else {
    s = s.replace(/^\s*::toc(\[[^\]]*\])?\s*$/gm, '');
  }

  // :kbd[Ctrl+S] → separate <kbd> keys joined by a "+" (same as the website).
  s = s.replace(/:kbd\[([^\]]+)\]/g, (_m, k) => {
    const keys = String(k).split('+').map((x) => x.trim()).filter(Boolean);
    return `<span class="md-kbd-combo">${keys.map((key) => `<kbd class="md-kbd">${escHtml(key)}</kbd>`).join('<span class="md-kbd-plus">+</span>')}</span>`;
  });
  // Inline annotation from the website: <doc-comment data-comment=".." data-img=".."
  // data-link=".." data-video="..">text</doc-comment> → a dashed-underline span that
  // reveals a hover card (pure CSS, no runtime JS). Mirrors the site's md.jsx DocComment.
  // Done here (pre-sanitise) so it survives as plain spans instead of being stripped.
  s = s.replace(/<doc-comment\b([^>]*)>([\s\S]*?)<\/doc-comment>/gi, (_m, attrs, inner) => {
    const at = (n: string) => { const mm = String(attrs).match(new RegExp(`data-${n}=("|')([\\s\\S]*?)\\1`, 'i')); return mm ? mm[2] : ''; };
    const text = at('comment'), link = at('link'), img = at('img'), video = at('video');
    if (!text && !img && !link && !video) return inner;
    const card = `<span class="doc-comment-card">`
      + (img ? `<img class="doc-comment-img" src="${escAttr(img)}" alt="">` : '')
      + (video ? `<video class="doc-comment-img" src="${escAttr(video)}" controls></video>` : '')
      + (text ? `<span class="doc-comment-text">${escHtml(text)}</span>` : '')
      + (link ? `<a class="doc-comment-link" href="${escAttr(link)}" target="_blank" rel="noreferrer">${escHtml(link.replace(/^https?:\/\//, '').slice(0, 40))}</a>` : '')
      + `</span>`;
    return `<span class="doc-comment" tabindex="0">${inner}${card}</span>`;
  });
  s = s.replace(/:icon\[([^\]]+)\](?:\{[^}]*\})?/g, (_m, name) => iconImg(name));            // inline icon → coloured icon
  // :button[Label]{brand=youtube href=…} / :btn[…] → the site's one shape, three sizes,
  // any colour. A button with nowhere to go is a shape that looks pressable and is not, so
  // an absent href renders a span rather than a dead link — same rule as the website.
  s = s.replace(/:(?:button|btn)\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, txt, rawAttrs) => {
    const a = parseDirAttrs(rawAttrs || '');
    const brand = BUTTON_BRANDS[String(a.brand || '').toLowerCase()];
    const color = a.color || brand?.color || '';
    const size = BUTTON_SIZES.has(String(a.size)) ? a.size : 'md';
    const outline = a.outline != null;
    const href = abs(a.href || a.url || '');
    const cls = `doc-btn doc-btn-${size}${outline ? ' doc-btn-outline' : ''}`;
    const logo = brand
      ? (brandIconUrl(brand.slug)
        ? `<img class="doc-btn-logo" src="${escAttr(brandIconUrl(brand.slug))}/${outline ? brand.color.replace('#', '') : 'white'}" alt="" loading="lazy">`
        : '')
      : (a.icon ? iconImg(a.icon) : '');
    const inner = logo + escHtml(txt);
    const style = color ? ` style="--btn:${escAttr(color)}"` : '';
    if (!href) return `<span class="${cls}"${style}>${inner}</span>`;
    const ext = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noreferrer"' : '';
    return `<a class="${cls}"${style} href="${escAttr(href)}"${ext}>${inner}</a>`;
  });
  // :link[read this]{color=#0a7 href=…} — a link that is a colour rather than THE link
  // colour. The href rules are the button's, because they are the same rules.
  s = s.replace(/:link\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, txt, rawAttrs) => {
    const a = parseDirAttrs(rawAttrs || '');
    const href = abs(a.href || a.url || '');
    const style = a.color ? ` style="--lnk:${escAttr(a.color)}"` : '';
    if (!href) return `<span class="doc-link-c"${style}>${escHtml(txt)}</span>`;
    const ext = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noreferrer"' : '';
    return `<a class="doc-link-c"${style} href="${escAttr(href)}"${ext}>${escHtml(txt)}</a>`;
  });
  // :time[2026-09-01T20:00]{tz=Europe/Paris} / :at[…] → that instant in the reader's zone.
  s = s.replace(/:(?:time|at)\[([^\]]+)\](?:\{([^}]*)\})?/g,
    (_m, raw, rawAttrs) => docTime(String(raw).trim(), parseDirAttrs(rawAttrs || '')));
  // :badge[Label]{color=..} → a coloured chip (same look as the site's tags).
  s = s.replace(/:(?:badge|tag)\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, txt, attrs) => {
    const col = attrs && (attrs.match(/color=("|')?([^"'\s}]+)\1?/) || [])[2];
    return `<span class="community-inline-badge"${col ? ` style="--bc:${col}"` : ''}>${escHtml(txt)}</span>`;
  });

  // ── card / ref / file, written inline ───────────────────────────────────────
  //
  // The website runs container, leaf and TEXT directives through one switch, so `:ref[Doc]{href=…}`
  // typed in the middle of a sentence renders there exactly like the `:::ref` block. Here those
  // three names lived on the block scanner only, and the inline form — the shorter one, the one
  // people actually type — reached the reader as its own source code.
  //
  // Alone on its line it BECOMES the block, which is what the author drew. Inside a sentence it
  // becomes a small link chip instead: a card with a cover image, mid-paragraph, is not a card.
  s = s.replace(/^[ \t]*:(file|ref|card)\[([^\]]*)\](\{[^}]*\})?[ \t]*$/gm,
    (_m, n, label, at) => `:::${n}[${label}]${at || ''}\n:::`);
  // `[^:]` matters: the line above has just written `:::file[…]`, and without it this rule
  // matches the tail of its own output and leaves a stray `::` in front of a chip.
  s = s.replace(/(^|[^:]):(file|ref|card)\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, before, n, txt, rawAttrs) => {
    const a = parseDirAttrs(rawAttrs || '');
    const href = abs(a.href || a.url || a.link || '');
    const ico = n === 'file' ? FILE_SVG : (a.icon ? iconImg(a.icon) : '');
    const cls = 'doc-btn doc-btn-sm doc-btn-outline';
    if (!href) return `${before}<span class="${cls}">${ico}${escHtml(txt)}</span>`;
    const ext = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noreferrer"' : '';
    return `${before}<a class="${cls}" href="${escAttr(href)}"${ext}>${ico}${escHtml(txt)}</a>`;
  });

  const lines = s.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^(:{3,})([\w-]+)(\[[^\]]*\])?(\{[^}]*\})?\s*$/);
    if (!open) { out.push(lines[i]); i++; continue; }
    const name = open[2].toLowerCase();
    const label = open[3] ? open[3].slice(1, -1) : '';
    const attrs = parseDirAttrs(open[4] ? open[4].slice(1, -1) : '');
    const inner: string[] = []; i++; let depth = 1;
    while (i < lines.length) {
      if (/^:{3,}[\w-]/.test(lines[i])) depth++;
      else if (/^:{3,}\s*$/.test(lines[i])) { depth--; if (depth === 0) { i++; break; } }
      inner.push(lines[i]); i++;
    }
    const innerMd = expandDocBlocks(inner.join('\n'), opts, false).trim();
    if (name === 'steps') {
      // A numbered sequence, matching the `:::steps` / `:::step` the website renders.
      //
      // The markers are computed HERE rather than left to CSS counters, for the same
      // reason md.jsx does it on the site: the numbers have to be identical in both
      // places, and a CSS counter cannot be relied on anywhere the HTML is reused (an
      // e-mail, a copied snippet, a theme that resets counters).
      const kind = String(attrs.type || attrs.marker || '1').toLowerCase();
      let n = Math.max(1, parseInt(attrs.start, 10) || 1);
      // Only direct `step` children are numbered — a stray paragraph between two steps
      // must not consume a marker, or the list silently skips a number.
      // REPLACE the child's placeholder marker rather than prepending another. A step
      // always emits data-marker="•" so it still renders on its own; adding a second
      // attribute here produced `data-marker="1" data-marker="•"` on one element, which
      // is valid enough that nothing complained and wrong in a way only a test caught.
      // The class may now carry a state, and the tag may carry a style — so the marker is
      // found by its ATTRIBUTE rather than by the exact opening tag. A step with `status=done`
      // silently lost its number until this stopped matching on the class alone.
      const numbered = innerMd.replace(/(<div class="community-step[^"]*") data-marker="[^"]*"/g, (_m, head) => {
        const m = stepMarker(kind, n); n += 1;
        return `${head} data-marker="${escAttr(m)}"`;
      });
      const vertical = String(attrs.orientation || attrs.dir || 'vertical') !== 'horizontal';
      // `color=` paints the markers, like the site. Carried as a CSS variable on the wrapper so
      // one attribute colours every step under it, and a step may still override its own.
      const col = attrs.color ? ` style="--stepc:${escAttr(attrs.color)}"` : '';
      out.push('', `<div class="community-steps ${vertical ? 'community-steps-v' : 'community-steps-h'}"${col}>${numbered}</div>`, '');
    }
    else if (name === 'step') {
      // The marker is stamped by the parent above. A step used on its own still renders —
      // half a component is worse than a plain paragraph — it simply gets a bullet.
      const title = label || attrs.title || '';
      // A step of its own may be coloured, and may be marked done — the site allows both, and
      // a status that is not `done` is simply no status rather than a third state nobody set.
      const own = attrs.color ? ` style="--stepc:${escAttr(attrs.color)}"` : '';
      const state = String(attrs.status || '').toLowerCase() === 'done' ? ' community-step-done' : '';
      out.push('', `<div class="community-step${state}" data-marker="•"${own}>`
        + (title ? `<div class="community-step-title">${escHtml(title)}</div>` : '')
        // The body is MARKDOWN. Handing it through as raw HTML means `marked` never looks
        // inside it — the site renders **bold** there and the app printed the asterisks.
        + `<div class="community-step-body">${mdInline(innerMd)}</div></div>`, '');
    }
    else if (name === 'roadmap' || name === 'progress') {
      // THREE sources on the site, and the app knew only one of them:
      //
      //   :::roadmap  +  :::stage children   (below)
      //   :::roadmap  +  a ```json``` block  ← this one, and it is what people actually write
      //   :::roadmap{src="…"}                (the site polls it; a desktop app read offline cannot)
      //
      // Without the JSON branch the block fell through to "render the body plainly", so a
      // roadmap posted from the website arrived in BMM as the raw `{"categories":[…]}` printed
      // into the middle of the article.
      const vertical = String(attrs.orientation || attrs.dir || 'vertical') !== 'horizontal';
      const title = label || attrs.title || '';
      const jsonBlock = inner.join('\n').match(/```(?:json)?\s*([\s\S]*?)```/);
      // A `json` block wins; failing that, the `:::stage` children ARE the data. Without this
      // second source the app fell through to its own compact phase rows for the shape the
      // guide teaches, so the same post looked like two different features.
      const tracker = renderTracker(jsonBlock ? jsonBlock[1] : stagesToTrackerJson(inner), title);
      if (tracker) { out.push('', tracker, ''); }
      else {
        out.push('', `<div class="community-roadmap ${vertical ? 'community-roadmap-v' : 'community-roadmap-h'}">`
          + (title ? `<div class="community-roadmap-title">${escHtml(title)}</div>` : '')
          + `${innerMd}</div>`, '');
      }
    }
    else if (name === 'phase' || name === 'stage') {
      // The site's three states, plus the words people actually type. Anything unrecognised is
      // `todo` and never `done`: a typo must not report work as finished.
      const raw = String(attrs.state || attrs.status || '').toLowerCase();
      const state = ['done', 'shipped', 'complete'].includes(raw) ? 'done'
        : ['doing', 'active', 'wip', 'progress'].includes(raw) ? 'doing' : 'todo';
      const mark = state === 'done' ? '✓' : state === 'doing' ? '→' : '○';
      const title = label || attrs.title || '';
      // A stage under way can carry how far it has got. `done` is 100 by definition — a
      // finished stage showing a half-full bar is the kind of detail nobody reports and
      // everybody notices.
      const pct = state === 'done' ? 100 : Math.max(0, Math.min(100, parseInt(attrs.percent, 10) || 0));
      out.push('', `<div class="community-phase community-phase-${state}">`
        + `<div class="community-phase-mark" aria-hidden="true">${mark}</div>`
        + `<div class="community-phase-body">`
        + (title ? `<div class="community-phase-title">${escHtml(title)}`
          + (pct ? `<span class="community-phase-pct">${pct}%</span>` : '') + `</div>` : '')
        + (pct ? `<div class="community-phase-bar"><i style="width:${pct}%"></i></div>` : '')
        + `${innerMd}</div></div>`, '');
    }
    else if (name === 'tabs') {
      // The one shape this vocabulary could not express, and the reason it exists: people
      // wrote the same content three times — Windows, macOS, Linux — stacked down the page,
      // because three headings were the only way to say "pick the one that is yours".
      //
      // The panels have already been expanded by the recursive call above, so their titles
      // are read back OFF them rather than declared a second time here. A label written in
      // two places is a label that drifts from its content.
      const titles: string[] = [];
      const body = innerMd.replace(/<div class="doc-tab" data-title="([^"]*)">/g, (_m2, title) => {
        const i = titles.length;
        titles.push(title);
        return `<div class="doc-tab${i === 0 ? ' is-on' : ''}" data-title="${title}" role="tabpanel">`;
      });
      // No panels means somebody wrote `:::tabs` around ordinary content. Rendering the
      // content is right; an empty tab strip above it would not be.
      if (!titles.length) out.push('', innerMd, '');
      else {
        // Titles come back already escaped — they were read out of an attribute this file
        // wrote. Escaping them again would render `&amp;` at the reader.
        const bar = titles.map((title, i) => `<button type="button" role="tab" class="doc-tabs-btn${i === 0 ? ' is-on' : ''}"`
          + ` data-i="${i}" aria-selected="${i === 0 ? 'true' : 'false'}">${title || String(i + 1)}</button>`).join('');
        out.push('', `<div class="doc-tabs"><div class="doc-tabs-bar" role="tablist">${bar}</div>${body}</div>`, '');
      }
    }
    else if (name === 'tab') {
      // An untitled panel is numbered by the bar rather than left blank — better than a gap
      // in the strip, and it says which one to go and name.
      out.push('', `<div class="doc-tab" data-title="${escAttr(String(attrs.title || attrs.name || label || '').trim())}">${mdInline(innerMd)}</div>`, '');
    }
    else if (name === 'schedule' || name === 'hours') {
      // A repeating schedule, stated in ONE zone.
      //
      // The rows are NOT converted, and that is the correct answer rather than a missing
      // feature. "Monday 09:00 Europe/Paris" is 09:00 in Paris every week of the year; what
      // moves across a daylight-saving boundary is how far that is from the reader. A
      // converted row would be right today and wrong in March, with nothing on the page
      // admitting it. So the zone is named, and the difference is stated for right now.
      const tz = String(attrs.tz || attrs.timezone || '').trim();
      const title = String(label || attrs.title || '').trim() || t('md.sched.hours');
      const note = zoneNote(tz);
      out.push('', `<div class="doc-schedule"><div class="doc-schedule-head">`
        + `<span class="doc-schedule-title">${escHtml(title)}</span>`
        + (tz ? `<span class="doc-schedule-tz">${escHtml(tz)}</span>` : '')
        + `</div><div class="doc-schedule-body">${mdInline(innerMd)}</div>`
        + (note ? `<p class="doc-schedule-note">${escHtml(note)}</p>` : '')
        + `</div>`, '');
    }
    else if (name === 'cards') { out.push('', `<div class="community-cards">${innerMd}</div>`, ''); }
    else if (name === 'columns' || name === 'row') { out.push('', `<div class="community-columns">${innerMd}</div>`, ''); }
    else if (name === 'column' || name === 'col') { out.push('', `<div class="community-column">${mdInline(innerMd)}</div>`, ''); }
    else if (name === 'card' || name === 'ref') {
      const title = label || attrs.title || '';
      // Through `abs`, like everything else. This branch had its own copy of the
      // relative-to-absolute line, which is how it went round the URL check that was
      // added to `abs` — the funnel only funnels what actually flows through it.
      const href = abs(attrs.href || attrs.link || '');
      const icon = attrs.icon ? iconImg(attrs.icon) : '';
      // Optional cover media (image / video / colour swatch), like the website's cards.
      const media = attrs.image
        ? `<div class="community-inline-card-media" style="background-image:url('${escAttr(abs(attrs.image))}')"></div>`
        : attrs.video ? `<video class="community-inline-card-media" src="${escAttr(abs(attrs.video))}" controls></video>`
        : attrs.color ? `<div class="community-inline-card-media" style="background:${escAttr(attrs.color)}"></div>` : '';
      const titleHtml = title
        ? (href ? `<a href="${escAttr(href)}" target="_blank" rel="noreferrer" class="community-inline-card-title">${icon}${escHtml(title)}</a>` : `<span class="community-inline-card-title">${icon}${escHtml(title)}</span>`)
        : '';
      out.push('', `<div class="community-inline-card">${media}${titleHtml}<div class="community-inline-card-body">${mdInline(innerMd)}</div></div>`, '');
    } else if (name === 'file') {
      // Download card: :::file{name="setup.exe" href="…" size="12 MB"}
      const fname = label || attrs.name || attrs.title || 'file';
      const href = abs(attrs.href || attrs.url || attrs.link || '');
      const size = attrs.size || '';
      const btns = href
        ? `<a href="${escAttr(href)}" download class="community-file-btn">Download</a><a href="${escAttr(href)}" target="_blank" rel="noreferrer" class="community-file-btn community-file-btn-ghost">Open</a>`
        : '';
      out.push('', `<div class="community-file"><span class="community-file-icon">${FILE_SVG}</span><div class="community-file-info"><div class="community-file-name">${escHtml(fname)}</div>${size ? `<div class="community-file-size">${escHtml(size)}</div>` : ''}</div><div class="community-file-actions">${btns}</div></div>`, '');
    } else if (name === 'details' || name === 'collapse') {
      out.push('', `<details class="community-details"><summary>${escHtml(label || attrs.title || 'Details')}</summary><div class="community-details-body">${mdInline(innerMd)}</div></details>`, '');
    } else if (name === 'replay' || name === 'bmmreplay') {
      // Inline BMM session replay. The same :::replay{src="…" title="…"} the BCWEB site
      // uses. BMM has no inline rrweb player, so this renders a play card that opens the
      // app's own full replay viewer (playReplayFromUrl) via the delegated click handler
      // in update-notes.ts. `src` is made absolute against baseUrl for site content.
      const src = abs(attrs.src || attrs.href || '');
      const title = label || attrs.title || '';
      if (src) {
        const caption = t('watcher.playEmbed') || 'Play the recorded session';
        out.push('', `<button type="button" class="bmm-replay-embed" data-src="${escAttr(src)}"${title ? ` data-title="${escAttr(title)}"` : ''}>`
          + `<span class="bmm-replay-embed-icon" aria-hidden="true">▶</span>`
          + `<span class="bmm-replay-embed-text"><span class="bmm-replay-embed-title">${escHtml(title || (t('watcher.replayTitle') || 'Session replay'))}</span>`
          + `<span class="bmm-replay-embed-sub">${escHtml(caption)}</span></span></button>`, '');
      }
    } else if (name === 'center' || name === 'left' || name === 'right') {
      out.push('', `<div class="community-align" style="text-align:${name}">${mdInline(innerMd)}</div>`, '');
    } else if (CALLOUT_ALERT[name]) {
      // Callout → GitHub-style [!alert] blockquote (marked + post-processing style it).
      out.push('', `> [!${CALLOUT_ALERT[name]}]`);
      if (label || attrs.title) out.push(`> **${label || attrs.title}**`);
      innerMd.split('\n').forEach((l) => out.push(`> ${l}`));
      out.push('');
    } else { out.push('', innerMd, ''); }
  }
  // `:rocket:` LAST, and on the assembled output: a shortcode inside a directive's attributes
  // is not a shortcode, and by here every directive has been consumed. Only known names are
  // replaced, so `10:30:45` and a French sentence ending in a colon are both safe.
  return replaceEmoji(out.join('\n'));
}
