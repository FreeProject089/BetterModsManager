// Tutorial catalogues: follow a catalog.json, install .bmmtut files from it.
//
// SAME CONTRACT AS EVERY OTHER CATALOGUE IN BMM
//
// A source is a URL to a catalog.json whose entries carry `{ id, name, description?, url }`
// under `tutorials:[]` (or a generic `items:[]` with kind==='tutorial' — the shape BCWEB's
// pooled catalogues emit). Fetching goes through fetchSourceText so ssh:// sources work, and
// the protected-source fold is mounted here like everywhere: a download password and a
// signed identity key, per origin. Installing = fetching the .bmmtut and handing it to the
// same import path a file picker uses, signature verdict included.
//
// The followed list lives in localStorage under its own key — these are ADDRESSES, not
// secrets, the same storage decision every other catalogue screen already made.

import { t } from '../core/i18n.js';
import { invoke } from '../core/api.js';
import { toast } from './app.js';
import { fetchSourceText } from '../core/source-fetch.js';
import { importCustomTutorialText, signatureLabel } from './tutorial-custom.js';

const STORE = 'bmm.tutorialCatalogs';

interface CatalogEntry { id: string; name: string; description?: string; url: string }

function sources(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem(STORE) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch { return []; }
}

/** Entries out of one fetched catalogue document, tolerant of the two shapes in the wild. */
function entriesOf(doc: unknown): CatalogEntry[] {
    const d = doc as { tutorials?: unknown[]; items?: Array<{ kind?: string }> };
    const raw = Array.isArray(d?.tutorials)
        ? d.tutorials
        : Array.isArray(d?.items) ? d.items.filter((x) => String(x?.kind || '').toLowerCase() === 'tutorial') : [];
    return (raw as Array<Record<string, unknown>>)
        .map((x) => ({
            id: String(x.id || ''),
            name: String(x.name || x.id || ''),
            description: typeof x.description === 'string' ? x.description : '',
            url: String(x.url || (x.meta as Record<string, unknown> | undefined)?.download_url || ''),
        }))
        .filter((x) => x.id && x.url);
}


/**
 * Tutorial catalogues, on the screen every other kind of catalogue uses.
 *
 * This was two screens with two different ideas of the same thing: a browser that could
 * follow an address and nothing else, and a builder that could only write a FOLDER to a host
 * you had to arrange yourself. Neither could open a file somebody sent you, and the wording
 * they used for the same acts did not match the other five kinds.
 *
 * Both are ui/catalog-modal.ts now, so tutorials gained following by file, the single-file
 * bundle, and catalogue-index support without any of it being written here. What is left is
 * the part that is about tutorials.
 *
 * Two things it has to say for itself, both of which would be silent regressions:
 *
 *   · files are named after the ID, not the title. A tutorial id is already a slug and is
 *     what its entry has always been called, so naming files after titles would rename every
 *     file in every catalogue already published.
 *   · the document carries its entries TWICE — under `tutorials`, which this app prefers,
 *     and under `items` with a kind, which is what BCWEB's pooled catalogues emit. Write one
 *     and not the other and half the readers see an empty catalogue.
 */
export async function openTutorialCatalog(onInstalled: () => void): Promise<void> {
    const { openCatalogModal } = await import('./catalog-modal.js');
    const { listCustomDocs, getCustomDoc } = await import('./tutorial-custom.js');

    type Row = { id: string; name: string; desc: string };
    /** Where each browsed entry came from, so a relative address can be resolved. */
    let from = new Map<string, string>();

    await openCatalogModal<Row>({
        id: 'tut',
        title: t('tutcat.title'),
        subtitle: t('tutcat.desc'),
        storeKey: STORE,
        feedField: 'tutorials',
        ext: 'bmmtut',
        fallbackNoun: 'tutorial',
        indexType: 'tutorial',
        candidates: async () => listCustomDocs().map((d: any) => ({
            id: d.id, name: d.title?.en || d.id, desc: d.desc?.en || '',
        })),
        label: (r) => ({ name: r.name, sub: r.desc }),
        entryId: (r) => r.id,
        nameOf: (r) => r.id,
        writeEntry: async (r, dir, file) => {
            const tut = getCustomDoc(r.id);
            if (!tut) return false;
            const sep = dir.includes('\\') ? '\\' : '/';
            await invoke('write_text_file', { path: `${dir}${sep}${file}`, content: JSON.stringify(tut, null, 2) });
            return true;
        },
        row: (r, address) => ({ id: r.id, name: r.name, description: r.desc, url: address }),
        decorateDoc: (doc) => {
            const entries = (doc.tutorials as Array<Record<string, unknown>>) || [];
            doc.items = entries.map((e) => ({ ...e, kind: 'tutorial' }));
        },
        looksLike: (doc) => entriesOf(doc).length > 0 || Array.isArray((doc as any)?.tutorials),
        browse: {
            action: t('tutcat.install'),
            load: async () => {
                const entries: Array<{ id: string; name: string; sub?: string }> = [];
                const problems: string[] = [];
                from = new Map();
                for (const source of sources()) {
                    try {
                        // Cache-busted: a catalogue somebody just republished is the one case
                        // where a stale copy is worse than a slow fetch.
                        const sep = source.includes('?') ? '&' : '?';
                        const raw = await fetchSourceText(`${source}${sep}t=${Date.now()}`);
                        const found = entriesOf(JSON.parse(raw));
                        if (!found.length) { problems.push(`${source} — ${t('tutcat.empty')}`); continue; }
                        for (const e of found) {
                            // Kept apart per SOURCE: two catalogues may list the same id, and
                            // the address one of them gave is not the address of the other.
                            const key = `${source}::${e.id}`;
                            from.set(key, `${source}::${e.url}`);
                            entries.push({ id: key, name: e.name, sub: e.description });
                        }
                    } catch (e) {
                        // Kept ON the source: when one server is down, which one is the
                        // useful thing to know.
                        problems.push(`${source} — ${String(e).slice(0, 80)}`);
                    }
                }
                return { entries, problems };
            },
            pick: async (e) => {
                const rec = from.get(e.id);
                if (!rec) return;
                const i = rec.lastIndexOf('::');
                const src = rec.slice(0, i);
                const addr = rec.slice(i + 2);
                // Relative to its catalogue, so a catalogue and its files move hosts together.
                const url = /^[a-z]+:\/\//i.test(addr) ? addr : new URL(addr, src).toString();
                const text = await fetchSourceText(url);
                const res = await importCustomTutorialText(text);
                const sig = signatureLabel(res.signature);
                toast(`${t('tuthub.imported')} — ${sig.text}`, sig.tone === 'err' ? 'warning' : 'success');
                onInstalled();
            },
        },
        manageKeys: () => {
            (document.getElementById('nav-settings') as HTMLElement | null)?.click();
            setTimeout(() => document.getElementById('settings-identity-card')
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
        },
    });
}

/** The builder is the same screen's Create tab now. Kept as a name callers already use. */
export const openTutorialCatalogBuilder = (): Promise<void> => openTutorialCatalog(() => {});