// bc-endpoints.ts — where a BetterCommunity call goes, v1 or v2, and how a v2 answer reads as v1.
//
// PURE: no imports, no DOM, no Tauri. The runtime half (state, transport) is bc-client.ts; this is
// the rule itself, tested against the compiled module (tests/bc-endpoints.test.mjs).
//
// THE SWITCH. app.cfg `BCApiVersion=v2` (+ optional `BCv2Base=https://…`). Absent — every install
// today — the version is v1 and every URL built here is byte-for-byte the one BMM built before.
// In v2 mode, only two things move to the v2 root:
//   1. calls with a v2 ADAPTER (feedback centre, consent receipts, signed catalogue feeds), which
//      use the native `/v2/...` routes;
//   2. v1 paths BetterCommunity v2 serves itself in its compatibility layer (contract
//      `compat.ts` + `feedback.ts`): catalog.json, repos.json, hosted repos, feedback.
// Every other v1 call stays on the v1 root, so switching a test build to v2 never sends a call to
// a server that has no route for it. That table is the list to shrink before the cut-over
// (Update/Documentation/BC-v2-readiness.md).

export type BcApiVersion = 'v1' | 'v2';

/** What the switch is made of (app.cfg through get_bc_config, plus links.json's site root). */
export interface BcSwitch {
    testMode: boolean;
    testBase: string;
    /** links.json `bettercommunity` (production site root). */
    linksRoot: string;
    apiVersion: BcApiVersion;
    /** app.cfg `BCv2Base`; '' = same root as v1. */
    v2Base: string;
}

export interface BcRoots { version: BcApiVersion; v1Root: string; v2Root: string }

export const BC_PROD_ROOT = 'https://bettercommunity.ch';
/** The project key BMM speaks for on BetterCommunity (v1 `?project=bmm`, `/feedback/bmm`). */
export const BC_PROJECT = 'bmm';

/** `v2` / `2` (any case) is v2; anything else, or nothing, is v1. Mirrors settings.rs bc_api_version_of. */
export function parseApiVersion(raw: unknown): BcApiVersion {
    const v = String(raw ?? '').trim().toLowerCase();
    return v === 'v2' || v === '2' ? 'v2' : 'v1';
}

const trimSlash = (s: string): string => s.trim().replace(/\/+$/, '');

/** https anywhere; plain http only to this machine. Mirrors bc_v2.rs base_allowed. */
export function baseAllowed(base: string): boolean {
    let u: URL;
    try { u = new URL(trimSlash(base)); } catch { return false; }
    const h = u.hostname.toLowerCase();
    const local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
    if (u.search || u.hash || u.username) return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && local);
}

/**
 * The two roots. v1Root is exactly what `bcRoot()` has always returned (test base in test mode,
 * else the links.json site, else production). v2Root is `BCv2Base` when v2 is selected and the
 * base is allowed, else the v1 root (after the cut-over one domain serves both).
 */
export function resolveRoots(sw: BcSwitch): BcRoots {
    const v1Root = trimSlash(sw.testMode ? (sw.testBase || '') : (sw.linksRoot || `${BC_PROD_ROOT}/`)) || BC_PROD_ROOT;
    if (sw.apiVersion !== 'v2') return { version: 'v1', v1Root, v2Root: v1Root };
    const v2 = trimSlash(sw.v2Base || '');
    return { version: 'v2', v1Root, v2Root: v2 && baseAllowed(v2) ? v2 : v1Root };
}

/**
 * v1 routes (relative to `/api`) that BetterCommunity v2 serves itself, same path, v1 shapes.
 * From the v2 contracts: compat.ts (catalog.json, repos.json, /repos/:slug/*) and feedback.ts
 * (/feedback/:project and its /config). Keep in step with them.
 */
export const V2_COMPAT_ROUTES: readonly RegExp[] = [
    /^\/catalog\.json(?:\?|$)/,
    /^\/repos\.json(?:\?|$)/,
    /^\/repos\/[a-z0-9][a-z0-9-]{1,62}\/./,
    /^\/feedback\/[a-z0-9][a-z0-9-]{1,62}(?:\/config)?(?:\?|$)/,
];

export function servedByV2Compat(route: string): boolean {
    return V2_COMPAT_ROUTES.some((re) => re.test(route));
}

const withSlash = (route: string): string => (route.startsWith('/') ? route : `/${route}`);

/**
 * A v1 API URL: `<root>/api<route>`. In v1 mode it is the v1 root, always — the URL BMM has
 * always built. In v2 mode the v2 root, but only for a route v2 serves (V2_COMPAT_ROUTES).
 */
export function v1ApiUrl(roots: BcRoots, route: string): string {
    const r = withSlash(route);
    const root = roots.version === 'v2' && servedByV2Compat(r) ? roots.v2Root : roots.v1Root;
    return `${root}/api${r}`;
}

/** A native v2 URL: `<v2Root>/v2<route>` (`route` with or without its `/v2` prefix). */
export function v2ApiUrl(roots: BcRoots, route: string): string {
    const r = withSlash(route).replace(/^\/v2(?=\/|$)/, '');
    return `${roots.v2Root}/v2${r}`;
}

// ── Feedback centre: v1 payload ⇄ v2 contract (feedback.ts sendFeedback / getFeedbackConfig) ──

/** BMM's report as bc-feedback.ts builds it (v1 shape). Kept structural: no import of that module. */
export interface V1FeedbackLike {
    kind: 'feedback' | 'bug' | 'crash';
    title?: string;
    body: string;
    email?: string;
    discord?: string;
    appVersion?: string;
    os?: string;
    meta?: Record<string, unknown>;
    fingerprint?: string;
    attachments?: { name: string; type: string; data: string }[];
}

/** Where reports go. v1 mode (and v2 without the native adapter): the v1 path, unchanged. */
export function feedbackEndpointFor(roots: BcRoots, project = BC_PROJECT): string {
    return roots.version === 'v2'
        ? v2ApiUrl(roots, `/projects/${project}/feedback`)
        : v1ApiUrl(roots, `/feedback/${project}`);
}

const META_KEY = /^[A-Za-z0-9_.-]{1,40}$/;
const FINGERPRINT = /^[A-Za-z0-9:._-]{1,128}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const plain = (s: string, max: number): string => s.replace(CONTROL, '').slice(0, max);

/** v1 meta was free-form; v2 takes ≤ 40 flat keys of string ≤ 2000 / number / boolean / null. */
export function flattenMeta(meta: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
    const out: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(meta || {})) {
        if (Object.keys(out).length >= 40) break;
        if (!META_KEY.test(k) || v === undefined) continue;
        if (v === null || typeof v === 'boolean') out[k] = v;
        else if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : null;
        else if (typeof v === 'string') out[k] = v.slice(0, 2000);
        else { try { out[k] = JSON.stringify(v).slice(0, 2000); } catch { out[k] = null; } }
    }
    return out;
}

/** The body of `POST /v2/projects/:project/feedback` (a strict object: no other key). */
export function feedbackToV2(p: V1FeedbackLike): Record<string, unknown> {
    const body: Record<string, unknown> = {
        kind: p.kind,
        title: plain((p.title || '').trim(), 200),
        body: plain(p.body || '', 4 * 1024 * 1024),
        app_version: (p.appVersion || '').trim().slice(0, 40),
        os: (p.os || '').trim().slice(0, 80),
        attachments: (p.attachments || []).slice(0, 40).map((a) => ({
            name: plain(a.name || 'file', 200).trim() || 'file',
            content_type: /^[a-z]+\/[a-z0-9.+-]+$/i.test(a.type || '') ? a.type.slice(0, 100) : 'application/octet-stream',
            data: a.data,
        })),
    };
    const email = (p.email || '').trim();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.email = email.slice(0, 320);
    const discord = plain((p.discord || '').trim(), 40);
    if (discord.length >= 2) body.discord = discord;
    const meta = flattenMeta(p.meta);
    if (Object.keys(meta).length) body.meta = meta;
    if (p.fingerprint && FINGERPRINT.test(p.fingerprint)) body.fingerprint = p.fingerprint;
    return body;
}

/** v2 `FeedbackConfig` → the v1 shape bc-feedback.ts and the dialog read. */
export function feedbackConfigFromV2(c: any): {
    enabled: boolean; kinds: Record<'feedback' | 'bug' | 'crash', boolean>; crashSampling: number; maxBodyKB: number;
    maxAttachMB: number; maxAttachments: number; maxRequestMB: number; requireContact: boolean; minVersion: string;
} {
    const kinds: string[] = Array.isArray(c?.kinds) ? c.kinds : [];
    return {
        enabled: !!c?.enabled,
        kinds: { feedback: kinds.includes('feedback'), bug: kinds.includes('bug'), crash: kinds.includes('crash') },
        crashSampling: Number(c?.crash_sampling ?? 100),
        maxBodyKB: Number(c?.max_body_kb ?? 0),
        maxAttachMB: Number(c?.max_attach_mb ?? 0),
        maxAttachments: Number(c?.max_attachments ?? 0),
        maxRequestMB: Number(c?.max_request_mb ?? 1),
        requireContact: !!c?.require_contact,
        minVersion: String(c?.min_version ?? ''),
    };
}

/**
 * A v2 answer re-expressed as the v1 answer it stands for, so the one status switch in
 * bc-feedback.ts (and its translated sentences) serves both. v2 refusals are problem documents
 * (`{ code: 'feedback.body_too_large', … }`, contract problem.ts); v1 said `{ error: 'body_too_large' }`.
 * v2 does not repeat the limit in a refusal: the dialog reads it from the config it already holds.
 */
export function feedbackAnswerFromV2(status: number, j: any): { status: number; body: Record<string, unknown> } {
    const code = typeof j?.code === 'string' && j.code.startsWith('feedback.') ? j.code.slice('feedback.'.length) : '';
    if (status === 201 || status === 200) {
        return { status: 200, body: { ok: true, id: String(j?.id ?? ''), threadId: null, linked: false, duplicate: !!j?.duplicate, sampled: j?.sampled !== false } };
    }
    if (code === 'disabled') return { status: 403, body: { error: 'disabled' } };
    if (code === 'body_too_large' || code === 'too_many_attachments' || code === 'attachments_too_large') return { status: 413, body: { error: code } };
    if (status === 413) return { status: 413, body: { error: 'too_large' } };
    if (code) return { status: 422, body: { error: code === 'kind_closed' ? 'kind_disabled' : code } };
    if (status === 429) return { status: 429, body: { retryAfterSec: Number(j?.retry_after ?? j?.retryAfterSec ?? 60) } };
    return { status, body: (j && typeof j === 'object') ? j : {} };
}

// ── Signed catalogue feeds (v2 catalogs.ts): discovery only — verification is catalog_format.rs ──

/** Where the signed feeds live, for `catalog_verify_signature` (catalog_format.rs) to check. */
export function signedFeedUrls(roots: BcRoots): { index: string; keys: string; catalog: (slug: string) => string } {
    return {
        index: v2ApiUrl(roots, '/feeds/catalog'),
        keys: v2ApiUrl(roots, '/feeds/keys'),
        catalog: (slug: string) => v2ApiUrl(roots, `/feeds/catalogs/${encodeURIComponent(slug)}`),
    };
}
