// The Integrity dialog's pure part: how a mod's hash state reads, the filter, the readable
// hash, and the exported report. No import, so a test reads it without the app
// (integrity-center.ts draws). The data comes from Rust: get_hash_overview (one row per mod,
// without the hash maps) and get_mod_integrity (one mod checked against its files).

/** t(key) → the translation, or the key itself when there is none. */
export type T = (key: string) => string;

/** verified: the last check (or the hashing itself) matched · mismatch: the last check found a
 *  file changed, added or removed · missing: no baseline yet · unchecked: a baseline that was
 *  never compared with the files (hashed by an older BMM). */
export type HashState = 'verified' | 'mismatch' | 'missing' | 'unchecked';
export const STATES: HashState[] = ['verified', 'mismatch', 'missing', 'unchecked'];

export interface HashRow {
    id: string; name: string; version: string; enabled: boolean;
    files: number; hashed_at: string | null; invalid: boolean | null; content_id: string | null;
}

/** get_mod_integrity's answer (camelCase on the wire). */
export interface Report { modId: string; missing: string[]; modified: string[]; added: string[]; total: number; isValid: boolean }

const say = (t: T, key: string, en: string): string => { const v = t(key); return v && v !== key ? v : en; };

export function stateOf(r: Pick<HashRow, 'files' | 'invalid'>): HashState {
    if (!r.files) return 'missing';
    if (r.invalid === true) return 'mismatch';
    if (r.invalid === false) return 'verified';
    return 'unchecked';
}

export function stateName(s: HashState, t: T): string {
    const m: Record<HashState, [string, string]> = {
        verified: ['sha.state.verified', 'Verified'],
        mismatch: ['sha.state.mismatch', 'Mismatch'],
        missing: ['sha.state.missing', 'No hash'],
        unchecked: ['sha.state.unchecked', 'Not checked'],
    };
    return say(t, m[s][0], m[s][1]);
}

export function countStates(rows: HashRow[]): Record<HashState, number> {
    const out: Record<HashState, number> = { verified: 0, mismatch: 0, missing: 0, unchecked: 0 };
    for (const r of rows) out[stateOf(r)]++;
    return out;
}

/** The rows a state filter and a search keep, mismatches first, then by name. */
export function filterRows(rows: HashRow[], state: HashState | 'all', query: string): HashRow[] {
    const q = query.trim().toLowerCase();
    const rank: Record<HashState, number> = { mismatch: 0, unchecked: 1, missing: 2, verified: 3 };
    return rows
        .filter((r) => state === 'all' || stateOf(r) === state)
        .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.content_id || '').toLowerCase().includes(q) || r.id.toLowerCase().startsWith(q))
        .sort((a, b) => rank[stateOf(a)] - rank[stateOf(b)] || a.name.localeCompare(b.name));
}

/** The algorithm a stored hash was made with: BLAKE3 values carry a `b3:` tag, SHA-256 do not. */
export function hashAlgo(h: string): 'BLAKE3' | 'SHA-256' {
    return h.startsWith('b3:') ? 'BLAKE3' : 'SHA-256';
}

/** A long hash cut to what a person compares: the head and the tail, the tag dropped. */
export function shortHash(h: string, head = 8, tail = 6): string {
    const v = h.startsWith('b3:') ? h.slice(3) : h;
    return v.length <= head + tail + 1 ? v : `${v.slice(0, head)}…${v.slice(-tail)}`;
}

/** A report's one-line verdict. */
export function reportLine(r: Report, t: T): string {
    if (r.isValid) return say(t, 'sha.rep.ok', 'All {n} files match.').replace('{n}', String(r.total));
    const parts: string[] = [];
    if (r.modified.length) parts.push(say(t, 'sha.rep.modified', '{n} changed').replace('{n}', String(r.modified.length)));
    if (r.missing.length) parts.push(say(t, 'sha.rep.missing', '{n} missing').replace('{n}', String(r.missing.length)));
    if (r.added.length) parts.push(say(t, 'sha.rep.added', '{n} added').replace('{n}', String(r.added.length)));
    return parts.join(' · ');
}

/** The report as JSON: every listed mod, its state, and the files the last check flagged. */
export function reportJson(rows: HashRow[], reports: Map<string, Report>, scope: string, now: string): string {
    return JSON.stringify({
        kind: 'bmm-integrity-report',
        version: 1,
        generated_at: now,
        scope,
        counts: countStates(rows),
        mods: rows.map((r) => {
            const rep = reports.get(r.id);
            return {
                id: r.id, name: r.name, version: r.version, enabled: r.enabled,
                state: stateOf(r), files: r.files, hashed_at: r.hashed_at, content_id: r.content_id,
                ...(rep ? { checked: { total: rep.total, modified: rep.modified, missing: rep.missing, added: rep.added } } : {}),
            };
        }),
    }, null, 2);
}

const csvCell = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    // A cell a spreadsheet would run as a formula is prefixed with a quote (CSV injection).
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The report as CSV, one row per mod. */
export function reportCsv(rows: HashRow[], reports: Map<string, Report>): string {
    const head = ['id', 'name', 'version', 'enabled', 'state', 'files', 'hashed_at', 'content_id', 'modified', 'missing', 'added'];
    const lines = rows.map((r) => {
        const rep = reports.get(r.id);
        return [r.id, r.name, r.version, r.enabled, stateOf(r), r.files, r.hashed_at, r.content_id,
            rep ? rep.modified.length : '', rep ? rep.missing.length : '', rep ? rep.added.length : ''].map(csvCell).join(',');
    });
    return [head.join(','), ...lines].join('\r\n') + '\r\n';
}
