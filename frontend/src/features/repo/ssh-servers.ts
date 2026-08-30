// Your SSH servers, in one place, configured once.
//
// The form used to live INSIDE the Server Repo export card, which put "where do I publish"
// in the middle of "how do I build a repo". Two things followed from that and both were
// wrong:
//
//   · a server is not a property of an export. It is a machine you own, and you use it from
//     the repo screen, from the manifest screen and from a catalogue — the configuration
//     belonged to none of those three and was reachable from one.
//   · nothing else could offer publishing without either duplicating the form or sending
//     somebody to Generate Repository first, to fill in a screen they had no business
//     visiting.
//
// So the profiles live here, and every place that publishes or fetches mounts the compact
// chooser in ssh-action.ts instead. The storage is unchanged — `bmm.ssh.targets`, the same
// keys, the same `ssh://name/path` URLs — so nothing anybody already configured moves.
//
// WHAT IS STORED, AND WHAT IS NOT. Host, port, user, base folder, key PATH and the method.
// Never the passphrase, never the password: they are read from a field at the moment of use.
// That is also why a scheduled publish needs a key with no passphrase — there is nobody at
// 04:00 to type one, and a prompt nobody answers is a task that silently never runs.
import { invoke, pickFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { topLayerZ } from '../../ui/layer.js';
import {
    loadTargets, saveTarget, deleteTarget, sshTargetNames, explainSsh, DEFAULT_TARGET,
    type SshTarget,
} from './repo-ssh.js';

/** Everyone who drew a profile list wants to know when one is added or removed. */
const listeners = new Set<() => void>();

/** Tell every mounted chooser that the list changed. */
export function onSshServersChanged(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
const announce = (): void => { for (const fn of [...listeners]) { try { fn(); } catch { /* one bad listener is not the others' problem */ } } };

/** A blank profile, with the defaults a first-time reader would otherwise have to guess. */
const blank = (): SshTarget => ({ host: '', port: 22, user: '', keyPath: '', remoteDir: '', auth: 'key' });

interface TestResult {
    fingerprint: string;
    remoteDirExists: boolean;
    writable: boolean;
    writeError?: string | null;
    entries: number;
    user?: string;
}

/**
 * Open the manager.
 *
 * `focus` selects a profile by name on open, so "Manage servers…" from a chooser lands on
 * the one that was selected rather than on whichever the object enumerated first.
 */
export function openSshServers(focus?: string): void {
    const existing = document.getElementById('__ssh-servers');
    if (existing) { existing.remove(); }

    const ov = document.createElement('div');
    ov.id = '__ssh-servers';
    ov.className = 'modal-overlay open';
    ov.style.zIndex = String(topLayerZ());

    let current = focus && loadTargets()[focus] ? focus : (sshTargetNames()[0] || '');
    let draft: SshTarget = current ? { ...loadTargets()[current] } : blank();
    let dirty = false;

    ov.innerHTML = `
      <div class="modal glass" style="max-width:720px;width:96%;">
        <div class="modal-header">
          <h2 style="margin:0;font-size:16px;">${escHtml(t('sshsrv.title'))}</h2>
          <button class="modal-close" id="sshsrv-close" aria-label="${escAttr(t('common.close'))}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="modal-body" style="padding:14px 18px;display:grid;grid-template-columns:180px 1fr;gap:16px;align-items:start;">
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:6px;">${escHtml(t('sshsrv.list'))}</div>
            <div id="sshsrv-list" style="display:flex;flex-direction:column;gap:4px;max-height:320px;overflow-y:auto;"></div>
            <button class="btn btn-secondary btn-sm" id="sshsrv-add" type="button" style="width:100%;margin-top:8px;justify-content:center;">${escHtml(t('sshsrv.add'))}</button>
          </div>
          <div id="sshsrv-form"></div>
        </div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);

    const list = ov.querySelector('#sshsrv-list') as HTMLElement;
    const form = ov.querySelector('#sshsrv-form') as HTMLElement;

    const close = (): void => { ov.remove(); };
    ov.querySelector('#sshsrv-close')?.addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

    function renderList(): void {
        const names = sshTargetNames();
        list.innerHTML = names.length
            ? names.map((n) => `<button type="button" class="btn ${n === current ? 'btn-accent' : 'btn-ghost'} btn-sm" data-pick="${escAttr(n)}"
                 style="justify-content:flex-start;text-align:left;">${escHtml(n)}</button>`).join('')
            : `<p style="font-size:11px;color:var(--text-muted);margin:0;">${escHtml(t('sshsrv.empty'))}</p>`;
        list.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => {
            b.addEventListener('click', () => {
                const n = b.getAttribute('data-pick') || '';
                if (dirty && !confirm(t('sshsrv.discard'))) return;
                current = n;
                draft = { ...loadTargets()[n] };
                dirty = false;
                renderList(); renderForm();
            });
        });
    }

    function renderForm(): void {
        const isKey = (draft.auth || 'key') === 'key';
        form.innerHTML = `
          <label style="display:block;margin-bottom:10px;">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">${escHtml(t('sshsrv.name'))}</span>
            <input class="form-input" id="sshsrv-f-name" value="${escAttr(current)}" placeholder="${escAttr(DEFAULT_TARGET)}" spellcheck="false">
            <span style="font-size:10px;color:var(--text-muted);">${escHtml(t('sshsrv.nameHint'))}</span>
          </label>
          <div style="display:grid;grid-template-columns:1fr 90px;gap:8px;margin-bottom:10px;">
            <label style="display:block;">
              <span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">${escHtml(t('repo.ssh.host'))}</span>
              <input class="form-input" id="sshsrv-f-host" value="${escAttr(draft.host)}" spellcheck="false">
            </label>
            <label style="display:block;">
              <span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">${escHtml(t('repo.ssh.port'))}</span>
              <input class="form-input" id="sshsrv-f-port" type="number" min="1" max="65535" value="${escAttr(String(draft.port ?? 22))}">
            </label>
          </div>
          <label style="display:block;margin-bottom:10px;">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">${escHtml(t('repo.ssh.user'))}</span>
            <input class="form-input" id="sshsrv-f-user" value="${escAttr(draft.user)}" spellcheck="false">
          </label>
          <label style="display:block;margin-bottom:10px;">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">${escHtml(t('sshsrv.base'))}</span>
            <span style="display:flex;gap:6px;">
              <input class="form-input" id="sshsrv-f-dir" value="${escAttr(draft.remoteDir)}" placeholder="/var/www/repo" spellcheck="false" style="flex:1;min-width:0;">
              <!-- Browsing needs a connection, so it needs whatever this server authenticates
                   with. The passphrase box below it is the same one Test uses, and it is read
                   at the moment of use and kept nowhere. -->
              <button class="btn btn-secondary btn-sm" id="sshsrv-f-dirbrowse" type="button">${escHtml(t('repo.ssh.browseRemote'))}</button>
            </span>
            <span style="font-size:10px;color:var(--text-muted);">${escHtml(t('sshsrv.baseHint'))}</span>
          </label>
          <div style="display:flex;gap:6px;margin-bottom:10px;">
            <button type="button" class="btn ${isKey ? 'btn-accent' : 'btn-ghost'} btn-sm" id="sshsrv-f-key">${escHtml(t('repo.ssh.authKey'))}</button>
            <button type="button" class="btn ${isKey ? 'btn-ghost' : 'btn-accent'} btn-sm" id="sshsrv-f-pw">${escHtml(t('repo.ssh.authPassword'))}</button>
          </div>
          ${isKey ? `
          <label style="display:block;margin-bottom:10px;">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">${escHtml(t('repo.ssh.key'))}</span>
            <span style="display:flex;gap:6px;">
              <input class="form-input" id="sshsrv-f-keypath" value="${escAttr(draft.keyPath)}" spellcheck="false" style="flex:1;min-width:0;">
              <button class="btn btn-secondary btn-sm" id="sshsrv-f-browse" type="button">${escHtml(t('repo.ssh.browse'))}</button>
            </span>
          </label>` : `<p style="font-size:11px;color:var(--text-muted);margin:0 0 10px;">${escHtml(t('sshsrv.pwNote'))}</p>`}
          <label style="display:block;margin-bottom:10px;">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">${escHtml(t('sshsrv.secret'))}</span>
            <input class="form-input" id="sshsrv-f-secret" type="password" autocomplete="new-password" placeholder="${escAttr(t('sshsrv.secretPh'))}">
            <span style="font-size:10px;color:var(--text-muted);">${escHtml(t('sshsrv.secretHint'))}</span>
          </label>
          <div id="sshsrv-test" style="font-size:11px;margin-bottom:10px;"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" id="sshsrv-save" type="button">${escHtml(t('common.save'))}</button>
            <button class="btn btn-secondary btn-sm" id="sshsrv-testbtn" type="button">${escHtml(t('repo.ssh.test'))}</button>
            ${current ? `<button class="btn btn-ghost btn-sm" id="sshsrv-del" type="button" style="margin-left:auto;">${escHtml(t('common.delete'))}</button>` : ''}
          </div>`;

        const val = (id: string): string => ((form.querySelector(`#${id}`) as HTMLInputElement | null)?.value || '').trim();
        const read = (): void => {
            draft = {
                host: val('sshsrv-f-host'),
                port: Number(val('sshsrv-f-port')) || 22,
                user: val('sshsrv-f-user'),
                remoteDir: val('sshsrv-f-dir'),
                keyPath: isKey ? val('sshsrv-f-keypath') : '',
                auth: isKey ? 'key' : 'password',
            };
        };
        form.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { dirty = true; }));

        form.querySelector('#sshsrv-f-key')?.addEventListener('click', () => { read(); draft.auth = 'key'; dirty = true; renderForm(); });
        form.querySelector('#sshsrv-f-pw')?.addEventListener('click', () => { read(); draft.auth = 'password'; dirty = true; renderForm(); });
        form.querySelector('#sshsrv-f-browse')?.addEventListener('click', async () => {
            const p = await pickFile().catch(() => null);
            if (p) { const i = form.querySelector('#sshsrv-f-keypath') as HTMLInputElement; i.value = String(p); dirty = true; }
        });

        // The base folder, walked rather than typed.
        //
        // Reads the form as it stands rather than the saved target: somebody filling this in
        // for a new server has not saved anything yet, and refusing to browse until they do
        // would mean saving a folder they cannot see in order to go and look at it.
        form.querySelector('#sshsrv-f-dirbrowse')?.addEventListener('click', async () => {
            read();
            const out = form.querySelector('#sshsrv-test') as HTMLElement;
            if (!draft.host || !draft.user) { out.textContent = t('sshsrv.needHostUser'); return; }
            const secret = (form.querySelector('#sshsrv-f-secret') as HTMLInputElement | null)?.value || '';
            const { browseRemoteFolder } = await import('./ssh-browse.js');
            const picked = await browseRemoteFolder(draft, secret, draft.remoteDir || '/');
            if (picked === null) return;
            const i = form.querySelector('#sshsrv-f-dir') as HTMLInputElement;
            i.value = picked;
            dirty = true;
        });

        form.querySelector('#sshsrv-save')?.addEventListener('click', () => {
            read();
            const name = val('sshsrv-f-name') || DEFAULT_TARGET;
            const out = form.querySelector('#sshsrv-test') as HTMLElement;
            if (!draft.host || !draft.user || !draft.remoteDir) { out.textContent = t('sshsrv.needFields'); return; }
            // A rename is a save under the new name plus a delete of the old one. Doing it in
            // that order means a failure leaves the original intact rather than neither.
            saveTarget(draft, name);
            if (current && current !== name) deleteTarget(current);
            current = name;
            dirty = false;
            // Said where the reader is looking, next to the button they pressed, rather
            // than in a corner of the window behind this dialog.
            out.innerHTML = `<span style="color:var(--success);">${escHtml(t('sshsrv.saved'))}</span>`;
            renderList(); renderForm(); announce();
        });

        form.querySelector('#sshsrv-del')?.addEventListener('click', () => {
            if (!confirm(t('sshsrv.confirmDelete').replace('{name}', current))) return;
            deleteTarget(current);
            const names = sshTargetNames();
            current = names[0] || '';
            draft = current ? { ...loadTargets()[current] } : blank();
            dirty = false;
            renderList(); renderForm(); announce();
        });

        form.querySelector('#sshsrv-testbtn')?.addEventListener('click', async () => {
            read();
            const out = form.querySelector('#sshsrv-test') as HTMLElement;
            if (!draft.host || !draft.user) { out.textContent = t('sshsrv.needFields'); return; }
            // The secret is asked for HERE and kept nowhere: a test that silently reused a
            // stored password would be testing something the real publish cannot do.
            const secret = window.prompt(draft.auth === 'password' ? t('repo.ssh.password') : t('repo.ssh.passphrase')) || '';
            out.textContent = t('repo.ssh.testing');
            try {
                const r = (await invoke('ssh_test_connection', { target: draft, secret })) as TestResult;
                out.innerHTML = `<span style="color:var(--success);">${escHtml(t('repo.ssh.testOk'))}</span> `
                    + escHtml(`${r.user || draft.user}@${draft.host} · ${r.entries} · ${r.writable ? t('sshsrv.writable') : t('sshsrv.notWritable')}`);
            } catch (e) {
                out.innerHTML = `<span style="color:var(--danger);">${escHtml(explainSsh(String(e)))}</span>`;
            }
        });
    }

    ov.querySelector('#sshsrv-add')?.addEventListener('click', () => {
        if (dirty && !confirm(t('sshsrv.discard'))) return;
        current = '';
        draft = blank();
        dirty = false;
        renderList(); renderForm();
    });

    renderList();
    renderForm();
}
