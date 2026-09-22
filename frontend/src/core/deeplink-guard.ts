/**
 * deeplink-guard.ts — what a `bmm://` link may do, and what it must ask first.
 *
 * Any web page can fire a bmm:// link: a page the user merely visits can open one, and the
 * browser does not tell BMM which page it was. So every link is input from a stranger
 * (CWE-352 / CWE-601 / CWE-78 / CWE-22). Before this module, `bmm://app/launch?exe=` ran any
 * local path (a `.ps1` with `-ExecutionPolicy Bypass`), `bmm://data/export-auto?dir=\\host\x`
 * copied the full data file — tokens included — to a network share, and a dozen more routes
 * changed persistent state without a word.
 *
 * Two layers, both decided HERE, before the handler's dispatch runs:
 *
 *   1. HARD LIMITS (`refuse`) — refused whatever the user would answer; the dialog is never
 *      shown. A raw `exe=` path, a script payload, a non-https download, a network or relative
 *      path, a signing key or passphrase carried by a link, an install with no checksum.
 *      The Rust commands the link routes call (`commands/link_guard.rs`) enforce the same
 *      limits again, so a bug here cannot turn into a launch or a write.
 *
 *   2. THE GATE (`prompt`) — anything that changes persistent state, downloads, writes or runs
 *      shows one in-app dialog saying in plain words what will happen, the exact target and
 *      who asked. Cancel is the default. Nothing is applied before the answer.
 *
 * Origins. The handler is also the app's own dispatcher: the scheduler and the local API
 * (both authenticated — a task the user saved, a caller holding the API token) route actions
 * through it. Those are TRUSTED: no dialog (an unattended task would wait for ever), but the
 * limits marked `always` below still apply. Every other origin — the OS (a web page or
 * another program), a theme's button, the deep-link tester, or unknown — asks.
 *
 * Pure (no DOM, no Tauri) so the rules are tested against the compiled module.
 */

export type LinkOrigin = 'external' | 'theme' | 'panel' | 'scheduler' | 'api' | 'self' | 'unknown';

const ORIGINS: readonly LinkOrigin[] = ['external', 'theme', 'panel', 'scheduler', 'api', 'self', 'unknown'];
/** Callers that are the app itself acting for the user. `self` is a link this handler
 *  dispatches to itself AFTER the user already answered for it (catalog/import → follow). */
const TRUSTED: ReadonlySet<LinkOrigin> = new Set<LinkOrigin>(['scheduler', 'api', 'self']);

export function normalizeOrigin(o: unknown): LinkOrigin {
    return (ORIGINS as readonly string[]).includes(String(o)) ? (o as LinkOrigin) : 'unknown';
}
export function isTrustedOrigin(o: LinkOrigin): boolean { return TRUSTED.has(o); }

// ── Hard-limit predicates (mirrored in commands/link_guard.rs) ────────────────────────

/** Why a link-supplied filesystem path is refused, or null. Checked before anything
 *  touches the path: asking Windows whether `\\host\share` exists already sends the user's
 *  NTLM credentials to `host`. */
export function linkPathRefusal(p: string | null | undefined): string | null {
    const s = String(p ?? '').trim();
    if (!s) return 'empty';
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(s)) return 'invalid';
    if (/^[\\/]{2}/.test(s)) return 'network';               // \\host\share, //host, \\?\, \\.\
    if (/:\/\//.test(s) || /^file:/i.test(s)) return 'network';
    if (!/^[A-Za-z]:[\\/]/.test(s)) return 'relative';       // C:foo is relative to drive C
    if (s.slice(2).includes(':')) return 'invalid';          // NTFS alternate data stream
    if (s.split(/[\\/]/).some((seg) => seg === '..')) return 'traversal';
    return null;
}

/** Why a link-supplied download URL is refused, or null. https, a host, no credentials. */
export function linkHttpsRefusal(url: string | null | undefined): string | null {
    const u = String(url ?? '').trim();
    if (!u) return 'missing';
    if (/\s/.test(u)) return 'invalid';
    if (!/^https:\/\//i.test(u)) return 'not-https';
    const authority = u.slice(8).split(/[/?#]/)[0];
    if (!authority) return 'no-host';
    if (authority.includes('@')) return 'credentials';
    return null;
}

export function hostOf(url: string): string {
    try { return new URL(url).host; } catch { return ''; }
}

export function isSha256(s: string | null | undefined): boolean {
    return /^(sha256:)?[0-9a-f]{64}$/i.test(String(s ?? '').trim());
}

/** A payload whose NAME says it is a script. Refused from a link whatever `type` says. */
export function namesScript(url: string): boolean {
    const file = (url.split(/[?#]/)[0].split('/').pop() || '').toLowerCase();
    return /\.(ps1|bat|cmd|vbs|vbe|js|jse|wsf|hta|sh|py|lnk|scr)$/.test(file);
}

/**
 * `catalog/<kind>/<verb>` — EXACTLY three segments, and a kind this app knows.
 *
 * The handler dispatched the two catalogue families on a prefix and a suffix
 * (`action.startsWith('catalog/') && action.endsWith('/install')`) while the switch below
 * matches the action WHOLE. So `bmm://catalog/app/anything/install` was an action the gate
 * did not recognise — admitted with no dialog and no hard limit — and an app install to the
 * handler, which downloaded the link's payload and RAN it (`install_app` launches anything
 * whose name says "setup"/"install", and every `.msi`). The two sides read one link
 * differently, which is the only thing a gate cannot survive.
 *
 * One parser, used on both sides, so they cannot disagree again. An action that is
 * catalogue-shaped and does not parse is refused by `decideLink` rather than let through
 * undecided, and the handler, reading the same parse, dispatches nothing for it either.
 */
export const CATALOG_KINDS: readonly string[] = ['app', 'plugin', 'theme'];

export function catalogRoute(action: string): { kind: string; verb: string } | null {
    const p = action.split('/');
    if (p.length !== 3 || p[0] !== 'catalog' || !CATALOG_KINDS.includes(p[1])) return null;
    return { kind: p[1], verb: p[2] };
}

/** The app-id → folder rule of `link_install_app`. */
export function appIdOk(id: string): boolean {
    return /^[A-Za-z0-9._-]{1,128}$/.test(id) && id !== '.' && id !== '..';
}

export function slugOf(name: string, fallback: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

// ── The decision ─────────────────────────────────────────────────────────────────────

export interface LinkPrompt {
    action: string;
    /** i18n key of the plain-words description (`dlg.do.<…>`). */
    descKey: string;
    /** The exact thing acted on: a path, a URL, an id, a name. */
    target: string;
    targetKind: 'path' | 'url' | 'id' | 'name' | 'data' | 'none';
    /** URL host, shown on its own line so a look-alike cannot hide in a long URL. */
    host?: string;
    danger: boolean;
    /** Extra i18n keys (`dlg.note.<…>`) stating consequences. */
    notes: string[];
    origin: LinkOrigin;
}

export interface LinkDecision {
    /** A hard limit: refused, no dialog. `reason` is a `dlg.why.<reason>` key suffix. */
    refuse?: { reason: string; detail: string };
    /** The dialog to show an untrusted origin. Absent → nothing to ask. */
    prompt?: LinkPrompt;
    /** The parameters the handler may use (some may have been dropped). */
    params: URLSearchParams;
    /** Parameters removed because a link may never set them. */
    dropped: string[];
}

/** Routes that open a screen or a read-only view and change nothing persistent. Listed so
 *  that leaving a route prompt-free is a decision, not an omission. Each one's reason:
 *   plugin/compare, view/open, docs/open, theme/editor — navigation only.
 *   repo/gen, repo/update, repo/host, mod/update — open Server Repo with fields pre-filled;
 *     the user presses the button that acts.
 *   repo/sync — opens sync pre-filled; the fetch reads a remote repo.json and writes
 *     nothing until the user confirms the sync on that screen. (Keys still refused.)
 *   mod/check-updates — a read-only check of the sources already configured.
 *   benchmark/open — opens the benchmark; only runs with mode=auto (then it asks).
 *   catalog/<kind>/install with no url — opens the matching catalogue screen.
 *   telemetry/*, schedule/*, hook, catalog/<kind>/add-source, catalog/delete,
 *   repo/fetch-ssh, install|import|download — carry their OWN in-app dialog already. */
export const PROMPT_FREE: ReadonlySet<string> = new Set([
    'plugin/compare', 'view/open', 'docs/open', 'theme/editor',
    'repo/gen', 'repo/update', 'repo/host', 'mod/update', 'repo/sync', 'mod/check-updates',
    'benchmark/open',
    'telemetry/consent', 'telemetry/set', 'schedule/run', 'schedule/enable', 'hook',
    'catalog/delete', 'repo/fetch-ssh', 'install', 'import', 'download',
]);

/** Routes whose link may carry source credentials (`applySourceAccess`). */
const SOURCE_ACCESS_ROUTES = new Set(['repo/connect', 'repo/sync', 'catalog/follow', 'catalog/import']);

const flagOn = (q: URLSearchParams, k: string): boolean => q.get(k) === '1' || q.get(k) === 'true';

export function decideLink(action: string, input: URLSearchParams, originIn: LinkOrigin): LinkDecision {
    const origin = normalizeOrigin(originIn);
    const trusted = isTrustedOrigin(origin);
    const params = new URLSearchParams(input);
    const dropped: string[] = [];
    const refuse = (reason: string, detail = ''): LinkDecision => ({ refuse: { reason, detail }, params, dropped });
    const ask = (descKey: string, target: string, targetKind: LinkPrompt['targetKind'], extra: Partial<LinkPrompt> = {}): LinkDecision => (
        trusted ? { params, dropped } : {
            params, dropped,
            prompt: { action, descKey, target, targetKind, danger: false, notes: [], origin, ...extra },
        });
    const get = (k: string) => (params.get(k) || '').trim();

    // ── Limits that hold for every origin ──────────────────────────────────────────
    // Unmasked local recording is never switched on by a link, whoever sends it — the same
    // rule telemetry-link.ts applies to `full=1` on telemetry.
    if (action === 'recorder/set' && params.has('full') && flagOn(params, 'full')) {
        params.delete('full'); dropped.push('full');
    }
    // A link never carries a program path. The route launches what BMM registered, by id.
    if (action === 'app/launch' && params.has('exe')) return refuse('exe-param', params.get('exe') || '');
    // A catalogue-shaped action the handler would still dispatch on its prefix, but that the
    // switch below does not know whole. Refused rather than admitted undecided: an action
    // nobody here recognised must not reach a route that recognises it. (`catalog/follow`,
    // `catalog/entry`, `catalog/delete`, `catalog/publish` are two segments and unaffected.)
    if (action.startsWith('catalog/') && action.split('/').length > 2 && !catalogRoute(action)) {
        return refuse('unknown-action', action);
    }

    // ── Limits for untrusted origins ───────────────────────────────────────────────
    if (!trusted && SOURCE_ACCESS_ROUTES.has(action) && (params.has('key') || params.has('passphrase'))) {
        // Binding a signing key to an origin — and unlocking it — happens in Settings only.
        return refuse('key-from-link', get('key'));
    }

    switch (action) {
        // ── Critical ──────────────────────────────────────────────────────────────
        case 'app/launch': {
            const id = get('id');
            if (!id) return refuse('missing', 'id');
            return ask('dlg.do.appLaunch', id, 'id', { danger: true });
        }
        case 'app/install':
        case 'catalog/app/install': {
            const url = get('url');
            if (action === 'catalog/app/install' && !url) return { params, dropped };   // opens Apps
            const why = linkHttpsRefusal(url);
            if (why) return refuse(why, url);
            const id = action === 'app/install' ? get('id') : slugOf(get('name') || 'app', 'app');
            if (!appIdOk(id)) return refuse('bad-id', id);
            const type = (get('type') || 'exe').toLowerCase();
            if (!['exe', 'msi', 'zip'].includes(type) || namesScript(url)) return refuse('script', url);
            if (!isSha256(get('sha256'))) return refuse('no-checksum', url);
            const path = get('path');
            if (path) {
                const pw = linkPathRefusal(path);
                if (pw) return refuse(pw, path);
            }
            return ask('dlg.do.appInstall', url, 'url', {
                host: hostOf(url), danger: true,
                notes: ['dlg.note.checksum', ...(path && !trusted ? ['dlg.note.picker'] : [])],
            });
        }

        // ── High ──────────────────────────────────────────────────────────────────
        case 'data/export-auto': {
            const dir = get('dir');
            if (!trusted) {
                if (dir) { const pw = linkPathRefusal(dir); if (pw) return refuse(pw, dir); }
                return ask('dlg.do.dataExport', dir || '—', 'path', { danger: true, notes: ['dlg.note.redacted', 'dlg.note.picker'] });
            }
            return { params, dropped };
        }
        case 'catalog/plugin/install': {
            const url = get('url');
            if (!url) return { params, dropped };
            const why = linkHttpsRefusal(url);
            if (why) return refuse(why, url);
            const sha = get('sha256');
            if (sha && !isSha256(sha)) return refuse('bad-checksum', sha);
            return ask('dlg.do.pluginInstall', get('name') ? `${get('name')} — ${url}` : url, 'url', {
                host: hostOf(url), danger: true,
                notes: [sha ? 'dlg.note.checksum' : 'dlg.note.unverified', 'dlg.note.pluginDisabled'],
            });
        }
        case 'catalog/theme/install':
        case 'theme/import': {
            const url = get('url');
            if (!url) return { params, dropped };
            const why = linkHttpsRefusal(url);
            if (why) return refuse(why, url);
            return ask('dlg.do.themeInstall', url, 'url', { host: hostOf(url) });
        }
        case 'replay/export': {
            const path = get('path');
            if (!trusted) {
                if (path) { const pw = linkPathRefusal(path); if (pw) return refuse(pw, path); params.delete('path'); dropped.push('path'); }
                return ask('dlg.do.replayExport', path || '—', 'path', { notes: ['dlg.note.saveDialog'] });
            }
            return { params, dropped };
        }

        // ── Medium ────────────────────────────────────────────────────────────────
        case 'recorder/set': {
            const parts = ['on', 'rust', 'js', 'full'].filter((k) => params.has(k)).map((k) => `${k}=${params.get(k)}`);
            if (!parts.length) return { params, dropped };
            return ask('dlg.do.recorder', parts.join(' · '), 'data', { notes: dropped.includes('full') ? ['dlg.note.fullDropped'] : [] });
        }
        case 'discord/rpc': {
            const on = flagOn(params, 'enabled');
            return ask(on ? 'dlg.do.rpcOn' : 'dlg.do.rpcOff', on ? 'enabled=1' : 'enabled=0', 'data', { notes: on ? ['dlg.note.rpcPublic'] : [] });
        }
        case 'launchpack/run': {
            const id = get('id');
            if (!id) return refuse('missing', 'id');
            return ask('dlg.do.launchpack', id, 'id', { danger: true });
        }
        case 'plugin/delete': {
            const id = get('id');
            if (!id) return refuse('missing', 'id');
            return ask('dlg.do.pluginDelete', id, 'id', { danger: true });
        }
        case 'plugin/activate': {
            const id = get('id');
            if (!id) return refuse('missing', 'id');
            return ask('dlg.do.pluginActivate', id, 'id');
        }
        case 'repo/publish-ssh':
        case 'catalog/publish': {
            const dir = get('dir');
            if (!dir) return action === 'catalog/publish' ? { params, dropped } : refuse('missing', 'dir');
            const pw = linkPathRefusal(dir);
            if (pw) return refuse(pw, dir);
            return ask(action === 'repo/publish-ssh' ? 'dlg.do.publishSsh' : 'dlg.do.catalogPublish', dir, 'path', {
                danger: action === 'repo/publish-ssh', notes: ['dlg.note.picker'],
            });
        }
        case 'catalog/follow':
        case 'catalog/unfollow':
        case 'catalog/import': {
            const url = get('url');
            if (action !== 'catalog/unfollow' && !trusted) {
                const why = linkHttpsRefusal(url);
                if (why) return refuse(why, url);
            }
            return ask(action === 'catalog/unfollow' ? 'dlg.do.unfollow' : 'dlg.do.follow', url, 'url', {
                host: hostOf(url), notes: action === 'catalog/unfollow' ? [] : ['dlg.note.fetchedOnStart'],
            });
        }
        case 'repo/connect': {
            // http stays allowed, as before: self-hosted repos on a LAN are often plain http,
            // and this route only adds a source the user then syncs from its own screen.
            // Nothing is applied — password included — until the dialog is answered.
            const url = get('url');
            if (!url) return refuse('missing', 'url');
            if (!/^https?:\/\/[^/?#@\s]+/i.test(url)) return refuse('bad-scheme', url);
            return ask('dlg.do.repoConnect', url, 'url', { host: hostOf(url), notes: /^http:/i.test(url) ? ['dlg.note.plainHttp'] : [] });
        }
        case 'language/import-inline':
            return ask('dlg.do.langInline', get('code') || 'custom', 'name');
        case 'theme/import-inline':
            return ask('dlg.do.themeInline', `${(params.get('data') || '').length} chars`, 'data');
        case 'language/import': {
            const path = get('path');
            if (!path) return { params, dropped };        // opens a file picker; nothing is read until the user picks
            const pw = linkPathRefusal(path);
            if (pw) return refuse(pw, path);
            return ask('dlg.do.langImport', path, 'path');
        }
        case 'replay/import': {
            const path = get('path');
            const url = get('url');
            if (path) { const pw = linkPathRefusal(path); if (pw) return refuse(pw, path); }
            if (url) { const why = linkHttpsRefusal(url); if (why) return refuse(why, url); }
            if (!path && !url) return { params, dropped };  // opens a file picker
            return ask('dlg.do.replayImport', url || path, url ? 'url' : 'path', url ? { host: hostOf(url) } : {});
        }

        // ── Low ───────────────────────────────────────────────────────────────────
        case 'mod/enable':
        case 'mod/disable':
            return ask(action === 'mod/enable' ? 'dlg.do.modEnable' : 'dlg.do.modDisable', get('id'), 'id');
        case 'modpack/enable':
        case 'modpack/disable':
            return ask(action === 'modpack/enable' ? 'dlg.do.modpackEnable' : 'dlg.do.modpackDisable', get('id'), 'id');
        case 'profile/activate':
            return ask('dlg.do.profileActivate', get('id'), 'id');
        case 'modpack/create':
            return ask('dlg.do.modpackCreate', get('name'), 'name');
        case 'restart':
            return ask('dlg.do.restart', '', 'none');
        case 'catalog/entry':
            return ask('dlg.do.catalogEntry', `${get('mode') || 'add'} ${get('type') || 'app'} ${get('id')}`, 'data');
        case 'settings/navbar':
            return ask('dlg.do.navbar', get('code').slice(0, 80), 'data');
        case 'settings/layout':
            return ask('dlg.do.layout', get('code').slice(0, 80), 'data');
        case 'theme/apply':
            return ask('dlg.do.themeApply', get('id'), 'id');
        case 'api': {
            const method = (get('method') || 'GET').toUpperCase();
            const rest = [...params.entries()].filter(([k]) => k !== 'method' && k !== 'path').map(([k, v]) => `${k}=${v}`).join('&');
            return ask('dlg.do.api', `${method} ${get('path')}${rest ? '\n' + rest : ''}`, 'data', { danger: method !== 'GET' });
        }
        case 'benchmark/run': {
            if ((get('mode') || '').toLowerCase() === 'manual') return { params, dropped };
            return ask('dlg.do.benchmark', `${get('dataset') || 'sandbox'} ${get('size') || 'M'}`, 'data');
        }
        // ── Routes with their OWN dialog: only the hard limits are added here ──────
        case 'repo/fetch-ssh': {
            const dir = get('dir');
            if (dir) { const pw = linkPathRefusal(dir); if (pw) return refuse(pw, dir); }
            return { params, dropped };
        }
        case 'install':
        case 'import':
        case 'download': {
            if (!trusted) { const why = linkHttpsRefusal(get('url')); if (why) return refuse(why, get('url')); }
            return { params, dropped };
        }
        default:
            return { params, dropped };
    }
}

export interface Admitted {
    action: string;
    params: URLSearchParams;
    origin: LinkOrigin;
    trusted: boolean;
    dropped: string[];
}

export interface GateUi {
    /** Show the in-app dialog. Resolve true ONLY when the user pressed the confirm button. */
    confirm(p: LinkPrompt): Promise<boolean>;
    /** A hard limit refused the link. */
    refuse(r: { action: string; reason: string; detail: string; origin: LinkOrigin }): void;
}

/** Parse a `bmm://` URL into its action. */
export function parseLink(urlStr: string): { action: string; params: URLSearchParams } | null {
    if (!urlStr || !/^bmm:\/\//i.test(urlStr)) return null;
    try {
        const u = new URL(urlStr.replace(/^bmm:\/\//i, 'https://bmm.local/'));
        return { action: u.pathname.replace(/^\/|\/$/g, ''), params: u.searchParams };
    } catch { return null; }
}

/**
 * The one gate every link passes before the handler dispatches it. Returns what the handler
 * may act on, or null — in which case the handler must do NOTHING.
 */
export async function admitLink(urlStr: string, originIn: unknown, ui: GateUi): Promise<Admitted | null> {
    const parsed = parseLink(urlStr);
    if (!parsed) return null;
    const origin = normalizeOrigin(originIn);
    const d = decideLink(parsed.action, parsed.params, origin);
    if (d.refuse) {
        ui.refuse({ action: parsed.action, ...d.refuse, origin });
        return null;
    }
    if (d.prompt) {
        let ok = false;
        try { ok = (await ui.confirm(d.prompt)) === true; } catch { ok = false; }
        if (!ok) return null;
    }
    return { action: parsed.action, params: d.params, origin, trusted: isTrustedOrigin(origin), dropped: d.dropped };
}
