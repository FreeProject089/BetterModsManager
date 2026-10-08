// laya-crash-events.ts — what BMM says when Laya has labelled crashes.
//
// Two events on the scheduler's hook ring (core/bmm-events.ts), rung from BOTH places that label
// crashes — « Trouver les causes » in « Rapports de crash & sessions » and the scheduled step
// `ai.crash_label` — so a task can react without labelling anything itself:
//
//  · `bmm.ai.crashLabelled`, once per report Laya labelled for the first time (a label served
//    from the cache is not news), carrying { report, family, cause, p, abstained, uncertain };
//  · `bmm.ai.crashGroup`, once per crash whose failure matches no group BMM remembers
//    (laya-assist-model.ts `newCrashGroups`), carrying the same fields.
//
// What an event carries is the fixed taxonomy (`ai_assist::CRASH_CAUSES`) and the report's own
// file name: never the excerpt, never a word of the model's.

import { fireEvent } from '../../core/bmm-events.js';
import { newCrashGroups } from './laya-assist-model.js';

/** One labelled crash, as `ai_task_crash_label` (or the page) has it. */
export interface CrashLabelled {
    report: string;
    family: string;
    cause: string;
    p: number;
    abstained: boolean;
    uncertain: boolean;
    cached?: boolean;
    reason?: string;
    excerpt?: string;
}

const SEEN_KEY = 'bmm.ai.crashGroups';

function readSeen(): string[][] {
    try {
        const v = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
        return Array.isArray(v) ? v.filter((x) => Array.isArray(x)).slice(0, 100) : [];
    } catch { return []; }
}

function writeSeen(seen: string[][]): void {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* private mode: nothing remembered */ }
}

/** What an event says about one crash. */
export function crashEventData(it: CrashLabelled): Record<string, unknown> {
    return {
        report: String(it.report || '').slice(0, 120),
        family: String(it.family || 'unknown'),
        cause: String(it.cause || 'unknown'),
        p: Math.round((Number(it.p) || 0) * 100) / 100,
        abstained: !!it.abstained,
        uncertain: !!it.uncertain,
    };
}

/**
 * Ring the two events for these labels. Returns how many new groups there were (the step
 * writes it to `ai.crash.groups`). Never throws: an event must not fail what it describes.
 */
export function announceCrashLabels(items: readonly CrashLabelled[]): number {
    try {
        const list = Array.isArray(items) ? items : [];
        for (const it of list) if (!it.cached) fireEvent('bmm.ai.crashLabelled', crashEventData(it));
        const g = newCrashGroups(readSeen(), list);
        if (g.fresh.length) writeSeen(g.seen);
        for (const i of g.fresh) fireEvent('bmm.ai.crashGroup', crashEventData(list[i]));
        return g.fresh.length;
    } catch { return 0; }
}
