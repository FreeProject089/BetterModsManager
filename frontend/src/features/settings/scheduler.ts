// Scheduler / automation engine (frontend).
//
// The engine runs while BMM is open: a timer wakes every ~20s, finds due tasks,
// and executes their workflow. A workflow is a tree of steps — actions, delays,
// and if/else condition blocks — so the user can build genuinely free automations
// (activate a profile, enable a modpack, run a custom command, branch on state…).
//
// Persistence + custom-command execution live in the Rust backend
// (commands/scheduler.rs); everything else (timing, conditions, action dispatch)
// is here so it can reuse every existing invoke() action.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { toast } from '../../ui/app.js';

// ── Types ───────────────────────────────────────────────────────────────────
type Trigger =
    | { type: 'once'; at: string }                                  // ISO local datetime
    | { type: 'interval'; everyMinutes: number }                    // every N minutes
    | { type: 'hourly'; everyHours: number }                        // every N hours
    | { type: 'dailyAt'; time: string }                             // "HH:MM"
    | { type: 'weeklyAt'; time: string; days: number[] }            // 0=Sun..6=Sat
    | { type: 'monthlyAt'; day: number; time: string }              // day-of-month 1..31
    | { type: 'appStart' }                                          // once per app launch
    | { type: 'manual' };                                           // only via Run button / deeplink

interface Action { type: string; params: Record<string, any>; }
interface Condition { type: string; params: Record<string, any>; negate?: boolean; }
type Step = (
    | { kind: 'action'; action: Action }
    | { kind: 'delay'; seconds: number }
    | { kind: 'waitFor'; condition: Condition; timeoutSec: number; pollSec?: number; onTimeout?: 'abort' | 'continue' }
    | { kind: 'if'; condition: Condition; then: Step[]; else: Step[] }
    // Loop: run `steps` repeatedly — while/until a condition, or a fixed number of
    // times — with a hard max-iterations safety cap and an optional pause between.
    | { kind: 'repeat'; mode: 'while' | 'until' | 'times' | 'doWhile'; condition?: Condition; times?: number; maxIters: number; everySec: number; steps: Step[] }
    // For-each: run `steps` once per item of a live collection. Inside the body,
    // every string action param may reference the item as {item.id} / {item.name}.
    | { kind: 'forEach'; source: 'mods' | 'enabledMods' | 'disabledMods' | 'profiles' | 'modpacks' | 'themes'; maxIters: number; everySec: number; steps: Step[] }
    // Switch: evaluate cases in order, run the FIRST whose condition holds, else default.
    | { kind: 'switch'; cases: { condition: Condition; steps: Step[] }[]; default: Step[] }
    // Try/catch: run `steps`; if anything in them fails, run `onError` INSTEAD of
    // aborting the whole task. Without it, one unreachable path or one missing file
    // killed an eight-step automation on step two.
    | { kind: 'try'; steps: Step[]; onError: Step[] }
    // Loop signals, and a clean end for the whole task. These are what make forEach
    // usable in practice: "for each mod, try to verify; on error notify and continue".
    | { kind: 'break' }
    | { kind: 'continue' }
    | { kind: 'stop' }
    // Editor-only flags shared by every kind: collapsed (folded in the editor) and
    // disabled (kept in the workflow but skipped at run time — like commenting out).
) & { collapsed?: boolean; disabled?: boolean };

interface Task {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    trigger: Trigger;
    steps: Step[];
    allowCustomCommands: boolean;
    osSchedule?: boolean;   // also register a Windows Scheduled Task (runs when BMM is closed)
    lastRun?: number;       // epoch ms
    lastResult?: string;    // 'ok' | 'error: ...'
    history?: { at: number; ok: boolean; ms: number; err?: string }[];  // last runs (capped)
}

// ── State ───────────────────────────────────────────────────────────────────
let _tasks: Task[] = [];
let _timer: number | null = null;
const _appStartFired = new Set<string>();
const _onceFired = new Set<string>();

// Picker caches (filled when the modal opens)
let _profiles: any[] = [];
let _mods: any[] = [];
let _modpacks: any[] = [];
let _themes: any[] = [];
let _apps: any[] = [];
let _disks: any[] = [];

// ── Persistence ──────────────────────────────────────────────────────────────
/** Fill in the arrays every block kind assumes it has.
 *
 *  Steps used to be built only by _makeStep(), which guarantees them. Now MCP and
 *  the CLI can author a task (bmm_create_schedule), and they validate only the top
 *  level — a switch without `default`, or a forEach without `steps`, saved and
 *  listed fine but threw the moment the user opened it in the editor. Which is
 *  exactly what the "created disabled, go inspect it" contract asks them to do. */
function normalizeSteps(steps: any[]): Step[] {
    if (!Array.isArray(steps)) return [];
    for (const st of steps) {
        if (!st || typeof st !== 'object') continue;
        if (st.kind === 'if') { st.then = normalizeSteps(st.then); st.else = normalizeSteps(st.else); }
        else if (st.kind === 'repeat' || st.kind === 'forEach') { st.steps = normalizeSteps(st.steps); }
        else if (st.kind === 'try') { st.steps = normalizeSteps(st.steps); st.onError = normalizeSteps(st.onError); }
        else if (st.kind === 'switch') {
            st.cases = Array.isArray(st.cases) ? st.cases : [];
            for (const c of st.cases) {
                if (!c.condition) c.condition = { type: 'always', params: {} };
                c.steps = normalizeSteps(c.steps);
            }
            st.default = normalizeSteps(st.default);
        }
    }
    return steps as Step[];
}

async function loadTasks(): Promise<void> {
    try {
        const raw = await invoke('get_schedules');
        _tasks = Array.isArray(raw) ? raw : [];
        for (const t of _tasks) t.steps = normalizeSteps(t.steps);
    } catch { _tasks = []; }
}
async function saveTasks(): Promise<void> {
    try { await invoke('save_schedules', { tasks: _tasks }); }
    catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
}

// Build a real, ready-to-use "simple loop" automation for the user (used by the
// "Load example" button and the interactive tutorial). Created disabled so it never
// fires unexpectedly — the user inspects it, then flips the toggle to enable it.
export async function createExampleAutomation(): Promise<void> {
    const id = (globalThis.crypto?.randomUUID?.() || `ex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const task: Task = {
        id,
        name: t('sched.example.name') || 'Example — simple loop',
        description: t('sched.example.desc') || 'Every hour, loop 3× and show a notification each time.',
        enabled: false,
        trigger: { type: 'hourly', everyHours: 1 },
        steps: [
            { kind: 'repeat', mode: 'times', times: 3, maxIters: 3, everySec: 2, steps: [
                { kind: 'action', action: { type: 'notify', params: { message: t('sched.example.msg') || 'Hello from your automation! 🎉' } } },
            ] },
        ],
        allowCustomCommands: false,
    };
    _tasks.push(task);
    await saveTasks();
    renderScheduleList();
    openTaskModal(task);
    toast(t('sched.example.created') || 'Example automation created — a simple loop. Toggle it on when ready.', 'success');
}

// ── Engine ───────────────────────────────────────────────────────────────────
export async function initScheduler(): Promise<void> {
    await loadTasks();
    renderScheduleList();
    const btn = document.getElementById('btn-create-schedule');
    if (btn && !btn.dataset.wired) {
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => openTaskModal(null));
        // Add Export / Import .BMMPA buttons next to "New task".
        const row = btn.parentElement;
        if (row && !document.getElementById('sched-export-btn')) {
            const exp = document.createElement('button');
            exp.id = 'sched-export-btn';
            exp.className = 'btn btn-ghost btn-sm';
            exp.style.gap = '6px';
            exp.textContent = t('sched.exportBmmpa') || 'Export .BMMPA';
            exp.addEventListener('click', () => exportTasksFile());
            const imp = document.createElement('button');
            imp.id = 'sched-import-btn';
            imp.className = 'btn btn-ghost btn-sm';
            imp.style.gap = '6px';
            imp.textContent = t('sched.importBmmpa') || 'Import .BMMPA';
            imp.addEventListener('click', () => importTasksFile());
            const ex = document.createElement('button');
            ex.id = 'sched-example-btn';
            ex.className = 'btn btn-ghost btn-sm';
            ex.style.gap = '6px';
            ex.textContent = t('sched.loadExample') || 'Load example';
            ex.title = t('sched.loadExample.d') || 'Create a ready-made simple-loop automation you can inspect and enable.';
            ex.addEventListener('click', () => createExampleAutomation());
            row.appendChild(exp);
            row.appendChild(imp);
            row.appendChild(ex);
        }
    }
    // Let the interactive tutorial build a real automation for the user.
    (window as any).bmmCreateExampleAutomation = createExampleAutomation;
    if (!_langWired) {
        _langWired = true;
        document.addEventListener('langChanged', () => renderScheduleList());
    }
    startEngine();
}
let _langWired = false;

function startEngine(): void {
    if (_timer !== null) return;
    // Fire appStart tasks once shortly after launch.
    setTimeout(() => tick().catch(() => {}), 4000);
    _timer = window.setInterval(() => { tick().catch(() => {}); }, 20000);
}

function nextLocalMidnightOffset(time: string): { h: number; m: number } {
    const [h, m] = time.split(':').map(n => parseInt(n, 10) || 0);
    return { h, m };
}

function isDue(task: Task, now: Date): boolean {
    const tr = task.trigger;
    const last = task.lastRun || 0;
    const nowMs = now.getTime();
    switch (tr.type) {
        case 'appStart':
            if (_appStartFired.has(task.id)) return false;
            return true;
        case 'once': {
            if (_onceFired.has(task.id) || task.lastRun) return false;
            const at = new Date(tr.at).getTime();
            return !isNaN(at) && nowMs >= at;
        }
        case 'manual':
            return false; // only runs via the Run button or bmm://schedule/run
        case 'interval': {
            const gap = Math.max(1, tr.everyMinutes) * 60000;
            return nowMs - last >= gap;
        }
        case 'hourly': {
            const gap = Math.max(1, tr.everyHours) * 3600000;
            return nowMs - last >= gap;
        }
        case 'monthlyAt': {
            const { h, m } = nextLocalMidnightOffset(tr.time);
            if (now.getDate() !== tr.day) return false;
            if (now.getHours() !== h || now.getMinutes() !== m) return false;
            return nowMs - last >= 60000;
        }
        case 'dailyAt': {
            const { h, m } = nextLocalMidnightOffset(tr.time);
            if (now.getHours() !== h || now.getMinutes() !== m) return false;
            // Avoid double-firing within the same minute.
            return nowMs - last >= 60000;
        }
        case 'weeklyAt': {
            const { h, m } = nextLocalMidnightOffset(tr.time);
            if (!tr.days?.includes(now.getDay())) return false;
            if (now.getHours() !== h || now.getMinutes() !== m) return false;
            return nowMs - last >= 60000;
        }
    }
    return false;
}

async function tick(): Promise<void> {
    const now = new Date();
    for (const task of _tasks) {
        if (!task.enabled) continue;
        if (!isDue(task, now)) continue;
        if (task.trigger.type === 'appStart') _appStartFired.add(task.id);
        if (task.trigger.type === 'once') _onceFired.add(task.id);
        await runTask(task);
    }
}

/** The saved scheduler tasks (loaded if needed) — used to populate the script
 *  generator's "Run scheduled task" dropdown. */
export async function getTasks(): Promise<Task[]> {
    if (!_tasks.length) await loadTasks();
    return _tasks;
}

/** Runs one task by id — used by the bmm://schedule/run deeplink (Windows Task Scheduler). */
export async function runTaskById(id: string): Promise<void> {
    if (!_tasks.length) await loadTasks();
    const task = _tasks.find(t => t.id === id);
    if (task) await runTask(task);
}

/** (Re)registers or removes the Windows Scheduled Task mirror for a task. */
async function syncOsSchedule(task: Task): Promise<void> {
    try {
        if (task.osSchedule && task.enabled) {
            await invoke('register_os_schedule', { taskId: task.id, trigger: task.trigger });
        } else {
            await invoke('unregister_os_schedule', { taskId: task.id });
        }
    } catch (e) { toast(`${t('sched.osFail') || 'OS schedule error'}: ${e}`, 'error'); }
}

async function runTask(task: Task): Promise<void> {
    const t0 = Date.now();
    try {
        // Per-run variable store: actions (e.g. a benchmark) write measured values
        // here, and `value` conditions read them → "if disk speed > X then Apply".
        const ctx: Record<string, number> = {};
        await runSteps(task.steps, task, ctx);
        task.lastResult = 'ok';
        toast(`${t('sched.ran') || 'Ran'}: ${task.name}`, 'success');
    } catch (e) {
        if (e instanceof _StopTask) {
            // Guard clause / "Stop task" — a clean, intentional early exit.
            task.lastResult = 'ok';
            toast(`${task.name} — ${t('sched.stopped') || 'stopped'}${e.reason ? `: ${e.reason}` : ''}`, 'info');
        } else {
            task.lastResult = `error: ${e}`;
            toast(`${task.name} — ${e}`, 'error');
        }
    }
    task.lastRun = Date.now();
    // Run history (last 20): timestamp, outcome, duration — shown in the editor.
    const ok = task.lastResult === 'ok';
    (task.history = task.history || []).push({ at: t0, ok, ms: Date.now() - t0, err: ok ? undefined : task.lastResult });
    if (task.history.length > 20) task.history = task.history.slice(-20);
    await saveTasks();
    renderScheduleList();
}

/** Non-local control flow. Thrown, because a step can sit at any depth and the
 *  loop that must react to it is an unknown number of frames up. Never surfaces
 *  as an error: every construct that can consume one does, and the task runner
 *  treats a stray one as a clean end. */
class FlowSignal {
    constructor(public kind: 'break' | 'continue') {}
}

/** Run a loop body, translating break/continue into the loop's own control flow.
 *  Returns false when the loop must end. */
async function runLoopBody(steps: Step[], task: Task, ctx: Record<string, number>): Promise<boolean> {
    try {
        await runSteps(steps, task, ctx);
    } catch (e) {
        if (e instanceof FlowSignal) {
            if (e.kind === 'break') return false;
            if (e.kind === 'continue') return true;
        }
        throw e;                       // a real failure, or a `stop` for the runner
    }
    return true;
}

async function runSteps(steps: Step[], task: Task, ctx: Record<string, number>): Promise<void> {
    for (const step of steps || []) {
        if (step.disabled) continue;   // switched off in the editor — skipped, not deleted
        if (step.kind === 'action') {
            await runAction(step.action, task, ctx);
        } else if (step.kind === 'delay') {
            await new Promise(r => setTimeout(r, Math.max(0, step.seconds) * 1000));
        } else if (step.kind === 'waitFor') {
            await waitForCondition(step.condition, step.timeoutSec, ctx, step.pollSec, step.onTimeout);
        } else if (step.kind === 'if') {
            const ok = await evalCondition(step.condition, ctx);
            await runSteps(ok ? step.then : step.else, task, ctx);
        } else if (step.kind === 'repeat') {
            // One loop for all four modes. They differ in exactly two decisions —
            // is the condition checked BEFORE the body or after, and does a true
            // condition mean "keep going" or "stop" — so writing them as three
            // hand-rolled loops meant the same edit three times, and they had
            // already drifted (a missing condition defaulted to `true` in one mode
            // and `false` in another, undocumented).
            const max = Math.max(1, Math.min(step.maxIters || 100, 100000));
            const gap = Math.max(0, step.everySec || 0) * 1000;
            const times = step.mode === 'times'
                ? Math.min(Math.max(0, step.times || 1), max)
                : max;
            // `times` has no condition; `doWhile` checks after the body; the rest before.
            const checkBefore = step.mode === 'while' || step.mode === 'until';
            const checkAfter = step.mode === 'doWhile';
            // `until` runs while the condition is FALSE; every other mode while TRUE.
            const keepGoing = async (): Promise<boolean> => {
                if (!step.condition) return step.mode !== 'doWhile';   // preserved default
                const ok = await evalCondition(step.condition, ctx);
                return step.mode === 'until' ? !ok : ok;
            };
            for (let n = 0; n < times; n++) {
                if (checkBefore && !await keepGoing()) break;
                if (!await runLoopBody(step.steps, task, ctx)) break;
                if (checkAfter && !await keepGoing()) break;
                if (gap) await new Promise(r => setTimeout(r, gap));
            }
        } else if (step.kind === 'forEach') {
            const items = await forEachItems(step.source);
            const max = Math.max(1, Math.min(step.maxIters || 100, 100000));
            const gap = Math.max(0, step.everySec || 0) * 1000;
            for (const item of items.slice(0, max)) {
                // The body runs on a per-item COPY with {item.*} placeholders resolved —
                // actions stay ordinary actions, they just receive concrete values.
                if (!await runLoopBody(substituteItem(step.steps, item), task, ctx)) break;
                if (gap) await new Promise(r => setTimeout(r, gap));
            }
        } else if (step.kind === 'try') {
            try {
                await runSteps(step.steps, task, ctx);
            } catch (e) {
                if (e instanceof FlowSignal) throw e;      // signals pass through
                await runSteps(step.onError, task, ctx);
            }
        } else if (step.kind === 'break') {
            throw new FlowSignal('break');
        } else if (step.kind === 'continue') {
            throw new FlowSignal('continue');
        } else if (step.kind === 'stop') {
            // Reuse the runner's existing clean-exit path (_StopTask) instead of a
            // second stop mechanism — it already reports the task as successful.
            throw new _StopTask(t('sched.stopHint') || 'stopped by a Stop step');
        } else if (step.kind === 'switch') {
            let ran = false;
            for (const c of step.cases || []) {
                if (await evalCondition(c.condition, ctx)) { await runSteps(c.steps, task, ctx); ran = true; break; }
            }
            if (!ran) await runSteps(step.default || [], task, ctx);
        }
    }
}

/** The live collection a for-each iterates. Fetched at run time, never cached. */
async function forEachItems(source: string): Promise<any[]> {
    try {
        if (source === 'profiles') return (await invoke('get_profiles')) as any[] || [];
        // The command names matter: `get_modpacks`/`get_builtin_themes` do not exist,
        // and the rejection was swallowed by the catch below — the loop ran ZERO times
        // and the task still reported success. The real ones are load_modpacks and
        // list_builtin_themes / list_installed_themes (both, or "each theme" would
        // silently skip everything the user actually installed).
        if (source === 'modpacks') return (await invoke('load_modpacks')) as any[] || [];
        if (source === 'themes') {
            const parse = (v: any) => { try { return (Array.isArray(v) ? v : JSON.parse(v)) || []; } catch { return []; } };
            const builtin = parse(await invoke('list_builtin_themes').catch(() => '[]'));
            const installed = parse(await invoke('list_installed_themes').catch(() => '[]'));
            return [...builtin, ...installed];
        }
        const mods = (await invoke('get_mods')) as any[] || [];
        if (source === 'enabledMods') return mods.filter((m: any) => m.enabled);
        if (source === 'disabledMods') return mods.filter((m: any) => !m.enabled);
        return mods;
    } catch { return []; }
}

/** Deep-copy steps with every "{item.xxx}" in string params replaced by the item's
 *  value — but NEVER inside a nested forEach's own body.
 *
 *  The outer loop used to rewrite the entire subtree, so an inner forEach found its
 *  own {item.*} placeholders already replaced by the OUTER item before it ever ran:
 *  "for each profile, for each mod, notify {item.name}" printed the profile's name
 *  once per mod, silently. Each loop now substitutes only what belongs to it and
 *  leaves an inner loop's body untouched for that loop to resolve itself. */
function substituteItem(steps: Step[], item: any): Step[] {
    const src = item?.mod_entry ?? item ?? {};
    const rep = (v: any): any => {
        if (typeof v === 'string') {
            return v.replace(/\{item\.([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, k) => {
                const val = src?.[k];
                return val === undefined || val === null ? '' : String(val);
            });
        }
        if (Array.isArray(v)) return v.map(rep);
        if (v && typeof v === 'object') { const o: any = {}; for (const k of Object.keys(v)) o[k] = rep(v[k]); return o; }
        return v;
    };
    // rep() already rebuilds every array and object it walks (primitives are
    // immutable), so it IS the deep copy — the JSON round-trip on top of it copied
    // the whole subtree a second time, per item, per lap, for nothing.
    // A nested forEach owns its body: copy the block, substitute everything EXCEPT
    // `steps`, and hand that subtree back untouched. The inner loop resolves it
    // against its own item when it runs.
    const walk = (list: Step[]): Step[] => (list || []).map((st: any) => {
        if (st && st.kind === 'forEach') {
            const { steps: inner, ...rest } = st;
            return { ...rep(rest), steps: JSON.parse(JSON.stringify(inner || [])) };
        }
        if (st && st.kind === 'if') return { ...rep({ ...st, then: [], else: [] }), then: walk(st.then), else: walk(st.else) };
        if (st && (st.kind === 'repeat' || st.kind === 'try')) {
            const copy: any = rep({ ...st, steps: [], onError: [] });
            if (st.steps) copy.steps = walk(st.steps);
            if (st.onError) copy.onError = walk(st.onError);
            return copy;
        }
        if (st && st.kind === 'switch') {
            return {
                ...rep({ ...st, cases: [], default: [] }),
                cases: (st.cases || []).map((c: any) => ({ ...rep({ ...c, steps: [] }), steps: walk(c.steps) })),
                default: walk(st.default),
            };
        }
        return rep(st);
    });
    return walk(steps || []);
}

// Polls a condition until it becomes true or the timeout elapses (then throws,
// aborting the rest of the workflow). This is what makes "wait until all mods are
// active, then launch X" possible.
async function waitForCondition(cond: Condition, timeoutSec: number, ctx: Record<string, number>, pollSec = 2, onTimeout: 'abort' | 'continue' = 'abort'): Promise<void> {
    const deadline = Date.now() + Math.max(1, timeoutSec || 60) * 1000;
    const pollMs = Math.max(250, (pollSec || 2) * 1000);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (await evalCondition(cond, ctx)) return;
        if (Date.now() >= deadline) {
            // Either abort the whole task (default) or just stop waiting and carry on.
            if (onTimeout === 'continue') return;
            throw new Error(t('sched.waitTimeout') || 'Timed out waiting for condition');
        }
        await new Promise(r => setTimeout(r, pollMs));
    }
}

// ── Action dispatch ───────────────────────────────────────────────────────────
// Size preset → run_app_benchmark `scale` string.
const BENCH_SCALE: Record<string, string> = { S: 'small', M: 'medium', L: 'large', XL: 'xlarge' };

async function runAction(action: Action, task: Task, ctx: Record<string, number>): Promise<void> {
    const p = action.params || {};
    // Fire a bmm:// deeplink through the app's canonical handler (covers every
    // script-generator action that maps to a deeplink). Falls back to runDeepLink.
    const dl = (path: string, qp: Record<string, any> = {}) => {
        const qs = Object.entries(qp)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
        const url = `bmm://${path}${qs ? '?' + qs : ''}`;
        const fn = (window as any).__bmmDeeplink;
        return fn ? fn(url) : runDeepLink(url);
    };
    const b = (v: any) => (v ? 1 : 0);
    switch (action.type) {
        case 'profile.activate':
            await invoke('set_active_profile', { profileId: p.id }); break;
        case 'mod.enable':
            await invoke('enable_mod', { modId: p.id, bypassSha: true }); break;
        case 'mod.disable':
            await invoke('disable_mod', { modId: p.id }); break;
        case 'modpack.enable':
            await applyModpack(p.id, true); break;
        case 'modpack.disable':
            await applyModpack(p.id, false); break;
        case 'mods.enableAll':
            await invoke('toggle_all_mods', { enable: true, bypassSha: true }); break;
        case 'mods.disableAll':
            await invoke('toggle_all_mods', { enable: false, bypassSha: false }); break;
        case 'mods.scan':
            await invoke('scan_mods_folder'); break;
        case 'theme.set':
            await invoke('set_active_theme', { themeId: p.id }); break;
        case 'app.launch':
            await invoke('launch_app', { appId: p.id, exePath: p.exePath || '' }); break;
        case 'notify':
            toast(p.message || task.name, 'info'); break;
        case 'custom.command': {
            if (!task.allowCustomCommands) {
                throw new Error(t('sched.customDisabled') || 'Custom commands are disabled for this task');
            }
            const args = (p.args || '').trim() ? String(p.args).split(/\s+/) : [];
            await invoke('run_scheduled_command', {
                program: p.program, args, workingDir: p.workingDir || null, allow: true,
            });
            break;
        }
        case 'deeplink':
            await runDeepLink(p.url); break;

        // ── Benchmarks ────────────────────────────────────────────────────────
        case 'benchmark.run': {
            const dataset = p.dataset === 'real' ? 'real' : 'sandbox';
            const size = String(p.size || 'M').toUpperCase();
            const scale = size === 'CUSTOM'
                ? `custom:${Math.max(1, parseInt(p.customMb, 10) || 256)}`
                : (BENCH_SCALE[size] || 'medium');
            const sources: string[] = dataset === 'real'
                ? (Array.isArray(p.sources) ? p.sources : (p.sources ? [p.sources] : []))
                : [];
            const report: any = await invoke('run_app_benchmark', { mode: dataset, realSources: sources, scale });
            const totalMs = Number(report?.total_ms) || 0;
            const bytes = Number(report?.env?.dataset_bytes ?? report?.dataset_bytes) || 0;
            ctx['benchmark.total_ms'] = totalMs;
            if (bytes > 0 && totalMs > 0) ctx['benchmark.mbps'] = Math.round((bytes / 1048576) / (totalMs / 1000) * 10) / 10;
            toast(`${task.name}: benchmark ${Math.round(totalMs)} ms${ctx['benchmark.mbps'] ? ` · ${ctx['benchmark.mbps']} MB/s` : ''}`, 'info');
            break;
        }

        // ── Storage Manager ──────────────────────────────────────────────────
        case 'storage.calibration':
            await setSettingFlag('auto_io_calibration', !!p.enabled); break;
        case 'storage.smartIo':
            await setSettingFlag('smart_io_enabled', !!p.enabled); break;
        case 'storage.flag':                       // generic: toggle ANY boolean setting (e.g. a future "dcp")
            if (p.key) await setSettingFlag(String(p.key), !!p.enabled);
            break;
        case 'storage.diskBenchmark': {
            const mount = p.mountPoint || (await firstDiskMount());
            if (!mount) throw new Error('No disk to benchmark');
            const r: any = await invoke('benchmark_disk', { mountPoint: mount });
            ctx['disk.read_mbps'] = Number(r?.read_mb_s) || 0;
            ctx['disk.write_mbps'] = Number(r?.write_mb_s) || 0;
            ctx['disk.suggested_limit'] = Number(r?.suggested_limit) || 0;
            toast(`${task.name}: ${mount} ${ctx['disk.read_mbps']}↓ / ${ctx['disk.write_mbps']}↑ MB/s`, 'info');
            break;
        }
        case 'storage.applyLimit': {
            const mount = p.mountPoint || (await firstDiskMount());
            if (!mount) throw new Error('No disk selected');
            const limit = p.limitMbS != null && p.limitMbS !== ''
                ? Math.max(1, parseInt(p.limitMbS, 10) || 0)
                : Math.round(ctx['disk.suggested_limit'] || 0);
            await invoke('set_disk_limit', { mountPoint: mount, limitMbS: limit > 0 ? limit : null });
            toast(`${task.name}: ${mount} limit → ${limit > 0 ? limit + ' MB/s' : 'unlimited'}`, 'success');
            break;
        }
        case 'var.set':                            // store a literal value for later conditions
            ctx[String(p.name || 'var')] = Number(p.value) || 0; break;

        // ── Logic & math ──────────────────────────────────────────────────────
        case 'math.set': {                         // target = <expression over ctx>
            const target = String(p.target || 'result');
            try { ctx[target] = evalExpr(String(p.expr || '0'), ctx); }
            catch (e) { throw new Error(`${t('sched.mathErr') || 'Math error'}: ${e}`); }
            break;
        }
        case 'var.ternary': {                      // target = cond ? ifTrue : ifFalse
            const ok = p.condition ? await evalCondition(p.condition, ctx) : false;
            ctx[String(p.target || 'result')] = Number(ok ? p.ifTrue : p.ifFalse) || 0;
            break;
        }
        case 'rule.table': {                       // first matching rule sets target
            const src = Number(ctx[String(p.source || '')] ?? NaN);
            const target = String(p.target || 'result');
            for (const r of (Array.isArray(p.rows) ? p.rows : [])) {
                if (cmpNum(src, r.op, Number(r.value))) { ctx[target] = Number(r.result) || 0; break; }
            }
            break;
        }
        case 'task.stop':                          // guard clause / early exit (clean)
            throw new _StopTask(String(p.reason || ''));

        // ── New script-generator actions (executed via bmm:// deeplinks) ────────
        case 'modpack.create':   dl('modpack/create', { name: p.name, profile: p.profile }); break;
        case 'mod.add':          dl('install', { url: p.url, name: p.name }); break;
        case 'modlist.export':   dl('api', { method: 'POST', path: '/api/modlists/export' }); break;
        case 'modlist.import':   dl('api', { method: 'POST', path: '/api/modlists/import' }); break;
        case 'plugin.apply':     dl('plugin/activate', { id: p.id }); break;
        case 'plugin.compare':   dl('plugin/compare', { id: p.id }); break;
        case 'plugin.delete':    if (p.id) await invoke('uninstall_plugin', { pluginId: p.id }); break;
        case 'mods.checkUpdates': dl('mod/check-updates'); break;
        case 'mods.autoImportOmm': {
            const n: any = await invoke('auto_import_omm');
            toast(`${task.name}: ${t('sched.ommImported') || 'imported'} ${n} OMM mod(s)`, 'success');
            break;
        }
        case 'mods.clearHistory':
            await invoke('clear_activity_history', { profileId: p.id }); break;
        case 'mods.exportModpack':
            if (p.id) await invoke('export_modpack', { id: p.id, destDir: p.dir || null }); break;
        case 'file.open':        if (p.path) await invoke('open_file', { path: p.path }); break;
        case 'folder.open':      if (p.path) await invoke('open_folder', { path: p.path }); break;
        case 'repo.connect':     dl('repo/connect', { url: p.url, name: p.name }); break;
        case 'repo.sync':        dl('repo/sync', { url: p.url, profile: p.profile }); break;
        case 'repo.gen':         dl('repo/gen'); break;
        case 'repo.update':      dl('repo/update', { dir: p.dir }); break;
        case 'repo.host':        dl('repo/host', { dir: p.dir, port: p.port }); break;
        case 'app.install':      dl('app/install', { id: p.id, url: p.url, title: p.title }); break;
        case 'launchpack.run':   await invoke('run_launch_pack', { id: p.id }); break;
        case 'task.run':
            // Runs the sub-task to completion (it awaits), then records whether it
            // succeeded into ctx so a following IF / repeat can branch on the result
            // ("if task responded / did X"): value source `lasttask.ok` = 1 | 0.
            if (p.id) {
                await runTaskById(String(p.id));
                const sub = _tasks.find(tk => tk.id === p.id);
                ctx['lasttask.ok'] = sub && sub.lastResult === 'ok' ? 1 : 0;
                if (sub) toast(`${t('sched.subTaskDone') || 'Sub-task finished'}: ${sub.name} → ${sub.lastResult}`, ctx['lasttask.ok'] ? 'info' : 'warning');
            }
            break;
        case 'telemetry.consent': dl('telemetry/consent', { enabled: b(p.enabled) }); break;
        case 'telemetry.set':    dl('telemetry/set', { replay: b(p.replay), full: b(p.full), bench: b(p.bench) }); break;
        case 'recorder.set':     dl('recorder/set', { on: b(p.on), full: b(p.full), rust: b(p.rust), js: b(p.js) }); break;
        case 'replay.export':    dl('replay/export'); break;
        case 'replay.import':    dl('replay/import', { path: p.path, url: p.url }); break;
        case 'discord.rpc':      dl('discord/rpc', { enabled: b(p.enabled) }); break;
        case 'data.exportAuto':  dl('data/export-auto', { dir: p.dir, name: p.name, increment: p.increment }); break;
        case 'restart':          dl('restart'); break;
        case 'app.checkUpdate': {
            const info: any = await invoke('check_for_update', { includePrerelease: !!p.enabled });
            ctx['update.available'] = info?.has_update ? 1 : 0;
            if (info?.has_update) toast(`${task.name}: ${t('sched.updateAvail') || 'update available'} — v${info.latest_version}`, 'info');
            break;
        }
        case 'system.clearApiLog': await invoke('clear_api_log'); break;
        case 'system.clearResourceRecords': await invoke('clear_resource_records'); break;
        case 'perf.diskSpace': {
            const mount = p.mountPoint || (await firstDiskMount());
            if (!mount) throw new Error('No disk to check');
            const r: any = await invoke('check_disk_space', { path: mount });
            ctx['disk.free_gb'] = Math.round((r?.available_bytes || 0) / 1073741824 * 10) / 10;
            ctx['disk.total_gb'] = Math.round((r?.total_bytes || 0) / 1073741824 * 10) / 10;
            ctx['disk.free_percent'] = Math.round((r?.free_percent || 0) * 10) / 10;
            toast(`${task.name}: ${mount} — ${ctx['disk.free_gb']} GB ${t('sched.free') || 'free'} (${ctx['disk.free_percent']}%)`, 'info');
            break;
        }
        case 'open.url': {
            const u = String(p.url || '');
            if (u) { try { await (window as any).__TAURI__?.shell?.open?.(u); } catch { window.open(u, '_blank'); } }
            break;
        }

        default:
            throw new Error(`Unknown action: ${action.type}`);
    }
}

/** Flip one boolean field in AppSettings and persist (read-modify-write). */
async function setSettingFlag(key: string, value: boolean): Promise<void> {
    const settings: any = await invoke('get_settings');
    settings[key] = value;
    await invoke('update_settings', { settings });
}
async function firstDiskMount(): Promise<string> {
    try {
        const disks: any[] = await invoke('get_system_disks');
        return disks?.[0]?.mount_point || '';
    } catch { return ''; }
}

async function applyModpack(modpackId: string, enable: boolean): Promise<void> {
    const packs: any[] = await invoke('load_modpacks').catch(() => []);
    const pack = packs.find(m => m.id === modpackId);
    if (!pack) throw new Error(`Modpack ${modpackId} not found`);
    const ids: string[] = (pack.mods || []).map((m: any) => m.mod_id).filter(Boolean);
    for (const id of ids) {
        if (enable) await invoke('enable_mod', { modId: id, bypassSha: true }).catch(() => {});
        else await invoke('disable_mod', { modId: id }).catch(() => {});
    }
}

async function runDeepLink(url: string): Promise<void> {
    if (!url || !/^bmm:\/\//i.test(url)) throw new Error('Invalid bmm:// URL');
    // Re-dispatch through the app's deeplink listener.
    window.dispatchEvent(new CustomEvent('bmm:deeplink', { detail: { url } }));
    try { (window as any).__TAURI__?.event?.emit?.('scheme-request-received', url); } catch {}
}

// ── Condition evaluation ──────────────────────────────────────────────────────
async function evalCondition(cond: Condition, ctx: Record<string, number> = {}): Promise<boolean> {
    let r = await evalConditionRaw(cond, ctx);
    return cond.negate ? !r : r;
}
async function evalConditionRaw(cond: Condition, ctx: Record<string, number>): Promise<boolean> {
    const p = cond.params || {};
    const now = new Date();
    switch (cond.type) {
        case 'always': return true;
        case 'value': {
            // Compare a captured value (e.g. disk.write_mbps, benchmark.mbps) to a threshold.
            const left = Number(ctx[String(p.source)] ?? NaN);
            const right = Number(p.value);
            if (Number.isNaN(left)) return false;
            switch (p.op) {
                case '>': return left > right;
                case '<': return left < right;
                case '>=': return left >= right;
                case '<=': return left <= right;
                case '==': return left === right;
                case '!=': return left !== right;
                default: return false;
            }
        }
        case 'profileActive': {
            const id = await invoke('get_active_profile_id').catch(() => null);
            return id === p.id;
        }
        case 'modEnabled': {
            const mods: any[] = await invoke('get_all_mods').catch(() => []);
            return !!mods.find(m => m.id === p.id)?.enabled;
        }
        case 'modDisabled': {
            const mods: any[] = await invoke('get_all_mods').catch(() => []);
            const m = mods.find(x => x.id === p.id);
            return !!m && !m.enabled;
        }
        case 'appRunning':
            return await invoke('is_process_running', { name: p.name || '' }).catch(() => false);
        case 'appNotRunning':
            return !(await invoke('is_process_running', { name: p.name || '' }).catch(() => false));
        case 'fileExists':
            return await invoke('path_exists', { path: p.path || '' }).catch(() => false);
        case 'online':
            return navigator.onLine;
        case 'timeReached': {
            const [h, m] = String(p.time || '00:00').split(':').map((n: string) => parseInt(n, 10) || 0);
            return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
        }
        case 'modpackActive': {
            const packs: any[] = await invoke('load_modpacks').catch(() => []);
            const pack = packs.find(m => m.id === p.id);
            if (!pack) return false;
            const ids: string[] = (pack.mods || []).map((m: any) => m.mod_id).filter(Boolean);
            if (!ids.length) return false;
            const mods: any[] = await invoke('get_all_mods').catch(() => []);
            const byId = new Map(mods.map(m => [m.id, m]));
            return ids.every(id => byId.get(id)?.enabled);
        }
        case 'modpackInactive': {
            const packs: any[] = await invoke('load_modpacks').catch(() => []);
            const pack = packs.find(m => m.id === p.id);
            if (!pack) return true;
            const ids: string[] = (pack.mods || []).map((m: any) => m.mod_id).filter(Boolean);
            const mods: any[] = await invoke('get_all_mods').catch(() => []);
            const byId = new Map(mods.map(m => [m.id, m]));
            return ids.every(id => !byId.get(id)?.enabled);
        }
        case 'allModsActive': {
            const activeId = await invoke('get_active_profile_id').catch(() => null);
            if (!activeId) return false;
            const mods: any[] = await invoke('get_mods').catch(() => []);
            return mods.length > 0 && mods.every(m => m.enabled);
        }
        case 'dayOfWeek':
            return Array.isArray(p.days) && p.days.includes(now.getDay());
        case 'timeRange': {
            const toMin = (s: string) => { const [h, m] = s.split(':').map((n: string) => parseInt(n, 10) || 0); return h * 60 + m; };
            const cur = now.getHours() * 60 + now.getMinutes();
            const a = toMin(p.from || '00:00'), b = toMin(p.to || '23:59');
            return a <= b ? (cur >= a && cur <= b) : (cur >= a || cur <= b);
        }
        case 'commandSucceeds': {
            const args = (p.args || '').trim() ? String(p.args).split(/\s+/) : [];
            try { await invoke('run_scheduled_command', { program: p.program, args, workingDir: p.workingDir || null, allow: true }); return true; }
            catch { return false; }
        }
        // ── File verification / comparison ─────────────────────────────────────
        case 'fileHash': {
            // True when the file's hash (blake3 default, or sha256) equals the
            // expected value. Used for "loop until <file> sha == <value>".
            try {
                const h = await invoke('hash_file', { path: p.path || '', algo: p.algo || 'blake3' }) as string;
                return (h || '').toLowerCase() === String(p.value || '').toLowerCase().replace(/^b3:/, '').trim();
            } catch { return false; }
        }
        case 'fileSize': {
            const m: any = await invoke('file_meta', { path: p.path || '' }).catch(() => null);
            if (!m || !m.exists) return false;
            return cmpNum(Number(m.size), p.op, Number(p.value));
        }
        case 'fileType': {
            const m: any = await invoke('file_meta', { path: p.path || '' }).catch(() => null);
            if (!m || !m.exists) return false;
            return String(m.ext || '').toLowerCase() === String(p.ext || '').toLowerCase().replace(/^\./, '');
        }
        case 'fileName': {
            const m: any = await invoke('file_meta', { path: p.path || '' }).catch(() => null);
            if (!m || !m.exists) return false;
            return String(m.name || '').toLowerCase().includes(String(p.value || '').toLowerCase());
        }
        case 'fileNewer': {
            // True when the file was modified within the last N minutes.
            const m: any = await invoke('file_meta', { path: p.path || '' }).catch(() => null);
            if (!m || !m.exists || !m.modified_ms) return false;
            const ageMin = (Date.now() - Number(m.modified_ms)) / 60000;
            return ageMin <= Math.max(0, Number(p.minutes) || 0);
        }
    }
    return false;
}

/** Numeric comparison shared by value/size conditions. */
function cmpNum(left: number, op: string, right: number): boolean {
    if (Number.isNaN(left) || Number.isNaN(right)) return false;
    switch (op) {
        case '>': return left > right;
        case '<': return left < right;
        case '>=': return left >= right;
        case '<=': return left <= right;
        case '!=': return left !== right;
        case '==': default: return left === right;
    }
}

// Sentinel thrown by the "Stop task" action — a guard-clause early exit. Caught by
// runTask and treated as a clean stop (NOT an error).
class _StopTask { constructor(public reason = '') {} }

// ── Safe math expression evaluator (no eval) ─────────────────────────────────
// Supports + - * / % ^, parentheses, ctx variables, and a few pure functions.
// A tiny recursive-descent parser — never executes arbitrary code.
const _MATH_FUNCS: Record<string, (...a: number[]) => number> = {
    min: Math.min, max: Math.max, abs: Math.abs, round: Math.round, floor: Math.floor,
    ceil: Math.ceil, sqrt: Math.sqrt, pow: Math.pow, sign: Math.sign,
    clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
};
function evalExpr(expr: string, ctx: Record<string, number>): number {
    const tokens = (String(expr).match(/\d+\.?\d*|[A-Za-z_][\w.]*|[-+*/%(),^]/g) || []);
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    const primary = (): number => {
        const t = next();
        if (t === '(') { const v = expr2(); if (next() !== ')') throw new Error(')'); return v; }
        if (t === '-') return -primary();
        if (t === '+') return primary();
        if (/^\d/.test(t)) return parseFloat(t);
        if (/^[A-Za-z_]/.test(t)) {
            if (peek() === '(') {
                next(); const args: number[] = [];
                if (peek() !== ')') { args.push(expr2()); while (peek() === ',') { next(); args.push(expr2()); } }
                if (next() !== ')') throw new Error(')');
                const f = _MATH_FUNCS[t.toLowerCase()]; if (!f) throw new Error('fn ' + t);
                return f(...args);
            }
            return Number(ctx[t] ?? 0);
        }
        throw new Error('tok ' + t);
    };
    const powf = (): number => { let v = primary(); while (peek() === '^') { next(); v = Math.pow(v, primary()); } return v; };
    const term = (): number => { let v = powf(); while (peek() === '*' || peek() === '/' || peek() === '%') { const o = next(); const r = powf(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; };
    function expr2(): number { let v = term(); while (peek() === '+' || peek() === '-') { const o = next(); const r = term(); v = o === '+' ? v + r : v - r; } return v; }
    const r = expr2();
    if (pos < tokens.length) throw new Error('trailing');
    return Number.isFinite(r) ? r : 0;
}

// ── List rendering (glass-card) ───────────────────────────────────────────────
/** Inline SVG icon for a trigger type (clock family / rocket / hand). */
function triggerIcon(tr: Trigger): string {
    const P = (d: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    switch (tr.type) {
        case 'once':      return P('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>');
        case 'interval':
        case 'hourly':    return P('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>');
        case 'dailyAt':   return P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>');
        case 'weeklyAt':
        case 'monthlyAt': return P('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
        case 'appStart':  return P('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>');
        case 'manual':    return P('<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>');
    }
}

export function renderScheduleList(): void {
    const container = document.getElementById('scheduler-list-container');
    if (!container) return;
    if (!_tasks.length) {
        // Modern empty state: icon tile + message + hint, instead of a bare line.
        container.innerHTML = `
            <div class="sched-empty">
                <div class="sched-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
                <strong>${t('sched.emptyTitle') || 'No scheduled tasks yet'}</strong>
                <span>${t('sched.empty') || 'Create one to automate BMM — sync a repo at night, switch profile before a session, launch your tools in one click.'}</span>
            </div>`;
        return;
    }
    container.innerHTML = '';
    const I = (d: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    for (const task of _tasks) {
        const row = document.createElement('div');
        row.className = `sched-row ${task.enabled ? 'sched-on' : 'sched-off'}`;
        row.innerHTML = `
            <div class="sched-row-main">
                <div class="sched-row-icon">${triggerIcon(task.trigger)}</div>
                <div class="sched-row-text">
                    <strong>${escHtml(task.name)}</strong>
                    ${task.description ? `<span class="sched-row-desc">${escHtml(task.description)}</span>` : ''}
                    <span class="sched-row-sub">
                        <span class="sched-chip sched-chip-trigger">${escHtml(triggerLabel(task.trigger))}</span>
                        <span class="sched-chip">${stepCount(task.steps)} ${t('sched.steps') || 'steps'}</span>
                        ${task.lastRun ? `<span class="sched-chip sched-chip-dim">${t('sched.last') || 'last'} ${new Date(task.lastRun).toLocaleString()}</span>` : ''}
                        ${task.lastResult ? `<span class="sched-chip ${task.lastResult === 'ok' ? 'sched-chip-ok' : 'sched-chip-err'}" data-tooltip="${escAttr(task.lastResult)}">${task.lastResult === 'ok' ? 'OK' : 'ERR'}</span>` : ''}
                    </span>
                </div>
            </div>
            <div class="sched-row-actions">
                <label class="plug-toggle sched-toggle" data-tooltip="${escAttr(task.enabled ? (t('sched.enabled') || 'Enabled') : (t('sched.disabled') || 'Disabled'))}">
                    <input type="checkbox" ${task.enabled ? 'checked' : ''} data-act="toggle">
                    <span class="plug-toggle-slider"></span>
                </label>
                <button class="btn btn-xs btn-ghost sched-act" data-act="run" data-tooltip="${escAttr(t('sched.runNow') || 'Run now')}">${I('<polygon points="5 3 19 12 5 21 5 3"/>')}</button>
                <button class="btn btn-xs btn-ghost sched-act" data-act="dup" data-tooltip="${escAttr(t('sched.dupTask') || 'Duplicate task')}">${I('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')}</button>
                <button class="btn btn-xs btn-ghost sched-act" data-act="edit" data-tooltip="${escAttr(t('common.edit') || 'Edit')}">${I('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>')}</button>
                <button class="btn btn-xs btn-ghost sched-act sched-act-del" data-act="del" data-tooltip="${escAttr(t('common.delete') || 'Delete')}">${I('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')}</button>
            </div>`;
        row.querySelector('[data-act="toggle"]')?.addEventListener('change', async (e) => {
            task.enabled = (e.target as HTMLInputElement).checked; await saveTasks();
            if (task.osSchedule) await syncOsSchedule(task);
        });
        row.querySelector('[data-act="run"]')?.addEventListener('click', () => runTask(task));
        // Duplicate: full deep clone under a new id. Deliberately created DISABLED
        // and without the OS mirror so saving the copy can't double-fire anything.
        row.querySelector('[data-act="dup"]')?.addEventListener('click', async () => {
            const copy: Task = JSON.parse(JSON.stringify(task));
            copy.id = `sched-${Date.now()}`;
            copy.name = `${task.name} ${t('sched.copySuffix') || '(copy)'}`;
            copy.enabled = false;
            copy.osSchedule = false;
            copy.lastRun = undefined; copy.lastResult = undefined; copy.history = [];
            _tasks.push(copy);
            await saveTasks();
            renderScheduleList();
            toast(`${t('sched.duplicated') || 'Duplicated'}: ${copy.name}`, 'success');
        });
        row.querySelector('[data-act="edit"]')?.addEventListener('click', () => openTaskModal(task));
        row.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
            if (!await window.confirmCustom!(t('sched.delTitle') || 'Delete task', `${task.name}?`, 'danger',
                { yesLabel: t('common.delete') || 'Delete', noLabel: t('common.cancel') || 'Cancel' })) return;
            if (task.osSchedule) { try { await invoke('unregister_os_schedule', { taskId: task.id }); } catch {} }
            _tasks = _tasks.filter(x => x.id !== task.id); await saveTasks(); renderScheduleList();
        });
        container.appendChild(row);
    }
}

function stepCount(steps: Step[]): number {
    let n = 0;
    for (const s of steps || []) {
        n++;
        if (s.kind === 'if') n += stepCount(s.then) + stepCount(s.else);
        else if (s.kind === 'repeat' || s.kind === 'forEach') n += stepCount(s.steps);
        else if (s.kind === 'switch') n += stepCount(s.default) + (s.cases || []).reduce((acc, c) => acc + stepCount(c.steps), 0);
        else if (s.kind === 'try') n += stepCount(s.steps) + stepCount(s.onError);
    }
    return n;
}
function triggerLabel(tr: Trigger): string {
    switch (tr.type) {
        case 'once': return `${t('sched.trOnce') || 'Once'} ${new Date(tr.at).toLocaleString()}`;
        case 'interval': return `${t('sched.trEvery') || 'Every'} ${tr.everyMinutes} min`;
        case 'hourly': return `${t('sched.trEvery') || 'Every'} ${tr.everyHours} h`;
        case 'dailyAt': return `${t('sched.trDaily') || 'Daily at'} ${tr.time}`;
        case 'weeklyAt': return `${t('sched.trWeekly') || 'Weekly'} ${tr.time}`;
        case 'monthlyAt': return `${t('sched.trMonthly') || 'Monthly'} ${t('sched.day') || 'day'} ${tr.day} ${tr.time}`;
        case 'appStart': return t('sched.trAppStart') || 'On BMM start';
        case 'manual': return t('sched.trManual') || 'Manual only';
    }
}

// ── Modal builder ─────────────────────────────────────────────────────────────
let _editing: Task | null = null;
let _draft: Task;

// ── Undo / redo (Ctrl+Z / Ctrl+Y) — JSON snapshots of the whole draft ─────────
let _undo: string[] = [];
let _redo: string[] = [];
let _histAttached = false;
/** Capture the current draft BEFORE a structural change (add/delete/type switch). */
function _snapshot(): void {
    try { _undo.push(JSON.stringify(_draft)); } catch { return; }
    if (_undo.length > 80) _undo.shift();
    _redo = [];
}
function _rerenderModal(): void {
    const modal = document.getElementById('modal-scheduler');
    if (modal) {
        const body = modal.querySelector('.sched-body') as HTMLElement | null;
        const top = body ? body.scrollTop : 0;
        renderModal(modal);
        const nb = modal.querySelector('.sched-body') as HTMLElement | null;
        if (nb) nb.scrollTop = top;
    }
}
function _undoAction(): void {
    if (!_undo.length) return;
    try { _redo.push(JSON.stringify(_draft)); } catch {}
    _draft = JSON.parse(_undo.pop()!);
    _rerenderModal();
    try { (window as any).toast?.(t('sched.undone') || 'Undone', 'info'); } catch {}
}
function _redoAction(): void {
    if (!_redo.length) return;
    try { _undo.push(JSON.stringify(_draft)); } catch {}
    _draft = JSON.parse(_redo.pop()!);
    _rerenderModal();
    try { (window as any).toast?.(t('sched.redone') || 'Redone', 'info'); } catch {}
}
/** Attach Ctrl+Z / Ctrl+Y once; only acts while the scheduler modal is open and
 *  the focus isn't in a text field (so native text undo still works there). */
function _ensureHistoryKeys(): void {
    if (_histAttached) return;
    _histAttached = true;
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('modal-scheduler');
        if (!modal || !modal.classList.contains('open')) return;
        if (!(e.ctrlKey || e.metaKey)) return;
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); _undoAction(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); _redoAction(); }
    }, true);
}

/** True when deleting the step would also discard inner steps (if/repeat). */
function _stepHasContent(step: Step): boolean {
    if (step.kind === 'if') return ((step.then?.length || 0) + (step.else?.length || 0)) > 0;
    if (step.kind === 'repeat' || step.kind === 'forEach') return (step.steps?.length || 0) > 0;
    if (step.kind === 'switch') return ((step.default?.length || 0) + (step.cases || []).reduce((a, c) => a + (c.steps?.length || 0), 0)) > 0;
    if (step.kind === 'try') return ((step.steps?.length || 0) + (step.onError?.length || 0)) > 0;
    return false;
}
/** Delete a step — confirms first if it contains inner steps, snapshots for undo. */
async function _deleteStep(step: Step, steps: Step[], i: number, rerender: () => void): Promise<void> {
    if (_stepHasContent(step)) {
        const ok = await (window as any).confirmCustom?.(
            t('sched.delTitle') || 'Delete this block?',
            t('sched.delConfirm') || 'This block has steps inside it. Delete it and everything in it?',
            'danger', { yesLabel: t('common.delete') || 'Delete', noLabel: t('common.cancel') || 'Cancel' });
        if (!ok) return;
    }
    _snapshot();
    steps.splice(i, 1);
    rerender();
}

async function loadPickers(): Promise<void> {
    const [profiles, mods, modpacks, builtin, installed, appsState] = await Promise.all([
        invoke('get_profiles').catch(() => []),
        invoke('get_all_mods').catch(() => []),
        invoke('load_modpacks').catch(() => []),
        invoke('list_builtin_themes').catch(() => '[]'),
        invoke('list_installed_themes').catch(() => '[]'),
        invoke('get_apps_state').catch(() => ({ installed: {} })),
    ]);
    _disks = await invoke('get_system_disks').catch(() => []) as any[];
    _profiles = profiles as any[];
    _mods = mods as any[];
    _modpacks = modpacks as any[];
    // The theme commands return a JSON *string* — parse before merging.
    const parse = (v: any): any[] => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };
    _themes = [...parse(builtin), ...parse(installed)].map((th: any) => ({ id: th.id, name: th.name || th.id }));
    // Installed apps for the "Launch app" picker.
    const inst = (appsState as any)?.installed || {};
    _apps = Object.entries(inst).map(([id, info]: any) => ({ id, name: info?.title || id, exe: info?.exe_path || '' }));
}

async function openTaskModal(task: Task | null): Promise<void> {
    await loadPickers();
    _editing = task;
    _draft = task ? JSON.parse(JSON.stringify(task)) : {
        id: `sched-${Date.now()}`, name: '', enabled: true,
        trigger: { type: 'interval', everyMinutes: 60 }, steps: [], allowCustomCommands: false,
    };
    _undo = []; _redo = [];          // fresh undo history per open
    _ensureHistoryKeys();
    let modal = document.getElementById('modal-scheduler');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-scheduler';
        modal.className = 'modal-generic-overlay';
        // Append INSIDE the app window (position:relative, overflow:hidden) so the
        // absolute 100%×100% overlay is bounded to the visible app, not the whole
        // document (which extends past the rounded window → oversized backdrop).
        (document.getElementById('app-window-outer') || document.body).appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal!.classList.remove('open'); });
    }
    renderModal(modal);
    modal.classList.add('open');
}

/** Human one-liner for the header summary: "Daily at 08:00 · 3 steps · even when BMM is closed". */
function draftSummary(): string {
    const bits = [triggerLabel(_draft.trigger), `${stepCount(_draft.steps)} ${t('sched.steps') || 'steps'}`];
    if (_draft.osSchedule) bits.push(t('sched.sumOs') || 'even when BMM is closed');
    if (_draft.allowCustomCommands) bits.push(t('sched.sumCmd') || 'can run commands');
    return bits.join(' · ');
}
function refreshSummary(modal: HTMLElement): void {
    const el = modal.querySelector('#sched-summary');
    if (el) el.textContent = draftSummary();
}

function renderModal(modal: HTMLElement): void {
    modal.innerHTML = `
      <div class="modal glass sched-modal sched-full">
        <div class="modal-header sched-head">
            <div class="sched-head-main">
                <div class="sched-head-icon"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
                <div class="sched-head-text">
                    <h2 class="modal-title">${_editing ? (t('sched.editTitle') || 'Edit task') : (t('sched.newTitle') || 'New scheduled task')}</h2>
                    <span class="sched-head-summary" id="sched-summary">${escHtml(draftSummary())}</span>
                </div>
            </div>
            <button class="modal-close" id="sched-close">&times;</button>
        </div>
        <div class="sched-layout">
            <aside class="sched-side">
                <label class="sched-label">${t('sched.fName') || 'Name'}</label>
                <input class="input sched-name-input" id="sched-name" value="${escAttr(_draft.name)}" placeholder="${escAttr(t('sched.fNamePh') || 'e.g. Activate DCS profile every morning')}">
                <textarea class="input" id="sched-desc" rows="2" placeholder="${escAttr(t('sched.fDescriptionPh') || 'Description (optional)')}" style="resize:vertical;margin-top:8px">${escHtml(_draft.description || '')}</textarea>

                <label class="sched-label" style="margin-top:16px">${t('sched.fTrigger') || 'Trigger'} <span class="sched-hint-inline">${t('sched.fTriggerHint') || '— WHEN it runs'}</span></label>
                <div id="sched-trigger"></div>

                <label class="sched-label" style="margin-top:16px">${t('sched.secOptions') || 'Options'}</label>
                <label class="sched-opt">
                    <input type="checkbox" id="sched-allow-cmd" ${_draft.allowCustomCommands ? 'checked' : ''}>
                    <div><b>${t('sched.allowCmdTitle') || 'Allow custom commands'}</b><span>${t('sched.allowCmd') || 'This task may run real external programs on your PC.'}</span></div>
                </label>
                <label class="sched-opt">
                    <input type="checkbox" id="sched-os" ${_draft.osSchedule ? 'checked' : ''}>
                    <div><b>${t('sched.osScheduleTitle') || 'Run even when BMM is closed'}</b><span>${t('sched.osSchedule') || 'Registers a Windows Scheduled Task that launches BMM at the trigger time.'}</span></div>
                </label>
                ${_editing && _draft.history?.length ? `
                <label class="sched-label" style="margin-top:16px">${t('sched.history') || 'Recent runs'}</label>
                <div class="sched-history">
                    ${[..._draft.history].reverse().slice(0, 8).map(h => `
                        <div class="sched-hist-row ${h.ok ? 'ok' : 'err'}"${h.err ? ` data-tooltip="${escAttr(h.err)}"` : ''}>
                            <span class="sched-hist-dot"></span>
                            <span class="sched-hist-when">${new Date(h.at).toLocaleString()}</span>
                            <span class="sched-hist-ms">${h.ms >= 1000 ? (h.ms / 1000).toFixed(1) + 's' : h.ms + 'ms'}</span>
                        </div>`).join('')}
                </div>` : ''}
            </aside>
            <main class="modal-body sched-body sched-flow">
                <div class="sched-flow-head">
                    <span class="sched-flow-start">${t('sched.flowStart') || 'START'}</span>
                    <span class="sched-flow-hint">${t('sched.fStepsHint') || 'WHAT it does, top to bottom'} — <span class="sched-flow-hint-drag">${t('sched.dragHint') || 'drag any block into an IF/LOOP branch to nest it'}</span></span>
                    <!-- The legend must list what the language actually has. It still
                         showed four blocks after For-Each, Switch, Try and the loop
                         signals were added — a legend that omits half the vocabulary
                         teaches the user the vocabulary is smaller than it is. -->
                    <span class="sched-legend-mini">
                        <b class="sched-step-tag sched-do" data-tooltip="${escAttr(t('sched.legendDo') || '')}">${t('sched.do') || 'DO'}</b>
                        <b class="sched-step-tag sched-if" data-tooltip="${escAttr(t('sched.legendIf') || '')}">${t('sched.if') || 'IF'}</b>
                        <b class="sched-step-tag sched-repeat" data-tooltip="${escAttr(t('sched.legendLoop') || '')}">${t('sched.repeat') || 'LOOP'}</b>
                        <b class="sched-step-tag sched-repeat" data-tooltip="${escAttr(t('sched.legendForEach') || '')}">${t('sched.forEach') || 'FOR EACH'}</b>
                        <b class="sched-step-tag sched-if" data-tooltip="${escAttr(t('sched.legendSwitch') || '')}">${t('sched.switch') || 'SWITCH'}</b>
                        <b class="sched-step-tag sched-if" data-tooltip="${escAttr(t('sched.legendTry') || '')}">${t('sched.try') || 'TRY'}</b>
                        <b class="sched-step-tag sched-wait" data-tooltip="${escAttr(t('sched.legendWait') || '')}">${t('sched.waitUntil') || 'WAIT'}</b>
                        <b class="sched-step-tag sched-repeat" data-tooltip="${escAttr(t('sched.legendBreak') || '')}">${t('sched.break') || 'BREAK'}</b>
                        <b class="sched-step-tag sched-repeat" data-tooltip="${escAttr(t('sched.legendStop') || '')}">${t('sched.stop') || 'STOP'}</b>
                    </span>
                </div>
                <div class="sched-timeline">
                    <div id="sched-steps" class="sched-steps"></div>
                    <div class="sched-add-row" id="sched-root-add"></div>
                </div>
            </main>
        </div>
        <div class="modal-footer sched-footer">
            <button class="btn btn-ghost" id="sched-cancel">${t('common.cancel') || 'Cancel'}</button>
            <button class="btn btn-ghost sched-test" id="sched-test" data-tooltip="${escAttr(t('sched.testHint') || 'Run the steps once right now, without saving')}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px"><polygon points="5 3 19 12 5 21 5 3"/></svg>${t('sched.testRun') || 'Test run'}</button>
            <button class="btn btn-primary" id="sched-save">${t('common.save') || 'Save'}</button>
        </div>
      </div>`;

    modal.querySelector('#sched-close')?.addEventListener('click', () => modal.classList.remove('open'));
    modal.querySelector('#sched-cancel')?.addEventListener('click', () => modal.classList.remove('open'));
    modal.querySelector('#sched-name')?.addEventListener('input', (e) => { _draft.name = (e.target as HTMLInputElement).value; });
    modal.querySelector('#sched-desc')?.addEventListener('input', (e) => { _draft.description = (e.target as HTMLTextAreaElement).value; });
    modal.querySelector('#sched-allow-cmd')?.addEventListener('change', (e) => { _draft.allowCustomCommands = (e.target as HTMLInputElement).checked; refreshSummary(modal); });
    modal.querySelector('#sched-os')?.addEventListener('change', (e) => { _draft.osSchedule = (e.target as HTMLInputElement).checked; refreshSummary(modal); });
    // Test run: execute the CURRENT draft's steps once, without saving the task —
    // instant feedback while building an automation instead of save→run→edit loops.
    modal.querySelector('#sched-test')?.addEventListener('click', async () => {
        if (!_draft.steps.length) { toast(t('sched.testNoSteps') || 'Add at least one step to test.', 'warning'); return; }
        const btn = modal.querySelector('#sched-test') as HTMLButtonElement;
        btn.disabled = true;
        toast(t('sched.testing') || 'Test run started…', 'info', 1500);
        try {
            await runSteps(_draft.steps, _draft, {});
            toast(t('sched.testOk') || 'Test run finished.', 'success');
        } catch (e) {
            if (e instanceof _StopTask) toast(`${t('sched.stopped') || 'stopped'}${(e as any).reason ? `: ${(e as any).reason}` : ''}`, 'info');
            else toast(`${t('sched.testFail') || 'Test run failed'} — ${e}`, 'error');
        } finally { btn.disabled = false; }
    });
    modal.querySelector('#sched-save')?.addEventListener('click', async () => {
        if (!_draft.name.trim()) { toast(t('sched.needName') || 'Name required', 'warning'); return; }
        if (_draft.osSchedule && (_draft.trigger.type as string) === 'appStart') {
            // appStart already runs on launch; OS task would be redundant but harmless.
        }
        const idx = _tasks.findIndex(x => x.id === _draft.id);
        if (idx >= 0) _tasks[idx] = _draft; else _tasks.push(_draft);
        await saveTasks();
        await syncOsSchedule(_draft);
        renderScheduleList(); modal.classList.remove('open');
    });

    renderTriggerEditor(modal.querySelector('#sched-trigger') as HTMLElement);
    renderStepsEditor(modal.querySelector('#sched-steps') as HTMLElement, _draft.steps);
    renderAddRow(modal.querySelector('#sched-root-add') as HTMLElement, _draft.steps);
}

function renderTriggerEditor(host: HTMLElement): void {
    const tr = _draft.trigger;
    // Visual trigger picker: one card per trigger type (icon + label) instead of a
    // bare <select> — the WHEN choice is the heart of a schedule, make it scannable.
    const kinds: Array<[string, string]> = [
        ['interval',  t('sched.trEvery')   || 'Every N minutes'],
        ['hourly',    t('sched.trHourly')  || 'Every N hours'],
        ['dailyAt',   t('sched.trDaily')   || 'Daily at time'],
        ['weeklyAt',  t('sched.trWeekly')  || 'Weekly on days'],
        ['monthlyAt', t('sched.trMonthly') || 'Monthly on a day'],
        ['once',      t('sched.trOnce')    || 'Once at date/time'],
        ['appStart',  t('sched.trAppStart')|| 'On BMM start'],
        ['manual',    t('sched.trManual')  || 'Manual only'],
    ];
    host.innerHTML = `
        <div class="sched-tr-grid">
            ${kinds.map(([v, label]) => `
                <button type="button" class="sched-tr-card ${tr.type === v ? 'active' : ''}" data-tr="${v}">
                    <span class="sched-tr-card-icon">${triggerIcon({ type: v } as Trigger)}</span>
                    <span class="sched-tr-card-label">${escHtml(label)}</span>
                </button>`).join('')}
        </div>
        <div id="sched-tr-params" class="sched-tr-params"></div>`;
    host.querySelectorAll('.sched-tr-card').forEach(card => card.addEventListener('click', () => {
        const v = (card as HTMLElement).dataset.tr!;
        if (v === 'interval') _draft.trigger = { type: 'interval', everyMinutes: 60 };
        else if (v === 'hourly') _draft.trigger = { type: 'hourly', everyHours: 1 };
        else if (v === 'dailyAt') _draft.trigger = { type: 'dailyAt', time: '08:00' };
        else if (v === 'weeklyAt') _draft.trigger = { type: 'weeklyAt', time: '08:00', days: [1] };
        else if (v === 'monthlyAt') _draft.trigger = { type: 'monthlyAt', day: 1, time: '08:00' };
        else if (v === 'once') _draft.trigger = { type: 'once', at: new Date(Date.now() + 3600000).toISOString().slice(0, 16) };
        else if (v === 'manual') _draft.trigger = { type: 'manual' };
        else _draft.trigger = { type: 'appStart' };
        renderTriggerEditor(host);
        const m = document.getElementById('modal-scheduler'); if (m) refreshSummary(m);
    }));
    const ph = host.querySelector('#sched-tr-params') as HTMLElement;
    // Any param change (time, minutes, day…) refreshes the header summary live.
    ph.addEventListener('input', () => { const m = document.getElementById('modal-scheduler'); if (m) refreshSummary(m); });
    if (tr.type === 'interval') {
        ph.innerHTML = `<input type="number" class="input" id="sched-tr-min" min="1" value="${tr.everyMinutes}" style="max-width:120px"> ${t('sched.unitMin') || 'min'}`;
        ph.querySelector('#sched-tr-min')?.addEventListener('input', (e) => { (_draft.trigger as any).everyMinutes = parseInt((e.target as HTMLInputElement).value) || 1; });
    } else if (tr.type === 'hourly') {
        ph.innerHTML = `<input type="number" class="input" id="sched-tr-h" min="1" value="${tr.everyHours}" style="max-width:120px"> ${t('sched.unitH') || 'h'}`;
        ph.querySelector('#sched-tr-h')?.addEventListener('input', (e) => { (_draft.trigger as any).everyHours = parseInt((e.target as HTMLInputElement).value) || 1; });
    } else if (tr.type === 'monthlyAt') {
        ph.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${t('sched.day') || 'Day'}</span>
            <input type="number" class="input" id="sched-tr-dom" min="1" max="31" value="${tr.day}" style="max-width:90px">
            <span style="font-size:12px;color:var(--text-muted)">${t('sched.atTime') || 'at'}</span>
            <input type="time" class="input" id="sched-tr-time" value="${tr.time}" style="max-width:140px">`;
        ph.querySelector('#sched-tr-dom')?.addEventListener('input', (e) => { (_draft.trigger as any).day = Math.min(31, Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1)); });
        ph.querySelector('#sched-tr-time')?.addEventListener('input', (e) => { (_draft.trigger as any).time = (e.target as HTMLInputElement).value; });
    } else if (tr.type === 'manual') {
        ph.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${t('sched.trManualHint') || 'Never runs automatically — use the ▶ Run button or a bmm://schedule/run link.'}</span>`;
    } else if (tr.type === 'dailyAt') {
        ph.innerHTML = `<input type="time" class="input" id="sched-tr-time" value="${tr.time}" style="max-width:140px">`;
        ph.querySelector('#sched-tr-time')?.addEventListener('input', (e) => { (_draft.trigger as any).time = (e.target as HTMLInputElement).value; });
    } else if (tr.type === 'weeklyAt') {
        const dayNames = (t('sched.dayNames') || 'Sun,Mon,Tue,Wed,Thu,Fri,Sat').split(',');
        ph.innerHTML = `<input type="time" class="input" id="sched-tr-time" value="${tr.time}" style="max-width:140px;margin-bottom:8px">
            <div style="display:flex;gap:4px;flex-wrap:wrap">${dayNames.map((d, i) =>
                `<button type="button" class="btn btn-xs ${tr.days.includes(i) ? 'btn-accent' : 'btn-ghost'}" data-day="${i}">${escHtml(d)}</button>`).join('')}</div>`;
        ph.querySelector('#sched-tr-time')?.addEventListener('input', (e) => { (_draft.trigger as any).time = (e.target as HTMLInputElement).value; });
        ph.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
            const i = parseInt((b as HTMLElement).dataset.day!); const days = (_draft.trigger as any).days as number[];
            const k = days.indexOf(i); if (k >= 0) days.splice(k, 1); else days.push(i); renderTriggerEditor(host);
        }));
    } else if (tr.type === 'once') {
        ph.innerHTML = `<input type="datetime-local" class="input" id="sched-tr-at" value="${escAttr(tr.at.slice(0, 16))}" style="max-width:220px">`;
        ph.querySelector('#sched-tr-at')?.addEventListener('input', (e) => { (_draft.trigger as any).at = new Date((e.target as HTMLInputElement).value).toISOString(); });
    } else {
        ph.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${t('sched.trAppStartHint') || 'Runs once each time BMM launches.'}</span>`;
    }
}

// Recursive step list editor.
/** Pointer-based step reordering (reliable in WebView2, unlike native HTML5 DnD).
 *  Grabs the grip handle, tracks the cursor, shows an insertion line, applies on release. */
// Every rendered step container (root list, IF then/else, LOOP body) registers its
// backing Step[] here, so a drag can move a step ACROSS containers — into an IF
// branch, out of a loop, between branches — not just reorder within one list.
const _zoneSteps = new WeakMap<HTMLElement, Step[]>();

/** Re-render the whole root steps tree (source of truth after a cross-zone move). */
function _rerenderRootSteps(): void {
    const m = document.getElementById('modal-scheduler');
    const root = m?.querySelector('#sched-steps') as HTMLElement | null;
    if (!m || !root) return;
    const body = m.querySelector('.sched-body') as HTMLElement | null;
    const top = body ? body.scrollTop : 0;
    renderStepsEditor(root, _draft.steps, 0);
    if (body) body.scrollTop = top;
    refreshSummary(m as HTMLElement);
}

function _startStepDrag(ev: MouseEvent, steps: Step[], fromIdx: number, block: HTMLElement, host: HTMLElement, rerender: () => void): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const startY = ev.clientY;
    let dragging = false;
    let insertIdx = fromIdx;
    let targetZone: HTMLElement = host;

    const clearMarks = () => {
        document.querySelectorAll('.sched-drop-before, .sched-drop-after').forEach(el => el.classList.remove('sched-drop-before', 'sched-drop-after'));
        document.querySelectorAll('.sched-drop-into').forEach(el => el.classList.remove('sched-drop-into'));
    };
    const zoneBlocks = (zone: HTMLElement): HTMLElement[] =>
        Array.from(zone.children).filter(c => (c as HTMLElement).classList.contains('sched-step') && c !== block) as HTMLElement[];

    /** The step container under the cursor. A zone inside the dragged block itself
     *  is invalid (a step can't be dropped into its own branches) → climb out. */
    const zoneAt = (x: number, y: number): HTMLElement => {
        let el = document.elementFromPoint(x, y) as HTMLElement | null;
        let z = el?.closest('.sched-drop-zone') as HTMLElement | null;
        while (z && block.contains(z)) z = (z.parentElement?.closest('.sched-drop-zone') as HTMLElement | null) ?? null;
        return (z && _zoneSteps.has(z)) ? z : host;
    };

    const computeInsert = (e: MouseEvent) => {
        clearMarks();
        targetZone = zoneAt(e.clientX, e.clientY);
        const bs = zoneBlocks(targetZone);
        let idx = bs.length;                    // default: append at the end
        for (let k = 0; k < bs.length; k++) {
            const r = bs[k].getBoundingClientRect();
            if (e.clientY < r.top + r.height / 2) { idx = k; break; }
        }
        if (idx < bs.length) bs[idx].classList.add('sched-drop-before');
        else if (bs.length) bs[bs.length - 1].classList.add('sched-drop-after');
        else targetZone.classList.add('sched-drop-into');   // empty branch → "drop here" ring
        insertIdx = idx;
    };

    const onMove = (e: MouseEvent) => {
        if (!dragging) {
            if (Math.abs(e.clientY - startY) < 4) return;   // small threshold before it counts as a drag
            dragging = true;
            block.classList.add('sched-dragging');
            document.body.classList.add('sched-drag-live'); // reveals empty drop zones
            document.body.style.userSelect = 'none';
        }
        computeInsert(e);
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        document.body.classList.remove('sched-drag-live');
        block.classList.remove('sched-dragging');
        clearMarks();
        if (!dragging) return;
        const targetArr = _zoneSteps.get(targetZone);
        if (!targetArr) return;
        const sameZone = targetArr === steps;
        // The insert index was computed over the list WITHOUT the dragged block, so
        // within the same zone it maps 1:1 after removal — no extra shift needed.
        if (sameZone && insertIdx === fromIdx) return;      // dropped where it started
        _snapshot();
        const [moved] = steps.splice(fromIdx, 1);
        targetArr.splice(Math.min(insertIdx, targetArr.length), 0, moved);
        // A cross-zone move touches two containers — re-render the whole tree.
        if (sameZone) rerender(); else _rerenderRootSteps();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function renderStepsEditor(host: HTMLElement, steps: Step[], depth = 0): void {
    host.innerHTML = '';
    // Register this container as a drop zone so steps can be dragged INTO it
    // (root list, IF then/else branches, LOOP bodies — all become valid targets).
    _zoneSteps.set(host, steps);
    host.classList.add('sched-drop-zone');
    steps.forEach((step, i) => {
        const block = document.createElement('div');
        block.className = 'sched-step sched-step-' + step.kind + (step.collapsed ? ' collapsed' : '') + (step.disabled ? ' sched-disabled' : '');
        // Indentation is handled entirely by the branch containers' padding (one
        // clean guide line per level) — NOT a per-step margin, which used to stack
        // on top of the branch padding and squeezed deep blocks into a tiny column.
        const rerenderHere = () => renderStepsEditor(host, steps, depth);

        if (step.kind === 'action') {
            block.appendChild(actionEditor(step.action, rerenderHere));
        } else if (step.kind === 'delay') {
            block.innerHTML = `<div class="sched-step-head">${_kindTile('delay')}<span class="sched-step-tag sched-pause">${t('sched.delay') || 'Wait'}</span>
                <span class="sched-delay-body"><input type="number" class="input" min="0" value="${step.seconds}" style="max-width:90px"> ${t('sched.unitSec') || 's'}</span></div>`;
            block.querySelector('input')?.addEventListener('input', (e) => { step.seconds = parseInt((e.target as HTMLInputElement).value) || 0; });
        } else if (step.kind === 'waitFor') {
            const toMode = step.onTimeout || 'abort';
            block.innerHTML = `<div class="sched-step-head">${_foldBtn(step)}${_kindTile('waitFor')}<span class="sched-step-tag sched-wait">${t('sched.waitUntil') || 'WAIT UNTIL'}</span>
                <span class="sched-cond-label">${t('sched.condition') || 'condition:'}</span>
                <div class="sched-cond" style="flex:1"></div></div>
                <div class="sched-wait-opts">
                    <span class="sched-wait-lbl">${t('sched.checkEvery') || 'check every'}</span>
                    <input type="number" class="input sched-wait-poll" min="1" value="${step.pollSec || 2}" style="max-width:70px"> ${t('sched.unitSec') || 's'}
                    <span class="sched-wait-lbl">${t('sched.timeout') || 'timeout'}</span>
                    <input type="number" class="input sched-wait-to" min="1" value="${step.timeoutSec}" style="max-width:80px"> ${t('sched.unitSec') || 's'}
                    <span class="sched-wait-lbl">${t('sched.onTimeout') || 'on timeout'}</span>
                    <select class="input sched-wait-ot" style="max-width:150px">
                        <option value="abort"${toMode === 'abort' ? ' selected' : ''}>${t('sched.timeoutAbort') || 'stop the task (error)'}</option>
                        <option value="continue"${toMode === 'continue' ? ' selected' : ''}>${t('sched.timeoutContinue') || 'continue anyway'}</option>
                    </select>
                </div>`;
            block.querySelector('.sched-cond')?.appendChild(conditionEditor(step.condition));
            block.querySelector('.sched-wait-to')?.addEventListener('input', (e) => { step.timeoutSec = parseInt((e.target as HTMLInputElement).value) || 60; });
            block.querySelector('.sched-wait-poll')?.addEventListener('input', (e) => { step.pollSec = parseInt((e.target as HTMLInputElement).value) || 2; });
            block.querySelector('.sched-wait-ot')?.addEventListener('change', (e) => { step.onTimeout = (e.target as HTMLSelectElement).value as any; });
            _wireFold(block, step);
        } else if (step.kind === 'if') {
            block.innerHTML = `<div class="sched-step-head">${_foldBtn(step)}${_kindTile('if')}<span class="sched-step-tag sched-if">${t('sched.if') || 'IF'}</span>
                <span class="sched-cond-label">${t('sched.condition') || 'condition:'}</span>
                <div class="sched-cond" style="flex:1"></div></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.then') || 'THEN'}</div><div class="sched-then"></div><div class="sched-then-add"></div></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.else') || 'ELSE'}</div><div class="sched-else"></div><div class="sched-else-add"></div></div>`;
            block.querySelector('.sched-cond')?.appendChild(conditionEditor(step.condition));
            renderStepsEditor(block.querySelector('.sched-then') as HTMLElement, step.then, depth + 1);
            renderStepsEditor(block.querySelector('.sched-else') as HTMLElement, step.else, depth + 1);
            renderAddRow(block.querySelector('.sched-then-add') as HTMLElement, step.then, depth + 1, host, steps, depth);
            renderAddRow(block.querySelector('.sched-else-add') as HTMLElement, step.else, depth + 1, host, steps, depth);
            _wireFold(block, step);
        } else if (step.kind === 'repeat') {
            const modeSel = (['while', 'until', 'doWhile', 'times'] as const).map(m =>
                `<option value="${m}"${step.mode === m ? ' selected' : ''}>${escHtml(t('sched.loop.' + m) || m)}</option>`).join('');
            block.innerHTML = `<div class="sched-step-head">${_foldBtn(step)}${_kindTile('repeat')}
                    <span class="sched-step-tag sched-repeat">${t('sched.repeat') || 'REPEAT'}</span>
                    <select class="input sched-rep-mode" style="max-width:130px">${modeSel}</select>
                    <span class="sched-rep-cond-wrap" style="display:${step.mode === 'times' ? 'none' : 'flex'};align-items:center;gap:6px;flex:1"><div class="sched-cond" style="flex:1"></div></span>
                    <span class="sched-rep-times-wrap" style="display:${step.mode === 'times' ? 'inline-flex' : 'none'};align-items:center;gap:6px"><input type="number" class="input sched-rep-times" min="1" value="${step.times || 3}" style="max-width:90px"> ${t('sched.loopTimes') || 'times'}</span>
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.loopMax') || 'max'}</span><input type="number" class="input sched-rep-max" min="1" value="${step.maxIters || 100}" style="max-width:90px">
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.loopEvery') || 'every'}</span><input type="number" class="input sched-rep-every" min="0" value="${step.everySec || 1}" style="max-width:80px"> ${t('sched.unitSec') || 's'}</div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.loopBody') || 'LOOP'}</div><div class="sched-loop"></div><div class="sched-loop-add"></div></div>`;
            if (!step.condition) step.condition = { type: 'always', params: {} };
            block.querySelector('.sched-cond')?.appendChild(conditionEditor(step.condition));
            block.querySelector('.sched-rep-mode')?.addEventListener('change', (e) => { _snapshot(); step.mode = (e.target as HTMLSelectElement).value as any; renderStepsEditor(host, steps, depth); });
            block.querySelector('.sched-rep-times')?.addEventListener('input', (e) => { step.times = parseInt((e.target as HTMLInputElement).value) || 1; });
            block.querySelector('.sched-rep-max')?.addEventListener('input', (e) => { step.maxIters = parseInt((e.target as HTMLInputElement).value) || 100; });
            block.querySelector('.sched-rep-every')?.addEventListener('input', (e) => { step.everySec = parseFloat((e.target as HTMLInputElement).value) || 0; });
            renderStepsEditor(block.querySelector('.sched-loop') as HTMLElement, step.steps, depth + 1);
            renderAddRow(block.querySelector('.sched-loop-add') as HTMLElement, step.steps, depth + 1, host, steps, depth);
            _wireFold(block, step);
        } else if (step.kind === 'forEach') {
            const srcSel = (['enabledMods', 'disabledMods', 'mods', 'profiles', 'modpacks', 'themes'] as const).map(m =>
                `<option value="${m}"${step.source === m ? ' selected' : ''}>${escHtml(t('sched.fe.' + m) || m)}</option>`).join('');
            block.innerHTML = `<div class="sched-step-head">${_foldBtn(step)}${_kindTile('forEach')}
                    <span class="sched-step-tag sched-repeat">${t('sched.forEach') || 'FOR EACH'}</span>
                    <select class="input sched-fe-src" style="max-width:190px">${srcSel}</select>
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.loopMax') || 'max'}</span><input type="number" class="input sched-fe-max" min="1" value="${step.maxIters || 100}" style="max-width:90px">
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.loopEvery') || 'every'}</span><input type="number" class="input sched-fe-every" min="0" value="${step.everySec || 0}" style="max-width:80px"> ${t('sched.unitSec') || 's'}
                    <span style="font-size:10px;color:var(--text-muted)">${t('sched.fe.hint') || '{item.id} / {item.name} in the body'}</span></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.fe.body') || 'PER ITEM'}</div><div class="sched-fe-body"></div><div class="sched-fe-add"></div></div>`;
            block.querySelector('.sched-fe-src')?.addEventListener('change', (e) => { step.source = (e.target as HTMLSelectElement).value as any; });
            block.querySelector('.sched-fe-max')?.addEventListener('input', (e) => { step.maxIters = parseInt((e.target as HTMLInputElement).value) || 100; });
            block.querySelector('.sched-fe-every')?.addEventListener('input', (e) => { step.everySec = parseFloat((e.target as HTMLInputElement).value) || 0; });
            renderStepsEditor(block.querySelector('.sched-fe-body') as HTMLElement, step.steps, depth + 1);
            renderAddRow(block.querySelector('.sched-fe-add') as HTMLElement, step.steps, depth + 1, host, steps, depth);
            _wireFold(block, step);
        } else if (step.kind === 'try') {
            block.innerHTML = `<div class="sched-step-head">${_foldBtn(step)}${_kindTile('try')}
                    <span class="sched-step-tag sched-if">${t('sched.try') || 'TRY'}</span>
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.tryHint') || 'if anything below fails, run ON ERROR instead of aborting the task'}</span></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.tryDo') || 'TRY'}</div><div class="sched-try-body"></div><div class="sched-try-add"></div></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.tryCatch') || 'ON ERROR'}</div><div class="sched-catch-body"></div><div class="sched-catch-add"></div></div>`;
            renderStepsEditor(block.querySelector('.sched-try-body') as HTMLElement, step.steps, depth + 1);
            renderStepsEditor(block.querySelector('.sched-catch-body') as HTMLElement, step.onError, depth + 1);
            renderAddRow(block.querySelector('.sched-try-add') as HTMLElement, step.steps, depth + 1, host, steps, depth);
            renderAddRow(block.querySelector('.sched-catch-add') as HTMLElement, step.onError, depth + 1, host, steps, depth);
            _wireFold(block, step);
        } else if (step.kind === 'break' || step.kind === 'continue' || step.kind === 'stop') {
            const label = step.kind === 'break' ? (t('sched.break') || 'BREAK')
                        : step.kind === 'continue' ? (t('sched.continue') || 'CONTINUE')
                        : (t('sched.stop') || 'STOP');
            const hint = step.kind === 'break' ? (t('sched.breakHint') || 'leave the loop now')
                       : step.kind === 'continue' ? (t('sched.continueHint') || 'skip to the next iteration')
                       : (t('sched.stopHint') || 'end the whole task, successfully');
            block.innerHTML = `<div class="sched-step-head">${_kindTile('signal')}
                    <span class="sched-step-tag sched-repeat">${label}</span>
                    <span style="font-size:11px;color:var(--text-muted)">${hint}</span></div>`;
        } else if (step.kind === 'switch') {
            block.innerHTML = `<div class="sched-step-head">${_foldBtn(step)}${_kindTile('switch')}
                    <span class="sched-step-tag sched-if">${t('sched.switch') || 'SWITCH'}</span>
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.switchHint') || 'first matching case runs'}</span>
                    <button class="btn btn-xs sched-chip sched-sw-addcase" style="margin-left:auto">${t('sched.switchAddCase') || '+ case'}</button></div>
                <div class="sched-sw-cases"></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.switchDefault') || 'DEFAULT'}</div><div class="sched-sw-def"></div><div class="sched-sw-def-add"></div></div>`;
            const casesHost = block.querySelector('.sched-sw-cases') as HTMLElement;
            (step.cases || []).forEach((c, ci) => {
                const cb = document.createElement('div');
                cb.className = 'sched-branch';
                cb.innerHTML = `<div class="sched-branch-label" style="display:flex;align-items:center;gap:8px">${t('sched.switchCase') || 'CASE'} ${ci + 1}
                        <span class="sched-sw-cond" style="flex:1"></span>
                        <button class="btn btn-xs sched-chip sched-sw-delcase">✕</button></div>
                    <div class="sched-sw-case-steps"></div><div class="sched-sw-case-add"></div>`;
                cb.querySelector('.sched-sw-cond')?.appendChild(conditionEditor(c.condition));
                renderStepsEditor(cb.querySelector('.sched-sw-case-steps') as HTMLElement, c.steps, depth + 1);
                renderAddRow(cb.querySelector('.sched-sw-case-add') as HTMLElement, c.steps, depth + 1, host, steps, depth);
                cb.querySelector('.sched-sw-delcase')?.addEventListener('click', () => {
                    _snapshot(); step.cases.splice(ci, 1); renderStepsEditor(host, steps, depth);
                });
                casesHost.appendChild(cb);
            });
            block.querySelector('.sched-sw-addcase')?.addEventListener('click', () => {
                _snapshot(); step.cases.push({ condition: { type: 'always', params: {} }, steps: [] }); renderStepsEditor(host, steps, depth);
            });
            renderStepsEditor(block.querySelector('.sched-sw-def') as HTMLElement, step.default, depth + 1);
            renderAddRow(block.querySelector('.sched-sw-def-add') as HTMLElement, step.default, depth + 1, host, steps, depth);
            _wireFold(block, step);
        }

        // Every step is collapsible. if/repeat/waitFor add their fold inline; action +
        // delay get one injected into their head here.
        const headEl = block.querySelector('.sched-act-head, .sched-step-head') as HTMLElement | null;
        if (headEl && !headEl.querySelector('.sched-fold')) {
            headEl.insertAdjacentHTML('afterbegin', _foldBtn(step));
            _wireFold(block, step);
        }

        // Unified step toolbar (hover): run just this step, duplicate, disable, delete.
        if (headEl && !headEl.querySelector('.sched-tools')) {
            const tools = document.createElement('span');
            tools.className = 'sched-tools';
            const offTip = step.disabled ? (t('sched.enableStep') || 'Enable this step') : (t('sched.disableStep') || 'Disable this step (skipped at run time)');
            tools.innerHTML = `
                <button class="sched-tool sched-run1" data-tooltip="${escAttr(t('sched.runStep') || 'Run this step now')}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
                <button class="sched-tool sched-dup" data-tooltip="${escAttr(t('sched.dupStep') || 'Duplicate step')}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                <button class="sched-tool sched-off ${step.disabled ? 'active' : ''}" data-tooltip="${escAttr(offTip)}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></button>
                <button class="sched-tool sched-del2" data-tooltip="${escAttr(t('common.delete') || 'Delete')}">${SCHED_X}</button>`;
            headEl.appendChild(tools);
            tools.querySelector('.sched-run1')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                const btn = e.currentTarget as HTMLButtonElement;
                btn.disabled = true;
                try {
                    // Run a shallow copy with disabled cleared, so even a switched-off
                    // step can be test-fired on demand.
                    await runSteps([{ ...(step as any), disabled: false } as Step], _draft, {});
                    toast(t('sched.stepDone') || 'Step finished.', 'success');
                } catch (err) {
                    if (err instanceof _StopTask) toast(`${t('sched.stopped') || 'stopped'}${(err as any).reason ? `: ${(err as any).reason}` : ''}`, 'info');
                    else toast(`${t('sched.stepFail') || 'Step failed'} — ${err}`, 'error');
                } finally { btn.disabled = false; }
            });
            tools.querySelector('.sched-dup')?.addEventListener('click', (e) => {
                e.stopPropagation();
                _snapshot();
                steps.splice(i + 1, 0, JSON.parse(JSON.stringify(step)));
                rerenderHere();
            });
            tools.querySelector('.sched-off')?.addEventListener('click', (e) => {
                e.stopPropagation();
                _snapshot();
                step.disabled = !step.disabled;
                block.classList.toggle('sched-disabled', !!step.disabled);
                const b = e.currentTarget as HTMLElement;
                b.classList.toggle('active', !!step.disabled);
                b.title = step.disabled ? (t('sched.enableStep') || 'Enable this step') : (t('sched.disableStep') || 'Disable this step (skipped at run time)');
            });
            tools.querySelector('.sched-del2')?.addEventListener('click', (e) => {
                e.stopPropagation();
                _deleteStep(step, steps, i, rerenderHere);
            });
        }

        // Grip handle — pointer-based reorder (native HTML5 DnD is unreliable in WebView2).
        const handle = document.createElement('span');
        handle.className = 'sched-drag-handle';
        handle.title = t('sched.reorder') || 'Drag to reorder';
        handle.innerHTML = `<svg width="12" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/></svg>`;
        handle.addEventListener('mousedown', (e) => _startStepDrag(e, steps, i, block, host, rerenderHere));
        block.prepend(handle);

        // Notion-style insert-between: a slim hover bar between blocks; clicking it
        // reveals the kind chips and inserts the new step at THAT position.
        if (i > 0) {
            const ins = document.createElement('div');
            ins.className = 'sched-insert';
            ins.innerHTML = `<button class="sched-insert-btn" data-tooltip="${escAttr(t('sched.insertHere') || 'Insert a step here')}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 5v14M5 12h14"/></svg></button>`;
            ins.querySelector('.sched-insert-btn')?.addEventListener('click', () => {
                if (ins.querySelector('.sched-insert-picker')) { ins.querySelector('.sched-insert-picker')?.remove(); return; }
                const picker = document.createElement('div');
                picker.className = 'sched-insert-picker sched-add-row';
                picker.innerHTML = ['action', 'if', 'repeat', 'waitFor', 'delay'].map(k =>
                    `<button class="btn btn-xs sched-chip sched-add-${k === 'action' ? 'do' : k === 'repeat' ? 'loop' : k === 'waitFor' ? 'wait' : k}" data-ins="${k}">${
                        k === 'action' ? (t('sched.addAction') || 'Action') : k === 'if' ? (t('sched.addIf') || 'If/Else')
                        : k === 'repeat' ? (t('sched.addLoop') || 'Loop') : k === 'waitFor' ? (t('sched.addWaitFor') || 'Wait until') : (t('sched.addDelay') || 'Pause')}</button>`).join('');
                picker.querySelectorAll('[data-ins]').forEach(b => b.addEventListener('click', () => {
                    _snapshot();
                    steps.splice(i, 0, _makeStep((b as HTMLElement).dataset.ins!));
                    renderStepsEditor(host, steps, depth);
                }));
                ins.appendChild(picker);
            });
            host.appendChild(ins);
        }

        host.appendChild(block);
    });
}

function renderAddRow(host: HTMLElement, steps: Step[], depth = 0, rerenderHost?: HTMLElement, rerenderSteps?: Step[], rerenderDepth = 0): void {
    host.className = 'sched-add-row';
    host.innerHTML = `
        <button class="btn btn-xs sched-chip sched-add-do" data-add="action" data-tooltip="${escAttr(t('sched.legendDo') || '')}">${KIND_ICON.action} ${t('sched.addAction') || 'Action'}</button>
        <button class="btn btn-xs sched-chip sched-add-if" data-add="if" data-tooltip="${escAttr(t('sched.legendIf') || '')}">${KIND_ICON.if} ${t('sched.addIf') || 'If/Else'}</button>
        <button class="btn btn-xs sched-chip sched-add-loop" data-add="repeat" data-tooltip="${escAttr(t('sched.legendLoop') || '')}">${KIND_ICON.repeat} ${t('sched.addLoop') || 'Loop'}</button>
        <button class="btn btn-xs sched-chip sched-add-wait" data-add="waitFor" data-tooltip="${escAttr(t('sched.legendWait') || '')}">${KIND_ICON.waitFor} ${t('sched.addWaitFor') || 'Wait until'}</button>
        <button class="btn btn-xs sched-chip sched-add-delay" data-add="delay" data-tooltip="${escAttr(t('sched.legendDelay') || '')}">${KIND_ICON.delay} ${t('sched.addDelay') || 'Pause'}</button>
        <button class="btn btn-xs sched-chip sched-add-foreach" data-add="forEach" data-tooltip="${escAttr(t('sched.legendForEach') || '')}">${KIND_ICON.forEach} ${t('sched.addForEach') || 'For each'}</button>
        <button class="btn btn-xs sched-chip sched-add-switch" data-add="switch" data-tooltip="${escAttr(t('sched.legendSwitch') || '')}">${KIND_ICON.switch} ${t('sched.addSwitch') || 'Switch'}</button>
        <button class="btn btn-xs sched-chip sched-add-try" data-add="try" data-tooltip="${escAttr(t('sched.legendTry') || '')}">${KIND_ICON.try} ${t('sched.addTry') || 'Try / on error'}</button>
        <button class="btn btn-xs sched-chip sched-add-break" data-add="break" data-tooltip="${escAttr(t('sched.legendBreak') || '')}">${KIND_ICON.signal} ${t('sched.addBreak') || 'Break'}</button>
        <button class="btn btn-xs sched-chip sched-add-continue" data-add="continue" data-tooltip="${escAttr(t('sched.legendContinue') || '')}">${KIND_ICON.signal} ${t('sched.addContinue') || 'Continue'}</button>
        <button class="btn btn-xs sched-chip sched-add-stop" data-add="stop" data-tooltip="${escAttr(t('sched.legendStop') || '')}">${KIND_ICON.signal} ${t('sched.addStop') || 'Stop'}</button>`;
    const rerender = () => {
        // Preserve the modal's scroll position so adding a step deep in a big task
        // doesn't yank the view back to the top (a real annoyance with lots of content).
        const body = document.querySelector('#modal-scheduler .sched-body') as HTMLElement | null;
        const top = body ? body.scrollTop : 0;
        if (rerenderHost) renderStepsEditor(rerenderHost, rerenderSteps!, rerenderDepth);
        else renderStepsEditor(host.previousElementSibling as HTMLElement || host.parentElement!.querySelector('.sched-steps') as HTMLElement, steps, depth);
        if (body) body.scrollTop = top;
    };
    host.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
        _snapshot();
        steps.push(_makeStep((btn as HTMLElement).dataset.add!));
        rerender();
    }));
}

/** A fresh step of the given kind with sane defaults (shared by add rows + inserts). */
function _makeStep(kind: string): Step {
    if (kind === 'if') return { kind: 'if', condition: { type: 'always', params: {} }, then: [], else: [] } as Step;
    if (kind === 'repeat') return { kind: 'repeat', mode: 'while', condition: { type: 'always', params: {} }, maxIters: 100, everySec: 1, steps: [] } as Step;
    if (kind === 'forEach') return { kind: 'forEach', source: 'enabledMods', maxIters: 100, everySec: 0, steps: [] } as Step;
    if (kind === 'switch') return { kind: 'switch', cases: [{ condition: { type: 'always', params: {} }, steps: [] }], default: [] } as Step;
    if (kind === 'try') return { kind: 'try', steps: [], onError: [] } as Step;
    if (kind === 'break' || kind === 'continue' || kind === 'stop') return { kind } as Step;
    if (kind === 'waitFor') return { kind: 'waitFor', condition: { type: 'allModsActive', params: {} }, timeoutSec: 120 } as Step;
    if (kind === 'delay') return { kind: 'delay', seconds: 5 } as Step;
    return { kind: 'action', action: { type: 'profile.activate', params: {} } } as Step;
}

// group → optgroup label (matches the script generator's categories).
const ACTION_GROUPS: { g: string; label: string }[] = [
    { g: 'mods',    label: 'Mods & profiles' },
    { g: 'repo',    label: 'Repo & sharing' },
    { g: 'apps',    label: 'Apps & launch' },
    { g: 'look',    label: 'Appearance' },
    { g: 'perf',    label: 'Benchmarks & storage' },
    { g: 'privacy', label: 'Privacy & recorder' },
    { g: 'logic',   label: 'Logic & math' },
    { g: 'system',  label: 'System & flow' },
];

// icon per group (inline SVG, no emoji — matches the BMM icon-only rule).
// Simplified to clean, single-shape glyphs that stay legible at 14px (the old
// "look"/"system"/"logic" icons were busy compound paths that read as a blur
// at tile size — this was the "ugly action-type icons" complaint).
const GROUP_ICON: Record<string, string> = {
    mods:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
    repo:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v3a3 3 0 0 1-3 3H9"/></svg>',
    apps:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    look:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
    perf:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
    privacy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    system:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    logic:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h6l3 14h7M13 5h7"/></svg>',
};

// Clean inline X icon for delete buttons (replaces the raw ✕ glyph).
const SCHED_X = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
// One icon per step kind — used by the head tiles, the add-chips and the pickers.
const KIND_ICON: Record<string, string> = {
    action:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    if:      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v6a6 6 0 0 0 6 6h6M14 9l4 3-4 3"/></svg>',
    repeat:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2.1 21 6l-4 3.9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 21.9 3 18l4-3.9"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    waitFor: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5l3 2"/></svg>',
    delay:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="4.5" width="4" height="15" rx="1.2"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.2"/></svg>',
    forEach: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="5" rx="1"/><rect x="3" y="15" width="7" height="5" rx="1"/><path d="M14 6.5h7M14 17.5h7M14 12h7"/></svg>',
    switch:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v5"/><path d="M12 8 5 13v8M12 8l7 5v8"/></svg>',
    try:     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    signal:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
};
/** Kind-coloured icon tile that opens every step head (the visual anchor). */
function _kindTile(kind: string): string {
    return `<span class="sched-kind-ic k-${kind}">${KIND_ICON[kind] || ''}</span>`;
}
// Fold chevron for collapsible control blocks (if / loop / wait until) — a
// small rounded chip (not a bare ghost button) so it reads as a control at a
// glance instead of a stray dot.
const SCHED_CHEV = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
// Fold button + a short summary shown only while collapsed.
function _foldBtn(step: any): string {
    let sum = '';
    if (step.kind === 'if') sum = `${(step.then?.length || 0) + (step.else?.length || 0)} ${t('sched.stepsInside') || 'inside'}`;
    else if (step.kind === 'repeat' || step.kind === 'forEach') sum = `${step.steps?.length || 0} ${t('sched.stepsInside') || 'inside'}`;
    else if (step.kind === 'switch') sum = `${(step.cases?.length || 0)} cases`;
    else if (step.kind === 'try') sum = `${(step.steps?.length || 0)} + ${(step.onError?.length || 0)}`;
    else if (step.kind === 'delay') sum = `${step.seconds || 0}${t('sched.unitSec') || 's'}`;
    const sumHtml = sum ? `<span class="sched-fold-sum">${sum}</span>` : '';
    return `<button class="btn btn-xs btn-ghost sched-fold" data-tooltip="${escAttr(t('sched.foldTip') || 'Collapse / expand')}" aria-label="fold">${SCHED_CHEV}</button>${sumHtml}`;
}
function _wireFold(block: HTMLElement, step: any): void {
    block.querySelector('.sched-fold')?.addEventListener('click', (e) => {
        e.stopPropagation();
        step.collapsed = !step.collapsed;
        block.classList.toggle('collapsed', !!step.collapsed);
    });
}

const ACTION_TYPES: { v: string; label: string; needs?: string; group: string }[] = [
    // ── Mods & profiles ──
    { v: 'profile.activate', label: 'Activate profile', needs: 'profile', group: 'mods' },
    { v: 'mod.enable', label: 'Enable mod', needs: 'mod', group: 'mods' },
    { v: 'mod.disable', label: 'Disable mod', needs: 'mod', group: 'mods' },
    { v: 'modpack.enable', label: 'Enable modpack', needs: 'modpack', group: 'mods' },
    { v: 'modpack.disable', label: 'Disable modpack', needs: 'modpack', group: 'mods' },
    { v: 'modpack.create', label: 'Create modpack', needs: 'mpCreate', group: 'mods' },
    { v: 'mod.add', label: 'Add a mod (from URL)', needs: 'modAdd', group: 'mods' },
    { v: 'modlist.export', label: 'Export a mod list (.mmlist)', group: 'mods' },
    { v: 'modlist.import', label: 'Import a mod list (.mmlist)', group: 'mods' },
    { v: 'mods.enableAll', label: 'Enable all mods', group: 'mods' },
    { v: 'mods.disableAll', label: 'Disable all mods', group: 'mods' },
    { v: 'mods.scan', label: 'Scan mods folder', group: 'mods' },
    { v: 'plugin.apply', label: 'Apply plugin modlist', needs: 'pluginId', group: 'mods' },
    { v: 'plugin.compare', label: 'Compare plugin', needs: 'pluginId', group: 'mods' },
    { v: 'plugin.delete', label: 'Delete plugin', needs: 'pluginId', group: 'mods' },
    { v: 'mods.checkUpdates', label: 'Check mod updates', group: 'mods' },
    { v: 'mods.autoImportOmm', label: 'Auto-import Open Mod Manager mods', group: 'mods' },
    { v: 'mods.clearHistory', label: 'Clear profile activity history', needs: 'profile', group: 'mods' },
    { v: 'mods.exportModpack', label: 'Export modpack (.bmp)', needs: 'modpackExport', group: 'mods' },
    // ── Repo & sharing ──
    { v: 'repo.connect', label: 'Connect repo', needs: 'repoConnect', group: 'repo' },
    { v: 'repo.sync', label: 'Sync repo', needs: 'repoSync', group: 'repo' },
    { v: 'repo.gen', label: 'Generate repo', group: 'repo' },
    { v: 'repo.update', label: 'Update repo', needs: 'repoUpdate', group: 'repo' },
    { v: 'repo.host', label: 'Host repo (HTTP)', needs: 'repoHost', group: 'repo' },
    // ── Apps & launch ──
    { v: 'app.launch', label: 'Launch app', needs: 'app', group: 'apps' },
    { v: 'file.open', label: 'Open / launch a file or program', needs: 'pathFile', group: 'apps' },
    { v: 'folder.open', label: 'Open a folder', needs: 'pathFolder', group: 'apps' },
    { v: 'app.install', label: 'Install app', needs: 'appInstall', group: 'apps' },
    { v: 'launchpack.run', label: 'Run launch pack', needs: 'lpId', group: 'apps' },
    // ── Appearance ──
    { v: 'theme.set', label: 'Set theme', needs: 'theme', group: 'look' },
    // ── Benchmarks & storage ──
    { v: 'benchmark.run', label: 'Run benchmark', needs: 'benchmark', group: 'perf' },
    { v: 'storage.diskBenchmark', label: 'Storage: benchmark a disk', needs: 'disk', group: 'perf' },
    { v: 'storage.applyLimit', label: 'Storage: apply disk speed limit', needs: 'applyLimit', group: 'perf' },
    { v: 'storage.calibration', label: 'Storage: Performance Auto-Calibration', needs: 'toggle', group: 'perf' },
    { v: 'storage.smartIo', label: 'Storage: Smart I/O', needs: 'toggle', group: 'perf' },
    { v: 'storage.flag', label: 'Storage: toggle a setting (advanced)', needs: 'flag', group: 'perf' },
    { v: 'perf.diskSpace', label: 'Check free disk space', needs: 'disk', group: 'perf' },
    // ── Privacy & recorder ──
    { v: 'telemetry.consent', label: 'Telemetry consent', needs: 'toggle', group: 'privacy' },
    { v: 'telemetry.set', label: 'Telemetry options', needs: 'telemetry', group: 'privacy' },
    { v: 'recorder.set', label: 'Session recorder', needs: 'recorder', group: 'privacy' },
    { v: 'replay.export', label: 'Export replay', group: 'privacy' },
    { v: 'replay.import', label: 'Import replay', needs: 'replayImport', group: 'privacy' },
    // ── System & flow ──
    { v: 'notify', label: 'Show notification', needs: 'message', group: 'system' },
    { v: 'discord.rpc', label: 'Discord Rich Presence', needs: 'toggle', group: 'system' },
    { v: 'data.exportAuto', label: 'Export data (backup)', needs: 'exportAuto', group: 'system' },
    { v: 'var.set', label: 'Set a value (for conditions)', needs: 'var', group: 'system' },
    { v: 'app.checkUpdate', label: 'Check for BMM update', needs: 'checkUpdate', group: 'system' },
    { v: 'system.clearApiLog', label: 'Clear API log', group: 'system' },
    { v: 'system.clearResourceRecords', label: 'Clear resource monitor records', group: 'system' },
    // ── Logic & math ──
    { v: 'math.set', label: 'Math: compute into a variable', needs: 'mathSet', group: 'logic' },
    { v: 'var.ternary', label: 'Ternary: var = cond ? a : b', needs: 'ternary', group: 'logic' },
    { v: 'rule.table', label: 'Rule table (decision table)', needs: 'ruleTable', group: 'logic' },
    { v: 'task.stop', label: 'Stop the task (guard clause)', needs: 'stopReason', group: 'logic' },
    { v: 'task.run', label: 'Run another scheduled task', needs: 'taskId', group: 'system' },
    { v: 'restart', label: 'Restart BMM', group: 'system' },
    { v: 'open.url', label: 'Open a URL / link', needs: 'url', group: 'system' },
    { v: 'custom.command', label: 'Run custom command', needs: 'command', group: 'system' },
    { v: 'deeplink', label: 'Run bmm:// deeplink', needs: 'url', group: 'system' },
];

function actionEditor(action: Action, onStructureChange?: () => void): HTMLElement {
    const el = document.createElement('div');
    const render = () => {
        const def = ACTION_TYPES.find(a => a.v === action.type) || ACTION_TYPES[0];
        // Build a grouped <optgroup> dropdown that mirrors the script generator's
        // categorised action catalogue.
        const groupsHtml = ACTION_GROUPS.map(grp => {
            const opts = ACTION_TYPES.filter(a => a.group === grp.g);
            if (!opts.length) return '';
            return `<optgroup label="${escAttr(t('sched.grp.' + grp.g) || grp.label)}">${opts.map(a => {
                const ad = t('sched.actd.' + a.v); const desc = ad === ('sched.actd.' + a.v) ? '' : ad;
                return `<option value="${a.v}"${action.type === a.v ? ' selected' : ''} data-icon="${escAttr(GROUP_ICON[a.group] || '')}" data-desc="${escAttr(desc)}">${escHtml(t('sched.act.' + a.v) || a.label)}</option>`;
            }).join('')}</optgroup>`;
        }).join('');
        el.className = 'sched-act-card';
        el.innerHTML = `
            <div class="sched-act-head">
                <span class="sched-act-icon">${GROUP_ICON[def.group] || ''}</span>
                <span class="sched-step-tag sched-do">${t('sched.do') || 'DO'}</span>
                <select class="input sched-act-type">${groupsHtml}</select>
            </div>
            <div class="sched-act-params"></div>`;
        el.querySelector('.sched-act-type')?.addEventListener('change', (e) => {
            _snapshot(); action.type = (e.target as HTMLSelectElement).value; action.params = {};
            // Re-render the whole block (not just this card) so the injected step
            // toolbar / fold controls survive the type switch.
            if (onStructureChange) onStructureChange(); else render();
        });
        const paramsHost = el.querySelector('.sched-act-params') as HTMLElement;
        renderParams(paramsHost, def?.needs, action.params);
        // Hide the params row entirely when an action needs no configuration.
        paramsHost.style.display = paramsHost.innerHTML.trim() ? '' : 'none';
    };
    render();
    return el;
}

function pickerOptions(list: any[], selected: string, labelKey = 'name'): string {
    return `<option value="">— ${t('sched.pick') || 'select'} —</option>` +
        list.map(o => `<option value="${escAttr(o.id)}" ${o.id === selected ? 'selected' : ''}>${escHtml(o[labelKey] || o.title || o.id)}</option>`).join('');
}

// Micro-label shown above the simple single-picker params (profile/mod/…) so the
// row never reads as a lone, context-free dropdown floating in empty space.
const NEEDS_LABEL: Record<string, string> = {
    profile: 'sched.fldProfile', mod: 'sched.fldMod', modpack: 'sched.fldModpack',
    theme: 'sched.fldTheme', app: 'sched.fldApp', message: 'sched.fldMessage', url: 'sched.fldUrl',
    disk: 'sched.fldDisk', pluginId: 'sched.fldPlugin', lpId: 'sched.fldLaunchpack', taskId: 'sched.fldTask',
};
const NEEDS_LABEL_FALLBACK: Record<string, string> = {
    profile: 'Profile', mod: 'Mod', modpack: 'Modpack', theme: 'Theme', app: 'App', message: 'Message', url: 'URL',
    disk: 'Disk', pluginId: 'Plugin', lpId: 'Launch pack', taskId: 'Task',
};
function _field(needs: string, controlHtml: string): string {
    const key = NEEDS_LABEL[needs];
    if (!key) return controlHtml;
    return `<div class="sched-field"><label class="sched-flabel">${t(key) || NEEDS_LABEL_FALLBACK[needs]}</label>${controlHtml}</div>`;
}

function renderParams(host: HTMLElement, needs: string | undefined, params: Record<string, any>): void {
    if (!needs) { host.innerHTML = ''; return; }
    if (needs === 'profile') host.innerHTML = _field(needs, `<select class="input sched-p" style="max-width:200px">${pickerOptions(_profiles, params.id)}</select>`);
    else if (needs === 'mod') host.innerHTML = _field(needs, `<select class="input sched-p" style="max-width:240px">${pickerOptions(_mods, params.id)}</select>`);
    else if (needs === 'modpack') host.innerHTML = _field(needs, `<select class="input sched-p" style="max-width:200px">${pickerOptions(_modpacks, params.id)}</select>`);
    else if (needs === 'theme') host.innerHTML = _field(needs, `<select class="input sched-p" style="max-width:200px">${pickerOptions(_themes, params.id)}</select>`);
    else if (needs === 'app') host.innerHTML = _field(needs, _apps.length
        ? `<select class="input sched-p" style="max-width:220px">${pickerOptions(_apps, params.id)}</select>`
        : `<input class="input sched-p" placeholder="${escAttr(t('sched.appIdPh') || 'app id (install an app first)')}" value="${escAttr(params.id || '')}" style="max-width:220px">`);
    else if (needs === 'message') host.innerHTML = _field(needs, `<input class="input sched-p" placeholder="${escAttr(t('sched.message') || 'message')}" value="${escAttr(params.message || '')}">`);
    else if (needs === 'url') host.innerHTML = _field(needs, `<input class="input sched-p" placeholder="bmm://mod/enable?id=…" value="${escAttr(params.url || '')}">`);
    else if (needs === 'command') host.innerHTML = `
        <div class="sched-cmd-builder">
            <label class="sched-cmd-label">${t('sched.cmdProgram') || '1. Program to run'}</label>
            <div class="sched-cmd-row">
                <input class="input sched-p-prog" placeholder="${escAttr(t('sched.programPh') || 'e.g. notepad.exe')}" value="${escAttr(params.program || '')}">
                <button type="button" class="btn btn-sm btn-secondary sched-browse-prog">${t('sched.choose') || 'Choose…'}</button>
            </div>
            <label class="sched-cmd-label">${t('sched.cmdArgs') || '2. Arguments'} <span class="sched-cmd-opt">${t('common.optional') || '(optional)'}</span></label>
            <input class="input sched-p-args" placeholder="${escAttr(t('sched.argsPh2') || 'e.g.  --profile DCS   (leave empty if none)')}" value="${escAttr(params.args || '')}">
            <details class="sched-cmd-adv">
                <summary>${t('sched.cmdAdvanced') || 'Advanced — working folder'}</summary>
                <div class="sched-cmd-row" style="margin-top:6px">
                    <input class="input sched-p-wd" placeholder="${escAttr(t('sched.workdirPh') || 'folder to run from (optional)')}" value="${escAttr(params.workingDir || '')}">
                    <button type="button" class="btn btn-sm btn-secondary sched-browse-wd">${t('sched.choose') || 'Choose…'}</button>
                </div>
            </details>
            <span class="sched-cmd-hint">${t('sched.cmdHint') || 'Tip: tick “Allow custom commands” at the bottom of this task, or it won’t run.'}</span>
        </div>`;
    else if (needs === 'benchmark') {
        const profOpts = _profiles.filter((p: any) => p.mods_path)
            .map((p: any) => `<option value="${escAttr(p.mods_path)}">${escHtml(p.name || p.id)}</option>`).join('');
        host.innerHTML = `
        <select class="input sched-b-dataset" style="max-width:120px">
            <option value="sandbox"${params.dataset !== 'real' ? ' selected' : ''}>${t('bench.sandbox') || 'Sandbox'}</option>
            <option value="real"${params.dataset === 'real' ? ' selected' : ''}>${t('bench.real') || 'Real'}</option>
        </select>
        <select class="input sched-b-size" style="max-width:100px">
            ${['S', 'M', 'L', 'XL', 'CUSTOM'].map(s => `<option value="${s}"${(params.size || 'M') === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
        <input class="input sched-b-mb" type="number" min="1" placeholder="${escAttr(t('sched.phMb') || 'MB')}" value="${escAttr(params.customMb || '')}" style="max-width:90px;display:${(params.size || 'M') === 'CUSTOM' ? 'inline-block' : 'none'}">
        <div class="sched-b-sources" style="display:${params.dataset === 'real' ? 'block' : 'none'};width:100%;margin-top:8px">
            <div class="sched-b-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>
            <button type="button" class="btn btn-sm sched-b-add-folder">${t('bench.addFolder') || '+ Folder'}</button>
            ${profOpts ? `<select class="input sched-b-add-profile" style="max-width:200px;margin-left:6px"><option value="">${t('bench.addProfile') || '+ Profile…'}</option>${profOpts}</select>` : ''}
        </div>`;
        // Sources picker (real mode): chips fed by a folder browser + profile dropdown.
        if (!Array.isArray(params.sources)) params.sources = params.sources ? [params.sources] : [];
        const chips = host.querySelector('.sched-b-chips') as HTMLElement;
        const renderChips = () => {
            const arr: string[] = params.sources;
            chips.innerHTML = arr.length ? arr.map((p, i) => `<span class="pill" style="display:inline-flex;align-items:center;gap:6px;max-width:100%">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px" data-tooltip="${escAttr(p)}">${escHtml((p.split(/[\\/]/).pop() || p))}</span>
                <button type="button" class="sched-b-rm" data-i="${i}" style="background:none;border:0;color:var(--text-muted);cursor:pointer;display:inline-flex"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </span>`).join('') : `<span style="font-size:11px;color:var(--text-muted)">${t('bench.noProfile') || 'Pick profiles / folders (else sandbox is used)'}</span>`;
            chips.querySelectorAll('.sched-b-rm').forEach(b => b.addEventListener('click', () => { params.sources.splice(Number((b as HTMLElement).dataset.i), 1); renderChips(); }));
        };
        renderChips();
        host.querySelector('.sched-b-add-folder')?.addEventListener('click', async () => {
            const { pickFolder } = await import('../../core/api.js');
            const f = await pickFolder().catch(() => null);
            if (f && !params.sources.includes(f)) { params.sources.push(f); renderChips(); }
        });
        const ap = host.querySelector('.sched-b-add-profile') as HTMLSelectElement | null;
        ap?.addEventListener('change', () => { if (ap.value && !params.sources.includes(ap.value)) { params.sources.push(ap.value); renderChips(); } ap.value = ''; });
    }
    else if (needs === 'toggle') host.innerHTML = `<label style="font-size:12px;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" class="sched-en" ${params.enabled ? 'checked' : ''}> ${t('sched.enableOn') || 'Enable (uncheck = disable)'}</label>`;
    else if (needs === 'flag') host.innerHTML = `<input class="input sched-f-key" placeholder="${escAttr(t('sched.settingKey') || 'setting key (e.g. dcp)')}" value="${escAttr(params.key || '')}" style="max-width:180px"><label style="font-size:12px;margin-left:8px;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" class="sched-en" ${params.enabled ? 'checked' : ''}> on</label>`;
    else if (needs === 'disk') host.innerHTML = _field('disk', `<select class="input sched-disk" style="max-width:240px">${diskOptions(params.mountPoint)}</select>`);
    else if (needs === 'applyLimit') host.innerHTML = `<select class="input sched-disk" style="max-width:200px">${diskOptions(params.mountPoint)}</select><input class="input sched-limit" type="number" min="1" placeholder="${escAttr(t('sched.limitPh') || 'MB/s (empty = suggested)')}" value="${escAttr(params.limitMbS || '')}" style="max-width:200px;margin-left:6px">`;
    else if (needs === 'var') host.innerHTML = `<input class="input sched-v-name" placeholder="${escAttr(t('sched.phName') || 'name')}" value="${escAttr(params.name || '')}" style="max-width:140px"><input class="input sched-v-val" type="number" placeholder="${escAttr(t('sched.phValue') || 'value')}" value="${escAttr(params.value || '')}" style="max-width:120px;margin-left:6px">`;
    // ── Logic & math param editors ────────────────────────────────────────────
    else if (needs === 'mathSet') host.innerHTML = `
        <div class="sched-field"><label class="sched-flabel">${t('sched.mathTarget') || 'Store into variable'}</label>
            <input class="input sched-m-target" placeholder="result" value="${escAttr(params.target || '')}" style="max-width:160px"></div>
        <div class="sched-field" style="flex:1;min-width:240px"><label class="sched-flabel">${t('sched.mathExpr') || 'Expression (uses your variables)'}</label>
            <input class="input sched-m-expr" placeholder="(disk.read_mbps + disk.write_mbps) / 2" value="${escAttr(params.expr || '')}"></div>`;
    else if (needs === 'ternary') {
        if (!params.condition) params.condition = { type: 'always', params: {} };
        host.innerHTML = `
            <div class="sched-field"><label class="sched-flabel">${t('sched.mathTarget') || 'Store into variable'}</label>
                <input class="input sched-tn-target" placeholder="result" value="${escAttr(params.target || '')}" style="max-width:150px"></div>
            <div class="sched-field" style="flex:1;min-width:220px"><label class="sched-flabel">${t('sched.tnCond') || 'If this condition is true…'}</label>
                <div class="sched-cond"></div></div>
            <div class="sched-field"><label class="sched-flabel">${t('sched.tnTrue') || 'then ='}</label>
                <input class="input sched-tn-true" type="number" value="${escAttr(params.ifTrue ?? 1)}" style="max-width:90px"></div>
            <div class="sched-field"><label class="sched-flabel">${t('sched.tnFalse') || 'else ='}</label>
                <input class="input sched-tn-false" type="number" value="${escAttr(params.ifFalse ?? 0)}" style="max-width:90px"></div>`;
        host.querySelector('.sched-cond')?.appendChild(conditionEditor(params.condition));
    }
    else if (needs === 'stopReason') host.innerHTML = `<input class="input sched-stop-reason" placeholder="${escAttr(t('sched.stopReasonPh') || 'reason (optional) — put inside an IF for a guard clause')}" value="${escAttr(params.reason || '')}" style="min-width:300px">`;
    else if (needs === 'ruleTable') {
        if (!Array.isArray(params.rows)) params.rows = [];
        const opSel = (v: string) => ['==', '!=', '>', '<', '>=', '<='].map(o => `<option value="${o}"${v === o ? ' selected' : ''}>${o}</option>`).join('');
        const rowsHtml = params.rows.map((r: any, ri: number) => `
            <div class="sched-rule-row" data-ri="${ri}">
                <span class="sched-rule-when">${t('sched.ruleWhen') || 'when'}</span>
                <select class="input sched-rl-op" style="max-width:64px">${opSel(r.op || '==')}</select>
                <input class="input sched-rl-val" type="number" value="${escAttr(r.value ?? 0)}" style="max-width:90px" placeholder="${escAttr(t('sched.phValue') || 'value')}">
                <span class="sched-rule-then">${t('sched.ruleThen') || '→ set ='}</span>
                <input class="input sched-rl-res" type="number" value="${escAttr(r.result ?? 0)}" style="max-width:90px" placeholder="${escAttr(t('sched.ruleResult') || 'result')}">
                <button type="button" class="btn btn-xs btn-ghost sched-rl-del" style="color:var(--danger)">${SCHED_X}</button>
            </div>`).join('');
        host.innerHTML = `
            <div class="sched-rule-head">
                <div class="sched-field"><label class="sched-flabel">${t('sched.ruleSource') || 'Compare this variable'}</label>
                    <input class="input sched-rl-src" placeholder="my_var" value="${escAttr(params.source || '')}" style="max-width:150px"></div>
                <div class="sched-field"><label class="sched-flabel">${t('sched.ruleTarget') || 'Store the match into'}</label>
                    <input class="input sched-rl-target" placeholder="result" value="${escAttr(params.target || '')}" style="max-width:150px"></div>
            </div>
            <div class="sched-rule-rows">${rowsHtml || `<span style="font-size:11px;color:var(--text-muted)">${t('sched.ruleEmpty') || 'No rules — add one. First matching row wins (top to bottom).'}</span>`}</div>
            <button type="button" class="btn btn-xs sched-chip sched-rl-add">${t('sched.ruleAdd') || '+ Rule'}</button>`;
    }
    // ── New script-generator actions ──────────────────────────────────────────
    else if (needs === 'pathFile') host.innerHTML = `<input class="input sched-path" placeholder="${escAttr(t('sched.filePathPh') || 'file or .exe to open/launch')}" value="${escAttr(params.path || '')}" style="min-width:260px"><button type="button" class="btn btn-sm btn-secondary sched-browse-file" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button>`;
    else if (needs === 'pathFolder') host.innerHTML = `<input class="input sched-path" placeholder="${escAttr(t('sched.folderPathPh') || 'folder to open')}" value="${escAttr(params.path || '')}" style="min-width:260px"><button type="button" class="btn btn-sm btn-secondary sched-browse-folder" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button>`;
    else if (needs === 'pluginId') host.innerHTML = _field(needs, `<input class="input sched-p" placeholder="${escAttr(t('sched.pluginIdPh') || 'plugin id (from plugin.json)')}" value="${escAttr(params.id || '')}" style="max-width:260px">`);
    else if (needs === 'lpId')     host.innerHTML = _field(needs, `<input class="input sched-p" placeholder="${escAttr(t('sched.lpIdPh') || 'launch pack id')}" value="${escAttr(params.id || '')}" style="max-width:260px">`);
    else if (needs === 'taskId')   host.innerHTML = _field(needs, `<input class="input sched-p" placeholder="${escAttr(t('sched.taskIdPh') || 'scheduled task id')}" value="${escAttr(params.id || '')}" style="max-width:260px">`);
    else if (needs === 'repoConnect') host.innerHTML = `<input class="input sched-r-url" placeholder="${escAttr(t('sched.repoUrlPh') || 'repo.json URL')}" value="${escAttr(params.url || '')}" style="min-width:240px"><input class="input sched-r-name" placeholder="${escAttr(t('sched.repoNamePh') || 'name (optional)')}" value="${escAttr(params.name || '')}" style="max-width:180px;margin-left:6px">`;
    else if (needs === 'repoSync') host.innerHTML = `<input class="input sched-r-url" placeholder="${escAttr(t('sched.repoUrlPh') || 'repo.json URL')}" value="${escAttr(params.url || '')}" style="min-width:240px"><input class="input sched-r-prof" placeholder="${escAttr(t('sched.repoProfPh') || 'remote profile id')}" value="${escAttr(params.profile || '')}" style="max-width:180px;margin-left:6px">`;
    else if (needs === 'repoUpdate') host.innerHTML = `<input class="input sched-r-dir" placeholder="${escAttr(t('sched.repoDirPh') || 'repo folder')}" value="${escAttr(params.dir || '')}" style="min-width:240px"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button>`;
    else if (needs === 'repoHost') host.innerHTML = `<input class="input sched-r-dir" placeholder="${escAttr(t('sched.serveDirPh') || 'folder to serve')}" value="${escAttr(params.dir || '')}" style="min-width:220px"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button><input class="input sched-r-port" type="number" min="1" placeholder="port" value="${escAttr(params.port || '')}" style="max-width:100px;margin-left:6px">`;
    else if (needs === 'appInstall') host.innerHTML = `<input class="input sched-a-id" placeholder="${escAttr(t('sched.appIdPh2') || 'app id')}" value="${escAttr(params.id || '')}" style="max-width:140px"><input class="input sched-a-url" placeholder="${escAttr(t('sched.appUrlPh') || 'download URL')}" value="${escAttr(params.url || '')}" style="min-width:220px;margin-left:6px"><input class="input sched-a-title" placeholder="${escAttr(t('sched.appTitlePh') || 'title (optional)')}" value="${escAttr(params.title || '')}" style="max-width:160px;margin-left:6px">`;
    else if (needs === 'mpCreate') host.innerHTML = `
        <div class="sched-field"><label class="sched-flabel">${t('sched.mpNameLbl') || 'Modpack name'}</label>
            <input class="input sched-mp-name" placeholder="${escAttr(t('sched.mpNamePh') || 'e.g. My DCS pack')}" value="${escAttr(params.name || '')}" style="min-width:200px"></div>
        <div class="sched-field"><label class="sched-flabel">${t('sched.mpFromLbl') || 'From profile (its active mods)'}</label>
            <select class="input sched-mp-prof" style="min-width:200px">${pickerOptions(_profiles, params.profile)}</select></div>`;
    else if (needs === 'modAdd') host.innerHTML = `
        <div class="sched-field"><label class="sched-flabel">${t('sched.modUrlLbl') || 'Mod download URL'}</label>
            <input class="input sched-ma-url" placeholder="https://example.com/mod.zip" value="${escAttr(params.url || '')}" style="min-width:240px"></div>
        <div class="sched-field"><label class="sched-flabel">${t('sched.modNameLbl') || 'Display name (optional)'}</label>
            <input class="input sched-ma-name" placeholder="${escAttr(t('sched.modNamePh') || 'MyMod')}" value="${escAttr(params.name || '')}" style="min-width:160px"></div>`;
    else if (needs === 'telemetry') host.innerHTML = `<label class="sched-tg"><input type="checkbox" class="sched-tl-replay" ${params.replay ? 'checked' : ''}> ${t('sched.tlReplay') || 'Replay'}</label><label class="sched-tg"><input type="checkbox" class="sched-tl-full" ${params.full ? 'checked' : ''}> ${t('sched.tlFull') || 'Full (unmasked)'}</label><label class="sched-tg"><input type="checkbox" class="sched-tl-bench" ${params.bench ? 'checked' : ''}> ${t('sched.tlBench') || 'Benchmarks'}</label>`;
    else if (needs === 'recorder') host.innerHTML = `<label class="sched-tg"><input type="checkbox" class="sched-rc-on" ${params.on ? 'checked' : ''}> ${t('sched.rcOn') || 'Record'}</label><label class="sched-tg"><input type="checkbox" class="sched-rc-full" ${params.full ? 'checked' : ''}> ${t('sched.rcFull') || 'Full'}</label><label class="sched-tg"><input type="checkbox" class="sched-rc-rust" ${params.rust ? 'checked' : ''}> ${t('sched.rcRust') || 'Rust log'}</label><label class="sched-tg"><input type="checkbox" class="sched-rc-js" ${params.js ? 'checked' : ''}> ${t('sched.rcJs') || 'JS log'}</label>`;
    else if (needs === 'replayImport') host.innerHTML = `<input class="input sched-ri-path" placeholder="${escAttr(t('sched.replayPathPh') || 'local .bmmreplay path')}" value="${escAttr(params.path || '')}" style="min-width:220px"><input class="input sched-ri-url" placeholder="${escAttr(t('sched.replayUrlPh') || 'or URL')}" value="${escAttr(params.url || '')}" style="max-width:200px;margin-left:6px">`;
    else if (needs === 'exportAuto') host.innerHTML = `<input class="input sched-ea-dir" placeholder="${escAttr(t('sched.backupDirPh') || 'backup folder')}" value="${escAttr(params.dir || '')}" style="min-width:200px"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button><input class="input sched-ea-name" placeholder="bmm-backup-{date}" value="${escAttr(params.name || '')}" style="max-width:180px;margin-left:6px"><select class="input sched-ea-inc" style="max-width:150px;margin-left:6px">${['paren', 'underscore', 'timestamp', 'overwrite'].map(o => `<option value="${o}"${(params.increment || 'paren') === o ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
    else if (needs === 'checkUpdate') host.innerHTML = `<label class="sched-tg"><input type="checkbox" class="sched-en" ${params.enabled ? 'checked' : ''}> ${t('sched.includePrerelease') || 'Include pre-releases'}</label>`;
    else if (needs === 'modpackExport') host.innerHTML = `
        <div class="sched-field"><label class="sched-flabel">${t('sched.mpNameLbl') || 'Modpack'}</label>
            <select class="input sched-p" style="min-width:200px">${pickerOptions(_modpacks, params.id)}</select></div>
        <div class="sched-field" style="flex:1;min-width:220px"><label class="sched-flabel">${t('sched.exportDirLbl') || 'Destination folder (empty = ask each time)'}</label>
            <span style="display:flex;gap:6px"><input class="input sched-ea-dir" placeholder="${escAttr(t('sched.backupDirPh') || 'folder')}" value="${escAttr(params.dir || '')}" style="flex:1"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir">${t('sched.choose') || 'Choose…'}</button></span></div>`;

    const sel = host.querySelector('.sched-p') as HTMLInputElement | HTMLSelectElement;
    if (sel) {
        const set = () => {
            if (needs === 'message') params.message = (sel as HTMLInputElement).value;
            else if (needs === 'url') params.url = (sel as HTMLInputElement).value;
            else params.id = (sel as HTMLInputElement).value;
        };
        sel.addEventListener('change', set);
        sel.addEventListener('input', set);
    }
    host.querySelector('.sched-p-prog')?.addEventListener('input', (e) => { params.program = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-args')?.addEventListener('input', (e) => { params.args = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-wd')?.addEventListener('input', (e) => { params.workingDir = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-browse-prog')?.addEventListener('click', async () => {
        const { pickFile } = await import('../../core/api.js');
        const f = await pickFile({ filters: [{ name: 'Programs', extensions: ['exe', 'bat', 'cmd', 'ps1', 'com'] }, { name: 'All files', extensions: ['*'] }] }).catch(() => null);
        if (f) { params.program = f; (host.querySelector('.sched-p-prog') as HTMLInputElement).value = f; }
    });
    host.querySelector('.sched-browse-wd')?.addEventListener('click', async () => {
        const { pickFolder } = await import('../../core/api.js');
        const d = await pickFolder().catch(() => null);
        if (d) { params.workingDir = d; (host.querySelector('.sched-p-wd') as HTMLInputElement).value = d; }
    });
    // benchmark / storage / var editors
    host.querySelector('.sched-b-dataset')?.addEventListener('change', (e) => {
        params.dataset = (e.target as HTMLSelectElement).value;
        const src = host.querySelector('.sched-b-sources') as HTMLElement | null;
        if (src) src.style.display = params.dataset === 'real' ? 'block' : 'none';
    });
    host.querySelector('.sched-b-size')?.addEventListener('change', (e) => {
        params.size = (e.target as HTMLSelectElement).value;
        const mb = host.querySelector('.sched-b-mb') as HTMLElement | null;
        if (mb) mb.style.display = params.size === 'CUSTOM' ? 'inline-block' : 'none';
    });
    host.querySelector('.sched-b-mb')?.addEventListener('input', (e) => { params.customMb = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-en')?.addEventListener('change', (e) => { params.enabled = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-f-key')?.addEventListener('input', (e) => { params.key = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-disk')?.addEventListener('change', (e) => { params.mountPoint = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-limit')?.addEventListener('input', (e) => { params.limitMbS = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-v-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-v-val')?.addEventListener('input', (e) => { params.value = (e.target as HTMLInputElement).value; });
    // ── Logic & math listeners ──
    host.querySelector('.sched-m-target')?.addEventListener('input', (e) => { params.target = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-m-expr')?.addEventListener('input', (e) => { params.expr = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-tn-target')?.addEventListener('input', (e) => { params.target = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-tn-true')?.addEventListener('input', (e) => { params.ifTrue = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-tn-false')?.addEventListener('input', (e) => { params.ifFalse = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-stop-reason')?.addEventListener('input', (e) => { params.reason = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-rl-src')?.addEventListener('input', (e) => { params.source = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-rl-target')?.addEventListener('input', (e) => { params.target = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-rl-add')?.addEventListener('click', () => { if (!Array.isArray(params.rows)) params.rows = []; params.rows.push({ op: '==', value: 0, result: 0 }); renderParams(host, needs, params); });
    host.querySelectorAll('.sched-rule-row').forEach(rowEl => {
        const ri = Number((rowEl as HTMLElement).dataset.ri);
        rowEl.querySelector('.sched-rl-op')?.addEventListener('change', (e) => { params.rows[ri].op = (e.target as HTMLSelectElement).value; });
        rowEl.querySelector('.sched-rl-val')?.addEventListener('input', (e) => { params.rows[ri].value = (e.target as HTMLInputElement).value; });
        rowEl.querySelector('.sched-rl-res')?.addEventListener('input', (e) => { params.rows[ri].result = (e.target as HTMLInputElement).value; });
        rowEl.querySelector('.sched-rl-del')?.addEventListener('click', () => { params.rows.splice(ri, 1); renderParams(host, needs, params); });
    });
    // ── New action params ──
    host.querySelector('.sched-r-url')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-r-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-r-prof')?.addEventListener('input', (e) => { params.profile = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-r-dir')?.addEventListener('input', (e) => { params.dir = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-r-port')?.addEventListener('input', (e) => { params.port = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-a-id')?.addEventListener('input', (e) => { params.id = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-a-url')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-a-title')?.addEventListener('input', (e) => { params.title = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-mp-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-mp-prof')?.addEventListener('change', (e) => { params.profile = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-ma-url')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-ma-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-tl-replay')?.addEventListener('change', (e) => { params.replay = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-tl-full')?.addEventListener('change', (e) => { params.full = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-tl-bench')?.addEventListener('change', (e) => { params.bench = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-rc-on')?.addEventListener('change', (e) => { params.on = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-rc-full')?.addEventListener('change', (e) => { params.full = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-rc-rust')?.addEventListener('change', (e) => { params.rust = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-rc-js')?.addEventListener('change', (e) => { params.js = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-ri-path')?.addEventListener('input', (e) => { params.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-ri-url')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-ea-dir')?.addEventListener('input', (e) => { params.dir = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-ea-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-ea-inc')?.addEventListener('change', (e) => { params.increment = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-browse-dir')?.addEventListener('click', async () => {
        const { pickFolder } = await import('../../core/api.js');
        const d = await pickFolder().catch(() => null);
        if (d) { params.dir = d; const inp = host.querySelector('.sched-r-dir, .sched-ea-dir') as HTMLInputElement | null; if (inp) inp.value = d; }
    });
    host.querySelector('.sched-path')?.addEventListener('input', (e) => { params.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-browse-file')?.addEventListener('click', async () => {
        const { pickFile } = await import('../../core/api.js');
        const f = await pickFile({ filters: [{ name: 'All files', extensions: ['*'] }] }).catch(() => null);
        if (f) { params.path = f; (host.querySelector('.sched-path') as HTMLInputElement).value = f; }
    });
    host.querySelector('.sched-browse-folder')?.addEventListener('click', async () => {
        const { pickFolder } = await import('../../core/api.js');
        const d = await pickFolder().catch(() => null);
        if (d) { params.path = d; (host.querySelector('.sched-path') as HTMLInputElement).value = d; }
    });
}

function diskOptions(selected: string): string {
    return `<option value="">— ${t('sched.pick') || 'select'} —</option>` +
        _disks.map((d: any) => `<option value="${escAttr(d.mount_point)}"${d.mount_point === selected ? ' selected' : ''}>${escHtml(d.mount_point)}${d.name ? ' · ' + escHtml(d.name) : ''}</option>`).join('');
}

const COND_TYPES = ['always', 'value', 'profileActive', 'modEnabled', 'modDisabled', 'modpackActive', 'modpackInactive', 'allModsActive', 'appRunning', 'appNotRunning', 'fileExists', 'fileHash', 'fileSize', 'fileType', 'fileName', 'fileNewer', 'online', 'timeReached', 'dayOfWeek', 'timeRange', 'commandSucceeds'];
// Values a preceding action can capture (used by the `value` condition).
const VALUE_SOURCES = ['disk.read_mbps', 'disk.write_mbps', 'disk.suggested_limit', 'benchmark.mbps', 'benchmark.total_ms', 'lasttask.ok'];
function conditionEditor(cond: Condition): HTMLElement {
    const el = document.createElement('div');
    const render = () => {
        el.innerHTML = `
            <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);margin-right:6px">
                <input type="checkbox" class="sched-neg" ${cond.negate ? 'checked' : ''}> ${t('sched.not') || 'NOT'}</label>
            <select class="input sched-cond-type" style="max-width:170px">
                ${COND_TYPES.map(c => `<option value="${c}" ${cond.type === c ? 'selected' : ''}>${escHtml(t('sched.cond.' + c) || c)}</option>`).join('')}
            </select>
            <span class="sched-cond-params"></span>`;
        el.querySelector('.sched-neg')?.addEventListener('change', (e) => { cond.negate = (e.target as HTMLInputElement).checked; });
        el.querySelector('.sched-cond-type')?.addEventListener('change', (e) => { _snapshot(); cond.type = (e.target as HTMLSelectElement).value; cond.params = {}; render(); });
        renderCondParams(el.querySelector('.sched-cond-params') as HTMLElement, cond);
    };
    render();
    return el;
}

// File path input + Browse button, shared by every file-verification condition.
function condFileInput(p: Record<string, any>): string {
    return `<input class="input sched-cp-path" placeholder="${escAttr(t('sched.filePath') || 'C:\\path\\to\\file')}" value="${escAttr(p.path || '')}" style="min-width:230px"><button type="button" class="btn btn-sm btn-secondary sched-cp-browse" style="margin:0 6px">${t('sched.choose') || 'Choose…'}</button>`;
}

function renderCondParams(host: HTMLElement, cond: Condition): void {
    const p = cond.params || (cond.params = {});
    if (cond.type === 'profileActive') host.innerHTML = `<select class="input sched-cp" style="max-width:180px">${pickerOptions(_profiles, p.id)}</select>`;
    else if (cond.type === 'modEnabled' || cond.type === 'modDisabled') host.innerHTML = `<select class="input sched-cp" style="max-width:200px">${pickerOptions(_mods, p.id)}</select>`;
    else if (cond.type === 'modpackActive' || cond.type === 'modpackInactive') host.innerHTML = `<select class="input sched-cp" style="max-width:200px">${pickerOptions(_modpacks, p.id)}</select>`;
    else if (cond.type === 'appRunning' || cond.type === 'appNotRunning') host.innerHTML = `<input class="input sched-cp-name" placeholder="${escAttr(t('sched.appName') || 'app exe (e.g. DCS.exe)')}" value="${escAttr(p.name || '')}" style="max-width:200px">`;
    else if (cond.type === 'fileExists') host.innerHTML = `<input class="input sched-cp-path" placeholder="${escAttr(t('sched.filePath') || 'C:\\path\\to\\file')}" value="${escAttr(p.path || '')}" style="min-width:240px">`;
    else if (cond.type === 'timeReached') host.innerHTML = `<input type="time" class="input sched-cp-time" value="${escAttr(p.time || '17:00')}" style="max-width:140px">`;
    else if (cond.type === 'dayOfWeek') {
        const dayNames = (t('sched.dayNames') || 'Sun,Mon,Tue,Wed,Thu,Fri,Sat').split(',');
        if (!Array.isArray(p.days)) p.days = [];
        host.innerHTML = dayNames.map((d, i) => `<button type="button" class="btn btn-xs ${p.days.includes(i) ? 'btn-accent' : 'btn-ghost'}" data-d="${i}">${escHtml(d)}</button>`).join('');
        host.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
            const i = parseInt((b as HTMLElement).dataset.d!); const k = p.days.indexOf(i); if (k >= 0) p.days.splice(k, 1); else p.days.push(i); renderCondParams(host, cond);
        }));
    } else if (cond.type === 'timeRange') {
        host.innerHTML = `<input type="time" class="input sched-cp-from" value="${escAttr(p.from || '08:00')}" style="max-width:120px"> → <input type="time" class="input sched-cp-to" value="${escAttr(p.to || '18:00')}" style="max-width:120px">`;
        host.querySelector('.sched-cp-from')?.addEventListener('input', (e) => { p.from = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-cp-to')?.addEventListener('input', (e) => { p.to = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'commandSucceeds') {
        host.innerHTML = `<input class="input sched-cp-prog" placeholder="${escAttr(t('sched.phProgram') || 'program')}" value="${escAttr(p.program || '')}" style="max-width:160px"> <input class="input sched-cp-args" placeholder="${escAttr(t('sched.phArgs') || 'args')}" value="${escAttr(p.args || '')}" style="max-width:140px">`;
        host.querySelector('.sched-cp-prog')?.addEventListener('input', (e) => { p.program = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-cp-args')?.addEventListener('input', (e) => { p.args = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'value') {
        host.innerHTML = `
            <select class="input sched-cp-src" style="max-width:170px">
                ${VALUE_SOURCES.map(s => `<option value="${s}"${p.source === s ? ' selected' : ''}>${escHtml(s)}</option>`).join('')}
            </select>
            <select class="input sched-cp-op" style="max-width:70px">
                ${['>', '<', '>=', '<=', '==', '!='].map(o => `<option value="${o}"${p.op === o ? ' selected' : ''}>${o}</option>`).join('')}
            </select>
            <input class="input sched-cp-val" type="number" placeholder="${escAttr(t('sched.phValue') || 'value')}" value="${escAttr(p.value ?? '')}" style="max-width:110px">`;
        host.querySelector('.sched-cp-src')?.addEventListener('change', (e) => { p.source = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-op')?.addEventListener('change', (e) => { p.op = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.value = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileHash') {
        host.innerHTML = `${condFileInput(p)}
            <select class="input sched-cp-algo" style="max-width:110px">${['blake3', 'sha256'].map(a => `<option value="${a}"${(p.algo || 'blake3') === a ? ' selected' : ''}>${a}</option>`).join('')}</select>
            <input class="input sched-cp-val" placeholder="${escAttr(t('sched.expectedHash') || 'expected hash')}" value="${escAttr(p.value || '')}" style="min-width:200px">`;
        host.querySelector('.sched-cp-algo')?.addEventListener('change', (e) => { p.algo = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.value = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileSize') {
        host.innerHTML = `${condFileInput(p)}
            <select class="input sched-cp-op" style="max-width:70px">${['>', '<', '>=', '<=', '==', '!='].map(o => `<option value="${o}"${p.op === o ? ' selected' : ''}>${o}</option>`).join('')}</select>
            <input class="input sched-cp-val" type="number" min="0" placeholder="${escAttr(t('sched.sizeBytes') || 'size (bytes)')}" value="${escAttr(p.value ?? '')}" style="max-width:140px">`;
        host.querySelector('.sched-cp-op')?.addEventListener('change', (e) => { p.op = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.value = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileType') {
        host.innerHTML = `${condFileInput(p)}<input class="input sched-cp-ext" placeholder="${escAttr(t('sched.extPh') || 'extension e.g. zip')}" value="${escAttr(p.ext || '')}" style="max-width:120px">`;
        host.querySelector('.sched-cp-ext')?.addEventListener('input', (e) => { p.ext = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileName') {
        host.innerHTML = `${condFileInput(p)}<input class="input sched-cp-val" placeholder="${escAttr(t('sched.nameContains') || 'name contains…')}" value="${escAttr(p.value || '')}" style="max-width:160px">`;
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.value = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileNewer') {
        host.innerHTML = `${condFileInput(p)}<span style="font-size:11px;color:var(--text-muted)">${t('sched.modifiedWithin') || 'modified within last'}</span><input class="input sched-cp-min" type="number" min="1" value="${escAttr(p.minutes || 60)}" style="max-width:90px"> ${t('sched.unitMin') || 'min'}`;
        host.querySelector('.sched-cp-min')?.addEventListener('input', (e) => { p.minutes = (e.target as HTMLInputElement).value; });
    } else host.innerHTML = '';

    const cp = host.querySelector('.sched-cp') as HTMLSelectElement;
    if (cp) cp.addEventListener('change', () => { p.id = cp.value; });
    host.querySelector('.sched-cp-name')?.addEventListener('input', (e) => { p.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-cp-path')?.addEventListener('input', (e) => { p.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-cp-time')?.addEventListener('input', (e) => { p.time = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-cp-browse')?.addEventListener('click', async () => {
        const { pickFile } = await import('../../core/api.js');
        const f = await pickFile({ filters: [{ name: 'All files', extensions: ['*'] }] }).catch(() => null);
        if (f) { p.path = f; const inp = host.querySelector('.sched-cp-path') as HTMLInputElement | null; if (inp) inp.value = f; }
    });
}

// ── Share / import via .BMMPA (BMM Planification & Automation) ─────────────────
// A .BMMPA file is just a small JSON envelope holding the task list — easy to
// share. We reuse the gated write_text_file / read_file_text commands.
const BMMPA_MAGIC = 'BMMPA';

export async function exportTasksFile(): Promise<void> {
    if (!_tasks.length) { toast(t('sched.noTasks') || 'No tasks to export', 'info'); return; }
    const { saveFile } = await import('../../core/api.js');
    const path = await saveFile({ defaultPath: 'automations.bmmpa', filters: [{ name: 'BMM Automation', extensions: ['bmmpa'] }] }).catch(() => null);
    if (!path) return;
    const payload = JSON.stringify({ magic: BMMPA_MAGIC, version: 1, exported: new Date().toISOString(), tasks: _tasks }, null, 2);
    try {
        await invoke('write_text_file', { path, content: payload });
        toast(t('sched.exported') || 'Automations exported', 'success');
    } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
}

export async function importTasksFile(): Promise<void> {
    const { pickFile } = await import('../../core/api.js');
    const path = await pickFile({ filters: [{ name: 'BMM Automation', extensions: ['bmmpa', 'json'] }] }).catch(() => null);
    if (!path) return;
    try {
        const raw: string = await invoke('read_file_text', { path });
        const doc = JSON.parse(raw);
        const arr: any[] = Array.isArray(doc) ? doc : (doc.magic === BMMPA_MAGIC ? doc.tasks : doc.tasks);
        if (!Array.isArray(arr)) throw new Error('Not a valid .bmmpa file');
        let added = 0;
        for (const tk of arr) {
            if (tk && tk.name) {
                tk.id = `sched-${Date.now()}-${added}`;
                tk.osSchedule = false; // don't auto-register OS tasks on import
                _tasks.push(tk); added++;
            }
        }
        await saveTasks(); renderScheduleList();
        toast(`${added} ${t('sched.imported') || 'automation(s) imported'}`, 'success');
    } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
}
