// Publishing a catalogue of automations — the decisions, with nothing around them.
//
// BMM could READ a preset catalog and had no way to make one, so publishing meant writing
// catalog.json by hand and guessing the field names. This is the writing half.
//
// The two decisions it used to own itself — what filename a name collapses to, and what
// address is written for it — now live in core/catalog-publish.ts, because every other
// catalogue builder in BMM asks exactly the same two questions and each had grown its own
// answer. What is left here is the part that IS specific to automations: the shape of a
// preset feed's row.
//
// Still pure, and for the original reason: both of those are only visible once somebody
// ELSE follows the catalogue, which is far too late to find out.

import { planPublish, safeFileStem as stem, type EntryChoice } from '../../core/catalog-publish.js';

/**
 * The shared stem rule, with THIS catalogue's noun as the fallback.
 *
 * Re-exporting the shared function directly changed what an unnamed automation is called
 * from "automation" to "entry" — a silent downgrade in the one place a reader sees the
 * fallback at all. The rule is shared; the word is not.
 */
export const safeFileStem = (name: unknown, fallback = 'automation'): string => stem(name, fallback);

/** Only what naming a file needs. Structural so this module depends on nothing. */
export interface CatalogTask {
    id: string;
    name?: string;
    description?: string;
}

export interface PlannedEntry {
    /** The .bmmpa filename, without its extension. */
    stem: string;
    /** The filename to write beside the catalogue. Empty when the entry is a LINK. */
    file: string;
    /** False when the publisher gave an address instead of packing the file. */
    embed: boolean;
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
 * What the catalog will contain: one filename and one feed entry per automation.
 *
 * Addresses are RELATIVE when no base is given, and that is the default because a catalog
 * that names its own host stops working the moment it is moved, mirrored or forked — and
 * being forked is the normal life of a folder on GitHub. The reader resolves a relative name
 * against wherever it fetched the catalog from, so the folder is self-contained.
 */
export function planTaskCatalog<T extends CatalogTask>(
    tasks: T[],
    base = '',
    choose: (task: T) => EntryChoice = () => ({ mode: 'embed' }),
): (PlannedEntry & { task: T })[] {
    const plan = planPublish(tasks as any, choose as any, {
        ext: 'bmmpa', base, fallback: 'automation',
        // The NAME only, never the id — a task id is opaque, and a file called
        // `t-lq3k2j.bmmpa` in a published catalogue helps nobody. Two unnamed automations
        // become automation and automation-2, which is what this builder has always done.
        nameOf: (t: any) => String(t?.name || ''),
    });
    // Errors are the caller's to report — it knows which screen the entry is on. Dropping
    // them here silently would publish a shorter list than the one somebody is looking at.
    _lastErrors = plan.errors;
    return plan.rows.map((r) => {
        const task = r.item as unknown as T;
        const stem = r.file ? r.file.replace(/\.bmmpa$/i, '') : safeFileStem(task.name, 'automation');
        return {
            task,
            stem,
            // Empty when the entry is a LINK: there is no file to write for it.
            file: r.file,
            embed: r.embed,
            entry: {
                id: stem,
                name: task.name || stem,
                description: task.description || '',
                version: '1.0',
                download_url: r.address,
                tasks: 1,
            },
        };
    });
}

/** Why an entry did not make it, from the last plan. One sentence each, naming it. */
let _lastErrors: string[] = [];
export function lastPlanErrors(): string[] { return _lastErrors; }
