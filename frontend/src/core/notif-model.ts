// The notification rules, as data: which group a message belongs to, how each group wants to
// be told (in the app, also as a system notification, or not at all), do-not-disturb and quiet
// hours, snoozing, and how long the history is kept. No DOM, no storage access of its own and
// no imports, so tests/notifications.test.mjs loads the compiled module in plain node.
//
// The one speaker is still ui/app.ts `toast()`; ui/notification-center.ts keeps the record.
// Both ask this file what to do, so the popup, the system notification and the history
// cannot disagree about a message.

export type NotifType = 'info' | 'success' | 'warning' | 'error';

/** The groups the centre and Settings show. A message's `source` maps onto one of them. */
export const NOTIF_GROUPS = ['updates', 'repos', 'scheduler', 'activity', 'community', 'app'] as const;
export type NotifGroup = (typeof NOTIF_GROUPS)[number];

/** How a group is delivered. `app` = popup + history; `system` = also an OS notification when
 *  BMM is not in front; `off` = history only (nothing pops up). An ERROR still pops up in the
 *  app whatever the group says: "I switched notifications off" is not consent to failing
 *  silently. */
export type DeliveryMode = 'app' | 'system' | 'off';
export const DELIVERY_MODES: readonly DeliveryMode[] = ['app', 'system', 'off'];

/** The group of a source label. The labels are what callers already pass to `toast()`; an
 *  unknown one is the app's own. */
export function groupOf(source: string | undefined | null): NotifGroup {
    const s = String(source || '').trim().toLowerCase();
    if (!s || s === 'bmm' || s === 'app' || s === 'conflicts') return 'app';
    if (s === 'updates' || s === 'update') return 'updates';
    if (s === 'repo' || s === 'repos' || s === 'follow' || s === 'followed') return 'repos';
    if (s === 'tasks' || s === 'scheduler' || s === 'automation') return 'scheduler';
    if (s === 'activity' || s === 'jobs') return 'activity';
    if (s === 'bcweb' || s === 'community' || s === 'bettercommunity' || s === 'news') return 'community';
    return 'app';
}

export interface QuietHours { enabled: boolean; from: string; to: string }

export interface NotifPrefs {
    modes: Partial<Record<NotifGroup, DeliveryMode>>;
    /** Do not disturb, switched on by hand: nothing pops up (errors still do, in the app). */
    dnd: boolean;
    /** Do not disturb on a schedule, local time, "HH:MM". `from` > `to` spans midnight. */
    quiet: QuietHours;
}

export const DEFAULT_PREFS: NotifPrefs = { modes: {}, dnd: false, quiet: { enabled: false, from: '22:00', to: '08:00' } };

export const PREFS_KEY = 'bmm.notif.prefs.v1';
/** The older per-source switch (a list of source labels whose popups were off). */
export const LEGACY_MUTE_KEY = 'bmm.muteSources';

function validMode(m: unknown): m is DeliveryMode {
    return m === 'app' || m === 'system' || m === 'off';
}

function validClock(s: unknown, fallback: string): string {
    const v = String(s ?? '');
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback;
}

/**
 * Preferences from what storage holds. Anything malformed falls back to the default, field by
 * field. `legacyMuted` is the old list of muted source labels: a group none of whose settings
 * exist yet, and whose old label was muted, starts at `off`, so an update does not bring back a
 * popup somebody had switched off.
 */
export function parsePrefs(raw: string | null | undefined, legacyMuted?: string | null): NotifPrefs {
    let obj: any = null;
    try { obj = raw ? JSON.parse(raw) : null; } catch { obj = null; }
    const modes: Partial<Record<NotifGroup, DeliveryMode>> = {};
    if (obj && typeof obj.modes === 'object' && obj.modes) {
        for (const g of NOTIF_GROUPS) if (validMode(obj.modes[g])) modes[g] = obj.modes[g];
    }
    if (!obj && legacyMuted) {
        try {
            const old = JSON.parse(legacyMuted);
            if (Array.isArray(old)) for (const label of old) modes[groupOf(String(label))] = 'off';
        } catch { /* nothing to migrate */ }
    }
    const q = obj && obj.quiet && typeof obj.quiet === 'object' ? obj.quiet : {};
    return {
        modes,
        dnd: !!(obj && obj.dnd === true),
        quiet: {
            enabled: q.enabled === true,
            from: validClock(q.from, DEFAULT_PREFS.quiet.from),
            to: validClock(q.to, DEFAULT_PREFS.quiet.to),
        },
    };
}

export function modeFor(prefs: NotifPrefs, group: NotifGroup): DeliveryMode {
    return prefs.modes[group] || 'app';
}

function minutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map((x) => Number(x));
    return h * 60 + m;
}

/** Whether `now` (local time) falls in the quiet window. Equal ends = never. */
export function inQuietHours(q: QuietHours, now: Date): boolean {
    if (!q.enabled) return false;
    const from = minutes(validClock(q.from, '22:00'));
    const to = minutes(validClock(q.to, '08:00'));
    if (from === to) return false;
    const t = now.getHours() * 60 + now.getMinutes();
    return from < to ? t >= from && t < to : t >= from || t < to;
}

/** Do not disturb right now, by hand or by the clock. */
export function isQuiet(prefs: NotifPrefs, now: Date): boolean {
    return prefs.dnd || inQuietHours(prefs.quiet, now);
}

export interface Delivery { toast: boolean; os: boolean }

/**
 * What to do with one message. `globalMuted` is the older all-popups switch. `focused` = BMM's
 * window is in front (a system notification is only for when it is not).
 */
export function deliveryFor(
    type: NotifType,
    group: NotifGroup,
    prefs: NotifPrefs,
    o: { now: Date; focused: boolean; globalMuted?: boolean },
): Delivery {
    const mode = modeFor(prefs, group);
    const quiet = isQuiet(prefs, o.now);
    if (type === 'error') return { toast: true, os: mode === 'system' && !o.focused && !quiet };
    if (mode === 'off' || quiet || o.globalMuted) return { toast: false, os: false };
    return { toast: true, os: mode === 'system' && !o.focused };
}

// ── History ─────────────────────────────────────────────────────────────────────────────

export interface NotifAction { kind: string; arg?: string; label?: string }

export interface NotifEntry {
    id: string;
    source: string;
    type: NotifType;
    message: string;
    ts: number;
    read?: boolean;
    /** How many times the same message arrived and was folded into this entry. */
    count?: number;
    /** Hidden until then (ms epoch); comes back unread. */
    snoozedUntil?: number;
    /** What « Open » does (resolved by the centre's action registry). */
    action?: NotifAction;
    /** Same key = same event: a repeat updates the entry instead of adding one. */
    key?: string;
}

export const HISTORY_MAX = 200;
export const HISTORY_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
/** Two identical messages closer than this are one event. */
export const REPEAT_MS = 2000;

/** Bounded: newest HISTORY_MAX, nothing older than the age limit (snoozed ones included). */
export function pruneHistory(list: NotifEntry[], now: number, max = HISTORY_MAX, maxAge = HISTORY_MAX_AGE_MS): NotifEntry[] {
    return list.filter((e) => now - e.ts <= maxAge).slice(0, max);
}

/**
 * Add a message to the history (newest first), folding a repeat: the same `key`, or the same
 * text from the same source within REPEAT_MS of the newest entry, updates that entry (count+1,
 * newer time, unread again) instead of adding one. Returns the new list and whether it folded.
 */
export function addEntry(
    list: NotifEntry[],
    e: Omit<NotifEntry, 'id' | 'ts'> & { id?: string },
    now: number,
): { list: NotifEntry[]; folded: boolean } {
    const out = list.slice();
    const i = e.key
        ? out.findIndex((x) => x.key === e.key)
        : out.length && out[0].message === e.message && out[0].source === e.source && now - out[0].ts < REPEAT_MS ? 0 : -1;
    if (i >= 0) {
        const prev = out[i];
        const next: NotifEntry = {
            ...prev,
            message: e.message,
            type: e.type,
            ts: now,
            read: false,
            count: (prev.count || 1) + 1,
            ...(e.action ? { action: e.action } : {}),
        };
        delete next.snoozedUntil;
        out.splice(i, 1);
        out.unshift(next);
        return { list: pruneHistory(out, now), folded: true };
    }
    const id = e.id || `n${now}_${Math.random().toString(36).slice(2, 8)}`;
    const entry: NotifEntry = { id, source: e.source, type: e.type, message: e.message, ts: now };
    if (e.action) entry.action = e.action;
    if (e.key) entry.key = e.key;
    out.unshift(entry);
    return { list: pruneHistory(out, now), folded: false };
}

export function isSnoozed(e: NotifEntry, now: number): boolean {
    return !!e.snoozedUntil && e.snoozedUntil > now;
}

/** Snooze presets, in ms from `now`; "tomorrow" = next 09:00 local. */
export function snoozeUntil(preset: '1h' | '4h' | 'tomorrow', now: Date): number {
    if (preset === '1h') return now.getTime() + 3600_000;
    if (preset === '4h') return now.getTime() + 4 * 3600_000;
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
}

/** Entries whose snooze ran out: unsnoozed and unread again (they are news again). */
export function wakeSnoozed(list: NotifEntry[], now: number): { list: NotifEntry[]; woke: number } {
    let woke = 0;
    const out = list.map((e) => {
        if (e.snoozedUntil && e.snoozedUntil <= now) {
            woke += 1;
            const n = { ...e, read: false };
            delete n.snoozedUntil;
            return n;
        }
        return e;
    });
    return { list: out, woke };
}

/** Unread and not snoozed: what the badge counts. */
export function unreadOf(list: readonly NotifEntry[], now: number): number {
    return list.filter((e) => !e.read && !isSnoozed(e, now)).length;
}

export interface NotifGroupView { group: NotifGroup; entries: NotifEntry[]; unread: number }

/** Entries grouped by NOTIF_GROUPS, each newest first; groups ordered by their newest entry. */
export function groupEntries(list: readonly NotifEntry[], now: number): NotifGroupView[] {
    const by = new Map<NotifGroup, NotifEntry[]>();
    for (const e of list) {
        const g = groupOf(e.source);
        if (!by.has(g)) by.set(g, []);
        by.get(g)!.push(e);
    }
    return [...by.entries()]
        .map(([group, entries]) => ({ group, entries, unread: entries.filter((e) => !e.read && !isSnoozed(e, now)).length }))
        .sort((a, b) => (b.entries[0]?.ts || 0) - (a.entries[0]?.ts || 0));
}

/** The identity of a popup on screen, for "this exact message is already showing". */
export function toastKey(message: string, type: string, source: string, key?: string): string {
    return key ? `k:${key}` : `${type}\u0000${source}\u0000${message}`;
}
