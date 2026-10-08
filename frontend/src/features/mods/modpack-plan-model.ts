/**
 * modpack-plan-model.ts — what activating a modpack will change, before anything is touched.
 *
 * Pure (no DOM, no invoke), unit-tested in tests/mod-flows.test.mjs. The activation dialog
 * shows this plan (to enable / already on / missing / conflicts / integrity), the job manager
 * then runs exactly `toDisable` and `toEnable`, and `packOrder` is placed in the profile's
 * activation order afterwards (mod_order_arrange).
 *
 * A pack names its mods by local id and, for another PC, by SHA-256; `shaIndex` is the
 * sha → local id answer of find_local_mods_by_hashes. Dependencies are followed one level, as
 * the previous apply loop did, and only for a reference that asks for them.
 */

export interface PackRef {
    mod_id?: string;
    sha256?: string;
    mod_name?: string;
    name?: string;
    include_dependencies?: boolean;
}

export interface PackLike {
    id?: string;
    name?: string;
    mods?: PackRef[];
}

export interface LocalMod {
    id: string;
    name: string;
    enabled: boolean;
    dependencies?: string[];
    file_hashes?: Record<string, string> | null;
    file_hashes_invalid?: boolean | null;
}

export interface ConflictLike {
    category?: string;
    other_mod_id?: string;
    other_mod_name?: string;
    file_count?: number;
}

export interface PackConflict {
    modId: string;
    modName: string;
    otherId: string;
    otherName: string;
    files: number;
    /** The other mod is part of the same pack (its order decides who wins). */
    inPack: boolean;
}

export interface ModpackPlan {
    toEnable: LocalMod[];
    alreadyOn: LocalMod[];
    missing: Array<{ ref: PackRef; label: string }>;
    toDisable: LocalMod[];
    /** In toEnable with no hashes: enable_mod refuses them (MISSING_SHA) unless bypassed. */
    noHash: LocalMod[];
    /** In the pack and marked as no longer matching their hashes. */
    invalid: LocalMod[];
    /** The pack's mods (dependencies after their parent), as local ids. */
    packOrder: string[];
    /** off: nothing on · partial: some · on: every found mod is on. */
    state: 'off' | 'partial' | 'on';
}

export function findLocal(ref: PackRef | null | undefined, mods: LocalMod[], shaIndex: Record<string, string>): LocalMod | null {
    if (!ref) return null;
    if (ref.mod_id) {
        const byId = mods.find((m) => m.id === ref.mod_id);
        if (byId) return byId;
    }
    if (ref.sha256 && shaIndex && shaIndex[ref.sha256]) {
        return mods.find((m) => m.id === shaIndex[ref.sha256!]) || null;
    }
    return null;
}

function hasHashes(m: LocalMod): boolean {
    return !!m.file_hashes && Object.keys(m.file_hashes).length > 0;
}

/**
 * `mods` is where the pack's references are looked up (every mod BMM knows); `opts.library`
 * is the active profile's library, the one "only this pack" turns off (default: `mods`).
 */
export function planModpack(pack: PackLike, mods: LocalMod[], shaIndex: Record<string, string> = {}, opts: { exclusive?: boolean; library?: LocalMod[] } = {}): ModpackPlan {
    const byId = new Map(mods.map((m) => [m.id, m]));
    const order: string[] = [];
    const seen = new Set<string>();
    const missing: ModpackPlan['missing'] = [];
    const add = (m: LocalMod | null | undefined) => {
        if (!m || seen.has(m.id)) return;
        seen.add(m.id);
        order.push(m.id);
    };
    for (const ref of pack?.mods || []) {
        const local = findLocal(ref, mods, shaIndex);
        if (!local) {
            missing.push({ ref, label: ref.mod_name || ref.name || ref.mod_id || (ref.sha256 ? ref.sha256.slice(0, 12) : '?') });
            continue;
        }
        add(local);
        if (ref.include_dependencies) for (const dep of local.dependencies || []) add(byId.get(dep));
    }
    const inPack = order.map((id) => byId.get(id)!).filter(Boolean);
    const toEnable = inPack.filter((m) => !m.enabled);
    const alreadyOn = inPack.filter((m) => m.enabled);
    const toDisable = opts.exclusive ? (opts.library || mods).filter((m) => m.enabled && !seen.has(m.id)) : [];
    const state: ModpackPlan['state'] = !inPack.length || !alreadyOn.length ? 'off' : toEnable.length ? 'partial' : 'on';
    return {
        toEnable,
        alreadyOn,
        missing,
        toDisable,
        noHash: toEnable.filter((m) => !hasHashes(m)),
        invalid: inPack.filter((m) => !!m.file_hashes_invalid),
        packOrder: order,
        state,
    };
}

/** File overlaps that will be live once the plan ran: between two pack mods, or between a
 *  pack mod and a mod that stays on. Each pair once. */
export function planConflicts(plan: ModpackPlan, mods: LocalMod[], conflictCache: Record<string, ConflictLike[]>): PackConflict[] {
    const packIds = new Set(plan.packOrder);
    const offAfter = new Set(plan.toDisable.map((m) => m.id));
    const onAfter = new Set<string>([...packIds, ...mods.filter((m) => m.enabled && !offAfter.has(m.id)).map((m) => m.id)]);
    const names = new Map(mods.map((m) => [m.id, m.name]));
    const out: PackConflict[] = [];
    const pairs = new Set<string>();
    for (const id of plan.packOrder) {
        for (const c of conflictCache?.[id] || []) {
            if (c.category && c.category !== 'Intra') continue;
            const other = String(c.other_mod_id || '');
            if (!other || !onAfter.has(other)) continue;
            const key = [id, other].sort().join('|');
            if (pairs.has(key)) continue;
            pairs.add(key);
            out.push({
                modId: id,
                modName: names.get(id) || id,
                otherId: other,
                otherName: c.other_mod_name || names.get(other) || other,
                files: Number(c.file_count) || 0,
                inPack: packIds.has(other),
            });
        }
    }
    return out.sort((a, b) => Number(a.inPack) - Number(b.inPack) || b.files - a.files);
}
