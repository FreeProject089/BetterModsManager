// Writing a `.DATABMM` backup — one implementation, two callers.
//
// The Export data screen wrote one; the scheduler's "Export data (backup)" action wrote a
// `.json` through a different command, so a nightly automation produced a smaller, different
// thing than the button in Settings, could not choose what went in it, and could not lock
// it. Somebody with a scheduled backup and identity keys on their ring had neither.
//
// This is the sequence both now use. It stays small on purpose: the FILTERING of app data
// belongs to the JSON exporter and the archive belongs to `export_data_bundle`; what is here
// is the three steps in between that were being done twice.

import { invoke } from '../../core/api.js';

/** Which sections ride along. Mirrors `commands::export_bundle::BundleOptions`. */
export interface BackupSections {
    appData?: boolean;
    themes?: boolean;
    themePresets?: boolean;
    translations?: boolean;
    launchPacks?: boolean;
    automations?: boolean;
    navigation?: boolean;
    apps?: boolean;
    replays?: boolean;
    crashes?: boolean;
    diagnostics?: boolean;
    /** The PRIVATE halves of your identity keys. Requires a passphrase — see below. */
    identityKeys?: boolean;
}

export interface BackupResult {
    bytes: number;
    sections: { section: string; files: number; note?: string }[];
    path: string;
}

/** Everything on, except the two that are somebody's deliberate choice. */
export const DEFAULT_SECTIONS: BackupSections = {
    appData: true, themes: true, themePresets: true, translations: true,
    launchPacks: true, automations: true, navigation: true, apps: true,
    // Replays and crash reports are large and are diagnostics, not configuration. A nightly
    // backup that quietly grew to gigabytes because it was carrying every session recording
    // is a backup somebody turns off.
    replays: false, crashes: false, diagnostics: false,
    // Never by default. See writeBackup.
    identityKeys: false,
};

/**
 * Write the archive.
 *
 * Refuses to include identity keys without a passphrase, and that refusal is here rather
 * than only on the settings screen because the scheduler reaches this too — a nightly task
 * that wrote unlocked private keys to a synced folder would be the worst thing in this
 * codebase, and it would do it every night.
 */
export async function writeBackup(
    destPath: string,
    sections: BackupSections,
    passphrase?: string | null,
    /** What the JSON exporter should filter to. Defaults to everything it exports. */
    exportOptions?: unknown,
    extras?: unknown,
): Promise<BackupResult> {
    if (sections.identityKeys && !passphrase) {
        throw new Error('settings.exportKeysNeedPass');
    }

    // The app_data section is built by the JSON exporter's own rules, so the two exports
    // cannot disagree about what "profiles" or "plugins" means.
    const appDataJson = sections.appData
        ? JSON.parse(await invoke('export_app_data_json', { options: exportOptions ?? null, extras: extras ?? null }) as string)
        : null;

    // The navbar layout lives in localStorage, which Rust cannot read. Without it the pages
    // would be backed up and the buttons that reach them would not — a restore with every
    // page present and no way to open one.
    let navbarConfig: unknown = null;
    if (sections.navigation) {
        try { navbarConfig = JSON.parse(localStorage.getItem('bmm_navbar_config') || 'null'); }
        catch { navbarConfig = null; }
    }

    const r = await invoke('export_data_bundle', {
        destPath,
        options: {
            app_data: !!sections.appData,
            themes: !!sections.themes,
            theme_presets: !!sections.themePresets,
            translations: !!sections.translations,
            launch_packs: !!sections.launchPacks,
            automations: !!sections.automations,
            navigation: !!sections.navigation,
            apps: !!sections.apps,
            replays: !!sections.replays,
            crashes: !!sections.crashes,
            diagnostics: !!sections.diagnostics,
            identity_keys: !!sections.identityKeys,
        },
        appDataJson,
        extras: extras ?? null,
        navbarConfig,
        passphrase: passphrase || null,
    }) as { bytes: number; sections: BackupResult['sections'] };

    return { ...r, path: destPath };
}

/**
 * Where an unattended backup goes.
 *
 * Through the backend, which owns the one naming rule: the `{date}`/`{time}`/`{datetime}`
 * tokens and what happens when the file is already there. Resolving it here as well would be
 * a second copy, and the drift would show up as a backup silently overwriting yesterday's.
 */
export function backupDestPath(
    dir: string,
    name?: string | null,
    increment?: string | null,
    ext = 'DATABMM',
): Promise<string> {
    return invoke('backup_dest_path', { dir, name: name || null, increment: increment || null, ext }) as Promise<string>;
}
