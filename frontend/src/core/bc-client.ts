// bc-client.ts — the one place a BetterCommunity URL is made, and one way to call it.
//
// The rule (which root, v1 or v2, which route survives in v2) is pure and lives in
// bc-endpoints.ts; this file feeds it the live switch (app.cfg via links-config's loadBcConfig,
// links.json's site root) and adds a transport with a timeout and ONE error shape.
//
// No behaviour change by default: without `BCApiVersion=v2` in app.cfg, `bcUrl(route)` is
// exactly `${bcRoot()}/api${route}` — the string every call site built by hand.
//
// Transport goes through the native bridge (bc_api_get / bc_api_post), like every other BC call:
// the webview origin is tauri.localhost and the BCWEB API sends no CORS header for it.

// api.js is imported lazily, in call(): resolving a URL must not load the Tauri bridge, so the
// pure part of this module stays importable from anywhere (node tests included).
import { getLinks, bcTestMode, bcTestBase, bcApiVersionCfg, bcV2BaseCfg } from './links-config.js';
import {
    resolveRoots, v1ApiUrl, v2ApiUrl, feedbackEndpointFor, signedFeedUrls,
    type BcRoots, type BcApiVersion,
} from './bc-endpoints.js';

export type { BcApiVersion, BcRoots };

/** The roots right now. Cheap: recomputed on each call so a late loadBcConfig is seen. */
export function bcRoots(): BcRoots {
    return resolveRoots({
        testMode: bcTestMode(),
        testBase: bcTestBase(),
        linksRoot: String((getLinks() as unknown as Record<string, unknown>).bettercommunity || ''),
        apiVersion: bcApiVersionCfg(),
        v2Base: bcV2BaseCfg(),
    });
}

/** `v1` unless app.cfg says `BCApiVersion=v2`. Adapters switch on this. */
export function bcApiVersion(): BcApiVersion { return bcRoots().version; }
export function bcUsesV2(): boolean { return bcApiVersion() === 'v2'; }

/** A v1 API URL (`route` relative to `/api`, e.g. `/link/status?creatorId=…`). */
export function bcUrl(route: string): string { return v1ApiUrl(bcRoots(), route); }
/** A native v2 URL (`route` relative to `/v2`). Only meaningful when bcUsesV2(). */
export function bcV2Url(route: string): string { return v2ApiUrl(bcRoots(), route); }
/** The v2 site root (= v1 root unless BCv2Base is set and v2 is selected). */
export function bcV2Root(): string { return bcRoots().v2Root; }
/** Where reports go when links.json does not say otherwise (v1 path in v1 mode). */
export function bcFeedbackEndpoint(): string { return feedbackEndpointFor(bcRoots()); }
/** v2 signed feed addresses, for catalog_format.rs `catalog_verify_signature` to check. */
export function bcSignedFeeds(): ReturnType<typeof signedFeedUrls> { return signedFeedUrls(bcRoots()); }

/** The one failure shape. `code` is what a caller switches on. */
export interface BcError {
    code: 'offline' | 'timeout' | 'http' | 'bad_json';
    /** HTTP status when the server answered (from the bridge's `http_<n>`), else 0. */
    status: number;
    /** The server's body (v1 `{ error }` / v2 problem `{ code, title }`) when it sent JSON. */
    body?: unknown;
    message: string;
}
export type BcResult<T> = { ok: true; data: T } | { ok: false; error: BcError };

/** Read the bridge's rejection: `http_<n>` (empty body) or the server's body text. */
export function bcErrorOf(e: unknown): BcError {
    const msg = String((e as Error)?.message ?? e ?? '');
    const m = /^http_(\d{3})$/.exec(msg.trim());
    if (m) return { code: 'http', status: Number(m[1]), message: msg };
    try {
        const body = JSON.parse(msg);
        const st = Number((body as any)?.status) || 0;
        return { code: 'http', status: st, body, message: String((body as any)?.title || (body as any)?.error || msg) };
    } catch { /* not JSON: a transport failure */ }
    return { code: 'offline', status: 0, message: msg };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const id = setTimeout(() => reject(Object.assign(new Error('timeout'), { bcTimeout: true })), ms);
        p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
    });
}

async function call<T>(cmd: 'bc_api_get' | 'bc_api_post', args: Record<string, unknown>, timeoutMs: number): Promise<BcResult<T>> {
    let raw: string;
    try {
        const { invoke } = await import('./api.js');
        raw = await withTimeout(invoke(cmd, args, { quiet: true }) as Promise<string>, timeoutMs);
    } catch (e) {
        if ((e as any)?.bcTimeout) return { ok: false, error: { code: 'timeout', status: 0, message: `timeout (${timeoutMs} ms)` } };
        return { ok: false, error: bcErrorOf(e) };
    }
    try { return { ok: true, data: JSON.parse(raw) as T }; } catch {
        return { ok: false, error: { code: 'bad_json', status: 200, message: 'the answer is not JSON' } };
    }
}

/** GET a full BetterCommunity URL (from bcUrl / bcV2Url). Never throws. */
export function bcGetJson<T = unknown>(url: string, timeoutMs = 10_000): Promise<BcResult<T>> {
    return call<T>('bc_api_get', { url }, timeoutMs);
}
/** POST JSON to a full BetterCommunity URL. Never throws. */
export function bcPostJson<T = unknown>(url: string, body: unknown, timeoutMs = 15_000): Promise<BcResult<T>> {
    return call<T>('bc_api_post', { url, body: JSON.stringify(body ?? {}) }, timeoutMs);
}
