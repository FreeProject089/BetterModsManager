// launch-announcements.ts — what BetterCommunity wants BMM users to see when BMM opens.
//
// The admin picks, on BCWEB, a blog post, "the latest BMM blog post" or a custom card, and how
// often it shows. BMM reads GET <BetterCommunity>/api/bmm/launch?version=…&lang=… and turns each
// item into a step of the launch deck.
//
// The rules this file keeps:
//   · It never delays the start-up. The request starts early (prefetchLaunchFeed) and the deck
//     waits for it at most WAIT_AT_OPEN_MS; a slower answer is added to a deck already open, or
//     serves from the on-disk cache next time.
//   · Offline is silent. No toast, no error, no retry loop: the cached copy or nothing.
//   · It is cached with the server's ETag and asked again with If-None-Match, so an unchanged
//     feed costs a 304 and no body.
//   · It goes through the Rust `http_request` command, which attaches NO identity (no creator
//     id, no key proof): a public feed read at every launch must not become a "this install
//     started" ping. The webview could not fetch it anyway (CORS).
//   · Everything the server sends is untrusted: launch-logic.ts sanitizes it (plain text,
//     https-only links opened in the system browser, pictures only from BetterCommunity).
//   · Display counts are local, per id + rev: a new rev of the same card starts from zero.

import { invoke } from '../core/api.js';
import { getLang, t } from '../core/i18n.js';
import { bcApi, bcRoot } from '../core/links-config.js';
import {
    sanitizeFeed, dueAnnouncements, inWindow, parseCounts, recordShown, recordMuted, shownCount, loadFeed,
    type Announcement, type DisplayCounts, type FeedCache,
} from './launch-logic.js';
import { addLaunchStepLive, isLaunchDeckOpen, type LaunchStep, type LaunchContext } from './launch-deck.js';

/** '0' = no announcements at all: nothing is fetched and nothing is shown. */
export const ANN_ENABLED_KEY = 'bmm_launch_announcements_enabled';
const CACHE_KEY = 'bmm_launch_feed_cache';
const COUNTS_KEY = 'bmm_launch_ann_counts';
const FETCH_TIMEOUT_MS = 4000;
export const WAIT_AT_OPEN_MS = 1500;
/** At most this many announcements per launch; the rest wait for the next one. */
const MAX_PER_LAUNCH = 3;
/** "What's new", opened on purpose: every card still in its window, up to this many. */
const MAX_ITEMS_MANUAL = 10;
const PRIORITY_BASE = 80;

export function announcementsEnabled(): boolean {
    try { return localStorage.getItem(ANN_ENABLED_KEY) !== '0'; } catch { return true; }
}
export function setAnnouncementsEnabled(on: boolean): void {
    try { localStorage.setItem(ANN_ENABLED_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

function readCache(): FeedCache | null {
    try {
        const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (v && typeof v.url === 'string' && typeof v.body === 'string') {
            return { url: v.url, etag: typeof v.etag === 'string' ? v.etag : '', body: v.body, at: Number(v.at) || 0 };
        }
    } catch { /* corrupt → no cache */ }
    return null;
}
function writeCache(c: FeedCache): void {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* quota: next launch fetches again */ }
}

function readCounts(): DisplayCounts {
    try { return parseCounts(localStorage.getItem(COUNTS_KEY)); } catch { return {}; }
}
function writeCounts(c: DisplayCounts): void {
    try { localStorage.setItem(COUNTS_KEY, JSON.stringify(c)); } catch { /* private mode */ }
}

let _version: string | null = null;
export async function appVersion(): Promise<string> {
    if (_version !== null) return _version;
    try { _version = String(await (window as any).__TAURI__?.app?.getVersion?.() || ''); }
    catch { _version = ''; }
    return _version;
}

function feedLang(): 'fr' | 'en' { return getLang() === 'fr' ? 'fr' : 'en'; }

function feedUrl(version: string, lang: string): string {
    return `${bcApi()}/bmm/launch?version=${encodeURIComponent(version)}&lang=${lang}`;
}

/** Pictures come from BetterCommunity or not at all (a remote image is a request to its host). */
function imageHosts(): string[] {
    const hosts = ['bettercommunity.ch'];
    try { const u = new URL(bcRoot()); if (u.protocol === 'https:') hosts.push(u.hostname); } catch { /* production only */ }
    return hosts;
}

function parseBody(body: string): Announcement[] {
    try { return sanitizeFeed(JSON.parse(body), { imageHosts: imageHosts() }); } catch { return []; }
}

/** The cached feed for the current version + language, if there is one. */
export async function cachedAnnouncements(): Promise<Announcement[]> {
    const c = readCache();
    if (!c) return [];
    return c.url === feedUrl(await appVersion(), feedLang()) ? parseBody(c.body) : [];
}

let _fetch: Promise<Announcement[] | null> | null = null;

/**
 * Start (once per launch) the request for the feed. Resolves with the fresh announcements, the
 * cached ones on a 304, or null when there is no answer (off, offline, error). Never rejects.
 */
export function prefetchLaunchFeed(): Promise<Announcement[] | null> {
    if (_fetch) return _fetch;
    _fetch = (async (): Promise<Announcement[] | null> => {
        if (!announcementsEnabled()) return null;
        try {
            const url = feedUrl(await appVersion(), feedLang());
            const r = await loadFeed(url, {
                online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
                request: async (u, headers) => {
                    const rep: any = await invoke('http_request', { url: u, method: 'GET', headers, body: null, timeoutMs: FETCH_TIMEOUT_MS }, { quiet: true });
                    return { status: Number(rep?.status), body: rep?.body, etag: rep?.etag };
                },
                readCache,
                writeCache,
                now: () => Date.now(),
            });
            return r.body === null ? null : parseBody(r.body);
        } catch (e) {
            // Offline, DNS, timeout, a server that is down: all the same to the reader — nothing.
            console.debug('[BMM] launch feed unavailable:', e);
            return null;
        }
    })();
    return _fetch;
}

/** Wait for the fresh feed at most `ms`; fall back to the cache. */
async function freshOrCached(ms: number): Promise<{ items: Announcement[]; fresh: boolean }> {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), ms));
    const fresh = await Promise.race([prefetchLaunchFeed(), timeout]);
    if (fresh) return { items: fresh, fresh: true };
    return { items: await cachedAnnouncements(), fresh: false };
}

/** One deck step for one announcement. */
function stepFor(a: Announcement, order: number, ctx: LaunchContext): LaunchStep {
    return {
        id: `ann:${a.id}`,
        priority: PRIORITY_BASE + order / 100,
        when: () => true,
        title: () => a.title,
        kicker: () => (a.kind === 'blog' ? t('launch.ann.blog') : t('launch.ann.news')),
        render: (el) => renderAnnouncement(el, a),
        // A display counts when it is SEEN, not when it was eligible: a card behind a deck the
        // reader closed on step one has not been shown. A deck the reader opened on purpose
        // ("What's new") does not spend a display either.
        onShown: () => { if (!ctx.manual) writeCounts(recordShown(readCounts(), a, Date.now())); },
        mute: {
            get: () => shownCount(a, readCounts()).muted,
            set: (on) => writeCounts(recordMuted(readCounts(), a, Date.now(), on)),
            label: () => t('launch.mute'),
        },
    };
}

function renderAnnouncement(el: HTMLElement, a: Announcement): void {
    el.classList.add('ld-ann');
    if (a.imageUrl) {
        const img = document.createElement('img');
        img.className = 'ld-ann-img';
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => img.remove(), { once: true });
        img.src = a.imageUrl;
        el.appendChild(img);
    }
    if (a.publishedAt) {
        const d = document.createElement('p');
        d.className = 'ld-ann-date';
        try { d.textContent = new Date(a.publishedAt).toLocaleDateString(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' }); }
        catch { d.textContent = a.publishedAt.slice(0, 10); }
        el.appendChild(d);
    }
    if (a.summary) {
        const p = document.createElement('p');
        p.className = 'ld-ann-summary';
        p.textContent = a.summary;
        el.appendChild(p);
    }
    if (a.url) {
        const url = a.url;
        const row = document.createElement('div');
        row.className = 'ld-actions';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-secondary';
        b.textContent = a.kind === 'blog' ? t('launch.ann.readPost') : t('launch.ann.open');
        let host = '';
        try { host = new URL(url).hostname; } catch { /* sanitized already */ }
        b.title = t('launch.ann.opensIn', { host });
        // The system browser, through the backend: window.open is a no-op in the webview.
        b.addEventListener('click', () => { void invoke('open_external', { url }).catch(() => { /* the browser refused */ }); });
        row.appendChild(b);
        el.appendChild(row);
    }
}

/**
 * The announcement steps for this launch (or for a "What's new" the reader asked for, which
 * shows every card still in its window, whatever the counters say). Also arranges for a feed
 * that answers late to add its new cards to the deck while it is open.
 */
export async function announcementSteps(ctx: LaunchContext): Promise<LaunchStep[]> {
    if (!announcementsEnabled()) return [];
    if (ctx.firstRun && !ctx.manual) return [];
    const version = await appVersion();
    const { items, fresh } = await freshOrCached(ctx.manual ? FETCH_TIMEOUT_MS : WAIT_AT_OPEN_MS);
    const pick = (list: Announcement[]): Announcement[] => (ctx.manual
        ? list.filter((a) => inWindow(a, Date.now(), version)).slice(0, MAX_ITEMS_MANUAL)
        : dueAnnouncements(list, Date.now(), version, readCounts(), MAX_PER_LAUNCH));
    const chosen = pick(items);
    if (!fresh && !ctx.manual) {
        // Arrived after the deck was drawn: add what is new, if the deck is still open.
        void prefetchLaunchFeed().then(async (late) => {
            if (!late || !isLaunchDeckOpen()) return;
            const have = new Set(chosen.map((a) => a.id));
            const extra = pick(late).filter((a) => !have.has(a.id)).slice(0, Math.max(0, MAX_PER_LAUNCH - chosen.length));
            let i = chosen.length;
            for (const a of extra) await addLaunchStepLive(stepFor(a, i++, ctx));
        });
    }
    return chosen.map((a, i) => stepFor(a, i, ctx));
}

