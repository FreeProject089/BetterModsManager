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

/** One thing wrong with one entry. The `field` is what the editor should point at. */
export interface EntryProblem {
    /** i18n key, so a caller can decide how loud to be about each. */
    key: string;
    text: string;
    /** Which input in the editor fixes it, or '' when it is about the entry as a whole. */
    field: string;
}

/**
 * What is wrong with ONE entry, before it is saved.
 *
 * Its own function because the answer is needed in two places that used to disagree: the
 * create screen listed problems only AFTER an entry was saved and the modal listed none at
 * all, so the way to find out an entry was incomplete was to save it, close the editor and
 * read a list at the bottom of the page.
 *
 * Every check here is a thing that PARSES and then behaves badly elsewhere, never a matter
 * of taste. Nothing about tags, images or descriptions appears — those are the author's.
 */
export function entryProblems(app: any, say: Say): EntryProblem[] {
    const out: EntryProblem[] = [];
    const id = String(app?.id || '').trim();
    if (!id) {
        out.push({ key: 'apps.create.pbNoId', field: 'id', text: say('apps.create.pbNoId', 'An entry has no id.') });
    }
    if (!String(app?.title || '').trim()) {
        out.push({
            key: 'apps.create.pbNoTitle', field: 'title',
            text: say('apps.create.pbNoTitle', '{id}: no title.').replace('{id}', id || '?'),
        });
    }
    // A FILE is a source, and this used to say otherwise.
    //
    // Choosing "use a file instead" and leaving the address blank is the whole point of
    // that button — the file is packed in when the catalogue is published as one file, and
    // the URL is written at that moment. The screen reported it as "no download URL, every
    // reader drops this entry silently", which is alarming, wrong, and unfixable without
    // undoing the thing the author meant to do.
    const url = String(app?.download?.url || '').trim();
    const file = String(app?.src_file || '').trim();
    if (!url && !file) {
        out.push({
            key: 'apps.create.pbNoUrl', field: 'dl-url',
            text: say('apps.create.pbNoUrl', '{id}: no download URL — every reader drops this entry silently.')
                .replace('{id}', id || '?'),
        });
    } else if (!url && file) {
        // Not a problem, but a fact worth knowing before you hand somebody a catalog.json:
        // that document names no address for this entry, so only the one-file publish
        // carries it.
        out.push({
            key: 'apps.create.pbFileOnly', field: '',
            text: say('apps.create.pbFileOnly', '{id}: a file, no address — carried only by the one-file publish.')
                .replace('{id}', id || '?'),
        });
    }
    return out;
}

/**
 * What is wrong with a draft, as sentences.
 *
 * Reported, never blocking: it is the author's document, and a document with a problem in it
 * is still theirs to publish.
 *
 * Per-entry checks come from entryProblems, so this list and the editor's footer cannot
 * drift into disagreeing about whether an entry is finished. What is left here is the one
 * thing no single entry can see: a duplicate id, which makes two entries fight over one
 * install record.
 */
export function draftProblems(draft: DraftLike, say: Say): string[] {
    const out: string[] = [];
    const seen = new Map<string, number>();
    for (const a of draft.apps || []) {
        for (const p of entryProblems(a, say)) out.push(p.text);
        const id = String(a?.id || '').trim();
        if (id) seen.set(id, (seen.get(id) || 0) + 1);
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
