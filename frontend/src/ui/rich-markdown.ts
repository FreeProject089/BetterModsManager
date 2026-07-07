// Shared "rich markdown" pre-processor. BMM renders markdown with `marked`, which
// doesn't understand the GitBook-style remark-directive blocks the BCWEB site uses
// (`:::note`, `::::cards`, `:badge[]`, `:icon[]`, `:kbd[]`, `::toc`…). This down-
// converts them to constructs `marked` (+ our post-processing) renders, so the SAME
// markdown displays the SAME way in the Community blog AND the Release/Update notes —
// cards, columns, collapsibles, coloured icons and the table of contents included.
import { escHtml, escAttr } from '../core/utils.js';

const CALLOUT_ALERT: Record<string, string> = {
  note: 'NOTE', info: 'NOTE', tip: 'TIP', hint: 'TIP', success: 'TIP',
  warning: 'WARNING', caution: 'CAUTION', danger: 'CAUTION', important: 'IMPORTANT', callout: 'NOTE', custom: 'NOTE',
};

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

export function expandDocBlocks(md: string, opts: ExpandOpts = {}, _top = true): string {
  const baseUrl = (opts.baseUrl || '').replace(/\/+$/, '');
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
    if (name === 'cards') { out.push('', `<div class="community-cards">${innerMd}</div>`, ''); }
    else if (name === 'columns' || name === 'row') { out.push('', `<div class="community-columns">${innerMd}</div>`, ''); }
    else if (name === 'column' || name === 'col') { out.push('', `<div class="community-column">${mdInline(innerMd)}</div>`, ''); }
    else if (name === 'card' || name === 'ref') {
      const title = label || attrs.title || '';
      let href = attrs.href || attrs.link || '';
      if (href.startsWith('/') && baseUrl) href = `${baseUrl}${href}`; // relative site link → absolute
      const icon = attrs.icon ? iconImg(attrs.icon) : '';
      const titleHtml = title
        ? (href ? `<a href="${escAttr(href)}" target="_blank" rel="noreferrer" class="community-inline-card-title">${icon}${escHtml(title)}</a>` : `<span class="community-inline-card-title">${icon}${escHtml(title)}</span>`)
        : '';
      out.push('', `<div class="community-inline-card">${titleHtml}<div class="community-inline-card-body">${mdInline(innerMd)}</div></div>`, '');
    } else if (name === 'details' || name === 'collapse') {
      out.push('', `<details class="community-details"><summary>${escHtml(label || attrs.title || 'Details')}</summary><div class="community-details-body">${mdInline(innerMd)}</div></details>`, '');
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
