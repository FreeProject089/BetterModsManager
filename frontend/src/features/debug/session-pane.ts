// DevTools → Session: what the recorder is capturing and what telemetry would send.
//
// Both subsystems were previously debuggable only by exporting a file and reading it in
// another editor — a poor loop for rrweb in particular, where the question is usually "is
// it still recording, and how fast is the buffer growing right now".
//
// Three things this pane refuses to do, all learned the hard way:
//
//  * It never STARTS a recording. It observes (observeReplay), it does not subscribe.
//    Subscribing made opening the tab switch on an unmasked full-DOM capture of the whole
//    app — see the note in replay-recorder.ts. A debugger that causes the thing it
//    measures is not a debugger.
//  * It retains no event data. An early version kept the last 400 events and
//    re-serialised the lot every two seconds; rrweb snapshots run to megabytes, so it
//    held tens of MB and re-stringified them on the main thread, on a timer.
//  * It never renders event payloads as HTML. A recording captures the DOM of an app
//    showing user data — mod names, paths, a repo URL with a share key. Interpolating any
//    of it into markup would make the debugger an injection sink, on data whose whole
//    point is that it came from elsewhere.

import { t } from '../../core/i18n.js';
import { getConsent, exportData } from '../../core/analytics.js';
import { isFullReplay, observeReplay, unobserveReplay, isRecording, getExtraBlockSelectors } from '../../core/replay-recorder.js';

let events = 0;
let lastEventAt: number | null = null;
let bytes = 0;
let biggest = 0;
let observing = false;
let timer: number | null = null;

// Each event is measured once, on arrival, and discarded. Running totals only: O(1) state,
// no periodic work, no retention. The largest single event is tracked because that is the
// number that explains a memory spike — an average over a stream mixing snapshots and
// interactions explains nothing.
const onEvent = (ev: any) => {
    events++;
    lastEventAt = Date.now();
    try {
        const n = JSON.stringify(ev).length;
        bytes += n;
        if (n > biggest) biggest = n;
    } catch {
        // A circular or exotic payload is not worth crashing the debugger over.
    }
};

// The payload preview is a sample, not the archive. Pretty-printing an unbounded export
// into the DOM every few seconds is what turned this pane from slow into fatal.
const PREVIEW_LIMIT = 24 * 1024;

function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function row(label: string, value: string, tone = ''): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)';
    const k = document.createElement('span');
    k.style.cssText = 'color:var(--text-muted,#7c8698)';
    k.textContent = label;
    const v = document.createElement('span');
    v.style.cssText = `font-family:var(--font-mono,monospace);${tone}`;
    // textContent, never innerHTML — see the header note.
    v.textContent = value;
    el.append(k, v);
    return el;
}

function heading(text: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'margin:12px 0 6px;font-weight:700;color:var(--text,#e6edf3);text-transform:uppercase;letter-spacing:.5px;font-size:10px';
    el.textContent = text;
    return el;
}

/** The cheap half: counters only. Safe to run on a timer. */
function renderStats(host: HTMLElement) {
    const idle = lastEventAt ? Math.round((Date.now() - lastEventAt) / 1000) : null;
    const live = isRecording();

    host.textContent = '';
    host.append(heading(t('dev.session.recorder') || 'Session recorder'));

    // Stated first, because every number below is meaningless without it. Zeros while
    // nothing is recording are correct, not a stall — and this pane will not start one
    // to make them move.
    host.append(row(
        t('dev.session.state') || 'Recorder',
        live ? (isFullReplay() ? 'running · full replay' : 'running · masked') : 'not running',
        live ? 'color:var(--success,#22c55e)' : 'color:var(--text-muted,#7c8698)',
    ));
    host.append(row(t('dev.session.events') || 'Events seen', String(events)));
    host.append(row(t('dev.session.buffer') || 'Total captured', fmtBytes(bytes)));
    host.append(row(t('dev.session.biggest') || 'Largest single event', fmtBytes(biggest)));
    host.append(row(
        t('dev.session.last') || 'Last event',
        idle === null ? '—' : `${idle}s ago`,
        idle !== null && idle > 30 ? 'color:var(--warning,#f59e0b)' : '',
    ));
    // Masking is the difference between a shareable recording and a leak, so it is shown
    // rather than assumed from the fact that a rule exists somewhere.
    host.append(row(t('dev.session.masked') || 'Extra blocked selectors', String(getExtraBlockSelectors().length)));
}

/** The expensive half: reads and formats the whole telemetry store. On demand only. */
async function renderPayload(host: HTMLElement) {
    host.textContent = '';
    host.append(heading(t('dev.session.telemetry') || 'Telemetry'));

    let raw = '[]';
    try { raw = await exportData(); } catch { /* keeps the pane usable offline */ }
    let count = 0;
    try { const parsed = JSON.parse(raw); count = Array.isArray(parsed) ? parsed.length : 0; } catch {}

    const consent = getConsent();
    host.append(row(
        t('dev.session.consent') || 'Consent',
        consent === null ? 'not asked' : consent ? 'granted' : 'declined',
        consent ? 'color:var(--success,#22c55e)' : 'color:var(--text-muted,#7c8698)',
    ));
    host.append(row(t('dev.session.queued') || 'Events stored', String(count)));
    host.append(row(t('dev.session.payload') || 'Payload size', fmtBytes(new Blob([raw]).size)));

    // The exact bytes that would leave the machine — the whole point of the pane: a
    // privacy claim you can read rather than one you have to trust.
    let text: string;
    try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch { text = raw; }
    const truncated = text.length > PREVIEW_LIMIT;
    if (truncated) text = text.slice(0, PREVIEW_LIMIT);

    host.append(heading(t('dev.session.exact') || 'Exactly what would be sent'));
    if (truncated) {
        const note = document.createElement('div');
        note.style.cssText = 'margin-bottom:6px;color:var(--warning,#f59e0b)';
        note.textContent = t('dev.session.truncated')
            || `Showing the first ${fmtBytes(PREVIEW_LIMIT)} — use Export to read all of it.`;
        host.append(note);
    }
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:8px 0 0;padding:8px;max-height:260px;overflow:auto;background:rgba(0,0,0,.3);border:1px solid var(--debug-border,#2a3242);border-radius:6px;font-size:10px;white-space:pre-wrap;word-break:break-all';
    pre.textContent = text;
    host.append(pre);
}

async function build(pane: HTMLElement) {
    pane.textContent = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:10px;font-size:11px;overflow-y:auto;height:100%';

    const stats = document.createElement('div');
    const payload = document.createElement('div');

    const bar = document.createElement('div');
    bar.style.cssText = 'margin-top:12px;display:flex;gap:8px;align-items:center';
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = t('dev.session.reload') || 'Reload payload';
    // Reading and formatting the store is the costly part, so it happens when asked for
    // and not on the refresh timer. The counters above stay live either way.
    btn.addEventListener('click', () => { void renderPayload(payload); });
    bar.append(btn);

    wrap.append(stats, bar, payload);
    pane.append(wrap);

    renderStats(stats);
    await renderPayload(payload);
    return stats;
}

/** Start observing and refreshing. Idempotent — reopening the tab must not double-count. */
export async function mountSessionPane(pane: HTMLElement) {
    if (!observing) { observeReplay(onEvent); observing = true; }
    const stats = await build(pane);
    if (timer) window.clearInterval(timer);
    // Counters only. Cheap enough to run while the tab is open, and it stops on unmount.
    timer = window.setInterval(() => { if (stats.isConnected) renderStats(stats); }, 2000);
}

/** Stop refreshing when the pane is hidden. The observer stays: the counters are only
 *  useful if they kept running while you were looking at another tab. */
export function unmountSessionPane() {
    if (timer) { window.clearInterval(timer); timer = null; }
}

/** Drop the counters. */
export function resetSessionPane() {
    events = 0; bytes = 0; biggest = 0; lastEventAt = null;
}

/** Called on teardown. */
export async function disposeSessionPane() {
    unmountSessionPane();
    if (observing) { unobserveReplay(onEvent); observing = false; }
    resetSessionPane();
}
