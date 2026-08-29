import { invoke, pickFile } from './api.js';

// The identity KEYRING: named ed25519 keys BMM can prove itself with, and which one signs.
//
// Held once and mounted wherever it is needed — the Settings manager, the repo sync panel,
// the catalogue access fold. Three doors onto one ring; three copies of the wiring is how one
// of them ends up writing a setting the other two cannot see.
//
// Paths and names, never key material: a file is opened at the moment a proof is signed and
// the bytes are dropped.
//
// This module lives in core/ and must not reach into ui/ for a toast — a dynamic import is
// still an edge, and core → ui → core is a cycle the dep-graph gate counts. Callers pass a
// notifier that takes an i18n KEY: this knows WHAT happened, the screen knows how to say it.

export interface KeyEntry {
    /** The stable handle. Minted once, never derived from the name, so a rename keeps it. */
    id: string;
    name: string;
    path: string;
}
export interface KeyringView {
    keys: KeyEntry[];
    /** The key that signs when no per-source choice applies. */
    active: string | null;
    /** origin (`scheme://host`) → key name. */
    byOrigin: Record<string, string>;
}
export type Notify = (i18nKey: string, kind: 'success' | 'warning') => void;

export async function listKeyring(): Promise<KeyringView> {
    const v = await invoke('key_auth_list');
    // CHECKED, not asserted. `as KeyringView` told TypeScript this was a keyring and told the
    // runtime nothing: a build whose backend does not answer this command hands back null, the
    // cast waves it through, and the first `.byOrigin` throws deep inside a caller's `fill()` —
    // where it became an unhandled rejection and the dropdown just sat there empty. Empty is
    // also what "you own no keys" looks like, so the two were indistinguishable on screen.
    // Throwing here puts the failure where a caller can catch it and say so.
    if (!v || typeof v !== 'object' || !Array.isArray((v as KeyringView).keys)) {
        throw new Error('key_auth_list returned no keyring');
    }
    const view = v as KeyringView;
    // `by_origin` is optional on the wire; a missing map is "no per-source choices", not a fault.
    if (!view.byOrigin) view.byOrigin = {};
    return view;
}

/** The origin a URL's proof would be addressed to — the unit a per-source choice applies to. */
export async function originOf(url: string): Promise<string | null> {
    try {
        return ((await invoke('key_auth_origin_of', { url })) as string | null) ?? null;
    } catch {
        return null;
    }
}

/**
 * The manager: one row per key, a radio for which one signs, remove, and an add row.
 *
 * Re-painted from the value the backend returns rather than from what we just sent it, so the
 * screen can never show a ring the app is not actually using.
 */
export async function renderKeyManager(
    listId: string,
    nameInputId: string,
    addButtonId: string,
    notify?: Notify,
    t: (k: string) => string = (k) => k,
): Promise<void> {
    const list = document.getElementById(listId);
    const nameInput = document.getElementById(nameInputId) as HTMLInputElement | null;
    const addBtn = document.getElementById(addButtonId);
    if (!list) return;

    const paint = (view: KeyringView) => {
        list.textContent = '';
        if (!view.keys.length) {
            const empty = document.createElement('span');
            empty.style.cssText = 'font-size:11px;color:var(--text-muted);';
            empty.textContent = t('settings.identity.authKeyNone');
            list.appendChild(empty);
            return;
        }
        for (const k of view.keys) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';

            // A radio, not a dropdown: with three keys the whole ring and the current choice
            // are one glance, and choosing is one click rather than open-scan-click.
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'bmm-identity-key';
            radio.checked = view.active === k.name;
            radio.title = t('settings.identity.authKeyUse');
            radio.style.cssText = 'flex:0 0 auto;cursor:pointer;';
            radio.addEventListener('change', async () => {
                try {
                    paint((await invoke('key_auth_set_active', { name: k.name })) as KeyringView);
                    notify?.('settings.identity.authKeyActive', 'success');
                } catch { notify?.('settings.identity.authKeyBad', 'warning'); }
            });

            const label = document.createElement('span');
            label.style.cssText = 'font-weight:600;font-size:11px;flex:0 0 auto;';
            label.textContent = k.name;

            // The handle, next to the name that is NOT one. The only reason to read it is to
            // paste it somewhere else, so clicking copies rather than making anyone select
            // eleven characters of monospace by hand.
            const id = document.createElement('button');
            id.type = 'button';
            id.className = 'idk-handle';
            id.textContent = k.id || '\u2014';
            id.title = t('settings.identity.authKeyIdCopy');
            id.disabled = !k.id;
            id.addEventListener('click', async () => {
                if (!k.id) return;
                try {
                    await navigator.clipboard.writeText(k.id);
                    notify?.('settings.identity.authKeyIdCopied', 'success');
                } catch {
                    // Clipboard denied is not silence: the id is short enough to read off the
                    // screen, and saying nothing would look like the click did nothing.
                    notify?.('settings.identity.authKeyIdNoCopy', 'warning');
                }
            });

            const path = document.createElement('span');
            path.style.cssText = 'font-size:10px;color:var(--text-muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            path.textContent = k.path;
            path.title = k.path;

            const del = document.createElement('button');
            del.className = 'sic-btn danger';
            del.textContent = t('settings.identity.authKeyClear');
            del.addEventListener('click', async () => {
                try {
                    paint((await invoke('key_auth_remove', { name: k.name })) as KeyringView);
                    notify?.('settings.identity.authKeyCleared', 'success');
                } catch { /* already gone */ }
            });

            row.append(radio, label, id, path, del);
            list.appendChild(row);
        }
    };

    try {
        paint(await listKeyring());
    } catch {
        // Same rule as the chooser: a blank list and a broken backend must not look alike.
        list.textContent = '';
        const bad = document.createElement('span');
        bad.style.cssText = 'font-size:11px;color:var(--bmm-warning);';
        bad.textContent = t('settings.identity.authKeyUnavailable');
        list.appendChild(bad);
    }

    if (addBtn && addBtn.dataset.krWired !== '1') {
        addBtn.dataset.krWired = '1';
        addBtn.addEventListener('click', async () => {
            const typed = (nameInput?.value || '').trim();
            const path = await pickFile();
            if (!path) return;
            // No name typed? Use the FILE's name. Demanding one first turned "add this key"
            // into a two-step form for a value the file already carries, and `id_ed25519` is
            // exactly what people call that key anyway. A typed name still wins.
            const base = path.split(/[\\/]/).pop() || '';
            const name = typed || base.replace(/\.(pub|ppk|pem|key)$/i, '') || 'key';
            try {
                paint((await invoke('key_auth_add', { name, path })) as KeyringView);
                if (nameInput) nameInput.value = '';
                notify?.('settings.identity.authKeySet', 'success');
            } catch (e) {
                // The backend refuses a file it cannot sign with, so this is "wrong file",
                // not "save failed" — name which, or the same file gets picked again.
                notify?.(String(e) === 'repo.ssh.errKeyPassphrase'
                    ? 'settings.identity.authKeyLocked'
                    : 'settings.identity.authKeyBad', 'warning');
            }
        });
    }
}

/**
 * A chooser bound to one source: which key signs for that server.
 *
 * Per ORIGIN, because that is what a proof is addressed to. A finer unit — per catalogue, per
 * kind — would be a promise the protocol cannot keep: one request to one host carries one
 * proof, so every catalogue on that server shares the answer whether the screen says so or
 * not. Saying so is the honest option.
 *
 * `urlOf` is read at the moment of use rather than captured, so the chooser follows whatever
 * address the field beside it currently holds.
 */
export async function renderKeySelect(
    selectId: string,
    urlOf: () => string,
    notify?: Notify,
    t: (k: string) => string = (k) => k,
): Promise<void> {
    const sel = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!sel) return;

    /** One option that explains itself, for when there is nothing to choose from. */
    const only = (label: string, broken: boolean) => {
        sel.textContent = '';
        const o = document.createElement('option');
        o.value = '';
        o.textContent = label;
        sel.appendChild(o);
        sel.disabled = true;
        // The reason travels as a title, so a screenshot of the dropdown carries it.
        sel.title = broken ? label : '';
    };

    const fill = async () => {
        let view: KeyringView;
        try {
            view = await listKeyring();
        } catch (e) {
            // NOT silence. An empty dropdown reads as "you have no keys", which is a
            // different fact from "this build cannot answer" — and the second one is usually
            // an app that has not been rebuilt since the keyring existed.
            only(t('settings.identity.authKeyUnavailable'), true);
            notify?.('settings.identity.authKeyUnavailable', 'warning');
            return;
        }
        const origin = await originOf(urlOf()).catch(() => null);
        const chosen = origin ? view.byOrigin[origin] : undefined;
        sel.textContent = '';

        const auto = document.createElement('option');
        auto.value = '';
        // Three different states, three different sentences. "Par défaut (aucune choisie)" on
        // an EMPTY ring is a lie by omission — it suggests a default exists and was not picked,
        // when there is nothing to pick. An empty list has to say it is empty.
        auto.textContent = !view.keys.length
            ? t('settings.identity.authKeyNoneAtAll')
            : view.active
                ? t('settings.identity.authKeyAuto').replace('{name}', view.active)
                : t('settings.identity.authKeyAutoNone');
        sel.appendChild(auto);

        for (const k of view.keys) {
            const o = document.createElement('option');
            o.value = k.name;
            o.textContent = k.name;
            if (chosen === k.name) o.selected = true;
            sel.appendChild(o);
        }
        sel.disabled = !view.keys.length;
    };

    if (sel.dataset.krWired !== '1') {
        sel.dataset.krWired = '1';
        sel.addEventListener('change', async () => {
            try {
                await invoke('key_auth_set_for_url', { url: urlOf(), name: sel.value || null });
                notify?.('settings.identity.authKeyForSource', 'success');
            } catch (e) {
                // A URL with no origin is the usual cause — an empty field, or `ssh://name`,
                // which has no host to address a proof to.
                notify?.(String(e) === 'repo.keyauth.errBadUrl'
                    ? 'repo.keyauth.errBadUrl'
                    : 'settings.identity.authKeyBad', 'warning');
                await fill();
            }
        });
    }
    await fill();
}

/** Repaint a chooser after its source address changed. */
export async function refreshKeySelect(selectId: string, urlOf: () => string, t?: (k: string) => string): Promise<void> {
    await renderKeySelect(selectId, urlOf, undefined, t);
}
