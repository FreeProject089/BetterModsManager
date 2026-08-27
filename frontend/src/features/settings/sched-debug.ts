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
    mode: DebugMode;
    /** Resolves the gate the runner is waiting on. Null when nothing is waiting. */
    release: (() => void) | null;
    /** Set when Stop was pressed: the runner throws instead of continuing. */
    stopped: boolean;
    panel: HTMLElement | null;
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
    _session = { taskId, mode: 'step', release: null, stopped: false, panel: null };
    openPanel(taskName);
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
    paint(s, label, ctx);
    if (s.mode === 'run') return;
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
        <div class="dbg-head">
            <b>${escHtml(t('sched.dbg.title'))}</b>
            <span class="dbg-task">${escHtml(taskName)}</span>
            <button type="button" class="dbg-x" id="dbg-stop" title="${escHtml(t('sched.dbg.stop'))}">&times;</button>
        </div>
        <div class="dbg-step" id="dbg-step">${escHtml(t('sched.dbg.waiting'))}</div>
        <div class="dbg-vars" id="dbg-vars"></div>
        <div class="dbg-foot">
            <button type="button" class="btn btn-xs btn-accent" id="dbg-step-btn">${escHtml(t('sched.dbg.step'))}</button>
            <button type="button" class="btn btn-xs btn-secondary" id="dbg-run-btn">${escHtml(t('sched.dbg.continue'))}</button>
            <button type="button" class="btn btn-xs btn-ghost" id="dbg-stop-btn">${escHtml(t('sched.dbg.stop'))}</button>
        </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(el);
    raiseAboveAll(el, 11800);
    s.panel = el;

    el.querySelector('#dbg-step-btn')?.addEventListener('click', () => {
        s.mode = 'step';
        s.release?.();
    });
    el.querySelector('#dbg-run-btn')?.addEventListener('click', () => {
        // Carry on without stopping again. The session stays open so the panel keeps showing
        // variables as they change — which is the other half of what it is for.
        s.mode = 'run';
        s.release?.();
    });
    const stop = () => { s.stopped = true; s.release?.(); };
    el.querySelector('#dbg-stop')?.addEventListener('click', stop);
    el.querySelector('#dbg-stop-btn')?.addEventListener('click', stop);
}

function paint(s: Session, label: string, ctx: RunCtx): void {
    const stepEl = s.panel?.querySelector('#dbg-step') as HTMLElement | null;
    const varsEl = s.panel?.querySelector('#dbg-vars') as HTMLElement | null;
    if (stepEl) stepEl.textContent = label;
    if (!varsEl) return;
    const rows = snapshot(ctx);
    varsEl.innerHTML = rows.length
        ? rows.map(([k, kind, v]) => `<div class="dbg-var">
               <code class="dbg-k">${escHtml(k)}</code>
               <span class="dbg-t">${escHtml(kind)}</span>
               <span class="dbg-v" title="${escHtml(v)}">${escHtml(v.length > 200 ? `${v.slice(0, 200)}…` : v)}</span>
           </div>`).join('')
        : `<p class="dbg-none">${escHtml(t('sched.dbg.noVars'))}</p>`;
}
