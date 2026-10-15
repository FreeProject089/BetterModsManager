// update-history-model.ts — the pure half of the Versions tab (ui/update-history.ts): which
// files under Update/ are version notes, which version each is, and how they group. No DOM, no
// app imports: the node tests load it directly.

export interface NoteFile { filename: string; content: string; path: string }

export interface Version {
    version: string;
    main: NoteFile;
    kind: 'changelog' | 'release' | 'github' | 'ptb';
    others: NoteFile[];
    counts: { added: number; improved: number; fixed: number };
}

export const KIND_RANK = { changelog: 3, release: 2, github: 1, ptb: 0 } as const;

export function kindOf(name: string): Version['kind'] | null {
    const n = name.toLowerCase();
    if (!/\d+\.\d+\.\d+/.test(n)) return null;
    if (n.startsWith('changelog')) return 'changelog';
    if (n.startsWith('release_notes')) return 'release';
    if (n.startsWith('github_release')) return 'github';
    if (/ptb/.test(n)) return 'ptb';
    return null;
}

export function versionOf(name: string): string | null {
    const m = name.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

export function cmpVersion(a: string, b: string): number {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
    return 0;
}

/** What a version brought, counted from its `## [NEW]` / `## [IMPROVED]` / `## [FIXED]` headings. */
export function countSections(md: string): Version['counts'] {
    const c = { added: 0, improved: 0, fixed: 0 };
    for (const m of md.matchAll(/^#{2,3}\s*\[([^\]]+)\]/gm)) {
        const tag = m[1].toUpperCase();
        if (tag === 'NEW' || tag === 'NOUVEAU') c.added++;
        else if (/IMPROVED|AMÉLIORÉ|AMELIORE|REFINE|RAFFINEMENT|VISUAL|VISUEL/.test(tag)) c.improved++;
        else if (/FIXED|FIXÉ|FIXE|CORRIGÉ/.test(tag)) c.fixed++;
    }
    return c;
}

export function groupVersions(notes: NoteFile[]): Version[] {
    const by = new Map<string, NoteFile[]>();
    for (const n of notes) {
        const k = kindOf(n.filename), v = versionOf(n.filename);
        if (!k || !v) continue;
        if (!by.has(v)) by.set(v, []);
        by.get(v)!.push(n);
    }
    const out: Version[] = [];
    for (const [version, files] of by) {
        files.sort((a, b) => KIND_RANK[kindOf(b.filename)!] - KIND_RANK[kindOf(a.filename)!]);
        const main = files[0];
        out.push({ version, main, kind: kindOf(main.filename)!, others: files.slice(1), counts: countSections(main.content) });
    }
    return out.sort((a, b) => cmpVersion(b.version, a.version));
}

