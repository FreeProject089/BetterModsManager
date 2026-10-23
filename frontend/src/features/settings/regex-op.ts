// Running one pattern, synchronously — what the regex worker does (regex-worker.ts), and never
// what the UI thread does (regex-budget.ts runs it through the worker, with a time budget).
// Its own module so the worker and the budget both import it without importing each other.

export interface RegexReq {
    op: 'test' | 'last';
    pattern: string;
    flags: string;
    hay: string;
    /** For `last`: which group to return (1 by default, 0 = the whole match). */
    group?: number;
}
export type RegexResult = { ok: true; hit: boolean; value: string } | { ok: false; error: 'invalid' | 'timeout' };

/** How long a pattern may run. Generous for a real log tail, instant for a person. */
export const REGEX_BUDGET_MS = 750;
/** The most text a pattern is run against: the tail a step reads is 64 KB by default. */
export const REGEX_MAX_HAY = 1 << 20;

/** Run one request, synchronously. What the worker does — and never called on the UI thread. */
export function runRegexOp(req: RegexReq): RegexResult {
    let re: RegExp;
    const flags = String(req.flags || '').replace(/[^gimsuy]/g, '');
    try { re = new RegExp(String(req.pattern || ''), req.op === 'last' && !flags.includes('g') ? flags + 'g' : flags); } catch { return { ok: false, error: 'invalid' }; }
    const hay = String(req.hay ?? '').slice(-REGEX_MAX_HAY);
    if (req.op === 'test') return { ok: true, hit: re.test(hay), value: '' };
    let m: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    while ((m = re.exec(hay)) !== null) {
        last = m;
        if (m.index === re.lastIndex) re.lastIndex += 1; // a zero-width match
    }
    if (!last) return { ok: true, hit: false, value: '' };
    const g = req.group === undefined ? 1 : Number(req.group);
    return { ok: true, hit: true, value: String(last[g] ?? last[0] ?? '') };
}
