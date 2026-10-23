// The catalogue index: every followed catalogue, merged, de-duplicated, searchable.
//
// Each catalogue screen used to filter its own list with `name.toLowerCase().includes(q)`:
// « eclair » did not find « Éclair », « f18 » did not find « F/A-18 », a word in the tags or
// the author did not count, and the order was whatever the feeds happened to send. Two
// catalogues listing the same plugin showed it twice.
//
// This is the shared answer, pure so it can be tested directly:
//
//  - **Folding.** Case, accents (NFD + combining marks dropped), ligatures (æ œ ß), and
//    punctuation inside words (`F/A-18` is the tokens `f`, `a`, `18` AND the joined `fa18`).
//  - **A token index built once per change**, not a scan per keystroke: each entry's text is
//    folded and tokenised when its source is (re)loaded; a query is a binary search for
//    prefixes over the sorted token list.
//  - **Ranking.** Every query word must match something (AND). A whole-word match beats a
//    prefix; a match in the name beats the id, tags, author, then the description; an exact
//    name beats everything. Ties break by name.
//  - **De-duplication across catalogues.** Same kind + id, or the same file (download SHA-256)
//    under two ids, is ONE entry carrying every source it came from in `sources`. The first
//    source to list it is the one whose fields are shown.

import type { CatalogItem, UniversalCatalog } from '../../core/catalog-format.js';

const LIGATURES: Record<string, string> = { 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ø': 'o', 'đ': 'd', 'ł': 'l', 'ı': 'i', 'þ': 'th' };

/** Lower-case, accents and ligatures removed. */
export function fold(s: string): string {
    return String(s ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[æœßøđłıþ]/g, (c) => LIGATURES[c] ?? c);
}

/** Folded words. Inside-word punctuation also yields the joined form (`f/a-18` → f, a, 18, fa18). */
export function tokenize(s: string): string[] {
    const out = new Set<string>();
    for (const chunk of fold(s).split(/\s+/)) {
        if (!chunk) continue;
        const parts = chunk.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        for (const p of parts) out.add(p);
        if (parts.length > 1) out.add(parts.join(''));
    }
    return [...out];
}

/** Field weights: where a word is found decides how much it counts. */
const WEIGHT = { name: 8, id: 5, tags: 4, author: 3, kind: 2, description: 1 } as const;
type Field = keyof typeof WEIGHT;

export interface IndexedEntry {
    /** `kind:id` (lower-cased id). */
    key: string;
    kind: string;
    id: string;
    name: string;
    item: CatalogItem;
    /** Every catalogue that lists it, first one first. */
    sources: string[];
}

export interface SearchHit { entry: IndexedEntry; score: number }

interface SourceDoc { url: string; items: CatalogItem[] }

export class CatalogSearchIndex {
    private docs: SourceDoc[] = [];
    private built: IndexedEntry[] | null = null;
    /** token → [entry index, field weight] pairs. */
    private postings = new Map<string, Array<[number, number]>>();
    private tokens: string[] = [];
    private exactNames = new Map<string, number[]>();

    /** Replace what one source contributes. Order of FIRST insertion decides precedence. */
    setSource(url: string, catalog: Pick<UniversalCatalog, 'items'> | null | undefined): void {
        const items = Array.isArray(catalog?.items) ? catalog!.items : [];
        const at = this.docs.findIndex((d) => d.url === url);
        if (at >= 0) this.docs[at] = { url, items };
        else this.docs.push({ url, items });
        this.built = null;
    }

    removeSource(url: string): void {
        this.docs = this.docs.filter((d) => d.url !== url);
        this.built = null;
    }

    sourceUrls(): string[] { return this.docs.map((d) => d.url); }

    /** Every entry, de-duplicated, optionally of one kind. */
    entries(kind?: string): IndexedEntry[] {
        const all = this.build();
        return kind ? all.filter((e) => e.kind === kind) : all.slice();
    }

    private build(): IndexedEntry[] {
        if (this.built) return this.built;
        const out: IndexedEntry[] = [];
        const byKey = new Map<string, number>();
        const bySha = new Map<string, number>();
        for (const d of this.docs) {
            for (const it of d.items) {
                if (!it || typeof it.id !== 'string' || typeof it.kind !== 'string') continue;
                const key = `${it.kind}:${it.id.toLowerCase()}`;
                const sha = typeof it.download?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(it.download.sha256)
                    ? `${it.kind}:${it.download.sha256}` : '';
                const hit = byKey.get(key) ?? (sha ? bySha.get(sha) : undefined);
                if (hit !== undefined) {
                    if (!out[hit].sources.includes(d.url)) out[hit].sources.push(d.url);
                    byKey.set(key, hit);
                    continue;
                }
                const i = out.length;
                out.push({ key, kind: it.kind, id: it.id, name: String(it.name || it.id), item: it, sources: [d.url] });
                byKey.set(key, i);
                if (sha) bySha.set(sha, i);
            }
        }
        this.built = out;
        this.indexTokens(out);
        return out;
    }

    private indexTokens(entries: IndexedEntry[]): void {
        const post = new Map<string, Array<[number, number]>>();
        const names = new Map<string, number[]>();
        const add = (tok: string, i: number, w: number) => {
            const l = post.get(tok);
            if (!l) { post.set(tok, [[i, w]]); return; }
            const last = l[l.length - 1];
            if (last[0] === i) { if (w > last[1]) last[1] = w; } else l.push([i, w]);
        };
        entries.forEach((e, i) => {
            const it = e.item;
            const fields: Array<[Field, string]> = [
                ['name', [e.name, ...Object.values(it.name_i18n || {})].join(' ')],
                ['id', e.id],
                ['tags', (it.tags || []).join(' ')],
                ['author', it.author || ''],
                ['kind', e.kind],
                ['description', [it.summary || '', it.description || '', ...Object.values(it.description_i18n || {})].join(' ').slice(0, 2000)],
            ];
            // Highest weight first, so `add` keeps the best field per token without sorting.
            for (const [f, text] of fields) for (const tok of tokenize(text)) add(tok, i, WEIGHT[f]);
            const n = fold(e.name).trim();
            names.set(n, [...(names.get(n) || []), i]);
        });
        this.postings = post;
        this.tokens = [...post.keys()].sort();
        this.exactNames = names;
    }

    /** First index in the sorted token list whose token is >= `p`. */
    private lowerBound(p: string): number {
        let lo = 0, hi = this.tokens.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (this.tokens[mid] < p) lo = mid + 1; else hi = mid; }
        return lo;
    }

    /**
     * Ranked search. An empty query lists everything (of `kind`) by name.
     */
    search(query: string, opts: { kind?: string; limit?: number } = {}): SearchHit[] {
        const entries = this.build();
        const limit = opts.limit ?? 200;
        const words = tokenize(query);
        const keep = (e: IndexedEntry) => !opts.kind || e.kind === opts.kind;
        if (!words.length) {
            return entries.filter(keep)
                .sort((a, b) => a.name.localeCompare(b.name))
                .slice(0, limit)
                .map((entry) => ({ entry, score: 0 }));
        }
        let scores: Map<number, number> | null = null;
        for (const w of words) {
            const mine = new Map<number, number>();
            for (let t = this.lowerBound(w); t < this.tokens.length && this.tokens[t].startsWith(w); t++) {
                const tok = this.tokens[t];
                const whole = tok === w;
                for (const [i, weight] of this.postings.get(tok)!) {
                    // A whole word counts double; a prefix counts more the more of the word it covers.
                    const s = weight * (whole ? 2 : 1 + w.length / tok.length);
                    if (s > (mine.get(i) ?? 0)) mine.set(i, s);
                }
            }
            if (scores === null) scores = mine;
            else {
                const next = new Map<number, number>();
                for (const [i, s] of mine) { const prev = scores.get(i); if (prev !== undefined) next.set(i, prev + s); }
                scores = next;
            }
            if (!scores.size) return [];
        }
        const q = fold(query).trim();
        for (const i of this.exactNames.get(q) || []) if (scores!.has(i)) scores!.set(i, scores!.get(i)! + 100);
        return [...scores!.entries()]
            .map(([i, score]) => ({ entry: entries[i], score }))
            .filter((h) => keep(h.entry))
            .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
            .slice(0, limit);
    }
}

/**
 * Rank plain rows (anything with a name and some text) with the same folding and scoring,
 * for screens whose rows are not catalogue items — the catalogue modal's browse list.
 * Returns the indices of matching rows, best first; all of them, in order, for an empty query.
 */
export function rankRows(rows: Array<{ id?: string; name: string; sub?: string; note?: string }>, query: string): number[] {
    const ix = new CatalogSearchIndex();
    ix.setSource('rows', {
        items: rows.map((r, i) => ({ kind: 'row', id: String(i), name: r.name, description: [r.sub || '', r.note || '', r.id || ''].join(' ') })),
    });
    if (!tokenize(query).length) return rows.map((_, i) => i);
    return ix.search(query, { limit: rows.length }).map((h) => Number(h.entry.id));
}
