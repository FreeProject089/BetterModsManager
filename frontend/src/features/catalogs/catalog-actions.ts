// Installing one catalogue item on somebody's explicit behalf.
//
// The single door for "install this entry out of a catalogue" that is not a button on the
// catalogue screen itself: a scheduled task the user created, a plugin acting through its
// permission, or a screen elsewhere in BMM that wants the same install. Each call says WHO is
// asking (`source`); anything else is refused before a byte is fetched (catalog-consent.ts).
//
//   catalogInstall('app', 'texture-optimizer', { source: 'task', taskId: 't-42' })
//   catalogInstall('plugin', 'my-plugin', { source: 'plugin', pluginId: 'other-plugin' })
//   catalogInstall('theme', 'midnight', { source: 'user' })
//
// What an unattended caller (task, plugin) gets is deliberately narrower than a click:
//
//   - https only, and a published sha256 for apps and plugins (nobody is there to say yes to
//     the "unverified download" warning, so there is no warning — there is a refusal);
//   - apps go through `link_install_app` and plugins through `link_install_plugin`: the same
//     Rust limits a confirmed bmm:// link gets, and a plugin lands DISABLED;
//   - a theme is installed, never applied; a modpack is added to the list, never activated;
//   - a .mm list is never applied (it needs a profile and choices) — refused.
//
// A user click on the catalogue screens keeps its own richer flow (the install dialog, the
// folder picker, the warnings). `source: 'user'` here opens that same flow for apps.
//
// The screens that own a kind (apps, themes) REGISTER their installer here when they load,
// rather than this module importing them: it is reachable from the scheduler and the plugin
// bridge, and importing four screens from here would put it in every import cycle they are in.

import { invoke } from '../../core/api.js';
import {
    catalogActRefusal, unattendedRefusal, isUnattended,
    type CatalogKind, type CatalogActOptions, type CatalogActResult,
} from './catalog-consent.js';

export type { CatalogKind, CatalogActOptions, CatalogActResult } from './catalog-consent.js';
export { CATALOG_KINDS, CATALOG_ACTORS } from './catalog-consent.js';

/** What a screen hands over for its kind: install one entry by id, attended or not. */
export type CatalogInstaller = (id: string, o: { unattended: boolean; installPath?: string }) => Promise<CatalogActResult>;
const _installers: Partial<Record<CatalogKind, CatalogInstaller>> = {};

/** Called once by the screen that owns `kind` (apps-catalog.ts, theme-catalog.ts). */
export function registerCatalogInstaller(kind: CatalogKind, fn: CatalogInstaller): void {
    _installers[kind] = fn;
}

/** The backend answers with a key, sometimes `key|detail`. Keep the key, keep the detail. */
function failed(e: unknown, fallback = 'catalog.act.failed'): CatalogActResult {
    const raw = String((e as Error)?.message ?? e).replace(/^Error:\s*/, '');
    const key = raw.split('|')[0].trim();
    return key.startsWith('catalog.act.')
        ? { ok: false, reason: key, detail: raw.slice(key.length + 1) || undefined }
        : { ok: false, reason: fallback, detail: raw.slice(0, 300) };
}

/**
 * Install one catalogue entry, on behalf of `opts.source`. Never throws; never applies,
 * enables or activates what it installs beyond what the kind's own install already does for a
 * click (see the header for the unattended limits).
 */
export async function catalogInstall(kind: CatalogKind, id: string, opts: CatalogActOptions): Promise<CatalogActResult> {
    const why = catalogActRefusal(kind, id, opts);
    if (why) return { ok: false, reason: why };
    const unattended = isUnattended(opts.source);
    try {
        switch (kind) {
            case 'app':
            case 'theme': {
                const fn = _installers[kind];
                if (!fn) return { ok: false, reason: 'catalog.act.notReady' };
                return await fn(id, { unattended, installPath: opts.installPath });
            }
            case 'plugin': return await installPluginEntry(id, unattended);
            case 'modpack': return await installModpackEntry(id, unattended);
            default: return { ok: false, reason: 'catalog.act.badKind' };
        }
    } catch (e) {
        return failed(e);
    }
}

/** A plugin from the plugin catalogue, by id. */
async function installPluginEntry(id: string, unattended: boolean): Promise<CatalogActResult> {
    const { getLinks } = await import('../../core/links-config.js');
    const cat: any = await invoke('fetch_plugin_catalog', { catalogUrl: getLinks().plugin_catalog });
    const entry = (cat?.plugins || []).find((p: any) => p?.id === id);
    if (!entry) return { ok: false, reason: 'catalog.act.notFound' };
    const url = String(entry.download_url || '').trim();
    if (unattended) {
        const no = unattendedRefusal('plugin', entry);
        if (no) return { ok: false, reason: no };
        // Installed DISABLED, any earlier grant for that id cleared — what a confirmed link gets.
        await invoke('link_install_plugin', { downloadUrl: url, sha256: entry.sha256 });
        return { ok: true, installed: id };
    }
    // A click: the regular install, checksum enforced when there is one. Without one the
    // catalogue screen's own warning is the place to say yes, so this refuses instead.
    if (!entry.sha256) return { ok: false, reason: 'catalog.act.needsChecksum' };
    await invoke('install_plugin', { downloadUrl: url, sha256: entry.sha256, allowUnverified: false });
    return { ok: true, installed: id };
}

/** A modpack from the followed modpack catalogues, by id. Added to the list, not activated. */
async function installModpackEntry(id: string, unattended: boolean): Promise<CatalogActResult> {
    const [{ readModpackCatalogs, parseModpackFeed }, { fetchCatalogText, asLegacy }] = await Promise.all([
        import('../mods/modpack-catalog.js'),
        import('../../core/catalog-read.js'),
    ]);
    for (const src of readModpackCatalogs()) {
        try {
            if (/\.cbmp(\?|$)/i.test(src)) {
                const cat: any = await invoke('read_modpack_catalog', { source: src });
                const m = (cat?.modpacks || []).find((x: any) => String(x?.id || '') === id);
                if (!m) continue;
                // Inside a local bundle: nothing is downloaded, nothing to check over the wire.
                await invoke('install_from_modpack_catalog', { source: src, entry: String(m.file || '') });
                return { ok: true, installed: id };
            }
            const doc = await asLegacy(JSON.parse(await fetchCatalogText(src, true)), 'modpack', src);
            const pack = parseModpackFeed(doc, src).packs.find((p) => p.id === id);
            if (!pack) continue;
            if (unattended) {
                const no = unattendedRefusal('modpack', pack);
                if (no) return { ok: false, reason: no };
            }
            await invoke('install_modpack_from_url', { downloadUrl: pack.url });
            return { ok: true, installed: id };
        } catch { /* one unreachable catalogue does not end the search */ }
    }
    return { ok: false, reason: 'catalog.act.notFound' };
}
