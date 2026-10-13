// The BMM Tools hub, the part that thinks (tools-hub.ts is the part that draws and fetches).
//
// Import-free on purpose, like every *-model.ts here: tests/tools-model.test.mjs loads the
// compiled file in plain node, which cannot load anything that touches Tauri.

/** The hub's tools, in rail order. `icon` is a ui/icons.ts glyph name. */
export const TOOLS = [
    { id: 'duplicates', icon: 'copy', audience: 'user' },
    { id: 'conflicts', icon: 'alert', audience: 'user' },
    { id: 'disk', icon: 'hard-drive', audience: 'user' },
    { id: 'diff', icon: 'git-branch', audience: 'user' },
    { id: 'orphans', icon: 'search', audience: 'user' },
    { id: 'hash', icon: 'fingerprint', audience: 'author' },
    { id: 'validate', icon: 'shield-check', audience: 'author' },
] as const;

export type ToolId = typeof TOOLS[number]['id'];

export function isToolId(x: unknown): x is ToolId {
    return typeof x === 'string' && TOOLS.some((t) => t.id === x);
}

/** Existing BMM tools the hub links to (palette command ids): one place to find them all,
 *  without a second implementation of any of them. */
export const LINKED_COMMANDS = ['mods.verify', 'mods.graph', 'profiles.loadOrder', 'settings.storage', 'settings.hashing'] as const;

// ── Hash checker ────────────────────────────────────────────────────────────────────────

/** A pasted hash reduced to bare lower-case hex: the `b3:` / `blake3:` / `sha256:` prefixes
 *  BMM and other tools print, spaces and line breaks (a hash copied from a web page) removed. */
export function normalizeHash(s: unknown): string {
    return String(s ?? '')
        .trim()
        .replace(/^(b3|blake3|sha-?256)\s*[:=]\s*/i, '')
        .replace(/\s+/g, '')
        .toLowerCase();
}

/** The algorithm a pasted value names by its prefix, if it names one. */
export function hashAlgoHint(s: unknown): 'blake3' | 'sha256' | null {
    const v = String(s ?? '').trim().toLowerCase();
    if (/^(b3|blake3)\s*[:=]/.test(v)) return 'blake3';
    if (/^sha-?256\s*[:=]/.test(v)) return 'sha256';
    return null;
}

export type HashVerdict = 'match' | 'mismatch' | 'empty' | 'invalid';

/** Compare a computed digest with what the person pasted. `invalid` = not 64 hex digits, said
 *  apart from `mismatch` because "you pasted half a hash" and "the file differs" lead to
 *  different next steps. */
export function compareHash(computed: string, expected: unknown): HashVerdict {
    const e = normalizeHash(expected);
    if (!e) return 'empty';
    if (!/^[0-9a-f]{64}$/.test(e)) return 'invalid';
    return normalizeHash(computed) === e ? 'match' : 'mismatch';
}

// ── Export ──────────────────────────────────────────────────────────────────────────────

/** One CSV cell: quoted when it must be, and a leading = + - @ neutralised so a spreadsheet
 *  opening the export does not run a mod name as a formula. */
export function csvCell(v: unknown): string {
    let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], cols?: string[]): string {
    const head = cols && cols.length ? cols : Array.from(rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set<string>()));
    const lines = [head.map(csvCell).join(',')];
    for (const r of rows) lines.push(head.map((c) => csvCell(r[c])).join(','));
    return lines.join('\r\n') + '\r\n';
}

// ── Conflicts ───────────────────────────────────────────────────────────────────────────

export interface ConflictPair {
    a: string;
    b: string;
    aName: string;
    bName: string;
    files: number;
    active: boolean;
    inter: boolean;
    otherProfile: string;
}

/**
 * `get_all_mod_conflicts` answers `{ modId: ConflictReport[] }`, one report per side, so every
 * pair arrives twice. Flattened here to unique pairs, restricted to `scope` (the mod ids of
 * one profile) when given: a pair is kept when either side is in it. Active conflicts first,
 * then the most files.
 */
export function conflictPairs(
    map: Record<string, any[]> | null | undefined,
    names: Record<string, string>,
    scope?: Set<string> | null,
): ConflictPair[] {
    const seen = new Map<string, ConflictPair>();
    for (const [a, reports] of Object.entries(map || {})) {
        for (const r of reports || []) {
            const b = String(r?.other_mod_id ?? '');
            if (!b || b === a) continue;
            if (scope && !scope.has(a) && !scope.has(b)) continue;
            const key = [a, b].sort().join('\u0000');
            const files = Number(r?.file_count ?? 0) || 0;
            const active = String(r?.status ?? '') === 'Active';
            const prev = seen.get(key);
            if (prev) {
                // The two sides can disagree (one reports Active while the other, computed from
                // its own profile, says Potential): the worse one is the truth.
                prev.active = prev.active || active;
                prev.files = Math.max(prev.files, files);
                continue;
            }
            seen.set(key, {
                a, b, aName: names[a] || a, bName: String(r?.other_mod_name || names[b] || b), files, active,
                inter: String(r?.category ?? '') === 'Inter', otherProfile: String(r?.other_profile_name ?? ''),
            });
        }
    }
    return [...seen.values()].sort((x, y) => Number(y.active) - Number(x.active) || y.files - x.files || x.aName.localeCompare(y.aName));
}

// ── Rows for export, per tool ───────────────────────────────────────────────────────────

/** Flat rows for the CSV export of a tool's result (the JSON export is the result itself). */
export function rowsFor(tool: ToolId, r: any): Record<string, unknown>[] {
    if (!r) return [];
    switch (tool) {
        case 'duplicates':
            return [
                ...(r.mod_groups || []).flatMap((g: any) => (g.mods || []).map((m: any) => ({ kind: 'mod', group: g.key, name: m.name, version: m.version, profile: m.profile_name || '', path: m.path, size: '' }))),
                ...(r.file_groups || []).flatMap((g: any) => (g.files || []).map((f: any) => ({ kind: 'file', group: g.hash, name: f.mod_name, version: '', profile: '', path: f.path, size: g.size }))),
            ];
        case 'conflicts':
            return (Array.isArray(r) ? r as ConflictPair[] : []).map((p) => ({ mod_a: p.aName, mod_b: p.bName, files: p.files, active: p.active, other_profile: p.otherProfile }));
        case 'disk':
            return [
                ...(r.profiles || []).flatMap((p: any) => [
                    { scope: 'profile', profile: p.name, name: 'mods', path: p.mods_path, bytes: p.mods_bytes },
                    { scope: 'profile', profile: p.name, name: 'backups', path: p.backup_path, bytes: p.backup_bytes },
                    ...(p.mods || []).map((m: any) => ({ scope: 'mod', profile: p.name, name: m.name, path: m.path, bytes: m.bytes })),
                ]),
                ...(r.app_data || []).map((x: any) => ({ scope: 'app_data', profile: '', name: x.name, path: x.path, bytes: x.bytes })),
            ];
        case 'diff': {
            const one = (kind: string, s: any) => ({ kind, name: s.name, a: kind === 'only_b' ? '' : s.version, b: kind === 'only_a' ? '' : s.version });
            const pair = (kind: string, f: (x: any) => unknown) => (p: any) => ({ kind, name: p.a.name, a: f(p.a), b: f(p.b) });
            return [
                ...(r.only_a || []).map((s: any) => one('only_a', s)),
                ...(r.only_b || []).map((s: any) => one('only_b', s)),
                ...(r.version || []).map(pair('version', (x) => x.version)),
                ...(r.enabled || []).map(pair('enabled', (x) => x.enabled)),
                ...(r.order || []).map(pair('order', (x) => x.order)),
            ];
        }
        case 'orphans':
            return (r.items || []).map((o: any) => ({ kind: o.kind, name: o.name, profile: o.profile_name || '', path: o.path }));
        case 'hash':
            return [{ file: r.path, size: r.size, algo: r.algo, hash: r.hash, expected: r.expected || '', verdict: r.verdict }];
        case 'validate':
            return [{ format: r.format, ok: r.ok, count: r.count, problems: (r.problems || []).join(' | ') }];
    }
    return [];
}

/** How many findings a result holds, for the rail badge and the empty state. */
export function findingCount(tool: ToolId, r: any): number {
    if (!r) return 0;
    switch (tool) {
        case 'duplicates': return (r.mod_groups?.length || 0) + (r.file_groups?.length || 0);
        case 'conflicts': return Array.isArray(r) ? r.length : 0;
        case 'disk': return (r.profiles?.length || 0) + (r.app_data?.length || 0);
        case 'diff': return ['only_a', 'only_b', 'version', 'enabled', 'order'].reduce((n, k) => n + (r[k]?.length || 0), 0);
        case 'orphans': return r.items?.length || 0;
        case 'hash': return r.verdict === 'mismatch' ? 1 : 0;
        case 'validate': return r.problems?.length || 0;
    }
    return 0;
}

/** Percentage for a progress event, clamped; null when the total is unknown. */
export function progressPct(done: unknown, total: unknown): number | null {
    const d = Number(done), tt = Number(total);
    if (!Number.isFinite(d) || !Number.isFinite(tt) || tt <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((d / tt) * 100)));
}
