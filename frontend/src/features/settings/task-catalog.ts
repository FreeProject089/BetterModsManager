// Publishing a catalog of automations — the decisions, with nothing around them.
//
// BMM could READ a preset catalog and had no way to make one, so publishing meant writing
// catalog.json by hand and guessing the field names. This is the writing half.
//
// Pure on purpose, and for the same reason preset-catalog.ts is: the two things that can be
// wrong here — the filename a task name collapses to, and the address written for it — are
// only visible once somebody ELSE follows the catalog, which is far too late to find out.
// Testing them requires no disk, no network and no browser; the module that writes the files
// imports these and does nothing else clever.

/** Only what naming a file needs. Structural so this module depends on nothing. */
export interface CatalogTask {
    id: string;
    name?: string;
    description?: string;
}

export interface PlannedEntry {
    /** The .bmmpa filename, without its extension. */
    stem: string;
    /** The row written into catalog.json, in the feed's own field names. */
    entry: {
        id: string;
        name: string;
        description: string;
        version: string;
        download_url: string;
        tasks: number;
    };
}

/**
 * A task name, turned into something safe to be a filename.
 *
 * Anything a filesystem treats specially has to go — the path separators above all, or a
 * task called `a/b` writes into a directory instead of beside its catalog. Leading dots go
 * too: `.hidden.bmmpa` is a file the person who exported it will not find again.
 */
export function safeFileStem(name: unknown, fallback = 'automation'): string {
    return String(name || fallback)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, '-')
        .replace(/^[.\s-]+|[.\s-]+$/g, '').slice(0, 60) || fallback;
}

/**
 * What the catalog will contain: one filename and one feed entry per automation.
 *
 * Addresses are RELATIVE when no base is given, and that is the default because a catalog
 * that names its own host stops working the moment it is moved, mirrored or forked — and
 * being forked is the normal life of a folder on GitHub. The reader resolves a relative name
 * against wherever it fetched the catalog from, so the folder is self-contained.
 */
export function planTaskCatalog<T extends CatalogTask>(tasks: T[], base = ''): (PlannedEntry & { task: T })[] {
    const used = new Set<string>();
    const clean = base.replace(/\/+$/, '');
    return tasks.map((task) => {
        // Unique per catalog. Two automations called "Nightly" collapse to the same stem, and
        // without this the second overwrites the first while the catalog still lists both —
        // so one entry silently serves the other's contents. That reads as the wrong
        // automation being published rather than as a name clash, which is why it must not
        // be allowed to happen quietly.
        let stem = safeFileStem(task.name);
        if (used.has(stem)) {
            let n = 2;
            while (used.has(`${stem}-${n}`)) n += 1;
            stem = `${stem}-${n}`;
        }
        used.add(stem);
        return {
            task,
            stem,
            entry: {
                id: stem,
                name: task.name || stem,
                description: task.description || '',
                version: '1.0',
                download_url: clean ? `${clean}/${stem}.bmmpa` : `${stem}.bmmpa`,
                tasks: 1,
            },
        };
    });
}
