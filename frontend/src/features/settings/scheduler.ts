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

import { sourceAccessHtml, wireSourceAccess } from '../../core/source-access.js';
import { copyIdButtons, wireCopyIds } from '../../core/copy-id.js';
import { invoke, pickFiles } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
import { calendarDue, nextCalendarDue } from './sched-time.js';
import { substituteVars, VAR_NAME_RE, BLOCK_NAME_RE, parseList, readNum, readVar, renderVar, type RunCtx } from './sched-vars.js';
import { parseHeaderLines, readJsonPath, statusIsFailure } from './http-action.js';
import { inspectBmmpa } from './bmmpa-inspect.js';
import { BMMS_INDEX, type BmmsEntry } from '../../docs/bmms-reference.gen.js';
import { outlineOf, offsetOfLine, renderOutline, explain, wordAtPoint, type OutlineRow } from './bmms-editor-aids.js';
import { BMM_EVENTS, fireEvent, noteTaskRunning } from '../../core/bmm-events.js';
import { treeOf, foldersOf, renderTree } from './block-tree.js';
import { showConfirm } from '../../ui/confirm.js';
import { reasonNotRunning } from './sched-why.js';
import { planOf, previewAgainst } from './sched-preview.js';
import { debugging, gate, startDebug, endDebug, failDebug, DebugStopped } from './sched-debug.js';
import { parsePresetFeed, looksLikePresetFeed, readPresetCatalogs, writePresetCatalogs } from './preset-catalog.js';
import { mountCompletions } from './bmms-complete.js';
import { attachHighlight } from '../../ui/code-editor.js';
import { registerBmmsLanguage } from './bmms-prism.js';
import { raiseAboveAll } from '../../ui/layer.js';
import { safeFileStem, presetRow } from './task-catalog.js';
import type { EntryChoice } from '../../core/catalog-publish.js';
import {
    originLabel, originOf, forgetOrigin, isDisabled, setDisabled, recordHistory,
    hasSource, looksLikeIndex, catalogLooksLike, importIndexForType,
} from '../catalogs/catalog-index.js';
import { writeSources } from '../catalogs/catalog-sources.js';
import { getLinks } from '../../core/links-config.js';
import { askConfirm } from '../../core/api.js';
import { fetchSourceText } from '../../core/source-fetch.js';

/**
 * A 16px line icon, drawn the way every other icon in this panel is drawn: one stroked
 * path inheriting `currentColor`, so it takes the theme's text colour and stays legible
 * on a light background. Emoji do not — they carry their own colours, they render as a
 * different typeface on every OS, and several of them are simply a coloured square in the
 * webview. The preset chips were the last place in the scheduler still using them.
 */
const SVG16 = (d: string): string =>
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

// ── Types ───────────────────────────────────────────────────────────────────
type Trigger =
    | { type: 'once'; at: string }                                  // ISO local datetime
    | { type: 'interval'; everyMinutes: number }                    // every N minutes
    | { type: 'hourly'; everyHours: number }                        // every N hours
    | { type: 'dailyAt'; time: string }                             // "HH:MM"
    | { type: 'weeklyAt'; time: string; days: number[] }            // 0=Sun..6=Sat
    | { type: 'monthlyAt'; day: number; time: string }              // day-of-month 1..31
    | { type: 'appStart' }                                          // once per app launch
    // Fires when a FILE changes — the only way one process learns that another did
    // something. A game does not announce anything; it writes. This is what turns "DCS
    // just joined a server" into something an automation can hang off, and it is not
    // DCS-specific: point it at any log, any save, any file a program touches.
    | { type: 'watchFile'; path: string }
    /**
     * Fires when BMM itself does something.
     *
     * The other triggers all watch the OUTSIDE: a clock, a file somebody else wrote. This one
     * watches BMM — a mod that turned out to be missing while a modpack was being applied, a
     * sync that failed, an error somebody saw.
     *
     * Those moments were previously observable only by the person sitting there. A task that
     * repairs a broken install is useless if it can only find out on a timer, because by then
     * the person has already given up and fixed it by hand.
     *
     * Built on the same hook ring as `wait.hook` and `bmm://hook`: BMM rings a hook named
     * `bmm.<something>`, and this polls it. One mechanism, so an event and a webhook are the
     * same kind of thing and everything that works for one works for the other.
     */
    | { type: 'onEvent'; event: string }
    | { type: 'manual' };                                           // only via Run button / deeplink

interface Action { type: string; params: Record<string, any>; }


/** The three things a task can do that reach OUTSIDE its own automation.
 *  Everything else a step can do is a BMM action the user could perform by hand;
 *  these three are not, so each is granted on its own rather than bundled behind
 *  one "allow unsafe" box that says nothing about what it unlocks. */
interface TaskPerms {
    /** Spawn an external program with arguments. */
    command?: boolean;
    /** Run a user-authored script through PowerShell / CMD / Bash / Python. */
    script?: boolean;
    /** Fire a bmm:// deeplink. This was ungated: a deeplink can reach anything the
     *  app exposes, including actions that have no step of their own, so it was the
     *  widest capability in the scheduler and the only one nobody had to ask for. */
    deeplink?: boolean;
    /** Terminate a process. Separate from `command` because the risk is different in
     *  kind: launching a program is something the user could undo, while killing one
     *  can lose unsaved work with no warning and nothing to undo. Defaults off for
     *  every existing task — the capability did not exist when their consent was
     *  given, which is the same reason `script` is not inherited either. */
    stopProcess?: boolean;
}

/** A task's effective permissions. An old task has no `perms`, only the single
 *  allowCustomCommands flag — that flag meant "may run external programs", so it
 *  maps to `command`, and to `deeplink` because deeplinks used to need nothing at
 *  all and revoking them on upgrade would break working automations. It does NOT
 *  map to `script`: that capability did not exist when consent was given, and
 *  granting it retroactively would be inventing consent. */
function taskPerms(task: Task): TaskPerms {
    if (task.perms) return task.perms;
    return { command: !!task.allowCustomCommands, deeplink: true, script: false };
}

function requirePerm(task: Task, key: keyof TaskPerms, label: string): void {
    if (!taskPerms(task)[key]) {
        throw new Error((t('sched.permDenied') || 'This task is not permitted to {what}. Grant it in the task’s permissions.').replace('{what}', label));
    }
}
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
    | { kind: 'forEach'; source: 'mods' | 'enabledMods' | 'disabledMods' | 'profiles' | 'modpacks' | 'themes' | 'list' | 'mapKeys'; listName?: string; maxIters: number; everySec: number; steps: Step[] }
    // Switch: evaluate cases in order, run the FIRST whose condition holds, else default.
    | { kind: 'switch'; cases: { condition: Condition; steps: Step[] }[]; default: Step[] }
    // Try/catch: run `steps`; if anything in them fails, run `onError` INSTEAD of
    // aborting the whole task. Without it, one unreachable path or one missing file
    // killed an eight-step automation on step two.
    | { kind: 'try'; steps: Step[]; onError: Step[] }
    /**
     * Make this true, and only do the work when it is not.
     *
     * For a task whose job is a STATE rather than a script: it fires on its schedule, finds
     * everything already as it should be, and does nothing. When something drifts, it fixes
     * it — and then CHECKS. That last part is why this is not `if not <condition>`: an `if`
     * runs its block and never looks back, so a fix that failed looks exactly like one that
     * worked, and a task running hourly is the worst place for that to be invisible.
     */
    | { kind: 'ensure'; condition: Condition; steps: Step[]; onFail?: 'abort' | 'continue' }
    /**
     * Run it again when it fails.
     *
     * People were building this out of two tasks that call each other — which is why the
     * export walker carries a `seen` set. That works, and it costs two tasks, a shared counter
     * and a reader who has to hold both in their head to see one loop.
     *
     * The case is a repo that is briefly unreachable, or a file another program still has
     * open: not an error to handle, an attempt to make again.
     */
    | { kind: 'retry'; times: number; everySec: number; steps: Step[]; onFail?: 'abort' | 'continue' }
    // Run every branch AT THE SAME TIME and carry on when all have settled. For the case a
    // sequence gets wrong: three independent downloads, or a sync and a benchmark that have
    // nothing to say to each other, where doing them in order only costs time.
    //
    // `mode` is what happens when one branch throws. 'all' aborts the step (the default,
    // and what a sequence would have done); 'settle' lets the others finish and reports the
    // failures afterwards — the honest choice for "do these five, tell me which failed".
    | { kind: 'parallel'; mode?: 'all' | 'settle'; branches: Step[][] }
    // Loop signals, and a clean end for the whole task. These are what make forEach
    // usable in practice: "for each mod, try to verify; on error notify and continue".
    // Run a named block of steps defined once and shared by every task. It carries no `steps`
    // of its own — the body lives in the block store — which is why the tree walkers do not
    // need a case for it: there is nothing inline to walk.
    | { kind: 'call'; block: string }
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
    /** Legacy single opt-in. Kept as the MIGRATION SOURCE, never as the gate:
     *  tasks saved before permissions were split still carry only this, and
     *  dropping it would silently revoke what the user had already granted. */
    allowCustomCommands: boolean;
    /** What this task is permitted to do beyond changing BMM's own state.
     *  Absent on an old task — taskPerms() derives it from allowCustomCommands. */
    perms?: TaskPerms;
    osSchedule?: boolean;   // also register a Windows Scheduled Task (runs when BMM is closed)
    /**
     * Where this task writes when it is given a RELATIVE path.
     *
     * Empty means `appdata:TaskOutput/<task id>`, which is the answer for almost everybody:
     * somewhere that exists, is per-task, and is not the game folder. An absolute path or a
     * place name (`mods:`, `plugin:x/bundle`) is honoured as written.
     *
     * The point is that `do file.write(path: "run.log", …)` has an obvious meaning and cannot
     * land somewhere surprising. A task writing to a bare filename with no rule about where
     * would write next to the executable, which is both wrong and hard to find.
     */
    outputDir?: string;
    /** When the task started existing. It is the CATCH-UP BASELINE: without it, a daily
     *  task created at 22:00 would consider today's 21:00 window missed and fire the
     *  moment you saved it. Backfilled on load for tasks written before this existed. */
    createdAt?: number;
    /** Run a calendar window that elapsed while BMM was closed, at the next launch.
     *  Default ON — a daily backup that silently does nothing because the app was shut
     *  at 03:00 is worse than one that runs late. At most ONE run is owed, however long
     *  BMM was away. */
    catchUp?: boolean;
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
        else if (st.kind === 'ensure') { st.steps = normalizeSteps(st.steps); }
        else if (st.kind === 'retry') { st.steps = normalizeSteps(st.steps); }
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
        let backfilled = false;
        for (const t of _tasks) {
            t.steps = normalizeSteps(t.steps);
            // Backfill the catch-up baseline for tasks written before it existed. Its
            // last run is the honest answer; a task that has never run gets "now", so
            // adopting catch-up can never make an old task fire for a window that
            // elapsed before the feature was there.
            if (!t.createdAt) { t.createdAt = t.lastRun || Date.now(); backfilled = true; }
        }
        if (backfilled) await saveTasks();
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

// One delegated listener for every Files… menu entry, registered ONCE for the module.
//
// It has to be delegated at all because showGlobalDropdown CLONES the menu into the portal
// and cloneNode(true) does not copy event listeners — a handler bound to an entry would be
// lost on the copy the user actually clicks. The data attribute survives the clone; a
// listener does not.
//
// It has to be registered once because renderScheduleList() runs again on every language
// change and every task add/delete. Registering inside that loop stacked one listener PER
// TASK PER RENDER, none of them ever removed, each holding its own copy of the action map —
// so a single click eventually ran the same action many times over.
const _schedActions = new Map<string, () => void>();
let _schedDelegated = false;
function _wireSchedMenuDelegation(): void {
    if (_schedDelegated) return;
    _schedDelegated = true;
    document.addEventListener('click', (ev: any) => {
        const hit = ev.target?.closest?.('[data-sched-act]');
        if (!hit) return;
        const fn = _schedActions.get(hit.dataset.schedAct);
        if (!fn) return;
        (window as any).closeGlobalDropdown?.(true);
        fn();
    });
}

export async function initScheduler(): Promise<void> {
    await loadTasks();
    renderScheduleList();

    // The API can arm and disarm a task, and the file it writes is not what the running
    // scheduler is using — that was loaded at startup. Without this the change sits on disk
    // while a task that shows as disabled keeps firing, which is a lie with consequences.
    if (!(window as any).__bmmSchedWatch) {
        (window as any).__bmmSchedWatch = true;
        const { listen } = await import('../../core/api.js');
        void listen('bmm://schedules-changed', () => {
            void loadTasks().then(() => renderScheduleList());
        });
    }
    // Tasks registered with Windows BEFORE the OS-schedule key existed carry a command line
    // with no `k=`, so the deep link would stop and ask — at the hour the task fires, with
    // nobody there. That is the exact failure the key was added to prevent, arriving to the
    // people who already had the feature working.
    //
    // Re-registered once. Guarded by a flag rather than done every launch, because each one
    // spawns PowerShell and a machine with a dozen tasks would pay for it at every start.
    if (localStorage.getItem('bmm_os_sched_keyed') !== '1') {
        const stale = _tasks.filter((t) => t.osSchedule && t.enabled);
        for (const task of stale) await syncOsSchedule(task);
        localStorage.setItem('bmm_os_sched_keyed', '1');
        if (stale.length) console.log(`[SCHED] re-registered ${stale.length} OS task(s) with the schedule key`);
    }

    const btn = document.getElementById('btn-create-schedule');
    if (btn && !btn.dataset.wired) {
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => openTaskModal(null));
        // Add Export / Import .BMMPA buttons next to "New task".
        const row = btn.parentElement;
        if (row && !document.getElementById('sched-export-btn')) {
            // ONE button, and a menu behind it.
            //
            // There were four of these in a row beside "New task" — Export, Import, Inspect,
            // Load example — and three of them are things somebody does once. Four buttons of
            // equal weight say four equally likely things, and the row pushed the one that
            // matters off to the left.
            //
            // The menu is built from a list rather than four near-identical blocks, so adding
            // a fifth entry cannot come with a fifth copy of the wiring.
            const ITEMS: Array<[string, string, string, () => void]> = [
                ['sched-export-btn', t('sched.exportBmmpa') || 'Export .BMMPA', '', () => exportTasksFile()],
                ['sched-import-btn', t('sched.importBmmpa') || 'Import .BMMPA', '', () => importTasksFile()],
                // Deliberately next to Import: the moment somebody is about to import a file
                // they were sent is the moment this is useful, and one they find afterwards is
                // one they find too late.
                ['sched-inspect-btn', t('sched.inspectBmmpa') || 'Inspect a .BMMPA',
                    t('sched.inspectBmmpa.d') || 'See what a shared automation would do — permissions, scripts and everything it touches — without importing it.',
                    () => inspectTasksFile()],
                ['sched-example-btn', t('sched.loadExample') || 'Load example',
                    t('sched.loadExample.d') || 'Create a ready-made simple-loop automation you can inspect and enable.',
                    () => createExampleAutomation()],
                // Following and publishing live behind the same button as the rest of the
                // file work, because that is what they are — and until now the only way to
                // reach either was a button inside a panel you had to already know about.
                ['sched-catalog-btn', t('sched.pc.open'), t('sched.pc.open.d'),
                    () => { void browsePresetCatalogs(); }],
                ['sched-publish-btn', t('sched.tcb.open'), t('sched.tcb.tip'),
                    () => { void openTaskCatalogBuilder(); }],
            ];

            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:relative;display:inline-block';
            const more = document.createElement('button');
            more.id = 'sched-more-btn';
            more.className = 'btn btn-ghost btn-sm';
            more.style.gap = '6px';
            more.textContent = t('sched.more') || 'Files…';
            // Built to the portal's contract, which is not obvious and which the first
            // version of this got wrong twice:
            //
            //   1. showGlobalDropdown CLONES the node. An inline `display:none` rides along
            //      on the clone, and no class can override an inline style — so the menu was
            //      moved to the portal, positioned, and stayed invisible. The button appeared
            //      to do nothing at all.
            //   2. cloneNode(true) does NOT copy event listeners. Per-item addEventListener
            //      calls are lost, so even once visible every entry would have been inert.
            //
            // So: the template is never inserted in the page (nothing to hide), and the
            // entries carry a data attribute that one delegated listener dispatches on.
            const menu = document.createElement('div');
            // is-template: hidden where it sits, visible on the CLONE the portal makes
            // (which gains .open). A CLASS, not an inline style — an inline display:none
            // travels with the clone and nothing can override it, which is exactly how this
            // menu came to open into an invisible node.
            menu.className = 'bmm-tag-menu is-template';
            menu.style.minWidth = '210px';
            for (const [id, label, hint, run] of ITEMS) {
                const b = document.createElement('button');
                b.type = 'button';
                b.id = id;                       // kept: the command palette and the tutorial address these
                b.className = 'bmm-tag-menu-row';
                b.dataset.schedAct = id;         // survives cloneNode; a listener does not
                b.textContent = label;
                if (hint) b.title = hint;
                menu.appendChild(b);
                _schedActions.set(id, run);
            }
            // Handed to the global dropdown portal rather than shown in place.
            //
            // A menu positioned inside this card is clipped by it: the settings sections
            // establish their own painting context, so the last entries were cut off at the
            // section's bottom edge and the one below it painted over them. The portal moves
            // the menu to a fixed container on <body> (z-index 999999) and positions it under
            // the button, which is what every other menu in the app already does.
            _wireSchedMenuDelegation();
            more.addEventListener('click', (e) => {
                e.stopPropagation();
                // The portal owns opening, closing, click-outside and viewport clamping. It is
                // defined in modals.ts, which loads at boot, so there is no meaningful case
                // where it is absent — and the previous "fallback" hid a real failure behind a
                // path that could not work either.
                (window as any).showGlobalDropdown?.(more, menu);
            });
            wrap.appendChild(more);
            // Kept IN the document, hidden by .is-template. It has to be reachable by id:
            // the tutorial spotlights sched-example-btn, and getElementById does not see a
            // detached node.
            wrap.appendChild(menu);
            row.appendChild(wrap);
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
// Kept across re-renders but NOT persisted: a filter is about the next few seconds, and one
// that survived a restart would hide tasks from somebody who had forgotten they set it.
let _taskFilter = '';

function startEngine(): void {
    if (_timer !== null) return;
    // Fire appStart tasks once shortly after launch.
    setTimeout(() => tick().catch(() => {}), 4000);
    _timer = window.setInterval(() => { tick().catch(() => {}); }, 20000);
    // Keep the "in 4 min" chips honest. Only while the list is actually on screen —
    // `offsetParent` is null for a hidden section, so a user who never opens the
    // scheduler pays nothing for a countdown nobody is reading.
    window.setInterval(() => {
        const c = document.getElementById('scheduler-list-container');
        if (c && c.offsetParent !== null) renderScheduleList();
    }, 30000);
}

function nextLocalMidnightOffset(time: string): { h: number; m: number } {
    const [h, m] = time.split(':').map(n => parseInt(n, 10) || 0);
    return { h, m };
}

// ── When a calendar trigger fires ─────────────────────────────────────────────
//
// The arithmetic lives in ./sched-time.ts, which imports nothing and is unit-tested.
// This file cannot be: it talks to Tauri, the DOM and i18n from its first line, which
// is precisely why a timing bug could sit here unnoticed for as long as it did.

/** When this task next runs, as epoch ms — or null if nothing is scheduled (manual,
 *  a spent `once`, a disabled task). Shown in the list; not used for firing. */
export function nextDue(task: Task, from: Date = new Date()): number | null {
    if (!task.enabled) return null;
    const tr = task.trigger;
    const last = task.lastRun || 0;
    const nowMs = from.getTime();
    switch (tr.type) {
        case 'manual': return null;
        case 'appStart': return _appStartFired.has(task.id) ? null : nowMs;
        case 'once': {
            if (_onceFired.has(task.id) || task.lastRun) return null;
            const at = new Date(tr.at).getTime();
            return isNaN(at) ? null : at;
        }
        case 'interval': return (last || nowMs) + Math.max(1, tr.everyMinutes) * 60000;
        case 'hourly': return (last || nowMs) + Math.max(1, tr.everyHours) * 3600000;
        case 'dailyAt':
        case 'weeklyAt':
        case 'monthlyAt':
            return nextCalendarDue(tr, from);
    }
    return null;
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
        case 'monthlyAt':
        case 'dailyAt':
        case 'weeklyAt':
            // The baseline is whichever is later: the last run, or the moment the task
            // was created. Without the creation half, saving a daily 21:00 task at 22:00
            // would count today's window as missed and fire the instant you pressed Save.
            return calendarDue(tr, now, Math.max(last, task.createdAt || 0), task.catchUp !== false);
    }
    return false;
}

/**
 * Why this task has not run, in a sentence.
 *
 * The deciding is in sched-why.ts, which knows nothing about the app and can therefore be
 * tested. This half supplies the four sets the running scheduler keeps and the next due time,
 * because those are the parts that only exist here.
 */
export function whyNotRunning(task: Task, now: Date = new Date()): { key: string; v?: string } {
    return reasonNotRunning(
        task as any,
        { watch: _watchSeen as any, event: _eventSeen as any, appStart: _appStartFired, once: _onceFired },
        task.enabled && task.trigger.type !== 'manual' ? nextDue(task, now) : null,
    );
}

/**
 * The last stamp seen for each watched file, per task.
 *
 * In memory, not on the task. Persisting it would mean a change made while BMM was closed
 * fires on the next start — which for "you joined a server" means acting on a session that
 * ended hours ago. The first poll after a start therefore RECORDS and does not fire, which
 * is also what stops every watch task running once at every launch.
 */
const _watchSeen = new Map<string, string>();

async function watchFired(task: Task): Promise<boolean> {
    const tr = task.trigger as { type: 'watchFile'; path: string };
    const path = String(tr.path || '').trim();
    if (!path) return false;
    const stamp = String(await invoke('file_stamp', { path }).catch(() => ''));
    // No file is not a change. A game that has never run has no log, and firing on its
    // appearance later is right — firing on its absence now is not.
    if (!stamp) { _watchSeen.set(task.id, ''); return false; }
    const seen = _watchSeen.get(task.id);
    _watchSeen.set(task.id, stamp);
    if (seen === undefined) return false;   // first sighting: learn it, do not act on it
    return seen !== stamp;
}

/**
 * The last event each task has already acted on.
 *
 * Per task rather than per event name: two tasks watching `bmm.mod.missing` must both see it,
 * and a shared marker would give it to whichever polled first.
 *
 * Seeded on the first poll, like the file watch: a task enabled at 10:00 should not run for
 * everything that happened at 09:00, which is what somebody arming a task means by arming it.
 */
const _eventSeen = new Map<string, number>();

/** The event data of the hit that fired the current run, handed to the task as variables. */
const _eventData = new Map<string, Record<string, unknown>>();

async function eventFired(task: Task): Promise<boolean> {
    const tr = task.trigger as { type: 'onEvent'; event: string };
    const name = String(tr.event || '').trim();
    if (!name) return false;
    const since = _eventSeen.get(task.id);
    const now = Date.now();
    if (since === undefined) { _eventSeen.set(task.id, now); return false; }
    const hits = await (invoke('hook_poll', { name, since: since + 1 }) as Promise<any[]>).catch(() => []);
    if (!hits.length) return false;
    // The LAST one. A burst of five missing mods in one modpack should run the repair task
    // once with the most recent, not five times racing each other over the same folder.
    const last = hits[hits.length - 1];
    _eventSeen.set(task.id, Number(last?.at) || now);
    _eventData.set(task.id, (last && typeof last.data === 'object' && last.data) || {});
    return true;
}

async function tick(): Promise<void> {
    const now = new Date();
    for (const task of _tasks) {
        if (!task.enabled) continue;
        if (task.trigger.type === 'watchFile') {
            if (!(await watchFired(task))) continue;
        } else if (task.trigger.type === 'onEvent') {
            if (!(await eventFired(task))) continue;
        } else if (!isDue(task, now)) continue;
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
/**
 * Run a task object that is NOT in the store — a `.bmmscript` somebody opened.
 *
 * It gets a temporary id so the running panel can show and cancel it, and `osSchedule` is
 * forced off: a file that is being run once must not register a Windows scheduled task on
 * the way past.
 */
export async function runTaskOnce(task: Partial<Task>): Promise<void> {
    const one = {
        ...task,
        id: `bmms-${Date.now()}`,
        enabled: true,
        osSchedule: false,
        steps: Array.isArray(task.steps) ? task.steps : [],
    } as Task;
    await runTask(one);
}

/** Add a task object to the store — the same path importTasksFile uses for one task. */
/**
 * A task arriving from a FILE, made safe to sit in the list.
 *
 * A `.bmmpa` is somebody else's automation, and it carries its own `enabled`, its own
 * `perms` and its own trigger. Importing one used to keep all three: only `osSchedule` was
 * cleared. So a shared file could arrive enabled, granted `command` and `script`, on a
 * one-minute interval — and start running programs a minute later with nothing asked and
 * nothing shown.
 *
 * That is the exact thing the `.bmmscript` review screen exists to prevent, and the .bmmpa
 * path went around it. It matters more since automations can be published as a CATALOGUE:
 * these files are meant to travel between strangers now.
 *
 * The duplicate button already reasoned this way about a copy of your OWN task — "created
 * DISABLED so saving the copy can't double-fire anything". A file from a stranger deserves at
 * least that.
 *
 * Three things are taken away, and the person is told which:
 *   · **enabled** — nothing from a file runs before somebody looks at it;
 *   · **perms / allowCustomCommands** — the four capabilities that reach OUTSIDE BMM are
 *     granted by the person who will live with them, never by the file's author;
 *   · **osSchedule** — registering a Windows scheduled task is not a file's decision.
 *
 * Everything else is kept, so the automation is intact and one toggle away from working.
 * Returns what it removed, so the toast can say so rather than leaving somebody wondering
 * why the imported task does nothing.
 */
export function sanitiseImportedTask(task: any): { task: any; strippedPerms: string[]; wasEnabled: boolean } {
    const RISKY = ['command', 'script', 'deeplink', 'stopProcess'] as const;
    const asked: string[] = [];
    for (const k of RISKY) if (task?.perms?.[k] === true) asked.push(k);
    // The legacy single flag means command + deeplink; a file written by an older BMM carries
    // only that, and reading `perms` alone would report it as asking for nothing.
    if (task?.allowCustomCommands === true) for (const k of ['command', 'deeplink']) if (!asked.includes(k)) asked.push(k);

    const wasEnabled = task?.enabled === true;
    return {
        task: {
            ...task,
            enabled: false,
            osSchedule: false,
            allowCustomCommands: false,
            perms: { command: false, script: false, deeplink: false, stopProcess: false },
        },
        strippedPerms: asked,
        wasEnabled,
    };
}

export async function importTaskObject(task: Partial<Task>): Promise<string> {
    const { task: safe, strippedPerms } = sanitiseImportedTask(task);
    safe.id = newTaskId();
    _tasks.push(safe as Task);
    await saveTasks();
    renderScheduleList();
    if (strippedPerms.length) {
        toast((t('sched.importStripped') || 'Imported disabled. It asked for: {p} — grant what you want in its permissions.')
            .replace('{p}', strippedPerms.join(', ')), 'warning', 8000);
    }
    return safe.id;
}

/**
 * An id no other task has.
 *
 * `sched-${Date.now()}` alone is a millisecond stamp, and importing a file with three tasks in
 * it does all three inside the same millisecond — so they came out sharing an id. Everything
 * that finds a task by id then finds the FIRST one: running the second runs the first, deleting
 * the third deletes the first, and nothing anywhere says why.
 *
 * Found while making a plugin able to ship several automations, which is the case that turns a
 * rare collision into the ordinary one.
 */
function newTaskId(): string {
    let id = `sched-${Date.now()}`;
    if (!_tasks.some((t) => t.id === id)) return id;
    // A suffix rather than a wait: sleeping a millisecond to make a timestamp unique is a
    // clock dependency in the middle of an import.
    for (let n = 2; ; n++) {
        id = `sched-${Date.now()}-${n}`;
        if (!_tasks.some((t) => t.id === id)) return id;
    }
}

/** One saved task, by id, for a caller that has to SHOW what it is about to do. */
export async function findTask(id: string): Promise<Task | null> {
    if (!_tasks.length) await loadTasks();
    return _tasks.find((t) => t.id === id) || null;
}

/** Arm or disarm one task. Returns false when there is no task with that id. */
export async function setTaskEnabled(id: string, on: boolean): Promise<boolean> {
    if (!_tasks.length) await loadTasks();
    const task = _tasks.find((t) => t.id === id);
    if (!task) return false;
    task.enabled = on;
    await saveTasks();
    // The OS mirror follows, or a disabled task keeps firing from the Windows scheduler,
    // which is the worst version of this: the app says off and the machine says on.
    await syncOsSchedule(task);
    renderScheduleList();
    return true;
}

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
    noteTaskRunning(1);
    // Registered BEFORE the first step, so a task that fails immediately still appears in
    // the panel long enough to be seen, and a task started twice is visible as such.
    _running.set(task.id, {
        id: task.id, name: task.name, startedAt: t0,
        step: t('sched.run.starting') || 'starting…', depth: 0,
        done: 0, total: (task.steps || []).filter((s) => !s.disabled).length, cancel: false,
    });
    renderRunningPanel();
    ensureRunTicker();
    try {
        // Per-run variable store: actions (e.g. a benchmark) write measured values
        // here, and `value` conditions read them → "if disk speed > X then Apply".
        //
        // Seeded with the shared variables, read at the START of the run and not again.
        // A snapshot rather than a live view on purpose: a task that read a value another
        // task rewrote halfway through would behave differently depending on scheduling,
        // which is the least debuggable kind of difference. A var.set inside THIS run
        // updates the snapshot as well as the store, so a later step sees its own write.
        const ctx: RunCtx = { nums: {}, text: {}, shared: readSharedVars() };
        // What the event carried, as `{event.<key>}`.
        //
        // Prefixed rather than merged: an event describing a mod as `id` must not quietly
        // become whatever the task's own `id` variable means two steps later. The whole value
        // of an event trigger is knowing WHICH mod, so it has to arrive under a name that
        // cannot be shadowed by accident.
        const evd = _eventData.get(task.id);
        if (evd) {
            for (const [k, v] of Object.entries(evd)) {
                if (v === null || typeof v === 'object') continue;
                ctx.text[`event.${k}`] = String(v);
                if (typeof v === 'number') ctx.nums[`event.${k}`] = v;
            }
            _eventData.delete(task.id);
        }
        await runSteps(task.steps, task, ctx);
        task.lastResult = 'ok';
        toast(`${t('sched.ran') || 'Ran'}: ${task.name}`, 'success');
    } catch (e) {
        if (e instanceof _StopTask) {
            // Guard clause / "Stop task" — a clean, intentional early exit.
            task.lastResult = 'ok';
            toast(`${task.name} — ${t('sched.stopped') || 'stopped'}${e.reason ? `: ${e.reason}` : ''}`, 'info');
        } else if (e instanceof _CancelledTask) {
            // Recorded as its own outcome, not as 'ok'. A person ending a run and a task
            // deciding to end are different events, and a history that shows both as a
            // clean finish cannot answer "did this actually do its work last night".
            task.lastResult = `cancelled${e.at ? ` at ${e.at}` : ''}`;
            toast(`${task.name} — ${t('sched.run.cancelled') || 'stopped by you'}`, 'info');
        } else {
            task.lastResult = `error: ${e}`;
            toast(`${task.name} — ${e}`, 'error');
        }
    } finally {
        // Paired with the increment above, in the finally for the same reason the panel entry
        // is: a task that threw must not leave the app thinking it is still running, or every
        // error toast after it would be swallowed as "that task's failure" forever.
        noteTaskRunning(-1);
        // In a finally: a task that threw must not stay in the panel as "running" forever,
        // which is the state that makes a Stop button appear broken.
        _running.delete(task.id);
        renderRunningPanel();
    }
    task.lastRun = Date.now();
    // Run history (last 20): timestamp, outcome, duration — shown in the editor.
    const ok = task.lastResult === 'ok';
    (task.history = task.history || []).push({ at: t0, ok, ms: Date.now() - t0, err: ok ? undefined : task.lastResult });
    if (task.history.length > 20) task.history = task.history.slice(-20);
    await saveTasks();
    renderScheduleList();
    await flushDirty();
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
async function runLoopBody(steps: Step[], task: Task, ctx: RunCtx): Promise<boolean> {
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

/**
 * A sleep that notices Stop.
 *
 * Polled in short slices rather than one long timer. A five-minute pause that ignored the
 * flag would make the button appear broken in precisely the situation people press it —
 * waiting is when you change your mind. 250 ms is below the threshold where a click feels
 * ignored, and costs nothing at this frequency.
 */
async function interruptibleSleep(ms: number, state?: RunState): Promise<void> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (state?.cancel) throw new _CancelledTask(state.step);
        await new Promise((r) => setTimeout(r, Math.min(250, until - Date.now())));
    }
}

async function runSteps(steps: Step[], task: Task, ctx: RunCtx, depth = 0): Promise<void> {
    const state = _running.get(task.id);
    for (const step of steps || []) {
        if (step.disabled) continue;   // switched off in the editor — skipped, not deleted
        // Between steps, never inside one. A step already in flight finishes: an HTTP
        // request is not abandoned half-sent and a launched script is not orphaned, because
        // stopping those leaves the world in a state nothing here can describe. Delay and
        // wait-until poll the same flag, so the case people actually wait on ends promptly.
        if (state?.cancel) throw new _CancelledTask(state.step);
        if (state) {
            state.step = stepLabel(step);
            state.depth = depth;
            // Progress counts TOP-LEVEL steps only. Counting every nested step would make
            // "3 of 4" jump to "17 of 4" the moment a loop starts, which is worse than
            // coarse.
            if (depth === 0) state.done++;
            renderRunningPanel();
        }
        // Before the step, never inside one. Same rule as the cancel check above, for the same
        // reason: a step already in flight has changed something, and pausing half-way through
        // one leaves the world in a state nothing here can describe.
        if (debugging(task.id)) await gate(task.id, stepLabel(step), ctx);
        if (step.kind === 'action') {
            await runAction(step.action, task, ctx, depth);
        } else if (step.kind === 'delay') {
            await interruptibleSleep(Math.max(0, step.seconds) * 1000, state);
        } else if (step.kind === 'waitFor') {
            await waitForCondition(step.condition, step.timeoutSec, ctx, step.pollSec, step.onTimeout, state, task);
        } else if (step.kind === 'if') {
            const ok = await evalCondition(step.condition, ctx, task);
            await runSteps(ok ? step.then : step.else, task, ctx, depth + 1);
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
                const ok = await evalCondition(step.condition, ctx, task);
                return step.mode === 'until' ? !ok : ok;
            };
            for (let n = 0; n < times; n++) {
                if (checkBefore && !await keepGoing()) break;
                if (!await runLoopBody(step.steps, task, ctx)) break;
                if (checkAfter && !await keepGoing()) break;
                if (gap) await new Promise(r => setTimeout(r, gap));
            }
        } else if (step.kind === 'forEach') {
            // A list the task built itself, rather than one of the six live collections.
            // Resolved HERE and not in forEachItems, which fetches from the app and has no
            // access to the run context.
            const items = step.source === 'list'
                ? (ctx.lists?.[String(step.listName || 'list')] || [])
                // A map iterates its KEYS, so {item.id} and {item.name} are both the key and
                // `map.get` inside the body is what reaches the value. Iterating pairs would
                // need an item shape no other source produces.
                : step.source === 'mapKeys'
                    ? Object.keys(ctx.maps?.[String(step.listName || 'map')] || {})
                    : await forEachItems(step.source);
            const max = Math.max(1, Math.min(step.maxIters || 100, 100000));
            const gap = Math.max(0, step.everySec || 0) * 1000;
            for (const item of items.slice(0, max)) {
                // The body runs on a per-item COPY with {item.*} placeholders resolved —
                // actions stay ordinary actions, they just receive concrete values.
                if (!await runLoopBody(substituteItem(step.steps, item), task, ctx)) break;
                if (gap) await new Promise(r => setTimeout(r, gap));
            }
        } else if (step.kind === 'retry') {
            const attempts = Math.max(1, Math.floor(step.times || 3));
            const gap = Math.max(0, Number(step.everySec ?? 5)) * 1000;
            let lastErr: unknown = null;
            for (let attempt = 1; attempt <= attempts; attempt++) {
                try {
                    await runSteps(step.steps, task, ctx, depth + 1);
                    ctx.nums['retry.attempts'] = attempt;
                    lastErr = null;
                    break;
                } catch (e) {
                    // NEVER retried: a stop, a cancel, a debug stop, or a break/continue on
                    // its way out. Those are somebody's decision or somebody's finger on a
                    // button, and running the block again is the opposite of what they asked
                    // for — a cancelled task that retries three times is a task that ignores
                    // Stop.
                    if (e instanceof FlowSignal || e instanceof _StopTask
                        || e instanceof _CancelledTask || e instanceof DebugStopped) throw e;
                    lastErr = e;
                    ctx.nums['retry.attempts'] = attempt;
                    if (attempt >= attempts) break;
                    if (state) {
                        state.step = t('sched.retry.again')
                            .replace('{n}', String(attempt + 1))
                            .replace('{t}', String(attempts));
                        renderRunningPanel();
                    }
                    // Interruptible, so Stop works during the wait. A retry that ignores the
                    // button for thirty seconds at a time is the wait people most want to
                    // abandon.
                    await interruptibleSleep(gap, state);
                }
            }
            if (lastErr && step.onFail !== 'continue') throw lastErr;
            if (lastErr) {
                ctx.text['retry.error'] = String(lastErr);
            }
        } else if (step.kind === 'ensure') {
            const already = await evalCondition(step.condition, ctx, task);
            if (already) {
                // The ordinary outcome, and it is said rather than skipped in silence: a task
                // that reports nothing on the ninety-nine runs where all was well is a task
                // nobody can tell from one that stopped running.
                if (state) { state.step = t('sched.ensure.already'); renderRunningPanel(); }
            } else {
                await runSteps(step.steps, task, ctx, depth + 1);
                // The re-check. Cheap, and the only thing separating this from an `if`.
                const fixed = await evalCondition(step.condition, ctx, task);
                if (state) { state.step = fixed ? t('sched.ensure.fixed') : t('sched.ensure.stillFalse'); renderRunningPanel(); }
                if (!fixed && step.onFail !== 'continue') {
                    throw new Error(t('sched.ensure.stillFalse'));
                }
            }
        } else if (step.kind === 'try') {
            try {
                await runSteps(step.steps, task, ctx, depth + 1);
            } catch (e) {
                if (e instanceof FlowSignal) throw e;      // signals pass through
                await runSteps(step.onError, task, ctx, depth + 1);
            }
        } else if (step.kind === 'parallel') {
            // Each branch is its own runSteps, started together. They share `ctx`, which is
            // deliberate and worth knowing: two branches writing the same variable race and
            // the last write wins. Branches are for INDEPENDENT work; anything that has to
            // agree about a value belongs in a sequence.
            const branches = (step.branches || []).filter((b) => Array.isArray(b) && b.length);
            if (branches.length) {
                const runs = branches.map((b) => runSteps(b, task, ctx, depth + 1));
                if (step.mode === 'settle') {
                    const results = await Promise.allSettled(runs);
                    const failed = results.filter((r) => r.status === 'rejected');
                    // A cancel or a `stop` is not "one branch failed", it is the task ending.
                    // Swallowing those here would let a cancelled task keep running.
                    const fatal = failed.find((r) => r.reason instanceof _CancelledTask || r.reason instanceof _StopTask);
                    if (fatal) throw fatal.reason;
                    if (failed.length) {
                        toast((t('sched.par.some') || '{n} of {m} parallel branch(es) failed')
                            .replace('{n}', String(failed.length)).replace('{m}', String(branches.length)), 'warning');
                    }
                } else {
                    // Promise.all rejects on the FIRST failure, but the others are already
                    // running and cannot be un-started. Settling them before rethrowing keeps
                    // the step from returning while work is still in flight — an unhandled
                    // rejection from a branch nobody awaits is the usual bug here.
                    try {
                        await Promise.all(runs);
                    } catch (e) {
                        await Promise.allSettled(runs);
                        throw e;
                    }
                }
            }
        } else if (step.kind === 'call') {
            // A named block of steps, written once and run from anywhere.
            //
            // It runs INSIDE this task: same ctx, same `task`, so every permission check in
            // runAction reads the CALLER's permissions. That is the decision the whole feature
            // hangs on — permissions attached to a block would be granted in one place and
            // spent in another, and importing a block would become a way to run actions the
            // calling task was refused.
            const blocks = readBlocks();
            const body = blocks[String(step.block || '')];
            // A missing block ABORTS rather than skipping. A call that silently does nothing
            // is a task that reports success while half of it never happened.
            if (!body) {
                throw new Error((t('sched.call.missing') || 'No block named “{n}”.').replace('{n}', String(step.block || '')));
            }
            // Depth, not a visited-set: a block calling itself twice in sequence is legitimate,
            // a block calling itself forever is not, and only the nesting tells them apart.
            // runSteps already carries `depth` for the loop guards; this rides on it.
            if (depth >= 20) {
                throw new Error(t('sched.call.deep') || 'Blocks are nested too deeply — a block is probably calling itself.');
            }
            await runSteps(body, task, ctx, depth + 1);
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
                if (await evalCondition(c.condition, ctx, task)) { await runSteps(c.steps, task, ctx, depth + 1); ran = true; break; }
            }
            if (!ran) await runSteps(step.default || [], task, ctx, depth + 1);
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
        if (st && st.kind === 'retry') {
            const copy: any = rep({ ...st, steps: [] });
            copy.steps = walk(st.steps);
            return copy;
        }
        if (st && st.kind === 'ensure') {
            const copy: any = rep({ ...st, steps: [] });
            copy.steps = walk(st.steps);
            return copy;
        }
        if (st && (st.kind === 'repeat' || st.kind === 'try')) {
            const copy: any = rep({ ...st, steps: [], onError: [] });
            if (st.steps) copy.steps = walk(st.steps);
            if (st.onError) copy.onError = walk(st.onError);
            return copy;
        }
        if (st && st.kind === 'parallel') {
            // Every branch, or {item.x} silently stops resolving inside a parallel nested in
            // a for-each — the exact bug this walk exists to prevent, for one kind only.
            return { ...rep({ ...st, branches: [] }), branches: (st.branches || []).map((b: any) => walk(b)) };
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
async function waitForCondition(cond: Condition, timeoutSec: number, ctx: RunCtx, pollSec = 2, onTimeout: 'abort' | 'continue' = 'abort', state?: RunState, task?: Task): Promise<void> {
    const deadline = Date.now() + Math.max(1, timeoutSec || 60) * 1000;
    const pollMs = Math.max(250, (pollSec || 2) * 1000);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (await evalCondition(cond, ctx, task)) return;
        if (Date.now() >= deadline) {
            // Either abort the whole task (default) or just stop waiting and carry on.
            if (onTimeout === 'continue') return;
            throw new Error(t('sched.waitTimeout') || 'Timed out waiting for condition');
        }
        // Interruptible, like the delay. A wait-until whose condition never comes true is
        // THE case people reach for Stop — a task waiting for a file that will never appear
        // is the definition of stuck, and it was the one that ignored the button.
        await interruptibleSleep(pollMs, state);
    }
}

// ── Action dispatch ───────────────────────────────────────────────────────────
// Size preset → run_app_benchmark `scale` string.
const BENCH_SCALE: Record<string, string> = { S: 'small', M: 'medium', L: 'large', XL: 'xlarge' };

/** What a task changed that the OPEN screens are now wrong about.
 *
 *  The runner never refreshed anything. A scheduled task could enable forty mods,
 *  switch the profile or pull a repo, and the library went on showing what it had
 *  read before the task started — stale until you navigated away and back, with no
 *  sign it was stale. The task itself reported success, so nothing looked broken.
 *
 *  Refreshing after every action would be the other mistake: a For-Each over forty
 *  mods would re-read and re-render the library forty times, forty-nine fiftieths of
 *  it thrown away. So actions only NOTE what they invalidated, and the flush happens
 *  once, when the task is over.
 *
 *  Actions that change nothing on screen — notify, delay, a benchmark — note nothing
 *  and cost nothing. That is the "only what needs an update gets one" rule, applied
 *  per action rather than per task. */
type DirtyArea = 'mods' | 'profiles';
let _dirty = new Set<DirtyArea>();

/** Which screens each action invalidates. An action absent from this map is one that
 *  leaves the visible state alone; adding a new action means deciding, once, whether
 *  it belongs here — which is easier to get right than remembering to call a
 *  refresh at forty call sites. */
const DIRTIES: Record<string, DirtyArea[]> = {
    'mod.enable': ['mods'],
    'mod.disable': ['mods'],
    'mods.enableAll': ['mods'],
    'mods.disableAll': ['mods'],
    'mods.scan': ['mods'],
    'mods.order': ['mods'],
    'modpack.enable': ['mods'],
    'modpack.disable': ['mods'],
    // A profile switch swaps what is deployed, so BOTH lists are wrong afterwards.
    'profile.activate': ['profiles', 'mods'],
    // Repo work rewrites mod files on disk; the library is reading the old ones.
    'repo.sync': ['mods'],
    'repo.connect': ['mods'],
    'repo.update': ['mods'],
    'mods.checkUpdates': ['mods'],
    'mods.autoImportOmm': ['mods'],
    'mod.add': ['mods'],
    'modlist.import': ['mods'],
    'modpack.create': ['mods'],
    // theme.set repaints through the theme engine's own path, so it is deliberately
    // absent rather than forgotten.
};

/** Re-read whatever the task invalidated, once, after it has finished.
 *
 *  Dynamically imported so the scheduler does not drag the mod and profile views
 *  onto its own load path, and each failure is swallowed on its own: a refresh is a
 *  courtesy after the work is already done, and a task that succeeded must not be
 *  reported as failed because a screen would not redraw. */
async function flushDirty(): Promise<void> {
    const areas = _dirty;
    _dirty = new Set();
    if (!areas.size) return;
    if (areas.has('mods')) {
        try { (await import('../mods/mods.js')).refreshMods(false, true); } catch { /* view may not be loaded */ }
    }
    if (areas.has('profiles')) {
        try { (await import('../profiles/profiles.js')).renderProfiles(); } catch { /* view may not be loaded */ }
    }
}

/** Make a command's or script's output usable by the REST of the task.
 *
 *  Without this, running code was a dead end: it could change the world but could
 *  not tell the automation around it what it found, so "if the script says yes,
 *  then..." was unexpressible and the only signal was pass/fail. The trimmed first
 *  line goes into ctx under the user's chosen name, where the existing {var}
 *  substitution and the numeric conditions already look. */
/**
 * Variables that outlive a run, shared by every task.
 *
 * localStorage, like the rest of the scheduler's state, and read fresh on each access
 * rather than cached in a module variable: two tasks can be mid-run at once, and a cached
 * copy would let the second overwrite what the first just wrote.
 *
 * These are NOT a secret store. A task will hold an API token here because that is the
 * obvious thing to do with it, and localStorage is readable by anything running in the
 * webview — which the UI says next to the field rather than leaving people to assume.
 */
const SHARED_VARS_KEY = 'bmm.sched.vars';

export function readSharedVars(): Record<string, string> {
    try {
        const raw = JSON.parse(localStorage.getItem(SHARED_VARS_KEY) || '{}');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const out: Record<string, string> = {};
        // Filtered on the way OUT as well as in. A hand-edited store, or one written by an
        // older build, must not hand back a name that substituteVars cannot match — that
        // is a variable which appears in the list and never resolves.
        for (const [k, v] of Object.entries(raw)) if (VAR_NAME_RE.test(k)) out[k] = String(v ?? '');
        return out;
    } catch { return {}; }
}

/**
 * Declared enums: a name, and the set of values it may hold.
 *
 * The point is not the values — a condition could always compare free text. It is that a
 * SWITCH whose cases all test the same enum can be told which members it has not handled,
 * which is the one thing `switch` could never do and the only reason `match` was ever wanted
 * (see .Assets/.md/SCHEDULER_TYPES_DESIGN.md).
 *
 * Stored like the shared variables, and for the same reason: an enum outlives a run and is
 * shared by every task, so it cannot live in RunCtx. Read fresh on every access rather than
 * cached, because two tasks can be mid-run at once.
 */
/**
 * Reusable blocks: a name, and the steps it runs.
 *
 * Stored beside the shared variables and the enums, for the same reason — a block outlives a
 * run and belongs to every task, so it cannot live in a task's own definition. Read fresh on
 * each access; two tasks can be mid-run at once.
 *
 * The block carries NO permissions of its own. It runs inside whichever task called it, so
 * every check reads the caller's grants — see the `call` step in runSteps for why that is the
 * whole point rather than an implementation detail.
 */
const BLOCKS_KEY = 'bmm.sched.blocks';

export function readBlocks(): Record<string, Step[]> {
    try {
        const raw = JSON.parse(localStorage.getItem(BLOCKS_KEY) || '{}');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const out: Record<string, Step[]> = {};
        for (const [k, v] of Object.entries(raw)) {
            // Same filter-on-the-way-out rule as the other two stores: a name no step could
            // reference would sit in the list and never run.
            if (!BLOCK_NAME_RE.test(k) || !Array.isArray(v)) continue;
            // normalizeSteps because a stored block is JSON somebody may have hand-edited or an
            // older build wrote — the runner expects the same shape it gives a task's steps.
            out[k] = normalizeSteps(v as Step[]);
        }
        return out;
    } catch { return {}; }
}

export function writeBlocks(all: Record<string, Step[]>): void {
    try { localStorage.setItem(BLOCKS_KEY, JSON.stringify(all)); } catch { /* quota or private mode */ }
}

const ENUMS_KEY = 'bmm.sched.enums';

export function readEnums(): Record<string, string[]> {
    try {
        const raw = JSON.parse(localStorage.getItem(ENUMS_KEY) || '{}');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const out: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(raw)) {
            // Same filter-on-the-way-out rule as the shared variables: a name a condition
            // could never reference would show in the list and never work.
            if (!VAR_NAME_RE.test(k) || !Array.isArray(v)) continue;
            // Members are de-duplicated. Two identical members make the exhaustiveness count
            // wrong in the one direction that matters — it would report a member as unhandled
            // while a case already covers it.
            const seen = new Set<string>();
            for (const m of v) {
                const str = String(m ?? '').trim();
                if (str && !seen.has(str)) seen.add(str);
            }
            if (seen.size) out[k] = [...seen];
        }
        return out;
    } catch { return {}; }
}

export function writeEnums(all: Record<string, string[]>): void {
    try { localStorage.setItem(ENUMS_KEY, JSON.stringify(all)); } catch { /* quota or private mode */ }
}

export function writeSharedVars(vars: Record<string, string>): void {
    try { localStorage.setItem(SHARED_VARS_KEY, JSON.stringify(vars)); } catch { /* quota */ }
}

/**
 * Offer the programs that are running right now.
 *
 * The field was a bare text box, so naming a program meant knowing its executable name or
 * walking a file picker to it. The scheduler already asks the backend for the process list
 * — it is how the PID-based actions work — and the same answer is the better half of this
 * field.
 *
 * Full path first where there is one, because that is what will actually be launched: two
 * different `java.exe` on one machine is normal, and a bare name picks whichever the PATH
 * happens to find. The bare name is offered too, for the case where PATH resolution is the
 * intent.
 *
 * Failure is silent and leaves an ordinary text box. This is a convenience over a field
 * that already worked; an error toast because a suggestion list could not be built would
 * be reporting a problem the person does not have.
 */
async function fillProgramSuggestions(host: HTMLElement): Promise<void> {
    const list = host.querySelector('#sched-prog-list');
    if (!list) return;
    try {
        const procs: any[] = await invoke('list_running_processes') as any[];
        const seen = new Set<string>();
        const opts: string[] = [];
        for (const pr of procs) {
            for (const v of [pr?.exe, pr?.name]) {
                const s = String(v || '').trim();
                if (!s || seen.has(s)) continue;
                seen.add(s);
                // 60 is past the point where the dropdown stops being scannable, and the
                // list arrives heaviest-first so the useful ones are already at the top.
                if (opts.length < 60) opts.push(`<option value="${escAttr(s)}">`);
            }
        }
        list.innerHTML = opts.join('');
    } catch { /* a text box with no suggestions is the field as it was */ }
}

/**
 * How long this script step may take, in seconds.
 *
 * Undefined means "the default", decided in Rust — not here. Two defaults for one rule is how
 * they drift, and the one that matters is the one the process actually gets.
 *
 * A step written before this existed carries nothing and gets the default, which is the point:
 * the change is a limit where there was none, not a setting people have to go and turn on.
 */
function scriptLimit(p: Record<string, any>): number | null {
    const n = parseInt(String(p.timeoutSecs ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function _captureOutput(p: Record<string, any>, out: any, ctx: RunCtx): void {
    const name = String(p.into || '').trim();
    if (!name) return;
    const whole = String(out ?? '').trim();
    const first = String(out ?? '').split(/\r?\n/).find(l => l.trim())?.trim() || '';
    const num = parseFloat(first);
    // The number, for conditions. A non-numeric line still becomes its length rather than
    // NaN — NaN would make every comparison silently false, which reads as "the condition
    // did not hold" instead of "there was no number here".
    ctx.nums[name] = Number.isFinite(num) ? num : first.length;
    // And the text, which is what a script usually actually returns. This is the half that
    // was missing: without it a script that printed a path or a name was reduced to the
    // length of that string and there was no way to get the string itself back.
    //
    // The WHOLE output, not just the first line — a script listing three files is a normal
    // thing to want, and first-line-only was a limit inherited from needing one number.
    ctx.text[name] = whole;
}


/**
 * Which engine runs a shipped script, from its extension.
 *
 * The action has a field for it, and leaving that field blank has to do the right thing:
 * nobody ships `setup.ps1` and means "run this with Python". PowerShell is the fallback
 * because this is a Windows app and it is what `custom.script` already defaults to.
 */
function engineFor(path: string): string {
    const ext = (path.split('.').pop() || '').toLowerCase();
    return ({ ps1: 'powershell', bat: 'cmd', cmd: 'cmd', sh: 'bash', py: 'python' } as Record<string, string>)[ext]
        || 'powershell';
}

/**
 * Add the automations from a `.bmmpa` to the scheduler, DISABLED.
 *
 * Disabled is the whole point, and it is the same rule a repo's carried automation follows:
 * an automation can run commands, its author is whoever sent the file, and importing is not
 * the same act as agreeing to run it. Permissions are stripped for the same reason — they
 * are granted by the person who reads the task, not carried in by the file that asks.
 *
 * An id already present is left alone rather than replaced, so an import cannot rewrite a
 * task somebody already trusts by naming it the same thing.
 *
 * `includes` are restored FIRST. A `.bmmpa` carries the reusable blocks, modpacks and launch
 * packs its tasks call, and dropping them would import a task whose `Run a block` step points
 * at a name that does not exist here — which stops the task rather than skipping, by design.
 * Written and then found by reading the export side: the exporter has always carried them.
 */
export async function importTasksFromPath(path: string): Promise<number> {
    const raw = String(await invoke('read_file_text', { path }));
    const doc = JSON.parse(raw);
    await restoreIncludes(doc?.includes).catch(() => ({ count: 0, remap: {} }));
    const incoming: any[] = Array.isArray(doc?.tasks) ? doc.tasks : (Array.isArray(doc) ? doc : [doc]);
    // Typed, because the catch arm's [] would otherwise infer never[] and the push below
    // becomes an error that reads as if the DATA were wrong rather than the annotation.
    const current: any[] = await (invoke('get_schedules') as Promise<any[]>).catch(() => [] as any[]);
    const have = new Set((current || []).map((x: any) => String(x?.id || '')));
    let added = 0;
    for (const raw of incoming) {
        if (!raw || typeof raw !== 'object' || !raw.id) continue;
        if (have.has(String(raw.id))) continue;
        current.push({ ...raw, enabled: false, perms: {}, osSchedule: false });
        have.add(String(raw.id));
        added += 1;
    }
    if (added) await invoke('save_schedules', { tasks: current });
    if (added) await loadTasks();
    return added;
}

async function runAction(action: Action, task: Task, ctx: RunCtx, depth = 0): Promise<void> {
    // Substituted once, here, so every action sees resolved parameters without each case
    // having to remember to ask. `action.params` itself is left alone — it is the saved
    // task, and rewriting it would bake one run's values into the stored definition.
    const p = substituteVars(action.params || {}, ctx);
    // A parameter may NAME a place instead of saying where it is: `plugin:my-tools/bundle`,
    // `mods:`, `app:obs`. Resolved here, once, for the same reason substitution is — every
    // case would otherwise have to remember to ask, and the one that forgets fails at 3am
    // with a message about a folder nobody recognises.
    await resolvePathSpecs(p);
    // Noted BEFORE the action runs, not after: a step that throws half-way through
    // has still changed something, and the screens are wrong either way. Try/On error
    // can swallow that throw and let the task continue, so recording it only on
    // success would lose exactly the case where a stale view is most confusing.
    for (const area of DIRTIES[action.type] || []) _dirty.add(area);
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
        case 'data.validate': {
            const r = await invoke('bmm_validate', {
                path: p.path || null, text: p.text || null,
            }) as { format: string; ok: boolean; problems: string[]; count: number };
            ctx.text['valid.format'] = r.format;
            ctx.text['valid.problems'] = r.problems.map((k) => t(k)).join('; ');
            ctx.nums['valid.ok'] = r.ok ? 1 : 0;
            ctx.nums['valid.count'] = r.count;
            // An expected format that did not arrive fails the step out loud when asked to.
            // Silently carrying on is what turns "the download was a login page" into a
            // problem three steps later, about something unrelated.
            const want = String(p.expect || '').trim();
            const matched = !want || want === r.format;
            ctx.nums['valid.matched'] = matched ? 1 : 0;
            if (want && !matched && p.strict !== false) {
                throw new Error(t('sched.valid.wrongFormat')
                    .replace('{want}', want)
                    .replace('{got}', r.format || t('sched.valid.nothing')));
            }
            break;
        }
        case 'log.print': {
            const line = String(p.message ?? p.text ?? '');
            // Two places, on purpose. The running panel is what somebody watching sees; the
            // log file is what they read afterwards, which is the case `print` exists for —
            // a task that failed at 3am and the question is what it was holding at the time.
            // runAction has no `state` of its own — runSteps holds it. Looked up by id, which
            // is the same map and one call.
            const rs = _running.get(task.id);
            if (rs) { rs.step = line.slice(0, 200); renderRunningPanel(); }
            ctx.text['log.last'] = line;
            if (task.outputDir !== '-') {
                try {
                    await invoke('task_write_file', {
                        taskId: task.id, outputDir: task.outputDir || null,
                        path: 'run.log', text: `${new Date().toISOString()}  ${line}\n`, append: true,
                    });
                } catch { /* printing must never be the thing that fails a task */ }
            }
            break;
        }
        case 'file.write': {
            const where = await invoke('task_write_file', {
                taskId: task.id, outputDir: task.outputDir || null,
                path: String(p.path || 'output.txt'), text: String(p.text ?? ''),
                append: p.append === true || p.append === 'true',
            }) as string;
            ctx.text['file.written'] = where;
            break;
        }
        case 'mods.order': {
            // Two shapes, because there are two questions. "Make this one win" is what
            // somebody has when they are looking at a conflict; "here is the order" is what a
            // task restoring a known-good setup has.
            const [current] = await invoke('mod_order_get', { profileId: null }) as [{ id: string }[], unknown];
            const ids = (current || []).map((m) => m.id);
            let next: string[];
            if (p.order) {
                // An explicit list. Anything active but not named keeps its relative place at
                // the FRONT, so a partial list means "these last, in this order" rather than
                // "drop everything else" — which the backend would refuse anyway, loudly.
                const named = String(p.order).split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
                const known = named.filter((id) => ids.includes(id));
                next = [...ids.filter((id) => !known.includes(id)), ...known];
            } else {
                const id = String(p.id || '');
                if (!ids.includes(id)) throw new Error(t('sched.order.notActive').replace('{m}', id));
                next = p.mode === 'first'
                    ? [id, ...ids.filter((x) => x !== id)]
                    : [...ids.filter((x) => x !== id), id];
            }
            const moved = await invoke('mod_order_set', { profileId: null, order: next }) as number;
            ctx.nums['order.moved'] = moved;
            break;
        }
        case 'theme.set':
            await invoke('set_active_theme', { themeId: p.id }); break;
        case 'app.launch':
            await invoke('launch_app', { appId: p.id, exePath: p.exePath || '' }); break;
        case 'app.stop': {
            requirePerm(task, 'stopProcess', t('sched.permStopProcess') || 'stop running programs');
            const stopped = await invoke('stop_process', {
                name: p.name || '', pid: p.pid || null, allow: true,
            });
            // Captured like any other step result, so a later step can branch on how many
            // were actually stopped rather than only on whether the step threw.
            _captureOutput(p, String(stopped), ctx);
            break;
        }
        case 'notify':
            toast(p.message || task.name, 'info'); break;
        case 'custom.command': {
            requirePerm(task, 'command', t('sched.permRunCommand') || 'run external programs');
            const args = (p.args || '').trim() ? String(p.args).split(/\s+/) : [];
            const out = await invoke('run_scheduled_command', {
                program: p.program, args, workingDir: p.workingDir || null, allow: true,
            });
            _captureOutput(p, out, ctx);
            break;
        }
        case 'code.run': {
            // Compiled at RUN time, not stored as steps. The source is the truth: storing the
            // compiled tree would mean a snippet silently kept running an old compilation
            // after somebody edited the text, which is the worst kind of stale.
            const src = String(p.code || '').trim();
            if (!src) break;
            const r: any = await invoke('bmms_compile_steps', { source: src });
            if (!r?.ok) {
                const e = (r?.errors || [])[0];
                // The position, in the message. A task that fails at 03:00 leaves only this
                // line in the log, and "syntax error" with no line is not something anybody
                // can act on the next morning.
                throw new Error(e
                    ? `${t('sched.bmms.line') || 'Line'} ${e.line}:${e.col} — ${e.message}`
                    : (t('sched.bmms.badcode') || 'This BMMScript did not compile.'));
            }
            // INSIDE this task: same ctx, same `task`, so every permission check in runAction
            // reads the caller's permissions. Same decision as `call` — permissions attached
            // to a snippet would be granted in one place and spent in another.
            // Bounded like `call`: a snippet whose code.run runs another snippet is
            // legitimate once and a stack overflow forever, and only the nesting tells them
            // apart. runSteps already carries `depth` for the loop guards; this rides on it.
            if (depth >= 20) throw new Error(t('sched.bmms.deep') || 'BMMScript is nested too deeply — a snippet is probably running itself.');
            await runSteps((r.steps || []) as Step[], task, ctx, depth + 1);
            break;
        }
        case 'catalog.create': {
            const dir = String(p.dir || '').trim();
            if (!dir) throw new Error(t('sched.catNeedDir') || 'This step needs a destination folder.');
            const kind = String(p.kind || 'tutorial');
            const title = String(p.name || '').trim() || 'My catalogue';
            // Trailing slash stripped once, here, so neither branch has to think about it.
            const base = String(p.base || '').trim().replace(/\/+$/, '');
            const wrote = await buildCatalogueInto(kind, dir, title, base);
            ctx.nums['catalog.entries'] = wrote;
            // Nothing written is not a success. A catalogue with no entries is a file that
            // looks published and installs nothing, and on a schedule nobody is watching the
            // count go by.
            if (!wrote) {
                toast(`${task.name}: ${t('sched.catEmpty').replace('{k}', kind)}`, 'warning', 12000);
                break;
            }
            let msg = (t('sched.catDone') || 'Published {n} entry(ies).').replace('{n}', String(wrote));
            if (p.bundle) {
                // A .bmmbundle is the catalogue AND its files in one archive, which is what
                // somebody hands over when there is no server to put a folder on. Packed
                // from the folder just written, so the two can never describe different
                // things.
                const out = String(p.bundleOut || '').trim() || `${dir}/${(title || 'catalogue').replace(/[^A-Za-z0-9._-]/g, '_')}.bmmbundle`;
                const packed: any = await invoke('catalog_bundle_pack', { dir, out });
                ctx.text['catalog.bundle'] = String(packed?.path || out);
                msg += ` ${t('sched.catBundled').replace('{f}', String(out).replace(/^.*[/\\]/, ''))}`;
            }
            toast(`${task.name}: ${msg}`, 'success', 9000);
            break;
        }
        case 'folder.create': {
            // No permission gate on purpose. A task can already make folders through
            // custom.script, but only once it has been trusted with "run scripts" —
            // which is the whole machine. This is confined to BMM's own app-data
            // directory by the backend, so it grants nothing a task could not do to
            // its own data anyway.
            const made = await invoke('create_bmm_folder', { relative: p.path || '' });
            _captureOutput(p, made, ctx);
            break;
        }
        case 'custom.script': {
            requirePerm(task, 'script', t('sched.permRunScript') || 'run scripts');
            // A non-zero exit used to fail the whole STEP, so a script could not report a
            // state — "exited 2 because there was nothing to do" and "could not start" were
            // the same outcome. With this ticked the exit code lands in a variable and the
            // task decides what it means.
            if (p.keepGoing) {
                const r = await invoke('run_scheduled_script_full', {
                    engine: p.engine || 'powershell',
                    code: String(p.code || ''),
                    workingDir: p.workingDir || null,
                    allow: true,
                    timeoutSecs: scriptLimit(p),
                }) as { code: number; stdout: string; stderr: string; ok: boolean };
                ctx.nums['script.code'] = Number(r.code);
                ctx.nums['script.ok'] = r.ok ? 1 : 0;
                ctx.text['script.stdout'] = String(r.stdout || '');
                ctx.text['script.stderr'] = String(r.stderr || '');
                _captureOutput(p, r.stdout, ctx);
                break;
            }
            // The body goes through the same {item.*} / {var} substitution as every
            // other string param, so a script inside a For-Each can act on the item
            // it was handed instead of re-deriving it.
            const out = await invoke('run_scheduled_script', {
                engine: p.engine || 'powershell',
                code: String(p.code || ''),
                workingDir: p.workingDir || null,
                allow: true,
                timeoutSecs: scriptLimit(p),
            });
            _captureOutput(p, out, ctx);
            break;
        }
        case 'deeplink':
            requirePerm(task, 'deeplink', t('sched.permDeeplink') || 'fire deeplinks');
            await runDeepLink(p.url); break;

        // ── Variables ────────────────────────────────────────────────────────
        case 'var.set': {
            const name = String(p.name || '').trim();
            // Refused rather than skipped. A variable named `my var` can never be read
            // back — substituteVars will not match it — so accepting the write would
            // create something that looks stored and is permanently unreadable.
            if (!VAR_NAME_RE.test(name)) {
                throw new Error((t('sched.var.badName') || 'Not a usable variable name: {n}').replace('{n}', name || '(empty)'));
            }
            const value = String(p.value ?? '');
            if (p.scope === 'shared') {
                const all = readSharedVars();
                all[name] = value;
                writeSharedVars(all);
                // The run context sees it immediately too, so a later step in THIS task
                // does not have to wait for the next run to read what was just written.
                ctx.shared = { ...(ctx.shared || {}), [name]: value };
            } else {
                ctx.text[name] = value;
                const n = parseFloat(value);
                ctx.nums[name] = Number.isFinite(n) ? n : value.length;
            }
            break;
        }
        case 'var.clear': {
            const name = String(p.name || '').trim();
            const all = readSharedVars();
            if (name) delete all[name]; else for (const k of Object.keys(all)) delete all[k];
            writeSharedVars(all);
            if (ctx.shared) { if (name) delete ctx.shared[name]; else ctx.shared = {}; }
            break;
        }

        // ── Talking to something else ────────────────────────────────────────
        case 'http.request': {
            // Under the SAME permission as running a program. An HTTP call can post the
            // contents of a captured variable anywhere, and a task that can do that
            // without asking would make the other permissions decorative.
            requirePerm(task, 'command', t('sched.permHttp') || 'reach external services');
            const url = String(p.url || '').trim();
            if (!/^https?:\/\//i.test(url)) {
                throw new Error((t('sched.http.badUrl') || 'Not an http(s) address: {u}').replace('{u}', url || '(empty)'));
            }
            const headers = parseHeaderLines(String(p.headers || ''));
            const res: any = await invoke('http_request', {
                url,
                method: String(p.method || 'GET').toUpperCase(),
                headers,
                body: p.body ? String(p.body) : null,
                timeoutMs: Math.min(120_000, Math.max(1_000, parseInt(p.timeoutMs, 10) || 15_000)),
            });
            const status = Number(res?.status) || 0;
            const text = String(res?.body ?? '');
            // Status is always available for a condition, under a name that cannot collide
            // with a user's own: dots are not allowed in a variable name.
            ctx.nums['http.status'] = status;
            ctx.text['http.status'] = String(status);
            // A JSON pointer, when asked for. Anything else would need a script step just
            // to pull one field out of a response, which is the common case.
            let captured = text;
            if (p.jsonPath) {
                try { captured = readJsonPath(text, String(p.jsonPath)); }
                catch { throw new Error(t('sched.http.badJson') || 'The response was not JSON, so no field could be read from it.'); }
            }
            // A failing status throws rather than capturing the error page as if it were
            // the answer — otherwise a 500 whose body is HTML becomes the value of a
            // variable a later step trusts.
            if (statusIsFailure(status, !!p.allowAnyStatus)) {
                throw new Error((t('sched.http.status') || 'HTTP {s} from {u}').replace('{s}', String(status)).replace('{u}', url));
            }
            _captureOutput(p, captured, ctx);
            break;
        }

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
            ctx.nums['benchmark.total_ms'] = totalMs;
            if (bytes > 0 && totalMs > 0) ctx.nums['benchmark.mbps'] = Math.round((bytes / 1048576) / (totalMs / 1000) * 10) / 10;
            toast(`${task.name}: benchmark ${Math.round(totalMs)} ms${ctx.nums['benchmark.mbps'] ? ` · ${ctx.nums['benchmark.mbps']} MB/s` : ''}`, 'info');
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
            ctx.nums['disk.read_mbps'] = Number(r?.read_mb_s) || 0;
            ctx.nums['disk.write_mbps'] = Number(r?.write_mb_s) || 0;
            ctx.nums['disk.suggested_limit'] = Number(r?.suggested_limit) || 0;
            toast(`${task.name}: ${mount} ${ctx.nums['disk.read_mbps']}↓ / ${ctx.nums['disk.write_mbps']}↑ MB/s`, 'info');
            break;
        }
        case 'storage.applyLimit': {
            const mount = p.mountPoint || (await firstDiskMount());
            if (!mount) throw new Error('No disk selected');
            const limit = p.limitMbS != null && p.limitMbS !== ''
                ? Math.max(1, parseInt(p.limitMbS, 10) || 0)
                : Math.round(ctx.nums['disk.suggested_limit'] || 0);
            await invoke('set_disk_limit', { mountPoint: mount, limitMbS: limit > 0 ? limit : null });
            toast(`${task.name}: ${mount} limit → ${limit > 0 ? limit + ' MB/s' : 'unlimited'}`, 'success');
            break;
        }

        // ── Logic & math ──────────────────────────────────────────────────────
        case 'math.set': {                         // target = <expression over ctx>
            const target = String(p.target || 'result');
            try { ctx.nums[target] = evalExpr(String(p.expr || '0'), ctx); }
            catch (e) { throw new Error(`${t('sched.mathErr') || 'Math error'}: ${e}`); }
            break;
        }
        case 'var.ternary': {                      // target = cond ? ifTrue : ifFalse
            const ok = p.condition ? await evalCondition(p.condition, ctx, task) : false;
            ctx.nums[String(p.target || 'result')] = Number(ok ? p.ifTrue : p.ifFalse) || 0;
            break;
        }
        case 'rule.table': {                       // first matching rule sets target
            const src = readNum(ctx, String(p.source || '')) ?? NaN;
            const target = String(p.target || 'result');
            for (const r of (Array.isArray(p.rows) ? p.rows : [])) {
                if (cmpNum(src, r.op, Number(r.value))) { ctx.nums[target] = Number(r.result) || 0; break; }
            }
            break;
        }
        // ── Games: notice, then act ─────────────────────────────────────

        // Pull one value out of a file or a variable and keep it.
        //
        // This is the whole of "which server am I on" for every game that is not DCS. A game
        // writes a log; the log has a line naming what it just did; a regex takes the part
        // that matters and puts it in a variable the next steps can branch on. Nothing about
        // it is game-specific, which is why it is not called anything game-specific.
        case 'text.extract': {
            const target = String(p.target || 'value').trim() || 'value';
            let hay = '';
            if (p.path) {
                // The TAIL, not the file. A game log is appended to for the whole session
                // and can be hundreds of megabytes; what just happened is at the end of it.
                hay = String(await invoke('read_text_tail', {
                    path: String(p.path), kb: Number(p.tailKb) || 64,
                }).catch(() => ''));
            } else if (p.source) {
                hay = String(ctx.text[String(p.source)] ?? '');
            }
            let value = '';
            const pattern = String(p.regex || '').trim();
            if (pattern) {
                try {
                    // LAST match, not first. In a log the most recent line is the one that
                    // describes now; the first is whatever happened when the game started.
                    const re = new RegExp(pattern, 'g');
                    let m: RegExpExecArray | null;
                    let last: RegExpExecArray | null = null;
                    while ((m = re.exec(hay)) !== null) {
                        last = m;
                        if (m.index === re.lastIndex) re.lastIndex += 1;  // a zero-width match
                    }
                    if (last) value = String(last[Number(p.group) || 1] ?? last[0] ?? '');
                } catch {
                    // A regex somebody typed. A bad one is a mistake in the task, not a
                    // reason to abandon the run half-way through.
                    toast(`${task.name}: ${t('sched.textExtract.badRegex')}`, 'warning', 8000);
                }
            } else {
                value = hay.trim();
            }
            ctx.text[target] = value;
            // Also as a number when it is one, so `value >` conditions work on it without a
            // second action to convert it.
            const n = Number(value);
            if (value !== '' && Number.isFinite(n)) ctx.nums[target] = n;
            break;
        }

        // Put a mod list on: install what is missing, then enable exactly what it names.
        //
        // The unattended half of the import screen. Everything it does, a person can do by
        // hand in Mods → Import — which is the rule for a scheduler action.
        case 'modlist.apply': {
            const { applyModList } = await import('../mods/modlist.js');
            const r = await applyModList({
                path: p.path ? String(p.path) : undefined,
                url: p.url ? String(p.url) : undefined,
                install: p.install !== false,
                exact: !!p.exact,
                passphrase: p.passphrase ? String(p.passphrase) : undefined,
            });
            toast(`${task.name}: ${t('sched.listApply.done')
                .replace('{on}', String(r.enabled))
                .replace('{new}', String(r.installed))}`, 'success', 8000);
            if (r.missing.length) {
                // Named, and a warning rather than a failure. A list that names a mod
                // nothing can supply is still worth applying for the rest of it — but
                // "applied" with three mods silently absent is the report that gets somebody
                // kicked off a strict server without knowing why.
                toast(`${task.name}: ${t('sched.listApply.missing')
                    .replace('{n}', String(r.missing.length))} — ${r.missing.slice(0, 6).join(', ')}`,
                    'warning', 12000);
            }
            break;
        }

        // One of a plugin's shipped files: read it, copy it out, or run it.
        //
        // `run` is the only mode that is gated, and it is gated by the TASK's own script
        // permission rather than by anything about the plugin. A shipped script is a program
        // somebody else wrote; whether this automation may run programs is a question the
        // user answered once, in writing, on the task — and that answer governs here too.
        case 'plugin.asset': {
            const pluginId = String(p.pluginId || '');
            const assetPath = String(p.path || '');
            if (!pluginId || !assetPath) { toast(`${task.name}: ${t('sched.pa.nothing')}`, 'warning', 8000); break; }
            const mode = String(p.mode || 'read');

            if (mode === 'read') {
                const target = String(p.target || 'asset').trim() || 'asset';
                const text = String(await invoke('plugin_asset_read', { pluginId, path: assetPath }));
                ctx.text[target] = text;
                const n = Number(text.trim());
                if (text.trim() !== '' && Number.isFinite(n)) ctx.nums[target] = n;
                break;
            }

            if (mode === 'copy') {
                const dir = String(p.dir || '');
                if (!dir) { toast(`${task.name}: ${t('sched.pa.noDir')}`, 'warning', 8000); break; }
                const where = await invoke('plugin_asset_export', { pluginId, path: assetPath, destDir: dir }) as string;
                toast(`${task.name}: ${t('sched.pa.copied').replace('{f}', String(where).replace(/^.*[/\\]/, ''))}`, 'success', 7000);
                break;
            }

            if (mode === 'run') {
                // The task's OWN script permission, through the same helper `custom.script`
                // uses — so this refuses in the same words, and there is one place that
                // decides whether an automation may run programs.
                requirePerm(task, 'script', t('sched.permRunScript') || 'run scripts');
                // Read and handed to the engine as code, exactly as a typed script is. The
                // alternative — launching the file by path — would mean the OS choosing what
                // runs a .ps1, which is a different decision made by a different party.
                const code = String(await invoke('plugin_asset_read', { pluginId, path: assetPath }));
                const out = await invoke('run_scheduled_script', {
                    engine: String(p.engine || engineFor(assetPath)),
                    code,
                    workingDir: p.workingDir || null,
                    allow: true,
                    timeoutSecs: scriptLimit(p),
                });
                _captureOutput(p, out, ctx);
                toast(`${task.name}: ${t('sched.pa.ran').replace('{f}', assetPath)}`, 'success', 7000);
                break;
            }

            // `open` — the folder, not the file. Handing a .ps1 to the shell is `run`, and
            // the difference between the two must not be which button somebody clicked.
            const full = await invoke('plugin_asset_path', { pluginId, path: assetPath }) as string;
            await invoke('open_folder', { path: full.replace(/[/\\][^/\\]*$/, '') });
            break;
        }

        // Bring a file in.
        //
        // The kind is worked out from the extension unless the task names one. Everything
        // else is shared: a URL is fetched with the source's credentials first, and the
        // passphrase is handed to whichever reader needs it.
        case 'import.file': {
            let path = String(p.path || '').trim();
            const url = String(p.url || '').trim();
            if (!path && !url) { toast(`${task.name}: ${t('sched.imp.nothing')}`, 'warning', 8000); break; }
            if (!path) {
                await applyCredsFor(url, p);
                path = await invoke('fetch_to_app_data', {
                    url, folder: 'imports', password: p.password || null, defaultExt: null,
                }) as string;
            }
            const ext = (path.split('.').pop() || '').toLowerCase();
            const kind = String(p.kind || 'auto') === 'auto'
                ? ({ mm: 'modlist', mmlist: 'modlist', bmmplug: 'plugin', bmmtheme: 'theme',
                     bmmpa: 'automation', databmm: 'backup', bmmbundle: 'bundle' } as Record<string, string>)[ext] || 'modlist'
                : String(p.kind);
            const pass = p.passphrase ? String(p.passphrase) : null;

            if (kind === 'modlist') {
                const { applyModList } = await import('../mods/modlist.js');
                // Installing is a separate question from importing: a task that only wants
                // the list read into BMM should not start downloading mods because the
                // action's name has "import" in it.
                if (p.apply) {
                    const r = await applyModList({ path, install: p.install !== false, exact: !!p.exact, passphrase: pass || undefined });
                    toast(`${task.name}: ${t('sched.listApply.done').replace('{on}', String(r.enabled)).replace('{new}', String(r.installed))}`, 'success', 8000);
                } else {
                    const list: any = await invoke('import_modlist', { path, passphrase: pass });
                    ctx.nums['import.count'] = Array.isArray(list?.mods) ? list.mods.length : 0;
                    ctx.text['import.name'] = String(list?.name || '');
                    toast(`${task.name}: ${t('sched.imp.read').replace('{n}', String(ctx.nums['import.count']))}`, 'success', 7000);
                }
            } else if (kind === 'plugin') {
                const r: any = await invoke('install_plugin_from_file', { filePath: path });
                ctx.text['import.name'] = String(r?.manifest?.name || '');
                toast(`${task.name}: ${t('sched.imp.plugin').replace('{p}', ctx.text['import.name'])}`, 'success', 8000);
            } else if (kind === 'theme') {
                await invoke('import_theme', { path });
                toast(`${task.name}: ${t('sched.imp.theme')}`, 'success', 6000);
            } else if (kind === 'automation') {
                const n = await importTasksFromPath(path);
                ctx.nums['import.count'] = n;
                toast(`${task.name}: ${t('sched.imp.tasks').replace('{n}', String(n))}`, 'success', 9000);
            } else if (kind === 'bundle') {
                // A .bmmbundle is a catalogue in a zip. It is FOLLOWED, not unpacked — what
                // it holds changes when its author republishes it.
                requirePerm(task, 'deeplink', t('sched.permDeeplink') || 'fire deeplinks');
                await runDeepLink(`bmm://catalog/follow?type=${encodeURIComponent(String(p.catType || 'plugin'))}`
                    + `&url=${encodeURIComponent('bundle:' + path)}`);
            } else if (kind === 'backup') {
                // Restoring OVERWRITES what is here. Unattended, that is the most
                // destructive thing in the scheduler, so it is not what the action does
                // unless the task says so in its own words — and by default it INSPECTS,
                // which is the useful half anyway ("did last night's backup come out right").
                const info: any = await invoke('inspect_data_bundle', { path, passphrase: pass });
                ctx.nums['import.count'] = Number(info?.sections?.length || 0);
                ctx.text['import.name'] = String(info?.created_at || '');
                if (!p.restore) {
                    toast(`${task.name}: ${t('sched.imp.checked').replace('{n}', String(ctx.nums['import.count']))}`, 'success', 8000);
                } else {
                    const r: any = await invoke('restore_data_bundle', {
                        args: { path, passphrase: pass, sections: Array.isArray(p.sections) ? p.sections : [] },
                    });
                    toast(`${task.name}: ${t('sched.imp.restored').replace('{n}', String((r?.restored || []).length))}`, 'warning', 14000);
                }
            } else {
                toast(`${task.name}: ${t('sched.imp.unknownKind').replace('{k}', kind)}`, 'warning', 8000);
            }
            break;
        }

        // Make an identity key.
        //
        // The name is what makes this safe to run on a schedule: an existing name is
        // REFUSED by the backend rather than overwritten, so a task that fires every week
        // makes one key and then does nothing, instead of quietly replacing the key you
        // prove with — which would lock you out of every source that has your public line.
        case 'key.create': {
            const name = String(p.name || '').trim();
            if (!name) { toast(`${task.name}: ${t('sched.key.noName')}`, 'warning', 8000); break; }
            try {
                const r = await invoke('key_auth_generate', { name, kind: p.kind || 'ed25519' }) as any;
                ctx.text['key.public'] = String(r?.public || '');
                ctx.text['key.path'] = String(r?.path || '');
                // Bound to a host straight away when the task named one, which is the whole
                // reason to make a key unattended: the sync that needs it is the next step.
                if (p.bindUrl) {
                    await invoke('key_auth_set_for_url', { url: String(p.bindUrl), name }).catch(() => undefined);
                }
                toast(`${task.name}: ${t('sched.key.made').replace('{k}', name)}`, 'success', 9000);
            } catch (e) {
                // errNameTaken is the ordinary outcome of a repeating task, not a failure.
                if (String(e).includes('errNameTaken')) {
                    toast(`${task.name}: ${t('sched.key.exists').replace('{k}', name)}`, 'info', 6000);
                } else { throw e; }
            }
            break;
        }

        // Follow a catalogue, or stop.
        //
        // Through the deeplink the interface's own screens use, so the source lands in the
        // following list with an origin and can be removed by the button that removes the
        // others — rather than being written straight into a store nothing else knows about.
        case 'catalog.follow': {
            const type = String(p.catType || 'plugin');
            const url = String(p.url || '').trim();
            if (!url) { toast(`${task.name}: ${t('sched.cat.noUrl')}`, 'warning', 8000); break; }
            requirePerm(task, 'deeplink', t('sched.permDeeplink') || 'fire deeplinks');
            await runDeepLink(`bmm://catalog/${p.unfollow ? 'unfollow' : 'follow'}`
                + `?type=${encodeURIComponent(type)}&url=${encodeURIComponent(url)}`);
            break;
        }

        // Set a game up to be watched.
        //
        // For DCS that means installing the hook, because DCS can be ASKED. For everything
        // else it means resolving which file to watch and putting it where the next steps
        // can read it — there is nothing to install, and pretending otherwise would be an
        // action that reports success for doing nothing.
        // Tasks saved before this existed still say `dcs.hook`. Falling through to the
        // default would make them silently do nothing, which for a watcher means the whole
        // automation stops firing with no error anywhere.
        //
        // @retired-action dcs.hook
        case 'dcs.hook':
        case 'game.watch': {
            const game = String(p.game || (action.type === 'dcs.hook' ? 'dcs' : 'custom'));
            if (String(p.mode || 'setup') === 'remove') {
                if (game !== 'dcs') { toast(`${task.name}: ${t('sched.gw.nothingToRemove')}`, 'info', 6000); break; }
                const n = Number(await invoke('dcs_remove_hook', { dir: p.dir || null }).catch(() => 0));
                toast(`${task.name}: ${t('sched.dcsHookOff').replace('{n}', String(n))}`, 'info', 6000);
                break;
            }
            let watch = String(p.path || '');
            if (game === 'dcs') {
                const r: any = await invoke('dcs_install_hook', { dir: p.dir || null });
                watch = watch || String((r?.watch || [])[0] || '');
                toast(`${task.name}: ${t('sched.dcsHookOk')
                    .replace('{n}', String((r?.installed || []).length))}`, 'success', 8000);
            }
            if (!watch) {
                // Named, and a warning. A "set up" step that quietly resolved to nothing is
                // the reason the task never fires, and it is the hardest thing to find later.
                toast(`${task.name}: ${t('sched.gw.noFile')}`, 'warning', 10000);
                break;
            }
            // Handed to the next steps rather than only reported: the point of this action is
            // that `text.extract` and the watch trigger use what it found.
            ctx.text['game.watchFile'] = watch;
            if (game !== 'dcs') toast(`${task.name}: ${t('sched.gw.ready').replace('{f}', watch.replace(/^.*[/\\]/, ''))}`, 'success', 7000);
            break;
        }

        // Poll an address until it answers, or give up.
        //
        // The point is the giving up. A wait with no ceiling is a task that hangs forever
        // and a scheduler that never runs the next one — and "still waiting" looks exactly
        // like "working" from outside.
        case 'wait.http': {
            const url = String(p.url || '').trim();
            if (!url) { toast(`${task.name}: ${t('sched.wait.noUrl')}`, 'warning', 8000); break; }
            const everyMs = Math.max(1000, Number(p.everySeconds || 5) * 1000);
            const untilMs = Date.now() + Math.max(everyMs, Number(p.timeoutSeconds || 300) * 1000);
            const wantStatus = Number(p.status || 0);
            let tries = 0;
            let ok = false;
            let lastStatus = 0;
            while (Date.now() < untilMs) {
                tries += 1;
                try {
                    // Same command the http.request action uses. It resolves any status
                    // rather than throwing on a 4xx/5xx, which is what makes "wait until it
                    // stops answering 503" expressible at all.
                    const r = await invoke('http_request', {
                        url, method: 'GET', headers: {}, body: null,
                        timeoutMs: Math.min(everyMs, 15000),
                    }) as any;
                    lastStatus = Number(r?.status || 0);
                    // Any 2xx by default; an exact code when the task named one — a service
                    // that answers 503 while starting is the case this exists for.
                    ok = wantStatus ? lastStatus === wantStatus : (lastStatus >= 200 && lastStatus < 300);
                } catch { ok = false; }
                if (ok) break;
                if (Date.now() + everyMs >= untilMs) break;
                await new Promise((r) => setTimeout(r, everyMs));
            }
            ctx.nums['wait.tries'] = tries;
            ctx.nums['wait.ok'] = ok ? 1 : 0;
            ctx.nums['http.status'] = lastStatus;
            if (!ok) {
                // Said out loud, with the last status. A silent give-up leaves the steps
                // after this running against something that never came up.
                toast(`${task.name}: ${t('sched.wait.gaveUp')
                    .replace('{n}', String(tries)).replace('{s}', String(lastStatus || '—'))}`, 'warning', 12000);
                if (p.stopOnTimeout !== false) throw new _StopTask(t('sched.wait.stopped'));
            }
            break;
        }

        // Wait for something to ring a named doorbell.
        //
        // `POST /api/hook` with that name wakes this up. Only rings from AFTER the wait
        // began count, so a task that runs hourly does not fire instantly on last hour's
        // signal.
        case 'wait.hook': {
            const name = String(p.name || '').trim();
            if (!name) { toast(`${task.name}: ${t('sched.wait.noName')}`, 'warning', 8000); break; }
            const since = Date.now();
            const everyMs = Math.max(500, Number(p.everySeconds || 2) * 1000);
            const untilMs = since + Math.max(everyMs, Number(p.timeoutSeconds || 300) * 1000);
            let hits: any[] = [];
            while (Date.now() < untilMs) {
                hits = await (invoke('hook_poll', { name, since }) as Promise<any[]>).catch(() => []);
                if (hits.length) break;
                if (Date.now() + everyMs >= untilMs) break;
                await new Promise((r) => setTimeout(r, everyMs));
            }
            ctx.nums['wait.ok'] = hits.length ? 1 : 0;
            if (hits.length) {
                // Whatever the caller sent, as text, so the next steps can read it. A
                // doorbell that could only say "somebody rang" would need a second channel
                // for the thing it rang about.
                const last = hits[hits.length - 1];
                ctx.text['hook.data'] = typeof last?.data === 'string' ? last.data : JSON.stringify(last?.data ?? null);
            } else {
                toast(`${task.name}: ${t('sched.wait.noSignal').replace('{h}', name)}`, 'warning', 12000);
                if (p.stopOnTimeout !== false) throw new _StopTask(t('sched.wait.stopped'));
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
        case 'repo.syncNow': {
            // A REAL sync, not a deeplink. Every other repo action here only opens the
            // UI prefilled, which is useless at 3am with nobody to press the button.
            //
            // The three directories are explicit parameters rather than resolved from
            // the active profile, and that is deliberate. The sync dialog does not
            // resolve them either — the user types or browses them — so there is no
            // existing, tested resolution to reuse, and inventing one here would put a
            // guess in front of `deleteExtra`. Same values, chosen by the same human,
            // once, when the task is written.
            if (!p.url || !p.gameDir || !p.modsDir) {
                throw new Error(t('sched.syncMissing') || 'This sync step needs a repo URL, a destination folder and a mods folder.');
            }

            // Bind the identity key this task names to this host, BEFORE the fetch — the
            // manifest itself is behind the gate on a protected repo, so binding after it
            // would be binding after the request that needed it.
            await applyCredsFor(String(p.url), p);

            // Resolve which profile INSIDE the repo to install. Fetching first also
            // answers the "repo with no repo.json" case with a real message instead of
            // a sync that runs against nothing.
            let info: any;
            try {
                info = await invoke('fetch_repo_info', {
                    url: p.url,
                    creatorId: await invoke('get_creator_id').catch(() => null),
                    password: p.password || null,
                });
            } catch (e) {
                throw new Error((t('sched.syncNoManifest') || 'Could not read that repo (no repo.json, or it is unreachable): {e}').replace('{e}', String(e)));
            }
            const repoProfiles: any[] = info?.profiles || [];
            const wanted = String(p.repoProfile || '').trim().toLowerCase();
            const chosen = wanted
                ? repoProfiles.find(rp => String(rp.id).toLowerCase() === wanted || String(rp.name || '').toLowerCase() === wanted)
                : (repoProfiles.length === 1 ? repoProfiles[0] : null);
            if (!chosen) {
                // Never guess which profile to install. Picking one from several would
                // install somebody's whole mod set into a folder on a timer.
                throw new Error((t('sched.syncPickProfile') || 'Name which repo profile to sync. Available: {list}')
                    .replace('{list}', repoProfiles.map(rp => rp.name || rp.id).join(', ') || '—'));
            }

            const summary = await invoke('sync_server_repo', { args: {
                url: p.url,
                creatorId: await invoke('get_creator_id').catch(() => null),
                password: p.password || null,
                gameDir: p.gameDir,
                modsDir: p.modsDir,
                backupDir: p.backupDir || '',
                choices: [{
                    repoProfileId: chosen.id,
                    // An existing local profile, never null. Null means "create new",
                    // which on a schedule would mint a fresh profile every single run.
                    targetLocalProfileId: p.targetProfile || null,
                    selectedModIds: null,
                }],
                // BOTH default OFF and stay off unless the task says otherwise. These
                // two are what turn a sync into data loss, and a scheduled task runs
                // when nobody is watching to stop it.
                overwriteAll: !!p.overwriteAll,
                deleteExtra: !!p.deleteExtra,
                downloadLimit: parseInt(p.downloadLimit, 10) || 0,
                unzipArchives: p.keepZipped ? false : true,
                addRepoAsUpdateSource: true,
            } });
            _captureOutput(p, (summary as any)?.installed ?? '', ctx);
            break;
        }
        // Rewrite repo.json for a folder that is already hosted.
        //
        // Real, not a deeplink: it reads the directory, writes one file and returns the diff,
        // which is exactly what a nightly "the folder changed, refresh the index" wants — and
        // it pairs with `repo.publishSsh` as the next step.
        case 'repo.manifest': {
            const dir = String(p.dir || '').trim();
            if (!dir) { toast(`${task.name}: ${t('sched.rm.noDir')}`, 'warning', 8000); break; }
            // The field names are the Rust struct's — `author`, not `author_name`, which is
            // what I wrote first. serde would have dropped the unknown key silently and the
            // manifest would have been published with no author on it.
            const report = await invoke('generate_repo_manifest', {
                args: {
                    mods_dir: dir,
                    name: String(p.name || '') || null,
                    author: String(p.author || '') || null,
                },
            }) as { mods: number; added: string[]; removed: string[]; changed: string[] };
            ctx.nums['manifest.mods'] = report.mods;
            ctx.nums['manifest.added'] = report.added.length;
            ctx.nums['manifest.removed'] = report.removed.length;
            ctx.nums['manifest.changed'] = report.changed.length;
            // `removed` is the one worth reading. A mistyped path and a deliberate removal
            // both write a perfectly valid manifest — one of them describing an empty server.
            toast(`${task.name}: ${t('sched.rm.done')
                .replace('{n}', String(report.mods))
                .replace('{a}', String(report.added.length))
                .replace('{r}', String(report.removed.length))
                .replace('{c}', String(report.changed.length))}`,
                report.removed.length ? 'warning' : 'success', report.removed.length ? 12000 : 8000);
            break;
        }
        case 'repo.gen':         dl('repo/gen'); break;
        case 'repo.update':      dl('repo/update', { dir: p.dir }); break;
        case 'repo.host':        dl('repo/host', { dir: p.dir, port: p.port }); break;
        case 'repo.publishSsh': {
            const { publishStoredTarget } = await import('../repo/repo-ssh.js');
            // WHICH server. BMM has held several named targets for a while and this action
            // always used the first one, so somebody with a staging box and a live box could
            // publish to exactly one of them from a task — and could not tell which.
            const sent = await publishStoredTarget(String(p.dir || ''), String(p.target || '') || undefined);
            ctx.nums['ssh.files'] = sent;
            _captureOutput(p, String(sent), ctx);
            break;
        }
        // The mirror of the above: keep a local folder in step with what the server serves.
        // No confirmation here, unlike the button and the deeplink — a scheduled task IS the
        // standing consent, and a prompt at 04:00 is a task that never finishes.
        case 'repo.fetchSsh': {
            const { pullStoredTarget } = await import('../repo/repo-ssh.js');
            const got = await pullStoredTarget(String(p.dir || ''), String(p.target || '') || undefined);
            ctx.nums['ssh.files'] = got;
            _captureOutput(p, String(got), ctx);
            break;
        }
        case 'app.install':      dl('app/install', { id: p.id, url: p.url, title: p.title }); break;
        case 'launchpack.run':   await invoke('run_launch_pack', { id: p.id }); break;
        case 'task.run':
            // Runs the sub-task to completion (it awaits), then records whether it
            // succeeded into ctx so a following IF / repeat can branch on the result
            // ("if task responded / did X"): value source `lasttask.ok` = 1 | 0.
            if (p.id) {
                await runTaskById(String(p.id));
                const sub = _tasks.find(tk => tk.id === p.id);
                ctx.nums['lasttask.ok'] = sub && sub.lastResult === 'ok' ? 1 : 0;
                if (sub) toast(`${t('sched.subTaskDone') || 'Sub-task finished'}: ${sub.name} → ${sub.lastResult}`, ctx.nums['lasttask.ok'] ? 'info' : 'warning');
            }
            break;
        case 'task.spawn': {
            // Starts the sub-task and moves on. `task.run` awaits, which is right when the
            // next step depends on the result — and wrong for anything long you only wanted
            // to set going.
            //
            // REFUSES a task that is already running, itself included. With `await`, a task
            // that runs itself recurses and eventually blows the stack: bad, bounded, and
            // visible. Without `await` it would spawn unbounded concurrent copies of itself
            // instantly, and the only symptom would be the machine getting slower. That
            // guard is what makes this action safe to offer at all.
            const id = String(p.id || '');
            if (!id) break;
            if (_running.has(id)) {
                toast(t('sched.spawnBusy') || 'That task is already running — not started again.', 'warning');
                ctx.nums['lasttask.spawned'] = 0;
                break;
            }
            // No await, and the rejection is handled here: an unhandled one from a detached
            // promise surfaces as a console error with no task name attached to it.
            void runTaskById(id).catch(() => { /* the sub-task records its own lastResult */ });
            ctx.nums['lasttask.spawned'] = 1;
            const spawned = _tasks.find(tk => tk.id === id);
            toast(`${t('sched.spawned') || 'Started in the background'}: ${spawned?.name || id}`, 'info');
            break;
        }
        case 'list.set': {
            // Replaces the whole list. `list.push` is the one that appends — a "set" that
            // quietly appended would make a task run twice produce a list twice as long.
            const name = String(p.name || 'list');
            ctx.lists = ctx.lists || {};
            ctx.lists[name] = parseList(p.value, String(p.sep || ','));
            // Two writes on purpose. The per-list name is for text substitution
            // ({list.mods.length} in a toast); `list.length` is the LAST list touched and is
            // the one a condition can pick, because VALUE_SOURCES is a fixed list and a
            // template-literal key can never appear in it. Without the fixed one, this value
            // is written and no condition can read it — and check-scheduler-vars cannot see a
            // dynamic key to tell you so.
            ctx.nums[`list.${name}.length`] = ctx.lists[name].length;
            ctx.nums['list.length'] = ctx.lists[name].length;
            break;
        }
        case 'list.push': {
            const name = String(p.name || 'list');
            ctx.lists = ctx.lists || {};
            const v = String(p.value ?? '').trim();
            if (v) (ctx.lists[name] = ctx.lists[name] || []).push(v);
            ctx.nums[`list.${name}.length`] = (ctx.lists[name] || []).length;
            ctx.nums['list.length'] = (ctx.lists[name] || []).length;
            break;
        }
        case 'list.clear': {
            const name = String(p.name || 'list');
            ctx.lists = ctx.lists || {};
            ctx.lists[name] = [];
            ctx.nums[`list.${name}.length`] = 0;
            ctx.nums['list.length'] = 0;
            break;
        }
        case 'map.set': {
            // Same two-writes trick as list.set, for the same reason: the per-name key is for
            // substitution ({map.urls.size} in a toast), and the fixed `map.size` is the one a
            // condition can pick, because VALUE_SOURCES is a literal list and a template key
            // can never appear in it.
            const name = String(p.name || 'map');
            const key = String(p.key ?? '').trim();
            ctx.maps = ctx.maps || {};
            const m = (ctx.maps[name] = ctx.maps[name] || {});
            // An empty key is refused rather than stored. `m[''] = v` is a real entry that no
            // `map.get` can ever ask for, and it would inflate the size a condition compares.
            if (!key) throw new Error(t('sched.map.noKey') || 'This step needs a key.');
            m[key] = String(p.value ?? '');
            ctx.nums[`map.${name}.size`] = Object.keys(m).length;
            ctx.nums['map.size'] = Object.keys(m).length;
            break;
        }
        case 'id.of': {
            // What a thing IS, as a variable an automation can compare.
            //
            // The local id is already knowable — the task was written with it in hand. The
            // content id is the one worth asking for: "is the pack on this machine the pack
            // I published", asked without downloading anything or trusting a name.
            const into = String(p.into || '').trim();
            if (!VAR_NAME_RE.test(into)) {
                throw new Error((t('sched.var.badName') || 'Not a usable variable name: {n}').replace('{n}', into || '(empty)'));
            }
            const kind = String(p.kind || '').trim();
            const id = String(p.id || '').trim();
            // Looked up by id in Rust, where each kind is defined once. Deliberately not
            // computed here from whatever the frontend happens to be holding: two
            // implementations of a content id is the failure the whole thing exists to
            // avoid.
            const cid = await invoke('content_id_of', { kind, id }) as string;
            ctx.text[into] = cid;
            break;
        }
        case 'map.get': {
            const name = String(p.name || 'map');
            const key = String(p.key ?? '').trim();
            const into = String(p.into || '').trim();
            if (!VAR_NAME_RE.test(into)) {
                throw new Error((t('sched.var.badName') || 'Not a usable variable name: {n}').replace('{n}', into || '(empty)'));
            }
            const m = (ctx.maps && ctx.maps[name]) || {};
            const hit = Object.prototype.hasOwnProperty.call(m, key);
            // A missing key writes an EMPTY value rather than leaving the target untouched.
            // Leaving it alone means a second read silently keeps the first read's answer, and
            // the task carries on with a value that belongs to another key entirely — the
            // hardest of the two to debug. `map.<name>.hit` says which happened, so a task
            // that cares can branch on it instead of guessing from an empty string.
            const value = hit ? m[key] : '';
            ctx.text[into] = value;
            const n = parseFloat(value);
            ctx.nums[into] = Number.isFinite(n) ? n : value.length;
            ctx.nums[`map.${name}.hit`] = hit ? 1 : 0;
            ctx.nums['map.hit'] = hit ? 1 : 0;
            break;
        }
        case 'map.clear': {
            const name = String(p.name || 'map');
            ctx.maps = ctx.maps || {};
            ctx.maps[name] = {};
            ctx.nums[`map.${name}.size`] = 0;
            ctx.nums['map.size'] = 0;
            break;
        }
        case 'telemetry.consent': dl('telemetry/consent', { enabled: b(p.enabled) }); break;
        case 'telemetry.set':    dl('telemetry/set', { replay: b(p.replay), full: b(p.full), bench: b(p.bench) }); break;
        case 'recorder.set':     dl('recorder/set', { on: b(p.on), full: b(p.full), rust: b(p.rust), js: b(p.js) }); break;
        case 'replay.export':    dl('replay/export'); break;
        case 'replay.import':    dl('replay/import', { path: p.path, url: p.url }); break;
        case 'discord.rpc':      dl('discord/rpc', { enabled: b(p.enabled) }); break;
        case 'data.exportAuto':  dl('data/export-auto', { dir: p.dir, name: p.name, increment: p.increment }); break;

        // The real backup: the same archive the Export data screen writes, with the same
        // sections and the same lock.
        case 'data.backup': {
            const { writeBackup, backupDestPath, DEFAULT_SECTIONS } = await import('./data-backup.js');
            const dir = String(p.dir || '');
            if (!dir) { toast(`${task.name}: ${t('sched.bk.noDir')}`, 'warning', 8000); break; }
            const sections = { ...DEFAULT_SECTIONS, ...(p.sections || {}) };
            // Refused HERE as well as inside writeBackup, so the message names the task. A
            // nightly job writing unlocked private keys to a synced folder would do it every
            // night, and the first anybody would know is when it had.
            if (sections.identityKeys && !p.passphrase) {
                toast(`${task.name}: ${t('settings.exportKeysNeedPass')}`, 'warning', 12000);
                break;
            }
            const dest = await backupDestPath(dir, p.name, p.increment, 'DATABMM');
            const r = await writeBackup(dest, sections, p.passphrase || null);
            const took = r.sections.filter((x) => x.files > 0).length;
            ctx.nums['backup.bytes'] = r.bytes;
            ctx.text['backup.path'] = r.path;
            toast(`${task.name}: ${t('sched.bk.done')
                .replace('{mb}', (r.bytes / 1048576).toFixed(1))
                .replace('{n}', String(took))
                .replace('{f}', String(r.path).replace(/^.*[/\\]/, ''))}`, 'success', 9000);
            break;
        }
        case 'restart':          dl('restart'); break;
        case 'app.checkUpdate': {
            const info: any = await invoke('check_for_update', { includePrerelease: !!p.enabled });
            ctx.nums['update.available'] = info?.has_update ? 1 : 0;
            if (info?.has_update) toast(`${task.name}: ${t('sched.updateAvail') || 'update available'} — v${info.latest_version}`, 'info');
            break;
        }
        case 'system.clearApiLog': await invoke('clear_api_log'); break;
        case 'system.clearResourceRecords': await invoke('clear_resource_records'); break;
        case 'perf.diskSpace': {
            const mount = p.mountPoint || (await firstDiskMount());
            if (!mount) throw new Error('No disk to check');
            const r: any = await invoke('check_disk_space', { path: mount });
            ctx.nums['disk.free_gb'] = Math.round((r?.available_bytes || 0) / 1073741824 * 10) / 10;
            ctx.nums['disk.total_gb'] = Math.round((r?.total_bytes || 0) / 1073741824 * 10) / 10;
            ctx.nums['disk.free_percent'] = Math.round((r?.free_percent || 0) * 10) / 10;
            toast(`${task.name}: ${mount} — ${ctx.nums['disk.free_gb']} GB ${t('sched.free') || 'free'} (${ctx.nums['disk.free_percent']}%)`, 'info');
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
//
// `task` is threaded through so a condition can ask what the task is PERMITTED to do.
// It could not before, and the consequence was not theoretical: `commandSucceeds` passed
// `allow: true` to run_scheduled_command, so a condition could spawn any program on the
// machine while the ACTION that runs a program refused without the `command` permission. A
// shared .bmmpa needed only to put its command in an `if` instead of a step.
//
// Optional, because `var.ternary` and the editor's preview evaluate conditions outside a run.
// Absent means "no task vouched for this", which is treated as no permission — the safe
// direction, and the one that makes forgetting to thread it fail closed.
async function evalCondition(cond: Condition, ctx: RunCtx = { nums: {}, text: {} }, task?: Task): Promise<boolean> {
    let r = await evalConditionRaw(cond, ctx, task);
    return cond.negate ? !r : r;
}
async function evalConditionRaw(cond: Condition, ctx: RunCtx, task?: Task): Promise<boolean> {
    const p = cond.params || {};
    const now = new Date();
    /** Refuse unless the task granted this. No task = nobody granted anything. */
    const needPerm = (key: keyof TaskPerms, what: string) => {
        if (!task) {
            throw new Error(t('sched.cond.noTask')
                || 'This condition needs a permission, and it is being evaluated outside a task.');
        }
        requirePerm(task, key, what);
    };
    switch (cond.type) {
        case 'always': return true;
        // ── Boolean groups ───────────────────────────────────────────────────────────
        //
        // "Run this when the game is closed AND it is after 18:00 AND a backup exists" had
        // to be written as three nested ifs, each with its own else — and the moment one
        // needed an OR it became a switch whose cases repeated most of each other. Every
        // condition in this file answers about ONE thing, which is right; what was missing
        // was a way to say "these together".
        //
        // `all` and `any` hold a list of conditions in `params.of` and are themselves
        // conditions, so they nest, and `negate` (which every condition already has) gives
        // NOT. That is the whole of boolean algebra in two more types and no new concept.
        //
        // Short-circuiting is deliberate and not just for speed: a condition can run a
        // command or reach the network, and "A AND B" must not run B when A already
        // decided. An EMPTY group is `true` for `all` and `false` for `any` — the standard
        // reading, and the one that makes a half-built group in the editor behave
        // predictably rather than blocking the task.
        case 'all': {
            const of: Condition[] = Array.isArray(p.of) ? p.of : [];
            for (const c of of) { if (!(await evalCondition(c, ctx, task))) return false; }
            return true;
        }
        case 'any': {
            const of: Condition[] = Array.isArray(p.of) ? p.of : [];
            for (const c of of) { if (await evalCondition(c, ctx, task)) return true; }
            return false;
        }
        case 'enumIs': {
            // The typed subject a switch needs. Compares a VARIABLE against one declared
            // member of one declared enum, so the editor can later look at a switch's cases
            // and say which members are unhandled — which free-text comparison can never
            // support, because nothing states what the branch is about.
            const val = readVar(ctx, String(p.name || ''));
            if (!val) return false;
            // Compared as text on purpose. A member is a label, not a quantity: `>` on
            // `failed` has no meaning, and coercing here would make `0` equal `` .
            return renderVar(val) === String(p.member ?? '');
        }
        case 'value': {
            // Compare a captured value (e.g. disk.write_mbps, benchmark.mbps) to a threshold.
            const left = readNum(ctx, String(p.source)) ?? NaN;
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
        case 'fileIsValid': {
            const r = await invoke('bmm_validate', { path: p.path || null, text: null })
                .catch(() => null) as { format: string; ok: boolean } | null;
            if (!r) return false;
            const want = String(p.expect || '').trim();
            return r.ok && (!want || want === r.format);
        }
        case 'modWins': {
            // True when this mod wins EVERY file it contests. Written for `ensure`:
            //
            //     ensure modWins(id: "big-map-pack") {
            //         do mods.order(id: "big-map-pack", mode: "last")
            //     }
            //
            // A mod that contests nothing wins vacuously, which is the right answer — there is
            // nothing to be losing.
            const [mods] = await invoke('mod_order_get', { profileId: null })
                .catch(() => [[], []]) as [{ id: string; contested: number; winning: number }[], unknown];
            const me = (mods || []).find((m) => m.id === p.id);
            if (!me) return false;
            return me.winning >= me.contested;
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
            return await invoke('is_process_running', { name: p.name || '', pid: p.pid || null }).catch(() => false);
        case 'appNotRunning':
            return !(await invoke('is_process_running', { name: p.name || '', pid: p.pid || null }).catch(() => false));
        case 'fileExists':
            return await invoke('path_exists', { path: p.path || '' }).catch(() => false);
        // Is this text in the end of that file?
        //
        // The tail, for the same reason text.extract reads the tail: what a game just did is
        // at the end of its log, and "somewhere in 300 MB" is a different question with a
        // different answer — usually yes, for every server you have ever joined.
        case 'fileContains': {
            const hay = String(await invoke('read_text_tail', {
                path: String(p.path || ''), kb: Number(p.tailKb) || 64,
            }).catch(() => ''));
            if (!hay) return false;
            const needle = String(p.text || '');
            if (!needle) return false;
            if (p.regex) {
                try { return new RegExp(needle, 'i').test(hay); } catch { return false; }
            }
            return hay.toLowerCase().includes(needle.toLowerCase());
        }
        // Compare a TEXT variable. `value` only ever compared numbers, so a task that had
        // just extracted a server name had no way to branch on it — the name became its
        // length and every comparison was quietly false.
        case 'textIs': {
            const left = String(ctx.text[String(p.source || '')] ?? '');
            const right = String(p.value ?? '');
            switch (String(p.op || 'is')) {
                case 'is': return left.toLowerCase() === right.toLowerCase();
                case 'isNot': return left.toLowerCase() !== right.toLowerCase();
                case 'contains': return left.toLowerCase().includes(right.toLowerCase());
                case 'empty': return left.trim() === '';
                case 'notEmpty': return left.trim() !== '';
                case 'matches':
                    try { return new RegExp(right, 'i').test(left); } catch { return false; }
                default: return false;
            }
        }
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
            // Gated like the action that runs a program, which it is. `allow: true` was
            // hardcoded here, so this condition ran arbitrary programs with no permission at
            // all — the one hole that made the `command` permission optional in practice,
            // since a command in an `if` was never asked about.
            //
            // The refusal is thrown, not swallowed into `false`: a task denied a permission
            // has not evaluated to "no", it has failed, and reporting it as "no" would send
            // somebody looking for why their program returned non-zero.
            needPerm('command', t('sched.perm.command') || 'run a program');
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
        case 'pathIsDir': {
            // `fileExists` is true for a folder too — Path::exists() does not distinguish —
            // so "is this a file or a directory?" had no answer. file_meta already carries
            // is_dir; nothing needed the backend, only asking.
            const m: any = await invoke('file_meta', { path: p.path || '' }).catch(() => null);
            if (!m || !m.exists) return false;
            return p.want === 'file' ? !m.is_dir : !!m.is_dir;
        }
        case 'filesMatch': {
            // Every file in a LIST still hashes to what a MAP says it should.
            //
            // fileHash answers for one file against one literal, which is no use for "did
            // anything under this profile change?" — the question people actually have. The
            // list holds the paths, the map holds path → hash, and both are ordinary
            // scheduler variables, so a previous step can fill them.
            //
            // A path in the list with no entry in the map is a MISMATCH, not a skip: a
            // manifest that silently ignores what it does not mention verifies nothing.
            const paths = ctx.lists?.[String(p.list || '')] || [];
            const want = ctx.maps?.[String(p.map || '')] || {};
            if (!paths.length) return !!p.emptyIsTrue;
            for (const path of paths) {
                const expected = String(want[path] || '').toLowerCase().replace(/^b3:/, '').trim();
                if (!expected) return false;
                try {
                    const h = await invoke('hash_file', { path, algo: p.algo || 'blake3' }) as string;
                    if ((h || '').toLowerCase() !== expected) return false;
                } catch { return false; }   // unreadable is not "unchanged"
            }
            return true;
        }
        // ── Reachability ───────────────────────────────────────────────────────
        case 'catalogOk':
        case 'repoOk': {
            // Does this address answer, and is it the kind of document it claims to be?
            //
            // Gated on `command` for the same reason http.request is: a condition that
            // fetches a URL can be pointed anywhere by whoever shared the .bmmpa, and a
            // network read nobody granted would make the other permissions decorative.
            needPerm('command', t('sched.perm.net') || 'reach the network');
            // http_request, NOT fetch_remote_json: that one goes through catalog_get, which
            // attaches the user's X-Creator-ID for first-party hosts. A URL out of a shared
            // task must not be able to borrow the reader's identity.
            const url = String(p.url || '').trim();
            if (!/^https?:\/\//i.test(url)) return false;
            const target = cond.type === 'repoOk' && !/\.json($|\?)/i.test(url)
                ? `${url.replace(/\/+$/, '')}/repo.json`
                : url;
            try {
                const rep: any = await invoke('http_request', {
                    url: target, method: 'GET', headers: {}, body: null, timeoutMs: 15000,
                });
                if (!rep || rep.status < 200 || rep.status >= 300) return false;
                if (p.shapeless) return true;   // "it answered 2xx" is sometimes the whole question
                const doc = JSON.parse(rep.body || 'null');
                if (cond.type === 'repoOk') {
                    // A repo document, or a catalogue listing repos — both are "the repo
                    // answered" for a caller that just wants to know before syncing.
                    return !!doc && (Array.isArray(doc.mods) || Array.isArray(doc.repos) || typeof doc.name === 'string');
                }
                return catalogLooksLike(doc, String(p.kind || 'any'));
            } catch { return false; }
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

/** Thrown when somebody presses Stop. Distinct from _StopTask so the history can tell a
 *  guard clause ("this task decided to end early") from an interruption ("a person ended
 *  it"). Recording both as a clean finish would hide the second one entirely. */
class _CancelledTask { constructor(public at = '') {} }

/**
 * What is running, right now.
 *
 * There was no answer to that question. A task that takes four minutes showed nothing at
 * all until it finished, so "is it stuck, or is it working?" could only be answered by
 * waiting — and a task that WAS stuck, on a wait-until that would never come true, could
 * not be ended without closing BMM.
 *
 * A module-level map rather than state on the Task: a task can legitimately be running
 * while its saved definition is being edited, and the two must not share a field.
 */
export interface RunState {
    id: string;
    name: string;
    startedAt: number;
    /** Human label for the step being executed, e.g. "Call an HTTP API". */
    step: string;
    /** How deep in the tree — an action inside a loop inside an if reads as 3. */
    depth: number;
    /** Completed top-level steps, and how many there are. */
    done: number;
    total: number;
    /** Set by requestStop. Checked between steps; see the note on cooperative stopping. */
    cancel: boolean;
}

const _running = new Map<string, RunState>();

export function listRunning(): RunState[] {
    return [..._running.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Ask a run to stop.
 *
 * Cooperative, and the UI says so. The flag is checked between steps, so a step already in
 * flight finishes first — an HTTP request mid-flight is not abandoned, a script already
 * launched is not killed. Interrupting those would leave the outside world in a state
 * nothing here knows how to describe, which is worse than waiting a few seconds. Delays and
 * wait-untils poll the flag, so the common "waiting five minutes" case ends promptly.
 */
export function requestStop(id: string): boolean {
    const r = _running.get(id);
    if (!r) return false;
    r.cancel = true;
    return true;
}

/** A step, in words, for the running panel. Falls back to the kind rather than to a blank —
 *  "repeat" tells you where you are; an empty string does not. */
function stepLabel(step: Step): string {
    if (step.kind === 'action') {
        const type = String((step as any).action?.type || '');
        const def = ACTION_TYPES.find((a) => a.v === type);
        return def ? (t('sched.act.' + def.v) || def.label) : (type || 'action');
    }
    const words: Record<string, string> = {
        if: t('sched.addIf') || 'If/Else',
        repeat: t('sched.addLoop') || 'Loop',
        waitFor: t('sched.addWaitFor') || 'Wait until',
        delay: t('sched.addDelay') || 'Pause',
        ensure: t('sched.addEnsure'),
        retry: t('sched.addRetry'),
    };
    return words[step.kind] || step.kind;
}

// ── Safe math expression evaluator (no eval) ─────────────────────────────────
// Supports + - * / % ^, parentheses, ctx variables, and a few pure functions.
// A tiny recursive-descent parser — never executes arbitrary code.
const _MATH_FUNCS: Record<string, (...a: number[]) => number> = {
    min: Math.min, max: Math.max, abs: Math.abs, round: Math.round, floor: Math.floor,
    ceil: Math.ceil, sqrt: Math.sqrt, pow: Math.pow, sign: Math.sign,
    clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
};
function evalExpr(expr: string, ctx: RunCtx): number {
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
            return readNum(ctx, t) ?? 0;
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
        case 'watchFile': return P('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="15" r="2"/>');
        // A bell: BMM telling you, rather than you going to look.
        case 'onEvent': return P('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>');
        case 'appStart':  return P('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>');
        case 'manual':    return P('<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>');
    }
}

/**
 * The "running now" strip, above the task list.
 *
 * Its own element and its own render, deliberately: it repaints on every step of every run,
 * and repainting the whole task list at that rate would fight with anything the person is
 * doing in it — a toggle mid-click, a tooltip mid-hover.
 *
 * Absent entirely when nothing is running. A permanent "0 running" row is a line of screen
 * that is noise in the normal case, and the normal case is nothing running.
 */
export function renderRunningPanel(): void {
    const host = document.getElementById('scheduler-running');
    if (!host) return;
    const runs = listRunning();
    if (!runs.length) { host.innerHTML = ''; host.style.display = 'none'; return; }
    host.style.display = '';
    const esc = (x: unknown) => escHtml(String(x ?? ''));
    host.innerHTML = `
        <div class="sched-run-head">${esc(t('sched.run.title') || 'Running now')}</div>
        ${runs.map((r) => {
            const secs = Math.max(0, Math.round((Date.now() - r.startedAt) / 1000));
            // The step number is capped at the total: a loop re-entering top-level steps
            // could otherwise print "5 of 4", which reads as a bug in the counter.
            const pos = r.total ? `${Math.min(r.done, r.total)}/${r.total}` : '';
            return `
            <div class="sched-run-row${r.cancel ? ' is-stopping' : ''}">
                <span class="sched-run-spin"></span>
                <span class="sched-run-name">${esc(r.name)}</span>
                <span class="sched-run-step">${esc(r.step)}${r.depth ? ` <span class="sched-run-depth">↳${r.depth}</span>` : ''}</span>
                <span class="sched-run-pos">${esc(pos)}</span>
                <span class="sched-run-age">${secs}s</span>
                <button class="btn btn-xs btn-ghost sched-run-stop" data-stop="${escAttr(r.id)}" ${r.cancel ? 'disabled' : ''}
                    data-tooltip="${escAttr(t('sched.run.stopTip') || 'Ends the run after the current step finishes — a request already sent is not abandoned.')}">
                    ${r.cancel ? esc(t('sched.run.stopping') || 'stopping…') : esc(t('sched.run.stop') || 'Stop')}
                </button>
            </div>`;
        }).join('')}`;
    host.querySelectorAll<HTMLElement>('.sched-run-stop').forEach((b) => b.addEventListener('click', () => {
        if (requestStop(String(b.dataset.stop))) renderRunningPanel();
    }));
}

/**
 * Keep the elapsed counter honest while a run is in flight.
 *
 * A run that sits on one long step would otherwise show a frozen age, which reads as a
 * hung UI rather than a slow step. The timer only exists while something is running — a
 * permanent interval for a panel that is empty most of the time is a permanent cost.
 */
let _runTick: number | null = null;
export function ensureRunTicker(): void {
    if (_runTick !== null) return;
    _runTick = window.setInterval(() => {
        if (!_running.size) { window.clearInterval(_runTick!); _runTick = null; }
        renderRunningPanel();
    }, 1000);
}

export function renderScheduleList(): void {
    const container = document.getElementById('scheduler-list-container');
    if (!container) return;
    renderRunningPanel();
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

    // A filter, but only once there are enough tasks to need one.
    //
    // Below the threshold it would be furniture: three rows are faster to read than to
    // filter, and a search box above them is one more thing between you and the task you
    // came for. Above it, scanning a wall of rows is the actual problem.
    const NEEDS_FILTER_AT = 8;
    let shown = _tasks;
    if (_tasks.length >= NEEDS_FILTER_AT) {
        const bar = document.createElement('div');
        bar.className = 'sched-filter';
        bar.innerHTML = `
            <input type="text" class="input sched-filter-input" id="sched-filter-input"
                placeholder="${escAttr(t('sched.filter') || 'Filter tasks…')}" value="${escAttr(_taskFilter)}">
            <span class="sched-filter-count" id="sched-filter-count"></span>`;
        container.appendChild(bar);
        const inp = bar.querySelector('#sched-filter-input') as HTMLInputElement;
        inp.addEventListener('input', () => {
            _taskFilter = inp.value;
            renderScheduleList();
            // Re-rendering replaces the field, so focus and caret have to be put back or
            // typing a second character lands nowhere.
            const again = document.getElementById('sched-filter-input') as HTMLInputElement | null;
            if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        });
        const needle = _taskFilter.trim().toLowerCase();
        if (needle) {
            // Name and description: the two things somebody remembers about a task they
            // wrote weeks ago.
            shown = _tasks.filter((tk) => `${tk.name} ${tk.description || ''}`.toLowerCase().includes(needle));
        }
        const count = bar.querySelector('#sched-filter-count');
        if (count) {
            count.textContent = needle
                ? (t('sched.filter.n') || '{n} of {total}').replace('{n}', String(shown.length)).replace('{total}', String(_tasks.length))
                : (t('sched.filter.total') || '{total} tasks').replace('{total}', String(_tasks.length));
        }
        if (!shown.length) {
            const none = document.createElement('div');
            none.className = 'sched-filter-none';
            none.textContent = t('sched.filter.none') || 'No task matches that.';
            container.appendChild(none);
            return;
        }
    }

    const I = (d: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    for (const task of shown) {
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
                        ${nextRunChip(task)}
                        <span class="sched-chip">${stepCount(task.steps)} ${t('sched.steps') || 'steps'}</span>
                        ${task.lastRun ? `<span class="sched-chip sched-chip-dim" data-tooltip="${escAttr(new Date(task.lastRun).toLocaleString())}">${t('sched.last') || 'last'} ${escHtml(agoTime(task.lastRun))}</span>` : ''}
                        ${task.lastResult ? `<span class="sched-chip ${task.lastResult === 'ok' ? 'sched-chip-ok' : 'sched-chip-err'}" data-tooltip="${escAttr(task.lastResult)}">${task.lastResult === 'ok' ? 'OK' : 'ERR'}</span>` : ''}
                        ${runSparkline(task)}
                    </span>
                </div>
            </div>
            <div class="sched-row-actions">
                ${copyIdButtons('task', task.id)}
                <label class="plug-toggle sched-toggle" data-tooltip="${escAttr(task.enabled ? (t('sched.enabled') || 'Enabled') : (t('sched.disabled') || 'Disabled'))}">
                    <input type="checkbox" ${task.enabled ? 'checked' : ''} data-act="toggle">
                    <span class="plug-toggle-slider"></span>
                </label>
                <button class="btn btn-xs btn-ghost sched-act" data-act="run" data-tooltip="${escAttr(t('sched.runNow') || 'Run now')}">${I('<polygon points="5 3 19 12 5 21 5 3"/>')}</button>
                <button class="btn btn-xs btn-ghost sched-act" data-act="dup" data-tooltip="${escAttr(t('sched.dupTask') || 'Duplicate task')}">${I('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')}</button>
                <button class="btn btn-xs btn-ghost sched-act" data-act="exp1" data-tooltip="${escAttr(t('sched.exportOne') || 'Export this automation')}">${I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>')}</button>
                <button class="btn btn-xs btn-ghost sched-act" data-act="edit" data-tooltip="${escAttr(t('common.edit') || 'Edit')}">${I('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>')}</button>
                <button class="btn btn-xs btn-ghost sched-act sched-act-del" data-act="del" data-tooltip="${escAttr(t('common.delete') || 'Delete')}">${I('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')}</button>
            </div>`;
        wireCopyIds(row, toast);
        row.querySelector('[data-act="toggle"]')?.addEventListener('change', async (e) => {
            task.enabled = (e.target as HTMLInputElement).checked; await saveTasks();
            if (task.osSchedule) await syncOsSchedule(task);
        });
        row.querySelector('[data-act="run"]')?.addEventListener('click', () => runTask(task));
        row.querySelector('[data-act="exp1"]')?.addEventListener('click', () => { void exportOneTask(task.id); });
        // Duplicate: full deep clone under a new id. Deliberately created DISABLED
        // and without the OS mirror so saving the copy can't double-fire anything.
        row.querySelector('[data-act="dup"]')?.addEventListener('click', async () => {
            const copy: Task = JSON.parse(JSON.stringify(task));
            copy.id = `sched-${Date.now()}`;
            copy.name = `${task.name} ${t('sched.copySuffix') || '(copy)'}`;
            copy.enabled = false;
            copy.osSchedule = false;
            copy.lastRun = undefined; copy.lastResult = undefined; copy.history = [];
            copy.createdAt = Date.now();   // a copy is a new task, not a replay of the old one
            _tasks.push(copy);
            await saveTasks();
            renderScheduleList();
            toast(`${t('sched.duplicated') || 'Duplicated'}: ${copy.name}`, 'success');
        });
        row.querySelector('[data-act="edit"]')?.addEventListener('click', () => openTaskModal(task));
        row.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
            try {
                // Not `confirmCustom!`. The non-null assertion silences the compiler about a
                // value that is only there because another module ran first; if it ever is not,
                // the call throws inside an async listener and the button appears inert.
                const ask = window.confirmCustom;
                // askConfirm, not window.confirm: the latter does not ask anything inside the
                // Tauri webview, it returns immediately — which is precisely how this button
                // came to do nothing at all.
                const ok = typeof ask === 'function'
                    ? await ask(t('sched.delTitle') || 'Delete task', `${task.name}?`, 'danger',
                        { yesLabel: t('common.delete') || 'Delete', noLabel: t('common.cancel') || 'Cancel' })
                    : await askConfirm(`${task.name}?`, { title: t('sched.delTitle') || 'Delete task' });
                if (!ok) return;
                if (task.osSchedule) {
                    // An OS entry that will not unregister must not stop the task being
                    // removed from BMM — it is reported and the deletion continues.
                    try { await invoke('unregister_os_schedule', { taskId: task.id }); }
                    catch (e) { toast(`${t('sched.osUnregFail') || 'Could not remove the Windows task'}: ${e}`, 'error'); }
                }
                _tasks = _tasks.filter(x => x.id !== task.id);
                await saveTasks();
                renderScheduleList();
            } catch (e) {
                // The point of this catch: a delete that fails now SAYS SO. Before it could
                // only ever look like a button that does nothing.
                toast(`${t('common.error') || 'Error'}: ${e}`, 'error');
            }
        });
        container.appendChild(row);
    }
}

/** "in 4 min" / "in 3 h" / "in 2 d" — a duration a human reads at a glance. The exact
 *  timestamp goes in the tooltip, because the useful question is almost always "soon or
 *  not", and only occasionally "at exactly what time". */
function relTime(ms: number): string {
    const d = Math.max(0, ms - Date.now());
    const mins = Math.round(d / 60000);
    if (mins < 1) return t('sched.inMoment') || 'in under a minute';
    if (mins < 60) return `${t('sched.in') || 'in'} ${mins} min`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${t('sched.in') || 'in'} ${hrs} h`;
    return `${t('sched.in') || 'in'} ${Math.round(hrs / 24)} ${t('sched.days') || 'd'}`;
}

/** "3 min ago" / "2 h ago" — the mirror of relTime, for the last run. A full
 *  locale timestamp took a third of the row to say "recently". */
function agoTime(ms: number): string {
    const d = Math.max(0, Date.now() - ms);
    const mins = Math.round(d / 60000);
    if (mins < 1) return t('sched.justNow') || 'just now';
    if (mins < 60) return `${mins} min ${t('sched.ago') || 'ago'}`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs} h ${t('sched.ago') || 'ago'}`;
    return `${Math.round(hrs / 24)} ${t('sched.days') || 'd'} ${t('sched.ago') || 'ago'}`;
}

/** The last few runs as bars: green ok, red failed, oldest on the left. A task that
 *  fails every other night looks identical to a healthy one when all you keep is the
 *  MOST RECENT result — the history was already being recorded and only the editor
 *  ever showed it. */
function runSparkline(task: Task): string {
    const h = (task.history || []).slice(-8);
    if (h.length < 2) return '';
    const bars = h.map(r => `<i class="${r.ok ? 'ok' : 'err'}"${r.err ? ` data-tooltip="${escAttr(r.err)}"` : ''}></i>`).join('');
    const bad = h.filter(r => !r.ok).length;
    const label = bad
        ? (t('sched.sparkFails') || '{n} of the last {m} runs failed').replace('{n}', String(bad)).replace('{m}', String(h.length))
        : (t('sched.sparkOk') || 'last {m} runs all fine').replace('{m}', String(h.length));
    return `<span class="sched-spark" data-tooltip="${escAttr(label)}">${bars}</span>`;
}

/**
 * When this task runs next — or why it does not.
 *
 * It used to return nothing at all for a disabled task, a manual one, a file watch or an event
 * trigger. That is four of the ways a task can be sitting in the list doing nothing, each shown
 * as an empty space, and "why has this not run" is the most common question anybody asks a
 * scheduler.
 *
 * A time is still a time. Everything else gets the reason, in the same slot.
 */
function nextRunChip(task: Task): string {
    const at = task.enabled && task.trigger.type !== 'manual' ? nextDue(task) : null;
    if (at !== null) {
        return `<span class="sched-chip sched-chip-next" data-tooltip="${escAttr(new Date(at).toLocaleString())}">${escHtml(relTime(at))}</span>`;
    }
    const why = whyNotRunning(task);
    const said = t(why.key).replace('{v}', why.v || '');
    // Muted, not coloured: none of these is an error. A manual task that says "only when you
    // press Run" is working exactly as intended, and a red chip would say otherwise.
    return `<span class="sched-chip sched-chip-why" data-tooltip="${escAttr(said)}">${escHtml(said)}</span>`;
}

function stepCount(steps: Step[]): number {
    let n = 0;
    for (const s of steps || []) {
        n++;
        if (s.kind === 'if') n += stepCount(s.then) + stepCount(s.else);
        else if (s.kind === 'repeat' || s.kind === 'forEach') n += stepCount(s.steps);
        else if (s.kind === 'switch') n += stepCount(s.default) + (s.cases || []).reduce((acc, c) => acc + stepCount(c.steps), 0);
        else if (s.kind === 'try') n += stepCount(s.steps) + stepCount(s.onError);
        else if (s.kind === 'ensure') n += stepCount(s.steps);
        else if (s.kind === 'retry') n += stepCount(s.steps);
        else if (s.kind === 'parallel') n += (s.branches || []).reduce((acc, b) => acc + stepCount(b), 0);
    }
    return n;
}
/** Short weekday names for the weekly chip, Sunday first to match Date.getDay(). */
function dowNames(): string[] {
    return [0, 1, 2, 3, 4, 5, 6].map((i) => t(`sched.dow${i}`) || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]);
}

/** The trigger, as a sentence.
 *
 *  It used to reuse the trigger PICKER's button labels as sentence prefixes, so an hourly
 *  task's chip read "Every N minutes 1 h" and a daily one "Daily at time 03:00" — the
 *  literal placeholder text, with the real value appended. They are separate strings now
 *  because they are separate jobs: one names a choice, the other describes a schedule.
 *
 *  Weekly also SAYS WHICH DAYS. It never did, so "Weekly 20:00" was the same chip whether
 *  the task ran on Mondays or every day but Monday. */
function triggerLabel(tr: Trigger): string {
    switch (tr.type) {
        case 'once': return `${t('sched.lblOnce') || 'Once on'} ${new Date(tr.at).toLocaleString()}`;
        case 'interval': return `${t('sched.lblEvery') || 'Every'} ${tr.everyMinutes} min`;
        case 'hourly': return `${t('sched.lblEvery') || 'Every'} ${tr.everyHours} h`;
        case 'dailyAt': return `${t('sched.lblDaily') || 'Daily at'} ${tr.time}`;
        case 'weeklyAt': {
            const names = dowNames();
            const days = [...(tr.days || [])].sort((a, b) => a - b).map((d) => names[d]).filter(Boolean);
            // Every day selected is "daily", not a seven-item list.
            const when = days.length === 7 ? (t('sched.lblEveryDay') || 'every day') : days.join(', ');
            return when
                ? `${when} ${t('sched.lblAt') || 'at'} ${tr.time}`
                : `${t('sched.lblWeeklyNoDay') || 'Weekly — no day picked'}`;
        }
        case 'monthlyAt': return `${t('sched.lblMonthly') || 'Day'} ${tr.day} ${t('sched.lblAt') || 'at'} ${tr.time}`;
        case 'appStart': return t('sched.trAppStart') || 'On BMM start';
        case 'watchFile': {
            const name = String(tr.path || '').replace(/^.*[\\/]/, '');
            return name
                ? `${t('sched.trWatch') || 'When a file changes'}: ${name}`
                : (t('sched.trWatchNoPath') || 'When a file changes — no file picked');
        }
        case 'onEvent': {
            const ev = String(tr.event || '').trim();
            return ev ? `${t('sched.trEvent')}: ${ev}` : t('sched.trEventNone');
        }
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
    if (step.kind === 'ensure') return (step.steps?.length || 0) > 0;
    if (step.kind === 'retry') return (step.steps?.length || 0) > 0;
    if (step.kind === 'parallel') return (step.branches || []).some((b) => b.length > 0);
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

/**
 * Ready-made tasks, offered when creating a new one.
 *
 * The scheduler can express a great deal and an empty editor shows none of it: the first
 * screen is a name field and an "add step" button, which teaches nothing about what a
 * task can be. Each preset is a real, complete task that does something worth doing on
 * its own — not a demo — so it can be saved unchanged or used as a starting point.
 *
 * Every action type, parameter name, condition source and trigger shape below was read
 * out of runAction/VALUE_SOURCES rather than remembered. A preset with an invented field
 * would be worse than no preset: it is presented as the correct way to do the thing.
 *
 * Nothing here needs a permission. A preset that arrives already asking to run scripts or
 * kill processes trains people to grant those without reading, which is the opposite of
 * what splitting the permissions was for — the two that touch other programs are written
 * so the user has to grant it deliberately, and say so in their description.
 */
/** What a preset is FOR. The picker groups by this, and the order below is the order the
 *  groups appear in: what you came for first, the housekeeping after it. */
type PresetCat = 'mods' | 'upkeep' | 'watch' | 'repo' | 'advanced';
const PRESET_CATS: { cat: PresetCat; label: string; key: string }[] = [
    { cat: 'mods', key: 'sched.presetCat.mods', label: 'Mods & profiles' },
    { cat: 'upkeep', key: 'sched.presetCat.upkeep', label: 'Backups & upkeep' },
    { cat: 'watch', key: 'sched.presetCat.watch', label: 'Watching something' },
    { cat: 'repo', key: 'sched.presetCat.repo', label: 'Repos & syncing' },
    { cat: 'advanced', key: 'sched.presetCat.advanced', label: 'Chains & variables' },
];

const PRESETS: { cat: PresetCat; key: string; icon: string; title: string; desc: string; make: () => Partial<Task> }[] = [
    {
        // Two presets for the same idea: notice which server you are on, put the right mods
        // on before the loading screen decides for you. This one is DCS because DCS can be
        // ASKED — it has a supported hook API — so it does not have to guess from a log.
        //
        // Both arrive with the path and the list blank on purpose. A preset that filled them
        // in with a guess would be a task that looks configured, runs, finds nothing, and
        // reports success.
        cat: 'mods', key: 'dcsServer',
        icon: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
        title: 'DCS: the right mods for the server you joined',
        desc: 'Sets up the DCS watcher, then applies the mod list for whichever server you join.',
        make: () => ({
            name: 'DCS — mods for this server',
            // The file the DCS hook writes. Left blank so the trigger editor's "Set up DCS"
            // button fills it in — it is the same click that installs the hook, and a path
            // typed here without the hook installed watches a file nothing will ever write.
            trigger: { type: 'watchFile', path: '' },
            steps: [
                // Which server. The hook writes JSON, so one pattern gets the name out of it.
                {
                    kind: 'action',
                    action: {
                        type: 'text.extract',
                        params: { path: '', regex: '\"server\"\s*:\s*\"([^\"]*)\"', group: 1, target: 'server', tailKb: 4 },
                    },
                },
                // Nothing to do when you left the server rather than joined one. Without
                // this the task fires on disconnect too and re-applies a list for a session
                // that has ended.
                {
                    kind: 'if',
                    condition: { type: 'textIs', params: { source: 'server', op: 'notEmpty' } },
                    then: [
                        {
                            kind: 'if',
                            condition: { type: 'textIs', params: { source: 'server', op: 'contains', value: 'Blue Flag' } },
                            // `exact` is on: a strict server means the list AND NOTHING ELSE,
                            // and one extra mod is the same rejection as a missing one.
                            then: [{ kind: 'action', action: { type: 'modlist.apply', params: { path: '', install: true, exact: true } } }],
                            else: [{ kind: 'action', action: { type: 'notify', params: { message: 'No mod list set for {text.server}.' } } }],
                        },
                    ],
                    else: [],
                },
            ],
        }),
    },
    {
        // The same thing for a game with no hook API: watch its log, read the server out of
        // a line, branch. Every game that prints what it connected to can do this, and the
        // only part that changes between them is the pattern.
        cat: 'mods', key: 'gameServer',
        icon: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
        title: 'Any game: mods for the server in the log',
        desc: 'Watch a game log, read the server name out of a line, apply the matching mod list.',
        make: () => ({
            name: 'Server → mod list',
            trigger: { type: 'watchFile', path: '' },
            steps: [
                {
                    kind: 'action',
                    action: {
                        // The pattern is the one thing to change per game. It reads: find the
                        // last line saying "connected to X" and keep X.
                        type: 'text.extract',
                        params: { path: '', regex: 'connect(?:ed|ing)? to[: ]+(.+)', group: 1, target: 'server', tailKb: 64 },
                    },
                },
                {
                    kind: 'if',
                    condition: { type: 'textIs', params: { source: 'server', op: 'notEmpty' } },
                    then: [
                        { kind: 'action', action: { type: 'notify', params: { message: 'Joined {text.server} — applying its mod list.' } } },
                        { kind: 'action', action: { type: 'modlist.apply', params: { url: '', install: true, exact: false } } },
                    ],
                    else: [],
                },
            ],
        }),
    },
    {
        cat: 'upkeep', key: 'backup', icon: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
        title: 'Weekly backup',
        desc: 'Every Monday at 09:00, export your BMM data and say so.',
        make: () => ({
            name: 'Weekly backup',
            trigger: { type: 'weeklyAt', time: '09:00', days: [1] },
            steps: [
                { kind: 'action', action: { type: 'data.exportAuto', params: { increment: true } } },
                { kind: 'action', action: { type: 'notify', params: { message: 'Weekly backup done.' } } },
            ],
        }),
    },
    {
        cat: 'upkeep', key: 'updates', icon: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
        title: 'Tell me about updates',
        desc: 'Every morning, check for mod and BMM updates — and only notify if there is one.',
        make: () => ({
            name: 'Check for updates',
            trigger: { type: 'dailyAt', time: '09:00' },
            steps: [
                { kind: 'action', action: { type: 'mods.checkUpdates', params: {} } },
                { kind: 'action', action: { type: 'app.checkUpdate', params: {} } },
                // The point of the `if`: a daily "no updates" toast is a notification people
                // learn to dismiss without reading, which costs you the one that mattered.
                {
                    kind: 'if',
                    condition: { type: 'value', params: { source: 'update.available', op: '==', value: 1 } },
                    then: [{ kind: 'action', action: { type: 'notify', params: { message: 'A BMM update is available.' } } }],
                    else: [],
                },
            ],
        }),
    },
    {
        cat: 'upkeep', key: 'disk', icon: '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
        title: 'Warn me before the disk fills',
        desc: 'Twice a day, check free space and warn under 20 GB. Silent otherwise.',
        make: () => ({
            name: 'Low disk space warning',
            trigger: { type: 'interval', everyMinutes: 720 },
            steps: [
                { kind: 'action', action: { type: 'perf.diskSpace', params: {} } },
                {
                    kind: 'if',
                    condition: { type: 'value', params: { source: 'disk.free_gb', op: '<', value: 20 } },
                    then: [{ kind: 'action', action: { type: 'notify', params: { message: 'Less than 20 GB free — mods may fail to install.' } } }],
                    else: [],
                },
            ],
        }),
    },
    {
        cat: 'mods', key: 'scan', icon: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
        title: 'Rescan mods when BMM opens',
        desc: 'Picks up anything you added to the mods folder outside BMM.',
        make: () => ({
            name: 'Rescan mods on start',
            trigger: { type: 'appStart' },
            steps: [{ kind: 'action', action: { type: 'mods.scan', params: {} } }],
        }),
    },
    {
        cat: 'mods', key: 'aftergame', icon: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
        title: 'Tidy up after the game closes',
        desc: 'Waits for the game to exit, then stops its launcher and rescans your mods. Fill in the two names, and grant “Stop programs”.',
        make: () => ({
            name: 'Tidy up after playing',
            trigger: { type: 'interval', everyMinutes: 5 },
            steps: [
                // Guard first: without it this task fires every five minutes forever, and
                // "the game is not running" is true almost all day.
                {
                    kind: 'if',
                    condition: { type: 'appRunning', params: { name: '' } },
                    then: [],
                    else: [{ kind: 'action', action: { type: 'task.stop', params: { reason: 'the game is not running' } } }],
                },
                {
                    kind: 'waitFor',
                    condition: { type: 'appNotRunning', params: { name: '' } },
                    timeoutSec: 14400, pollSec: 30, onTimeout: 'abort',
                },
                { kind: 'action', action: { type: 'app.stop', params: { name: '' } } },
                { kind: 'action', action: { type: 'mods.scan', params: {} } },
            ],
        }),
    },
    {
        cat: 'upkeep', key: 'diskguard', icon: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
        title: 'Stop early if the disk is nearly full',
        desc: 'A guard for the TOP of another task: checks free space and stops cleanly under 10 GB, so the real work never starts on a full disk.',
        make: () => ({
            name: 'Disk guard',
            trigger: { type: 'manual' },
            steps: [
                { kind: 'action', action: { type: 'perf.diskSpace', params: {} } },
                {
                    kind: 'if',
                    condition: { type: 'value', params: { source: 'disk.free_gb', op: '<', value: 10 } },
                    // Stopping is CLEAN, not an error: a guard that failed the task would
                    // fill the history with red for the exact case it was written to handle.
                    then: [{ kind: 'action', action: { type: 'task.stop', params: { reason: 'Less than 10 GB free — stopped before doing anything.' } } }],
                    else: [],
                },
            ],
        }),
    },
    {
        cat: 'mods', key: 'rescan', icon: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
        title: 'Rescan the library every morning',
        desc: 'Picks up mods added or removed outside BMM, before you sit down to play.',
        make: () => ({
            name: 'Morning rescan',
            trigger: { type: 'dailyAt', time: '08:00' },
            steps: [{ kind: 'action', action: { type: 'mods.scan', params: {} } }],
        }),
    },
    {
        cat: 'watch', key: 'watchsite', icon: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
        title: 'Tell me when a server stops answering',
        desc: 'Calls an address every 30 minutes and speaks up only when the answer is not 200. Put your own URL in the step — needs “Run external programs”.',
        make: () => ({
            name: 'Server watch',
            trigger: { type: 'interval', everyMinutes: 30 },
            steps: [
                // allowAnyStatus on purpose: the point is to SEE a bad status and react to
                // it, and the default would abort the task before reaching the check below.
                { kind: 'action', action: { type: 'http.request', params: { url: 'https://example.com/health', method: 'GET', allowAnyStatus: true, timeoutMs: 10000 } } },
                {
                    kind: 'if',
                    condition: { type: 'value', params: { source: 'http.status', op: '!=', value: 200 } },
                    then: [{ kind: 'action', action: { type: 'notify', params: { message: 'The server did not answer 200.' } } }],
                    else: [],
                },
            ],
        }),
    },
    {
        cat: 'advanced', key: 'sharedvar', icon: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
        title: 'Share a value with your other tasks',
        desc: 'Writes one shared variable that every other task can read as {sharedNote}. A building block rather than a finished job.',
        make: () => ({
            name: 'Set a shared value',
            trigger: { type: 'manual' },
            steps: [
                { kind: 'action', action: { type: 'var.set', params: { name: 'sharedNote', value: 'edit me', scope: 'shared' } } },
                { kind: 'action', action: { type: 'notify', params: { message: 'Saved. Other tasks can now read {sharedNote}.' } } },
            ],
        }),
    },
    // ── the doors that open outward ──────────────────────────────────────────
    //
    // Everything above this line is BMM talking to itself. These three — a deeplink, an HTTP
    // call, a plugin — are how a task reaches anything else, and they are the ones nobody
    // starts from, because knowing they exist means having read the action list to the end.
    {
        cat: 'watch', key: 'apiPing', icon: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
        title: 'Watch a service and say when it breaks',
        desc: 'Every 15 minutes, call an HTTP endpoint. Notify only when it stops answering.',
        make: () => ({
            name: 'Watch a service',
            trigger: { type: 'interval', everyMinutes: 15 },
            // `command` because an HTTP call can post a captured variable anywhere — the
            // runner asks for that permission and refuses without it.
            permissions: { command: true },
            steps: [
                { kind: 'action', action: { type: 'http.request', params: { url: 'https://example.com/health', method: 'GET', timeoutMs: 10000 } } },
                // http.status is set by the call above under a name a variable cannot collide
                // with, because dots are not allowed in one.
                { kind: 'if', condition: { type: 'value', params: { source: 'http.status', op: '!=', value: 200 } },
                  then: [{ kind: 'action', action: { type: 'notify', params: { message: 'The service answered {http.status}.' } } }],
                  else: [] },
            ],
        }),
    },
    {
        cat: 'advanced', key: 'deeplinkOpen', icon: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
        title: 'Open a BMM screen on a schedule',
        desc: 'Fire a bmm:// link — every screen and action the app exposes has one.',
        make: () => ({
            name: 'Open a screen',
            trigger: { type: 'dailyAt', time: '18:00' },
            permissions: { deeplink: true },
            steps: [
                { kind: 'action', action: { type: 'deeplink', params: { url: 'bmm://mod/check-updates' } } },
            ],
        }),
    },
    {
        cat: 'advanced', key: 'pluginNight', icon: '<path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/>',
        title: 'Compare a plugin, then apply it',
        desc: 'See what a plugin would change before it changes it — and only apply if it differs.',
        make: () => ({
            name: 'Apply a plugin modlist',
            trigger: { type: 'weeklyAt', time: '20:00', days: [5] },
            permissions: { deeplink: true },
            steps: [
                // Compare first. Applying blind is how a modlist that was edited upstream
                // rearranges a profile somebody spent an evening on.
                { kind: 'action', action: { type: 'plugin.compare', params: { id: '' } } },
                { kind: 'delay', seconds: 5 },
                { kind: 'action', action: { type: 'plugin.apply', params: { id: '' } } },
                { kind: 'action', action: { type: 'notify', params: { message: 'Plugin applied.' } } },
            ],
        }),
    },
    {
        cat: 'repo', key: 'sshNightly', icon: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
        title: 'Publish the repo over SSH, nightly',
        desc: 'Export, then send it to the saved SSH target. Needs a key with no passphrase.',
        make: () => ({
            name: 'Nightly publish',
            trigger: { type: 'dailyAt', time: '04:00' },
            steps: [
                { kind: 'action', action: { type: 'repo.gen', params: {} } },
                { kind: 'action', action: { type: 'repo.publishSsh', params: { dir: '' } } },
                { kind: 'action', action: { type: 'notify', params: { message: 'Repo published.' } } },
            ],
        }),
    },
    {
        cat: 'repo', key: 'unattendedSync', icon: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
        title: 'Sync a repo while you sleep',
        desc: 'A real sync, not a screen. Nothing to press at 3am.',
        make: () => ({
            name: 'Unattended sync',
            trigger: { type: 'dailyAt', time: '03:00' },
            steps: [
                { kind: 'action', action: { type: 'repo.syncNow', params: {} } },
                { kind: 'action', action: { type: 'notify', params: { message: 'Repo synced.' } } },
            ],
        }),
    },
    {
        cat: 'upkeep', key: 'packBackup', icon: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
        title: 'Export your modpacks every week',
        desc: 'A .bmp beside your data, so a broken profile is an import away from fixed.',
        make: () => ({
            name: 'Weekly modpack export',
            trigger: { type: 'weeklyAt', time: '10:00', days: [0] },
            steps: [
                { kind: 'action', action: { type: 'mods.exportModpack', params: {} } },
            ],
        }),
    },
    {
        // What a content id is FOR, as a task somebody can run.
        //
        // A local id says which entry on THIS machine; it says nothing about whether that
        // entry still holds what it held when you wrote the automation down. Somebody edits
        // the pack, the id does not change, and the task keeps applying a different thing
        // under the same name. The content id is what notices.
        //
        // Both fields arrive blank on purpose. Filled in with a guess, this would be a task
        // that looks configured, runs, matches nothing and reports success.
        cat: 'advanced', key: 'packUnchanged', icon: '<path d="M20 6 9 17l-5-5"/><circle cx="12" cy="12" r="10"/>',
        title: 'Apply a modpack only if it has not changed',
        desc: 'Reads what the pack IS and compares it to the id you recorded, so an edited pack stops rather than applying quietly.',
        make: () => ({
            name: 'Apply the pack I meant',
            trigger: { type: 'manual' },
            steps: [
                // Copy the pack's Content ID from its card into the value below, once.
                { kind: 'action', action: { type: 'id.of', params: { kind: 'modpack', id: '', into: 'packNow' } } },
                {
                    kind: 'if',
                    condition: { type: 'textIs', params: { source: 'packNow', op: 'is', value: '' } },
                    then: [
                        { kind: 'action', action: { type: 'modpack.enable', params: { id: '' } } },
                    ],
                    else: [
                        { kind: 'action', action: { type: 'notify', params: { message: 'That modpack is not the one this task was written for \u2014 nothing applied.', level: 'warning' } } },
                        { kind: 'action', action: { type: 'task.stop', params: { reason: 'the pack changed' } } },
                    ],
                },
            ],
        }),
    },
    {
        cat: 'repo', key: 'diskThenSync', icon: '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
        title: 'Only sync if there is room',
        desc: 'Check free space first, and stop with a reason rather than filling the disk.',
        make: () => ({
            name: 'Sync if there is room',
            trigger: { type: 'dailyAt', time: '02:00' },
            steps: [
                { kind: 'action', action: { type: 'perf.diskSpace', params: {} } },
                // A guard clause, not an if/else: stopping says WHY in the run log, while an
                // empty else branch looks like the task ran and did nothing.
                { kind: 'if', condition: { type: 'value', params: { source: 'disk.free_gb', op: '<', value: 5 } },
                  then: [{ kind: 'action', action: { type: 'task.stop', params: { reason: 'Less than 5 GB free — not syncing.' } } }],
                  else: [] },
                { kind: 'action', action: { type: 'repo.syncNow', params: {} } },
            ],
        }),
    },
    {
        cat: 'advanced', key: 'apiChain', icon: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
        title: 'Read a value from an API and keep it',
        desc: 'Pull one field out of a JSON response into a shared variable other tasks can read.',
        make: () => ({
            name: 'Read a value from an API',
            trigger: { type: 'interval', everyMinutes: 60 },
            permissions: { command: true },
            steps: [
                // jsonPath pulls ONE field out. Without it every task that reads an API needs
                // a script step just to get at a value, which is the common case.
                { kind: 'action', action: { type: 'http.request', params: { url: 'https://example.com/api/status.json', method: 'GET', jsonPath: 'version', into: 'apiVersion', timeoutMs: 10000 } } },
                { kind: 'action', action: { type: 'notify', params: { message: 'Upstream is at {apiVersion}.' } } },
            ],
        }),
    },
];

/** Build a full task from a preset. The id and createdAt are minted here, never stored in
 *  the preset itself — two tasks made from one preset must not share an id. */
function taskFromPreset(p: (typeof PRESETS)[number]): Task {
    return {
        id: newTaskId(), enabled: true, createdAt: Date.now(), catchUp: true,
        allowCustomCommands: false, name: '', trigger: { type: 'interval', everyMinutes: 60 }, steps: [],
        ...p.make(),
    } as Task;
}

async function openTaskModal(task: Task | null): Promise<void> {
    await loadPickers();
    _editing = task;
    _draft = task ? JSON.parse(JSON.stringify(task)) : {
        id: `sched-${Date.now()}`, name: '', enabled: true, createdAt: Date.now(), catchUp: true,
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
    // The next run, in the editor as well as the list. "Weekly 20:00" does not tell you
    // whether that means tonight or in six days, and that is the question you have while
    // still deciding what the trigger should be.
    {
        const at = nextDue({ ..._draft, enabled: true } as Task);
        if (at !== null) bits.push(`${t('sched.next') || 'next'} ${new Date(at).toLocaleString()}`);
    }
    if (_draft.osSchedule) bits.push(t('sched.sumOs') || 'even when BMM is closed');
    {
        const pm = taskPerms(_draft as Task);
        const granted = [
            pm.command  && (t('sched.sumCmd') || 'can run commands'),
            pm.script   && (t('sched.sumScript') || 'can run scripts'),
            pm.deeplink && (t('sched.sumDeeplink') || 'can fire deeplinks'),
        ].filter(Boolean) as string[];
        if (granted.length) bits.push(granted.join(', '));
    }
    return bits.join(' · ');
}
function refreshSummary(modal: HTMLElement): void {
    const el = modal.querySelector('#sched-summary');
    if (el) el.textContent = draftSummary();
}

/**
 * The shared variables, listed.
 *
 * `var.set` with scope `shared` has always persisted across runs and across tasks, and nothing
 * ever showed you what was in there — `readSharedVars` had six callers, all of them the run
 * context or var.set/var.clear, and not one of them rendered. So the only way to discover that
 * a name was taken was to overwrite it, and the only way to discover a typo was a task reading
 * a variable that silently substituted to itself.
 *
 * Appended to the sidebar after the modal's markup is built rather than woven into that
 * template literal: this panel has to re-render on its own whenever a variable is deleted, and
 * a section that owns its own DOM can do that without rebuilding — and without editing the
 * whole task editor to add a list.
 */
function renderSharedVarsPanel(modal: HTMLElement): void {
    const side = modal.querySelector('.sched-side');
    if (!side) return;
    const host = (side.querySelector('.sched-sv') as HTMLElement) || (() => {
        const el = document.createElement('div');
        el.className = 'sched-sv';
        side.appendChild(el);
        return el;
    })();

    const all = readSharedVars();
    const names = Object.keys(all).sort();
    // The value is shown, not hidden. These are the user's own automation variables, and a
    // list of names with no values answers "is it set" but never "is it right" — which is the
    // question you actually have when a task built the wrong path.
    const rows = names.map((n) => `
        <div class="sched-sv-row">
            <code class="sched-sv-name">${escHtml(n)}</code>
            <span class="sched-sv-val" data-tooltip="${escAttr(all[n])}">${escHtml(all[n].length > 40 ? all[n].slice(0, 40) + '…' : all[n])}</span>
            <button type="button" class="btn btn-ghost btn-xs sched-sv-del" data-name="${escAttr(n)}"
                data-tooltip="${escAttr(t('sched.sv.del') || 'Delete this shared variable')}">${SCHED_X}</button>
        </div>`).join('');

    host.innerHTML = `
        <div class="sched-sv-title">${t('sched.sv.title') || 'Shared variables'}</div>
        <div class="sched-sv-hint">${t('sched.sv.hint') || 'Kept between runs and readable by every task.'}</div>
        ${names.length ? rows : `<div class="sched-sv-empty">${t('sched.sv.empty') || 'None yet — a “Set variable” step with scope “shared” puts one here.'}</div>`}`;

    host.querySelectorAll('.sched-sv-del').forEach((btn) => btn.addEventListener('click', () => {
        const name = (btn as HTMLElement).dataset.name || '';
        const store = readSharedVars();
        delete store[name];
        writeSharedVars(store);
        // Re-render this panel only. Rebuilding the modal here would throw away whatever the
        // user has typed into the draft, to remove one row from a list.
        renderSharedVarsPanel(modal);
    }));
}

/**
 * Declared enums, in the same sidebar as the shared variables.
 *
 * Declaring one is what lets a SWITCH be told which members it has not handled. Without a
 * declaration a case is free text and nothing can know what the branch is about — that gap,
 * not the syntax, is the whole reason `match` was on the wish list.
 */
/**
 * The reusable blocks, and the one way to make one: save the steps you are looking at.
 *
 * A separate block EDITOR would be a second copy of the step editor, and the two would drift —
 * this project has paid for that shape enough times today. Building the steps in a task and
 * saving them is the same editor doing the same job.
 */
/** Which folders are expanded, and which block is selected. Outlives a repaint on purpose:
 *  a tree that collapses itself every time you touch it is a tree nobody expands twice. */
const _blOpen = new Set<string>();
let _blCurrent = '';

function renderBlocksPanel(modal: HTMLElement): void {
    const side = modal.querySelector('.sched-side');
    if (!side) return;
    const host = (side.querySelector('.sched-bl') as HTMLElement) || (() => {
        const el = document.createElement('div');
        el.className = 'sched-sv sched-bl';
        side.appendChild(el);
        return el;
    })();

    const all = readBlocks();
    const names = Object.keys(all).sort();

    host.innerHTML = `
        <div class="sched-sv-title">${t('sched.bl.title') || 'Reusable blocks'}</div>
        <div class="sched-sv-hint">${t('sched.bl.hint') || 'Steps saved once and run from any task with “Run a block”. They use the calling task’s permissions.'}</div>
        <div class="bt-tree" id="sched-bl-tree"></div>
        <div class="sched-bl-picked" id="sched-bl-picked"></div>
        <div class="sched-en-add">
            <input class="input sched-bl-name" spellcheck="false" placeholder="${escAttr(t('sched.bl.namePh'))}">
            <button type="button" class="btn btn-xs btn-secondary sched-bl-save">${t('sched.bl.save') || 'Save these steps'}</button>
        </div>
        <div class="sched-sv-hint">${escHtml(t('sched.tree.folderHint'))}</div>`;

    // The tree, from the names. Nothing stores it: renaming a block moves it and deleting the
    // last one in a folder removes the folder, with no second structure that can disagree.
    const tree = modal.querySelector('#sched-bl-tree') as HTMLElement | null;
    const picked = modal.querySelector('#sched-bl-picked') as HTMLElement | null;
    if (tree && picked) {
        const paint = () => {
            renderTree(tree, treeOf(names), _blOpen, _blCurrent, (path) => {
                _blCurrent = path;
                paint();
            }, (folder) => {
                if (_blOpen.has(folder)) _blOpen.delete(folder); else _blOpen.add(folder);
                paint();
            });
            const steps = all[_blCurrent];
            picked.innerHTML = _blCurrent && steps
                ? `<div class="sched-sv-row">
                       <code class="sched-sv-name">${escHtml(_blCurrent)}</code>
                       <span class="sched-sv-val">${steps.length} ${escHtml(t('sched.steps') || 'steps')}</span>
                       <button type="button" class="btn btn-ghost btn-xs sched-bl-del" data-name="${escAttr(_blCurrent)}"
                           data-tooltip="${escAttr(t('sched.bl.del') || 'Delete this block')}">${SCHED_X}</button>
                   </div>`
                : `<div class="sched-sv-empty">${escHtml(names.length ? t('sched.tree.pick') : (t('sched.bl.empty') || 'None yet.'))}</div>`;
            wireDelete();
        };
        // Every folder starts open. A tree that hides what is in it on first sight is a tree
        // whose whole content is one click away and invisible — which is what the flat list
        // already was.
        if (!_blOpen.size) for (const f of foldersOf(treeOf(names))) _blOpen.add(f);
        paint();
    }

    function wireDelete(): void {

    host.querySelectorAll('.sched-bl-del').forEach((btn) => btn.addEventListener('click', () => {
        const name = (btn as HTMLElement).dataset.name || '';
        // Refused while ANYTHING still calls it. A block that vanishes turns every caller into
        // a task that fails at a step which no longer exists — at RUN time, which is the worst
        // moment to find out.
        //
        // This used to check the OPEN task only, which is the one case where somebody already
        // knows. Blocks are stored once for the whole app, so the caller that matters is
        // usually a task nobody has open.
        const used = blockCallers(name, _draft);
        if (used.length) {
            toast(`${t('sched.bl.inuseBy')} ${used.slice(0, 4).join(', ')}${used.length > 4 ? '…' : ''}`, 'warning', 9000);
            return;
        }
        const store = readBlocks();
        delete store[name];
        writeBlocks(store);
        _blCurrent = '';
        renderBlocksPanel(modal);
    }));
    }

    host.querySelector('.sched-bl-save')?.addEventListener('click', async () => {
        const name = (host.querySelector('.sched-bl-name') as HTMLInputElement).value.trim();
        if (!BLOCK_NAME_RE.test(name)) {
            toast((t('sched.var.badName') || 'Not a usable variable name: {n}').replace('{n}', name || '(empty)'), 'warning');
            return;
        }
        if (!_draft.steps.length) { toast(t('sched.bl.nosteps') || 'Add some steps first.', 'warning'); return; }
        const store = readBlocks();
        // Saving onto a name that exists REPLACES it, everywhere, for every task — blocks are
        // stored once for the whole app. Silently was the old behaviour, and the way to meet it
        // was for somebody else's automation to start doing your steps.
        if (store[name]) {
            const callers = blockCallers(name, _draft);
            const ok = await showConfirm(
                t('sched.bl.overwriteTitle').replace('{n}', name),
                callers.length
                    ? `${t('sched.bl.overwriteUsed').replace('{n}', String(callers.length))} — ${callers.slice(0, 8).join(' · ')}`
                    : t('sched.bl.overwriteFree'),
                true,
            );
            if (!ok) return;
        }
        // A deep copy, or editing the task afterwards would silently rewrite the block — the
        // saved thing has to stop being the same object.
        store[name] = JSON.parse(JSON.stringify(_draft.steps));
        writeBlocks(store);
        toast((t('sched.bl.saved') || 'Saved “{n}”.').replace('{n}', name), 'info');
        renderBlocksPanel(modal);
    });
}

function renderEnumsPanel(modal: HTMLElement): void {
    const side = modal.querySelector('.sched-side');
    if (!side) return;
    const host = (side.querySelector('.sched-en') as HTMLElement) || (() => {
        const el = document.createElement('div');
        el.className = 'sched-sv sched-en';
        side.appendChild(el);
        return el;
    })();

    const all = readEnums();
    const names = Object.keys(all).sort();
    const rows = names.map((n) => `
        <div class="sched-sv-row">
            <code class="sched-sv-name">${escHtml(n)}</code>
            <span class="sched-sv-val" data-tooltip="${escAttr(all[n].join(', '))}">${escHtml(all[n].join(', '))}</span>
            <button type="button" class="btn btn-ghost btn-xs sched-en-del" data-name="${escAttr(n)}"
                data-tooltip="${escAttr(t('sched.en.del') || 'Delete this enum')}">${SCHED_X}</button>
        </div>`).join('');

    host.innerHTML = `
        <div class="sched-sv-title">${t('sched.en.title') || 'Enums'}</div>
        <div class="sched-sv-hint">${t('sched.en.hint') || 'A named set of values, so a Switch can be told which ones it has not handled.'}</div>
        ${names.length ? rows : `<div class="sched-sv-empty">${t('sched.en.empty') || 'None yet.'}</div>`}
        <div class="sched-en-add">
            <input class="input sched-en-name" spellcheck="false" placeholder="${escAttr(t('sched.en.namePh') || 'name')}">
            <input class="input sched-en-members" spellcheck="false" placeholder="${escAttr(t('sched.en.membersPh') || 'ok, failed, skipped')}">
            <button type="button" class="btn btn-xs btn-secondary sched-en-save">${t('sched.en.add') || 'Add'}</button>
        </div>`;

    host.querySelectorAll('.sched-en-del').forEach((btn) => btn.addEventListener('click', () => {
        const store = readEnums();
        delete store[(btn as HTMLElement).dataset.name || ''];
        writeEnums(store);
        renderEnumsPanel(modal);
    }));
    host.querySelector('.sched-en-save')?.addEventListener('click', () => {
        const name = (host.querySelector('.sched-en-name') as HTMLInputElement).value.trim();
        const raw = (host.querySelector('.sched-en-members') as HTMLInputElement).value;
        // Refused rather than skipped, exactly as var.set does: a name no condition could
        // reference would appear in this list and never work.
        if (!VAR_NAME_RE.test(name)) {
            toast((t('sched.var.badName') || 'Not a usable variable name: {n}').replace('{n}', name || '(empty)'), 'warning');
            return;
        }
        const members = parseList(raw);
        if (!members.length) {
            toast(t('sched.en.noMembers') || 'An enum needs at least one value.', 'warning');
            return;
        }
        const store = readEnums();
        store[name] = members;
        writeEnums(store);
        renderEnumsPanel(modal);
    });
}

/**
 * The members a switch's cases do not cover — the one thing `switch` could never say, and the
 * reason a separate `match` kind is not being built.
 *
 * Only speaks when EVERY case tests the same declared enum. A switch mixing an enum test with
 * a file check is not incomplete, it is a different kind of switch, and warning about it would
 * train people to ignore the warning.
 *
 * Advisory, never a save-blocker: handling three of five members and letting DEFAULT catch the
 * rest is legitimate. A check that refuses the save becomes something to work around.
 */
function switchGaps(step: { cases?: { condition: Condition }[]; default?: Step[] }): { enum: string; missing: string[] } | null {
    const cases = step.cases || [];
    if (!cases.length) return null;
    const first = cases[0]?.condition;
    if (!first || first.type !== 'enumIs') return null;
    const name = String(first.params?.enum || '');
    if (!name) return null;
    // Every case, or nothing. A negated case does not establish which member ran, so it also
    // disqualifies the check rather than being counted as covering one.
    for (const c of cases) {
        if (c.condition?.type !== 'enumIs' || c.condition.negate) return null;
        if (String(c.condition.params?.enum || '') !== name) return null;
    }
    const members = readEnums()[name];
    if (!members) return null;
    const covered = new Set(cases.map((c) => String(c.condition.params?.member ?? '')));
    const missing = members.filter((m) => !covered.has(m));
    return missing.length ? { enum: name, missing } : null;
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
                ${(() => {
                    // A picker plus a catalogue button, and the two are gated differently.
                    //
                    // Applying a preset REPLACES the draft, so it is offered only on a blank
                    // new task — picking one by mistake then costs nothing, because there was
                    // nothing to lose. Browsing a catalogue only ever opens a read-only
                    // report, so that button stays available the whole time: wanting to look
                    // at what other people published does not stop being reasonable the
                    // moment you have typed a name.
                    const browse = `<button type="button" class="btn btn-sm btn-secondary sched-preset-browse" id="sched-preset-catalog"
                            data-tooltip="${escAttr(t('sched.pc.tip') || 'Automations published by other people. Each one is inspected before anything is imported.')}">
                            ${SVG16('<path d="M12 13v8"/><path d="m8 17 4 4 4-4"/><path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284"/>')}
                            <span>${escHtml(t('sched.pc.browse') || 'From a catalogue…')}</span>
                        </button>`;
                    // ALWAYS on screen, including while editing.
                    //
                    // It used to disappear the moment the draft had a name or a step, because
                    // applying a preset REPLACES the draft and hiding it made that impossible.
                    // It also made the presets impossible to FIND: the one moment you want to
                    // know whether the thing you are building already exists ready-made is
                    // just after you started building it. So it stays, and the replacement is
                    // confirmed rather than prevented — with the draft's own step count in the
                    // question, so "replace" is not an abstraction.
                    //
                    // Grouped, and alphabetical inside a group. Nineteen presets in one flat
                    // list, in the order somebody happened to write them, is a list you read
                    // top to bottom every single time.
                    const groups = PRESET_CATS.map((c) => {
                        const mine = PRESETS.filter((p) => p.cat === c.cat)
                            .map((p) => ({ p, label: t('sched.preset.' + p.key) || p.title }))
                            .sort((a, b) => a.label.localeCompare(b.label));
                        if (!mine.length) return '';
                        return `<optgroup label="${escAttr(t(c.key) || c.label)}">${mine.map(({ p, label }) =>
                            `<option value="${escAttr(p.key)}">${escHtml(label)}</option>`).join('')}</optgroup>`;
                    }).join('');
                    return `<label class="sched-label">${t('sched.presetsTitle') || 'Start from a preset'} <span class="sched-hint-inline">${t('sched.presetsHint') || '— or build your own below'}</span></label>
                    <div class="sched-preset-row">
                        <select class="input sched-preset-pick" id="sched-preset-pick">
                            <option value="">${escHtml(t('sched.presetPick') || 'Pick one…')}</option>
                            ${groups}
                        </select>
                        ${browse}
                    </div>
                    <div class="sched-preset-desc" id="sched-preset-desc"></div>`;
                })()}
                <label class="sched-label">${t('sched.fName') || 'Name'}</label>
                <input class="input sched-name-input" id="sched-name" value="${escAttr(_draft.name)}" placeholder="${escAttr(t('sched.fNamePh') || 'e.g. Activate DCS profile every morning')}">
                <textarea class="input" id="sched-desc" rows="2" placeholder="${escAttr(t('sched.fDescriptionPh') || 'Description (optional)')}" style="resize:vertical;margin-top:8px">${escHtml(_draft.description || '')}</textarea>

                <label class="sched-label" style="margin-top:16px">${t('sched.fTrigger') || 'Trigger'} <span class="sched-hint-inline">${t('sched.fTriggerHint') || '— WHEN it runs'}</span></label>
                <div id="sched-trigger"></div>

                <label class="sched-label" style="margin-top:16px">${t('sched.secOptions') || 'Options'}</label>
                ${(() => {
                    // One box called "allow custom commands" answered the wrong
                    // question: it told you a permission was being granted but not
                    // what it unlocked, and it silently covered deeplinks, which can
                    // reach anything the app exposes. Three boxes, each naming a real
                    // capability, so consent is given to something legible.
                    const pm = taskPerms(_draft as Task);
                    const row = (key: string, on: boolean, title: string, desc: string) => `
                        <label class="sched-opt sched-perm">
                            <input type="checkbox" data-perm="${key}" ${on ? 'checked' : ''}>
                            <div><b>${title}</b><span>${desc}</span></div>
                        </label>`;
                    return `<div class="sched-perm-group">
                        <div class="sched-perm-head">${t('sched.permsTitle') || 'Permissions'}<span>${t('sched.permsHint') || '— what this task may do outside BMM'}</span></div>
                        ${row('command', !!pm.command, t('sched.allowCmdTitle') || 'Run external programs', t('sched.allowCmd') || 'This task may launch real programs on your PC.')}
                        ${row('script', !!pm.script, t('sched.allowScriptTitle') || 'Run scripts', t('sched.allowScript') || 'This task may run PowerShell, CMD, Bash or Python code you write.')}
                        ${row('deeplink', !!pm.deeplink, t('sched.allowDeeplinkTitle') || 'Fire deeplinks', t('sched.allowDeeplink') || 'This task may trigger bmm:// links, which can reach anything the app exposes.')}
                        ${row('stopProcess', !!pm.stopProcess, t('sched.allowStopTitle') || 'Stop programs', t('sched.allowStop') || 'This task may terminate running programs. Unsaved work in them is lost, with no warning and nothing to undo.')}
                    </div>`;
                })()}
                <label class="sched-opt">
                    <input type="checkbox" id="sched-os" ${_draft.osSchedule ? 'checked' : ''}>
                    <div><b>${t('sched.osScheduleTitle') || 'Run even when BMM is closed'}</b><span>${t('sched.osSchedule') || 'Registers a Windows Scheduled Task that launches BMM at the trigger time.'}</span></div>
                </label>
                ${['dailyAt', 'weeklyAt', 'monthlyAt'].includes(_draft.trigger.type) ? `
                <label class="sched-opt">
                    <input type="checkbox" id="sched-catchup" ${_draft.catchUp !== false ? 'checked' : ''}>
                    <div><b>${t('sched.catchUpTitle') || 'Catch up a missed run'}</b><span>${t('sched.catchUp') || 'If BMM was closed at the scheduled time, run once at the next launch. At most one run is owed, however long BMM was away.'}</span></div>
                </label>` : ''}
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
                    <!-- Two views of ONE draft. There is no third state where the code and
                         the bricks disagree, because there is only ever one tree. -->
                    <span class="sched-mode-switch" role="tablist" aria-label="${escAttr(t('sched.modeAria') || 'How to edit this task')}">
                        <span class="sched-mode-glider" aria-hidden="true"></span>
                        <button type="button" class="sched-mode-btn on" data-mode="bricks" role="tab" aria-selected="true"
                                data-tooltip="${escAttr(t('sched.modeBricksTip') || 'Build this task by clicking. Everything the language has is here.')}">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
                            <span>${t('sched.modeBricks') || 'Blocks'}</span>
                        </button>
                        <button type="button" class="sched-mode-btn" data-mode="code" role="tab" aria-selected="false"
                                data-tooltip="${escAttr(t('sched.modeCodeTip') || 'Write this task as text. Anything you build here opens back up as blocks.')}">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                            <span>${t('sched.modeCode') || 'Code'}</span>
                        </button>
                    </span>
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
                <div class="sched-codepane" id="sched-codepane" hidden>
                    <div class="sched-code-bar">
                        <span class="sched-code-bar-hint">${escHtml(t('sched.bmms.barHint'))}</span>
                        <button type="button" class="btn btn-xs btn-ghost" id="sched-code-outline" aria-pressed="false"
                            data-tasky="sched.outline.tip" data-tasky-icon="list">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h4M4 12h4M4 18h4M11 6h9M11 12h9M11 18h9"/></svg>
                            ${escHtml(t('sched.outline.toggle'))}
                        </button>
                        <button type="button" class="btn btn-xs btn-ghost" id="sched-code-ref" aria-pressed="false"
                            data-tasky="sched.ref.insertHint" data-tasky-icon="icon-info">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 21l-4.35-4.35"/><circle cx="11" cy="11" r="7"/></svg>
                            ${escHtml(t('sched.ref.toggle'))}
                        </button>

                    </div>
                    <div class="sched-code-row">
                        <aside class="sched-outline" id="sched-outline" hidden>
                            <div class="bo-list" id="sched-outline-list"></div>
                        </aside>
                        <textarea class="input sched-code" id="sched-code-ta" rows="20" spellcheck="false"></textarea>
                        <aside class="sched-ref" id="sched-ref" hidden>
                            <input type="search" class="input sched-ref-q" id="sched-ref-q"
                                   placeholder="${escAttr(t('sched.ref.search'))}" spellcheck="false">
                            <div class="sched-ref-list" id="sched-ref-list"></div>
                        </aside>
                    </div>
                    <div class="sched-code-status" id="sched-code-status"></div>
                </div>
            </main>
        </div>
        <div class="modal-footer sched-footer">
            <button class="btn btn-ghost" id="sched-cancel">${t('common.cancel') || 'Cancel'}</button>
            <button class="btn btn-ghost sched-test" id="sched-preview" data-tooltip="${escAttr(t('sched.prev.hint'))}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>${escHtml(t('sched.prev.run'))}</button>
            <button class="btn btn-ghost sched-test" id="sched-debug" data-tooltip="${escAttr(t('sched.dbg.hint'))}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px"><circle cx="12" cy="12" r="3"/><path d="M12 5V3M12 21v-2M5 12H3M21 12h-2M6.5 6.5 5 5M17.5 17.5 19 19M17.5 6.5 19 5M6.5 17.5 5 19"/></svg>${escHtml(t('sched.dbg.run'))}</button>
            <button class="btn btn-ghost sched-test" id="sched-test" data-tooltip="${escAttr(t('sched.testHint') || 'Run the steps once right now, without saving')}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px"><polygon points="5 3 19 12 5 21 5 3"/></svg>${t('sched.testRun') || 'Test run'}</button>
            <button class="btn btn-primary" id="sched-save">${t('common.save') || 'Save'}</button>
        </div>
      </div>`;

    renderSharedVarsPanel(modal);
    renderEnumsPanel(modal);
    renderBlocksPanel(modal);
    modal.querySelector('#sched-close')?.addEventListener('click', () => modal.classList.remove('open'));
    modal.querySelector('#sched-cancel')?.addEventListener('click', () => modal.classList.remove('open'));
    modal.querySelector('#sched-preset-catalog')?.addEventListener('click', () => { void browsePresetCatalogs(); });
    {
        const pick = modal.querySelector<HTMLSelectElement>('#sched-preset-pick');
        const desc = modal.querySelector<HTMLElement>('#sched-preset-desc');
        // Description on selection, before applying. A preset replaces the whole draft, so
        // being able to read what one does WITHOUT committing to it is the difference
        // between choosing and guessing — the tooltip on the old cards required hovering
        // each one in turn, which nobody does.
        pick?.addEventListener('change', () => {
            const p = PRESETS.find((x) => x.key === pick.value);
            if (desc) desc.textContent = p ? (t('sched.presetd.' + p.key) || p.desc) : '';
            if (!p) return;
            void (async () => {
                // Applying REPLACES the draft. On a blank new task that costs nothing, so it
                // happens straight away; once there is work in the draft it is a destructive
                // edit, and it gets asked about with the count of what would go.
                const has = (_draft.steps?.length || 0) + (_draft.name ? 1 : 0);
                if (has) {
                    const ok = await showConfirm(
                        t('sched.presetReplaceTitle') || 'Replace this task?',
                        (t('sched.presetReplaceBody') || 'Starting from a preset throws away what is in this task — {n} step(s), and its name, trigger and permissions. Undo brings it back.')
                            .replace('{n}', String(_draft.steps?.length || 0)),
                        true,
                    );
                    if (!ok) {
                        // Put the picker back where it was, or it reads as applied.
                        pick.value = '';
                        if (desc) desc.textContent = '';
                        return;
                    }
                }
                _snapshot();                   // undo covers this like any other edit
                _draft = taskFromPreset(p);
                renderModal(modal!);
            })();
        });
    }
    modal.querySelector('#sched-name')?.addEventListener('input', (e) => { _draft.name = (e.target as HTMLInputElement).value; });
    modal.querySelector('#sched-desc')?.addEventListener('input', (e) => { _draft.description = (e.target as HTMLTextAreaElement).value; });
    modal.querySelectorAll<HTMLInputElement>('[data-perm]').forEach(cb => {
        cb.addEventListener('change', () => {
            // Materialise the derived set on first edit, so a task saved from this
            // modal always carries an explicit grant rather than one inferred from
            // the legacy flag by whatever version happens to read it next.
            const pm = { ...taskPerms(_draft as Task) };
            (pm as any)[cb.dataset.perm!] = cb.checked;
            _draft.perms = pm;
            _draft.allowCustomCommands = !!pm.command;   // keep the legacy field truthful
            refreshSummary(modal);
        });
    });
    modal.querySelector('#sched-os')?.addEventListener('change', (e) => { _draft.osSchedule = (e.target as HTMLInputElement).checked; refreshSummary(modal); });
    modal.querySelector('#sched-catchup')?.addEventListener('change', (e) => { _draft.catchUp = (e.target as HTMLInputElement).checked; refreshSummary(modal); });
    // Test run: execute the CURRENT draft's steps once, without saving the task —
    // instant feedback while building an automation instead of save→run→edit loops.
    // Debug: the SAME run as a test, one step at a time. Not a second runner — a debugger
    // that runs the task differently from how it really runs is a debugger that lies about
    // the bug.
    modal.querySelector('#sched-preview')?.addEventListener('click', () => { void openPreview(); });

    modal.querySelector('#sched-debug')?.addEventListener('click', () => {
        if (!_draft.steps.length) { toast(t('sched.testNoSteps') || 'Add at least one step to test.', 'warning'); return; }
        startDebug(_draft.id || 'draft', _draft.name || (t('sched.untitled') || 'Untitled'));
        (modal.querySelector('#sched-test') as HTMLButtonElement | null)?.click();
    });

    modal.querySelector('#sched-test')?.addEventListener('click', async () => {
        if (!_draft.steps.length) { toast(t('sched.testNoSteps') || 'Add at least one step to test.', 'warning'); return; }
        const btn = modal.querySelector('#sched-test') as HTMLButtonElement;
        btn.disabled = true;
        toast(t('sched.testing') || 'Test run started…', 'info', 1500);
        // A test run registers like any other, so it appears in the panel and can be
        // stopped. Without this, the one run you are MOST likely to want to abandon — the
        // one you started to see what a half-built task does — was the only one that could
        // not be, and a five-minute Pause meant waiting it out or closing BMM.
        //
        // Under the draft's id, so a test and a scheduled run of the same task cannot both
        // claim the row. `_draft.id` exists before the task is saved; a brand-new draft
        // without one falls back to a constant, which is fine because only one editor is
        // open at a time.
        const testId = _draft.id || 'draft';
        _running.set(testId, {
            id: testId, name: `${_draft.name || (t('sched.untitled') || 'Untitled')} (${t('sched.testRun') || 'Test run'})`,
            startedAt: Date.now(), step: t('sched.run.starting') || 'starting…', depth: 0,
            done: 0, total: (_draft.steps || []).filter((s) => !s.disabled).length, cancel: false,
        });
        renderRunningPanel();
        ensureRunTicker();
        try {
            await runSteps(_draft.steps, { ..._draft, id: testId } as Task, { nums: {}, text: {}, shared: readSharedVars() });
            toast(t('sched.testOk') || 'Test run finished.', 'success');
        } catch (e) {
            if (e instanceof DebugStopped) toast(t('sched.dbg.ended'), 'info');
            else if (e instanceof _StopTask) toast(`${t('sched.stopped') || 'stopped'}${(e as any).reason ? `: ${(e as any).reason}` : ''}`, 'info');
            else if (e instanceof _CancelledTask) toast(t('sched.run.cancelled') || 'stopped by you', 'info');
            else {
                // Before the `finally` below, which used to be the whole story: a failing
                // task closed the debugger and left a toast, so the one moment somebody
                // opens a debugger FOR — it broke, what was it holding — was the one moment
                // the values were already gone. failDebug keeps the panel on that moment;
                // endDebug then detaches the session so nothing can wait on it.
                failDebug(e);
                toast(`${t('sched.testFail') || 'Test run failed'} — ${e}`, 'error');
            }
        } finally {
            // In the finally for the same reason runTask's is: a test that threw must not
            // leave a row in the panel with a Stop button that does nothing.
            _running.delete(testId);
            renderRunningPanel();
            btn.disabled = false;
            // Whatever happened. A session left open holds the panel on screen with a Step
            // button that resolves nothing — which looks exactly like a hung task.
            endDebug();
        }
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
    wireCodeMode(modal);
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
        ['watchFile', t('sched.trWatch')   || 'When a file changes'],
        ['onEvent',   t('sched.trEvent')],
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
        else if (v === 'watchFile') _draft.trigger = { type: 'watchFile', path: '' };
        else if (v === 'onEvent') _draft.trigger = { type: 'onEvent', event: 'bmm.mod.missing' };
        else if (v === 'manual') _draft.trigger = { type: 'manual' };
        else _draft.trigger = { type: 'appStart' };
        renderTriggerEditor(host);
        const m = document.getElementById('modal-scheduler'); if (m) refreshSummary(m);
    }));
    const ph = host.querySelector('#sched-tr-params') as HTMLElement;
    // Any param change (time, minutes, day…) refreshes the header summary live.
    ph.addEventListener('input', () => { const m = document.getElementById('modal-scheduler'); if (m) refreshSummary(m); });
    if (tr.type === 'onEvent') {
        ph.innerHTML = `
            <select class="input" id="sched-tr-ev" data-csel-search="1" style="max-width:100%">
                ${BMM_EVENTS.map((e) => `<option value="${escAttr(e)}"${tr.event === e ? ' selected' : ''}>${escAttr(e)} — ${escHtml(t('sched.ev.' + e))}</option>`).join('')}
            </select>
            <input class="input" id="sched-tr-ev-custom" spellcheck="false" style="margin-top:6px"
                placeholder="${escAttr(t('sched.trEventCustomPh'))}" value="${escAttr(BMM_EVENTS.includes(tr.event) ? '' : (tr.event || ''))}">
            <p class="sched-hint">${escHtml(t('sched.trEventHint'))}</p>`;
        ph.querySelector('#sched-tr-ev')?.addEventListener('change', (e) => {
            (_draft.trigger as any).event = (e.target as HTMLSelectElement).value;
            const custom = ph.querySelector('#sched-tr-ev-custom') as HTMLInputElement | null;
            if (custom) custom.value = '';
        });
        // A name typed here WINS over the dropdown, because somebody typing one is naming
        // something the list does not have — which is the whole reason the field is there.
        ph.querySelector('#sched-tr-ev-custom')?.addEventListener('input', (e) => {
            const v = (e.target as HTMLInputElement).value.trim();
            if (v) (_draft.trigger as any).event = v;
        });
    }
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
    } else if (tr.type === 'watchFile') {
        // The DCS button is here rather than in a "games" screen because this is the moment
        // somebody needs it: they have chosen "when a file changes" and do not yet know
        // which file. It installs the hook and fills the path in with what the hook writes.
        ph.innerHTML = `
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <input class="input" id="sched-tr-watch" spellcheck="false" style="flex:1;min-width:220px"
                    placeholder="${escAttr(t('sched.trWatchPh') || 'Full path to the file to watch')}"
                    value="${escAttr(tr.path || '')}">
                <button type="button" class="btn btn-xs btn-ghost" id="sched-tr-watch-pick">${escHtml(t('common.browse') || 'Browse')}</button>
                <button type="button" class="btn btn-xs btn-ghost" id="sched-tr-watch-dcs">${escHtml(t('sched.trWatchDcs') || 'Set up DCS')}</button>
            </div>
            <p class="sched-hint">${escHtml(t('sched.trWatchHint') || '')}</p>`;
        ph.querySelector('#sched-tr-watch')?.addEventListener('input', (e) => {
            (_draft.trigger as any).path = (e.target as HTMLInputElement).value;
        });
        ph.querySelector('#sched-tr-watch-pick')?.addEventListener('click', async () => {
            const { pickFile } = await import('../../core/api.js');
            const f = await pickFile({ filters: [{ name: 'All files', extensions: ['*'] }] }).catch(() => null);
            if (!f) return;
            (_draft.trigger as any).path = f;
            (ph.querySelector('#sched-tr-watch') as HTMLInputElement).value = String(f);
        });
        ph.querySelector('#sched-tr-watch-dcs')?.addEventListener('click', async () => {
            try {
                const r: any = await invoke('dcs_install_hook', { dir: null });
                // The FIRST is picked rather than asking, and the count is reported — there
                // are usually two DCS folders (release and open beta) and the hook goes in
                // both, but a trigger watches one file.
                const first = (r?.watch || [])[0];
                if (!first) return;
                (_draft.trigger as any).path = first;
                (ph.querySelector('#sched-tr-watch') as HTMLInputElement).value = String(first);
                toast(t('sched.dcsHookOk').replace('{n}', String((r.installed || []).length)), 'success', 8000);
            } catch (e) {
                toast(String(e).includes('game.errNoDcs')
                    ? t('sched.dcsHookNone') : String(e), 'warning', 8000);
            }
        });
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

/**
 * Blocks ⇄ Code, over the same draft.
 *
 * Going TO code prints `_draft.steps`; coming BACK compiles the text and replaces them. The
 * one rule that matters: leaving code mode with code that does not compile is refused. The
 * alternative is a switch that quietly keeps the old bricks while the text on screen says
 * something else — you would go back to blocks, see your previous work, and never learn
 * that the edit was dropped.
 *
 * Only the STEPS travel. The name, trigger and permissions have their own controls in the
 * sidebar and stay in charge of themselves; printing them into the text would give every
 * one of them two places to be edited and a rule about which wins.
 */
/**
 * What the code box offers as suggestions.
 *
 * Read from the SAME arrays the brick editor renders from, so an action added tomorrow is
 * suggested tomorrow. A hand-kept copy of 75 names is a list that goes stale the first time
 * somebody adds an action and does not think of this file.
 */
function codeVocabulary() {
    // Parameter names come from the GENERATED index rather than from a second list here:
    // gen-bmms-reference.mjs already extracts them from the runner, and a copy would be a
    // list that offers `passphrase` to an action that stopped taking it two versions ago.
    const params: Record<string, string[]> = {};
    for (const e of BMMS_INDEX) if (e.p?.length) params[e.n] = e.p;
    return {
        actions: ACTION_TYPES.map((a) => a.v),
        conditions: COND_TYPES.slice(),
        sources: VALUE_SOURCES.slice(),
        loops: LOOP_SOURCES.slice(),
        params,
    };
}

/**
 * One line about the highlighted suggestion, in the reader's language.
 *
 * The same keys the reference panel and the block editor use, so the box, the panel and the
 * bricks cannot describe one action three ways.
 */
function describeCompletion(c: { text: string; kind: string }): string {
    if (c.kind === 'action') {
        const d = t('sched.actd.' + c.text) || '';
        const l = t('sched.act.' + c.text) || '';
        const p = BMMS_INDEX.find((e) => e.k === 'a' && e.n === c.text)?.p || [];
        const head = [l, d].filter(Boolean).join(' \u2014 ');
        return p.length ? `${head}${head ? '  ' : ''}(${p.join(', ')})` : head;
    }
    if (c.kind === 'condition') return t('sched.cond.' + c.text) || '';
    if (c.kind === 'type') return t('sched.bmms.type.' + c.text) || '';
    if (c.kind === 'variable') return t('sched.bmms.acVariable') || 'a variable this script sets';
    if (c.kind === 'param') return t('sched.bmms.acParam') || 'a parameter of this action';
    return '';
}

function wireCodeMode(modal: HTMLElement): void {
    const pane = modal.querySelector('#sched-codepane') as HTMLElement | null;
    const timeline = modal.querySelector('.sched-timeline') as HTMLElement | null;
    const ta = modal.querySelector('#sched-code-ta') as HTMLTextAreaElement | null;
    const status = modal.querySelector('#sched-code-status') as HTMLElement | null;

    // The reference, one click from the editor.
    //
    // Writing BMMScript by hand means knowing eighty-two action names and their parameters,
    // and the page that lists them was three screens away behind a modal you had to close
    // first. It opens the generated reference — the one built from the registry, so it can
    // never list an action this build does not have.
    wireReferencePanel(modal);
    wireOutlineAndHover(modal);


    const btns = Array.from(modal.querySelectorAll('.sched-mode-btn')) as HTMLElement[];
    if (!pane || !timeline || !ta || !status || !btns.length) return;

    let mode: 'bricks' | 'code' = 'bricks';

    const say = (msg: string, bad: boolean) => {
        status.textContent = msg;
        status.classList.toggle('is-bad', bad);
    };

    /**
     * Compile what is in the box. Returns the steps, or null after reporting why not.
     *
     * `jump` moves the caret to the error, and defaults to OFF. It is the right thing to do
     * when somebody pressed Blocks or Save — they asked, and hunting for line 34 by
     * counting is the difference between an editor and a text box that judges you. It is the
     * wrong thing to do while they are typing: half a line is a syntax error, so the live
     * check fired on nearly every pause and threw the caret across the file mid-sentence.
     */
    const readCode = async (jump = false, hushCaretLine = false): Promise<Step[] | null> => {
        const src = ta.value.trim();
        // Empty is a legitimate task with no steps, not an error.
        if (!src) return [];
        try {
            const r: any = await invoke('bmms_compile_steps', { source: src });
            if (r?.ok) return (r.steps || []) as Step[];
            const e = (r.errors || [])[0];
            // Half a line is a syntax error. Complaining about the line somebody is still
            // typing is complaining about every keystroke, so the live check stays quiet
            // about THAT line and reports everything else — move away and the error appears.
            const caretLine = ta.value.slice(0, ta.selectionStart).split('\n').length;
            if (!(hushCaretLine && e?.line === caretLine)) {
                say(e ? `${t('sched.bmms.line') || 'Line'} ${e.line}:${e.col} — ${e.message}` : (t('common.error') || 'Error'), true);
            }
            if (jump && e?.line) {
                const upto = ta.value.split('\n').slice(0, e.line - 1).join('\n').length + (e.line > 1 ? 1 : 0);
                ta.focus();
                ta.setSelectionRange(upto, upto);
            }
            return null;
        } catch {
            say(t('sched.bmms.badcode') || 'This BMMScript did not compile.', true);
            return null;
        }
    };

    const show = (next: 'bricks' | 'code') => {
        mode = next;
        timeline.hidden = next === 'code';
        pane.hidden = next !== 'code';
        for (const b of btns) {
            const on = b.dataset.mode === next;
            b.classList.toggle('on', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        // The glider is moved by a class rather than by measuring, so it cannot drift out of
        // step with the buttons when the labels are translated to different widths.
        modal.querySelector('.sched-mode-switch')?.classList.toggle('at-code', next === 'code');
    };

    for (const b of btns) {
        b.addEventListener('click', async () => {
            const next = (b.dataset.mode === 'code' ? 'code' : 'bricks') as 'bricks' | 'code';
            if (next === mode) return;
            if (next === 'code') {
                // Printed fresh from the draft every time, so the text can never be a stale
                // copy of steps edited in the other view since.
                try {
                    ta.value = await invoke('bmms_decompile', { task: { name: _draft.name, trigger: _draft.trigger, steps: _draft.steps } }) as string;
                    // Only the body: the header is the sidebar's business, and showing it
                    // here would invite editing it in two places.
                    ta.value = stripTaskWrapper(ta.value);
                } catch { ta.value = ''; }
                // Assigning .value fires no input event, so nothing would repaint and the
                // mirror would keep showing the previous task.
                hl?.refresh();
                say((t('sched.bmms.ok') || '{n} step(s)').replace('{n}', String(stepCount(_draft.steps))), false);
                show('code');
                return;
            }
            const steps = await readCode(true);
            if (steps === null) return;   // refused — stay here, the message says why
            _draft.steps = steps;
            show('bricks');
            renderStepsEditor(modal.querySelector('#sched-steps') as HTMLElement, _draft.steps);
            renderAddRow(modal.querySelector('#sched-root-add') as HTMLElement, _draft.steps);
        });
    }

    // Checked as you stop typing, so the Blocks button is never the first thing to tell you
    // there is a mistake.
    let timer: any = null;
    mountCompletions(ta, codeVocabulary(), describeCompletion);
    // Colour, through the same mirror every other code box in BMM uses. It decides
    // nothing — the live compile below is the thing that judges the code.
    registerBmmsLanguage();
    const hl = attachHighlight(ta, 'bmms');

    ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const steps = await readCode(false, true);
            if (steps) say((t('sched.bmms.ok') || '{n} step(s)').replace('{n}', String(stepCount(steps))), false);
        }, 350);
    });

    // Saving from code mode must save the CODE, not the steps it replaced. Without this a
    // task edited entirely in text and saved without switching back would keep whatever the
    // blocks held — the worst possible outcome and a silent one.
    modal.querySelector('#sched-save')?.addEventListener('click', async (e) => {
        if (mode !== 'code') return;
        const steps = await readCode(true);
        if (steps === null) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        _draft.steps = steps;
    }, true);   // capture, so this runs BEFORE the save handler reads _draft
}

/** The body of a printed task, without its `task "…" { … }` wrapper and header lines. */
function stripTaskWrapper(src: string): string {
    const open = src.indexOf('{');
    const close = src.lastIndexOf('}');
    if (open < 0 || close <= open) return src;
    const body = src.slice(open + 1, close).split('\n');
    // The header lines the sidebar owns. Dropped by NAME rather than by counting lines,
    // because how many there are depends on the task.
    const HEADER = /^\s*(every|once|manual|on\s+app|describe|disabled|allow)\b/;
    while (body.length && (!body[0].trim() || HEADER.test(body[0]))) body.shift();
    while (body.length && !body[body.length - 1].trim()) body.pop();
    // One indent level removed, so the text starts at the left margin like an editor's does.
    return body.map((l) => (l.startsWith('    ') ? l.slice(4) : l)).join('\n');
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
            // 'list' and 'mapKeys' were missing from this picker. The runtime has resolved a
            // list source the whole time and the type has allowed it, so `for each` over a
            // list the task built itself worked and could not be chosen — the same gap that
            // left the list ACTIONS without a form.
            const srcSel = LOOP_SOURCES.map(m =>
                `<option value="${m}"${step.source === m ? ' selected' : ''}>${escHtml(t('sched.fe.' + m) || m)}</option>`).join('');
            const ownSource = step.source === 'list' || step.source === 'mapKeys';
            const nameBox = ownSource ? `<input class="input sched-fe-name" spellcheck="false" style="max-width:150px"
                    placeholder="${escAttr(step.source === 'list' ? (t('sched.fe.listPh') || 'list name') : (t('sched.fe.mapPh') || 'map name'))}"
                    value="${escAttr(step.listName || '')}">` : '';
            block.innerHTML = `<div class="sched-step-head">${_foldBtn(step)}${_kindTile('forEach')}
                    <span class="sched-step-tag sched-repeat">${t('sched.forEach') || 'FOR EACH'}</span>
                    <select class="input sched-fe-src" style="max-width:190px">${srcSel}</select>${nameBox}
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.loopMax') || 'max'}</span><input type="number" class="input sched-fe-max" min="1" value="${step.maxIters || 100}" style="max-width:90px">
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.loopEvery') || 'every'}</span><input type="number" class="input sched-fe-every" min="0" value="${step.everySec || 0}" style="max-width:80px"> ${t('sched.unitSec') || 's'}
                    <span style="font-size:10px;color:var(--text-muted)">${t('sched.fe.hint') || '{item.id} / {item.name} in the body'}</span></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.fe.body') || 'PER ITEM'}</div><div class="sched-fe-body"></div><div class="sched-fe-add"></div></div>`;
            block.querySelector('.sched-fe-src')?.addEventListener('change', (e) => {
                step.source = (e.target as HTMLSelectElement).value as any;
                // Redraw: the name box only exists for the two run-context sources, so without
                // this, picking one shows no way to name it until the editor is reopened.
                renderStepsEditor(host, steps, depth);
            });
            block.querySelector('.sched-fe-name')?.addEventListener('input', (e) => { step.listName = (e.target as HTMLInputElement).value; });
            block.querySelector('.sched-fe-max')?.addEventListener('input', (e) => { step.maxIters = parseInt((e.target as HTMLInputElement).value) || 100; });
            block.querySelector('.sched-fe-every')?.addEventListener('input', (e) => { step.everySec = parseFloat((e.target as HTMLInputElement).value) || 0; });
            renderStepsEditor(block.querySelector('.sched-fe-body') as HTMLElement, step.steps, depth + 1);
            renderAddRow(block.querySelector('.sched-fe-add') as HTMLElement, step.steps, depth + 1, host, steps, depth);
            _wireFold(block, step);
        } else if (step.kind === 'parallel') {
            if (!Array.isArray(step.branches) || !step.branches.length) step.branches = [[], []];
            const modeSel = ([['all', t('sched.par.all') || 'stop if one fails'], ['settle', t('sched.par.settle') || 'let them all finish']] as [string, string][])
                .map(([v, l]) => `<option value="${v}"${(step.mode || 'all') === v ? ' selected' : ''}>${escHtml(l)}</option>`).join('');
            block.innerHTML = `<div class="sched-step-head">${_foldBtn(step)}${_kindTile('parallel')}
                    <span class="sched-step-tag sched-repeat">${t('sched.parallel') || 'AT THE SAME TIME'}</span>
                    <select class="input sched-par-mode" style="max-width:190px">${modeSel}</select>
                    <span style="font-size:11px;color:var(--text-muted);flex:1">${t('sched.parHint') || 'branches share the task\u2019s variables \u2014 use them for work that does not depend on each other'}</span>
                    <button type="button" class="btn btn-xs sched-par-add-branch">+ ${escHtml(t('sched.par.addBranch') || 'branch')}</button>
                </div>
                ${step.branches.map((_b, bi) => `
                <div class="sched-branch">
                    <div class="sched-branch-label">
                        ${escHtml((t('sched.par.branch') || 'BRANCH {n}').replace('{n}', String(bi + 1)))}
                        ${step.branches.length > 1 ? `<button type="button" class="btn btn-xs btn-ghost sched-par-del" data-b="${bi}" title="${escAttr(t('sched.par.delBranch') || 'Remove this branch')}">\u00d7</button>` : ''}
                    </div>
                    <div class="sched-par-body" data-b="${bi}"></div>
                    <div class="sched-par-add" data-b="${bi}"></div>
                </div>`).join('')}`;
            block.querySelector('.sched-par-mode')?.addEventListener('change', (e) => {
                _snapshot(); step.mode = (e.target as HTMLSelectElement).value as 'all' | 'settle';
            });
            block.querySelector('.sched-par-add-branch')?.addEventListener('click', () => {
                _snapshot(); step.branches.push([]); renderStepsEditor(host, steps, depth);
            });
            block.querySelectorAll('.sched-par-del').forEach((b) => b.addEventListener('click', (e) => {
                _snapshot();
                // A floor of one: removing the last branch leaves a step that renders as an
                // empty box with no way to put anything back in it.
                const bi = Number((e.currentTarget as HTMLElement).dataset.b);
                if (step.branches.length > 1) step.branches.splice(bi, 1);
                renderStepsEditor(host, steps, depth);
            }));
            block.querySelectorAll('.sched-par-body').forEach((el) => {
                const bi = Number((el as HTMLElement).dataset.b);
                renderStepsEditor(el as HTMLElement, step.branches[bi], depth + 1);
            });
            block.querySelectorAll('.sched-par-add').forEach((el) => {
                const bi = Number((el as HTMLElement).dataset.b);
                renderAddRow(el as HTMLElement, step.branches[bi], depth + 1, host, steps, depth);
            });
            _wireFold(block, step);
        } else if (step.kind === 'retry') {
            block.innerHTML = `<div class="sched-step-head">${_foldBtn(step)}${_kindTile('retry')}
                    <span class="sched-step-tag sched-repeat">${escHtml(t('sched.retry'))}</span>
                    <input type="number" class="input sched-rt-times" min="1" max="99" value="${step.times || 3}" style="max-width:80px">
                    <span style="font-size:11px;color:var(--text-muted)">${escHtml(t('sched.retry.timesWord'))}</span>
                    <span style="font-size:11px;color:var(--text-muted)">${escHtml(t('sched.loopEvery') || 'every')}</span>
                    <input type="number" class="input sched-rt-every" min="0" value="${step.everySec ?? 30}" style="max-width:80px">
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.unitSec') || 's'}</span>
                    <label class="sched-ensure-cont"><input type="checkbox" class="sched-rt-cont" ${step.onFail === 'continue' ? 'checked' : ''}>
                        <span data-tooltip="${escAttr(t('sched.retry.orContinueHint'))}">${escHtml(t('sched.ensure.orContinue'))}</span></label></div>
                <p class="sched-ensure-hint">${escHtml(t('sched.retry.hint'))}</p>
                <div class="sched-branch"><div class="sched-branch-label">${escHtml(t('sched.retry.body'))}</div><div class="sched-rt-body"></div><div class="sched-rt-add"></div></div>`;
            block.querySelector('.sched-rt-times')?.addEventListener('input', (e) => { step.times = Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1); });
            block.querySelector('.sched-rt-every')?.addEventListener('input', (e) => { step.everySec = Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0); });
            block.querySelector('.sched-rt-cont')?.addEventListener('change', (e) => { step.onFail = (e.target as HTMLInputElement).checked ? 'continue' : 'abort'; });
            renderStepsEditor(block.querySelector('.sched-rt-body') as HTMLElement, step.steps, depth + 1);
            renderAddRow(block.querySelector('.sched-rt-add') as HTMLElement, step.steps, depth + 1, host, steps, depth);
            _wireFold(block, step);
        } else if (step.kind === 'ensure') {
            block.innerHTML = `<div class="sched-step-head">${_foldBtn(step)}${_kindTile('ensure')}
                    <span class="sched-step-tag sched-if">${escHtml(t('sched.ensure'))}</span>
                    <span class="sched-cond-label">${escHtml(t('sched.ensure.condLabel'))}</span>
                    <div class="sched-cond" style="flex:1"></div>
                    <label class="sched-ensure-cont"><input type="checkbox" class="sched-ens-cont" ${step.onFail === 'continue' ? 'checked' : ''}>
                        <span data-tooltip="${escAttr(t('sched.ensure.orContinueHint'))}">${escHtml(t('sched.ensure.orContinue'))}</span></label></div>
                <p class="sched-ensure-hint">${escHtml(t('sched.ensure.hint'))}</p>
                <div class="sched-branch"><div class="sched-branch-label">${escHtml(t('sched.ensure.fix'))}</div><div class="sched-ens-body"></div><div class="sched-ens-add"></div></div>`;
            if (!step.condition) step.condition = { type: 'always', params: {} };
            block.querySelector('.sched-cond')?.appendChild(conditionEditor(step.condition));
            block.querySelector('.sched-ens-cont')?.addEventListener('change', (e) => {
                step.onFail = (e.target as HTMLInputElement).checked ? 'continue' : 'abort';
            });
            renderStepsEditor(block.querySelector('.sched-ens-body') as HTMLElement, step.steps, depth + 1);
            renderAddRow(block.querySelector('.sched-ens-add') as HTMLElement, step.steps, depth + 1, host, steps, depth);
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
        } else if (step.kind === 'call') {
            const names = Object.keys(readBlocks()).sort();
            // No blocks yet is a state the picker has to SAY, not show as an empty select. An
            // empty dropdown looks like a loading bug; a sentence explains where blocks come
            // from, which is the sidebar's "save these steps as a block".
            const body = names.length
                ? `<select class="input sched-call-block" style="max-width:220px">
                       <option value=""${step.block ? '' : ' selected'}>${escHtml(t('sched.call.pick') || '— pick a block —')}</option>
                       ${names.map((n) => `<option value="${escAttr(n)}"${step.block === n ? ' selected' : ''}>${escHtml(n)}</option>`).join('')}
                   </select>
                   ${step.block && !names.includes(step.block)
                       ? `<span style="font-size:11px;color:var(--danger)">${escHtml((t('sched.call.missing') || 'No block named “{n}”.').replace('{n}', step.block))}</span>`
                       : ''}`
                : `<span style="font-size:11px;color:var(--text-muted)">${escHtml(t('sched.call.none') || 'No block yet — build some steps, then use “Save as block” in the sidebar.')}</span>`;
            block.innerHTML = `<div class="sched-step-head">${_kindTile('call')}
                    <span class="sched-step-tag sched-repeat">${t('sched.call') || 'RUN BLOCK'}</span>
                    ${body}
                    <span style="font-size:10px;color:var(--text-muted)">${t('sched.call.perm') || 'runs with THIS task’s permissions'}</span></div>`;
            block.querySelector('.sched-call-block')?.addEventListener('change', (e) => {
                (step as any).block = (e.target as HTMLSelectElement).value;
            });
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
                ${(() => {
                    const gap = switchGaps(step);
                    if (!gap) return '';
                    return `<div class="sched-sw-gap">${escHtml((t('sched.switchGap') || 'Not handled: {m} — DEFAULT will catch them.').replace('{m}', gap.missing.join(', ')))}</div>`;
                })()}
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
                    await runSteps([{ ...(step as any), disabled: false } as Step], _draft, { nums: {}, text: {}, shared: readSharedVars() });
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
        <button class="btn btn-xs sched-chip sched-add-if" data-add="ensure" data-tooltip="${escAttr(t('sched.legendEnsure'))}">${KIND_ICON.ensure} ${escHtml(t('sched.addEnsure'))}</button>
        <button class="btn btn-xs sched-chip sched-add-loop" data-add="repeat" data-tooltip="${escAttr(t('sched.legendLoop') || '')}">${KIND_ICON.repeat} ${t('sched.addLoop') || 'Loop'}</button>
        <button class="btn btn-xs sched-chip sched-add-wait" data-add="waitFor" data-tooltip="${escAttr(t('sched.legendWait') || '')}">${KIND_ICON.waitFor} ${t('sched.addWaitFor') || 'Wait until'}</button>
        <button class="btn btn-xs sched-chip sched-add-delay" data-add="delay" data-tooltip="${escAttr(t('sched.legendDelay') || '')}">${KIND_ICON.delay} ${t('sched.addDelay') || 'Pause'}</button>
        <button class="btn btn-xs sched-chip sched-add-foreach" data-add="forEach" data-tooltip="${escAttr(t('sched.legendForEach') || '')}">${KIND_ICON.forEach} ${t('sched.addForEach') || 'For each'}</button>
        <button class="btn btn-xs sched-chip sched-add-switch" data-add="switch" data-tooltip="${escAttr(t('sched.legendSwitch') || '')}">${KIND_ICON.switch} ${t('sched.addSwitch') || 'Switch'}</button>
        <button class="btn btn-xs sched-chip sched-add-try" data-add="parallel" data-tooltip="${escAttr(t('sched.legendPar') || 'Run several branches at the same time')}">${KIND_ICON.parallel} ${t('sched.addParallel') || 'At the same time'}</button>
        <button class="btn btn-xs sched-chip sched-add-loop" data-add="retry" data-tooltip="${escAttr(t('sched.retry.hint'))}">${KIND_ICON.retry} ${escHtml(t('sched.addRetry'))}</button>
        <button class="btn btn-xs sched-chip sched-add-try" data-add="try" data-tooltip="${escAttr(t('sched.legendTry') || '')}">${KIND_ICON.try} ${t('sched.addTry') || 'Try / on error'}</button>
        <button class="btn btn-xs sched-chip sched-add-call" data-add="call" data-tooltip="${escAttr(t('sched.legendCall') || '')}">${KIND_ICON.call} ${t('sched.addCall') || 'Run a block'}</button>
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
    if (kind === 'ensure') return { kind: 'ensure', condition: { type: 'always', params: {} }, steps: [], onFail: 'abort' } as Step;
    if (kind === 'retry') return { kind: 'retry', times: 3, everySec: 30, steps: [], onFail: 'abort' } as Step;
    // TWO empty branches, not one: a parallel with a single branch is a sequence with extra
    // words, and the shape has to show what the step is for the moment it is added.
    if (kind === 'parallel') return { kind: 'parallel', mode: 'all', branches: [[], []] } as Step;
    // Empty block name on purpose: the editor's picker fills it, and a default pointing at
    // somebody's first block would run a real block the moment the step was added.
    if (kind === 'call') return { kind: 'call', block: '' } as Step;
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
    // Two lines running side by side, then meeting: the whole idea of the step.
    parallel: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3"/><path d="M12 6H6v6"/><path d="M12 6h6v6"/><path d="M6 12v3"/><path d="M18 12v3"/><path d="M6 15h12"/><path d="M12 15v6"/></svg>',
    // A circular arrow with a small warning break: try again, because it went wrong.
    retry:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    ensure:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4"/><path d="M8.5 12.2l2.7 2.7L21 5.5"/></svg>',
    signal:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
    // A box with an arrow going into it — the body lives elsewhere and is brought in here.
    call:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V16"/><path d="M13 12H2M6 8.5 2.5 12 6 15.5"/></svg>',
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
    else if (step.kind === 'ensure') sum = `${(step.steps?.length || 0)} ${t('sched.stepsInside') || 'inside'}`;
    else if (step.kind === 'retry') sum = `${(step.steps?.length || 0)} ${t('sched.stepsInside') || 'inside'}`;
    else if (step.kind === 'parallel') sum = (step.branches || []).map((b: Step[]) => b.length).join(' | ');
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

/**
 * Write a catalogue of the user's own things into `dir`, and return how many entries it has.
 *
 * Deliberately NOT one generic path with three flags. The kinds disagree about the one
 * thing that matters — whether the index points at files or contains them — and a shape
 * that hid that would have to invent a file for a theme, or drop the .bmmtut for a
 * tutorial. Each branch is short and says which it is.
 *
 * Everything is a parameter. Nothing here opens a picker: this runs from a task, and a task
 * that fires at 03:00 has nobody to answer a dialog.
 */
async function buildCatalogueInto(kind: string, dir: string, title: string, base: string): Promise<number> {
    const stamp = new Date().toISOString();
    const write = (file: string, content: string) => invoke('write_text_file', { path: `${dir}/${file}`, content });

    if (kind === 'modpack') {
        // Embedded. BMM holds a modpack as data, so there is nothing to link to and nothing
        // for the reader to fetch — the same shape the modpack catalogue reader expects.
        const packs: any[] = (await invoke('load_modpacks').catch(() => [])) as any[];
        await write('catalog.json', JSON.stringify({ version: '1.0', name: title, generatedAt: stamp, modpacks: packs }, null, 2));
        return packs.length;
    }

    if (kind === 'automation') {
        // Automations are written OUT as files and linked, not embedded, because a `.bmmpa`
        // is a document somebody reads before trusting it — and a catalogue whose entries
        // are inline JSON is one nobody can read without installing.
        //
        // Permissions are stripped on the way out for the same reason they are stripped on
        // the way in: they are granted by the person who reads the task, never carried by
        // the file that asks for them.
        const tasks = await getTasks();
        let n = 0;
        const entries: any[] = [];
        for (const task of tasks) {
            const file = `${String(task.id).replace(/[^A-Za-z0-9._-]/g, '_')}.bmmpa`;
            await write(file, JSON.stringify({ magic: 'BMMPA', version: 1, tasks: [forExport(task)] }, null, 2));
            entries.push({
                id: task.id,
                name: task.name || task.id,
                description: (task as any).description || '',
                file,
                url: base ? `${base}/${file}` : undefined,
            });
            n += 1;
        }
        // The index goes down LAST: a catalog.json listing files that failed to write looks
        // finished and installs nothing.
        await write('catalog.json', JSON.stringify({ version: '1.0', name: title, generatedAt: stamp, presets: entries }, null, 2));
        return n;
    }

    if (kind === 'folder') {
        // The universal one: publish whatever is already in the folder.
        //
        // This is the case the other kinds cannot cover. A `.mm` is not held by BMM — it is
        // exported — so a catalogue of mod lists can only be built from files somebody has
        // already put somewhere. Point this at that folder.
        const files: string[] = (await invoke('list_dir_files', { dir, exts: null }).catch(() => [])) as string[];
        const KNOWN: Record<string, string> = {
            mm: 'lists', mmlist: 'lists', bmmplug: 'plugins', bmmtheme: 'themes',
            bmmpa: 'presets', bmp: 'modpacks',
        };
        const buckets: Record<string, any[]> = {};
        for (const f of files) {
            const name = String(f).replace(/^.*[/\\]/, '');
            const ext = (name.split('.').pop() || '').toLowerCase();
            const bucket = KNOWN[ext];
            if (!bucket) continue;
            (buckets[bucket] = buckets[bucket] || []).push({
                id: name.replace(/\.[^.]+$/, ''),
                name: name.replace(/\.[^.]+$/, ''),
                file: name,
                url: base ? `${base}/${name}` : undefined,
            });
        }
        const total = Object.values(buckets).reduce((a, b) => a + b.length, 0);
        await write('catalog.json', JSON.stringify({ version: '1.0', name: title, generatedAt: stamp, ...buckets }, null, 2));
        return total;
    }

    if (kind === 'theme') {
        // Embedded, not linked — this is the shape the theme catalogue reader already
        // expects, so a published folder can be followed without any other file.
        const themes: any[] = JSON.parse((await invoke('list_installed_themes') as string) || '[]');
        await write('catalog.json', JSON.stringify({ version: '1.0', name: title, generatedAt: stamp, themes }, null, 2));
        return themes.length;
    }

    if (kind === 'plugin') {
        // Linked, and the link is the author's own download URL: BMM holds an installed
        // plugin as an extracted folder, not as the package it arrived in, so there is no
        // file here to copy. A plugin with no URL is skipped rather than written as an
        // entry that cannot be installed.
        const installed: any[] = (await invoke('get_installed_plugins').catch(() => [])) as any[];
        const plugins = installed
            .map((ip) => ({ m: ip?.manifest || {}, url: ip?.manifest?.download_url || ip?.manifest?.downloadUrl || '' }))
            .filter((x) => x.m.id && (x.url || base))
            .map(({ m, url }) => ({
                id: m.id,
                name: m.name || m.id,
                version: m.version || '1.0.0',
                author: m.author || '',
                description: m.description || '',
                game: m.game || '',
                official: false,
                download_url: url || `${base}/${m.id}.bmmplug`,
                tags: Array.isArray(m.tags) ? m.tags : [],
            }));
        await write('catalog.json', JSON.stringify({ version: '1.0', name: title, generatedAt: stamp, plugins }, null, 2));
        return plugins.length;
    }

    // tutorial — the index points at files, and this writes them too. Same rule as the
    // hub's own builder: the lessons go down BEFORE the index, because a catalog.json
    // listing files that failed to write looks finished and installs nothing.
    const { listCustomDocs, getCustomDoc } = await import('../../ui/tutorial-custom.js');
    const docs = listCustomDocs();
    const written: { id: string; name: string; desc: string }[] = [];
    for (const d of docs) {
        const full = getCustomDoc(d.id);
        if (!full) continue;
        await write(`${d.id}.bmmtut`, JSON.stringify(full, null, 2));
        written.push({ id: d.id, name: d.title?.en || d.id, desc: d.desc?.en || '' });
    }
    const entries = written.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.desc,
        // Relative unless an address was given — the reader resolves an entry URL against
        // the catalogue's own address, so the folder works from wherever it is uploaded.
        url: base ? `${base}/${w.id}.bmmtut` : `${w.id}.bmmtut`,
    }));
    await write('catalog.json', JSON.stringify({
        name: title,
        generatedAt: stamp,
        tutorials: entries,
        // Both shapes: `tutorials` is what this app's reader prefers, `items` with a kind is
        // what BCWEB's pooled catalogues emit. One without the other is invisible to half
        // the readers.
        items: entries.map((e) => ({ ...e, kind: 'tutorial' })),
    }, null, 2));
    return entries.length;
}

const ACTION_TYPES: { v: string; label: string; needs?: string; group: string }[] = [
    // ── Mods & profiles ──
    { v: 'profile.activate', label: 'Activate profile', needs: 'profile', group: 'mods' },
    { v: 'mod.enable', label: 'Enable mod', needs: 'mod', group: 'mods' },
    { v: 'mod.disable', label: 'Disable mod', needs: 'mod', group: 'mods' },
    { v: 'mods.order', label: 'Set which mod wins shared files', needs: 'modOrder', group: 'mods' },
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
    // The repo action that actually RUNS unattended. `repo.gen`, `repo.update` and
    // `repo.host` only open the screen prefilled, which is nothing at 3am; this rewrites
    // repo.json for a folder that is already hosted, and returns what changed.
    { v: 'repo.manifest', label: 'Rebuild a repo\'s manifest (unattended)', needs: 'repoManifest', group: 'repo' },
    // Uses the SSH target saved in Server Repo. A scheduled task cannot answer a passphrase
    // prompt at 04:00, so a key with one fails with a message instead of hanging forever.
    { v: 'repo.publishSsh', label: 'Publish repo over SSH', needs: 'repoSshDir', group: 'repo' },
    // The other direction: keep a local folder in step with what the server actually serves.
    // Same target, same passphrase constraint.
    { v: 'repo.fetchSsh', label: 'Fetch repo over SSH', needs: 'repoSshPullDir', group: 'repo' },
    // ── Apps & launch ──
    { v: 'app.launch', label: 'Launch app', needs: 'app', group: 'apps' },
    { v: 'app.stop', label: 'Stop app / process', needs: 'appStop', group: 'apps' },
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
    // The old one wrote a `.json` through a different command than the Export data screen:
    // a smaller, different thing, with no choice of contents and no way to lock it. Kept,
    // because tasks refer to it and a JSON backup is still what an older BMM can read.
    { v: 'data.exportAuto', label: 'Export data (backup, .json)', needs: 'exportAuto', group: 'system' },
    { v: 'data.backup', label: 'Back up data (.DATABMM)', needs: 'dataBackup', group: 'system' },
    { v: 'var.set', label: 'Set a variable', needs: 'varSet', group: 'logic' },
    { v: 'app.checkUpdate', label: 'Check for BMM update', needs: 'checkUpdate', group: 'system' },
    { v: 'system.clearApiLog', label: 'Clear API log', group: 'system' },
    { v: 'system.clearResourceRecords', label: 'Clear resource monitor records', group: 'system' },
    // ── Logic & math ──
    { v: 'math.set', label: 'Math: compute into a variable', needs: 'mathSet', group: 'logic' },
    { v: 'var.ternary', label: 'Ternary: var = cond ? a : b', needs: 'ternary', group: 'logic' },
    { v: 'rule.table', label: 'Rule table (decision table)', needs: 'ruleTable', group: 'logic' },
    { v: 'task.stop', label: 'Stop the task (guard clause)', needs: 'stopReason', group: 'logic' },
    { v: 'task.run', label: 'Run another scheduled task', needs: 'taskId', group: 'system' },
    { v: 'task.spawn', label: 'Start another task WITHOUT waiting (async)', needs: 'taskId', group: 'system' },
    { v: 'restart', label: 'Restart BMM', group: 'system' },
    { v: 'open.url', label: 'Open a URL / link', needs: 'url', group: 'system' },
    { v: 'custom.command', label: 'Run custom command', needs: 'command', group: 'system' },
    { v: 'custom.script', label: 'Run a script', needs: 'script', group: 'system' },
    { v: 'folder.create', label: 'Create a folder (BMM data)', needs: 'bmmfolder', group: 'system' },
    { v: 'catalog.create', label: 'Publish a catalogue', needs: 'catCreate', group: 'system' },
    { v: 'code.run', label: 'Run BMMScript (advanced)', needs: 'bmms', group: 'logic' },
    { v: 'repo.syncNow', label: 'Sync a server repo (unattended)', needs: 'reposync', group: 'repo' },
    { v: 'deeplink', label: 'Run bmm:// deeplink', needs: 'url', group: 'system' },
    { v: 'list.set', label: 'List — set it (JSON array or a, b, c)', needs: 'listSet', group: 'logic' },
    { v: 'list.push', label: 'List — add one item', needs: 'listPush', group: 'logic' },
    { v: 'list.clear', label: 'List — empty it', needs: 'listName', group: 'logic' },
    { v: 'map.set', label: 'Map — set a key', needs: 'mapSet', group: 'logic' },
    { v: 'map.get', label: 'Map — read a key into a variable', needs: 'mapGet', group: 'logic' },
    { v: 'id.of', label: 'Content id of a thing, into a variable', needs: 'idOf', group: 'logic' },
    { v: 'map.clear', label: 'Map — empty it', needs: 'mapName', group: 'logic' },
    { v: 'var.clear', label: 'Clear a shared variable', needs: 'varClear', group: 'logic' },
    { v: 'http.request', label: 'Call an HTTP API', needs: 'http', group: 'system' },
    // Waiting for something OUTSIDE BMM to be ready. A task could wait for a clock and for
    // a file; these are the two cases that kept coming up and had no answer.
    { v: 'wait.http', label: 'Wait until an address answers', needs: 'waitHttp', group: 'system' },
    { v: 'wait.hook', label: 'Wait for a signal (webhook)', needs: 'waitHook', group: 'system' },
    // ── Games ──
    // The glue between "a file changed" and "put the right mods on". Universal on purpose:
    // nothing here knows what DCS is except the one action that installs its hook.
    { v: 'text.extract', label: 'Read a value out of a file or a variable', needs: 'textExtract', group: 'logic' },
    { v: 'log.print', label: 'Write a line to the log', needs: 'message', group: 'logic' },
    { v: 'data.validate', label: 'Check what a file is', needs: 'validate', group: 'logic' },
    { v: 'file.write', label: 'Write a file', needs: 'fileWrite', group: 'logic' },
    { v: 'modlist.apply', label: 'Apply a mod list (install what is missing)', needs: 'listApply', group: 'mods' },
    // One action for every game. DCS is a CASE inside it — the only one with a supported
    // callback API, so it gets a hook installed; everything else is a log and a pattern.
    // It used to be a DCS-only action, which made the whole feature look like a DCS feature.
    { v: 'game.watch', label: 'Set up watching a game', needs: 'gameWatch', group: 'apps' },
    // A plugin's shipped files, usable by an automation. The point is the `read` mode: a
    // plugin ships a config template or a list of codes, and a task reads it into a variable
    // instead of that value being typed into the task and drifting from the plugin.
    { v: 'plugin.asset', label: 'Use a file a plugin ships', needs: 'pluginAsset', group: 'mods' },
    // Identity and sources. Both were reachable only by clicking.
    { v: 'key.create', label: 'Make an identity key', needs: 'keyCreate', group: 'repo' },
    // Bringing a file IN. One action for every BMM format, because the questions are the
    // same each time — where is it, is the source protected, is the file locked.
    { v: 'import.file', label: 'Import a file (list, plugin, theme, automation, backup)', needs: 'importFile', group: 'system' },
    { v: 'catalog.follow', label: 'Follow (or stop following) a catalogue', needs: 'catFollow', group: 'repo' },
];

/**
 * The three things a protected source can ask for, as one block.
 *
 * A repo can want a download password, a signed proof from one of your identity keys, or
 * both; a `.mm` or a `.DATABMM` can be sealed with a passphrase. Those were scattered — the
 * sync form had a password buried under "Destructive options" (a password is not a
 * destructive option), nothing offered a key, and nothing offered a passphrase. Written once
 * here so every action that reaches a source asks the same way.
 *
 * `want` picks which of the three apply, because they are not all meaningful everywhere: a
 * catalogue has no passphrase, and a local file has no download password.
 */
/**
 * Which saved SSH server this step uses.
 *
 * Filled in after render because reading the targets is cheap but the list is not known when
 * the markup is built. Blank means the one named `default`, and the option SAYS so rather
 * than being an empty line that happens to mean something.
 */
function sshTargetField(params: Record<string, any>): string {
    return `<div class="sched-field" style="margin-top:6px">
        <label class="sched-flabel">${escHtml(t('sched.ssh.target'))}</label>
        <select class="input sched-r-target" style="min-width:200px"></select>
        <span class="sched-cmd-hint">${escHtml(t('sched.ssh.targetHint'))}</span>
    </div>`;
}

async function fillSshTargets(host: HTMLElement, params: Record<string, any>): Promise<void> {
    const sel = host.querySelector('.sched-r-target') as HTMLSelectElement | null;
    if (!sel) return;
    const { loadTargets, DEFAULT_TARGET } = await import('../repo/repo-ssh.js');
    const names = Object.keys(loadTargets());
    const chosen = String(params.target || '');
    sel.innerHTML = `<option value="">${escHtml(t('sched.ssh.targetDefault').replace('{n}', DEFAULT_TARGET))}</option>`
        + names.map((n) => `<option value="${escAttr(n)}"${n === chosen ? ' selected' : ''}>${escHtml(n)}</option>`).join('')
        // A target the task names and that has since been deleted: shown as gone rather than
        // silently falling back to `default`, which would publish to the wrong server.
        + (chosen && !names.includes(chosen)
            ? `<option value="${escAttr(chosen)}" selected>${escHtml(t('sched.ssh.targetMissing').replace('{n}', chosen))}</option>` : '');
    if (!names.length) {
        sel.insertAdjacentHTML('afterend',
            `<span class="sched-cmd-hint">${escHtml(t('sched.ssh.none'))}</span>`);
    }
    sel.addEventListener('change', () => { params.target = sel.value; });
}

function credsFields(params: Record<string, any>, want: { password?: boolean; key?: boolean; passphrase?: boolean }): string {
    const rows: string[] = [];
    if (want.password) {
        rows.push(`<label class="sched-cmd-label">${escHtml(t('sched.creds.password'))}</label>
            <input class="input sched-c-pass" type="password" autocomplete="new-password"
                placeholder="${escAttr(t('sched.creds.passwordPh'))}" value="${escAttr(params.password || '')}">`);
    }
    if (want.key) {
        // Filled in from the ring after render — reading it is async and this returns markup.
        rows.push(`<label class="sched-cmd-label">${escHtml(t('sched.creds.key'))}</label>
            <select class="input sched-c-key" style="max-width:280px"></select>
            <span class="sched-cmd-hint">${escHtml(t('sched.creds.keyHint'))}</span>`);
    }
    if (want.passphrase) {
        rows.push(`<label class="sched-cmd-label">${escHtml(t('sched.creds.passphrase'))}</label>
            <input class="input sched-c-phrase" type="password" autocomplete="new-password"
                value="${escAttr(params.passphrase || '')}">
            <span class="sched-cmd-hint">${escHtml(t('sched.creds.passphraseHint'))}</span>`);
    }
    if (!rows.length) return '';
    return `<details class="sched-cmd-adv sched-creds">
        <summary>${escHtml(t('sched.creds.title'))}</summary>
        ${rows.join('')}
    </details>`;
}

/** Bind the block. Safe to call for a host that has none of it — nothing matches. */
function wireCreds(host: HTMLElement, params: Record<string, any>): void {
    host.querySelector('.sched-c-pass')?.addEventListener('input', (e) => {
        params.password = (e.target as HTMLInputElement).value;
    });
    host.querySelector('.sched-c-phrase')?.addEventListener('input', (e) => {
        params.passphrase = (e.target as HTMLInputElement).value;
    });
    const keySel = host.querySelector('.sched-c-key') as HTMLSelectElement | null;
    if (!keySel) return;
    void (async () => {
        const ring = await (invoke('key_auth_list') as Promise<any>).catch(() => null);
        const keys: { name: string }[] = Array.isArray(ring?.keys) ? ring.keys : [];
        const chosen = String(params.keyName || '');
        // "The active one" is the default and is named, rather than being a blank option
        // that silently means the same thing. Which key is active is a global setting and
        // somebody reading this task should not have to go and look it up.
        const activeLabel = ring?.active
            ? t('sched.creds.keyActive').replace('{k}', String(ring.active))
            : t('sched.creds.keyNone');
        keySel.innerHTML = `<option value="">${escHtml(activeLabel)}</option>`
            + keys.map((k) => `<option value="${escAttr(k.name)}"${k.name === chosen ? ' selected' : ''}>${escHtml(k.name)}</option>`).join('')
            // A key named by the task and since removed from the ring: shown as gone rather
            // than silently falling back to the active one, which would sign as somebody else.
            + (chosen && !keys.some((k) => k.name === chosen)
                ? `<option value="${escAttr(chosen)}" selected>${escHtml(t('sched.creds.keyMissing').replace('{k}', chosen))}</option>` : '');
        keySel.addEventListener('change', () => { params.keyName = keySel.value; });
    })();
}

/**
 * Apply an action's credentials before it reaches the source.
 *
 * The password and the passphrase are passed to the command that needs them; the KEY is
 * different — proofs are signed by whichever key is bound to that host, so naming one here
 * binds it. That binding is what `key_auth_set_for_url` was built for, and it persists,
 * which is the honest behaviour: the next sync of the same repo, by hand, uses the same key.
 */
async function applyCredsFor(url: string, params: Record<string, any>): Promise<void> {
    const name = String(params.keyName || '').trim();
    if (!name || !url) return;
    try { await invoke('key_auth_set_for_url', { url, name }); } catch { /* unprotected source */ }
}

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

type ProcInfo = { pid: number; name: string; exe: string | null; memMb: number };
let _procsPromise: Promise<ProcInfo[]> | null = null;

/**
 * The processes running right now, for the name/pid pickers.
 *
 * Refreshed on demand rather than cached for the session, unlike the interpreter probe:
 * what is running changes constantly, and a stale list is worse than none here — it would
 * offer a pid that has already been recycled onto a different program.
 */
function runningProcesses(force = false): Promise<ProcInfo[]> {
    if (force || !_procsPromise) {
        _procsPromise = invoke('list_running_processes')
            .then((r: any) => (Array.isArray(r) ? (r as ProcInfo[]) : []))
            .catch(() => [] as ProcInfo[]);
    }
    return _procsPromise;
}

/**
 * Fill a <datalist> with the process names actually running, so the field offers real
 * answers instead of asking the user to remember an executable name.
 *
 * A name that matches nothing makes a condition that is silently always false, which is
 * why this is worth more than it looks: the old field accepted "DCS" happily and the task
 * simply never fired.
 *
 * Deduped by name — a browser with thirty helper processes should be one suggestion, not
 * thirty — and kept in the backend's heaviest-first order, so the application somebody
 * means is near the top.
 */
async function fillProcessDatalist(host: HTMLElement, id: string): Promise<void> {
    const dl = host.querySelector(`#${id}`) as HTMLDataListElement | null;
    if (!dl) return;
    const procs = await runningProcesses(true);
    if (!dl.isConnected) return;
    const seen = new Set<string>();
    dl.innerHTML = procs
        .filter((p) => p.name && !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()))
        .slice(0, 200)
        .map((p) => `<option value="${escAttr(p.name)}">${escAttr(`pid ${p.pid} · ${p.memMb} MB`)}</option>`)
        .join('');
}

/** What the backend probe found, once per session. */
type EngineInfo = { engine: string; available: boolean; program: string | null; version: string | null };
let _enginesPromise: Promise<EngineInfo[]> | null = null;

// Probed once and reused. Each probe spawns interpreters to ask their version, which is
// far too expensive to redo on every keystroke in the engine dropdown — and the answer
// cannot change while the app is open without the user installing something, at which
// point reopening BMM is a reasonable price.
function scriptEngines(): Promise<EngineInfo[]> {
    if (!_enginesPromise) {
        // This project's invoke() returns Promise<any> and is not generic — the cast is the
        // annotation, not a type argument.
        _enginesPromise = invoke('scheduler_script_engines')
            .then((r: any) => (Array.isArray(r) ? (r as EngineInfo[]) : []))
            .catch(() => [] as EngineInfo[]);
    }
    return _enginesPromise;
}

/**
 * Say whether the selected language can actually run here, and which binary it will use.
 *
 * BMM bundles no interpreter, so "does Python work?" is a property of the machine, not of
 * the build — and the honest answer is often no. Without this, the first sign of trouble
 * was a task failing at whatever hour it was scheduled for.
 */
async function paintEngineStatus(host: HTMLElement, engine: string): Promise<void> {
    const el = host.querySelector('.sched-engine-status') as HTMLElement | null;
    if (!el) return;
    el.textContent = t('sched.scrEngChecking') || 'Checking…';
    const info = (await scriptEngines()).find((e) => e.engine === engine);
    // Still the panel we started on? The user can switch language while the probe runs.
    if (!el.isConnected) return;
    if (!info) { el.textContent = ''; return; }
    if (info.available) {
        el.classList.remove('sched-engine-missing');
        el.textContent = (t('sched.scrEngOk') || 'Will run with {program} ({version}) on this computer.')
            .replace('{program}', info.program || engine).replace('{version}', info.version || '?');
    } else {
        el.classList.add('sched-engine-missing');
        el.textContent = engine === 'python'
            ? (t('sched.scrEngNoPy') || 'No Python found on this computer. BMM does not bundle one — this task will fail until you install Python and it is on your PATH.')
            : (t('sched.scrEngNo') || 'Not available on this computer — this task will fail until it is installed.');
    }
}

function renderParams(host: HTMLElement, needs: string | undefined, params: Record<string, any>): void {
    if (!needs) { host.innerHTML = ''; return; }
    if (needs === 'profile') host.innerHTML = _field(needs, `<select class="input sched-p" style="max-width:200px">${pickerOptions(_profiles, params.id)}</select>`);
    else if (needs === 'mod') host.innerHTML = _field(needs, `<select class="input sched-p" style="max-width:240px">${pickerOptions(_mods, params.id)}</select>`);
    else if (needs === 'modOrder') {
        const modes = [['last', t('sched.order.modeLast')], ['first', t('sched.order.modeFirst')]] as [string, string][];
        host.innerHTML = `
        <div class="sched-cmd-builder">
            <div class="sched-cmd-row">
                <select class="input sched-p" style="max-width:240px">${pickerOptions(_mods, params.id)}</select>
                <select class="input sched-p-mode" style="max-width:190px">
                    ${modes.map(([v, l]) => `<option value="${v}"${(params.mode || 'last') === v ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}
                </select>
            </div>
            <span class="sched-cmd-hint">${escHtml(t('sched.order.hint'))}</span>
            <label class="sched-cmd-label">${escHtml(t('sched.order.exact'))}</label>
            <input class="input sched-p-order" placeholder="${escAttr(t('sched.order.exactPh'))}" value="${escAttr(params.order || '')}">
            <span class="sched-cmd-hint">${escHtml(t('sched.order.exactHint'))}</span>
        </div>`;
    }
    else if (needs === 'modpack') host.innerHTML = _field(needs, `<select class="input sched-p" style="max-width:200px">${pickerOptions(_modpacks, params.id)}</select>`);
    else if (needs === 'theme') host.innerHTML = _field(needs, `<select class="input sched-p" style="max-width:200px">${pickerOptions(_themes, params.id)}</select>`);
    else if (needs === 'appStop') {
        host.innerHTML = `
        <div class="sched-cmd-builder">
            <label class="sched-cmd-label">${t('sched.stopWhich') || '1. Which program'}</label>
            <div class="sched-cmd-row">
                <input class="input sched-p-name" list="sched-proc-list-a" placeholder="${escAttr(t('sched.appName') || 'app exe (e.g. DCS.exe)')}" value="${escAttr(params.name || '')}" style="max-width:220px">
                <datalist id="sched-proc-list-a"></datalist>
                <input class="input sched-p-pid" type="number" min="1" placeholder="${escAttr(t('sched.pidPh') || 'or pid')}" value="${escAttr(params.pid ?? '')}" style="max-width:110px">
            </div>
            <span class="sched-cmd-hint">${t('sched.stopHint') || 'Every process with that name is stopped. BMM itself is never stopped, so a task cannot kill the scheduler running it.'}</span>
            <span class="sched-cmd-hint">${t('sched.stopPerm') || 'Grant “Stop programs” in this task’s Permissions, or it won’t run. Stopping a program can lose unsaved work.'}</span>
        </div>`;
        host.querySelector('.sched-p-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-p-pid')?.addEventListener('input', (e) => {
            const v = parseInt((e.target as HTMLInputElement).value, 10);
            params.pid = Number.isFinite(v) && v > 0 ? v : undefined;
        });
        void fillProcessDatalist(host, 'sched-proc-list-a');
    }
    else if (needs === 'app') host.innerHTML = _field(needs, _apps.length
        ? `<select class="input sched-p" style="max-width:220px">${pickerOptions(_apps, params.id)}</select>`
        : `<input class="input sched-p" placeholder="${escAttr(t('sched.appIdPh') || 'app id (install an app first)')}" value="${escAttr(params.id || '')}" style="max-width:220px">`);
    else if (needs === 'message') host.innerHTML = _field(needs, `<input class="input sched-p" placeholder="${escAttr(t('sched.message') || 'message')}" value="${escAttr(params.message || '')}">`);
    else if (needs === 'url') host.innerHTML = _field(needs, `<input class="input sched-p" placeholder="bmm://mod/enable?id=…" value="${escAttr(params.url || '')}">`);
    else if (needs === 'command') {
        host.innerHTML = `
        <div class="sched-cmd-builder">
            <label class="sched-cmd-label">${t('sched.cmdProgram') || '1. Program to run'}</label>
            <div class="sched-cmd-row">
                <!-- A datalist rather than a <select>: what is running right now is a good
                     SUGGESTION and a terrible constraint. The program a task launches is
                     usually one that is NOT running — that is generally the point — so the
                     list has to sit beside free typing instead of replacing it. Filled
                     asynchronously below; an empty list leaves an ordinary text box. -->
                <input class="input sched-p-prog" list="sched-prog-list" spellcheck="false"
                    placeholder="${escAttr(t('sched.programPh') || 'e.g. notepad.exe — or pick one that is running')}" value="${escAttr(params.program || '')}">
                <datalist id="sched-prog-list"></datalist>
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
            <span class="sched-cmd-hint">${t('sched.cmdHint') || 'Tip: grant “Run external programs” in this task’s Permissions, or it won’t run.'}</span>
        </div>`;
        void fillProgramSuggestions(host);
    }
    else if (needs === 'reposync') {
        const profOpts = _profiles.map((pr: any) =>
            `<option value="${escAttr(pr.id)}"${params.targetProfile === pr.id ? ' selected' : ''}>${escHtml(pr.name || pr.id)}</option>`).join('');
        host.innerHTML = `
        <div class="sched-cmd-builder">
            <label class="sched-cmd-label">${t('sched.syncUrl') || '1. Repo URL'}</label>
            <input class="input sched-rs-url" placeholder="https://example.com/repo.json" value="${escAttr(params.url || '')}">
            <label class="sched-cmd-label">${t('sched.syncRepoProfile') || '2. Which profile inside the repo'}</label>
            <input class="input sched-rs-rprof" placeholder="${escAttr(t('sched.syncRepoProfilePh') || 'its name, e.g. Main — required when the repo has several')}" value="${escAttr(params.repoProfile || '')}">
            <label class="sched-cmd-label">${t('sched.syncTarget') || '3. Install into this local profile'}</label>
            <select class="input sched-rs-target"><option value="">${escHtml(t('sched.syncTargetNone') || '— pick one —')}</option>${profOpts}</select>
            <label class="sched-cmd-label">${t('sched.syncFolders') || '4. Folders'}</label>
            <div class="sched-cmd-row"><input class="input sched-rs-game" placeholder="${escAttr(t('sched.syncGamePh') || 'game folder')}" value="${escAttr(params.gameDir || '')}"><button type="button" class="btn btn-sm btn-secondary sched-rs-browse" data-for="game">${t('sched.choose') || 'Choose…'}</button></div>
            <div class="sched-cmd-row" style="margin-top:6px"><input class="input sched-rs-mods" placeholder="${escAttr(t('sched.syncModsPh') || 'mods folder')}" value="${escAttr(params.modsDir || '')}"><button type="button" class="btn btn-sm btn-secondary sched-rs-browse" data-for="mods">${t('sched.choose') || 'Choose…'}</button></div>
            <div class="sched-cmd-row" style="margin-top:6px"><input class="input sched-rs-backup" placeholder="${escAttr(t('sched.syncBackupPh') || 'backup folder (optional)')}" value="${escAttr(params.backupDir || '')}"><button type="button" class="btn btn-sm btn-secondary sched-rs-browse" data-for="backup">${t('sched.choose') || 'Choose…'}</button></div>
            <details class="sched-cmd-adv">
                <summary>${t('sched.syncDanger') || 'Destructive options — off by default'}</summary>
                <label class="sched-opt" style="margin-top:6px"><input type="checkbox" class="sched-rs-overwrite" ${params.overwriteAll ? 'checked' : ''}><div><b>${t('sched.syncOverwriteT') || 'Overwrite every file'}</b><span>${t('sched.syncOverwrite') || 'Re-downloads and replaces files that already match. Slower, and your local edits are lost.'}</span></div></label>
                <label class="sched-opt"><input type="checkbox" class="sched-rs-delete" ${params.deleteExtra ? 'checked' : ''}><div><b>${t('sched.syncDeleteT') || 'Delete mods the repo does not have'}</b><span>${t('sched.syncDelete') || 'Removes anything in the mods folder that is not in the repo. On a schedule this runs with nobody watching — leave it off unless the folder is only ever filled by this repo.'}</span></div></label>
            </details>
            ${credsFields(params, { password: true, key: true })}
        </div>`;
        // The password used to live inside "Destructive options", which it is not. It is now
        // in the block every action that reaches a protected source shares, next to the key.
        wireCreds(host, params);
    }
    else if (needs === 'bmmfolder') host.innerHTML = _field(needs,
        `<input class="input sched-p-bmmdir" placeholder="${escAttr(t('sched.bmmFolderPh') || 'e.g. backups/weekly')}" value="${escAttr(params.path || '')}">`)
        + `<span class="sched-cmd-hint">${t('sched.bmmFolderHint') || 'Created inside BMM’s own data folder. Sub-paths are allowed; the folder cannot be placed outside it.'}</span>`;
    else if (needs === 'script') {
        const eng = params.engine || 'powershell';
        const engines: [string, string][] = [
            ['powershell', 'PowerShell'], ['cmd', 'CMD / Batch'], ['bash', 'Bash'], ['python', 'Python'],
            ['node', 'JavaScript (Node)'],
            // Compiled, not interpreted: a Rust step pays rustc's startup before it runs.
            // Fine for a nightly job, wrong for one that fires every minute — the status
            // line below says so when this is selected.
            ['rust', 'Rust'],
        ];
        host.innerHTML = `
        <div class="sched-cmd-builder">
            <label class="sched-cmd-label">${t('sched.scrEngine') || '1. Language'}</label>
            <select class="input sched-p-engine" style="max-width:180px">
                ${engines.map(([v, l]) => `<option value="${v}"${eng === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
            <!-- Filled in asynchronously by paintEngineStatus. BMM bundles no interpreter,
                 so the answer to "will this run?" is a property of THIS machine and cannot
                 be known at build time. Saying it here is the difference between finding out
                 now and finding out from a failed run at 3am. -->
            <span class="sched-cmd-hint sched-engine-status"></span>
            <!-- painted right after this innerHTML lands; see the void call below -->
            <label class="sched-cmd-label">${t('sched.scrCode') || '2. Code'}</label>
            <textarea class="input sched-p-code sched-code" rows="9" spellcheck="false"
                placeholder="${escAttr(t('sched.scrCodePh') || 'Write your script here. It runs as a file — no quoting or escaping needed.')}">${escHtml(params.code || '')}</textarea>
            <span class="sched-cmd-hint">${t('sched.scrSubst') || 'Inside a For-Each, {item.name} and {item.id} are substituted before the script runs.'}</span>
            <details class="sched-cmd-adv">
                <summary>${t('sched.scrAdvanced') || 'Advanced — working folder, capture output'}</summary>
                <div class="sched-cmd-row" style="margin-top:6px">
                    <input class="input sched-p-wd" placeholder="${escAttr(t('sched.workdirPh') || 'folder to run from (optional)')}" value="${escAttr(params.workingDir || '')}">
                    <button type="button" class="btn btn-sm btn-secondary sched-browse-wd">${t('sched.choose') || 'Choose…'}</button>
                </div>
                <input class="input sched-p-into" style="margin-top:6px"
                    placeholder="${escAttr(t('sched.scrIntoPh') || 'store the first output line in a variable, e.g. count')}" value="${escAttr(params.into || '')}">
                <span class="sched-cmd-hint">${t('sched.scrIntoHint') || 'Named here, the result becomes a variable later steps can test — otherwise a script can only pass or fail.'}</span>
                <label class="sched-cmd-row" style="margin-top:8px"><input type="checkbox" class="sched-p-keepgoing"${params.keepGoing ? ' checked' : ''}>
                    <span>${escHtml(t('sched.scrKeepGoing'))}</span></label>
                <span class="sched-cmd-hint">${escHtml(t('sched.scrKeepGoingHint'))}</span>
                <label class="sched-cmd-row" style="margin-top:8px">
                    <span>${escHtml(t('sched.scrTimeout'))}</span>
                    <input type="number" class="input sched-p-timeout" min="1" max="7200" style="max-width:110px"
                        placeholder="300" value="${escAttr(params.timeoutSecs ?? '')}">
                </label>
                <span class="sched-cmd-hint">${escHtml(t('sched.scrTimeoutHint'))}</span>
            </details>
            <span class="sched-cmd-hint">${t('sched.scrHint') || 'Tip: grant “Run scripts” in this task’s Permissions, or it won’t run.'}</span>
        </div>`;
        void paintEngineStatus(host, eng);
    }
    // The three list actions had no branch here at all. `renderParams` only assigns
    // host.innerHTML inside a matching branch, so picking "List — set it" left the PREVIOUS
    // action's fields on screen: the list name and value could never be typed, and the step
    // silently ran against the default name with an empty value. The actions worked; the
    // editor could not reach them.
    //
    // Reuses .sched-p-varname / .sched-p-varvalue because the generic wiring at the end of
    // this function already maps them to params.name / params.value — which is exactly what
    // list.set, list.push and list.clear read.
    else if (needs === 'importFile') {
        const KINDS = ['auto', 'modlist', 'plugin', 'theme', 'automation', 'bundle', 'backup'];
        const kind = String(params.kind || 'auto');
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.imp.file') || '1. A file on this machine')}</label>
            <div style="display:flex;gap:6px">
                <input class="input sched-p-impath" spellcheck="false" style="flex:1" value="${escAttr(params.path || '')}">
                <button type="button" class="btn btn-xs btn-ghost sched-browse-impath">${escHtml(t('common.browse') || 'Browse')}</button>
            </div>
            <label class="sched-cmd-label">${escHtml(t('sched.imp.url') || '… or an address to fetch it from')}</label>
            <input class="input sched-p-imurl" spellcheck="false" placeholder="https://…" value="${escAttr(params.url || '')}">
            <label class="sched-cmd-label">${escHtml(t('sched.imp.kind') || '2. What it is')}</label>
            <select class="input sched-p-imkind" style="max-width:280px">
                ${KINDS.map((k) => `<option value="${k}"${kind === k ? ' selected' : ''}>${escHtml(t('sched.imp.k.' + k))}</option>`).join('')}
            </select>
            <span class="sched-cmd-hint">${escHtml(t('sched.imp.kindHint') || '')}</span>
            <div class="sched-imp-extra"></div>
            ${credsFields(params, { password: true, key: true, passphrase: true })}
        </div>`;

        // Per-kind extras, drawn for the kind that is chosen. `auto` shows the mod-list ones,
        // because that is what `auto` resolves to for anything it cannot place, and a form
        // with no options at all reads as an action with nothing to configure.
        const extra = host.querySelector('.sched-imp-extra') as HTMLElement;
        const paintExtra = () => {
            const k = (host.querySelector('.sched-p-imkind') as HTMLSelectElement).value;
            if (k === 'modlist' || k === 'auto') {
                extra.innerHTML = `
                    <label class="sched-cmd-row"><input type="checkbox" class="sched-p-imapply"${params.apply ? ' checked' : ''}>
                        <span>${escHtml(t('sched.imp.apply'))}</span></label>
                    <label class="sched-cmd-row"><input type="checkbox" class="sched-p-iminstall"${params.install !== false ? ' checked' : ''}>
                        <span>${escHtml(t('sched.la.install'))}</span></label>
                    <label class="sched-cmd-row"><input type="checkbox" class="sched-p-imexact"${params.exact ? ' checked' : ''}>
                        <span>${escHtml(t('sched.la.exact'))}</span></label>`;
            } else if (k === 'backup') {
                extra.innerHTML = `
                    <label class="sched-cmd-row sched-bk-danger"><input type="checkbox" class="sched-p-imrestore"${params.restore ? ' checked' : ''}>
                        <span>${escHtml(t('sched.imp.restore'))}</span></label>
                    <span class="sched-cmd-hint">${escHtml(t('sched.imp.restoreHint'))}</span>`;
            } else if (k === 'bundle') {
                const TYPES = ['app', 'plugin', 'theme', 'preset', 'modpack', 'repo', 'tutorial', 'list'];
                extra.innerHTML = `<label class="sched-cmd-label">${escHtml(t('sched.cat.type'))}</label>
                    <select class="input sched-p-imcattype" style="max-width:220px">
                        ${TYPES.map((v) => `<option value="${v}"${(params.catType || 'plugin') === v ? ' selected' : ''}>${escHtml(t('sched.cat.t.' + v))}</option>`).join('')}
                    </select>
                    <span class="sched-cmd-hint">${escHtml(t('sched.imp.bundleHint'))}</span>`;
            } else if (k === 'automation') {
                extra.innerHTML = `<span class="sched-cmd-hint">${escHtml(t('sched.imp.autoHint'))}</span>`;
            } else {
                extra.innerHTML = '';
            }
            extra.querySelector('.sched-p-imapply')?.addEventListener('change', (e) => { params.apply = (e.target as HTMLInputElement).checked; });
            extra.querySelector('.sched-p-iminstall')?.addEventListener('change', (e) => { params.install = (e.target as HTMLInputElement).checked; });
            extra.querySelector('.sched-p-imexact')?.addEventListener('change', (e) => { params.exact = (e.target as HTMLInputElement).checked; });
            extra.querySelector('.sched-p-imrestore')?.addEventListener('change', (e) => { params.restore = (e.target as HTMLInputElement).checked; });
            extra.querySelector('.sched-p-imcattype')?.addEventListener('change', (e) => { params.catType = (e.target as HTMLSelectElement).value; });
        };
        host.querySelector('.sched-p-imkind')?.addEventListener('change', (e) => {
            params.kind = (e.target as HTMLSelectElement).value;
            paintExtra();
        });
        paintExtra();
        wireCreds(host, params);
    }
    else if (needs === 'keyCreate') {
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.key.name') || '1. Name it')}</label>
            <input class="input sched-p-kcname" spellcheck="false" style="max-width:260px"
                placeholder="${escAttr(t('sched.key.namePh') || 'e.g. work')}" value="${escAttr(params.name || '')}">
            <label class="sched-cmd-label">${escHtml(t('sched.key.kind') || '2. Type')}</label>
            <select class="input sched-p-kckind" style="max-width:260px">
                ${[['ed25519', 'ed25519'], ['ecdsa', 'ECDSA (nistp256)'], ['rsa', 'RSA 4096']]
                    .map(([v, l]) => `<option value="${v}"${(params.kind || 'ed25519') === v ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}
            </select>
            <span class="sched-cmd-hint">${escHtml(t('sched.key.kindHint') || '')}</span>
            <label class="sched-cmd-label">${escHtml(t('sched.key.bind') || '3. Use it for this host (optional)')}</label>
            <input class="input sched-p-kcbind" spellcheck="false"
                placeholder="https://repo.example.org" value="${escAttr(params.bindUrl || '')}">
            <span class="sched-cmd-hint">${escHtml(t('sched.key.hint') || '')}</span>
        </div>`;
    }
    else if (needs === 'catFollow') {
        const TYPES = ['app', 'plugin', 'theme', 'preset', 'modpack', 'repo', 'tutorial', 'list'];
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.cat.type') || '1. Kind of catalogue')}</label>
            <select class="input sched-p-cftype" style="max-width:220px">
                ${TYPES.map((v) => `<option value="${v}"${(params.catType || 'plugin') === v ? ' selected' : ''}>${escHtml(t('sched.cat.t.' + v))}</option>`).join('')}
            </select>
            <label class="sched-cmd-label">${escHtml(t('sched.cat.url') || '2. Address')}</label>
            <input class="input sched-p-cfurl" spellcheck="false"
                placeholder="https://…/catalog.json" value="${escAttr(params.url || '')}">
            <label class="sched-cmd-row"><input type="checkbox" class="sched-p-cfoff"${params.unfollow ? ' checked' : ''}>
                <span>${escHtml(t('sched.cat.unfollow') || 'Stop following it instead')}</span></label>
            <span class="sched-cmd-hint">${escHtml(t('sched.cat.hint') || '')}</span>
        </div>`;
    }
    else if (needs === 'dataBackup') {
        // The sections, and their order, come from the shared defaults rather than a list
        // typed here — a section added to the backup format would otherwise be missing from
        // this screen and from nowhere else, which is invisible until somebody restores.
        const SECTIONS: [string, string][] = [
            ['appData', 'sched.bk.sAppData'], ['themes', 'sched.bk.sThemes'],
            ['themePresets', 'sched.bk.sPresets'], ['translations', 'sched.bk.sLang'],
            ['launchPacks', 'sched.bk.sPacks'], ['automations', 'sched.bk.sAutomations'],
            ['navigation', 'sched.bk.sNav'], ['apps', 'sched.bk.sApps'],
            ['replays', 'sched.bk.sReplays'], ['crashes', 'sched.bk.sCrashes'],
            ['diagnostics', 'sched.bk.sDiag'], ['identityKeys', 'sched.bk.sKeys'],
        ];
        const DEFAULTS: Record<string, boolean> = {
            appData: true, themes: true, themePresets: true, translations: true,
            launchPacks: true, automations: true, navigation: true, apps: true,
            replays: false, crashes: false, diagnostics: false, identityKeys: false,
        };
        params.sections = params.sections || { ...DEFAULTS };
        const on = (k: string) => params.sections[k] !== undefined ? !!params.sections[k] : DEFAULTS[k];

        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.bk.dir') || '1. Folder')}</label>
            <div style="display:flex;gap:6px">
                <input class="input sched-p-bkdir" spellcheck="false" style="flex:1" value="${escAttr(params.dir || '')}">
                <button type="button" class="btn btn-xs btn-ghost sched-browse-bkdir">${escHtml(t('common.browse') || 'Browse')}</button>
            </div>
            <label class="sched-cmd-label">${escHtml(t('sched.bk.name') || '2. File name')}</label>
            <input class="input sched-p-bkname" spellcheck="false"
                placeholder="bmm-backup-{date}" value="${escAttr(params.name || '')}">
            <span class="sched-cmd-hint">${escHtml(t('sched.bk.nameHint') || '')}</span>
            <label class="sched-cmd-label">${escHtml(t('sched.bk.exists') || '3. If that name is taken')}</label>
            <select class="input sched-p-bkinc" style="max-width:280px">
                ${['paren', 'underscore', 'timestamp', 'overwrite'].map((v) =>
                    `<option value="${v}"${(params.increment || 'paren') === v ? ' selected' : ''}>${escHtml(t('sched.bk.inc.' + v))}</option>`).join('')}
            </select>
            <label class="sched-cmd-label">${escHtml(t('sched.bk.what') || '4. What goes in')}</label>
            <div class="sched-bk-grid">
                ${SECTIONS.map(([k, key]) => `<label class="sched-cmd-row${k === 'identityKeys' ? ' sched-bk-danger' : ''}">
                    <input type="checkbox" class="sched-p-bksec" data-sec="${escAttr(k)}"${on(k) ? ' checked' : ''}>
                    <span>${escHtml(t(key))}</span></label>`).join('')}
            </div>
            <label class="sched-cmd-label">${escHtml(t('sched.bk.pass') || '5. Passphrase')}</label>
            <input type="password" class="input sched-p-bkpass" autocomplete="new-password"
                value="${escAttr(params.passphrase || '')}">
            <span class="sched-cmd-hint sched-bk-passhint">${escHtml(t('sched.bk.passHint') || '')}</span>
        </div>`;

        const passHint = host.querySelector('.sched-bk-passhint') as HTMLElement;
        const syncHint = () => {
            // The one section that changes what the passphrase field MEANS: optional
            // everywhere else, required here, and the screen has to say which it is now.
            const keys = !!params.sections.identityKeys;
            passHint.textContent = keys
                ? (t('sched.bk.passRequired') || '')
                : (t('sched.bk.passHint') || '');
            passHint.classList.toggle('is-required', keys);
        };
        host.querySelectorAll<HTMLInputElement>('.sched-p-bksec').forEach((cb) => {
            cb.addEventListener('change', () => {
                params.sections[cb.dataset.sec as string] = cb.checked;
                syncHint();
            });
        });
        syncHint();
    }
    else if (needs === 'pluginAsset') {
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.pa.plugin') || '1. Plugin')}</label>
            <select class="input sched-p-paplugin"><option value="">—</option></select>
            <label class="sched-cmd-label">${escHtml(t('sched.pa.file') || '2. File it ships')}</label>
            <select class="input sched-p-pafile"><option value="">—</option></select>
            <label class="sched-cmd-label">${escHtml(t('sched.pa.mode') || '3. What to do with it')}</label>
            <select class="input sched-p-pamode" style="max-width:260px">
                <option value="read"${(params.mode || 'read') === 'read' ? ' selected' : ''}>${escHtml(t('sched.pa.modeRead'))}</option>
                <option value="copy"${params.mode === 'copy' ? ' selected' : ''}>${escHtml(t('sched.pa.modeCopy'))}</option>
                <option value="open"${params.mode === 'open' ? ' selected' : ''}>${escHtml(t('sched.pa.modeOpen'))}</option>
                <option value="run"${params.mode === 'run' ? ' selected' : ''}>${escHtml(t('sched.pa.modeRun'))}</option>
            </select>
            <div class="sched-pa-extra"></div>
        </div>`;

        // The two lists come from what is actually installed, not from what the task
        // remembers. A plugin uninstalled since the task was written must show as missing
        // here rather than as a name that looks fine and fails at four in the morning.
        void (async () => {
            const plugins = await (invoke('get_installed_plugins') as Promise<any[]>).catch(() => []);
            const psel = host.querySelector('.sched-p-paplugin') as HTMLSelectElement | null;
            const fsel = host.querySelector('.sched-p-pafile') as HTMLSelectElement | null;
            if (!psel || !fsel) return;

            const chosen = String(params.pluginId || '');
            const known = plugins.some((pl: any) => pl?.manifest?.id === chosen);
            psel.innerHTML = `<option value="">—</option>`
                + plugins.map((pl: any) => {
                    const id = String(pl?.manifest?.id || '');
                    return `<option value="${escAttr(id)}"${id === chosen ? ' selected' : ''}>${escHtml(pl?.manifest?.name || id)}</option>`;
                }).join('')
                // Named as gone rather than silently dropped: the task still holds the id,
                // and a blank dropdown would look like nothing had ever been chosen.
                + (chosen && !known ? `<option value="${escAttr(chosen)}" selected>${escHtml(t('sched.pa.missing').replace('{p}', chosen))}</option>` : '');

            const fillFiles = async () => {
                const id = psel.value;
                const files = id
                    ? await (invoke('plugin_assets_list', { pluginId: id }) as Promise<any[]>).catch(() => [])
                    : [];
                const cur = String(params.path || '');
                fsel.innerHTML = files.length
                    ? files.map((a: any) => `<option value="${escAttr(a.path)}"${a.path === cur ? ' selected' : ''}>${escHtml(a.path)}${a.kind === 'script' ? '  • ' + escHtml(t('plugins.assets.kindScript')) : ''}</option>`).join('')
                    : `<option value="">${escHtml(t('sched.pa.noFiles'))}</option>`;
                if (files.length && !files.some((a: any) => a.path === cur)) params.path = files[0].path;
            };
            psel.addEventListener('change', () => { params.pluginId = psel.value; params.path = ''; void fillFiles(); });
            fsel.addEventListener('change', () => { params.path = fsel.value; });
            await fillFiles();
        })();

        // The mode decides which extra field is needed, so it is drawn per mode rather than
        // showing a "folder" box to somebody who chose "read".
        const extra = host.querySelector('.sched-pa-extra') as HTMLElement;
        const paintExtra = () => {
            const mode = (host.querySelector('.sched-p-pamode') as HTMLSelectElement).value;
            if (mode === 'read') {
                extra.innerHTML = `<label class="sched-cmd-label">${escHtml(t('sched.pa.target') || 'Keep it as')}</label>
                    <input class="input sched-p-patarget" spellcheck="false" style="max-width:220px"
                        placeholder="asset" value="${escAttr(params.target || '')}">
                    <span class="sched-cmd-hint">${escHtml(t('sched.pa.readHint') || '')}</span>`;
                extra.querySelector('.sched-p-patarget')?.addEventListener('input', (e) => {
                    params.target = (e.target as HTMLInputElement).value;
                });
            } else if (mode === 'copy') {
                extra.innerHTML = `<label class="sched-cmd-label">${escHtml(t('sched.pa.dir') || 'Copy it into')}</label>
                    <div style="display:flex;gap:6px">
                        <input class="input sched-p-padir" spellcheck="false" style="flex:1" value="${escAttr(params.dir || '')}">
                        <button type="button" class="btn btn-xs btn-ghost sched-browse-padir">${escHtml(t('common.browse') || 'Browse')}</button>
                    </div>`;
                extra.querySelector('.sched-p-padir')?.addEventListener('input', (e) => {
                    params.dir = (e.target as HTMLInputElement).value;
                });
                extra.querySelector('.sched-browse-padir')?.addEventListener('click', async () => {
                    const { pickFolder } = await import('../../core/api.js');
                    const d = await pickFolder().catch(() => null);
                    if (!d) return;
                    params.dir = d;
                    (extra.querySelector('.sched-p-padir') as HTMLInputElement).value = String(d);
                });
            } else if (mode === 'run') {
                extra.innerHTML = `<span class="sched-cmd-hint">${escHtml(t('sched.pa.runHint') || '')}</span>`;
            } else {
                extra.innerHTML = `<span class="sched-cmd-hint">${escHtml(t('sched.pa.openHint') || '')}</span>`;
            }
        };
        host.querySelector('.sched-p-pamode')?.addEventListener('change', (e) => {
            params.mode = (e.target as HTMLSelectElement).value;
            paintExtra();
        });
        paintExtra();
    }
    else if (needs === 'textExtract') {
        // Two sources, one field each, and only one is used — whichever is filled in. A
        // radio to choose between them would be a third control for a decision the two
        // fields already make.
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.tx.file') || '1. Read from this file')}</label>
            <div style="display:flex;gap:6px">
                <input class="input sched-p-txpath" spellcheck="false" style="flex:1"
                    placeholder="${escAttr(t('sched.tx.filePh') || '')}"
                    value="${escAttr(params.path || '')}">
                <button type="button" class="btn btn-xs btn-ghost sched-browse-txpath">${escHtml(t('common.browse') || 'Browse')}</button>
            </div>
            <label class="sched-cmd-label">${escHtml(t('sched.tx.orVar') || '… or from this variable')}</label>
            <input class="input sched-p-txsource" spellcheck="false" style="max-width:220px"
                placeholder="${escAttr(t('sched.tx.orVarPh') || 'a variable name')}"
                value="${escAttr(params.source || '')}">
            <label class="sched-cmd-label">${escHtml(t('sched.tx.regex') || '2. Pattern')}</label>
            <select class="input sched-p-txlib" data-csel-search="1" style="max-width:100%;margin-bottom:6px">
                <option value="">${escHtml(t('sched.rx.pick'))}</option>
                ${REGEX_LIBRARY.map((r) => `<option value="${escAttr(r.re)}">${escHtml(t(r.label))}</option>`).join('')}
            </select>
            <input class="input sched-p-txregex" spellcheck="false"
                placeholder="${escAttr(t('sched.tx.regexPh') || '')}"
                value="${escAttr(params.regex || '')}">
            <span class="sched-cmd-hint">${escHtml(t('sched.tx.regexHint') || '')}</span>
            <label class="sched-cmd-label">${escHtml(t('sched.tx.target') || '3. Keep it as')}</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                <input class="input sched-p-txtarget" spellcheck="false" style="max-width:200px"
                    placeholder="server" value="${escAttr(params.target || '')}">
                <span class="sched-cmd-hint">${escHtml(t('sched.tx.group') || 'group')}</span>
                <input type="number" class="input sched-p-txgroup" min="0" style="max-width:80px"
                    value="${escAttr(String(params.group ?? 1))}">
                <span class="sched-cmd-hint">${escHtml(t('sched.tx.tail') || 'last KB')}</span>
                <input type="number" class="input sched-p-txtail" min="1" style="max-width:90px"
                    value="${escAttr(String(params.tailKb ?? 64))}">
            </div>
        </div>`;
    }
    else if (needs === 'validate') {
        const formats = ['', 'mm', 'bmmpa', 'bmmplug', 'repo', 'bmmcat', 'bmp', 'cbmp', 'theme', 'databmm', 'bmmreplay', 'bmmnav', 'mm-locked'];
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.valid.file'))}</label>
            <div style="display:flex;gap:6px">
                <input class="input sched-path" spellcheck="false" style="flex:1"
                    placeholder="${escAttr(t('sched.valid.filePh'))}" value="${escAttr(params.path || '')}">
                <button type="button" class="btn btn-xs btn-ghost sched-browse-file">${escHtml(t('common.browse') || 'Browse')}</button>
            </div>
            <label class="sched-cmd-label">${escHtml(t('sched.valid.orText'))}</label>
            <input class="input sched-p-vtext" spellcheck="false"
                placeholder="${escAttr(t('sched.valid.orTextPh'))}" value="${escAttr(params.text || '')}">
            <label class="sched-cmd-label">${escHtml(t('sched.valid.expect'))}</label>
            <select class="input sched-p-vexpect" style="max-width:220px">
                ${formats.map((f) => `<option value="${f}"${(params.expect || '') === f ? ' selected' : ''}>${f ? escHtml(f) : escHtml(t('sched.valid.anything'))}</option>`).join('')}
            </select>
            <span class="sched-cmd-hint">${escHtml(t('sched.valid.hint'))}</span>
        </div>`;
    }
    else if (needs === 'fileWrite') {
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.fw.path'))}</label>
            <div style="display:flex;gap:6px">
                <input class="input sched-path" spellcheck="false" style="flex:1"
                    placeholder="${escAttr(t('sched.fw.pathPh'))}" value="${escAttr(params.path || '')}">
                <button type="button" class="btn btn-xs btn-ghost sched-browse-folder">${escHtml(t('common.browse') || 'Browse')}</button>
            </div>
            <span class="sched-cmd-hint">${escHtml(t('sched.fw.pathHint'))}</span>
            <label class="sched-cmd-label">${escHtml(t('sched.fw.text'))}</label>
            <textarea class="input sched-p-fwtext" rows="4" spellcheck="false"
                placeholder="${escAttr(t('sched.fw.textPh'))}">${escHtml(params.text || '')}</textarea>
            <label class="sched-cmd-opt"><input type="checkbox" class="sched-p-fwappend" ${params.append ? 'checked' : ''}>
                <span>${escHtml(t('sched.fw.append'))}</span></label>
            <span class="sched-cmd-hint">${escHtml(t('sched.fw.appendHint'))}</span>
            <button type="button" class="btn btn-xs btn-ghost sched-fw-open" style="align-self:flex-start;margin-top:6px">${escHtml(t('sched.fw.openOut'))}</button>
        </div>`;
    }
    else if (needs === 'listApply') {
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.la.file') || '1. The list file')}</label>
            <div style="display:flex;gap:6px">
                <input class="input sched-p-lapath" spellcheck="false" style="flex:1"
                    placeholder="${escAttr(t('sched.la.filePh') || 'a .mm on this machine')}"
                    value="${escAttr(params.path || '')}">
                <button type="button" class="btn btn-xs btn-ghost sched-browse-lapath">${escHtml(t('common.browse') || 'Browse')}</button>
            </div>
            <label class="sched-cmd-label">${escHtml(t('sched.la.url') || '… or an address to fetch it from')}</label>
            <input class="input sched-p-laurl" spellcheck="false"
                placeholder="https://…/list.mm" value="${escAttr(params.url || '')}">
            <label class="sched-cmd-row"><input type="checkbox" class="sched-p-lainstall"
                ${params.install !== false ? 'checked' : ''}>
                <span>${escHtml(t('sched.la.install') || 'Install what is missing')}</span></label>
            <label class="sched-cmd-row"><input type="checkbox" class="sched-p-laexact"
                ${params.exact ? 'checked' : ''}>
                <span>${escHtml(t('sched.la.exact') || 'Turn everything else OFF')}</span></label>
            <span class="sched-cmd-hint">${escHtml(t('sched.la.exactHint') || '')}</span>
            <label class="sched-cmd-label">${escHtml(t('sched.la.pass') || 'Passphrase, if the list is locked')}</label>
            <input type="password" class="input sched-p-lapass" autocomplete="new-password"
                value="${escAttr(params.passphrase || '')}">
            <span class="sched-cmd-hint">${escHtml(t('sched.la.passHint') || '')}</span>
        </div>`;
    }
    else if (needs === 'waitHttp' || needs === 'waitHook') {
        const isHook = needs === 'waitHook';
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(isHook ? t('sched.wait.name') : t('sched.wait.url'))}</label>
            <input class="input ${isHook ? 'sched-p-wname' : 'sched-p-wurl'}" spellcheck="false"
                placeholder="${escAttr(isHook ? 'build-done' : 'https://…/health')}"
                value="${escAttr((isHook ? params.name : params.url) || '')}">
            <span class="sched-cmd-hint">${escHtml(isHook ? t('sched.wait.nameHint') : t('sched.wait.urlHint'))}</span>
            ${isHook ? '' : `<label class="sched-cmd-label">${escHtml(t('sched.wait.status'))}</label>
                <input type="number" class="input sched-p-wstatus" min="0" max="599" style="max-width:120px"
                    placeholder="200" value="${escAttr(params.status ?? '')}">
                <span class="sched-cmd-hint">${escHtml(t('sched.wait.statusHint'))}</span>`}
            <label class="sched-cmd-label">${escHtml(t('sched.wait.timing'))}</label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span class="sched-cmd-hint">${escHtml(t('sched.wait.every'))}</span>
                <input type="number" class="input sched-p-wevery" min="1" style="max-width:90px"
                    value="${escAttr(String(params.everySeconds ?? (isHook ? 2 : 5)))}">
                <span class="sched-cmd-hint">${escHtml(t('sched.wait.upTo'))}</span>
                <input type="number" class="input sched-p-wtimeout" min="1" style="max-width:110px"
                    value="${escAttr(String(params.timeoutSeconds ?? 300))}">
                <span class="sched-cmd-hint">${escHtml(t('sched.unitSec'))}</span>
            </div>
            <label class="sched-cmd-row"><input type="checkbox" class="sched-p-wstop"${params.stopOnTimeout !== false ? ' checked' : ''}>
                <span>${escHtml(t('sched.wait.stopOnTimeout'))}</span></label>
            <span class="sched-cmd-hint">${escHtml(t('sched.wait.stopHint'))}</span>
        </div>`;
    }
    else if (needs === 'gameWatch') {
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.gw.game') || '1. Game')}</label>
            <select class="input sched-p-gwgame" style="max-width:280px"></select>
            <div class="sched-gw-note sched-cmd-hint"></div>
            <label class="sched-cmd-label">${escHtml(t('sched.gw.file') || '2. File to watch')}</label>
            <div style="display:flex;gap:6px">
                <input class="input sched-p-gwpath" spellcheck="false" style="flex:1" value="${escAttr(params.path || '')}">
                <button type="button" class="btn btn-xs btn-ghost sched-gw-scan">${escHtml(t('sched.gw.scan') || 'Find in a folder…')}</button>
            </div>
            <span class="sched-cmd-hint">${escHtml(t('sched.gw.fileHint') || '')}</span>
            <label class="sched-cmd-label">${escHtml(t('sched.gw.mode') || '3. What to do')}</label>
            <select class="input sched-p-gwmode" style="max-width:240px">
                <option value="setup"${params.mode !== 'remove' ? ' selected' : ''}>${escHtml(t('sched.gw.setup'))}</option>
                <option value="remove"${params.mode === 'remove' ? ' selected' : ''}>${escHtml(t('sched.gw.remove'))}</option>
            </select>
        </div>`;

        const gameSel = host.querySelector('.sched-p-gwgame') as HTMLSelectElement;
        const pathIn = host.querySelector('.sched-p-gwpath') as HTMLInputElement;
        const noteEl = host.querySelector('.sched-gw-note') as HTMLElement;
        void (async () => {
            const profiles = await (invoke('game_profiles') as Promise<any[]>).catch(() => []);
            const chosen = String(params.game || 'custom');
            gameSel.innerHTML = profiles.map((g) =>
                `<option value="${escAttr(g.id)}"${g.id === chosen ? ' selected' : ''}>${escHtml(g.id === 'custom' ? t('game.other') : g.name)}</option>`).join('');
            const apply = (fromUser: boolean) => {
                const g = profiles.find((x) => x.id === gameSel.value);
                params.game = gameSel.value;
                // A note per game: whether BMM found anything, and whether there is a hook.
                // An empty dropdown with no explanation is the version of this screen that
                // sends somebody hunting through their Documents folder.
                noteEl.textContent = g?.note ? t(g.note) : (g?.found?.length ? '' : t('game.note.notFound'));
                if (fromUser) {
                    // Only on a real choice: overwriting a path somebody typed, because the
                    // form was drawn, is the kind of help nobody asks for twice.
                    pathIn.value = String(g?.found?.[0] || '');
                    params.path = pathIn.value;
                    if (g?.pattern) params.pattern = g.pattern;
                }
            };
            gameSel.addEventListener('change', () => apply(true));
            apply(false);
        })();
        host.querySelector('.sched-gw-scan')?.addEventListener('click', async () => {
            const { pickFolder } = await import('../../core/api.js');
            const dir = await pickFolder().catch(() => null);
            if (!dir) return;
            const hits = await (invoke('game_find_logs', { dir, limit: 25 }) as Promise<string[]>).catch(() => []);
            if (!hits.length) { toast(t('sched.gw.noneFound'), 'warning', 8000); return; }
            // Newest first, and the first is taken: the file a game just wrote to is the one
            // being looked for, and it is never the one that sorts first alphabetically.
            pathIn.value = hits[0];
            params.path = hits[0];
            toast(t('sched.gw.found').replace('{n}', String(hits.length)).replace('{f}', hits[0].replace(/^.*[/\\]/, '')), 'success', 8000);
        });
    }
    else if (needs === 'dcsHook') {
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.dcs.mode') || 'What to do')}</label>
            <select class="input sched-p-dcsmode" style="max-width:220px">
                <option value="install"${params.mode !== 'remove' ? ' selected' : ''}>${escHtml(t('sched.dcs.install') || 'Set it up')}</option>
                <option value="remove"${params.mode === 'remove' ? ' selected' : ''}>${escHtml(t('sched.dcs.remove') || 'Take it out')}</option>
            </select>
            <label class="sched-cmd-label">${escHtml(t('sched.dcs.dir') || 'A specific DCS folder (optional)')}</label>
            <input class="input sched-p-dcsdir" spellcheck="false"
                placeholder="${escAttr(t('sched.dcs.dirPh') || 'blank = every DCS folder found')}"
                value="${escAttr(params.dir || '')}">
            <span class="sched-cmd-hint">${escHtml(t('sched.dcs.hint') || '')}</span>
        </div>`;
    }
    else if (needs === 'listSet' || needs === 'listPush' || needs === 'listName') {
        const nameField = `
            <label class="sched-cmd-label">${t('sched.list.name') || '1. List name'}</label>
            <input class="input sched-p-varname" spellcheck="false"
                placeholder="${escAttr(t('sched.list.namePh') || 'e.g. mods — read back as {list.mods.length}')}"
                value="${escAttr(params.name || '')}">`;
        const valueField = needs === 'listName' ? '' : `
            <label class="sched-cmd-label">${needs === 'listPush'
                ? (t('sched.list.item') || '2. Item to add')
                : (t('sched.list.value') || '2. Items')}</label>
            <textarea class="input sched-p-varvalue" rows="2" spellcheck="false"
                placeholder="${escAttr(needs === 'listPush'
                    ? (t('sched.list.itemPh') || 'One value. {variables} are substituted first.')
                    : (t('sched.list.valuePh') || 'A JSON array, or a, b, c. {variables} are substituted first.'))}">${escHtml(params.value || '')}</textarea>`;
        // Only "set it" splits anything, so only it offers a separator.
        const sepField = needs !== 'listSet' ? '' : `
            <label class="sched-cmd-label">${t('sched.list.sep') || '3. Separator'}</label>
            <input class="input sched-p-listsep" spellcheck="false" style="max-width:120px"
                placeholder="," value="${escAttr(params.sep || '')}">`;
        host.innerHTML = `<div class="sched-cmd-builder">${nameField}${valueField}${sepField}</div>`;
    }
    else if (needs === 'mapSet' || needs === 'mapGet' || needs === 'mapName') {
        const nameField = `
            <label class="sched-cmd-label">${t('sched.map.name') || '1. Map name'}</label>
            <input class="input sched-p-varname" spellcheck="false"
                placeholder="${escAttr(t('sched.map.namePh') || 'e.g. urls — read back as {map.urls.size}')}"
                value="${escAttr(params.name || '')}">`;
        const keyField = needs === 'mapName' ? '' : `
            <label class="sched-cmd-label">${t('sched.map.key') || '2. Key'}</label>
            <input class="input sched-p-mapkey" spellcheck="false"
                placeholder="${escAttr(t('sched.map.keyPh') || '{variables} are substituted first')}"
                value="${escAttr(params.key || '')}">`;
        const tail = needs === 'mapSet' ? `
            <label class="sched-cmd-label">${t('sched.map.value') || '3. Value'}</label>
            <textarea class="input sched-p-varvalue" rows="2" spellcheck="false"
                placeholder="${escAttr(t('sched.map.valuePh') || 'Plain text. {variables} are substituted first.')}">${escHtml(params.value || '')}</textarea>`
            : needs === 'mapGet' ? `
            <label class="sched-cmd-label">${t('sched.map.into') || '3. Store it in'}</label>
            <input class="input sched-p-mapinto" spellcheck="false"
                placeholder="${escAttr(t('sched.map.intoPh') || 'variable name — read back as {name}')}"
                value="${escAttr(params.into || '')}">` : '';
        host.innerHTML = `<div class="sched-cmd-builder">${nameField}${keyField}${tail}</div>`;
    }
    else if (needs === 'idOf') {
        // Three fields and no free text for the kind: a typo there is an action that always
        // fails, and the list is short and fixed.
        const KINDS = ['modpack', 'plugin', 'task'];
        host.innerHTML = `
        <div class="sched-cmd-builder">
            <label class="sched-cmd-label">${t('sched.idof.kind') || '1. What kind of thing'}</label>
            <select class="input sched-p-idkind">
                ${KINDS.map((k) => `<option value="${k}"${params.kind === k ? ' selected' : ''}>${escHtml(t('sched.idof.k.' + k) || k)}</option>`).join('')}
            </select>
            <label class="sched-cmd-label">${t('sched.idof.id') || '2. Its local id'}</label>
            <input class="input sched-p-idid" spellcheck="false"
                placeholder="${escAttr(t('sched.idof.idPh') || 'the id from its card — {variables} are substituted first')}"
                value="${escAttr(params.id || '')}">
            <label class="sched-cmd-label">${t('sched.idof.into') || '3. Store the content id in'}</label>
            <input class="input sched-p-idinto" spellcheck="false"
                placeholder="${escAttr(t('sched.idof.intoPh') || 'variable name — read back as {name}')}"
                value="${escAttr(params.into || '')}">
            <p class="sched-cmd-hint">${escHtml(t('sched.idof.hint') || 'The content id says WHAT the thing is, so the same pack on another machine gives the same answer. Compare it with textIs to check you have what you expect.')}</p>
        </div>`;
    }
    else if (needs === 'varSet') {
        const shared = params.scope === 'shared';
        host.innerHTML = `
        <div class="sched-cmd-builder">
            <label class="sched-cmd-label">${t('sched.var.name') || '1. Name'}</label>
            <input class="input sched-p-varname" spellcheck="false"
                placeholder="${escAttr(t('sched.var.namePh') || 'letters, digits and _ — this is what {name} will match')}"
                value="${escAttr(params.name || '')}">
            <label class="sched-cmd-label">${t('sched.var.value') || '2. Value'}</label>
            <textarea class="input sched-p-varvalue" rows="2" spellcheck="false"
                placeholder="${escAttr(t('sched.var.valuePh') || 'Plain text. {other} variables are substituted first.')}">${escHtml(params.value || '')}</textarea>
            <label class="sched-cmd-label">${t('sched.var.scope') || '3. How long it lasts'}</label>
            <select class="input sched-p-varscope" style="max-width:280px">
                <option value="run"${shared ? '' : ' selected'}>${escHtml(t('sched.var.scopeRun') || 'This run only')}</option>
                <option value="shared"${shared ? ' selected' : ''}>${escHtml(t('sched.var.scopeShared') || 'Shared — every task, until changed')}</option>
            </select>
            <span class="sched-cmd-hint">${escHtml(t('sched.var.hint') || 'A value this run captured always wins over a shared one with the same name, so a shared variable can never shadow a fresh result.')}</span>
            <span class="sched-cmd-hint sched-var-warn">${escHtml(t('sched.var.secret') || 'Not a secret store: shared values sit in BMM’s local storage in plain text, and travel in an exported .bmmpa. Keep tokens out of them.')}</span>
        </div>`;
    }
    else if (needs === 'varClear') host.innerHTML = _field(needs,
        `<input class="input sched-p-varname" spellcheck="false" placeholder="${escAttr(t('sched.var.clearPh') || 'name to clear — leave empty to clear them all')}" value="${escAttr(params.name || '')}">`)
        + `<span class="sched-cmd-hint">${escHtml(t('sched.var.clearHint') || 'Only shared variables. A run’s own values disappear when it ends.')}</span>`;
    else if (needs === 'http') {
        const m = String(params.method || 'GET').toUpperCase();
        const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
        host.innerHTML = `
        <div class="sched-cmd-builder">
            <label class="sched-cmd-label">${t('sched.http.req') || '1. Request'}</label>
            <div class="sched-cmd-row">
                <select class="input sched-p-method" style="max-width:110px">
                    ${methods.map((x) => `<option value="${x}"${m === x ? ' selected' : ''}>${x}</option>`).join('')}
                </select>
                <input class="input sched-p-url" spellcheck="false" placeholder="https://api.example.com/v1/status" value="${escAttr(params.url || '')}">
            </div>
            <label class="sched-cmd-label">${t('sched.http.headers') || '2. Headers'}</label>
            <textarea class="input sched-p-headers" rows="2" spellcheck="false"
                placeholder="${escAttr(t('sched.http.headersPh') || 'One per line — Authorization: Bearer {token}')}">${escHtml(params.headers || '')}</textarea>
            <label class="sched-cmd-label">${t('sched.http.body') || '3. Body'}</label>
            <textarea class="input sched-p-httpbody" rows="3" spellcheck="false"
                placeholder="${escAttr(t('sched.http.bodyPh') || 'Sent as-is. Ignored by GET and HEAD.')}">${escHtml(params.body || '')}</textarea>
            <span class="sched-cmd-hint">${escHtml(t('sched.http.subst') || '{variables} are substituted in the address, the headers and the body before the call.')}</span>
            <details class="sched-cmd-adv">
                <summary>${t('sched.http.adv') || 'Advanced — read one field, timeout, allow error statuses'}</summary>
                <input class="input sched-p-jsonpath" style="margin-top:6px" spellcheck="false"
                    placeholder="${escAttr(t('sched.http.jsonPh') || 'field to read, e.g. data.0.version — blank keeps the whole body')}" value="${escAttr(params.jsonPath || '')}">
                <input class="input sched-p-into" style="margin-top:6px"
                    placeholder="${escAttr(t('sched.http.intoPh') || 'store the result in a variable, e.g. latest')}" value="${escAttr(params.into || '')}">
                <input class="input sched-p-timeout" type="number" min="1000" max="120000" style="margin-top:6px"
                    placeholder="${escAttr(t('sched.http.timeoutPh') || 'timeout in ms (default 15000)')}" value="${escAttr(params.timeoutMs || '')}">
                <label class="sched-opt" style="margin-top:6px"><input type="checkbox" class="sched-p-anystatus" ${params.allowAnyStatus ? 'checked' : ''}><div><b>${escHtml(t('sched.http.anyT') || 'Treat 4xx and 5xx as success')}</b><span>${escHtml(t('sched.http.any') || 'Off by default: otherwise a 500 whose body is an HTML error page becomes the value of a variable a later step trusts. {http.status} is always readable either way.')}</span></div></label>
            </details>
            <span class="sched-cmd-hint">${escHtml(t('sched.http.perm') || 'Needs the “Run external programs” permission — a request can post a captured value anywhere.')}</span>
        </div>`;
    }
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
    else if (needs === 'repoManifest') {
        host.innerHTML = `<div class="sched-cmd-builder">
            <label class="sched-cmd-label">${escHtml(t('sched.rm.dir') || '1. The repo folder')}</label>
            <div style="display:flex;gap:6px">
                <input class="input sched-p-rmdir" spellcheck="false" style="flex:1" value="${escAttr(params.dir || '')}">
                <button type="button" class="btn btn-xs btn-ghost sched-browse-rmdir">${escHtml(t('common.browse') || 'Browse')}</button>
            </div>
            <span class="sched-cmd-hint">${escHtml(t('sched.rm.dirHint') || '')}</span>
            <label class="sched-cmd-label">${escHtml(t('sched.rm.name') || '2. Repo name (optional)')}</label>
            <input class="input sched-p-rmname" spellcheck="false" style="max-width:260px" value="${escAttr(params.name || '')}">
            <label class="sched-cmd-label">${escHtml(t('sched.rm.author') || '3. Author (optional)')}</label>
            <input class="input sched-p-rmauthor" spellcheck="false" style="max-width:260px" value="${escAttr(params.author || '')}">
        </div>`;
    }
    else if (needs === 'repoSshDir') {
        host.innerHTML = `<input class="input sched-r-dir" placeholder="${escAttr(t('sched.sshDirPh') || 'exported repo folder to publish')}" value="${escAttr(params.dir || '')}" style="min-width:260px"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button>`
            + sshTargetField(params);
        void fillSshTargets(host, params);
    }
    // Same shape as repoSshDir, different placeholder: this folder is the DESTINATION, and
    // reusing the "folder to publish" wording here is how somebody points a fetch at the
    // wrong directory and overwrites an export they had not published yet.
    else if (needs === 'repoSshPullDir') {
        host.innerHTML = `<input class="input sched-r-dir" placeholder="${escAttr(t('sched.sshPullDirPh') || 'local folder to fetch INTO')}" value="${escAttr(params.dir || '')}" style="min-width:260px"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button>`
            + sshTargetField(params);
        void fillSshTargets(host, params);
    }
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
    else if (needs === 'exportAuto') host.innerHTML = `<input class="input sched-ea-dir" placeholder="${escAttr(t('sched.backupDirPh') || 'backup folder')}" value="${escAttr(params.dir || '')}" style="min-width:200px"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button><input class="input sched-ea-name" placeholder="bmm-backup-{date}" value="${escAttr(params.name || '')}" style="max-width:180px;margin-left:6px"><select class="input sched-ea-inc" style="max-width:170px;margin-left:6px">${['paren', 'underscore', 'timestamp', 'overwrite'].map(o => `<option value="${o}"${(params.increment || 'paren') === o ? ' selected' : ''}>${escHtml(t('sched.inc_' + o) || o)}</option>`).join('')}</select>`;
    else if (needs === 'bmms') {
        host.innerHTML = `
        <div class="sched-cmd-builder">
            <label class="sched-cmd-label">${t('sched.bmms.codeLbl') || 'BMMScript'}</label>
            <textarea class="input sched-bmms-code sched-code" rows="9" spellcheck="false"
                placeholder="${escAttr(t('sched.bmms.codePh') || 'do mods.scan()\nif online {\n    do notify(message: "hello")\n}')}">${escHtml(params.code || '')}</textarea>
            <!-- Compiled as you stop typing, so a syntax error is found here rather than at
                 whatever hour the task runs. Filled in by the checker below. -->
            <span class="sched-cmd-hint sched-bmms-status"></span>
            <span class="sched-cmd-hint">${t('sched.bmms.hint') || 'The same steps as the bricks, written as text. It runs inside this task — same permissions, same variables.'}</span>
        </div>`;
        const ta = host.querySelector('.sched-bmms-code') as HTMLTextAreaElement | null;
        const status = host.querySelector('.sched-bmms-status') as HTMLElement | null;
        // Debounced: the compiler is a Tauri round trip and running it per keystroke would
        // queue one call per character on a fast typist.
        let timer: any = null;
        const check = async () => {
            if (!status || !ta) return;
            const src = ta.value.trim();
            if (!src) { status.textContent = ''; status.classList.remove('sched-engine-missing'); return; }
            try {
                const r: any = await invoke('bmms_compile_steps', { source: src });
                if (!status.isConnected) return;   // panel changed while we were away
                if (r?.ok) {
                    status.classList.remove('sched-engine-missing');
                    status.textContent = (t('sched.bmms.ok') || '{n} step(s)').replace('{n}', String((r.steps || []).length));
                } else {
                    const e = (r?.errors || [])[0];
                    status.classList.add('sched-engine-missing');
                    status.textContent = e ? `${t('sched.bmms.line') || 'Line'} ${e.line}: ${e.message}` : (t('common.error') || 'Error');
                }
            } catch { /* the checker is a courtesy; its failure must not block editing */ }
        };
        // Same language, smaller window — so the same colours. attachHighlight is
        // idempotent and degrades to a plain textarea when Prism is missing.
        registerBmmsLanguage();
        if (ta) attachHighlight(ta, 'bmms');
        ta?.addEventListener('input', () => {
            params.code = ta.value;
            clearTimeout(timer);
            timer = setTimeout(() => { void check(); }, 300);
        });
        void check();
    }
    else if (needs === 'catCreate') host.innerHTML = `
        <div class="sched-field"><label class="sched-flabel">${t('sched.catKindLbl') || 'What to publish'}</label>
            <select class="input sched-cat-kind" style="min-width:170px">${
                ([['tutorial', t('sched.catKindTut') || 'My tutorials'],
                  ['theme', t('sched.catKindTheme') || 'My themes'],
                  ['plugin', t('sched.catKindPlugin') || 'My plugins'],
                  ['modpack', t('sched.catKindModpack')],
                  ['automation', t('sched.catKindAuto')],
                  // The one the others cannot cover: a `.mm` is exported, not held by BMM,
                  // so a catalogue of mod lists can only be built from a folder.
                  ['folder', t('sched.catKindFolder')]] as [string, string][])
                    .map(([v, l]) => `<option value="${v}"${(params.kind || 'tutorial') === v ? ' selected' : ''}>${escHtml(l)}</option>`).join('')
            }</select></div>
        <div class="sched-field" style="flex:1;min-width:220px"><label class="sched-flabel">${t('sched.catDirLbl') || 'Destination folder'}</label>
            <span style="display:flex;gap:6px"><input class="input sched-ea-dir" placeholder="${escAttr(t('sched.backupDirPh') || 'folder')}" value="${escAttr(params.dir || '')}" style="flex:1"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir">${t('sched.choose') || 'Choose…'}</button></span></div>
        <div class="sched-field"><label class="sched-flabel">${t('sched.catNameLbl') || 'Catalogue name'}</label>
            <input class="input sched-cat-name" placeholder="${escAttr(t('sched.catNamePh') || 'My catalogue')}" value="${escAttr(params.name || '')}" style="min-width:170px"></div>
        <div class="sched-field" style="flex:1;min-width:220px"><label class="sched-flabel">${t('sched.catBaseLbl') || 'Address the files will be served from (optional)'}</label>
            <input class="input sched-cat-base" placeholder="${escAttr(t('sched.catBasePh') || 'leave empty — they sit beside the catalogue')}" value="${escAttr(params.base || '')}"></div>
        <label class="sched-cmd-row" style="margin-top:6px"><input type="checkbox" class="sched-cat-bundle"${params.bundle ? ' checked' : ''}>
            <span>${escHtml(t('sched.catBundle'))}</span></label>
        <span class="sched-cmd-hint">${escHtml(t('sched.catBundleHint'))}</span>
        <span class="sched-cmd-hint">${t('sched.catHint') || 'Writes catalog.json into the folder, plus the files it points at when the kind has any. Themes are embedded in the index and have no separate files.'}</span>`;
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
    host.querySelector('.sched-p-mode')?.addEventListener('change', (e) => { params.mode = (e.target as HTMLSelectElement).value; });
    // Picking a pattern FILLS the field rather than replacing it invisibly: the point is to
    // see what you got, and to edit it afterwards.
    host.querySelector('.sched-p-txlib')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (!v) return;
        params.regex = v;
        const inp = host.querySelector('.sched-p-txregex') as HTMLInputElement | null;
        if (inp) { inp.value = v; inp.focus(); }
    });
    host.querySelector('.sched-p-fwtext')?.addEventListener('input', (e) => { params.text = (e.target as HTMLTextAreaElement).value; });
    host.querySelector('.sched-p-vtext')?.addEventListener('input', (e) => { params.text = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-timeout')?.addEventListener('input', (e) => {
        const v = parseInt((e.target as HTMLInputElement).value, 10);
        // Cleared means "the default", not zero. Storing 0 would be a limit of one second
        // after the clamp, which is not what an empty field means to anybody.
        if (Number.isFinite(v) && v > 0) params.timeoutSecs = v; else delete params.timeoutSecs;
    });
    host.querySelector('.sched-p-vexpect')?.addEventListener('change', (e) => { params.expect = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-p-fwappend')?.addEventListener('change', (e) => { params.append = (e.target as HTMLInputElement).checked; });
    // Where a bare filename actually lands. The rule is one sentence and it is still a rule
    // somebody has to take on trust until they can see the folder — and after the first write
    // "where did it go" is the only question.
    host.querySelector('.sched-fw-open')?.addEventListener('click', async () => {
        try {
            const dir = await invoke('task_output_dir', {
                taskId: _draft.id || 'draft', outputDir: _draft.outputDir || null,
            }) as string;
            await invoke('open_folder', { path: dir });
        } catch (e) { toast(String(e), 'error', 8000); }
    });
    host.querySelector('.sched-p-order')?.addEventListener('input', (e) => { params.order = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-prog')?.addEventListener('input', (e) => { params.program = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-args')?.addEventListener('input', (e) => { params.args = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-wd')?.addEventListener('input', (e) => { params.workingDir = (e.target as HTMLInputElement).value; });
    const rsBind = (sel: string, key: string, prop: 'value' | 'checked' = 'value') => {
        host.querySelector(sel)?.addEventListener(prop === 'checked' ? 'change' : 'input', (e) => {
            params[key] = (e.target as any)[prop];
        });
    };
    rsBind('.sched-rs-url', 'url'); rsBind('.sched-rs-rprof', 'repoProfile');
    rsBind('.sched-rs-target', 'targetProfile'); rsBind('.sched-rs-game', 'gameDir');
    rsBind('.sched-rs-mods', 'modsDir'); rsBind('.sched-rs-backup', 'backupDir');
    // The password moved into the shared credentials block (credsFields/wireCreds), which
    // binds it. This selector now matches nothing and would be a binding nobody can see.
    rsBind('.sched-rs-overwrite', 'overwriteAll', 'checked');
    rsBind('.sched-rs-delete', 'deleteExtra', 'checked');
    host.querySelectorAll('.sched-rs-browse').forEach((b) => b.addEventListener('click', async () => {
        const which = (b as HTMLElement).dataset.for!;
        // Imported here, like the other browse buttons in this file do — the dialog
        // module is not on the scheduler's own load path.
        const { pickFolder } = await import('../../core/api.js');
        const d = await pickFolder().catch(() => null);
        if (!d) return;
        const map: Record<string, [string, string]> = {
            game: ['.sched-rs-game', 'gameDir'], mods: ['.sched-rs-mods', 'modsDir'], backup: ['.sched-rs-backup', 'backupDir'],
        };
        const [sel, key] = map[which];
        params[key] = d;
        (host.querySelector(sel) as HTMLInputElement).value = d;
    }));
    host.querySelector('.sched-p-bmmdir')?.addEventListener('input', (e) => { params.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-engine')?.addEventListener('change', (e) => {
        params.engine = (e.target as HTMLSelectElement).value;
        void paintEngineStatus(host, params.engine);
    });
    host.querySelector('.sched-p-code')?.addEventListener('input', (e) => { params.code = (e.target as HTMLTextAreaElement).value; });
    host.querySelector('.sched-p-into')?.addEventListener('input', (e) => { params.into = (e.target as HTMLInputElement).value; });
    // Variables and HTTP. Bound here with the rest rather than inside their own branch:
    // every one of these is a querySelector that finds nothing for the other action types,
    // which is how the existing bindings already work.
    host.querySelector('.sched-p-varname')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-varvalue')?.addEventListener('input', (e) => { params.value = (e.target as HTMLTextAreaElement).value; });
    host.querySelector('.sched-p-listsep')?.addEventListener('input', (e) => { params.sep = (e.target as HTMLInputElement).value; });
    // text.extract / modlist.apply / dcs.hook. Same shape as everything else here: a
    // querySelector that finds nothing for the other action types binds nothing.
    host.querySelector('.sched-p-rmdir')?.addEventListener('input', (e) => { params.dir = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-rmname')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-rmauthor')?.addEventListener('input', (e) => { params.author = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-browse-rmdir')?.addEventListener('click', async () => {
        const { pickFolder } = await import('../../core/api.js');
        const d = await pickFolder().catch(() => null);
        if (!d) return;
        params.dir = d;
        (host.querySelector('.sched-p-rmdir') as HTMLInputElement).value = String(d);
    });
    host.querySelector('.sched-cat-bundle')?.addEventListener('change', (e) => { params.bundle = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-p-impath')?.addEventListener('input', (e) => { params.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-imurl')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-browse-impath')?.addEventListener('click', async () => {
        const { pickFile } = await import('../../core/api.js');
        const f = await pickFile({ filters: [
            { name: 'BMM files', extensions: ['mm', 'mmlist', 'bmmplug', 'bmmtheme', 'bmmpa', 'bmmbundle', 'DATABMM', 'json'] },
            { name: 'All files', extensions: ['*'] },
        ] }).catch(() => null);
        if (!f) return;
        params.path = f;
        (host.querySelector('.sched-p-impath') as HTMLInputElement).value = String(f);
    });
    host.querySelector('.sched-p-kcname')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-kckind')?.addEventListener('change', (e) => { params.kind = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-p-kcbind')?.addEventListener('input', (e) => { params.bindUrl = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-cftype')?.addEventListener('change', (e) => { params.catType = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-p-cfurl')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-cfoff')?.addEventListener('change', (e) => { params.unfollow = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-p-bkdir')?.addEventListener('input', (e) => { params.dir = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-bkname')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-bkinc')?.addEventListener('change', (e) => { params.increment = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-p-bkpass')?.addEventListener('input', (e) => { params.passphrase = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-browse-bkdir')?.addEventListener('click', async () => {
        const { pickFolder } = await import('../../core/api.js');
        const d = await pickFolder().catch(() => null);
        if (!d) return;
        params.dir = d;
        (host.querySelector('.sched-p-bkdir') as HTMLInputElement).value = String(d);
    });
    host.querySelector('.sched-p-txpath')?.addEventListener('input', (e) => { params.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-txsource')?.addEventListener('input', (e) => { params.source = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-txregex')?.addEventListener('input', (e) => { params.regex = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-txtarget')?.addEventListener('input', (e) => { params.target = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-txgroup')?.addEventListener('input', (e) => { params.group = parseInt((e.target as HTMLInputElement).value) || 0; });
    host.querySelector('.sched-p-txtail')?.addEventListener('input', (e) => { params.tailKb = parseInt((e.target as HTMLInputElement).value) || 64; });
    host.querySelector('.sched-p-lapath')?.addEventListener('input', (e) => { params.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-laurl')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-lainstall')?.addEventListener('change', (e) => { params.install = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-p-laexact')?.addEventListener('change', (e) => { params.exact = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-p-lapass')?.addEventListener('input', (e) => { params.passphrase = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-wurl')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-wname')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-wstatus')?.addEventListener('input', (e) => { params.status = parseInt((e.target as HTMLInputElement).value, 10) || 0; });
    host.querySelector('.sched-p-wevery')?.addEventListener('input', (e) => { params.everySeconds = parseInt((e.target as HTMLInputElement).value, 10) || 1; });
    host.querySelector('.sched-p-wtimeout')?.addEventListener('input', (e) => { params.timeoutSeconds = parseInt((e.target as HTMLInputElement).value, 10) || 1; });
    host.querySelector('.sched-p-wstop')?.addEventListener('change', (e) => { params.stopOnTimeout = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-p-keepgoing')?.addEventListener('change', (e) => { params.keepGoing = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-p-gwpath')?.addEventListener('input', (e) => { params.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-gwmode')?.addEventListener('change', (e) => { params.mode = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-p-dcsmode')?.addEventListener('change', (e) => { params.mode = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-p-dcsdir')?.addEventListener('input', (e) => { params.dir = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-browse-txpath')?.addEventListener('click', async () => {
        const { pickFile } = await import('../../core/api.js');
        const f = await pickFile({ filters: [{ name: 'All files', extensions: ['*'] }] }).catch(() => null);
        if (f) { params.path = f; (host.querySelector('.sched-p-txpath') as HTMLInputElement).value = String(f); }
    });
    host.querySelector('.sched-browse-lapath')?.addEventListener('click', async () => {
        const { pickFile } = await import('../../core/api.js');
        const f = await pickFile({ filters: [{ name: 'BMM mod list', extensions: ['mm', 'mmlist', 'json'] }] }).catch(() => null);
        if (f) { params.path = f; (host.querySelector('.sched-p-lapath') as HTMLInputElement).value = String(f); }
    });
    host.querySelector('.sched-p-mapkey')?.addEventListener('input', (e) => { params.key = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-mapinto')?.addEventListener('input', (e) => { params.into = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-idkind')?.addEventListener('change', (e) => { params.kind = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-p-idid')?.addEventListener('input', (e) => { params.id = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-idinto')?.addEventListener('input', (e) => { params.into = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-varscope')?.addEventListener('change', (e) => { params.scope = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-p-method')?.addEventListener('change', (e) => { params.method = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-p-url')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-headers')?.addEventListener('input', (e) => { params.headers = (e.target as HTMLTextAreaElement).value; });
    host.querySelector('.sched-p-httpbody')?.addEventListener('input', (e) => { params.body = (e.target as HTMLTextAreaElement).value; });
    host.querySelector('.sched-p-jsonpath')?.addEventListener('input', (e) => { params.jsonPath = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-timeout')?.addEventListener('input', (e) => { params.timeoutMs = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-anystatus')?.addEventListener('change', (e) => { params.allowAnyStatus = (e.target as HTMLInputElement).checked; });
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
    host.querySelector('.sched-cat-kind')?.addEventListener('change', (e) => { params.kind = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-cat-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-cat-base')?.addEventListener('input', (e) => { params.base = (e.target as HTMLInputElement).value; });
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
    addBmmPathButtons(host, params);
}

function diskOptions(selected: string): string {
    return `<option value="">— ${t('sched.pick') || 'select'} —</option>` +
        _disks.map((d: any) => `<option value="${escAttr(d.mount_point)}"${d.mount_point === selected ? ' selected' : ''}>${escHtml(d.mount_point)}${d.name ? ' · ' + escHtml(d.name) : ''}</option>`).join('');
}

/** What `for each` can walk. One list: the editor's dropdown and the code box's suggestions. */
const LOOP_SOURCES = ['enabledMods', 'disabledMods', 'mods', 'profiles', 'modpacks', 'themes', 'list', 'mapKeys'] as const;
const COND_TYPES = ['always', 'all', 'any', 'value', 'textIs', 'fileContains', 'enumIs', 'profileActive', 'modEnabled', 'modDisabled', 'modWins', 'fileIsValid', 'modpackActive', 'modpackInactive', 'allModsActive', 'appRunning', 'appNotRunning', 'fileExists', 'pathIsDir', 'fileHash', 'filesMatch', 'fileSize', 'fileType', 'fileName', 'fileNewer', 'online', 'catalogOk', 'repoOk', 'timeReached', 'dayOfWeek', 'timeRange', 'commandSucceeds'];
// Values a preceding action can capture (used by the `value` condition).
// Every variable an action writes into `ctx`, so a `value` condition can read all of
// them. Four were missing — check_disk_space has always written disk.free_gb,
// disk.free_percent and disk.total_gb, and app.checkUpdate writes update.available, but
// none appeared in this dropdown, and the dropdown is the only way to name a source. The
// actions were writing to variables no condition could reach: "if an update is available,
// notify me" was simply not expressible.
//
// Keep this in step with the context writes in runAction. A source listed here with
// nothing writing it reads as always-zero; a write missing from here is unreachable.

/**
 * Patterns worth not writing again.
 *
 * Every one of these is something people were writing by hand into `text.extract`, getting
 * subtly wrong, and only finding out when a task read the wrong half of a line at 3am. A
 * shelf of them is not a feature so much as a refusal to make everybody rediscover
 * `\d+\.\d+\.\d+`.
 *
 * They all carry ONE capture group, because that is what `text.extract` keeps: a pattern with
 * none matches and stores nothing, which reads exactly like a pattern that did not match.
 */
const REGEX_LIBRARY: { label: string; re: string }[] = [
    { label: 'sched.rx.version', re: '\b(v?\d+\.\d+(?:\.\d+)?)\b' },
    { label: 'sched.rx.number', re: '(-?\d+(?:\.\d+)?)' },
    { label: 'sched.rx.url', re: '(https?://[^\s"<>)]+)' },
    { label: 'sched.rx.ipv4', re: '\b((?:\d{1,3}\.){3}\d{1,3})\b' },
    { label: 'sched.rx.hostPort', re: '([A-Za-z0-9.-]+:\d{2,5})' },
    { label: 'sched.rx.email', re: '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})' },
    { label: 'sched.rx.sha256', re: '\b([a-fA-F0-9]{64})\b' },
    { label: 'sched.rx.guid', re: '([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})' },
    { label: 'sched.rx.isoDate', re: '(\d{4}-\d{2}-\d{2})' },
    { label: 'sched.rx.time', re: '(\d{1,2}:\d{2}(?::\d{2})?)' },
    { label: 'sched.rx.winPath', re: '([A-Za-z]:\\\\[^"<>|?*\r\n]+)' },
    { label: 'sched.rx.quoted', re: '"([^"]*)"' },
    { label: 'sched.rx.afterEquals', re: '=\s*(.+?)\s*$' },
    { label: 'sched.rx.jsonString', re: '"name"\s*:\s*"([^"]*)"' },
    { label: 'sched.rx.lastLine', re: '(.+)$' },
    // The two people ask for by name. A DCS server line and a "player joined" line are the
    // reason this list exists at all.
    { label: 'sched.rx.joined', re: '(?:joined|connected)\s*:?\s*(.+?)\s*$' },
    { label: 'sched.rx.error', re: '(?:ERROR|FATAL)\s*:?\s*(.+?)\s*$' },
];

const VALUE_SOURCES = [
    'disk.read_mbps', 'disk.write_mbps', 'disk.suggested_limit',
    'disk.free_gb', 'disk.free_percent', 'disk.total_gb',
    'benchmark.mbps', 'benchmark.total_ms',
    'update.available', 'lasttask.ok', 'lasttask.spawned', 'list.length',
    // How big the backup came out. A task can then warn when a nightly bundle suddenly
    // triples — which is what a replays section left ticked by accident looks like.
    'backup.bytes',
    // How many files changed hands when the deployment order last moved. Zero is the
    // ordinary answer and a useful one: it means the order changed and nothing on disk
    // did, so the mods that moved share no file.
    'order.moved',
    // How many attempts the last retry took. 1 means it worked first time, which is
    // worth being able to branch on: a step that needed three tries is working and worth
    // knowing about.
    'retry.attempts',
    // What the last check found. `valid.ok` and `valid.matched` are 1/0 so a plain `value`
    // condition can read them; the format itself is text, as {valid.format}.
    'valid.ok',
    'valid.matched',
    'valid.count',
    // Written by the two waits and by a script run with "keep going": what happened,
    // as something a condition can select. Without these a task could wait and could not
    // branch on the outcome of waiting, which is most of the reason to wait.
    'wait.ok', 'wait.tries', 'script.code', 'script.ok',
    // How much an import brought in — mods in a list, tasks in a .bmmpa, sections in a
    // backup. The number is what a task branches on: "if the nightly backup came out
    // with fewer sections than usual, say so".
    'import.count',
    // How many entries a publish wrote. Zero is the interesting number: a catalogue with
    // no entries looks published and installs nothing.
    'catalog.entries',
    // How many files a publish or fetch moved. Zero from a publish means the folder was
    // empty, which is what a failed export upstream looks like from here.
    'ssh.files',
    // What a manifest rebuild found. `removed` is the one worth a condition: a mistyped
    // path and a deliberate removal both write a valid manifest, and only one of them
    // describes an empty server.
    'manifest.mods', 'manifest.added', 'manifest.removed', 'manifest.changed',
    // Written by http.request on every call, including a failed one. Listed here because
    // check-scheduler-vars caught that it was not: a value an action writes and no
    // condition can select is half a feature, and the half that is missing is the point —
    // "call the API, and if it answered 404 do something else".
    'http.status',
    // The last map touched: how many keys it holds, and whether the last `map.get` found its
    // key. `map.hit` is the one that matters — without it, a missing key and a key whose value
    // is genuinely empty are the same empty string, and a task cannot tell "not there" from
    // "there and blank".
    'map.size', 'map.hit',
];
function conditionEditor(cond: Condition): HTMLElement {
    const el = document.createElement('div');
    const render = () => {
        el.innerHTML = `
            <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);margin-right:6px">
                <input type="checkbox" class="sched-neg" ${cond.negate ? 'checked' : ''}> ${t('sched.not') || 'NOT'}</label>
            <select class="input sched-cond-type" style="max-width:170px">
                ${COND_TYPES.map(c => `<option value="${c}" ${cond.type === c ? 'selected' : ''}>${escHtml(t('sched.cond.' + c) || c)}</option>`).join('')}
            </select>
            <span class="sched-cond-params"></span>
            <button type="button" class="btn btn-xs btn-ghost sched-cond-try"
                data-tooltip="${escAttr(t('sched.cond.tryHint'))}">${escHtml(t('sched.cond.try'))}</button>
            <span class="sched-cond-result"></span>`;
        el.querySelector('.sched-neg')?.addEventListener('change', (e) => { cond.negate = (e.target as HTMLInputElement).checked; });
        el.querySelector('.sched-cond-type')?.addEventListener('change', (e) => { _snapshot(); cond.type = (e.target as HTMLSelectElement).value; cond.params = {}; render(); });
        renderCondParams(el.querySelector('.sched-cond-params') as HTMLElement, cond);

        // Ask it now.
        //
        // "Does fileExists see what I think it sees" needed a whole task built around it
        // before: add a step, add a notify, save, run, read the toast, delete it again. The
        // answer takes one call and it was never offered.
        const out = el.querySelector('.sched-cond-result') as HTMLElement | null;
        el.querySelector('.sched-cond-try')?.addEventListener('click', async () => {
            if (!out) return;
            out.className = 'sched-cond-result is-busy';
            out.textContent = t('sched.cond.trying');
            try {
                // The task's SHARED variables, and nothing else. A condition that reads {path}
                // captured by an earlier step cannot be answered here, and the hint says so —
                // pretending otherwise would report false for a condition that is fine.
                const ok = await evalCondition(cond, { nums: {}, text: {}, shared: readSharedVars() }, _draft as Task);
                out.className = `sched-cond-result ${ok ? 'is-true' : 'is-false'}`;
                out.textContent = ok ? t('sched.cond.isTrue') : t('sched.cond.isFalse');
            } catch (e) {
                // A condition that THREW is a third answer, and the most useful one: a
                // permission it does not have, a path it cannot read.
                out.className = 'sched-cond-result is-err';
                out.textContent = String(e).slice(0, 120);
            }
        });
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
    // A GROUP renders the conditions inside it, each with its own full editor — so a group
    // can hold a group, and "A and (B or not C)" is built by clicking rather than by nesting
    // three ifs and repeating their else branches.
    if (cond.type === 'all' || cond.type === 'any') {
        if (!Array.isArray(p.of)) p.of = [];
        const draw = () => {
            host.innerHTML = `
                <div class="sched-cond-group">
                    <div class="sched-cond-group-head">${escHtml(cond.type === 'all'
                        ? (t('sched.cond.allHint') || 'Every one of these must hold')
                        : (t('sched.cond.anyHint') || 'At least one of these must hold'))}</div>
                    <div class="sched-cond-list"></div>
                    <button type="button" class="btn btn-xs btn-ghost sched-cond-add">+ ${escHtml(t('sched.cond.add') || 'condition')}</button>
                </div>`;
            const list = host.querySelector('.sched-cond-list') as HTMLElement;
            (p.of as Condition[]).forEach((sub, i) => {
                const row = document.createElement('div');
                row.className = 'sched-cond-row';
                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'btn btn-xs btn-ghost sched-cond-del';
                del.textContent = '✕';
                del.title = t('common.delete') || 'Remove';
                del.addEventListener('click', () => { _snapshot(); (p.of as Condition[]).splice(i, 1); draw(); });
                row.appendChild(conditionEditor(sub));
                row.appendChild(del);
                list.appendChild(row);
            });
            host.querySelector('.sched-cond-add')?.addEventListener('click', () => {
                _snapshot();
                (p.of as Condition[]).push({ type: 'always', params: {} });
                draw();
            });
        };
        draw();
        return;
    }
    if (cond.type === 'profileActive') host.innerHTML = `<select class="input sched-cp" style="max-width:180px">${pickerOptions(_profiles, p.id)}</select>`;
    else if (cond.type === 'fileIsValid') {
        host.innerHTML = `<span style="display:flex;gap:6px;align-items:center;flex:1">
            <input class="input sched-cp" spellcheck="false" style="flex:1" placeholder="${escAttr(t('sched.valid.filePh'))}" value="${escAttr(p.path || '')}">
            <input class="input sched-cp2" spellcheck="false" style="max-width:130px" placeholder="${escAttr(t('sched.valid.expectPh'))}" value="${escAttr(p.expect || '')}">
        </span>`;
        host.querySelector('.sched-cp')?.addEventListener('input', (e) => { p.path = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-cp2')?.addEventListener('input', (e) => { p.expect = (e.target as HTMLInputElement).value; });
        return;
    }
    else if (cond.type === 'modEnabled' || cond.type === 'modDisabled' || cond.type === 'modWins') host.innerHTML = `<select class="input sched-cp" style="max-width:200px">${pickerOptions(_mods, p.id)}</select>`;
    else if (cond.type === 'modpackActive' || cond.type === 'modpackInactive') host.innerHTML = `<select class="input sched-cp" style="max-width:200px">${pickerOptions(_modpacks, p.id)}</select>`;
    else if (cond.type === 'appRunning' || cond.type === 'appNotRunning') {
        // A pid is exact but does not survive a reboot; a name survives but can match
        // several processes or none. Both are offered, and the backend prefers the pid when
        // one is given. The datalist is what makes the name usable at all — see
        // fillProcessDatalist.
        host.innerHTML = `<input class="input sched-cp-name" list="sched-proc-list" placeholder="${escAttr(t('sched.appName') || 'app exe (e.g. DCS.exe)')}" value="${escAttr(p.name || '')}" style="max-width:200px">
            <datalist id="sched-proc-list"></datalist>
            <input class="input sched-cp-pid" type="number" min="1" placeholder="${escAttr(t('sched.pidPh') || 'or pid')}" value="${escAttr(p.pid ?? '')}" style="max-width:110px">
            <span class="sched-cmd-hint">${t('sched.pidHint') || 'A pid is exact but changes every restart — prefer the name for a task that runs for months.'}</span>`;
        host.querySelector('.sched-cp-pid')?.addEventListener('input', (e) => {
            const v = parseInt((e.target as HTMLInputElement).value, 10);
            p.pid = Number.isFinite(v) && v > 0 ? v : undefined;
        });
        void fillProcessDatalist(host, 'sched-proc-list');
    }
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
    } else if (cond.type === 'enumIs') {
        const enums = readEnums();
        const names = Object.keys(enums).sort();
        if (!names.length) {
            host.innerHTML = `<span style="font-size:11px;color:var(--text-muted)">${t('sched.cond.noEnums') || 'No enum declared yet — add one in the sidebar.'}</span>`;
        } else {
            const chosen = names.includes(String(p.enum)) ? String(p.enum) : names[0];
            p.enum = chosen;
            const members = enums[chosen] || [];
            if (!members.includes(String(p.member))) p.member = members[0] || '';
            host.innerHTML = `
                <input class="input sched-cp-name" spellcheck="false" placeholder="${escAttr(t('sched.cond.varPh') || 'variable')}" value="${escAttr(p.name || '')}" style="max-width:150px">
                <select class="input sched-cp-enum" style="max-width:140px">${names.map(n => `<option value="${escAttr(n)}"${chosen === n ? ' selected' : ''}>${escHtml(n)}</option>`).join('')}</select>
                <select class="input sched-cp-member" style="max-width:150px">${members.map(m => `<option value="${escAttr(m)}"${p.member === m ? ' selected' : ''}>${escHtml(m)}</option>`).join('')}</select>`;
            host.querySelector('.sched-cp-name')?.addEventListener('input', (e) => { p.name = (e.target as HTMLInputElement).value; });
            // Changing the enum redraws, because the member list belongs to it — leaving a
            // member from the previous enum selected is a condition that can never be true.
            host.querySelector('.sched-cp-enum')?.addEventListener('change', (e) => {
                p.enum = (e.target as HTMLSelectElement).value;
                p.member = (readEnums()[p.enum] || [])[0] || '';
                renderCondParams(host, cond);
            });
            host.querySelector('.sched-cp-member')?.addEventListener('change', (e) => { p.member = (e.target as HTMLSelectElement).value; });
        }
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
    } else if (cond.type === 'textIs') {
        // A free-typed variable name, not a dropdown of VALUE_SOURCES: the whole point of
        // this condition is branching on something text.extract just invented a name for,
        // and a fixed list cannot contain a name that does not exist yet.
        host.innerHTML = `
            <input class="input sched-cp-src" spellcheck="false" style="max-width:170px"
                placeholder="${escAttr(t('sched.phVarName') || 'variable')}" value="${escAttr(p.source || '')}">
            <select class="input sched-cp-op" style="max-width:130px">
                ${['is', 'isNot', 'contains', 'matches', 'empty', 'notEmpty']
                    .map(o => `<option value="${o}"${(p.op || 'is') === o ? ' selected' : ''}>${escHtml(t('sched.txtOp.' + o) || o)}</option>`).join('')}
            </select>
            <input class="input sched-cp-val" spellcheck="false" style="min-width:170px"
                placeholder="${escAttr(t('sched.phValue') || 'value')}" value="${escAttr(p.value ?? '')}">`;
        host.querySelector('.sched-cp-src')?.addEventListener('input', (e) => { p.source = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-cp-op')?.addEventListener('change', (e) => { p.op = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.value = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileContains') {
        host.innerHTML = `${condFileInput(p)}
            <input class="input sched-cp-val" spellcheck="false" style="min-width:190px"
                placeholder="${escAttr(t('sched.phContains') || 'text to look for')}" value="${escAttr(p.text || '')}">
            <label class="sched-cp-chk"><input type="checkbox" class="sched-cp-re"${p.regex ? ' checked' : ''}>
                <span>${escHtml(t('sched.asRegex') || 'as a pattern')}</span></label>
            <input class="input sched-cp-tail" type="number" min="1" style="max-width:90px"
                title="${escAttr(t('sched.tx.tail') || 'last KB')}" value="${escAttr(String(p.tailKb ?? 64))}">`;
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.text = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-cp-re')?.addEventListener('change', (e) => { p.regex = (e.target as HTMLInputElement).checked; });
        host.querySelector('.sched-cp-tail')?.addEventListener('input', (e) => { p.tailKb = parseInt((e.target as HTMLInputElement).value) || 64; });
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
    } else if (cond.type === 'pathIsDir') {
        // A file and a folder are both "exists", so the thing being chosen is which one you
        // meant — stated as two named outcomes rather than a checkbox nobody can read twice.
        host.innerHTML = `${condFileInput(p)}<select class="input sched-cp-want" style="max-width:150px">
            <option value="dir"${p.want !== 'file' ? ' selected' : ''}>${escAttr(t('sched.cond.isDir') || 'is a folder')}</option>
            <option value="file"${p.want === 'file' ? ' selected' : ''}>${escAttr(t('sched.cond.isFile') || 'is a file')}</option>
        </select>`;
        host.querySelector('.sched-cp-want')?.addEventListener('change', (e) => { p.want = (e.target as HTMLSelectElement).value; });
    } else if (cond.type === 'filesMatch') {
        host.innerHTML = `<span style="font-size:11px;color:var(--text-secondary)">${t('sched.cond.filesIn') || 'every file listed in'}</span>
            <input class="input sched-cp-list" placeholder="${escAttr(t('sched.listName') || 'list name')}" value="${escAttr(p.list || '')}" style="max-width:150px">
            <span style="font-size:11px;color:var(--text-secondary)">${t('sched.cond.hashesTo') || 'still hashes to what'}</span>
            <input class="input sched-cp-map" placeholder="${escAttr(t('sched.mapName') || 'map name')}" value="${escAttr(p.map || '')}" style="max-width:150px">
            <span style="font-size:11px;color:var(--text-secondary)">${t('sched.cond.says') || 'says'}</span>
            <select class="input sched-cp-algo" style="max-width:120px">
                <option value="blake3"${p.algo !== 'sha256' ? ' selected' : ''}>blake3</option>
                <option value="sha256"${p.algo === 'sha256' ? ' selected' : ''}>sha256</option>
            </select>`;
        host.querySelector('.sched-cp-list')?.addEventListener('input', (e) => { p.list = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-cp-map')?.addEventListener('input', (e) => { p.map = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-cp-algo')?.addEventListener('change', (e) => { p.algo = (e.target as HTMLSelectElement).value; });
    } else if (cond.type === 'catalogOk' || cond.type === 'repoOk') {
        host.innerHTML = `<input class="input sched-cp-url" placeholder="https://…" value="${escAttr(p.url || '')}" style="min-width:240px">
            ${cond.type === 'catalogOk' ? `<select class="input sched-cp-kind" style="max-width:150px">
                ${['any', 'app', 'plugin', 'theme', 'preset', 'repo', 'index'].map((k) =>
                    `<option value="${k}"${(p.kind || 'any') === k ? ' selected' : ''}>${escAttr(t('sched.cond.kind.' + k) || k)}</option>`).join('')}
            </select>` : ''}
            <label style="font-size:11px;color:var(--text-secondary);display:inline-flex;align-items:center;gap:4px">
                <input type="checkbox" class="sched-cp-shapeless"${p.shapeless ? ' checked' : ''}>
                ${escAttr(t('sched.cond.answeredOnly') || 'answered is enough')}
            </label>
            <span style="font-size:11px;color:var(--warning)">${escAttr(t('sched.cond.needsNet') || 'needs the “run a program” permission')}</span>`;
        host.querySelector('.sched-cp-url')?.addEventListener('input', (e) => { p.url = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-cp-kind')?.addEventListener('change', (e) => { p.kind = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-shapeless')?.addEventListener('change', (e) => { p.shapeless = (e.target as HTMLInputElement).checked; });
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

/**
 * Which actions name something else by id, and what kind of thing.
 *
 * Data rather than a name pattern: `task.run` and `launchpack.run` share a suffix and
 * nothing else, and a future `foo.run` should not be treated as a reference by accident.
 * Every one of these keeps its target in `params.id`.
 */
const REF_ACTIONS: Record<string, 'task' | 'launchpack' | 'modpack' | 'profile' | 'plugin'> = {
    'task.run': 'task',
    'launchpack.run': 'launchpack',
    'modpack.enable': 'modpack',
    'modpack.disable': 'modpack',
    'profile.activate': 'profile',
    // A plugin is the same kind of dependency as a launch pack: small self-describing JSON
    // that means nothing by id alone on another machine. `plugin.delete` is deliberately
    // NOT here — exporting the definition of something the task removes would ship the very
    // thing it exists to get rid of.
    'plugin.apply': 'plugin',
    'plugin.compare': 'plugin',
};

/** Every id a task names, by kind. Walks the whole tree — a sub-task called from inside a
 *  loop inside an if is still a dependency, and a collector that reads only the top level
 *  produces a file that is missing exactly the parts that were hardest to find. */
/**
 * The fields a step can hold other steps in.
 *
 * ONE list, because three walkers had their own copy and none of them learned about
 * `branches` when the parallel kind arrived — so a reference inside a parallel branch was
 * invisible to the exporter, the id remapper and the substituter at once. `cases` is not
 * here: it holds objects with their own `steps`, so every caller handles it separately.
 */
const STEP_BODIES = ['steps', 'then', 'else', 'onError', 'default'] as const;

/** Every array of steps hanging off this step, `branches` included. */
function stepBodies(st: any): Step[][] {
    const out: Step[][] = [];
    for (const k of STEP_BODIES) if (Array.isArray(st?.[k])) out.push(st[k]);
    if (Array.isArray(st?.branches)) for (const b of st.branches) if (Array.isArray(b)) out.push(b);
    if (Array.isArray(st?.cases)) for (const c of st.cases) if (Array.isArray(c?.steps)) out.push(c.steps);
    return out;
}

/**
 * Everything that calls this block, by name.
 *
 * Blocks are stored in ONE place for the whole app, not per task — which is what makes them
 * shareable and also what makes them dangerous: the panel is showing you every task's blocks,
 * and the name you are about to save over may belong to something you have never opened.
 *
 * Blocks calling blocks are included. A helper called only by another helper is exactly the one
 * nobody remembers, and it breaks the same way.
 */
function blockCallers(name: string, draft?: Task | null): string[] {
    if (!name) return [];
    const calls = (steps: Step[]): boolean => (steps || []).some(function seek(st: any): boolean {
        if (st?.kind === 'call' && st.block === name) return true;
        return stepBodies(st).some((body) => body.some(seek));
    });
    const out: string[] = [];
    // The draft first: it is the one open on screen, and it is not in `_tasks` until saved.
    if (draft && calls(draft.steps || [])) {
        out.push(draft.name || t('sched.untitled') || 'Untitled');
    }
    for (const task of _tasks) {
        if (draft && task.id === draft.id) continue;
        if (calls(task.steps || [])) out.push(task.name || task.id);
    }
    const blocks = readBlocks();
    for (const [other, steps] of Object.entries(blocks)) {
        if (other !== name && calls(steps)) out.push(`${t('sched.bl.blockWord')} ${other}`);
    }
    return out;
}

function collectRefs(steps: Step[], out: Record<string, Set<string>> = {}): Record<string, Set<string>> {
    for (const st of steps || []) {
        if ((st as any).kind === 'action') {
            const kind = REF_ACTIONS[String((st as any).action?.type || '')];
            const id = String((st as any).action?.params?.id || '').trim();
            if (kind && id) (out[kind] = out[kind] || new Set()).add(id);
        }
        // A `call` names a BLOCK, and a block is a kind of its own rather than an action —
        // so REF_ACTIONS could never have found it, however many actions were added.
        if ((st as any).kind === 'call') {
            const name = String((st as any).block || '').trim();
            if (name) (out.block = out.block || new Set()).add(name);
        }
        for (const body of stepBodies(st)) collectRefs(body, out);
    }
    return out;
}

/**
 * A task plus everything it calls, transitively.
 *
 * Sharing a task that runs two other tasks used to share one third of an automation: the
 * file imported, the step was there, and it failed at run time on an id that means nothing
 * on the other machine. Following the references is the difference between sending an
 * automation and sending a reference to one.
 *
 * The `seen` set is not an optimisation — two tasks that call each other are a legitimate
 * thing to build (a retry loop, an error handler that re-runs the main job), and without it
 * this recurses until the stack ends.
 */
function withSubTasks(root: Task, all: Task[]): { tasks: Task[]; missing: string[] } {
    const byId = new Map(all.map((x) => [x.id, x]));
    const out: Task[] = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    const walk = (task: Task) => {
        if (seen.has(task.id)) return;
        seen.add(task.id);
        out.push(task);
        for (const id of collectRefs(task.steps).task || []) {
            const sub = byId.get(id);
            // A reference to a task that does not exist HERE is recorded, not skipped. It
            // is usually a task deleted since, and the person exporting is the only one who
            // can still say what it was.
            if (sub) walk(sub); else if (!missing.includes(id)) missing.push(id);
        }
    };
    walk(root);
    return { tasks: out, missing };
}

/**
 * The launch packs and modpacks a set of tasks names, as definitions.
 *
 * Included because they are small, self-describing JSON that means nothing by id alone on
 * another machine. Apps and mods are NOT: those are files, often gigabytes, frequently
 * licensed, and a .bmmpa is a text document somebody reads before trusting.
 *
 * Failure is per-kind and silent-ish: a backend that cannot list launch packs should not
 * stop somebody exporting a task, so the export continues without them and the inspector
 * shows the reference as unresolved — which is the truth.
 */
async function collectIncludes(tasks: Task[]): Promise<Record<string, any[]>> {
    const refs: Record<string, Set<string>> = {};
    for (const t of tasks) collectRefs(t.steps, refs);
    const includes: Record<string, any[]> = {};

    if (refs.launchpack?.size) {
        try {
            const packs = await invoke('get_launch_packs') as any[];
            const want = refs.launchpack;
            includes.launchpacks = (packs || []).filter((p: any) => want.has(String(p?.id)));
        } catch { /* see above */ }
    }
    if (refs.modpack?.size) {
        try {
            const packs = await invoke('load_modpacks') as any[];
            const want = refs.modpack;
            includes.modpacks = (packs || []).filter((p: any) => want.has(String(p?.id ?? p?.name)));
        } catch { /* see above */ }
    }
    if (refs.block?.size) {
        // The bodies, from the local store. Blocks are plain step arrays with no identity of
        // their own, so there is nothing to fetch and nothing that can fail — a named block
        // that does not exist here simply is not carried, and the inspector reports the
        // reference as unresolved, which is the truth.
        const store = readBlocks();
        const want = refs.block;
        const picked: Record<string, Step[]> = {};
        for (const name of want) if (store[name]) picked[name] = store[name];
        if (Object.keys(picked).length) includes.blocks = [picked];
    }
    if (refs.plugin?.size) {
        try {
            const installed = await invoke('get_installed_plugins') as any[];
            const want = refs.plugin;
            // The MANIFEST, which is the whole definition: id, version, permissions, and the
            // modlist that says what applying it actually does. Not the plugin's script files
            // — those live in its folder, and a .bmmpa is a text document somebody reads
            // before trusting it. `has_scripts` still travels, so the inspector can say the
            // original had them and this copy does not.
            includes.plugins = (installed || [])
                .filter((ip: any) => want.has(String(ip?.manifest?.id)))
                .map((ip: any) => ip.manifest);
        } catch { /* see above */ }
    }
    return includes;
}

/**
 * Write a .bmmpa holding `tasks`.
 *
 * One task or forty go through the same envelope — `tasks` stays an array of one rather
 * than gaining a singular `task` field. A second shape would mean a second branch in every
 * reader: BMM's importer, BMM's inspector, and BCWEB's moderation inspector. Three places
 * to keep in agreement, so that a file can say the same thing two ways.
 *
 * `suggested` only seeds the save dialog; the person picks the real path.
 */
/**
 * One task, stripped of what belongs to THIS machine.
 *
 * The export already dropped `perms`, `enabled` and `osSchedule` — three decisions the person
 * importing has to make for themselves. It kept the run history, which is a different kind of
 * mistake: it is not a decision, it is a record of what happened here.
 *
 * `history` entries carry an error string, and an error string routinely carries a local path:
 * `error: Could not write C:\Users\<name>\…`. Sharing an automation was therefore sharing
 * a list of when the author was at their computer and where their files live. Nothing warned,
 * because nothing was wrong with the automation.
 *
 * `lastRun` and `lastResult` go for the same reason and one more: an imported task showing
 * "last ran 3 hours ago, OK" is describing a run that happened on somebody else's machine.
 */
function forExport(task: Task): Task {
    const { history, lastRun, lastResult, ...rest } = task as any;
    void history; void lastRun; void lastResult;
    return { ...rest, perms: {}, enabled: false, osSchedule: false } as Task;
}

async function writeBmmpa(tasks: Task[], suggested: string): Promise<void> {
    if (!tasks.length) { toast(t('sched.noTasks') || 'No tasks to export', 'info'); return; }
    const { saveFile } = await import('../../core/api.js');
    const path = await saveFile({ defaultPath: suggested, filters: [{ name: 'BMM Automation', extensions: ['bmmpa'] }] }).catch(() => null);
    if (!path) return;
    const includes = await collectIncludes(tasks);
    const payload = JSON.stringify({
        magic: BMMPA_MAGIC, version: 1, exported: new Date().toISOString(),
        tasks: tasks.map(forExport),
        // Only when there is something. An empty `includes: {}` in every file
        // invites a reader to render an empty section on every import.
        ...(Object.keys(includes).length ? { includes } : {}),
    }, null, 2);
    try {
        // Signed on the way to disk. A .bmmpa can carry scripts, so "is this still what the
        // author wrote" is the question a person most needs answered before importing one —
        // and the private key lives on the Rust side, where it belongs.
        const signed = await invoke('write_signed_document', { path, json: payload, format: 'bmmpa' });
        toast((t('sched.exportedN') || 'Exported {n} automation(s)').replace('{n}', String(tasks.length))
            + (signed ? '' : ` — ${t('sched.exportUnsigned') || 'written unsigned'}`), 'success');
    } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
}

export async function exportTasksFile(): Promise<void> {
    await writeBmmpa(_tasks, 'automations.bmmpa');
}

/**
 * Export one task. Sharing a single automation used to mean exporting everything and
 * hand-editing the JSON to delete the rest — which is how a private path or an API token
 * sitting in another task ends up in a file somebody meant to share.
 */
export async function exportOneTask(id: string): Promise<void> {
    const task = _tasks.find((x) => x.id === id);
    if (!task) { toast(t('sched.noTasks') || 'No tasks to export', 'info'); return; }
    const safe = safeFileStem(task.name);
    // Everything it calls, transitively. Sharing a task that runs two other tasks used
    // to share one third of an automation: it imported, the step was there, and it failed
    // at run time on an id that means nothing on the other machine.
    const { tasks, missing } = withSubTasks(task, _tasks);
    if (missing.length) {
        // Said out loud rather than exported quietly. A reference to a task deleted since
        // is something only the person exporting can still explain.
        toast((t('sched.exp.missing') || '{n} referenced task(s) no longer exist and cannot be included.')
            .replace('{n}', String(missing.length)), 'warning');
    }
    if (tasks.length > 1) {
        toast((t('sched.exp.withSubs') || 'Including {n} task(s) this one calls.')
            .replace('{n}', String(tasks.length - 1)), 'info');
    }
    await writeBmmpa(tasks, `${safe}.bmmpa`);
}

/**
 * Show what a shared automation contains, WITHOUT importing it.
 *
 * The file is read and parsed; nothing is registered, nothing runs, and no task list is
 * touched. That separation is the whole point — importing is the commitment, and until now
 * it was also the only way to find out what you were committing to.
 */
/**
 * Presets published by other people.
 *
 * Every entry is DOWNLOADED and INSPECTED before anything is imported — the same reader
 * the Inspect button uses, on the same rules. A catalog of automations is a catalog of
 * other people's code, and importing one on the strength of its description would be the
 * thing this whole inspector exists to avoid.
 */
/** One row of the sources panel: where it came from, and how that went. */
interface PresetSource {
    url: string;
    official: boolean;
    // 'loading' exists so the panel can open BEFORE the feeds answer. Every other state is an
    // outcome; this one is the absence of one, and giving it a name keeps the renderer a single
    // switch over `state` instead of a second "are we still waiting" flag beside it.
    // 'off' is not an outcome either: the feed was never asked. It is a state rather than a
    // filter because a source removed from this list cannot be switched back on FROM this
    // list — the one control that undoes it would be the one thing the filter hides.
    state: 'ok' | 'error' | 'notfeed' | 'loading' | 'off';
    count: number;
    detail?: string;
}

/**
 * The official feed comes from the link registry, never from a literal here.
 *
 * It used to be typed into a `window.prompt` default, which meant the official catalogue
 * could only ever be the production domain. A BCWEB running behind a tunnel — cloudflared,
 * ngrok, a staging host — was unreachable no matter how well it worked, so the one path
 * that most needs testing before release was the one path that could not be tested. An
 * empty entry in links.json now means "no official feed", which is a thing a fork may
 * legitimately want to say.
 */
function officialPresetUrl(): string {
    try { return String(getLinks().preset_catalog || '').trim(); } catch { return ''; }
}

async function loadPresetSources(): Promise<{ presets: any[]; sources: PresetSource[] }> {
    const official = officialPresetUrl();
    // Deduplicated against the followed list: somebody who pasted the official address by
    // hand should see one source, not the same catalogue twice under two badges.
    const followed = readPresetCatalogs().filter((u) => u.trim() !== official);
    const wanted = [...(official ? [{ url: official, official: true }] : []),
                    ...followed.map((url) => ({ url, official: false }))];

    const presets: any[] = [];
    const sources: PresetSource[] = [];
    for (const { url, official: isOff } of wanted) {
        // Switched off: listed, not fetched. Recorded as a source so the row — and the button
        // that switches it back on — still exists.
        if (!isOff && isDisabled(url)) { sources.push({ url, official: false, state: 'off', count: 0 }); continue; }
        try {
            // A BUNDLE is a file on this machine, not an address to fetch. The `bundle:`
            // prefix is explicit rather than sniffed from the string: guessing that a
            // source is local because it does not look like a URL is how a typo'd address
            // becomes a file read.
            let bundleDir = '';
            let text: string;
            if (url.startsWith('bundle:')) {
                const res: any = await invoke('catalog_bundle_open', { path: url.slice('bundle:'.length) });
                bundleDir = String(res?.dir || '');
                text = String(res?.catalog || '');
            } else {
                // A preset source may be an ssh:// one; fetchSourceText picks the transport
                // and handles a password-protected HTTP source, so this call site knows
                // about neither.
                text = await fetchSourceText(url);
            }
            const doc = JSON.parse(text);
            if (!looksLikePresetFeed(doc)) {
                // Told apart from "empty" on purpose: a plugin catalog reported as an empty
                // preset catalog sends somebody looking for a problem that is not there.
                sources.push({ url, official: isOff, state: 'notfeed', count: 0 });
                continue;
            }
            const parsed = parsePresetFeed(doc, url, bundleDir);
            // Trust follows the address, not the document — the rule apply_trust enforces
            // for app catalogs. A community feed cannot call its own entries official by
            // saying so in JSON.
            // `_src` so a source can be hidden WITHOUT re-fetching every feed. Switching one
            // off used to call reload(), which re-asked every catalogue over the network to
            // answer a question already on screen — seconds of waiting for a checkbox. With
            // the origin on each card the panel can filter in place.
            for (const p of parsed.presets) presets.push({ ...p, official: isOff, _src: url });
            sources.push({ url, official: isOff, state: 'ok', count: parsed.presets.length,
                           detail: parsed.dropped.length ? parsed.dropped.join('\n') : undefined });
        } catch (e) {
            // The failure is kept ON the source rather than pooled into one "skipped" list.
            // When bettercommunity.ch answers 503, the useful thing to see is which feed is
            // down — not a footnote under an empty page that reads as "you follow nothing".
            sources.push({ url, official: isOff, state: 'error', count: 0, detail: String(e).slice(0, 160) });
        }
    }
    return { presets, sources };
}

/// Which open of the catalogue panel is current. Bumped on every open, cleared on close, so
/// a slow load that finishes after the reader walked away knows it is stale.
let _catalogOpenToken = 0;

/**
 * Make a catalogue of your own automations.
 *
 * This used to be a builder of its own — its own modal, its own wording, its own idea of
 * what a catalogue is written as. Every other kind of catalogue in BMM had grown one too, and
 * they disagreed: one said *Publish my own…* and another *Create catalog*, one had the
 * protected-source block and three did not, and following a catalogue lived on a different
 * screen from making one. Somebody who had learnt one had learnt one.
 *
 * So what is left here is the part that IS about automations — what can go in, what a row
 * says, and how one is written — and the screen comes from ui/catalog-modal.ts.
 *
 * Writing an entry goes through `write_signed_document`, the same path a hand-export takes:
 * a catalogue whose files were unsigned while an exported one was signed would be a quieter
 * file for no reason anybody chose.
 */
export async function openTaskCatalogBuilder(): Promise<void> {
    const { openCatalogModal } = await import('../../ui/catalog-modal.js');
    let unsigned = 0;

    /**
     * Automations handed over as `.bmmpa` files rather than taken from your own list.
     *
     * Publishing on somebody else's behalf used to mean importing their automation first —
     * which grants it nothing, but does put a task you did not write into your scheduler,
     * with its permissions stripped, for you to remember to delete afterwards. Reading the
     * file is not running it: it is parsed, checked for the shape a .bmmpa has, and the
     * BYTES are copied at publish time. Nothing is imported and nothing executes.
     *
     * `_file` is what makes that work: writeEntry copies that file instead of re-exporting a
     * task this machine does not have. It never reaches catalog.json, because the row is
     * built by presetRow from the fields below.
     */
    type Candidate = Task & { _file?: string };
    let handed: Candidate[] = [];
    let firstCall = true;

    const pickBmmpa = async (): Promise<Candidate[]> => {
        const paths = await pickFiles([{ name: 'BMM automation', extensions: ['bmmpa', 'json'] }]).catch(() => null);
        const out: Candidate[] = [];
        for (const p of paths || []) {
            const base = String(p).replace(/^.*[/\\]/, '');
            try {
                const doc = JSON.parse(await invoke('read_file_text', { path: p }) as string);
                const first = Array.isArray(doc?.tasks) ? doc.tasks[0] : null;
                // Checked when it is PICKED. A file that is not an automation must fail here,
                // with its name, rather than produce a catalogue entry that installs nothing.
                if (!first || typeof first !== 'object') {
                    toast(t('sched.tcb.notTask').replace('{f}', base), 'warning', 7000);
                    continue;
                }
                out.push({
                    ...(first as Task),
                    id: String(first.id || base),
                    name: String(first.name || base.replace(/\.[^.]+$/, '')),
                    _file: String(p),
                });
            } catch {
                toast(t('sched.tcb.notTask').replace('{f}', base), 'warning', 7000);
            }
        }
        return out;
    };
    await openCatalogModal<Task>({
        id: 'preset',
        title: t('sched.tcb.title'),
        subtitle: t('sched.tcb.sub'),
        storeKey: 'bmm_preset_catalogs',
        feedField: 'presets',
        ext: 'bmmpa',
        fallbackNoun: 'automation',
        candidates: async () => {
            // The first call is the screen opening: your own automations. Every call after it
            // is the "add a file" button, so it asks for files and adds them to what is there.
            if (firstCall) { firstCall = false; return _tasks.slice(); }
            const more = await pickBmmpa();
            handed = [...handed, ...more];
            return more;
        },
        addMoreLabel: t('sched.tcb.addFile'),
        label: (task) => ({
            name: task.name || '',
            sub: `${(task.steps || []).length} ${t('sched.tcb.steps')}`,
        }),
        entryId: (task) => task.id,
        writeEntry: async (task, dir, file) => {
            const sep = dir.includes('\\') ? '\\' : '/';
            // A handed-over file is COPIED, signature and all. Re-exporting it would sign
            // somebody else's automation with this machine's key, and collectIncludes cannot
            // resolve sub-tasks and blocks that live on their machine, not this one.
            const src = (task as Candidate)._file;
            if (src) {
                await invoke('copy_file', { src, dest: `${dir}${sep}${file}` });
                return true;
            }
            // Everything it calls, transitively — sub-tasks, blocks, launch packs, plugins.
            // The same collector a hand-export uses, so a published automation is not a
            // thinner thing than a shared one.
            const includes = await collectIncludes([task]);
            const payload = JSON.stringify({
                magic: BMMPA_MAGIC, version: 1, exported: new Date().toISOString(), tasks: [task],
                ...(Object.keys(includes).length ? { includes } : {}),
            }, null, 2);
            const signed = await invoke('write_signed_document', {
                path: `${dir}${sep}${file}`, json: payload, format: 'bmmpa',
            });
            if (!signed) unsigned += 1;
            return true;
        },
        row: (task, address) => presetRow(task, address),
        looksLike: looksLikePresetFeed,
        // Said once, at the end, rather than per file: one automation that could not be
        // signed and forty that could is one sentence, not forty toasts.
        onChange: () => {
            if (unsigned) {
                toast(t('sched.exportUnsigned') || 'written unsigned', 'warning');
                unsigned = 0;
            }
        },
    });
    if (unsigned) toast(t('sched.exportUnsigned') || 'written unsigned', 'warning');
}

export async function browsePresetCatalogs(): Promise<void> {
    // The modal opens FIRST, then fills in.
    //
    // It used to await every source before drawing anything, so clicking the button did
    // nothing visible until the slowest feed answered — and the feed that made this obvious was
    // one returning 503, where "nothing happens" lasted the whole timeout. A panel whose entire
    // job is to explain why a catalogue did not answer cannot itself hang silently while it
    // finds out.
    //
    // Each source row already states its own outcome, so `pending: true` is a state the
    // existing renderer can show rather than a second loading screen.
    const pending = officialPresetUrl();
    // Each open gets a token. The panel below stamps it, the close handler clears it, and the
    // re-render at the end refuses to run against a stale one.
    const token = ++_catalogOpenToken;
    showPresetCatalog({
        presets: [],
        sources: pending ? [{ url: pending, official: true, state: 'loading', count: 0 }] : [],
    });
    const data = await loadPresetSources();

    // CLOSED MEANS CLOSED. A source that does not answer holds this await open for its whole
    // timeout, and the panel re-rendered when it finally returned — so closing it while an
    // unreachable catalogue was still being waited on made it spring back, which is not a
    // thing a window is allowed to do. The result is announced instead, and it is still one
    // click away.
    if (token !== _catalogOpenToken || !document.querySelector('.sched-pc-overlay')) {
        const found = (data.presets || []).length;
        const failed = (data.sources || []).filter((x: any) => x.state === 'error').length;
        toast(found
            ? (t('sched.pc.doneToast') || '{n} automation(s) found in the catalogues').replace('{n}', String(found))
            : (t('sched.pc.noneToast') || 'The catalogues returned nothing'),
        failed ? 'warning' : 'info');
        return;
    }
    // Re-render in place. showPresetCatalog closes any panel it already opened, so this
    // replaces the pending view rather than stacking a second overlay on top of it.
    showPresetCatalog(data);
}

/**
 * Browse automations published by other people.
 *
 * Built as sources-beside-results rather than one flat list, for a reason the 503 on
 * bettercommunity.ch demonstrated: the old panel showed "Nothing to show from the catalogs
 * you follow" with the real reason folded into a collapsed "1 skipped" line. That sentence
 * is false and discouraging — you follow a catalogue, it is simply down. Here every source
 * is a row that states its own outcome, so an unreachable feed reads as an unreachable
 * feed.
 *
 * Nothing here imports. Inspect downloads and analyses; the decision stays with the person.
 */
/**
 * A transport error, in words somebody can act on.
 *
 * The panel used to print the raw string — "error sending request for url (https://…" —
 * truncated mid-address. That tells a reader nothing about which of the two things went
 * wrong, and those two things have different answers: a typo in the address is theirs to
 * fix, a server that is down is not. The original is kept, behind a fold, because when
 * neither guess is right the exact text is the only thing left.
 */
function explainFetchError(raw: string): { short: string; raw: string } {
    const r = String(raw || '');
    const status = r.match(/HTTP (\d{3})/);
    if (status) {
        const code = Number(status[1]);
        if (code === 404) return { short: t('sched.pc.e404') || 'Nothing at that address (404).', raw: r };
        if (code === 401 || code === 403) return { short: t('sched.pc.e403') || 'That catalogue is private ({c}).'.replace('{c}', String(code)), raw: r };
        if (code >= 500) return { short: (t('sched.pc.e5xx') || 'The server is having trouble ({c}) — not your address.').replace('{c}', String(code)), raw: r };
        return { short: `HTTP ${code}`, raw: r };
    }
    if (/timed? ?out|timeout/i.test(r)) return { short: t('sched.pc.etimeout') || 'No answer in time.', raw: r };
    if (/dns|resolve|name/i.test(r)) return { short: t('sched.pc.ednst') || 'That host does not resolve — check the address.', raw: r };
    if (/not a preset catalogue/i.test(r)) return { short: t('sched.pc.notfeed') || 'not a preset catalogue', raw: r };
    return { short: t('sched.pc.eunreach') || 'Could not reach it.', raw: r };
}

function showPresetCatalog(data: { presets: any[]; sources: PresetSource[] }): void {
    const esc = (x: unknown) => escHtml(String(x ?? ''));
    // Replace, never stack. This is called twice now — once to open immediately, once when the
    // feeds answer — and it builds a fresh overlay each time, so without this the loading panel
    // would sit behind the real one, both listening for clicks. Matched on its OWN marker class
    // rather than modal-generic-overlay, which every other modal in the app also uses.
    document.querySelectorAll('.sched-pc-overlay').forEach((el) => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'modal-generic-overlay sched-pc-overlay open';
    let { presets, sources } = data;
    let filter = '';
    // What following last said, and what was typed. Both survive a repaint on purpose:
    // paint() rebuilds the whole overlay, so an address that vanished from the field the
    // moment its own error appeared would have to be retyped to be corrected.
    // Sources switched off since the panel opened. Their cards are filtered out in place; the
    // next open re-reads the flag from storage, so this is a view of the session, not a store.
    let hidden: string[] = [];
    let addOut: { kind: 'ok' | 'bad'; text: string; raw?: string } | null = null;
    let addUrl = '';

    const sourceRow = (s: PresetSource) => {
        const label = s.official
            ? (t('sched.pc.official') || 'Official')
            : (t('sched.pc.community') || 'Community');
        // 'loading' is NOT an error and must not be painted like one. Everything that is not
        // 'ok' used to fall into the red branch, so a source still being fetched would have
        // announced itself as unreachable — the panel would open by lying about the thing it
        // exists to report accurately.
        const state = s.state === 'loading'
            ? `<span class="sched-pc-src-n">${esc(t('sched.pc.loading') || 'checking…')}</span>`
            : s.state === 'ok'
                ? `<span class="sched-pc-src-n">${s.count} ${esc(t('sched.pc.tasks') || 'automations')}</span>`
                // 'off' is neither good nor bad — nobody asked it anything. Painting it red
                // would report a problem where there is a choice.
                : s.state === 'off'
                    ? `<span class="sched-pc-src-n">${esc(t('sched.pc.off') || 'switched off')}</span>`
                    : `<span class="sched-pc-src-bad">${esc(s.state === 'notfeed'
                        ? (t('sched.pc.notfeed') || 'not a preset catalogue')
                        : (t('sched.pc.unreachable') || 'unreachable'))}</span>`;
        const bad = s.state === 'error' || s.state === 'notfeed';
        return `
            <div class="sched-pc-src${bad ? ' is-bad' : ''}${s.state === 'off' ? ' is-off' : ''}">
                <div class="sched-pc-src-head">
                    <span class="sched-pc-badge${s.official ? ' is-official' : ''}">${esc(label)}</span>
                    ${state}
                    ${s.official ? '' : `<button class="sched-pc-toggle" data-url="${escAttr(s.url)}"
                        data-tooltip="${escAttr(s.state === 'off'
                            ? (t('sched.pc.on') || 'Fetch this one again')
                            : (t('sched.pc.offit') || 'Keep it listed but stop fetching it'))}">${
                        s.state === 'off'
                            ? SVG16('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>')
                            : SVG16('<path d="M10.7 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.1"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.2-.8"/><path d="m2 2 20 20"/>')
                    }</button>
                    <button class="sched-pc-drop" data-url="${escAttr(s.url)}"
                        data-tooltip="${escAttr(t('sched.pc.unfollow') || 'Stop following this catalogue')}">${SVG16('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')}</button>`}
                </div>
                <div class="sched-pc-src-url" title="${escAttr(s.url)}">${esc(s.url)}</div>
                ${(() => {
                    // Where it came from, when an index brought it in. The panel that follows
                    // catalogues one at a time never said which index a source arrived with.
                    const from = s.official ? null : originOf(s.url);
                    return from ? `<div class="sched-pc-src-from">${esc(t('sched.pc.via') || 'via')} ${esc(originLabel(from))}</div>` : '';
                })()}
                ${s.detail ? (() => {
                    const e = explainFetchError(s.detail!);
                    return `<div class="sched-pc-src-why">${esc(e.short)}</div>
                        <details class="sched-pc-src-raw"><summary>${esc(t('sched.pc.details') || 'exact message')}</summary>${esc(e.raw)}</details>`;
                })() : ''}
            </div>`;
    };

    const cards = () => {
        const q = filter.trim().toLowerCase();
        // Sources switched off in THIS session are filtered here rather than re-fetched away.
        const live = hidden.length ? presets.filter((p) => !hidden.includes(p._src)) : presets;
        const shown = q
            ? live.filter((p) => `${p.name} ${p.description} ${p.author || ''}`.toLowerCase().includes(q))
            : live;
        if (!shown.length) {
            // Three different situations, and they need different sentences. "Nothing to
            // show" covers all three and helps with none.
            if (presets.length) return `<p class="sched-pc-empty">${esc(t('sched.pc.noMatch') || 'Nothing matches that search.')}</p>`;
            const anyOk = sources.some((x) => x.state === 'ok');
            const title = anyOk
                ? (t('sched.pc.emptyFeeds') || 'The catalogues you follow published nothing yet.')
                : (t('sched.pc.allDown') || 'No catalogue answered.');
            const body = anyOk
                ? (t('sched.pc.emptyHelp') || 'Nothing is wrong — they simply have no automations in them. Follow another address on the left.')
                : (t('sched.pc.downHelp') || 'Each source on the left says what happened. A server being down is not something you can fix from here; a wrong address is.');
            return `<div class="sched-pc-blank">
                <div class="sched-pc-blank-icon">${SVG16('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>')}</div>
                <b>${esc(title)}</b>
                <p>${esc(body)}</p>
                <button class="btn btn-sm btn-secondary" id="sched-pc-retry">${esc(t('sched.pc.retry') || 'Try again')}</button>
            </div>`;
        }
        return shown.map((p) => `
            <div class="sched-pc-card">
                <div class="sched-pc-card-top">
                    <b>${esc(p.name)}</b>
                    ${p.official ? `<span class="sched-pc-badge is-official">${esc(t('sched.pc.official') || 'Official')}</span>` : ''}
                    ${p.version ? `<span class="sched-pc-ver">v${esc(p.version)}</span>` : ''}
                </div>
                <div class="sched-pc-card-desc">${esc(p.description)}</div>
                <div class="sched-pc-card-foot">
                    <span class="sched-pc-from">${esc(p.author || '')}${p.author && p.source ? ' · ' : ''}${esc(p.source ? originLabel(p.source) : '')}</span>
                    ${typeof p.tasks === 'number' ? `<span class="sched-pc-n">${p.tasks} ${esc(t('sched.pc.tasks') || 'automations')}</span>` : ''}
                    <button class="btn btn-sm btn-secondary sched-pc-get" data-i="${presets.indexOf(p)}">${esc(t('sched.pc.inspect') || 'Inspect')}</button>
                </div>
            </div>`).join('');
    };

    const paint = () => {
        overlay.innerHTML = `
        <div class="modal sched-pc-modal">
            <!-- The house modal header, not a bespoke one. This panel used sched-insp-top with a
                 bare bold title and two text buttons, which is why it read as unfinished beside
                 every other catalogue in the app: same job, different furniture. Icon tile,
                 title with a subtitle, and a real × — the shape theme-catalog.ts already uses. -->
            <div class="modal-header">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:36px;height:36px;border-radius:9px;background:rgba(59,130,246,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--bmm-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                    </div>
                    <div>
                        <h2 style="margin:0;font-size:16px;">${esc(t('sched.pc.title') || 'Automations from a catalogue')}</h2>
                        <p style="margin:0;font-size:11px;color:var(--bmm-text-muted);">${esc(t('sched.pc.sub') || 'Published by other people — nothing is imported until you say so')}</p>
                    </div>
                </div>
                <button class="modal-close" id="sched-pc-close" data-tooltip="${escAttr(t('common.close') || 'Close')}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="sched-pc-body">
                <aside class="sched-pc-side">
                    <div class="sched-pc-side-h">${esc(t('sched.pc.sources') || 'Sources')}</div>
                    ${sources.map(sourceRow).join('') || `<p class="sched-pc-empty">${esc(t('sched.pc.noSources') || 'No source configured.')}</p>`}
                    <div class="sched-pc-add">
                        <input class="input" id="sched-pc-url" value="${escAttr(addUrl)}" placeholder="${escAttr(t('sched.pc.ask') || 'Address of a preset catalogue')}">
                        <button class="btn btn-sm btn-secondary" id="sched-pc-follow">${esc(t('sched.pc.follow') || 'Follow')}</button>
                    </div>
                    <!-- A catalogue does not have to be somewhere. A bundle is one file
                         holding the catalogue and its automations, so somebody can send you
                         one and there is nothing to host and no address to keep alive. -->
                    <button class="btn btn-sm btn-ghost sched-pc-publish" id="sched-pc-openbundle"
                            data-tooltip="${escAttr(t('sched.pc.bundleTip') || 'Follow a catalogue that came as a single file — it carries its own automations')}">
                        ${SVG16('<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>')}
                        <span>${esc(t('sched.pc.openBundle') || 'Open a bundle file…')}</span>
                    </button>
                    <!-- Publishing lives beside following, because they are the two halves of
                         the same idea and BMM only ever had one of them. A reader with no
                         writer makes a format look closed even when it is not. -->
                    <button class="btn btn-sm btn-ghost sched-pc-publish" id="sched-pc-publish"
                            data-tooltip="${escAttr(t('sched.tcb.tip') || 'Write a folder of your own automations plus a catalog.json — drop it on GitHub and follow it from anywhere')}">
                        ${SVG16('<path d="M12 21V11"/><path d="m8 15 4-4 4 4"/><path d="M4.4 15.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.4 8.3"/>')}
                        <span>${esc(t('sched.tcb.open') || 'Publish my own…')}</span>
                    </button>
                    <!-- Where following says what happened. A toast was the only feedback, and
                         a toast that has already faded is indistinguishable from no feedback at
                         all — which is what "it just does nothing" means. -->
                    <div class="sched-pc-addout" id="sched-pc-addout">${addOut ? `
                        <div class="sched-pc-addout-${escAttr(addOut.kind)}">${esc(addOut.text)}</div>
                        ${addOut.raw ? `<details class="sched-pc-src-raw"><summary>${esc(t('sched.pc.details') || 'exact message')}</summary>${esc(addOut.raw)}</details>` : ''}
                    ` : ''}</div>
                </aside>
                <section class="sched-pc-main">
                    <!-- The access block belongs in the WIDE column. In the sources rail it was
                         squeezed into ~230px: labels wrapping mid-word, the key chooser and its
                         button stacked, the hint a column of two-word lines. A control that has
                         to explain itself needs room to. -->
                    ${sourceAccessHtml('pc')}
                    <!-- Refresh lives here, beside the search, exactly where the theme
                         catalogue puts it. It was in the header; moving it kept its id so the
                         existing handler still finds it — a button relocated must not become a
                         handler bound to nothing. -->
                    <div class="sched-pc-searchrow">
                        <input class="input sched-pc-search" id="sched-pc-q" value="${escAttr(filter)}"
                               placeholder="${escAttr(t('sched.pc.search') || 'Search automations')}">
                        <button class="btn btn-ghost btn-sm" id="sched-pc-refresh"
                            data-tooltip="${escAttr(t('sched.pc.refreshTip') || 'Fetch every source again')}">${esc(t('sched.pc.refresh') || 'Refresh')}</button>
                    </div>
                    <div class="sched-pc-grid">${cards()}</div>
                </section>
            </div>
        </div>`;
        wire();
    };

    // Clearing the token is what makes "closed" stick: a pending load that finishes
    // afterwards reports itself instead of re-opening this.
    const close = () => { _catalogOpenToken += 1; overlay.remove(); };
    const reload = async () => { const d = await loadPresetSources(); presets = d.presets; sources = d.sources; paint(); };

    function wire(): void {
        wireSourceAccess('pc', (m, k) => toast(m, k === 'warning' ? 'warning' : 'success'),
            () => { (document.getElementById('nav-settings') as HTMLElement | null)?.click(); setTimeout(() => document.getElementById('settings-identity-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250); },
            () => (document.getElementById('sched-pc-url') as HTMLInputElement | null)?.value?.trim() || '');
        overlay.querySelector('#sched-pc-close')?.addEventListener('click', close);
        overlay.querySelector('#sched-pc-refresh')?.addEventListener('click', () => { void reload(); });
        overlay.querySelector('#sched-pc-retry')?.addEventListener('click', () => { void reload(); });

        const q = overlay.querySelector<HTMLInputElement>('#sched-pc-q');
        q?.addEventListener('input', () => {
            filter = q.value;
            // Only the grid is repainted. Rebuilding the whole modal would take the caret
            // out of the box on every keystroke.
            const grid = overlay.querySelector('.sched-pc-grid');
            if (grid) { grid.innerHTML = cards(); wireCards(); }
        });

        const urlBox = overlay.querySelector<HTMLInputElement>('#sched-pc-url');
        const followBtn = overlay.querySelector<HTMLButtonElement>('#sched-pc-follow');

        /**
         * Follow a catalogue — after checking it is one.
         *
         * It used to write the address and then re-fetch EVERY source. Two consequences, and
         * the second is the one that reads as "nothing happened": you waited for the slowest
         * feed you already followed before seeing anything, and a bad address was added anyway
         * with its failure buried in a row that only appeared once that wait was over.
         *
         * Now the new address is fetched ALONE and judged first. Nothing is written unless it
         * answers with a preset catalogue, so the followed list cannot fill up with addresses
         * that were never going to work, and the reason is stated where the field is rather
         * than in a toast that has already gone.
         */
        urlBox?.addEventListener('input', () => { addUrl = urlBox.value; });

        // Where following says what happened. Hoisted out of `follow` because opening a
        // bundle reports into the same place, and two copies of one line is two chances
        // for the panel to answer one action and not the other.
        const say = (kind: 'ok' | 'bad', text: string, raw?: string) => { addOut = { kind, text, raw }; paint(); };

        const follow = async () => {
            const url = (urlBox?.value || '').trim();
            addUrl = url;

            if (!/^https?:\/\//i.test(url)) { say('bad', t('sched.pc.badUrl') || 'That is not an http(s) address.'); return; }
            // Case-insensitively, and against the official row too — the same question the
            // rest of the catalogue code asks of a URL.
            if (hasSource([...readPresetCatalogs(), officialPresetUrl()].filter(Boolean), url)) {
                say('bad', t('sched.pc.dup') || 'You already follow that catalogue.'); return;
            }

            if (followBtn) followBtn.disabled = true;
            say('ok', t('sched.pc.checking') || 'Checking that address…');
            try {
                const text: string = await invoke('fetch_remote_json', { url }) as string;
                const doc = JSON.parse(text);
                // An INDEX pasted here is the common mistake and deserves its own sentence:
                // it would parse, contain no presets, and look like an empty catalogue.
                if (looksLikeIndex(doc)) {
                    // Imported here, and only its automation entries. Refusing and pointing at
                    // Settings was correct and unhelpful: this panel knows which type it is,
                    // and the index says which of its entries are that type.
                    const r = await importIndexForType(doc, 'preset', url, undefined, writeSources);
                    addUrl = '';
                    say(r.added ? 'ok' : 'bad', r.added
                        ? (t('sched.pc.fromIndex') || 'Added {n} automation catalogue(s) from that index.').replace('{n}', String(r.added))
                        : r.ofType
                            ? (t('sched.pc.indexAll') || 'That index lists {n} automation catalogue(s) and you already follow them all.').replace('{n}', String(r.ofType))
                            : (t('sched.pc.indexNone') || 'That index lists no automation catalogues — it holds {n} entr(y/ies) of other kinds.').replace('{n}', String(r.total)));
                    if (r.added) await reload();
                    return;
                }
                if (!looksLikePresetFeed(doc)) {
                    say('bad', t('sched.pc.notfeedAdd') || 'That address answered, but it is not a preset catalogue.');
                    return;
                }
                const n = (doc.presets || doc.tasks || []).length || 0;
                writePresetCatalogs([...readPresetCatalogs(), url]);
                recordHistory({ action: 'add', type: 'preset', url });
                addUrl = '';
                say('ok', (t('sched.pc.followed') || 'Following — {n} automation(s).').replace('{n}', String(n)));
                await reload();
            } catch (e) {
                // The explained reason AND the exact message, the same pair the source rows
                // use. "Failed" alone is what sent people to look for a problem elsewhere.
                const ex = explainFetchError(String(e));
                say('bad', ex.short, ex.raw);
            } finally {
                if (followBtn) followBtn.disabled = false;
            }
        };
        overlay.querySelector('#sched-pc-follow')?.addEventListener('click', () => { void follow(); });
        overlay.querySelector('#sched-pc-publish')?.addEventListener('click', () => { void openTaskCatalogBuilder(); });
        overlay.querySelector('#sched-pc-openbundle')?.addEventListener('click', async () => {
            const { pickFile } = await import('../../core/api.js');
            const path = await pickFile([{ name: t('catpub.bundleKind'), extensions: ['bmmbundle', 'zip'] }]).catch(() => null);
            if (!path) return;
            try {
                // Opened before it is followed: a file that is not a catalogue must fail
                // HERE, with the reason, rather than becoming a source that errors on every
                // future open of this panel.
                const res: any = await invoke('catalog_bundle_open', { path });
                const doc = JSON.parse(String(res?.catalog || ''));
                if (!looksLikePresetFeed(doc)) {
                    say('bad', t('sched.pc.bundleNotFeed') || 'That bundle opened, but the catalogue inside it is not an automation catalogue.');
                    return;
                }
                const src = `bundle:${path}`;
                if (readPresetCatalogs().includes(src)) { say('bad', t('sched.pc.already') || 'You already follow that one.'); return; }
                writePresetCatalogs([...readPresetCatalogs(), src]);
                recordHistory({ action: 'add', type: 'preset', url: src });
                say('ok', (t('sched.pc.followedBundle') || 'Following that bundle — {n} automation(s), no host needed.')
                    .replace('{n}', String((doc.presets || []).length || 0)));
                await reload();
            } catch (e) {
                say('bad', t('sched.pc.bundleBad') || 'That file is not a catalogue bundle.', String(e).slice(0, 200));
            }
        });
        urlBox?.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void follow(); });

        overlay.querySelectorAll<HTMLElement>('.sched-pc-toggle').forEach((b) => b.addEventListener('click', () => {
            const u = b.dataset.url || '';
            const off = !isDisabled(u);
            setDisabled(u, off);
            // In place. Everything needed is already loaded: the source row keeps its count,
            // and its cards are the ones carrying this `_src`. Turning one back ON re-uses the
            // presets fetched earlier in this session rather than asking the network again.
            const row = sources.find((x) => x.url === u);
            if (row) row.state = off ? 'off' : (row.count ? 'ok' : 'notfeed');
            hidden = off ? [...hidden, u] : hidden.filter((x) => x !== u);
            paint();
        }));

        overlay.querySelectorAll<HTMLElement>('.sched-pc-drop').forEach((b) => b.addEventListener('click', async () => {
            const u = b.dataset.url || '';
            writePresetCatalogs(readPresetCatalogs().filter((x) => x !== u));
            // The provenance, the history line and the on/off flag go with it — otherwise a
            // catalogue removed here leaves a stale origin behind, and a source that was OFF
            // when removed comes back OFF if it is ever followed again, which reads as the
            // re-follow having silently failed.
            forgetOrigin(u);
            setDisabled(u, false);
            recordHistory({ action: 'remove', type: 'preset', url: u });
            await reload();
        }));

        wireCards();
    }

    function wireCards(): void {
        overlay.querySelectorAll<HTMLElement>('.sched-pc-get').forEach((b) => b.addEventListener('click', async () => {
            const p = presets[Number(b.dataset.i)];
            b.textContent = t('sched.pc.loading') || 'Fetching…';
            try {
                // Inside a bundle it is a file BMM extracted itself, so it is read rather
                // than fetched. Reaching for the network with a path produces an error that
                // names neither the file nor the reason.
                const text: string = p.local
                    ? await invoke('read_file_text', { path: p.downloadUrl }) as string
                    : await invoke('fetch_remote_json', { url: p.downloadUrl }) as string;
                const report = inspectBmmpa(JSON.parse(text));
                if (!report.ok) { toast(report.error || t('sched.inspectFailed') || 'Could not read that file', 'error'); return; }
                close();
                // Downloading is not importing: this ends in a report, and the person decides.
                showBmmpaReport(report, p.name);
            } catch (e) {
                toast(`${t('sched.inspectFailed') || 'Could not read that file'} — ${String(e).slice(0, 100)}`, 'error');
            } finally { b.textContent = t('sched.pc.inspect') || 'Inspect'; }
        }));
    }

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    // ATTACH FIRST, then paint.
    //
    // paint() ends by calling wire(), and wire() calls wireSourceAccess('pc', ...), which
    // finds its controls with document.getElementById. Painting into a DETACHED overlay meant
    // those ids were not in the document yet: the lookup returned null, wiring bailed out
    // silently, and the protected-source block on this one screen opened onto a dropdown
    // nothing ever filled and a "manage keys" button with no listener. Every other screen
    // mounts into markup that is already on the page, which is why only this one was broken.
    //
    // It repaired itself on any later repaint — following a source, an error message, a
    // refresh — which is exactly what made it look intermittent rather than broken.
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
    paint();
}

export async function inspectTasksFile(): Promise<void> {
    const { pickFile } = await import('../../core/api.js');
    const path = await pickFile({ filters: [{ name: 'BMM Automation', extensions: ['bmmpa', 'json'] }] }).catch(() => null);
    if (!path) return;
    let report;
    try {
        const raw: string = await invoke('read_file_text', { path });
        report = inspectBmmpa(JSON.parse(raw));
    } catch (e) {
        // A parse failure is reported as such rather than as "nothing in it": the two mean
        // very different things to somebody deciding whether to trust a file.
        toast(`${t('sched.inspectFailed') || 'Could not read that file'} — ${String(e).slice(0, 120)}`, 'error');
        return;
    }
    if (!report.ok) { toast(report.error || t('sched.inspectFailed') || 'Could not read that file', 'error'); return; }
    showBmmpaReport(report, path);
}

function showBmmpaReport(report: ReturnType<typeof inspectBmmpa>, path: string): void {
    const esc = (x: unknown) => escHtml(String(x ?? ''));
    // The analyser returns codes; the words are the view's. An unknown code falls back to
    // itself rather than to a blank — seeing "app.frobnicate" tells you something, seeing
    // nothing does not.
    const PERM: Record<string, string> = {
        command: t('bmi.p.command') || 'Runs external programs',
        script: t('bmi.p.script') || 'Runs scripts (PowerShell / CMD / Bash / Python)',
        deeplink: t('bmi.p.deeplink') || 'Fires bmm:// deeplinks',
        stopProcess: t('bmi.p.stop') || 'Stops running programs',
    };
    const REACH: Record<string, string> = {
        'custom.command': t('bmi.r.command') || 'Runs an external program',
        'custom.script': t('bmi.r.script') || 'Runs a script',
        'app.stop': t('bmi.r.stop') || 'Stops a program',
        'app.launch': t('bmi.r.launch') || 'Launches an app',
        'file.open': t('bmi.r.file') || 'Opens a file or program',
        'folder.open': t('bmi.r.folder') || 'Opens a folder',
        'open.url': t('bmi.r.url') || 'Opens a URL',
        restart: t('bmi.r.restart') || 'Restarts BMM',
        'task.run': t('bmi.r.task') || 'Runs another scheduled task',
    };
    /**
     * The step tree, in full.
     *
     * The panel used to say "12 steps" and list the risky verbs. That answers "should I be
     * nervous" and not "what does this actually do" — and the second question is the one
     * somebody has when the answer to the first is "a bit".
     *
     * Nested with real indentation, because a task's shape IS its meaning: three actions in
     * a row and three actions inside a loop that runs a hundred times are the same list and
     * very different automations.
     */
    const tree = (nodes: any[], depth = 0): string => nodes.map((n) => {
        const label = n.type
            ? (t('sched.act.' + n.type) || n.type)
            : (t('sched.addIf') && n.kind === 'if' ? t('sched.addIf') : n.kind);
        const params = n.params
            ? Object.entries(n.params).map(([k, v]) =>
                `<span class="sched-insp-kv"><i>${esc(k)}</i> ${esc(v)}</span>`).join('')
            : '';
        // A reference the file does not satisfy is the most useful line here: such a task
        // imports cleanly and fails later, on a machine whose owner has no idea what the id
        // was meant to be.
        const ref = n.refId
            ? (n.refName
                ? `<span class="sched-insp-ref">→ ${esc(n.refName)}</span>`
                : `<span class="sched-insp-ref is-missing">→ ${esc(t('sched.insp.notIncluded') || 'not in this file')}: <code>${esc(n.refId)}</code></span>`)
            : '';
        return `
            <div class="sched-insp-node" style="margin-left:${depth * 14}px">
                <div class="sched-insp-node-head">
                    <span class="sched-insp-kind">${esc(label)}</span>
                    ${n.note ? `<span class="sched-insp-flag">!</span>` : ''}
                    ${ref}
                </div>
                ${params ? `<div class="sched-insp-params">${params}</div>` : ''}
            </div>
            ${tree(n.children || [], depth + 1)}`;
    }).join('');

    const body = report.tasks.map((tk) => `
        <div class="sched-insp-task">
            <div class="sched-insp-head">
                <b>${esc(tk.name)}</b>
                <span class="sched-insp-trigger">${esc(tk.trigger)}</span>
                <span class="sched-insp-count">${tk.stepCount} ${esc(t('sched.insp.steps') || 'steps')}</span>
            </div>
            ${tk.description ? `<div class="sched-insp-desc">${esc(tk.description)}</div>` : ''}
            ${tk.perms.length ? `<div class="sched-insp-warn"><b>${esc(t('sched.insp.asks') || 'It grants itself:')}</b> ${tk.perms.map((k) => esc(PERM[k] || k)).join(' · ')}</div>` : ''}
            ${tk.reaching.length ? `<div class="sched-insp-warn"><b>${esc(t('sched.insp.reaches') || 'Reaches outside BMM:')}</b> ${tk.reaching.map((k) => esc(REACH[k] || k)).join(' · ')}</div>` : ''}
            ${tk.targets.length ? `<div class="sched-insp-targets"><b>${esc(t('sched.insp.targets') || 'Names:')}</b> ${tk.targets.map((x) => `<code>${esc(x)}</code>`).join(' ')}</div>` : ''}
            ${tk.scripts.map((sc) => `<details class="sched-insp-script">
                <summary>${esc(sc.engine === 'command'
                    ? (t('sched.insp.command') || 'Command')
                    : (t('sched.insp.script') || 'Script'))} — ${esc(sc.engine)}</summary>
                <div class="sched-insp-codewrap">
                    <button class="sched-insp-copy" data-copy="${escAttr(sc.code)}"
                        data-tooltip="${escAttr(t('sched.insp.copy') || 'Copy to clipboard')}">${esc(t('sched.insp.copy') || 'Copy')}</button>
                    <pre>${esc(sc.code)}</pre>
                </div>
            </details>`).join('')}
            <details class="sched-insp-steps" open>
                <summary>${esc(t('sched.insp.tree') || 'Every step, in order')}</summary>
                <div class="sched-insp-tree">${tree((tk as any).steps || [])}</div>
            </details>
        </div>`).join('');

    // What the file carries besides tasks, and what it names but does not carry. Both go
    // above the verdict: "12 automations" means something different when three of them call
    // a fourth that is not here.
    const inc = (report as any).includes || { launchpacks: 0, modpacks: 0 };
    const unres: { kind: string; id: string }[] = (report as any).unresolved || [];
    const extras = [
        inc.launchpacks ? `${inc.launchpacks} ${t('sched.insp.launchpacks') || 'launch pack(s)'}` : '',
        inc.modpacks ? `${inc.modpacks} ${t('sched.insp.modpacks') || 'modpack(s)'}` : '',
    ].filter(Boolean).join(' · ');
    const extraLine = extras
        ? `<div class="sched-insp-extra">${esc(t('sched.insp.alsoCarries') || 'Also in this file:')} ${esc(extras)}</div>`
        : '';
    const missingLine = unres.length
        ? `<div class="sched-insp-warn">${esc((t('sched.insp.unresolved')
            || 'Names {n} thing(s) it does not include — these will fail on another machine:')
            .replace('{n}', String(unres.length)))}
            ${unres.slice(0, 8).map((u) => `<code>${esc(u.kind)}:${esc(u.id)}</code>`).join(' ')}</div>`
        : '';

    const verdict = report.needsReview
        ? `<div class="sched-insp-verdict sched-insp-verdict-warn">${esc(t('sched.insp.review') || 'This file asks for permissions or reaches outside BMM. Read it before importing.')}</div>`
        : `<div class="sched-insp-verdict">${esc(t('sched.insp.clean') || 'Nothing here asks for a permission or touches anything outside BMM.')}</div>`;

    const overlay = document.createElement('div');
    overlay.className = 'modal-generic-overlay open';
    overlay.innerHTML = `
        <div class="modal sched-insp-modal">
            <div class="sched-insp-top">
                <div>
                    <b>${esc(t('sched.insp.title') || 'What this file contains')}</b>
                    <span class="sched-insp-file">${esc(path.split(/[\\/]/).pop())}</span>
                </div>
                <button class="btn btn-ghost btn-sm" id="sched-insp-close">${esc(t('common.close') || 'Close')}</button>
            </div>
            ${verdict}
            ${extraLine}
            ${missingLine}
            <div class="sched-insp">${body}</div>
            <p class="sched-insp-foot">${esc(t('sched.insp.foot') || 'Nothing has been imported. Close this and use Import if you want it.')}</p>
        </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#sched-insp-close')?.addEventListener('click', close);
    // Copy the body out to try it somewhere safe. Reading a script in a <pre> and deciding
    // it is fine is exactly the judgement this panel exists to support, and "paste it into
    // a sandbox first" is the careful version of that — so it should not require selecting
    // twenty lines by hand without catching the scrollbar.
    overlay.querySelectorAll<HTMLElement>('.sched-insp-copy').forEach((b) => b.addEventListener('click', async (e) => {
        e.preventDefault();   // the button lives inside <summary>'s sibling; stop the toggle
        try {
            await navigator.clipboard.writeText(b.dataset.copy || '');
            const was = b.textContent;
            b.textContent = t('sched.insp.copied') || 'Copied';
            setTimeout(() => { b.textContent = was; }, 1200);
        } catch {
            toast(t('sched.insp.copyFail') || 'Could not reach the clipboard.', 'error');
        }
    }));
    // Escape closes it too — this is a read-only view, so there is nothing to lose by
    // dismissing it the fastest way somebody will try.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
}

/**
 * Put back what an imported automation needs, and ONLY what is missing.
 *
 * An id that already exists here is left exactly as it was. Importing somebody's automation
 * must never quietly rewrite a plugin or a modpack you already had — a merge nobody asked
 * for is far worse than a step that fails loudly, because it is discovered much later and
 * by then the original is gone.
 *
 * Per kind and per item, so one unrestorable thing costs only itself.
 *
 * Returns the count that actually landed AND a remap, because two of the three kinds keep
 * the id they arrived with and one does not: create_launch_pack mints a fresh UUID. Without
 * the remap a restored launch pack is a pack nobody references — the step still names the
 * exporter's id, still fails, and now there is an orphan pack as well. Plugins and modpacks
 * keep their ids (both commands preserve a non-empty one), so neither needs remapping.
 */
async function restoreIncludes(includes: any): Promise<{ count: number; remap: Record<string, string> }> {
    const remap: Record<string, string> = {};
    if (!includes || typeof includes !== 'object') return { count: 0, remap };
    let n = 0;

    const plugins = Array.isArray(includes.plugins) ? includes.plugins : [];
    if (plugins.length) {
        const have = new Set(((await invoke('get_installed_plugins').catch(() => [])) as any[])
            .map((ip: any) => String(ip?.manifest?.id)));
        for (const manifest of plugins) {
            const id = String(manifest?.id || '');
            if (!id || have.has(id)) continue;
            try {
                // Rebuilt from the manifest, WITHOUT scripts: the file never carried them,
                // and inventing paths that do not exist would produce a plugin that fails
                // the moment it is applied. has_scripts is cleared for the same reason —
                // a plugin that claims scripts it does not have prompts for nothing.
                await invoke('create_local_plugin', {
                    manifest: { ...manifest, scripts: [], has_scripts: false, folders: [] },
                    iconSrcPath: null, iconSvg: null, scriptSrcPaths: null, folderSrcPaths: null, removedBundled: null,
                });
                n++;
            } catch { /* one plugin that will not rebuild must not cost the others */ }
        }
    }

    // Blocks arrive as a single object of name → steps. Only the missing ones are written:
    // a block name is chosen by a person and collisions are likely, and silently replacing
    // the body of a block somebody else's task also calls would break that task instead.
    const blockMap = Array.isArray(includes.blocks) ? (includes.blocks[0] || {}) : {};
    if (blockMap && typeof blockMap === 'object' && Object.keys(blockMap).length) {
        const store = readBlocks();
        let touched = false;
        for (const [name, body] of Object.entries(blockMap)) {
            if (store[name] || !Array.isArray(body)) continue;
            store[name] = body as Step[];
            touched = true;
            n++;
        }
        if (touched) writeBlocks(store);
    }

    const packs = Array.isArray(includes.launchpacks) ? includes.launchpacks : [];
    if (packs.length) {
        const have = new Set(((await invoke('get_launch_packs').catch(() => [])) as any[]).map((p: any) => String(p?.id)));
        for (const pk of packs) {
            if (!pk?.id || have.has(String(pk.id))) continue;
            try {
                const made: any = await invoke('create_launch_pack', {
                    name: String(pk.name || pk.id),
                    exePaths: (pk.executable_paths || pk.executablePaths || []).map((x: any) => String(x)),
                    // The icon is a path on the machine that exported it, so it means
                    // nothing here. The pack arrives without one rather than with a
                    // broken reference.
                    iconSourcePath: null,
                });
                if (made?.id) remap[String(pk.id)] = String(made.id);
                n++;
            } catch { /* as above */ }
        }
    }

    const mps = Array.isArray(includes.modpacks) ? includes.modpacks : [];
    if (mps.length) {
        const have = new Set(((await invoke('load_modpacks').catch(() => [])) as any[]).map((m: any) => String(m?.id ?? m?.name)));
        for (const mp of mps) {
            const key = String(mp?.id ?? mp?.name ?? '');
            if (!key || have.has(key)) continue;
            try { await invoke('save_modpack', { modpack: mp }); n++; } catch { /* as above */ }
        }
    }
    return { count: n, remap };
}

/** Point every step at the id the thing actually got. Walks the same branches collectRefs
 *  does — a step inside a loop inside an if is still a step. */
function remapRefs(steps: Step[], remap: Record<string, string>): void {
    for (const st of steps || []) {
        const a = (st as any).action;
        if ((st as any).kind === 'action' && REF_ACTIONS[String(a?.type || '')] === 'launchpack') {
            const was = String(a?.params?.id || '');
            if (was && remap[was]) a.params.id = remap[was];
        }
        for (const body of stepBodies(st)) remapRefs(body, remap);
    }
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
        // Every task in the file goes through the same door. Sanitising one import path and
        // not the other is the shape this bug already had.
        const askedAll = new Set<string>();
        for (const tk of arr) {
            if (tk && tk.name) {
                const { task: safe, strippedPerms } = sanitiseImportedTask(tk);
                safe.id = `sched-${Date.now()}-${added}`;
                strippedPerms.forEach((x) => askedAll.add(x));
                _tasks.push(safe as Task); added++;
            }
        }
        // What the file carried WITH the tasks. Until now this was collected on export,
        // shown by the inspector, and then dropped — so every launch pack and modpack ever
        // exported in one of these files failed to arrive, silently, and the step that
        // needed it failed later on an id nobody recognised.
        //
        // BEFORE saveTasks, because a restored launch pack gets a new id and the steps that
        // name the old one have to be repointed while they are still in hand.
        const { count: restored, remap } = await restoreIncludes(doc?.includes);
        if (Object.keys(remap).length) for (const tk of arr) if (Array.isArray(tk?.steps)) remapRefs(tk.steps, remap);
        await saveTasks(); renderScheduleList();
        toast(`${added} ${t('sched.imported') || 'automation(s) imported'}`
            + (restored ? ` — ${(t('sched.importedIncl') || 'also restored {n} item(s) it needed').replace('{n}', String(restored))}` : ''),
            'success');
        if (askedAll.size) {
            toast((t('sched.importStripped') || 'Imported disabled. It asked for: {p} — grant what you want in its permissions.')
                .replace('{p}', [...askedAll].join(', ')), 'warning', 8000);
        }
    } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
}


/**
 * The reference, BESIDE the code instead of instead of it.
 *
 * "Open the docs" switched view and closed this modal, which is the one thing you cannot do
 * to somebody in the middle of writing a script: the answer arrives and the question is gone.
 * The full page is still a click away for reading; this is for the other case, which is far
 * more common — "what is that action called again", answered without leaving the line.
 *
 * Entries come from BMMS_INDEX, generated from the same registry as the docs page, so the
 * panel cannot offer an action the runner does not have. What each one is CALLED comes from
 * the app's own i18n at render time, so it is in the reader's language and matches the block
 * editor word for word.
 */
function wireReferencePanel(modal: HTMLElement): void {
    const btn = modal.querySelector('#sched-code-ref') as HTMLButtonElement | null;
    const panel = modal.querySelector('#sched-ref') as HTMLElement | null;
    const q = modal.querySelector('#sched-ref-q') as HTMLInputElement | null;
    const list = modal.querySelector('#sched-ref-list') as HTMLElement | null;
    const ta = modal.querySelector('#sched-code-ta') as HTMLTextAreaElement | null;
    if (!btn || !panel || !q || !list || !ta) return;

    const KINDS: Record<string, string> = { a: 'sched.ref.kindAction', c: 'sched.ref.kindCond', v: 'sched.ref.kindValue', s: 'sched.ref.kindSource' };

    /** What this entry is called, and what it does — both empty for the ones with no keys. */
    const label = (e: BmmsEntry): string =>
        e.k === 'a' ? (t('sched.act.' + e.n) || '') : e.k === 'c' ? (t('sched.cond.' + e.n) || '') : '';
    const desc = (e: BmmsEntry): string => (e.k === 'a' ? (t('sched.actd.' + e.n) || '') : '');

    /**
     * What gets typed for you.
     *
     * An action arrives with its parameter names and the cursor on the first value, because
     * the names are the half nobody remembers. A value source arrives in braces — that is the
     * only form the runner reads, and writing it bare is the mistake this prevents.
     */
    const snippet = (e: BmmsEntry): { text: string; caret: number } => {
        if (e.k === 'a') {
            const ps = e.p || [];
            const body = ps.map((p) => `${p}: `).join(', ');
            return { text: `do ${e.n}(${body})`, caret: `do ${e.n}(${ps[0] ? ps[0] + ': ' : ''}`.length };
        }
        if (e.k === 'v') return { text: `{${e.n}}`, caret: e.n.length + 2 };
        return { text: e.n, caret: e.n.length };
    };

    const insert = (e: BmmsEntry): void => {
        const { text, caret } = snippet(e);
        const at = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? at;
        ta.value = ta.value.slice(0, at) + text + ta.value.slice(end);
        ta.focus();
        // Where the value goes, not after the whole thing: landing past the closing bracket
        // means every insert is followed by the same three arrow presses.
        ta.setSelectionRange(at + caret, at + caret);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const paint = (): void => {
        const needle = q.value.trim().toLowerCase();
        const hits = BMMS_INDEX.filter((e) => {
            if (!needle) return true;
            return e.n.toLowerCase().includes(needle)
                || label(e).toLowerCase().includes(needle)
                || desc(e).toLowerCase().includes(needle);
        });
        if (!hits.length) {
            list.innerHTML = `<p class="sched-ref-none">${escHtml(t('sched.ref.none'))}</p>`;
            return;
        }
        // ALL of them, grouped and sorted.
        //
        // It used to stop at 60 of 151 and say so. Saying so is better than lying, and it is
        // still a reference that does not contain two thirds of the reference — you cannot
        // find what an action is called by searching for a name you do not know.
        //
        // Actions come first because they are what `do` takes and what people are looking for;
        // within a kind, alphabetical, so the same search reads the same way twice.
        const ORDER: BmmsEntry['k'][] = ['a', 'c', 'v', 's'];
        const shown: BmmsEntry[] = [];
        const chunks: string[] = [];
        for (const kind of ORDER) {
            const mine = hits.filter((e) => e.k === kind)
                .sort((x, y) => x.n.localeCompare(y.n));
            if (!mine.length) continue;
            chunks.push(`<h5 class="sched-ref-h">${escHtml(t(KINDS[kind]))}<span>${mine.length}</span></h5>`);
            for (const e of mine) {
                const l = label(e);
                const d = desc(e);
                const ps = (e.p || []).join(', ');
                chunks.push(`<button type="button" class="sched-ref-row" data-i="${shown.length}" title="${escAttr(d || l || e.n)}">
                    <span class="sched-ref-k sched-ref-k-${e.k}">${escHtml(t(KINDS[e.k]))}</span>
                    <span class="sched-ref-n">${escHtml(e.n)}</span>
                    ${ps ? `<span class="sched-ref-p">${escHtml(ps)}</span>` : ''}
                    ${l ? `<span class="sched-ref-l">${escHtml(l)}</span>` : ''}
                </button>`);
                shown.push(e);
            }
        }
        list.innerHTML = chunks.join('');
        list.querySelectorAll<HTMLElement>('.sched-ref-row').forEach((row) => {
            row.addEventListener('click', () => insert(shown[parseInt(row.dataset.i || '0', 10)]));
        });
    };

    btn.addEventListener('click', () => {
        const open = panel.hasAttribute('hidden');
        if (open) { panel.removeAttribute('hidden'); paint(); q.focus(); }
        else panel.setAttribute('hidden', '');
        btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    });
    q.addEventListener('input', paint);
}


/** The scheme words a spec can start with. See src-tauri/src/commands/bmm_paths_core.rs. */
const PATH_KINDS = ['plugin', 'app', 'modpack', 'profile', 'mods', 'game', 'backup', 'appdata'];

/**
 * Expand any parameter that names a place instead of giving a path.
 *
 * The prefilter here can only be too GENEROUS, never too strict: anything whose first word
 * looks like a scheme is sent to Rust, and Rust hands back whatever is not really a spec
 * unchanged. Deciding it here would be a second implementation of "is this a spec", and the
 * one that matters — the one that must never mistake `C:\\mods` for a scheme — is the one
 * with the tests.
 */
async function resolvePathSpecs(params: Record<string, any>): Promise<void> {
    for (const [k, v] of Object.entries(params)) {
        if (typeof v !== 'string' || !v) continue;
        const head = v.split(/[:/\\]/)[0];
        if (!PATH_KINDS.includes(head)) continue;
        try {
            params[k] = await invoke('bmm_path_resolve', { spec: v }) as string;
        } catch (e) {
            // Loud. A spec that cannot be resolved is a plugin that is not installed or a
            // profile that is gone, and continuing with the unresolved text would hand
            // `plugin:my-tools/bundle` to something expecting a path — which fails later,
            // somewhere else, with a worse message.
            throw new Error(`${t('paths.errFailed').replace('{s}', v)} — ${e}`);
        }
    }
}

/**
 * Put a "BMM…" button beside every Browse button in a step's form.
 *
 * Injected rather than written into each form's markup: there are eight of those today and
 * the ninth would be the one somebody forgets. Anything that already offers Browse gets this
 * for free, including forms added later.
 */
function addBmmPathButtons(host: HTMLElement, params: Record<string, any>): void {
    const targets: [string, string, string][] = [
        ['.sched-browse-dir', '.sched-r-dir, .sched-ea-dir', 'dir'],
        ['.sched-browse-file', '.sched-path', 'path'],
        ['.sched-browse-folder', '.sched-path', 'path'],
    ];
    for (const [btnSel, inputSel, key] of targets) {
        const browse = host.querySelector(btnSel) as HTMLElement | null;
        const input = host.querySelector(inputSel) as HTMLInputElement | null;
        if (!browse || !input || browse.dataset.bmmPath) continue;
        browse.dataset.bmmPath = '1';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-ghost sched-bmm-path';
        btn.textContent = t('paths.pick');
        btn.title = t('paths.pickHint');
        btn.addEventListener('click', async () => {
            const spec = await pickBmmPath();
            if (!spec) return;
            params[key] = spec;
            input.value = spec;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        browse.parentElement?.insertBefore(btn, browse.nextSibling);
    }
}

/**
 * Choose a place, and get back the SPEC rather than the path it points at today.
 *
 * The spec is the point. A resolved path is right on this machine until the plugin is
 * reinstalled or the profile switches; `plugin:my-tools/bundle` keeps meaning the same thing,
 * and means it on somebody else's machine too — which is what makes a task shareable.
 */
async function pickBmmPath(): Promise<string | null> {
    let roots: { kind: string; id: string; label: string; path: string }[];
    try {
        roots = await invoke('bmm_path_roots') as typeof roots;
    } catch (e) { toast(String(e), 'error', 8000); return null; }
    if (!roots.length) { toast(t('paths.noneKnown'), 'info', 7000); return null; }

    return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.className = 'cm-overlay';
        const rows = roots.map((r, i) => {
            const spec = r.id ? `${r.kind}:${r.id}` : `${r.kind}:`;
            return `<button type="button" class="pp-row" data-i="${i}" data-spec="${escAttr(spec)}">
                <span class="pp-kind">${escHtml(r.kind)}</span>
                <span class="pp-label">${escHtml(r.label || r.id)}</span>
                <span class="pp-spec">${escHtml(spec)}</span>
                <span class="pp-path">${escHtml(r.path)}</span>
            </button>`;
        }).join('');
        ov.innerHTML = `<div class="cm-modal pp-modal">
            <div class="cm-head"><h3>${escHtml(t('paths.pickTitle'))}</h3>
                <button class="cm-x" id="pp-x" aria-label="${escAttr(t('common.close'))}">&times;</button></div>
            <p class="pp-lede">${escHtml(t('paths.pickLede'))}</p>
            <input type="search" class="input pp-q" id="pp-q" placeholder="${escAttr(t('common.search') || 'Search')}" spellcheck="false">
            <div class="pp-list" id="pp-list">${rows}</div>
            <div class="cm-foot">
                <label class="pp-sub">${escHtml(t('paths.subfolder'))}
                    <input type="text" class="input" id="pp-sub" placeholder="bundle/presets" spellcheck="false"></label>
                <button class="btn btn-sm btn-ghost" id="pp-cancel">${escHtml(t('common.cancel'))}</button>
            </div>
        </div>`;
        const shut = (v: string | null) => { ov.remove(); resolve(v); };
        ov.querySelector('#pp-x')?.addEventListener('click', () => shut(null));
        ov.querySelector('#pp-cancel')?.addEventListener('click', () => shut(null));
        const sub = ov.querySelector('#pp-sub') as HTMLInputElement;
        ov.querySelectorAll<HTMLElement>('.pp-row').forEach((row) => {
            row.addEventListener('click', () => {
                const tail = sub.value.trim().replace(/^[/\\]+/, '');
                const base = row.dataset.spec || '';
                shut(tail ? `${base}${base.endsWith(':') ? '' : '/'}${tail}` : base);
            });
        });
        const q = ov.querySelector('#pp-q') as HTMLInputElement;
        q.addEventListener('input', () => {
            const n = q.value.trim().toLowerCase();
            ov.querySelectorAll<HTMLElement>('.pp-row').forEach((row) => {
                row.style.display = !n || row.textContent!.toLowerCase().includes(n) ? '' : 'none';
            });
        });
        (document.getElementById('app-window-outer') || document.body).appendChild(ov);
        raiseAboveAll(ov, 11600);
        q.focus();
    });
}


/**
 * The outline, and the hover that says what a word does.
 *
 * Both hang off the same textarea and neither changes what it contains: an editor aid that can
 * edit is an editor aid that can lose somebody's work.
 */
function wireOutlineAndHover(modal: HTMLElement): void {
    const ta = modal.querySelector('#sched-code-ta') as HTMLTextAreaElement | null;
    const panel = modal.querySelector('#sched-outline') as HTMLElement | null;
    const list = modal.querySelector('#sched-outline-list') as HTMLElement | null;
    const btn = modal.querySelector('#sched-code-outline') as HTMLButtonElement | null;
    if (!ta || !panel || !list || !btn) return;

    let rows: OutlineRow[] = [];
    const paint = () => {
        rows = outlineOf(ta.value);
        renderOutline(list, rows, (line) => {
            // Caret first, then scroll. Setting selectionStart on a textarea that is not
            // focused does nothing visible in some engines, and "it jumped nowhere" reads as
            // a broken outline rather than a focus rule.
            ta.focus();
            const at = offsetOfLine(ta.value, line);
            ta.setSelectionRange(at, at);
            // Roughly: line height is not knowable without measuring, and being a line or two
            // out is fine when the caret is already in the right place.
            const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
            ta.scrollTop = Math.max(0, (line - 3) * lh);
        });
    };

    btn.addEventListener('click', () => {
        const open = panel.hasAttribute('hidden');
        if (open) { panel.removeAttribute('hidden'); paint(); }
        else panel.setAttribute('hidden', '');
        btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    });
    // Repainted on a timer rather than on every keystroke: the outline is a signpost, and one
    // that re-sorts itself mid-word is a distraction.
    let timer: number | null = null;
    ta.addEventListener('input', () => {
        if (panel.hasAttribute('hidden')) return;
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(paint, 400);
    });

    // ── Hover ───────────────────────────────────────────────────
    let tip: HTMLElement | null = null;
    let lastWord = '';
    const hide = () => { tip?.remove(); tip = null; lastWord = ''; };

    ta.addEventListener('mousemove', (e) => {
        const mirror = ta.parentElement?.querySelector('.code-hl-mirror') as HTMLElement | null;
        if (!mirror) return;
        const word = wordAtPoint(mirror, e.clientX, e.clientY);
        if (!word) { hide(); return; }
        if (word === lastWord) return;
        const said = explain(word);
        hide();
        if (!said) { lastWord = ''; return; }
        lastWord = word;
        tip = document.createElement('div');
        tip.className = 'bmms-hover';
        tip.innerHTML = `<b>${escHtml(said.title)}</b>${said.body ? `<span>${escHtml(said.body)}</span>` : ''}`;
        (document.getElementById('app-window-outer') || document.body).appendChild(tip);
        raiseAboveAll(tip, 11700);
        // Placed below-right of the pointer, then pulled back inside the window. A tooltip
        // that opens off-screen is one nobody knows appeared.
        const r = tip.getBoundingClientRect();
        const x = Math.min(e.clientX + 14, window.innerWidth - r.width - 10);
        const y = e.clientY + 20 + r.height > window.innerHeight ? e.clientY - r.height - 10 : e.clientY + 20;
        tip.style.left = `${Math.max(8, x)}px`;
        tip.style.top = `${Math.max(8, y)}px`;
    });
    ta.addEventListener('mouseleave', hide);
    ta.addEventListener('scroll', hide);
    ta.addEventListener('keydown', hide);
}


/**
 * What this task would change, without changing it.
 *
 * The debugger runs for real — mods really get enabled. That is right for a debugger and wrong
 * for the question people have BEFORE running something they just wrote.
 *
 * It reads the steps and does not evaluate a single condition, so it cannot be exactly right.
 * The screen is built around saying so: every line is marked certain or maybe, and the note at
 * the bottom explains what it could not know.
 */
async function openPreview(): Promise<void> {
    const plan = planOf(_draft.steps || []);
    if (!plan.length) {
        toast(t('sched.prev.nothing'), 'info', 7000);
        return;
    }
    const mods: any[] = await invoke('get_all_mods').catch(() => []);
    const known = new Set((mods || []).map((m) => String(m.id)));
    const on = new Set((mods || []).filter((m) => m.enabled).map((m) => String(m.id)));
    const nameOf = (id: string) => (mods || []).find((m) => String(m.id) === id)?.name || id;
    const lines = previewAgainst(plan, on, known);

    const changes = lines.filter((l) => l.effect === 'change').length;
    const maybes = lines.filter((l) => !l.certain).length;

    const ov = document.createElement('div');
    ov.className = 'cm-overlay';
    ov.innerHTML = `<div class="cm-modal pv-modal">
        <div class="cm-head">
            <h3>${escHtml(t('sched.prev.title'))}</h3>
            <button class="cm-x" id="pv-x" aria-label="${escAttr(t('common.close'))}">&times;</button>
        </div>
        <p class="pv-lede">${escHtml(t('sched.prev.lede')
            .replace('{c}', String(changes))
            .replace('{n}', String(lines.length)))}</p>
        <div class="pv-list">
            ${lines.map((l) => `<div class="pv-row pv-${escHtml(l.effect)}${l.certain ? '' : ' is-maybe'}">
                <span class="pv-what">${escHtml(t('sched.prev.w.' + l.what))}</span>
                <span class="pv-id">${escHtml(l.what === 'enable' || l.what === 'disable' ? nameOf(l.id) : (l.id || '—'))}</span>
                <span class="pv-eff">${escHtml(t('sched.prev.e.' + l.effect))}</span>
                ${l.certain ? '' : `<span class="pv-maybe">${escHtml(t('sched.prev.maybe'))}</span>`}
            </div>`).join('')}
        </div>
        <div class="cm-foot">
            <span class="pv-note">${escHtml(maybes ? t('sched.prev.noteMaybe').replace('{m}', String(maybes)) : t('sched.prev.note'))}</span>
            <button class="btn btn-sm btn-accent" id="pv-ok">${escHtml(t('common.close'))}</button>
        </div>
    </div>`;
    const shut = () => ov.remove();
    ov.querySelector('#pv-x')?.addEventListener('click', shut);
    ov.querySelector('#pv-ok')?.addEventListener('click', shut);
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    raiseAboveAll(ov, 11500);
}
