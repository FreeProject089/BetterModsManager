// Writing the catalogue source lists — and telling the backend what they say.
//
// The lists live in `localStorage`, which is the right place for them: they are the user's
// own preferences, written and read by the screens that show them. It is also a place the
// Rust side cannot see, and that had a consequence nobody had written down — the whole
// catalogue subsystem was unreachable from a script, the CLI, an assistant or a deeplink.
// You could follow a catalogue by clicking, and by no other means.
//
// So every write also pushes a MIRROR the backend can read. Routed through one function
// rather than mirrored at each call site, because a mirror maintained in four places is a
// mirror that is wrong in one of them and looks right everywhere.
//
// Its own module rather than a few more lines in catalog-index, because catalog-index is
// deliberately Tauri-free — its parsing half is tested directly, and reaching `invoke` from
// it closes nine cycles in the module graph. The direction is one-way: this imports
// catalog-index, and catalog-index knows nothing about this.

import { invoke } from '../../core/api.js';
import { STORE_KEY } from './catalog-index.js';

const read = (key: string): string[] => {
    try {
        const v = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
        return [];
    }
};

/**
 * Write a source list — the only way any of them should be written.
 *
 * The local write happens first and unconditionally: the list somebody can see is the one
 * that matters, and the mirror is the copy for everyone else.
 */
export function writeSources(key: string, list: string[]): void {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* the store is full or blocked */ }
    void pushMirror();
}

/**
 * Hand the backend the whole map of what is followed, as it stands right now.
 *
 * The WHOLE map, not a delta: a delta would need the backend to know how each list is
 * ordered and de-duplicated, which is a second copy of rules that live in one place.
 *
 * Fire-and-forget. A backend that will not take it must not stop somebody following a
 * catalogue.
 */
export async function pushMirror(): Promise<void> {
    const sources: Record<string, string[]> = {};
    for (const [type, key] of Object.entries(STORE_KEY)) sources[type] = read(key);
    try { await invoke('catalog_sources_set', { sources }); } catch { /* see above */ }
}
