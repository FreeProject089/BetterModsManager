// Automation packages: the pure helpers (no DOM, no Tauri), shared by sched-pkg.ts and the
// DCS join-gate form, and tested in tests/sched-pkg-model.test.mjs.

/** What a package lists for one file (commands/sched_pkg.rs PkgFile). */
export interface PkgFile { name: string; sha256: string; size: number }

/** A size people read. */
export function kb(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The top-level items of a package (a file, or a folder of files), from its flat file list. */
export function itemsOf(files: PkgFile[]): { name: string; files: number; size: number }[] {
    const map = new Map<string, { name: string; files: number; size: number }>();
    for (const f of files) {
        const parts = f.name.split('/');
        const key = parts.slice(0, 2).join('/');
        const row = map.get(key) || { name: key, files: 0, size: 0 };
        row.files += 1;
        row.size += f.size;
        map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Split a command line into arguments: spaces separate, double quotes group. No shell: the
 *  list goes to the program as it is, so nothing in it is ever run as a second command. */
export function splitArgs(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    let any = false;
    for (const ch of String(line || '')) {
        if (ch === '"') { quoted = !quoted; any = true; continue; }
        if (!quoted && /\s/.test(ch)) {
            if (cur || any) out.push(cur);
            cur = '';
            any = false;
            continue;
        }
        cur += ch;
    }
    if (cur || any) out.push(cur);
    return out;
}

/** A package file name from a picked path: `files/<base name>`, made safe. */
export function entryNameFor(path: string): string {
    const base = String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'file';
    const clean = base.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'file';
    return `files/${clean}`;
}
