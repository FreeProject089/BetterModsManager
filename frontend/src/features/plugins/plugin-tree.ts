// Reading a folder listing — the part with no browser in it.
//
// Split from plugin-inspect.ts for the reason every other pure module here was: that one
// imports `permDomains` from plugins.ts, which reaches `state.js` and localStorage at import
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
