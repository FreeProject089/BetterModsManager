// custom-page-broker.ts — the ONE and ONLY bridge between a sandboxed custom
// page and BMM. A page (origin `null`, no allow-same-origin) can reach nothing
// on its own; it can only `postMessage` to the parent, where this broker:
//   1. confirms the message comes from a known *page* iframe (not a URL iframe
//      or any random frame) — matched by contentWindow, never by origin,
//   2. confirms the requested capability is GRANTED for that page (default-deny),
//   3. dispatches to a small, frozen, hand-written API table — NEVER a generic
//      `invoke` passthrough. Every method is scoped to the verified page id.
//
// Capabilities not granted, methods not in the table, and frames not registered
// are all rejected. Nothing here can touch BMM internals, the filesystem, the
// shell, telemetry, or another page's data.

import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';

const grantsCache = new Map<string, Set<string>>();

/** (Re)load a page's granted capabilities from the backend into the cache. */
export async function refreshGrants(pageId: string): Promise<Set<string>> {
    let set = new Set<string>();
    try { set = new Set((await invoke('page_grants_get', { id: pageId })) as string[]); } catch { /* deny all */ }
    grantsCache.set(pageId, set);
    return set;
}

/** Which custom page (if any) owns the window that sent a message. */
function pageIdFor(source: unknown): string | null {
    const frames = document.querySelectorAll('iframe.custom-page-frame');
    for (const f of Array.from(frames)) {
        if ((f as HTMLIFrameElement).contentWindow === source) {
            return (f as HTMLElement).dataset.pageId || null;
        }
    }
    return null;
}

type Args = Record<string, unknown>;
// Frozen API surface. Each handler receives the *verified* page id (so a page can
// only ever touch its own namespace) plus the page-supplied args.
type CapHandler = (id: string, a: Args) => Promise<unknown>;
const API: Readonly<Record<string, Record<string, CapHandler>>> = Object.freeze({
    storage: Object.freeze({
        get: (id: string, a: Args) => invoke('page_storage_get', { id, key: String(a.key ?? '') }),
        set: (id: string, a: Args) => invoke('page_storage_set', { id, key: String(a.key ?? ''), value: String(a.value ?? '') }),
        remove: (id: string, a: Args) => invoke('page_storage_remove', { id, key: String(a.key ?? '') }),
        keys: (id: string) => invoke('page_storage_keys', { id }),
        clear: (id: string) => invoke('page_storage_clear', { id }),
    }),
    notifications: Object.freeze({
        // BMM toast only — never a system notification, never arbitrary HTML.
        notify: (_id: string, a: Args) => {
            const type = a.type === 'error' ? 'error' : a.type === 'success' ? 'success' : 'info';
            (window as any).toast?.(String(a.msg ?? '').slice(0, 200), type);
            return Promise.resolve(true);
        },
    }),
    network: Object.freeze({
        // Internet GET, but the backend re-checks the grant AND the per-page origin
        // allow-list before doing anything. The page never fetches directly.
        fetch: (id: string, a: Args) => invoke('page_fetch', { id, url: String(a.url ?? '') }),
    }),
    clipboard: Object.freeze({
        // Routed through BMM's main frame (the sandboxed page has no clipboard access).
        write: (_id: string, a: Args) => navigator.clipboard.writeText(String(a.text ?? '')).then(() => true),
        read: () => navigator.clipboard.readText(),
    }),
    system: Object.freeze({
        // Safe read-only system info (Rust re-checks the grant). No file/shell access.
        info: (id: string) => invoke('page_system_info', { id }),
    }),
    read: Object.freeze({
        // A fixed set of non-sensitive read-only values. NOTHING here touches the
        // filesystem, the shell, BMM's data, settings, profiles, or telemetry.
        get: (_id: string, a: Args) => {
            const scope = String(a.scope ?? '');
            const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
            const accent = cssVar('--accent') || cssVar('--bmm-accent');
            const bg = cssVar('--bmm-bg') || cssVar('--bg') || getComputedStyle(document.body).backgroundColor;
            const isDark = () => {
                const m = (bg || '').match(/\d+/g);
                if (!m || m.length < 3) return true;
                return (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) < 128;
            };
            const map: Record<string, string> = {
                'app.name': 'Better Mods Manager',
                'app.version': String((window as any).__BMM_VERSION__ ?? (window as any).APP_VERSION ?? ''),
                'app.platform': String((navigator as any).platform ?? ''),
                'app.lang': String((window as any).__bmmLang ?? document.documentElement.lang ?? ''),
                'app.locale': (() => { try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return ''; } })(),
                'app.online': navigator.onLine ? 'true' : 'false',
                'theme.current': document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme') || '',
                'theme.dark': isDark() ? 'true' : 'false',
                'theme.accent': accent,
                'screen.width': String(window.screen?.width ?? ''),
                'screen.height': String(window.screen?.height ?? ''),
            };
            return Promise.resolve(Object.prototype.hasOwnProperty.call(map, scope) ? map[scope] : null);
        },
    }),
});

let wired = false;
/** Install the single message listener. Idempotent; call once at startup. */
export function initPageBroker(): void {
    if (wired) return;
    wired = true;
    window.addEventListener('message', async (e: MessageEvent) => {
        const d = e.data;
        if (!d || d.__bmm !== true || typeof d.reqId === 'undefined') return;
        const pageId = pageIdFor(e.source);
        if (!pageId) return;                                   // not one of our page frames → ignore
        const reply = (m: Record<string, unknown>) => {
            try { (e.source as Window | null)?.postMessage({ __bmmReply: true, reqId: d.reqId, ...m }, '*'); } catch { /* gone */ }
        };
        const grants = grantsCache.get(pageId) || new Set<string>();
        if (typeof d.cap !== 'string' || !grants.has(d.cap)) {
            // Surface the missing permission so the user knows what to grant.
            const cap = typeof d.cap === 'string' ? d.cap : '?';
            (window as any).toast?.(`${t('navedit.permMissing') || 'Custom page is missing permission'}: "${cap}"`, 'warning');
            return reply({ error: 'permission_denied', cap });
        }
        const handler = API[d.cap]?.[String(d.method)];
        if (!handler) return reply({ error: 'unknown_method' });
        try { reply({ ok: await handler(pageId, (d.args && typeof d.args === 'object') ? d.args : {}) }); }
        catch (err) { reply({ error: String(err) }); }
    });
}
