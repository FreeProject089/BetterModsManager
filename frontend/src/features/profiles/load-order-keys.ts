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
