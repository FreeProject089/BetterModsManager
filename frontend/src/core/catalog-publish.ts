// Publishing a catalogue: one decision, per entry, for every kind of catalogue.
//
// Every builder in BMM had grown its own answer to the same question — where does this
// entry's file live? — and each answered it once, for the whole catalogue: the automation
// and tutorial builders wrote the files and put relative names in, optionally prefixed with
// one base address; the plugin builder did the opposite and made you type a URL for every
// row. Neither could do the thing people actually want, which is BOTH: pack the three small
// ones, link the 90 MB one.
//
// So the decision moves down to the entry, and up out of the builders into here.
//
//   **embed** — the file is written beside catalog.json and the entry names it, relatively.
//               The folder is self-contained, survives being moved, mirrored or forked, and
//               can be zipped into a bundle.
//   **link**  — the entry carries an http(s) URL and nothing is written for it.
//
// A catalogue is any mix of the two. That is the whole feature, and it is one boolean per
// row plus a string.
//
// Pure, importing nothing. The two things that go wrong here — the filename a name collapses
// to, and the address written for it — are only visible once somebody ELSE follows the
// catalogue, which is far too late to find out.

/** What a publisher chose for one entry. */
export type EntryChoice =
    | { mode: 'embed' }
    | { mode: 'link'; url: string };

/** Only what planning needs. Structural, so every builder can pass its own rows. */
export interface PublishItem {
    id: string;
    name?: string;
}

export interface PlannedRow<T extends PublishItem = PublishItem> {
    item: T;
    /** True when the file has to be written/exported beside the catalogue. */
    embed: boolean;
    /** The filename to write, without a directory. Empty for a linked entry. */
    file: string;
    /** What goes in the catalogue's `download_url` / `url` field. */
    address: string;
}

export interface PublishPlan<T extends PublishItem = PublishItem> {
    rows: PlannedRow<T>[];
    /** One sentence per entry that cannot be published, naming it. Never a count. */
    errors: string[];
    embedded: number;
    linked: number;
}

/**
 * A name, turned into something safe to be a filename.
 *
 * Anything a filesystem treats specially has to go — the path separators above all, or an
 * entry called `a/b` writes into a directory instead of beside its catalogue. Leading dots
 * go too: `.hidden.bmmpa` is a file the person who exported it will not find again.
 */
/*
 * Deliberately character-for-character: `why? *this*` becomes `why---this`, not `why-this`.
 * Collapsing the runs reads better and renames files that are already named in published
 * catalogues, and a renamed file is a dead entry in every catalog.json pointing at the old
 * one. tests/task-catalog.test.mjs pins the exact output.
 */
export function safeFileStem(name: unknown, fallback = 'entry'): string {
    return String(name || fallback)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, '-')
        .replace(/^[.\s-]+|[.\s-]+$/g, '').slice(0, 60) || fallback;
}

/**
 * Turn a set of items and one choice each into what to write and what to list.
 *
 * `base` is the odd one out and deserves its own sentence. It prefixes the address of an
 * EMBEDDED entry, for the case where the files really will be uploaded somewhere other than
 * beside the catalogue. Empty is right almost always: a relative name is resolved by the
 * reader against wherever it fetched the catalogue from, so the folder keeps working when it
 * is moved, mirrored or forked — and being forked is the normal life of a folder on GitHub.
 * A base does not touch a LINKED entry: that entry already said where it lives.
 *
 * Filenames are deduplicated on the STEM, not the name, because `a/b` and `a b` are two
 * names and one file — and the second silently overwriting the first is a catalogue that
 * serves the wrong content under the right name.
 */
export function planPublish<T extends PublishItem>(
    items: T[],
    choose: (item: T) => EntryChoice,
    opts: {
        ext: string;
        base?: string;
        fallback?: string;
        /**
         * What to name the file after. Defaults to the entry's name, then its id.
         *
         * A caller overrides it when its ids are opaque: an unnamed automation named after
         * `t-lq3k2j` is a worse filename than one named `automation`, and the builders that
         * came before this module deliberately never looked at the id.
         */
        nameOf?: (item: T) => string;
    },
): PublishPlan<T> {
    const ext = opts.ext.replace(/^\./, '');
    const base = String(opts.base || '').replace(/\/+$/, '');
    const used = new Set<string>();
    const rows: PlannedRow<T>[] = [];
    const errors: string[] = [];

    for (const item of items) {
        const label = String(item.name || item.id || '(unnamed)');
        const choice = choose(item);

        if (choice.mode === 'link') {
            const url = String(choice.url || '').trim();
            // Named, and refused. A catalogue that quietly dropped the entry publishes a
            // shorter list than the one on screen; one that kept an unusable address
            // publishes a row nobody can follow.
            if (!url) {
                errors.push(`${label} — set to link, but no address given`);
                continue;
            }
            if (!/^https?:\/\//i.test(url)) {
                errors.push(`${label} — "${url.slice(0, 60)}" is not an http(s) address`);
                continue;
            }
            rows.push({ item, embed: false, file: '', address: url });
            continue;
        }

        // The fallback word is the CALLER's: an unnamed automation listed as "entry" is
        // worse than one listed as "automation", and only the builder knows which noun its
        // catalogue is full of.
        const basis = opts.nameOf ? opts.nameOf(item) : (item.name || item.id);
        let stem = safeFileStem(basis, opts.fallback || 'entry');
        if (used.has(stem.toLowerCase())) {
            let n = 2;
            while (used.has(`${stem}-${n}`.toLowerCase())) n++;
            stem = `${stem}-${n}`;
        }
        used.add(stem.toLowerCase());
        const file = `${stem}.${ext}`;
        rows.push({ item, embed: true, file, address: base ? `${base}/${file}` : file });
    }

    return {
        rows,
        errors,
        embedded: rows.filter((r) => r.embed).length,
        linked: rows.filter((r) => !r.embed).length,
    };
}

/**
 * Can this catalogue be packed into a single file?
 *
 * Only when something was embedded. A catalogue of nothing but links has no files to pack,
 * and a zip holding one catalog.json is not a bundle — it is a catalog.json somebody has to
 * unzip first. Said rather than silently produced.
 */
export function canBundle(plan: PublishPlan<PublishItem>): boolean {
    return plan.embedded > 0;
}
