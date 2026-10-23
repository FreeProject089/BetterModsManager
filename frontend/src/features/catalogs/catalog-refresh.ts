// Refreshing many catalogues: only the stale ones, each on its own, last good data kept.
//
// Pure: the fetcher and the normaliser are passed in (the app passes core/catalog-read's
// `fetchCatalog` and `normalizeAny`; the tests pass fakes), so the rules below are tested
// without a network:
//
//  - **Incremental.** A source fetched successfully less than its TTL ago is not fetched
//    again; `force` overrides. Per-source TTL, default 10 minutes.
//  - **Isolated.** Sources are fetched concurrently (bounded) and a failure is recorded on
//    THAT source — status `error`, the message, the time — never thrown out of `refresh`.
//  - **Last good data.** A source that fails keeps what it last served in the index, marked
//    `stale`; it is removed only when it is no longer followed. A refused document (invalid
//    signature) is a failure like any other: it never REPLACES what was accepted before.
//  - **Status per source.** `ok · stale · error · pending`, last success, last attempt,
//    consecutive failures, item count, signature status, the cache state the fetcher reported
//    (`not_modified`, `stale`, …). Serialisable, so a screen can persist and show it.

import type { Normalized, UniversalCatalog } from '../../core/catalog-format.js';
import { CatalogSearchIndex } from './catalog-search.js';

export interface SourceSpec { url: string; kind?: string; ttlMs?: number }

export interface SourceStatus {
    url: string;
    kind?: string;
    state: 'ok' | 'stale' | 'error' | 'pending';
    lastOk?: number;
    lastTry?: number;
    failures: number;
    error?: string;
    items: number;
    signature?: string;
    /** What the fetcher said about the transport: fresh, not_modified, cached, stale, direct. */
    fetch?: string;
}

export type Fetcher = (url: string, opts: { force: boolean }) => Promise<{ text: string; state?: string; error?: string }>;
export type Normalizer = (doc: unknown, kind: string | undefined, url: string) => Promise<Normalized>;

export const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class CatalogRefresher {
    readonly index: CatalogSearchIndex;
    private status = new Map<string, SourceStatus>();
    private catalogs = new Map<string, UniversalCatalog>();

    constructor(private fetcher: Fetcher, private normalizer: Normalizer, opts: { index?: CatalogSearchIndex; now?: () => number; concurrency?: number } = {}) {
        this.index = opts.index ?? new CatalogSearchIndex();
        this.now = opts.now ?? (() => Date.now());
        this.concurrency = Math.max(1, opts.concurrency ?? 4);
    }
    private now: () => number;
    private concurrency: number;

    /** Is this source due? Never fetched, last attempt failed, or older than its TTL. */
    isStale(spec: SourceSpec): boolean {
        const st = this.status.get(spec.url);
        if (!st || st.lastOk === undefined || st.state === 'error' || st.state === 'stale') return true;
        return this.now() - st.lastOk >= (spec.ttlMs ?? DEFAULT_TTL_MS);
    }

    /**
     * Bring the index up to date with `sources`. Sources no longer listed leave the index.
     * Resolves when every due source has answered or failed; never rejects.
     */
    async refresh(sources: SourceSpec[], opts: { force?: boolean } = {}): Promise<SourceStatus[]> {
        const wanted = new Set(sources.map((s) => s.url));
        for (const url of [...this.status.keys()]) {
            if (!wanted.has(url)) { this.status.delete(url); this.catalogs.delete(url); this.index.removeSource(url); }
        }
        const due = sources.filter((s) => opts.force || this.isStale(s));
        let next = 0;
        const worker = async () => {
            while (next < due.length) {
                const spec = due[next++];
                await this.refreshOne(spec, !!opts.force);
            }
        };
        await Promise.all(Array.from({ length: Math.min(this.concurrency, due.length) }, worker));
        return this.list(sources.map((s) => s.url));
    }

    private async refreshOne(spec: SourceSpec, force: boolean): Promise<void> {
        const prev = this.status.get(spec.url);
        const st: SourceStatus = {
            url: spec.url, kind: spec.kind, state: 'pending',
            lastOk: prev?.lastOk, lastTry: this.now(), failures: prev?.failures ?? 0,
            items: prev?.items ?? 0, signature: prev?.signature,
        };
        this.status.set(spec.url, st);
        try {
            const got = await this.fetcher(spec.url, { force });
            st.fetch = got.state;
            const n = await this.normalizer(JSON.parse(got.text), spec.kind, spec.url);
            if (n.refused) {
                throw new Error(n.issues.find((i) => i.severity === 'error')?.message || 'refused');
            }
            this.catalogs.set(spec.url, n.catalog);
            this.index.setSource(spec.url, n.catalog);
            st.items = n.catalog.items?.length ?? 0;
            st.signature = n.signature?.status;
            // The cache served its last good copy because the server failed: the data is
            // usable, and the source is still not well.
            if (got.state === 'stale') {
                st.state = 'stale';
                st.error = got.error;
                st.failures += 1;
            } else {
                st.state = 'ok';
                st.lastOk = this.now();
                st.failures = 0;
                st.error = undefined;
            }
        } catch (e) {
            st.failures += 1;
            st.error = String((e as Error)?.message ?? e).slice(0, 300);
            // Keep serving what this source served last; say so.
            st.state = this.catalogs.has(spec.url) ? 'stale' : 'error';
        }
    }

    /** Status of every source (or of `urls`, in that order). */
    list(urls?: string[]): SourceStatus[] {
        const keys = urls ?? [...this.status.keys()];
        return keys.map((u) => this.status.get(u)).filter(Boolean).map((s) => ({ ...s! }));
    }

    catalogOf(url: string): UniversalCatalog | undefined { return this.catalogs.get(url); }

    /** For persisting the statuses between runs (the data itself lives in the backend cache). */
    toJSON(): SourceStatus[] { return this.list(); }

    /** Restore statuses. Restored sources are due (`stale`): their data is not in memory. */
    restore(saved: unknown): void {
        if (!Array.isArray(saved)) return;
        for (const s of saved) {
            if (s && typeof s.url === 'string') {
                this.status.set(s.url, { ...s, state: s.state === 'error' ? 'error' : 'stale', failures: Number(s.failures) || 0, items: Number(s.items) || 0 });
            }
        }
    }
}
