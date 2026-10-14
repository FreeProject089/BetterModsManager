// Catalogue sources, the part that thinks (source-list.ts draws, source-store.ts writes).
//
// Import-free on purpose, like every *-model.ts here: tests/source-list-model.test.mjs loads
// the compiled file in plain node, which cannot load anything that touches Tauri.
//
// One list for every catalogue kind, shown in two places (the App catalogue's Sources tab and
// Settings → Catalogue index). Each row says what the source is (official, partner, yours),
// whether it is fetched, and how it answered the last time.

/** The kinds a person can follow by hand, in the order the list groups them. */
export const SOURCE_KINDS = ['app', 'plugin', 'theme', 'preset', 'modpack', 'repo', 'tutorial', 'list'] as const;
export type SourceKind = typeof SOURCE_KINDS[number];

/** Where a row came from. Official and partner rows are read-only: links.json and the
 *  official catalogue decide them, not this list. */
export type SourceTier = 'official' | 'partner' | 'custom';

/** The health a row shows. `off` = followed but switched off (never counted as a failure);
 *  `unknown` = not fetched since BMM started. */
export type SourceHealth = 'ok' | 'stale' | 'error' | 'pending' | 'off' | 'unknown';

export interface SourceStatusIn {
    state?: string;
    error?: string;
    items?: number;
    lastOk?: number;
    lastTry?: number;
    signature?: string;
    name?: string;
}

export interface SourceRow {
    kind: string;
    url: string;
    tier: SourceTier;
    enabled: boolean;
    /** The person's own label, else the catalogue's own name, else derived from the URL. */
    name: string;
    /** The index this source came from, when one brought it. */
    via?: string;
    health: SourceHealth;
    error?: string;
    items?: number;
    lastOk?: number;
    /** `verified` · `unsigned` · `invalid` · `unknown_key`, when known. */
    signature?: string;
}

/** A short readable name for a URL: `owner/repo` on GitHub, host + file elsewhere, the file
 *  name for a `bundle:` source. Never empty. */
export function labelFromSourceUrl(url: string): string {
    const s = String(url || '').trim();
    if (!s) return '';
    if (s.startsWith('bundle:')) return s.slice(7).split(/[\\/]/).pop() || s;
    let u: URL;
    try { u = new URL(s); } catch { return s; }
    const parts = u.pathname.split('/').filter(Boolean);
    if (/(^|\.)githubusercontent\.com$/i.test(u.hostname) && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    if (/(^|\.)github\.com$/i.test(u.hostname) && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    const bits: string[] = [];
    for (const k of ['project', 'kind', 'type']) {
        const v = u.searchParams.get(k);
        if (v) bits.push(v);
    }
    const file = parts.pop() || '';
    return [u.host, file, bits.join('/')].filter(Boolean).join(' · ');
}

/** The health of one row from what the fetchers recorded. Disabled wins over everything:
 *  a source switched off is not failing, it is off. */
export function healthOf(enabled: boolean, st?: SourceStatusIn | null): SourceHealth {
    if (!enabled) return 'off';
    const s = String(st?.state || '');
    if (s === 'ok' || s === 'stale' || s === 'error' || s === 'pending') return s;
    return 'unknown';
}

/** Build a row. `label` is the person's own name for it (may be empty). */
export function makeRow(o: {
    kind: string; url: string; tier: SourceTier; enabled: boolean;
    label?: string; via?: string; status?: SourceStatusIn | null;
}): SourceRow {
    const st = o.status || null;
    const health = healthOf(o.enabled, st);
    const row: SourceRow = {
        kind: o.kind, url: o.url, tier: o.tier, enabled: o.enabled,
        name: (o.label || '').trim() || String(st?.name || '').trim() || labelFromSourceUrl(o.url),
        health,
    };
    if (o.via) row.via = o.via;
    if (st && health !== 'off') {
        if (st.error && (health === 'error' || health === 'stale')) row.error = String(st.error);
        if (typeof st.items === 'number' && (health === 'ok' || health === 'stale')) row.items = st.items;
        if (st.lastOk) row.lastOk = st.lastOk;
        if (st.signature) row.signature = st.signature;
    }
    return row;
}

/** The sources that count as "did not answer": enabled, fetched, failed. Off rows, blank
 *  URLs and rows never fetched are not failures. */
export function failedRows(rows: SourceRow[]): SourceRow[] {
    return rows.filter((r) => r.enabled && r.url.trim() && r.health === 'error');
}

/** Rows grouped by kind, official and partner first within a kind, the person's order kept. */
export function groupRows(rows: SourceRow[]): Array<{ kind: string; rows: SourceRow[] }> {
    const order = (k: string) => { const i = (SOURCE_KINDS as readonly string[]).indexOf(k); return i < 0 ? 99 : i; };
    const tierRank: Record<SourceTier, number> = { official: 0, partner: 1, custom: 2 };
    const by = new Map<string, SourceRow[]>();
    for (const r of rows) {
        const list = by.get(r.kind) || [];
        list.push(r);
        by.set(r.kind, list);
    }
    return [...by.entries()]
        .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
        .map(([kind, list]) => ({
            kind,
            // Stable: equal tiers keep the order they arrived in (the person's order).
            rows: list.map((r, i) => ({ r, i })).sort((a, b) => tierRank[a.r.tier] - tierRank[b.r.tier] || a.i - b.i).map((x) => x.r),
        }));
}

/** Move `url` by `delta` places in `list` (case-insensitive match). Returns a new list; the
 *  same order when the move would leave the list. */
export function moveInList(list: string[], url: string, delta: number): string[] {
    const low = String(url).toLowerCase();
    const i = list.findIndex((u) => String(u).toLowerCase() === low);
    const j = i + Math.trunc(delta);
    if (i < 0 || j < 0 || j >= list.length || j === i) return list.slice();
    const out = list.slice();
    const [x] = out.splice(i, 1);
    out.splice(j, 0, x);
    return out;
}

// ── Import / export ─────────────────────────────────────────────────────────────────────

export const EXPORT_FORMAT = 'bmm-catalog-sources';

export interface ExportedSource { kind: string; url: string; name?: string; enabled: boolean }

/** The export document: only the person's own sources (official ones come with BMM). */
export function exportDoc(rows: SourceRow[], labels: Record<string, string>, now = Date.now()): object {
    return {
        format: EXPORT_FORMAT,
        version: 1,
        exported_at: new Date(now).toISOString(),
        sources: rows.filter((r) => r.tier === 'custom').map((r) => {
            const o: ExportedSource = { kind: r.kind, url: r.url, enabled: r.enabled };
            const name = (labels[r.url] || '').trim();
            if (name) o.name = name;
            return o;
        }),
    };
}

/**
 * Read an import: our own export, a bare array of URLs (for `defaultKind`), or a map
 * `{ kind: [urls] }` (the backend mirror's shape). Unknown kinds, blank and non-http(s)
 * addresses (except `bundle:`) are dropped and counted. Duplicates within the file collapse.
 */
export function parseImport(doc: unknown, defaultKind = 'app'): { sources: ExportedSource[]; dropped: number } {
    const out: ExportedSource[] = [];
    let dropped = 0;
    const seen = new Set<string>();
    const kinds = SOURCE_KINDS as readonly string[];
    const push = (kind: unknown, url: unknown, name?: unknown, enabled?: unknown) => {
        const k = String(kind || '').trim().toLowerCase();
        const u = String(url || '').trim();
        if (!kinds.includes(k) || !u || !(/^https?:\/\/[^/\s]+/i.test(u) || u.startsWith('bundle:'))) { dropped += 1; return; }
        const key = `${k}\u0000${u.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        const o: ExportedSource = { kind: k, url: u, enabled: enabled !== false };
        const n = typeof name === 'string' ? name.trim().slice(0, 120) : '';
        if (n) o.name = n;
        out.push(o);
    };
    if (Array.isArray(doc)) {
        for (const x of doc) {
            if (typeof x === 'string') push(defaultKind, x);
            else if (x && typeof x === 'object') push((x as any).kind || defaultKind, (x as any).url, (x as any).name, (x as any).enabled);
            else dropped += 1;
        }
    } else if (doc && typeof doc === 'object') {
        const d = doc as Record<string, unknown>;
        if (Array.isArray(d.sources)) {
            for (const x of d.sources) {
                if (x && typeof x === 'object') push((x as any).kind, (x as any).url, (x as any).name, (x as any).enabled);
                else dropped += 1;
            }
        } else {
            for (const [k, v] of Object.entries(d)) {
                if (!Array.isArray(v)) continue;
                for (const u of v) push(k, u);
            }
        }
    }
    return { sources: out, dropped };
}

/** "3 min ago" style age, in the units the caller's words provide. */
export function ageParts(ms: number | undefined, now = Date.now()): { n: number; unit: 's' | 'm' | 'h' | 'd' } | null {
    if (!ms || !Number.isFinite(ms)) return null;
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 60) return { n: s, unit: 's' };
    if (s < 3600) return { n: Math.round(s / 60), unit: 'm' };
    if (s < 86400) return { n: Math.round(s / 3600), unit: 'h' };
    return { n: Math.round(s / 86400), unit: 'd' };
}
