// Run-time variables for the scheduler — the part with no app in it.
//
// Split out for the same reason as sched-time.ts: this is a pure function of some params
// and a context, so it can be tested directly. scheduler.ts cannot be — it reaches
// Tauri, the DOM and localStorage before its first statement runs, so importing it from a
// test throws on `localStorage is not defined`.

/**
 * Per-run variables, in the two forms a step can produce.
 *
 * `nums` is what conditions compare, and used to be the whole story — the context was a
 * plain Record<string, number>. That made a script's output unusable unless it happened
 * to be a single number: the capture fell back to the string's LENGTH, so a script
 * returning a path or a name gave a meaningless integer, every comparison against it was
 * true or false by accident, and there was no way to get the string itself back.
 *
 * `text` keeps what the step actually said. Both are filled from the same capture, so
 * naming a variable gives you the number where there is one AND the text always.
 */
export interface RunCtx {
    nums: Record<string, number>;
    text: Record<string, string>;
    /**
     * Variables that outlive the run: written by `var.set` with scope `shared`, and
     * readable by every task.
     *
     * Kept in a THIRD bag rather than merged into `text` so the precedence is a property
     * of the data instead of a rule about the order two objects were spread in. A step's
     * own capture must win over a stored value with the same name — otherwise a task that
     * captures `path` starts reading some other task's `path` from last Tuesday, and the
     * failure looks like the script misbehaving.
     */
    shared?: Record<string, string>;
}

/**
 * Where a `var.set` writes.
 *
 * `run` disappears when the task finishes; `shared` persists and is visible to every task.
 * Two words rather than a boolean because the stored task is JSON somebody reads and
 * shares — `scope: "shared"` says what it does, `persist: true` does not say to whom.
 */
export type VarScope = 'run' | 'shared';

/** Names a variable may have. Deliberately the same shape substituteVars will match:
 *  a name it cannot substitute is a variable that silently never works. */
export const VAR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Replace {var} in every string parameter with what an earlier step captured.
 *
 * At RUN time, unlike substituteItem's {item.x}, which is resolved when a for-each plans
 * its body. A captured value does not exist until the step producing it has run, so there
 * is nothing to substitute earlier — that is why this is a second point rather than an
 * extension of the first.
 *
 * Text wins over the number when both exist: the number is a derived convenience for
 * conditions, and the text is what the step actually said.
 *
 * An unknown {name} is left EXACTLY as written rather than blanked. A path containing
 * braces, or a script that prints them, must survive a step that does not mean to
 * substitute anything — and silently emptying a parameter is how a task deletes the wrong
 * folder. {item.x} is skipped for the same reason: it belongs to the for-each that owns
 * it, and eating it here would resurrect the nested-loop bug substituteItem exists to fix.
 *
 * Returns a new object; the caller's params are never mutated, because they are the saved
 * task and rewriting them would bake one run's values into the stored definition.
 */
export function substituteVars(params: Record<string, any>, ctx: RunCtx): Record<string, any> {
    const rep = (v: any): any => {
        if (typeof v === 'string') {
            return v.replace(/\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g, (m, k) => {
                if (k.startsWith('item.')) return m;
                // Order matters and is the point: this run's capture, then this run's
                // number, then a stored value. A step that captured `path` two lines up
                // must not read some other task's `path` from last Tuesday — that failure
                // presents as the script misbehaving, and sends you to the wrong file.
                if (Object.prototype.hasOwnProperty.call(ctx.text, k)) return ctx.text[k];
                if (Object.prototype.hasOwnProperty.call(ctx.nums, k)) return String(ctx.nums[k]);
                if (ctx.shared && Object.prototype.hasOwnProperty.call(ctx.shared, k)) return ctx.shared[k];
                return m;
            });
        }
        if (Array.isArray(v)) return v.map(rep);
        if (v && typeof v === 'object') { const o: any = {}; for (const k of Object.keys(v)) o[k] = rep(v[k]); return o; }
        return v;
    };
    return rep(params);
}
