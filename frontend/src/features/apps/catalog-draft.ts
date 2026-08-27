// Reading an app catalogue back in, and saying what is wrong with one.
//
// Split out of apps-catalog.ts for the same reason sched-why.ts was split out of
// scheduler.ts: that module reaches `window` through its import chain, so nothing in it can
// be tested without a browser. These two functions are the parts worth pinning — the first
// decides whether a file somebody picked is even this screen's document, and the second is
// the only place three quiet ways of breaking a catalogue are named.
//
// No i18n import here on purpose (core/i18n reaches localStorage at import time). The caller
// passes a lookup; the fallbacks below are the English.

/** Whatever the Create screen is holding. Structurally the same as `CatalogDraft`. */
export interface DraftLike {
    name: string;
    description: string;
    partner_catalogs: string[];
    community_imports: string[];
    apps: any[];
}

/** `(key, fallback) => text`. The caller wires this to `t`. */
export type Say = (key: string, fallback: string) => string;

/**
 * Take a BMM-native catalogue document and return the draft it describes.
 *
 * Throws a translation KEY, never a sentence — the caller is in a screen and knows the
 * reader's language; this does not.
 */
export function draftFromCatalog(json: any): DraftLike {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error('apps.create.errNotJson');
    }
    // `apps` missing is the interesting case rather than an empty result: it is what a
    // PLUGIN or THEME catalogue looks like, which is a real document and simply not this
    // screen's. Reading it as "an app catalogue with no apps" would say "your file is
    // empty", which is a different problem with a different fix.
    if (!Array.isArray(json.apps)) {
        throw new Error('apps.create.errNoApps');
    }
    return {
        name: String(json.name || ''),
        description: String(json.description || ''),
        partner_catalogs: Array.isArray(json.partner_catalogs) ? json.partner_catalogs : [],
        community_imports: Array.isArray(json.community_imports) ? json.community_imports : [],
        apps: json.apps,
    };
}

/**
 * What is wrong with a draft, as sentences.
 *
 * Reported, never blocking: it is the author's document, and a document with a problem in it
 * is still theirs to publish.
 *
 * The three checked are the ones that PARSE and then behave badly elsewhere. A duplicate id
 * makes two entries fight over one install record. An entry with no download URL is dropped
 * silently by every feed builder that reads a catalogue — BCWEB's filters on `download.url`
 * and says nothing — so the entry is simply not there and no one is told why.
 */
export function draftProblems(draft: DraftLike, say: Say): string[] {
    const out: string[] = [];
    const seen = new Map<string, number>();
    for (const a of draft.apps || []) {
        const id = String(a?.id || '').trim();
        if (!id) {
            // Counted per entry rather than folded into one line: two entries with no id are
            // two things to fix, not one duplicate of "".
            out.push(say('apps.create.pbNoId', 'An entry has no id.'));
            continue;
        }
        seen.set(id, (seen.get(id) || 0) + 1);
        if (!String(a?.download?.url || '').trim()) {
            out.push(say('apps.create.pbNoUrl', '{id}: no download URL — every reader drops this entry silently.')
                .replace('{id}', id));
        }
        if (!String(a?.title || '').trim()) {
            out.push(say('apps.create.pbNoTitle', '{id}: no title.').replace('{id}', id));
        }
    }
    for (const [id, n] of seen) {
        if (n > 1) {
            out.push(say('apps.create.pbDupe', '{id} appears {n} times — two entries with one id fight over one install record.')
                .replace('{id}', id)
                .replace('{n}', String(n)));
        }
    }
    return out;
}
