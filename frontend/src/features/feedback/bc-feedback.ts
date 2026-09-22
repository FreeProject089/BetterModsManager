// bc-feedback.ts — feedback, bug and crash reports sent to the BetterCommunity feedback
// centre (BCWEB `POST /feedback/<project>`), which is where they land unless links.json says
// otherwise.
//
// Two rules drive everything here. BetterCommunity being unreachable must never break BMM:
// every network failure becomes a toast and, for the report itself, a local queue that is
// retried on the next start. And the endpoint is configuration, not code: `feedback_endpoint`
// in links.json can point at another BetterCommunity, at a tunnel, or be emptied to fall back
// to the BetaHub client that this module replaces.
import { invoke } from '../../core/api.js';
import { creatorProofFor } from '../../core/canvas-fingerprint.js';
import { getLinks, bcApi } from '../../core/links-config.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { recordNotification } from '../../ui/notification-center.js';

export type FeedbackKind = 'feedback' | 'bug' | 'crash';

export interface FeedbackAttachment { name: string; type: string; data: string /* base64 */ }
export interface FeedbackPayload {
    kind: FeedbackKind;
    title?: string;
    body: string;
    email?: string;
    discord?: string;
    appVersion?: string;
    os?: string;
    meta?: Record<string, unknown>;
    fingerprint?: string;
    attachments?: FeedbackAttachment[];
}
export interface FeedbackResult { id: string; threadId: string | null; linked: boolean; duplicate?: boolean; sampled?: boolean }
export interface FeedbackRemoteConfig {
    enabled: boolean;
    kinds?: Record<FeedbackKind, boolean>;
    crashSampling?: number;
    maxBodyKB?: number;
    maxAttachMB?: number;
    maxAttachments?: number;
    /** How large the whole REQUEST may be, base64 included — a different limit from
     *  maxAttachMB, which counts the DECODED bytes the server stores. Optional because a
     *  server older than the field does not send it. */
    maxRequestMB?: number;
    requireContact?: boolean;
    minVersion?: string;
}

// The attachment budget lives in its own import-free module so it can be exercised
// without loading this file's transport chain; re-exported here because every caller of
// submitFeedback also needs to know what fits.
export { attachLimits, decodedLen, fitsBudget, type AttachBudget, type AttachUsed } from './feedback-budget.js';

/** Thrown by submit(); `code` is what the caller switches on. */
export class FeedbackError extends Error {
    constructor(public code: string, message: string, public retryAfterSec = 0, public detail?: unknown) { super(message); }
}

const QUEUE_KEY = 'bmm.feedback.queue';
const SENT_KEY = 'bmm.feedback.sent';
const QUEUE_MAX = 5;
const QUEUE_ITEM_MAX_BYTES = 2 * 1024 * 1024; // attachments beyond this are dropped from a queued copy, not the report
const CLIENT_MAX_PER_10MIN = 5;
const CLIENT_MAX_PER_DAY = 20;
// An unrecognised sender has no account to answer and no name to write back to, and the
// server now gives them their own tighter budget rather than letting them spend the one
// everybody behind the same address shares. Matched here so the refusal arrives BEFORE
// somebody spends ten minutes writing a report that gets a 429.
const ANON_MAX_PER_10MIN = 2;
const ANON_MAX_PER_DAY = 4;
const CONFIG_TTL_MS = 10 * 60 * 1000;

/** Where reports go. `feedback_endpoint` in links.json; '' means "not BetterCommunity". */
export function feedbackEndpoint(): string {
    const raw = (getLinks() as unknown as Record<string, unknown>).feedback_endpoint;
    if (raw === '' || raw === null) return '';
    if (typeof raw === 'string' && /^https?:\/\//.test(raw)) return raw.replace(/\/+$/, '');
    return `${bcApi()}/feedback/bmm`;
}
/** The web page where a linked user follows their reports. */
export function feedbackWebUrl(): string {
    const raw = (getLinks() as unknown as Record<string, unknown>).feedback_web;
    if (typeof raw === 'string' && /^https?:\/\//.test(raw)) return raw;
    return `${bcApi().replace(/\/api$/, '')}/dashboard?s=reports`;
}
/** True when reports go to BetterCommunity (the default); false = BetaHub fallback. */
export function usesBetterCommunity(): boolean { return feedbackEndpoint() !== ''; }

let cfgCache: { at: number; cfg: FeedbackRemoteConfig | null } = { at: 0, cfg: null };

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), ms);
    return { signal: c.signal, done: () => clearTimeout(id) };
}

/**
 * Who is sending this, and the proof of it.
 *
 * `X-Creator-ID` on its own is a claim anybody who has seen the id can make — it is an
 * ed25519 PUBLIC key, and handing it to repo owners for whitelisting is what it is for. The
 * server therefore ignores it unless `X-Creator-Proof` verifies: a two-minute, origin-bound
 * signature made with the private half, which only this install has.
 *
 * Both headers are optional. No creator id, an older build with no `creator_proof` command, a
 * server that does not look at it — all of them land on "anonymous", which is what every BMM
 * report was until now anyway. Nothing here can fail a submission.
 */
async function creatorHeader(): Promise<Record<string, string>> {
    let id = '';
    try { id = await invoke('get_creator_id') as string; } catch { return {}; }
    if (!id || typeof id !== 'string' || id === '\u2014') return {};
    const out: Record<string, string> = { 'X-Creator-ID': id };
    try {
        // The AUDIENCE is the origin of wherever this report is going — read from the
        // endpoint we are about to post to, not from a constant, so a tunnelled or
        // self-hosted BetterCommunity gets a proof addressed to itself.
        const aud = new URL(feedbackEndpoint()).origin;
        // v5 (nonce, rotation chain, hashed fingerprint) when this build has it, v1 otherwise.
        const proof = await creatorProofFor(aud);
        if (proof) out['X-Creator-Proof'] = proof;
    } catch { /* older build, or no endpoint — the report goes anonymously */ }
    return out;
}

/** The project's live limits, or null when BetterCommunity cannot be reached. Cached 10 min. */
export async function fetchFeedbackConfig(force = false): Promise<FeedbackRemoteConfig | null> {
    const ep = feedbackEndpoint();
    if (!ep) return null;
    if (!force && cfgCache.cfg && Date.now() - cfgCache.at < CONFIG_TTL_MS) return cfgCache.cfg;
    const tm = withTimeout(6000);
    try {
        const r = await fetch(`${ep}/config`, { signal: tm.signal, headers: { Accept: 'application/json' } });
        if (!r.ok) return null;
        const cfg = await r.json() as FeedbackRemoteConfig;
        cfgCache = { at: Date.now(), cfg };
        return cfg;
    } catch { return null; }
    finally { tm.done(); }
}

// ── client-side throttle: what a well-behaved client sends regardless of what the server allows
function sentTimes(): number[] {
    try { return (JSON.parse(localStorage.getItem(SENT_KEY) || '[]') as number[]).filter((x) => Date.now() - x < 86_400_000); } catch { return []; }
}
export function clientThrottleOk(linked = true): { ok: boolean; waitSec: number } {
    const now = Date.now(); const s = sentTimes();
    const per10 = linked ? CLIENT_MAX_PER_10MIN : ANON_MAX_PER_10MIN;
    const perDay = linked ? CLIENT_MAX_PER_DAY : ANON_MAX_PER_DAY;
    const last10 = s.filter((x) => now - x < 600_000);
    if (last10.length >= per10) return { ok: false, waitSec: Math.ceil((600_000 - (now - last10[0])) / 1000) };
    if (s.length >= perDay) return { ok: false, waitSec: Math.ceil((86_400_000 - (now - s[0])) / 1000) };
    return { ok: true, waitSec: 0 };
}
/** What an anonymous sender is allowed, for the dialog to say out loud. */
export const anonLimits = { per10min: ANON_MAX_PER_10MIN, perDay: ANON_MAX_PER_DAY };
function recordSent(): void {
    try { localStorage.setItem(SENT_KEY, JSON.stringify([...sentTimes(), Date.now()])); } catch { /* private mode */ }
}

async function baseMeta(): Promise<Record<string, unknown>> {
    const [appVersion, buildDate] = await Promise.all([
        invoke('get_app_version').catch(() => ''), invoke('get_build_date').catch(() => ''),
    ]);
    return { appVersion: String(appVersion || ''), buildDate: String(buildDate || ''), os: navigator.platform || '', lang: navigator.language || '', ua: navigator.userAgent };
}

/** One POST. Throws FeedbackError with a code: offline · rate_limited · disabled · too_large ·
 *  filtered · version · contact_required · rejected. Never throws anything else. */
/**
 * Ask the configured endpoint what it is, and report exactly what came back.
 *
 * Until now the only way to find out whether `feedback_endpoint` was right was to write a
 * report and press Send — and every way of being wrong (bad host, wrong path, unknown project,
 * reports switched off) surfaced as one of two sentences that both read like "the feature is
 * off". This does the same GET the modal does, and returns the distinction: unreachable vs
 * reachable-but-off vs working, with the limits it will actually enforce.
 *
 * `force` bypasses the config cache — testing a URL you just changed must not answer from the
 * answer the old URL gave.
 */
export interface EndpointTest {
    state: 'no_url' | 'unreachable' | 'disabled' | 'ok';
    url: string;
    why?: string;
    cfg?: FeedbackRemoteConfig;
}
export async function testFeedbackEndpoint(): Promise<EndpointTest> {
    const ep = feedbackEndpoint();
    if (!ep) return { state: 'no_url', url: '' };
    const tm = withTimeout(6000);
    try {
        const r = await fetch(`${ep}/config`, { signal: tm.signal, headers: { Accept: 'application/json' } });
        if (!r.ok) return { state: 'unreachable', url: ep, why: `HTTP ${r.status}` };
        const cfg = await r.json() as FeedbackRemoteConfig;
        cfgCache = { at: Date.now(), cfg };
        return cfg?.enabled ? { state: 'ok', url: ep, cfg } : { state: 'disabled', url: ep, cfg };
    } catch (e) {
        // A timeout and a DNS failure are both "no answer" to fetch, but they mean different
        // things to whoever typed the URL, so the reason is passed through rather than summarised.
        const why = (e as Error)?.name === 'AbortError' ? 'timeout (6 s)' : String((e as Error)?.message || e);
        return { state: 'unreachable', url: ep, why };
    } finally { tm.done(); }
}

export async function submitFeedback(payload: FeedbackPayload, opts: { queueOnOffline?: boolean; linked?: boolean } = {}): Promise<FeedbackResult> {
    const ep = feedbackEndpoint();
    if (!ep) throw new FeedbackError('disabled', t('feedback.disabled'));
    const thr = clientThrottleOk(opts.linked !== false);
    if (!thr.ok) throw new FeedbackError('rate_limited', t('feedback.rateLimited').replace('{s}', String(thr.waitSec)), thr.waitSec);
    const m = await baseMeta();
    const body: FeedbackPayload = { ...payload, appVersion: payload.appVersion || String(m.appVersion || ''), os: payload.os || String(m.os || ''), meta: { ...m, ...(payload.meta || {}) } };
    const tm = withTimeout(30_000);
    let r: Response;
    try {
        r = await fetch(ep, { method: 'POST', signal: tm.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(await creatorHeader()) }, body: JSON.stringify(body) });
    } catch {
        tm.done();
        if (opts.queueOnOffline !== false) enqueue(body);
        throw new FeedbackError('offline', t('feedback.offline'));
    }
    tm.done();
    if (r.status === 429) {
        const j = await r.json().catch(() => ({})) as { retryAfterSec?: number };
        const s = Number(j.retryAfterSec || 60);
        throw new FeedbackError('rate_limited', t('feedback.rateLimited').replace('{s}', String(s)), s);
    }
    // A 404 here is NOT "reports are off". The endpoint answered — it just does not know this
    // project key, which in practice means feedback_endpoint in the link config points at the
    // wrong path or the wrong deployment. Reporting it as "disabled" (the same sentence the
    // server sends when a project really is switched off) sent people looking for a setting to
    // turn on, when what was wrong was a URL.
    if (r.status === 404) throw new FeedbackError('disabled', t('feedback.noProject'));
    // Three different limits, three different fixes, and the server names which one it was and
    // by how much. Collapsing them into "the report is too big" threw all of that away: a
    // 300-byte crash log that tripped the ATTACHMENT COUNT read as "your text is too long".
    if (r.status === 413) {
        const j = await r.json().catch(() => ({})) as { error?: string; maxBodyKB?: number; max?: number; maxAttachMB?: number };
        if (j.error === 'body_too_large') throw new FeedbackError('too_large', t('feedback.tooLongBody').replace('{n}', String(j.maxBodyKB ?? '?')));
        if (j.error === 'too_many_attachments') throw new FeedbackError('too_large', t('feedback.tooManyFiles').replace('{n}', String(j.max ?? '?')));
        if (j.error === 'attachments_too_large') throw new FeedbackError('too_large', t('feedback.filesTooBig').replace('{n}', String(j.maxAttachMB ?? '?')));
        throw new FeedbackError('too_large', t('feedback.tooLarge'));
    }
    if (r.status === 422) {
        const j = await r.json().catch(() => ({})) as { error?: string; minVersion?: string };
        if (j.error === 'version_too_old' || j.error === 'version_blocked') throw new FeedbackError('version', t('feedback.versionRefused').replace('{v}', j.minVersion || ''));
        if (j.error === 'contact_required') throw new FeedbackError('contact_required', t('feedback.contactRequired'));
        throw new FeedbackError('filtered', t('feedback.filtered'));
    }
    if (r.status === 503) {
        if (opts.queueOnOffline !== false) enqueue(body);
        throw new FeedbackError('offline', t('feedback.offline'));
    }
    if (!r.ok) throw new FeedbackError('rejected', `${t('feedback.rejected')} (HTTP ${r.status})`);
    const j = await r.json().catch(() => ({})) as Partial<FeedbackResult> & { ok?: boolean };
    recordSent();
    return { id: String(j.id || ''), threadId: j.threadId || null, linked: !!j.linked, duplicate: !!j.duplicate, sampled: j.sampled !== false };
}

// ── offline queue ───────────────────────────────────────────────────────────
interface Queued { at: number; payload: FeedbackPayload }
function readQueue(): Queued[] { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as Queued[]; } catch { return []; } }
function writeQueue(q: Queued[]): void { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))); } catch { /* full or private */ } }

function enqueue(payload: FeedbackPayload): void {
    // A queued copy must fit in localStorage. Attachments are what makes a report big, and a
    // crash zip re-read from disk later is better than a report lost now.
    const slim: FeedbackPayload = { ...payload, attachments: [] };
    let size = 0;
    for (const a of payload.attachments || []) {
        if (size + a.data.length > QUEUE_ITEM_MAX_BYTES) { slim.meta = { ...(slim.meta || {}), droppedAttachments: (Number(slim.meta?.droppedAttachments) || 0) + 1 }; continue; }
        size += a.data.length; slim.attachments!.push(a);
    }
    writeQueue([...readQueue(), { at: Date.now(), payload: slim }]);
}
export function queuedCount(): number { return readQueue().length; }

/** Retry what could not be sent. Silent when nothing is queued or the server is still away;
 *  one toast per report that finally leaves. */
export async function flushFeedbackQueue(): Promise<number> {
    const q = readQueue();
    if (!q.length || !usesBetterCommunity()) return 0;
    if (!(await fetchFeedbackConfig())) return 0; // still unreachable — try again next start
    let sent = 0; const rest: Queued[] = [];
    for (const item of q) {
        try { await submitFeedback(item.payload, { queueOnOffline: false }); sent++; }
        catch (e) {
            const code = (e as FeedbackError).code;
            // Permanent refusals are dropped — retrying "filtered" forever is not a service.
            if (code === 'offline' || code === 'rate_limited') rest.push(item);
        }
    }
    writeQueue(rest);
    if (sent) {
        const msg = t('feedback.queueFlushed').replace('{n}', String(sent));
        toast(msg, 'success');
        recordNotification(msg, 'success', 'BMM');
    }
    return sent;
}

/** Called once at start-up: retry the queue after the links registry is loaded. */
export function initFeedback(): void {
    setTimeout(() => { flushFeedbackQueue().catch(() => {}); }, 15_000);
}

// ── helpers for the report modals ──────────────────────────────────────────
export function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = () => resolve(String(rd.result || '').split(',')[1] || '');
        rd.onerror = () => reject(rd.error);
        rd.readAsDataURL(file);
    });
}
export function textToBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}
/** Show the failure the way the user can act on it. Returns true when the report was queued. */
export function explainFeedbackError(e: unknown): boolean {
    const fe = e instanceof FeedbackError ? e : null;
    if (!fe) { toast(`${t('betahub.errorSubmit')}: ${(e as Error)?.message || e}`, 'error'); return false; }
    if (fe.code === 'offline') { toast(t('feedback.offlineQueued'), 'warning'); return true; }
    toast(fe.message, fe.code === 'rate_limited' ? 'warning' : 'error');
    return false;
}
