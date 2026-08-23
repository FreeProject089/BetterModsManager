import { invoke, getSettings, pickFile } from './api.js';

// The identity key control, wired ONCE and mounted wherever it is needed.
//
// BMM holds ONE key and presents it to every repository and catalogue that requires one, so
// there is exactly one value here — but three screens where a person reasonably looks for it:
// Settings → Identity & API, the repo sync panel, and the catalogue sources card. Three doors
// onto one value is right; three copies of the wiring is how one of them ends up writing a
// setting the others cannot see. So the doors share this.
//
// A PATH is stored, never key material: the file is read at the moment a proof is signed and
// the bytes are dropped.

export interface IdentityKeyIds {
    /** Read-only input that shows the stored path. */
    input: string;
    /** Button that opens the file picker. */
    pick: string;
    /** Button that clears the setting. */
    clear: string;
}

/** The stored path, or '' when none is set. */
export async function identityKeyPath(): Promise<string> {
    try {
        return String((await getSettings()).key_auth_key_path || '').trim();
    } catch {
        // Settings unreadable is not the same as "no key" — but the control has nothing
        // truthful to show either way, so it shows nothing rather than claiming "None".
        return '';
    }
}

/**
 * Wire one mount point. Safe to call when the elements are absent (a screen that does not
 * have this control simply gets nothing), and safe to call twice — the guard attribute stops
 * a second listener stacking on the same button, which would fire the picker twice.
 */
/**
 * How the mounting screen reports what happened.
 *
 * `notify` takes an i18n KEY, not a sentence: this module lives in core/ and must not reach
 * into ui/ for a toast — a dynamic import is still an edge, and core → ui → core is a cycle.
 * It also happens to be the right split: this knows WHAT happened, the screen knows how to
 * say it.
 */
export type IdentityKeyNotify = (i18nKey: string, kind: 'success' | 'warning') => void;

export function wireIdentityKey(
    ids: IdentityKeyIds,
    notify?: IdentityKeyNotify,
    onChange?: (path: string) => void,
): void {
    const input = document.getElementById(ids.input) as HTMLInputElement | null;
    const pick = document.getElementById(ids.pick);
    const clear = document.getElementById(ids.clear);
    if (!pick || !clear) return;
    if (pick.dataset.idkWired === '1') return;
    pick.dataset.idkWired = '1';

    const show = (p: string) => {
        if (input) { input.value = p; input.title = p; }
        onChange?.(p);
    };

    pick.addEventListener('click', async () => {
        const path = await pickFile();
        if (!path) return;
        try {
            await invoke('set_key_auth_key', { path });
            show(path);
            notify?.('settings.identity.authKeySet', 'success');
        } catch (e) {
            // The backend refuses a file it cannot sign with, so this is "wrong file", not
            // "save failed" — name which, or the same file gets picked again.
            notify?.(String(e) === 'repo.ssh.errKeyPassphrase'
                ? 'settings.identity.authKeyLocked'
                : 'settings.identity.authKeyBad', 'warning');
        }
    });

    clear.addEventListener('click', async () => {
        try {
            await invoke('set_key_auth_key', { path: null });
            show('');
            notify?.('settings.identity.authKeyCleared', 'success');
        } catch { /* nothing was set */ }
    });
}

/** Fill a mount point's input from the stored setting. */
export async function refreshIdentityKey(ids: IdentityKeyIds): Promise<string> {
    const p = await identityKeyPath();
    const input = document.getElementById(ids.input) as HTMLInputElement | null;
    if (input) { input.value = p; input.title = p; }
    return p;
}
