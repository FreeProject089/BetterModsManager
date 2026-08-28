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
import { escHtml } from '../../core/utils.js';
import { STORE_KEY, addSource, rememberOrigin, recordHistory } from '../catalogs/catalog-index.js';
import { writeSources } from '../catalogs/catalog-sources.js';
import { toast } from '../../ui/app.js';
import { showConfirm } from '../../ui/confirm.js';
import { pendingExtras, setPendingExtras, applyExtrasToRepo,
    type RepoExtra, type ExtraCandidate } from './repo-pending.js';
export { pendingExtras, setPendingExtras, applyPendingExtras, applyExtrasToRepo,
    type RepoExtra, type ExtraCandidate } from './repo-pending.js';


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
    modpack: 'repo.extras.kindModpack',
    app: 'repo.extras.kindApp',
    launchpack: 'repo.extras.kindLaunchpack',
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

    // A launch pack is a list of programs somebody else chose to start on this machine.
    // It is never installed by a sync: the import is offered, and the toast says how many
    // of those programs are not where the file says they are.
    if (r.kind === 'launchpack') {
        const ok = await showConfirm(r.name, t('repo.extras.openLaunchpack'), false);
        if (!ok) return;
        const res = await invoke('import_launch_pack', { path: r.path as string }) as
            { pack: { name: string }; missing: string[] };
        toast(res.missing?.length
            ? (t('settings.lpImportedMissing') || 'Imported "{n}" — {c} program(s) not found')
                .replace('{n}', res.pack.name).replace('{c}', String(res.missing.length))
            : (t('settings.lpImported') || 'Imported "{n}"').replace('{n}', res.pack.name),
            res.missing?.length ? 'error' : 'success', 9000);
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

    // Modpacks. NOT an extra — they are a first-class manifest field with their own share
    // rule — but they belong on this screen, which is "everything that is not a mod". They
    // were only settable on the export form, so adding one to a repo published last month
    // meant re-exporting every mod in it.
    try {
        const packs = await invoke('load_modpacks') as any[];
        for (const p of packs || []) {
            if (!p?.id) continue;
            out.push({
                kind: 'modpack', id: String(p.id), name: String(p.name || p.id),
                description: p.description ? String(p.description) : undefined,
                inline: p,
            });
        }
    } catch { /* see above */ }

    // Launch packs. Carried as a `.bmmlaunch`, built at publish time by export_launch_pack
    // the way a plugin is built by export_plugin — the candidate holds the id and the
    // exporter does the packing, so nothing is written until the user saves.
    try {
        const packs = await invoke('get_launch_packs') as any[];
        for (const p of packs || []) {
            if (!p?.id) continue;
            out.push({
                kind: 'launchpack', id: String(p.id), name: String(p.name || p.id),
                description: (t('repo.extras.lpDesc') || '{n} program(s)')
                    .replace('{n}', String((p.executable_paths || []).length)),
            });
        }
    } catch { /* none, or an older build: not an error on a picker */ }

    // Catalogues followed here. TWO kinds, and the difference is the whole point:
    //
    //   · an https catalogue is RECOMMENDED — the repo names the address and the receiver
    //     follows it, so what it holds keeps changing after the repo was published.
    //   · a `.bmmbundle` is CARRIED — the file travels inside the repo, so the receiver
    //     needs nothing except the repo they already have.
    //
    // Only the first was offered. A bundle followed here was skipped by the `https?` filter
    // and could not be published at all, which meant the one kind of catalogue that needs no
    // host was the one kind a repo could not pass on.
    for (const [type, key] of Object.entries(STORE_KEY)) {
        let list: string[] = [];
        try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { continue; }
        for (const src of Array.isArray(list) ? list : []) {
            if (typeof src !== 'string' || !src.trim()) continue;
            if (/^https?:\/\//i.test(src)) {
                out.push({
                    kind: 'catalog', id: src, name: shortUrl(src),
                    url: src, catalog_type: type,
                    description: t('repo.extras.catalogOf').replace('{t}', type),
                });
                continue;
            }
            if (src.startsWith('bundle:')) {
                const path = src.slice('bundle:'.length);
                out.push({
                    kind: 'bundle', id: `${type}-${baseName(path)}`, name: baseName(path),
                    file_path: path, catalog_type: type,
                    description: t('repo.extras.bundleOf').replace('{t}', type),
                });
            }
        }
    }

    return out;
}

/** The last path segment, on either separator. */
function baseName(p: string): string {
    return p.replace(/^.*[/\\]/, '') || p;
}

/**
 * A catalogue file to carry, chosen from disk.
 *
 * For the bundle somebody was sent and has not followed, and for the one just published from
 * the Create screen — neither is in a followed-sources list, and both are exactly what a repo
 * should be able to hand on.
 */
/**
 * Which extras kind a file on disk is, by its extension.
 *
 * The picker offered `.bmmbundle` and nothing else, so the one door for "something somebody
 * sent me" only opened for one of the six kinds a repo can carry. A `.bmmpa` in your
 * downloads could not be published without importing it into BMM first and picking it out of
 * the list again.
 *
 * Extension, not content: `repo_extras_apply` reads the bytes and the receiving side checks
 * the hash, so a mislabelled file fails there with a reason. Guessing harder here would be a
 * second opinion about what a file is, and there is already one.
 */
const FILE_KIND: Record<string, string> = {
    bmmbundle: 'bundle', zip: 'bundle',
    bmmpa: 'task',
    bmmplug: 'plugin',
    bmmtheme: 'theme',
    bmmlaunch: 'launchpack',
    mm: 'modlist', mmlist: 'modlist',
    json: 'catalog',
};

export async function pickBundleCandidate(): Promise<ExtraCandidate | null> {
    const { pickFile } = await import('../../core/api.js');
    const path = (await pickFile({
        filters: [{
            name: t('repo.extras.anyKind') || 'Anything a repo can carry',
            extensions: Object.keys(FILE_KIND),
        }],
    }).catch(() => null)) as string;
    if (!path) return null;
    const ext = baseName(path).split('.').pop()?.toLowerCase() || '';
    const kind = FILE_KIND[ext] || '';
    // A `catalog.json` is carried as a FILE, unlike a followed catalogue which travels as an
    // address — the difference the repo format already makes, and the reason the two are
    // different kinds rather than one with a flag.
    if (kind && kind !== 'bundle') {
        return {
            kind, id: baseName(path).replace(/\.[^.]+$/, ''),
            name: baseName(path),
            file_path: path,
            description: t('repo.extras.fromFile') || 'From a file on this machine',
        };
    }
    // Opened before it is offered: a zip that is not a catalogue must fail here, with a
    // reason, rather than become an entry that fails on somebody else's machine.
    try {
        const res: any = await invoke('catalog_bundle_open', { path });
        const cat = JSON.parse(String(res?.catalog || '{}'));
        const kinds = ['apps', 'plugins', 'themes', 'modpacks', 'presets', 'modlists']
            .filter((k) => Array.isArray(cat?.[k]) && cat[k].length);
        if (!kinds.length) {
            toast(t('repo.extras.bundleEmpty') || 'That bundle carries no catalogue entries.', 'warning', 7000);
            return null;
        }
        return {
            kind: 'bundle', id: baseName(path).replace(/\.[^.]+$/, ''),
            name: String(cat?.name || baseName(path)),
            file_path: path,
            catalog_type: kinds[0].replace(/s$/, ''),
            description: t('repo.extras.bundleOf').replace('{t}', kinds.join(', ')),
        };
    } catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error', 7000);
        return null;
    }
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
 * The picker: what goes into this repo.
 *
 * Grouped by kind, everything unticked to start. A screen that opens with fourteen boxes
 * already ticked is a screen whose default is "publish my whole machine", and the person
 * reading it has not yet been told that catalogues travel as addresses.
 */
/**
 * Wire an "Include in the repo…" button, wherever it sits.
 *
 * There are four surfaces that end with a repo on disk — generating one, writing a
 * manifest on its own, updating one locally, and pulling one from a server to edit and put
 * back — and the extras belong to all four. Only the first had the button, so anybody using
 * the other three had to go to the generate card, pick, come back, and hope the selection
 * survived; and adding a theme to a repo published months ago meant re-generating it.
 *
 * The wiring lives here rather than being repeated per surface. The pending tag, the
 * cross-surface refresh and the destination hint are three things that have to agree, and
 * three copies of them is three chances for one to be right and the others stale — which is
 * the shape that produced "0 element(s) added" in the first place.
 *
 * `dirHint` is a FUNCTION, not a string: the destination field is typed into after this runs,
 * and reading it at wire time would pin the hint to whatever was there when the page drew.
 */
export function wireExtrasButton(btn: HTMLElement, dirHint: () => string): void {
    if (btn.dataset.extrasWired) return;
    btn.dataset.extrasWired = '1';

    const showPending = async (): Promise<void> => {
        const n = pendingExtras().chosen.length;
        let tag = btn.nextElementSibling as HTMLElement | null;
        if (tag && !tag.classList.contains('repo-extras-pending')) tag = null;
        if (!n) { tag?.remove(); return; }
        if (!tag) {
            tag = document.createElement('span');
            tag.className = 'repo-extras-pending';
            btn.insertAdjacentElement('afterend', tag);
        }
        tag.textContent = (t('repo.extras.pendingTag') || '{n} waiting').replace('{n}', String(n));
        tag.title = t('repo.extras.destLaterTip') || '';
    };

    void showPending();
    // Every surface that WRITES the extras fires this, so a tag on a card nobody is looking
    // at is still correct when they look.
    document.addEventListener('bmm:repo-extras-changed', () => { void showPending(); });
    btn.addEventListener('click', async () => {
        await openExtrasPicker(dirHint() || undefined);
        void showPending();
    });
}

/**
 * Build one and put it in `host`.
 *
 * Same markup as the generate card's, which is in index.html because the tutorial anchors on
 * it by id. Built here for the other three so the copy that exists in HTML stays the only
 * one anybody has to keep in step with the stylesheet.
 */
export function mountExtrasButton(host: HTMLElement | null, dirHint: () => string): void {
    if (!host || host.querySelector('.repo-extras-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm repo-extras-btn';
    btn.style.cssText = 'width:100%;justify-content:center;margin-top:8px;';
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M20 7h-9"/><path d="M14 17H5"/>
            <circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>
        </svg><span>${escHtml(t('repo.extras.pick') || 'Include in the repo\u2026')}</span>`;
    host.appendChild(btn);
    wireExtrasButton(btn, dirHint);
}

export async function openExtrasPicker(repoDirHint?: string): Promise<void> {
    const { pickFolder } = await import('../../core/api.js');
    const { raiseAboveAll } = await import('../../ui/layer.js');

    // The destination is chosen INSIDE this screen, not before it.
    //
    // Clicking "include in the repo" used to open a Windows folder picker first, whenever
    // the export-path field happened to be empty — so the answer to "what can I include?"
    // was a file explorer, and the list of includable things only appeared after you had
    // already committed to a folder. The list does not depend on the folder at all.
    let repoDir = repoDirHint || '';

    // What this machine could publish. Read first, and never blocked on having a
    // destination: an empty list must be able to say WHY it is empty rather than look like
    // a screen that failed to load.
    let candidates: ExtraCandidate[] = [];
    try {
        candidates = await collectExtraCandidates();
    } catch (e) {
        toast(`${t('common.error')} — ${String(e).slice(0, 120)}`, 'error');
        return;
    }

    // What the chosen repo already carries. Re-read every time the destination changes,
    // because "already ticked" is a fact about THAT repo and carrying it across from
    // another one would publish things nobody asked for.
    let already: RepoExtra[] = [];

    const picked = new Set<string>();
    /**
     * The ticks the PERSON made, as opposed to the ones a destination brought with it.
     *
     * Changing the destination re-reads that repo and re-seeds what is ticked — and the
     * first version of that wiped everything, including the twelve boxes somebody had just
     * gone through before choosing where to put them. They pressed Save and were told
     * "0 added". Kept apart so a re-seed replaces only the seeded half.
     */
    const userPicked = new Set<string>();
    // Per-modpack share rule, seeded from what the destination repo already publishes so
    // opening the screen and saving without touching anything leaves it exactly as it was.
    const shareModes: Record<string, string> = {};
    const whitelists: Record<string, string[]> = {};
    /** Why the destination could not be read, as something to print rather than a toast. */
    let destError = '';

    /**
     * Read a destination repo and seed what is ticked from it.
     *
     * Runs again whenever the destination changes, and clears first: "already ticked" is a
     * fact about ONE repo, and carrying a tick over from the folder you looked at before
     * would publish something nobody chose.
     */
    const seedFrom = async (dir: string): Promise<void> => {
        picked.clear();
        // Whatever was ticked by hand comes straight back. Only the destination's own
        // contribution is being replaced here.
        for (const k of userPicked) picked.add(k);
        for (const k of Object.keys(shareModes)) delete shareModes[k];
        for (const k of Object.keys(whitelists)) delete whitelists[k];
        destError = '';
        already = [];
        if (!dir) {
            // No destination: what is waiting for the next generated repo IS the answer to
            // "what is already included", so reopening shows it ticked rather than blank.
            // Without this a selection made yesterday looked like no selection at all, and
            // the only way to see it was the badge beside the button.
            for (const c of pendingExtras().chosen) {
                const key = `${c.kind}:${c.id}`;
                picked.add(key);
                if (!candidates.some((x) => x.kind === c.kind && x.id === c.id)) candidates.push(c);
            }
            return;
        }
        try {
            const manifest = await invoke('read_local_repo', { repoDir: dir }) as any;
            already = (manifest?.extras || []) as RepoExtra[];
        } catch (e) {
            // Named on the screen, not thrown away. "That folder is not a repo" is the
            // answer somebody needs while they still have the browse button in front of
            // them — a toast that fired before the screen existed was unactionable.
            destError = String(e).slice(0, 160);
            return;
        }
        // What the repo already carries is ticked. This screen REPLACES the manifest's
        // list, so opening it and saving without touching anything must leave the repo as
        // it was — an "edit" screen that silently drops what it did not know about is a
        // data-loss bug.
        for (const e of already) {
            picked.add(`${e.kind}:${e.id}`);
            if (!candidates.some((c) => c.kind === e.kind && c.id === e.id)) {
                // Carried by the repo but no longer on this machine: shown, ticked, and
                // kept on save. Dropping it because this machine has changed since would
                // quietly un-publish somebody else's download.
                candidates.push({
                    kind: e.kind, id: e.id, name: e.name,
                    description: e.description, author: e.author, version: e.version,
                    url: e.url, catalog_type: e.catalog_type,
                });
            }
        }
        try {
            const current = await invoke('repo_modpacks_read', { repoDir: dir }) as any[];
            for (const sh of current || []) {
                const id = String(sh?.modpack?.id || '');
                if (!id) continue;
                shareModes[id] = String(sh.share_mode || 'public');
                if (Array.isArray(sh.custom_whitelist)) whitelists[id] = sh.custom_whitelist.map(String);
                // Already published: ticked, like the extras it sits beside.
                picked.add(`modpack:${id}`);
                if (!candidates.some((c) => c.kind === 'modpack' && c.id === id)) {
                    // Shared by the repo but no longer on this machine. Kept rather than
                    // silently un-published, the same rule the extras use.
                    candidates.push({ kind: 'modpack', id, name: String(sh.modpack?.name || id), inline: sh.modpack });
                }
            }
        } catch { /* no manifest yet, or none shared: an empty list is the right answer */ }
    };

    await seedFrom(repoDir);

    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
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
                                ${c.kind === 'modpack' ? `
                                <span class="rx-share">
                                    <select class="input input-sm rx-share-mode" data-id="${esc(c.id)}">
                                        <option value="public"${(shareModes[c.id] || 'public') === 'public' ? ' selected' : ''}>${esc(t('modpack.sharePublic') || 'Public')}</option>
                                        <option value="whitelist_repo"${shareModes[c.id] === 'whitelist_repo' ? ' selected' : ''}>${esc(t('modpack.shareWhitelistRepo') || 'Repo whitelist')}</option>
                                        <option value="whitelist_custom"${shareModes[c.id] === 'whitelist_custom' ? ' selected' : ''}>${esc(t('modpack.shareWhitelistCustom') || 'Custom whitelist')}</option>
                                    </select>
                                    <input type="text" class="input input-sm rx-share-wl" data-id="${esc(c.id)}"
                                        placeholder="${esc(t('modpack.shareWhitelistPh') || 'ids, comma separated')}"
                                        value="${esc((whitelists[c.id] || []).join(', '))}"
                                        ${shareModes[c.id] === 'whitelist_custom' ? '' : 'hidden'}>
                                </span>` : ''}
                            </div>
                        </label>`;
                    }).join('')}
                </div>`).join('')
            : `<p class="repo-extras-lede">${esc(t('repo.extras.nothing'))}</p>`;

        ov.innerHTML = `<div class="modal glass cm-modal rx-modal">
            <div class="modal-header">
                <h3>${esc(t('repo.extras.pickTitle'))}</h3>
                <button class="modal-close" type="button" id="rx-close" aria-label="${esc(t('common.close'))}">&times;</button>
            </div>
            <div class="modal-body rx-body">
                <p class="repo-extras-lede">${esc(t('repo.extras.pickHint'))}</p>
                ${body}
            </div>
            <div class="rx-dest">
                <span class="rx-dest-label">${esc(t('repo.extras.dest'))}</span>
                <span class="rx-dest-path${repoDir ? '' : ' is-empty'}">${
                    esc(repoDir || t('repo.extras.destLater'))}</span>
                <button class="btn btn-sm btn-ghost" id="rx-dest-pick">${esc(t('repo.extras.destPick'))}</button>
            </div>
            ${destError ? `<p class="rx-dest-err">${esc(destError)}</p>` : ''}
            <div class="modal-footer">
                <!-- A bundle that was sent to you, or one just published from the Create
                     screen: neither is in a followed-sources list, and both are exactly what
                     a repo should be able to hand on. -->
                <button class="btn btn-sm btn-ghost" id="rx-add-bundle">${esc(t('repo.extras.addBundle') || 'Carry a catalogue file…')}</button>
                <button class="btn btn-sm btn-accent" id="rx-save">${
                    esc(repoDir ? t('repo.extras.pickDone') : t('repo.extras.pickLater'))}</button>
            </div>
        </div>`;

        (ov.querySelector('#rx-close') as HTMLElement)?.addEventListener('click', close);
        (ov.querySelector('#rx-dest-pick') as HTMLElement)?.addEventListener('click', async () => {
            const dir = (await pickFolder().catch(() => null)) as string || '';
            if (!dir) return;      // cancelled: the screen stays exactly as it was
            repoDir = dir;
            await seedFrom(repoDir);
            draw();
        });
        // No folder is no longer a dead end: the selection is kept and applied by whatever
        // produces the repo next. The button says which of the two it is doing.
        const saveBtn = ov.querySelector('#rx-save') as HTMLButtonElement | null;
        if (saveBtn && !repoDir) saveBtn.title = t('repo.extras.destLaterTip');
        (ov.querySelector('#rx-add-bundle') as HTMLElement)?.addEventListener('click', async () => {
            const c = await pickBundleCandidate();
            if (!c) return;
            const key = `${c.kind}:${c.id}`;
            if (!candidates.some((x) => `${x.kind}:${x.id}` === key)) candidates.push(c);
            picked.add(key);      // chosen by the act of picking it
            draw();
        });
        ov.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((cb) => {
            cb.addEventListener('change', () => {
                const k = cb.dataset.key as string;
                if (cb.checked) { picked.add(k); userPicked.add(k); }
                else { picked.delete(k); userPicked.delete(k); }
            });
        });
        ov.querySelectorAll<HTMLSelectElement>('.rx-share-mode').forEach((sel) => {
            sel.addEventListener('change', () => {
                const id = sel.dataset.id as string;
                shareModes[id] = sel.value;
                // The whitelist field only means something for one of the three modes, so it
                // appears with it rather than sitting there greyed and unexplained.
                const wl = ov.querySelector<HTMLInputElement>(`.rx-share-wl[data-id="${CSS.escape(id)}"]`);
                if (wl) wl.hidden = sel.value !== 'whitelist_custom';
            });
        });
        ov.querySelectorAll<HTMLInputElement>('.rx-share-wl').forEach((inp) => {
            inp.addEventListener('input', () => {
                whitelists[inp.dataset.id as string] =
                    inp.value.split(',').map((x) => x.trim()).filter(Boolean);
            });
        });
        (ov.querySelector('#rx-save') as HTMLElement)?.addEventListener('click', save);
    };

    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    // Clicking the dimmed area closes it, like every other dialog in BMM. `e.target === ov`
    // and not `contains`: a click that STARTED inside and drifted out while dragging a
    // whitelist field would otherwise close the screen mid-edit.
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

    const save = async () => {
        const btn = ov.querySelector('#rx-save') as HTMLButtonElement | null;
        if (btn) { btn.disabled = true; btn.textContent = t('common.saving'); }
        try {
            const chosen = candidates.filter((c) => picked.has(`${c.kind}:${c.id}`));
            // No folder chosen: this is a DECISION, kept until something produces a repo.
            // Generating, manifest-only, update-from-server and update-an-existing-repo all
            // apply it at the end.
            if (!repoDir) {
                const packs0 = chosen.filter((c) => c.kind === 'modpack');
                setPendingExtras(chosen, packs0.map((c) => ({
                    modpack: c.inline,
                    share_mode: shareModes[c.id] || 'public',
                    custom_whitelist: (shareModes[c.id] === 'whitelist_custom' && whitelists[c.id]?.length)
                        ? whitelists[c.id] : null,
                })));
                toast(t('repo.extras.pending').replace('{n}', String(chosen.length)), 'success', 7000);
                close();
                return;
            }
            // Two destinations, because they are two different things in the manifest: an
            // extra is a file under `extras/` listed in `repo.extras`, a modpack is an entry
            // in `repo.modpacks` with its own share rule. Both re-sign the manifest.
            const packs = chosen.filter((c) => c.kind === 'modpack');
            const extras = chosen.filter((c) => c.kind !== 'modpack');
            const written = await applyExtrasToRepo(repoDir, extras, true);
            const shares = packs.map((c) => ({
                modpack: c.inline,
                share_mode: shareModes[c.id] || 'public',
                custom_whitelist: (shareModes[c.id] === 'whitelist_custom' && whitelists[c.id]?.length)
                    ? whitelists[c.id] : null,
            }));
            // Sent even when empty: this screen shows the whole list and the user edits it, so
            // unticking the last modpack has to mean the repo stops sharing it.
            const nPacks = await invoke('repo_modpacks_apply', { repoDir, shares, replace: true }) as number;
            toast(t('repo.extras.applied').replace('{n}', String(written.length + nPacks)), 'success', 6000);
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
