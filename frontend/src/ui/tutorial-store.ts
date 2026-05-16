// @ts-nocheck
/**
 * tutorial-store.ts — localStorage-backed progress persistence for tutorials.
 *
 * All progress is stored under the key "bmm-tutorial-progress" in localStorage.
 * No backend changes are required.
 */

import type { TutorialProgressStore, TutorialProgressRecord, StepStatus, StepState } from './tutorial-types.js';

const STORAGE_KEY = 'bmm-tutorial-progress';

function load(): TutorialProgressStore {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function save(store: TutorialProgressStore): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch { /* quota or private mode */ }
}

function getRecord(tutorialId: string): TutorialProgressRecord {
    const store = load();
    return store[tutorialId] ?? { last_part_id: null, last_step_id: null, steps: {} };
}

function setRecord(tutorialId: string, record: TutorialProgressRecord): void {
    const store = load();
    store[tutorialId] = record;
    save(store);
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Returns the last position the user was at for a given tutorial. */
export function getLastPosition(tutorialId: string): { partId: string | null; stepId: string | null } {
    const r = getRecord(tutorialId);
    return { partId: r.last_part_id, stepId: r.last_step_id };
}

/** Saves the current position (called on every step transition). */
export function savePosition(tutorialId: string, partId: string, stepId: string): void {
    const r = getRecord(tutorialId);
    r.last_part_id = partId;
    r.last_step_id = stepId;
    setRecord(tutorialId, r);
}

/** Returns the status of a specific step. */
export function getStepStatus(tutorialId: string, partId: string, stepId: string): StepStatus {
    const r = getRecord(tutorialId);
    return r.steps[`${partId}:${stepId}`] ?? { state: 'pending' };
}

/** Updates the status of a specific step. */
export function setStepStatus(tutorialId: string, partId: string, stepId: string, status: StepStatus): void {
    const r = getRecord(tutorialId);
    r.steps[`${partId}:${stepId}`] = status;
    setRecord(tutorialId, r);
}

/** Shorthand to mark a step as complete. */
export function markStepComplete(tutorialId: string, partId: string, stepId: string): void {
    setStepStatus(tutorialId, partId, stepId, { state: 'complete' });
}

/** Shorthand to mark a step as partially done (action step seen but not completed). */
export function markStepPartial(tutorialId: string, partId: string, stepId: string): void {
    const current = getStepStatus(tutorialId, partId, stepId);
    if (current.state !== 'complete') {
        setStepStatus(tutorialId, partId, stepId, { state: 'partial' });
    }
}

/** Returns all step statuses for a tutorial (for hub display). */
export function getAllStepStatuses(tutorialId: string): Record<string, StepStatus> {
    return getRecord(tutorialId).steps;
}

/** Counts completed vs total steps for a given tutorial. */
export function getTutorialCompletion(tutorialId: string, totalSteps: string[]): { done: number; total: number } {
    const r = getRecord(tutorialId);
    const done = totalSteps.filter(key => r.steps[key]?.state === 'complete').length;
    return { done, total: totalSteps.length };
}

/** Resets all progress for a tutorial. */
export function resetTutorial(tutorialId: string): void {
    const store = load();
    delete store[tutorialId];
    save(store);
}

/** Returns true if every step in stepKeys is 'complete'. */
export function isTutorialComplete(tutorialId: string, stepKeys: string[]): boolean {
    const r = getRecord(tutorialId);
    return stepKeys.every(k => r.steps[k]?.state === 'complete');
}
