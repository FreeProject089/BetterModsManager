// Reading a catalog INDEX — one URL that lists catalogs of several types.
//
// BMM configures one fixed URL per type (links.json carries `apps_catalog` and
// `plugin_catalog` separately), and the only chaining it had, `community_imports`, lives
// on AppCatalog — so it can bring in more app catalogs and nothing else. There was no way
// to hand BMM a single address and have it pick up app, plugin and theme catalogs
// together. This is that reader.
//
// The parsing half is pure and lives here so it can be tested directly; the applying half
// takes its stores as arguments for the same reason. Everything that talks to Tauri or
// localStorage stays in the caller.

/** One catalog named by an index. */
export interface IndexEntry {
    /** app · plugin · theme · preset · repo — which subsystem it belongs to. */
    type: string;
    /** Which Better* product it is for. Absent means the publisher did not say. */
    app?: string;
    url: string;
    name?: string;
    description?: string;
    owner?: string;
    items?: number;
    /** What the document CLAIMS. Never trusted — see parseCatalogIndex. */
    official?: boolean;
}

export interface CatalogIndex {
    version?: string;
    name?: string;
    description?: string;
    catalogs: IndexEntry[];
}

/** Types BMM can actually route. An entry naming anything else is dropped, not guessed. */
// `repo` and `preset` were missing while the feed already published both, so a perfectly
// good index entry was thrown away by the reader — and that failure looks like the server
// not sending it, which is the wrong place to go looking. Keep this in step with what the
// index can emit; a type accepted here with nowhere to route it is lost by the caller,
// which is worse than refusing it.
export const INDEX_TYPES = ['app', 'plugin', 'theme', 'preset', 'repo'] as const;

/**
 * Parse and sanitise an index document.
 *
 * Rejects rather than repairs. An index is a remote document from a server the user
 * pasted a URL for, so every field is untrusted input:
 *
 *  - Only http(s) URLs survive. A `file://` or `javascript:` entry in a list that gets
 *    handed to a fetcher is the obvious attack, and "it would probably fail anyway" is not
 *    a reason to pass it on.
 *  - `official` is dropped entirely. BMM assigns trust from the source URL — apply_trust
 *    overrides whatever an app catalog claims — and an index that could grant it would be
 *    a way around that, not an extension of it.
 *  - Unknown types are dropped. Guessing that "plugins" means "plugin" is how a preset
 *    catalog ends up in the themes list.
 *  - Duplicate URLs collapse, keeping the first: an index listing something twice must not
 *    make the caller add it twice.
 */
/**
 * Is this document an INDEX of catalogs, rather than a catalog?
 *
 * Somebody handed an index URL will paste it into whichever "add a catalog source" field
 * is in front of them — they are all boxes that take a URL, and nothing on screen says
 * which kind of document each expects. Adding an index as an app catalog fails silently:
 * it has no `apps` array, so BMM reads zero entries and reports a source that works and
 * contains nothing. Detecting it is what turns that into "this is an index, shall I add it
 * as one?".
 *
 * Shape, never the URL. A file called catalogs.json can be anything and a catalog can be
 * called anything; guessing from the name is how the wrong document gets accepted with
 * confidence.
 *
 * The test is deliberately narrow: a `catalogs` ARRAY whose entries look like index
 * entries — a url and a type. A document merely carrying the word "catalogs" is not one,
 * and misidentifying a real catalog would take a working source away from somebody.
 */
export function looksLikeIndex(doc: unknown): boolean {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
    const d = doc as Record<string, any>;
    // An explicit self-declaration is enough on its own — BCWEB sends kind: 'catalog-index'
    // — but is NOT required, so a hand-written index still works.
    if (String(d.kind || '').toLowerCase() === 'catalog-index' && Array.isArray(d.catalogs)) return true;
    if (!Array.isArray(d.catalogs) || d.catalogs.length === 0) return false;
    // A catalog feed never carries a top-level `catalogs` array of {url,type} objects; those
    // carry apps/plugins/themes/presets instead. Requiring BOTH fields keeps a document that
    // happens to list catalog NAMES from being mistaken for one that lists their addresses.
    return d.catalogs.every((e: any) => e && typeof e === 'object'
        && typeof e.url === 'string' && typeof e.type === 'string');
}

export function parseCatalogIndex(raw: unknown, forApp = 'bmm'): { index: CatalogIndex; dropped: string[] } {
    const dropped: string[] = [];
    const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    const list = Array.isArray(doc.catalogs) ? doc.catalogs : [];
    const seen = new Set<string>();
    const catalogs: IndexEntry[] = [];

    for (const e of list) {
        if (!e || typeof e !== 'object') { dropped.push('not an object'); continue; }
        const type = String(e.type || '').trim().toLowerCase();
        const url = String(e.url || '').trim();
        if (!(INDEX_TYPES as readonly string[]).includes(type)) {
            dropped.push(`${url || '(no url)'} — unknown type ${JSON.stringify(e.type)}`);
            continue;
        }
        // Not for this app. An index may list catalogs for every Better* product, and
        // pulling a BSM theme catalog into BMM would put entries in front of people that
        // their app cannot install.
        //
        // An entry with NO app is KEPT, deliberately. Absent means "nobody said", which is
        // the state of every catalog published before the field existed — dropping those
        // would empty the index for the people who have been using it longest. The
        // asymmetry is the point: an explicit mismatch is a statement, a missing value is
        // not.
        const app = String(e.app || '').trim().toLowerCase();
        if (app && forApp && app !== forApp) {
            dropped.push(`${url} — for ${app}, not ${forApp}`);
            continue;
        }
        if (!/^https?:\/\//i.test(url)) {
            dropped.push(`${url || '(no url)'} — not an http(s) url`);
            continue;
        }
        const key = url.toLowerCase();
        if (seen.has(key)) { dropped.push(`${url} — listed twice`); continue; }
        seen.add(key);
        catalogs.push({
            type,
            url,
            ...(app ? { app } : {}),
            name: typeof e.name === 'string' ? e.name.slice(0, 120) : undefined,
            description: typeof e.description === 'string' ? e.description.slice(0, 400) : undefined,
            owner: typeof e.owner === 'string' ? e.owner.slice(0, 120) : undefined,
            items: Number.isFinite(e.items) ? Number(e.items) : undefined,
        });
    }

    return {
        index: {
            version: typeof doc.version === 'string' ? doc.version : undefined,
            name: typeof doc.name === 'string' ? doc.name.slice(0, 120) : undefined,
            description: typeof doc.description === 'string' ? doc.description.slice(0, 400) : undefined,
            catalogs,
        },
        dropped,
    };
}

/** Where each type's community sources are kept. Not a new store — these are the two the
 *  deeplink handler already writes to, so a catalog added by either route lands in one
 *  place and shows up in the same list. */
export const STORE_KEY: Record<string, string> = {
    plugin: 'bmm_plugin_catalogs',
    theme: 'bmm_theme_community_sources',
    // New stores, following the existing naming rather than inventing a scheme. `app` is
    // absent on purpose: app sources live in the Rust backend behind add_community_source,
    // and the caller special-cases it.
    preset: 'bmm_preset_catalogs',
    repo: 'bmm_repo_catalogs',
};

/** Every type this module can actually deliver somewhere.
 *
 *  The check that stops INDEX_TYPES and STORE_KEY drifting apart: a type accepted by the
 *  parser with nowhere to put it is accepted and then dropped on the floor by the caller,
 *  which looks exactly like the server never sending it. `app` is the one deliberate
 *  exception — it has a backend command instead of a local store. */

/** Where an imported catalog came from: catalog URL → the index that listed it.
 *
 *  A SEPARATE map rather than a richer entry in the source lists themselves. Those lists
 *  are plain arrays of URLs written by the deeplink handler too, and changing their shape
 *  would mean every reader and writer of them agreeing at once — including one in the Rust
 *  backend. This is additive: anything that does not know about provenance keeps working,
 *  and a missing entry simply means "added by hand", which is the truth.
 */
const ORIGIN_KEY = 'bmm_catalog_origins';

export function readOrigins(): Record<string, string> {
    try {
        const v = JSON.parse(localStorage.getItem(ORIGIN_KEY) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
}

/** Record that `catalogUrl` arrived via `indexUrl`. */
export function rememberOrigin(catalogUrl: string, indexUrl: string): void {
    if (!catalogUrl || !indexUrl) return;
    try {
        const m = readOrigins();
        m[catalogUrl] = indexUrl;
        localStorage.setItem(ORIGIN_KEY, JSON.stringify(m));
    } catch { /* ignore */ }
}

/** The index a catalog came from, or null if nobody recorded one. Null is a real answer —
 *  "added by hand" — not a missing value to paper over. */
export function originOf(catalogUrl: string): string | null {
    return readOrigins()[catalogUrl] || null;
}

/** Just the host, for a compact label. Falls back to the whole string rather than to a
 *  blank: an unparseable origin is still information. */
export function originLabel(indexUrl: string): string {
    try { return new URL(indexUrl).host; } catch { return indexUrl; }
}

export const ROUTABLE = INDEX_TYPES.filter((t) => t === 'app' || !!STORE_KEY[t]);

/**
 * Is this URL already in that list?
 *
 * One function because it is asked TWICE — once by the preview, to say "already there", and
 * once by the writer, to decide whether to append. Written out separately they disagreed: the
 * preview lowercased and the writer used `Array.includes`, so a URL differing only in case was
 * announced as already-followed and then added again, and the list grew a duplicate that is
 * fetched on every start and visible nowhere.
 *
 * Host-insensitive by lowercasing the whole string rather than parsing: a path IS case
 * sensitive on most servers, but two entries differing only in the case of a path are a typo
 * far more often than two distinct catalogs, and following one twice is the worse outcome.
 */
export const hasSource = (list: string[], url: string): boolean =>
    list.some((u) => String(u).toLowerCase() === String(url).toLowerCase());

/**
 * Append a source unless it is already there. Returns whether the list changed, so a caller
 * can report what it actually did rather than what it was asked to do.
 */
export function addSource(list: string[], url: string): boolean {
    if (hasSource(list, url)) return false;
    list.push(url);
    return true;
}

/**
 * Work out what importing an index would change, without changing anything.
 *
 * Separated from applying so the caller can show "3 new, 2 already there" before doing it
 * — and so this can be tested without a browser. `existing` is what each store already
 * holds, keyed by type: a type MISSING from it reads as "follows nothing", so a caller that
 * forgets a type reports everything it already has as new.
 */
export function planImport(
    index: CatalogIndex,
    existing: Record<string, string[]>,
): { add: IndexEntry[]; already: IndexEntry[] } {
    const add: IndexEntry[] = [];
    const already: IndexEntry[] = [];
    for (const e of index.catalogs) {
        (hasSource(existing[e.type] || [], e.url) ? already : add).push(e);
    }
    return { add, already };
}
