// Shared "rich markdown" pre-processor. BMM renders markdown with `marked`, which
// doesn't understand the GitBook-style remark-directive blocks the BCWEB site uses
// (`:::note`, `::::cards`, `:badge[]`, `:icon[]`, `:kbd[]`, `::toc`…). This down-
// converts them to constructs `marked` (+ our post-processing) renders, so the SAME
// markdown displays the SAME way in the Community blog AND the Release/Update notes —
// cards, columns, collapsibles, coloured icons and the table of contents included.
import { escHtml, escAttr } from '../core/utils.js';
import { t } from '../core/i18n.js';

const CALLOUT_ALERT: Record<string, string> = {
  note: 'NOTE', info: 'NOTE', tip: 'TIP', hint: 'TIP', success: 'TIP',
  warning: 'WARNING', caution: 'CAUTION', danger: 'CAUTION', important: 'IMPORTANT', callout: 'NOTE', custom: 'NOTE',
};

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
  if (simple) return `<img class="md-inline-icon" src="https://cdn.simpleicons.org/${simple[1].replace(/[^a-z0-9-]/g, '')}" alt="" loading="lazy">`;
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

export function expandDocBlocks(md: string, opts: ExpandOpts = {}, _top = true): string {
  const baseUrl = (opts.baseUrl || '').replace(/\/+$/, '');
  const abs = (u: string) => (u && u.startsWith('/') && baseUrl) ? `${baseUrl}${u}` : u; // relative site URL → absolute
  let s = md || '';

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
  // :badge[Label]{color=..} → a coloured chip (same look as the site's tags).
  s = s.replace(/:(?:badge|tag)\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, txt, attrs) => {
    const col = attrs && (attrs.match(/color=("|')?([^"'\s}]+)\1?/) || [])[2];
    return `<span class="community-inline-badge"${col ? ` style="--bc:${col}"` : ''}>${escHtml(txt)}</span>`;
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
    else if (name === 'roadmap') {
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
      const tracker = jsonBlock ? renderTracker(jsonBlock[1], title) : '';
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
    else if (name === 'cards') { out.push('', `<div class="community-cards">${innerMd}</div>`, ''); }
    else if (name === 'columns' || name === 'row') { out.push('', `<div class="community-columns">${innerMd}</div>`, ''); }
    else if (name === 'column' || name === 'col') { out.push('', `<div class="community-column">${mdInline(innerMd)}</div>`, ''); }
    else if (name === 'card' || name === 'ref') {
      const title = label || attrs.title || '';
      let href = attrs.href || attrs.link || '';
      if (href.startsWith('/') && baseUrl) href = `${baseUrl}${href}`; // relative site link → absolute
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
      let href = attrs.href || attrs.url || attrs.link || '';
      if (href.startsWith('/') && baseUrl) href = `${baseUrl}${href}`;
      const size = attrs.size || '';
      const btns = href
        ? `<a href="${escAttr(href)}" download class="community-file-btn">Download</a><a href="${escAttr(href)}" target="_blank" rel="noreferrer" class="community-file-btn community-file-btn-ghost">Open</a>`
        : '';
      const fileSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      out.push('', `<div class="community-file"><span class="community-file-icon">${fileSvg}</span><div class="community-file-info"><div class="community-file-name">${escHtml(fname)}</div>${size ? `<div class="community-file-size">${escHtml(size)}</div>` : ''}</div><div class="community-file-actions">${btns}</div></div>`, '');
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
  return out.join('\n');
}
