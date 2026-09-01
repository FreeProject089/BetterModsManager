// One way to read a remote source, whatever it is reached over.
//
// Catalogs — app, plugin, theme, preset — are each fetched from their own module, and every
// one of them called `fetch_remote_json` with a URL. That was fine while a URL could only be
// http(s). Now that a source can live on a server reachable only over SSH, the choice of
// transport has to be made SOMEWHERE, and making it in four places is how three of them end
// up disagreeing.
//
// So it is made here, once. `ssh://<name>/<path>` reads over SFTP using the target saved
// under that name; anything else goes through `fetch_remote_json` exactly as before,
// including its cache-busting, its real HTTP status reporting and its CORS-free path through
// the Rust side.

import { invoke } from './api.js';

/**
 * Read a source as text.
 *
 * `quiet` is passed through to `invoke` for the http path, where a probe that is expected to
 * fail (checking whether a catalog exists at a guessed URL) should not shout in the console.
 */
export async function fetchSourceText(url: string, quiet = false): Promise<string> {
    // A LOCAL file — a `file://` URL or an absolute filesystem path from the file picker — is read
    // from disk through the hardened `read_file_text` command. This is why importing a catalog
    // "via File" works: it used to fall through to `fetch_remote_json`, which accepts only http(s),
    // so a picked path was rejected. Handling it HERE fixes it once for every catalog type that
    // reaches this single reader (app / plugin / theme / preset / index), consistently. Zip-shaped
    // mod lists take their own import path (`import_modlist`) and never arrive here.
    const local = localPathOf(url);
    if (local !== null) return await invoke('read_file_text', { path: local }) as string;

    // Loaded lazily: this module sits in core/ and the SSH panel is a repo feature. A static
    // import would drag the panel into the boot path of anything that reads a catalog.
    const m = await import('../features/repo/repo-ssh.js');
    const src = m.parseSshSource(url);
    if (!src) return await fetchHttp(url, quiet);

    const target = m.storedSshTarget(src.name);
    if (!target) {
        // Named, but nothing saved under that name. Say which name, because the whole point
        // of names is that there can be several and only one of them is wrong.
        throw new Error(`repo.ssh.errNoSuchTarget|${src.name}`);
    }
    return await invoke('ssh_read_text', {
        target,
        secret: m.currentSshSecret(src.name),
        path: src.path,
    }) as string;
}

// ── download passwords, for the session only ────────────────────────────────
//
// A protected source answers 401, the user is asked once, and the answer is remembered for
// as long as the app runs — never written to disk, which is the same rule the SSH panel
// follows and for the same reason: settings end up in backups and crash reports.
//
// Keyed by origin + path, with the query string dropped: catalog URLs carry a cache-busting
// `?t=` that changes on every fetch, so keying by the whole URL would ask for the password
// again every single time.
const _sessionPasswords: Record<string, string> = {};

function passwordKey(url: string): string {
    try { const u = new URL(url); return u.origin + u.pathname; } catch { return url.split('?')[0]; }
}

/**
 * The passwords this run knows, keyed by origin.
 *
 * Exposed for one caller: exporting a mod list that carries credentials for the sources it
 * names. Keyed by ORIGIN rather than by the origin+path used internally, because what
 * travels is "the password for this host" — a path from the exporter's machine means
 * nothing on the machine that opens the list.
 *
 * Only what was typed since launch. Nothing is stored, so nothing older can be offered, and
 * the export screen says so rather than letting somebody assume otherwise.
 */
export function knownSourcePasswords(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, pw] of Object.entries(_sessionPasswords)) {
        try { out[new URL(key).origin] = pw; } catch { /* not a URL: not an origin */ }
    }
    return out;
}

/** Remember a password for a source, for this run only. */
export function rememberSourcePassword(url: string, password: string): void {
    _sessionPasswords[passwordKey(url)] = password;
}

async function fetchHttp(url: string, quiet: boolean): Promise<string> {
    const key = passwordKey(url);
    const known = _sessionPasswords[key] ?? null;
    try {
        return await invoke('fetch_remote_json', { url, password: known }, { quiet }) as string;
    } catch (e) {
        // The one code both fetch_repo_info and fetch_remote_json return for this, so there
        // is a single rule rather than one per transport.
        if (String((e as Error)?.message ?? e) !== 'repo.errPasswordRequired') throw e;
        // ui/ask-one, not features/repo/repo-sync: the dialog is the app's one-field box, and
        // importing the repo feature to reach it pulled ui/app + profiles + mod-updates into
        // a cycle with core — seven of them, through this single line.
        const { promptRepoPassword } = await import('../ui/ask-one.js');
        const pw = await promptRepoPassword();
        // Cancelled: re-throw the original, so the caller's normal error path runs and the
        // user is not told something different from what actually happened.
        if (pw == null) throw e;
        _sessionPasswords[key] = pw;
        return await invoke('fetch_remote_json', { url, password: pw }, { quiet }) as string;
    }
}

/**
 * A local filesystem path for this source, or null if it is a remote (http/https/ssh) URL.
 *
 * Recognises a `file://` URL (mapped back to a path, incl. the Windows `/C:/…` form) and bare
 * absolute paths as a file picker returns them: a Windows drive (`C:\…`), a UNC share (`\\…`),
 * or a POSIX absolute path (`/…`, but not the protocol-relative `//host`). Anything with an
 * http(s)/ssh scheme is remote and returns null so it keeps its existing transport.
 */
function localPathOf(u: string): string | null {
    if (/^file:\/\//i.test(u)) {
        try { return decodeURIComponent(new URL(u).pathname).replace(/^\/([a-zA-Z]:)/, '$1'); } catch { return null; }
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return null; // http(s)://, ssh://, any scheme → remote
    if (/^[a-zA-Z]:[\\/]/.test(u) || /^\\\\/.test(u)) return u; // Windows drive or UNC
    if (u.startsWith('/') && !u.startsWith('//')) return u;     // POSIX absolute (not protocol-relative)
    return null;
}

/** True when this source is read over SSH rather than HTTP. */
export async function isSshSource(url: string): Promise<boolean> {
    const m = await import('../features/repo/repo-ssh.js');
    return m.parseSshSource(url) !== null;
}
