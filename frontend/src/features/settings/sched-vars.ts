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
    /**
     * Named lists, for the steps that need more than one value.
     *
     * `nums` and `text` hold exactly one thing each, so a task that collected several — the
     * profiles it touched, the URLs a feed returned — had nowhere to put them and resorted to
     * a delimited string that every reader had to split the same way. A fourth bag rather
     * than a convention inside `text`, because "is this a list" then stops being a guess
     * about the contents of a string.
     *
     * Strings, not `any`: everything a step can produce is text or a number, and a bag that
     * could hold objects would let `for each` iterate something no condition can compare.
     */
    lists?: Record<string, string[]>;
}

/**
 * A run-time value, carrying its own type.
 *
 * The four bags above each exist for a real reason, and none of them is going away yet. But
 * they mean a variable's type is decided by WHICH BAG somebody wrote it into, and the same
 * name can sit in two bags at once — which is fine for substituting into a string (there is a
 * precedence rule, and it is correct) and useless for branching on a value, because "whatever
 * the first bag holding this name says" is not a type.
 *
 * `match`, `enum`, `maps` and `result` all need a value whose shape is knowable. This is that
 * shape. It is introduced here first, as the single way to READ a variable, so the storage can
 * migrate to it later without every reader changing twice.
 *
 * See .Assets/.md/SCHEDULER_TYPES_DESIGN.md for where this is going.
 */
export type SchedValue =
    | { t: 'text'; v: string }
    | { t: 'num'; v: number }
    | { t: 'list'; v: string[] };

/**
 * Resolve a name to a typed value — the one place that knows the precedence.
 *
 * The order is the one `substituteVars` has always used, moved here rather than reinvented:
 * this run's captured text, then this run's number, then a stored `shared` value. A step that
 * captured `path` two lines up must not read some other task's `path` from last Tuesday.
 *
 * Lists are checked FIRST because they are the one shape a string cannot impersonate. A list
 * and a text can share a name today — `list.set('x')` and a capture into `x` write different
 * bags — and for a caller asking "what is x", the list is the answer that carries more
 * information. Substitution deliberately does not use this rule; see below.
 *
 * Returns undefined for an unknown name, never a default. A caller that wants "" or 0 can say
 * so; one that gets it silently cannot tell an empty value from a missing one, and that
 * difference is the whole point of asking.
 */
export function readVar(ctx: RunCtx, name: string): SchedValue | undefined {
    if (ctx.lists && Object.prototype.hasOwnProperty.call(ctx.lists, name)) {
        return { t: 'list', v: ctx.lists[name] };
    }
    if (Object.prototype.hasOwnProperty.call(ctx.text, name)) return { t: 'text', v: ctx.text[name] };
    if (Object.prototype.hasOwnProperty.call(ctx.nums, name)) return { t: 'num', v: ctx.nums[name] };
    if (ctx.shared && Object.prototype.hasOwnProperty.call(ctx.shared, name)) {
        return { t: 'text', v: ctx.shared[name] };
    }
    return undefined;
}

/**
 * A value as it appears inside a string parameter.
 *
 * A list renders as JSON rather than `a,b,c` so that pasting it back into a step that reads a
 * list round-trips exactly — `parseList` prefers JSON, and a comma-joined list loses any item
 * that contained a comma. `[object Object]` was never a possibility here and must not become
 * one when maps arrive.
 */
export function renderVar(val: SchedValue): string {
    if (val.t === 'num') return String(val.v);
    if (val.t === 'list') return JSON.stringify(val.v);
    return val.v;
}

/**
 * A variable as a number, for the paths that can only work with one — math expressions and
 * numeric comparisons.
 *
 * This exists because a SHARED variable used to be invisible to every one of them. `var.set`
 * with scope `shared` writes only `ctx.shared`; the run starts with `nums: {}` and nothing
 * copies one into the other. So `count + 1` on a shared counter read 0 and evaluated to 1 on
 * every run, forever, while the same name substituted correctly into a string two lines above.
 * Nothing errored. That is the failure this whole typed-read seam is for.
 *
 * The coercion mirrors what `var.set` already does for run-scope values rather than inventing
 * a better one: a parseable number is that number, and anything else is its LENGTH. Length is
 * a strange answer, but it is the answer the run scope has always given, and two rules for
 * "the number of this text" would be worse than one odd rule.
 *
 * Returns undefined for an unknown name so callers keep their own default — `evalExpr` wants
 * 0, a comparison wants NaN, and collapsing that here would make an absent variable compare
 * equal to zero.
 */
export function readNum(ctx: RunCtx, name: string): number | undefined {
    // `nums` FIRST, deliberately against readVar's own order. Every numeric path in the
    // scheduler reads `ctx.nums[name]` today, and a step is free to have written a number
    // there that is not parseFloat(text) — a version string's part count, a metric with a
    // formatted label. Consulting text first would silently change what those evaluate to.
    // Checking nums first makes this purely additive: what resolves today resolves the same,
    // and only names that resolved to NOTHING gain an answer.
    if (Object.prototype.hasOwnProperty.call(ctx.nums, name)) return ctx.nums[name];
    const val = readVar(ctx, name);
    if (!val) return undefined;
    if (val.t === 'num') return val.v;
    // A list's number is its length — the one reading that is never a surprise, and it makes
    // arithmetic over a collected list work without a separate step.
    if (val.t === 'list') return val.v.length;
    const n = parseFloat(val.v);
    return Number.isFinite(n) ? n : val.v.length;
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
 *
 * Deliberately NOT written in terms of `readVar`, though it resolves the same three bags in
 * the same order. `readVar` also answers for lists; this does not, and must not start to. A
 * task saved today where `{x}` names a list leaves the braces alone, and somebody is relying
 * on that — quietly turning it into `["a","b"]` inside a path or a command line is the kind of
 * change that is invisible in review and destructive at run time. When the storage migrates to
 * typed values, THIS is the function whose behaviour has to be pinned first.
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

/**
 * Read a list out of what somebody typed.
 *
 * Accepts a JSON array or a delimited line, because both are what people actually paste: an
 * API response is JSON, and a hand-written list is `a, b, c`. Guessing wrong on a JSON array
 * would split it on its commas and produce items like `["a` — a failure that looks like data.
 *
 * Blank entries are dropped. A trailing comma is a typo, not an empty item, and an empty item
 * would make `for each` run a step against nothing.
 */
export function parseList(raw: unknown, sep = ','): string[] {
    if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
    const s = String(raw ?? '').trim();
    if (!s) return [];
    if (s.startsWith('[')) {
        try {
            const v = JSON.parse(s);
            if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
        } catch { /* not JSON after all — fall through to the delimiter */ }
    }
    return s.split(sep).map((x) => x.trim()).filter(Boolean);
}
