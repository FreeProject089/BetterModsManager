// Catalogues of shared MOD LISTS.
//
// A `.mm` is the oldest shareable thing in BMM — a named set of mods with their addresses,
// exported from a profile and sent to somebody — and it was the only BMM document with no
// catalogue of its own. Plugins, themes, automations, tutorials and modpacks all had a way
// to publish a set of them and follow somebody else's; mod lists were passed around one
// file at a time.
//
// **It differs from the other builders in one way that shapes this file.** BMM keeps no
// library of mod lists: a `.mm` is written out of the current profile and then belongs to
// the filesystem. So the builder takes FILES the publisher picks rather than rows out of an
// internal store — everything else (embed or link per entry, the bundle, the addresses) is
// the same machinery every other catalogue uses.
//
// The parsing half is pure and takes its source as an argument, so it can be tested without
// a network and without the app around it.

import { invoke, pickFiles, pickFolder, saveFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
import { resolveEntryUrl } from '../../core/catalog-url.js';
import { bundleEntryKind, resolveBundleEntry } from '../../core/catalog-bundle.js';
import { planPublish, safeFileStem, type EntryChoice } from '../../core/catalog-publish.js';
import { fetchSourceText } from '../../core/source-fetch.js';

/** One row of a mod-list catalogue, after sanitising. */
export interface ListEntry {
    id: string;
    name: string;
    description: string;
    author: string;
    /** How many mods it holds, when the publisher said. Undefined is "not stated". */
    mods?: number;
    /** Where the `.mm` is: an http(s) URL, or a path inside an extracted bundle. */
    downloadUrl: string;
    /** True when `downloadUrl` is a file BMM extracted itself. */
    local?: boolean;
    source?: string;
}

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Does this document claim to be a catalogue of mod lists? */
export function looksLikeListFeed(doc: unknown): boolean {
    return !!doc && typeof doc === 'object' && Array.isArray((doc as Record<string, unknown>).lists);
}

/**
 * Parse a mod-list catalogue.
 *
 * Returns what it could use AND why it dropped the rest — never a bare list, because
 * "3 of 20 loaded" is something the reader has to be told rather than left to notice.
 *
 * @param bundleDir when the catalogue came out of a bundle, the folder it was extracted
 *                  into. Entries naming a file then resolve inside it, through the same
 *                  guard every other catalogue uses.
 */
export function parseListFeed(raw: unknown, source = '', bundleDir = ''): { lists: ListEntry[]; dropped: string[] } {
    const dropped: string[] = [];
    const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    const rows = Array.isArray(doc.lists) ? doc.lists : [];
    const seen = new Set<string>();
    const lists: ListEntry[] = [];

    for (const e of rows) {
        if (!e || typeof e !== 'object') { dropped.push('not an object'); continue; }
        const addr = str(e.download_url ?? e.downloadUrl ?? e.url, 600);
        const id = str(e.id ?? e.slug, 120);
        const name = str(e.name ?? e.title, 200) || id;
        // A bundle may still point outward, per entry: the small lists travel with it, one
        // that lives on a CDN stays there.
        const inBundle = !!bundleDir && bundleEntryKind(addr) === 'inside';
        const url = inBundle ? resolveBundleEntry(addr, bundleDir) : resolveEntryUrl(addr, source);
        if (!url) { dropped.push(`${name || id || '(unnamed)'} — no usable address`); continue; }
        if (!id) { dropped.push(`${name || '(unnamed)'} — no id`); continue; }
        if (seen.has(id.toLowerCase())) { dropped.push(`${name} — listed twice`); continue; }
        seen.add(id.toLowerCase());
        lists.push({
            id,
            name,
            description: str(e.description, 1000),
            author: str(e.author, 120),
            // Only when it is a real count: a publisher who said nothing has not said zero.
            mods: Number.isFinite(e.mods) && e.mods >= 0 ? Number(e.mods) : undefined,
            downloadUrl: url,
            ...(inBundle ? { local: true } : {}),
            ...(source ? { source } : {}),
        });
    }
    return { lists, dropped };
}

const STORE = 'bmm_list_catalogs';

export function readListCatalogs(): string[] {
    try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
}
export function writeListCatalogs(v: string[]): void {
    try { localStorage.setItem(STORE, JSON.stringify([...new Set(v)])); } catch { /* preference only */ }
}

/** Fetch one source, whatever kind of address it is. */
async function loadOne(src: string): Promise<{ lists: ListEntry[]; dropped: string[] }> {
    if (src.startsWith('bundle:')) {
        const res: any = await invoke('catalog_bundle_open', { path: src.slice('bundle:'.length) });
        return parseListFeed(JSON.parse(String(res?.catalog || '')), src, String(res?.dir || ''));
    }
    return parseListFeed(JSON.parse(await fetchSourceText(src, true)), src);
}

/**
 * The mod-list catalogue, as a descriptor for the shared screen.
 *
 * Following, creating, protected sources, the bundle-or-file choice and the per-entry
 * pack-or-link decision are all in ui/catalog-modal.ts, because none of them is about mod
 * lists. What IS about mod lists is here: where the candidates come from, what a row says,
 * and what a document entry looks like.
 *
 * The candidates are FILES the publisher picks, and that is the one way this kind differs
 * from every other: BMM keeps no library of mod lists. A `.mm` is written out of a profile
 * and then belongs to the filesystem.
 */
interface PickedList {
    id: string;
    name: string;
    description: string;
    author: string;
    mods: number;
    /** The bytes as they were read — see writeEntry. */
    content: string;
}

async function pickLists(): Promise<PickedList[]> {
    const paths = await pickFiles([{ name: t('mm.cat.kind'), extensions: ['mm', 'json'] }]).catch(() => null);
    if (!paths?.length) return [];
    const out: PickedList[] = [];
    const unreadable: string[] = [];
    for (const p of paths) {
        const base = String(p).replace(/^.*[/\\]/, '');
        try {
            const text = await invoke('read_file_text', { path: p }) as string;
            const doc = JSON.parse(text);
            // The shape a .mm has, checked rather than assumed: picking the wrong file in a
            // folder full of JSON is the normal mistake, and publishing it would produce an
            // entry that installs nothing.
            if (!doc || typeof doc !== 'object' || !Array.isArray(doc.mods)) { unreadable.push(base); continue; }
            out.push({
                id: safeFileStem(doc.name || base.replace(/\.[^.]+$/, ''), 'list').toLowerCase(),
                name: String(doc.name || base.replace(/\.[^.]+$/, '')),
                description: String(doc.description || ''),
                author: String(doc.author || ''),
                mods: doc.mods.length,
                content: text,
            });
        } catch { unreadable.push(base); }
    }
    if (unreadable.length) {
        toast(t('mm.cat.notLists').replace('{list}', unreadable.slice(0, 4).join(', ')), 'warning', 7000);
    }
    return out;
}

export async function openListCatalog(onImported?: (doc: unknown) => void): Promise<void> {
    const { openCatalogModal } = await import('../../ui/catalog-modal.js');
    // Kept beside the browse tab rather than threaded through it: a BrowseEntry says what a
    // row LOOKS like, and where the file lives is this kind's business, not the screen's.
    let offered: ListEntry[] = [];
    await openCatalogModal<PickedList>({
        id: 'list',
        title: t('mm.cat.browseTitle'),
        subtitle: t('mm.cat.sub'),
        storeKey: STORE,
        feedField: 'lists',
        ext: 'mm',
        fallbackNoun: 'list',
        candidates: pickLists,
        // BMM keeps no library of mod lists, so the create tab IS a file picker — and one
        // that can only be answered once is a screen you have to reopen to fix a mistake.
        addMoreLabel: t('mm.cat.addFiles'),
        label: (x) => ({ name: x.name, sub: `${x.mods} ${t('modpack.cat.mods')}` }),
        entryId: (x) => x.id,
        // The BYTES that were read, not a re-serialisation: a .mm may carry a signature over
        // its own text, and re-encoding it would break that while leaving a file that still
        // parses.
        writeEntry: async (x, dir, file) => {
            const sep = dir.includes('\\') ? '\\' : '/';
            await invoke('write_text_file', { path: `${dir}${sep}${file}`, content: x.content });
            return true;
        },
        row: (x, address) => ({
            id: x.id, name: x.name, description: x.description, author: x.author,
            mods: x.mods, download_url: address,
        }),
        looksLike: looksLikeListFeed,
        browse: {
            action: t('mm.import'),
            load: async () => {
                const r = await loadFollowedLists();
                offered = r.lists;
                return {
                    entries: r.lists.map((l) => ({
                        id: l.id,
                        name: l.name,
                        sub: l.description || l.author,
                        note: l.mods === undefined ? undefined : `${l.mods} ${t('modpack.cat.mods')}`,
                    })),
                    problems: r.problems,
                };
            },
            // Read, then shown in the same preview an imported .mm gets. Nothing is applied
            // to a profile here: a catalogue offers lists, and choosing one is choosing to
            // LOOK at it.
            pick: async (e) => {
                const l = offered.find((x) => x.id === e.id);
                if (!l) return;
                const text = l.local
                    ? await invoke('read_file_text', { path: l.downloadUrl }) as string
                    : await fetchSourceText(l.downloadUrl, true);
                let doc = JSON.parse(text);

                // A LOCKED list, asked for every time.
                //
                // Nothing about the phrase is remembered — not for the session, not per
                // source. A catalogue is a list of addresses somebody else controls, and a
                // remembered phrase would mean a list swapped at that address opens with a
                // secret its new author never had.
                if (doc?.bmm_locked) {
                    const { promptRepoPassword } = await import('../repo/repo-sync.js');
                    const pass = await promptRepoPassword();
                    if (pass == null) return;
                    const opened = await invoke('open_locked_modlist', { text, passphrase: pass })
                        .catch(() => null) as string | null;
                    if (!opened) { toast(t('bmm.enc.errWrongPass'), 'error', 7000); return; }
                    doc = JSON.parse(opened);
                }
                if (!doc || !Array.isArray(doc.mods)) { toast(t('mm.cat.notAList'), 'error'); return; }
                if (onImported) onImported(doc);
                else (await import('./modlist.js')).renderImportedModlist(doc);
                return true;
            },
        },
        onChange: () => { void onImported; },
    });
}

/** Everything the followed catalogues hold, for a screen that wants to show them. */
export async function loadFollowedLists(): Promise<{ lists: ListEntry[]; problems: string[] }> {
    const lists: ListEntry[] = [];
    const problems: string[] = [];
    for (const src of readListCatalogs()) {
        try {
            const r = await loadOne(src);
            lists.push(...r.lists);
            problems.push(...r.dropped);
        } catch (e) {
            // Kept ON the source rather than pooled: when one server is down, which one is
            // the useful thing to know.
            problems.push(`${src} — ${String(e).slice(0, 80)}`);
        }
    }
    return { lists, problems };
}
