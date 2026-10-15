// Who may install something out of a catalogue, and how.
//
// The owner's rule, in one place: a catalogue of apps, plugins, themes, modpacks or .mm lists
// PROPOSES things. Nothing in one is downloaded, installed, enabled or applied unless a person
// asked for it — by pressing a button, by a scheduled task they created, or by a plugin they
// installed and gave the permission to. Refreshing a source, syncing it, opening a catalogue
// screen or following a new catalogue never installs anything.
//
// Pure (no window, no i18n, no invoke) so the rule is pinned by a node test
// (tests/catalog-consent.test.mjs) without a browser. `catalog-actions.ts` is the screen-side
// half that actually installs, and it asks this module first.

/** The catalogue kinds BMM reads. */
export const CATALOG_KINDS = ['app', 'plugin', 'theme', 'modpack', 'modlist'] as const;
export type CatalogKind = typeof CATALOG_KINDS[number];

/**
 * Who is asking.
 *
 *  - `user`   — a click in BMM's own interface, at the moment it happens.
 *  - `task`   — a scheduled task the user created (it names its `taskId`).
 *  - `plugin` — a plugin the user installed, acting through a permission it holds (`pluginId`).
 *
 * Nothing else: a refresh, a sync, a deep link that was not confirmed, or "the catalogue says
 * so" are not actors, and an install without one of these three is refused.
 */
export const CATALOG_ACTORS = ['user', 'task', 'plugin'] as const;
export type CatalogActor = typeof CATALOG_ACTORS[number];

export interface CatalogActOptions {
    source: CatalogActor;
    /** The scheduled task that is running this (required when `source` is `task`). */
    taskId?: string;
    /** The plugin that is asking (required when `source` is `plugin`). */
    pluginId?: string;
    /** Apps: the folder to install into. Absent → the default apps folder. */
    installPath?: string;
}

/** What `catalogInstall` answers. Never throws: `ok:false` carries a translation key. */
export interface CatalogActResult {
    ok: boolean;
    /** An i18n key (`catalog.act.*`) when refused or failed. */
    reason?: string;
    /** The backend's own message, when it failed there. */
    detail?: string;
    /** What was installed (an id, a name), when it worked. */
    installed?: string;
}

/** Can nobody be asked at this moment? Then every check that would have been a dialog is a refusal. */
export function isUnattended(source: CatalogActor): boolean {
    return source !== 'user';
}

/**
 * Why this request must not go ahead, or `null` when it may.
 *
 * Checked BEFORE anything is fetched. The keys are `catalog.act.*`, all present in en/fr.
 */
export function catalogActRefusal(kind: unknown, id: unknown, opts: unknown): string | null {
    if (!CATALOG_KINDS.includes(kind as CatalogKind)) return 'catalog.act.badKind';
    if (typeof id !== 'string' || !id.trim()) return 'catalog.act.noId';
    const o = (opts && typeof opts === 'object' ? opts : {}) as Partial<CatalogActOptions>;
    if (!CATALOG_ACTORS.includes(o.source as CatalogActor)) return 'catalog.act.noActor';
    if (o.source === 'task' && !String(o.taskId || '').trim()) return 'catalog.act.noTask';
    if (o.source === 'plugin' && !String(o.pluginId || '').trim()) return 'catalog.act.noPlugin';
    // A .mm list is applied to a PROFILE, with choices (which profile, strict or not) that
    // a catalogue entry does not carry. It is opened for the person to look at, never applied.
    if (kind === 'modlist') return 'catalog.act.modlistIsPreview';
    return null;
}

/**
 * The extra limits for an unattended install (a task or a plugin): nobody is there to read a
 * warning, so everything that would have been a warning is a refusal.
 *
 *  - https only (plain http lets anyone on the path swap the payload);
 *  - a published sha256 for anything that runs (apps, plugins) — the download is verified
 *    against it or the install stops.
 *
 * `entry` is the catalogue entry as the screen reads it: `{ download: { url, sha256 } }` for
 * an app, `{ download_url, sha256 }` for a plugin, theme or modpack.
 */
export function unattendedRefusal(kind: CatalogKind, entry: any): string | null {
    const url = String(entry?.download?.url ?? entry?.download_url ?? entry?.url ?? '').trim();
    const sha = String(entry?.download?.sha256 ?? entry?.sha256 ?? '').trim();
    // A theme that carries its colours inline has nothing to download.
    if (kind === 'theme' && !url) return null;
    if (!/^https:\/\//i.test(url)) return 'catalog.act.needsHttps';
    if ((kind === 'app' || kind === 'plugin') && !/^[0-9a-f]{64}$/i.test(sha)) return 'catalog.act.needsChecksum';
    return null;
}

/**
 * Whether a catalogue item may update itself in the background.
 *
 * Only when the user switched that on for THAT item (`'on'`). The old rule was "unless switched
 * off", which made every plugin installed from the catalogue reinstall itself from whatever the
 * catalogue said next — an install nobody asked for. A stored `'off'`, nothing, or anything
 * else means: tell the user a newer version exists, install nothing.
 */
export function autoUpdateAllowed(stored: string | null | undefined): boolean {
    return stored === 'on';
}
