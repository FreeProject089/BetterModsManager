// The run record a scheduled task writes to its log (PLAN-BMM-RESOURCES-2026.md §5.1, A1).
//
// Pure: no Tauri, no DOM, so the rules are tests. scheduler.ts builds one record per run and
// sends it to `sched_run_append` (src-tauri/src/commands/sched_runs.rs), which stores it as one
// line of <app-data>/TaskRuns/<id>.jsonl, capped at 50 runs / 2 MB.
//
// What goes in: when, what triggered it, how it ended, and each ACTION step (label, path in the
// tree, start, duration, status, error). Actions are where a run touches the world and where it
// fails; recording every delay and branch would bury them.
//
// What never goes in: secrets. The labels are the editor's own summaries, but an error message
// can quote a URL with a token in its query, an Authorization header, a password argument. So
// every string is passed through `redact` first, with the same intent as the .bmmpa export: a
// log is something people paste into a bug report.

export type StepStatus = 'ok' | 'error' | 'stopped' | 'cancelled';

export interface RunStep {
    label: string;
    depth: number;
    at: number;
    ms: number;
    status: StepStatus;
    error?: string;
}

export interface RunRecord {
    id: string;
    task: string;
    trigger: string;
    at: number;
    ms: number;
    result: string;
    ok: boolean;
    steps: RunStep[];
}

/** At most this many steps per record: a loop of 10 000 iterations is a summary, not a log. */
export const MAX_STEPS = 200;
const MAX_TEXT = 500;

const RULES: [RegExp, string][] = [
    // Header or query forms: Authorization: Bearer xxx, token=xxx, api_key: xxx, password=xxx
    [/\b(authorization|proxy-authorization)\s*[:=]\s*[^\s,;]+(\s+[^\s,;]+)?/gi, '$1: [redacted]'],
    [/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
    [/\b(token|access_token|api[_-]?key|apikey|secret|password|passwd|pwd|key|sig|signature|auth)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s&,;]+)/gi, '$1=[redacted]'],
    // Credentials inside a URL: https://user:pass@host
    [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@'],
    // A query string may carry anything: keep the path, drop the query.
    [/(\bhttps?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[redacted]'],
    // Long opaque strings (keys, JWTs, hashes pasted by mistake).
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '[redacted-jwt]'],
    [/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]'],
];

/** Remove what looks like a secret, and cap the length. */
export function redact(text: unknown): string {
    let s = String(text ?? '');
    for (const [re, to] of RULES) s = s.replace(re, to);
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '…' : s;
}

export function newRun(taskId: string, trigger: string, now = Date.now()): RunRecord {
    return { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, task: taskId, trigger: redact(trigger).slice(0, 60), at: now, ms: 0, result: '', ok: false, steps: [] };
}

/** Start a step; returns it so the caller can close it, or null past the cap. */
export function startStep(run: RunRecord, label: string, depth: number, now = Date.now()): RunStep | null {
    if (run.steps.length >= MAX_STEPS) return null;
    const step: RunStep = { label: redact(label).slice(0, 120), depth, at: now, ms: 0, status: 'ok' };
    run.steps.push(step);
    return step;
}

export function endStep(step: RunStep | null, status: StepStatus, error?: unknown, now = Date.now()): void {
    if (!step) return;
    step.ms = Math.max(0, now - step.at);
    step.status = status;
    if (error !== undefined && status !== 'ok') step.error = redact(error instanceof Error ? error.message : error);
}

export function finishRun(run: RunRecord, result: string, now = Date.now()): RunRecord {
    run.ms = Math.max(0, now - run.at);
    run.result = redact(result);
    run.ok = result === 'ok';
    return run;
}
