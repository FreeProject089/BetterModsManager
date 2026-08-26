// Everything a repo carries that is not a mod, on both sides of the wire.
//
// The publishing half picks what goes in; the receiving half shows what came and installs
// the parts the user ticks. The backend (`repo_extras_write` / `repo_extras_apply` /
// `repo_extras_install`) does the bytes, the hashes and the disk; what is left here is the
// two things that cannot live there: what the user is asked, and what a catalogue means.
//
// A catalogue is the reason this file exists at all. Following one is a change to what BMM
// trusts as a source, and that is local state — it belongs where the rest of the source
// lists are written, not in a download loop in Rust.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { STORE_KEY, addSource, rememberOrigin, recordHistory } from '../catalogs/catalog-index.js';
import { writeSources } from '../catalogs/catalog-sources.js';
import { toast } from '../../ui/app.js';
import { showConfirm } from '../../ui/confirm.js';


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

/** What `repo_extras_install` reports back. */
interface ExtraInstalled {
    kind: string;
    id: string;
    name: string;
    path?: string;
    url?: string;
    catalog_type?: string;
    needs_caller: boolean;
    locked: boolean;
    unverified: boolean;
}

/**
 * Kinds this build can act on, and how each is described on screen.
 *
 * An entry whose kind is missing here is still SHOWN — named, greyed, with "this version of
 * BMM cannot install this". A repo published by a newer BMM must not look like a repo with
 * things missing from it, which is what silently hiding unknown kinds would produce.
 */
const KIND_LABEL: Record<string, string> = {
    plugin: 'repo.extras.kindPlugin',
    task: 'repo.extras.kindTask',
    theme: 'repo.extras.kindTheme',
    modlist: 'repo.extras.kindModlist',
    bundle: 'repo.extras.kindBundle',
    catalog: 'repo.extras.kindCatalog',
    app: 'repo.extras.kindApp',
};

/**
 * Ticked by default?
 *
 * No for the two kinds that are CODE. A plugin runs inside BMM and an automation runs
 * commands on the machine; syncing a repo is a decision about mods, and a default tick
 * would turn it into a decision about running a stranger's code that nobody made out loud.
 * (They also land disabled — this is the second of two locks, not the only one.)
 */
const DEFAULT_ON = (kind: string): boolean => kind !== 'plugin' && kind !== 'task';

const esc = (s: string): string =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Human size, for a line that is meant to be glanced at rather than read. */
const size = (n: number): string =>
    n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * The section on the sync screen: what this repo carries besides mods.
 *
 * Renders nothing at all when there is nothing — an empty "Also included" heading on every
 * repo is a heading people stop reading, and this one has to be noticed the day it lists a
 * plugin.
 */
export function renderRepoExtras(extras: RepoExtra[] | undefined, container: HTMLElement): void {
    const list = (extras || []).filter((e) => e && e.kind && (e.file || e.url));
    if (!list.length) return;

    const group = document.createElement('div');
    group.className = 'repo-sync-profile-group glass-card repo-extras';
    group.innerHTML = `<h4 class="repo-extras-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
        ${esc(t('repo.extras.title'))}
    </h4>
    <p class="repo-extras-lede">${esc(t('repo.extras.lede'))}</p>`;

    const rows = document.createElement('div');
    rows.className = 'repo-extras-rows';

    for (const e of list) {
        const known = !!KIND_LABEL[e.kind];
        const row = document.createElement('label');
        row.className = 'repo-extras-row' + (known ? '' : ' is-unknown');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'repo-extra-cb';
        cb.checked = known && DEFAULT_ON(e.kind);
        cb.disabled = !known;
        cb.dataset.extra = JSON.stringify(e);

        const body = document.createElement('div');
        body.className = 'repo-extras-body';

        const bits: string[] = [];
        if (e.version) bits.push(`v${esc(e.version)}`);
        if (e.author) bits.push(esc(e.author));
        if (e.file) bits.push(size(e.file.size));
        // Said before the download, not after. A locked list that arrives unannounced is a
        // file that will not open and no way to tell whether that is the point.
        if (e.locked) bits.push(esc(t('repo.extras.lockedTag')));
        // No hash in the manifest means nothing vouches for these bytes. It installs, and
        // it says so — the alternative is a silent difference between checked and unchecked.
        if (e.file && !e.file.sha256_hash) bits.push(esc(t('repo.extras.noHashTag')));

        body.innerHTML = `<span class="repo-extras-name">${esc(e.name || e.id)}</span>
            <span class="repo-extras-kind">${esc(known ? t(KIND_LABEL[e.kind]) : e.kind)}</span>
            ${bits.length ? `<span class="repo-extras-meta">${bits.join(' · ')}</span>` : ''}
            ${e.description ? `<span class="repo-extras-desc">${esc(e.description)}</span>` : ''}
            ${known ? '' : `<span class="repo-extras-desc">${esc(t('repo.extras.unknownKind'))}</span>`}`;

        row.append(cb, body);
        rows.appendChild(row);
    }

    group.appendChild(rows);
    container.appendChild(group);
}

/**
 * Install everything ticked in `container`, and report what happened in one sentence.
 *
 * Every entry is attempted even when one fails. A repo carrying six things, one of which is
 * a plugin whose hash is wrong, must still deliver the other five — abandoning the batch on
 * the first failure would make one bad entry look like a broken repo.
 */
export async function installSelectedExtras(
    container: HTMLElement,
    baseUrl: string,
    creds: { creatorId?: string | null; password?: string | null },
): Promise<{ done: number; failed: number }> {
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('.repo-extra-cb:checked'));
    let done = 0;
    let failed = 0;
    const followed: string[] = [];
    const files: ExtraInstalled[] = [];

    for (const cb of boxes) {
        let entry: RepoExtra;
        try { entry = JSON.parse(cb.dataset.extra || '{}'); } catch { failed += 1; continue; }
        try {
            const r = await invoke('repo_extras_install', {
                baseUrl,
                entry,
                creatorId: creds.creatorId || null,
                password: creds.password || null,
            }) as ExtraInstalled;
            if (r.needs_caller && r.url) {
                if (await followCatalog(r.url, r.catalog_type, baseUrl)) followed.push(r.name);
            } else if (r.needs_caller && r.path) {
                files.push(r);
            }
            done += 1;
        } catch (err) {
            failed += 1;
            // Named. "3 of 4 installed" with no name is a message that cannot be acted on.
            toast(`${entry.name || entry.id}: ${String(err)}`, 'warning', 8000);
        }
    }

    if (followed.length) {
        toast(t('repo.extras.followed').replace('{n}', String(followed.length)), 'success', 6000);
    }
    for (const f of files) await offerFile(f, baseUrl);
    if (done) toast(t('repo.extras.installed').replace('{n}', String(done)), 'success', 6000);
    return { done, failed };
}

/**
 * Follow a catalogue a repo recommends.
 *
 * Written through the same stores the "add a source" screens use, and recorded with the
 * repo as its origin — so it appears in the catalogue list with a provenance line, and can
 * be un-followed there like any other. A source added by a repo that could not be traced
 * back to it would be a source nobody can account for later.
 */
async function followCatalog(url: string, catalogType: string | undefined, via: string): Promise<boolean> {
    const type = catalogType || 'app';
    try {
        if (type === 'app') {
            await invoke('add_community_source', { url });
        } else {
            const key = STORE_KEY[type];
            if (!key) return false;
            let list: string[] = [];
            try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { list = []; }
            if (!Array.isArray(list)) list = [];
            if (!addSource(list, url)) return false;
            writeSources(key, list);
        }
        // The ORIGIN is the repo's address, not its name. It is what the catalogue list
        // shows as provenance and what un-following matches on, and two repos can perfectly
        // well be called the same thing.
        rememberOrigin(url, via);
        recordHistory({ action: 'add', type, url, via });
        return true;
    } catch {
        return false;
    }
}

/**
 * A list or a bundle arrived as a file. Ask before opening it.
 *
 * Not opened automatically, because opening one is a conversation: a locked `.mm` wants a
 * passphrase, an ordinary one may carry credentials to accept or refuse, and a bundle
 * installs entries. None of that belongs at the end of a sync, when somebody has walked
 * away from a progress bar.
 */
async function offerFile(r: ExtraInstalled, via: string): Promise<void> {
    // A BUNDLE is a catalogue in a zip — the same thing the "follow by file" button takes.
    // It is followed, not opened: what it holds changes when its author republishes it, and
    // unpacking a copy here would freeze one version of it under a name that suggests
    // otherwise. `bundle:<path>` is the exact form the catalogue screens already read.
    if (r.kind === 'bundle') {
        const ok = await showConfirm(r.name, t('repo.extras.followBundle'), false);
        if (!ok) return;
        if (await followCatalog(`bundle:${r.path}`, r.catalog_type, via)) {
            toast(t('repo.extras.followed').replace('{n}', '1'), 'success', 6000);
        }
        return;
    }
    // An automation goes through the scheduler's own importer, which restores the blocks and
    // packs its tasks call and enforces "disabled, no permissions". Rust hands it back rather
    // than installing it, because restoring those means writing localStorage.
    if (r.kind === 'task') {
        const ok = await showConfirm(r.name, t('repo.extras.openTask'), false);
        if (!ok) return;
        const { importTasksFromPath } = await import('../settings/scheduler.js');
        const n = await importTasksFromPath(r.path as string);
        toast(t('repo.extras.taskAdded').replace('{n}', String(n)), 'success', 9000);
        return;
    }

    const ok = await showConfirm(
        r.name,
        r.locked ? t('repo.extras.openLocked') : t('repo.extras.openList'),
        false,
    );
    if (!ok) return;
    const { importListAsking } = await import('../mods/modlist.js');
    await importListAsking(r.path as string);
}

// ── Publishing ────────────────────────────────────────────────────────────────

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
 * Everything on this machine that could go into a repo.
 *
 * Read from where each subsystem actually keeps its state rather than from a cache, because
 * this list is shown to somebody deciding what to publish and a stale entry here becomes a
 * missing file in the repo.
 */
export async function collectExtraCandidates(): Promise<ExtraCandidate[]> {
    const out: ExtraCandidate[] = [];

    // Plugins — the .bmmplug is rebuilt from the installed folder at publish time by
    // export_plugin, so the candidate carries the id and the exporter does the packing.
    try {
        const plugins = await invoke('get_installed_plugins') as any[];
        for (const p of plugins || []) {
            const m = p?.manifest || {};
            if (!m.id) continue;
            out.push({
                kind: 'plugin', id: String(m.id), name: String(m.name || m.id),
                description: m.description ? String(m.description) : undefined,
                author: m.author ? String(m.author) : undefined,
                version: m.version ? String(m.version) : undefined,
            });
        }
    } catch { /* a subsystem that will not answer contributes nothing, not a broken screen */ }

    // Automations — carried inline, exactly as the scheduler holds them.
    try {
        const tasks = await invoke('get_schedules') as any[];
        for (const task of tasks || []) {
            if (!task?.id) continue;
            out.push({
                kind: 'task', id: String(task.id), name: String(task.name || task.id),
                description: task.description ? String(task.description) : undefined,
                inline: { tasks: [task] },
            });
        }
    } catch { /* see above */ }

    // Themes — installed ones only. A built-in needs no publishing: the receiver has it.
    try {
        const themes = JSON.parse(await invoke('list_installed_themes') as string || '[]');
        for (const th of themes || []) {
            if (!th?.id) continue;
            out.push({
                kind: 'theme', id: String(th.id), name: String(th.name || th.id),
                author: th.author ? String(th.author) : undefined,
                version: th.version ? String(th.version) : undefined,
                inline: th,
            });
        }
    } catch { /* see above */ }

    // Catalogues followed here, offered as addresses to recommend.
    for (const [type, key] of Object.entries(STORE_KEY)) {
        let list: string[] = [];
        try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { continue; }
        for (const url of Array.isArray(list) ? list : []) {
            if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
            out.push({
                kind: 'catalog', id: url, name: shortUrl(url),
                url, catalog_type: type,
                description: t('repo.extras.catalogOf').replace('{t}', type),
            });
        }
    }

    return out;
}

/** A URL as a name: the host and the last path segment, which is what distinguishes two. */
function shortUrl(url: string): string {
    try {
        const u = new URL(url);
        const last = u.pathname.split('/').filter(Boolean).pop();
        return last ? `${u.host}/${last}` : u.host;
    } catch {
        return url;
    }
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
        if (c.kind === 'plugin' && !c.file_path && !c.inline) {
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

/**
 * The picker: what goes into this repo.
 *
 * Grouped by kind, everything unticked to start. A screen that opens with fourteen boxes
 * already ticked is a screen whose default is "publish my whole machine", and the person
 * reading it has not yet been told that catalogues travel as addresses.
 */
export async function openExtrasPicker(repoDirHint?: string): Promise<void> {
    const { pickFolder } = await import('../../core/api.js');
    const { raiseAboveAll } = await import('../../ui/layer.js');

    let repoDir = repoDirHint || '';
    if (!repoDir) {
        repoDir = (await pickFolder().catch(() => null)) as string || '';
        if (!repoDir) return;
    }

    // Read BEFORE the screen is drawn, so an empty list can say why it is empty rather than
    // appear as a screen that failed to load.
    let candidates: ExtraCandidate[] = [];
    let already: RepoExtra[] = [];
    try {
        candidates = await collectExtraCandidates();
        const manifest = await invoke('read_local_repo', { repoDir }) as any;
        already = (manifest?.extras || []) as RepoExtra[];
    } catch (e) {
        toast(`${t('repo.extras.errNoManifest')} — ${String(e).slice(0, 120)}`, 'error');
        return;
    }

    // What the repo already carries is ticked. This screen REPLACES the manifest's list, so
    // opening it and saving without touching anything must leave the repo as it was — an
    // "edit" screen that silently drops what it did not know about is a data-loss bug.
    const picked = new Set(already.map((e) => `${e.kind}:${e.id}`));
    for (const e of already) {
        if (!candidates.some((c) => c.kind === e.kind && c.id === e.id)) {
            // Carried by the repo but no longer on this machine: shown, ticked, and kept on
            // save. Dropping it because this machine has changed since would quietly
            // un-publish somebody else's download.
            candidates.push({
                kind: e.kind, id: e.id, name: e.name,
                description: e.description, author: e.author, version: e.version,
                url: e.url, catalog_type: e.catalog_type,
            });
        }
    }

    const ov = document.createElement('div');
    ov.className = 'cm-overlay';
    const draw = () => {
        const groups = new Map<string, ExtraCandidate[]>();
        for (const c of candidates) {
            if (!groups.has(c.kind)) groups.set(c.kind, []);
            (groups.get(c.kind) as ExtraCandidate[]).push(c);
        }
        const body = candidates.length
            ? Array.from(groups.entries()).map(([kind, list]) => `
                <div class="rx-group">
                    <h5 class="rx-group-title">${esc(t(KIND_LABEL[kind] || kind))} <span>${list.length}</span></h5>
                    ${list.map((c) => {
                        const key = `${c.kind}:${c.id}`;
                        return `<label class="repo-extras-row">
                            <input type="checkbox" data-key="${esc(key)}"${picked.has(key) ? ' checked' : ''}>
                            <div class="repo-extras-body">
                                <span class="repo-extras-name">${esc(c.name)}</span>
                                ${c.version ? `<span class="repo-extras-meta">v${esc(c.version)}</span>` : ''}
                                ${c.description ? `<span class="repo-extras-desc">${esc(c.description)}</span>` : ''}
                            </div>
                        </label>`;
                    }).join('')}
                </div>`).join('')
            : `<p class="repo-extras-lede">${esc(t('repo.extras.nothing'))}</p>`;

        ov.innerHTML = `<div class="cm-modal rx-modal">
            <div class="cm-head">
                <h3>${esc(t('repo.extras.pickTitle'))}</h3>
                <button class="cm-x" id="rx-close" aria-label="${esc(t('common.close'))}">&times;</button>
            </div>
            <p class="repo-extras-lede">${esc(t('repo.extras.pickHint'))}</p>
            <div class="rx-body">${body}</div>
            <div class="cm-foot">
                <span class="repo-extras-meta">${esc(repoDir)}</span>
                <button class="btn btn-sm btn-accent" id="rx-save">${esc(t('repo.extras.pickDone'))}</button>
            </div>
        </div>`;

        (ov.querySelector('#rx-close') as HTMLElement)?.addEventListener('click', close);
        ov.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((cb) => {
            cb.addEventListener('change', () => {
                const k = cb.dataset.key as string;
                if (cb.checked) picked.add(k); else picked.delete(k);
            });
        });
        (ov.querySelector('#rx-save') as HTMLElement)?.addEventListener('click', save);
    };

    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

    const save = async () => {
        const btn = ov.querySelector('#rx-save') as HTMLButtonElement | null;
        if (btn) { btn.disabled = true; btn.textContent = t('common.saving'); }
        try {
            const chosen = candidates.filter((c) => picked.has(`${c.kind}:${c.id}`));
            const written = await applyExtrasToRepo(repoDir, chosen, true);
            toast(t('repo.extras.applied').replace('{n}', String(written.length)), 'success', 6000);
            close();
        } catch (e) {
            toast(String(e), 'error', 9000);
            if (btn) { btn.disabled = false; btn.textContent = t('repo.extras.pickDone'); }
        }
    };

    draw();
    // Mounted in the window, not the body: #app-window-outer has `contain: paint`, so an
    // overlay on document.body escapes the rounded window and loses the stacking contest.
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    raiseAboveAll(ov, 11400);
    document.addEventListener('keydown', onKey, true);
}
