/**
 * profile-folders-model.ts — what the "New profile" dialog says about the folders picked.
 *
 * Pure: no DOM, no invoke. The dialog asks the backend whether a path exists and hands the
 * answer in; this decides what to tell the reader, as i18n keys with their variables, so the
 * same rules are unit-tested (tests/mod-flows.test.mjs) and read the same in both languages.
 *
 * The rules follow what the backend actually does:
 *  · create_profile refuses a game or mods folder that does not exist;
 *  · the backup folder holds the game files a mod replaced, so it must be this profile's alone;
 *  · the game folder may be shared: deployed files are owned by the game folder, not by a
 *    profile, so a file another profile put there is never backed up as an "original" and
 *    disabling falls back to the other profile's copy (commands/mods.rs).
 */

export type FolderKind = 'game' | 'mods' | 'backup';
export type NoteLevel = 'ok' | 'info' | 'warn' | 'error';

export interface FolderNote {
    level: NoteLevel;
    key: string;
    vars?: Record<string, string>;
}

export interface ProfileLike {
    id?: string;
    name: string;
    game_path?: string;
    mods_path?: string;
    backup_path?: string;
}

export interface FolderContext {
    /** null: not asked yet (no answer from the backend). */
    exists: boolean | null;
    gamePath: string;
    modsPath: string;
    backupPath: string;
    profiles: ProfileLike[];
    /** The profile being edited, left out of the "shared with" checks. */
    selfId?: string | null;
}

/** One spelling per folder: `\\?\` dropped, `/` separators, no trailing slash, lower case
 *  (Windows paths are case-insensitive, and so is every comparison made here). */
export function normFolder(p: string | null | undefined): string {
    let s = String(p ?? '').trim();
    if (!s) return '';
    s = s.replace(/^\\\\\?\\/, '').replace(/\\/g, '/');
    s = s.replace(/\/+/g, '/');
    while (s.length > 1 && s.endsWith('/') && !/^[a-z]:\/$/i.test(s)) s = s.slice(0, -1);
    return s.toLowerCase();
}

export function sameFolder(a: string | null | undefined, b: string | null | undefined): boolean {
    const x = normFolder(a);
    return !!x && x === normFolder(b);
}

/** `child` sits somewhere under `parent` (not the folder itself). */
export function isInside(child: string | null | undefined, parent: string | null | undefined): boolean {
    const c = normFolder(child);
    const p = normFolder(parent);
    if (!c || !p || c === p) return false;
    return c.startsWith(p.endsWith('/') ? p : p + '/');
}

/** The last segment of a path ("C:\\Games\\DCS World" → "DCS World"). */
export function folderName(p: string | null | undefined): string {
    const s = String(p ?? '').trim().replace(/[\\/]+$/, '');
    const parts = s.split(/[\\/]/);
    return parts[parts.length - 1] || '';
}

/** The parent folder, in the path's own spelling ("" for a drive root). */
export function parentFolder(p: string | null | undefined): string {
    const s = String(p ?? '').trim().replace(/[\\/]+$/, '');
    const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    return i > 0 ? s.slice(0, i) : '';
}

function others(ctx: FolderContext): ProfileLike[] {
    return (ctx.profiles || []).filter((p) => !ctx.selfId || p.id !== ctx.selfId);
}

function names(list: ProfileLike[]): string {
    return list.map((p) => p.name || p.id || '?').join(', ');
}

/** What to say under one folder field, most serious first. Empty path: nothing. */
export function folderNotes(kind: FolderKind, path: string, ctx: FolderContext): FolderNote[] {
    const notes: FolderNote[] = [];
    if (!normFolder(path)) return notes;
    if (ctx.exists === false) {
        notes.push({ level: 'error', key: 'prof.chk.missing' });
        return notes;
    }
    const rest = others(ctx);

    if (kind === 'game') {
        if (ctx.modsPath && isInside(path, ctx.modsPath)) notes.push({ level: 'error', key: 'prof.chk.gameInMods' });
        const shared = rest.filter((p) => sameFolder(p.game_path, path));
        if (shared.length) notes.push({ level: 'info', key: 'prof.chk.sharedGame', vars: { profiles: names(shared) } });
    } else if (kind === 'mods') {
        if (ctx.gamePath && sameFolder(path, ctx.gamePath)) notes.push({ level: 'error', key: 'prof.chk.modsIsGame' });
        else if (ctx.gamePath && isInside(path, ctx.gamePath)) notes.push({ level: 'warn', key: 'prof.chk.modsInGame' });
        const shared = rest.filter((p) => sameFolder(p.mods_path, path));
        if (shared.length) notes.push({ level: 'warn', key: 'prof.chk.sharedMods', vars: { profiles: names(shared) } });
    } else {
        if ((ctx.gamePath && sameFolder(path, ctx.gamePath)) || (ctx.modsPath && sameFolder(path, ctx.modsPath))) {
            notes.push({ level: 'error', key: 'prof.chk.backupIsOther' });
        } else if (ctx.gamePath && isInside(path, ctx.gamePath)) {
            notes.push({ level: 'warn', key: 'prof.chk.backupInGame' });
        }
        const shared = rest.filter((p) => sameFolder(p.backup_path, path));
        if (shared.length) notes.push({ level: 'error', key: 'prof.chk.sharedBackup', vars: { profiles: names(shared) } });
    }

    const rank: Record<NoteLevel, number> = { error: 0, warn: 1, info: 2, ok: 3 };
    notes.sort((a, b) => rank[a.level] - rank[b.level]);
    if (ctx.exists === true && !notes.some((n) => n.level === 'error' || n.level === 'warn')) {
        notes.push({ level: 'ok', key: 'prof.chk.ok' });
    }
    return notes;
}

export function hasError(notes: FolderNote[]): boolean {
    return notes.some((n) => n.level === 'error');
}

/** Folders worth offering as the mods folder once the game folder is known: a "Mods" folder
 *  beside or inside the game, or one named after the game next to it. The caller keeps the
 *  ones that exist (create_profile needs an existing folder) and are not the game folder. */
export function modsFolderCandidates(gamePath: string, gameName: string): string[] {
    const g = String(gamePath || '').trim().replace(/[\\/]+$/, '');
    if (!g) return [];
    const sep = g.includes('\\') ? '\\' : '/';
    const parent = parentFolder(g);
    const label = (gameName || folderName(g)).trim();
    const out: string[] = [];
    const push = (p: string) => { if (p && !out.some((x) => sameFolder(x, p)) && !sameFolder(p, g)) out.push(p); };
    if (parent) {
        if (label) push(`${parent}${sep}${label} Mods`);
        push(`${parent}${sep}Mods`);
    }
    push(`${g}${sep}Mods`);
    return out;
}

/** What still blocks Create, as i18n keys (empty: ready). */
export function missingForCreate(name: string, gamePath: string, modsPath: string, notes: FolderNote[][]): string[] {
    const missing: string[] = [];
    if (!String(name || '').trim()) missing.push('prof.need.name');
    if (!normFolder(gamePath)) missing.push('prof.need.game');
    if (!normFolder(modsPath)) missing.push('prof.need.mods');
    if (notes.some(hasError)) missing.push('prof.need.fix');
    return missing;
}
