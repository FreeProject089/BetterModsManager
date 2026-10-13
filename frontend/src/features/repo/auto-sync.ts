// Check the repos you follow when BMM starts.
//
// What this does and, more importantly, what it deliberately does NOT do.
//
// It fetches each opted-in repo's manifest and compares it against what is installed. If
// something is new or outdated it tells you, with one click to sync.
//
// It does not run the sync itself. Syncing writes into a game folder, and BMM starts when
// you turn your PC on — quite possibly with the game already running, or mid-update from
// the game's own launcher. Writing to those files unattended, seconds after boot, is a
// corrupted install nobody asked for. So the fetch is automatic and the write stays a
// decision, which is also why the checkbox is worded "check" rather than "sync".
//
// Failures here are near-silent on purpose: a repo being unreachable at boot is ordinary
// (no network yet), and a startup error toast for something the user did not initiate is
// noise they cannot act on.

import { invoke } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { isNewerVersion, normRepoUrl } from './versions.js';

interface AutoSyncRepo {
    url: string;
    name: string;
    mode: string;
}

/// Fill the sync form for `url` and open it, so the user's single click lands on a form
/// that is already correct. Set by initRepoSync(); absent if the repo view never loaded.
type Opener = (url: string, mode: string) => void;
let opener: Opener | null = null;

export function registerRepoSyncOpener(fn: Opener) {
    opener = fn;
}

async function outdatedCount(repo: AutoSyncRepo): Promise<number> {
    const info: any = await invoke('fetch_repo_info', { url: repo.url, creatorId: null });
    const remote: any[] = (info?.profiles || []).flatMap((p: any) => p.mods || []);
    if (!remote.length) return 0;

    const local: any[] = await invoke('get_all_mods');
    // Only the mods installed FROM this repo: another repo's mod with the same id is not this
    // one (it used to count), and a local id is never a repo id.
    const me = normRepoUrl(repo.url);
    const byId = new Map<string, any>();
    for (const m of local) {
        if (m.repo_mod_id && normRepoUrl(m.source_repo || '') === me) byId.set(String(m.repo_mod_id), m);
    }
    // Absent mods count only in the repo profiles the user installed something from: the
    // profiles they never synced are not « to update ».
    const synced = (info?.profiles || []).filter((p: any) => (p.mods || []).some((rm: any) => byId.has(String(rm.id))));
    const pool: any[] = synced.length ? synced.flatMap((p: any) => p.mods || []) : remote;
    // "Outdated" = absent, or a NEWER version (numbers compared as numbers, never a downgrade).
    const seen = new Set<string>();
    return pool.filter((rm) => {
        const id = String(rm.id);
        if (seen.has(id)) return false;
        seen.add(id);
        const hit = byId.get(id);
        return !hit || isNewerVersion(String(rm.version || ''), String(hit.version || ''));
    }).length;
}

export async function runAutoSyncCheck() {
    let repos: AutoSyncRepo[] = [];
    try {
        repos = (await invoke('get_auto_sync_repos')) as AutoSyncRepo[];
    } catch {
        return;
    }
    if (!repos.length) return;

    for (const repo of repos) {
        let count = 0;
        try {
            count = await outdatedCount(repo);
        } catch {
            // Unreachable at boot is the normal case, not an error worth interrupting for.
            continue;
        }
        if (count <= 0) continue;

        const label = repo.name?.trim() || repo.url;
        // Pre-filled first, so the toast is telling the truth: by the time it is read, the
        // sync screen already has this repo and its mode loaded and needs one click.
        opener?.(repo.url, repo.mode);
        toast(
            `${label}: ${count} ${t('repo.autoSyncPending') || 'mods to update'}`,
            'info',
            8000,
        );
    }
}
