// The conflicts view, as data: the DRAFT the user edits (an activation order, per-file pins,
// mods to disable) and the small operations on it. No DOM, no network, one import (another
// import-free model), so tests/conflicts-view.test.mjs loads the compiled module in plain node.
//
// What this file does NOT do is decide who wins a file. That rule lives in Rust
// (src-tauri/src/commands/mod_order.rs, `winner_of`): the view sends the draft to
// `conflict_plan` and draws the answer, so what the screen says and what deployment does
// cannot drift apart.

import { moveId, sameOrder } from '../profiles/load-order-model.js';

export { moveId, sameOrder };

/** relative path -> the mod whose copy is kept (Profile.file_winners). */
export type Pins = Record<string, string>;

export interface Draft {
    /** Every active mod, first applied first (the mods to disable included). */
    order: string[];
    pins: Pins;
    /** Mods the draft turns off. */
    disable: string[];
}

/** A contested file as `conflict_plan` returns it. */
export interface PlanFile { path: string; mods: string[]; winner: string; pinned?: boolean }
export interface PlanPair { a: string; b: string; files: number; a_wins: number; b_wins: number; pinned: number }
export interface PlanMove { path: string; from: string; to: string }
export interface PlanView {
    profile_id: string;
    order: string[];
    names: Record<string, string>;
    pins: Pins;
    files: PlanFile[];
    files_total: number;
    pairs: PlanPair[];
    handovers: PlanMove[];
    handovers_total: number;
}

export function cloneDraft(d: Draft): Draft {
    return { order: d.order.slice(), pins: { ...d.pins }, disable: d.disable.slice() };
}

/** Same order, same pins, same mods to disable. */
export function sameDraft(a: Draft, b: Draft): boolean {
    if (!sameOrder(a.order, b.order)) return false;
    const da = [...a.disable].sort();
    const db = [...b.disable].sort();
    if (!sameOrder(da, db)) return false;
    const ka = Object.keys(a.pins).filter((k) => a.pins[k]);
    const kb = Object.keys(b.pins).filter((k) => b.pins[k]);
    return ka.length === kb.length && ka.every((k) => a.pins[k] === b.pins[k]);
}

/**
 * "Make `winner` win over `loser`" by reordering: `winner` moves to just after `loser`, the
 * smallest move that does it. Nothing changes when it already comes later, or when either is
 * not in the order. Other mods keep their relative order.
 */
export function makeWinOver(order: readonly string[], winner: string, loser: string): string[] {
    const iw = order.indexOf(winner);
    const il = order.indexOf(loser);
    if (iw < 0 || il < 0 || iw > il) return order.slice();
    const rest = order.filter((id) => id !== winner);
    rest.splice(rest.indexOf(loser) + 1, 0, winner);
    return rest;
}

/**
 * Keep `modId`'s copy of every path in `paths` (null = let the order decide again). Pins whose
 * value is empty are dropped, so the draft stays comparable.
 */
export function setPins(pins: Pins, paths: readonly string[], modId: string | null): Pins {
    const out: Pins = { ...pins };
    for (const p of paths) {
        if (modId) out[p] = modId;
        else delete out[p];
    }
    return out;
}

/** Toggle a mod in the draft's "disable" list. */
export function toggleDisable(d: Draft, id: string): Draft {
    const out = cloneDraft(d);
    out.disable = out.disable.includes(id) ? out.disable.filter((x) => x !== id) : [...out.disable, id];
    return out;
}

/** The files a pair shares, from a plan answer. */
export function filesOfPair(files: readonly PlanFile[], a: string, b: string): PlanFile[] {
    return files.filter((f) => f.mods.includes(a) && f.mods.includes(b));
}

/** The pairs a mod is part of (for the library badge: open the view focused on one mod). */
export function pairsOfMod(pairs: readonly PlanPair[], id: string): PlanPair[] {
    return pairs.filter((p) => p.a === id || p.b === id);
}

/** Who the pair's files go to, as one short fact: 'a' | 'b' | 'split' | 'other'. */
export function pairVerdict(p: PlanPair): 'a' | 'b' | 'split' | 'other' {
    if (p.b_wins === p.files) return 'b';
    if (p.a_wins === p.files) return 'a';
    if (p.a_wins + p.b_wins === 0) return 'other';
    return 'split';
}

/** Case-insensitive filter over a pair's two names. */
export function pairMatches(p: PlanPair, names: Record<string, string>, q: string): boolean {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [p.a, p.b].some((id) => (names[id] || id).toLowerCase().includes(s));
}

/** The draft as `conflict_plan` / `conflict_apply` arguments. */
export function planArgs(d: Draft): { order: string[]; pins: Pins; disable: string[] } {
    return { order: d.order.slice(), pins: { ...d.pins }, disable: d.disable.slice() };
}
