// offline.ts — connectivity awareness for BMM.
//
// navigator.onLine only tells us whether a network interface exists, not whether
// the internet is actually reachable. So we also probe a tiny always-on endpoint.
// Features that load remote content call requireOnline()/safeFetch() so that,
// when there's no connection, the user gets a clear message instead of a raw
// error — the feature itself is never removed, it just waits for connectivity.

import { t } from './i18n.js';

let _online = navigator.onLine;
let _probing = false;

// 204 endpoints are tiny, CORS-friendly, and exist purely for connectivity checks.
const PROBE_URLS = [
    'https://www.gstatic.com/generate_204',
    'https://cloudflare.com/cdn-cgi/trace',
];

export function isOnline(): boolean { return _online; }

async function probe(): Promise<boolean> {
    if (!navigator.onLine) return false;
    for (const url of PROBE_URLS) {
        try {
            await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(5000) });
            return true;     // resolved (even opaque) ⇒ reachable
        } catch { /* try next */ }
    }
    return false;
}

function msg(): string {
    return t('offline.banner') || 'No internet connection — online features are paused until you reconnect.';
}

function render(): void {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;
    const label = banner.querySelector('.offline-banner-text');
    if (label) label.textContent = msg();
    if (_online) {
        banner.classList.remove('visible');
        setTimeout(() => banner.classList.remove('active'), 400);
    } else {
        banner.classList.add('active');
        setTimeout(() => banner.classList.add('visible'), 10);
    }
}

function setOnline(v: boolean): void {
    if (v === _online) return;
    _online = v;
    render();
    try { window.dispatchEvent(new CustomEvent('bmm-connectivity', { detail: { online: v } })); } catch {}
}

export async function recheck(): Promise<boolean> {
    if (_probing) return _online;
    _probing = true;
    try { setOnline(await probe()); } finally { _probing = false; }
    return _online;
}

export function initOffline(): void {
    window.addEventListener('online', () => { recheck(); });
    window.addEventListener('offline', () => setOnline(false));
    recheck();
    // Re-probe often while offline (to recover fast), occasionally while online.
    setInterval(() => { if (!_online) recheck(); }, 15000);
    setInterval(() => { recheck(); }, 120000);
    render();

    // Expose for any feature module (no import needed):
    (window as any).bmmIsOnline = isOnline;
    (window as any).bmmRequireOnline = requireOnline;
    (window as any).bmmSafeFetch = safeFetch;
}

/** Returns true if online; otherwise toasts a friendly message and returns false. */
export function requireOnline(feature?: string): boolean {
    if (_online) return true;
    const m = (feature ? `${feature} — ` : '') + msg();
    try { (window as any).toast?.(m, 'warning'); } catch {}
    return false;
}

/** fetch() that no-ops (returns null) with a message when offline. */
export async function safeFetch(url: string, opts?: RequestInit, feature?: string): Promise<Response | null> {
    if (!requireOnline(feature)) return null;
    try {
        return await fetch(url, opts);
    } catch (e) {
        // a fetch failure mid-session likely means we just dropped offline
        recheck();
        throw e;
    }
}
