/**
 * Laya in a scheduled task: the rules around the three AI steps, kept apart from the runner so
 * they can be tested without the app.
 *
 * Three things live here.
 *
 *  · **Budgets.** A task may ask Laya at most {@link AI_MAX_STEPS} times per run and spend at
 *    most {@link AI_MAX_MS} waiting for it. A `repeat` or a `for each` written by mistake around
 *    an AI step would otherwise hold the engine for as long as the loop's own cap allows. The
 *    Rust side adds its own ceiling across every task (commands/ai_ops.rs, 30 per minute).
 *
 *  · **Untrusted results.** `ai.ask` and `ai.suggest_mod_metadata` produce FREE TEXT, built from
 *    things BMM does not control (a mod's readme, a file's words). That text is kept in a
 *    variable, and a variable can be substituted into any later step: `custom.command` with
 *    `{answer}` would run whatever a crafted readme talked the model into. So the variables
 *    those steps write are TAINTED, the taint follows copies (`var.set`, `text.extract`, a list,
 *    a map…), and a tainted variable is accepted only in the fields of {@link AI_TEXT_FIELDS}:
 *    a message, a log line, a file's content, a copy. Anywhere else (a program, a path, an
 *    address, a header, a condition that opens a file) the step is refused. `ai.classify` is not tainted: its answer is one of the labels the TASK gave, or
 *    `none` (commands/ai_ops.rs `constrain`), so "the model chose" can only ever mean "the model
 *    chose one of your own branches".
 *
 *  · **The `aiLabel` condition**: "the label is X with p ≥ t", read from what `ai.classify` left.
 */

export const AI_MAX_STEPS = 20;
export const AI_MAX_MS = 120_000;

/**
 * Where AI text MAY go: the parameters that only SHOW or STORE it. An allow-list, not a list of
 * dangerous steps: the first version listed the steps that run something and missed the ones
 * that open a file (`file.open` hands a path to the shell), write a backup to a chosen folder or
 * read a UNC path (review, Oct 1). A step or a field not named here refuses a tainted reference.
 */
export const AI_TEXT_FIELDS: Record<string, readonly string[]> = {
    'log.print': ['message', 'text'],
    'notify': ['message'],
    'file.write': ['text'],
    'data.validate': ['text'],
    'feed.publish': ['title', 'body'],
    'webhook.send': ['body'],
    'discord.send': ['message'],
    'slack.send': ['message'],
    'var.set': ['value'],
    'var.ternary': ['ifTrue', 'ifFalse'],
    'list.set': ['value'],
    'list.push': ['value'],
    'map.set': ['key', 'value'],
    'text.extract': ['source'],
    'ai.classify': ['text'],
    'ai.ask': ['question'],
};

/** Conditions that only COMPARE a value; any other refuses a tainted reference (a path, a URL…). */
export const AI_TEXT_CONDITIONS: Record<string, readonly string[]> = {
    textIs: ['source', 'value'],
    value: ['source', 'value'],
    enumIs: ['source', 'value'],
    aiLabel: ['var', 'label', 'min'],
};

/** The parameters of each AI step that name where a result goes. */
const OUTPUT_FIELDS = ['into', 'name', 'target', 'listName', 'mapName'];

type Ctx = object;
interface Budget { steps: number; ms: number }
const _budgets = new WeakMap<Ctx, Budget>();
const _taint = new WeakMap<Ctx, Set<string>>();

export function aiBudget(ctx: Ctx): Budget {
    let b = _budgets.get(ctx);
    if (!b) { b = { steps: 0, ms: 0 }; _budgets.set(ctx, b); }
    return b;
}

/** Take one AI step from the run's budget, or say why not ('steps' | 'time'). */
export function takeAiStep(ctx: Ctx): null | 'steps' | 'time' {
    const b = aiBudget(ctx);
    if (b.steps >= AI_MAX_STEPS) return 'steps';
    if (b.ms >= AI_MAX_MS) return 'time';
    b.steps++;
    return null;
}

export function chargeAiTime(ctx: Ctx, ms: number): void {
    const b = aiBudget(ctx);
    b.ms += Math.max(0, Number.isFinite(ms) ? ms : 0);
}

/** What is left, for a timeout: never more than the Rust side's own 30 s per call. */
export function aiTimeLeft(ctx: Ctx): number {
    return Math.max(0, Math.min(30_000, AI_MAX_MS - aiBudget(ctx).ms));
}

// ── Taint ───────────────────────────────────────────────────────────────────

function taintSet(ctx: Ctx): Set<string> {
    let s = _taint.get(ctx);
    if (!s) { s = new Set(); _taint.set(ctx, s); }
    return s;
}

export function taint(ctx: Ctx, ...names: string[]): void {
    const s = taintSet(ctx);
    for (const n of names) if (n) s.add(n);
}

/** A variable is written again by a clean step: it is clean again. */
export function untaint(ctx: Ctx, ...names: string[]): void {
    const s = taintSet(ctx);
    for (const n of names) s.delete(n);
}

export function isTainted(ctx: Ctx, name: string, shared: Iterable<string> = []): boolean {
    if (taintSet(ctx).has(name)) return true;
    for (const n of shared) if (n === name) return true;
    return false;
}

/** Every `{name}` a value refers to, in strings at any depth. */
export function refsIn(v: unknown, out: Set<string> = new Set()): Set<string> {
    if (typeof v === 'string') {
        for (const m of v.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g)) out.add(m[1]);
    } else if (Array.isArray(v)) {
        for (const x of v) refsIn(x, out);
    } else if (v && typeof v === 'object') {
        for (const x of Object.values(v as Record<string, unknown>)) refsIn(x, out);
    }
    return out;
}

/**
 * The parameter of this step that would carry AI text somewhere it acts, or null.
 * `params` are the RAW ones (before substitution): a reference is what is checked, never the
 * text, so a result that happens to look harmless is refused all the same.
 */
export function taintProblem(type: string, params: Record<string, unknown>, ctx: Ctx, shared: Iterable<string> = []): string | null {
    return fieldsProblem(AI_TEXT_FIELDS[type] || [], params, ctx, shared);
}

/** The same rule for a condition. `all` / `any` hold other conditions, each checked on its own. */
export function condTaintProblem(type: string, params: Record<string, unknown>, ctx: Ctx, shared: Iterable<string> = []): string | null {
    if (type === 'all' || type === 'any') return null;
    return fieldsProblem(AI_TEXT_CONDITIONS[type] || [], params, ctx, shared);
}

function fieldsProblem(allowed: readonly string[], params: Record<string, unknown>, ctx: Ctx, shared: Iterable<string>): string | null {
    const sharedList = [...shared];
    for (const [k, v] of Object.entries(params || {})) {
        if (allowed.includes(k)) continue;
        if ([...refsIn(v)].some((n) => isTainted(ctx, n, sharedList))) return k;
    }
    return null;
}

/**
 * After a step ran: when it READ a tainted variable, what it WROTE is tainted too (a copy of
 * AI text is AI text). Returns the names it tainted, for shared-variable bookkeeping.
 */
export function propagateTaint(params: Record<string, unknown>, ctx: Ctx, shared: Iterable<string> = []): string[] {
    const sharedList = [...shared];
    const read = [...refsIn(params)].some((n) => isTainted(ctx, n, sharedList));
    const outs = OUTPUT_FIELDS.map((k) => String((params || {})[k] ?? '').trim()).filter(Boolean);
    if (!read) { untaint(ctx, ...outs); return []; }
    taint(ctx, 'last.out', ...outs);
    return outs;
}

// ── Shared variables keep their taint across runs ──────────────────────────

const SHARED_TAINT_KEY = 'bmm.sched.vars.ai';

export function readSharedTaint(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem(SHARED_TAINT_KEY) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 500) : [];
    } catch { return []; }
}

export function writeSharedTaint(names: string[]): void {
    try { localStorage.setItem(SHARED_TAINT_KEY, JSON.stringify([...new Set(names)].slice(0, 500))); } catch { /* private mode */ }
}

// ── Labels and the condition ───────────────────────────────────────────────

/**
 * The labels a step offers, as typed: one per line `id: what it means`, or `a, b, c`.
 * Ids are trimmed, `none` is Laya's own answer and not a label, duplicates are dropped.
 */
export function parseLabels(raw: unknown): { id: string; what: string }[] {
    const text = String(raw ?? '');
    const parts = text.includes('\n') ? text.split(/\r?\n/) : text.split(',');
    const out: { id: string; what: string }[] = [];
    for (const part of parts) {
        const line = part.trim();
        if (!line) continue;
        const i = line.indexOf(':');
        const id = (i > 0 ? line.slice(0, i) : line).trim().slice(0, 64);
        const what = (i > 0 ? line.slice(i + 1) : '').trim().slice(0, 300);
        if (!id || id.toLowerCase() === 'none') continue;
        if (out.some((o) => o.id.toLowerCase() === id.toLowerCase())) continue;
        out.push({ id, what });
    }
    return out;
}

/** Where `ai.classify` left its answer: the step's `into`, else `ai.label` / `ai.p`. */
export function labelOf(ctx: { text: Record<string, string>; nums: Record<string, number> }, into = ''): { label: string; p: number } | null {
    const name = String(into || '').trim();
    const label = name ? ctx.text[name] : ctx.text['ai.label'];
    const p = name ? ctx.nums[`${name}.p`] : ctx.nums['ai.p'];
    if (typeof label !== 'string' || !label) return null;
    return { label, p: Number.isFinite(p) ? Number(p) : 0 };
}

/** `aiLabel`: the label is `want` (case-insensitive) and its probability is at least `min`. */
export function aiLabelHolds(ctx: { text: Record<string, string>; nums: Record<string, number> }, params: Record<string, unknown>): boolean {
    const got = labelOf(ctx, String(params.var ?? ''));
    if (!got) return false;
    const want = String(params.label ?? '').trim().toLowerCase();
    if (!want) return false;
    const raw = parseFloat(String(params.min ?? '0.5'));
    const min = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5;
    return got.label.toLowerCase() === want && got.p >= min;
}

/** An error code from commands/ai_ops.rs (`ai.task.blocked|game_mode`) as [key, reason]. */
export function aiErrorParts(e: unknown): [string, string] {
    const raw = String(e instanceof Error ? e.message : e ?? '');
    const [key, why = ''] = raw.split('|');
    return [key, why];
}
