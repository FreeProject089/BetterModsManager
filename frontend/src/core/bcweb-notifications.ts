// bcweb-notifications.ts — the account's BCWEB notifications, in BMM's own centre.
//
// BMM's notification centre was built with a `source` on every entry precisely so it
// would not be BMM-only. This is the second source. Nothing about the panel changes.
//
// The key never passes through here. set/has live in Rust and the fetch is made by
// the Rust process, so this module can ask for notifications but cannot read the
// credential that gets them — a compromised page cannot exfiltrate what it was never
// handed.

import { invoke } from './api.js';
import { getLang } from './i18n.js';
import { recordNotification } from '../ui/notification-center.js';
import { bcRoot } from './links-config.js';

/** The newest createdAt already seen. Sent as `since` so the server returns only
 *  what arrived after it — a poller that re-reads the whole list every few minutes
 *  and de-duplicates locally is doing the server's job badly and paying for it in
 *  bandwidth every time. */
const SEEN_KEY = 'bmm.bcweb.notifSince';

/** Ten minutes. A notification is not urgent — that is what a notification IS — and
 *  a desktop app polling someone's server harder than that is a cost the user never
 *  agreed to pay on their behalf. */
const POLL_MS = 10 * 60 * 1000;

let _timer: ReturnType<typeof setInterval> | null = null;

function since(): string | null {
    try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

/** BCWEB's `kind` mapped onto the centre's four severities. Anything unrecognised
 *  becomes 'info' rather than being dropped: a notification whose type we do not
 *  know is still a notification, and silently discarding it would be the worst
 *  possible reading of "unknown". */
function severityOf(kind: string): 'info' | 'success' | 'warning' | 'error' {
    const k = String(kind || '').toLowerCase();
    if (k.includes('error') || k.includes('fail') || k.includes('ban') || k.includes('suspend')) return 'error';
    if (k.includes('warn') || k.includes('expir') || k.includes('quota') || k.includes('limit')) return 'warning';
    if (k.includes('paid') || k.includes('approved') || k.includes('published') || k.includes('success')) return 'success';
    return 'info';
}

/** Fetch once. Returns how many new entries were recorded. */
export async function pullBcwebNotifications(): Promise<number> {
    let raw: string;
    try {
        raw = await invoke('bcweb_notifications', { base: bcRoot(), since: since() }) as string;
    } catch (e) {
        // no_key is the normal state for anyone who has not linked an account, so it
        // is not an error to report — only a reason to stop. bad_key IS worth saying
        // once, because a revoked key fails silently forever otherwise.
        const msg = String(e);
        if (msg.includes('bad_key')) {
            recordNotification(
                'BetterCommunity rejected the stored API key — it may have been revoked or expired.',
                'warning', 'BCWEB');
            stopBcwebNotifications();
        }
        return 0;
    }

    let list: any[] = [];
    try { list = (JSON.parse(raw)?.notifications || []) as any[]; } catch { return 0; }
    if (!list.length) return 0;

    const fr = (getLang() || '').toLowerCase().startsWith('fr');

    // Oldest first, so the centre's newest-first list ends up in the right order —
    // recordNotification unshifts, so feeding it newest-first would invert them.
    for (const n of list.slice().reverse()) {
        // bodyFr is null for rows written from a single string; falling back to body
        // is what the website already does, so the two surfaces agree.
        const text = (fr && n.bodyFr) ? n.bodyFr : n.body;
        if (text) recordNotification(String(text), severityOf(n.kind), 'BCWEB');
    }

    // The watermark advances only after the entries are IN. Advancing it first would
    // lose the batch permanently if recording threw half-way — and a notification you
    // never saw is indistinguishable from one that was never sent.
    const newest = list.reduce((a: string, n: any) => (n.createdAt > a ? n.createdAt : a), since() || '');
    if (newest) { try { localStorage.setItem(SEEN_KEY, newest); } catch { /* watermark only */ } }

    return list.length;
}

export function stopBcwebNotifications(): void {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

/** Start polling, if a key is stored. Safe to call again — it replaces the timer
 *  rather than adding a second one, which is how a settings screen that re-runs its
 *  init ends up fetching twice as often every time it is opened. */
export async function startBcwebNotifications(): Promise<void> {
    stopBcwebNotifications();
    let ok = false;
    try { ok = await invoke('has_bcweb_api_key') as boolean; } catch { ok = false; }
    if (!ok) return;
    void pullBcwebNotifications();
    _timer = setInterval(() => { void pullBcwebNotifications(); }, POLL_MS);
}
