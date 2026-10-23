// The shared activation order, as data: what the share/import dialog shows and what every bulk
// enable passes to `mod_order_arrange`, with no DOM and no imports.
//
// The backend (src-tauri/src/commands/order_share.rs) is the one place that parses a pasted
// order, matches it to the library and computes the merged order. This module only reads what
// it answered: which mods land where, and in how many words to say it. Kept import-free so
// tests/order-share.test.mjs can load the compiled module in plain node.

/** Where a bulk enable puts its mods in the order. */
export type PlaceMode = 'top' | 'bottom' | 'keep';
export const PLACE_MODES: readonly PlaceMode[] = ['top', 'bottom', 'keep'];

/** A mode word from a setting, a task or a pack, or `fallback` when it is not one. */
export function normalizeMode(m: unknown, fallback: PlaceMode | null = null): PlaceMode | null {
    const s = typeof m === 'string' ? m.trim().toLowerCase() : '';
    return (PLACE_MODES as readonly string[]).includes(s) ? s as PlaceMode : fallback;
}

/**
 * The block a bulk enable hands to the engine. A modpack or a script's explicit list places
 * ALL of its mods (`whole`), in its own order; "Enable all" or a list apply places only the
 * mods it newly enabled, so an order the user built is never reshuffled by "turn the rest on".
 */
export function bulkBlock(requested: readonly string[], activeBefore: readonly string[], whole: boolean): string[] {
    const before = new Set(activeBefore);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of requested) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (whole || !before.has(id)) out.push(id);
    }
    return out;
}

export interface PreviewRow { id: string; name: string; from: number; to: number }

/** `mod_order_import_preview`'s answer. */
export interface ImportPlan {
    name?: string | null;
    game?: string | null;
    total: number;
    matched: PreviewRow[];
    inactive: PreviewRow[];
    missing: string[];
    extra: PreviewRow[];
    result: string[];
    changed: boolean;
    handovers: number;
}

export type Move = 'up' | 'down' | 'same';

/** A row of the "where they land" list: every active mod, in its new place. */
export interface Landing { id: string; name: string; from: number; to: number; move: Move; known: boolean }

/** Every active mod after the import, top of the list first applied, with how it moved. */
export function landings(plan: ImportPlan): Landing[] {
    const rows: Landing[] = [
        ...(plan.matched || []).map((r) => ({ ...r, known: true })),
        ...(plan.extra || []).map((r) => ({ ...r, known: false })),
    ].map((r) => ({
        id: r.id, name: r.name, from: r.from, to: r.to, known: r.known,
        // Lower number = applied earlier. Moving to a higher number wins more files: "up".
        move: (r.to > r.from ? 'up' : r.to < r.from ? 'down' : 'same') as Move,
    }));
    return rows.sort((a, b) => a.to - b.to);
}

/** The counts the dialog's summary line reads. */
export function planCounts(plan: ImportPlan): { placed: number; moved: number; missing: number; inactive: number; extra: number } {
    const moved = landings(plan).filter((l) => l.move !== 'same').length;
    return {
        placed: (plan.matched || []).length,
        moved,
        missing: (plan.missing || []).length,
        inactive: (plan.inactive || []).length,
        extra: (plan.extra || []).length,
    };
}

/** What a pasted text looks like, for the hint under the box (the backend decides). */
export type PastedKind = 'empty' | 'link' | 'code' | 'json' | 'list';
export function pastedKind(text: string): PastedKind {
    const t = (text || '').trim();
    if (!t) return 'empty';
    if (t.startsWith('bmm://order')) return 'link';
    if (t.startsWith('BMMORDER1.')) return 'code';
    if (t.startsWith('{')) return 'json';
    return 'list';
}
