/**
 * activity-center.ts — the title-bar button and panel that show everything BMM is doing.
 *
 * The button sits beside the window controls on every view: a ring that fills with the overall
 * progress, and a badge with the number of running actions. It opens a panel (non-modal popover)
 * with one row per running action (kind, title, step, bar, elapsed time, Cancel where the
 * subsystem can stop) and the recent history (success / error with its message / cancelled).
 *
 * The data is core/activity.ts; the adapters that fill it are core/activity-sources.ts. The
 * activation pill (activation-indicator.ts) stays as it was: it is the at-a-glance view of the
 * mod in flight, this is the list of all of it.
 *
 * Keyboard: the button is a real <button>; opening moves focus into the panel, Esc closes it and
 * gives focus back to the button, Tab walks the panel's buttons. A click outside closes it.
 */
import { t } from '../core/i18n.js';
import { escHtml, escAttr } from '../core/utils.js';
import { uiIcon, type IconName } from './icons.js';
import {
    subscribeActivity, runningActivities, activityHistory, clearActivityHistory, cancelActivity,
    overallProgress, type ActivityEntry, type ActivityKind,
} from '../core/activity.js';

const KIND_ICON: Record<ActivityKind, IconName> = {
    activation: 'power',
    download: 'download',
    sync: 'refresh',
    scan: 'search',
    install: 'package',
    export: 'export',
    import: 'import',
    schedule: 'calendar',
    ai: 'ai',
    repair: 'reapply',
    hash: 'fingerprint',
    benchmark: 'activity',
    other: 'loader',
};

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

let btn: HTMLButtonElement | null = null;
let badge: HTMLElement | null = null;
let ringFill: SVGCircleElement | null = null;
let panel: HTMLElement | null = null;
let paintQueued = false;
let ticker: number | null = null;
let inited = false;

function kindLabel(k: ActivityKind): string {
    switch (k) {
        case 'activation': return t('activity.kind.activation');
        case 'download': return t('activity.kind.download');
        case 'sync': return t('activity.kind.sync');
        case 'scan': return t('activity.kind.scan');
        case 'install': return t('activity.kind.install');
        case 'export': return t('activity.kind.export');
        case 'import': return t('activity.kind.import');
        case 'schedule': return t('activity.kind.schedule');
        case 'ai': return t('activity.kind.ai');
        case 'repair': return t('activity.kind.repair');
        case 'hash': return t('activity.kind.hash');
        case 'benchmark': return t('activity.kind.benchmark');
        default: return t('activity.kind.other');
    }
}

/** "4 s", "2 min 05 s", "1 h 03 min". */
export function formatElapsed(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return t('activity.sec', { s: String(s) });
    const m = Math.floor(s / 60);
    if (m < 60) return t('activity.minSec', { m: String(m), s: String(s % 60).padStart(2, '0') });
    return t('activity.hourMin', { h: String(Math.floor(m / 60)), m: String(m % 60).padStart(2, '0') });
}

function clockTime(ts: number): string {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

// ── the button ─────────────────────────────────────────────────────────────────────────────

function mountButton(): void {
    if (btn && btn.isConnected) return;
    const bar = document.querySelector('.titlebar');
    if (!bar) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'btn-activity-center';
    b.className = 'actc-btn';
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML = `
        <svg class="actc-ring" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
            <circle class="actc-ring-track" cx="18" cy="18" r="${RING_R}"/>
            <circle class="actc-ring-fill" cx="18" cy="18" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/>
        </svg>
        ${uiIcon('activity', 14, { cls: 'actc-btn-ic' })}
        <span class="actc-badge" hidden></span>`;
    b.addEventListener('click', () => toggleActivityCenter());
    const controls = bar.querySelector('.titlebar-controls');
    if (controls) bar.insertBefore(b, controls); else bar.appendChild(b);
    btn = b;
    badge = b.querySelector('.actc-badge');
    ringFill = b.querySelector('.actc-ring-fill');
}

function paintButton(): void {
    mountButton();
    if (!btn) return;
    const run = runningActivities();
    const n = run.length;
    btn.classList.toggle('is-busy', n > 0);
    const p = overallProgress(run);
    btn.classList.toggle('is-indeterminate', n > 0 && p === null);
    if (ringFill) ringFill.style.strokeDashoffset = String((RING_C * (1 - (n > 0 && p !== null ? p : 0))).toFixed(2));
    const errs = activityHistory().filter((e) => e.state === 'error' && e.endedAt && Date.now() - e.endedAt < 60_000).length;
    btn.classList.toggle('has-error', n === 0 && errs > 0);
    if (badge) {
        badge.hidden = n === 0;
        badge.textContent = n > 99 ? '99+' : String(n);
    }
    const label = n > 0 ? t('activity.btnRunning', { n: String(n) }) : t('activity.title');
    btn.setAttribute('aria-label', label);
    btn.title = label;
}

// ── the panel ──────────────────────────────────────────────────────────────────────────────

function runningRow(e: ActivityEntry): string {
    const pct = e.progress === null ? null : Math.round(e.progress * 100);
    const bar = `<div class="actc-bar${pct === null ? ' is-indeterminate' : ''}" role="progressbar"
            aria-label="${escAttr(e.title)}" aria-valuemin="0" aria-valuemax="100"${pct === null ? '' : ` aria-valuenow="${pct}"`}>
            <span style="--actc-p:${pct === null ? 0 : (pct / 100).toFixed(3)}"></span></div>`;
    const cancel = e.cancellable
        ? `<button type="button" class="actc-cancel" data-cancel="${escAttr(e.id)}" data-focus-key="cancel-${escAttr(e.id)}"
                ${e.cancelling ? 'disabled' : ''} aria-label="${escAttr(t('activity.cancelOne', { title: e.title }))}">
                ${uiIcon('stop', 12)}<span>${escHtml(e.cancelling ? t('activity.cancelling') : t('activity.cancel'))}</span></button>`
        : '';
    return `<li class="actc-row is-running" data-id="${escAttr(e.id)}">
        <span class="actc-kind" title="${escAttr(kindLabel(e.kind))}">${uiIcon(KIND_ICON[e.kind] || 'loader', 16)}</span>
        <div class="actc-main">
            <div class="actc-line">
                <span class="actc-title">${escHtml(e.title)}</span>
                <span class="actc-time" data-started="${e.startedAt}">${escHtml(formatElapsed(Date.now() - e.startedAt))}</span>
            </div>
            ${e.detail ? `<div class="actc-detail" title="${escAttr(e.detail)}">${escHtml(e.detail)}</div>` : ''}
            <div class="actc-progress">${bar}${pct === null ? '' : `<span class="actc-pct">${pct}%</span>`}</div>
        </div>
        ${cancel}
    </li>`;
}

function historyRow(e: ActivityEntry): string {
    const icon: IconName = e.state === 'done' ? 'success' : e.state === 'error' ? 'error' : 'stop';
    const stateText = e.state === 'done' ? t('activity.stateDone') : e.state === 'error' ? t('activity.stateError') : t('activity.stateCancelled');
    const took = e.endedAt ? formatElapsed(e.endedAt - e.startedAt) : '';
    const sub = e.state === 'error' && e.error ? e.error : e.detail;
    return `<li class="actc-row is-${e.state}">
        <span class="actc-kind actc-state" title="${escAttr(stateText)}">${uiIcon(icon, 16, { label: stateText })}</span>
        <div class="actc-main">
            <div class="actc-line">
                <span class="actc-title">${escHtml(e.title)}</span>
                <span class="actc-time">${escHtml(e.endedAt ? clockTime(e.endedAt) : '')}</span>
            </div>
            ${sub ? `<div class="actc-detail${e.state === 'error' ? ' actc-error' : ''}" title="${escAttr(sub)}">${escHtml(sub)}</div>` : ''}
            <div class="actc-meta">${escHtml(kindLabel(e.kind))}${took ? ` · ${escHtml(took)}` : ''}</div>
        </div>
    </li>`;
}

function panelHTML(): string {
    const run = runningActivities();
    const hist = activityHistory();
    const runBlock = run.length
        ? `<ul class="actc-list">${run.map(runningRow).join('')}</ul>`
        : `<p class="actc-empty">${escHtml(t('activity.idle'))}</p>`;
    const histBlock = hist.length
        ? `<ul class="actc-list">${hist.map(historyRow).join('')}</ul>`
        : `<p class="actc-empty">${escHtml(t('activity.noHistory'))}</p>`;
    return `
        <div class="actc-head">
            <strong id="actc-heading">${escHtml(t('activity.title'))}</strong>
            <button type="button" class="actc-act" id="actc-close" data-focus-key="close" aria-label="${escAttr(t('activity.close'))}">${uiIcon('close', 14)}</button>
        </div>
        <div class="actc-body">
            <h3 class="actc-sec">${escHtml(t('activity.running'))}${run.length ? ` <span class="actc-count">${run.length}</span>` : ''}</h3>
            ${runBlock}
            <div class="actc-sec-row">
                <h3 class="actc-sec">${escHtml(t('activity.recent'))}</h3>
                ${hist.length ? `<button type="button" class="actc-act" id="actc-clear" data-focus-key="clear">${uiIcon('clear', 14)}<span>${escHtml(t('activity.clearHistory'))}</span></button>` : ''}
            </div>
            ${histBlock}
        </div>`;
}

function paintPanel(): void {
    if (!panel) return;
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && panel.contains(active) ? active.dataset.focusKey : undefined;
    const body = panel.querySelector('.actc-body');
    const scroll = body ? body.scrollTop : 0;
    panel.innerHTML = panelHTML();
    const nb = panel.querySelector('.actc-body');
    if (nb) nb.scrollTop = scroll;
    if (focusKey) {
        const again = panel.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`);
        (again || panel).focus();
    }
}

/** Only the elapsed times move every second: no rebuild, so nothing under the pointer jumps. */
function tickTimes(): void {
    if (!panel) return;
    const now = Date.now();
    panel.querySelectorAll<HTMLElement>('.actc-time[data-started]').forEach((el) => {
        const s = Number(el.dataset.started);
        if (Number.isFinite(s)) el.textContent = formatElapsed(now - s);
    });
}

function onPanelClick(ev: MouseEvent): void {
    const target = ev.target as HTMLElement;
    const c = target.closest<HTMLButtonElement>('[data-cancel]');
    if (c) { c.disabled = true; void cancelActivity(String(c.dataset.cancel)); return; }
    if (target.closest('#actc-clear')) { clearActivityHistory(); return; }
    if (target.closest('#actc-close')) closePanel(true);
}

const onOutside = (e: MouseEvent): void => {
    if (!panel) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (path.includes(panel) || (btn && path.includes(btn))) return;
    closePanel(false);
};

const onKey = (e: KeyboardEvent): void => {
    if (!panel) return;
    if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        closePanel(true);
    }
};

function position(): void {
    if (!panel || !btn) return;
    const r = btn.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 6)}px`;
    panel.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
}

function closePanel(returnFocus: boolean): void {
    if (!panel) return;
    panel.remove();
    panel = null;
    btn?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', position);
    if (ticker !== null) { window.clearInterval(ticker); ticker = null; }
    if (returnFocus) btn?.focus();
}

export function toggleActivityCenter(): void {
    if (panel) { closePanel(true); return; }
    mountButton();
    if (!btn) return;
    const p = document.createElement('div');
    p.className = 'actc-panel';
    p.id = 'activity-center-panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-labelledby', 'actc-heading');
    p.tabIndex = -1;
    p.addEventListener('mousedown', (e) => e.stopPropagation());
    p.addEventListener('click', onPanelClick);
    document.body.appendChild(p);
    panel = p;
    paintPanel();
    position();
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', p.id);
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', position);
    ticker = window.setInterval(tickTimes, 1000);
    // Focus the first thing you can act on: a Cancel when something runs, else the close button.
    const first = p.querySelector<HTMLElement>('[data-cancel]:not([disabled])') || p.querySelector<HTMLElement>('#actc-close');
    (first || p).focus();
}

function schedulePaint(): void {
    if (paintQueued) return;
    paintQueued = true;
    let ran = false;
    const go = () => {
        if (ran) return;
        ran = true;
        paintQueued = false;
        paintButton();
        paintPanel();
    };
    // A frame when the window paints, a timer for a hidden window that gets no frames.
    requestAnimationFrame(go);
    setTimeout(go, 200);
}

/** Mount the button and follow the registry. Idempotent. */
export function initActivityCenter(): void {
    if (inited) return;
    inited = true;
    paintButton();
    subscribeActivity(schedulePaint);
    document.addEventListener('langChanged', schedulePaint);
}
