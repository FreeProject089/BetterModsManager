// Publish this, or fetch it, over SSH — the same panel wherever that sentence makes sense.
//
// It was one card, in Generate Repository, that did everything: configured a server, chose a
// folder, and published. Everything else either had no SSH at all or had a lone button that
// published to whichever profile the object happened to enumerate first, with no destination
// and no way to type a passphrase.
//
// So the parts are separated:
//
//   ssh-servers.ts   WHERE — the machines you own, configured once, from anywhere
//   ssh-action.ts    WHAT  — this panel: pick one of them, say where, go
//
// A caller says what it has (a folder, one file, or "let them choose") and which direction
// makes sense. Everything else — the profile list, the destination, the secret, the progress,
// the error translation — is the same on every card, because it is the same question.
import { invoke, pickFile, pickFolder } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { sshTargetNames, storedSshTarget, explainSsh, type SshTarget } from './repo-ssh.js';
import { openSshServers, onSshServersChanged } from './ssh-servers.js';

/** What the caller is publishing, or fetching into. */
export interface SshActionSource {
    /** A whole folder. The repo export, a staged catalogue. */
    dir?: () => string;
    /** One file. A regenerated `repo.json`, a `catalog.json`, a `.bmmbundle`. */
    file?: () => string;
    /**
     * Where it lands under the profile's base folder. '' means the base itself.
     *
     * For a single file this is its NAME on the server, which is why it is not derived from
     * the local path: `C:\Users\me\Desktop\repo.json` must not become that on a server.
     */
    remoteName?: string;
    /** Let the reader choose the source themselves, rather than the card deciding. */
    pick?: 'dir' | 'file';
}

export interface SshActionOpts {
    /** Which way round. `both` draws two buttons. */
    mode: 'publish' | 'fetch' | 'both';
    source: SshActionSource;
    /** The line above the panel. Each card explains what IT publishes. */
    label?: string;
    /** Ask before publishing — for the ones that overwrite what people are downloading. */
    confirm?: boolean;
    /** Called after a successful transfer, with the byte count. */
    onDone?: (bytes: number, direction: 'up' | 'down') => void;
}

const uid = (): string => `ssha${Math.random().toString(36).slice(2, 9)}`;

/**
 * Draw the panel into `host`.
 *
 * Idempotent per host: mounting twice replaces the first, so a card that re-renders does not
 * end up with two of these quietly publishing to different servers.
 */
export function mountSshAction(host: HTMLElement | null, opts: SshActionOpts): void {
    if (!host) return;
    host.querySelector('.ssh-action')?.remove();

    const id = uid();
    const box = document.createElement('div');
    box.className = 'ssh-action';
    box.dataset.sshAction = id;
    host.appendChild(box);

    let busy = false;

    const render = (): void => {
        const names = sshTargetNames();
        // No profile: one honest sentence and the way to fix it. A disabled dropdown over an
        // empty list is a control that looks broken rather than unconfigured.
        if (!names.length) {
            box.innerHTML = `
              <div class="ssh-action-empty">
                <span>${escHtml(t('sshact.none'))}</span>
                <button type="button" class="btn btn-secondary btn-sm" data-manage>${escHtml(t('sshact.manage'))}</button>
              </div>`;
            box.querySelector('[data-manage]')?.addEventListener('click', () => openSshServers());
            return;
        }

        const chosen = box.querySelector<HTMLSelectElement>('.ssh-action-profile')?.value || names[0];
        const target = storedSshTarget(chosen);
        const base = target?.remoteDir || '';
        const needsSecret = (target?.auth || 'key') === 'password';

        box.innerHTML = `
          ${opts.label ? `<div class="ssh-action-label">${escHtml(opts.label)}</div>` : ''}
          <div class="ssh-action-row">
            <label class="ssh-action-cell">
              <span>${escHtml(t('sshact.server'))}</span>
              <select class="form-input ssh-action-profile">
                ${names.map((n) => `<option value="${escAttr(n)}"${n === chosen ? ' selected' : ''}>${escHtml(n)}</option>`).join('')}
              </select>
            </label>
            <button type="button" class="btn btn-ghost btn-sm ssh-action-manage" data-manage>${escHtml(t('sshact.manage'))}</button>
          </div>

          ${opts.source.pick ? `
          <label class="ssh-action-cell">
            <span>${escHtml(opts.source.pick === 'file' ? t('sshact.localFile') : t('sshact.localDir'))}</span>
            <span class="ssh-action-inline">
              <input class="form-input ssh-action-local" spellcheck="false" placeholder="${escAttr(t('sshact.localPh'))}">
              <button type="button" class="btn btn-secondary btn-sm" data-pick>${escHtml(t('repo.ssh.browse'))}</button>
            </span>
          </label>` : ''}

          <label class="ssh-action-cell">
            <span>${escHtml(t('sshact.dest'))}</span>
            <span class="ssh-action-inline">
              <input class="form-input ssh-action-dest" spellcheck="false" value="${escAttr(base)}" placeholder="${escAttr(base || '/var/www/repo')}">
              <button type="button" class="btn btn-secondary btn-sm" data-browse>${escHtml(t('repo.ssh.browseRemote'))}</button>
            </span>
            <span class="ssh-action-hint">${escHtml(
              opts.source.remoteName
                ? t('sshact.destFileHint').replace('{name}', opts.source.remoteName)
                : t('sshact.destHint'))}</span>
          </label>

          <label class="ssh-action-cell">
            <span>${escHtml(needsSecret ? t('repo.ssh.password') : t('repo.ssh.passphrase'))}</span>
            <input type="password" class="form-input ssh-action-secret" autocomplete="off" placeholder="${escAttr(needsSecret ? '' : t('sshact.secretOptional'))}">
          </label>

          <div class="ssh-action-buttons">
            ${opts.mode !== 'fetch' ? `<button type="button" class="btn btn-primary btn-sm" data-go="up">${escHtml(t('sshact.publish'))}</button>` : ''}
            ${opts.mode !== 'publish' ? `<button type="button" class="btn btn-secondary btn-sm" data-go="down">${escHtml(t('sshact.fetch'))}</button>` : ''}
          </div>
          <div class="ssh-action-status" hidden></div>`;

        box.querySelector('.ssh-action-profile')?.addEventListener('change', render);
        box.querySelectorAll('[data-manage]').forEach((b) => b.addEventListener('click', () => openSshServers(chosen)));

        box.querySelector('[data-pick]')?.addEventListener('click', async () => {
            const p = opts.source.pick === 'file'
                ? await pickFile().catch(() => null)
                : await pickFolder().catch(() => null);
            if (p) (box.querySelector('.ssh-action-local') as HTMLInputElement).value = String(p);
        });

        box.querySelector('[data-browse]')?.addEventListener('click', () => { void browse(chosen); });
        box.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => {
            b.addEventListener('click', () => { void run(b.getAttribute('data-go') === 'down' ? 'down' : 'up'); });
        });
    };

    const status = (text: string, tone: '' | 'ok' | 'err' = ''): void => {
        const el = box.querySelector('.ssh-action-status') as HTMLElement | null;
        if (!el) return;
        el.hidden = !text;
        el.textContent = text;
        el.dataset.tone = tone;
    };

    /** The profile as configured, with the destination this panel is showing. */
    const targetNow = (): { name: string; target: SshTarget; secret: string } | null => {
        const name = box.querySelector<HTMLSelectElement>('.ssh-action-profile')?.value || '';
        const stored = name ? storedSshTarget(name) : null;
        if (!stored) { toast(t('sshact.none'), 'warning', 6000); return null; }
        const dest = (box.querySelector<HTMLInputElement>('.ssh-action-dest')?.value || '').trim();
        const secret = box.querySelector<HTMLInputElement>('.ssh-action-secret')?.value || '';
        // The override replaces the base folder for THIS transfer and is not written back to
        // the profile: a one-off publish into a subfolder must not silently move where every
        // other card publishes.
        return { name, target: { ...stored, remoteDir: dest || stored.remoteDir }, secret };
    };

    async function browse(name: string): Promise<void> {
        const stored = storedSshTarget(name);
        if (!stored) return;
        const secret = box.querySelector<HTMLInputElement>('.ssh-action-secret')?.value || '';
        const start = (box.querySelector<HTMLInputElement>('.ssh-action-dest')?.value || '').trim() || stored.remoteDir || '/';
        status(t('sshact.listing'));
        try {
            const entries = (await invoke('ssh_list_dir', {
                target: { ...stored, remoteDir: start }, secret, path: start,
            })) as { name: string; isDir: boolean }[];
            status('');
            pickRemote(start, entries, stored, secret);
        } catch (e) {
            status(explainSsh(String(e)), 'err');
        }
    }

    /** A small remote folder picker, drawn where the panel is rather than in a modal. */
    function pickRemote(path: string, entries: { name: string; isDir: boolean }[], stored: SshTarget, secret: string): void {
        box.querySelector('.ssh-action-browser')?.remove();
        const wrap = document.createElement('div');
        wrap.className = 'ssh-action-browser';
        wrap.innerHTML = `
          <div class="ssh-action-browser-path">${escHtml(path)}</div>
          <div class="ssh-action-browser-list">
            <button type="button" class="btn btn-ghost btn-sm" data-up>${escHtml(t('repo.ssh.browserUp'))}</button>
            ${entries.filter((e) => e.isDir).map((e) => `<button type="button" class="btn btn-ghost btn-sm" data-into="${escAttr(e.name)}">${escHtml(e.name)}</button>`).join('')}
          </div>
          <div class="ssh-action-browser-foot">
            <button type="button" class="btn btn-primary btn-sm" data-use>${escHtml(t('repo.ssh.browserChoose'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-cancel>${escHtml(t('common.cancel'))}</button>
          </div>`;
        box.appendChild(wrap);
        const go = async (next: string): Promise<void> => {
            try {
                const list = (await invoke('ssh_list_dir', {
                    target: { ...stored, remoteDir: next }, secret, path: next,
                })) as { name: string; isDir: boolean }[];
                pickRemote(next, list, stored, secret);
            } catch (e) { status(explainSsh(String(e)), 'err'); }
        };
        wrap.querySelector('[data-up]')?.addEventListener('click', () => {
            const up = path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
            void go(up);
        });
        wrap.querySelectorAll<HTMLElement>('[data-into]').forEach((b) => {
            b.addEventListener('click', () => void go(`${path.replace(/\/+$/, '')}/${b.getAttribute('data-into')}`));
        });
        wrap.querySelector('[data-use]')?.addEventListener('click', () => {
            (box.querySelector('.ssh-action-dest') as HTMLInputElement).value = path;
            wrap.remove();
        });
        wrap.querySelector('[data-cancel]')?.addEventListener('click', () => wrap.remove());
    }

    async function run(direction: 'up' | 'down'): Promise<void> {
        if (busy) return;
        const now = targetNow();
        if (!now) return;

        const picked = (box.querySelector<HTMLInputElement>('.ssh-action-local')?.value || '').trim();
        const local = picked || (opts.source.file ? opts.source.file() : opts.source.dir ? opts.source.dir() : '');
        if (!local) { toast(t('sshact.noSource'), 'warning', 6000); return; }

        const oneFile = !!opts.source.file || opts.source.pick === 'file';
        if (direction === 'up' && opts.confirm) {
            // Naming the server rather than asking "are you sure": with several configured,
            // WHICH one is the question worth answering.
            const ok = await (window as any).confirmCustom?.(
                t('repo.update.publishTitle'),
                (t('repo.update.publishMsg') || '').replace('{name}', now.name),
                'warning',
            ).catch(() => false);
            if (!ok) return;
        }

        busy = true;
        box.querySelectorAll('button').forEach((b) => { (b as HTMLButtonElement).disabled = true; });
        status(direction === 'up' ? t('sshact.publishing') : t('sshact.fetching'));
        try {
            let bytes = 0;
            if (oneFile) {
                const remoteName = opts.source.remoteName || local.replace(/^.*[\\/]/, '');
                bytes = (await invoke(direction === 'up' ? 'ssh_upload_file' : 'ssh_download_file', {
                    target: now.target, secret: now.secret,
                    ...(direction === 'up' ? { localFile: local, remoteName } : { remoteName, localFile: local }),
                })) as number;
            } else {
                bytes = (await invoke(direction === 'up' ? 'ssh_upload_repo' : 'ssh_download_repo', {
                    target: now.target, secret: now.secret, localDir: local,
                })) as number;
            }
            status(t(direction === 'up' ? 'sshact.published' : 'sshact.fetched').replace('{n}', String(bytes)), 'ok');
            toast(t(direction === 'up' ? 'sshact.published' : 'sshact.fetched').replace('{n}', String(bytes)), 'success', 6000);
            opts.onDone?.(bytes, direction);
        } catch (e) {
            const msg = explainSsh(String(e));
            status(msg, 'err');
            toast(msg, 'error', 9000);
        } finally {
            busy = false;
            box.querySelectorAll('button').forEach((b) => { (b as HTMLButtonElement).disabled = false; });
        }
    }

    render();
    // A profile added while this card is on screen appears in it, rather than after a
    // navigation somebody has no reason to perform.
    const off = onSshServersChanged(() => { if (box.isConnected) render(); else off(); });
}
