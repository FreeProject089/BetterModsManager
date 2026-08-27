// Walking a task one step at a time, and seeing what it is holding.
//
// A task that misbehaves gives you two things today: the running panel's current step, which is
// gone by the time you read it, and whatever `print` you thought to add beforehand. Both are
// after-the-fact. The question people actually have — "what is `path` right now, and why did
// that `if` go the other way" — had no way to be asked.
//
// So the runner gains a GATE. Before each step, if a debug session is watching this task, it
// stops and waits for somebody to press something. Nothing else about the run changes: the same
// steps, the same order, the same permissions. A debugger that runs the task differently from
// how it really runs is a debugger that lies about the bug.
//
// Deliberately BMMScript-only. A `run a script` step hands its code to PowerShell or Python in
// another process; stepping into that would mean writing a debugger for five languages, and
// pretending to would be worse than not offering it. The step is shown, run whole, and its
// result appears in the variables like anything else.

import { escHtml } from '../../core/utils.js';
import { t } from '../../core/i18n.js';
import { raiseAboveAll } from '../../ui/layer.js';
import type { RunCtx } from './sched-vars.js';

/** What the person watching last pressed. */
type DebugMode = 'step' | 'run';

interface Session {
    taskId: string;
    taskName: string;
    mode: DebugMode;
    /** Resolves the gate the runner is waiting on. Null when nothing is waiting. */
    release: (() => void) | null;
    /** Set when Stop was pressed: the runner throws instead of continuing. */
    stopped: boolean;
    panel: HTMLElement | null;
    /**
     * Every step that has been gated, in order.
     *
     * The panel used to show the CURRENT step and nothing else, which answers "where am I"
     * and not "how did I get here" — and the second is the question you have when a task
     * took a branch you did not expect. Kept in memory only; it goes with the session.
     */
    log: string[];
    /** The last snapshot, so the next one can say what CHANGED rather than just what is. */
    seen: Map<string, string>;
    /**
     * Run until a step's label contains this, then stop again. Empty = run to the end.
     *
     * The missing middle setting: Step is one at a time and Continue is all the way, and a
     * task with a hundred steps and one suspect `if` gave you a choice between a hundred
     * clicks and none.
     */
    breakOn: string;
}

let _session: Session | null = null;

/** Thrown when somebody stops a debug run. Caught by the runner like a cancellation. */
export class DebugStopped extends Error {
    constructor() {
        super('debug stopped');
        this.name = 'DebugStopped';
    }
}

/** Is this task being stepped through? */
export function debugging(taskId: string): boolean {
    return !!_session && _session.taskId === taskId && !_session.stopped;
}

/** Begin a session. The run itself is started by the caller, as normal. */
export function startDebug(taskId: string, taskName: string): void {
    endDebug();
    _session = {
        taskId, taskName, mode: 'step', release: null, stopped: false, panel: null,
        log: [], seen: new Map(), breakOn: '',
    };
    openPanel(taskName);
}

/**
 * Does this step's label match what we are running to?
 *
 * Case-insensitive substring. An empty needle never matches, so "Continue" with the box
 * blank means what it has always meant — run to the end.
 */
export function hitsBreakpoint(label: string, needle: string): boolean {
    const n = needle.trim().toLowerCase();
    return !!n && label.toLowerCase().includes(n);
}

/**
 * Which names are new or now hold something else.
 *
 * A run holding twenty variables repaints twenty rows on every step, and the one that just
 * moved looks exactly like the nineteen that did not. That is the whole reason somebody is
 * watching.
 */
export function changedSince(
    seen: Map<string, string>,
    rows: [string, string, string][],
): { changed: Set<string>; fresh: Set<string> } {
    const changed = new Set<string>();
    const fresh = new Set<string>();
    for (const [k, , v] of rows) {
        if (!seen.has(k)) fresh.add(k);
        else if (seen.get(k) !== v) changed.add(k);
    }
    return { changed, fresh };
}

/**
 * The session as text, for pasting into a bug report.
 *
 * Everything somebody would otherwise retype out of a screenshot, in an order that reads:
 * what ran, then what it was holding when it stopped.
 */
export function debugReport(taskName: string, log: string[], rows: [string, string, string][]): string {
    const steps = log.length
        ? log.map((l, i) => `${String(i + 1).padStart(3)}. ${l}`).join('\n')
        : '(nothing ran)';
    const vars = rows.length
        ? rows.map(([k, kind, v]) => `${k} (${kind}) = ${v}`).join('\n')
        : '(no variables)';
    return `BMM debug — ${taskName}\n\nSteps\n${steps}\n\nVariables\n${vars}\n`;
}

/** Tear the session down. Safe to call twice. */
export function endDebug(): void {
    if (!_session) return;
    // Release anything still waiting, or the run hangs forever holding a lock nobody can see.
    _session.release?.();
    _session.panel?.remove();
    _session = null;
}

/**
 * The gate. Called by the runner before each step.
 *
 * Returns immediately when nothing is watching, so the cost on an ordinary run is one map
 * lookup — a debugger that slows down every task to be available for one is not worth having.
 */
export async function gate(taskId: string, label: string, ctx: RunCtx): Promise<void> {
    const s = _session;
    if (!s || s.taskId !== taskId) return;
    if (s.stopped) throw new DebugStopped();
    // A cap, because a `repeat 10000 times` would otherwise grow this without bound and the
    // interesting part of a long run is the end of it.
    s.log.push(label);
    if (s.log.length > 500) s.log.splice(0, s.log.length - 500);
    paint(s, label, ctx);
    if (s.mode === 'run') {
        if (!hitsBreakpoint(label, s.breakOn)) return;
        // Reached what we were running to: back to stepping, and say so.
        s.mode = 'step';
        markMode(s);
    }
    await new Promise<void>((resolve) => {
        s.release = () => { s.release = null; resolve(); };
    });
    if (s.stopped) throw new DebugStopped();
}

/** Everything the run is holding, flattened for showing. */
export function snapshot(ctx: RunCtx): [string, string, string][] {
    const rows: [string, string, string][] = [];
    for (const [k, v] of Object.entries(ctx.text || {})) rows.push([k, 'text', String(v)]);
    for (const [k, v] of Object.entries(ctx.nums || {})) {
        // A name in both bags is the ordinary case — a capture writes the text and its number.
        // Showing it twice would read as two variables; showing only one would hide the half
        // somebody is actually comparing against.
        const at = rows.findIndex((r) => r[0] === k);
        if (at >= 0) rows[at][1] = 'text + num';
        else rows.push([k, 'num', String(v)]);
    }
    for (const [k, v] of Object.entries(ctx.lists || {})) rows.push([k, 'list', JSON.stringify(v)]);
    for (const [k, v] of Object.entries(ctx.maps || {})) rows.push([k, 'map', JSON.stringify(v)]);
    for (const [k, v] of Object.entries(ctx.shared || {})) {
        // Shared values are shown LAST and marked, because a run-scope value of the same name
        // wins when it is substituted — and somebody reading this list has to be able to tell
        // which one the next step will actually use.
        if (!rows.some((r) => r[0] === k)) rows.push([k, 'shared', String(v)]);
    }
    return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

function openPanel(taskName: string): void {
    const s = _session;
    if (!s) return;
    const el = document.createElement('div');
    el.className = 'dbg-panel';
    el.innerHTML = `
        <div class="dbg-head" id="dbg-head">
            <b>${escHtml(t('sched.dbg.title'))}</b>
            <span class="dbg-task">${escHtml(taskName)}</span>
            <span class="dbg-mode" id="dbg-mode">${escHtml(t('sched.dbg.modeStep'))}</span>
            <button type="button" class="dbg-x" id="dbg-stop" title="${escHtml(t('sched.dbg.stop'))}">&times;</button>
        </div>
        <div class="dbg-step" id="dbg-step">${escHtml(t('sched.dbg.waiting'))}</div>
        <details class="dbg-logwrap" id="dbg-logwrap">
            <summary>${escHtml(t('sched.dbg.log'))} <span id="dbg-logn">0</span></summary>
            <ol class="dbg-log" id="dbg-log"></ol>
        </details>
        <div class="dbg-vars" id="dbg-vars"></div>
        <div class="dbg-brk">
            <label for="dbg-break">${escHtml(t('sched.dbg.breakOn'))}</label>
            <input class="input" id="dbg-break" type="text"
                placeholder="${escHtml(t('sched.dbg.breakOnPh'))}"
                title="${escHtml(t('sched.dbg.breakOnTip'))}">
        </div>
        <div class="dbg-foot">
            <button type="button" class="btn btn-xs btn-accent" id="dbg-step-btn"
                title="${escHtml(t('sched.dbg.stepTip'))}">${escHtml(t('sched.dbg.step'))}</button>
            <button type="button" class="btn btn-xs btn-secondary" id="dbg-run-btn"
                title="${escHtml(t('sched.dbg.continueTip'))}">${escHtml(t('sched.dbg.continue'))}</button>
            <button type="button" class="btn btn-xs btn-ghost" id="dbg-copy-btn"
                title="${escHtml(t('sched.dbg.copyTip'))}">${escHtml(t('sched.dbg.copy'))}</button>
            <button type="button" class="btn btn-xs btn-ghost" id="dbg-stop-btn">${escHtml(t('sched.dbg.stop'))}</button>
        </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(el);
    raiseAboveAll(el, 11800);
    s.panel = el;

    el.querySelector('#dbg-step-btn')?.addEventListener('click', () => {
        // Also the way BACK from Continue: pressing this mid-run re-arms the gate, and the
        // next step stops. Nothing said so before, which made Continue feel one-way.
        s.mode = 'step';
        markMode(s);
        s.release?.();
    });
    el.querySelector('#dbg-run-btn')?.addEventListener('click', () => {
        // Carry on without stopping again — or until a step's label matches the box. The
        // session stays open so the panel keeps showing variables as they change, which is
        // the other half of what it is for.
        s.mode = 'run';
        markMode(s);
        s.release?.();
    });
    el.querySelector('#dbg-break')?.addEventListener('input', (e) => {
        s.breakOn = (e.target as HTMLInputElement).value;
        markMode(s);
    });
    el.querySelector('#dbg-copy-btn')?.addEventListener('click', (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const text = debugReport(s.taskName, s.log, _lastRows);
        void navigator.clipboard.writeText(text).then(
            () => flash(btn, t('sched.dbg.copied')),
            () => flash(btn, t('common.error')),
        );
    });
    const stop = () => { s.stopped = true; s.release?.(); };
    el.querySelector('#dbg-stop')?.addEventListener('click', stop);
    el.querySelector('#dbg-stop-btn')?.addEventListener('click', stop);
    dragBy(el, el.querySelector('#dbg-head') as HTMLElement);
}

/** The rows of the last paint, so Copy reports what is on screen rather than re-deriving. */
let _lastRows: [string, string, string][] = [];

/** Say a word on a button for a moment, then put its label back. */
function flash(btn: HTMLButtonElement, word: string): void {
    const was = btn.textContent;
    btn.textContent = word;
    btn.disabled = true;
    setTimeout(() => { btn.textContent = was; btn.disabled = false; }, 1400);
}

/** What the panel will do when the run reaches the next step. */
function markMode(s: Session): void {
    const el = s.panel?.querySelector('#dbg-mode') as HTMLElement | null;
    if (!el) return;
    el.textContent = s.mode === 'step'
        ? t('sched.dbg.modeStep')
        : s.breakOn.trim()
            ? (t('sched.dbg.modeUntil') || 'running until …').replace('{n}', s.breakOn.trim())
            : t('sched.dbg.modeRun');
    el.classList.toggle('is-run', s.mode === 'run');
}

/**
 * Let a floating panel be moved by its header.
 *
 * It is pinned to a corner, and the corner it is pinned to is sometimes exactly where the
 * step you are looking at is drawn. Pointer events rather than mouse, so a pen or a touch
 * screen moves it too, and capture so a fast drag does not lose the panel behind the cursor.
 */
function dragBy(panel: HTMLElement, handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const r = panel.getBoundingClientRect();
        const dx = e.clientX - r.left;
        const dy = e.clientY - r.top;
        handle.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
            // Clamped so it cannot be dragged off the edge and become unreachable.
            panel.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, m.clientX - dx))}px`;
            panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, m.clientY - dy))}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        };
        const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
    });
}

function paint(s: Session, label: string, ctx: RunCtx): void {
    const stepEl = s.panel?.querySelector('#dbg-step') as HTMLElement | null;
    const varsEl = s.panel?.querySelector('#dbg-vars') as HTMLElement | null;
    if (stepEl) stepEl.textContent = label;

    // What already ran. Newest at the bottom and scrolled to, so the list reads in the order
    // it happened rather than needing to be read backwards.
    const logEl = s.panel?.querySelector('#dbg-log') as HTMLElement | null;
    const logN = s.panel?.querySelector('#dbg-logn') as HTMLElement | null;
    if (logN) logN.textContent = String(s.log.length);
    if (logEl && (s.panel?.querySelector('#dbg-logwrap') as HTMLDetailsElement | null)?.open) {
        logEl.innerHTML = s.log.map((l) => `<li>${escHtml(l)}</li>`).join('');
        logEl.scrollTop = logEl.scrollHeight;
    }

    if (!varsEl) return;
    const rows = snapshot(ctx);
    _lastRows = rows;
    // Which ones moved. Twenty rows repainted identically hide the one that changed, and the
    // one that changed is the reason somebody is standing here.
    const { changed, fresh } = changedSince(s.seen, rows);
    s.seen = new Map(rows.map(([k, , v]) => [k, v]));
    varsEl.innerHTML = rows.length
        ? rows.map(([k, kind, v]) => {
            const mark = fresh.has(k) ? ' is-new' : changed.has(k) ? ' is-changed' : '';
            return `<div class="dbg-var${mark}">
               <code class="dbg-k">${escHtml(k)}</code>
               <span class="dbg-t">${escHtml(kind)}</span>
               <span class="dbg-v" title="${escHtml(v)}">${escHtml(v.length > 200 ? `${v.slice(0, 200)}…` : v)}</span>
           </div>`;
        }).join('')
        : `<p class="dbg-none">${escHtml(t('sched.dbg.noVars'))}</p>`;
}
