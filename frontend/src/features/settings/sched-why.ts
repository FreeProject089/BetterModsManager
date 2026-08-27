// Why a task has not run — the part with no app in it.
//
// Split out for the same reason as sched-time.ts and sched-vars.ts: scheduler.ts reaches Tauri,
// the DOM and localStorage before its first statement runs, so importing it from a test throws
// on `requestAnimationFrame is not defined`. Everything decided here is a pure function of a
// task, a clock and four sets, so it belongs where it can be exercised.
//
// This is the most common question anybody asks a scheduler, and the app answered it worst: a
// task sat in the list saying nothing at all, and the reasons it might be sitting there are not
// guessable from looking at it.

/**
 * The part of a task this needs, and nothing else.
 *
 * Structural rather than imported: `Task` lives inside scheduler.ts, which is the module this
 * file exists to be independent of. Naming the four fields it reads also documents exactly how
 * much of a task an answer depends on.
 */
export interface TaskLike {
    id: string;
    enabled: boolean;
    trigger: { type: string; [k: string]: unknown };
    lastRun?: number;
}

/** What the running scheduler remembers about what has already fired. */
export interface FiredState {
    /** Tasks whose watched file has been polled at least once. */
    watch: Set<string>;
    /** Tasks whose event ring has been read at least once. */
    event: Set<string>;
    /** `appStart` tasks that have fired during this launch. */
    appStart: Set<string>;
    /** `once` tasks that have fired. */
    once: Set<string>;
}

/** A reason, as a key and something to put in it. Never a finished sentence. */
export interface Reason {
    key: string;
    v?: string;
}

/**
 * Why this task is not going to run in a moment.
 *
 * The order is the order the RUNNER checks in, so the answer is the reason the runner would
 * give. A task that is both disabled and not due reads as disabled, because turning it on is
 * the thing that would change something.
 *
 * `next` is the already-computed next due time, or null: this module does not know how to
 * compute one and should not learn — there is one calendar in this codebase and it is not here.
 */
export function reasonNotRunning(
    task: TaskLike,
    fired: FiredState,
    next: number | null,
): Reason {
    if (!task.enabled) return { key: 'sched.why.off' };

    const tr: any = task.trigger;
    if (tr.type === 'manual') return { key: 'sched.why.manual' };

    if (tr.type === 'watchFile') {
        const path = String(tr.path || '').trim();
        if (!path) return { key: 'sched.why.watchNoPath' };
        const name = path.replace(/^.*[\\/]/, '');
        // The first poll after a start RECORDS and does not fire, so "armed but nothing seen
        // yet" is a real state worth naming — otherwise a task that has been watching for ten
        // seconds looks identical to one that is broken.
        return fired.watch.has(task.id)
            ? { key: 'sched.why.watchIdle', v: name }
            : { key: 'sched.why.watchArming', v: name };
    }

    if (tr.type === 'onEvent') {
        const ev = String(tr.event || '').trim();
        if (!ev) return { key: 'sched.why.eventNone' };
        return fired.event.has(task.id)
            ? { key: 'sched.why.eventIdle', v: ev }
            : { key: 'sched.why.eventArming', v: ev };
    }

    if (tr.type === 'appStart') {
        return fired.appStart.has(task.id)
            ? { key: 'sched.why.appStartDone' }
            : { key: 'sched.why.appStartSoon' };
    }

    if (tr.type === 'once') {
        if (fired.once.has(task.id) || task.lastRun) return { key: 'sched.why.onceDone' };
        const at = new Date(String(tr.at)).getTime();
        if (isNaN(at)) return { key: 'sched.why.onceBadDate' };
        return { key: 'sched.why.dueAt', v: new Date(at).toLocaleString() };
    }

    if (next === null) return { key: 'sched.why.noNext' };
    return { key: 'sched.why.dueAt', v: new Date(next).toLocaleString() };
}
