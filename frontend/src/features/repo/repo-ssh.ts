// Server Repo → publish over SSH, and pull back down.
//
// The backend does the work (src-tauri/src/commands/repo_ssh.rs); this is the form, the
// remote folder picker, the progress bar, and the translation of the backend's error codes.
//
// ERRORS ARRIVE AS CODES, not sentences. Rust returns `repo.ssh.errAuthRejected` or
// `repo.ssh.errConnect|host|detail` — a key and its arguments, pipe-separated. The backend
// has no language, and a message composed there would be English forever. Splitting on '|'
// here is what lets the same failure read correctly in both.
//
// WHAT IS STORED, AND WHAT IS NOT
//
// Host, port, user, remote folder, key PATH and the chosen method are remembered. The
// passphrase and the password are not, ever — they are read from the field at the moment of
// use. That is why a scheduled sync only works with a key that has no passphrase: there is
// nobody at 04:00 to type anything, and a prompt nobody answers is a task that silently
// never runs.

import { invoke, pickFile, askConfirm } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml } from '../../core/utils.js';

type AuthMethod = 'key' | 'password';

export interface SshTarget {
    host: string;
    port?: number | null;
    user: string;
    keyPath: string;
    remoteDir: string;
    auth?: AuthMethod;
}

interface SshTestResult {
    fingerprint: string;
    remoteDirExists: boolean;
    writable: boolean;
    /** The server's reason, when the write probe failed and it gave one. */
    writeError?: string | null;
    entries: number;
    /** Who owns the remote directory, and its mode — the answer to "but I have the rights". */
    dirUid?: number | null;
    dirGid?: number | null;
    dirMode?: number | null;
    /** The account BMM authenticated as. */
    user?: string;
}

/** 0o755 → "rwxr-xr-x". A mode is checkable at a glance in letters and not in octal. */
function modeLetters(mode: number): string {
    const bit = (n: number, chars: string) =>
        [4, 2, 1].map((b, i) => (n & b ? chars[i] : '-')).join('');
    return bit((mode >> 6) & 7, 'rwx') + bit((mode >> 3) & 7, 'rwx') + bit(mode & 7, 'rwx');
}

/**
 * Why the write was refused, in terms the reader can check on their own server.
 *
 * "Permission denied" alone sent people to verify permissions they already held, on an
 * account that was already right. The usual truth is duller and invisible from here: /srv,
 * /var/www and /opt are root-owned and mode 755, so every account may LIST them and only
 * root may create a file in one. Naming the owner, the mode and the account BMM used turns
 * an argument into an observation.
 */
function whyNotWritable(r: SshTestResult, dir: string): string {
    if (r.dirUid === null || r.dirUid === undefined || !r.user) return '';
    const mode = typeof r.dirMode === 'number' ? modeLetters(r.dirMode) : '';
    const owner = `${r.dirUid}:${r.dirGid ?? '?'}`;
    const why = t('repo.ssh.testWhyOwner')
        .replace('{dir}', dir).replace('{owner}', owner)
        .replace('{mode}', mode).replace('{user}', r.user);
    const fix = t('repo.ssh.testWhyFix')
        .replace('{dir}', dir.replace(/\/+$/, '')).replace('{user}', r.user);
    return `${why} ${fix}`;
}

interface RemoteEntry {
    name: string;
    isDir: boolean;
    size: number;
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

/** Where the settings live. Host/user/folder/key PATH/method — never a secret. */
const STORE = 'bmm.repo.ssh';        // legacy: ONE target, migrated on first read
const STORE_MANY = 'bmm.ssh.targets'; // { [name]: SshTarget }

/** The name `ssh://` with nothing after it refers to. */
export const DEFAULT_TARGET = 'default';

/**
 * Every saved target, by name.
 *
 * Migrates the old single-target key on first read: it becomes "default", so `ssh://` keeps
 * meaning exactly what it meant and an upgrade never loses somebody's server.
 */
export function loadTargets(): Record<string, SshTarget> {
    let all: Record<string, SshTarget> = {};
    try { all = JSON.parse(localStorage.getItem(STORE_MANY) || '{}') || {}; } catch { all = {}; }
    if (Object.keys(all).length) return all;
    try {
        const legacy = JSON.parse(localStorage.getItem(STORE) || '{}');
        if (legacy && legacy.host) {
            all = { [DEFAULT_TARGET]: legacy as SshTarget };
            localStorage.setItem(STORE_MANY, JSON.stringify(all));
        }
    } catch { /* nothing to migrate */ }
    return all;
}

/** One target by name, or an empty object. */
function loadTarget(name = DEFAULT_TARGET): Partial<SshTarget> {
    return loadTargets()[name] || {};
}

/**
 * Tell the backend which private key to prove identity with.
 *
 * Best-effort and deliberately silent: the command refuses anything that is not a usable
 * ed25519 key, and that is a perfectly ordinary state — an RSA key is fine for SSH and simply
 * cannot be used for this. Reporting it here would be an error message on a screen where
 * nothing went wrong.
 */
function rememberKeyAuthKey(target: SshTarget): void {
    if (target.auth === 'password' || !target.keyPath) return;
    // Deliberately NOT pointing the identity keyring at this target's key any more.
    //
    // It used to, because that was the only way to set one. Now that the ring has real screens,
    // silently repointing the app's identity because somebody configured an SFTP target is a
    // surprise: the key that opens a shell and the key a catalogue knows you by are different
    // questions, and answering one by changing the other is how you end up presenting the
    // wrong identity without ever choosing to.

}

/** Save (or replace) a named target. The secret is never part of what gets written. */
function saveTarget(target: SshTarget, name = DEFAULT_TARGET): void {
    try {
        const all = loadTargets();
        all[name] = target;
        localStorage.setItem(STORE_MANY, JSON.stringify(all));
        // Keep the legacy key in step for the default, so a downgrade still finds a server.
        if (name === DEFAULT_TARGET) localStorage.setItem(STORE, JSON.stringify(target));
        rememberKeyAuthKey(target);
    } catch { /* storage full */ }
}

/** Forget a named target. */
export function deleteTarget(name: string): void {
    try {
        const all = loadTargets();
        delete all[name];
        localStorage.setItem(STORE_MANY, JSON.stringify(all));
        if (name === DEFAULT_TARGET) localStorage.removeItem(STORE);
    } catch { /* ignore */ }
}

/**
 * The target name inside a source URL.
 *
 *   ssh://          → "default"
 *   ssh://prod      → "prod"
 *   ssh://prod/     → "prod"
 *
 * Anything that is not an `ssh://` URL yields null, so callers can use this as the test.
 */
export function sshTargetName(url: string): string | null {
    return parseSshSource(url)?.name ?? null;
}

/**
 * An `ssh://` source, split into the target NAME and the path under it.
 *
 *   ssh://                       → { name: 'default', path: '' }
 *   ssh://prod                   → { name: 'prod',    path: '' }
 *   ssh://prod/catalogs/app.json → { name: 'prod',    path: 'catalogs/app.json' }
 *
 * The first segment is the name and the rest is the path, which is what lets a catalog of any
 * kind name a file on a server without inventing a second setting to hold the server.
 */
export function parseSshSource(url: string): { name: string; path: string } | null {
    const u = (url || '').trim();
    if (!/^ssh:\/\//i.test(u)) return null;
    const rest = u.slice('ssh://'.length);
    // `ssh:///a/b.json` — three slashes, so the authority is EMPTY and the rest is a path on
    // the default target. Stripping the leading slashes first read `a` as the target name and
    // silently looked for a server nobody had configured.
    if (rest.startsWith('/')) return { name: DEFAULT_TARGET, path: rest.replace(/^\/+/, '') };
    const cut = rest.indexOf('/');
    if (cut < 0) return { name: rest.replace(/\/+$/, '').trim() || DEFAULT_TARGET, path: '' };
    return {
        name: rest.slice(0, cut).trim() || DEFAULT_TARGET,
        path: rest.slice(cut + 1).replace(/^\/+/, ''),
    };
}

/** The name currently typed in the panel's name field, or "default". */
function currentName(): string {
    return (el<HTMLInputElement>('repo-ssh-name')?.value || '').trim() || DEFAULT_TARGET;
}

// ── auth method ──────────────────────────────────────────────────────────────

let authMethod: AuthMethod = 'key';

/** Show the fields that belong to the active method, and only those. */
function applyAuthMethod(m: AuthMethod): void {
    authMethod = m;
    const keyBtn = el<HTMLButtonElement>('repo-ssh-auth-key');
    const passBtn = el<HTMLButtonElement>('repo-ssh-auth-pass');
    keyBtn?.setAttribute('aria-pressed', String(m === 'key'));
    passBtn?.setAttribute('aria-pressed', String(m === 'password'));
    for (const n of Array.from(document.querySelectorAll<HTMLElement>('.repo-ssh-keyonly'))) {
        n.hidden = m !== 'key';
    }
    for (const n of Array.from(document.querySelectorAll<HTMLElement>('.repo-ssh-passonly'))) {
        n.hidden = m !== 'password';
    }
}

/** Read the form. Returns null (and says why) when something required is missing. */
function readForm(): { target: SshTarget; secret: string } | null {
    const host = el<HTMLInputElement>('repo-ssh-host')?.value.trim() || '';
    const user = el<HTMLInputElement>('repo-ssh-user')?.value.trim() || '';
    const keyPath = el<HTMLInputElement>('repo-ssh-key')?.value.trim() || '';
    const remoteDir = el<HTMLInputElement>('repo-ssh-remote')?.value.trim() || '';
    const portRaw = el<HTMLInputElement>('repo-ssh-port')?.value.trim() || '';

    // The key path is required for key auth and meaningless for password auth. Demanding it
    // in both modes was the first thing that made this panel feel obstructive.
    if (!host || !user || !remoteDir || (authMethod === 'key' && !keyPath)) {
        status(t('repo.ssh.needFields'), 'err');
        return null;
    }
    const port = portRaw ? Number(portRaw) : null;
    const secret = authMethod === 'key'
        ? (el<HTMLInputElement>('repo-ssh-pass')?.value || '')
        : (el<HTMLInputElement>('repo-ssh-pw')?.value || '');
    return {
        target: {
            host, user, remoteDir, auth: authMethod,
            keyPath: authMethod === 'key' ? keyPath : '',
            port: Number.isFinite(port) ? port : null,
        },
        secret,
    };
}

/**
 * The block under the buttons that says WHY, when there is a why.
 *
 * Separate from `status` on purpose: that one writes into a 10px round pill beside the
 * title, which is the right shape for a verdict and the wrong shape for a sentence.
 */
function why(text: string, tone: 'ok' | 'warn' | 'err' | '' = ''): void {
    const b = el('repo-ssh-why');
    if (!b) return;
    b.textContent = text;
    b.hidden = !text;
    if (tone) b.dataset.tone = tone; else delete b.dataset.tone;
}

function status(text: string, tone: 'ok' | 'warn' | 'err' | '' = ''): void {
    const b = el('repo-ssh-status');
    if (!b) return;
    b.textContent = text;
    b.hidden = !text;
    if (tone) b.dataset.tone = tone; else delete b.dataset.tone;
}

/**
 * Turn `code|arg|arg` into a sentence in the user's language.
 *
 * The argument NAMES differ per message ({host}, {dir}, {fp}, {detail}), so the mapping is
 * per code rather than positional-for-everything: a generic {0}/{1} would read like a stack
 * trace in a place people go when something already went wrong.
 */
function explain(raw: unknown): string {
    // Rust hands back a bare string; anything thrown on this side is an Error. `String(err)`
    // on an Error yields "Error: repo.ssh.errListDir|…", and the leading "Error: " means the
    // code no longer starts with `repo.ssh.` — every locally-thrown failure would silently
    // fall through to the generic wrapper instead of resolving to its own sentence.
    const s = raw instanceof Error ? raw.message : String(raw ?? '');
    const [code, ...args] = s.split('|');
    const named: Record<string, Record<string, string>> = {
        'repo.ssh.errKeyRead': { detail: args[1] || args[0] || '' },
        'repo.ssh.errKeyDecode': { detail: args[0] || '' },
        'repo.ssh.errConnect': { host: args[0] || '', detail: args[1] || '' },
        'repo.ssh.errAuth': { detail: args[0] || '' },
        'repo.ssh.errHostKeyChanged': { fp: args[0] || '' },
        'repo.ssh.errLocalDir': { dir: args[0] || '' },
        'repo.ssh.errSftp': { detail: args[0] || '' },
        'repo.ssh.errListDir': { dir: args[0] || '', detail: args[1] || '' },
        'repo.ssh.errRemoteMissing': { dir: args[0] || '' },
        'repo.ssh.errOpenRemote': { path: args[0] || '', detail: args[1] || '' },
        'repo.ssh.errReadRemote': { path: args[0] || '', detail: args[1] || '' },
        'repo.ssh.errLocalWrite': { path: args[0] || '', detail: args[1] || '' },
        'repo.ssh.errUnsafePath': { path: args[0] || '' },
        'repo.ssh.errNoManifest': { dir: args[0] || '' },
        'repo.ssh.errNoSuchTarget': { name: args[0] || '' },
        'repo.ssh.errBadManifest': { detail: args[0] || '' },
    };
    // A code we know about resolves; anything else is shown verbatim inside a generic
    // wrapper rather than swallowed — an unrecognised failure is still a failure to report.
    if (code.startsWith('repo.ssh.') && t(code) !== code) {
        let out = t(code);
        for (const [k, v] of Object.entries(named[code] || {})) out = out.replace(`{${k}}`, v);
        return out;
    }
    return t('repo.ssh.errGeneric').replace('{detail}', s);
}

const fmtBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

let busy = false;

function setBusy(on: boolean): void {
    busy = on;
    for (const id of ['repo-ssh-test', 'repo-ssh-publish', 'repo-ssh-pull', 'repo-ssh-remote-pick']) {
        const b = el<HTMLButtonElement>(id);
        if (b) b.disabled = on;
    }
    // Re-apply the reasons that are not "busy". Without this, finishing a transfer would
    // re-enable Publish even with no folder to publish — two rules writing one property, and
    // the last one to run wins.
    if (!on) renderRoute();
}

// ── connection test ──────────────────────────────────────────────────────────

async function testConnection(): Promise<void> {
    const form = readForm();
    if (!form || busy) return;
    setBusy(true);
    status(t('repo.ssh.testing'));
    try {
        const r = (await invoke('ssh_test_connection', {
            target: form.target,
            secret: form.secret || null,
        })) as SshTestResult;
        saveTarget(form.target, currentName());
        renderSavedTargets();
        el('repo-ssh-forget')!.hidden = false;
        if (!r.remoteDirExists) {
            status(t('repo.ssh.testNoDirShort'), 'warn');
            why(t('repo.ssh.testNoDir').replace('{dir}', form.target.remoteDir), 'warn');
        } else if (!r.writable) {
            // The failure worth catching here: the upload version of it fails after
            // transferring everything.
            //
            // The server's own words are appended when it gave any. Without them this said
            // "not writable" for four different causes — no permission, a read-only mount, a
            // full disk, a chroot putting the path elsewhere — and the one it named was the
            // only one the reader could not check.
            // The server often says the same thing twice ("Permission denied: Permission
            // denied") because the SFTP layer prefixes its own message with the code's name.
            // Collapsing a repeated half is not cosmetic: a doubled message reads like two
            // different failures.
            const raw = (r.writeError || '').trim();
            const half = raw.split(':').map((x) => x.trim()).filter(Boolean);
            const said = half.length === 2 && half[0].toLowerCase() === half[1].toLowerCase()
                ? half[0] : raw;
            const said2 = said ? ` — ${said}` : '';
            status(t('repo.ssh.testNotWritableShort'), 'err');
            why(t('repo.ssh.testNotWritable').replace('{dir}', form.target.remoteDir) + said2
                + (whyNotWritable(r, form.target.remoteDir)
                    ? `
${whyNotWritable(r, form.target.remoteDir)}` : ''),
                'err');
        } else {
            status(t('repo.ssh.testOkWritable'), 'ok');
            why('');
        }
        // The toast AGREES with the verdict.
        //
        // It used to announce success unconditionally, so a directory BMM had just refused to
        // write into produced "Connected. Fingerprint …" in green beside "connected, but /srv
        // is not writable" in red. Two messages, one test, opposite tones — the reader is left
        // to work out which one is the result. The fingerprint is worth showing either way, so
        // it stays; only the claim of success is conditional.
        const ok = r.remoteDirExists && r.writable;
        toast(
            (ok ? t('repo.ssh.testOk') : t('repo.ssh.testOkButNot')).replace('{fp}', r.fingerprint),
            ok ? 'success' : 'warning',
            ok ? 6000 : 9000,
        );
    } catch (e) {
        status(t('repo.ssh.testFailedShort'), 'err');
        // Cleared and rewritten, never left behind: an explanation from the PREVIOUS run
        // sitting under a new failure describes a server that is no longer the one being
        // talked about.
        why(explain(e), 'err');
        toast(explain(e), 'error', 8000);
    } finally {
        setBusy(false);
    }
}

// ── transfers ────────────────────────────────────────────────────────────────

function beginTransfer(): void {
    const wrap = el('repo-ssh-progress');
    const fill = el('repo-ssh-bar-fill');
    if (wrap) wrap.hidden = false;
    if (fill) fill.style.width = '0%';
    status('');
}

async function publish(): Promise<void> {
    const form = readForm();
    if (!form || busy) return;
    const localDir = (el<HTMLInputElement>('repo-export-path')?.value || '').trim();
    if (!localDir) {
        status(t('repo.ssh.pickExportFirst'), 'err');
        return;
    }
    setBusy(true);
    beginTransfer();

    try {
        const bytes = (await invoke('ssh_upload_repo', {
            target: form.target,
            secret: form.secret || null,
            localDir,
        })) as number;
        saveTarget(form.target, currentName());
        renderSavedTargets();
        const done = el('repo-ssh-progress-text')?.dataset.done || '?';
        const msg = t('repo.ssh.uploaded').replace('{n}', done).replace('{size}', fmtBytes(bytes));
        status(msg, 'ok');
        toast(msg, 'success', 7000);
    } catch (e) {
        status(explain(e), 'err');
        toast(explain(e), 'error', 9000);
    } finally {
        setBusy(false);
    }
}

/**
 * Pull the repo down from the server into the export folder.
 *
 * Asks first. The remote copy overwrites files of the same name, and somebody who exported
 * locally five minutes ago and has not published yet would lose that work with one click —
 * the button sits next to "Publish" and the two read alike at a glance.
 */
async function pull(): Promise<void> {
    const form = readForm();
    if (!form || busy) return;
    const localDir = (el<HTMLInputElement>('repo-export-path')?.value || '').trim();
    if (!localDir) {
        status(t('repo.ssh.pickExportFirst'), 'err');
        return;
    }
    // askConfirm, not window.confirm and not dialog.confirm: tauri-plugin-dialog 2.x ships
    // no `confirm` command at all, so the webview rejects it as an uncaught promise while
    // the synchronous call returns undefined. api.ts documents the whole trap and routes to
    // the in-app modal instead.
    const ok = await askConfirm(
        t('repo.ssh.pullConfirm').replace('{dir}', localDir),
        { title: t('repo.ssh.pull'), type: 'warning' },
    );
    if (!ok) return;

    setBusy(true);
    beginTransfer();
    try {
        const bytes = (await invoke('ssh_download_repo', {
            target: form.target,
            secret: form.secret || null,
            localDir,
        })) as number;
        saveTarget(form.target, currentName());
        renderSavedTargets();
        const done = el('repo-ssh-progress-text')?.dataset.done || '?';
        const msg = t('repo.ssh.pulled').replace('{n}', done).replace('{size}', fmtBytes(bytes));
        status(msg, 'ok');
        toast(msg, 'success', 7000);
    } catch (e) {
        status(explain(e), 'err');
        toast(explain(e), 'error', 9000);
    } finally {
        setBusy(false);
    }
}

// ── remote folder picker ─────────────────────────────────────────────────────
//
// The reason this exists: an absolute remote path typed from memory is the single most
// common way this panel failed. `/var/www/repo` when the account lands in `/home/you`, a
// trailing slash, a capital letter on a case-sensitive filesystem — and the connection test
// then says "not writable", which sends people looking at permissions for a path that was
// never there.

let browsePath = '';

async function openBrowser(): Promise<void> {
    const form = readForm();
    if (!form || busy) return;
    const overlay = el('repo-ssh-browser');
    if (!overlay) return;
    overlay.hidden = false;
    // Start from whatever is typed, or from wherever the account lands when it is empty.
    browsePath = form.target.remoteDir || '';
    await refreshBrowser();
}

function closeBrowser(): void {
    const overlay = el('repo-ssh-browser');
    if (overlay) overlay.hidden = true;
}

async function refreshBrowser(): Promise<void> {
    const form = readForm();
    if (!form) return;
    const list = el('repo-ssh-browser-list');
    const pathEl = el('repo-ssh-browser-path');
    if (!list) return;
    list.textContent = t('repo.ssh.browserLoading');

    try {
        const raw = await invoke('ssh_list_dir', {
            target: form.target,
            secret: form.secret || null,
            path: browsePath || null,
        });
        // A non-array answer is a failure, not an empty folder, and it must not be allowed
        // to become a TypeError two lines later: "Cannot read properties of null (reading
        // 'length')" tells the user nothing about their server. It happens for real outside
        // the Tauri webview, where invoke() resolves to null.
        if (!Array.isArray(raw)) throw new Error(`repo.ssh.errListDir|${browsePath}|no response`);
        const entries = raw as RemoteEntry[];

        // The server resolves "wherever I landed" into a real path; show that, so the value
        // written into the field is always absolute.
        if (!browsePath) {
            browsePath = (await invoke('ssh_resolve_path', {
                target: form.target,
                secret: form.secret || null,
                path: '.',
            })) as string;
        }
        if (pathEl) pathEl.textContent = browsePath;

        list.textContent = '';
        if (!entries.length) {
            const empty = document.createElement('div');
            empty.className = 'repo-ssh-browser-empty';
            empty.textContent = t('repo.ssh.browserEmpty');
            list.appendChild(empty);
            return;
        }
        for (const e of entries) {
            // Built as DOM, not innerHTML: these names come from a remote machine, and a
            // directory called `<img onerror=…>` must never become markup.
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'repo-ssh-browser-row';
            row.dataset.dir = e.isDir ? '1' : '0';
            row.dataset.name = e.name;
            row.disabled = !e.isDir;

            const icon = document.createElement('span');
            icon.textContent = e.isDir ? '📁' : '📄';
            const name = document.createElement('span');
            name.className = 'rb-name';
            name.textContent = e.name;
            row.append(icon, name);
            if (!e.isDir) {
                const size = document.createElement('span');
                size.className = 'rb-size';
                size.textContent = fmtBytes(e.size);
                row.appendChild(size);
            }
            list.appendChild(row);
        }
    } catch (err) {
        list.textContent = '';
        const bad = document.createElement('div');
        bad.className = 'repo-ssh-browser-empty';
        bad.textContent = explain(err);
        list.appendChild(bad);
    }
}

/** Put a named target into the form. */
function fillForm(name: string): void {
    const saved = loadTarget(name);
    const set = (id: string, v: unknown) => {
        const input = el<HTMLInputElement>(id);
        if (input) input.value = v == null ? '' : String(v);
    };
    set('repo-ssh-name', name);
    set('repo-ssh-host', saved.host);
    set('repo-ssh-port', saved.port);
    set('repo-ssh-user', saved.user);
    set('repo-ssh-key', saved.keyPath);
    set('repo-ssh-remote', saved.remoteDir);
    // The secrets are not stored, so their fields are cleared rather than left holding
    // whatever the previous target's field contained — which would silently be sent.
    set('repo-ssh-pass', '');
    set('repo-ssh-pw', '');
    applyAuthMethod(saved.auth === 'password' ? 'password' : 'key');
    el('repo-ssh-forget')!.hidden = !saved.host;
}

/** One chip per saved target; the active one is marked. */
function renderSavedTargets(): void {
    const host = el('repo-ssh-saved');
    if (!host) return;
    const names = sshTargetNames();
    host.hidden = names.length < 2;   // one target needs no picker
    host.textContent = '';
    const active = currentName();
    for (const n of names) {
        // Built as DOM: a target name is user input, and innerHTML here would make
        // `<img onerror=…>` a working name.
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'repo-ssh-chip' + (n === active ? ' is-active' : '');
        b.dataset.target = n;
        b.textContent = n;
        host.appendChild(b);
    }
}

/**
 * Offer the keys configured under Identity & API as the private key for SFTP.
 *
 * A keyring entry is a NAME and a PATH on this machine, which is exactly what russh needs to
 * open a session — so the key a catalogue knows you by can also be the key that publishes to
 * it. Until now the only way to reuse one was to retype its path, which is a path people get
 * subtly wrong and then debug as an authentication problem.
 *
 * Picking one FILLS the path field rather than replacing it. What gets read at send time
 * stays visible and editable, and a target already pointing at a key outside the ring is not
 * quietly repointed.
 *
 * The reverse direction is deliberately NOT wired: configuring an SFTP target must not
 * silently change which identity BMM presents to catalogues. Two different questions.
 */
async function fillKeyRing(): Promise<void> {
    const sel = el<HTMLSelectElement>('repo-ssh-key-ring');
    if (!sel) return;
    const put = (label: string, disabled: boolean) => {
        sel.textContent = '';
        const o = document.createElement('option');
        o.value = ''; o.textContent = label;
        sel.appendChild(o);
        sel.disabled = disabled;
    };
    try {
        const { listKeyring } = await import('../../core/identity-key.js');
        const view = await listKeyring();
        if (!view.keys.length) { put(t('repo.ssh.ringEmpty'), true); return; }
        put(t('repo.ssh.ringPick'), false);
        for (const k of view.keys) {
            const o = document.createElement('option');
            // The PATH is the value, because that is what the form needs; the name is what
            // the reader recognises.
            o.value = k.path;
            o.textContent = k.name;
            sel.appendChild(o);
        }
    } catch {
        // Same rule as every other key control: a backend that cannot answer says so rather
        // than presenting an empty list, which is indistinguishable from "you have no keys".
        put(t('settings.identity.authKeyUnavailable'), true);
    }
}

/** Wire the panel. Idempotent — a second call attaches nothing twice. */
/**
 * Keep the "this folder → that place" line in step with the form.
 *
 * The two halves of the answer were never next to each other: the SOURCE is the export
 * folder, which lives on a different card, and the DESTINATION is a host and a remote
 * directory four rows apart with a user and a port between them. The panel explained the
 * ORDER to do things in and never once said where the files land.
 *
 * Read from the inputs on every keystroke rather than from the saved target: the saved one
 * is what a scheduled publish will use, and this line is about the button under it.
 */
function renderRoute(): void {
    const val = (id: string) => el<HTMLInputElement>(id)?.value.trim() || '';
    const from = el('repo-ssh-route-from');
    const to = el('repo-ssh-route-to');
    if (!from || !to) return;

    // The folder the export card is pointed at — the same one Publish sends.
    const dir = (document.getElementById('repo-export-path') as HTMLInputElement | null)?.value.trim() || '';
    from.textContent = dir || (t('repo.ssh.routeNoDir') || 'no exported folder yet');
    from.classList.toggle('is-empty', !dir);

    // The two buttons that MOVE that folder are off until there is one, and say why.
    //
    // They used to be pressable and answer "pick an export first" afterwards, which puts the
    // requirement on the far side of a click — on a card that mentions the folder nowhere
    // except this line. Untouched while a transfer runs: `busy` owns them then, and
    // re-enabling mid-upload would be worse than either.
    if (!busy) {
        for (const id of ['repo-ssh-publish', 'repo-ssh-pull']) {
            const b = el<HTMLButtonElement>(id);
            if (!b) continue;
            b.disabled = !dir;
            b.title = dir ? '' : (t('repo.ssh.pickExportFirst') || '');
        }
    }

    const host = val('repo-ssh-host');
    const user = val('repo-ssh-user');
    const port = val('repo-ssh-port');
    const remote = val('repo-ssh-remote');
    if (!host) {
        to.textContent = t('repo.ssh.routeNoHost') || 'no server yet';
        to.classList.add('is-empty');
        return;
    }
    // `user@host:port/path` — the form somebody would type into an ssh command, so it is
    // recognisable rather than being a sentence assembled out of four labels. The port is
    // shown only when it is not 22, which is the whole reason the field is usually empty.
    const at = user ? `${user}@` : '';
    const p = port && port !== '22' ? `:${port}` : '';
    to.textContent = `${at}${host}${p}${remote ? ` ${remote}` : ''}`;
    to.classList.remove('is-empty');
}

export function initRepoSsh(): void {
    const card = el('repo-ssh-card');
    if (!card || card.dataset.bound) return;
    card.dataset.bound = '1';

    // Open on the first saved target, or an empty "default".
    fillForm(sshTargetNames()[0] || DEFAULT_TARGET);
    renderSavedTargets();

    // Switching target: delegated, because the chips are rebuilt on every save.
    el('repo-ssh-saved')?.addEventListener('click', (e) => {
        const n = (e.target as HTMLElement)?.closest('.repo-ssh-chip') as HTMLElement | null;
        if (!n?.dataset.target) return;
        fillForm(n.dataset.target);
        renderSavedTargets();
        // Setting .value from code fires no `input` event, so the line would keep showing
        // the previous target until somebody typed a character.
        renderRoute();
        status('');
    });
    el('repo-ssh-name')?.addEventListener('input', renderSavedTargets);

    // The route line, and everything that changes it. `repo-export-path` lives on the
    // generate card and is what Publish actually sends, so it is watched too — otherwise
    // the line would claim a folder that had been changed since.
    renderRoute();
    for (const id of ['repo-ssh-host', 'repo-ssh-user', 'repo-ssh-port', 'repo-ssh-remote', 'repo-export-path']) {
        document.getElementById(id)?.addEventListener('input', renderRoute);
    }

    void fillKeyRing();
    el<HTMLSelectElement>('repo-ssh-key-ring')?.addEventListener('change', (e) => {
        const path = (e.target as HTMLSelectElement).value;
        if (!path) return;
        const input = el<HTMLInputElement>('repo-ssh-key');
        if (input) { input.value = path; input.dispatchEvent(new Event('input')); }
    });
    el('repo-ssh-key-manage')?.addEventListener('click', () => {
        (document.getElementById('nav-settings') as HTMLElement | null)?.click();
        setTimeout(() => document.getElementById('settings-identity-card')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
    });

    el('repo-ssh-auth-key')?.addEventListener('click', () => applyAuthMethod('key'));
    el('repo-ssh-auth-pass')?.addEventListener('click', () => applyAuthMethod('password'));

    el('repo-ssh-test')?.addEventListener('click', () => { void testConnection(); });
    el('repo-ssh-publish')?.addEventListener('click', () => { void publish(); });
    el('repo-ssh-pull')?.addEventListener('click', () => { void pull(); });

    el('repo-ssh-key-pick')?.addEventListener('click', async () => {
        const p = await pickFile();
        if (p) {
            const input = el<HTMLInputElement>('repo-ssh-key');
            if (input) input.value = p;
        }
    });

    // ── picker wiring ──
    //
    // Move the overlay to <body> first. It is `position: fixed`, and a fixed element is
    // positioned against the viewport ONLY while no ancestor establishes a containing block
    // — a transform, filter, perspective, will-change or `contain` does, and then `fixed`
    // silently behaves like `absolute`.
    //
    // Both apply here: `.repo-tab-panel` carries a transform for its tab animation, and
    // `#app-window-outer` sets `contain: paint`. Measured in the browser before this line
    // existed: `inset: 0` produced a 776x3621 overlay against a 1280x720 viewport. Nothing
    // errors, nothing logs — the dimmer is simply the wrong size and the panel is nowhere
    // near the middle of the screen.
    // Moved to #app-window-outer, NOT to <body>.
    //
    // It has to leave `.repo-tab-panel`, which carries a transform for its tab animation — that
    // part of the original reasoning still holds. But <body> put the dim outside the app: over
    // the transparent Tauri margins, the rounded corners, and Tasky. The frame's `contain:
    // paint` clips an absolute child to the window, which is exactly the wanted behaviour.
    const overlay = el('repo-ssh-browser');
    const frame = document.getElementById('app-window-outer') || document.body;
    if (overlay && overlay.parentElement !== frame) frame.appendChild(overlay);

    // Collapsed by default: a tall panel about something most people set up once, sitting
    // between Generate and Update. It opens by itself when a target is already saved — having
    // configured it is the sign you use it.
    const sshToggle = el('repo-ssh-toggle');
    const sshBody = el('repo-ssh-body');
    if (sshToggle && sshBody) {
        const setOpen = (open: boolean) => {
            sshBody.hidden = !open;
            sshToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            sshToggle.classList.toggle('is-open', open);
        };
        setOpen(sshTargetNames().length > 0);
        sshToggle.addEventListener('click', () => setOpen(sshBody.hidden));
    }

    el('repo-ssh-remote-pick')?.addEventListener('click', () => { void openBrowser(); });
    el('repo-ssh-browser-close')?.addEventListener('click', closeBrowser);
    el('repo-ssh-browser')?.addEventListener('click', (e) => {
        // Click on the backdrop only — a click inside the panel must not close it.
        if (e.target === el('repo-ssh-browser')) closeBrowser();
    });
    el('repo-ssh-browser-up')?.addEventListener('click', () => {
        const cut = browsePath.replace(/\/+$/, '').lastIndexOf('/');
        browsePath = cut > 0 ? browsePath.slice(0, cut) : '/';
        void refreshBrowser();
    });
    el('repo-ssh-browser-choose')?.addEventListener('click', () => {
        const input = el<HTMLInputElement>('repo-ssh-remote');
        if (input) input.value = browsePath;
        closeBrowser();
        status(t('repo.ssh.browserPicked').replace('{dir}', browsePath), 'ok');
    });
    // Delegated: the rows are rebuilt on every navigation, so binding per row would leak a
    // listener per directory visited.
    el('repo-ssh-browser-list')?.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement)?.closest('.repo-ssh-browser-row') as HTMLElement | null;
        if (!row || row.dataset.dir !== '1') return;
        browsePath = `${browsePath.replace(/\/+$/, '')}/${row.dataset.name}`;
        void refreshBrowser();
    });

    // Progress, emitted per file by the backend, for both directions.
    //
    // `listen` is read off the global, NEVER imported. Nothing bundles this frontend — the
    // compiled JS is loaded by the webview as plain ES modules — so a bare specifier like
    // '@tauri-apps/api/event' has no import map to resolve it and the browser throws
    // "Failed to resolve module specifier" at parse time, before any .catch can run. That is
    // exactly what took the whole Server Repo screen down: initRepoSsh threw, so initRepo
    // never finished. `withGlobalTauri: true` in tauri.conf.json guarantees the global
    // exists. check-imports.mjs now fails the build on a bare specifier anywhere.
    const listen = (window as any).__TAURI__?.event?.listen as
        | (<T>(e: string, cb: (evt: { payload: T }) => void) => Promise<() => void>)
        | undefined;
    if (listen) {
        void listen<{ done: number; total: number; bytes: number; current: string; direction: string }>(
            'repo-ssh-progress',
            (e) => {
                const { done, total, bytes, current, direction } = e.payload;
                const fill = el('repo-ssh-bar-fill');
                const text = el('repo-ssh-progress-text');
                if (fill && total > 0) fill.style.width = `${Math.round((done / total) * 100)}%`;
                if (text) {
                    text.dataset.done = String(done);
                    const key = direction === 'down' ? 'repo.ssh.downloading' : 'repo.ssh.uploading';
                    text.textContent = t(key)
                        .replace('{done}', String(done))
                        .replace('{total}', String(total))
                        .replace('{file}', current) + ` · ${fmtBytes(bytes)}`;
                }
            },
        );
    }
}

// ── the stored target, for the SUBSCRIBER side ───────────────────────────────
//
// Syncing FROM an SSH repo reuses the whole existing sync screen; it only needs a different
// transport. The URL field carries `ssh://` and nothing else — the host, port, user, folder
// and method come from what is saved here, never from the field, so a link or a scheduled
// task can no more point BMM at an arbitrary machine for reading than it can for writing.

/** The URL-field value that means "use the SSH target saved in this panel". */
export const SSH_SOURCE_URL = 'ssh://';

/** True when a sync URL names an SSH target. */
export const isSshSourceUrl = (url: string): boolean => sshTargetName(url) !== null;

/**
 * A saved target, or null when nothing usable is configured under that name.
 *
 * "Usable" is checked here rather than at the point of use, so a half-filled entry reads as
 * absent instead of failing later with a field-validation message about a panel the caller
 * never opened.
 */
export function storedSshTarget(name = DEFAULT_TARGET): SshTarget | null {
    const saved = loadTarget(name);
    if (!saved.host || !saved.user || !saved.remoteDir) return null;
    if (saved.auth !== 'password' && !saved.keyPath) return null;
    return saved as SshTarget;
}

/** The names of every usable saved target, for a picker. */
export function sshTargetNames(): string[] {
    return Object.keys(loadTargets()).filter((n) => storedSshTarget(n)).sort();
}

/**
 * The secret currently TYPED in the panel, if any.
 *
 * Read from the field at the moment of use, exactly like the publish path — nothing is
 * stored. A password-authenticated source therefore works while the panel is filled in and
 * fails with a clear message from a scheduled task, which is the honest behaviour.
 */
export function currentSshSecret(name = DEFAULT_TARGET): string | null {
    const saved = loadTarget(name);
    const id = saved.auth === 'password' ? 'repo-ssh-pw' : 'repo-ssh-pass';
    return el<HTMLInputElement>(id)?.value || null;
}

// ── headless entry points (deeplink, scheduler, plugin API) ──────────────────

/** The stored target, or a thrown explanation of what is missing. */
function storedTargetOrThrow(name = DEFAULT_TARGET): SshTarget {
    const saved = loadTarget(name);
    if (!saved.host || !saved.user || !saved.remoteDir) {
        throw new Error(t('repo.ssh.needFields'));
    }
    // Password auth cannot run unattended: nothing is stored, and there is nobody to ask.
    // Saying so is the whole point — a task that hangs on an invisible prompt looks like a
    // task that ran and did nothing.
    if (saved.auth === 'password') throw new Error(t('repo.ssh.errHeadlessPassword'));
    if (!saved.keyPath) throw new Error(t('repo.ssh.needFields'));
    return saved as SshTarget;
}

/** Publish with the STORED target, no UI. See the note above about passphrases. */
/**
 * Transfer using a target and secret handed in, rather than one read from storage.
 *
 * `publishStoredTarget` / `pullStoredTarget` refuse a password target outright: nothing about
 * a password is stored, so a scheduled run has nobody to ask. That refusal is right for the
 * scheduler and wrong for a person sitting in front of the update dialog, who can simply type
 * it. These two exist for that case — the caller has the secret in hand and passes it.
 */
export async function publishWithTarget(localDir: string, target: SshTarget, secret: string | null): Promise<number> {
    return (await invoke('ssh_upload_repo', { target, secret, localDir })) as number;
}
export async function pullWithTarget(localDir: string, target: SshTarget, secret: string | null): Promise<number> {
    return (await invoke('ssh_download_repo', { target, secret, localDir })) as number;
}

export async function publishStoredTarget(localDir: string, name = DEFAULT_TARGET): Promise<number> {
    return (await invoke('ssh_upload_repo', {
        target: storedTargetOrThrow(name),
        secret: null,
        localDir,
    })) as number;
}

/** Pull with the STORED target, no UI. */
export async function pullStoredTarget(localDir: string, name = DEFAULT_TARGET): Promise<number> {
    return (await invoke('ssh_download_repo', {
        target: storedTargetOrThrow(name),
        secret: null,
        localDir,
    })) as number;
}

/**
 * An SSH error code from the backend, as a sentence.
 *
 * The backend reports failures as i18n KEYS, sometimes with `|`-separated detail. t() returns
 * the key itself on a miss, so printing String(e) puts `repo.ssh.errAuthRejected` in front of
 * the user — which is what the sync panel used to do before it grew its own explain().
 *
 * It lives HERE rather than in repo.ts because it is about SSH, and because anything else
 * wanting to report an SSH failure could otherwise only import repo.ts (a cycle) or write a
 * second copy — which is exactly how the sync panel got one.
 */
export function explainSsh(raw: string): string {
    const [key, ...rest] = String(raw).split('|');
    const msg = t(key);
    // t() returning the key unchanged means there is no translation; the raw text is then more
    // use than the key name.
    const base = msg === key ? raw : msg;
    return rest.length ? `${base} — ${rest.join(' ')}` : base;
}

/**
 * Put a "Publish over SSH" button on any card that can name a repo folder.
 *
 * `dirHint` is read at CLICK time, never at mount time: the folder is usually chosen after
 * the card is built, and capturing it early gives a button that publishes the wrong place or
 * nothing at all.
 *
 * Hidden entirely when no target is configured. A button that can only produce "no SSH target
 * set" is an invitation to an error message.
 */
export function mountPublishButton(host: HTMLElement | null, dirHint: () => string): void {
    if (!host || host.querySelector('.repo-ssh-mount-btn')) return;
    if (!sshTargetNames().length) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm repo-ssh-mount-btn';
    btn.style.cssText = 'width:100%;justify-content:center;margin-top:8px;';
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
        </svg><span>${escHtml(t('repo.ssh.publishHere') || 'Publish over SSH')}</span>`;
    host.appendChild(btn);

    btn.addEventListener('click', async () => {
        const dir = (dirHint() || '').trim();
        if (!dir) { toast(t('repo.ssh.publishNoDir'), 'warning', 7000); return; }
        const names = sshTargetNames();
        if (!names.length) { toast(t('repo.sync.useSshNotSet'), 'warning', 7000); return; }
        const target = names[0];
        // The same confirm the update dialog asks, and for the same reason: this overwrites
        // what people are downloading right now. Naming the target rather than asking "are
        // you sure" — with several configured, WHICH one is the question worth answering.
        const ok = await (window as any).confirmCustom?.(
            t('repo.update.publishTitle'),
            (t('repo.update.publishMsg') || '').replace('{name}', target),
            'warning',
        ).catch(() => false);
        if (!ok) return;
        btn.disabled = true;
        try {
            const n = await publishStoredTarget(dir, target);
            toast((t('repo.update.published') || '').replace('{n}', String(n)), 'success', 6000);
        } catch (e) {
            toast(explainSsh(String(e)), 'error', 9000);
        } finally {
            btn.disabled = false;
        }
    });
}

/** Does a usable headless target exist? Used to enable/disable the scheduler action. */
export function hasHeadlessSshTarget(name = DEFAULT_TARGET): boolean {
    try { storedTargetOrThrow(name); return true; } catch { return false; }
}
