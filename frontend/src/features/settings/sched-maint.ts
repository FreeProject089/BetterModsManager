// The upkeep steps of scheduled tasks — the part that talks to the app.
//
// Five steps used to be five buttons somebody had to remember to press: check the repos you
// follow, look for new versions of the catalogue items you installed, verify the mods, clean
// the caches, see where the disk went. Each already had its backend (repo_follow_check,
// fetch_*_catalog + install_*, verify_integrity / get_mod_integrity, tools_cache_*,
// tools_disk_usage); what was missing was a way to run them on a schedule and get an answer a
// condition can read. This module holds the logic; scheduler.ts's runAction calls it and writes
// the numbers into the run, where the editor, the checks and the reference can see them.
//
// Every function here takes `dry` where doing and looking differ, and with it only LOOKS. The
// dry run (sched-dryrun.ts) and a step with « dryRun » set both go through that path, so « what
// would happen » is answered by the same code that would make it happen.
//
// Catalogue updates are deliberately narrow. Only what the person TICKED when writing the task
// is looked at — never « everything installed » — and only entries carrying a SHA-256 are
// downloaded or installed unattended, the same rule as the plugin auto-update. An app whose
// payload is an installer (exe / msi) is downloaded at most: its wizard needs a person.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { getLinks, catalogSources } from '../../core/links-config.js';
import { enabledOnly } from '../catalogs/catalog-index.js';
import { isNewerVersion } from '../apps/app-version.js';
import { unattendedRefusal } from '../catalogs/catalog-consent.js';

const tx = (key: string, fallback: string): string => {
    const v = t(key);
    return v && v !== key ? v : fallback;
};

/** A size people read: 1.2 GB, 340 MB, 12 KB. */
export function humanBytes(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

// ── Followed repos ───────────────────────────────────────────────────────────────────────────

interface FollowedRepo { url: string; name: string; follow: { enabled: boolean; action: string; lastUpdates?: number }; due: boolean }
interface FollowCheck { url: string; name: string; notModified: boolean; updates: unknown[]; action: string; error: string | null }

export interface FollowSummary {
    checked: number;
    updates: number;
    errors: number;
    /** One line per repo with something to say. */
    lines: string[];
}

/**
 * Check the repos you follow.
 *
 *   report  read each one, install nothing (the dry run is this too);
 *   auto    the same read, then — when something has an update — Server Repo's own « Check
 *           now » pass, which does for each repo what ITS follow settings say (notify, download
 *           or apply) and holds back while a game runs. One installer, the follower's own;
 *   ask     is `report` here; the runner asks afterwards, with the count in front of you.
 *
 * `only` narrows it to some addresses; empty means every followed repo that is switched on.
 * Returns `applied: true` when the auto pass was started.
 */
export async function checkFollowedRepos(mode: string, only: string[], cancelled?: () => boolean): Promise<FollowSummary & { applied: boolean }> {
    const list = (await invoke('repo_follow_list').catch(() => [])) as FollowedRepo[];
    const want = only.map((u) => u.trim().toLowerCase()).filter(Boolean);
    const repos = (list || []).filter((r) => r.follow?.enabled && (!want.length || want.includes(r.url.toLowerCase())));
    const out: FollowSummary & { applied: boolean } = { checked: 0, updates: 0, errors: 0, lines: [], applied: false };
    for (const r of repos) {
        if (cancelled?.()) break;
        const name = r.name || r.url;
        const res = (await invoke('repo_follow_check', { url: r.url, password: null, force: false })
            .catch((e) => ({ url: r.url, name, notModified: false, updates: [], action: '', error: String(e) }))) as FollowCheck | null;
        out.checked++;
        if (!res) continue;
        if (res.error) {
            out.errors++;
            out.lines.push(t('sched.rf.lineErr', { name, err: res.error }));
            continue;
        }
        // Not modified since the last look: the updates found then are still waiting.
        const n = res.notModified ? Number(r.follow?.lastUpdates || 0) : (res.updates || []).length;
        if (n) {
            out.updates += n;
            out.lines.push(t('sched.rf.line', { name, n: String(n) }));
        }
    }
    if (mode === 'auto' && out.updates > 0 && !cancelled?.()) {
        // The follow card lives in the static page and is wired at start-up, so its button works
        // whether or not Server Repo is on screen.
        const btn = document.getElementById('btn-repo-follow-check-all') as HTMLButtonElement | null;
        if (btn && !btn.disabled) { btn.click(); out.applied = true; }
    }
    return out;
}

// ── Catalogue items ──────────────────────────────────────────────────────────────────────────

export interface CatItem {
    /** `app:<id>` or `plugin:<id>` — what a task stores. */
    key: string;
    kind: 'app' | 'plugin';
    id: string;
    name: string;
    version: string;
}

export interface CatUpdate {
    item: CatItem;
    version: string;
    url: string;
    sha256: string;
    /** zip | exe | msi | script (apps); empty for plugins. */
    fileType: string;
    entry: any;
}

/** The installed items that came from a catalogue — the ones a task can be told to follow. */
export async function listSubscribed(): Promise<CatItem[]> {
    const out: CatItem[] = [];
    const apps = (await invoke('get_apps_state').catch(() => null)) as { installed?: Record<string, { id: string; title: string; version?: string | null }> } | null;
    for (const a of Object.values(apps?.installed || {})) {
        out.push({ key: `app:${a.id}`, kind: 'app', id: a.id, name: a.title || a.id, version: a.version || '' });
    }
    const plugins = (await invoke('get_installed_plugins').catch(() => [])) as { manifest?: { id: string; name?: string; version?: string } }[];
    for (const p of plugins || []) {
        const id = p?.manifest?.id;
        if (!id) continue;
        // Only a plugin installed FROM a catalogue has somewhere to look for a newer version.
        let src: string | null = null;
        try { src = localStorage.getItem('bmm_plugin_src_' + id); } catch { src = null; }
        if (!src) continue;
        out.push({ key: `plugin:${id}`, kind: 'plugin', id, name: p.manifest?.name || id, version: p.manifest?.version || '' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function appCatalogue(): Promise<any[]> {
    const official = catalogSources('apps_catalog' as any);
    const state = (await invoke('get_apps_state').catch(() => null)) as { community_sources?: string[] } | null;
    const extra = enabledOnly(state?.community_sources || []).filter((u) => !u.startsWith('bundle:'));
    if (!official.length && !extra.length) return [];
    // A v2 signed feed reads without its keys pinned too (flagged, not refused); the App Catalog
    // screen pins them on its first visit, and this does not import it to stay out of its graph.
    const raw = (await invoke('fetch_app_catalogs', { catalogUrl: official[0] || '', extraCommunityUrls: [...official.slice(1), ...extra] })) as { apps?: any[] };
    return raw?.apps || [];
}

async function pluginCatalogue(): Promise<any[]> {
    const sources = [getLinks().plugin_catalog];
    try {
        const mine = JSON.parse(localStorage.getItem('bmm_plugin_catalogs') || '[]');
        if (Array.isArray(mine)) for (const s of mine) if (typeof s === 'string' && s.trim()) sources.push(s.trim());
    } catch { /* no community catalogues */ }
    const out: any[] = [];
    for (const src of sources.filter(Boolean)) {
        try {
            const cat = (await invoke('fetch_plugin_catalog', { catalogUrl: src })) as { plugins?: any[] };
            for (const p of cat?.plugins || []) if (p?.id && !out.some((x) => x.id === p.id)) out.push(p);
        } catch { /* one catalogue down is not all of them */ }
    }
    return out;
}

/** Which of `items` have a newer version in their catalogue. Network reads only. */
export async function findCatalogUpdates(items: CatItem[]): Promise<{ updates: CatUpdate[]; errors: string[] }> {
    const updates: CatUpdate[] = [];
    const errors: string[] = [];
    if (items.some((i) => i.kind === 'app')) {
        try {
            const entries = await appCatalogue();
            for (const it of items.filter((i) => i.kind === 'app')) {
                const e = entries.find((x) => x?.id === it.id);
                if (!e || !e.version || !isNewerVersion(e.version, it.version)) continue;
                updates.push({ item: it, version: String(e.version), url: String(e.download?.url || ''), sha256: String(e.download?.sha256 || ''), fileType: String(e.download?.file_type || ''), entry: e });
            }
        } catch (e) { errors.push(t('sched.cu.errApps', { e: String(e) })); }
    }
    if (items.some((i) => i.kind === 'plugin')) {
        try {
            const entries = await pluginCatalogue();
            for (const it of items.filter((i) => i.kind === 'plugin')) {
                const e = entries.find((x) => x?.id === it.id);
                if (!e || !e.version || String(e.version) === it.version) continue;
                let src: string | null = null;
                try { src = localStorage.getItem('bmm_plugin_src_' + it.id); } catch { src = null; }
                updates.push({ item: it, version: String(e.version), url: String(e.download_url || src || ''), sha256: String(e.sha256 || ''), fileType: '', entry: e });
            }
        } catch (e) { errors.push(t('sched.cu.errPlugins', { e: String(e) })); }
    }
    return { updates, errors };
}

/**
 * Why an update may not be fetched or installed unattended, or null.
 *
 * The https + SHA-256 rule is the catalogue's own (catalog-consent.ts `unattendedRefusal`, the
 * same function `catalogInstall` applies), so a task and a plugin are held to one rule. The two
 * extra lines are about doing it WITHOUT a person: an installer wizard, and a bundle file.
 */
export function unattendedProblem(u: CatUpdate, install: boolean): string | null {
    if (!u.url) return t('sched.cu.noUrl');
    const why = unattendedRefusal(u.item.kind, u.entry || { download_url: u.url, sha256: u.sha256 });
    if (why) return t(why);
    if (install && u.item.kind === 'app' && /^(exe|msi)$/i.test(u.fileType)) return t('sched.cu.wizard');
    if (u.entry?._local) return t('sched.cu.bundle');
    return null;
}

/** Download one update into the task's folder (checksum verified in Rust). Returns its path. */
export async function downloadCatalogUpdate(u: CatUpdate, taskId: string, outputDir: string | null): Promise<string> {
    const ext = u.item.kind === 'plugin' ? 'zip' : (u.fileType || 'bin');
    const name = `${u.item.id}-${u.version}.${ext}`.replace(/[^\w.-]+/g, '_');
    const r = (await invoke('sched_download', { taskId, outputDir, url: u.url, sha256: u.sha256, fileName: name, maxMb: null })) as { path: string };
    return r.path;
}

/**
 * Install one update through the catalogue's single door (catalog-actions.ts `catalogInstall`,
 * `source: 'task'`): the unattended limits there apply — https, a published SHA-256, a plugin
 * lands disabled. An app goes back into the folder it was installed in.
 */
export async function installCatalogUpdate(u: CatUpdate, taskId: string): Promise<void> {
    let installPath: string | undefined;
    if (u.item.kind === 'app') {
        const state = (await invoke('get_apps_state').catch(() => null)) as { installed?: Record<string, { install_path?: string; is_managed?: boolean }> } | null;
        const inst = state?.installed?.[u.item.id];
        // A managed install lives at <folder>/<id>; the installer appends the id itself.
        if (inst?.install_path && inst.is_managed !== false) {
            const parts = inst.install_path.split(/[\\/]/);
            if (parts.length > 1 && parts[parts.length - 1] === u.item.id) installPath = inst.install_path.slice(0, -(u.item.id.length + 1));
        }
    }
    const { catalogInstall } = await import('../catalogs/catalog-actions.js');
    const r = await catalogInstall(u.item.kind, u.item.id, { source: 'task', taskId, installPath });
    if (!r.ok) throw new Error(`${t(r.reason || 'catalog.act.failed')}${r.detail ? ` (${r.detail})` : ''}`);
}

// ── Mod integrity ────────────────────────────────────────────────────────────────────────────

export interface IntegritySummary { checked: number; problems: number; lines: string[] }

/**
 * `game`: the active profile's deployed files against the game folder (verify_integrity — what
 * the « Verify integrity » button does). `hashes`: each hashed mod's files against the hashes
 * recorded for it (get_mod_integrity, one mod at a time, so a stop lands between two mods).
 * Both only read.
 */
export async function verifyIntegrity(scope: string, enabledOnlyMods: boolean, max: number, cancelled?: () => boolean): Promise<IntegritySummary> {
    if (scope !== 'hashes') {
        const altered = (await invoke('verify_integrity')) as string[];
        return { checked: 1, problems: (altered || []).length, lines: (altered || []).slice(0, 50) };
    }
    const rows = ((await invoke('get_hash_overview', { profileId: null })) as { id: string; name: string; enabled: boolean; files: number }[]) || [];
    const todo = rows.filter((r) => r.files > 0 && (!enabledOnlyMods || r.enabled)).slice(0, Math.max(1, max));
    const out: IntegritySummary = { checked: 0, problems: 0, lines: [] };
    for (const r of todo) {
        if (cancelled?.()) break;
        try {
            const rep = (await invoke('get_mod_integrity', { modId: r.id })) as { isValid: boolean; missing: string[]; modified: string[]; added: string[] };
            out.checked++;
            if (!rep.isValid) {
                out.problems++;
                out.lines.push(t('sched.iv.line', {
                    name: r.name || r.id, m: String(rep.modified?.length || 0), x: String(rep.missing?.length || 0), a: String(rep.added?.length || 0),
                }));
            }
        } catch (e) {
            out.checked++;
            out.problems++;
            out.lines.push(`${r.name || r.id}: ${String(e)}`);
        }
    }
    return out;
}

// ── Caches ───────────────────────────────────────────────────────────────────────────────────

/** The cache folders a task may empty (tools.rs cache_targets). The crash archive is opt-in. */
export const CACHE_TARGETS = ['catalog_cache', 'mod_cache', 'update_leftovers', 'crash_archive'] as const;
export const CACHE_DEFAULT = ['catalog_cache', 'mod_cache', 'update_leftovers'];

export interface CacheSummary { total: number; freed: number; lines: string[]; errors: string[] }

export async function cleanCaches(targets: string[], minMb: number, dry: boolean): Promise<CacheSummary> {
    const ids = targets.filter((x) => (CACHE_TARGETS as readonly string[]).includes(x));
    const pre = (await invoke('tools_cache_preview')) as { items: { id: string; bytes: number; entries: number; busy: boolean }[]; total_bytes: number };
    const chosen = (pre.items || []).filter((i) => ids.includes(i.id));
    const total = chosen.reduce((n, i) => n + (i.bytes || 0), 0);
    const lines = chosen.map((i) => t('sched.cc.line', {
        id: tx('sched.cc.t.' + i.id, i.id), size: humanBytes(i.bytes), n: String(i.entries), busy: i.busy ? ` · ${t('sched.cc.busy')}` : '',
    }));
    // Under the threshold there is nothing worth a deletion pass.
    if (dry || total < Math.max(0, minMb) * 1024 * 1024 || !chosen.length) return { total, freed: 0, lines, errors: [] };
    const done = (await invoke('tools_cache_clean', { ids: chosen.filter((i) => !i.busy).map((i) => i.id), confirmed: true })) as { freed_bytes: number; errors: string[] };
    return { total, freed: done.freed_bytes || 0, lines, errors: done.errors || [] };
}

// ── Disk usage ───────────────────────────────────────────────────────────────────────────────

export interface DiskSummary { total: number; profiles: number; top: string[]; markdown: string }

export async function diskReport(topN: number): Promise<DiskSummary> {
    const r = (await invoke('tools_disk_usage')) as {
        total_bytes: number; app_data_path: string;
        profiles: { name: string; mods_bytes: number; backup_bytes: number; mods: { name: string; bytes: number }[] }[];
        app_data?: { name: string; bytes: number }[];
    };
    const profs = [...(r.profiles || [])].sort((a, b) => (b.mods_bytes + b.backup_bytes) - (a.mods_bytes + a.backup_bytes));
    const mods = profs.flatMap((p) => (p.mods || []).map((m) => ({ ...m, profile: p.name })))
        .sort((a, b) => b.bytes - a.bytes).slice(0, Math.max(1, topN));
    const top = mods.map((m) => `${m.name} (${m.profile}) — ${humanBytes(m.bytes)}`);
    const md: string[] = [
        `# ${t('sched.du.mdTitle')} — ${new Date().toLocaleString()}`,
        '',
        `${t('sched.du.mdTotal')}: **${humanBytes(r.total_bytes)}**`,
        '',
        `## ${t('sched.du.mdProfiles')}`,
        '',
        `| ${t('sched.du.mdProfile')} | ${t('sched.du.mdMods')} | ${t('sched.du.mdBackups')} |`,
        '| --- | ---: | ---: |',
        ...profs.map((p) => `| ${p.name.replace(/\|/g, '/')} | ${humanBytes(p.mods_bytes)} | ${humanBytes(p.backup_bytes)} |`),
        '',
        `## ${t('sched.du.mdTop', { n: String(mods.length) })}`,
        '',
        ...mods.map((m) => `- ${m.name.replace(/\|/g, '/')} (${m.profile}) — ${humanBytes(m.bytes)}`),
        '',
    ];
    return { total: r.total_bytes || 0, profiles: profs.length, top, markdown: md.join('\n') };
}
