// A regular expression somebody else wrote, run with a time limit.
//
// Three scheduler features take a pattern typed into a task: `text.extract`, the `fileContains`
// condition with "regex" ticked, and `textIs … matches`. They ran it with `new RegExp(p).test()`
// on the UI thread. JavaScript regexes backtrack, and a pattern such as `(a+)+$` against a long
// line of `a`s runs for minutes — a frozen BMM, from a task that may have arrived in a catalogue
// (security pass, Sept 2026). There is no way to interrupt a regex on the thread running it.
//
// So the pattern runs in a WORKER, and the worker is terminated when the budget is spent. The
// answer is then "timeout", which the step reports; the UI never stops. One worker is kept warm
// and reused (starting one per condition, on a trigger polled every twenty seconds, would cost
// more than the regex); requests are queued so each reply meets its question. When workers are
// unavailable, a pattern with a nested quantifier is refused outright rather than risked.
//
// `regexProblem` is the static half: the editors use it to say, while the pattern is typed,
// that it is invalid or of the shape that backtracks catastrophically.

import { runRegexOp, REGEX_BUDGET_MS, type RegexReq, type RegexResult } from './regex-op.js';
export { runRegexOp, REGEX_BUDGET_MS, REGEX_MAX_HAY, type RegexReq, type RegexResult } from './regex-op.js';

/**
 * Invalid, or shaped to backtrack catastrophically: a quantified group that itself contains a
 * quantifier — `(a+)+`, `(\w*)*`, `(x+|y)+{2,}` — the family behind nearly every real ReDoS.
 * A heuristic, used to WARN while typing; the worker's budget is what actually protects.
 */
export function regexProblem(pattern: string): 'invalid' | 'nested' | null {
    const p = String(pattern ?? '');
    if (!p) return null;
    try { new RegExp(p); } catch { return 'invalid'; }
    // Strip escapes and character classes, whose `+` and `*` are literal.
    const bare = p.replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, 'x');
    const stack: boolean[] = [];
    for (let i = 0; i < bare.length; i++) {
        const c = bare[i];
        if (c === '(') stack.push(false);
        else if (c === ')') {
            const inner = stack.pop() ?? false;
            const after = bare.slice(i + 1, i + 3);
            const outer = /^(?:[+*]|\{\d*,)/.test(after);
            if (inner && outer) return 'nested';
            if (stack.length && (inner || outer)) stack[stack.length - 1] = true;
        } else if ((c === '+' || c === '*' || (c === '{' && /^\{\d*,\d*\}/.test(bare.slice(i)))) && stack.length) {
            stack[stack.length - 1] = true;
        }
    }
    return null;
}

/** The part of a Worker this needs, so a test can hand in Node's worker_threads. */
export interface WorkerLike {
    postMessage(msg: unknown): void;
    onmessage: ((e: { data: any }) => void) | null;
    terminate(): void;
}

/**
 * A runner with a budget. `spawn` makes a worker that answers each request with `runRegexOp`;
 * a worker that has not answered within `budgetMs` is terminated and the next request gets a
 * fresh one.
 */
export function makeBudgetRunner(spawn: () => WorkerLike, budgetMs = REGEX_BUDGET_MS): (req: RegexReq) => Promise<RegexResult> {
    let worker: WorkerLike | null = null;
    let queue: Promise<unknown> = Promise.resolve();
    const one = (req: RegexReq): Promise<RegexResult> => new Promise((resolve) => {
        if (!worker) worker = spawn();
        const w = worker;
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            try { w.terminate(); } catch { /* already gone */ }
            if (worker === w) worker = null;
            resolve({ ok: false, error: 'timeout' });
        }, budgetMs);
        w.onmessage = (e) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(e.data as RegexResult);
        };
        w.postMessage(req);
    });
    return (req) => {
        const run = queue.then(() => one(req), () => one(req));
        queue = run;
        return run;
    };
}

let _runner: ((req: RegexReq) => Promise<RegexResult>) | null = null;

/** Run a pattern in the regex worker, within the budget. */
export async function regexWithBudget(req: RegexReq): Promise<RegexResult> {
    if (!_runner) {
        try {
            const W = (globalThis as any).Worker;
            if (typeof W !== 'function') throw new Error('no worker');
            const url = new URL('./regex-worker.js', import.meta.url);
            _runner = makeBudgetRunner(() => new W(url, { type: 'module' }) as WorkerLike);
        } catch {
            // No worker at all: refuse the dangerous shape, run the rest here.
            _runner = async (r) => (regexProblem(r.pattern) === 'nested' ? { ok: false, error: 'timeout' } : runRegexOp(r));
        }
    }
    return _runner(req);
}
