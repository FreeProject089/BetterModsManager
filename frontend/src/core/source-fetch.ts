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
    // Loaded lazily: this module sits in core/ and the SSH panel is a repo feature. A static
    // import would drag the panel into the boot path of anything that reads a catalog.
    const m = await import('../features/repo/repo-ssh.js');
    const src = m.parseSshSource(url);
    if (!src) return await invoke('fetch_remote_json', { url }, { quiet }) as string;

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

/** True when this source is read over SSH rather than HTTP. */
export async function isSshSource(url: string): Promise<boolean> {
    const m = await import('../features/repo/repo-ssh.js');
    return m.parseSshSource(url) !== null;
}
