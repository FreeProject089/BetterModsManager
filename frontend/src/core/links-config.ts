/**
 * Central link registry — all external URLs live in links.json.
 *
 * Load order (first success wins, rest skipped):
 *   1. REMOTE_LINKS_URL  — hosted JSON, change links without touching the app
 *   2. assets/links.json — local bundled fallback
 *   3. Built-in DEFAULTS — hardcoded last resort
 *
 * To switch hosting: change REMOTE_LINKS_URL below and recompile once.
 * After that, edit the hosted JSON freely — no recompile needed.
 * Set REMOTE_LINKS_URL to '' to skip remote and always use local/defaults.
 */

// ── Where to fetch links.json remotely (leave empty to disable) ────────────
const REMOTE_LINKS_URL = '';

// ── Local fallback path (relative, served by Tauri) ────────────────────────
const LOCAL_LINKS_PATH = 'assets/links.json';

export interface BmmLinks {
    plugin_catalog:  string;
    plugin_github:   string;
    server_browse:   string;
    contributors:    string;
    autoupdate_api:  string;
}

const DEFAULTS: BmmLinks = {
    plugin_catalog:  'https://raw.githubusercontent.com/BetterDCS/BetterModsManager_Plugins/main/catalog.json',
    plugin_github:   'https://github.com/BetterDCS/BetterModsManager_Plugins',
    server_browse:   'https://raw.githubusercontent.com/BetterDCS/Better_ModManager_ServerBrowse/main/repos.json',
    contributors:    'https://raw.githubusercontent.com/BetterDCS/BMM_Contributors/refs/heads/main/contributors.json',
    autoupdate_api:  'https://api.github.com/repos/FreeProject089/BetterModsManager/releases',
};

let _links: BmmLinks = { ...DEFAULTS };
let _loaded = false;

async function tryFetch(url: string): Promise<BmmLinks | null> {
    try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
            const data = await res.json();
            return { ...DEFAULTS, ...data };
        }
    } catch (_) {}
    return null;
}

export async function loadLinks(): Promise<void> {
    if (_loaded) return;

    // 1. Try remote
    if (REMOTE_LINKS_URL) {
        const data = await tryFetch(REMOTE_LINKS_URL);
        if (data) {
            _links = data;
            console.log('[BMM] links.json loaded from remote:', REMOTE_LINKS_URL);
            _loaded = true;
            return;
        }
        console.warn('[BMM] Remote links.json failed, falling back to local...');
    }

    // 2. Try local bundled file
    const data = await tryFetch(LOCAL_LINKS_PATH);
    if (data) {
        _links = data;
        console.log('[BMM] links.json loaded from local file.');
        _loaded = true;
        return;
    }

    // 3. Built-in defaults
    console.warn('[BMM] Could not load links.json — using built-in defaults.');
    _loaded = true;
}

/** Returns the cached links (call loadLinks() first at app startup). */
export function getLinks(): Readonly<BmmLinks> {
    return _links;
}
