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

/**
 * Save (or replace) a named target. The secret is never part of what gets written.
 *
 * Exported because the “this repo is on an SSH machine” block needs to create one from
 * inside a modal, where the card that owns this panel is behind an overlay and unreachable.
 * The EDITOR can live in two places; the STORE must not, which is why this is the only
 * function that writes it.
 */
export function saveTarget(target: SshTarget, name = DEFAULT_TARGET): void {
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


// ── auth method ──────────────────────────────────────────────────────────────

let authMethod: AuthMethod = 'key';





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


// ── connection test ──────────────────────────────────────────────────────────


// ── transfers ────────────────────────────────────────────────────────────────





// ── remote folder picker ─────────────────────────────────────────────────────
//
// The reason this exists: an absolute remote path typed from memory is the single most
// common way this panel failed. `/var/www/repo` when the account lands in `/home/you`, a
// trailing slash, a capital letter on a case-sensitive filesystem — and the connection test
// then says "not writable", which sends people looking at permissions for a path that was
// never there.

let browsePath = '';









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


/** Does a usable headless target exist? Used to enable/disable the scheduler action. */
export function hasHeadlessSshTarget(name = DEFAULT_TARGET): boolean {
    try { storedTargetOrThrow(name); return true; } catch { return false; }
}
