// protected-folder.ts — the dialog shown when Windows refuses BMM a game folder.
//
// The owner's diagnostic export: enabling a mod into C:\Program Files\Eagle Dynamics\DCS World
// failed with « Failed to copy A -> B » and no way out. The backend now answers
// PROTECTED_FOLDER|… (protected-folder-model.ts) and nothing is left half-applied; this says
// what happened, why, and offers:
//
//   · Restart BMM as administrator — `restart_elevated`: Windows shows its UAC prompt, the person
//     answers; on Yes the elevated BMM opens on the saved profile and this one closes;
//   · Learn more — the troubleshooting section (BMM Docs reference/troubleshooting#protected-folder);
//   · Cancel.
//
// One dialog at a time: an « Enable all » that hits the same folder ten times asks once.
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { invoke } from '../../core/api.js';
import { openModal } from '../../ui/modal-shell.js';
import { raiseAboveAll } from '../../ui/layer.js';
import { uiIcon } from '../../ui/icons.js';
import { openLearnMore } from '../../core/learn-more.js';
import { protectedFolderLines, parseProtectedFolderError, type ProtectedFolderInfo } from './protected-folder-model.js';

export type ProtectedFolderChoice = 'restart' | 'learn' | 'cancel';

let open: Promise<ProtectedFolderChoice> | null = null;

function say(msg: string, kind: string): void {
    try { (window as unknown as { toast?: (m: string, k: string, ms?: number) => void }).toast?.(msg, kind, 7000); } catch { /* no toast host */ }
}

/** Show the dialog for `info` (or join the one already open). Resolves with what was chosen. */
export function showProtectedFolderDialog(info: ProtectedFolderInfo): Promise<ProtectedFolderChoice> {
    if (open) return open;
    const L = protectedFolderLines(info, (k, v) => t(k, v || {}));
    open = new Promise<ProtectedFolderChoice>((resolve) => {
        let choice: ProtectedFolderChoice = 'cancel';
        const m = openModal({
            title: L.title,
            icon: uiIcon('warning', 18),
            tone: 'warn',
            size: 'sm',
            className: 'vfy-modal pf-modal',
            closeLabel: t('common.close'),
            body: `<p class="vfy-msg">${escHtml(L.what)}</p>
                <p class="vfy-msg">${escHtml(L.why)}</p>
                <p class="vfy-msg">${escHtml(L.todo)}</p>
                ${L.os ? `<p class="vfy-msg pf-os"><small>${escHtml(L.os)}</small></p>` : ''}
                <p class="vfy-msg pf-wait" role="status" hidden>${escHtml(t('mod.protectedFolder.restarting'))}</p>`,
            footer: `<button type="button" class="btn btn-ghost" data-pf="cancel">${escHtml(t('common.cancel'))}</button>
                <button type="button" class="btn btn-ghost" data-pf="learn">${escHtml(t('mod.protectedFolder.learnMore'))}</button>
                <button type="button" class="btn btn-primary" data-pf="restart">${escHtml(t('mod.protectedFolder.restart'))}</button>`,
            initialFocus: '[data-pf="cancel"]',
            onClose: () => { open = null; resolve(choice); },
        });
        raiseAboveAll(m.overlay);
        const buttons = Array.from(m.dialog.querySelectorAll<HTMLButtonElement>('[data-pf]'));
        m.q('[data-pf="cancel"]')?.addEventListener('click', () => { choice = 'cancel'; m.close(); });
        m.q('[data-pf="learn"]')?.addEventListener('click', () => {
            choice = 'learn';
            m.close();
            openLearnMore('protected-folder');
        });
        m.q('[data-pf="restart"]')?.addEventListener('click', async () => {
            choice = 'restart';
            const wait = m.q<HTMLElement>('.pf-wait');
            buttons.forEach((b) => { b.disabled = true; });
            if (wait) wait.hidden = false;
            try {
                // Windows' UAC prompt is up while this waits; on Yes this window closes by itself.
                await invoke('restart_elevated');
            } catch (e) {
                const msg = String((e as { message?: string })?.message ?? e);
                say(t(msg), 'error');
                buttons.forEach((b) => { b.disabled = false; });
                if (wait) wait.hidden = true;
                choice = 'cancel';
            }
        });
    });
    return open;
}

/** Show the dialog when `err` is a protected-folder error. True when it was one. */
export function handleProtectedFolderError(err: unknown): boolean {
    const info = parseProtectedFolderError(err);
    if (!info) return false;
    void showProtectedFolderDialog(info);
    return true;
}

// ── The warning before the first activation ─────────────────────────────────────────────
// A profile whose game folder is under Program Files and a BMM that is not elevated: one line
// under the edit-profile game folder and in the Library header, so the refusal is not a surprise.
// (The new-profile form says it in its own notes: profiles/profile-create.ts.)

const lastAsked = new Map<string, string>();

/** The protected root `path` is in when BMM would need elevation for it, else ''. */
async function rootNeedingElevation(path: string): Promise<string> {
    if (!path.trim()) return '';
    try {
        const p = (await invoke('check_folder_protection', { path }, { quiet: true })) as { needs_elevation?: boolean; root?: string | null } | null;
        return p && p.needs_elevation ? String(p.root || '') : '';
    } catch {
        return '';
    }
}

/** Show (or remove) the one-line warning `hintId` after `anchor` for `path`. */
async function paintHint(anchor: Element | null, hintId: string, path: string): Promise<void> {
    if (!anchor) return;
    lastAsked.set(hintId, path);
    const root = await rootNeedingElevation(path);
    if (lastAsked.get(hintId) !== path) return; // a newer path was asked meanwhile
    let el = document.getElementById(hintId);
    if (!root) { el?.remove(); return; }
    if (!el) {
        el = document.createElement('p');
        el.id = hintId;
        el.className = 'pf-hint np-note np-note--warn';
        el.setAttribute('role', 'note');
        anchor.insertAdjacentElement('afterend', el);
    }
    el.innerHTML = `${uiIcon('warning', 14)}<span>${escHtml(t('mod.protectedFolder.warning', { root }))}</span>`;
}

/** Under a game-folder input (the edit-profile dialog). */
export function paintProtectedHint(inputId: string, path: string): Promise<void> {
    const input = document.getElementById(inputId);
    const anchor = input?.closest('.path-picker') || input;
    return paintHint(anchor || null, `${inputId}-protected`, path);
}

/** In the Library header, for the active profile. */
export async function paintLibraryProtectedHint(activeProfileId: string | null | undefined): Promise<void> {
    const sub = document.getElementById('lib-subtitle');
    if (!sub) return;
    let path = '';
    if (activeProfileId) {
        try {
            const profiles = ((await invoke('get_profiles', {}, { quiet: true })) as Array<{ id: string; game_path?: string }>) || [];
            path = profiles.find((p) => p.id === activeProfileId)?.game_path || '';
        } catch { path = ''; }
    }
    return paintHint(sub, 'lib-protected-hint', path);
}
