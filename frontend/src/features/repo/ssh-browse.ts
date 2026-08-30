import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { raiseAboveAll } from '../../ui/layer.js';
import { explainSsh, type SshTarget } from './repo-ssh.js';

// Walking a server's folders, once, for everybody who needs to.
//
// It began as a list drawn inside the publish card that wrote its answer straight into that
// card's field. Fine there — and it meant the SSH servers dialog, where you type the BASE
// folder every one of those transfers starts from, had no browser at all. The one place a
// path is set for good was the one place you had to know it by heart.
//
// So: a modal that returns a path and knows nothing about who asked. `await` it, put the
// answer wherever it belongs.
//
// TWO THINGS IT GETS RIGHT THAT THE FIRST VERSION DID NOT.
//
// It RAISES ITSELF. `.modal-overlay` is z-index 5000; the servers dialog opens through
// `raiseAboveAll` and lands above 11000. A browser opened from that dialog therefore appeared
// *behind* the dialog that opened it — visible only as a dimming of a screen you could still
// see, with its buttons unreachable. Anything opened from a dialog has to ask where the top
// is; it cannot assume it.
//
// And it shows FILES. The backend has always returned them, with sizes — the first version
// filtered them out, so a folder full of the repo you are looking for read as empty and there
// was no way to tell "wrong path" from "nothing here yet". Files are shown and are not
// targets: you are choosing a folder, and a file you cannot click is the clearest way to say
// that while still proving you are in the right place.

interface Entry { name: string; isDir: boolean; size: number }

/** Bytes, at the precision a person reading a directory listing wants. */
function humanSize(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '';
    const U = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < U.length - 1) { v /= 1024; i++; }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${U[i]}`;
}

/**
 * Ask the server what is in a folder.
 *
 * `remoteDir` is set to the path being listed as well as passed as `path`, because the backend
 * resolves a relative path against the target's base — a browser that quietly reinterpreted
 * "/" as "the base folder" would show the wrong tree while looking right.
 */
async function list(target: SshTarget, secret: string, path: string): Promise<Entry[]> {
    return (await invoke('ssh_list_dir', {
        target: { ...target, remoteDir: path }, secret, path,
    })) as Entry[];
}

/** The parent of a path, with the trailing slashes that break a naive `dirname` taken off. */
function parentOf(path: string): string {
    return path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
}

/** `/srv/www/repo` → the clickable trail that gets you back to any of its ancestors. */
function crumbs(path: string): { label: string; path: string }[] {
    const parts = path.split('/').filter(Boolean);
    const out = [{ label: '/', path: '/' }];
    let acc = '';
    for (const p of parts) { acc += `/${p}`; out.push({ label: p, path: acc }); }
    return out;
}

const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const UP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

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
        // Above whatever opened it. See the note at the top of this file.
        raiseAboveAll(ov);
        ov.innerHTML = `
      <div class="modal glass ssh-br" style="max-width:560px;width:96%;">
        <div class="modal-header">
          <div style="min-width:0;">
            <h3 style="margin:0;font-size:15px;">${escHtml(t('sshbr.title'))}</h3>
            <div class="ssh-br-who">${escHtml(`${target.user}@${target.host}`)}${target.port && target.port !== 22 ? escHtml(`:${target.port}`) : ''}</div>
          </div>
          <button class="modal-close" id="sshbr-x" aria-label="${escAttr(t('common.close'))}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="modal-body ssh-br-body">
          <div class="ssh-br-crumbs" id="sshbr-crumbs"></div>
          <div class="ssh-br-list" id="sshbr-list" tabindex="-1"></div>
          <div class="ssh-br-foot-note" id="sshbr-status"></div>
        </div>
        <div class="modal-footer ssh-br-actions">
          <div class="ssh-br-chosen" id="sshbr-chosen"></div>
          <button class="btn btn-ghost btn-sm" id="sshbr-cancel" type="button">${escHtml(t('common.cancel'))}</button>
          <button class="btn btn-primary btn-sm" id="sshbr-use" type="button">${escHtml(t('sshbr.choose'))}</button>
        </div>
      </div>`;
        (document.getElementById('app-window-outer') || document.body).appendChild(ov);

        const crumbEl = ov.querySelector('#sshbr-crumbs') as HTMLElement;
        const listEl = ov.querySelector('#sshbr-list') as HTMLElement;
        const statusEl = ov.querySelector('#sshbr-status') as HTMLElement;
        const chosenEl = ov.querySelector('#sshbr-chosen') as HTMLElement;
        let here = start;
        let done = false;

        const finish = (value: string | null): void => {
            if (done) return;
            done = true;
            ov.remove();
            document.removeEventListener('keydown', onKey, true);
            resolve(value);
        };
        function onKey(e: KeyboardEvent): void {
            // Capture, and only while this dialog is the top one: it is opened FROM another
            // modal, and letting Escape through would close both at once.
            if (e.key !== 'Escape' || done) return;
            e.stopPropagation();
            e.preventDefault();
            finish(null);
        }
        document.addEventListener('keydown', onKey, true);

        const go = async (next: string): Promise<void> => {
            statusEl.textContent = t('sshact.listing');
            listEl.setAttribute('aria-busy', 'true');
            try {
                const entries = await list(target, secret, next);
                here = next;
                chosenEl.textContent = next;
                crumbEl.innerHTML = crumbs(next)
                    .map((c) => `<button type="button" class="ssh-br-crumb" data-go="${escAttr(c.path)}">${escHtml(c.label)}</button>`)
                    .join('<span class="ssh-br-sep">/</span>');
                const dirs = entries.filter((e) => e.isDir);
                const files = entries.filter((e) => !e.isDir);
                listEl.innerHTML = `
          ${next === '/' ? '' : `<button type="button" class="ssh-br-item ssh-br-up" data-go="${escAttr(parentOf(next))}"><span class="ssh-br-ico">${UP_ICON}</span><span class="ssh-br-name">..</span></button>`}
          ${dirs.map((e) => `<button type="button" class="ssh-br-item" data-go="${escAttr(`${next.replace(/\/+$/, '')}/${e.name}`)}"><span class="ssh-br-ico ssh-br-ico-dir">${FOLDER_ICON}</span><span class="ssh-br-name">${escHtml(e.name)}</span></button>`).join('')}
          ${files.map((e) => `<div class="ssh-br-item ssh-br-file"><span class="ssh-br-ico">${FILE_ICON}</span><span class="ssh-br-name">${escHtml(e.name)}</span><span class="ssh-br-size">${escHtml(humanSize(e.size))}</span></div>`).join('')}
          ${entries.length ? '' : `<div class="ssh-br-empty">${escHtml(t('sshbr.empty'))}</div>`}`;
                listEl.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => {
                    b.addEventListener('click', () => void go(b.getAttribute('data-go') || '/'));
                });
                // Said as a count rather than left to be inferred from a short list: "3 folders,
                // 41 files" is how you tell a folder that is nearly empty from one you cannot
                // read into.
                statusEl.textContent = entries.length
                    ? t('sshbr.count').replace('{d}', String(dirs.length)).replace('{f}', String(files.length))
                    : '';
            } catch (e) {
                // Said in the dialog and left open. Closing on a refused connection would take
                // the passphrase field away with it, which is usually the thing to fix.
                statusEl.innerHTML = `<span class="ssh-br-err">${escHtml(explainSsh(String(e)))}</span>`;
                listEl.innerHTML = '';
            } finally {
                listEl.removeAttribute('aria-busy');
            }
        };

        crumbEl.addEventListener('click', (e) => {
            const b = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
            if (b) void go(b.getAttribute('data-go') || '/');
        });
        ov.querySelector('#sshbr-use')?.addEventListener('click', () => finish(here));
        ov.querySelector('#sshbr-cancel')?.addEventListener('click', () => finish(null));
        ov.querySelector('#sshbr-x')?.addEventListener('click', () => finish(null));
        ov.addEventListener('click', (e) => { if (e.target === ov) finish(null); });

        void go(start);
    });
}
