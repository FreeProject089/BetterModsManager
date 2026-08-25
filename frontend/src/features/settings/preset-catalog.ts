// Reading a preset catalog — a published list of shareable automations.
//
// The feed shape is BCWEB's `catalog.json?kind=PRESET`: `{ version, name, presets: [...] }`
// where each entry points at a `.bmmpa` rather than describing its tasks. That indirection
// is deliberate on both sides: the .bmmpa is the file BMM already exports and imports, so
// a client that reconstructed tasks from feed JSON would be a second parser to keep in step
// with the first.
//
// Pure: parsing only. Fetching, downloading and importing are the caller's, so this can be
// tested without a network and cannot accidentally do any of them.

export interface PresetEntry {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    /** Where the .bmmpa lives. http(s) only — see below. */
    downloadUrl: string;
    tags: string[];
    /** How many automations are inside, when the publisher said. Undefined is "not stated",
     *  which is different from zero and must not be shown as it. */
    tasks?: number;
    /** The catalog this came from, so a list of many can say where each one is from. */
    source?: string;
}

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Parse a preset feed. Returns the entries it could use and the reasons it dropped the
 * rest — never a bare list, because "3 of 20 loaded" is something the user needs told.
 *
 * A catalog is a document from whichever server somebody pasted, so every field is
 * untrusted:
 *
 *  - http(s) only, checked AFTER resolving, never before. A relative name resolves against
 *    the catalog's own address; an absolute one with a scheme wins over the base, so
 *    `javascript:…` survives resolution untouched and only a check on the RESULT catches
 *    it. Handing that to a fetcher is the obvious attack, and "it would probably fail" is
 *    not a reason to pass it on.
 *  - A relative name is allowed, and is the point: a folder of .bmmpa files with a
 *    catalog.json beside them, dropped on GitHub Pages or into a repo, works with no
 *    address written in it anywhere — so it keeps working when it is moved or forked.
 *  - An entry with no download_url is dropped rather than shown as an un-installable row.
 *    A row you cannot act on is a row that makes the list look broken.
 *  - Duplicate ids collapse, first wins, so a catalog listing something twice does not
 *    offer it twice.
 */
/**
 * An entry's address, resolved against the catalog it came from.
 *
 * Returns '' for anything that must not be fetched, so the caller has one thing to test.
 *
 * The ORDER is the security property. Resolution is not a narrowing operation: `new URL`
 * gives an absolute URL its own scheme regardless of the base, so `javascript:…` comes out
 * of it unchanged. Checking the input and trusting the output would therefore let exactly
 * the thing this guards against straight through — the check is on the result.
 */
export function resolveEntryUrl(raw: string, source: string): string {
    const v = String(raw || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    // Relative, and only meaningful against an http(s) catalog. A catalog read from a local
    // file has no base to resolve against, and inventing one would turn a relative name into
    // a path on the user's disk.
    if (!/^https?:\/\//i.test(source)) return '';
    try {
        const out = new URL(v, source).toString();
        return /^https?:\/\//i.test(out) ? out : '';
    } catch { return ''; }
}

export function parsePresetFeed(raw: unknown, source = ''): { presets: PresetEntry[]; dropped: string[] } {
    const dropped: string[] = [];
    const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    const list = Array.isArray(doc.presets) ? doc.presets : [];
    const seen = new Set<string>();
    const presets: PresetEntry[] = [];

    for (const e of list) {
        if (!e || typeof e !== 'object') { dropped.push('not an object'); continue; }
        const raw = str(e.download_url ?? e.downloadUrl, 600);
        const id = str(e.id ?? e.slug, 120);
        const name = str(e.name ?? e.title, 200) || id;
        const url = resolveEntryUrl(raw, source);
        if (!url) {
            dropped.push(`${name || id || '(unnamed)'} — no usable download address`);
            continue;
        }
        if (!id) { dropped.push(`${name || '(unnamed)'} — no id`); continue; }
        if (seen.has(id.toLowerCase())) { dropped.push(`${name} — listed twice`); continue; }
        seen.add(id.toLowerCase());
        presets.push({
            id,
            name,
            description: str(e.description, 1000),
            author: str(e.author, 120),
            version: str(e.version, 40),
            downloadUrl: url,
            tags: Array.isArray(e.tags) ? e.tags.filter((x: unknown) => typeof x === 'string').slice(0, 8) : [],
            // Only when it is a real count. A publisher who said nothing has not said zero.
            tasks: Number.isFinite(e.tasks) && e.tasks >= 0 ? Number(e.tasks) : undefined,
            ...(source ? { source } : {}),
        });
    }
    return { presets, dropped };
}

/** Is this document a preset catalog at all?
 *
 *  Used to tell a wrong-kind paste from an empty one: "this is a plugin catalog" and
 *  "this catalog has no presets yet" are different things to be told, and reporting the
 *  first as the second sends somebody looking for a problem that is not there. */
export function looksLikePresetFeed(doc: unknown): boolean {
    return !!doc && typeof doc === 'object' && Array.isArray((doc as Record<string, any>).presets);
}

/** Preset catalogs the user follows. Same storage the catalog index writes to, so one
 *  pulled in by an index and one added by hand end up in a single list. */
const KEY = 'bmm_preset_catalogs';

export function readPresetCatalogs(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [];
    } catch { return []; }
}

export function writePresetCatalogs(urls: string[]): void {
    try { localStorage.setItem(KEY, JSON.stringify([...new Set(urls)])); } catch { /* ignore */ }
}
