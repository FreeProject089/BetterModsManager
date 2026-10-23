// custom-page-model.ts — what editing a custom page does to the navbar config and the page
// store, with no DOM (Settings › Customise navigation › My pages / Edit page).
//
// A page made from a starter (« Notes », « Checklist »…) is a NORMAL page: the guided flow
// copies the starter's HTML, CSS and JS into a new bundle (`create_custom_page`), and from
// then on the page is the user's own, edited like any other. Nothing refers back to the
// starter. What is remembered, per page, is only WHICH starter it came from, so the editor can
// offer « Revert to the starter » with the right one preselected. That record lives here
// (localStorage, `bmm_custom_page_origin`), never in the page, and losing it costs nothing but
// the preselection.
//
// Pages made before the record existed have none: `resolveOrigin` recognises an unedited
// starter by its exact source and records it (the migration); an edited one stays unknown and
// the editor asks which starter to revert to.
//
// Nothing here grants anything. Duplicating calls `duplicate_custom_page`, which copies the
// bundle and NOT its permissions or storage; no path calls `page_set_grant`.
//
// No imports: the tests load the compiled file directly.

/** A starter, as far as this module needs one. */
export interface StarterLike { labelKey: string; html: string; css: string; js: string; }
/** A page's editable source, as `get_custom_page_source` returns it. */
export interface PageSourceLike { name: string; html: string; css: string; js: string; }
/** A sidebar button, as navbar-customize stores it. */
export interface NavButtonLike { id: string; label: string; kind: string; target: string; icon?: string; }
/** The parts of the navbar config a page's buttons live in. */
export interface NavConfigLike {
    order: string[];
    hidden: Record<string, boolean>;
    labels: Record<string, string>;
    custom: NavButtonLike[];
}
/** Storage the origin record is kept in (localStorage, or a fake in the tests). */
export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void; }
export type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export const ORIGIN_KEY = 'bmm_custom_page_origin';

/** pageId → the labelKey of the starter it was made from. */
export function readOrigins(store: KeyValueStore | null | undefined): Record<string, string> {
    try {
        const v = JSON.parse(store?.getItem(ORIGIN_KEY) || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
        const out: Record<string, string> = {};
        for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
        return out;
    } catch { return {}; }
}

export function writeOrigin(store: KeyValueStore | null | undefined, pageId: string, labelKey: string | null): void {
    if (!store) return;
    const all = readOrigins(store);
    if (labelKey) all[pageId] = labelKey; else delete all[pageId];
    try { store.setItem(ORIGIN_KEY, JSON.stringify(all)); } catch { /* full or blocked: the preselection is lost, nothing else */ }
}

const norm = (s: string | undefined | null): string => String(s ?? '').replace(/\r\n/g, '\n').trim();

/** Same source as the starter? (The backend trims the HTML it reads back, so compare trimmed.) */
export function sameAsStarter(src: PageSourceLike, tpl: StarterLike): boolean {
    return norm(src.html) === norm(tpl.html) && norm(src.css) === norm(tpl.css) && norm(src.js) === norm(tpl.js);
}

/** The starter whose exact source this page still has, or null. */
export function detectStarter(src: PageSourceLike, starters: readonly StarterLike[]): string | null {
    return starters.find((tpl) => sameAsStarter(src, tpl))?.labelKey || null;
}

/** Where a page came from: the record if there is one, else a recognised unedited starter,
 *  which is then recorded (`migrated: true`). `modified` says the source no longer matches. */
export function resolveOrigin(
    pageId: string, src: PageSourceLike, starters: readonly StarterLike[], store: KeyValueStore | null | undefined,
): { labelKey: string | null; migrated: boolean; modified: boolean } {
    const known = readOrigins(store)[pageId];
    const tpl = known ? starters.find((s) => s.labelKey === known) : undefined;
    if (tpl) return { labelKey: tpl.labelKey, migrated: false, modified: !sameAsStarter(src, tpl) };
    const found = detectStarter(src, starters);
    if (found) { writeOrigin(store, pageId, found); return { labelKey: found, migrated: true, modified: false }; }
    return { labelKey: null, migrated: false, modified: true };
}

/** The sidebar buttons that open this page. */
export function buttonsForPage(cfg: NavConfigLike, pageId: string): NavButtonLike[] {
    return cfg.custom.filter((c) => c.kind === 'page' && c.target === pageId);
}

/** A page renamed: the buttons that were still called by the page's old name follow it. A
 *  button the user named differently keeps its own name. Returns how many followed. */
export function renameFollowers(cfg: NavConfigLike, pageId: string, oldName: string, newName: string): number {
    const from = oldName.trim(), to = newName.trim();
    if (!to || from === to) return 0;
    let n = 0;
    for (const b of buttonsForPage(cfg, pageId)) {
        if (b.label.trim() === from) { b.label = to; delete cfg.labels[b.id]; n++; }
    }
    return n;
}

/** A page deleted: its buttons leave the sidebar with it. Returns the removed button ids. */
export function dropPageButtons(cfg: NavConfigLike, pageId: string): string[] {
    const gone = buttonsForPage(cfg, pageId).map((b) => b.id);
    if (!gone.length) return gone;
    const set = new Set(gone);
    cfg.custom = cfg.custom.filter((c) => !set.has(c.id));
    cfg.order = cfg.order.filter((x) => !set.has(x));
    for (const id of gone) { delete cfg.labels[id]; delete cfg.hidden[id]; }
    return gone;
}

/** « Name (copy) », « Name (copy 2) »… not already taken. `copyWord` is translated. */
export function copyName(name: string, taken: readonly string[], copyWord: string): string {
    const base = name.trim() || copyWord;
    const used = new Set(taken.map((s) => s.trim()));
    let cand = `${base} (${copyWord})`;
    for (let i = 2; used.has(cand); i++) cand = `${base} (${copyWord} ${i})`;
    return cand;
}

/** Duplicate a page: a new page with the same bundle and NO permissions or storage. The copy
 *  remembers the same starter as the original. */
export async function duplicatePage(
    deps: { invoke: Invoke; store?: KeyValueStore | null },
    pageId: string, newName: string,
): Promise<{ id: string; name: string; skipped: string[] }> {
    const res = await deps.invoke('duplicate_custom_page', { id: pageId, name: newName }) as { page: { id: string; name: string }; skipped?: string[] };
    const origin = readOrigins(deps.store)[pageId];
    if (origin) writeOrigin(deps.store, res.page.id, origin);
    return { id: res.page.id, name: res.page.name, skipped: res.skipped || [] };
}

/** Revert a page's HTML, CSS and JS to a starter. Its name, sub-documents, files, storage
 *  and permissions are left as they are: reverting the code grants nothing and takes nothing. */
export async function revertToStarter(
    deps: { invoke: Invoke; store?: KeyValueStore | null },
    pageId: string, name: string, tpl: StarterLike,
): Promise<void> {
    await deps.invoke('update_custom_page', { id: pageId, name, html: tpl.html, css: tpl.css, js: tpl.js });
    writeOrigin(deps.store, pageId, tpl.labelKey);
}

/** Delete a page, its buttons and its origin record. The caller asks first. */
export async function deletePage(
    deps: { invoke: Invoke; store?: KeyValueStore | null },
    cfg: NavConfigLike, pageId: string,
): Promise<string[]> {
    await deps.invoke('delete_custom_page', { id: pageId });
    writeOrigin(deps.store, pageId, null);
    return dropPageButtons(cfg, pageId);
}
