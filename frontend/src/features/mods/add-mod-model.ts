/**
 * add-mod-model.ts — what the "Add a mod" dialog reads from a picked folder or archive.
 *
 * Pure (no DOM, no invoke), unit-tested in tests/mod-flows.test.mjs. The dialog lists the
 * source (folder_tree for a folder, preview_under for an archive, neither of which extracts
 * anything) and hands the entries in; this turns them into the preview: a name and version
 * guessed from the file name, how many files, how big, and which ACTIVE mods ship the same
 * relative paths (the files that would overwrite each other once both are on).
 */

export const ARCHIVE_RE = /\.(zip|rar|7z|tar\.gz|tgz|tar|gz)$/i;

export interface SourceInfo {
    kind: 'folder' | 'archive';
    /** "zip", "7z", "tar.gz"… ('' for a folder). */
    archiveType: string;
    /** The file or folder name as it is on disk. */
    base: string;
    /** A name to start from: the base without extension, separators made spaces, version cut. */
    name: string;
    /** A version read from the name ("Cockpit_v1.2.3" → "1.2.3"), '' when there is none. */
    version: string;
}

export interface TreeEntryLike {
    path: string;
    size?: number;
    is_dir?: boolean;
}

export interface SourceSummary {
    files: number;
    folders: number;
    bytes: number;
    /** The first top-level names, folders first. */
    top: string[];
    /** The listing hit its cap: the counts are "at least". */
    capped: boolean;
}

export interface ConflictHit {
    id: string;
    name: string;
    count: number;
    sample: string[];
}

const VERSION_RE = /(?:^|[\s_\-(\[])v?(\d+(?:\.\d+){1,3}[a-z]?)(?=$|[\s_\-)\]])/gi;

export function describeSource(path: string): SourceInfo {
    const raw = String(path || '').trim().replace(/[\\/]+$/, '');
    const base = raw.split(/[\\/]/).pop() || '';
    const m = base.match(ARCHIVE_RE);
    const kind: SourceInfo['kind'] = m ? 'archive' : 'folder';
    const archiveType = m ? m[1].toLowerCase() : '';
    let stem = m ? base.slice(0, base.length - m[0].length) : base;

    let version = '';
    let cut = -1;
    for (const v of stem.matchAll(VERSION_RE)) { version = v[1]; cut = v.index ?? -1; }
    if (version && cut > 0) stem = stem.slice(0, cut);

    const name = stem.replace(/[_]+/g, ' ').replace(/\s*-\s*$/, '').replace(/\s{2,}/g, ' ').trim() || base;
    return { kind, archiveType, base, name, version };
}

/** A relative path compared the way Windows compares it: `/`, lower case, no leading `./` or `/`. */
export function normRel(p: string): string {
    return String(p || '').replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '').replace(/\/+/g, '/').toLowerCase();
}

export function summarize(entries: TreeEntryLike[], cap = 0): SourceSummary {
    let files = 0, folders = 0, bytes = 0;
    const tops = new Map<string, boolean>();
    for (const e of entries || []) {
        const p = String(e?.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!p) continue;
        const parts = p.split('/').filter(Boolean);
        const isDir = !!e.is_dir || p.endsWith('/');
        if (isDir) folders++; else { files++; bytes += Number(e.size) || 0; }
        if (parts.length) {
            const top = parts[0];
            const topIsDir = parts.length > 1 || isDir;
            tops.set(top, (tops.get(top) || false) || topIsDir);
        }
    }
    const top = [...tops.entries()]
        .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] ? -1 : 1))
        .slice(0, 6)
        .map(([n, d]) => (d ? n + '/' : n));
    return { files, folders, bytes, top, capped: cap > 0 && (entries || []).length >= cap };
}

/** The files only, as relative paths (directories dropped). */
export function filePaths(entries: TreeEntryLike[]): string[] {
    return (entries || []).filter((e) => e && e.path && !e.is_dir && !String(e.path).endsWith('/')).map((e) => String(e.path));
}

/** Which other mods ship the same relative paths, biggest overlap first. */
export function findConflicts(newFiles: string[], others: Array<{ id: string; name: string; files: string[] }>, sampleSize = 3): ConflictHit[] {
    const mine = new Set((newFiles || []).map(normRel).filter(Boolean));
    if (!mine.size) return [];
    const hits: ConflictHit[] = [];
    for (const o of others || []) {
        let count = 0;
        const sample: string[] = [];
        for (const f of o.files || []) {
            if (!mine.has(normRel(f))) continue;
            count++;
            if (sample.length < sampleSize) sample.push(String(f).replace(/\\/g, '/'));
        }
        if (count) hits.push({ id: o.id, name: o.name, count, sample });
    }
    return hits.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function formatSize(bytes: number): string {
    const b = Math.max(0, Number(bytes) || 0);
    if (b < 1024) return `${b} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = b / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
