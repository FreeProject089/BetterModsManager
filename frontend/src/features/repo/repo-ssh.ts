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

type AuthMethod = 'key' | 'password';

interface SshTarget {
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
    entries: number;
}

interface RemoteEntry {
    name: string;
    isDir: boolean;
    size: number;
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

/** Where the settings live. Host/user/folder/key PATH/method — never a secret. */
const STORE = 'bmm.repo.ssh';

function loadTarget(): Partial<SshTarget> {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
}

function saveTarget(target: SshTarget): void {
    // The passphrase and password are deliberately absent from what gets written.
    try { localStorage.setItem(STORE, JSON.stringify(target)); } catch { /* storage full */ }
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
        saveTarget(form.target);
        el('repo-ssh-forget')!.hidden = false;
        if (!r.remoteDirExists) {
            status(t('repo.ssh.testNoDir').replace('{dir}', form.target.remoteDir), 'warn');
        } else if (!r.writable) {
            // The failure worth catching here: the upload version of it fails after
            // transferring everything.
            status(t('repo.ssh.testNotWritable').replace('{dir}', form.target.remoteDir), 'err');
        } else {
            status(t('repo.ssh.testOkWritable'), 'ok');
        }
        toast(t('repo.ssh.testOk').replace('{fp}', r.fingerprint), 'success', 6000);
    } catch (e) {
        status(explain(e), 'err');
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
        saveTarget(form.target);
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
        saveTarget(form.target);
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

/** Wire the panel. Idempotent — a second call attaches nothing twice. */
export function initRepoSsh(): void {
    const card = el('repo-ssh-card');
    if (!card || card.dataset.bound) return;
    card.dataset.bound = '1';

    const saved = loadTarget();
    const set = (id: string, v: unknown) => {
        const input = el<HTMLInputElement>(id);
        if (input && v != null && v !== '') input.value = String(v);
    };
    set('repo-ssh-host', saved.host);
    set('repo-ssh-port', saved.port);
    set('repo-ssh-user', saved.user);
    set('repo-ssh-key', saved.keyPath);
    set('repo-ssh-remote', saved.remoteDir);
    applyAuthMethod(saved.auth === 'password' ? 'password' : 'key');
    if (saved.host) el('repo-ssh-forget')!.hidden = false;

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
    const overlay = el('repo-ssh-browser');
    if (overlay && overlay.parentElement !== document.body) document.body.appendChild(overlay);

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

// ── headless entry points (deeplink, scheduler, plugin API) ──────────────────

/** The stored target, or a thrown explanation of what is missing. */
function storedTargetOrThrow(): SshTarget {
    const saved = loadTarget();
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
export async function publishStoredTarget(localDir: string): Promise<number> {
    return (await invoke('ssh_upload_repo', {
        target: storedTargetOrThrow(),
        secret: null,
        localDir,
    })) as number;
}

/** Pull with the STORED target, no UI. */
export async function pullStoredTarget(localDir: string): Promise<number> {
    return (await invoke('ssh_download_repo', {
        target: storedTargetOrThrow(),
        secret: null,
        localDir,
    })) as number;
}

/** Does a usable headless target exist? Used to enable/disable the scheduler action. */
export function hasHeadlessSshTarget(): boolean {
    try { storedTargetOrThrow(); return true; } catch { return false; }
}
