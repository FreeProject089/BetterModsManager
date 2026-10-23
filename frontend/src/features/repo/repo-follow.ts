// Followed repos: the « Followed repos » card on the Server Repo page (Join side) and the runner
// that checks them while BMM is open.
//
// The backend (commands/repo_follow.rs) keeps the per-repo settings on the connected repo in
// data.json, says which repos are due, and checks one with a conditional GET (an unchanged repo
// costs one 304). What happens when a mod has an update is per repo:
//
//   notify    (default) say it, in a toast that lands in the notification centre, and on the card
//   download  sync the updated mods' files into their profile (the sync screen's delta sync)
//   apply     the same, and in the ACTIVE profile turn the enabled ones off before and on after,
//             through the activation job manager, so the game gets the new files
//
// Nothing is downloaded or applied while a game runs (the check reports the governor's game
// mode): the user is told and the next check tries again.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { uiIcon } from '../../ui/icons.js';
import { runActivationJob } from '../../core/activation-jobs.js';
import { openFollowDialog } from './follow-dialog.js';

// window.toast, not ui/app.js: ui/app.ts imports repo.ts, which imports this module.
const toast = (msg: string, type = 'info', duration?: number): void => {
    const fn = (window as any).toast;
    // Source 'Repo': the notification centre groups it under followed repos, and Settings
    // decides per group how it is delivered (ui/notification-center.ts).
    if (typeof fn === 'function') fn(msg, type, duration, '', 'Repo', { action: { kind: 'view', arg: 'repo' } });
};

interface Follow {
    enabled: boolean;
    intervalMin: number;
    action: 'notify' | 'download' | 'apply' | string;
    lastCheck: string | null;
    lastVersion: string | null;
    lastUpdates: number;
    lastError: string | null;
}
interface FollowedRepo { url: string; name: string; follow: Follow; due: boolean; hasPassword?: boolean }
interface ApplyStep { localProfileId: string; repoProfileId: string; repoModIds: string[]; localModIds: string[]; enabledLocalIds: string[] }
interface FollowCheck {
    url: string; name: string; notModified: boolean; version: string | null;
    updates: Array<{ mod_id: string; name: string; new_version: string }>;
    action: string; error: string | null; gameRunning: boolean; plan: ApplyStep[];
}

/** Minutes offered for the interval (the backend clamps to 15 min … 30 days). */
const INTERVALS: Array<[number, string]> = [[15, 'repo.follow.every15m'], [60, 'repo.follow.every1h'], [360, 'repo.follow.every6h'], [1440, 'repo.follow.every1d'], [10080, 'repo.follow.every1w']];
const ACTIONS: Array<[string, string]> = [['notify', 'repo.follow.actNotify'], ['download', 'repo.follow.actDownload'], ['apply', 'repo.follow.actApply']];

/** The runner looks at the due list this often; each repo has its own interval. */
const TICK_MS = 5 * 60 * 1000;
const FIRST_TICK_MS = 45 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
const busy = new Set<string>();

function errText(e: unknown): string {
    const s = String((e as { message?: unknown })?.message ?? e ?? '');
    return /^[a-z][\w]*(\.[\w]+)+$/.test(s) ? t(s) : s;
}

function displayName(r: { name: string; url: string }): string {
    if (r.name) return r.name;
    try { return new URL(/^https?:\/\//i.test(r.url) ? r.url : `http://${r.url}`).host || r.url; } catch { return r.url; }
}

function when(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

// ── The card ────────────────────────────────────────────────────────────────────────────────

function statusHtml(r: FollowedRepo): string {
    const f = r.follow;
    if (busy.has(r.url)) return `<span class="rp-follow-st">${uiIcon('loader', 12, { cls: 'spin' })}<span>${escHtml(t('repo.follow.checking'))}</span></span>`;
    if (!f.enabled) return `<span class="rp-follow-st">${escHtml(t('repo.follow.paused'))}</span>`;
    if (f.lastError) return `<span class="rp-follow-st rp-tone--bad">${uiIcon('error', 12)}<span>${escHtml(t('repo.follow.lastError', { err: errText(f.lastError) }))}</span></span>`;
    if (!f.lastCheck) return `<span class="rp-follow-st">${escHtml(t('repo.follow.never'))}</span>`;
    const at = escHtml(t('repo.follow.lastCheck', { when: when(f.lastCheck) }));
    return f.lastUpdates
        ? `<span class="rp-follow-st rp-tone--warn">${uiIcon('download', 12)}<span>${escHtml(t('repo.follow.updates', { n: String(f.lastUpdates) }))} · ${at}</span></span>`
        : `<span class="rp-follow-st rp-tone--ok">${uiIcon('success', 12)}<span>${escHtml(t('repo.follow.upToDateShort'))} · ${at}</span></span>`;
}

function rowHtml(r: FollowedRepo): string {
    const f = r.follow;
    const opts = (list: Array<[string | number, string]>, cur: string | number) => list
        .map(([v, k]) => `<option value="${escAttr(String(v))}"${String(v) === String(cur) ? ' selected' : ''}>${escHtml(t(k))}</option>`).join('');
    // An interval set elsewhere (the API) that is not in the list still shows as itself.
    const ints: Array<[number, string]> = INTERVALS.some(([m]) => m === f.intervalMin) ? INTERVALS : [...INTERVALS, [f.intervalMin, '']];
    const intOpts = ints.map(([m, k]) => `<option value="${m}"${m === f.intervalMin ? ' selected' : ''}>${escHtml(k ? t(k) : t('repo.follow.everyMin', { n: String(m) }))}</option>`).join('');
    return `<li class="rp-follow-row${f.enabled ? '' : ' is-off'}" data-url="${escAttr(r.url)}">
        <div class="rp-follow-main">
            <label class="bmm-switch" title="${escAttr(t('repo.follow.enabled'))}"><input type="checkbox" data-f="enabled"${f.enabled ? ' checked' : ''} aria-label="${escAttr(t('repo.follow.enabled'))}"><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
            <div class="rp-follow-id">
                <span class="rp-follow-name">${escHtml(displayName(r))}${f.lastVersion ? ` <span class="rp-follow-ver rp-mono">v${escHtml(f.lastVersion)}</span>` : ''}${r.hasPassword ? ` <span class="rp-follow-ver" title="${escAttr(t('repo.followDlg.pwSavedShort'))}">${uiIcon('lock', 12)}</span>` : ''}</span>
                <span class="rp-follow-url rp-mono" title="${escAttr(r.url)}">${escHtml(r.url)}</span>
                ${statusHtml(r)}
            </div>
        </div>
        <div class="rp-follow-ctl">
            <label class="rp-follow-field"><span>${escHtml(t('repo.follow.interval'))}</span><select class="form-input" data-f="interval">${intOpts}</select></label>
            <label class="rp-follow-field"><span>${escHtml(t('repo.follow.action'))}</span><select class="form-input" data-f="action">${opts(ACTIONS, f.action)}</select></label>
            <div class="rp-follow-btns">
                ${f.lastUpdates ? `<button type="button" class="btn btn-sm btn-primary" data-f="review">${escHtml(t('repo.follow.review'))}</button>` : ''}
                <button type="button" class="btn btn-sm btn-secondary" data-f="check"${busy.has(r.url) ? ' disabled' : ''}>${uiIcon('refresh', 14)}<span>${escHtml(t('repo.follow.checkOne'))}</span></button>
                <button type="button" class="btn btn-sm btn-ghost" data-f="remove" title="${escAttr(t('repo.follow.remove'))}" aria-label="${escAttr(t('repo.follow.remove'))}">${uiIcon('close', 14)}</button>
            </div>
        </div>
    </li>`;
}

let lastList: FollowedRepo[] = [];

export async function renderFollowList(): Promise<void> {
    const box = document.getElementById('repo-follow-list');
    if (!box) return;
    try { lastList = await invoke('repo_follow_list') as FollowedRepo[]; } catch { lastList = []; }
    const all = document.getElementById('btn-repo-follow-check-all') as HTMLButtonElement | null;
    if (all) all.disabled = !lastList.some((r) => r.follow.enabled);
    box.innerHTML = lastList.length
        ? `<ul class="rp-follow-rows">${lastList.map(rowHtml).join('')}</ul>`
        : `<div class="rp-follow-empty">${uiIcon('bell', 16)}<span>${escHtml(t('repo.follow.empty'))}</span></div>`;
}

async function patch(url: string, p: { enabled?: boolean; intervalMin?: number; action?: string }): Promise<void> {
    try {
        await invoke('repo_follow_set', { url, name: null, patch: p });
    } catch (e) {
        toast(errText(e), 'error');
    }
    await renderFollowList();
}

/** Open « Follow a repo », prefilled when the repo is already known (the repo just fetched,
 *  a browse result, a history entry). The list redraws after a follow. */
export function followDialog(url?: string, name?: string): void {
    void openFollowDialog({ url, name, onSaved: () => { void renderFollowList(); } });
}

/** Follow the repo in the sync screen's URL field (or `url`) at once, with the defaults. */
export async function followRepo(url?: string, name?: string): Promise<void> {
    const u = (url ?? (document.getElementById('repo-sync-url') as HTMLInputElement | null)?.value ?? '').trim();
    if (!u) { toast(t('repo.follow.errNoUrl'), 'warning'); return; }
    try {
        const r = await invoke('repo_follow_set', { url: u, name: name || null, patch: { enabled: true } }) as FollowedRepo;
        toast(t('repo.follow.added', { name: displayName(r) }), 'success');
    } catch (e) {
        toast(errText(e), 'error');
        return;
    }
    await renderFollowList();
}

// ── Checking ────────────────────────────────────────────────────────────────────────────────

/** Download (and, in the active profile, re-apply) what a check found. Returns how many mods
 *  were updated. */
async function install(r: FollowCheck): Promise<number> {
    const apply = r.action === 'apply';
    const active = String(await invoke('get_active_profile_id').catch(() => '') || '');
    const creatorId = await invoke('get_creator_id').catch(() => null);
    const names = new Map(r.updates.map((u) => [u.mod_id, u.name]));
    let updated = 0;
    for (const step of r.plan) {
        const reapply = apply && step.localProfileId === active && step.enabledLocalIds.length > 0;
        const mods = step.enabledLocalIds.map((id) => ({ id, name: names.get(id) || id }));
        if (reapply) {
            const off = await runActivationJob({ mods, mode: 'disable', label: t('repo.follow.jobOff', { name: displayName(r) }), silent: true, refreshAfter: false, source: 'repo-follow' }).done;
            if (off.wasCancelled || off.error || off.failed.length) throw new Error(off.error || t('repo.follow.errReapply'));
        }
        // The local API refuses its own repo calls while a sync runs (the screen does the same).
        void invoke('set_repo_busy', { kind: 'sync', busy: true }).catch(() => {});
        try {
            await invoke('sync_server_repo', {
                args: {
                    url: r.url, creatorId, gameDir: '', modsDir: '', backupDir: '',
                    choices: [{ repoProfileId: step.repoProfileId, targetLocalProfileId: step.localProfileId, selectedModIds: step.repoModIds }],
                    overwriteAll: false, deleteExtra: false, downloadLimit: 0, unzipArchives: true,
                    password: null, addRepoAsUpdateSource: false, keepActiveProfile: true,
                },
            });
            updated += step.localModIds.length;
        } finally {
            void invoke('set_repo_busy', { kind: 'sync', busy: false }).catch(() => {});
            // Whatever the sync did, the mods the user had on go back on.
            if (reapply) await runActivationJob({ mods, mode: 'enable', label: t('repo.follow.jobOn', { name: displayName(r) }), silent: true, source: 'repo-follow' }).done;
        }
    }
    return updated;
}

/** Check one followed repo; `manual` reads it in full and says « up to date » too. */
export async function checkFollowed(url: string, manual = false): Promise<FollowCheck | null> {
    if (busy.has(url)) return null;
    busy.add(url);
    void renderFollowList();
    let r: FollowCheck | null = null;
    try {
        r = await invoke('repo_follow_check', { url, password: null, force: manual }) as FollowCheck;
        const name = displayName(r);
        if (r.error) {
            if (manual) toast(t('repo.follow.checkFailed', { name, err: errText(r.error) }), 'error', 7000);
            return r;
        }
        const n = r.updates.length;
        if (!n) {
            if (manual) toast(t('repo.follow.upToDate', { name }), 'success');
            return r;
        }
        const wantsInstall = r.action === 'download' || r.action === 'apply';
        if (!wantsInstall) {
            toast(t('repo.follow.found', { n: String(n), name }), 'info', 9000);
        } else if (r.gameRunning) {
            toast(t('repo.follow.heldGame', { n: String(n), name }), 'warning', 9000);
        } else if (!r.plan.length) {
            toast(t('repo.follow.foundManual', { n: String(n), name }), 'info', 9000);
        } else {
            try {
                const done = await install(r);
                toast(t(r.action === 'apply' ? 'repo.follow.applied' : 'repo.follow.downloaded', { n: String(done), name }), 'success', 9000);
                await invoke('repo_follow_check', { url, password: null, force: true }).catch(() => null);
                (window as any)._refreshModsFn?.(true);
            } catch (e) {
                toast(t('repo.follow.installFailed', { name, err: errText(e) }), 'error', 9000);
            }
        }
        return r;
    } catch (e) {
        if (manual) toast(errText(e), 'error');
        return r;
    } finally {
        busy.delete(url);
        void renderFollowList();
    }
}

/** One pass of the runner: every due repo, one after the other. */
async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
        const due = await invoke('repo_follow_due') as string[];
        for (const url of due || []) await checkFollowed(url, false);
    } catch { /* the next tick tries again */ } finally {
        ticking = false;
    }
}

export function startFollowRunner(): void {
    if (timer) return;
    setTimeout(() => { void tick(); }, FIRST_TICK_MS);
    timer = setInterval(() => { void tick(); }, TICK_MS);
}

export function initRepoFollow(): void {
    const card = document.getElementById('repo-follow-card');
    if (card) {
        // « + Follow a repo »: its own dialog (address, access, test, schedule), not the URL
        // field higher up, which is about syncing once.
        document.getElementById('btn-repo-follow-add')?.addEventListener('click', () => followDialog());
        // « Follow » on the repo just fetched (the joined card).
        document.getElementById('btn-repo-follow-joined')?.addEventListener('click', () => {
            const url = (document.getElementById('repo-sync-url') as HTMLInputElement | null)?.value?.trim() || '';
            const name = document.getElementById('repo-sync-name-display')?.textContent?.trim() || '';
            followDialog(url, name);
        });
        document.getElementById('btn-repo-follow-check-all')?.addEventListener('click', async () => {
            for (const r of lastList.filter((x) => x.follow.enabled)) await checkFollowed(r.url, true);
        });
        const list = document.getElementById('repo-follow-list');
        list?.addEventListener('change', (e) => {
            const el = e.target as HTMLInputElement | HTMLSelectElement;
            const url = el.closest<HTMLElement>('.rp-follow-row')?.dataset.url;
            if (!url) return;
            if (el.dataset.f === 'enabled') void patch(url, { enabled: (el as HTMLInputElement).checked });
            else if (el.dataset.f === 'interval') void patch(url, { intervalMin: Number(el.value) || 360 });
            else if (el.dataset.f === 'action') void patch(url, { action: el.value });
        });
        list?.addEventListener('click', (e) => {
            const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-f]');
            const url = b?.closest<HTMLElement>('.rp-follow-row')?.dataset.url;
            if (!b || !url) return;
            if (b.dataset.f === 'check') void checkFollowed(url, true);
            else if (b.dataset.f === 'review') (window as any).bmmShowModUpdates?.();
            else if (b.dataset.f === 'remove') {
                void invoke('repo_follow_remove', { url }).then(() => {
                    toast(t('repo.follow.removed'), 'info');
                    return renderFollowList();
                }).catch((err) => toast(errText(err), 'error'));
            }
        });
        void renderFollowList();
    }
    startFollowRunner();
}
