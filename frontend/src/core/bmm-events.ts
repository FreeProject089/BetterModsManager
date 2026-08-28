// The moments BMM can tell a task about.
//
// Every other trigger watches the OUTSIDE: a clock, a file some other program wrote. These
// are BMM itself saying what just happened — a mod that turned out to be missing while a
// modpack was being applied, a sync that failed, an error somebody saw.
//
// Those moments were only ever observable by the person sitting in front of the app. A task
// that repairs a broken install is close to useless if it can only find out on a timer,
// because by then the person has already given up and fixed it by hand.
//
// **They ring the same hooks as everything else.** `wait.hook`, `bmm://hook` and
// `POST /api/hook` were already a named ring with data; an event is one of those, rung by BMM
// instead of by something outside. One mechanism means a task can wait on an event exactly the
// way it waits on a webhook, and everything built for one works for the other.

import { invoke } from './api.js';

/**
 * The events BMM rings, for the trigger's dropdown.
 *
 * A short list on purpose. Every name here is a moment somebody has actually wanted to react
 * to; an event nobody acts on is a name in a list and a line in a table, forever. The trigger
 * also takes a typed name, so nothing here is a limit — it is a starting point.
 */
export const BMM_EVENTS = [
    'bmm.mod.missing',
    'bmm.mod.corrupt',
    'bmm.modpack.applied',
    'bmm.modpack.incomplete',
    'bmm.repo.syncFailed',
    'bmm.repo.synced',
    'bmm.profile.activated',
    'bmm.error',
    // Rung by the scheduler itself at the end of every run, carrying which task, whether
    // it worked, how long it took and how many chained runs led to it. The "after another
    // task" trigger is a reader of this and nothing more.
    'bmm.task.done',
];

/**
 * Ring one. Never throws, and never waits.
 *
 * Called from inside code that is doing something else — an activation, a sync, a toast — so
 * the one thing it must never do is change what that code does. An event that can fail the
 * operation it is describing is worse than no event.
 */
export function fireEvent(name: string, data: Record<string, unknown> = {}): void {
    void (invoke('hook_fire', { name, data }) as Promise<unknown>).catch(() => {});
}

/**
 * How many tasks are running right now.
 *
 * Only `bmm.error` cares, and the reason is a loop that would otherwise be very easy to build:
 * a task triggered by `bmm.error` that itself fails raises an error toast, which fires
 * `bmm.error`, which runs the task again — forever, with no error message anywhere that
 * explains it, because every individual step is behaving correctly.
 *
 * So an error raised WHILE a task is running is not an app-wide event. It is that task's
 * failure, it is already in that task's log and in the running panel, and it belongs there.
 */
let _tasksRunning = 0;

/** Called by the scheduler around a run. Counted, not a boolean: tasks can overlap. */
export function noteTaskRunning(delta: 1 | -1): void {
    _tasksRunning = Math.max(0, _tasksRunning + delta);
}

/** True while at least one task is running. */
export function anyTaskRunning(): boolean {
    return _tasksRunning > 0;
}

/**
 * The catch-all: something went wrong and somebody was told.
 *
 * Every error toast in BMM comes through one function, so this is one call rather than a
 * hundred — and it covers the failures nobody thought to instrument, which are the ones worth
 * reacting to.
 */
export function fireErrorEvent(message: string, source = ''): void {
    if (anyTaskRunning()) return;
    fireEvent('bmm.error', { message: String(message).slice(0, 400), source });
}
