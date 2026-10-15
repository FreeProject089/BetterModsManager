/**
 * history-journal.ts — what changed in BMM, for the History window (features/mods/history.ts).
 *
 * The mods already keep their own log on disk (commands/history.rs: enabled, disabled, deleted,
 * edited, per profile). Everything else that changes BMM's state left no trace: switching
 * profile, a setting, following a repo, an update. This journal is that trace. It listens to
 * the commands that change those things as they SUCCEED (api.ts addInvokeListener) and keeps a
 * short, readable entry for each, with the values before and after when there are any.
 *
 *   settings   update_settings, diffed against the last get_settings / update_settings seen.
 *              Secrets (tokens, keys, passwords) and noise (window sizes, « last seen »
 *              stamps) are never recorded. A burst of changes to the same settings within a
 *              few seconds is one entry.
 *   profiles   set_active_profile (from → to), create_profile, update_profile, delete_profile.
 *   repos      repo_follow_set / repo_follow_remove, add / remove_community_source.
 *   updates    recordHistory() from ui/update-notes.ts (a check's result) and, at start-up, a
 *              version different from the last one seen (« Updated BMM from A to B »).
 *
 * Kept in localStorage (the last MAX entries), wrapped: a webview with storage blocked keeps
 * the session's entries only. No DOM and no app imports: the node tests drive it directly.
 */

export type HistoryType = 'mods' | 'profiles' | 'settings' | 'updates' | 'repos' | 'other';

export interface HistoryChange { field: string; old: unknown; new: unknown }

export interface JournalEntry {
    id: string;
    at: number;
    type: HistoryType;
    /** What happened, a stable code the window turns into a sentence (`profile.switch`, …). */
    action: string;
    /** What it happened to: a profile name, a URL, a version. */
    subject: string;
    detail?: string;
    changes?: HistoryChange[];
}

export const JOURNAL_KEY = 'bmm.history.journal.v1';
export const VERSION_KEY = 'bmm.history.lastVersion';
export const JOURNAL_MAX = 300;
/** Changes to the same settings closer than this are one entry. */
export const MERGE_MS = 15_000;

/** Never written down, whatever the setting is called. */
const SECRET = /token|secret|password|passwd|api_?key|private|credential|\bpat\b|_pat$|auth/i;
/** Settings that move by themselves or on every resize: not something anybody « changed ». */
const NOISE = /window|geometry|width|height|position|last_|_seen|seen_|_at$|timestamp|recent|cache|collapsed|scroll|onboarding|counter|_count$|stats|sort_by/i;

let _entries: JournalEntry[] | null = null;
const _subs = new Set<() => void>();
let _settings: Record<string, unknown> | null = null;
let _profiles = new Map<string, string>();
let _activeProfile: string | null = null;
let _wired = false;

function storage(): Storage | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }

function load(): JournalEntry[] {
    if (_entries) return _entries;
    _entries = [];
    try {
        const raw = JSON.parse(storage()?.getItem(JOURNAL_KEY) || '[]');
        if (Array.isArray(raw)) {
            _entries = raw.filter((e) => e && typeof e.id === 'string' && typeof e.at === 'number' && typeof e.type === 'string' && typeof e.action === 'string')
                .map((e) => ({ ...e, subject: String(e.subject ?? '') })).slice(-JOURNAL_MAX);
        }
    } catch { _entries = []; }
    return _entries;
}

function save(): void {
    try { storage()?.setItem(JOURNAL_KEY, JSON.stringify(load().slice(-JOURNAL_MAX))); } catch { /* full or blocked: the session keeps it */ }
    _subs.forEach((f) => { try { f(); } catch { /* a subscriber never breaks the journal */ } });
}

let _seq = 0;
export function recordHistory(e: Omit<JournalEntry, 'id' | 'at'> & { at?: number }): JournalEntry {
    const entry: JournalEntry = { ...e, id: `j${Date.now().toString(36)}${(_seq++).toString(36)}`, at: e.at ?? Date.now() };
    const list = load();
    list.push(entry);
    if (list.length > JOURNAL_MAX) list.splice(0, list.length - JOURNAL_MAX);
    save();
    return entry;
}

export function journalEntries(): readonly JournalEntry[] { return load(); }

export function clearJournal(): void { _entries = []; save(); }

/** Drop what is older than `days` (0 = keep everything), like the mods' own retention. */
export function pruneJournal(days: number, now = Date.now()): void {
    if (!days || days < 0) return;
    const cut = now - days * 86_400_000;
    const list = load();
    const kept = list.filter((e) => e.at >= cut);
    if (kept.length !== list.length) { _entries = kept; save(); }
}

export function subscribeJournal(fn: () => void): () => void { _subs.add(fn); return () => { _subs.delete(fn); }; }

/** A value small enough to keep: long strings and big objects are cut. */
function keep(v: unknown): unknown {
    if (v === undefined) return null;
    if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
    if (v && typeof v === 'object') {
        const s = JSON.stringify(v);
        return s.length > 200 ? `${s.slice(0, 200)}…` : v;
    }
    return v;
}

/** The settings that differ between two snapshots, secrets and noise left out. Pure. */
export function diffSettings(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined): HistoryChange[] {
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [];
    const out: HistoryChange[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
        if (SECRET.test(k) || NOISE.test(k)) continue;
        const a = before[k], b = after[k];
        if (JSON.stringify(a) === JSON.stringify(b)) continue;
        out.push({ field: k, old: keep(a), new: keep(b) });
    }
    return out;
}

/** Fold `next` into the changes of an earlier entry: first old value, latest new value. */
export function mergeChanges(prev: HistoryChange[], next: HistoryChange[]): HistoryChange[] {
    const map = new Map(prev.map((c) => [c.field, { ...c }]));
    for (const c of next) {
        const p = map.get(c.field);
        if (p) p.new = c.new; else map.set(c.field, { ...c });
    }
    return [...map.values()].filter((c) => JSON.stringify(c.old) !== JSON.stringify(c.new));
}

function profileName(id: unknown): string {
    const s = String(id ?? '');
    return _profiles.get(s) || s;
}

/** What one successful command means for the journal. Exported for the tests. */
export function onCommand(command: string, args: Record<string, unknown>, result: unknown, now = Date.now()): void {
    switch (command) {
        case 'get_settings':
            if (result && typeof result === 'object') _settings = JSON.parse(JSON.stringify(result));
            return;
        case 'update_settings': {
            const next = (args?.settings && typeof args.settings === 'object') ? args.settings as Record<string, unknown> : null;
            if (!next) return;
            const changes = diffSettings(_settings, next);
            _settings = JSON.parse(JSON.stringify(next));
            if (!changes.length) return;
            const list = load();
            const last = list[list.length - 1];
            if (last && last.type === 'settings' && now - last.at < MERGE_MS) {
                last.changes = mergeChanges(last.changes || [], changes);
                last.at = now;
                if (!last.changes.length) list.pop();
                save();
                return;
            }
            recordHistory({ type: 'settings', action: 'settings.change', subject: changes.map((c) => c.field).join(', '), changes, at: now });
            return;
        }
        case 'get_profiles':
            if (Array.isArray(result)) _profiles = new Map(result.filter((p) => p && p.id).map((p) => [String(p.id), String(p.name ?? p.id)]));
            return;
        case 'get_active_profile_id':
            if (typeof result === 'string') _activeProfile = result;
            return;
        case 'set_active_profile': {
            const id = String(args?.profileId ?? '');
            if (!id || id === _activeProfile) { _activeProfile = id || _activeProfile; return; }
            const prev = _activeProfile;
            _activeProfile = id;
            recordHistory({
                type: 'profiles', action: 'profile.switch', subject: profileName(id), at: now,
                changes: prev ? [{ field: 'profile', old: profileName(prev), new: profileName(id) }] : undefined,
            });
            return;
        }
        case 'create_profile': {
            const r = result as { id?: string; name?: string } | null;
            const name = r?.name || String((args?.payload as any)?.name ?? '');
            if (r?.id) _profiles.set(String(r.id), name);
            recordHistory({ type: 'profiles', action: 'profile.create', subject: name, at: now });
            return;
        }
        case 'update_profile': {
            const name = String((args?.payload as any)?.name ?? profileName(args?.profileId));
            const old = profileName(args?.profileId);
            if (args?.profileId) _profiles.set(String(args.profileId), name);
            recordHistory({ type: 'profiles', action: 'profile.edit', subject: name, at: now,
                changes: old && old !== name && old !== String(args?.profileId) ? [{ field: 'name', old, new: name }] : undefined });
            return;
        }
        case 'delete_profile':
            recordHistory({ type: 'profiles', action: 'profile.delete', subject: profileName(args?.profileId), at: now });
            return;
        case 'repo_follow_set': {
            const patch = (args?.patch || {}) as Record<string, unknown>;
            const url = String(args?.url ?? '');
            const name = String((result as any)?.name || args?.name || url);
            const keys = Object.keys(patch);
            const follow = keys.length === 1 && patch.enabled === true;
            recordHistory({ type: 'repos', action: follow ? 'repo.follow' : 'repo.followEdit', subject: name, detail: url !== name ? url : undefined, at: now,
                changes: follow ? undefined : keys.filter((k) => !SECRET.test(k)).map((k) => ({ field: k, old: null, new: keep(patch[k]) })) });
            return;
        }
        case 'repo_follow_remove':
            recordHistory({ type: 'repos', action: 'repo.unfollow', subject: String(args?.url ?? ''), at: now });
            return;
        case 'add_community_source':
            recordHistory({ type: 'repos', action: 'source.add', subject: String(args?.url ?? ''), at: now });
            return;
        case 'remove_community_source':
            recordHistory({ type: 'repos', action: 'source.remove', subject: String(args?.url ?? ''), at: now });
            return;
    }
}

export interface JournalDeps {
    addInvokeListener: (fn: (command: string, args: Record<string, unknown>, result: unknown) => void) => () => void;
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/** Start listening (once) and note an update since the last start. */
export function initHistoryJournal(deps: JournalDeps): void {
    if (_wired) return;
    _wired = true;
    deps.addInvokeListener((c, a, r) => { try { onCommand(c, a, r); } catch { /* the journal never breaks a command */ } });
    void deps.invoke('get_app_version').then((v) => {
        if (typeof v !== 'string' || !v) return;
        const st = storage();
        let prev: string | null = null;
        try { prev = st?.getItem(VERSION_KEY) ?? null; } catch { prev = null; }
        if (prev && prev !== v) recordHistory({ type: 'updates', action: 'update.installed', subject: v, changes: [{ field: 'version', old: prev, new: v }] });
        try { st?.setItem(VERSION_KEY, v); } catch { /* blocked: told again next start */ }
    }).catch(() => undefined);
}

/** For the tests. */
export function _resetJournalForTests(): void { _entries = null; _settings = null; _profiles = new Map(); _activeProfile = null; _wired = false; _subs.clear(); }
