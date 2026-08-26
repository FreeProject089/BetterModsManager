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
/** Types BMM can actually route. An entry naming anything else is dropped, not guessed. */
// `repo` and `preset` were missing while the feed already published both, so a perfectly
// good index entry was thrown away by the reader — and that failure looks like the server
// not sending it, which is the wrong place to go looking. Keep this in step with what the
// index can emit; a type accepted here with nowhere to route it is lost by the caller,
// which is worse than refusing it.
export const INDEX_TYPES = ['app', 'plugin', 'theme', 'preset', 'modpack', 'repo', 'tutorial', 'list'];
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
export function looksLikeIndex(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc))
        return false;
    const d = doc;
    // An explicit self-declaration is enough on its own — BCWEB sends kind: 'catalog-index'
    // — but is NOT required, so a hand-written index still works.
    if (String(d.kind || '').toLowerCase() === 'catalog-index' && Array.isArray(d.catalogs))
        return true;
    if (!Array.isArray(d.catalogs) || d.catalogs.length === 0)
        return false;
    // A catalog feed never carries a top-level `catalogs` array of {url,type} objects; those
    // carry apps/plugins/themes/presets instead. Requiring BOTH fields keeps a document that
    // happens to list catalog NAMES from being mistaken for one that lists their addresses.
    return d.catalogs.every((e) => e && typeof e === 'object'
        && typeof e.url === 'string' && typeof e.type === 'string');
}
export function parseCatalogIndex(raw, forApp = 'bmm') {
    const dropped = [];
    const doc = (raw && typeof raw === 'object' ? raw : {});
    const list = Array.isArray(doc.catalogs) ? doc.catalogs : [];
    const seen = new Set();
    const catalogs = [];
    for (const e of list) {
        if (!e || typeof e !== 'object') {
            dropped.push('not an object');
            continue;
        }
        const type = String(e.type || '').trim().toLowerCase();
        const url = String(e.url || '').trim();
        if (!INDEX_TYPES.includes(type)) {
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
        if (seen.has(key)) {
            dropped.push(`${url} — listed twice`);
            continue;
        }
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
/**
 * Is this parsed document a catalogue of the asked-for kind?
 *
 * Shape, never the address: a file called catalog.json can be anything, and catching exactly
 * that is the point. Each kind is recognised by the array ITS OWN READER looks for, so a
 * document this calls a plugin catalogue is one the plugin browser will actually read — the
 * alternative is a second opinion about what a catalogue is, and two opinions drift.
 *
 * `index` defers to looksLikeIndex rather than repeating its rule.
 */
export const CATALOG_SHAPES = {
    app: (d) => Array.isArray(d?.apps),
    plugin: (d) => Array.isArray(d?.plugins),
    theme: (d) => Array.isArray(d) || Array.isArray(d?.themes),
    preset: (d) => Array.isArray(d?.presets) || Array.isArray(d?.tasks),
    modpack: (d) => Array.isArray(d?.modpacks),
    repo: (d) => Array.isArray(d?.repos),
    index: (d) => looksLikeIndex(d),
};
export function catalogLooksLike(doc, kind) {
    if (kind === 'any')
        return Object.values(CATALOG_SHAPES).some((f) => f(doc));
    const f = CATALOG_SHAPES[kind];
    // An unknown kind is not "anything goes" — it is a question the editor should not have
    // been able to ask, and answering true would hide that.
    return f ? f(doc) : false;
}
/**
 * Follow the entries of ONE type out of an index.
 *
 * Every catalogue browser takes an address, and somebody handed an index URL pastes it into
 * whichever box is in front of them — they all take a URL and none of them says which document
 * it wants. Refusing with "add it under Settings" was correct and unhelpful: the panel knows
 * which type it is, the index says which entries are that type, and the import is the same
 * three writes it already does by hand.
 *
 * Only its own type. An index lists catalogues for five of them, and a plugin browser quietly
 * following theme catalogues would be a bigger action than the one that was asked for.
 *
 * `addApp` exists because app sources live in the Rust backend rather than localStorage; every
 * other type is written here. Passing it is how a caller says "I am the app browser".
 */
export async function importIndexForType(doc, type, indexUrl, addApp) {
    const { index } = parseCatalogIndex(doc);
    const mine = index.catalogs.filter((e) => e.type === type);
    let added = 0;
    let already = 0;
    for (const e of mine) {
        try {
            if (type === 'app') {
                if (!addApp)
                    continue;
                await addApp(e.url);
            }
            else {
                const key = STORE_KEY[type];
                if (!key)
                    continue;
                const list = readSources(key);
                if (!addSource(list, e.url)) {
                    already += 1;
                    continue;
                }
                localStorage.setItem(key, JSON.stringify(list));
            }
            // Recorded only after the add succeeded, so a source that failed does not get an
            // origin pointing at an index it never came from.
            rememberOrigin(e.url, indexUrl);
            recordHistory({ action: 'add', type, url: e.url, via: indexUrl });
            added += 1;
        }
        catch { /* one bad entry must not abandon the rest of the index */ }
    }
    // What the index DOES hold, by type. "No plugin catalogues here" is a dead end; "no
    // plugin catalogues — it holds 1 app catalogue" is the next step, and it is the difference
    // between somebody thinking the import is broken and somebody opening the right screen.
    const kinds = {};
    for (const e of index.catalogs)
        kinds[e.type] = (kinds[e.type] || 0) + 1;
    return { added, already, ofType: mine.length, total: index.catalogs.length, kinds };
}
/** "1 app catalogue and 2 theme catalogues" — the types an index holds, in the reader's
 *  words. Sorted by count so the biggest thing in it is named first. */
export function describeKinds(kinds) {
    const NAME = {
        app: ['app catalogue', 'app catalogues'],
        plugin: ['plugin catalogue', 'plugin catalogues'],
        theme: ['theme catalogue', 'theme catalogues'],
        preset: ['preset catalogue', 'preset catalogues'],
        modpack: ['modpack catalogue', 'modpack catalogues'],
        repo: ['repo catalogue', 'repo catalogues'],
    };
    return Object.entries(kinds)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${(NAME[k] || [k, `${k}s`])[n > 1 ? 1 : 0]}`)
        .join(', ');
}
const readSources = (key) => {
    try {
        const v = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    }
    catch {
        return [];
    }
};
/** Where each type's community sources are kept. Not a new store — these are the two the
 *  deeplink handler already writes to, so a catalog added by either route lands in one
 *  place and shows up in the same list. */
export const STORE_KEY = {
    plugin: 'bmm_plugin_catalogs',
    theme: 'bmm_theme_community_sources',
    // New stores, following the existing naming rather than inventing a scheme. `app` is
    // absent on purpose: app sources live in the Rust backend behind add_community_source,
    // and the caller special-cases it.
    preset: 'bmm_preset_catalogs',
    modpack: 'bmm_modpack_catalogs',
    repo: 'bmm_repo_catalogs',
    // The tutorial catalogue client reads this exact key (ui/tutorial-catalog.ts), so an
    // index can now deliver one. A type accepted by the parser with nowhere to put it is
    // dropped by the caller and looks like the server never sent it — which is what the
    // check below exists to prevent.
    tutorial: 'bmm.tutorialCatalogs',
    // Catalogues of shared MOD LISTS — the .mm files people already export and send
    // each other. They were the one BMM document with no catalogue of its own.
    list: 'bmm_list_catalogs',
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
export function readOrigins() {
    try {
        const v = JSON.parse(localStorage.getItem(ORIGIN_KEY) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }
    catch {
        return {};
    }
}
/** Record that `catalogUrl` arrived via `indexUrl`. */
export function rememberOrigin(catalogUrl, indexUrl) {
    if (!catalogUrl || !indexUrl)
        return;
    try {
        const m = readOrigins();
        m[catalogUrl] = indexUrl;
        localStorage.setItem(ORIGIN_KEY, JSON.stringify(m));
    }
    catch { /* ignore */ }
}
/** The index a catalog came from, or null if nobody recorded one. Null is a real answer —
 *  "added by hand" — not a missing value to paper over. */
export function originOf(catalogUrl) {
    return readOrigins()[catalogUrl] || null;
}
/** Just the host, for a compact label. Falls back to the whole string rather than to a
 *  blank: an unparseable origin is still information. */
export function originLabel(indexUrl) {
    try {
        return new URL(indexUrl).host;
    }
    catch {
        return indexUrl;
    }
}
/**
 * A catalogue's own name for a chip: the host, plus whatever distinguishes it from the others
 * on the same host.
 *
 * `originLabel` answers "where did this come from" and the host alone is the right answer for
 * that. It is the wrong answer for a LIST of catalogues: four feeds from one server all read
 * `localhost`, the full address lives in a tooltip nobody hovers, and the strip becomes four
 * identical chips. The distinguishing part is usually the file, or the query that selects a
 * kind — so both are kept, and nothing else is.
 */
export function catalogLabel(url) {
    let u;
    try {
        u = new URL(url);
    }
    catch {
        return url;
    }
    const file = u.pathname.split('/').filter(Boolean).pop() || '';
    // The query narrows a feed to one project or one kind; those two are what tell two
    // otherwise-identical addresses apart. Anything else is noise on a chip.
    const bits = [];
    for (const k of ['project', 'kind', 'app', 'type', 'scope']) {
        const v = u.searchParams.get(k);
        if (v)
            bits.push(v);
    }
    const tail = [file, bits.join('/')].filter(Boolean).join(' ');
    return tail ? `${u.host} · ${tail}` : u.host;
}
/** Forget where a source came from. Called when the source itself goes, so the map does not
 *  accumulate provenance for catalogs nobody follows any more. */
export function forgetOrigin(catalogUrl) {
    try {
        const m = readOrigins();
        if (!(catalogUrl in m))
            return;
        delete m[catalogUrl];
        localStorage.setItem(ORIGIN_KEY, JSON.stringify(m));
    }
    catch { /* ignore */ }
}
// ── Disabled sources ─────────────────────────────────────────────────────────
//
// "Follow this index, but not that one catalog in it."
//
// A SEPARATE set rather than a flag inside each source list, for the same reason origins are
// separate: those lists are plain arrays of URLs written by the deeplink handler, by five
// different settings panels, and for apps by the Rust backend. Changing their shape means
// every reader and writer agreeing at once, across a language boundary. This is additive —
// anything that does not know about it keeps working, and a URL that is not in here is
// enabled, which is the right default for every source that already exists.
//
// Disabling is not removing, and the difference is the point: a removed source is forgotten,
// a disabled one is remembered and not fetched. Removing the only copy of a URL you might
// want back is what makes people keep catalogs they do not want.
const DISABLED_KEY = 'bmm_catalog_disabled';
export function readDisabled() {
    try {
        const v = JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [];
    }
    catch {
        return [];
    }
}
/** Is this source turned off? Case-insensitive, like every other question asked of a URL here. */
export const isDisabled = (url) => hasSource(readDisabled(), url);
/** Turn a source off or on. Returns the new disabled list. */
export function setDisabled(url, off) {
    const next = readDisabled();
    if (off)
        addSource(next, url);
    else
        return write(removeSource(next, url).list);
    return write(next);
}
const write = (list) => {
    try {
        localStorage.setItem(DISABLED_KEY, JSON.stringify(list));
    }
    catch { /* ignore */ }
    return list;
};
/**
 * The sources a fetcher should actually fetch.
 *
 * Every catalogue fetcher calls this on its URL list, and that is the ONLY thing that makes a
 * disabled source disabled — the flag is inert until something honours it. Written once here
 * so five fetchers cannot each get the filter subtly wrong.
 */
export function enabledOnly(urls) {
    const off = readDisabled();
    if (!off.length)
        return urls; // the common case, and it must not build a Set for nothing
    const low = new Set(off.map((u) => u.toLowerCase()));
    return urls.filter((u) => !low.has(String(u).toLowerCase()));
}
// ── History ──────────────────────────────────────────────────────────────────
//
// What was followed and unfollowed, and when. It exists because the source lists are plain
// arrays with no dates: a catalog that appeared without you remembering adding it has no
// record anywhere, and neither does one you removed and now want back.
//
// Deliberately not a log of everything — only the two events that change what BMM fetches at
// startup, which is the only question this answers.
const HISTORY_KEY = 'bmm_catalog_history';
/** Kept small on purpose: this is a convenience, not an audit trail, and localStorage is a
 *  few megabytes shared with everything else the app stores. */
export const HISTORY_MAX = 200;
export function readHistory() {
    try {
        const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        if (!Array.isArray(v))
            return [];
        // Newest first, and anything malformed dropped rather than rendered as a blank row.
        return v.filter((e) => e && typeof e.url === 'string' && (e.action === 'add' || e.action === 'remove'));
    }
    catch {
        return [];
    }
}
/** Record one event. Newest first, capped. Returns the list it wrote, so a caller can render
 *  without reading back. */
export function recordHistory(entry) {
    const next = [{ ...entry, at: entry.at ?? Date.now() }, ...readHistory()].slice(0, HISTORY_MAX);
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    }
    catch { /* ignore */ }
    return next;
}
export function clearHistory() {
    try {
        localStorage.removeItem(HISTORY_KEY);
    }
    catch { /* ignore */ }
}
/**
 * Drop ONE line, by its position in the list `readHistory` returns.
 *
 * By index rather than by URL because the same catalog can appear many times — followed,
 * removed, followed again — and "drop this line" must not mean "forget everything about this
 * catalog". An out-of-range index is a no-op rather than a truncation: the list may have been
 * re-rendered since the button was drawn, and silently deleting the wrong row is worse than
 * doing nothing.
 */
export function forgetHistoryAt(i) {
    const cur = readHistory();
    if (!Number.isInteger(i) || i < 0 || i >= cur.length)
        return cur;
    cur.splice(i, 1);
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(cur));
    }
    catch { /* ignore */ }
    return cur;
}
/**
 * Remove a source from a list, case-insensitively.
 *
 * The mirror of addSource, and it has to match it: a list that accepted a URL as a duplicate
 * of an existing one must be able to remove it by the same name, or a source becomes
 * unremovable through the button that claims to remove it.
 *
 * Returns the new list and whether anything went, so the caller can skip the write and the
 * history entry when nothing changed.
 */
export function removeSource(list, url) {
    const low = String(url).toLowerCase();
    const kept = list.filter((u) => String(u).toLowerCase() !== low);
    return { list: kept, removed: kept.length !== list.length };
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
export const hasSource = (list, url) => list.some((u) => String(u).toLowerCase() === String(url).toLowerCase());
/**
 * Append a source unless it is already there. Returns whether the list changed, so a caller
 * can report what it actually did rather than what it was asked to do.
 */
export function addSource(list, url) {
    if (hasSource(list, url))
        return false;
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
export function planImport(index, existing) {
    const add = [];
    const already = [];
    for (const e of index.catalogs) {
        (hasSource(existing[e.type] || [], e.url) ? already : add).push(e);
    }
    return { add, already };
}
//# sourceMappingURL=catalog-index.js.map