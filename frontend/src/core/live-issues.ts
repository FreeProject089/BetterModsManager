// live-issues.ts: "Send errors live" (Settings → Privacy), the webview half.
//
// Hands the Rust reporter (src-tauri/src/commands/live_issues.rs) the JS errors, unhandled
// rejections and failed commands of this window. Rust decides everything that matters: both
// switches (telemetry consent AND this one), redaction, grouping, the offline queue, the send.
// Here: nothing crosses the bridge while the switch is off, and a burst is throttled.

import { invoke, setInvokeFailureHook, type InvokeFailureKind } from './api.js';
import { t } from './i18n.js';
import { getLinks } from './links-config.js';
import { componentForCommand, isIgnoredCommand, shouldReportInvoke, errorText, errorStack, Throttle } from './live-issues-core.js';

let _on = false;
let _setting = false;   // the switch as stored (Settings → Privacy), whatever the consent
let _stored: boolean | null = null;   // same, with "never decided" kept apart
let _wired = false;
const _throttle = new Throttle();

type Status = { enabled: boolean; pending: number; sent: number; dropped: number; last_error: string; setting?: boolean | null };

function report(level: 'fatal' | 'error' | 'warning', component: string, message: string, stack?: string, code?: string): void {
    if (!_on) return;
    const key = `${component}|${code || ''}|${message.slice(0, 200)}`;
    if (!_throttle.allow(key)) return;
    invoke('live_issue_report', { level, component, message: message.slice(0, 4000), stack: stack || null, code: code || null }, { quiet: true }).catch(() => {});
}

function wire(): void {
    if (_wired) return;
    _wired = true;
    window.addEventListener('error', (e) => {
        const err = (e as ErrorEvent).error;
        report('error', 'js', err ? errorText(err) : String((e as ErrorEvent).message || 'error'), errorStack(err));
    });
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
        report('error', 'js', `Unhandled rejection: ${errorText(e.reason)}`, errorStack(e.reason));
    });
    setInvokeFailureHook((command: string, err: unknown, kind: InvokeFailureKind) => {
        if (!_on || isIgnoredCommand(command) || !shouldReportInvoke(kind)) return;
        report('error', componentForCommand(command), errorText(err), undefined, command);
    });
}

/** Boot (every launch, whatever the consent): Rust decides the switch's first value, loads the
 *  offline queue and starts sending if both switches are on. */
export async function initLiveIssues(sessionId: string): Promise<void> {
    try {
        const links = getLinks();
        const s = await invoke('live_issues_init', { endpoint: links.analytics_endpoint || '', apiKey: links.analytics_key || '', sessionId }, { quiet: true }) as Status;
        _on = !!s?.enabled;
        _setting = s?.setting === true;
        _stored = typeof s?.setting === 'boolean' ? s.setting : null;
    } catch { _on = false; }
    wire();
}

/** Re-read the state after telemetry consent changed. */
export async function refreshLiveIssues(): Promise<Status | null> {
    try {
        const s = await invoke('live_issues_status', {}, { quiet: true }) as Status;
        _on = !!s?.enabled;
        _setting = s?.setting === true;
        _stored = typeof s?.setting === 'boolean' ? s.setting : null;
        return s;
    } catch { return null; }
}

export async function setLiveErrors(enabled: boolean): Promise<void> {
    try {
        const s = await invoke('live_issues_set_enabled', { enabled }) as Status;
        _on = !!s?.enabled;
        _setting = enabled;
        _stored = enabled;
    } catch { /* the toggle is re-read below */ }
    renderRow();
}

/** The "errors" telemetry category: the live switch as stored. Also gates the warning and
 *  error logs that ride with ordinary telemetry, so one switch covers every error report. */
export function liveErrorsSetting(): boolean { return _setting; }
/** The stored switch, or null when it was never decided (installer or dialog). */
export function liveErrorsStored(): boolean | null { return _stored; }

/** Settings → Privacy: one toggle row, added under the replay rows (the card's markup lives in
 *  index.html; this row is built here so the feature stays in one module). */
export function mountLiveIssuesToggle(): void {
    const detail = document.getElementById('analytics-detail');
    if (!detail || document.getElementById('analytics-live-row')) { renderRow(); return; }
    const row = document.createElement('div');
    // The "errors" telemetry category (analytics.ts lists it among the others).
    row.className = 'setting-row tc-setting';
    row.id = 'analytics-live-row';
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0';
    const text = document.createElement('div');
    text.className = 'tc-setting-txt';
    text.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0';
    const label = document.createElement('span');
    label.style.cssText = 'font-size:12px;color:var(--text-muted)';
    label.textContent = t('analytics.category.errors');
    const hint = document.createElement('span');
    hint.id = 'analytics-live-hint';
    hint.className = 'tc-setting-hint';
    hint.style.cssText = 'font-size:11px;color:var(--text-secondary)';
    hint.textContent = t('analytics.category.errorsDesc');
    text.append(label, hint);
    const sw = document.createElement('label');
    sw.className = 'plug-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'analytics-live-toggle';
    input.setAttribute('aria-label', t('analytics.category.errors'));
    const slider = document.createElement('span');
    slider.className = 'plug-toggle-slider';
    sw.append(input, slider);
    row.append(text, sw);
    const after = document.getElementById('analytics-replay-full-row');
    if (after && after.parentElement === detail) after.after(row); else detail.prepend(row);
    input.addEventListener('change', () => { void setLiveErrors(input.checked); });
    renderRow();
}

async function renderRow(): Promise<void> {
    const input = document.getElementById('analytics-live-toggle') as HTMLInputElement | null;
    if (!input) return;
    const s = await refreshLiveIssues();
    input.checked = s?.setting === true;
    // Not a 'change' (that would save the switch again): tells the category list to re-read it.
    input.dispatchEvent(new Event('bmm:cats-sync', { bubbles: true }));
    const hint = document.getElementById('analytics-live-hint');
    if (hint && s) {
        hint.textContent = s.enabled
            ? `${t('analytics.category.errorsDesc')} ${t('analytics.liveStatus').replace('{sent}', String(s.sent || 0)).replace('{pending}', String(s.pending || 0))}`
            : t('analytics.category.errorsDesc');
    }
}
