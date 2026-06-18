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

/** A new random id every app launch → lets us group events into sessions. */
const _sessionId = (() => {
    try { return (crypto as any).randomUUID(); }
    catch { return 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
})();

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

    if (_consent === null) {
        // Ask after a short delay so it doesn't collide with onboarding.
        setTimeout(() => showConsentModal(), 1200);
        return;
    }
    if (_consent === true) await startCollection();
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
        // Identify the (anonymous) user once with spec profile + BMM-specific bits + retention anchors.
        track('$identify', { $set: { ...profile, ...extras, anon_id: anonId(), first_seen: firstSeen() } });
        track('session_start', { ts: new Date().toISOString(), first_seen: firstSeen() });
        (window as any).bmmTrack = (event: string, props?: Record<string, any>) => track(event, props || {});
        initModalTracking();
    } catch {}
    // Periodic flush; also flush before the window closes.
    if (_flushTimer === null) _flushTimer = window.setInterval(() => flush(), 90000);
    window.addEventListener('beforeunload', () => { trackSessionEnd(); flush(); }, { once: true });
    startPerfSampling();
    collectWebVitals();
    maybePeriodicBenchmark();   // weekly telemetry benchmark (if allowed)
    flush();
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

// BMM-specific profile bits: active theme (+ custom/predef), language, Tasky settings.
async function bmmProfileExtras(): Promise<Record<string, any>> {
    const ls = (k: string, dflt = true) => localStorage.getItem(k) !== 'false' ? dflt : false;
    const theme = localStorage.getItem('bmm_active_theme') || 'bmm-default';
    let theme_kind = 'predef';
    try {
        const { BUILTIN_THEMES } = await import('../features/themes/theme-engine.js');
        if (!BUILTIN_THEMES.some((b: any) => b.id === theme)) theme_kind = 'custom';
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
        fs_security_mode: localStorage.getItem('bmm_fs_security_mode') || undefined,
    };
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
let _modalObs: MutationObserver | null = null;
function initModalTracking(): void {
    if (_modalObs) return;
    const open = new WeakSet<Element>();
    _modalObs = new MutationObserver(muts => {
        for (const m of muts) {
            const el = m.target as HTMLElement;
            if (!el.classList) continue;
            const isModal = el.classList.contains('modal-overlay') || el.classList.contains('modal-generic-overlay') || el.classList.contains('modal-card');
            if (!isModal) continue;
            if (el.classList.contains('open')) {
                if (open.has(el)) continue;
                open.add(el);
                const name = el.id || el.querySelector('.modal-title, .modal-header h2, h3')?.textContent?.trim().slice(0, 40) || 'modal';
                _currentModal = name;            // attribute perf samples to this modal
                track('modal_open', { name });
            } else { open.delete(el); _currentModal = null; }
        }
    });
    _modalObs.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
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
}

function trackSessionEnd(): void {
    track('session_end', {
        duration_sec: Math.round((Date.now() - _sessionStart) / 1000),
        views_visited: _journey.length,
        journey: _journey.slice(-40),
    });
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

    // Fold / unfold the sent-packets list.
    document.getElementById('analytics-packets-toggle')?.addEventListener('click', () => {
        const list = document.getElementById('analytics-packets-list') as HTMLElement;
        const chev = document.getElementById('analytics-packets-chev') as HTMLElement;
        if (!list) return;
        const open = list.style.display === 'none';
        list.style.display = open ? 'flex' : 'none';
        if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
        if (open) renderSentPackets();
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
                const r = await fetch(`${base}/api/packet-status?ids=${encodeURIComponent(reqIds.join(','))}`);
                if (r.ok) statuses = (await r.json()).statuses || {};
            }
        } catch {}
    }
    const clearRow = `<div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button class="btn btn-xs btn-ghost" id="apv-clear-hist">${t('analytics.clearHistory') || 'Clear history'}</button></div>`;
    host.innerHTML = clearRow + packets.slice(0, 80).map(p => {
        const requested = !!p.deletion_requested;
        const when = (p.ts || '').slice(0, 16).replace('T', ' ');
        const srv = statuses[p.id];
        let status = '', done = false;
        if (srv && (srv.status === 'done' || srv.status === 'rejected')) {
            done = srv.status === 'done';
            status = done
                ? `${t('analytics.deleted2') || 'Deleted'}${srv.decided_at ? ' · ' + new Date(srv.decided_at).toLocaleDateString() : ''}`
                : (t('analytics.deleteRejected') || 'Request rejected');
        } else if (requested) {
            const sched = p.deletion_scheduled_at ? new Date(p.deletion_scheduled_at).toLocaleString() : '';
            status = sched
                ? `${t('analytics.deleteBy') || 'Erased by'} ${sched}`
                : (t('analytics.deleteRequested') || 'Deletion requested (≤72h)');
        }
        return `<div class="apv-pkt">
            <span class="apv-pkt-id" title="${escHtml(p.id)}">${escHtml(String(p.id).slice(0, 8))}…</span>
            <span class="apv-pkt-meta">${escHtml(when)} · ${p.count} ${t('analytics.packetEvents') || 'events'}</span>
            <span class="apv-pkt-spacer"></span>
            ${status
                ? `<span class="apv-pkt-status" style="${done ? 'background:rgba(52,211,153,.15);color:#34d399' : ''}">${escHtml(status)}</span>`
                : `<button class="btn btn-xs btn-ghost apv-del" data-id="${escHtml(p.id)}" style="color:var(--danger)">${t('analytics.requestDelete') || 'Request deletion'}</button>`}
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
export function showConsentModal(): void {
    if (document.getElementById('analytics-consent-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'analytics-consent-overlay';
    overlay.className = 'modal-overlay open';
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
                </ul>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px">
                ${t('analytics.consentFoot') || 'No personal data, no mod contents, no file paths. GDPR-friendly: opt-in, exportable and erasable from Settings → Privacy.'}
            </p>
            <p style="font-size:11px;color:#f59e0b;margin:0;display:flex;gap:6px;align-items:flex-start">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                ${t('analytics.benchNote') || 'If you accept, BMM runs a quick performance benchmark now and once every 7 days (anonymous). You can turn this off in Settings → Privacy.'}
            </p>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;border-top:1px solid var(--border)">
            <button class="btn btn-ghost" id="analytics-decline">${t('analytics.decline') || 'No thanks'}</button>
            <button class="btn btn-primary" id="analytics-accept">${t('analytics.accept') || 'Share anonymous data'}</button>
        </div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#analytics-accept')?.addEventListener('click', async () => { await setConsent(true); close(); });
    overlay.querySelector('#analytics-decline')?.addEventListener('click', async () => { await setConsent(false); close(); });
}
