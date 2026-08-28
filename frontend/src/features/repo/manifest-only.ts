// Server Repo → Host → "Manifest only".
//
// The rest of the Host tab exports a repo: it copies every mod into an output folder that
// you then upload. That is the wrong shape for anyone who already runs a mod server — they
// want the one small file that describes what they are already serving, not a second copy
// of it. This card produces exactly that, and never writes into the mods folder.
//
// Two ways in, one backend call:
//   • folders on disk, used as-is;
//   • a set of profiles, which resolve to their mods folder plus the list of mod folder
//     names to include — so "publish only these profiles" is a filter, not a second path.
//
// Both are a LIST. It used to be one folder, and one folder only, which made the profile
// mode useless for the case it exists for: selecting two profiles that do not share a mods
// folder was refused outright, with an error telling the owner to publish them as separate
// repos. A collection kept in two places was equally impossible. The backend takes several
// sources now; this screen is where they are chosen.

import { invoke, pickFolder } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { formatBytes } from '../../core/utils.js';

type Mode = 'folder' | 'profile';

/** One folder to read, and which of its subfolders to take. `onlyDirs: null` = all of them. */
interface Source {
    dir: string;
    onlyDirs: string[] | null;
    label: string | null;
}

interface SourceReport {
    dir: string;
    label: string | null;
    mods: number;
    files: number;
    bytes: number;
}

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
    sources: SourceReport[];
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
/** Folder mode's chosen folders, in the order they were added. */
let folders: string[] = [];

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

/** The chosen folders, each with a way to drop it. Full path shown — a manifest built over
 *  the wrong `mods` folder of three is a valid file describing the wrong server. */
function renderFolders() {
    const list = $('manifest-folder-list');
    if (!list) return;
    if (!folders.length) {
        list.innerHTML = `<div style="font-size:11px; color:var(--text-muted); padding:4px;">${
            t('repo.manifestNoFolders') || 'No folder chosen yet'}</div>`;
        return;
    }
    list.innerHTML = folders.map((_, i) => `
        <div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
            <span class="manifest-folder-path" style="flex:1; font-size:11px; color:var(--text); word-break:break-all;"></span>
            <button class="btn btn-sm manifest-folder-drop" data-index="${i}"
                style="height:22px; padding:0 8px; font-size:10px; font-weight:700;">✕</button>
        </div>`).join('');
    // Paths are data — assigned as text, never interpolated into markup.
    list.querySelectorAll<HTMLElement>('.manifest-folder-path').forEach((el, i) => {
        el.textContent = folders[i];
    });
    list.querySelectorAll<HTMLButtonElement>('.manifest-folder-drop').forEach((b) => {
        b.addEventListener('click', () => {
            folders.splice(Number(b.dataset.index), 1);
            renderFolders();
        });
    });
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

/// What to publish: folders, or profile ids for the backend to resolve.
///
/// The profile branch used to do the resolution here — ask for every known mod, keep the ones
/// whose path string starts with the profile's mods folder, send the folder names. When that
/// matched nothing it did not fail; it sent an EMPTY list, and the backend refused it with
/// "the selection is empty" for a profile full of mods. It is one `starts_with` over paths
/// this side never normalised, and the backend already owns the rule for the full export, so
/// the ids go over as ids.
async function resolveSelection(): Promise<{ sources: Source[]; profileIds: string[] } | null> {
    if (mode === 'folder') {
        if (!folders.length) {
            toast(t('repo.manifestPickFolder') || 'Add at least one mods folder first', 'error');
            return null;
        }
        return {
            sources: folders.map((dir) => ({ dir, onlyDirs: null, label: null })),
            profileIds: [],
        };
    }

    const checked = Array.from(document.querySelectorAll<HTMLInputElement>('.manifest-profile-cb:checked'))
        .map((cb) => profiles.find((p) => p.id === cb.value))
        .filter((p): p is Profile => !!p);
    if (!checked.length) {
        toast(t('repo.manifestPickProfiles') || 'Select at least one profile', 'error');
        return null;
    }
    return { sources: [], profileIds: checked.map((p) => p.id) };
}

function renderReport(r: ManifestReport) {
    const box = $('manifest-result');
    if (!box) return;
    const line = (label: string, ids: string[], color: string) =>
        ids.length ? `<div style="color:${color}">${label}: ${ids.length} — ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? '…' : ''}</div>` : '';
    // Per folder, and only when there is more than one — a single-folder report saying
    // "folder: 12 mods" above "12 mods" is noise. With several, the line that matters is the
    // folder that contributed nothing, and a total of 312 hides it completely.
    const perSource = (r.sources || []).length > 1
        ? `<div style="margin-top:6px; border-top:1px solid var(--bmm-s08); padding-top:5px;">${
            r.sources.map((s, i) => `
                <div style="display:flex; gap:6px; align-items:baseline; color:${s.mods ? 'var(--text-muted)' : 'var(--warning)'};">
                    <span class="manifest-src-name" data-i="${i}" style="flex:1; word-break:break-all;"></span>
                    <span>${s.mods} · ${formatBytes(s.bytes)}</span>
                </div>`).join('')}</div>`
        : '';

    box.style.display = '';
    box.innerHTML = `
        <div style="color:var(--success); font-weight:700; margin-bottom:4px;">repo.json</div>
        <div style="color:var(--text-muted); word-break:break-all; margin-bottom:6px;"></div>
        <div>${r.mods} mods · ${r.files} files · ${formatBytes(r.totalBytes)}${r.modpacks ? ` · ${r.modpacks} modpacks` : ''}</div>
        ${r.signed ? '' : `<div style="color:var(--warning)">${t('repo.manifestUnsigned') || 'Written unsigned — signing key unavailable'}</div>`}
        ${line(t('repo.manifestAdded') || 'Added', r.added, 'var(--success)')}
        ${line(t('repo.manifestChanged') || 'Changed', r.changed, 'var(--warning)')}
        ${line(t('repo.manifestRemoved') || 'Removed', r.removed, 'var(--danger)')}
        ${perSource}`;
    const pathEl = box.querySelector('div:nth-child(2)');
    if (pathEl) pathEl.textContent = r.outputPath;
    // Folder paths and profile names are both user data.
    box.querySelectorAll<HTMLElement>('.manifest-src-name').forEach((el) => {
        const s = r.sources[Number(el.dataset.i)];
        el.textContent = s.label ? `${s.label} — ${s.dir}` : s.dir;
    });

    // A folder that gave nothing is the one interesting outcome of a multi-folder run: the
    // manifest is valid, the total looks plausible, and one profile's mods are simply absent.
    const empty = (r.sources || []).filter((s) => !s.mods);
    if (empty.length) {
        toast(`${t('repo.manifestEmptySource') || 'Folders that contributed no mods'}: ${
            empty.map((s) => s.label || s.dir).join(', ')}`, 'warning');
    }

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

/// Hashing a real collection is minutes of work. With nothing said, the button sat disabled
/// and the card sat empty — which reads exactly like "it does not generate anything", and was
/// reported as such for a run that was busy the whole time.
function setBusy(on: boolean, text?: string) {
    const btn = $('btn-generate-manifest') as HTMLButtonElement | null;
    if (btn) { btn.disabled = on; btn.style.opacity = on ? '0.6' : ''; }
    const box = $('manifest-progress');
    if (!box) return;
    box.style.display = on ? '' : 'none';
    if (text) { const l = $('manifest-progress-label'); if (l) l.textContent = text; }
    if (!on) {
        // Reset on the way out, or the next run opens showing the last one's last file.
        const fill = $('manifest-progress-fill');
        if (fill) fill.style.width = '0%';
        const pct = $('manifest-progress-pct');
        if (pct) pct.textContent = '0%';
        const now = $('manifest-progress-now');
        if (now) now.textContent = '';
    }
}

async function generate() {
    const selection = await resolveSelection();
    if (!selection) return;

    setBusy(true, t('repo.manifestWorking') || 'Reading the folders…');
    try {
        const outDir = ($('manifest-output-dir') as HTMLInputElement | null)?.value?.trim();
        const report = (await invoke('generate_repo_manifest', {
            args: {
                sources: selection.sources,
                profileIds: selection.profileIds,
                // Where repo.json lands. Left empty it goes beside the first folder, which is
                // what it has always done — but with several folders "beside the first" is an
                // arbitrary choice, so it is worth being able to say.
                outputPath: outDir ? `${outDir.replace(/[\\/]+$/, '')}/repo.json` : null,
                filesBaseUrl: ($('manifest-files-base-url') as HTMLInputElement | null)?.value?.trim() || null,
                filesLayout: ($('manifest-files-layout') as HTMLInputElement | null)?.value?.trim() || null,
                modpackIds: selectedModpackIds(),
                reuseExisting: true,
            },
        })) as ManifestReport;
        renderReport(report);
        // Whatever was chosen in "Include in the repo…" but had no folder to go
        // into yet. Applied HERE rather than by that screen, so choosing and
        // publishing stop being the same act in the wrong order.
        try {
            const { applyPendingExtras } = await import('./repo-pending.js');
            const n = await applyPendingExtras(outDir || '', (m, k) => toast(m, k));
            if (n) toast(t('repo.extras.applied').replace('{n}', String(n)), 'success', 6000);
        } catch { /* the repo itself succeeded; an extra must not undo that */ }
        toast(t('repo.manifestDone') || 'repo.json generated', 'success');
    } catch (e) {
        toast(String(e), 'error');
    } finally {
        setBusy(false);
    }
}

/// Attached once, at init, and left attached: the listener is cheap, and re-attaching per run
/// is how a screen ends up with six of them reporting the same folder six times.
async function listenForProgress() {
    const ev = (window as any).__TAURI__?.event;
    if (!ev?.listen) return;
    await ev.listen('bmm://repo-manifest-progress', (event: { payload: { done: number; total: number; name: string } }) => {
        const p = event.payload;
        if (!p) return;
        const box = $('manifest-progress');
        if (!box || box.style.display === 'none') return;
        const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
        const fill = $('manifest-progress-fill');
        if (fill) fill.style.width = `${pct}%`;
        const label = $('manifest-progress-pct');
        if (label) label.textContent = `${pct}%`;
        const head = $('manifest-progress-label');
        if (head) head.textContent = `${p.done}/${p.total}`;
        // The file being hashed, on its own line: it is the thing that proves the bar is
        // moving between two percentages that are the same number.
        const now = $('manifest-progress-now');
        if (now) now.textContent = p.name || '';
    });
}

export function initManifestOnly() {
    void listenForProgress();
    $('btn-manifest-mode-folder')?.addEventListener('click', () => setMode('folder'));
    $('btn-manifest-mode-profile')?.addEventListener('click', () => setMode('profile'));
    $('btn-manifest-browse')?.addEventListener('click', async () => {
        const picked = await pickFolder();
        if (!picked) return;
        // Same folder twice is a no-op rather than a duplicate row: the backend merges them,
        // so a second row would promise something the manifest does not do.
        if (folders.some((f) => f.toLowerCase() === picked.toLowerCase())) return;
        folders.push(picked);
        renderFolders();
    });
    $('btn-manifest-output')?.addEventListener('click', async () => {
        const picked = await pickFolder();
        if (picked) {
            const input = $('manifest-output-dir') as HTMLInputElement | null;
            if (input) input.value = picked;
        }
    });
    // Extras belong here as much as on the generate card. Writing a manifest on its own
    // already applies whatever is waiting (see applyPendingExtras below) — there was simply
    // no way to CHOOSE from this screen, so the only route was to open the generate card,
    // pick, and come back hoping the selection survived.
    void import('./repo-extras.js').then((m) => {
        m.mountExtrasButton(
            $('manifest-result')?.parentElement || null,
            () => ($('manifest-output-dir') as HTMLInputElement | null)?.value?.trim() || '',
        );
    });
    $('btn-generate-manifest')?.addEventListener('click', () => void generate());
    setMode('folder');
    renderFolders();
    void loadModpacks();
}
