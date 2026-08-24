// "This repo lives on an SSH machine" — the block, shared by both update screens.
//
// WHY IT IS NOT THE PROTECTED-SOURCE BLOCK
//
// `source-access.ts` answers a different question. It carries a download password and an
// identity key for an HTTP server that asks callers to prove who they are — the credentials a
// SUBSCRIBER presents. This is the credentials an AUTHOR needs to reach their own machine over
// SSH: an account, a directory, and either a password or a private key. Putting SSH fields in
// the protected-source fold would have made one control mean two unrelated things depending on
// the URL typed above it.
//
// WHAT IT REUSES
//
// The servers themselves are the ones already configured under "Publish over SSH". Asking for
// host, port, user and remote directory a second time would be a second copy of the same
// facts, free to drift, and a fingerprint trusted in one place and unknown in the other. What
// this block adds is the two things that are deliberately never stored — the account password
// and the key passphrase — plus the option of pointing at a different private key for this
// run, including one from the identity keyring.
//
// NOTHING HERE IS WRITTEN ANYWHERE. The fields are read at the moment of use and the values
// travel as call arguments; that is the same contract the publish panel keeps.

import { t } from '../../core/i18n.js';
import { pickFile } from '../../core/api.js';
import { loadTargets, type SshTarget } from './repo-ssh.js';
import { closeOwningOverlay } from '../../core/source-access.js';

/** What a caller passes straight through to `plan_remote_repo_refresh` / `refresh_repo_from_server`. */
export interface SshSourceArgs {
    ssh: SshTarget | null;
    sshSecret: string | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/**
 * The markup. `p` is a per-screen prefix so two of these can coexist on one page.
 *
 * A `<details>` on purpose: an HTTP repo — still the common case — must not have to look at
 * four SSH fields to ignore them, and a fold that is shut is a clear statement that none of
 * this applies.
 */
export function sshSourceHtml(p: string): string {
    return `
    <details class="ssh-src" id="${p}-ssh">
      <summary>${esc(t('repo.sshsrc.title'))}</summary>
      <div class="ssh-src-body">
        <p class="ssh-src-hint">${esc(t('repo.sshsrc.desc'))}</p>

        <label class="ssh-src-label" for="${p}-ssh-target">${esc(t('repo.sshsrc.server'))}</label>
        <div class="ssh-src-row">
          <select class="input input-sm" id="${p}-ssh-target"></select>
          <button type="button" class="btn btn-sm" id="${p}-ssh-config">${esc(t('repo.sshsrc.configure'))}</button>
        </div>
        <div class="ssh-src-sum" id="${p}-ssh-sum"></div>

        <label class="ssh-src-label" for="${p}-ssh-pw">${esc(t('repo.sshsrc.password'))}</label>
        <input type="password" class="input input-sm" id="${p}-ssh-pw" autocomplete="off" placeholder="—">

        <label class="ssh-src-label" for="${p}-ssh-key">${esc(t('repo.sshsrc.key'))}</label>
        <div class="ssh-src-row">
          <input type="text" class="input input-sm" id="${p}-ssh-key" spellcheck="false"
                 placeholder="${esc(t('repo.sshsrc.keyPh'))}">
          <button type="button" class="btn btn-sm" id="${p}-ssh-key-pick">${esc(t('repo.ssh.browse'))}</button>
        </div>
        <div class="ssh-src-row">
          <select class="input input-sm" id="${p}-ssh-ring"></select>
          <button type="button" class="btn btn-sm" id="${p}-ssh-manage">${esc(t('repo.ssh.manageKeys'))}</button>
        </div>
        <input type="password" class="input input-sm" id="${p}-ssh-pass" autocomplete="off"
               placeholder="${esc(t('repo.sshsrc.passphrasePh'))}">

        <p class="ssh-src-hint">${esc(t('repo.sshsrc.note'))}</p>
      </div>
    </details>`;
}

/**
 * Wire it. `manageKeys` is supplied by the screen for the same reason `source-access` does it:
 * knowing how to navigate is the screen's job, not this module's.
 */
export function wireSshSource(p: string, manageKeys: () => void): void {
    const det = document.getElementById(`${p}-ssh`) as HTMLDetailsElement | null;
    const sel = document.getElementById(`${p}-ssh-target`) as HTMLSelectElement | null;
    if (!det || !sel) {
        // Loud, for the same reason the protected-source block is: a silent return here
        // produces a screen that looks complete and does nothing.
        console.error(`[ssh-source] "${p}" was wired before its markup was in the document.`);
        return;
    }

    const sum = document.getElementById(`${p}-ssh-sum`);

    // A const arrow, not a function declaration: `sel` was narrowed to non-null by the guard
    // above, and a hoisted declaration is outside that narrowing — tsc rejects it, correctly,
    // because nothing stops such a function being called before the guard runs.
    /** Who and where, spelled out. A target name alone says nothing about what it points at. */
    const paintSummary = (): void => {
        if (!sum) return;
        const tg = loadTargets()[sel.value];
        if (!tg) { sum.textContent = ''; sum.hidden = true; return; }
        sum.hidden = false;
        sum.textContent = `${tg.user}@${tg.host}${tg.port && tg.port !== 22 ? `:${tg.port}` : ''}  ${tg.remoteDir}`;
    };

    /** Saved targets, re-read on every open — one may have been added since. */
    const fillTargets = () => {
        const all = loadTargets();
        const names = Object.keys(all);
        const keep = sel.value;
        sel.textContent = '';
        const none = document.createElement('option');
        none.value = '';
        none.textContent = names.length
            ? t('repo.sshsrc.noneUseUrl')
            : t('repo.sshsrc.noTargets');
        sel.appendChild(none);
        for (const n of names) {
            const o = document.createElement('option');
            o.value = n;
            o.textContent = n;
            sel.appendChild(o);
        }
        // A selection made before a repaint survives it; a name that has since been deleted
        // falls back to "none" rather than to a target that no longer exists.
        if (keep && names.includes(keep)) sel.value = keep;
        paintSummary();
    };

    const fillRing = async () => {
        const ring = document.getElementById(`${p}-ssh-ring`) as HTMLSelectElement | null;
        if (!ring) return;
        const put = (label: string, disabled: boolean) => {
            ring.textContent = '';
            const o = document.createElement('option');
            o.value = ''; o.textContent = label;
            ring.appendChild(o);
            ring.disabled = disabled;
        };
        try {
            const { listKeyring } = await import('../../core/identity-key.js');
            const view = await listKeyring();
            if (!view.keys.length) { put(t('repo.ssh.ringEmpty'), true); return; }
            put(t('repo.ssh.ringPick'), false);
            for (const k of view.keys) {
                const o = document.createElement('option');
                o.value = k.path;
                o.textContent = k.name;
                ring.appendChild(o);
            }
        } catch {
            // Never an empty list on failure: empty means "you own no keys", which is a
            // different fact and the one that cost three rounds of debugging elsewhere.
            put(t('settings.identity.authKeyUnavailable'), true);
        }
    };

    det.addEventListener('toggle', () => {
        if (!det.open) return;
        fillTargets();
        void fillRing();
    });
    sel.addEventListener('change', paintSummary);

    document.getElementById(`${p}-ssh-ring`)?.addEventListener('change', (e) => {
        const path = (e.target as HTMLSelectElement).value;
        if (!path) return;
        // Fills the path field rather than replacing what it means: what will be read at
        // connect time stays visible and editable.
        const input = document.getElementById(`${p}-ssh-key`) as HTMLInputElement | null;
        if (input) input.value = path;
    });

    document.getElementById(`${p}-ssh-key-pick`)?.addEventListener('click', async () => {
        const f = await pickFile().catch(() => null);
        if (!f) return;
        const input = document.getElementById(`${p}-ssh-key`) as HTMLInputElement | null;
        if (input) input.value = f;
    });

    document.getElementById(`${p}-ssh-manage`)?.addEventListener('click', () => {
        // Leave the dialog before navigating. Without this the button did exactly half its
        // job: Settings loaded underneath, and the modal stayed on top of the page it had
        // just taken you to.
        closeOwningOverlay(det);
        manageKeys();
    });
    document.getElementById(`${p}-ssh-config`)?.addEventListener('click', () => {
        // The servers live in one place. Sending people there beats a second, drifting copy
        // of host/port/user/dir on this screen.
        document.getElementById('repo-ssh-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const body = document.getElementById('repo-ssh-body');
        const toggle = document.getElementById('repo-ssh-toggle');
        if (body?.hidden) { body.hidden = false; toggle?.setAttribute('aria-expanded', 'true'); }
    });

    fillTargets();
}

/**
 * Read the block, in the shape the two backend commands take.
 *
 * Returns nulls when no server is chosen — that is the ordinary HTTP case, not a mistake, so
 * it reports nothing and the caller carries on with the URL it already has.
 */
export function readSshSource(p: string): SshSourceArgs {
    const sel = document.getElementById(`${p}-ssh-target`) as HTMLSelectElement | null;
    const name = sel?.value || '';
    if (!name) return { ssh: null, sshSecret: null };

    const saved = loadTargets()[name];
    if (!saved) return { ssh: null, sshSecret: null };

    const val = (id: string) =>
        (document.getElementById(`${p}-${id}`) as HTMLInputElement | null)?.value?.trim() || '';
    const pw = val('ssh-pw');
    const keyPath = val('ssh-key');
    const passphrase = val('ssh-pass');

    // A password typed here wins, because typing one is an explicit statement about how to
    // authenticate THIS run. Otherwise it is key auth, using the key named here if one is —
    // which lets a saved target be reused with a different key without editing the target.
    const usePassword = pw.length > 0;
    return {
        ssh: {
            ...saved,
            auth: usePassword ? 'password' : 'key',
            keyPath: usePassword ? '' : (keyPath || saved.keyPath),
        },
        sshSecret: usePassword ? pw : (passphrase || null),
    };
}
