// Reading a catalogue: fetched through the HTTP cache, read through the universal format.
//
// Two helpers every catalogue loader can use without changing what it does with the result:
//
//   fetchCatalogText(url)   the text, through `catalog_fetch` for http(s): conditional request
//                           (ETag / Last-Modified, a 304 reuses the stored copy) and the last
//                           good copy when the server is down. ssh://, files and bundles go
//                           through fetchSourceText exactly as before.
//
//   asLegacy(doc, kind)     the document that loader already knows how to read. A v1 document
//                           is returned as it is (no round trip); a universal catalogue, a
//                           BetterCommunity v2 feed or a signed envelope is normalised by the
//                           backend — which verifies the signature against the trusted keys —
//                           and handed back in the v1 shape of that kind. An invalid signature
//                           throws: it is never served as a catalogue. Without a backend the
//                           TypeScript fallback (core/catalog-format.ts) reads it unverified.

import { invoke } from './api.js';
import { fetchSourceText, sessionPasswordFor } from './source-fetch.js';
import {
    needsNormalizing, normalizeCatalog, toLegacy, isIndexOnly,
    type Normalized, type UniversalCatalog,
} from './catalog-format.js';

export interface CatalogFetch {
    text: string;
    /** fresh · not_modified · cached · stale — or `direct` when the cache was not used. */
    state: string;
    /** With `stale`: why the server's answer was not used. */
    error?: string;
    lastOk?: string;
}

const isHttp = (u: string): boolean => /^https?:\/\//i.test(u);

/**
 * Fetch a catalogue through the cache.
 *
 * `maxAgeSecs` lets a periodic refresh skip a source it read recently; a screen the user just
 * opened should not pass it (a 304 costs one small request and is always current).
 */
export async function fetchCatalog(url: string, opts: { force?: boolean; maxAgeSecs?: number; quiet?: boolean; noPrompt?: boolean } = {}): Promise<CatalogFetch> {
    if (!isHttp(url)) return { text: await fetchSourceText(url, opts.quiet), state: 'direct' };
    try {
        const r: any = await invoke('catalog_fetch', {
            url, password: sessionPasswordFor(url), force: !!opts.force, maxAgeSecs: opts.maxAgeSecs ?? null,
        }, { quiet: opts.quiet });
        return { text: String(r?.body ?? ''), state: String(r?.state || 'fresh'), error: r?.error || undefined, lastOk: r?.lastOk || undefined };
    } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        // The password prompt lives in fetchSourceText; let it ask, then the next read goes
        // through the cache with the remembered password.
        // `noPrompt` (a background refresh): report it on that source instead of opening a dialog.
        if (msg === 'repo.errPasswordRequired') {
            if (opts.noPrompt) throw e;
            return { text: await fetchSourceText(url, opts.quiet), state: 'direct' };
        }
        // An HTTP answer is the server's: report it. Anything else (no backend, an unknown
        // command in an older build) falls back to the ordinary reader.
        if (/^HTTP \d+|^forbidden|too large/i.test(msg)) throw e;
        return { text: await fetchSourceText(url, opts.quiet), state: 'direct' };
    }
}

/** The text alone — a drop-in for `fetchSourceText` in a catalogue loader. */
export async function fetchCatalogText(url: string, quiet = false): Promise<string> {
    return (await fetchCatalog(url, { quiet })).text;
}

// ── BetterCommunity v2 signed feeds ─────────────────────────────────────────────
//
// v1 mode (every install today): nothing here runs. In `BCApiVersion=v2` mode the signed feeds
// of the configured v2 root (`bcSignedFeeds()`: `/v2/feeds/catalog`, `/v2/feeds/catalogs/:c`)
// are read like any catalogue, and the first time one is read the root's published keys
// (`/v2/feeds/keys`) are pinned through `catalog_keys fetch` — to `{root}/v2/feeds/` only, so
// the same server's unsigned compat catalog.json stays readable. From then on a feed from there
// that is unsigned, tampered or signed by another key is refused by the backend.

let _keysFor: string | null = null;
let _keysPending: Promise<boolean> | null = null;

/** The v2 signed-feed scope (`{root}/v2/feeds/`) in v2 mode, else null. */
async function v2FeedScope(): Promise<{ root: string; scope: string } | null> {
    try {
        const bc = await import('./bc-client.js');
        if (!bc.bcUsesV2()) return null;
        const root = bc.bcV2Root().replace(/\/+$/, '');
        return root ? { root, scope: `${root}/v2/feeds/` } : null;
    } catch { return null; }
}

/** Is `url` one of the configured v2 root's signed feeds (v2 mode only)? */
export async function isV2SignedFeed(url: string | undefined): Promise<boolean> {
    if (!url) return false;
    const s = await v2FeedScope();
    return !!s && url.toLowerCase().startsWith(s.scope.toLowerCase());
}

/**
 * Pin the v2 root's feed keys once (v2 mode only). True when a key for that scope is held.
 * Never throws: a server that publishes no key leaves its feeds readable as `unknown_key`
 * (flagged), exactly as before this existed.
 */
export async function ensureFeedKeys(): Promise<boolean> {
    const s = await v2FeedScope();
    if (!s) return false;
    if (_keysFor === s.scope) return true;
    if (_keysPending) return _keysPending;
    _keysPending = (async () => {
        try {
            const have: any = await invoke('catalog_keys', { op: 'list' }, { quiet: true });
            const held = (have?.keys || []).some((k: any) => String(k?.issuer || '').toLowerCase() === s.scope.toLowerCase());
            if (!held) await invoke('catalog_keys', { op: 'fetch', issuer: s.root, label: 'BetterCommunity v2' }, { quiet: true });
            _keysFor = s.scope;
            return true;
        } catch { return false; } finally { _keysPending = null; }
    })();
    return _keysPending;
}

/** Normalise any variant, preferring the backend (it verifies signatures). */
export async function normalizeAny(doc: unknown, kind?: string, sourceUrl?: string): Promise<Normalized> {
    if (await isV2SignedFeed(sourceUrl)) await ensureFeedKeys();
    try {
        const n = await invoke('catalog_normalize', { text: JSON.stringify(doc), kind: kind ?? null, sourceUrl: sourceUrl ?? null }, { quiet: true });
        if (n && typeof n === 'object' && (n as any).catalog) return n as Normalized;
    } catch { /* no backend: the fallback below */ }
    return normalizeCatalog(doc, { kind, sourceUrl });
}

/**
 * The document a v1 reader of `kind` should parse. See the header. `kind` may be `index`.
 */
export async function asLegacy(doc: unknown, kind: string, sourceUrl?: string): Promise<any> {
    // A v1 document is handed back as it is — except from a v2 signed-feed address, where an
    // unsigned document is a downgrade the backend must see (and refuse) once the key is pinned.
    if (!needsNormalizing(doc) && !(await isV2SignedFeed(sourceUrl))) return doc;
    const n = await normalizeAny(doc, kind === 'index' ? undefined : kind, sourceUrl);
    if (n.refused) {
        const why = n.issues.find((i) => i.severity === 'error')?.message || 'refused';
        throw new Error(`catalog refused: ${why}`);
    }
    const u = n.catalog as UniversalCatalog;
    return toLegacy(u, isIndexOnly(u) ? 'index' : kind);
}
