// bc-v2.ts — this session's BetterCommunity mode, and the v2 account (BMM 1.0.4).
//
// THE SWITCH. app.cfg (`BCApiVersion`, `BCv2Base`) > links.json (`bc_api`, `bc_v2_base`) > v1.
// links.json is the platform asset fetched at every start, so the day v2 goes live the owner sets
// `bc_api: "v2"` there and installed copies follow without a new release. Rust decides
// (bc_v2.rs `bc_v2_activate`): it applies the same precedence, then checks `GET /v2/health`; a v2
// that does not answer leaves the session on v1, logged. The webview only records the answer
// (links-config `setBcSession`); until it arrives, the session is v1.
//
// THE ACCOUNT. In v2 mode, signing in is the OAuth device flow (bc_v2_auth.rs): Rust keeps the
// tokens, sealed like BMM's other secrets, and never hands them over. The v1 account link
// (core/bc-link.ts) is untouched and keeps working in v1 mode.
//
// NOTHING HERE TOASTS (same rule as bc-link.ts): callers say what happened.
import { invoke } from './api.js';
import { getLinks, bcSwitchCfg, setBcSession } from './links-config.js';
import { pickSwitch } from './bc-endpoints.js';

export interface BcSession {
    activated: boolean;
    version: 'v1' | 'v2';
    requested: string;
    source: string;
    v2_root: string;
    fell_back: boolean;
    reason: string;
    client_id: string;
    app_key: string;
    app_id: string;
}

let _session: BcSession = {
    activated: false, version: 'v1', requested: 'v1', source: 'default', v2_root: '', fell_back: false, reason: '', client_id: '', app_key: '', app_id: '',
};
let _pending: Promise<BcSession> | null = null;

/** The session as Rust decided it (v1 until activateBcV2 resolved). */
export function bcSession(): Readonly<BcSession> { return _session; }

/** Decide this session's mode. Call once, after loadLinks(). Never throws; never blocks start-up
 *  for long (the health check is time-boxed in Rust). Fires `bmm:bc-session` on window. */
export function activateBcV2(): Promise<BcSession> {
    if (_pending) return _pending;
    _pending = (async () => {
        const links = getLinks() as unknown as Record<string, unknown>;
        const cfg = bcSwitchCfg();
        const str = (k: string): string => String(links[k] ?? '').trim();
        const asked = pickSwitch({ cfgSet: cfg.set, cfgVersion: cfg.version, cfgBase: cfg.base, linksVersion: str('bc_api'), linksBase: str('bc_v2_base') });
        try {
            const rt = await invoke('bc_v2_activate', {
                linksApi: str('bc_api') || null, linksBase: str('bc_v2_base') || null,
                clientId: str('bc_v2_client_id') || null, appKey: str('bc_v2_app_key') || null, appId: str('bc_v2_app_id') || null,
            }, { quiet: true }) as BcSession;
            if (rt && (rt.version === 'v1' || rt.version === 'v2')) _session = { ...rt };
        } catch {
            // An older backend or no bridge: v1, whatever was asked.
            _session = { ..._session, activated: true, requested: asked.version, source: asked.source, fell_back: asked.version === 'v2', reason: 'no_backend' };
        }
        setBcSession(_session.version, _session.v2_root);
        if (_session.fell_back) console.warn(`[BMM] BetterCommunity v2 asked by ${_session.source} but not usable (${_session.reason}): this session stays on v1`);
        console.log(`[BMM] BetterCommunity mode: ${_session.version}${_session.v2_root ? ` (${_session.v2_root})` : ''}`);
        try { window.dispatchEvent(new CustomEvent('bmm:bc-session', { detail: { ..._session } })); } catch { /* not in a window */ }
        return _session;
    })();
    return _pending;
}

// ── The v2 account ─────────────────────────────────────────────────────────────────────────

export interface BcV2Account {
    signed_in: boolean;
    v2: boolean;
    here?: boolean;
    name?: string;
    handle?: string;
    scope?: string;
    expired?: boolean;
    /** dpapi · keyring · memory (this run only). */
    storage?: string;
}

export async function bcV2Account(): Promise<BcV2Account> {
    try { return await invoke('bc_v2_auth_status', {}, { quiet: true }) as BcV2Account; }
    catch { return { signed_in: false, v2: false }; }
}

/** Signed in, to this session's v2 root, in v2 mode. */
export async function bcV2SignedIn(): Promise<boolean> {
    if (_session.version !== 'v2') return false;
    const a = await bcV2Account();
    return !!(a.signed_in && a.here);
}

export function bcV2DeviceStart(): Promise<any> { return invoke('bc_v2_device_start', {}, { quiet: true }); }
export function bcV2DevicePoll(): Promise<any> { return invoke('bc_v2_device_poll', {}, { quiet: true }); }
export function bcV2DeviceCancel(): void { void invoke('bc_v2_device_cancel', {}, { quiet: true }).catch(() => {}); }
export function bcV2SignOut(): Promise<any> { return invoke('bc_v2_sign_out', {}, { quiet: true }); }
/** Refresh the access token if it is about to expire (before a Laya suggest). */
export async function bcV2EnsureToken(): Promise<boolean> {
    try { return !!(await invoke('bc_v2_ensure_token', {}, { quiet: true })); } catch { return false; }
}
