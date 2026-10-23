// Extension panels for the DevTools menu.
//
// Other features add a panel to DevTools without DevTools knowing about them, and without
// pulling the DevTools UI (a large module) into the boot path: the registry is this small
// file, the UI reads it when it is built. A section registered before the menu exists is
// queued here and appears the first time the menu opens; one registered while the menu is
// open appears at once.
//
// Lifecycle a section can rely on:
//   · mount(host) runs the first time its tab is shown after the menu opens — never at
//     registration, never while the menu is closed. `host` is an empty element owned by the
//     menu; render into it.
//   · unmount() runs when the menu closes (it is fully torn down on close) and when the
//     section is unregistered or replaced. Stop timers, observers and listeners there.
//   · A throwing or rejecting mount is caught and shown in the host; it never breaks the
//     menu or the other sections.
//
// Public entry point: registerDebugSection, re-exported from debug-menu.ts.

export interface DebugSection {
    /** Stable id, unique among sections (e.g. 'laya'). Letters, digits, '-' and '_'. */
    id: string;
    /** i18n key of the tab label. */
    titleKey: string;
    /** Optional inline SVG markup (trusted, from our own code) shown beside the label. */
    icon?: string;
    mount: (host: HTMLElement) => void | Promise<void>;
    unmount?: () => void;
}

type Change = { kind: 'add' | 'remove'; section: DebugSection };
type Listener = (change: Change) => void;

const sections = new Map<string, DebugSection>();
const listeners = new Set<Listener>();

function emit(change: Change): void {
    for (const fn of listeners) {
        try { fn(change); } catch (e) { console.warn('[BMM-Debug] section listener failed', e); }
    }
}

/** Add (or replace) a DevTools panel. Returns a function that removes it again. */
export function registerDebugSection(section: DebugSection): () => void {
    if (!section || typeof section.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(section.id)) {
        throw new Error('registerDebugSection: id must be 1-40 letters, digits, "-" or "_"');
    }
    if (typeof section.titleKey !== 'string' || !section.titleKey) {
        throw new Error('registerDebugSection: titleKey is required');
    }
    if (typeof section.mount !== 'function') {
        throw new Error('registerDebugSection: mount(host) is required');
    }
    const prev = sections.get(section.id);
    if (prev) emit({ kind: 'remove', section: prev });
    const entry: DebugSection = { ...section };
    sections.set(section.id, entry);
    emit({ kind: 'add', section: entry });
    return () => {
        if (sections.get(section.id) !== entry) return;
        sections.delete(section.id);
        emit({ kind: 'remove', section: entry });
    };
}

/** The sections registered so far, in registration order. */
export function getDebugSections(): DebugSection[] {
    return [...sections.values()];
}

/** For the DevTools UI: hear about sections added or removed while it is built. */
export function watchDebugSections(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}
