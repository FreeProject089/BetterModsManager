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

import { safeFileStem as stem } from '../../core/catalog-publish.js';

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

/**
 * The row a preset catalogue lists an automation as, given the address decided for it.
 *
 * Deciding WHERE an entry lives, what filename it collapses to and how two entries that
 * collapse to one name are kept apart is core/catalog-publish.ts's job, and identical for
 * every kind of catalogue. What is left here — the only part that is about automations — is
 * the field names a preset feed uses, and they are pinned by tests because a wrong one is
 * invisible until somebody else follows the catalogue.
 *
 * The id comes from the ADDRESS when the file travels with the catalogue, because that
 * address already carries the deduplicated filename; a linked entry has no such filename, so
 * it falls back to its name.
 */
export function presetRow(task: CatalogTask, address: string): {
    id: string; name: string; description: string; version: string; download_url: string; tasks: number;
} {
    const bare = /^[^/\\]+$/.test(address) ? address.replace(/\.bmmpa$/i, '') : '';
    const id = bare || safeFileStem(task.name, 'automation');
    return {
        id,
        // The real name, even when the filename had to change: the reader shows this, and
        // "a-b" instead of "a/b: the good one" is a rename nobody asked for.
        name: task.name || id,
        description: task.description || '',
        version: '1.0',
        download_url: address,
        tasks: 1,
    };
}
