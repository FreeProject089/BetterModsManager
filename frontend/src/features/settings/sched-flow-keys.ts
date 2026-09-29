// The keyboard of the scheduler's editor — as data, registered in the ONE command registry.
//
// Every shortcut of the flow mode (and the three mode switches) is a command in
// core/commands.ts: it shows in Ctrl+K, it is listed and rebindable in Settings → Keyboard
// shortcuts, and the global dispatcher runs it. None is a private keydown handler, because a
// shortcut that is not in the registry cannot be found, cannot be rebound and silently
// collides with the ones that are.
//
// This file is data plus two small switches and imports nothing that touches the DOM at load,
// so commands.ts can register the list at boot without pulling the flow editor into the boot
// path. sched-flow.ts binds the handlers when it mounts; until then the commands are inert and
// hidden (their `when` is false).

/** Same shape as core/commands.ts `Chord`, repeated here so this file stays import-free. */
export interface FlowChord { ctrl?: boolean; shift?: boolean; alt?: boolean; key: string }

/**
 * `flow`: only while the flow canvas has the focus (or nothing else does).
 * `editor`: while the task editor is open, whichever of its three modes is showing.
 * `debug`: while a debug run is going (the panel's Step / Continue / Stop).
 */
export type FlowScope = 'flow' | 'editor' | 'debug';

export interface FlowKey {
    id: string;
    title: { en: string; fr: string };
    keywords: string;
    chord: FlowChord | null;
    scope: FlowScope;
}

export const FLOW_KEYS: FlowKey[] = [
    { id: 'sched.flow.addNode', scope: 'flow', chord: { key: '/' }, keywords: 'add node step insert palette search plus ajouter nœud étape insérer',
        title: { en: 'Flow: add a node…', fr: 'Flux : ajouter un nœud…' } },
    { id: 'sched.flow.edit', scope: 'flow', chord: { key: 'enter' }, keywords: 'edit inspect open node modifier inspecter ouvrir',
        title: { en: 'Flow: edit the selected node', fr: 'Flux : modifier le nœud sélectionné' } },
    { id: 'sched.flow.delete', scope: 'flow', chord: { key: 'delete' }, keywords: 'delete remove node supprimer effacer nœud',
        title: { en: 'Flow: delete the selection', fr: 'Flux : supprimer la sélection' } },
    { id: 'sched.flow.duplicate', scope: 'flow', chord: { ctrl: true, key: 'd' }, keywords: 'duplicate copy clone dupliquer copier',
        title: { en: 'Flow: duplicate the selection', fr: 'Flux : dupliquer la sélection' } },
    { id: 'sched.flow.undo', scope: 'flow', chord: { ctrl: true, key: 'z' }, keywords: 'undo back annuler',
        title: { en: 'Flow: undo', fr: 'Flux : annuler' } },
    { id: 'sched.flow.redo', scope: 'flow', chord: { ctrl: true, shift: true, key: 'z' }, keywords: 'redo again rétablir refaire',
        title: { en: 'Flow: redo', fr: 'Flux : rétablir' } },
    { id: 'sched.flow.selectAll', scope: 'flow', chord: { ctrl: true, key: 'a' }, keywords: 'select all tout sélectionner',
        title: { en: 'Flow: select every step', fr: 'Flux : sélectionner toutes les étapes' } },
    { id: 'sched.flow.next', scope: 'flow', chord: { key: 'arrowright' }, keywords: 'next right select suivant droite',
        title: { en: 'Flow: select the next node', fr: 'Flux : sélectionner le nœud suivant' } },
    { id: 'sched.flow.prev', scope: 'flow', chord: { key: 'arrowleft' }, keywords: 'previous left select précédent gauche',
        title: { en: 'Flow: select the previous node', fr: 'Flux : sélectionner le nœud précédent' } },
    { id: 'sched.flow.up', scope: 'flow', chord: { key: 'arrowup' }, keywords: 'up lane branch above haut branche',
        title: { en: 'Flow: select the node above', fr: 'Flux : sélectionner le nœud au-dessus' } },
    { id: 'sched.flow.down', scope: 'flow', chord: { key: 'arrowdown' }, keywords: 'down lane branch below bas branche',
        title: { en: 'Flow: select the node below', fr: 'Flux : sélectionner le nœud en dessous' } },
    { id: 'sched.flow.moveEarlier', scope: 'flow', chord: { alt: true, key: 'arrowleft' }, keywords: 'move earlier reorder before déplacer avant réordonner',
        title: { en: 'Flow: move the step earlier', fr: 'Flux : avancer l’étape' } },
    { id: 'sched.flow.moveLater', scope: 'flow', chord: { alt: true, key: 'arrowright' }, keywords: 'move later reorder after déplacer après réordonner',
        title: { en: 'Flow: move the step later', fr: 'Flux : reculer l’étape' } },
    { id: 'sched.flow.zoomIn', scope: 'flow', chord: { ctrl: true, key: '=' }, keywords: 'zoom in bigger agrandir zoomer',
        title: { en: 'Flow: zoom in', fr: 'Flux : zoomer' } },
    { id: 'sched.flow.zoomOut', scope: 'flow', chord: { ctrl: true, key: '-' }, keywords: 'zoom out smaller réduire dézoomer',
        title: { en: 'Flow: zoom out', fr: 'Flux : dézoomer' } },
    { id: 'sched.flow.fit', scope: 'flow', chord: { key: 'f' }, keywords: 'fit view whole everything center ajuster vue tout centrer',
        title: { en: 'Flow: fit the whole task in view', fr: 'Flux : ajuster toute la tâche à la vue' } },
    { id: 'sched.flow.autoLayout', scope: 'flow', chord: { shift: true, key: 'l' }, keywords: 'auto layout arrange tidy reset positions disposition ranger réinitialiser',
        title: { en: 'Flow: auto-layout (forget hand-placed positions)', fr: 'Flux : disposition automatique (oublier les positions manuelles)' } },
    { id: 'sched.mode.blocks', scope: 'editor', chord: { alt: true, key: '1' }, keywords: 'mode blocks bricks view briques blocs',
        title: { en: 'Task editor: Blocks mode', fr: 'Éditeur de tâche : mode Blocs' } },
    { id: 'sched.mode.code', scope: 'editor', chord: { alt: true, key: '2' }, keywords: 'mode code text bmmscript texte',
        title: { en: 'Task editor: Code mode', fr: 'Éditeur de tâche : mode Code' } },
    { id: 'sched.mode.flow', scope: 'editor', chord: { alt: true, key: '3' }, keywords: 'mode flow graph canvas nodes n8n flux graphe nœuds',
        title: { en: 'Task editor: Flow mode', fr: 'Éditeur de tâche : mode Flux' } },
    { id: 'sched.save', scope: 'editor', chord: { ctrl: true, key: 's' }, keywords: 'save task store enregistrer sauvegarder tâche',
        title: { en: 'Task editor: save the task', fr: 'Éditeur de tâche : enregistrer la tâche' } },
    { id: 'sched.flow.testNode', scope: 'flow', chord: { key: 't' }, keywords: 'test try run once node step essayer tester lancer nœud',
        title: { en: 'Flow: test the selected step once', fr: 'Flux : tester une fois l’étape sélectionnée' } },
    { id: 'sched.debug.breakpoint', scope: 'editor', chord: { key: 'f9' }, keywords: 'breakpoint pause stop here debug point d’arrêt déboguer',
        title: { en: 'Debugger: breakpoint on the selected step', fr: 'Débogueur : point d’arrêt sur l’étape sélectionnée' } },
    { id: 'sched.debug.step', scope: 'debug', chord: { key: 'f10' }, keywords: 'debug step next over déboguer pas suivant',
        title: { en: 'Debugger: step (run the next step, then stop)', fr: 'Débogueur : pas à pas (exécuter l’étape suivante, puis s’arrêter)' } },
    { id: 'sched.debug.continue', scope: 'debug', chord: { key: 'f5' }, keywords: 'debug continue resume run déboguer continuer reprendre',
        title: { en: 'Debugger: continue to the next breakpoint', fr: 'Débogueur : continuer jusqu’au prochain point d’arrêt' } },
    { id: 'sched.debug.stop', scope: 'debug', chord: { shift: true, key: 'f5' }, keywords: 'debug stop end abort déboguer arrêter terminer',
        title: { en: 'Debugger: stop the run', fr: 'Débogueur : arrêter l’exécution' } },
];

const _handlers = new Map<string, () => void>();
let _active: (scope: FlowScope) => boolean = () => false;
/** A scope bound by somebody other than the flow (the debugger, the editor's save). */
const _activeBy = new Map<FlowScope, () => boolean>();

/** Bind the commands of one scope, with its own "does it apply now". */
export function bindScopeKeys(scope: FlowScope, handlers: Record<string, () => void>, active: () => boolean): void {
    for (const [id, fn] of Object.entries(handlers)) _handlers.set(id, fn);
    _activeBy.set(scope, active);
}

/** Called by the editor when it mounts: what each command does, and when it applies. */
export function bindFlowKeys(handlers: Record<string, () => void>, active: (scope: FlowScope) => boolean): void {
    for (const [id, fn] of Object.entries(handlers)) _handlers.set(id, fn);
    _active = active;
}

export function flowKeyActive(scope: FlowScope): boolean {
    try {
        const own = _activeBy.get(scope);
        return own ? own() : _active(scope);
    } catch { return false; }
}

export function flowKeyRun(id: string): void {
    const fn = _handlers.get(id);
    if (fn) fn();
}
