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
//
// THE TEST, STEP BY STEP (1.0.3). It used to ask for the secret in a window.prompt (which the
// webview does not show), connect, and trust whatever key answered. Now it:
//   1. checks the form, field by field, and says which field is wrong;
//   2. reads the server's host key WITHOUT logging in (ssh_probe_host_key). A server seen for
//      the first time shows its fingerprint plainly and asks; nothing (no password, no key
//      signature) is offered to it before « Trust this server ». A CHANGED key is refused,
//      with the old and new fingerprints side by side;
//   3. logs in with the passphrase / password typed in the form, and checks the base folder:
//      exists, writable, and if not, who owns it.
// Every step says its result in a line of its own, in words.
import { invoke, pickFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { confirmAction } from '../../ui/verify.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { openModal } from '../../ui/modal-shell.js';
import {
    loadTargets, saveTarget, deleteTarget, explainSsh, DEFAULT_TARGET,
    type SshTarget,
} from './repo-ssh.js';
import { validateSshDraft, parseHostInput, modeString, type SshErrors, type SshField } from './ssh-validate.js';
import { ensureRepoDialogCss } from './repo-dialogs-css.js';
import { uiIcon } from '../../ui/icons.js';

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
    dirUid?: number | null;
    dirMode?: number | null;
    user?: string;
}
interface HostKeyProbe { fingerprint: string; known: string | null; status: 'new' | 'trusted' | 'changed' | 'unknown' }
type Step = { tone: '' | 'ok' | 'bad' | 'warn' | 'run'; text: string; html?: string };

/** The last test of each profile, this session: the list's status line. Never a secret. */
const lastTest = new Map<string, { ok: boolean; at: number }>();
/** Host keys BMM trusts, by `host:port`, as last read (offline) for the list. */
const knownKeys = new Map<string, string | null>();
const hostKey = (d: SshTarget): string => `${d.host.toLowerCase()}:${d.port || 22}`;

/**
 * Open the manager.
 *
 * `focus` selects a profile by name on open, so "Manage servers…" from a chooser lands on
 * the one that was selected rather than on whichever the object enumerated first.
 */
export function openSshServers(focus?: string): void {
    document.getElementById('__ssh-servers')?.remove();
    ensureRepoDialogCss();

    const names = (): string[] => Object.keys(loadTargets()).sort((a, b) => a.localeCompare(b));
    let current = focus && loadTargets()[focus] ? focus : (names()[0] || '');
    let draft: SshTarget = current ? { ...blank(), ...loadTargets()[current] } : blank();
    let dirty = false;
    let errors: SshErrors = {};
    let pendingTrust: ((answer: string) => void) | null = null;

    const m = openModal({
        id: '__ssh-servers',
        title: t('sshsrv.title'),
        subtitle: t('sshsrv.subtitle'),
        icon: uiIcon('server', 20),
        size: 'lg',
        tall: true,
        className: 'ssv-modal',
        body: `<div class="ssv">
            <nav class="ssv-side" aria-label="${escAttr(t('sshsrv.list'))}">
              <div class="ssv-side-h">${escHtml(t('sshsrv.list'))}</div>
              <div class="ssv-list" role="listbox" tabindex="0" aria-label="${escAttr(t('sshsrv.list'))}"></div>
              <button type="button" class="btn btn-secondary btn-sm ssv-add">${uiIcon('add', 14)}<span>${escHtml(t('sshsrv.add'))}</span></button>
            </nav>
            <section class="ssv-form"></section>
          </div>`,
        footer: `<div class="modal-footer-start"><button type="button" class="btn btn-ghost ssv-del">${uiIcon('delete', 14)}<span>${escHtml(t('common.delete'))}</span></button></div>
          <button type="button" class="btn btn-secondary ssv-test">${uiIcon('activity', 14)}<span>${escHtml(t('repo.ssh.test'))}</span></button>
          <button type="button" class="btn btn-primary ssv-save">${uiIcon('save', 14)}<span>${escHtml(t('common.save'))}</span></button>`,
        onClose: () => { pendingTrust?.('closed'); },
    });
    const list = m.q<HTMLElement>('.ssv-list')!;
    const form = m.q<HTMLElement>('.ssv-form')!;
    const delBtn = m.q<HTMLButtonElement>('.ssv-del')!;
    const testBtn = m.q<HTMLButtonElement>('.ssv-test')!;
    const saveBtn = m.q<HTMLButtonElement>('.ssv-save')!;

    // ── the list ────────────────────────────────────────────────────────────────────────────

    function statusOf(n: string): { cls: string; text: string; icon: Parameters<typeof uiIcon>[0] } {
        const tgt = { ...blank(), ...loadTargets()[n] };
        if (Object.keys(validateSshDraft(tgt)).length > 0) return { cls: 'warn', text: t('sshsrv.stIncomplete'), icon: 'warning' };
        const lt = lastTest.get(n);
        if (lt) return lt.ok ? { cls: 'ok', text: t('sshsrv.stTestOk'), icon: 'success' } : { cls: 'bad', text: t('sshsrv.stTestFailed'), icon: 'error' };
        if (knownKeys.get(hostKey(tgt))) return { cls: 'ok', text: t('sshsrv.stTrusted'), icon: 'shield-check' };
        return { cls: '', text: t('sshsrv.stNotTested'), icon: 'shield' };
    }

    function renderList(): void {
        const all = names();
        const targets = loadTargets();
        list.innerHTML = all.length
            ? all.map((n, i) => {
                const tg = targets[n] || blank();
                const st = statusOf(n);
                const where = tg.host ? `${tg.user ? `${tg.user}@` : ''}${tg.host}${tg.port && tg.port !== 22 ? `:${tg.port}` : ''}` : t('sshsrv.noHost');
                return `<div class="ssv-item${n === current ? ' is-on' : ''}" role="option" id="ssv-opt-${i}" data-pick="${escAttr(n)}" aria-selected="${n === current}">
                    <span class="ssv-item-name">${escHtml(n)}${n === DEFAULT_TARGET ? ` <span class="ssv-tag">${escHtml(t('sshsrv.defaultTag'))}</span>` : ''}</span>
                    <span class="ssv-item-where">${escHtml(where)}</span>
                    <span class="ssv-st${st.cls ? ` ssv-st--${st.cls}` : ''}">${uiIcon(st.icon, 12)}<span>${escHtml(st.text)}</span></span>
                </div>`;
            }).join('')
            : `<p class="ssv-empty">${uiIcon('server', 16)}<span>${escHtml(t('sshsrv.empty'))}</span></p>`;
        const at = all.indexOf(current);
        if (at >= 0) list.setAttribute('aria-activedescendant', `ssv-opt-${at}`); else list.removeAttribute('aria-activedescendant');
        delBtn.hidden = !current;
    }

    async function pick(n: string): Promise<void> {
        if (n === current) return;
        if (dirty && !(await confirmAction({ title: t('vfy.t.discard'), message: t('sshsrv.discard'), confirmLabel: t('vfy.b.discard'), tone: 'warn' }))) return;
        current = n;
        draft = { ...blank(), ...loadTargets()[n] };
        dirty = false;
        errors = {};
        renderList(); renderForm();
    }

    list.addEventListener('click', (e) => {
        const it = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
        if (it) void pick(it.dataset.pick || '');
    });
    // Up/Down move through the servers, Home/End jump, Enter goes to the form.
    list.addEventListener('keydown', (e) => {
        const all = names();
        if (!all.length) return;
        const i = Math.max(0, all.indexOf(current));
        let j = -1;
        if (e.key === 'ArrowDown') j = Math.min(all.length - 1, i + 1);
        else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = all.length - 1;
        else if (e.key === 'Enter') { e.preventDefault(); form.querySelector<HTMLElement>('input')?.focus(); return; }
        if (j < 0) return;
        e.preventDefault();
        void pick(all[j]).then(() => list.focus());
    });

    // ── the form ────────────────────────────────────────────────────────────────────────────

    const errHtml = (f: string): string => {
        const k = errors[f as SshField];
        return k ? `${uiIcon('error', 12)}<span>${escHtml(t(k))}</span>` : '';
    };
    const field = (label: string, f: SshField | 'secret', input: string, hint = ''): string => `
        <label class="ssv-field" data-field="${f}">
          <span class="ssv-label">${escHtml(label)}</span>
          ${input}
          <span class="ssv-err" id="ssv-err-${f}">${errHtml(f)}</span>
          ${hint ? `<span class="ssv-hint">${escHtml(hint)}</span>` : ''}
        </label>`;
    const inv = (f: SshField): string => (errors[f] ? ` aria-invalid="true" aria-describedby="ssv-err-${f}"` : '');

    function renderForm(): void {
        const isKey = (draft.auth || 'key') === 'key';
        form.innerHTML = `
          ${field(t('sshsrv.name'), 'name', `<input class="form-input" data-in="name" value="${escAttr(current)}" placeholder="${escAttr(DEFAULT_TARGET)}" spellcheck="false"${inv('name')}>`, t('sshsrv.nameHint'))}
          <div class="ssv-grid">
            ${field(t('repo.ssh.host'), 'host', `<input class="form-input ssv-mono" data-in="host" value="${escAttr(draft.host)}" placeholder="${escAttr(t('sshsrv.hostPh'))}" spellcheck="false" autocapitalize="off"${inv('host')}>`)}
            ${field(t('repo.ssh.port'), 'port', `<input class="form-input ssv-mono" data-in="port" type="number" min="1" max="65535" value="${escAttr(String(draft.port ?? 22))}"${inv('port')}>`)}
          </div>
          ${field(t('repo.ssh.user'), 'user', `<input class="form-input ssv-mono" data-in="user" value="${escAttr(draft.user)}" spellcheck="false" autocapitalize="off"${inv('user')}>`)}
          <div class="ssv-field">
            <span class="ssv-label" id="ssv-auth-l">${escHtml(t('sshsrv.auth'))}</span>
            <div class="bms-seg" role="radiogroup" aria-labelledby="ssv-auth-l">
              <button type="button" role="radio" aria-checked="${isKey}" data-auth="key" class="bms-seg-btn${isKey ? ' active' : ''}">${uiIcon('key', 14)}<span>${escHtml(t('repo.ssh.authKey'))}</span></button>
              <button type="button" role="radio" aria-checked="${!isKey}" data-auth="password" class="bms-seg-btn${isKey ? '' : ' active'}">${uiIcon('lock', 14)}<span>${escHtml(t('repo.ssh.authPassword'))}</span></button>
            </div>
          </div>
          ${isKey ? field(t('repo.ssh.key'), 'keyPath', `<span class="ssv-inline"><input class="form-input ssv-mono" data-in="keyPath" value="${escAttr(draft.keyPath)}" spellcheck="false"${inv('keyPath')}><button class="btn btn-secondary btn-sm" data-act="browse-key" type="button">${escHtml(t('repo.ssh.browse'))}</button></span>`)
            : `<p class="ssv-note">${uiIcon('info', 12)}<span>${escHtml(t('sshsrv.pwNote'))}</span></p>`}
          ${field(t('sshsrv.base'), 'remoteDir', `<span class="ssv-inline"><input class="form-input ssv-mono" data-in="remoteDir" value="${escAttr(draft.remoteDir)}" placeholder="/var/www/repo" spellcheck="false"${inv('remoteDir')}><button class="btn btn-secondary btn-sm" data-act="browse-dir" type="button">${escHtml(t('repo.ssh.browseRemote'))}</button></span>`, t('sshsrv.baseHint'))}
          ${field(isKey ? t('sshsrv.secretKey') : t('sshsrv.secretPw'), 'secret', `<input class="form-input" data-in="secret" type="password" autocomplete="new-password" placeholder="${escAttr(isKey ? t('sshsrv.secretPh') : t('sshsrv.secretPwPh'))}">`, t('sshsrv.secretHint'))}
          <div class="ssv-known" data-r="known"></div>
          <div class="ssv-steps" data-r="steps" aria-live="polite"></div>`;
        void renderKnown();
    }

    const val = (k: string): string => (form.querySelector<HTMLInputElement>(`[data-in="${k}"]`)?.value || '').trim();
    const secretNow = (): string => form.querySelector<HTMLInputElement>('[data-in="secret"]')?.value || '';
    function read(): void {
        const isKey = (draft.auth || 'key') === 'key';
        draft = {
            host: val('host'),
            port: Number(val('port')) || 22,
            user: val('user'),
            remoteDir: val('remoteDir'),
            keyPath: isKey ? val('keyPath') : '',
            auth: isKey ? 'key' : 'password',
        };
    }

    /** The trusted fingerprint line for the host in the form, from the stored list only. */
    async function renderKnown(): Promise<void> {
        const box = form.querySelector<HTMLElement>('[data-r="known"]');
        if (!box) return;
        if (!draft.host) { box.innerHTML = ''; return; }
        try {
            const p = await invoke('ssh_probe_host_key', { host: draft.host, port: draft.port || 22, offline: true }) as HostKeyProbe | null;
            knownKeys.set(hostKey(draft), p?.known || null);
            box.innerHTML = p?.known
                ? `<span class="ssv-st ssv-st--ok">${uiIcon('shield-check', 12)}<span>${escHtml(t('sshsrv.keyTrusted'))}</span></span><code class="ssv-fp">${escHtml(p.known)}</code><button type="button" class="btn btn-ghost btn-sm" data-act="forget">${escHtml(t('repo.ssh.forget'))}</button>`
                : `<span class="ssv-st">${uiIcon('shield', 12)}<span>${escHtml(t('sshsrv.keyUnknown'))}</span></span>`;
        } catch { box.innerHTML = ''; }
    }

    function showErrors(): void {
        const secret = secretNow();
        renderForm();
        const s = form.querySelector<HTMLInputElement>('[data-in="secret"]');
        if (s) s.value = secret;
        const first = (['name', 'host', 'port', 'user', 'keyPath', 'remoteDir'] as SshField[]).find((f) => errors[f]);
        if (first) form.querySelector<HTMLElement>(`[data-in="${first}"]`)?.focus();
    }

    function steps(items: Step[]): void {
        const box = form.querySelector<HTMLElement>('[data-r="steps"]');
        if (!box) return;
        const icon = (s: Step): string => s.tone === 'ok' ? uiIcon('success', 14) : s.tone === 'bad' ? uiIcon('error', 14) : s.tone === 'warn' ? uiIcon('warning', 14) : s.tone === 'run' ? uiIcon('loader', 14, { cls: 'spin' }) : uiIcon('info', 14);
        box.innerHTML = items.length ? `<ol class="ssv-steplist">${items.map((s) => `<li class="ssv-step${s.tone ? ` ssv-step--${s.tone}` : ''}">${icon(s)}<div>${s.html ?? escHtml(s.text)}</div></li>`).join('')}</ol>` : '';
    }

    form.addEventListener('input', (e) => {
        dirty = true;
        const el = e.target as HTMLElement;
        const k = el.dataset.in as SshField | undefined;
        // A corrected field stops saying it is wrong as soon as it is touched.
        if (k && errors[k]) {
            delete errors[k];
            const box = form.querySelector(`#ssv-err-${k}`);
            if (box) box.innerHTML = '';
            el.removeAttribute('aria-invalid');
        }
    });
    // `me@nas.local:2222` pasted into the host field: split into user / host / port.
    form.addEventListener('focusout', (e) => {
        const el = e.target as HTMLInputElement;
        if (el.dataset.in !== 'host' && el.dataset.in !== 'port') return;
        if (el.dataset.in === 'host' && /[@]|^(ssh|sftp):|^[^:]+:\d+$|^\[/i.test(el.value.trim())) {
            const p = parseHostInput(el.value);
            el.value = p.host;
            const u = form.querySelector<HTMLInputElement>('[data-in="user"]');
            const pt = form.querySelector<HTMLInputElement>('[data-in="port"]');
            if (p.user && u && !u.value.trim()) u.value = p.user;
            if (p.port && pt) pt.value = String(p.port);
        }
        read();
        void renderKnown();
    });
    form.addEventListener('click', async (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-auth],[data-act]');
        if (!b) return;
        if (b.dataset.auth) {
            const secret = secretNow();
            read();
            draft.auth = b.dataset.auth === 'password' ? 'password' : 'key';
            dirty = true;
            renderForm();
            const s = form.querySelector<HTMLInputElement>('[data-in="secret"]');
            if (s) s.value = secret;
            form.querySelector<HTMLElement>(`[data-auth="${draft.auth}"]`)?.focus();
            return;
        }
        const act = b.dataset.act;
        if (act === 'browse-key') {
            const p = await pickFile().catch(() => null);
            if (p) { const i = form.querySelector<HTMLInputElement>('[data-in="keyPath"]'); if (i) i.value = String(p); dirty = true; }
        } else if (act === 'browse-dir') {
            // Reads the form as it stands rather than the saved target: somebody filling this
            // in for a new server has not saved anything yet.
            read();
            if (!draft.host || !draft.user) { steps([{ tone: 'bad', text: t('sshsrv.needHostUser') }]); return; }
            const { browseRemoteFolder } = await import('./ssh-browse.js');
            const picked = await browseRemoteFolder(draft, secretNow(), draft.remoteDir || '/');
            if (picked === null) return;
            const i = form.querySelector<HTMLInputElement>('[data-in="remoteDir"]');
            if (i) i.value = picked;
            dirty = true;
        } else if (act === 'forget') {
            read();
            if (!(await confirmAction({ title: t('repo.ssh.forget'), message: t('sshsrv.forgetConfirm', { host: draft.host }), confirmLabel: t('vfy.b.forget'), tone: 'danger' }))) return;
            await invoke('ssh_forget_host', { host: draft.host, port: draft.port || 22 }).catch(() => undefined);
            knownKeys.delete(hostKey(draft));
            lastTest.delete(current);
            await renderKnown();
            renderList();
        } else if (act === 'trust' || act === 'distrust' || act === 'forget-changed') {
            pendingTrust?.(act);
        }
    });

    // ── test ────────────────────────────────────────────────────────────────────────────────

    // A question (trust this key? forget the changed one?) leaves Test usable: pressing it
    // again, or editing the host and pressing it, drops the question and starts over.
    const answer = (): Promise<string> => {
        testBtn.disabled = false;
        return new Promise<string>((res) => { pendingTrust = res; });
    };
    let runSeq = 0;

    async function runTest(): Promise<void> {
        pendingTrust?.('superseded');
        pendingTrust = null;
        const run = ++runSeq;
        read();
        errors = validateSshDraft(draft);
        // The base folder is not needed to TEST a login; step 3 reports on it.
        delete errors.remoteDir;
        if (Object.keys(errors).length) { showErrors(); return; }
        const isKey = (draft.auth || 'key') === 'key';
        const secret = secretNow();
        if (!isKey && !secret) {
            steps([{ tone: 'bad', text: t('sshsrv.needPassword') }]);
            form.querySelector<HTMLElement>('[data-in="secret"]')?.focus();
            return;
        }
        testBtn.disabled = true;
        const done: Step[] = [];
        const where = `${draft.host}:${draft.port || 22}`;
        try {
            // 1. Reach it, and read its host key without logging in.
            steps([{ tone: 'run', text: t('sshsrv.stepReach', { where }) }]);
            let p: HostKeyProbe;
            try {
                p = await invoke('ssh_probe_host_key', { host: draft.host, port: draft.port || 22 }) as HostKeyProbe;
            } catch (e) {
                lastTest.set(current, { ok: false, at: Date.now() });
                steps([{ tone: 'bad', text: explainSsh(String(e)) }]);
                renderList();
                return;
            }
            done.push({ tone: 'ok', text: t('sshsrv.stepReached', { where }) });
            if (p.status === 'changed') {
                steps([...done, {
                    tone: 'bad', text: '', html: `<strong>${escHtml(t('sshsrv.keyChanged'))}</strong>
                    <dl class="ssv-fps"><dt>${escHtml(t('sshsrv.fpTrusted'))}</dt><dd><code>${escHtml(p.known || '')}</code></dd><dt>${escHtml(t('sshsrv.fpNow'))}</dt><dd><code>${escHtml(p.fingerprint)}</code></dd></dl>
                    <p class="ssv-hint">${escHtml(t('sshsrv.keyChangedHint'))}</p>
                    <button type="button" class="btn btn-ghost btn-sm" data-act="forget-changed">${escHtml(t('repo.ssh.forget'))}</button>`,
                }]);
                if ((await answer()) !== 'forget-changed') return;
                testBtn.disabled = true;
                if (!(await confirmAction({ title: t('repo.ssh.forget'), message: t('sshsrv.forgetConfirm', { host: draft.host }), confirmLabel: t('vfy.b.forget'), tone: 'danger' }))) { steps(done); return; }
                await invoke('ssh_forget_host', { host: draft.host, port: draft.port || 22 });
                p = { ...p, known: null, status: 'new' };
            }
            if (p.status === 'new') {
                steps([...done, {
                    tone: 'warn', text: '', html: `<strong>${escHtml(t('sshsrv.keyNew'))}</strong>
                    <code class="ssv-fp ssv-fp--big">${escHtml(p.fingerprint)}</code>
                    <p class="ssv-hint">${escHtml(t('sshsrv.keyNewHint'))}</p>
                    <span class="ssv-inline"><button type="button" class="btn btn-primary btn-sm" data-act="trust">${escHtml(t('sshsrv.trust'))}</button><button type="button" class="btn btn-ghost btn-sm" data-act="distrust">${escHtml(t('sshsrv.distrust'))}</button></span>`,
                }]);
                form.querySelector<HTMLElement>('[data-act="trust"]')?.focus();
                const a = await answer();
                if (a === 'closed' || a === 'superseded') return;
                testBtn.disabled = true;
                if (a !== 'trust') { steps([...done, { tone: 'bad', text: t('sshsrv.keyDeclined') }]); return; }
                await invoke('ssh_trust_host', { host: draft.host, port: draft.port || 22, fingerprint: p.fingerprint });
                void renderKnown();
            }
            done.push({ tone: 'ok', text: '', html: `${escHtml(t('sshsrv.stepKeyOk'))} <code class="ssv-fp">${escHtml(p.fingerprint)}</code>` });

            // 2. Log in, and 3. look at the base folder.
            steps([...done, { tone: 'run', text: t('sshsrv.stepLogin', { user: draft.user }) }]);
            let r: TestResult;
            try {
                r = await invoke('ssh_test_connection', { target: draft, secret: secret || null }) as TestResult;
            } catch (e) {
                lastTest.set(current, { ok: false, at: Date.now() });
                steps([...done, { tone: 'bad', text: explainSsh(String(e)) }]);
                renderList();
                return;
            }
            done.push({ tone: 'ok', text: t('sshsrv.stepLoggedIn', { user: r.user || draft.user }) });
            if (!draft.remoteDir) {
                done.push({ tone: 'warn', text: t('sshsrv.stepNoDir') });
            } else if (!r.remoteDirExists) {
                done.push({ tone: 'warn', text: t('repo.ssh.testNoDir', { dir: draft.remoteDir }) });
            } else if (r.writable) {
                done.push({ tone: 'ok', text: t('sshsrv.stepWritable', { dir: draft.remoteDir, n: String(r.entries) }) });
            } else {
                const why = r.dirUid != null
                    ? t('repo.ssh.testWhyOwner', { dir: draft.remoteDir, owner: String(r.dirUid), mode: modeString(r.dirMode), user: r.user || draft.user })
                    : (r.writeError || '');
                done.push({ tone: 'bad', text: `${t('repo.ssh.testNotWritable', { dir: draft.remoteDir })} ${why}`.trim() });
            }
            lastTest.set(current, { ok: !done.some((s) => s.tone === 'bad'), at: Date.now() });
            steps(done);
            renderList();
        } finally {
            if (run === runSeq) {
                pendingTrust = null;
                testBtn.disabled = false;
            }
        }
    }
    testBtn.addEventListener('click', () => { void runTest(); });

    // ── save / delete / add ─────────────────────────────────────────────────────────────────

    function save(): void {
        read();
        const name = val('name') || DEFAULT_TARGET;
        errors = validateSshDraft(draft, name, names().filter((n) => n !== current));
        if (Object.keys(errors).length) { showErrors(); return; }
        // A rename is a save under the new name plus a delete of the old one. Doing it in
        // that order means a failure leaves the original intact rather than neither.
        saveTarget(draft, name);
        if (current && current !== name) {
            deleteTarget(current);
            const lt = lastTest.get(current);
            if (lt) { lastTest.set(name, lt); lastTest.delete(current); }
        }
        current = name;
        dirty = false;
        renderList(); renderForm(); announce();
        // Said where the reader is looking, next to the form, rather than in a corner.
        steps([{ tone: 'ok', text: t('sshsrv.saved') }]);
    }
    saveBtn.addEventListener('click', save);
    // Ctrl+S saves; Enter in a text field saves too (the form has no submit button of its own).
    m.dialog.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
        const el = e.target as HTMLElement;
        if (e.key === 'Enter' && !e.isComposing && el.tagName === 'INPUT' && form.contains(el)) { e.preventDefault(); save(); }
    });

    delBtn.addEventListener('click', async () => {
        if (!current) return;
        if (!(await confirmAction({ title: t('vfy.t.deleteServer'), message: t('sshsrv.confirmDelete', { name: current }), confirmLabel: t('common.delete'), tone: 'danger' }))) return;
        deleteTarget(current);
        lastTest.delete(current);
        current = names()[0] || '';
        draft = current ? { ...blank(), ...loadTargets()[current] } : blank();
        dirty = false;
        errors = {};
        renderList(); renderForm(); announce();
    });

    m.q<HTMLElement>('.ssv-add')!.addEventListener('click', async () => {
        if (dirty && !(await confirmAction({ title: t('vfy.t.discard'), message: t('sshsrv.discard'), confirmLabel: t('vfy.b.discard'), tone: 'warn' }))) return;
        current = '';
        draft = blank();
        dirty = false;
        errors = {};
        renderList(); renderForm();
        form.querySelector<HTMLElement>('[data-in="name"]')?.focus();
    });

    // The trusted keys of every saved server, for the list's status (offline: no network).
    void Promise.all(names().map(async (n) => {
        const tg = { ...blank(), ...loadTargets()[n] };
        if (!tg.host) return;
        const p = await invoke('ssh_probe_host_key', { host: tg.host, port: tg.port || 22, offline: true }).catch(() => null) as HostKeyProbe | null;
        knownKeys.set(hostKey(tg), p?.known || null);
    })).then(renderList);

    renderList();
    renderForm();
    (current ? list : form.querySelector<HTMLElement>('[data-in="name"]'))?.focus();
}
