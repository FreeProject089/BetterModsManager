// Saved activation-order lists, as data: what the lists dialog edits and shows, with no DOM
// and no imports.
//
// A list is a named order that may name mods that are NOT active, or not installed here
// (src-tauri/src/models/order_list.rs). The backend resolves each entry against the library,
// strongest identity first (local id, content fingerprint, repo id, then the name), validates
// what is saved and does every enable / reorder (commands/order_lists.rs). This module only
// holds the draft the dialog edits and reads the plans the backend answers.
//
// Kept import-free so tests/order-lists.test.mjs can load the compiled module in plain node.

/** One entry: a mod named by everything that identifies it (order_share.rs `OrderEntry`). */
export interface OrderEntry {
    name: string;
    version?: string;
    content_id?: string | null;
    repo_mod_id?: string | null;
    source_repo?: string | null;
    id?: string | null;
}

export interface OrderList {
    id: string;
    name: string;
    description?: string;
    game?: string | null;
    /** Profiles the list is meant for; empty = any profile. */
    profile_ids: string[];
    entries: OrderEntry[];
    created_at?: string;
    updated_at?: string;
}

/** How an entry found its mod, strongest first (order_share.rs `MatchKind`). */
export type MatchKind = 'id' | 'content' | 'source' | 'name_version' | 'name' | 'ambiguous' | 'missing';
export const MATCH_KINDS: readonly MatchKind[] = ['id', 'content', 'source', 'name_version', 'name', 'ambiguous', 'missing'];

/** A match the reader should glance at: by name only, or a name whose version differs. */
export function isWeakMatch(kind: MatchKind, versionDiffers = false): boolean {
    return kind === 'name' || versionDiffers;
}

export type EntryState = 'active' | 'inactive' | 'missing';

export interface PlanRow {
    index: number;
    name: string;
    version: string;
    mod_id: string | null;
    quality: MatchKind;
    candidates: number;
    version_differs: boolean;
    mod_name: string | null;
    mod_version: string | null;
    state: EntryState;
    position: number;
    in_profile: boolean;
}

export interface NamedMod { id: string; name: string }

/** `order_list_plan`'s answer. */
export interface ListPlan {
    profile_id: string;
    rows: PlanRow[];
    to_activate: NamedMod[];
    already_active: number;
    missing: number;
    ambiguous: number;
    to_deactivate: NamedMod[];
    placed: number;
    order_after: string[];
    order_changed: boolean;
    handovers: number;
}

/** What a library mod (`get_all_mods`) gives an entry. */
export interface LibraryMod {
    id: string;
    name: string;
    version?: string;
    content_id?: string | null;
    repo_mod_id?: string | null;
    source_repo?: string | null;
    enabled?: boolean;
}

/** The entry that names `m` by everything it has. The backend refreshes it on save anyway. */
export function entryOf(m: LibraryMod): OrderEntry {
    const e: OrderEntry = { name: m.name || m.id, version: m.version || '', id: m.id };
    if (m.content_id) e.content_id = m.content_id;
    if (m.repo_mod_id) e.repo_mod_id = m.repo_mod_id;
    if (m.source_repo) e.source_repo = m.source_repo;
    return e;
}

/** A name as people mistype it: case, spaces, `_` and `-` do not count (Rust `norm_name`). */
export function normName(s: string): string {
    return String(s || '').replace(/[\s_-]+/g, '').toLowerCase();
}

/** `entries` with `mods` appended, in the given order, skipping mods already listed. */
export function addMods(entries: readonly OrderEntry[], mods: readonly LibraryMod[]): OrderEntry[] {
    const have = new Set(entries.map((e) => e.id).filter(Boolean) as string[]);
    const out = entries.slice();
    for (const m of mods) {
        if (!m?.id || have.has(m.id)) continue;
        have.add(m.id);
        out.push(entryOf(m));
    }
    return out;
}

/** Entry `from` moved to `to` (clamped). Never adds or drops one. */
export function moveEntry<T>(entries: readonly T[], from: number, to: number): T[] {
    const out = entries.slice();
    if (from < 0 || from >= out.length) return out;
    const [x] = out.splice(from, 1);
    out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
    return out;
}

export function removeEntry<T>(entries: readonly T[], at: number): T[] {
    return entries.filter((_, i) => i !== at);
}

/**
 * The library mods the "add" picker offers: not already listed, matching `query` (name,
 * spacing-insensitive), inactive ones included — a list is not limited to what is on.
 */
export function pickable(mods: readonly LibraryMod[], entries: readonly OrderEntry[], query: string, limit = 200): LibraryMod[] {
    const have = new Set(entries.map((e) => e.id).filter(Boolean) as string[]);
    const q = normName(query);
    return mods
        .filter((m) => m?.id && !have.has(m.id) && (!q || normName(m.name).includes(q)))
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .slice(0, limit);
}

/** A list as it would be saved: whether the draft differs from what is stored. */
export function sameList(a: OrderList | null, b: OrderList | null): boolean {
    if (!a || !b) return a === b;
    const key = (l: OrderList) => JSON.stringify([
        l.name.trim(), (l.description || '').trim(), [...l.profile_ids].sort(),
        l.entries.map((e) => [e.id || '', e.name, e.version || '', e.content_id || '', e.repo_mod_id || '', e.source_repo || '']),
    ]);
    return key(a) === key(b);
}

/** The counts the activation preview reads. */
export function activationCounts(p: ListPlan | null, exclusive: boolean): { enable: number; already: number; missing: number; disable: number; total: number } {
    if (!p) return { enable: 0, already: 0, missing: 0, disable: 0, total: 0 };
    return {
        enable: (p.to_activate || []).length,
        already: p.already_active || 0,
        missing: (p.missing || 0) + (p.ambiguous || 0),
        disable: exclusive ? (p.to_deactivate || []).length : 0,
        total: (p.rows || []).length,
    };
}

/** Rows sorted into what the match-quality chips count. */
export function qualityCounts(rows: readonly PlanRow[]): Record<MatchKind, number> {
    const out = Object.fromEntries(MATCH_KINDS.map((k) => [k, 0])) as Record<MatchKind, number>;
    for (const r of rows || []) if (r && r.quality in out) out[r.quality]++;
    return out;
}
