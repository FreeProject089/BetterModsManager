// analytics.ts — opt-in, privacy-first telemetry client.
//
// Nothing is tracked or sent until the user explicitly consents (GDPR opt-in).
// On first start a clear consent modal explains what's collected and why it helps
// the BMM team. Events are buffered locally by the Rust side and flushed in
// batches to a PostHog-compatible endpoint (configured in links-config; empty =
// stays local). The user can change their mind, export, or delete at any time.

import { invoke } from './api.js';
import { t } from './i18n.js';
import { getLinks } from './links-config.js';
import { escHtml } from './utils.js';

let _consent: boolean | null = null;          // null = not asked yet
let _distinctId = '';
let _flushTimer: number | null = null;
let _packetsPoll: number | null = null;   // re-polls packet deletion status while the list is open
let _sessionStart = Date.now();
let _journey: string[] = [];                   // ordered view path this session
let _seq = 0;                                  // event sequence within the session
let _viewEnterTs = Date.now();                 // for per-view dwell time
let _currentView = '';
let _currentModal: string | null = null;       // modal currently open (perf attribution)
let _currentCounted = false;                   // did the current view get counted?
let _seenViews = new Set<string>();            // views opened ≥ once (3s-rule exemption)
let _pendingEnter: { view: string; timer: number } | null = null;

function loadSeenViews(): void {
    try { _seenViews = new Set(JSON.parse(localStorage.getItem('bmm_seen_views') || '[]')); } catch { _seenViews = new Set(); }
}
function persistSeenViews(): void {
    try { localStorage.setItem('bmm_seen_views', JSON.stringify([..._seenViews])); } catch {}
}

/** A new random id every app launch → lets us group events into sessions.
 *  Reassigned to the saved id when a page reload (Ctrl+F5) resumes a session. */
let _sessionId = (() => {
    try { return (crypto as any).randomUUID(); }
    catch { return 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
})();

// sessionStorage survives a reload but is cleared when the app window closes, so
// its presence means "this load is a refresh, resume the session" (a refresh
// must NOT count as a session end).
function persistSession(): void {
    try { sessionStorage.setItem('bmm_sess', JSON.stringify({ id: _sessionId, start: _sessionStart, journey: _journey.slice(-200) })); } catch {}
}

/** A persistent anonymous id (stable across launches) as a fallback identity when
 *  the Creator ID isn't available — so it's "always the same person", never who. */
function anonId(): string {
    try {
        let id: string = localStorage.getItem('bmm_anon_id') || '';
        if (!id) {
            id = (crypto as any).randomUUID?.() || ('a-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
            localStorage.setItem('bmm_anon_id', id);
        }
        return id;
    } catch { return ''; }
}

/** First-seen timestamp (for retention cohorts), set once. */
function firstSeen(): string {
    try {
        let v = localStorage.getItem('bmm_first_seen');
        if (!v) { v = new Date().toISOString(); localStorage.setItem('bmm_first_seen', v); }
        return v;
    } catch { return ''; }
}

function baseProps(): Record<string, any> {
    return { session_id: _sessionId, seq: ++_seq, view: _currentView || undefined, modal: _currentModal || undefined };
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function initAnalytics(): Promise<void> {
    try { _consent = (await invoke('get_analytics_consent')) as boolean | null; }
    catch { _consent = null; }
    // NOTE: we no longer pop the consent modal on a timer here — the startup
    // sequence (app.ts) calls maybeShowConsentModal() AFTER the TOS + Privacy
    // modals so it appears last and in order.
    if (_consent === true) await startCollection();
}

/** Show the telemetry consent modal only if the user hasn't decided yet.
 *  Resolves once they decide (or immediately if already decided). Called by the
 *  first-run startup sequence so it appears after every other modal. */
export async function maybeShowConsentModal(): Promise<void> {
    let consent: boolean | null = _consent;
    try { consent = (await invoke('get_analytics_consent')) as boolean | null; } catch {}
    _consent = consent;
    if (consent !== null) return;
    await showConsentModal();
}

/** Track an event (no-op unless the user opted in). */
export function track(event: string, props: Record<string, any> = {}): void {
    if (_consent !== true) return;
    invoke('analytics_track', { event, properties: { ...baseProps(), ...props }, distinctId: _distinctId }).catch(() => {});
}

/** Track a view navigation — funnel/retention friendly: emits a page_leave (with
 *  dwell time) for the previous view and a page_enter for the new one, and keeps
 *  the ordered journey for path analysis. */
export function trackView(view: string): void {
    if (_consent !== true) { _currentView = view; return; }
    const now = Date.now();
    // Only emit a page_leave for a view we actually counted, so enters/leaves stay paired.
    if (_currentView && _currentView !== view && _currentCounted) {
        track('page_leave', { view: _currentView, dwell_ms: now - _viewEnterTs, to: view });
    }
    // a still-pending (uncounted, <3s) repeat visit is abandoned
    if (_pendingEnter) { clearTimeout(_pendingEnter.timer); _pendingEnter = null; }

    _currentView = view;
    _viewEnterTs = now;
    _currentCounted = false;
    _journey.push(view);
    if (_journey.length > 200) _journey.shift();
    const from = _journey[_journey.length - 2] || null;
    const depth = _journey.length;

    // 3-second rule: a page only counts if it stays open ≥3s — UNLESS it's the
    // first time this view is ever opened (first open always counts).
    if (!_seenViews.has(view)) {
        _seenViews.add(view);
        persistSeenViews();
        _currentCounted = true;
        track('page_enter', { view, from, depth, first_visit: true });
    } else {
        const timer = window.setTimeout(() => {
            _pendingEnter = null;
            if (_currentView === view) {
                _currentCounted = true;
                track('page_enter', { view, from, depth, first_visit: false });
            }
        }, 3000);
        _pendingEnter = { view, timer };
    }
}

export function getConsent(): boolean | null { return _consent; }

export async function setConsent(enabled: boolean): Promise<void> {
    const wasOff = _consent !== true;
    _consent = enabled;
    try { await invoke('set_analytics_consent', { enabled }); } catch {}
    if (enabled) {
        await startCollection();
        // First opt-in: run one benchmark now so the team gets a baseline.
        if (wasOff) setTimeout(() => runTelemetryBenchmark(true), 3000);
    } else stopCollection();
}

export async function exportData(): Promise<string> {
    try { return await invoke('analytics_export') as string; } catch { return '[]'; }
}
export async function clearData(): Promise<void> {
    try { await invoke('analytics_clear'); } catch {}
}

// ── Collection lifecycle ───────────────────────────────────────────────────────
async function startCollection(): Promise<void> {
    loadSeenViews();
    try {
        const profile: any = await invoke('analytics_system_profile');
        // Stable anonymous identity: Creator ID if available, else a persistent uuid.
        _distinctId = profile?.distinct_id || anonId();
        const extras = await bmmProfileExtras();
        // Resume the session on a reload (Ctrl+F5) instead of starting a new one.
        const saved = (() => { try { return JSON.parse(sessionStorage.getItem('bmm_sess') || 'null'); } catch { return null; } })();
        const resumed = !!(saved && saved.id);
        if (resumed) {
            _sessionId = saved.id;
            if (saved.start) _sessionStart = saved.start;
            if (Array.isArray(saved.journey)) _journey = saved.journey;
        }
        // Identify the (anonymous) user once with spec profile + BMM-specific bits + retention anchors.
        track('$identify', { $set: { ...profile, ...extras, anon_id: anonId(), first_seen: firstSeen() } });
        if (!resumed) {
            track('session_start', { ts: new Date().toISOString(), first_seen: firstSeen() });
        }
        persistSession();
        (window as any).bmmTrack = (event: string, props?: Record<string, any>) => track(event, props || {});
        initModalTracking();
        initAutocapture();
        registerCloseHandler();
        // Catalog every modal the app exposes (once the DOM has settled), so the
        // dashboard can target modals that were never opened yet.
        setTimeout(sendModalCatalog, 4000);
    } catch {}
    // Periodic flush; also flush before the window closes.
    if (_flushTimer === null) _flushTimer = window.setInterval(() => flush(), 90000);
    // On unload we DON'T end the session — a reload (Ctrl+F5) also fires this and
    // must keep the session alive. We just persist state + flush; the real
    // session_end is sent by the Tauri close handler (registerCloseHandler).
    window.addEventListener('beforeunload', () => { persistSession(); flush(); }, { once: true });
    startPerfSampling();
    collectWebVitals();
    maybePeriodicBenchmark();   // weekly telemetry benchmark (if allowed)
    startSessionReplay();       // rrweb visual replay (privacy-masked by default)
    hookConsoleTelemetry();
    startRustLogPolling();
    flush();
}

let _telemetryReplay: any = null;

// Visual session replay: stream rrweb chunks through the normal telemetry
// transport as `$replay` events (the server routes them to a dedicated table).
// Off unless replay capture is enabled (default on; user can disable it).
function startSessionReplay(): void {
    try {
        if (localStorage.getItem('bmm_replay_enabled') === '0') return;
    } catch {}
    import('./replay-recorder.js')
        .then((m) => {
            if (!_telemetryReplay) _telemetryReplay = new m.TelemetryReplay((payload: any) => track('$replay', payload));
            _telemetryReplay.start();
        })
        .catch(() => { /* rrweb unavailable — silently skip */ });
}

// Core Web Vitals of the BMM WebView (Chromium APIs), sent once per launch.
function collectWebVitals(): void {
    if (_consent !== true) return;
    const v: any = {};
    try { const nav = performance.getEntriesByType('navigation')[0] as any; if (nav) v.ttfb = Math.round(nav.responseStart); } catch {}
    try {
        const po = new PerformanceObserver(list => { for (const e of list.getEntries()) { if (e.name === 'first-contentful-paint') v.fcp = Math.round(e.startTime); } });
        po.observe({ type: 'paint', buffered: true } as any);
    } catch {}
    try {
        const po = new PerformanceObserver(list => { const es = list.getEntries(); v.lcp = Math.round(es[es.length - 1].startTime); });
        po.observe({ type: 'largest-contentful-paint', buffered: true } as any);
    } catch {}
    try {
        let cls = 0;
        const po = new PerformanceObserver(list => { for (const e of list.getEntries() as any[]) if (!e.hadRecentInput) cls += e.value; v.cls = Math.round(cls * 1000) / 1000; });
        po.observe({ type: 'layout-shift', buffered: true } as any);
    } catch {}
    try {
        let worst = 0;
        const po = new PerformanceObserver(list => { for (const e of list.getEntries() as any[]) worst = Math.max(worst, e.duration); v.inp = Math.round(worst); });
        po.observe({ type: 'event', durationThreshold: 16, buffered: true } as any);
    } catch {}
    // Give the observers a few seconds, then send whatever we captured.
    setTimeout(() => { if (_consent === true && Object.keys(v).length) track('webvitals', v); }, 6000);
}

// Hook JS console to send warn/error logs via telemetry
function hookConsoleTelemetry(): void {
    const _orig: any = { warn: null, error: null };
    const LEVELS = ['warn', 'error'];
    for (const level of LEVELS) {
        _orig[level] = (console as any)[level].bind(console);
        (console as any)[level] = (...args: any[]) => {
            try {
                if (_consent === true) {
                    const msg = args.map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); } }).join(' ').slice(0, 2000);
                    track('$log_js', { level, msg });
                }
            } catch {}
            if (_orig[level]) _orig[level](...args);
        };
    }
}

let _lastRustLogLength = 0;
let _rustLogTimer: number | null = null;

// Periodically poll the Rust log file for new lines containing warnings or errors
function startRustLogPolling(): void {
    if (_rustLogTimer !== null) return;
    _rustLogTimer = window.setInterval(async () => {
        if (_consent !== true) return;
        try {
            const logStr = await invoke('read_session_log_tail', { maxBytes: 1048576 }) as string;
            if (!logStr) return;
            const newLen = logStr.length;
            if (newLen > _lastRustLogLength) {
                let diff = '';
                if (_lastRustLogLength === 0 || newLen < _lastRustLogLength) diff = logStr;
                else diff = logStr.slice(_lastRustLogLength);
                _lastRustLogLength = newLen;

                const lines = diff.split('\n').filter(line => {
                    const l = line.toLowerCase();
                    return l.includes('warn') || l.includes('error');
                });
                if (lines.length > 0) {
                    track('$log_rust', { log: lines.join('\n').slice(0, 5000) });
                }
            }
        } catch {}
    }, 15000);
}

// BMM-specific profile bits: active theme (+ custom/predef), language, Tasky settings.
async function bmmProfileExtras(): Promise<Record<string, any>> {
    const ls = (k: string, dflt = true) => localStorage.getItem(k) !== 'false' ? dflt : false;
    const theme = localStorage.getItem('bmm_active_theme') || 'bmm-default';
    let theme_kind = 'predef';
    try {
        // BUILTIN_THEMES is loaded from disk asynchronously and REASSIGNED, so we must
        // read the live module binding (a destructured `const { BUILTIN_THEMES }` would
        // capture the initial empty array → every theme wrongly classified as "custom").
        // Make sure it's actually populated before deciding.
        const themeEngine = await import('../features/themes/theme-engine.js');
        if (!themeEngine.BUILTIN_THEMES.length) {
            try { await themeEngine.loadBuiltinThemes(); } catch {}
        }
        if (!themeEngine.BUILTIN_THEMES.some((b: any) => b.id === theme)) theme_kind = 'custom';
    } catch {}
    let language = '';
    try { const { getLang } = await import('./i18n.js'); language = getLang(); } catch {}
    return {
        theme, theme_kind, language,
        tasky: {
            visible: ls('bmm_tasky_visible'),
            animations: ls('bmm_tasky_animated'),
            tooltips: ls('bmm_tasky_tooltip'),
        },
        counts: await bmmContentCounts(),
        fs_security_mode: await fsSecurityMode(),
    };
}

// How BMM accesses the filesystem (the "Security Access Mode" the user picked at
// first launch — e.g. standard / strict). Read from the settings, not localStorage.
async function fsSecurityMode(): Promise<string | undefined> {
    try { const st: any = await invoke('get_settings'); return st?.fs_security_mode || undefined; } catch { return undefined; }
}

// Best-effort BMM content inventory (counts only, never contents): how many
// mods / profiles / plugins / modpacks / tags / launch packs / apps / languages
// / installed themes the user has. Each probe is independent and silently
// skipped if its command isn't argless on this build.
async function bmmContentCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const sizeOf = (r: any): number =>
        Array.isArray(r) ? r.length : (r && typeof r === 'object' ? Object.keys(r).length : 0);
    const grab = async (key: string, cmd: string) => {
        try { counts[key] = sizeOf(await invoke(cmd)); } catch { /* command needs args on this build */ }
    };
    await Promise.all([
        grab('mods', 'get_mods_all_profiles'),
        grab('profiles', 'get_profiles'),
        grab('tags', 'get_tags'),
        grab('launchpacks', 'get_launch_packs'),
        grab('plugins', 'get_installed_plugins'),
        grab('modpacks', 'load_modpacks'),
        grab('apps', 'get_apps_state'),
        grab('languages', 'get_available_languages'),
        grab('themes_installed', 'list_installed_themes'),
    ]);
    return counts;
}

// Auto-track modal opens (any overlay gaining `.open`) so the team sees which
// modals users actually open — without editing every modal call-site.
let _modalPoll: number | null = null;
const _modalLastOpen: Record<string, number> = {};
const MODAL_DEDUPE_MS = 2500;

function initModalTracking(): void {
    if (_modalPoll) return;
    const open = new WeakSet<Element>();
    _modalPoll = window.setInterval(() => {
        if (_consent !== true) return;
        const els = document.querySelectorAll('[class*="modal" i].open, [class*="dialog" i].open, [id*="modal" i].open, [id*="dialog" i].open, [role="dialog"].open, .active.modal, .show.modal, .visible.modal');
        els.forEach(el => {
            if (!open.has(el)) {
                open.add(el);
                const name = modalName(el);
                _currentModal = name;
                const now = Date.now();
                if (now - (_modalLastOpen[name] || 0) >= MODAL_DEDUPE_MS) {
                    _modalLastOpen[name] = now;
                    track('modal_open', { name, title: modalTitle(el) });
                }
            }
        });
    }, 500);
}

function modalName(el: Element): string {
    return (el.id
        || el.getAttribute('data-modal')
        || el.querySelector('.modal-title, .modal-header h2, h2, h3')?.textContent?.trim()
        || 'modal').slice(0, 48);
}
function modalTitle(el: Element): string | undefined {
    const tx = el.querySelector('.modal-title, .modal-header h2, h2, h3')?.textContent?.trim();
    return tx ? tx.slice(0, 80) : undefined;
}

// Canonical list of every modal type BMM exposes (real element ids where they
// exist in index.html, + descriptive keys for the dynamically-built ones). Sent
// with the catalog so funnels/goals list ALL modals even before one is opened.
const KNOWN_MODALS = [
    // profiles
    'modal-new-profile', 'modal-edit-profile', 'modal-delete-profile',
    // mods
    'modal-add-mod', 'modal-mod-tags', 'modal-delete-mod', 'modal-integrity', 'modal-chk-sha-lazy',
    // conflicts
    'modal-conflict-warning', 'modal-conflict-tree', 'modal-conflict-file-selector',
    'modal-global-conflicts', 'modal-activation-warning', 'modal-duplicate-folder-warning',
    // storage / launchpacks / apps
    'modal-storage', 'modal-launchpack', 'modal-launchpack-delete', 'modal-app-picker',
    'apps-detail-modal', 'apps-install-modal', 'cr-app-modal',
    // credits / docs
    'modal-contributor-detail', 'modal-docs-diagram',
    // server repo
    'modal-repo-update', 'modal-repo-hub', 'modal-repo-browser', 'modal-repo-sync-summary',
    'modal-repo-history', 'modal-repo-verify-detail', 'modal-monitoring', 'modal-whitelist', 'modal-bans',
    // i18n / feedback / crash
    'modal-i18n-sandbox', 'modal-crash-report', 'modal-betahub-bugreport', 'modal-betahub-feedback',
    // history / legal / misc
    'modal-history', 'modal-history-detail', 'modal-license', 'modal-tos', 'modal-privacy',
    'modal-mapper-input', 'modal-mapper-confirm', 'modal-archive-explorer', 'modal-stack',
    // scheduling / updates / perf / language / security
    'modal-scheduler', 'modal-update-notes', 'modal-advanced-perf-overlay', 'modal-lang-select',
    'modal-security-choice', 'update-available-modal', 'ptb-welcome-modal', 'modal-confirm-generic',
    'export-progress-overlay',
    // dynamically-built (descriptive keys; real id/title captured on open)
    'theme-catalogue', 'theme-editor', 'benchmark', 'interactive-tutorial',
];

// Enumerate every modal-like element in the DOM and report the catalog once, so
// the dashboard can offer ALL modals (not just ones already opened) for funnels
// and goals. Only ids/names are sent — never content.
function sendModalCatalog(): void {
    if (_consent !== true) return;
    try {
        const els = document.querySelectorAll('[class*="modal" i], [class*="dialog" i], [id*="modal" i], [id*="dialog" i], [role="dialog"]');
        const names = new Set<string>(KNOWN_MODALS);
        els.forEach(el => { const n = modalName(el); if (n && n !== 'modal') names.add(n); });
        track('modal_catalog', { names: [...names].slice(0, 400) });
    } catch {}
}

// Reliable session_end on a real app close → lets the dashboard tell a clean
// exit (offline) from a crash (no session_end). Best-effort across Tauri APIs.
function registerCloseHandler(): void {
    try {
        const w = (window as any).__TAURI__;
        const onClose = () => { trackSessionEnd(); flush(); };
        w?.event?.listen?.('tauri://close-requested', onClose);
        w?.event?.listen?.('tauri://destroyed', onClose);
        w?.window?.getCurrent?.()?.onCloseRequested?.(onClose);
    } catch {}
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();   // flush buffer, don't end the session
    });
}

// ── Lightweight autocapture (privacy-safe: labels/field-names only, no values) ──
let _acStarted = false;
let _acWindow = Date.now();
let _acCount = 0;
function acAllowed(): boolean {
    const now = Date.now();
    if (now - _acWindow > 10000) { _acWindow = now; _acCount = 0; }
    if (_acCount >= 60) return false;     // flood guard
    _acCount++;
    return true;
}
function initAutocapture(): void {
    if (_acStarted) return;
    _acStarted = true;

    let lastClickTag = '';
    let lastClickTime = 0;
    
    document.addEventListener('click', (e) => {
        if (_consent !== true) return;
        const el = (e.target as HTMLElement)?.closest('button, a, [role="button"], .btn, input[type="button"], input[type="submit"]') as HTMLElement | null;
        if (!el || !acAllowed()) return;
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || (el as HTMLInputElement).value || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        
        // Anti-spam: ignore rapid clicks on the exact same button/link
        const now = Date.now();
        const sig = tag + text;
        if (now - lastClickTime < 1500 && lastClickTag === sig) return;
        lastClickTime = now;
        lastClickTag = sig;

        // outbound vs in-app button
        const href = (el as HTMLAnchorElement).href;
        if (tag === 'a' && href && /^https?:/i.test(href) && !href.startsWith(location.origin)) {
            track('outbound', { url: href.slice(0, 200) });
        } else {
            track('click', { text, tag, id: el.id || undefined });
        }
    }, true);

    document.addEventListener('copy', () => { if (_consent === true && acAllowed()) track('copy', {}); }, true);

    document.addEventListener('submit', (e) => {
        if (_consent !== true || !acAllowed()) return;
        const f = e.target as HTMLFormElement;
        track('form_submit', { id: f?.id || f?.getAttribute('name') || undefined });
    }, true);

    document.addEventListener('change', (e) => {
        if (_consent !== true || !acAllowed()) return;
        const el = e.target as HTMLElement;
        if (!/^(input|select|textarea)$/i.test(el.tagName)) return;
        const field = el.getAttribute('name') || el.id || (el as HTMLInputElement).type || 'field';
        track('input_change', { field: String(field).slice(0, 40) });   // name only, never the value
    }, true);

    window.addEventListener('error', (e) => {
        if (_consent !== true) return;
        track('error', { message: String(e.message || 'error').slice(0, 160) });
    });
    window.addEventListener('unhandledrejection', (e: any) => {
        if (_consent !== true) return;
        track('error', { message: String(e?.reason?.message || e?.reason || 'rejection').slice(0, 160) });
    });
}

// ── Client performance metrics: FPS / frametime / JS heap ──────────────────────
let _perfStarted = false;
function startPerfSampling(): void {
    if (_perfStarted) return;
    _perfStarted = true;
    let frames = 0, lastT = performance.now(), worstFrame = 0, lastFrame = lastT, sumFrame = 0, frameSamples = 0;
    const loop = (t: number) => {
        const dt = t - lastFrame; lastFrame = t;
        if (dt > 0) { frames++; sumFrame += dt; frameSamples++; if (dt > worstFrame) worstFrame = dt; }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // Emit an aggregated perf sample every 30s (one event, not per-frame).
    window.setInterval(() => {
        if (_consent !== true) return;
        const now = performance.now();
        const secs = (now - lastT) / 1000;
        const fps = secs > 0 ? frames / secs : 0;
        const ftAvg = frameSamples > 0 ? sumFrame / frameSamples : 0;
        const heap = (performance as any).memory?.usedJSHeapSize;
        track('perf', {
            fps_avg: Math.round(fps * 10) / 10,
            frametime_avg_ms: Math.round(ftAvg * 100) / 100,
            frametime_worst_ms: Math.round(worstFrame * 100) / 100,
            js_heap_mb: heap ? Math.round(heap / 1048576 * 10) / 10 : undefined,
            view: _currentView || undefined,
        });
        frames = 0; lastT = now; worstFrame = 0; sumFrame = 0; frameSamples = 0;
    }, 30000);
}

// ── Weekly telemetry benchmark ─────────────────────────────────────────────────
const BENCH_ALLOW_KEY = 'bmm_telemetry_bench';   // '1' allow (default), '0' off
const BENCH_LAST_KEY  = 'bmm_telemetry_bench_last';
export function telemetryBenchAllowed(): boolean { return localStorage.getItem(BENCH_ALLOW_KEY) !== '0'; }
export function setTelemetryBenchAllowed(on: boolean): void { localStorage.setItem(BENCH_ALLOW_KEY, on ? '1' : '0'); }

// ── Session replay (rrweb) preferences ────────────────────────────────────────
const REPLAY_KEY      = 'bmm_replay_enabled';   // '1'/absent = on (default), '0' off
const REPLAY_FULL_KEY = 'bmm_replay_full';      // '1' = full/unmasked, else masked
export function replayEnabled(): boolean { return localStorage.getItem(REPLAY_KEY) !== '0'; }
export function replayFull(): boolean { return localStorage.getItem(REPLAY_FULL_KEY) === '1'; }

/** Run a quick sandbox benchmark and send its result (kept to last 3 server-side). */
export async function runTelemetryBenchmark(force = false): Promise<void> {
    if (_consent !== true) return;
    if (!force && !telemetryBenchAllowed()) return;
    try {
        const report: any = await invoke('run_app_benchmark', { mode: 'sandbox', realSources: [], scale: 'S' });
        const ops: Record<string, number> = {};
        (report?.results || []).forEach((o: any) => { if (o?.id) ops[o.id] = o.ms; });
        track('benchmark', { source: 'telemetry', dataset_bytes: report?.env?.dataset_bytes, total_ms: report?.total_ms, ops, report });
        localStorage.setItem(BENCH_LAST_KEY, String(Date.now()));
        flush();
    } catch {}
}

function maybePeriodicBenchmark(): void {
    if (_consent !== true || !telemetryBenchAllowed()) return;
    const last = parseInt(localStorage.getItem(BENCH_LAST_KEY) || '0', 10) || 0;
    const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
    if (Date.now() - last >= SEVEN_DAYS) {
        // Defer so it doesn't compete with startup work.
        setTimeout(() => runTelemetryBenchmark(), 60000);
    }
}

function stopCollection(): void {
    if (_flushTimer !== null) { clearInterval(_flushTimer); _flushTimer = null; }
    if (_telemetryReplay) _telemetryReplay.stop();
}

let _sessionEnded = false;
function trackSessionEnd(): void {
    if (_sessionEnded) return;
    _sessionEnded = true;
    const props = {
        duration_sec: Math.round((Date.now() - _sessionStart) / 1000),
        views_visited: _journey.length,
        journey: _journey.slice(-40),
    };
    track('session_end', props);
    // Also deliver it RIGHT NOW via sendBeacon — the queued flush often doesn't
    // complete before the process exits, which would make a clean close look
    // like a crash. sendBeacon is built for unload and is reliable.
    beaconSessionEnd(props);
}

// Direct, fire-and-forget delivery of one batch on app close (bypasses the
// Rust queue so the clean-exit signal actually arrives).
function beaconSessionEnd(props: Record<string, any>): void {
    try {
        if (_consent !== true) return;
        const links = getLinks();
        const endpoint = (links.analytics_endpoint || '').trim();
        if (!endpoint || !navigator.sendBeacon) return;
        const ev = {
            event: 'session_end',
            distinct_id: _distinctId,
            timestamp: new Date().toISOString(),
            properties: { ...baseProps(), ...props },
        };
        const body = JSON.stringify({ api_key: links.analytics_key || '', packet_id: `beacon-${_sessionId}`, batch: [ev] });
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    } catch {}
}

function flush(): void {
    if (_consent !== true) return;
    const links = getLinks();
    invoke('analytics_flush', { endpoint: links.analytics_endpoint || '', apiKey: links.analytics_key || '' }).catch(() => {});
}

// ── Settings → Privacy card wiring ──────────────────────────────────────────────
export function initPrivacySettings(): void {
    const toggle = document.getElementById('analytics-toggle') as HTMLInputElement | null;
    if (!toggle) return;
    refreshPrivacyUI();
    if ((toggle as any).dataset.wired) return;
    (toggle as any).dataset.wired = '1';
    toggle.addEventListener('change', async () => { await setConsent(toggle.checked); refreshPrivacyUI(); });

    const benchToggle = document.getElementById('analytics-bench-toggle') as HTMLInputElement | null;
    if (benchToggle) {
        benchToggle.checked = telemetryBenchAllowed();
        benchToggle.addEventListener('change', () => setTelemetryBenchAllowed(benchToggle.checked));
    }

    // Session replay toggles. Enabling/disabling starts/stops recording live;
    // changing the masking mode re-arms rrweb so the new setting takes effect now.
    const replayToggle = document.getElementById('analytics-replay-toggle') as HTMLInputElement | null;
    const replayFullToggle = document.getElementById('analytics-replay-full-toggle') as HTMLInputElement | null;
    const restartReplay = () => {
        import('./replay-recorder.js').then((m) => {
            if (_telemetryReplay) _telemetryReplay.stop();
            if (_consent === true && replayEnabled()) {
                if (!_telemetryReplay) _telemetryReplay = new m.TelemetryReplay((payload: any) => track('$replay', payload));
                _telemetryReplay.listener.requiresMasking = !replayFull();
                _telemetryReplay.start();
            }
        }).catch(() => {});
    };
    if (replayToggle) {
        replayToggle.checked = replayEnabled();
        replayToggle.addEventListener('change', () => {
            localStorage.setItem(REPLAY_KEY, replayToggle.checked ? '1' : '0');
            if (replayFullToggle) replayFullToggle.disabled = !replayToggle.checked;
            restartReplay();
        });
    }
    if (replayFullToggle) {
        replayFullToggle.checked = replayFull();
        replayFullToggle.disabled = !replayEnabled();
        replayFullToggle.addEventListener('change', () => {
            localStorage.setItem(REPLAY_FULL_KEY, replayFullToggle.checked ? '1' : '0');
            restartReplay();   // re-arm rrweb with the new masking
        });
    }

    // Fold / unfold the sent-packets list. While open, poll the dashboard so an
    // admin's approve/reject of a deletion shows up here automatically.
    document.getElementById('analytics-packets-toggle')?.addEventListener('click', () => {
        const list = document.getElementById('analytics-packets-list') as HTMLElement;
        const chev = document.getElementById('analytics-packets-chev') as HTMLElement;
        if (!list) return;
        const open = list.style.display === 'none';
        list.style.display = open ? 'flex' : 'none';
        if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
        if (_packetsPoll !== null) { clearInterval(_packetsPoll); _packetsPoll = null; }
        if (open) {
            renderSentPackets();
            _packetsPoll = window.setInterval(() => {
                // stop if the list got hidden (e.g. left settings)
                if ((document.getElementById('analytics-packets-list') as HTMLElement)?.style.display === 'none') {
                    if (_packetsPoll !== null) { clearInterval(_packetsPoll); _packetsPoll = null; }
                    return;
                }
                renderSentPackets();
            }, 30000);
        }
    });

    document.getElementById('analytics-view-what')?.addEventListener('click', () => showConsentModal());
    document.getElementById('analytics-export')?.addEventListener('click', async () => {
        const { saveFile } = await import('./api.js');
        const path = await saveFile({ defaultPath: 'bmm-telemetry.json', filters: [{ name: 'JSON', extensions: ['json'] }] }).catch(() => null);
        if (!path) return;
        const data = await exportData();
        try { await invoke('write_text_file', { path, content: data }); (window as any).toast?.(t('analytics.exported') || 'Telemetry exported', 'success'); } catch {}
    });
    document.getElementById('analytics-delete')?.addEventListener('click', async () => {
        const ok = await (window as any).confirmCustom?.(
            t('analytics.deleteTitle') || 'Delete telemetry data',
            t('analytics.deleteConfirm') || 'Permanently delete all telemetry buffered on this PC?',
            'danger', { yesLabel: t('common.delete') || 'Delete', noLabel: t('common.cancel') || 'Cancel' });
        if (!ok) return;
        await clearData();
        try { (window as any).toast?.(t('analytics.deleted') || 'Telemetry data deleted', 'success'); } catch {}
    });
}

// Reflect consent state in the card (hero on/off, detail collapse, packets list).
function refreshPrivacyUI(): void {
    const on = _consent === true;
    const toggle = document.getElementById('analytics-toggle') as HTMLInputElement | null;
    if (toggle) toggle.checked = on;
    const hero = document.getElementById('analytics-hero');
    if (hero) hero.classList.toggle('on', on);
    const sub = document.getElementById('analytics-hero-sub');
    if (sub) sub.textContent = on ? (t('analytics.statusOn') || 'Active — thank you for helping improve BMM.')
                                  : (t('analytics.statusOff') || "Off — nothing is collected.");
    const detail = document.getElementById('analytics-detail');
    if (detail) detail.classList.toggle('collapsed', !on);
    if (on) renderSentPackets();
}

async function renderSentPackets(): Promise<void> {
    const host = document.getElementById('analytics-packets-list');
    if (!host) return;
    let packets: any[] = [];
    try { packets = await invoke('analytics_sent_packets'); } catch {}
    if (!packets.length) { host.innerHTML = `<div class="apv-packets-empty">${t('analytics.noPackets') || 'No packets sent yet.'}</div>`; return; }

    // Ask the dashboard for the real erasure status of any requested packet.
    let statuses: Record<string, any> = {};
    const reqIds = packets.filter(p => p.deletion_requested).map(p => p.id);
    if (reqIds.length) {
        try {
            const base = (getLinks().analytics_endpoint || '').trim().replace(/\/+$/, '').replace(/\/batch$/, '');
            if (base.startsWith('https://')) {
                const r = await fetch(`${base}/api/packet-status?ids=${encodeURIComponent(reqIds.join(','))}`, {
                    headers: { 'ngrok-skip-browser-warning': 'true' }
                });
                if (r.ok) statuses = (await r.json()).statuses || {};
            }
        } catch {}
    }
    const clearRow = `<div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button class="btn btn-xs btn-ghost" id="apv-clear-hist">${t('analytics.clearHistory') || 'Clear history'}</button></div>`;
    const delBtn = (id: string) => `<button class="btn btn-xs btn-ghost apv-del" data-id="${escHtml(id)}" style="color:var(--danger)">${t('analytics.requestDelete') || 'Request deletion'}</button>`;
    host.innerHTML = clearRow + packets.slice(0, 80).map(p => {
        const requested = !!p.deletion_requested;
        const when = (p.ts || '').slice(0, 16).replace('T', ' ');
        const srv = statuses[p.id];
        const isDone = !!srv && srv.status === 'done';
        const isRejected = !!srv && srv.status === 'rejected';
        const isPending = requested && !isDone && !isRejected;

        // right-hand control: green "Deleted" when done, pending text while waiting,
        // otherwise the request button (incl. when a previous request was rejected).
        let control: string;
        if (isDone) {
            const txt = `${t('analytics.deleted2') || 'Deleted'}${srv.decided_at ? ' · ' + new Date(srv.decided_at).toLocaleDateString() : ''}`;
            control = `<span class="apv-pkt-status" style="background:rgba(52,211,153,.15);color:#34d399;padding:3px 8px;border-radius:12px;font-weight:600;font-size:10.5px">${escHtml(txt)}</span>`;
        } else if (isPending) {
            const txt = t('analytics.deletePending') || 'Pending review (≤72h)';
            control = `<span class="apv-pkt-status" style="background:rgba(245,158,11,.15);color:#f59e0b;padding:3px 8px;border-radius:12px;font-weight:600;font-size:10.5px">${escHtml(txt)}</span>`;
        } else {
            // not requested, or rejected → offer the request button again
            const note = isRejected ? `<span class="apv-pkt-rejected" style="color:var(--danger,#ef4444);font-size:11px;margin-right:6px;font-weight:600">${t('analytics.deleteRejected') || 'Request rejected'}</span>` : '';
            control = note + delBtn(p.id);
        }

        // privacy-safe content summary: event NAMES + counts only, no values → pills.
        const ev = p.events && typeof p.events === 'object' ? Object.entries(p.events) : [];
        const evChips = ev.length
            ? ev.map(([k, v]) => `<span class="apv-evchip">${escHtml(k)}<b>×${v}</b></span>`).join('')
            : `<span class="apv-evchip">${p.count} ${t('analytics.packetEvents') || 'events'}</span>`;

        return `<div class="apv-pkt">
            <div class="apv-pkt-row">
                <span class="apv-pkt-id" title="${escHtml(p.id)}">${escHtml(String(p.id).slice(0, 8))}…</span>
                <span class="apv-pkt-meta">${escHtml(when)}</span>
                <span class="apv-pkt-spacer"></span>
                ${control}
            </div>
            <div class="apv-pkt-events">${evChips}</div>
        </div>`;
    }).join('');
    host.querySelector('#apv-clear-hist')?.addEventListener('click', async () => {
        try { await invoke('analytics_clear_sent_log'); renderSentPackets(); } catch {}
    });
    host.querySelectorAll('.apv-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = (btn as HTMLElement).dataset.id!;
            const links = getLinks();
            try {
                await invoke('analytics_request_deletion', { packetId: id, endpoint: links.analytics_endpoint || '', apiKey: links.analytics_key || '' });
                (window as any).toast?.(t('analytics.deleteQueued') || 'Deletion requested — applied within 72h', 'success');
                renderSentPackets();
            } catch (e) { (window as any).toast?.(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
        });
    });
}

// ── Consent modal ──────────────────────────────────────────────────────────────
export function showConsentModal(): Promise<void> {
    if (document.getElementById('analytics-consent-overlay')) return Promise.resolve();
    const overlay = document.createElement('div');
    overlay.id = 'analytics-consent-overlay';
    overlay.className = 'modal-overlay open';
    overlay.setAttribute('data-prevent-close', 'true');   // cannot be dismissed by clicking the backdrop
    overlay.style.zIndex = '2100000';
    overlay.innerHTML = `
      <div class="modal glass" style="max-width:560px;width:94%">
        <div class="modal-header">
            <h2 class="modal-title" style="margin:0;display:flex;align-items:center;gap:10px;font-size:1.15rem">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                ${t('analytics.consentTitle') || 'Help improve BMM'}
            </h2>
        </div>
        <div class="modal-body" style="padding:18px 22px;display:block">
            <p style="font-size:13px;color:var(--text-secondary);line-height:1.65;margin:0 0 12px">
                ${t('analytics.consentIntro') || 'BMM is built by a tiny team. Anonymous usage data helps us see which features matter, fix what\'s slow on real hardware, and decide what to build next. It is 100% optional and you can turn it off anytime.'}
            </p>
            <p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin:0 0 12px;padding:9px 11px;background:rgba(91,140,255,0.06);border:1px solid var(--border);border-radius:9px">
                ${t('analytics.consentAuth') || 'By accepting, you authorize the use of this anonymous data to improve BMM and the other Better Community tools. Data is kept only for a limited time and you can request erasure of any sent packet at any moment.'}
            </p>
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:12px">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:8px">${t('analytics.whatWeCollect') || 'What we collect'}</div>
                <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--text-secondary);line-height:1.8">
                    <li>${t('analytics.collect.specs') || 'PC specs (OS, CPU, RAM, GPU, disk) — to test on real hardware'}</li>
                    <li>${t('analytics.collect.bench') || 'Benchmark results — to track performance across versions'}</li>
                    <li>${t('analytics.collect.usage') || 'Feature usage & in-app navigation — most/least used features'}</li>
                    <li>${t('analytics.collect.network') || 'Network info (IP & approximate region, VM detection) — for abuse prevention & regional stats'}</li>
                    <li>${t('analytics.collect.id') || 'Your anonymous Creator ID — never your name or email'}</li>
                    <li>${t('analytics.collect.replay') || 'Visual session replay (masked by default) — to see where users get stuck'}</li>
                </ul>
            </div>
            
            <details style="margin-bottom:12px; font-size:12px; color:var(--text-secondary);">
                <summary style="cursor:pointer; font-weight:600; outline:none; user-select:none;">${t('analytics.customize') || 'Customize data collection...'}</summary>
                <div style="padding: 12px; margin-top: 8px; background: rgba(255,255,255,0.02); border-radius: 8px; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px;">
                    <label style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                        <span>${t('analytics.benchToggle') || 'Automatic Benchmark (every 7 days)'}</span>
                        <div class="plug-toggle">
                            <input type="checkbox" id="modal-bench-toggle" checked>
                            <span class="plug-toggle-slider"></span>
                        </div>
                    </label>
                    <label style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                        <span>${t('analytics.replayToggle') || 'Visual Session Replay (masked)'}</span>
                        <div class="plug-toggle">
                            <input type="checkbox" id="modal-replay-toggle" checked>
                            <span class="plug-toggle-slider"></span>
                        </div>
                    </label>
                    <label style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" id="modal-replay-full-container">
                        <span>${t('analytics.replayFullToggle') || 'Unmask Replay (capture text & images)'}</span>
                        <div class="plug-toggle">
                            <input type="checkbox" id="modal-replay-full-toggle">
                            <span class="plug-toggle-slider"></span>
                        </div>
                    </label>
                </div>
            </details>

            <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px">
                ${t('analytics.consentFoot') || 'No personal data, no mod contents, no file paths. GDPR-friendly: opt-in, exportable and erasable from Settings → Privacy.'}
            </p>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;border-top:1px solid var(--border)">
            <button class="btn btn-ghost" id="analytics-decline">${t('analytics.decline') || 'No thanks'}</button>
            <button class="btn btn-primary" id="analytics-accept">${t('analytics.accept') || 'Share anonymous data'}</button>
        </div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);

    // Block backdrop clicks from closing it (belt-and-suspenders alongside data-prevent-close).
    overlay.addEventListener('click', (e) => { if (e.target === overlay) e.stopPropagation(); }, true);

    return new Promise<void>((resolve) => {
        const close = () => { overlay.remove(); resolve(); };
        
        const benchToggle = overlay.querySelector('#modal-bench-toggle') as HTMLInputElement | null;
        const replayToggle = overlay.querySelector('#modal-replay-toggle') as HTMLInputElement | null;
        const replayFullToggle = overlay.querySelector('#modal-replay-full-toggle') as HTMLInputElement | null;
        
        if (replayToggle && replayFullToggle) {
            replayToggle.addEventListener('change', () => {
                replayFullToggle.disabled = !replayToggle.checked;
            });
        }

        overlay.querySelector('#analytics-accept')?.addEventListener('click', async () => {
            if (benchToggle) localStorage.setItem(BENCH_ALLOW_KEY, benchToggle.checked ? '1' : '0');
            if (replayToggle) localStorage.setItem(REPLAY_KEY, replayToggle.checked ? '1' : '0');
            if (replayFullToggle) localStorage.setItem(REPLAY_FULL_KEY, replayFullToggle.checked ? '1' : '0');
            await setConsent(true);
            refreshPrivacyUI();
            close();
        });
        overlay.querySelector('#analytics-decline')?.addEventListener('click', async () => { await setConsent(false); refreshPrivacyUI(); close(); });
    });
}
