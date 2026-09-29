// The "Test" button of a step — the part with no app in it.
//
// Every step can be run once, on its own, from the block editor or the flow's inspector. What
// that run is FOR is the answer: did it work, and what did the other end say. For a webhook that
// is the HTTP status and the first line of the reply; for anything else, whether it threw and
// what it left in `last.out`. This decides the verdict, and which steps are harmless enough to
// test without a question (tests/sched-test.test.mjs).

import type { RunCtx } from './sched-vars.js';

/** What the Test button shows. */
export interface TestOutcome { ok: boolean; status?: number; excerpt?: string; message: string }

/** Steps whose test only reads, computes or sends a message: tested without asking first. */
export const QUIET_TEST_ACTIONS: ReadonlySet<string> = new Set([
    'webhook.send', 'discord.send', 'slack.send', 'feed.publish', 'notify', 'log.print',
    'var.set', 'var.clear', 'math.set', 'var.ternary', 'rule.table', 'text.extract', 'data.validate',
    'list.set', 'list.push', 'list.clear', 'map.set', 'map.get', 'map.clear', 'id.of',
    'app.buildInfo', 'library.counts', 'perf.diskSpace', 'wait.http',
]);

/**
 * Does testing this step need a "this runs it for real" question first? Every action outside the
 * quiet list changes something (enables a mod, deletes a profile, starts a program), and a test
 * button that silently did that would be a trap. Control steps (if, loop…) run their whole body.
 */
export function testNeedsConfirm(step: { kind?: string; action?: { type?: string; params?: Record<string, unknown> } } | null | undefined): boolean {
    if (!step) return false;
    if (step.kind === 'delay' || step.kind === 'break' || step.kind === 'continue' || step.kind === 'stop') return false;
    if (step.kind !== 'action') return true;
    const type = String(step.action?.type || '');
    if (type === 'http.request') return String(step.action?.params?.method || 'GET').toUpperCase() !== 'GET';
    return !QUIET_TEST_ACTIONS.has(type);
}

/** One line of what came back, for a chip: whitespace folded, cut at `max`. */
export function excerptOf(text: unknown, max = 160): string {
    const one = String(text ?? '').replace(/\s+/g, ' ').trim();
    return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * The verdict of a one-step test, from what the run left in its context and whether it threw.
 * `words` supplies the translated sentences so this stays free of i18n.
 */
export function testOutcome(ctx: RunCtx, err: unknown, words: { ok: string; fail: string; stopped: string },
    isStop: (e: unknown) => boolean = (e) => (e as any)?.constructor?.name === '_StopTask'): TestOutcome {
    const status = typeof ctx?.nums?.['http.status'] === 'number' ? ctx.nums['http.status'] : undefined;
    const out = ctx?.text?.['http.body'] ?? ctx?.text?.['last.out'] ?? ctx?.text?.['log.last'] ?? ctx?.text?.['feed.file'] ?? '';
    const excerpt = excerptOf(out) || undefined;
    if (err === undefined || err === null) return { ok: true, status: status || undefined, excerpt, message: words.ok };
    if (isStop(err)) return { ok: true, status: status || undefined, excerpt, message: words.stopped };
    const msg = err instanceof Error ? (err.message || err.name) : String(err);
    return { ok: false, status: status || undefined, excerpt, message: `${words.fail} — ${excerptOf(msg, 300)}` };
}
