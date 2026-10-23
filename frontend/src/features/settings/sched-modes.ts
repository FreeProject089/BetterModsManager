// Which of the three editors a task opens in — the preference, and the one question that sets it.
//
// A task can be edited as a flow of nodes, as BMMScript text, or as blocks. All three edit the
// SAME step tree (scheduler.ts), so the choice is only about how somebody prefers to see it —
// and nobody could make it: the editor opened on Blocks, the switch sat in a corner, and the
// mode used last was remembered silently. So the first time somebody creates a task, they are
// asked, once, with the three explained in a line each; the answer is a setting like any other
// (Settings → Planning → "Tasks open in", and every switch of the mode updates it).
//
// Pure on purpose (localStorage is passed in), like sched-why.ts: the rules are tests.

export type EditorMode = 'bricks' | 'code' | 'flow';

/** Where the preference lives. The key predates this file; kept so nobody's choice is lost. */
export const MODE_KEY = 'bmm.sched.editorMode';
/** Set once the question has been answered (or the setting changed by hand). */
export const MODE_ASKED_KEY = 'bmm.sched.editorModeAsked';

/**
 * The three choices, in the order they are offered. Flux first and marked recommended: it
 * shows the whole task at once, branches side by side, and it is where the debugger and the
 * Test button are the most visual. The keys are i18n keys; the values the stored modes.
 */
export const MODE_CHOICES: readonly { mode: EditorMode; titleKey: string; descKey: string; recommended: boolean }[] = [
    { mode: 'flow', titleKey: 'sched.modes.flow', descKey: 'sched.modes.flowDesc', recommended: true },
    { mode: 'code', titleKey: 'sched.modes.code', descKey: 'sched.modes.codeDesc', recommended: false },
    { mode: 'bricks', titleKey: 'sched.modes.bricks', descKey: 'sched.modes.bricksDesc', recommended: false },
];

/** The smallest slice of Storage this needs, so a test can hand in a Map. */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function isMode(v: unknown): v is EditorMode {
    return v === 'bricks' || v === 'code' || v === 'flow';
}

/** The stored mode, or Blocks when there is none (what every task opened in before). */
export function readMode(store: KV | null | undefined): EditorMode {
    try {
        const v = store?.getItem(MODE_KEY);
        return isMode(v) ? v : 'bricks';
    } catch { return 'bricks'; }
}

/**
 * Remember a mode. `chosen` marks the question as answered: the prompt, the Settings select
 * and the mode switch in the editor all count as somebody saying what they want.
 */
export function writeMode(store: KV | null | undefined, m: EditorMode, chosen = true): void {
    if (!isMode(m)) return;
    try {
        store?.setItem(MODE_KEY, m);
        if (chosen) store?.setItem(MODE_ASKED_KEY, '1');
    } catch { /* private mode or quota: a preference, nothing is lost */ }
}

/**
 * Should creating THIS task ask the question first?
 *
 * Only for a NEW task, only when the question was never answered, and only for somebody who
 * has no tasks yet — "the very first time". A person with twenty tasks has been using the
 * editor already; interrupting them with an onboarding question would be noise. They can
 * still change it in Settings or with the switch.
 */
export function needsModePrompt(store: KV | null | undefined, opts: { isNew: boolean; taskCount: number }): boolean {
    if (!opts.isNew) return false;
    let asked: string | null = null;
    try { asked = store?.getItem(MODE_ASKED_KEY) ?? null; } catch { asked = '1'; }
    if (asked === '1') return false;
    return opts.taskCount === 0;
}
