// A catalog that carries its own files.
//
// Every BMM catalog is a `catalog.json` listing things that live somewhere else, and until
// now "somewhere else" meant a URL — so publishing one meant finding a host, and following
// one meant the host still being there. A BUNDLE is the same catalog.json with the files
// packed beside it in one archive: a single thing to send somebody, and nothing to host.
//
// The format is deliberately not new. It is a zip with `catalog.json` at its root and the
// payloads next to it, which is exactly the folder the builders already write — the bundle
// is that folder, zipped. Anything that can read the folder can read the bundle after one
// extraction, and anyone with a zip tool can look inside without BMM.
//
// **A bundle may still point outward.** An entry is either a name inside the archive or an
// http(s) URL, and both are legal in the same catalog: the small things travel with it, the
// 400 MB one stays on a CDN. That is the whole reason this file exists — the two kinds of
// address need telling apart before either is followed, and getting that wrong in the
// direction of "treat a path as a URL" or "treat a URL as a path" is how a catalog reads a
// file it was never pointed at.
//
// Pure, importing nothing, so the rule below can be pinned by tests rather than argued
// about.

/** What an entry's address turned out to be. */
export type BundleEntryKind = 'remote' | 'inside' | 'rejected';

/**
 * Classify an entry address found inside a bundle.
 *
 * Everything that is not plainly one of the two safe shapes is 'rejected'. In particular a
 * bare `foo.bmmpa` is 'inside' — that is the normal case — while anything carrying a
 * scheme, a drive letter, a UNC prefix, a leading slash or a `..` segment is refused
 * outright rather than cleaned up. Repairing a hostile path is how a guard becomes a
 * negotiation.
 */
export function bundleEntryKind(raw: unknown): BundleEntryKind {
    // A STRING, not something that stringifies. `String(0)` is "0" and
    // `String({})` is "[object Object]", and both are perfectly good filenames as far as
    // every check below is concerned — so a document whose download_url is a number, or an
    // object, would have been coerced into a name and then opened. JSON from somebody else
    // holds whatever they put in it.
    if (typeof raw !== 'string') return 'rejected';
    const v = raw.trim();
    if (!v) return 'rejected';
    if (/^https?:\/\//i.test(v)) return 'remote';
    // Any other scheme — file:, javascript:, data:, bmm: — is not an address a catalog
    // entry is allowed to carry. Checked before the path rules so `file:///etc/passwd`
    // cannot pass as a relative name by having no leading slash of its own.
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return 'rejected';
    if (v.startsWith('/') || v.startsWith('\\')) return 'rejected';   // absolute, or UNC
    if (/^[a-z]:/i.test(v)) return 'rejected';                        // C:\…
    // `..` as a whole segment, on either separator. `a..b.zip` is a filename, not an escape.
    if (v.split(/[/\\]/).some((seg) => seg === '..')) return 'rejected';
    // A NUL or a control character in a path is never a real filename and is a classic way
    // to truncate one on the way to a syscall.
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f]/.test(v)) return 'rejected';
    return 'inside';
}

/**
 * Where an entry inside a bundle actually is.
 *
 * `dir` is the directory the archive was extracted into — a path BMM chose, not one the
 * document supplied. Returns '' for anything that must not be opened, so a caller has one
 * thing to test rather than a set of path rules of its own.
 *
 * Note what this does NOT do: it never touches the disk, and it never normalises its way
 * out of a bad input. `bundleEntryKind` has already refused every shape that could leave
 * `dir`, so the join here is a concatenation and not a decision.
 */
export function resolveBundleEntry(raw: unknown, dir: unknown): string {
    if (bundleEntryKind(raw) !== 'inside') return '';
    if (typeof dir !== 'string') return '';
    const base = dir.trim();
    if (!base) return '';
    const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
    const rel = String(raw).trim().replace(/^[./\\]+/, '');
    if (!rel) return '';
    return base.replace(/[/\\]+$/, '') + sep + rel;
}

/**
 * Does this document look like a catalog at all?
 *
 * A bundle is a zip somebody handed over, so the first question is whether the thing at its
 * root is a catalog and not a coincidence — a mod archive that happens to contain a file
 * called catalog.json should be refused as a bundle, not half-read as one.
 *
 * Deliberately shallow: it checks for the SHAPE every BMM catalog shares (a version and one
 * of the known entry arrays), not for a particular type. Which type it is, is the reader's
 * business — and a check that knew the list would be one more place to update when an
 * eighth kind of catalog is added.
 */
export const CATALOG_ARRAYS = ['presets', 'plugins', 'themes', 'apps', 'modpacks', 'tutorials', 'lists', 'catalogs', 'items'] as const;

export function looksLikeCatalog(doc: unknown): boolean {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
    const d = doc as Record<string, unknown>;
    return CATALOG_ARRAYS.some((k) => Array.isArray(d[k]));
}

/**
 * Every address a catalog document carries, whatever kind of catalog it is.
 *
 * Used to check a bundle is complete before it is offered — a catalog naming three files
 * and containing two is a thing to say out loud at pack time, not to discover on the
 * machine of whoever you sent it to.
 */
export function catalogEntryUrls(doc: unknown): string[] {
    if (!looksLikeCatalog(doc)) return [];
    const d = doc as Record<string, unknown>;
    const out: string[] = [];
    for (const key of CATALOG_ARRAYS) {
        const arr = d[key];
        if (!Array.isArray(arr)) continue;
        for (const row of arr) {
            if (!row || typeof row !== 'object') continue;
            const r = row as Record<string, unknown>;
            // The field is spelled differently per catalog kind, and a bundle has to see
            // them all: download_url is the presets/plugins spelling, url the index one,
            // file the one the theme feed uses.
            const v = r.download_url ?? r.url ?? r.file ?? r.path;
            if (typeof v === 'string' && v.trim()) out.push(v.trim());
        }
    }
    return out;
}
