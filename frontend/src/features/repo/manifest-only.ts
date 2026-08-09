// Server Repo → Host → "Manifest only".
//
// The rest of the Host tab exports a repo: it copies every mod into an output folder that
// you then upload. That is the wrong shape for anyone who already runs a mod server — they
// want the one small file that describes what they are already serving, not a second copy
// of it. This card produces exactly that, and never writes into the mods folder.
//
// Two ways in, one backend call:
//   • a folder on disk, used as-is;
//   • a set of profiles, which resolve to their mods folder plus the list of mod folder
//     names to include — so "publish only these profiles" is a filter, not a second path.

import { invoke, pickFolder } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { formatBytes } from '../../core/utils.js';

type Mode = 'folder' | 'profile';

interface ManifestReport {
    outputPath: string;
    mods: number;
    files: number;
    totalBytes: number;
    added: string[];
    removed: string[];
    changed: string[];
    modpacks: number;
    modpacksSkipped: string[];
    signed: boolean;
}

interface Profile {
    id: string;
    name: string;
    mods_path: string;
}

interface Modpack {
    id: string;
    name: string;
}

let mode: Mode = 'folder';
let profiles: Profile[] = [];
let modpacks: Modpack[] = [];

const $ = (id: string) => document.getElementById(id);

function setMode(next: Mode) {
    mode = next;
    const folderBtn = $('btn-manifest-mode-folder');
    const profileBtn = $('btn-manifest-mode-profile');
    folderBtn?.classList.toggle('btn-primary', next === 'folder');
    profileBtn?.classList.toggle('btn-primary', next === 'profile');
    const folderBlock = $('manifest-folder-block');
    const profileBlock = $('manifest-profile-block');
    if (folderBlock) folderBlock.style.display = next === 'folder' ? '' : 'none';
    if (profileBlock) profileBlock.style.display = next === 'profile' ? '' : 'none';
    if (next === 'profile') void loadProfiles();
}

async function loadModpacks() {
    const list = $('manifest-modpack-list');
    if (!list) return;
    try {
        modpacks = (await invoke('load_modpacks')) as Modpack[];
    } catch {
        modpacks = [];
    }
    if (!modpacks.length) {
        list.textContent = t('repo.manifestNoModpacks') || 'No modpacks yet';
        list.setAttribute('style', list.getAttribute('style') + ';font-size:11px;color:var(--text-muted);');
        return;
    }
    list.innerHTML = modpacks.map((m) => `
        <label style="display:flex; align-items:center; gap:8px; padding:4px; cursor:pointer; font-size:11px; color:var(--text);">
            <input type="checkbox" class="manifest-modpack-cb" value="${m.id}" style="margin:0;">
            <span></span>
        </label>`).join('');
    // Pack names are user data — assigned as text, never interpolated into markup.
    list.querySelectorAll('label').forEach((label, i) => {
        const span = label.querySelector('span');
        if (span) span.textContent = modpacks[i].name;
    });
}

function selectedModpackIds(): string[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>('.manifest-modpack-cb:checked'))
        .map((cb) => cb.value);
}

async function loadProfiles() {
    const list = $('manifest-profile-list');
    if (!list) return;
    try {
        profiles = (await invoke('get_profiles')) as Profile[];
    } catch {
        profiles = [];
    }
    if (!profiles.length) {
        list.innerHTML = `<div style="font-size:11px; color:var(--text-muted); padding:4px;">${t('repo.manifestNoProfiles') || 'No profiles'}</div>`;
        return;
    }
    list.innerHTML = profiles.map((p) => `
        <label style="display:flex; align-items:center; gap:8px; padding:4px; cursor:pointer; font-size:11px; color:var(--text);">
            <input type="checkbox" class="manifest-profile-cb" value="${p.id}" style="margin:0;">
            <span></span>
        </label>`).join('');
    // Names are user data — set as text so a profile called `<img onerror=…>` stays a name.
    list.querySelectorAll('label').forEach((label, i) => {
        const span = label.querySelector('span');
        if (span) span.textContent = profiles[i].name;
    });
}

/// Which mod folder names to publish, and which directory they live in.
///
/// Profiles sharing one mods folder are merged; profiles pointing at different folders are
/// refused rather than silently publishing only the first, since the manifest describes a
/// single directory and the other profiles' mods would just be missing.
async function resolveSelection(): Promise<{ modsDir: string; onlyDirs: string[] | null } | null> {
    if (mode === 'folder') {
        const dir = ($('manifest-mods-dir') as HTMLInputElement | null)?.value?.trim();
        if (!dir) {
            toast(t('repo.manifestPickFolder') || 'Choose the mods folder first', 'error');
            return null;
        }
        return { modsDir: dir, onlyDirs: null };
    }

    const checked = Array.from(document.querySelectorAll<HTMLInputElement>('.manifest-profile-cb:checked'))
        .map((cb) => profiles.find((p) => p.id === cb.value))
        .filter((p): p is Profile => !!p);
    if (!checked.length) {
        toast(t('repo.manifestPickProfiles') || 'Select at least one profile', 'error');
        return null;
    }

    const dirs = [...new Set(checked.map((p) => p.mods_path))];
    if (dirs.length > 1) {
        toast(t('repo.manifestMixedFolders') || 'Those profiles use different mods folders — publish them as separate repos', 'error');
        return null;
    }

    let names: string[] = [];
    try {
        const all = (await invoke('get_all_mods')) as Array<{ mod_folder_path: string }>;
        const prefix = dirs[0].replace(/[\\/]+$/, '');
        names = all
            .map((m) => m.mod_folder_path)
            .filter((p) => p.startsWith(prefix))
            .map((p) => p.slice(prefix.length).replace(/^[\\/]+/, '').split(/[\\/]/)[0])
            .filter(Boolean);
        names = [...new Set(names)];
    } catch {
        names = [];
    }
    // An empty resolution is refused by the backend too — publishing "everything" because a
    // selection resolved to nothing is how a private mod reaches a public server.
    return { modsDir: dirs[0], onlyDirs: names };
}

function renderReport(r: ManifestReport) {
    const box = $('manifest-result');
    if (!box) return;
    const line = (label: string, ids: string[], color: string) =>
        ids.length ? `<div style="color:${color}">${label}: ${ids.length} — ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? '…' : ''}</div>` : '';
    box.style.display = '';
    box.innerHTML = `
        <div style="color:var(--success); font-weight:700; margin-bottom:4px;">repo.json</div>
        <div style="color:var(--text-muted); word-break:break-all; margin-bottom:6px;"></div>
        <div>${r.mods} mods · ${r.files} files · ${formatBytes(r.totalBytes)}${r.modpacks ? ` · ${r.modpacks} modpacks` : ''}</div>
        ${r.signed ? '' : `<div style="color:var(--warning)">${t('repo.manifestUnsigned') || 'Written unsigned — signing key unavailable'}</div>`}
        ${line(t('repo.manifestAdded') || 'Added', r.added, 'var(--success)')}
        ${line(t('repo.manifestChanged') || 'Changed', r.changed, 'var(--warning)')}
        ${line(t('repo.manifestRemoved') || 'Removed', r.removed, 'var(--danger)')}`;
    const pathEl = box.querySelector('div:nth-child(2)');
    if (pathEl) pathEl.textContent = r.outputPath;

    // Removals are the one outcome worth interrupting for: a mistyped path produces a
    // perfectly valid manifest that publishes an empty server, and it looks like success.
    // A skipped modpack is silent otherwise, and a repo missing the pack people were told
    // to install looks like the repo is broken rather than like a selection problem.
    if (r.modpacksSkipped.length) {
        toast(`${t('repo.manifestPacksSkipped') || 'Modpacks left out (mods not published)'}: ${r.modpacksSkipped.join(', ')}`, 'warning');
    }
    if (r.removed.length) {
        toast(`${r.removed.length} ${t('repo.manifestRemovedWarn') || 'mods are no longer in the folder and were dropped from the manifest'}`, 'warning');
    }
}

async function generate() {
    const btn = $('btn-generate-manifest') as HTMLButtonElement | null;
    const selection = await resolveSelection();
    if (!selection) return;

    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    try {
        const report = (await invoke('generate_repo_manifest', {
            args: {
                modsDir: selection.modsDir,
                onlyDirs: selection.onlyDirs,
                filesBaseUrl: ($('manifest-files-base-url') as HTMLInputElement | null)?.value?.trim() || null,
                filesLayout: ($('manifest-files-layout') as HTMLInputElement | null)?.value?.trim() || null,
                modpackIds: selectedModpackIds(),
                reuseExisting: true,
            },
        })) as ManifestReport;
        renderReport(report);
        toast(t('repo.manifestDone') || 'repo.json generated', 'success');
    } catch (e) {
        toast(String(e), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}

export function initManifestOnly() {
    $('btn-manifest-mode-folder')?.addEventListener('click', () => setMode('folder'));
    $('btn-manifest-mode-profile')?.addEventListener('click', () => setMode('profile'));
    $('btn-manifest-browse')?.addEventListener('click', async () => {
        const picked = await pickFolder();
        if (picked) {
            const input = $('manifest-mods-dir') as HTMLInputElement | null;
            if (input) input.value = picked;
        }
    });
    $('btn-generate-manifest')?.addEventListener('click', () => void generate());
    setMode('folder');
    void loadModpacks();
}
