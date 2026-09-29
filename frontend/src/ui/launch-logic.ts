// launch-logic.ts — the decisions behind the launch deck, with no DOM and no imports.
//
// Everything here is a pure function so node --test can hold it to its promises without a
// webview: which steps open and in what order, which of them still block the close, and — for
// the announcements BetterCommunity sends — what is safe to show, to whom, and how many times.
//
// The deck itself (launch-deck.ts) and the feed client (launch-announcements.ts) only ask these
// questions; they never answer them a second way.

// ── steps ─────────────────────────────────────────────────────────────────────

/** What a provider can know when it decides whether its step belongs to this launch. */
export interface LaunchContext {
    /** First launch of this install (onboarding not shown yet). */
    firstRun: boolean;
    /** Reopened on purpose ("Show what's new"), not the start-up pass. */
    manual: boolean;
}

/** The part of a step the ordering and gating logic needs. */
export interface StepLike {
    id: string;
    priority: number;
    required?: boolean;
    when: (ctx: LaunchContext) => boolean | Promise<boolean>;
}

/**
 * Lower priority first; ties keep registration order (Array.prototype.sort is stable), so two
 * providers that picked the same number still come out the same way on every launch.
 */
export function orderSteps<T extends StepLike>(steps: readonly T[]): T[] {
    const safe = (p: number): number => (Number.isFinite(p) ? p : 1e9);
    return steps.slice().sort((a, b) => safe(a.priority) - safe(b.priority));
}

/**
 * Ask every provider, in parallel, whether its step belongs to this launch.
 *
 * A provider that throws, rejects or takes longer than `timeoutMs` is left out — silently for
 * an informational step, because one broken source must not keep every other step off the
 * screen, and the deck is never allowed to hang the start-up behind a slow answer. A REQUIRED
 * step is the exception: a provider that cannot answer is asked to answer "no" itself, since
 * guessing "yes" would block the close on a question nobody can put.
 *
 * With `deckEnabled` false only required steps survive (Settings → "Launch deck" off).
 * Duplicate ids keep the first registration.
 */
export async function collectEligible<T extends StepLike>(
    steps: readonly T[],
    ctx: LaunchContext,
    opts: { deckEnabled: boolean; timeoutMs?: number } = { deckEnabled: true },
): Promise<T[]> {
    const timeoutMs = opts.timeoutMs ?? 4000;
    const seen = new Set<string>();
    const unique = steps.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    const pool = opts.deckEnabled ? unique : unique.filter((s) => s.required);
    const verdicts = await Promise.all(pool.map(async (s) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const answer = await Promise.race([
                Promise.resolve().then(() => s.when(ctx)),
                new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
            ]);
            return answer === true;
        } catch {
            return false;
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }));
    return orderSteps(pool.filter((_, i) => verdicts[i]));
}

/** Index of the first required step not completed yet, or -1 when the deck may close. */
export function firstPendingRequired(steps: readonly { id: string; required?: boolean }[], done: ReadonlySet<string>): number {
    return steps.findIndex((s) => s.required && !done.has(s.id));
}

/**
 * The furthest step the reader may move to. A required step that is not answered is a wall:
 * everything before it and the step itself are reachable, nothing after it. Without one, every
 * step is.
 */
export function maxReachable(steps: readonly { id: string; required?: boolean }[], done: ReadonlySet<string>): number {
    const wall = firstPendingRequired(steps, done);
    return wall < 0 ? steps.length - 1 : wall;
}

/** Where a request to close lands: -1 = close now, otherwise the index of the step to show. */
export function closeTarget(steps: readonly { id: string; required?: boolean }[], done: ReadonlySet<string>): number {
    return firstPendingRequired(steps, done);
}

// ── semver ────────────────────────────────────────────────────────────────────

export interface Semver { major: number; minor: number; patch: number; pre: string[] }

const SEMVER = /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** A strict SemVer 2.0 parse (a leading "v" tolerated). Anything else is null, never a guess. */
export function parseSemver(v: unknown): Semver | null {
    if (typeof v !== 'string' || v.length > 64) return null;
    const m = SEMVER.exec(v.trim());
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

/** -1, 0 or 1, by SemVer precedence (a pre-release sorts before its release; build ignored). */
export function compareSemver(a: Semver, b: Semver): number {
    for (const k of ['major', 'minor', 'patch'] as const) {
        if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
    }
    if (!a.pre.length && !b.pre.length) return 0;
    if (!a.pre.length) return 1;
    if (!b.pre.length) return -1;
    const n = Math.max(a.pre.length, b.pre.length);
    for (let i = 0; i < n; i++) {
        const x = a.pre[i], y = b.pre[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
        if (xn && yn) { const d = Number(x) - Number(y); if (d) return d < 0 ? -1 : 1; continue; }
        if (xn !== yn) return xn ? -1 : 1;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

// ── announcements ─────────────────────────────────────────────────────────────

export type DisplayMode = 'always' | 'once' | 'times';

export interface Announcement {
    id: string;
    rev: number;
    kind: 'blog' | 'custom';
    title: string;
    summary: string;
    /** https only, or null — the card then has no "read" button. */
    url: string | null;
    /** https on an allowed host only, or null — the card then has no picture. */
    imageUrl: string | null;
    publishedAt: string | null;
    display: {
        mode: DisplayMode;
        times: number;
        from: number | null;     // epoch ms
        until: number | null;    // epoch ms
        minVersion: Semver | null;
        maxVersion: Semver | null;
    };
    priority: number;
}

/** Per id: the rev that was counted, how many times it was shown, and whether it was muted. */
export type DisplayCounts = Record<string, { rev: number; n: number; muted?: boolean; last?: number }>;

export const MAX_ITEMS = 10;
export const MAX_TITLE = 140;
export const MAX_SUMMARY = 400;

/**
 * Plain text, one line of it: control characters out (they include the bidi overrides that
 * can make a title read backwards), whitespace collapsed, capped. The deck renders these with
 * textContent, so this is not the XSS defence — it is what keeps a feed from putting a
 * 40 000-character or right-to-left-overridden headline on the reader's screen.
 */
export function plainText(v: unknown, max: number): string {
    if (typeof v !== 'string') return '';
    const cleaned = v
        .replace(/<[^>]{0,500}>/g, ' ')                                   // a stray tag reads as noise, not as markup
        .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

/** An absolute https URL with no embedded credentials, normalised, or null. */
export function safeHttpsUrl(v: unknown): string | null {
    if (typeof v !== 'string' || !v || v.length > 2048) return null;
    let u: URL;
    try { u = new URL(v.trim()); } catch { return null; }
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
    return u.href;
}

/** Whether `host` is one of `allowed`, or a subdomain of one of them. Exact labels, no substring match. */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
    const h = host.toLowerCase().replace(/\.$/, '');
    return allowed.some((a) => {
        const d = a.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
        return !!d && (h === d || h.endsWith(`.${d}`));
    });
}

function isoMs(v: unknown): number | null {
    if (typeof v !== 'string' || !v || v.length > 64) return null;
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
}

const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Turn whatever the server sent into announcements the deck may show, or an empty list.
 *
 * Never throws. An item is DROPPED, not repaired, when the part that decides who sees it is
 * unreadable: an id that is not an id, a date or a version bound that does not parse. Showing
 * an announcement written for 2.x to a 1.x install because its bound was misspelt is worse than
 * showing nothing. The cosmetic parts are repaired instead: a bad url or picture just goes.
 */
export function sanitizeFeed(raw: unknown, opts: { imageHosts: readonly string[] }): Announcement[] {
    if (!raw || typeof raw !== 'object') return [];
    const feed = raw as { v?: unknown; items?: unknown };
    if (feed.v !== 1 || !Array.isArray(feed.items)) return [];
    const out: Announcement[] = [];
    const ids = new Set<string>();
    for (const it of feed.items.slice(0, 50)) {
        if (out.length >= MAX_ITEMS) break;
        if (!it || typeof it !== 'object') continue;
        const o = it as Record<string, unknown>;
        const id = typeof o.id === 'string' ? o.id.trim() : '';
        if (!ID_RE.test(id) || ids.has(id)) continue;
        const title = plainText(o.title, MAX_TITLE);
        if (!title) continue;
        const rev = Number.isInteger(o.rev) && (o.rev as number) >= 0 ? (o.rev as number) : 0;
        const d = (o.display && typeof o.display === 'object' ? o.display : {}) as Record<string, unknown>;
        const mode: DisplayMode = d.mode === 'always' || d.mode === 'times' ? d.mode : 'once';
        const times = mode === 'times'
            ? (Number.isInteger(d.times) ? Math.min(100, Math.max(1, d.times as number)) : 1)
            : 1;
        // Present-but-unreadable bounds drop the item (see above); absent ones are null.
        const bound = <R>(v: unknown, parse: (x: unknown) => R | null): R | null | undefined => {
            if (v === null || v === undefined || v === '') return null;
            const r = parse(v);
            return r === null ? undefined : r;
        };
        const from = bound(d.from, isoMs);
        const until = bound(d.until, isoMs);
        const minVersion = bound(d.minVersion, parseSemver);
        const maxVersion = bound(d.maxVersion, parseSemver);
        if (from === undefined || until === undefined || minVersion === undefined || maxVersion === undefined) continue;
        let imageUrl = safeHttpsUrl(o.imageUrl);
        if (imageUrl && !hostAllowed(new URL(imageUrl).hostname, opts.imageHosts)) imageUrl = null;
        const pr = Number(o.priority);
        ids.add(id);
        out.push({
            id,
            rev,
            kind: o.kind === 'blog' ? 'blog' : 'custom',
            title,
            summary: plainText(o.summary, MAX_SUMMARY),
            url: safeHttpsUrl(o.url),
            imageUrl,
            publishedAt: isoMs(o.publishedAt) !== null ? new Date(isoMs(o.publishedAt) as number).toISOString() : null,
            display: { mode, times, from, until, minVersion, maxVersion },
            priority: Number.isFinite(pr) ? Math.max(-1000, Math.min(1000, pr)) : 0,
        });
    }
    // Highest priority first, then newest.
    return out.sort((a, b) => (b.priority - a.priority) || ((b.publishedAt || '') < (a.publishedAt || '') ? -1 : (b.publishedAt || '') > (a.publishedAt || '') ? 1 : 0));
}

/** Inside its date window and version range? (Independent of how often it was shown.) */
export function inWindow(a: Announcement, now: number, appVersion: string): boolean {
    const { from, until, minVersion, maxVersion } = a.display;
    if (from !== null && now < from) return false;
    if (until !== null && now > until) return false;
    if (minVersion || maxVersion) {
        const v = parseSemver(appVersion);
        if (!v) return false;   // cannot tell → a targeted announcement does not guess
        if (minVersion && compareSemver(v, minVersion) < 0) return false;
        if (maxVersion && compareSemver(v, maxVersion) > 0) return false;
    }
    return true;
}

/** How many times this rev has been shown here (a new rev starts again from zero). */
export function shownCount(a: Announcement, counts: DisplayCounts): { n: number; muted: boolean } {
    const c = counts[a.id];
    if (!c || c.rev !== a.rev) return { n: 0, muted: false };
    return { n: Number.isFinite(c.n) && c.n > 0 ? c.n : 0, muted: !!c.muted };
}

/** Should this announcement open at this launch? */
export function isDue(a: Announcement, now: number, appVersion: string, counts: DisplayCounts): boolean {
    if (!inWindow(a, now, appVersion)) return false;
    const { n, muted } = shownCount(a, counts);
    if (muted) return false;
    if (a.display.mode === 'always') return true;
    if (a.display.mode === 'once') return n < 1;
    return n < a.display.times;
}

/** The announcements to show at start-up, capped. */
export function dueAnnouncements(items: readonly Announcement[], now: number, appVersion: string, counts: DisplayCounts, max = 3): Announcement[] {
    return items.filter((a) => isDue(a, now, appVersion, counts)).slice(0, max);
}

const COUNTS_CAP = 200;

/** Record one display. Returns a new object; the oldest entries are pruned past a cap. */
export function recordShown(counts: DisplayCounts, a: Announcement, now: number): DisplayCounts {
    const { n, muted } = shownCount(a, counts);
    const next: DisplayCounts = { ...counts, [a.id]: { rev: a.rev, n: n + 1, last: now, ...(muted ? { muted: true } : {}) } };
    return pruneCounts(next);
}

/** "Don't show again" for this rev. A new rev of the same announcement is shown again. */
export function recordMuted(counts: DisplayCounts, a: Announcement, now: number, muted = true): DisplayCounts {
    const { n } = shownCount(a, counts);
    const entry: DisplayCounts[string] = { rev: a.rev, n, last: now };
    if (muted) entry.muted = true;
    return pruneCounts({ ...counts, [a.id]: entry });
}

function pruneCounts(c: DisplayCounts): DisplayCounts {
    const keys = Object.keys(c);
    if (keys.length <= COUNTS_CAP) return c;
    const keep = keys.sort((x, y) => (c[y].last || 0) - (c[x].last || 0)).slice(0, COUNTS_CAP);
    const out: DisplayCounts = {};
    for (const k of keep) out[k] = c[k];
    return out;
}

/** Parse stored counts defensively: a corrupt value is an empty history, never a crash. */
export function parseCounts(raw: string | null): DisplayCounts {
    if (!raw) return {};
    try {
        const v = JSON.parse(raw);
        if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
        const out: DisplayCounts = {};
        for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
            if (!ID_RE.test(k) || !e || typeof e !== 'object') continue;
            const r = e as Record<string, unknown>;
            if (!Number.isInteger(r.rev) || !Number.isFinite(Number(r.n))) continue;
            out[k] = { rev: r.rev as number, n: Math.max(0, Number(r.n)), ...(r.muted ? { muted: true } : {}), ...(Number.isFinite(Number(r.last)) ? { last: Number(r.last) } : {}) };
        }
        return out;
    } catch { return {}; }
}

// ── the feed request, with its dependencies handed in ─────────────────────────────

export interface FeedCache { url: string; etag: string; body: string; at: number }

export interface FeedDeps {
    online(): boolean;
    /** One GET. Resolves with what the server said; rejects on no answer at all. */
    request(url: string, headers: Record<string, string>): Promise<{ status: number; body?: string; etag?: string }>;
    readCache(): FeedCache | null;
    writeCache(c: FeedCache): void;
    now(): number;
}

export interface FeedResult { body: string | null; source: 'network' | 'not-modified' | 'none' }

/**
 * Ask for the feed once, the cheap way: If-None-Match when the cache holds this very URL, the
 * cached body on a 304, a new cache entry only for a 200 whose body IS a feed. Offline, an error,
 * a timeout or any other status is `none` — silent, and the cache is left as it was.
 */
export async function loadFeed(url: string, deps: FeedDeps): Promise<FeedResult> {
    if (!deps.online()) return { body: null, source: 'none' };
    const cache = deps.readCache();
    const headers: Record<string, string> = { Accept: 'application/json' };
    const sameUrl = !!cache && cache.url === url;
    if (sameUrl && cache!.etag) headers['If-None-Match'] = cache!.etag;
    let rep: { status: number; body?: string; etag?: string };
    try { rep = await deps.request(url, headers); } catch { return { body: null, source: 'none' }; }
    if (rep.status === 304 && sameUrl) {
        deps.writeCache({ ...cache!, at: deps.now() });
        return { body: cache!.body, source: 'not-modified' };
    }
    if (rep.status === 200 && typeof rep.body === 'string') {
        let isFeed = false;
        try { isFeed = JSON.parse(rep.body)?.v === 1; } catch { isFeed = false; }
        // A captive portal answering 200 with HTML must not wipe the last good copy.
        if (!isFeed) return { body: null, source: 'none' };
        if (rep.body.length <= 256 * 1024) deps.writeCache({ url, etag: typeof rep.etag === 'string' ? rep.etag : '', body: rep.body, at: deps.now() });
        return { body: rep.body, source: 'network' };
    }
    return { body: null, source: 'none' };
}
