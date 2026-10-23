// The tutorial creator's rules, without the creator.
//
// What makes a document unsaveable, what makes a step suspicious, and how a step moves in its
// list — pure functions over the stored document, so the node tests can run them and the
// creator only renders their answers. Import-light (the expression parser and the selector
// rules), on purpose.

import { checkCondition } from './tutorial-expr.js';
import { selectorSyntaxOk } from './tutorial-target.js';
import type { CustomTutorialDoc } from './tutorial-custom.js';

export type IssueCode =
    | 'noTitle'        // the tutorial has no English title (blocks Save)
    | 'badId'          // the id cannot name a file (blocks Save)
    | 'emptyStep'      // a step with neither a title nor a text
    | 'badSelector'    // the highlight target does not parse as a selector
    | 'waitNoTarget'   // a wait that watches an element names none
    | 'badWaitTarget'  // …or names one that does not parse
    | 'badExpr'        // a custom condition that does not parse
    | 'noAction';      // "wait for an announced action" with no action chosen

export interface Issue { code: IssueCode; part: number; step: number; blocking: boolean; detail?: string }

const NEEDS_TARGET = new Set(['click', 'appear', 'disappear', 'text', 'value', 'enabled']);

/** The same rule as the backend's checked_id: 1..64 of a-z A-Z 0-9 - _. */
export const idOk = (id: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(id.trim());

/** Every problem in a document. `part`/`step` are -1 for document-level ones. */
export function validateDoc(doc: CustomTutorialDoc): Issue[] {
    const out: Issue[] = [];
    if (!(doc.title?.en || '').trim()) out.push({ code: 'noTitle', part: -1, step: -1, blocking: true });
    if (!idOk(doc.id || '')) out.push({ code: 'badId', part: -1, step: -1, blocking: true });
    doc.parts.forEach((p, pi) => p.steps.forEach((st, si) => {
        const add = (code: IssueCode, detail?: string) => out.push({ code, part: pi, step: si, blocking: false, detail });
        if (!(st.title?.en || '').trim() && !(st.text?.en || '').trim()) add('emptyStep');
        if (st.selector && !selectorSyntaxOk(st.selector)) add('badSelector', st.selector);
        const w = st.wait;
        if (w && NEEDS_TARGET.has(w.kind)) {
            if (!w.selector?.trim()) add('waitNoTarget');
            else if (!selectorSyntaxOk(w.selector)) add('badWaitTarget', w.selector);
        }
        if (w?.kind === 'custom') {
            const r = checkCondition(w.expr || '');
            if (!r.ok) add('badExpr', r.error);
        }
        if (w?.kind === 'action' && !w.event) add('noAction');
    }));
    return out;
}

/** The issues of one step. */
export const issuesOf = (issues: Issue[], part: number, step: number): Issue[] =>
    issues.filter((i) => i.part === part && i.step === step);

/** Move one item of `list` from `from` to `to` (both clamped), in place. Returns the index it
 *  landed on — the creator keeps that step selected. */
export function moveItem<T>(list: T[], from: number, to: number): number {
    if (from < 0 || from >= list.length) return from;
    const dest = Math.max(0, Math.min(list.length - 1, to));
    if (dest === from) return from;
    const [it] = list.splice(from, 1);
    list.splice(dest, 0, it);
    return dest;
}

/** A step id not yet used in the part: step-N, the smallest free N. Ids are the progress keys,
 *  so a duplicate would share one tick between two steps. */
export function freeStepId(existing: string[], prefix = 'step'): string {
    const taken = new Set(existing);
    for (let n = existing.length + 1; ; n++) if (!taken.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

/** Whether `text` is a plausible .bmmtut document (the backend checks the rest on Save). */
export function parseBmmtut(text: string): CustomTutorialDoc | null {
    let v: unknown;
    try { v = JSON.parse(text); } catch { return null; }
    const d = v as CustomTutorialDoc;
    if (!d || d.format !== 'bmmtut' || !Array.isArray(d.parts) || !d.parts.length) return null;
    if (!d.parts.every((p) => Array.isArray(p.steps) && p.steps.length)) return null;
    if (!d.title || typeof d.title.en !== 'string') d.title = { en: String(d.id || '') };
    return d;
}

// ── the hub's two pure answers ──────────────────────────────────────────────────────────────

export type LessonStatus = 'new' | 'progress' | 'done';

/** One of three, from the step counts and whether a position was ever saved. Pure. */
export function lessonStatus(done: number, total: number, hasPosition: boolean): LessonStatus {
    if (total > 0 && done >= total) return 'done';
    return done > 0 || hasPosition ? 'progress' : 'new';
}

/** Whether `hay` contains every word of `query` (case- and accent-insensitive). Pure. */
export function matchesQuery(hay: string, query: string): boolean {
    // NFD splits "é" into "e" + a combining mark; \p{M} drops the marks.
    const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const h = fold(hay);
    return fold(query).split(/\s+/).filter(Boolean).every((w) => h.includes(w));
}
