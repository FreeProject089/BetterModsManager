/**
 * activity.ts — ONE registry for everything BMM is doing right now.
 *
 * Mods being turned on, a repo syncing, a catalogue app installing, an export, a scan, a
 * scheduled task, a Laya job: each subsystem used to show its progress only on its own screen,
 * so leaving the screen hid the work. Every one of them now also reports here, and the activity
 * centre (ui/activity-center.ts: a title-bar button with a count, and its panel) shows them all
 * in one place, with a Cancel where the subsystem can stop, and a short history of what ended.
 *
 * THE API
 *
 *   const h = startActivity({ kind: 'export', title: 'Export repo', cancel: () => stop() });
 *   h.update({ progress: 0.4, detail: 'mod 3 of 8' })   progress 0..1, or null = indeterminate
 *   h.done() / h.fail(err) / h.cancelled()              ends it; it moves to the history
 *   trackPromise(promise, { kind, title })              the same, driven by a promise
 *   subscribeActivity(fn)                               any change; returns the unsubscribe
 *   runningActivities() / activityHistory()             what the panel draws
 *   cancelActivity(id)                                  asks the subsystem to stop
 *   clearActivityHistory()
 *
 * `key` makes a start idempotent: starting with the key of an entry still running returns that
 * entry's handle, so two sources describing the same work (the command that runs it and the
 * progress event it emits) share one row.
 *
 * The history (last HISTORY_MAX) survives a reload through localStorage, wrapped: a webview
 * with storage blocked just keeps it for the session. This module has no DOM and no app
 * imports, so the node tests drive it directly.
 */

export type ActivityKind =
    | 'activation' | 'download' | 'sync' | 'scan' | 'install' | 'export' | 'import'
    | 'schedule' | 'ai' | 'repair' | 'hash' | 'benchmark' | 'other';

export type ActivityState = 'running' | 'done' | 'error' | 'cancelled';

export interface ActivityEntry {
    id: string;
    kind: ActivityKind;
    title: string;
    detail: string;
    /** 0..1, or null when the subsystem does not know how far it is. */
    progress: number | null;
    startedAt: number;
    endedAt?: number;
    state: ActivityState;
    /** The error, as text, for a failed entry. */
    error?: string;
    /** The subsystem can be asked to stop. */
    cancellable: boolean;
    /** A stop was asked and the subsystem has not ended yet. */
    cancelling: boolean;
    key?: string;
    source?: string;
}

export interface ActivityStart {
    kind: ActivityKind;
    title: string;
    detail?: string;
    progress?: number | null;
    /** How to stop it. Absent = no Cancel button. */
    cancel?: () => unknown;
    key?: string;
    source?: string;
    /**
     * A success shorter than this (ms) is not kept in the history: a background check that
     * took 80 ms is noise there. Failures are always kept.
     */
    ephemeralMs?: number;
}

export interface ActivityUpdate { progress?: number | null; detail?: string; title?: string }

export interface ActivityHandle {
    readonly id: string;
    update(u: ActivityUpdate): void;
    done(detail?: string): void;
    fail(err: unknown): void;
    cancelled(): void;
    /** true while the entry is still running. */
    isRunning(): boolean;
}

export interface ActivityDeps {
    now(): number;
    /** localStorage, or null. Every call is wrapped. */
    storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export const HISTORY_MAX = 30;
export const STORAGE_KEY = 'bmm.activity.history.v1';
const ERROR_MAX = 600;

let deps: ActivityDeps = defaults();
let seq = 0;
const running = new Map<string, ActivityEntry>();
const cancels = new Map<string, () => unknown>();
const ephemeral = new Map<string, number>();
const handles = new Map<string, ActivityHandle>();
let history: ActivityEntry[] | null = null;
const listeners = new Set<() => void>();

function defaults(): ActivityDeps {
    return {
        now: () => Date.now(),
        storage: () => {
            try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
        },
    };
}

/** Replace the clock or the storage (tests). */
export function configureActivity(over: Partial<ActivityDeps>): void {
    deps = { ...deps, ...over };
}

/** Forget everything (tests only). */
export function _resetActivityForTests(): void {
    deps = defaults();
    seq = 0;
    running.clear();
    cancels.clear();
    ephemeral.clear();
    handles.clear();
    history = null;
    listeners.clear();
}

function emit(): void {
    for (const fn of Array.from(listeners)) {
        try { fn(); } catch (e) { console.warn('[activity] listener failed', e); }
    }
}

export function subscribeActivity(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

// ── history persistence ────────────────────────────────────────────────────────────────────

const KINDS: readonly ActivityKind[] = ['activation', 'download', 'sync', 'scan', 'install', 'export', 'import', 'schedule', 'ai', 'repair', 'hash', 'benchmark', 'other'];
const STATES: readonly ActivityState[] = ['done', 'error', 'cancelled'];

/** Keep only well-formed rows: the stored value is data another build may have written. */
export function sanitizeHistory(raw: unknown): ActivityEntry[] {
    if (!Array.isArray(raw)) return [];
    const out: ActivityEntry[] = [];
    for (const r of raw) {
        if (!r || typeof r !== 'object') continue;
        const o = r as Record<string, unknown>;
        if (typeof o.id !== 'string' || typeof o.title !== 'string') continue;
        if (!KINDS.includes(o.kind as ActivityKind) || !STATES.includes(o.state as ActivityState)) continue;
        const startedAt = Number(o.startedAt);
        if (!Number.isFinite(startedAt)) continue;
        const endedAt = Number(o.endedAt);
        out.push({
            id: o.id,
            kind: o.kind as ActivityKind,
            title: o.title.slice(0, 300),
            detail: typeof o.detail === 'string' ? o.detail.slice(0, 300) : '',
            progress: o.state === 'done' ? 1 : null,
            startedAt,
            endedAt: Number.isFinite(endedAt) ? endedAt : startedAt,
            state: o.state as ActivityState,
            ...(typeof o.error === 'string' && o.error ? { error: o.error.slice(0, ERROR_MAX) } : {}),
            cancellable: false,
            cancelling: false,
        });
        if (out.length >= HISTORY_MAX) break;
    }
    return out;
}

function hist(): ActivityEntry[] {
    if (history) return history;
    history = [];
    try {
        const s = deps.storage();
        const raw = s ? s.getItem(STORAGE_KEY) : null;
        if (raw) history = sanitizeHistory(JSON.parse(raw));
    } catch { history = []; }
    return history;
}

function persist(): void {
    try {
        const s = deps.storage();
        if (!s) return;
        const h = hist();
        if (!h.length) { s.removeItem(STORAGE_KEY); return; }
        s.setItem(STORAGE_KEY, JSON.stringify(h.map((e) => ({
            id: e.id, kind: e.kind, title: e.title, detail: e.detail, startedAt: e.startedAt,
            endedAt: e.endedAt, state: e.state, ...(e.error ? { error: e.error } : {}),
        }))));
    } catch { /* storage full or blocked: the history stays in memory */ }
}

// ── lifecycle ──────────────────────────────────────────────────────────────────────────────

function clampProgress(p: unknown): number | null {
    if (p === null || p === undefined) return null;
    const n = Number(p);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(1, n));
}

/** An error of any shape, as one readable line. */
export function errorText(err: unknown): string {
    let s = '';
    if (typeof err === 'string') s = err;
    else if (err instanceof Error) s = err.message || String(err);
    else if (err && typeof err === 'object') {
        const m = (err as { message?: unknown; error?: unknown }).message ?? (err as { error?: unknown }).error;
        if (typeof m === 'string') s = m;
        else { try { s = JSON.stringify(err); } catch { s = String(err); } }
    } else if (err !== undefined && err !== null) s = String(err);
    s = s.trim();
    return s.length > ERROR_MAX ? `${s.slice(0, ERROR_MAX - 1)}…` : s;
}

function finish(id: string, state: Exclude<ActivityState, 'running'>, extra: { error?: string; detail?: string } = {}): void {
    const e = running.get(id);
    if (!e) return;
    running.delete(id);
    cancels.delete(id);
    handles.delete(id);
    const minMs = ephemeral.get(id) || 0;
    ephemeral.delete(id);
    e.state = state;
    e.endedAt = deps.now();
    e.cancellable = false;
    e.cancelling = false;
    if (state === 'done') e.progress = 1;
    if (extra.detail !== undefined) e.detail = extra.detail;
    if (extra.error) e.error = extra.error;
    const quick = state === 'done' && minMs > 0 && e.endedAt - e.startedAt < minMs;
    if (!quick) {
        const h = hist();
        h.unshift(e);
        if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
        persist();
    }
    emit();
}

function makeHandle(id: string): ActivityHandle {
    return {
        id,
        update(u) {
            const e = running.get(id);
            if (!e) return;
            let changed = false;
            if ('progress' in u) {
                const p = clampProgress(u.progress);
                if (p !== e.progress) { e.progress = p; changed = true; }
            }
            if (typeof u.detail === 'string' && u.detail !== e.detail) { e.detail = u.detail; changed = true; }
            if (typeof u.title === 'string' && u.title && u.title !== e.title) { e.title = u.title; changed = true; }
            if (changed) emit();
        },
        done(detail) { finish(id, 'done', detail !== undefined ? { detail } : {}); },
        fail(err) {
            const e = running.get(id);
            // A failure that arrives after someone asked to stop is the stop, not an error.
            if (e?.cancelling) { finish(id, 'cancelled'); return; }
            finish(id, 'error', { error: errorText(err) || 'error' });
        },
        cancelled() { finish(id, 'cancelled'); },
        isRunning() { return running.has(id); },
    };
}

export function startActivity(o: ActivityStart): ActivityHandle {
    if (o.key) {
        for (const e of running.values()) {
            if (e.key === o.key) {
                const h = handles.get(e.id)!;
                const u: ActivityUpdate = {};
                if (o.detail) u.detail = o.detail;
                if (o.progress !== undefined) u.progress = o.progress;
                if (o.cancel && !cancels.has(e.id)) { cancels.set(e.id, o.cancel); e.cancellable = true; emit(); }
                h.update(u);
                return h;
            }
        }
    }
    seq += 1;
    const id = `act-${deps.now().toString(36)}-${seq}`;
    const e: ActivityEntry = {
        id,
        kind: KINDS.includes(o.kind) ? o.kind : 'other',
        title: String(o.title || ''),
        detail: o.detail || '',
        progress: clampProgress(o.progress),
        startedAt: deps.now(),
        state: 'running',
        cancellable: typeof o.cancel === 'function',
        cancelling: false,
        ...(o.key ? { key: o.key } : {}),
        ...(o.source ? { source: o.source } : {}),
    };
    running.set(id, e);
    if (o.cancel) cancels.set(id, o.cancel);
    if (o.ephemeralMs && o.ephemeralMs > 0) ephemeral.set(id, o.ephemeralMs);
    const h = makeHandle(id);
    handles.set(id, h);
    emit();
    return h;
}

/** The handle of the running entry with this key, if any. */
export function findActivity(key: string): ActivityHandle | null {
    for (const e of running.values()) if (e.key === key) return handles.get(e.id) || null;
    return null;
}

/** Run `p` as an activity: done when it resolves, failed when it rejects. Returns `p`. */
export function trackPromise<T>(p: Promise<T>, o: ActivityStart): Promise<T> {
    const h = startActivity(o);
    p.then(() => h.done(), (err) => h.fail(err));
    return p;
}

/** Ask the subsystem behind `id` to stop. The entry ends when the subsystem says it ended. */
export async function cancelActivity(id: string): Promise<boolean> {
    const e = running.get(id);
    const fn = cancels.get(id);
    if (!e || !fn || e.cancelling) return false;
    e.cancelling = true;
    emit();
    try {
        await fn();
        return true;
    } catch (err) {
        const still = running.get(id);
        if (still) { still.cancelling = false; emit(); }
        console.warn('[activity] cancel failed', err);
        return false;
    }
}

/** Oldest first: the order they started in. */
export function runningActivities(): ActivityEntry[] {
    return Array.from(running.values()).sort((a, b) => a.startedAt - b.startedAt);
}

/** Newest first. */
export function activityHistory(): readonly ActivityEntry[] {
    return hist();
}

export function clearActivityHistory(): void {
    history = [];
    persist();
    emit();
}

/** The overall progress for the badge ring: mean of the determinate ones, null if none. */
export function overallProgress(list: readonly ActivityEntry[] = runningActivities()): number | null {
    const known = list.filter((e) => e.progress !== null);
    if (!known.length) return null;
    return known.reduce((s, e) => s + (e.progress as number), 0) / known.length;
}
