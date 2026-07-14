/**
 * Central link registry — all external URLs live in links.json.
 *
 * Load order (first success wins, rest skipped):
 *   1. BCWEB_LINKS_URL   — links.json hosted on BetterCommunity (edit from the admin panel)
 *   2. REMOTE_LINKS_URL  — the copy on GitHub (fallback if BCWEB is down)
 *   3. assets/links.json — local bundled fallback (offline)
 *   4. Built-in DEFAULTS — hardcoded last resort
 *
 * BCWEB is authoritative: edit links.json under Admin → Downloads & assets and every app
 * picks it up with no recompile. GitHub + the local bundle only matter if BCWEB is
 * unreachable. Set a URL to '' to skip that source.
 */

// ── BCWEB-hosted links.json (primary; served at /api/assets/links.json) ─────
const BCWEB_LINKS_URL = 'https://bettercommunity.ch/api/assets/links.json';

// ── GitHub copy (fallback if BCWEB is unreachable) ─────────────────────────
const REMOTE_LINKS_URL = 'https://raw.githubusercontent.com/FreeProject089/BetterModsManager/refs/heads/Tdev/frontend/assets/links.json';

// ── Local fallback path (relative, served by Tauri) ────────────────────────
const LOCAL_LINKS_PATH = 'assets/links.json';

export interface BmmLinks {
    // Data sources (fetched by backend/frontend)
    plugin_catalog:   string;
    plugin_github:    string;
    server_browse:    string;
    contributors:     string;
    autoupdate_api:   string;
    apps_catalog:     string;
    // Telemetry (opt-in). HTTPS PostHog-compatible capture endpoint + PUBLIC key.
    // `analytics_key` is a PUBLIC ingest key — it ships inside the app and only
    // permits submitting telemetry. The PRIVATE admin key (deletion approvals,
    // goal writes) lives ONLY on the telemetry server (ADMIN_KEY) and is never
    // shipped here. Empty endpoint = events stay buffered locally (no network).
    analytics_endpoint: string;
    analytics_key:      string;   // public ingest key (bmm_pk_…)
    // Community / social links (patched into HTML at runtime)
    github_repo:      string;
    discord:          string;
    reddit:           string;
    kofi:             string;
    kofi_community:   string;
    ed_forum:         string;
    bettercommunity:  string;
}

const DEFAULTS: BmmLinks = {
    plugin_catalog:   'https://raw.githubusercontent.com/BetterDCS/BetterModsManager_Plugins/main/catalog.json',
    plugin_github:    'https://github.com/BetterDCS/BetterModsManager_Plugins',
    server_browse:    'https://bettercommunity.ch/api/repos.json',
    contributors:     'https://bettercommunity.ch/api/assets/contributors.json',
    autoupdate_api:   'https://api.github.com/repos/FreeProject089/BetterModsManager/releases',
    apps_catalog:     'https://raw.githubusercontent.com/BetterDCS/BMM_App_Catalogue/main/catalog.json',
    // Telemetry: production collector (MUST be HTTPS — BMM refuses plain HTTP, so the
    // old localhost dev default only worked in test builds). For LOCAL testing, override
    // via a hosted links.json or an HTTPS tunnel (ngrok/cloudflared) ending in "/batch/".
    // Empty = buffer locally only.
    analytics_endpoint: 'https://telemetry.bettercommunity.ch/batch/',   // production collector — MUST end with /batch/
    analytics_key:      'bmm_pk_3aab75ffc7b964990178682c918f117767ba2657',   // PUBLIC ingest key — safe to ship
    github_repo:      'https://github.com/FreeProject089/BetterModsManager',
    discord:          'https://discord.com/invite/CTaaEF9R75',
    reddit:           'https://www.reddit.com/r/BetterModManager/',
    kofi:             'https://ko-fi.com/I2I31ZIPPG',
    kofi_community:   'https://ko-fi.com/bettercommunity',
    ed_forum:         'https://forum.dcs.world/topic/385941-better-modmanager/',
    bettercommunity:  'https://bettercommunity.ch/',
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

    let source = 'built-in defaults';

    // Try each source in priority order; first success wins.
    const sources: Array<[string, string]> = [
        [BCWEB_LINKS_URL,  `BCWEB (${BCWEB_LINKS_URL})`],
        [REMOTE_LINKS_URL, `GitHub (${REMOTE_LINKS_URL})`],
        [LOCAL_LINKS_PATH, `local file (${LOCAL_LINKS_PATH})`],
    ];
    for (const [url, label] of sources) {
        if (!url) continue;
        const data = await tryFetch(url);
        if (data) {
            _links = data;
            source = label;
            break;
        }
    }

    console.log(`[BMM] links.json source: ${source}`);
    _loaded = true;
}

/** Returns the cached links (call loadLinks() first at app startup). */
export function getLinks(): Readonly<BmmLinks> {
    return _links;
}

// ── BetterCommunity base resolution (blog / community / account link) ──────────
// Test mode + base URL come from app.cfg (BCTestMode / BCTestBase), read once at
// startup via the get_bc_config Tauri command. When test mode is OFF, everything uses
// the production `bettercommunity` link above. The base URL may include a port or not.
let _bcTestMode = false;
let _bcTestBase = 'http://localhost:5176';
let _bcLoaded = false;

export async function loadBcConfig(): Promise<void> {
    if (_bcLoaded) return;
    try {
        const { invoke } = await import('./api.js');
        const cfg = await invoke('get_bc_config') as { testMode?: boolean; test_mode?: boolean; baseUrl?: string; base_url?: string };
        if (cfg) {
            _bcTestMode = !!(cfg.testMode ?? cfg.test_mode);
            const base = cfg.baseUrl ?? cfg.base_url;
            if (base && base.trim()) _bcTestBase = base.trim();
        }
        console.log(`[BMM] BC config: testMode=${_bcTestMode}, base=${_bcTestBase}`);
    } catch (_) { /* not in Tauri / cfg unreadable → production defaults */ }
    // Mark loaded only AFTER the attempt — never before (a premature call that
    // failed once must not lock the config to defaults forever).
    _bcLoaded = true;
}

/** Whether the in-app BetterCommunity blog/community points at a test/staging base. */
export function bcTestMode(): boolean { return _bcTestMode; }
/** The configured test base URL (with or without a port), trailing slash trimmed. */
export function bcTestBase(): string { return _bcTestBase.replace(/\/+$/, ''); }
/** The effective BetterCommunity root: the test base when test mode is on, else the
 *  production `bettercommunity` link from the loaded links. */
export function bcRoot(): string {
    return (_bcTestMode ? bcTestBase() : (_links.bettercommunity || 'https://bettercommunity.ch/')).replace(/\/+$/, '');
}
