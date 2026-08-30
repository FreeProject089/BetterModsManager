// The two icon CDNs, in one place, with a switch.
//
// A markdown document can name any lucide icon and any Simple Icons brand. The curated set is
// bundled; everything else was fetched — from `cdn.jsdelivr.net` for a lucide mask and from
// `cdn.simpleicons.org` for a brand — and the URL for each was written into four different
// files. Four literals means four places to change, and in practice it means nobody changes
// any of them:
//
//   · a request that does not arrive (offline, a blocked host, a CDN having a day) leaves an
//     empty square where a glyph should be — no error, no fallback, and it reads as the app
//     being broken rather than as a fetch failing;
//   · it also tells a third party which page of a desktop application somebody is reading,
//     which is not a thing a mod manager should do quietly.
//
// So: one module, one decision. `setIconCdn(false)` turns both off and every caller falls back
// to a bundled glyph. Nothing here is fetched until a document actually names an icon that is
// not in the bundled set.

/** Off switches both families. Kept as a single flag because the two share one reason. */
let ENABLED = true;

/** Turn remote icons on or off for the whole app. */
export function setIconCdn(on: boolean): void { ENABLED = !!on; }

/** Are remote icons allowed right now? */
export const iconCdnEnabled = (): boolean => ENABLED;

/**
 * The mask URL for a lucide icon, or '' when remote icons are off.
 *
 * The name is filtered to `[a-z0-9-]` by every caller before it gets here and again here, so
 * a document cannot build a URL out of it.
 */
export function lucideIconUrl(name: string): string {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!ENABLED || !n) return '';
  return `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${n}.svg`;
}

/** The image URL for a Simple Icons brand, or '' when remote icons are off. */
export function brandIconUrl(slug: string): string {
  const s = String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!ENABLED || !s) return '';
  return `https://cdn.simpleicons.org/${s}`;
}
