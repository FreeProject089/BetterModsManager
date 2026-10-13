/**
 * activity-sources.ts — the adapters that feed core/activity.ts from every subsystem.
 *
 * Three doors, so no subsystem had to be rewritten:
 *
 *   1. COMMANDS. api.ts calls a hook when a command starts and when it ends
 *      (setInvokeActivityHook). The long-running commands are listed in COMMANDS below: what
 *      they are called, what kind of work they are, how to stop them and which progress event
 *      they emit. A command not listed costs one Map lookup.
 *   2. PROGRESS EVENTS. The backend's progress events (bmm://repo-sync-progress, …) move the
 *      bar and the detail line of the command row that emits them (by channel). An event with
 *      no running command row is ignored: a row born from an event would have nothing to end it.
 *   3. THE ACTIVATION JOBS (core/activation-jobs.ts): every queued/running job is a row, its
 *      Cancel is the job's own, and its summary ends it. The batches other screens run on the
 *      backend (Enable all) are one row while they last.
 *
 * Scheduled tasks report from their runner (features/settings/scheduler.ts), which owns their
 * Stop. Everything here is pure wiring with injected deps: the node tests drive it with fakes.
 */
import {
    startActivity, type ActivityHandle, type ActivityKind,
} from './activity.js';
import {
    onActivationChange, onActivationJobEnd, getActivationJobs, currentActivation, externalActivity,
    cancelActivationJob, cancelExternal, isActivationBusy, type ActivationJob, type JobSummary,
} from './activation-jobs.js';

type T = (key: string, vars?: Record<string, string>) => string;
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type Args = Record<string, unknown>;

export type Channel =
    | 'repo-sync' | 'repo-export' | 'mm-export' | 'mod-download' | 'repair'
    | 'ai-analyze' | 'ai-embedded' | 'ssh' | 'repo-validate';

export interface CommandSpec {
    kind: ActivityKind;
    title(t: T, args: Args): string;
    detail?(args: Args): string;
    /** How to stop it, when the backend can. */
    cancel?(invoke: Invoke, args: Args): (() => unknown) | undefined;
    channel?: Channel;
    /** A success shorter than this is not kept in the history (background checks). */
    ephemeralMs?: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** A run the page tagged with a token: its Stop is `repo_validate_cancel`. */
const runCancel = (inv: Invoke, runId: unknown): (() => unknown) | undefined => (str(runId) ? () => inv('repo_validate_cancel', { runId }) : undefined);

/** The commands worth a row: they can take seconds to minutes. */
export const COMMANDS: Record<string, CommandSpec> = {
    // downloads
    download_mod: { kind: 'download', title: (t) => t('activity.cmd.downloadMod'), detail: (a) => str(a.modName), channel: 'mod-download' },
    install_from_modlist: {
        kind: 'download', title: (t) => t('activity.cmd.installModlist'), channel: 'mod-download',
        cancel: (inv, a) => (a.runId ? () => inv('cancel_install_from_modlist', { runId: a.runId }) : undefined),
    },
    install_modpack_from_url: { kind: 'download', title: (t) => t('activity.cmd.installModpack') },
    install_from_modpack_catalog: { kind: 'download', title: (t) => t('activity.cmd.installModpack') },
    repair_modpack_mod: { kind: 'repair', title: (t) => t('activity.cmd.repairMod'), detail: (a) => str(a.modName), channel: 'repair' },
    // repos
    sync_server_repo: { kind: 'sync', title: (t) => t('activity.cmd.syncRepo'), channel: 'repo-sync', cancel: (inv) => () => inv('cancel_repo_sync') },
    export_server_repo: { kind: 'export', title: (t) => t('activity.cmd.exportRepo'), channel: 'repo-export', cancel: (inv) => () => inv('cancel_repo_export') },
    update_server_repo: { kind: 'export', title: (t) => t('activity.cmd.updateRepo'), channel: 'repo-export' },
    ssh_upload_repo: { kind: 'sync', title: (t) => t('activity.cmd.sshUpload'), channel: 'ssh' },
    ssh_download_repo: { kind: 'sync', title: (t) => t('activity.cmd.sshDownload'), channel: 'ssh' },
    scan_repo_hub: { kind: 'scan', title: (t) => t('activity.cmd.scanRepoHub'), ephemeralMs: 1500 },
    // Server Repo tools: the check and the conversion hash every file (stopped by their run token).
    repo_validate: { kind: 'hash', title: (t) => t('activity.cmd.validateRepo'), channel: 'repo-validate', cancel: (inv, a) => runCancel(inv, (a.args as Args | undefined)?.runId) },
    repo_format_convert: { kind: 'hash', title: (t) => t('activity.cmd.convertRepo'), channel: 'repo-validate', cancel: (inv, a) => runCancel(inv, a.runId) },
    repo_follow_check: { kind: 'scan', title: (t) => t('activity.cmd.followCheck'), detail: (a) => str(a.url), ephemeralMs: 1500 },
    // exports / imports
    export_modlist: {
        kind: 'export', title: (t) => t('activity.cmd.exportModlist'), detail: (a) => str(a.listName), channel: 'mm-export',
        cancel: (inv, a) => () => inv('cancel_export_modlist', { runId: a.runId ?? null }),
    },
    export_modpack: { kind: 'export', title: (t) => t('activity.cmd.exportModpack') },
    export_data_bundle: { kind: 'export', title: (t) => t('activity.cmd.backup') },
    export_diagnostics: { kind: 'export', title: (t) => t('activity.cmd.diagnostics') },
    catalog_bundle_pack: { kind: 'export', title: (t) => t('activity.cmd.packBundle') },
    restore_data_bundle: { kind: 'import', title: (t) => t('activity.cmd.restore') },
    import_modpack: { kind: 'import', title: (t) => t('activity.cmd.importModpack') },
    // scans
    scan_mods_folder: { kind: 'scan', title: (t) => t('activity.cmd.scanMods'), ephemeralMs: 1500 },
    scan_installed_apps: { kind: 'scan', title: (t) => t('activity.cmd.scanApps'), ephemeralMs: 1500 },
    scan_legacy_managers: { kind: 'scan', title: (t) => t('activity.cmd.scanLegacy'), ephemeralMs: 1500 },
    verify_integrity: { kind: 'scan', title: (t) => t('activity.cmd.verifyIntegrity') },
    recalculate_all_hashes: { kind: 'hash', title: (t) => t('activity.cmd.hashes') },
    // installs (app catalogue, plugins)
    install_app: { kind: 'install', title: (t) => t('activity.cmd.installApp'), detail: (a) => str(a.appTitle) },
    link_install_app: { kind: 'install', title: (t) => t('activity.cmd.installApp') },
    install_plugin: { kind: 'install', title: (t) => t('activity.cmd.installPlugin') },
    link_install_plugin: { kind: 'install', title: (t) => t('activity.cmd.installPlugin') },
    repo_extras_install: { kind: 'install', title: (t) => t('activity.cmd.installExtras') },
    // Laya
    ai_analyze_library: { kind: 'ai', title: (t) => t('activity.cmd.layaAnalyze'), channel: 'ai-analyze', cancel: (inv) => () => inv('ai_analyze_cancel') },
    ai_laya_run_task: { kind: 'ai', title: (t) => t('activity.cmd.layaTask'), channel: 'ai-analyze', cancel: (inv) => () => inv('ai_analyze_cancel') },
    // Pausing, not discarding: the download resumes from where it stopped next time.
    ai_embedded_install: { kind: 'ai', title: (t) => t('activity.cmd.layaInstall'), channel: 'ai-embedded', cancel: (inv) => () => inv('ai_embedded_cancel', { discard: false }) },
    // benchmark
    run_app_benchmark: { kind: 'benchmark', title: (t) => t('activity.cmd.benchmark'), cancel: (inv) => () => inv('cancel_app_benchmark') },
};

/** The event each channel listens to. */
export const CHANNEL_EVENTS: Record<Channel, string> = {
    'repo-sync': 'bmm://repo-sync-progress',
    'repo-export': 'bmm://repo-export-progress',
    'mm-export': 'bmm://mm-export-progress',
    'mod-download': 'bmm://mod-download-progress',
    'repair': 'bmm://repair-progress',
    'ai-analyze': 'ai-analyze-progress',
    'ai-embedded': 'ai-embedded-progress',
    'ssh': 'repo-ssh-progress',
    'repo-validate': 'bmm://repo-validate-progress',
};

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ratio = (a: number, b: number): number | null => (b > 0 ? Math.max(0, Math.min(1, a / b)) : null);

export function formatSize(n: number): string {
    if (!(n > 0)) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

/** A repo step: an i18n key, or a JSON object `{ key, …vars }` (src-tauri repo.rs). */
export function repoStepText(step: unknown, t: T): string {
    const s = str(step);
    if (!s) return '';
    if (s.startsWith('{')) {
        try {
            const o = JSON.parse(s) as Record<string, unknown>;
            if (typeof o.key !== 'string') return '';
            const vars: Record<string, string> = {};
            for (const [k, v] of Object.entries(o)) if (k !== 'key') vars[k] = String(v ?? '');
            return t(o.key, vars);
        } catch { return ''; }
    }
    return /^[a-zA-Z][\w.]*$/.test(s) ? t(s) : s;
}

/** What one progress event says: the bar (0..1, null = unknown) and the detail line. */
export function readProgress(ch: Channel, raw: unknown, t: T): { progress?: number | null; detail?: string } {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    switch (ch) {
        case 'repo-sync':
        case 'repo-export': {
            const step = repoStepText(p.step, t);
            const file = str(p.current_file);
            return { progress: num(p.progress) / 100, detail: step || file };
        }
        case 'mm-export':
            return { progress: ratio(num(p.current), num(p.total)), detail: str(p.mod_name) };
        case 'mod-download': {
            const total = num(p.total_mods);
            const idx = num(p.mod_index);
            const name = str(p.mod_name);
            const pr = total > 0 ? (Math.min(idx, total - 1) + num(p.progress) / 100) / total : num(p.progress) / 100;
            return { progress: pr, detail: total > 1 ? `${name} (${Math.min(idx + 1, total)}/${total})` : name };
        }
        case 'repair':
            return { progress: num(p.progress) / 100, detail: str(p.modName) };
        case 'ai-analyze':
            return { progress: ratio(num(p.done), num(p.total)), detail: num(p.total) ? `${num(p.done)}/${num(p.total)}` : '' };
        case 'ai-embedded': {
            const total = num(p.total);
            const got = num(p.received);
            return { progress: ratio(got, total), detail: total ? `${formatSize(got)} / ${formatSize(total)}` : '' };
        }
        case 'ssh':
        case 'repo-validate':
            return { progress: ratio(num(p.done), num(p.total)), detail: str(p.current) };
    }
    return {};
}

/** A cancelled command answers with an error; that is a stop, not a failure. */
export function looksCancelled(err: unknown): boolean {
    const s = String((err as { message?: unknown })?.message ?? err ?? '');
    return /cancel|annul|CANCELLED|repo\.errCancel/i.test(s);
}

// ── wiring ─────────────────────────────────────────────────────────────────────────────────

export interface SourceDeps {
    t: T;
    invoke: Invoke;
    listen(event: string, cb: (e: { payload: unknown }) => void): unknown;
    /** api.ts setInvokeActivityHook. */
    setInvokeHook(fn: ((command: string, args: Args) => ((ok: boolean, res: unknown) => void) | null) | null): void;
}

const channelRows = new Map<Channel, ActivityHandle[]>();

function addRow(ch: Channel, h: ActivityHandle): void {
    const list = channelRows.get(ch) || [];
    list.push(h);
    channelRows.set(ch, list);
}
function dropRow(ch: Channel, h: ActivityHandle): void {
    const list = channelRows.get(ch);
    if (!list) return;
    const i = list.indexOf(h);
    if (i >= 0) list.splice(i, 1);
}

/** The hook api.ts calls when a command starts. Exported for the tests. */
export function commandHook(deps: Pick<SourceDeps, 't' | 'invoke'>) {
    return (command: string, args: Args): ((ok: boolean, res: unknown) => void) | null => {
        const spec = Object.prototype.hasOwnProperty.call(COMMANDS, command) ? COMMANDS[command] : null;
        if (!spec) return null;
        const a = args || {};
        const h = startActivity({
            kind: spec.kind,
            title: spec.title(deps.t, a),
            detail: spec.detail ? spec.detail(a) : '',
            cancel: spec.cancel ? spec.cancel(deps.invoke, a) : undefined,
            source: command,
            ephemeralMs: spec.ephemeralMs,
        });
        if (spec.channel) addRow(spec.channel, h);
        return (ok, res) => {
            if (spec.channel) dropRow(spec.channel, h);
            if (ok) {
                // A few commands answer "cancelled: true" instead of failing.
                const r = res as { cancelled?: unknown } | null;
                if (r && typeof r === 'object' && r.cancelled === true) h.cancelled();
                else h.done();
            } else if (looksCancelled(res)) h.cancelled();
            else h.fail(res);
        };
    };
}

/** One progress event, routed to the newest running row of its channel. Exported for tests. */
export function routeEvent(ch: Channel, payload: unknown, t: T): boolean {
    const list = channelRows.get(ch);
    const h = list && list[list.length - 1];
    if (!h || !h.isRunning()) return false;
    h.update(readProgress(ch, payload, t));
    return true;
}

// activation jobs ↦ rows
const jobHandles = new Map<number, ActivityHandle>();
let extHandle: ActivityHandle | null = null;

function jobTitle(job: { label: string; mode: string }, t: T): string {
    return job.label || t(job.mode === 'disable' ? 'actjob.labelDisable' : 'actjob.labelEnable');
}

/** Reconcile the rows with the activation jobs. Exported for the tests. */
export function syncActivation(t: T): void {
    const cur = currentActivation();
    for (const job of getActivationJobs()) {
        if (job.state !== 'queued' && job.state !== 'running') continue;
        let h = jobHandles.get(job.id);
        if (!h) {
            h = startActivity({
                kind: 'activation', title: jobTitle(job, t), key: `actjob:${job.id}`,
                cancel: () => cancelActivationJob(job.id), source: job.source || 'activation',
            });
            jobHandles.set(job.id, h);
        }
        const n = job.items.length;
        const finished = job.items.filter((i) => i.phase === 'done' || i.phase === 'failed' || i.phase === 'cancelled').length;
        if (job.state === 'queued') {
            h.update({ progress: null, detail: t('activity.waiting') });
        } else {
            const it = cur && cur.job.id === job.id ? cur.item : null;
            const part = it && it.bytesTotal > 0 ? Math.min(1, it.bytesDone / it.bytesTotal) : 0;
            const pos = it ? job.items.indexOf(it) + 1 : finished;
            const name = it ? it.name : '';
            h.update({
                progress: n > 0 ? Math.min(1, (finished + (it && it.phase === 'running' ? part : 0)) / n) : null,
                detail: n > 1 ? `${name} (${Math.max(1, pos)}/${n})` : name,
            });
        }
    }
    // The batches other screens run on the backend (Enable all): one row while they last.
    const ext = externalActivity();
    if (ext.length) {
        const a = ext[ext.length - 1];
        if (!extHandle || !extHandle.isRunning()) {
            extHandle = startActivity({
                kind: 'activation', key: 'actjob:external',
                title: t(a.op === 'disable' ? 'actjob.labelDisable' : 'actjob.labelEnable'),
                cancel: () => cancelExternal(), source: 'activation-batch',
            });
        }
        extHandle.update({ progress: a.bytesTotal > 0 ? a.bytesDone / a.bytesTotal : null, detail: a.name || '' });
    } else if (extHandle && !isActivationBusy()) {
        extHandle.done();
        extHandle = null;
    }
}

/** A job left the list: its row ends with the job's outcome. Exported for the tests. */
export function endActivationRow(s: JobSummary, t: T): void {
    const h = jobHandles.get(s.id);
    jobHandles.delete(s.id);
    if (!h) return;
    if (s.wasCancelled) { h.cancelled(); return; }
    if (s.error) { h.fail(s.error); return; }
    if (s.failed.length) {
        const first = s.failed[0];
        h.fail(`${t('activity.failedCount', { n: String(s.failed.length), m: String(s.total) })} ${first.name}: ${first.error || ''}`.trim());
        return;
    }
    h.done(t('activity.doneCount', { n: String(s.done), m: String(s.total) }));
}

let attached = false;

/** Wire every source once. */
export function attachActivitySources(deps: SourceDeps): void {
    if (attached) return;
    attached = true;
    deps.setInvokeHook(commandHook(deps));
    for (const ch of Object.keys(CHANNEL_EVENTS) as Channel[]) {
        try {
            void Promise.resolve(deps.listen(CHANNEL_EVENTS[ch], (e) => { routeEvent(ch, e?.payload, deps.t); })).catch(() => {});
        } catch { /* no event bridge (browser preview) */ }
    }
    onActivationChange(() => syncActivation(deps.t));
    onActivationJobEnd((s) => endActivationRow(s, deps.t));
    syncActivation(deps.t);
}

/** Tests only. */
export function _resetActivitySourcesForTests(): void {
    attached = false;
    channelRows.clear();
    jobHandles.clear();
    extHandle = null;
}
