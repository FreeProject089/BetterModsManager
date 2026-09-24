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

/**
 * `ph:rocket` / `ph-bold:rocket` (thin · light · regular · bold · fill · duotone) → the
 * `<weight>/<file>` path under Phosphor's assets, or null when the name is not a Phosphor one.
 * The same spelling B.MD accepts on the website, so an icon named once draws in both places.
 */
export function phosphorRef(name: string): string | null {
    const m = String(name || '').toLowerCase().match(/^(?:ph|phosphor)(?:-(thin|light|regular|bold|fill|duotone))?:([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (!m) return null;
    const w = m[1] || 'regular';
    return `${w}/${m[2]}${w === 'regular' ? '' : `-${w}`}`;
}

/** The mask URL for a Phosphor icon (a `phosphorRef` path), or '' when remote icons are off. */
export function phosphorIconUrl(ref: string): string {
    const r = String(ref || '').toLowerCase().replace(/[^a-z0-9/-]/g, '');
    if (!ENABLED || !r) return '';
    return `https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/${r}.svg`;
}

/**
 * The isometric icons (`iso:server`, `iso:cube-cloud`, `iso:solid-play`), G5.
 *
 * Full-colour SVGs from three third-party sets whose licences allow redistribution inside
 * software (Isoflow isopack, MI2, Jolloficons: MIT; MI2's glyphs are Material Design Icons,
 * Apache-2.0). They ship WITH the app under assets/icons/iso/, next to LICENSES.txt, which
 * names every file's origin and carries the licence texts. Same spelling as B.MD on the
 * website, so an icon named once draws in both places.
 *
 * Bundled, not fetched: the CDN switch above does not apply, and nothing leaves the machine.
 * The list is closed, so a name outside it resolves to '' (callers fall back to their generic
 * glyph) and nothing a document writes can become a path. tests/iso-icons.test.mjs fails when
 * this list and the files on disk disagree.
 */
export const ISO_NAMES: readonly string[] = ('block cache card-terminal cloud cronjob cube desktop diamond dns document firewall '
    + 'function-module image laptop load-balancer lock mail mail-multiple mobile-device office package-module '
    + 'payment-card plane printer pyramid queue router server speech sphere storage switch-module tower truck-2 '
    + 'truck user vm cube-application cube-blockchain cube-clinic cube-cloud cube-money cube-patient cube-payer '
    + 'cube-provider cube-query cube-researcher cube-security cube-security-2 cube-security-3 cube-storage '
    + 'cube-storage-2 solid-app-menu solid-arrow-down solid-arrow-left solid-arrow-right solid-arrow-up '
    + 'solid-badge solid-boxes solid-camera solid-caution solid-chart-2 solid-chart solid-dot-vertical solid-eyes '
    + 'solid-fast-forward solid-file-add solid-file solid-flash solid-guard solid-message solid-minus solid-next '
    + 'solid-notepad solid-pause solid-play solid-plus solid-previous solid-rewind solid-send solid-stop '
    + 'solid-user-add solid-user-settings').split(' ');
const ISO_SET = new Set(ISO_NAMES);

/** `iso:server` / `isometric:server` → `server` when it is one of ISO_NAMES, else null. */
export function isoRef(name: string): string | null {
    const m = String(name || '').trim().toLowerCase().match(/^(?:iso|isometric):([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    return m && ISO_SET.has(m[1]) ? m[1] : null;
}

/** The bundled file for an `iso:` name, or '' when it is not one. */
export function isoIconUrl(name: string): string {
    const n = isoRef(name);
    return n ? `assets/icons/iso/${n}.svg` : '';
}
