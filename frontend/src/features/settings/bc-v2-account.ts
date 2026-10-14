// bc-v2-account.ts — Settings › « Linked BetterCommunity account » in BetterCommunity v2 mode.
//
// Shown only while this session runs on v2 (core/bc-v2.ts). Signing in is the OAuth device flow:
// BMM shows a short code, the person approves it on the website, Rust keeps the tokens
// (bc_v2_auth.rs) and this card only ever learns the account's name. The v1 link controls
// beside it are untouched: in v1 mode this card is hidden and they work as before.
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { openModal } from '../../ui/modal-shell.js';
import {
    bcSession, bcV2Account, bcV2DeviceStart, bcV2DevicePoll, bcV2DeviceCancel, bcV2SignOut, type BcV2Account,
} from '../../core/bc-v2.js';
import { initialFlow, flowStep, nextPollMs, isFinal, type FlowState, type FlowEvent } from '../../core/bc-device-flow.js';

const CARD_ID = 'bc-v2-account-card';
// The app's toast, read from window: importing ui/app here would close an import cycle
// (app → … → settings → this card → app).
const toast = (msg: string, kind: string): void => { (window as any).toast?.(msg, kind); };

/** Add the card under `parent` (once). It shows itself when the session is v2. */
export function mountBcV2AccountCard(parent: HTMLElement | null | undefined): void {
    if (!parent || document.getElementById(CARD_ID)) return;
    const card = document.createElement('div');
    card.id = CARD_ID;
    card.style.cssText = 'margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:10px;font-size:12px;display:none';
    parent.appendChild(card);
    const paint = async (): Promise<void> => {
        if (!card.isConnected) return;
        const s = bcSession();
        if (s.version !== 'v2') { card.style.display = 'none'; return; }
        card.style.display = '';
        const a = await bcV2Account();
        card.innerHTML = cardHtml(a, !!s.client_id);
        card.querySelector('#bcv2-sign-in')?.addEventListener('click', () => openDeviceFlow(() => { void paint(); }));
        card.querySelector('#bcv2-sign-out')?.addEventListener('click', async () => {
            try {
                const r: any = await bcV2SignOut();
                toast(r?.revoked ? t('bcv2.account.signedOut') : t('bcv2.account.signedOutLocal'), 'info');
            } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            void (await import('../../core/bcweb-notifications.js')).startBcwebNotifications();
            void paint();
        });
    };
    void paint();
    window.addEventListener('bmm:bc-session', () => { void paint(); });
    document.addEventListener('langChanged', () => { void paint(); });
}

function cardHtml(a: BcV2Account, hasClient: boolean): string {
    const dot = (on: boolean) => `<span style="width:8px;height:8px;border-radius:50%;background:${on ? 'var(--bmm-success,#22c55e)' : 'var(--text-muted)'};display:inline-block;flex-shrink:0"></span>`;
    const head = `<div style="font-weight:600;color:var(--text-secondary);margin-bottom:6px">${escHtml(t('bcv2.account.title'))}</div>`;
    if (a.signed_in && a.here) {
        const who = a.name ? (a.handle ? `${a.name} (@${a.handle})` : a.name) : (a.handle ? `@${a.handle}` : t('bcv2.account.someone'));
        const mem = a.storage === 'memory' ? `<div style="margin-top:6px;color:var(--bmm-warning,#f59e0b)">${escHtml(t('bcv2.account.memoryOnly'))}</div>` : '';
        return `${head}<div style="display:flex;align-items:center;gap:7px">${dot(true)} ${escHtml(t('bcv2.account.signedInAs', { name: who }))}</div>${mem}
            <div style="margin-top:6px;color:var(--text-muted);line-height:1.5">${escHtml(t('bcv2.account.what'))}</div>
            <div style="margin-top:8px"><button id="bcv2-sign-out" class="btn btn-sm">${escHtml(t('bcv2.account.signOut'))}</button></div>`;
    }
    return `${head}<div style="display:flex;align-items:center;gap:7px">${dot(false)} ${escHtml(t('bcv2.account.notSignedIn'))}</div>
        <div style="margin-top:6px;color:var(--text-muted);line-height:1.5">${escHtml(t('bcv2.account.why'))}</div>
        <div style="margin-top:8px">${hasClient
            ? `<button id="bcv2-sign-in" class="btn btn-sm btn-accent">${escHtml(t('bcv2.account.signIn'))}</button>`
            : `<span style="color:var(--text-muted)">${escHtml(t('bcv2.account.noClient'))}</span>`}</div>`;
}

/** The device-flow dialog: the code, the page to open, and polling until an answer. */
function openDeviceFlow(done: () => void): void {
    let st: FlowState = flowStep(initialFlow(), { type: 'start' });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const m = openModal({
        title: t('bcv2.account.signInTitle'),
        size: 'sm',
        body: `<div id="bcv2-flow" style="display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center"></div>`,
        footer: `<button type="button" class="btn btn-ghost" id="bcv2-flow-close">${escHtml(t('common.close'))}</button>`,
        onClose: () => stop(),
    });
    const box = m.q('#bcv2-flow')!;
    const stop = (): void => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (!isFinal(st)) { st = flowStep(st, { type: 'cancel' }); bcV2DeviceCancel(); }
    };
    const render = (): void => {
        const line = (k: string, tone = 'var(--text-muted)') => `<div style="color:${tone}">${escHtml(t(k))}</div>`;
        switch (st.phase) {
            case 'starting': box.innerHTML = line('bcv2.account.flowStarting'); break;
            case 'waiting':
                box.innerHTML = `<div>${escHtml(t('bcv2.account.flowStep1'))}</div>
                    <code style="font-size:24px;letter-spacing:3px;padding:6px 14px;border:1px solid var(--border);border-radius:8px">${escHtml(st.userCode)}</code>
                    <div style="display:flex;gap:8px"><button type="button" class="btn btn-sm btn-accent" id="bcv2-flow-open">${escHtml(t('bcv2.account.flowOpen'))}</button>
                    <button type="button" class="btn btn-sm" id="bcv2-flow-copy">${escHtml(t('bcv2.account.flowCopy'))}</button></div>
                    ${line(st.offline ? 'bcv2.account.flowOffline' : 'bcv2.account.flowWaiting')}`;
                box.querySelector('#bcv2-flow-open')?.addEventListener('click', () => { if (/^https?:\/\//i.test(st.page)) (window as any).openExternal?.(st.page); });
                box.querySelector('#bcv2-flow-copy')?.addEventListener('click', () => { void navigator.clipboard?.writeText(st.userCode).catch(() => {}); });
                break;
            case 'approved': box.innerHTML = line('bcv2.account.flowApproved', 'var(--bmm-success,#22c55e)'); break;
            case 'denied': box.innerHTML = line('bcv2.account.flowDenied', 'var(--bmm-warning,#f59e0b)'); break;
            case 'expired': box.innerHTML = line('bcv2.account.flowExpired', 'var(--bmm-warning,#f59e0b)'); break;
            case 'error': box.innerHTML = `${line('bcv2.account.flowError', 'var(--bmm-danger,#ef4444)')}<div style="font-size:11px;color:var(--text-muted)">${escHtml(st.error)}</div>`; break;
            default: box.innerHTML = '';
        }
    };
    const step = (e: FlowEvent): void => { st = flowStep(st, e); render(); schedule(); };
    const schedule = (): void => {
        const ms = nextPollMs(st);
        if (ms == null) {
            if (st.phase === 'approved') {
                done();
                void import('../../core/bcweb-notifications.js').then((n) => n.startBcwebNotifications()).catch(() => {});
                toast(t('bcv2.account.signedIn'), 'success');
                setTimeout(() => m.close(), 1200);
            }
            return;
        }
        timer = setTimeout(async () => {
            timer = null;
            if (!m.dialog.isConnected) { stop(); return; }
            let r: any;
            try { r = await bcV2DevicePoll(); } catch (e) { step({ type: 'polled', state: 'error', error: String(e), now: Date.now() }); return; }
            step({ type: 'polled', state: String(r?.state || 'error'), interval: r?.interval, account: r?.account, error: r?.error, offline: !!r?.offline, now: Date.now() });
        }, ms);
    };
    m.q('#bcv2-flow-close')?.addEventListener('click', () => { stop(); m.close(); });
    render();
    bcV2DeviceStart().then(
        (r: any) => step({ type: 'started', user_code: r?.user_code, verification_uri_complete: r?.verification_uri_complete, interval: r?.interval, expires_in: r?.expires_in, now: Date.now() }),
        (e) => step({ type: 'start_failed', error: String(e) }),
    );
}
