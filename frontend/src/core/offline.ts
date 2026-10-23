// offline.ts — connectivity awareness for BMM.
//
// navigator.onLine only tells us whether a network interface exists, not whether
// the internet is actually reachable. So we also probe a tiny always-on endpoint.
//
// What offline changes: the banner, and a `bmm-connectivity` event. It is a notice, not a
// lock: network features are not gated, and one started offline fails with its own error.
// Deliberately so: a repo on the LAN and the local API need no internet, and a gate keyed on
// reaching the probe endpoints would block them. (`requireOnline()` / `safeFetch()` used to
// live here for gating, were never called by anything, and the offline-mode diagram drew
// them as if they were; both are gone, and the diagram shows this behaviour.)

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
}
