// mapper-preview-model.ts — what the mapper's "Final preview" shows, computed without a DOM.
//
// Import-free so node can test it. The dialog (mapper-preview.ts) only draws this.
//
// The old preview was 802 flat rows of "source → destination" and two chips (root: 0,
// sub-folders: 802) that answered no question anybody had before pressing Save. What people
// need to know is: where does this land, how much, what gets replaced, and is anything odd
// (files dumped at the game root, other mods writing the same files). That is this model.

export interface PvFile { path: string; size: number }
export type PvStatus = 'new' | 'overwrite';
export interface PvItem {
    /** Path inside the mod, as listed. */
    src: string;
    /** Final path relative to the game folder, `\` separated. */
    dst: string;
    size: number;
    /** A queued move changes where this file lands. */
    moved: boolean;
    /** The game folder already has a file at `dst`. */
    status: PvStatus;
    /** First segment of `dst`, or '' for a file at the game root. */
    top: string;
}
export interface PvGroup { name: string; count: number; bytes: number; overwrites: number; moved: number }
export interface PvTotals { files: number; folders: number; bytes: number; news: number; overwrites: number; moved: number; atRoot: number; deleted: number }
export interface PvModel { items: PvItem[]; groups: PvGroup[]; totals: PvTotals }

const SEP = /[\\/]/;
/** `\` separators, no leading/trailing separator. */
export function normPath(p: string): string {
    return String(p || '').split(SEP).filter((s) => s && s !== '.').join('\\');
}
const key = (p: string) => normPath(p).toLowerCase();

/** Where one mod file ends up once the queued moves are applied. Same rule the mapper's Save
 *  applies (restructure_mod_item): the moved item keeps its name under the target folder;
 *  "." is the game root. When several moves match, the last one queued wins, as before. */
export function finalPathOf(file: string, moves: Array<[string, string]>): { dst: string; moved: boolean } {
    const f = normPath(file);
    let dst = f;
    let moved = false;
    for (const [srcRaw, target] of moves) {
        const src = normPath(srcRaw);
        if (!src) continue;
        const fl = f.toLowerCase(), sl = src.toLowerCase();
        if (fl !== sl && !fl.startsWith(sl + '\\')) continue;
        moved = true;
        const name = src.split('\\').pop() || src;
        const rest = fl === sl ? '' : f.slice(src.length + 1);
        const t = normPath(target);
        dst = [t, name, rest].filter(Boolean).join('\\');
    }
    return { dst, moved };
}

/** Every FILE path in a directory tree (FileTreeNode-shaped), normalised and lower-cased. */
export function gameFileSet(tree: Array<{ path: string; is_dir: boolean; children?: unknown[] | null }>): Set<string> {
    const out = new Set<string>();
    const stack = [...(tree || [])];
    while (stack.length) {
        const n = stack.pop() as { path: string; is_dir: boolean; children?: unknown[] | null };
        if (!n) continue;
        if (!n.is_dir) out.add(key(n.path));
        if (Array.isArray(n.children)) for (const c of n.children) stack.push(c as typeof n);
    }
    return out;
}

/** Is `p` equal to or inside one of `dirs` (both mod-relative)? */
function under(p: string, dirs: string[]): boolean {
    const pl = key(p);
    return dirs.some((d) => { const dl = key(d); return !!dl && (pl === dl || pl.startsWith(dl + '\\')); });
}

export function buildPreview(files: PvFile[], moves: Array<[string, string]>, gameFiles: Set<string>, deletions: string[] = []): PvModel {
    const items: PvItem[] = [];
    let deleted = 0;
    for (const f of files) {
        if (deletions.length && under(f.path, deletions)) { deleted++; continue; }
        const { dst, moved } = finalPathOf(f.path, moves);
        const i = dst.indexOf('\\');
        items.push({
            src: normPath(f.path), dst, size: Math.max(0, Number(f.size) || 0), moved,
            status: gameFiles.has(dst.toLowerCase()) ? 'overwrite' : 'new',
            top: i < 0 ? '' : dst.slice(0, i),
        });
    }
    // Folders first by name, root files last; inside a group, by path.
    items.sort((a, b) => (a.top === '' ? 1 : 0) - (b.top === '' ? 1 : 0) || a.top.localeCompare(b.top) || a.dst.localeCompare(b.dst));
    const byTop = new Map<string, PvGroup>();
    const folders = new Set<string>();
    const totals: PvTotals = { files: items.length, folders: 0, bytes: 0, news: 0, overwrites: 0, moved: 0, atRoot: 0, deleted };
    for (const it of items) {
        let g = byTop.get(it.top);
        if (!g) { g = { name: it.top, count: 0, bytes: 0, overwrites: 0, moved: 0 }; byTop.set(it.top, g); }
        g.count++; g.bytes += it.size;
        if (it.status === 'overwrite') { g.overwrites++; totals.overwrites++; } else totals.news++;
        if (it.moved) { g.moved++; totals.moved++; }
        if (!it.top) totals.atRoot++;
        totals.bytes += it.size;
        const parts = it.dst.split('\\');
        for (let k = 1; k < parts.length; k++) folders.add(parts.slice(0, k).join('\\').toLowerCase());
    }
    totals.folders = folders.size;
    return { items, groups: [...byTop.values()], totals };
}

/** "C:\Games\Very\Long\…\file.dds": keeps the head and, above all, the file name. */
export function middleEllipsis(s: string, max: number): string {
    const str = String(s || '');
    if (max < 8 || str.length <= max) return str;
    const tail = Math.ceil((max - 1) * 0.6);
    const head = max - 1 - tail;
    return str.slice(0, head) + '\u2026' + str.slice(str.length - tail);
}

/** Case-insensitive match on either side of the move. */
export function matchesQuery(it: PvItem, q: string): boolean {
    if (!q) return true;
    const n = q.toLowerCase();
    return it.dst.toLowerCase().includes(n) || it.src.toLowerCase().includes(n);
}

export type PvFilter = 'all' | 'moved' | 'overwrite' | 'root';
export function matchesFilter(it: PvItem, f: PvFilter): boolean {
    return f === 'all' || (f === 'moved' && it.moved) || (f === 'overwrite' && it.status === 'overwrite') || (f === 'root' && !it.top);
}

/** The rows [from, to) a virtual list must draw for this scroll position, with overscan. */
export function visibleRange(scrollTop: number, viewport: number, rowH: number, total: number, overscan = 8): [number, number] {
    const from = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
    const to = Math.min(total, Math.ceil((scrollTop + viewport) / rowH) + overscan);
    return [from, Math.max(from, to)];
}
