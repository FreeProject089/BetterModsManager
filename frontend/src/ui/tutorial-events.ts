// @ts-nocheck
/**
 * tutorial-events.ts — Lightweight event bus for BMM tutorial action detection.
 *
 * Feature modules (profiles, mods, etc.) call dispatchBmmAction() after
 * completing user actions. The tutorial engine listens for these to advance
 * action-gated steps automatically.
 *
 * How to add a new action:
 *   1. Call dispatchBmmAction('bmm:action:my-event', optionalData) from the feature module.
 *   2. Reference the event string in the TutorialStep.action.event field.
 */

/**
 * Dispatches a BMM tutorial action event on document.
 * Feature modules call this after completing significant user actions.
 *
 * @param eventName - e.g. 'bmm:action:profile-created'
 * @param detail    - optional payload for the event
 */
export function dispatchBmmAction(eventName: string, detail: Record<string, unknown> = {}): void {
    document.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: false }));
}

/**
 * Subscribes to a BMM tutorial action. Returns an unsubscribe function.
 * The tutorial engine uses this to wait for action completion.
 */
export function onBmmAction(eventName: string, handler: (detail: unknown) => void): () => void {
    const listener = (e: CustomEvent) => handler(e.detail);
    document.addEventListener(eventName, listener);
    return () => document.removeEventListener(eventName, listener);
}

// ── Known action event names (for reference — not enforced) ─────────────────
export const BMM_ACTIONS = {
    PROFILE_CREATED: 'bmm:action:profile-created',
    PROFILE_EDITED:  'bmm:action:profile-edited',
    MOD_ADDED:       'bmm:action:mod-added',
    MOD_ACTIVATED:   'bmm:action:mod-activated',
    MOD_DEACTIVATED: 'bmm:action:mod-deactivated',
    MODS_SCANNED:    'bmm:action:mods-scanned',
    MODPACK_CREATED: 'bmm:action:modpack-created',
    MODPACK_APPLIED: 'bmm:action:modpack-applied',
    INTEGRITY_CHECK: 'bmm:action:integrity-checked',
    MODLIST_IMPORTED:'bmm:action:modlist-imported',
    MODLIST_EXPORTED:'bmm:action:modlist-exported',
    MAPPER_OPENED:     'bmm:action:mapper-opened',
    PLUGIN_INSTALLED:  'bmm:action:plugin-installed',
    SCRIPT_GENERATED:  'bmm:action:script-generated',
    API_TOKEN_COPIED:  'bmm:action:api-token-copied',
} as const;
