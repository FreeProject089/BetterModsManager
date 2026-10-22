// protected-folder-model.ts — the backend's « the game folder is protected by Windows » answer.
//
// A game installed under C:\Program Files (DCS World's default) cannot be written by a BMM that
// is not running as administrator. The deploy now checks that BEFORE copying (and puts back what
// it copied when a copy still fails half-way), and answers with a typed error instead of the old
// « Failed to copy A -> B » (src-tauri/src/fs_utils.rs, `PROTECTED_FOLDER`):
//
//   PROTECTED_FOLDER|<game folder>|<protected root>|<Windows error text>
//
// Windows paths cannot contain `|`, so the two paths split cleanly; the OS text is the rest.
// This module only reads that string (no DOM, no app imports: the node tests load it as is);
// protected-folder.ts shows the dialog.

export const PROTECTED_FOLDER_PREFIX = 'PROTECTED_FOLDER|';

export interface ProtectedFolderInfo {
    /** The game folder BMM tried to write to. */
    game: string;
    /** The protected folder it is in (Program Files, Program Files (x86), Windows). */
    root: string;
    /** Windows' own words (« Access is denied. (os error 5) »), for the dialog and bug reports. */
    osError: string;
}

/** The text of whatever an invoke threw: a string, an Error, or something with a message. */
export function errorText(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
        return (err as { message: string }).message;
    }
    return err == null ? '' : String(err);
}

/** The parts of a PROTECTED_FOLDER error, or null for any other error. The code may be preceded
 *  by a wrapper's words (« Error: … »), so it is looked for, not required at index 0. */
export function parseProtectedFolderError(err: unknown): ProtectedFolderInfo | null {
    const s = errorText(err);
    const i = s.indexOf(PROTECTED_FOLDER_PREFIX);
    if (i < 0) return null;
    const parts = s.slice(i + PROTECTED_FOLDER_PREFIX.length).split('|');
    if (parts.length < 3) return null;
    const [game, root, ...rest] = parts;
    if (!game.trim() || !root.trim()) return null;
    return { game: game.trim(), root: root.trim(), osError: rest.join('|').trim() };
}

export function isProtectedFolderError(err: unknown): boolean {
    return parseProtectedFolderError(err) !== null;
}

/** The first protected-folder failure in a finished activation job's summary (core/activation-jobs.ts). */
export function protectedFolderInSummary(s: { failed?: ReadonlyArray<{ error?: string }> } | null | undefined): ProtectedFolderInfo | null {
    for (const f of s?.failed || []) {
        const info = parseProtectedFolderError(f?.error);
        if (info) return info;
    }
    return null;
}

export type Translate = (key: string, vars?: Record<string, string>) => string;

/** The dialog's words: what happened, why, what to do, and Windows' own text. */
export function protectedFolderLines(info: ProtectedFolderInfo, t: Translate): { title: string; what: string; why: string; todo: string; os: string } {
    return {
        title: t('mod.protectedFolder.title'),
        what: t('mod.protectedFolder.what', { game: info.game }),
        why: t('mod.protectedFolder.why', { root: info.root }),
        todo: t('mod.protectedFolder.todo', { root: info.root }),
        os: info.osError ? t('mod.protectedFolder.osError', { error: info.osError }) : '',
    };
}

/** A short line for a list of failures (an order list's report): never the raw code. */
export function failureLine(err: unknown, t: Translate): string {
    return isProtectedFolderError(err) ? t('mod.protectedFolder.short') : t(errorText(err));
}
