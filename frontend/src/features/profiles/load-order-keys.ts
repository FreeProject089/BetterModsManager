// The keyboard of the activation-order view — as data, registered in the ONE command registry
// (core/commands.ts), the way the scheduler's flow keys are (sched-flow-keys.ts).
//
// Each shortcut is a command: it is listed and rebindable in Settings → Keyboard shortcuts and
// findable in Ctrl+K, and the global dispatcher runs it. They are scoped by `when` to "the order
// view is open", so Alt+↑ means "move this mod up" there and nothing anywhere else.
//
// Import-free on purpose: commands.ts registers the list at boot, and the view itself is loaded
// only when somebody opens it. load-order.ts binds the handlers when it mounts.

export interface OrderChord { ctrl?: boolean; shift?: boolean; alt?: boolean; key: string }

export interface OrderKey {
    id: string;
    title: { en: string; fr: string };
    keywords: string;
    chord: OrderChord | null;
}

export const ORDER_KEYS: OrderKey[] = [
    { id: 'order.moveUp', chord: { alt: true, key: 'arrowup' }, keywords: 'move up earlier before monter avant',
        title: { en: 'Activation order: move the selected mod up (applied earlier)', fr: 'Ordre d’activation : monter le mod sélectionné (appliqué plus tôt)' } },
    { id: 'order.moveDown', chord: { alt: true, key: 'arrowdown' }, keywords: 'move down later after wins descendre après gagne',
        title: { en: 'Activation order: move the selected mod down (applied later, wins)', fr: 'Ordre d’activation : descendre le mod sélectionné (appliqué plus tard, gagne)' } },
    { id: 'order.moveTop', chord: { alt: true, key: 'home' }, keywords: 'top first début premier',
        title: { en: 'Activation order: move the selected mod to the top', fr: 'Ordre d’activation : mettre le mod sélectionné en haut' } },
    { id: 'order.moveBottom', chord: { alt: true, key: 'end' }, keywords: 'bottom last wins fin dernier gagne',
        title: { en: 'Activation order: move the selected mod to the bottom (it wins)', fr: 'Ordre d’activation : mettre le mod sélectionné en bas (il gagne)' } },
    { id: 'order.apply', chord: { ctrl: true, key: 'enter' }, keywords: 'apply save deploy appliquer enregistrer déployer',
        title: { en: 'Activation order: apply the new order', fr: 'Ordre d’activation : appliquer le nouvel ordre' } },
];

const _handlers = new Map<string, () => void>();
let _active: () => boolean = () => false;

/** Called by the view when it mounts: what each command does, and whether the view is open. */
export function bindOrderKeys(handlers: Record<string, () => void>, active: () => boolean): void {
    for (const [id, fn] of Object.entries(handlers)) _handlers.set(id, fn);
    _active = active;
}

export function orderKeysActive(): boolean {
    try { return _active(); } catch { return false; }
}

export function orderKeyRun(id: string): void {
    const fn = _handlers.get(id);
    if (fn) fn();
}

// The same four moves from the Mod Library: they act on the SELECTED mod of the library, apply at
// once (no draft: the library is not an editor), and are scoped to "the library is on screen, a
// mod is selected, the order view is closed". Same default chords as in the view: the two scopes
// never hold at the same time, so Alt+↑ means one thing wherever you are.
export const LIB_ORDER_KEYS: OrderKey[] = [
    { id: 'library.order.moveUp', chord: { alt: true, key: 'arrowup' }, keywords: 'library move up earlier bibliothèque monter',
        title: { en: 'Library: move the selected mod up in the activation order', fr: 'Bibliothèque : monter le mod sélectionné dans l’ordre d’activation' } },
    { id: 'library.order.moveDown', chord: { alt: true, key: 'arrowdown' }, keywords: 'library move down later wins bibliothèque descendre gagne',
        title: { en: 'Library: move the selected mod down (it wins)', fr: 'Bibliothèque : descendre le mod sélectionné (il gagne)' } },
    { id: 'library.order.moveTop', chord: { alt: true, key: 'home' }, keywords: 'library top first bibliothèque haut premier',
        title: { en: 'Library: put the selected mod first in the order', fr: 'Bibliothèque : mettre le mod sélectionné en haut de l’ordre' } },
    { id: 'library.order.moveBottom', chord: { alt: true, key: 'end' }, keywords: 'library bottom last wins bibliothèque bas dernier gagne',
        title: { en: 'Library: put the selected mod last in the order (it wins)', fr: 'Bibliothèque : mettre le mod sélectionné en bas de l’ordre (il gagne)' } },
];

const _libHandlers = new Map<string, () => void>();
let _libActive: () => boolean = () => false;

/** Called by features/mods/lib-order.ts when the library mounts. */
export function bindLibOrderKeys(handlers: Record<string, () => void>, active: () => boolean): void {
    for (const [id, fn] of Object.entries(handlers)) _libHandlers.set(id, fn);
    _libActive = active;
}

/** Never while the order view is open: there, the same chords edit the view's draft. */
export function libOrderKeysActive(): boolean {
    if (orderKeysActive()) return false;
    try { return _libActive(); } catch { return false; }
}

export function libOrderKeyRun(id: string): void {
    const fn = _libHandlers.get(id);
    if (fn) fn();
}
