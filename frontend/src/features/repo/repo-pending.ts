// What the next generated repo should carry, and putting it there.
//
// Split from repo-extras.ts for one reason: that module reaches the scheduler (it hands a
// `.bmmpa` to the task importer), and the scheduler needs THIS — its unattended generate
// action applies whatever is pending, exactly as the screen does. Importing the whole of
// repo-extras to get it closed a cycle, which the dependency gate refused.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';

/** How the caller says something went wrong. Passed in, not imported: `toast` lives in
 *  ui/app.ts, and importing it from here closed a cycle through half the app. */
export type Notify = (message: string, kind: 'success' | 'error') => void;

/** One entry as `repo.json` carries it. Mirrors `models::repo::RepoExtra`. */
export interface RepoExtra {
    kind: string;
    id: string;
    name: string;
    description?: string;
    author?: string;
    version?: string;
    file?: { relative_path: string; size: number; sha256_hash: string };
    url?: string;
    catalog_type?: string;
    locked?: boolean;
    icon?: string;
}

/** One thing the publisher can put in a repo, as the picker sees it. */
export interface ExtraCandidate {
    kind: string;
    id: string;
    name: string;
    description?: string;
    author?: string;
    version?: string;
    /** A file on disk, for something already exported. */
    file_path?: string;
    /** JSON the app already holds — an automation, a theme. */
    inline?: unknown;
    /** An address, for a catalogue or an app. */
    url?: string;
    catalog_type?: string;
}

/**
 * Write the chosen extras into a repo folder and re-sign its manifest.
 *
 * A plugin is packed here rather than in Rust because `export_plugin` already knows how to
 * build a `.bmmplug` from an installed folder, and a second implementation of that would be
 * a second thing to keep in step with the plugin format.
 */
export async function applyExtrasToRepo(
    repoDir: string,
    chosen: ExtraCandidate[],
    replace = true,
): Promise<RepoExtra[]> {
    const sources: ExtraCandidate[] = [];
    for (const c of chosen) {
        if (c.kind === 'launchpack' && !c.file_path && !c.inline) {
            const dest = `${repoDir}/.extras-staging/${c.id}.bmmlaunch`;
            await invoke('export_launch_pack', { id: c.id, destPath: dest });
            sources.push({ ...c, file_path: dest });
        } else if (c.kind === 'plugin' && !c.file_path && !c.inline) {
            // Packed into the repo folder's own staging area, so a failure leaves nothing
            // behind in the user's documents.
            // export_plugin takes the FULL destination path and returns nothing, so the
            // name is decided here — and it lands in the repo folder's own staging area, so
            // a failure leaves nothing behind in the user's documents.
            const dest = `${repoDir}/.extras-staging/${c.id}.bmmplug`;
            await invoke('export_plugin', { pluginId: c.id, destPath: dest });
            sources.push({ ...c, file_path: dest });
        } else {
            sources.push(c);
        }
    }
    return await invoke('repo_extras_apply', { repoDir, sources, replace }) as RepoExtra[];
}

/** Where a selection waits between choosing it and generating the repo. */
const PENDING_KEY = 'bmm_repo_extras_pending';

/**
 * What the next generated repo should carry.
 *
 * The picker used to WRITE, immediately, into a repo folder that had to exist already — so
 * the only way to publish a plugin with a repo was to generate the repo, then remember to
 * come back and add it, then generate again if you changed a profile. Choosing and
 * publishing were the same act, in the wrong order.
 *
 * A selection is a decision; applying it is a step. They are separate now: this holds the
 * decision, and every flow that produces or refreshes a repo folder applies it at the end.
 */
export function pendingExtras(): { chosen: ExtraCandidate[]; shares: unknown[] } {
    try {
        const raw = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
        if (raw && Array.isArray(raw.chosen)) {
            return { chosen: raw.chosen, shares: Array.isArray(raw.shares) ? raw.shares : [] };
        }
    } catch { /* corrupt or absent: nothing is pending, which is a valid answer */ }
    return { chosen: [], shares: [] };
}

/** Remember it. An empty selection CLEARS rather than storing an empty list. */
export function setPendingExtras(chosen: ExtraCandidate[], shares: unknown[]): void {
    try {
        if (!chosen.length && !shares.length) localStorage.removeItem(PENDING_KEY);
        else localStorage.setItem(PENDING_KEY, JSON.stringify({ chosen, shares }));
    } catch { /* private mode: the selection lives for this screen only */ }
    // The repo screen shows a count beside the button. It has to hear about a change it
    // did not make — an export clearing the selection is exactly that case.
    try { document.dispatchEvent(new CustomEvent('bmm:repo-extras-changed')); } catch { /* no DOM */ }
}

/**
 * Write whatever is pending into a repo folder that has just been produced or refreshed.
 *
 * Called by generate, by manifest-only, by update-from-server and by update-an-existing-repo
 * — the four things that leave a repo folder in a state worth publishing. Returns how many
 * entries landed, so the caller can say so; never throws, because a repo that was generated
 * correctly must not report failure over an extra.
 */
export async function applyPendingExtras(repoDir: string, notify?: Notify): Promise<number> {
    const { chosen, shares } = pendingExtras();
    if (!repoDir || (!chosen.length && !shares.length)) return 0;
    let n = 0;
    try {
        const packs = chosen.filter((c) => c.kind === 'modpack');
        const extras = chosen.filter((c) => c.kind !== 'modpack');
        if (extras.length) n += (await applyExtrasToRepo(repoDir, extras, true)).length;
        // `replace` is false here: generating does not un-publish what a previous run of
        // this same selection already put in, and the export has just rebuilt repo.json
        // from scratch anyway.
        if (shares.length) {
            n += await invoke('repo_modpacks_apply', { repoDir, shares, replace: true }) as number;
        }
    } catch (e) {
        // Kept, deliberately. A failure here is usually a file that has moved or a folder
        // that is not writable, and clearing the selection would make the fix "choose all
        // fourteen again" instead of "generate again".
        notify?.(`${t('repo.extras.pendingFailed')} — ${String(e).slice(0, 140)}`, 'error');
        return n;
    }
    // Applied, so it stops being pending. Without this the same selection would be written
    // into every repo generated afterwards, including ones it was never meant for.
    setPendingExtras([], []);
    return n;
}
