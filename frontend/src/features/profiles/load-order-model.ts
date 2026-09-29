// The activation order, as data: what the order view edits, with no DOM and no imports.
//
// The order is a list of mod ids, first applied first. When two active mods ship the same file,
// the LATER one wins it (the backend's rule, src-tauri/src/commands/mod_order.rs). The view edits
// a DRAFT of that list; everything it shows about the draft — who overrides whom, how many files
// would change hands — is computed here from the contested files the backend returned, so the
// indicators follow a drag instantly instead of waiting on a round trip per move.
//
// Kept import-free so tests/load-order.test.mjs can load the compiled module in plain node.

/** One active mod as `mod_order_get` returns it. */
export interface OrderedMod {
    id: string;
    name: string;
    position: number;
    contested: number;
    winning: number;
    overrides?: Rival[];
    overridden_by?: Rival[];
    archived?: boolean;
    added_at?: string;
}

/** A file more than one active mod ships: every provider (deployment order) and the winner. */
export interface ContestedFile {
    path: string;
    mods: string[];
    winner: string;
}

export interface Rival { id: string; name: string; files: number }

export type SortKey = 'current' | 'name-asc' | 'name-desc' | 'oldest' | 'newest';

/** Same ids in the same order. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** `order` with the item at `from` moved to `to` (both clamped). Never adds or drops an id. */
export function moveItem(order: readonly string[], from: number, to: number): string[] {
    const out = order.slice();
    if (from < 0 || from >= out.length) return out;
    const [id] = out.splice(from, 1);
    const at = Math.max(0, Math.min(out.length, to));
    out.splice(at, 0, id);
    return out;
}

/** Move one id up (-1) or down (+1) a step; to the top ('top') or bottom ('bottom'). */
export function moveId(order: readonly string[], id: string, where: -1 | 1 | 'top' | 'bottom'): string[] {
    const i = order.indexOf(id);
    if (i < 0) return order.slice();
    const to = where === 'top' ? 0 : where === 'bottom' ? order.length - 1 : i + where;
    return moveItem(order, i, to);
}

/**
 * The drop target of a drag: `id` placed before (`after` false) or after `target`.
 * Dropping onto itself is a no-op.
 */
export function dropAt(order: readonly string[], id: string, target: string, after: boolean): string[] {
    if (id === target) return order.slice();
    const rest = order.filter((x) => x !== id);
    const t = rest.indexOf(target);
    if (t < 0 || !order.includes(id)) return order.slice();
    rest.splice(after ? t + 1 : t, 0, id);
    return rest;
}

/**
 * A sort helper. `current` gives back `saved`; the others sort `order`. Ties keep their
 * current relative order (a stable sort), so sorting twice never shuffles equal names.
 */
export function sortOrder(order: readonly string[], mods: ReadonlyMap<string, OrderedMod>, key: SortKey, saved: readonly string[]): string[] {
    if (key === 'current') return saved.slice();
    const name = (id: string) => (mods.get(id)?.name || id).toLocaleLowerCase();
    const date = (id: string) => Date.parse(mods.get(id)?.added_at || '') || 0;
    const cmp: Record<Exclude<SortKey, 'current'>, (a: string, b: string) => number> = {
        'name-asc': (a, b) => name(a).localeCompare(name(b)),
        'name-desc': (a, b) => name(b).localeCompare(name(a)),
        // Oldest installed applied first: a mod added later is usually meant to change the
        // earlier ones, so newest-on-top is the "natural" order.
        'oldest': (a, b) => date(a) - date(b),
        'newest': (a, b) => date(b) - date(a),
    };
    const rank = new Map(order.map((id, i) => [id, i]));
    return order.slice().sort((a, b) => cmp[key](a, b) || (rank.get(a)! - rank.get(b)!));
}

/** Who wins `c` under `order`: the provider latest in the order. */
export function winnerUnder(c: ContestedFile, rank: ReadonlyMap<string, number>): string {
    let best = c.mods[0];
    for (const m of c.mods) if ((rank.get(m) ?? -1) > (rank.get(best) ?? -1)) best = m;
    return best;
}

/** How many contested files change winner between two orders of the same set. */
export function handoverCount(contested: readonly ContestedFile[], saved: readonly string[], draft: readonly string[]): number {
    const r0 = new Map(saved.map((id, i) => [id, i]));
    const r1 = new Map(draft.map((id, i) => [id, i]));
    let n = 0;
    for (const c of contested) if (winnerUnder(c, r0) !== winnerUnder(c, r1)) n++;
    return n;
}

/**
 * Per mod, under `order`: the mods it overrides (it is the winner, they lose) and the mods that
 * override it, with a file count each, most files first.
 */
export function rivalsUnder(
    contested: readonly ContestedFile[],
    order: readonly string[],
    nameOf: (id: string) => string,
): Map<string, { overrides: Rival[]; overriddenBy: Rival[]; contested: number; winning: number }> {
    const rank = new Map(order.map((id, i) => [id, i]));
    const beats = new Map<string, Map<string, number>>();
    const beaten = new Map<string, Map<string, number>>();
    const count = new Map<string, [number, number]>();
    const bump = (m: Map<string, Map<string, number>>, a: string, b: string) => {
        const inner = m.get(a) ?? new Map<string, number>();
        inner.set(b, (inner.get(b) ?? 0) + 1);
        m.set(a, inner);
    };
    for (const c of contested) {
        const w = winnerUnder(c, rank);
        for (const m of c.mods) {
            const e = count.get(m) ?? [0, 0];
            e[0]++;
            if (m === w) e[1]++;
            count.set(m, e);
            if (m !== w) { bump(beats, w, m); bump(beaten, m, w); }
        }
    }
    const flat = (m?: Map<string, number>): Rival[] => [...(m ?? new Map()).entries()]
        .map(([id, files]) => ({ id, name: nameOf(id), files }))
        .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
    const out = new Map<string, { overrides: Rival[]; overriddenBy: Rival[]; contested: number; winning: number }>();
    for (const id of order) {
        const [c, w] = count.get(id) ?? [0, 0];
        out.set(id, { overrides: flat(beats.get(id)), overriddenBy: flat(beaten.get(id)), contested: c, winning: w });
    }
    return out;
}
