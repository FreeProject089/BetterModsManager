// Catalogue sources, the part that writes: one set of operations over the two places sources
// live (app sources in the Rust backend behind *_community_source, every other kind in
// localStorage under STORE_KEY, mirrored to the backend by writeSources).
//
// Used by the shared source list (source-list.ts) in the App catalogue and in Settings →
// Catalogue index, so adding, renaming, reordering or removing a source does the same three
// bookkeeping writes wherever it happens: the list, its origin, its history line.

import { invoke } from '../../core/api.js';
import { catalogSources } from '../../core/links-config.js';
import {
    STORE_KEY, readSources, addSource, removeSource, forgetOrigin, rememberOrigin, recordHistory,
    setDisabled, isDisabled, hasSource,
} from './catalog-index.js';
import { writeSources } from './catalog-sources.js';
import { moveInList } from './source-list-model.js';

/** links.json key of each kind's official catalogue (a kind may list several URLs). */
export const OFFICIAL_LINK: Record<string, string> = {
    app: 'apps_catalog',
    plugin: 'plugin_catalog',
    theme: 'theme_catalog',
    preset: 'preset_catalog',
    tutorial: 'tutorial_catalog',
};

/** The official catalogue URL(s) of a kind: what BMM fetches without anybody adding it. */
export function officialSources(kind: string): string[] {
    const key = OFFICIAL_LINK[kind];
    if (!key) return [];
    try { return catalogSources(key as any); } catch { return []; }
}

/** The kinds this store can write. */
export function followableKinds(): string[] {
    return ['app', ...Object.keys(STORE_KEY)];
}

// ── Labels: the person's own name for a source ─────────────────────────────────────────
// A separate map (like origins and the disabled set), so the lists keep their plain shape
// that the deep-link handler, five panels and the backend all read.
const LABEL_KEY = 'bmm_catalog_labels';

export function readLabels(): Record<string, string> {
    try {
        const v = JSON.parse(localStorage.getItem(LABEL_KEY) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
}

export function setLabel(url: string, name: string): void {
    try {
        const m = readLabels();
        const n = String(name || '').trim().slice(0, 120);
        if (n) m[url] = n; else delete m[url];
        localStorage.setItem(LABEL_KEY, JSON.stringify(m));
    } catch { /* preference only */ }
}

// ── Lists ──────────────────────────────────────────────────────────────────────────────

/** The followed sources of one kind, in the person's order. */
export async function listFollowed(kind: string): Promise<string[]> {
    if (kind === 'app') {
        try {
            const st = await invoke('get_apps_state') as { community_sources?: string[] };
            return Array.isArray(st?.community_sources) ? st.community_sources : [];
        } catch { return []; }
    }
    const key = STORE_KEY[kind];
    return key ? readSources(key) : [];
}

/** Every kind's followed sources. */
export async function listAllFollowed(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const k of followableKinds()) out[k] = await listFollowed(k);
    return out;
}

async function replace(kind: string, list: string[]): Promise<string[]> {
    if (kind === 'app') return await invoke('set_community_sources', { urls: list }) as string[];
    const key = STORE_KEY[kind];
    if (!key) throw new Error(`unknown kind ${kind}`);
    writeSources(key, list);
    return list;
}

/** Follow a source. Returns false when it was already followed. */
export async function addFollowed(kind: string, url: string, opts: { name?: string; via?: string; enabled?: boolean } = {}): Promise<boolean> {
    const u = String(url || '').trim();
    if (!u) return false;
    const list = await listFollowed(kind);
    if (hasSource(list, u)) return false;
    if (kind === 'app') await invoke('add_community_source', { url: u });
    else {
        const key = STORE_KEY[kind];
        if (!key) throw new Error(`unknown kind ${kind}`);
        const next = list.slice();
        addSource(next, u);
        writeSources(key, next);
    }
    if (opts.name) setLabel(u, opts.name);
    if (opts.via) rememberOrigin(u, opts.via);
    if (opts.enabled === false) setDisabled(u, true);
    recordHistory({ action: 'add', type: kind, url: u, ...(opts.via ? { via: opts.via } : {}) });
    return true;
}

/** Stop following a source: the list, its origin, its off flag and its label go; a history
 *  line stays so it can be brought back. */
export async function removeFollowed(kind: string, url: string): Promise<boolean> {
    if (kind === 'app') {
        await invoke('remove_community_source', { url });
    } else {
        const key = STORE_KEY[kind];
        if (!key) return false;
        const { list, removed } = removeSource(readSources(key), url);
        if (!removed) return false;
        writeSources(key, list);
    }
    forgetOrigin(url);
    setDisabled(url, false);
    setLabel(url, '');
    recordHistory({ action: 'remove', type: kind, url });
    return true;
}

/** Change a source's address in place (same position), keeping its label and on/off state. */
export async function editFollowed(kind: string, oldUrl: string, newUrl: string, name?: string): Promise<void> {
    const nu = String(newUrl || '').trim();
    if (!nu) throw new Error('empty');
    if (nu.toLowerCase() !== oldUrl.toLowerCase()) {
        const list = await listFollowed(kind);
        if (hasSource(list, nu)) throw new Error('settings.catIndex.addDup');
        const low = oldUrl.toLowerCase();
        const next = list.map((u) => (u.toLowerCase() === low ? nu : u));
        await replace(kind, next);
        const off = isDisabled(oldUrl);
        setDisabled(oldUrl, false);
        if (off) setDisabled(nu, true);
        forgetOrigin(oldUrl);
        setLabel(oldUrl, '');
        recordHistory({ action: 'remove', type: kind, url: oldUrl });
        recordHistory({ action: 'add', type: kind, url: nu });
    }
    if (name !== undefined) setLabel(nu, name);
}

/** Move a source up (-1) or down (+1) in its kind's list. */
export async function moveFollowed(kind: string, url: string, delta: number): Promise<void> {
    const list = await listFollowed(kind);
    const next = moveInList(list, url, delta);
    if (next.join('\n') !== list.join('\n')) await replace(kind, next);
}

/** Switch a source on or off (kept in the list either way). */
export function toggleFollowed(url: string, on: boolean): void {
    setDisabled(url, !on);
}
