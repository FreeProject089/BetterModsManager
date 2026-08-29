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
    log: { label: string; done: boolean }[];
    /** The run's own context, so a value can be changed at a breakpoint. */
    ctx: RunCtx | null;
    /** Substring filter over the variable names. */
    filter: string;
    /**
     * Every value each variable has held, and the step number that left it there.
     *
     * "It is empty NOW" is half an answer; the question is which step emptied it. The
     * panel could only ever show the present and a one-step highlight, so answering that
     * meant stepping the whole task again and watching one row.
     */
    history: Map<string, { step: number; value: string }[]>;
    /** How many steps have been gated. The history's x-axis, and worth showing by itself. */
    steps: number;
    /** Wall clock, so a step that took nine seconds is visible as one. */
    startedAt: number;
    lastStepAt: number;
    /**
     * Set when the run threw. The panel STAYS, showing this and the values at that moment.
     *
     * It used to be torn down in the runner's `finally` — so the one moment a debugger
     * exists for was the one moment its window was already gone, and all you had was a
     * toast with the message in it.
     */
    failed: string;
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
        log: [], seen: new Map(), breakOn: '', ctx: null, filter: '',
        history: new Map(), steps: 0, startedAt: Date.now(), lastStepAt: Date.now(),
        failed: '',
    };
    openPanel(taskName);
}

/**
 * Does this step's label match anything we are running to?
 *
 * Case-insensitive substring, and now a COMMA-SEPARATED LIST. One needle was the wrong
 * shape for the question people actually have: a task usually has two or three places
 * worth stopping at, and one box meant running the task once per place.
 *
 * An empty needle never matches, so "Continue" with the box blank means what it has always
 * meant — run to the end. Blank entries between commas are dropped for the same reason:
 * `download,,upload` must not become "stop at everything".
 */
export function hitsBreakpoint(label: string, needle: string): boolean {
    const hay = label.toLowerCase();
    return breakpointList(needle).some((n) => hay.includes(n));
}

/** The needles in a breakpoint box, lowercased, blanks dropped. */
export function breakpointList(needle: string): string[] {
    return needle.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
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
 * Append this step's values to each variable's trail.
 *
 * Only what CHANGED is recorded. A run holding twenty variables over two hundred steps
 * would otherwise store four thousand identical entries, and the trail somebody opens to
 * find the one step that mattered would be a wall of the same value.
 *
 * The cap drops the OLDEST entries. A variable that changed a thousand times is being
 * changed in a loop, and the end of that loop is where the wrong value came from.
 */
export function recordHistory(
    history: Map<string, { step: number; value: string }[]>,
    step: number,
    rows: [string, string, string][],
    cap = 60,
): void {
    for (const [k, , v] of rows) {
        let trail = history.get(k);
        if (!trail) { trail = []; history.set(k, trail); }
        if (trail.length && trail[trail.length - 1].value === v) continue;
        trail.push({ step, value: v });
        if (trail.length > cap) trail.splice(0, trail.length - cap);
    }
}

/**
 * What a thrown thing says, trimmed to something a panel can hold.
 *
 * An Error's `message` and not its `toString`, because "Error: " in front of every failure
 * is noise on a line that has one job. Anything that is not an Error is printed as it is —
 * a task can throw a string, and hiding it behind "unknown error" would lose the only
 * description there was.
 */
export function failLine(err: unknown): string {
    const raw = err instanceof Error ? (err.message || err.name) : String(err);
    const one = raw.replace(/\s+/g, ' ').trim();
    return one.length > 400 ? `${one.slice(0, 400)}\u2026` : (one || 'error');
}

/**
 * The session as text, for pasting into a bug report.
 *
 * Everything somebody would otherwise retype out of a screenshot, in an order that reads:
 * what ran, then what it was holding when it stopped.
 */
export function debugReport(
    taskName: string,
    log: { label: string; done: boolean }[],
    rows: [string, string, string][],
    failed = '',
): string {
    // The mark says which step the run is standing on, which is the first thing anybody
    // reading a pasted report wants to know.
    const steps = log.length
        ? log.map((l, i) => `${String(i + 1).padStart(3)}. ${l.done ? ' ' : '>'} ${l.label}`).join('\n')
        : '(nothing ran)';
    const vars = rows.length
        ? rows.map(([k, kind, v]) => `${k} (${kind}) = ${v}`).join('\n')
        : '(no variables)';
    // First, because it is the reason the report exists when there is one. A reader who
    // has to scroll past two hundred steps to find out whether it failed will not.
    const head = failed ? `BMM debug — ${taskName}\nFAILED: ${failed}\n` : `BMM debug — ${taskName}\n`;
    return `${head}\nSteps\n${steps}\n\nVariables\n${vars}\n`;
}

/**
 * The run threw. Keep the window open on the moment it did.
 *
 * Called from the runner's catch, BEFORE its `finally` tears the session down. That order
 * was the bug: a failing task closed the debugger and left a toast, so the one moment
 * somebody opens a debugger for — "it broke, what was it holding" — was the one moment the
 * variables were already gone.
 *
 * The session stops being a gate immediately (nothing can wait on it, nothing can hang);
 * only the panel survives, and only to be read.
 */
export function failDebug(err: unknown): void {
    const s = _session;
    if (!s || s.failed) return;
    s.failed = failLine(err);
    // The step it was standing on is the one that threw. It is already the only entry
    // without a tick, which is now also what the red mark hangs on.
    paintFailure(s);
}

/**
 * Tear the session down. Safe to call twice.
 *
 * A FAILED session detaches — the runner can no longer reach it, so nothing waits on a
 * button that resolves nothing — but its panel stays until the person closes it.
 */
export function endDebug(): void {
    if (!_session) return;
    // Release anything still waiting, or the run hangs forever holding a lock nobody can see.
    _session.release?.();
    _session.release = null;
    if (_session.failed) {
        _session = null;   // detached: `debugging()` is false, the panel is just a document
        return;
    }
    // The panel STAYS. It used to be removed the moment the run finished, which threw away
    // the log, the variables and anything that had gone wrong on the way — after pressing
    // "run to the end", the answer to "so what happened" was an empty screen. It is an
    // inspector, and an inspector outlives the run it inspected; the × puts it away.
    finishPanel(_session, t('sched.dbg.finished'));
    detachKeys();
    _session = null;
}

/**
 * The terminal state: what ran, how long it took, and no controls that pretend otherwise.
 *
 * Step and Run are disabled because there is no gate left to release — a button that resolves
 * nothing is the difference between an inspector and a screenshot with buttons on it.
 */
function finishPanel(s: Session, word: string): void {
    const el = s.panel;
    if (!el) return;
    el.classList.add('is-done');
    const mode = el.querySelector('#dbg-mode') as HTMLElement | null;
    if (mode && !s.failed) { mode.textContent = word; mode.classList.remove('is-run'); }
    const secs = Math.max(0, Math.round((Date.now() - s.startedAt) / 100) / 10);
    const step = el.querySelector('#dbg-step') as HTMLElement | null;
    if (step && !s.failed) {
        step.textContent = (t('sched.dbg.finishedLine') || '{w} — {n} step(s), {s}s')
            .replace('{w}', word).replace('{n}', String(s.steps)).replace('{s}', String(secs));
    }
    for (const id of ['#dbg-step-btn', '#dbg-run-btn', '#dbg-stop-btn']) {
        const b = el.querySelector(id) as HTMLButtonElement | null;
        if (b) b.disabled = true;
    }
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
    // The gate runs BEFORE a step, so reaching it again is proof the previous one finished
    // without throwing. That is the outcome for free, with no change to the runner: the last
    // entry stays unmarked, so a step that failed — or the one you are standing on — is the
    // one without a tick, which is exactly the line worth looking at.
    if (s.log.length) s.log[s.log.length - 1].done = true;
    // A cap, because a `repeat 10000 times` would otherwise grow this without bound and the
    // interesting part of a long run is the end of it.
    s.log.push({ label, done: false });
    if (s.log.length > 500) s.log.splice(0, s.log.length - 500);
    s.ctx = ctx;
    s.steps++;
    s.lastStepAt = Date.now();
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
            <span class="dbg-count" id="dbg-count" title="${escHtml(t('sched.dbg.countTip'))}">0</span>
            <button type="button" class="dbg-x" id="dbg-close" title="${escHtml(t('sched.dbg.close'))}">&times;</button>
        </div>
        <div class="dbg-fail" id="dbg-fail" hidden></div>
        <div class="dbg-step" id="dbg-step">${escHtml(t('sched.dbg.waiting'))}</div>
        <details class="dbg-logwrap" id="dbg-logwrap">
            <summary>${escHtml(t('sched.dbg.log'))} <span id="dbg-logn">0</span></summary>
            <ol class="dbg-log" id="dbg-log"></ol>
        </details>
        <div class="dbg-filter">
            <input type="search" class="input" id="dbg-filter"
                placeholder="${escHtml(t('sched.dbg.filter'))}" spellcheck="false">
        </div>
        <div class="dbg-vars" id="dbg-vars"></div>
        <div class="dbg-trail" id="dbg-trail" hidden></div>
        <div class="dbg-brk">
            <label for="dbg-break">${escHtml(t('sched.dbg.breakOn'))}</label>
            <input class="input" id="dbg-break" type="text"
                placeholder="${escHtml(t('sched.dbg.breakOnPhMulti'))}"
                title="${escHtml(t('sched.dbg.breakOnTip'))}">
        </div>
        <div class="dbg-foot">
            <button type="button" class="btn btn-xs btn-accent" id="dbg-step-btn"
                title="${escHtml(t('sched.dbg.stepTip'))}">${escHtml(t('sched.dbg.step'))}</button>
            <button type="button" class="btn btn-xs btn-secondary" id="dbg-run-btn"
                title="${escHtml(t('sched.dbg.continueTip'))}">${escHtml(t('sched.dbg.continue'))}</button>
            <span class="dbg-foot-sp"></span>
            <button type="button" class="btn btn-xs btn-ghost" id="dbg-copy-btn"
                title="${escHtml(t('sched.dbg.copyTip'))}">${escHtml(t('sched.dbg.copy'))}</button>
            <button type="button" class="btn btn-xs btn-ghost dbg-danger" id="dbg-stop-btn"
                title="${escHtml(t('sched.dbg.stopTip'))}">${escHtml(t('sched.dbg.stop'))}</button>
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
    el.querySelector('#dbg-filter')?.addEventListener('input', (e) => {
        s.filter = (e.target as HTMLInputElement).value;
        repaintVars(s);
    });
    // Changing a value at a breakpoint, which is most of what a debugger is FOR: the point
    // of stopping before an `if` is to ask what the other branch does without editing the
    // task, running it again, and hoping the world cooperates.
    //
    // Delegated, because the rows are rebuilt on every step.
    // Clicking the NAME asks "how did it get like that": every value it has held, and the
    // step that left it there. Distinct from clicking the VALUE, which edits it — one row,
    // two questions, and they were both worth having.
    el.querySelector('#dbg-vars')?.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest('.dbg-k') as HTMLElement | null;
        if (k) { showTrail(s, k.textContent || ''); return; }
    });
    el.querySelector('#dbg-trail')?.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.dbg-trail-x')) hideTrail(s);
    });
    el.querySelector('#dbg-vars')?.addEventListener('click', (e) => {
        const v = (e.target as HTMLElement).closest('.dbg-v') as HTMLElement | null;
        if (!v || !s.ctx || v.querySelector('input')) return;
        const name = v.dataset.name || '';
        const input = document.createElement('input');
        input.className = 'input dbg-edit';
        input.value = v.dataset.raw || '';
        const commit = (save: boolean) => {
            if (save && s.ctx) {
                // Written to the same bag it was read from. A number that came back as text
                // would stop matching a `value` condition, which is the comparison somebody
                // stopped here to influence.
                if (Object.prototype.hasOwnProperty.call(s.ctx.nums || {}, name)) {
                    const n = Number(input.value);
                    if (Number.isFinite(n)) s.ctx.nums[name] = n;
                } else {
                    s.ctx.text[name] = input.value;
                }
                // Not counted as a change by the next paint: the highlight is for what the
                // TASK did, and colouring your own edit would hide the next real one.
                s.seen.set(name, input.value);
            }
            repaintVars(s);
        };
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
            if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
        });
        input.addEventListener('blur', () => commit(true));
        v.textContent = '';
        v.appendChild(input);
        input.focus();
        input.select();
    });
    el.querySelector('#dbg-copy-btn')?.addEventListener('click', (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const text = debugReport(s.taskName, s.log, _lastRows, s.failed);
        void navigator.clipboard.writeText(text).then(
            () => flash(btn, t('sched.dbg.copied')),
            () => flash(btn, t('common.error')),
        );
    });
    // Two different things, which used to be one.
    //
    // STOP ends the run: the gate throws `DebugStopped` and the task unwinds. CLOSE puts the
    // panel away and leaves whatever already happened alone. They were wired to the same
    // handler, so the × — which closes every other panel in BMM — killed the task instead;
    // and once a run had ENDED it did nothing at all, because there was no gate left to
    // release. A failed session's panel could not be dismissed by any means.
    el.querySelector('#dbg-stop-btn')?.addEventListener('click', () => {
        s.stopped = true;
        s.release?.();
        // A run that is already over has nothing to stop. Say it is over rather than leaving
        // a button that looks like it did something.
        if (!s.release) finishPanel(s, t('sched.dbg.endedShort'));
    });
    el.querySelector('#dbg-close')?.addEventListener('click', () => {
        s.stopped = true;
        s.release?.();
        detachKeys();
        el.remove();
    });
    dragBy(el, el.querySelector('#dbg-head') as HTMLElement);
    attachKeys(s);
}

/**
 * F10 steps, F5 continues.
 *
 * The two most-pressed buttons in the panel were the two that required moving a hand off
 * the keyboard, on a screen whose whole purpose is pressing one of them a hundred times.
 * The same keys every debugger has used for thirty years, so nobody has to learn them.
 *
 * Nothing is bound to Escape: it closes modals all over BMM, and a key that sometimes stops
 * a debug run and sometimes shuts a dialog behind it is worse than no key.
 */
let _keyHandler: ((e: KeyboardEvent) => void) | null = null;

function attachKeys(s: Session): void {
    detachKeys();
    _keyHandler = (e: KeyboardEvent) => {
        if (!_session || _session !== s || s.failed) return;
        // Never while somebody is typing — the filter and the breakpoint box are inputs, and
        // a debugger that steps when you type an F in a search field is a broken one.
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        if (e.key === 'F10') {
            e.preventDefault();
            s.mode = 'step';
            markMode(s);
            s.release?.();
        } else if (e.key === 'F5') {
            e.preventDefault();
            s.mode = 'run';
            markMode(s);
            s.release?.();
        }
    };
    document.addEventListener('keydown', _keyHandler, true);
}

function detachKeys(): void {
    if (_keyHandler) document.removeEventListener('keydown', _keyHandler, true);
    _keyHandler = null;
}

/** Show one variable's whole trail: every value, and the step that left it there. */
function showTrail(s: Session, name: string): void {
    const box = s.panel?.querySelector('#dbg-trail') as HTMLElement | null;
    if (!box) return;
    const trail = s.history.get(name) || [];
    box.hidden = false;
    box.innerHTML = `
        <div class="dbg-trail-head">
            <code>${escHtml(name)}</code>
            <span>${escHtml((t('sched.dbg.trailN') || '{n} value(s)').replace('{n}', String(trail.length)))}</span>
            <button type="button" class="dbg-trail-x" aria-label="${escHtml(t('common.close'))}">&times;</button>
        </div>
        ${trail.length
            ? `<ol class="dbg-trail-list">${trail.map((h) => `
                <li><span class="dbg-trail-step">#${h.step}</span>
                    <span class="dbg-trail-val">${escHtml(h.value.length > 200 ? `${h.value.slice(0, 200)}\u2026` : h.value)}</span></li>`).join('')}</ol>`
            : `<p class="dbg-none">${escHtml(t('sched.dbg.trailNone'))}</p>`}`;
    (box.querySelector('.dbg-trail-list') as HTMLElement | null)?.scrollTo(0, 1e6);
}

function hideTrail(s: Session): void {
    const box = s.panel?.querySelector('#dbg-trail') as HTMLElement | null;
    if (box) { box.hidden = true; box.innerHTML = ''; }
}

/**
 * Repaint the panel as a post-mortem.
 *
 * Everything that would advance the run goes, because there is no run left to advance. What
 * stays is everything that can be READ: the step it died on, the values it was holding, the
 * trail behind each of them, and Copy.
 */
function paintFailure(s: Session): void {
    const el = s.panel;
    if (!el) return;
    detachKeys();
    const fail = el.querySelector('#dbg-fail') as HTMLElement | null;
    if (fail) {
        fail.hidden = false;
        fail.textContent = `${t('sched.dbg.failed')} — ${s.failed}`;
    }
    el.classList.add('is-failed');
    const mode = el.querySelector('#dbg-mode') as HTMLElement | null;
    if (mode) { mode.textContent = t('sched.dbg.failedShort'); mode.classList.remove('is-run'); }
    // The step it stopped on is already the one without a tick. Marked red so a two-hundred
    // entry log does not have to be scanned for the absence of a character.
    const logEl = el.querySelector('#dbg-log') as HTMLElement | null;
    logEl?.querySelector('.is-here')?.classList.add('is-failed');
    for (const id of ['#dbg-step-btn', '#dbg-run-btn']) {
        const b = el.querySelector(id) as HTMLButtonElement | null;
        if (b) b.disabled = true;
    }
    const stopBtn = el.querySelector('#dbg-stop-btn') as HTMLButtonElement | null;
    if (stopBtn) stopBtn.textContent = t('common.close');
    // The breakpoint box and the step keys mean nothing now; the filter still does, because
    // finding one variable among forty is exactly what a post-mortem is for.
    const brk = el.querySelector('.dbg-brk') as HTMLElement | null;
    if (brk) brk.hidden = true;
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
        // The one without a tick is where the run is standing — or where it stopped.
        logEl.innerHTML = s.log.map((l) =>
            `<li class="${l.done ? 'is-done' : 'is-here'}">${escHtml(l.label)}</li>`).join('');
        logEl.scrollTop = logEl.scrollHeight;
    }

    if (!varsEl) return;
    const rows = snapshot(ctx);
    _lastRows = rows;
    // Which ones moved. Twenty rows repainted identically hide the one that changed, and the
    // one that changed is the reason somebody is standing here.
    //
    // Computed HERE and not in repaintVars: typing in the filter must not count as the task
    // changing something, and neither must your own edit.
    const { changed, fresh } = changedSince(s.seen, rows);
    recordHistory(s.history, s.steps, rows);
    s.seen = new Map(rows.map(([k, , v]) => [k, v]));
    const countEl = s.panel?.querySelector('#dbg-count') as HTMLElement | null;
    if (countEl) {
        // Steps and seconds. A step that took nine of them is a fact the panel could not
        // show at all, and it is usually the step somebody is looking for.
        const secs = Math.round((Date.now() - s.startedAt) / 1000);
        countEl.textContent = `${s.steps} · ${secs}s`;
    }
    _lastMarks = { changed, fresh };
    repaintVars(s);
}

/** What the last paint decided had moved, so a redraw does not have to decide again. */
let _lastMarks: { changed: Set<string>; fresh: Set<string> } = { changed: new Set(), fresh: new Set() };

/**
 * Draw the variable list from the last snapshot.
 *
 * Separate from `paint` because the filter and an edit redraw it WITHOUT a step having
 * happened — and re-deciding "what changed" on those would light up rows nothing touched.
 */
function repaintVars(s: Session): void {
    const varsEl = s.panel?.querySelector('#dbg-vars') as HTMLElement | null;
    if (!varsEl) return;
    const needle = s.filter.trim().toLowerCase();
    const rows = needle
        ? _lastRows.filter(([k]) => k.toLowerCase().includes(needle))
        : _lastRows;
    const { changed, fresh } = _lastMarks;
    varsEl.innerHTML = rows.length
        ? rows.map(([k, kind, v]) => {
            const mark = fresh.has(k) ? ' is-new' : changed.has(k) ? ' is-changed' : '';
            const short = v.length > 200 ? `${v.slice(0, 200)}…` : v;
            return `<div class="dbg-var${mark}">
               <code class="dbg-k" title="${escHtml(t('sched.dbg.trailTip'))}">${escHtml(k)}</code>
               <span class="dbg-t">${escHtml(kind)}</span>
               <span class="dbg-v" data-name="${escHtml(k)}" data-raw="${escHtml(v)}"
                     title="${escHtml(t('sched.dbg.editTip') || v)}">${escHtml(short)}</span>
           </div>`;
        }).join('')
        : `<p class="dbg-none">${escHtml(
            needle ? (t('sched.dbg.noMatch') || 'Nothing matches that.') : t('sched.dbg.noVars'))}</p>`;
}
