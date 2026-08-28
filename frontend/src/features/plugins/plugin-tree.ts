// Reading a folder listing — the part with no browser in it.
//
// Split from plugin-inspect.ts for the reason every other pure module here was: that one
// imports plugins.ts for its modal wiring, which reaches `state.js` and localStorage at import
// time, so nothing in it can be tested without a browser. The decisions worth pinning — what
// depth a row is drawn at, whether a size is worth printing — live here instead.

/** One row of a folder listing, as `plugin_tree` and `folder_tree` return it. */
export interface TreeEntry {
    path: string;
    size: number;
    is_dir: boolean;
}

/** Bytes as something a person reads. */
export function humanSize(n: number): string {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/**
 * What a flat list of relative paths says about the shape of a folder.
 *
 * The listing is flat because that is what a walk produces and what a cap can be applied to.
 * Turning it into a tree for DISPLAY is a rendering decision, so it lives here rather than in
 * Rust — and it means the same function draws a plugin's folder and a folder somebody is
 * about to bundle into one.
 */
export function treeRows(entries: TreeEntry[]): { depth: number; name: string; entry: TreeEntry }[] {
    return entries.map((e) => {
        const parts = e.path.split('/');
        return { depth: parts.length - 1, name: parts[parts.length - 1], entry: e };
    });
}

/** A summary line: how many files, how much, and what the biggest thing is. */
export function treeSummary(entries: TreeEntry[]): { files: number; folders: number; bytes: number } {
    let files = 0;
    let folders = 0;
    let bytes = 0;
    for (const e of entries) {
        if (e.is_dir) folders += 1;
        else { files += 1; bytes += e.size; }
    }
    return { files, folders, bytes };
}

/**
 * Which rows survive a set of collapsed folders and a filter.
 *
 * A listing of 2693 files across 660 folders is what a real mods folder looks like, and it
 * was drawn as 2693 indented lines. Collapsing is not decoration there — it is the
 * difference between a listing and a wall.
 *
 * Kept as a pure function over the FLAT list rather than by building a nested structure: the
 * walk produces a flat list because that is what a cap can be applied to, and a row's
 * children are exactly the rows whose path starts with its own plus a slash. Two
 * representations of one tree is the thing that goes out of step.
 *
 * A filter beats a collapse on purpose. Somebody who typed a name wants the match, not a
 * lecture about which folder it is hiding in — so matching rows show whatever their parents
 * are set to.
 */
export function visibleRows(
    entries: TreeEntry[],
    collapsed: Set<string>,
    query = '',
): TreeEntry[] {
    const q = query.trim().toLowerCase();
    if (q) {
        // Folders drop out entirely while filtering: a folder that merely CONTAINS a match is
        // not itself a match, and showing it puts empty-looking rows between the hits.
        return entries.filter((e) => !e.is_dir && e.path.toLowerCase().includes(q));
    }
    if (!collapsed.size) return entries;
    return entries.filter((e) => {
        for (const dir of collapsed) {
            if (e.path.startsWith(dir + '/')) return false;
        }
        return true;
    });
}

/**
 * Every folder in the listing, for "collapse all".
 *
 * The default state of a big tree: opening a modal on 660 expanded folders is the wall this
 * exists to avoid, and a person who wants one of them open can say so in one click.
 */
export function allFolders(entries: TreeEntry[]): string[] {
    return entries.filter((e) => e.is_dir).map((e) => e.path);
}

/** How many files sit under one folder, so a collapsed row can say what it is hiding. */
export function countUnder(entries: TreeEntry[], dir: string): { files: number; bytes: number } {
    let files = 0;
    let bytes = 0;
    const prefix = dir + '/';
    for (const e of entries) {
        if (e.is_dir || !e.path.startsWith(prefix)) continue;
        files += 1;
        bytes += e.size;
    }
    return { files, bytes };
}
