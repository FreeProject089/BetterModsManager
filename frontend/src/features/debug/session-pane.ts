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
import { isFullReplay, observeReplay, unobserveReplay, isRecording, getExtraBlockSelectors, subscribeReplay, unsubscribeReplay, type ReplaySubscriber } from '../../core/replay-recorder.js';

let events = 0;
let lastEventAt: number | null = null;
let bytes = 0;
let biggest = 0;
let biggestType = -1;
let observing = false;
let timer: number | null = null;

// The explicit test capture. Field report: "le session recorder fonctionne pas" —
// nothing was broken, nothing was RECORDING, so the observe-only counters sat at
// zero forever and read as a dead pane. The pane still never records by itself;
// this is a labelled button the user presses, masked, local, stopped on teardown.
let _testSub: ReplaySubscriber | null = null;
function _testCaptureRunning(): boolean { return _testSub !== null; }
async function _toggleTestCapture(): Promise<void> {
    if (_testSub) { const s = _testSub; _testSub = null; await unsubscribeReplay(s); return; }
    const sub = ((_ev: any, _ck: boolean) => { /* the observer does the counting */ }) as ReplaySubscriber;
    sub.requiresMasking = true;          // NEVER an unmasked capture from a debug pane
    _testSub = sub;
    await subscribeReplay(sub);
}

// Per-type tallies. rrweb's event.type is a small int; FullSnapshot (2) is what
// actually costs memory, IncrementalSnapshot (3) is what tells you the page is alive.
// Counting per type is O(1) and answers the question the totals cannot: WHAT is the
// buffer made of.
const TYPE_NAMES: Record<number, string> = {
    0: 'DomContentLoaded', 1: 'Load', 2: 'FullSnapshot',
    3: 'Incremental', 4: 'Meta', 5: 'Custom', 6: 'Plugin',
};
const byType = new Map<number, { n: number; bytes: number }>();

// Arrival rate over the last minute: six 10-second buckets, rotated in place. Fixed
// memory, no timestamps retained — the same rule as everything else in this pane.
const RATE_BUCKETS = 6;
const rate = new Array<number>(RATE_BUCKETS).fill(0);
let rateSlot = -1;
function bumpRate(now: number): void {
    const slot = Math.floor(now / 10_000) % RATE_BUCKETS;
    if (slot !== rateSlot) { rateSlot = slot; rate[slot] = 0; }
    rate[slot]++;
}

// Each event is measured once, on arrival, and discarded. Running totals only: O(1) state,
// no periodic work, no retention. The largest single event is tracked because that is the
// number that explains a memory spike — an average over a stream mixing snapshots and
// interactions explains nothing.
const onEvent = (ev: any) => {
    events++;
    lastEventAt = Date.now();
    bumpRate(lastEventAt);
    try {
        const n = JSON.stringify(ev).length;
        bytes += n;
        const ty = typeof ev?.type === 'number' ? ev.type : -1;
        if (n > biggest) { biggest = n; biggestType = ty; }
        const b = byType.get(ty) ?? { n: 0, bytes: 0 };
        b.n++; b.bytes += n;
        byType.set(ty, b);
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
    if (!live) {
        const why = document.createElement('div');
        why.style.cssText = 'font-size:10px;color:var(--text-muted,#7c8698);padding:4px 0 6px;line-height:1.5';
        why.textContent = t('dev.session.idleHint')
            || 'Nothing is recording, so every counter stays at zero — that is the pane working, not failing. Start a test capture below to watch the stream live.';
        host.append(why);
    }
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

    // Arrival rate: how alive the page is right now. The current 10s bucket is partial,
    // so the whole ring is summed as "per minute" — approximate, honest, O(1).
    const perMin = rate.reduce((a, b) => a + b, 0);
    host.append(row(t('dev.session.rate') || 'Rate (last minute)', `${perMin} ev/min`,
        perMin > 600 ? 'color:var(--warning,#f59e0b)' : ''));

    // What the buffer is MADE of. Totals say how big; this says why. FullSnapshots are
    // the memory driver — many of them means checkouts are firing (or something is
    // forcing them), and that is the first thing to look at when captured MB climbs.
    if (byType.size) {
        host.append(heading(t('dev.session.byType') || 'By event type'));
        const rows = [...byType.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
        for (const [ty, b] of rows) {
            const name = TYPE_NAMES[ty] ?? `type ${ty}`;
            host.append(row(
                ty === biggestType ? `${name} ★` : name,
                `${b.n} · ${fmtBytes(b.bytes)}`,
                ty === 2 && b.bytes > bytes / 2 ? 'color:var(--warning,#f59e0b)' : '',
            ));
        }
        const star = document.createElement('div');
        star.style.cssText = 'font-size:10px;color:var(--text-muted,#7c8698);margin-top:4px';
        star.textContent = t('dev.session.starNote') || '★ = the type of the largest single event';
        host.append(star);
    }
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

    // An empty queue rendered as a bare "[]", which reads as "this pane is broken"
    // rather than "there is nothing to send". The whole point here is a privacy
    // claim you can READ, so an empty store has to say WHY it is empty — and still
    // show the shape an event would take, or the claim is unverifiable precisely
    // when it is most reassuring.
    if (count === 0) {
        const why = document.createElement('div');
        why.style.cssText = 'padding:8px 0 4px;font-size:11px;line-height:1.6;color:var(--text-secondary,#9aa4b5)';
        why.textContent = consent === false
            ? (t('dev.session.emptyDeclined') || 'Nothing is stored: you declined telemetry, so no event is ever recorded.')
            : consent === null
                ? (t('dev.session.emptyUnasked') || 'Nothing is stored: telemetry has not been accepted, and BMM records nothing until it is.')
                : (t('dev.session.emptyNone') || 'Telemetry is on, but nothing has been recorded yet this session.');
        host.append(why);

        const shapeLabel = document.createElement('div');
        shapeLabel.style.cssText = 'margin-top:10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted,#7c8698)';
        shapeLabel.textContent = t('dev.session.shape') || 'The shape an event would have';
        host.append(shapeLabel);

        const shape = document.createElement('pre');
        shape.style.cssText = 'margin:6px 0 0;padding:8px;background:rgba(0,0,0,.3);border:1px solid var(--debug-border,#2a3242);border-radius:6px;font-size:10px;white-space:pre-wrap;color:var(--text-muted,#7c8698)';
        // Written out rather than sampled, so it is honest even with an empty store:
        // these are the only fields the pipeline ever fills.
        shape.textContent = JSON.stringify({
            event: 'view_opened',
            at: '2026-08-13T10:00:00Z',
            app_version: '1.0.0',
            os: 'windows',
            locale: 'fr-FR',
            props: { view: 'library' },
        }, null, 2);
        host.append(shape);
        return;
    }
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
    const cap = document.createElement('button');
    cap.className = 'btn btn-sm';
    const capLabel = () => {
        cap.textContent = _testCaptureRunning()
            ? (t('dev.session.stopTest') || 'Stop the test capture')
            : (t('dev.session.startTest') || 'Start a test capture (masked)');
    };
    capLabel();
    cap.addEventListener('click', () => { void _toggleTestCapture().then(() => { capLabel(); renderStats(stats); }); });
    bar.append(cap);

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
    events = 0; bytes = 0; biggest = 0; biggestType = -1; lastEventAt = null;
    byType.clear();
    rate.fill(0); rateSlot = -1;
}

/** Called on teardown. */
export async function disposeSessionPane() {
    unmountSessionPane();
    if (observing) { unobserveReplay(onEvent); observing = false; }
    if (_testSub) { const s = _testSub; _testSub = null; await unsubscribeReplay(s); }
    resetSessionPane();
}
