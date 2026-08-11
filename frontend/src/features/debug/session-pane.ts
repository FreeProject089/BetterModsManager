// DevTools → Session: what the recorder is capturing and what telemetry would send.
//
// Both subsystems were previously debuggable only by exporting a file and reading it in
// another editor — which is a poor loop for rrweb in particular, where the question is
// usually "is it still recording, and how fast is the buffer growing right now".
//
// Two things this pane refuses to do, both deliberate:
//
//  * It never renders event payloads as HTML. A recording captures the DOM of an app that
//    displays user data — mod names, paths, a repo URL with a share key. Interpolating any
//    of that into markup would make the debugger itself an injection sink, on data whose
//    whole point is that it came from somewhere else.
//  * It retains no event data at all. See the note on onEvent below — the first version
//    kept a rolling sample and re-serialised it on a timer, and froze the app.

import { t } from '../../core/i18n.js';
import { getConsent, exportData } from '../../core/analytics.js';
import { isFullReplay, subscribeReplay, unsubscribeReplay, getExtraBlockSelectors } from '../../core/replay-recorder.js';

let events = 0;
let lastEventAt: number | null = null;
let bytes = 0;
let biggest = 0;
let subscribed = false;
let timer: number | null = null;

// NOTHING is retained.
//
// The first version kept the last 400 events and re-serialised the whole lot every two
// seconds to size it. rrweb full snapshots run to megabytes each, so that held tens of MB
// and re-stringified them on the main thread on a timer — it froze the pane and then the
// whole app, which is precisely the failure this tab exists to reveal.
//
// Each event is measured once, on arrival, and discarded. Running totals only: O(1) per
// event, no periodic work, no retention. The largest single event is tracked because that
// is the number that actually explains a memory spike — an average over a stream mixing
// snapshots and mouse moves explains nothing.
const onEvent: any = (ev: any) => {
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

async function render(pane: HTMLElement) {
    let telemetry = '[]';
    try { telemetry = await exportData(); } catch { /* keeps the pane usable offline */ }
    let telemetryCount = 0;
    try { const parsed = JSON.parse(telemetry); telemetryCount = Array.isArray(parsed) ? parsed.length : 0; } catch {}

    const consent = getConsent();
    const idle = lastEventAt ? Math.round((Date.now() - lastEventAt) / 1000) : null;

    pane.textContent = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:10px;font-size:11px;overflow-y:auto;height:100%';

    const h = (text: string) => {
        const el = document.createElement('div');
        el.style.cssText = 'margin:12px 0 6px;font-weight:700;color:var(--text,#e6edf3);text-transform:uppercase;letter-spacing:.5px;font-size:10px';
        el.textContent = text;
        return el;
    };

    wrap.append(h(t('dev.session.recorder') || 'Session recorder'));
    wrap.append(row(t('dev.session.mode') || 'Mode', isFullReplay() ? 'full replay' : 'telemetry only'));
    wrap.append(row(t('dev.session.events') || 'Events seen', String(events)));
    wrap.append(row(t('dev.session.buffer') || 'Total captured', fmtBytes(bytes)));
    // The one number that explains a spike. An average would not.
    wrap.append(row(t('dev.session.biggest') || 'Largest single event', fmtBytes(biggest)));
    wrap.append(row(
        t('dev.session.last') || 'Last event',
        idle === null ? '—' : `${idle}s ago`,
        idle !== null && idle > 30 ? 'color:var(--warning,#f59e0b)' : '',
    ));
    // Masking is the difference between a shareable recording and a leak, so it is stated
    // here rather than assumed from the fact that a rule exists somewhere.
    wrap.append(row(t('dev.session.masked') || 'Extra blocked selectors', String(getExtraBlockSelectors().length)));

    wrap.append(h(t('dev.session.telemetry') || 'Telemetry'));
    wrap.append(row(
        t('dev.session.consent') || 'Consent',
        consent === null ? 'not asked' : consent ? 'granted' : 'declined',
        consent ? 'color:var(--success,#22c55e)' : 'color:var(--text-muted,#7c8698)',
    ));
    wrap.append(row(t('dev.session.queued') || 'Events stored', String(telemetryCount)));
    wrap.append(row(t('dev.session.payload') || 'Payload size', fmtBytes(new Blob([telemetry]).size)));

    // The exact bytes that would leave the machine. This is the whole point of the pane:
    // a privacy claim you can read, rather than one you have to trust.
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:8px 0 0;padding:8px;max-height:260px;overflow:auto;background:rgba(0,0,0,.3);border:1px solid var(--debug-border,#2a3242);border-radius:6px;font-size:10px;white-space:pre-wrap;word-break:break-all';
    try { pre.textContent = JSON.stringify(JSON.parse(telemetry), null, 2); }
    catch { pre.textContent = telemetry; }
    wrap.append(h(t('dev.session.exact') || 'Exactly what would be sent'), pre);

    pane.append(wrap);
}

/** Start collecting and refreshing. Idempotent — reopening the tab must not double-count. */
export async function mountSessionPane(pane: HTMLElement) {
    if (!subscribed) {
        try { await subscribeReplay(onEvent); subscribed = true; } catch { /* recorder off */ }
    }
    await render(pane);
    if (timer) window.clearInterval(timer);
    timer = window.setInterval(() => { void render(pane); }, 5000);
}

/** Stop refreshing when the pane is hidden. The subscription stays: the counters are only
 *  useful if they kept running while you were looking at another tab. */
export function unmountSessionPane() {
    if (timer) { window.clearInterval(timer); timer = null; }
}

/** Drop the retained sample and the counters. */
export function resetSessionPane() {
    events = 0; bytes = 0; biggest = 0; lastEventAt = null;
}

/** Called on teardown so a closed DevTools does not keep feeding the buffer. */
export async function disposeSessionPane() {
    unmountSessionPane();
    if (subscribed) {
        try { await unsubscribeReplay(onEvent); } catch {}
        subscribed = false;
    }
    resetSessionPane();
}
