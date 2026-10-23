// The app's one catalogue index: every followed source, refreshed incrementally through the
// HTTP cache, merged and searchable.
//
// The wiring of catalog-refresh.ts (rules) + catalog-search.ts (index) to the real fetcher
// and normaliser, and to the lists the user follows. Kept apart from catalog-index.ts, which
// is deliberately Tauri-free.
//
//   await refreshCatalogIndex()            due sources only; never throws
//   searchCatalogs('eclair', 'theme')      ranked, accent-folded, de-duplicated
//   catalogIndexStatus()                   per source: ok / stale / error, last success, why

import { fetchCatalog, normalizeAny } from '../../core/catalog-read.js';
import { STORE_KEY, readSources, enabledOnly } from './catalog-index.js';
import { CatalogRefresher, type SourceSpec, type SourceStatus } from './catalog-refresh.js';
import type { SearchHit } from './catalog-search.js';

const STATUS_KEY = 'bmm_catalog_index_status';

let _refresher: CatalogRefresher | null = null;

function refresher(): CatalogRefresher {
    if (_refresher) return _refresher;
    _refresher = new CatalogRefresher(
        (url, o) => fetchCatalog(url, { force: o.force, quiet: true, noPrompt: true }),
        (doc, kind, url) => normalizeAny(doc, kind, url),
    );
    try { _refresher.restore(JSON.parse(localStorage.getItem(STATUS_KEY) || '[]')); } catch { /* none saved */ }
    return _refresher;
}

/** Every followed, enabled source of the localStorage-kept kinds, plus any `extra` (the app
 *  catalogues live in the backend; a caller that has them passes them here). */
export function followedSources(extra: SourceSpec[] = []): SourceSpec[] {
    const out: SourceSpec[] = [];
    const seen = new Set<string>();
    for (const [kind, key] of Object.entries(STORE_KEY)) {
        for (const url of enabledOnly(readSources(key))) {
            // bundle: sources are files the catalogue screens open themselves.
            if (url.startsWith('bundle:') || seen.has(url.toLowerCase())) continue;
            seen.add(url.toLowerCase());
            out.push({ url, kind });
        }
    }
    for (const s of extra) if (!seen.has(s.url.toLowerCase())) { seen.add(s.url.toLowerCase()); out.push(s); }
    return out;
}

/** Refresh the stale sources (all with `force`). Resolves with every source's status. */
export async function refreshCatalogIndex(opts: { force?: boolean; extra?: SourceSpec[] } = {}): Promise<SourceStatus[]> {
    const r = refresher();
    const st = await r.refresh(followedSources(opts.extra), { force: opts.force });
    try { localStorage.setItem(STATUS_KEY, JSON.stringify(r.toJSON())); } catch { /* preference only */ }
    return st;
}

export function searchCatalogs(query: string, kind?: string, limit?: number): SearchHit[] {
    return refresher().index.search(query, { kind, limit });
}

export function catalogIndexStatus(): SourceStatus[] {
    return refresher().list();
}
