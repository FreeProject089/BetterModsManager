// navbar-customize.ts — Phase A of navbar customization.
// Non-destructive enhancement of the existing `.sidebar-nav` items: reorder, hide/show,
// and rename. State is persisted in localStorage. No third-party code execution here.

import { t } from '../core/i18n.js';
import { invoke, pickFile, saveFile } from '../core/api.js';
import { initPageBroker, refreshGrants } from './custom-page-broker.js';

const LS_KEY = 'bmm_navbar_config';

// ── Custom sandboxed pages (Phase B) ──────────────────────────────────────
interface PageMeta { id: string; name: string; runtime: string; entry: string; }
let _pagesCache: PageMeta[] = [];
async function loadPages(): Promise<PageMeta[]> {
    try { _pagesCache = (await invoke('list_custom_pages')) as PageMeta[]; } catch { _pagesCache = []; }
    return _pagesCache;
}
const PROTECTED = new Set(['settings']); // never hideable (you'd lose access to the editor)

interface CustomNavItem {
    id: string;                            // "custom:abc123"
    label: string;
    kind: 'view' | 'modal' | 'url' | 'page'; // internal view / modal / external URL / sandboxed custom page
    target: string;                        // viewId | modalId | https URL | pageId
    icon?: string;                         // chosen built-in icon key (see ICONS)
}

// Built-in icon set for custom buttons (key → SVG inner paths).
const ICONS: Record<string, string> = {
    star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21l1.2-6.9-5-4.9 6.9-1z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    bolt: '<path d="M13 2L3 14h7l-1 8 10-12h-7z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/>',
    upload: '<path d="M12 21V9"/><path d="M7 13l5-5 5 5"/><path d="M5 3h14"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    tag: '<path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4.8A2 2 0 0 1 4.8 2.8H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    package: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    terminal: '<path d="M4 5h16v14H4z"/><path d="M7 9l3 3-3 3"/><path d="M13 15h4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    play: '<path d="M6 4l14 8-14 8V4z"/>',
    shield: '<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z"/>',
    puzzle: '<path d="M10 3v3a2 2 0 1 0 4 0V3h4v4h-3a2 2 0 1 0 0 4h3v4h-4v-3a2 2 0 1 0-4 0v3H6v-4h3a2 2 0 1 0 0-4H6V3z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-1.5 4L16 12H5"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4l-2.5 2.5-2-2 2.5-2.5z"/>',
};
function svgWrap(inner: string): string {
    return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${inner}</svg>`;
}
/**
 * All icons available to custom buttons: the built-in set above PLUS every icon
 * already used by BMM's own nav items (harvested from the DOM at runtime). Each
 * entry maps a stable key → full <svg> markup. Keys: "star"… (built-ins) and
 * "nav:<viewId>" (BMM's own icons). The chosen *key* is what we persist.
 */
function iconRegistry(): Record<string, string> {
    const reg: Record<string, string> = {};
    for (const k of Object.keys(ICONS)) reg[k] = svgWrap(ICONS[k]);
    for (const el of items()) {
        if (!el.dataset.view) continue;                       // built-in views only
        const ic = el.querySelector('.nav-icon');
        if (ic && ic.innerHTML.trim()) reg['nav:' + el.dataset.view] = ic.innerHTML;
    }
    return reg;
}
interface NavbarConfig {
    // `order` mixes item ids (built-in data-view + custom) and section dividers
    // ("group:<id>"). A section header is rendered for each "group:" entry; the items
    // that follow it visually belong to that section.
    order: string[];
    hidden: Record<string, boolean>;
    labels: Record<string, string>;        // id → custom label (rename)
    custom: CustomNavItem[];
    groups: Record<string, { label: string }>;
}

function load(): NavbarConfig {
    try {
        const c = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        return {
            order: c.order || [], hidden: c.hidden || {}, labels: c.labels || {},
            custom: c.custom || [], groups: c.groups || {},
        };
    } catch { return { order: [], hidden: {}, labels: {}, custom: [], groups: {} }; }
}
const EMPTY_CFG: NavbarConfig = { order: [], hidden: {}, labels: {}, custom: [], groups: {} };
function save(c: NavbarConfig): void {
    try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

// ── Shareable config (short code / bmm:// link), mirroring card-order.ts ──
const NAV_CODE_PREFIX = 'BMMNAV1.';
function exportNavCode(): string {
    // The bmm:// link is the lightweight share: classic navbar + custom buttons.
    // Uploaded (data: URI) icons and custom pages are too big for a URL — those
    // travel in the .bmmnav file instead. Strip data-URI icons so the link stays short.
    const cfg = load();
    cfg.custom = cfg.custom.map(c => c.icon && c.icon.startsWith('data:') ? { ...c, icon: '' } : c);
    return NAV_CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
}
// ── .bmmnav file: the FULL portable bundle (navbar config + custom icons +
//    custom pages' source/permissions). The bmm:// code link can't carry page
//    bundles or uploaded icons, so sharing those uses this file. ──
interface NavBundlePage { id: string; name: string; html: string; css: string; js: string; grants: string[]; netOrigins: string[]; }
interface NavBundle { format: 'bmmnav'; version: 1; navbar: NavbarConfig; pages: NavBundlePage[]; }

async function exportNavBundle(): Promise<void> {
    const cfg = load();
    const pageIds = new Set(cfg.custom.filter(c => c.kind === 'page').map(c => c.target));
    const pages: NavBundlePage[] = [];
    for (const id of pageIds) {
        try {
            const src = await invoke('get_custom_page_source', { id }) as { name: string; html: string; css: string; js: string };
            const grants = await invoke('page_grants_get', { id }).catch(() => []) as string[];
            const netOrigins = await invoke('page_net_origins_get', { id }).catch(() => []) as string[];
            pages.push({ id, ...src, grants, netOrigins });
        } catch { /* page gone — skip */ }
    }
    const bundle: NavBundle = { format: 'bmmnav', version: 1, navbar: cfg, pages };
    const path = await saveFile({ defaultPath: 'my-navbar.bmmnav', filters: [{ name: 'BMM Navigation', extensions: ['bmmnav'] }] }).catch(() => null);
    if (!path) return;
    try { await invoke('write_text_file', { path, content: JSON.stringify(bundle) }); (window as any).toast?.(t('navedit.bundleExported') || 'Navigation exported', 'success'); }
    catch (e) { (window as any).toast?.(String(e), 'error'); }
}

async function importNavBundle(): Promise<void> {
    const path = await pickFile({ filters: [{ name: 'BMM Navigation', extensions: ['bmmnav', 'json'] }] }).catch(() => null);
    if (!path) return;
    let bundle: NavBundle;
    try { bundle = JSON.parse(await invoke('read_nav_bundle', { path }) as string); } catch (e) { (window as any).toast?.(String(e), 'error'); return; }
    if (bundle.format !== 'bmmnav' || !bundle.navbar) { (window as any).toast?.(t('navedit.badBundle') || 'Not a valid .bmmnav file', 'error'); return; }
    // Recreate each shared page (new ids), then remap the custom buttons' targets.
    const idMap: Record<string, string> = {};
    for (const p of bundle.pages || []) {
        try {
            const meta = await invoke('create_custom_page', { name: p.name, html: p.html, css: p.css, js: p.js }) as { id: string };
            idMap[p.id] = meta.id;
            for (const cap of p.grants || []) { try { await invoke('page_set_grant', { id: meta.id, cap, granted: true }); } catch { /* unknown cap */ } }
            if (p.netOrigins?.length) { try { await invoke('page_set_net_origins', { id: meta.id, origins: p.netOrigins }); } catch { /* ignore */ } }
        } catch { /* skip a bad page */ }
    }
    const cfg: NavbarConfig = { ...EMPTY_CFG, ...bundle.navbar };
    for (const c of cfg.custom || []) { if (c.kind === 'page' && idMap[c.target]) c.target = idMap[c.target]; }
    save(cfg); applyNavbarConfig();
    (window as any).toast?.(t('navedit.bundleImported') || 'Navigation imported', 'success');
    openNavbarEditor();
}

function parseNavCode(input: string): NavbarConfig | null {
    try {
        const s = input.trim();
        const m = s.match(/[?&]code=([^&]+)/);          // accept a bmm:// link or a raw code
        const code = m ? decodeURIComponent(m[1]) : s;
        if (!code.startsWith(NAV_CODE_PREFIX)) return null;
        const cfg = JSON.parse(decodeURIComponent(escape(atob(code.slice(NAV_CODE_PREFIX.length)))));
        return { ...EMPTY_CFG, ...cfg };
    } catch { return null; }
}

function navEl(): HTMLElement | null { return document.querySelector('.sidebar-nav'); }
function items(): HTMLElement[] {
    const n = navEl();
    if (!n) return [];
    return (Array.from(n.querySelectorAll(':scope > .nav-item')) as HTMLElement[])
        .filter(el => el.id !== 'nav-customize-btn');   // the editor trigger stays last, not reorderable
}
function idOf(el: HTMLElement): string {
    return el.dataset.view || el.dataset.customId || el.id.replace(/^nav-/, '');
}
function cssEsc(s: string): string {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}
function customIcon(item: CustomNavItem): string {
    const ic = item.icon || '';
    // Uploaded custom icon (a data: URI image — rendered as <img>, never injected as HTML).
    if (ic.startsWith('data:')) return `<img class="nav-custom-img" src="${escAttr(ic)}" alt="">`;
    const reg = iconRegistry();
    if (ic && reg[ic]) return reg[ic];
    const fallback = item.kind === 'url' ? ICONS.link : item.kind === 'modal' ? ICONS.grid : ICONS.folder;
    return svgWrap(fallback);
}
function labelEl(el: HTMLElement): HTMLElement | null { return el.querySelector('.nav-label'); }

/** Render (or refresh) the custom nav buttons defined in the config. */
function renderCustomItems(cfg: NavbarConfig): void {
    const nav = navEl(); if (!nav) return;
    const wantedIds = new Set(cfg.custom.map(c => c.id));
    // Remove custom buttons (and their views) that no longer exist.
    nav.querySelectorAll('.nav-item[data-custom-id]').forEach(el => {
        const id = (el as HTMLElement).dataset.customId!;
        if (!wantedIds.has(id)) { document.getElementById(viewIdFor(id))?.remove(); el.remove(); }
    });
    for (const item of cfg.custom) {
        let btn = nav.querySelector(`.nav-item[data-custom-id="${cssEsc(item.id)}"]`) as HTMLButtonElement | null;
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'nav-item nav-item-custom';
            btn.dataset.customId = item.id;
            btn.addEventListener('click', () => activateCustom(item));
            nav.appendChild(btn);
        }
        btn.innerHTML = `<span class="nav-icon">${customIcon(item)}</span><span class="nav-label">${escAttr(item.label)}</span>`;
    }
}

function viewIdFor(customId: string): string { return 'view-' + customId.replace(/[^a-z0-9]/gi, '-'); }

/**
 * URL for a sandboxed page's entry file. Tauri v2 does NOT route `bmmpage://`
 * directly in the webview — on Windows/Android custom schemes are served at
 * `http://<scheme>.localhost/…`, elsewhere at `<scheme>://localhost/…`. The
 * Rust handler accepts both (id as first path segment for *.localhost hosts).
 */
function pageBundleUrl(id: string): string {
    const enc = encodeURIComponent(id);
    const isWin = /Windows|Android/i.test(navigator.userAgent);
    return isWin
        ? `http://bmmpage.localhost/${enc}/index.html`
        : `bmmpage://localhost/${enc}/index.html`;
}

/** Open a custom item: switch to an internal view, open a modal, or show a sandboxed URL. */
function activateCustom(item: CustomNavItem): void {
    if (item.kind === 'view') {
        (document.querySelector(`.nav-item[data-view="${cssEsc(item.target)}"]`) as HTMLElement | null)?.click();
        return;
    }
    if (item.kind === 'modal') {
        // Prefer the curated action (real opener, properly initialized).
        if (runModalAction(item.target)) return;
        // Legacy fallback: a raw modal element id from an older custom button.
        const m = document.getElementById(item.target) || document.querySelector(`.${cssEsc(item.target)}`);
        if (m) {
            // Many modals live INSIDE a view section (e.g. #view-modpacks); if that view
            // isn't active it's display:none, so the modal stays invisible. Portal it to
            // the top-level window so it shows from anywhere, like its normal trigger does.
            const host = document.getElementById('app-window-outer');
            if (host && m.parentElement !== host) host.appendChild(m);
            m.classList.add('open');
            m.classList.add('active');                 // some overlays use .active instead of .open
        }
        return;
    }
    if (item.kind === 'page') {
        // Custom sandboxed page served by the bmmpage:// protocol. The iframe has
        // NO allow-same-origin → opaque `null` origin → it cannot reach window.parent,
        // the BMM DOM, __TAURI__/invoke, cookies, or the network (CSP connect-src 'none').
        const pvid = viewIdFor(item.id);
        let pview = document.getElementById(pvid) as HTMLElement | null;
        if (!pview) {
            const host = document.querySelector('.content-area') || document.querySelector('main') || document.body;
            pview = document.createElement('section');
            pview.id = pvid; pview.className = 'view custom-url-view custom-page-view';
            // allow-modals: alert()/confirm() in a quick test page failed silently
            // without it. Dialogs only — the isolation story (no allow-same-origin,
            // opaque origin, CSP connect-src 'none') is unchanged.
            pview.innerHTML = `<iframe class="custom-url-frame custom-page-frame" referrerpolicy="no-referrer"
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
                data-page-id="${escAttr(item.target)}"
                data-src="${escAttr(pageBundleUrl(item.target))}" src="about:blank"></iframe>`;
            host.appendChild(pview);
        }
        refreshGrants(item.target);                            // load this page's permissions for the broker
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        pview.classList.add('active');
        (navEl()?.querySelector(`.nav-item[data-custom-id="${cssEsc(item.id)}"]`) as HTMLElement | null)?.classList.add('active');
        syncCustomFrames();
        return;
    }
    // kind === 'url' → show a sandboxed iframe IN the content area (navbar stays).
    if (!/^https?:\/\//i.test(item.target)) return;            // only real web URLs
    const vid = viewIdFor(item.id);
    let view = document.getElementById(vid) as HTMLElement | null;
    if (!view) {
        const host = document.querySelector('.content-area') || document.querySelector('main') || document.body;
        view = document.createElement('section');
        view.id = vid; view.className = 'view custom-url-view';
        // An external https site is cross-origin to BMM, so the browser already isolates
        // it from the app (it can't reach window.parent / __TAURI__). allow-same-origin
        // here refers to the *site's own* origin (so it actually works), NOT BMM's.
        // No allow-top-navigation → it can never replace the BMM window.
        // NB: many sites (YouTube, Google…) refuse embedding via X-Frame-Options /
        // frame-ancestors — that's the site's choice, not a BMM bug; hence the
        // "open in browser" escape + hint in the bar.
        view.innerHTML = `
            <div class="custom-url-bar">
                <span class="custom-url-addr" data-tooltip="${escAttr(item.target)}">${escAttr(item.target)}</span>
                <span class="custom-url-hint">${t('navedit.embedHint') || 'Some sites block embedding'}</span>
                <button class="custom-url-open" type="button">${t('navedit.openExternal') || 'Open in browser ↗'}</button>
            </div>
            <iframe class="custom-url-frame" referrerpolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                data-src="${escAttr(item.target)}" src="about:blank"></iframe>`;
        view.querySelector('.custom-url-open')?.addEventListener('click', () => (window as any).openExternal?.(item.target));
        host.appendChild(view);
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    view.classList.add('active');
    (navEl()?.querySelector(`.nav-item[data-custom-id="${cssEsc(item.id)}"]`) as HTMLElement | null)?.classList.add('active');
    syncCustomFrames();
}

/**
 * Load the iframe of the *active* custom view from its `data-src`, and unload
 * every inactive one (`src=about:blank`) so it stops consuming CPU/memory/network
 * (e.g. a playing video) while you're on another tab. Cheap and idempotent.
 */
function syncCustomFrames(): void {
    document.querySelectorAll('.custom-url-view, .custom-page-view').forEach(view => {
        const f = view.querySelector('iframe') as HTMLIFrameElement | null;
        if (!f) return;
        const real = f.dataset.src || '';
        if (view.classList.contains('active')) {
            if (real && f.getAttribute('src') !== real) f.setAttribute('src', real);
        } else if (f.getAttribute('src') !== 'about:blank') {
            f.setAttribute('src', 'about:blank');
        }
    });
}

/** Apply the saved config to the real navbar (idempotent). */
export function applyNavbarConfig(): void {
    const nav = navEl(); if (!nav) return;
    const cfg = load();
    renderCustomItems(cfg);
    const byId = new Map(items().map(el => [idOf(el), el]));

    // 1) Reorder + section headers: walk `order`, appending a header for each "group:"
    //    entry and the matching item otherwise. Unknown/new items keep their spot after.
    nav.querySelectorAll('.nav-group-header').forEach(h => h.remove());
    for (const entry of cfg.order) {
        if (entry.startsWith('group:')) {
            const g = cfg.groups[entry];
            if (!g) continue;
            const h = document.createElement('div');
            h.className = 'nav-group-header';
            h.dataset.groupEntry = entry;
            h.textContent = g.label || '';
            nav.appendChild(h);
        } else {
            const el = byId.get(entry);
            if (el) nav.appendChild(el);
        }
    }
    // 2) Hide / show + 3) rename.
    for (const el of items()) {
        const id = idOf(el);
        el.classList.toggle('nav-item-hidden', !!cfg.hidden[id] && !PROTECTED.has(id));
        const lbl = labelEl(el);
        if (lbl) {
            const custom = cfg.labels[id];
            if (custom) {
                if (!lbl.dataset.i18nOrig) lbl.dataset.i18nOrig = lbl.getAttribute('data-i18n') || '';
                lbl.removeAttribute('data-i18n');     // stop i18n from overwriting the rename
                lbl.textContent = custom;
            } else if (lbl.dataset.i18nOrig !== undefined && !lbl.getAttribute('data-i18n') && lbl.dataset.i18nOrig) {
                lbl.setAttribute('data-i18n', lbl.dataset.i18nOrig); // restore original key
                lbl.textContent = t(lbl.dataset.i18nOrig);
            }
        }
    }
}

/** Apply the saved config at startup. The editor is opened from Settings (card-order bar). */
export function initNavbarCustomize(): void {
    applyNavbarConfig();
    initPageBroker();                          // the single postMessage bridge for sandboxed pages
    // When the user navigates to any built-in tab, the active custom view loses
    // `.active`; unload its iframe shortly after so it stops using resources.
    const nav = navEl();
    if (nav && !(nav as any)._bmmSyncWired) {
        (nav as any)._bmmSyncWired = true;
        nav.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.nav-item[data-view]')) {
                setTimeout(syncCustomFrames, 60);  // after app.ts switches the view
            }
        });
    }
}

/** Apply a shared navbar config from a bmm:// deep link code. Returns true on success. */
export function applyNavCodeFromLink(code: string): boolean {
    const cfg = parseNavCode(code);
    if (!cfg) return false;
    save(cfg); applyNavbarConfig();
    return true;
}

/** Open the customization editor (a modal). */
export function openNavbarEditor(): void {
    document.getElementById('navbar-editor-overlay')?.remove();
    const cfg = load();
    const overlay = document.createElement('div');
    overlay.id = 'navbar-editor-overlay';
    overlay.className = 'modal-generic-overlay open';

    const rowsHtml = orderedIds().map(id => {
        if (id.startsWith('group:')) {
            const label = cfg.groups[id]?.label || '';
            return `
            <div class="nbe-row nbe-row-group" data-id="${id}" draggable="false">
                <span class="nbe-grip" data-tooltip="${t('common.dragReorder') || 'Drag to reorder'}">⠿</span>
                <span class="nbe-section-tag">${t('navedit.section') || 'SECTION'}</span>
                <input class="nbe-name input" value="${escAttr(label)}" placeholder="${t('navedit.sectionName') || 'Section name'}">
                <button class="nbe-del" data-del="${id}" data-tooltip="${t('common.delete') || 'Delete'}">✕</button>
            </div>`;
        }
        const el = items().find(e => idOf(e) === id);
        const icon = el?.querySelector('.nav-icon')?.innerHTML || '';
        const name = cfg.labels[id] || t(el ? (labelEl(el)?.dataset.i18nOrig || labelEl(el)?.getAttribute('data-i18n') || id) : id) || id;
        const hidden = !!cfg.hidden[id];
        const prot = PROTECTED.has(id);
        const isCustom = id.startsWith('custom:');
        return `
        <div class="nbe-row" data-id="${id}" draggable="false">
            <span class="nbe-grip" data-tooltip="${t('common.dragReorder') || 'Drag to reorder'}">⠿</span>
            <span class="nbe-icon">${icon}</span>
            <input class="nbe-name input" value="${escAttr(name)}" placeholder="${escAttr(id)}">
            <button class="nbe-eye ${hidden ? 'is-hidden' : ''}" data-tooltip="${t('navedit.toggle') || 'Show / hide'}" ${prot ? 'disabled' : ''}>
                ${hidden ? eyeOff() : eyeOn()}
            </button>
            ${isCustom ? `<button class="nbe-edit" data-edit="${id}" data-tooltip="${t('navedit.editBtn') || 'Edit'}">✎</button><button class="nbe-del" data-del="${id}" data-tooltip="${t('common.delete') || 'Delete'}">✕</button>` : ''}
        </div>`;
    }).join('');

    overlay.innerHTML = `
        <div class="modal-generic nbe-modal">
            <div class="modal-generic-header">
                <h3>${t('navedit.title') || 'Customize navigation'}</h3>
                <button class="modal-close" id="nbe-close">✕</button>
            </div>
            <p class="nbe-sub">${t('navedit.sub') || 'Drag to reorder, rename, or hide items.'}</p>
            <div class="nbe-scroll">
            <div class="nbe-list" id="nbe-list">${rowsHtml}</div>
            <button class="btn btn-ghost btn-sm nbe-add-section-btn" id="nbe-add-section">+ ${t('navedit.addSection') || 'Add a section'}</button>
            <details class="nbe-add">
                <summary>+ ${t('navedit.addBtn') || 'Add a custom button'}</summary>
                <div class="nbe-add-form">
                    <label class="nbe-flbl">${t('navedit.label') || 'Label'}</label>
                    <input class="input" id="nbe-add-label" placeholder="${t('navedit.label') || 'Label'}">
                    <label class="nbe-flbl">${t('navedit.type') || 'Type'}</label>
                    <select class="input" id="nbe-add-kind">
                        <option value="view">${t('navedit.kindView') || 'Internal tab'}</option>
                        <option value="modal">${t('navedit.kindModal') || 'Modal'}</option>
                        <option value="page">${t('navedit.kindPage') || 'Custom page (sandboxed)'}</option>
                        <option value="url">${t('navedit.kindUrl') || 'External URL (sandboxed)'}</option>
                    </select>
                    <label class="nbe-flbl">${t('navedit.target') || 'Opens'}</label>
                    <div id="nbe-add-target-wrap"></div>
                    <label class="nbe-flbl">${t('navedit.icon') || 'Icon'}</label>
                    <div class="nbe-icon-grid" id="nbe-icon-grid">${iconGridHtml('folder')}</div>
                    <div class="nbe-icon-upload">
                        <label class="btn btn-xs btn-ghost">${t('navedit.uploadIcon') || 'Upload icon…'}<input type="file" id="nbe-icon-file" accept="image/png,image/jpeg,image/svg+xml,image/gif,image/webp" hidden></label>
                        <span class="nbe-icon-preview" id="nbe-icon-preview"></span>
                    </div>
                    <button class="btn btn-secondary nbe-add-go" id="nbe-add-go">${t('navedit.add') || 'Add'}</button>
                </div>
            </details>
            <details class="nbe-add nbe-pages">
                <summary>${t('navedit.managePages') || 'Custom pages (sandboxed)'}</summary>
                <div class="nbe-add-form">
                    <p class="nbe-sub">${t('navedit.pagesHint') || 'Pages run fully isolated: no access to BMM, your data, or the network.'}</p>
                    <div id="nbe-pages-list"></div>
                    <label class="nbe-flbl">${t('navedit.pageName') || 'Page name'}</label>
                    <input class="input" id="nbe-page-name" placeholder="${t('navedit.pageName') || 'Page name'}">
                    <label class="nbe-flbl">HTML</label>
                    <textarea class="input nbe-code" id="nbe-page-html" rows="8" placeholder="<h1>Hello</h1>"></textarea>
                    <label class="nbe-flbl">CSS</label>
                    <textarea class="input nbe-code" id="nbe-page-css" rows="6" placeholder="body { color: white }"></textarea>
                    <label class="nbe-flbl">JS ${`<span class="nbe-jsnote">${t('navedit.jsNote') || '(use addEventListener — inline onclick is blocked; bmm.* available)'}</span>`}</label>
                    <textarea class="input nbe-code" id="nbe-page-js" rows="8" placeholder="document.querySelector('button')?.addEventListener('click', () =&gt; bmm.notify('hi'))"></textarea>
                    <button class="btn btn-secondary" id="nbe-page-create">${t('navedit.createPage') || 'Create page'}</button>
                </div>
            </details>
            <div class="nbe-import-row" id="nbe-import-row" style="display:none">
                <input class="input" id="nbe-import-input" placeholder="${t('cardorder.importPh') || 'Paste code or bmm:// link'}">
                <button class="btn btn-xs btn-accent" id="nbe-import-apply">${t('common.apply') || 'Apply'}</button>
            </div>
            </div><!-- /nbe-scroll -->
            <!-- Share/import used to be four sibling ghost buttons ("Share", "Import",
                 ".bmmnav", "Import .bmmnav") — nothing said WHICH share carries what, and
                 the field feedback was exactly that confusion. One menu, and every entry
                 explains itself with a hint line: link = layout only, file = everything.
                 Same ids inside, so every handler below survives unchanged. -->
            <div class="nbe-actions">
                <button class="btn btn-ghost nbe-act" id="nbe-reset"><span class="nbe-act-ic">${svgWrap('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>')}</span><span class="nbe-act-tx">${t('navedit.reset') || 'Reset'}</span></button>
                <span class="nbe-share-menu-wrap">
                    <button class="btn btn-ghost nbe-act" id="nbe-share-menu-btn"><span class="nbe-act-ic">${svgWrap('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')}</span><span class="nbe-act-tx">${t('navedit.shareMenu') || 'Share / Import'} ▾</span></button>
                    <span class="nbe-share-menu" id="nbe-share-menu" hidden>
                        <button class="nbe-menu-item" id="nbe-share"><span class="nbe-mi-title">${t('navedit.shareLink') || 'Copy share link'}</span><span class="nbe-mi-hint">${t('navedit.shareLinkHint') || 'Layout & buttons only — no pages or uploaded icons'}</span></button>
                        <button class="nbe-menu-item" id="nbe-import"><span class="nbe-mi-title">${t('navedit.importCode') || 'Paste a link / code'}</span><span class="nbe-mi-hint">${t('navedit.importCodeHint') || 'Apply a layout someone shared as a bmm:// link'}</span></button>
                        <button class="nbe-menu-item" id="nbe-export-file"><span class="nbe-mi-title">${t('navedit.exportFile') || 'Export .bmmnav file'}</span><span class="nbe-mi-hint">${t('navedit.exportFileHint') || 'Everything: layout, custom pages, permissions, icons'}</span></button>
                        <button class="nbe-menu-item" id="nbe-import-file"><span class="nbe-mi-title">${t('navedit.importFileNav') || 'Import .bmmnav file'}</span><span class="nbe-mi-hint">${t('navedit.importFileHint') || 'Restores a full export, pages included'}</span></button>
                    </span>
                </span>
                <button class="btn btn-primary nbe-act" id="nbe-done"><span class="nbe-act-ic">${svgWrap('<path d="M20 6L9 17l-5-5"/>')}</span><span class="nbe-act-tx">${t('common.done') || 'Done'}</span></button>
            </div>
        </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);

    const list = overlay.querySelector('#nbe-list') as HTMLElement;
    const commit = () => { save(readEditor(list)); applyNavbarConfig(); };

    // Delete a custom button OR a section divider.
    list.querySelectorAll('.nbe-del').forEach(btn =>
        btn.addEventListener('click', () => {
            const id = (btn as HTMLElement).dataset.del!;
            const c = readEditor(list);
            if (id.startsWith('group:')) delete c.groups[id];
            else c.custom = c.custom.filter(x => x.id !== id);
            c.order = c.order.filter(x => x !== id);
            save(c); applyNavbarConfig(); openNavbarEditor(); // re-render
        }));

    // Add a section divider (at the top).
    overlay.querySelector('#nbe-add-section')?.addEventListener('click', () => {
        const c = readEditor(list);
        const gid = 'group:' + Math.random().toString(36).slice(2, 9);
        c.groups[gid] = { label: t('navedit.newSection') || 'New section' };
        c.order.unshift(gid);
        save(c); applyNavbarConfig(); openNavbarEditor();
    });

    // ── Add-button form: dynamic target + icon picker ──
    const kindSel = overlay.querySelector('#nbe-add-kind') as HTMLSelectElement;
    const tgtWrap = overlay.querySelector('#nbe-add-target-wrap') as HTMLElement;
    const iconGrid = overlay.querySelector('#nbe-icon-grid') as HTMLElement;
    let chosenIcon = 'folder';
    let editingId: string | null = null;                   // set while editing an existing custom button
    const addDetails = overlay.querySelector('.nbe-add') as HTMLDetailsElement;
    const addGo = overlay.querySelector('#nbe-add-go') as HTMLButtonElement;
    const labelInp = overlay.querySelector('#nbe-add-label') as HTMLInputElement;
    const renderTarget = () => { tgtWrap.innerHTML = targetFieldHtml(kindSel.value); };
    renderTarget();
    kindSel.addEventListener('change', renderTarget);
    const iconPreview = overlay.querySelector('#nbe-icon-preview') as HTMLElement;
    const setIcon = (icon: string) => {
        chosenIcon = icon;
        const isCustom = icon.startsWith('data:');
        iconGrid.querySelectorAll('.nbe-icon-opt').forEach(o => o.classList.toggle('sel', !isCustom && (o as HTMLElement).dataset.icon === icon));
        iconPreview.innerHTML = isCustom ? `<img class="nav-custom-img" src="${escAttr(icon)}" alt="">` : '';
    };
    iconGrid.addEventListener('click', (e) => {
        const opt = (e.target as HTMLElement).closest('.nbe-icon-opt') as HTMLElement | null;
        if (opt) setIcon(opt.dataset.icon!);
    });
    // Upload a custom icon → stored as a small data: URI (FileReader, no backend).
    (overlay.querySelector('#nbe-icon-file') as HTMLInputElement | null)?.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        if (file.size > 256 * 1024) { (window as any).toast?.(t('navedit.iconTooBig') || 'Icon must be under 256 KB', 'warning'); return; }
        const reader = new FileReader();
        reader.onload = () => { if (typeof reader.result === 'string') setIcon(reader.result); };
        reader.readAsDataURL(file);
    });

    // Edit an existing custom button → prefill the form in "save" mode.
    list.querySelectorAll('.nbe-edit').forEach(btn =>
        btn.addEventListener('click', () => {
            const id = (btn as HTMLElement).dataset.edit!;
            const it = load().custom.find(x => x.id === id);
            if (!it) return;
            editingId = id;
            addDetails.open = true;
            labelInp.value = it.label;
            kindSel.value = it.kind;
            renderTarget();
            const tgt = overlay.querySelector('#nbe-add-target') as HTMLInputElement | HTMLSelectElement | null;
            if (tgt) tgt.value = it.target;
            setIcon(it.icon || 'folder');
            addGo.textContent = t('navedit.save') || 'Save changes';
            addDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }));

    addGo.addEventListener('click', () => {
        const label = labelInp.value.trim();
        const kind = kindSel.value as CustomNavItem['kind'];
        const target = (overlay.querySelector('#nbe-add-target') as HTMLInputElement | HTMLSelectElement)?.value.trim() || '';
        const warn = (m: string) => (window as any).toast?.(m, 'warning');
        if (kind === 'page' && !_pagesCache.length) { warn(t('navedit.noPages') || 'No pages yet — create one below'); return; }
        if (!label) { warn(t('navedit.label') || 'Label'); return; }
        if (!target) { warn(t('navedit.target') || 'Opens'); return; }
        if (kind === 'url' && !/^https?:\/\//i.test(target)) { warn(t('navedit.urlNeedsHttp') || 'URL must start with https://'); return; }
        const cur = readEditor(list);                       // keep current order/renames/hides
        if (editingId) {
            const it = cur.custom.find(x => x.id === editingId);
            if (it) { it.label = label; it.kind = kind; it.target = target; it.icon = chosenIcon; }
        } else {
            cur.custom.push({ id: 'custom:' + Math.random().toString(36).slice(2, 9), label, kind, target, icon: chosenIcon });
        }
        save(cur); applyNavbarConfig(); openNavbarEditor();
    });

    // ── Custom pages manager (with per-page permission toggles, default-deny) ──
    const pagesListEl = overlay.querySelector('#nbe-pages-list') as HTMLElement;
    let editingPageId: string | null = null;            // set while editing an existing page's source
    const pageCreateBtn = overlay.querySelector('#nbe-page-create') as HTMLButtonElement;
    const pageField = (id: string) => overlay.querySelector(id) as HTMLInputElement & HTMLTextAreaElement;
    const renderPagesList = async () => {
        if (!_pagesCache.length) {
            pagesListEl.innerHTML = `<p class="nbe-sub">${t('navedit.noPages') || 'No pages yet — create one below'}</p>`;
            return;
        }
        const rows = await Promise.all(_pagesCache.map(async p => {
            let grants = new Set<string>();
            let origins: string[] = [];
            try { grants = new Set((await invoke('page_grants_get', { id: p.id })) as string[]); } catch { /* deny */ }
            try { origins = (await invoke('page_net_origins_get', { id: p.id })) as string[]; } catch { /* none */ }
            const cap = (c: string, lbl: string) =>
                `<label class="nbe-cap"><input type="checkbox" data-cap="${c}" data-pg="${escAttr(p.id)}" ${grants.has(c) ? 'checked' : ''}> ${lbl}</label>`;
            return `<div class="nbe-page-block">
                <div class="nbe-page-row">
                    <span class="nbe-name">${escAttr(p.name)}</span>
                    <button class="btn btn-xs btn-ghost nbe-editpage" data-editpage="${escAttr(p.id)}">${t('navedit.editBtn') || 'Edit'}</button>
                    <button class="btn btn-xs btn-ghost nbe-importfile" data-importpage="${escAttr(p.id)}">${t('navedit.importFile') || 'Import file (.wasm…)'}</button>
                    <button class="nbe-del" data-delpage="${escAttr(p.id)}" data-tooltip="${t('common.delete') || 'Delete'}">✕</button>
                </div>
                <div class="nbe-presets">
                    <span class="nbe-preset-lbl">${t('navedit.preset') || 'Preset'}:</span>
                    <button class="btn btn-xs btn-ghost" data-preset="strict" data-pg="${escAttr(p.id)}" data-tooltip="${t('navedit.presetStrictTip') || 'Fully isolated — no permissions'}">${t('navedit.presetStrict') || 'Strict'}</button>
                    <button class="btn btn-xs btn-ghost" data-preset="mid" data-pg="${escAttr(p.id)}" data-tooltip="${t('navedit.presetMidTip') || 'Local only: storage, notifications, app info'}">${t('navedit.presetMid') || 'Mid'}</button>
                    <button class="btn btn-xs btn-ghost" data-preset="low" data-pg="${escAttr(p.id)}" data-tooltip="${t('navedit.presetLowTip') || 'All of Mid + internet (add origins below)'}">${t('navedit.presetLow') || 'Low'}</button>
                </div>
                <div class="nbe-caps">
                    ${cap('storage', t('navedit.capStorage') || 'storage')}
                    ${cap('notifications', t('navedit.capNotify') || 'notify')}
                    ${cap('network', t('navedit.capNetwork') || 'internet')}
                    ${cap('read', t('navedit.capRead') || 'app info')}
                    ${cap('clipboard', t('navedit.capClipboard') || 'clipboard')}
                    ${cap('system', t('navedit.capSystem') || 'system info')}
                </div>
                <input class="input nbe-net-origins" data-pg="${escAttr(p.id)}"
                    placeholder="${t('navedit.netOriginsPh') || 'Allowed origins for internet, comma-separated (https://api.example.com)'}"
                    value="${escAttr(origins.join(', '))}">
            </div>`;
        }));
        pagesListEl.innerHTML = rows.join('');
        pagesListEl.querySelectorAll('[data-delpage]').forEach(b =>
            b.addEventListener('click', async () => {
                try { await invoke('delete_custom_page', { id: (b as HTMLElement).dataset.delpage }); } catch { /* ignore */ }
                await loadPages(); await renderPagesList(); if (kindSel.value === 'page') renderTarget();
            }));
        pagesListEl.querySelectorAll('input[data-cap]').forEach(cb =>
            cb.addEventListener('change', async () => {
                const el = cb as HTMLInputElement;
                try {
                    await invoke('page_set_grant', { id: el.dataset.pg, cap: el.dataset.cap, granted: el.checked });
                    await refreshGrants(el.dataset.pg!);       // broker picks up the change immediately
                } catch (err) { (window as any).toast?.(String(err), 'error'); }
            }));
        pagesListEl.querySelectorAll('.nbe-net-origins').forEach(inp =>
            inp.addEventListener('change', async () => {
                const el = inp as HTMLInputElement;
                const list = el.value.split(',').map(s => s.trim()).filter(Boolean);
                try { await invoke('page_set_net_origins', { id: el.dataset.pg, origins: list }); }
                catch (err) { (window as any).toast?.(String(err), 'error'); }
            }));
        // Permission presets: one click sets all capabilities to a safe level.
        const PRESETS: Record<string, string[]> = {
            strict: [],
            mid: ['storage', 'notifications', 'read'],
            low: ['storage', 'notifications', 'read', 'network', 'clipboard'],
        };
        // `system` is the most powerful — never auto-granted by a preset; the user
        // must tick it explicitly.
        const ALL_CAPS = ['storage', 'notifications', 'read', 'network', 'clipboard', 'system'];
        pagesListEl.querySelectorAll('[data-preset]').forEach(b =>
            b.addEventListener('click', async () => {
                const el = b as HTMLElement;
                const id = el.dataset.pg!;
                const want = new Set(PRESETS[el.dataset.preset!] || []);
                try {
                    for (const c of ALL_CAPS) await invoke('page_set_grant', { id, cap: c, granted: want.has(c) });
                    await refreshGrants(id);
                    await renderPagesList();
                    (window as any).toast?.(`${t('navedit.preset') || 'Preset'}: ${el.dataset.preset}`, 'success');
                } catch (err) { (window as any).toast?.(String(err), 'error'); }
            }));
        pagesListEl.querySelectorAll('[data-editpage]').forEach(b =>
            b.addEventListener('click', async () => {
                const id = (b as HTMLElement).dataset.editpage!;
                try {
                    const src = await invoke('get_custom_page_source', { id }) as { name: string; html: string; css: string; js: string };
                    (overlay.querySelector('.nbe-pages') as HTMLDetailsElement).open = true;
                    pageField('#nbe-page-name').value = src.name;
                    pageField('#nbe-page-html').value = src.html;
                    pageField('#nbe-page-css').value = src.css;
                    pageField('#nbe-page-js').value = src.js;
                    editingPageId = id;
                    pageCreateBtn.textContent = t('navedit.save') || 'Save changes';
                    pageCreateBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } catch (err) { (window as any).toast?.(String(err), 'error'); }
            }));
        pagesListEl.querySelectorAll('[data-importpage]').forEach(b =>
            b.addEventListener('click', async () => {
                const id = (b as HTMLElement).dataset.importpage!;
                try {
                    const path = await pickFile({ filters: [{ name: 'Page asset', extensions: ['wasm', 'js', 'mjs', 'json', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'woff2', 'txt', 'csv'] }] });
                    if (!path) return;
                    const base = String(path).split(/[\\/]/).pop() || 'asset';
                    const name = await invoke('import_page_file', { id, srcPath: path, destName: base });
                    (window as any).toast?.((t('navedit.fileImported') || 'File imported') + ': ' + name, 'success');
                } catch (err) { (window as any).toast?.(String(err), 'error'); }
            }));
    };
    loadPages().then(() => { renderPagesList(); if (kindSel.value === 'page') renderTarget(); });
    overlay.querySelector('#nbe-page-create')?.addEventListener('click', async () => {
        const name = (overlay.querySelector('#nbe-page-name') as HTMLInputElement).value.trim();
        const html = (overlay.querySelector('#nbe-page-html') as HTMLTextAreaElement).value;
        const css = (overlay.querySelector('#nbe-page-css') as HTMLTextAreaElement).value;
        const js = (overlay.querySelector('#nbe-page-js') as HTMLTextAreaElement).value;
        if (!name) { (window as any).toast?.(t('navedit.pageName') || 'Page name', 'warning'); return; }
        try {
            if (editingPageId) {
                await invoke('update_custom_page', { id: editingPageId, name, html, css, js });
                // The page view caches its bundle; drop any open view for this page so it
                // reloads the new source next time it's opened.
                document.querySelectorAll(`.custom-page-frame[data-page-id="${cssEsc(editingPageId)}"]`).forEach(f => (f.closest('.view') as HTMLElement | null)?.remove());
                (window as any).toast?.(t('navedit.pageSaved') || 'Page saved', 'success');
            } else {
                await invoke('create_custom_page', { name, html, css, js });
                (window as any).toast?.(t('navedit.pageCreated') || 'Page created', 'success');
            }
            editingPageId = null;
            pageCreateBtn.textContent = t('navedit.createPage') || 'Create page';
            await loadPages(); renderPagesList(); if (kindSel.value === 'page') renderTarget();
            pageField('#nbe-page-name').value = '';
            pageField('#nbe-page-html').value = '';
            pageField('#nbe-page-css').value = '';
            pageField('#nbe-page-js').value = '';
        } catch (e) { (window as any).toast?.(String(e), 'error'); }
    });

    // Live rename + hide.
    list.querySelectorAll('.nbe-name').forEach(inp =>
        inp.addEventListener('input', commit));
    list.querySelectorAll('.nbe-eye').forEach(btn =>
        btn.addEventListener('click', () => {
            if ((btn as HTMLButtonElement).disabled) return;
            const hidden = btn.classList.toggle('is-hidden');
            btn.innerHTML = hidden ? eyeOff() : eyeOn();
            commit();
        }));
    // Pointer-based reorder (reliable in WebView2).
    list.querySelectorAll('.nbe-grip').forEach(grip =>
        grip.addEventListener('mousedown', (e) => startRowDrag(e as MouseEvent, grip.closest('.nbe-row') as HTMLElement, list, commit)));

    // The Share/Import menu: opens upward (the actions bar is the modal's bottom edge),
    // closes on any choice or outside click.
    {
        const btn = overlay.querySelector('#nbe-share-menu-btn') as HTMLElement | null;
        const menu = overlay.querySelector('#nbe-share-menu') as HTMLElement | null;
        if (btn && menu) {
            btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
            menu.addEventListener('click', () => { menu.hidden = true; });
            overlay.addEventListener('click', () => { menu.hidden = true; });
        }
    }

    // The page code editors are real editors, not form fields: Tab inserts a tab
    // instead of leaving the textarea. Escape still exits for keyboard users.
    overlay.querySelectorAll('.nbe-code').forEach(ta =>
        ta.addEventListener('keydown', (e) => {
            const ev = e as KeyboardEvent;
            if (ev.key !== 'Tab') return;
            ev.preventDefault();
            const el = ta as HTMLTextAreaElement;
            const s = el.selectionStart, epos = el.selectionEnd;
            el.value = el.value.slice(0, s) + '\t' + el.value.slice(epos);
            el.selectionStart = el.selectionEnd = s + 1;
        }));

    overlay.querySelector('#nbe-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#nbe-done')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#nbe-reset')?.addEventListener('click', () => {
        save({ ...EMPTY_CFG });
        // restoring original labels/order + removing custom views is cleanest via a reload
        location.reload();
    });

    // Share / import the whole navbar config (short code + bmm:// link, like card-order).
    overlay.querySelector('#nbe-share')?.addEventListener('click', async () => {
        const link = `bmm://settings/navbar?code=${encodeURIComponent(exportNavCode())}`;
        try { await navigator.clipboard.writeText(link); } catch { /* ignore */ }
        (window as any).toast?.(t('navedit.copied') || 'Navigation link copied to clipboard', 'success');
    });
    const importRow = overlay.querySelector('#nbe-import-row') as HTMLElement;
    overlay.querySelector('#nbe-import')?.addEventListener('click', () => {
        importRow.style.display = importRow.style.display === 'none' ? 'flex' : 'none';
    });
    // Full bundle (navbar + custom icons + custom pages) as a .bmmnav file.
    overlay.querySelector('#nbe-export-file')?.addEventListener('click', () => exportNavBundle());
    overlay.querySelector('#nbe-import-file')?.addEventListener('click', () => importNavBundle());
    overlay.querySelector('#nbe-import-apply')?.addEventListener('click', () => {
        const val = (overlay.querySelector('#nbe-import-input') as HTMLInputElement).value;
        const cfg = parseNavCode(val);
        if (!cfg) { (window as any).toast?.(t('navedit.badCode') || 'Invalid navigation code', 'error'); return; }
        save(cfg); applyNavbarConfig(); openNavbarEditor();
        (window as any).toast?.(t('cardorder.applied') || 'Applied', 'success');
    });
}

function readEditor(list: HTMLElement): NavbarConfig {
    const order: string[] = [];
    const hidden: Record<string, boolean> = {};
    const labels: Record<string, string> = {};
    const groups: Record<string, { label: string }> = {};
    list.querySelectorAll('.nbe-row').forEach(row => {
        const id = (row as HTMLElement).dataset.id!;
        order.push(id);
        if (id.startsWith('group:')) {
            groups[id] = { label: (row.querySelector('.nbe-name') as HTMLInputElement)?.value.trim() || '' };
            return;
        }
        if (row.querySelector('.nbe-eye')?.classList.contains('is-hidden')) hidden[id] = true;
        const name = (row.querySelector('.nbe-name') as HTMLInputElement)?.value.trim();
        const orig = origLabel(id);
        if (name && name !== orig) labels[id] = name;
    });
    return { order, hidden, labels, custom: load().custom, groups };   // custom items managed separately
}

function orderedIds(): string[] {
    const cfg = load();
    const present = new Set(items().map(idOf));
    // Keep valid group dividers + present items, in saved order; append any new items.
    const ordered = cfg.order.filter(e => e.startsWith('group:') ? !!cfg.groups[e] : present.has(e));
    for (const id of present) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
}
function origLabel(id: string): string {
    const el = items().find(e => idOf(e) === id);
    const lbl = el ? labelEl(el) : null;
    const key = lbl?.dataset.i18nOrig || lbl?.getAttribute('data-i18n') || id;
    return t(key) || id;
}

// ── Pointer-based row reorder ──
function startRowDrag(ev: MouseEvent, row: HTMLElement, list: HTMLElement, onDrop: () => void): void {
    if (ev.button !== 0) return; ev.preventDefault();
    row.classList.add('nbe-dragging');
    document.body.style.userSelect = 'none';
    const onMove = (e: MouseEvent) => {
        const rows = Array.from(list.querySelectorAll('.nbe-row')) as HTMLElement[];
        const target = rows.find(r => {
            const rc = r.getBoundingClientRect();
            return e.clientY < rc.top + rc.height / 2;
        });
        if (target && target !== row) list.insertBefore(row, target);
        else if (!target && rows[rows.length - 1] !== row) list.appendChild(row);
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        row.classList.remove('nbe-dragging');
        onDrop();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function iconGridHtml(selected: string): string {
    const reg = iconRegistry();
    return Object.keys(reg).map(k =>
        `<button type="button" class="nbe-icon-opt ${k === selected ? 'sel' : ''}" data-icon="${escAttr(k)}">${reg[k]}</button>`
    ).join('');
}
/** Built-in (non-custom) nav items as {id, label}, for the "Internal tab" picker. */
function builtinViewOptions(): string {
    return items()
        .filter(el => !idOf(el).startsWith('custom:') && el.dataset.view)
        .map(el => `<option value="${el.dataset.view}">${escAttr(labelEl(el)?.textContent?.trim() || el.dataset.view!)}</option>`)
        .join('');
}
/** Every dialog in the app (id^="modal-"), as {id} options — so nobody types a raw id. */
// Curated, known-good dialog actions. Each runs the REAL opener (which sets the
// modal up properly) instead of blindly toggling `.open` on an element that may
// need parameters — that is what made the raw modal-id list buggy/untranslated.
interface ModalActionDef { value: string; def: string; run: () => void; avail: () => boolean; }
function modalActionDefs(): ModalActionDef[] {
    const w = window as any;
    // A global opener exposed by a feature module (no parameters needed).
    const opener = (value: string, def: string, fn: string): ModalActionDef =>
        ({ value, def, run: () => w[fn]?.(), avail: () => typeof w[fn] === 'function' });
    // A standalone manager opened by clicking its existing trigger button.
    const trigger = (value: string, def: string, btnId: string): ModalActionDef =>
        ({ value, def, run: () => (document.getElementById(btnId) as HTMLElement | null)?.click(), avail: () => !!document.getElementById(btnId) });
    return [
        opener('newProfile', 'New profile', 'openNewProfileModal'),
        opener('license', 'License', 'openLicenseModal'),
        opener('privacy', 'Privacy policy', 'openPrivacyModal'),
        opener('tos', 'Terms of service', 'openTosModal'),
        opener('eula', 'EULA', 'openEulaModal'),
        opener('hashStats', 'Hashing stats', 'showHashingStats'),
        trigger('storage', 'Storage manager', 'btn-open-storage'),
        trigger('benchmark', 'Benchmark', 'btn-open-benchmark'),
        trigger('themeEditor', 'Theme editor', 'btn-open-theme-editor'),
        trigger('bans', 'Bans manager', 'btn-open-bans'),
        trigger('whitelist', 'Whitelist manager', 'btn-open-whitelist'),
        trigger('monitoring', 'Monitoring', 'btn-open-monitoring'),
        trigger('repoHub', 'Repo hub', 'btn-open-repo-hub'),
        trigger('debug', 'Debug', 'btn-open-debug'),
    ].filter(a => a.avail());
}
function modalActionLabel(d: ModalActionDef): string { return t('navedit.act.' + d.value) || d.def; }
function modalActionOptions(): string {
    return modalActionDefs().map(d => `<option value="${escAttr(d.value)}">${escAttr(modalActionLabel(d))}</option>`).join('');
}
function runModalAction(value: string): boolean {
    const d = modalActionDefs().find(x => x.value === value);
    if (d) { d.run(); return true; }
    return false;
}
function pageOptions(): string {
    if (!_pagesCache.length) return `<option value="" disabled selected>${t('navedit.noPages') || 'No pages yet — create one below'}</option>`;
    return _pagesCache.map(p => `<option value="${escAttr(p.id)}">${escAttr(p.name)}</option>`).join('');
}
function targetFieldHtml(kind: string): string {
    if (kind === 'view') return `<select class="input" id="nbe-add-target">${builtinViewOptions()}</select>`;
    if (kind === 'modal') return `<select class="input" id="nbe-add-target">${modalActionOptions()}</select>`;
    if (kind === 'page') return `<select class="input" id="nbe-add-target">${pageOptions()}</select>`;
    return `<input class="input" id="nbe-add-target" placeholder="https://example.com">`; // url
}

function escAttr(s: string): string {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function eyeOn(): string {
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
}
function eyeOff(): string {
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
}
