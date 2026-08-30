import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { explainSsh, type SshTarget } from './repo-ssh.js';

// Walking a server's folders, once, for everybody who needs to.
//
// It existed inside the publish panel: a little list drawn into the panel's own markup, that
// wrote its answer straight into that panel's destination field. Fine there — and it meant the
// SSH servers dialog, where you type the BASE folder that every one of those transfers starts
// from, had no browser at all. The one place a path is set for good was the one place you had
// to know it by heart.
//
// So: a modal that returns a path, and knows nothing about who asked. `await` it, put the
// answer wherever it belongs.
//
// A modal and not an inline list, deliberately. The servers dialog is already a modal, so an
// inline browser inside it would be a scrolling region inside a scrolling region; and a
// folder tree is the kind of thing somebody reads for a moment with everything else out of
// the way, not a control they keep in the corner of their eye.

interface Entry { name: string; isDir: boolean }

/**
 * Ask the server what is in a folder.
 *
 * `remoteDir` is set to the path being listed as well as passing it as `path`, because the
 * backend resolves relative paths against the target's base — and a browser that quietly
 * reinterpreted "/" as "the base folder" would show the wrong tree while looking right.
 */
async function list(target: SshTarget, secret: string, path: string): Promise<Entry[]> {
    return (await invoke('ssh_list_dir', {
        target: { ...target, remoteDir: path }, secret, path,
    })) as Entry[];
}

/** The parent of a path, with the trailing slashes that break `dirname` taken off first. */
function parentOf(path: string): string {
    return path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
}

/**
 * Browse `target` and resolve to the chosen folder, or `null` if it was cancelled.
 *
 * Never throws. A server that cannot be reached resolves to `null` after saying so in the
 * dialog — the caller's field keeps whatever was typed, which is the correct outcome: not
 * being able to browse is not a reason to lose what somebody wrote.
 */
export function browseRemoteFolder(
    target: SshTarget,
    secret: string,
    startPath?: string,
): Promise<string | null> {
    return new Promise((resolve) => {
        const start = (startPath || target.remoteDir || '/').trim() || '/';
        const ov = document.createElement('div');
        ov.className = 'modal-overlay open';
        ov.innerHTML = `
      <div class="modal glass" style="max-width:520px;width:94%;">
        <div class="modal-header">
          <h3 style="margin:0;font-size:14px;">${escHtml(t('sshbr.title'))} <span style="color:var(--text-muted);font-weight:400;">${escHtml(`${target.user}@${target.host}`)}</span></h3>
          <button class="modal-close" id="sshbr-x" aria-label="${escAttr(t('common.close'))}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="modal-body" style="padding:12px 16px;">
          <div class="ssh-br-path" id="sshbr-path">${escHtml(start)}</div>
          <div class="ssh-br-list" id="sshbr-list"></div>
          <div class="ssh-br-status" id="sshbr-status"></div>
        </div>
        <div class="modal-footer" style="display:flex;gap:8px;padding:10px 16px;">
          <button class="btn btn-primary btn-sm" id="sshbr-use" type="button">${escHtml(t('sshbr.choose'))}</button>
          <button class="btn btn-ghost btn-sm" id="sshbr-cancel" type="button">${escHtml(t('common.cancel'))}</button>
        </div>
      </div>`;
        (document.getElementById('app-window-outer') || document.body).appendChild(ov);

        const pathEl = ov.querySelector('#sshbr-path') as HTMLElement;
        const listEl = ov.querySelector('#sshbr-list') as HTMLElement;
        const statusEl = ov.querySelector('#sshbr-status') as HTMLElement;
        let here = start;
        let done = false;

        const finish = (value: string | null): void => {
            if (done) return;
            done = true;
            ov.remove();
            document.removeEventListener('keydown', onKey);
            resolve(value);
        };
        function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') finish(null); }
        document.addEventListener('keydown', onKey);

        const go = async (next: string): Promise<void> => {
            statusEl.textContent = t('sshact.listing');
            listEl.innerHTML = '';
            try {
                const entries = await list(target, secret, next);
                here = next;
                pathEl.textContent = next;
                statusEl.textContent = '';
                const dirs = entries.filter((e) => e.isDir);
                listEl.innerHTML = `
          ${next === '/' ? '' : `<button type="button" class="ssh-br-item" data-go="${escAttr(parentOf(next))}">..</button>`}
          ${dirs.map((e) => `<button type="button" class="ssh-br-item" data-go="${escAttr(`${next.replace(/\/+$/, '')}/${e.name}`)}">${escHtml(e.name)}</button>`).join('')}
          ${dirs.length ? '' : `<div class="ssh-br-empty">${escHtml(t('sshbr.empty'))}</div>`}`;
                listEl.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => {
                    b.addEventListener('click', () => void go(b.getAttribute('data-go') || '/'));
                });
            } catch (e) {
                // Said in the dialog and left open. Closing on a refused connection would take
                // the passphrase field away with it, which is usually the thing to fix.
                statusEl.innerHTML = `<span style="color:var(--bmm-danger);">${escHtml(explainSsh(String(e)))}</span>`;
            }
        };

        ov.querySelector('#sshbr-use')?.addEventListener('click', () => finish(here));
        ov.querySelector('#sshbr-cancel')?.addEventListener('click', () => finish(null));
        ov.querySelector('#sshbr-x')?.addEventListener('click', () => finish(null));
        ov.addEventListener('click', (e) => { if (e.target === ov) finish(null); });

        void go(start);
    });
}
