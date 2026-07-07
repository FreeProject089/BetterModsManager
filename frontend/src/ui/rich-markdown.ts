// Shared "rich markdown" pre-processor. BMM renders markdown with `marked`, which
// doesn't understand the GitBook-style remark-directive blocks the BCWEB site uses
// (`:::note`, `::::cards`, `:badge[]`, `:icon[]`, `:kbd[]`, …). This down-converts
// those directives to constructs `marked` (+ our post-processing) already renders,
// so the SAME markdown displays identically in the in-app Community blog AND the
// Release/Update notes modals — icons and badges included.
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

// Render an inline icon like the site does: lucide names from the lucide-static CDN,
// `simple:brand` from the Simple Icons CDN. Served over https (allowed by the webview
// CSP's `img-src https:`), so no bundled icon set is needed and it matches BCWEB 1:1.
function iconImg(name: string): string {
  const n = String(name || '').trim().toLowerCase();
  const simple = n.match(/^(?:simple|si):(.+)$/);
  const src = simple
    ? `https://cdn.simpleicons.org/${simple[1].replace(/[^a-z0-9-]/g, '')}`
    : `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${n.replace(/[^a-z0-9-]/g, '')}.svg`;
  return `<img class="md-inline-icon" src="${escAttr(src)}" alt="" loading="lazy">`;
}

export interface ExpandOpts { baseUrl?: string; }

export function expandDocBlocks(md: string, opts: ExpandOpts = {}): string {
  const baseUrl = (opts.baseUrl || '').replace(/\/+$/, '');
  let s = md || '';
  s = s.replace(/^\s*::toc(\[[^\]]*\])?\s*$/gm, '');            // table-of-contents marker → drop
  s = s.replace(/:kbd\[([^\]]+)\]/g, (_m, k) => '`' + k + '`'); // shortcut → inline code
  s = s.replace(/:icon\[([^\]]+)\](?:\{[^}]*\})?/g, (_m, name) => iconImg(name)); // inline icon → real icon
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
    const innerMd = expandDocBlocks(inner.join('\n'), opts).trim();
    if (name === 'cards' || name === 'columns' || name === 'row' || name === 'column' || name === 'col') { out.push('', innerMd, ''); }
    else if (name === 'card' || name === 'ref') {
      const title = label || attrs.title || '';
      let href = attrs.href || attrs.link || '';
      if (href.startsWith('/') && baseUrl) href = `${baseUrl}${href}`; // relative site link → absolute
      const titleHtml = title
        ? (href ? `<a href="${escAttr(href)}" target="_blank" rel="noreferrer" class="community-inline-card-title">${escHtml(title)}</a>` : `<span class="community-inline-card-title">${escHtml(title)}</span>`)
        : '';
      out.push('', `<div class="community-inline-card">${titleHtml}<div class="community-inline-card-body">${escHtml(innerMd)}</div></div>`, '');
    } else if (name === 'details' || name === 'collapse') {
      out.push('', `<details><summary>${label || attrs.title || 'Details'}</summary>`, '', innerMd, '', '</details>', '');
    } else if (CALLOUT_ALERT[name]) {
      out.push('', `> [!${CALLOUT_ALERT[name]}]`);
      if (label || attrs.title) out.push(`> **${label || attrs.title}**`);
      innerMd.split('\n').forEach((l) => out.push(`> ${l}`));
      out.push('');
    } else { out.push('', innerMd, ''); }
  }
  return out.join('\n');
}
