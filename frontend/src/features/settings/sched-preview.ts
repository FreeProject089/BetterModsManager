// What this task would do to your mods, without doing it.
//
// The debugger runs for real: mods really get enabled, files really get written. That is the
// right design for a debugger and the wrong one for the question people have BEFORE running
// something they just wrote, which is "what is this about to change".
//
// So this reads the steps and reports the mod-shaped ones. It does not evaluate conditions and
// it does not run anything — which means it cannot be exactly right, and the whole design is
// about being honest about that rather than looking authoritative.
//
// A step whose body may not run is reported as MAYBE — inside an `if`, a loop, an `ensure`, or
// a `try`'s error handler. Reporting those as certain would be a preview that promises things
// it cannot know; leaving them out would be a preview that hides the half somebody most wants
// to check.
//
// A `try`'s main body and a `retry`'s body are NOT maybes: the first always starts and the
// second runs at least once. Being lazily pessimistic there would mark most of a careful task
// as uncertain, which is the same as saying nothing.

/** One thing the task would do. */
export interface PlannedChange {
    /** `enable` · `disable` · `modpack` · `plugin` · `profile` · `all`. */
    what: string;
    /** The id it names, or empty when the action takes none. */
    id: string;
    /** False when the step sits inside a branch, a loop or a retry. */
    certain: boolean;
}

/** The action types this can say something about, and what each does. */
const MOD_ACTIONS: Record<string, string> = {
    'mod.enable': 'enable',
    'mod.disable': 'disable',
    'modpack.enable': 'modpack',
    'modpack.disable': 'modpack',
    'plugin.apply': 'plugin',
    'profile.activate': 'profile',
    'mods.enableAll': 'all',
    'mods.disableAll': 'all',
};

/**
 * Every array of steps hanging off this one, and whether it is certain to run.
 *
 * Per BODY, not per step, because the answer differs inside one step. A `try`'s main body
 * always starts; its `onError` runs only when something failed. A `retry`'s body runs at least
 * once. An `if` picks one side, so neither is certain. A loop may run zero times.
 *
 * Getting this wrong in the generous direction is the worse mistake: a preview that promises a
 * change which never happens is one people stop reading.
 */
function bodies(st: any): { steps: any[]; sure: boolean }[] {
    const out: { steps: any[]; sure: boolean }[] = [];
    const add = (steps: any, sure: boolean) => {
        if (Array.isArray(steps)) out.push({ steps, sure });
    };
    switch (st?.kind) {
        case 'try':
            add(st.steps, true);      // the body always starts
            add(st.onError, false);   // only when something failed
            break;
        case 'retry':
            add(st.steps, true);      // at least one attempt
            break;
        case 'parallel':
            // Every branch runs. They just run at the same time.
            if (Array.isArray(st.branches)) for (const br of st.branches) add(br, true);
            break;
        case 'if':
            add(st.then, false);
            add(st.else, false);
            break;
        case 'switch':
            if (Array.isArray(st.cases)) for (const c of st.cases) add(c?.steps, false);
            add(st.default, false);
            break;
        default:
            // repeat, forEach, ensure: each may run its body zero times.
            add(st?.steps, false);
            break;
    }
    return out;
}

/**
 * What the task would change, in order.
 *
 * `certain` is false for anything nested inside a body that may or may not run — decided per
 * body, so a `try`'s main steps stay certain while its `onError` does not.
 */
export function planOf(steps: any[], certain = true): PlannedChange[] {
    const out: PlannedChange[] = [];
    for (const st of steps || []) {
        if (!st || st.disabled) continue;
        if (st.kind === 'action') {
            const what = MOD_ACTIONS[String(st.action?.type || '')];
            if (what) {
                out.push({ what, id: String(st.action?.params?.id ?? ''), certain });
            }
            continue;
        }
        // A `call` reaches into a block this cannot see from here. Reported as an unknown
        // rather than skipped: a preview that silently ignores half a task is worse than one
        // that says which half.
        if (st.kind === 'call') {
            out.push({ what: 'block', id: String(st.block || ''), certain });
            continue;
        }
        for (const body of bodies(st)) out.push(...planOf(body.steps, certain && body.sure));
    }
    return out;
}

/** One line of the answer, after comparing against what is on now. */
export interface PreviewLine {
    what: string;
    id: string;
    certain: boolean;
    /** `change` · `already` · `unknown`. */
    effect: string;
}

/**
 * The plan, against the mods as they are.
 *
 * "Would enable X" and "X is already on" are different sentences, and the second one is the
 * answer to most of the questions people open this to ask.
 */
export function previewAgainst(plan: PlannedChange[], enabledIds: Set<string>, knownIds: Set<string>): PreviewLine[] {
    return plan.map((p) => {
        let effect = 'change';
        if (p.what === 'enable') {
            effect = !knownIds.has(p.id) ? 'unknown' : enabledIds.has(p.id) ? 'already' : 'change';
        } else if (p.what === 'disable') {
            effect = !knownIds.has(p.id) ? 'unknown' : enabledIds.has(p.id) ? 'change' : 'already';
        } else if (p.what === 'block') {
            // A block's steps are not read here, so nothing can be said about them.
            effect = 'unknown';
        }
        return { ...p, effect };
    });
}
