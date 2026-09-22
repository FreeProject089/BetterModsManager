// bc-link.ts — one answer to "is this install linked to a BetterCommunity account", and one
// way to link it.
//
// It was two answers. Settings asked the server (`/link/status`) and showed the account name;
// the feedback dialog asked whether a NOTIFICATIONS API KEY FILE existed on disk and, from
// that, told people their reports would arrive in their dashboard. Those are different
// questions. The key is minted as a convenience when an account is linked, so it survives an
// unlink, it is absent for anyone who linked before it existed or whose mint failed (the
// server treats that as non-fatal on purpose), and it says nothing at all about what the
// server will do with a report. The dialog was confidently wrong in both directions.
//
// So the question lives here once, phrased the way the server answers it, and the link flow
// that fixes a "no" lives beside it instead of only inside the Settings page.
//
// NOTHING HERE TOASTS. This is `core/`, and reaching up into `ui/app.js` for a toast would
// close an import cycle — which the dependency ratchet caught the first time this file was
// written. It is also the better shape: the two callers want different things said. Settings
// wants a toast; the report dialog wants a line inside the panel somebody is already reading.
// So the flow REPORTS what happened and the caller says it.
import { invoke } from './api.js';
import { t } from './i18n.js';
import { bcRoot } from './links-config.js';
import { creatorProofFor } from './canvas-fingerprint.js';

/**
 * Three states, not two.
 *
 * `unknown` is what an unreachable server gets, and it is deliberately NOT folded into
 * `anonymous`. BMM works offline; telling somebody on a train that they are not linked — when
 * what happened is that we could not ask — invites them to go and link an account they already
 * have. The UI says "couldn't check" and behaves cautiously, which is a different sentence
 * from "you are not linked".
 */
export type BcLinkState = {
    state: 'linked' | 'anonymous' | 'unknown';
    displayName?: string;
    discord?: { linked: boolean; username?: string | null };
};

/** What `openAccountLinkFlow` did, for the caller to put into words. */
export type LinkAttempt =
    | { result: 'opened'; code: string }
    | { result: 'already' }
    | { result: 'offline' }
    | { result: 'no-creator' }
    | { result: 'error' };

const TTL_MS = 60_000;
let _cache: { at: number; value: BcLinkState } | null = null;

/** This install's creator id, or '' when there isn't one yet. */
export async function creatorId(): Promise<string> {
    try {
        const id = (await invoke('get_creator_id')) as string;
        return id && id !== '—' ? id : '';
    } catch { return ''; }
}

/**
 * Ask the server. Cached for a minute, because several panels ask on the same screen.
 *
 * Through `bc_api_get` rather than `fetch`: the webview's origin is tauri.localhost, so a
 * direct call to the BCWEB API is cross-origin and dies in the CORS preflight. Rust is not
 * subject to CORS, so the request actually goes out — the same reason every other BC call in
 * this app takes that route.
 */
export async function bcLinkState(force = false): Promise<BcLinkState> {
    if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.value;
    const cid = await creatorId();
    // No creator id at all is not a network problem and not a missing account: there is
    // nothing to link yet, and "anonymous" is the honest answer.
    if (!cid) return remember({ state: 'anonymous' });
    let data: { linked?: boolean; displayName?: string; discord?: { linked: boolean; username?: string | null } } | null = null;
    try {
        const raw = await invoke('bc_api_get',
            { url: `${bcRoot()}/api/link/status?creatorId=${encodeURIComponent(cid)}` },
            { quiet: true }) as string;
        data = JSON.parse(raw);
    } catch { /* offline, tunnelled elsewhere, or down */ }
    if (!data) return remember({ state: 'unknown' });
    if (!data.linked) return remember({ state: 'anonymous' });
    void registerKeyV5();
    return remember({ state: 'linked', displayName: data.displayName, discord: data.discord });
}

/** The origin a proof for BetterCommunity must name. */
function bcAudience(): string {
    try { return new URL(bcRoot()).origin; } catch { return ''; }
}

/**
 * Tell BetterCommunity which v5 key now speaks for this Creator ID.
 *
 * Only for an install whose id is LINKED to an account, and once per active key: the proof
 * carries the rotation chain (the v4 key signing the v5 one) and the hashed fingerprint, and
 * the server pins the chain so a bare v4 proof — which anyone who knows this PC's serials
 * could forge — is refused for this id from then on. Nothing is sent for an unlinked install;
 * see PRIVACY.md §2.1.
 */
async function registerKeyV5(): Promise<void> {
    let kid = '';
    try { kid = String(((await invoke('creator_key_info', {}, { quiet: true })) as { kid?: string })?.kid || ''); } catch { return; }
    if (!kid) return;
    try { if (localStorage.getItem('bc_key_v5') === kid) return; } catch { /* private mode: register again */ }
    const aud = bcAudience();
    if (!aud) return;
    const proof = await creatorProofFor(aud);
    if (!proof.startsWith('bmmc5.')) return;
    try {
        await invoke('bc_api_post', { url: `${bcRoot()}/api/link/upgrade`, body: JSON.stringify({ proof }) }, { quiet: true });
        try { localStorage.setItem('bc_key_v5', kid); } catch { /* private mode */ }
    } catch { /* offline, or an older server without the route — try again next time */ }
}

function remember(value: BcLinkState): BcLinkState {
    _cache = { at: Date.now(), value };
    // Settings' identity card already kept this flag to notice an unlink between launches;
    // writing it here too means every caller feeds the same detector instead of only the one
    // screen that happens to be open.
    try { if (value.state !== 'unknown') localStorage.setItem('bc_linked', value.state === 'linked' ? '1' : '0'); } catch { /* private mode */ }
    return value;
}

/** Drop the cache — call after a link completes so the next read is the new truth. */
export function forgetBcLinkState(): void { _cache = null; }

/**
 * Start the pairing flow: ask the server for a code, then show it.
 *
 * Lives here rather than in Settings because it is the fix for every "you are not linked" the
 * app shows, and a fix the user has to go and find somewhere else is one they mostly do not.
 *
 * `onLinked` fires when the code is actually accepted on the website — see the poll in
 * `showLinkCodeModal`, which is the part that was missing.
 */
export async function openAccountLinkFlow(onLinked?: (st: BcLinkState) => void): Promise<LinkAttempt> {
    const cid = await creatorId();
    if (!cid) return { result: 'no-creator' };
    const base = bcRoot();
    let data: { linked?: boolean; code?: string } | undefined;
    try {
        const raw = await invoke('bc_api_post',
            { url: `${base}/api/link/request`, body: JSON.stringify({ creatorId: cid, proof: (await creatorProofFor(bcAudience())) || undefined }) },
            { quiet: true }) as string;
        data = JSON.parse(raw);
    } catch {
        return { result: 'offline' };
    }
    if (data?.linked) { forgetBcLinkState(); return { result: 'already' }; }
    if (!data?.code) return { result: 'error' };
    showLinkCodeModal(data.code, base, onLinked);
    return { result: 'opened', code: data.code };
}

const escHtml = (s: unknown): string => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The pairing code, and a poll that notices when it has been used.
 *
 * The poll is the part that was missing: the code was shown and the dialog sat there until
 * dismissed, so whatever opened the flow never learned the answer and went on showing "not
 * linked" until the next launch. Now the modal closes itself the moment the server agrees, and
 * `onLinked` lets the caller redraw and say so.
 */
export function showLinkCodeModal(code: string, base: string, onLinked?: (st: BcLinkState) => void): void {
    document.getElementById('bc-link-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'bc-link-modal';
    // Absolutely fill the APP window container (not the OS window) so the backdrop stays
    // inside BMM's rounded frame and clicks land on the modal, not behind it.
    modal.style.cssText = 'position:absolute;inset:0;z-index:10500;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px)';
    modal.innerHTML = `
      <div style="width:100%;max-width:420px;background:var(--bmm-bg-elevated,#15171e);border:1px solid rgba(249,115,22,0.3);border-radius:18px;padding:24px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,0.5)">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">${escHtml(t('settings.link.title') || 'Link your BetterCommunity account')}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">${escHtml(t('settings.link.desc') || 'Enter this code on the website (Profile → Creator IDs). It expires in 15 minutes.')}</div>
        <div style="font-family:var(--font-mono,monospace);font-size:28px;font-weight:800;letter-spacing:4px;color:var(--bmm-warning);padding:14px;border-radius:12px;background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.2);margin-bottom:10px">${escHtml(code)}</div>
        <div id="bc-link-wait" style="font-size:11px;color:var(--text-muted);margin-bottom:14px">${escHtml(t('settings.link.waiting') || 'Waiting for the code to be entered on the website…')}</div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button id="bc-link-copy" class="btn btn-sm btn-accent">${escHtml(t('common.copy') || 'Copy')}</button>
          <button id="bc-link-open" class="btn btn-sm">${escHtml(t('settings.link.open') || 'Open website')}</button>
          <button id="bc-link-close" class="btn btn-sm btn-ghost">${escHtml(t('common.close') || 'Close')}</button>
        </div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(modal);

    // Every 4 s for 15 minutes — the life of the code, so the poll stops when the thing it is
    // waiting for can no longer happen, rather than running for as long as the app is open.
    const started = Date.now();
    const poll = window.setInterval(async () => {
        if (!modal.isConnected || Date.now() - started > 15 * 60_000) { window.clearInterval(poll); return; }
        const st = await bcLinkState(true);
        if (st.state !== 'linked') return;
        window.clearInterval(poll);
        modal.remove();
        try { onLinked?.(st); } catch { /* the link is what mattered */ }
    }, 4000);
    const stop = (): void => { window.clearInterval(poll); modal.remove(); };

    modal.addEventListener('click', (e) => { if (e.target === modal) stop(); });
    document.getElementById('bc-link-close')?.addEventListener('click', stop);
    // The button confirms on itself rather than raising a toast. A toast would mean importing
    // ui/app.js from core/ (see the module note), and a confirmation that appears on the thing
    // you just pressed is the better one anyway.
    document.getElementById('bc-link-copy')?.addEventListener('click', (e) => {
        navigator.clipboard.writeText(code);
        const b = e.currentTarget as HTMLButtonElement;
        const was = b.textContent;
        b.textContent = t('update.copied') || 'Copied!';
        window.setTimeout(() => { if (b.isConnected) b.textContent = was; }, 1200);
    });
    document.getElementById('bc-link-open')?.addEventListener('click', () => {
        invoke('open_external_url', { url: `${base}/profile` }).catch(() => window.open(`${base}/profile`, '_blank'));
    });
}
