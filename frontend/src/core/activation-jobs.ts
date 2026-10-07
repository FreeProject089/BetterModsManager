/**
 * activation-jobs.ts — turning mods on and off as background jobs owned by the app.
 *
 * WHY THIS EXISTS
 *
 * An activation used to belong to whatever screen started it: the card's toggle handler, the
 * order-list dialog, the modpack modal. Its progress (a spinner over the card, the toolbar's
 * Cancel) lived in that screen's DOM, so leaving the Library made the work invisible, coming
 * back redrew the cards from a backend that had not saved yet (the toggle read "off" again),
 * and leaving also flushed the Rust file cache in the middle of a dependency chain. From the
 * chair that is "navigating cancelled it". Nothing here is tied to a view: a job is queued,
 * runs one mod at a time, reports through `bmm://mod-op-progress`, and stops ONLY when
 * someone calls `cancel()` on it (the activity pill's button, the toolbar Cancel, the
 * keyboard command). Changing view, closing a dialog or tearing a card down never does.
 *
 * THE API
 *
 *   const job = runActivationJob({ mods: [{ id, name }], mode: 'enable', profileId, label });
 *   job.id                      — stable id, also in getActivationJobs()
 *   await job.done              — JobSummary: per-item phase, error, warning; never rejects
 *   await job.cancel()          — explicit stop: the mod in flight is undone by the backend,
 *                                 the ones not reached are left as they were
 *
 *   runActivationBatch({ mods, mode, label, run: (scope) => invoke(…, { cancelScope: scope }) })
 *                               — a batch the BACKEND runs as one command (an order list:
 *                                 one plan, the enables, one order commit), queued and shown
 *                                 like any job: same pill, same card animations, same Cancel,
 *                                 same end toast, and it outlives the dialog that started it
 *
 *   onActivationChange(fn)      — called (coalesced to a frame) whenever a job or a mod's
 *                                 progress changed; returns the unsubscribe
 *   modActivity(modId)          — what a library card should show for that mod right now
 *   isActivationBusy()          — any job queued/running or a mod op in flight
 *
 * Jobs run one after another (the backend serialises mod I/O anyway; running them side by side
 * only made them wait on each other's locks).
 *
 * CANCEL SCOPES. Every job carries its own cancel token (`scope`), passed to the backend with
 * each call (`cancelScope`). Its Stop is `cancel_mod_ops({ scope })` and its end
 * `clear_mod_op_cancel({ scope })`: neither touches the backend's global flag, so a job
 * finishing its cancel can no longer lower the Stop of a batch another screen runs (Enable
 * all), which is what the old shared flag did. A global Cancel-all still reaches every job
 * that began before it (fs_utils.rs, `CancelScope`). Inside a mod, the copy is parallel under the
 * resource governor's Deploy rules. `profileId`, when given, must be the active profile:
 * enable_mod / disable_mod act on the active one, and a job silently applied to a different
 * profile than the one its caller showed would be worse than one that refuses.
 *
 * This module has no static import of the app (api.js pulls the debug hub and the DOM), so the
 * node tests drive it with fake deps through configureActivationJobs().
 */

export type JobMode = 'enable' | 'disable';
export type ItemPhase = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type JobState = 'queued' | 'running' | 'done' | 'cancelled';

export interface JobMod { id: string; name?: string }

export interface JobItem {
    id: string;
    name: string;
    phase: ItemPhase;
    bytesDone: number;
    bytesTotal: number;
    /** The backend's error string (MISSING_SHA|…, CRITICAL_SPACE|…, a message). */
    error?: string;
    /** WARNING_SPACE|… when the mod went in but the disk is getting full. */
    warning?: string;
}

export interface ActivationJob {
    id: number;
    label: string;
    mode: JobMode;
    profileId: string | null;
    source: string;
    state: JobState;
    items: JobItem[];
    cancelRequested: boolean;
    /** This job's backend cancel token (`cancelScope`). */
    scope: string;
    /** Set for a backend batch (runActivationBatch). */
    batch?: BatchOptions;
    /** A backend batch whose command failed as a whole. */
    error?: string;
}

export interface JobSummary {
    id: number;
    /** A backend batch that failed as a whole (the profile changed, the list is gone…). */
    error?: string;
    label: string;
    mode: JobMode;
    total: number;
    done: number;
    failed: JobItem[];
    cancelled: number;
    /** true when the job stopped because someone cancelled it. */
    wasCancelled: boolean;
    items: JobItem[];
}

export interface RunOptions {
    mods: JobMod[];
    mode: JobMode;
    /** Must be the active profile when given; omitted = the active one, whatever it is. */
    profileId?: string | null;
    /** What the pill and the end toast call this job ("Enable list « Survival »"). */
    label?: string;
    bypassSha?: boolean;
    /** No end-of-job toast: the caller reports the result itself. */
    silent?: boolean;
    /** Ask the library to re-read the mods once the job ends (default true). */
    refreshAfter?: boolean;
    /** Who started it, for logs and the pill ("library", "order-list", …). */
    source?: string;
}

/** What a backend batch tells the job once its command answered. */
export interface BatchOutcome {
    /** The mods that failed, with the backend's error. */
    failed?: Array<{ id: string; name?: string; error: string }>;
    /** The batch stopped early (its Stop, or a global Cancel-all). */
    cancelled?: boolean;
    /** The end toast in the batch's own words (default: the job summary). */
    toast?: EndToast;
}

export interface EndToast { message: string; kind: string; ms?: number }

export interface BatchOptions extends Omit<RunOptions, 'bypassSha'> {
    /** Start the batch on the backend with this job's cancel scope (pass it as `cancelScope`). */
    run(scope: string): Promise<BatchOutcome>;
    /** The end toast when the command itself failed (default: the job summary). */
    failToast?(error: string): EndToast | null;
}

export interface ActivationJobHandle {
    id: number;
    done: Promise<JobSummary>;
    cancel(): Promise<void>;
}

/** What a library card shows. `pct` is 0..1 (null = not known yet). */
export interface ModActivity {
    op: JobMode;
    phase: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
    pct: number | null;
    bytesDone: number;
    bytesTotal: number;
    /** The mod's name when the backend gave it. */
    name?: string;
}

/** The backend's event (src-tauri/src/commands/mods.rs `ModOpProgress`). */
export interface ModOpProgress {
    mod_id: string;
    mod_name: string;
    op: JobMode;
    phase: 'start' | 'copy' | 'done' | 'failed' | 'cancelled';
    bytes_done: number;
    bytes_total: number;
}

export const MOD_OP_PROGRESS_EVENT = 'bmm://mod-op-progress';

export interface JobDeps {
    invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
    listen(event: string, cb: (e: { payload: unknown }) => void): Promise<unknown> | unknown;
    toast(msg: string, kind: string, ms?: number): void;
    t(key: string, vars?: Record<string, string>): string;
    /** Re-read the library once (window._refreshModsFn). */
    refresh(): void;
    /** Run `fn` soon, once per burst of changes (a frame in the app, sync in the tests). */
    schedule(fn: () => void): void;
    /** setTimeout, injectable so the tests do not wait for the "done" flash to fade. */
    later(fn: () => void, ms: number): void;
}

/** How long a finished mod keeps its done / failed look on the card before it settles. */
export const SETTLE_MS = 1400;

// ── state ─────────────────────────────────────────────────────────────────────────────────

let deps: JobDeps | null = null;
let custom: Partial<JobDeps> = {};
let nextId = 1;
const jobs: ActivationJob[] = [];
const resolvers = new Map<number, (s: JobSummary) => void>();
const promises = new Map<number, Promise<JobSummary>>();
/** Per mod, what the backend last said (any source: a job, Enable all, an order list). */
const live = new Map<string, ModActivity & { at: number }>();
/** Mods another screen announced it is about to process (Enable all): shown as queued. */
const announced = new Map<string, JobMode>();
const listeners = new Set<() => void>();
let pumping = false;
let notifyQueued = false;
let listening = false;
let current: { job: ActivationJob; item: JobItem; skip: boolean } | null = null;

function w(): any { return typeof window !== 'undefined' ? (window as any) : {}; }

/**
 * What the module uses until the app hands it its own (ui/app.ts configures invoke, listen and
 * t at boot). No import of api.js / i18n.js here, static or dynamic: both reach the app shell,
 * and every importer of this module would close an import cycle through it.
 */
function defaults(): JobDeps {
    const tauri = () => w().__TAURI__ || {};
    return {
        invoke: async (cmd, args) => {
            const inv = tauri().core?.invoke;
            if (typeof inv !== 'function') throw new Error('no Tauri bridge');
            return inv(cmd, args || {});
        },
        listen: async (event, cb) => {
            const l = tauri().event?.listen;
            return typeof l === 'function' ? l(event, cb) : () => {};
        },
        toast: (msg, kind, ms) => { try { w().toast?.(msg, kind, ms); } catch { /* no toast host */ } },
        t: (key) => key,
        refresh: () => { try { w()._refreshModsFn?.(); } catch { /* library not mounted */ } },
        schedule: (fn) => {
            // A frame when the window paints; a timer too, because a minimised or hidden
            // window gets no frames and the pill / toast must still catch up.
            let ran = false;
            const once = () => { if (!ran) { ran = true; fn(); } };
            const raf = w().requestAnimationFrame;
            if (typeof raf === 'function') raf(once);
            setTimeout(once, 150);
        },
        later: (fn, ms) => { setTimeout(fn, ms); },
    };
}

function d(): JobDeps {
    if (!deps) deps = { ...defaults(), ...custom } as JobDeps;
    return deps;
}

/** Replace some of the dependencies (tests; a host without the Tauri bridge). */
export function configureActivationJobs(over: Partial<JobDeps>): void {
    custom = { ...custom, ...over };
    deps = null;
}

/** Forget everything (tests only). */
export function _resetActivationJobsForTests(): void {
    jobs.length = 0;
    endToasts.clear();
    resolvers.clear();
    promises.clear();
    live.clear();
    announced.clear();
    listeners.clear();
    pumping = false;
    notifyQueued = false;
    listening = false;
    current = null;
    custom = {};
    deps = null;
    nextId = 1;
}

function changed(): void {
    if (notifyQueued) return;
    notifyQueued = true;
    d().schedule(() => {
        notifyQueued = false;
        for (const fn of Array.from(listeners)) {
            try { fn(); } catch (e) { console.warn('[activation-jobs] listener failed', e); }
        }
    });
}

/** Called whenever anything visible changed. Returns the unsubscribe. */
export function onActivationChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

// ── progress from the backend ───────────────────────────────────────────────────────────

/** Start listening to `bmm://mod-op-progress` (idempotent). */
export function initActivationJobs(): void {
    if (listening) return;
    listening = true;
    try {
        void Promise.resolve(d().listen(MOD_OP_PROGRESS_EVENT, (e) => handleProgressEvent((e as { payload: unknown })?.payload)))
            .catch(() => { listening = false; });
    } catch { listening = false; }
}

/** One backend event. Exported for the tests and for hosts that relay events themselves. */
export function handleProgressEvent(raw: unknown): void {
    const p = raw as Partial<ModOpProgress> | null;
    if (!p || typeof p.mod_id !== 'string' || !p.mod_id) return;
    const op: JobMode = p.op === 'disable' ? 'disable' : 'enable';
    const total = Math.max(0, Number(p.bytes_total) || 0);
    const doneBytes = Math.max(0, Math.min(Number(p.bytes_done) || 0, total || Number.MAX_SAFE_INTEGER));
    const phase: ModActivity['phase'] =
        p.phase === 'done' ? 'done' : p.phase === 'failed' ? 'failed' : p.phase === 'cancelled' ? 'cancelled' : 'running';
    const pct = phase === 'done' ? 1 : total > 0 ? Math.min(1, doneBytes / total) : null;
    const prev = live.get(p.mod_id);
    const name = (typeof p.mod_name === 'string' && p.mod_name) || prev?.name || '';
    const entry = { op, phase, pct, bytesDone: doneBytes, bytesTotal: total, name, at: Date.now() };
    live.set(p.mod_id, entry);
    announced.delete(p.mod_id);
    // A backend batch: the event says which of its mods the backend is on now.
    if (current?.job.batch) {
        const it = current.job.items.find((x) => x.id === p.mod_id);
        if (it && (it.phase === 'queued' || it.phase === 'running')) {
            it.phase = phase;
            if (phase === 'running') current.item = it;
        }
    }
    // The job item for that mod, if one is running it, gets the bytes too.
    if (current && current.item.id === p.mod_id) {
        current.item.bytesDone = doneBytes;
        current.item.bytesTotal = total;
    }
    if (phase !== 'running') {
        d().later(() => {
            const now = live.get(p.mod_id as string);
            if (now === entry) { live.delete(p.mod_id as string); changed(); }
        }, SETTLE_MS);
    }
    changed();
}

/**
 * A screen that runs its own batch (Enable all, Disable all) says which mods are coming, so
 * their cards show "queued" until the backend reaches them. `clearAnnounced` when it ends.
 */
export function announceExternal(ids: string[], op: JobMode): void {
    for (const id of ids) if (!live.has(id)) announced.set(id, op);
    changed();
}
export function clearAnnounced(ids?: string[]): void {
    if (!ids) announced.clear(); else for (const id of ids) announced.delete(id);
    changed();
}

// ── queries ────────────────────────────────────────────────────────────────────────────────

export function getActivationJobs(): readonly ActivationJob[] {
    return jobs;
}

/** The job running now, and its item in flight. */
export function currentActivation(): { job: ActivationJob; item: JobItem } | null {
    return current ? { job: current.job, item: current.item } : null;
}

/** Mods being processed right now by something that is not a job (Enable all, an order list). */
export function externalActivity(): Array<{ id: string } & ModActivity> {
    const inJobs = new Set<string>();
    for (const j of jobs) if (j.state === 'running') for (const it of j.items) inJobs.add(it.id);
    const out: Array<{ id: string } & ModActivity> = [];
    for (const [id, a] of live) if (a.phase === 'running' && !inJobs.has(id)) out.push({ id, ...a });
    return out;
}

export function isActivationBusy(): boolean {
    if (jobs.some((j) => j.state === 'queued' || j.state === 'running')) return true;
    for (const a of live.values()) if (a.phase === 'running') return true;
    return announced.size > 0;
}

export function modActivity(modId: string): ModActivity | null {
    const l = live.get(modId);
    if (l) return { op: l.op, phase: l.phase, pct: l.pct, bytesDone: l.bytesDone, bytesTotal: l.bytesTotal };
    for (const j of jobs) {
        if (j.state !== 'queued' && j.state !== 'running') continue;
        const it = j.items.find((x) => x.id === modId);
        if (!it) continue;
        if (it.phase === 'queued') return { op: j.mode, phase: 'queued', pct: null, bytesDone: 0, bytesTotal: 0 };
        if (it.phase === 'running') {
            const pct = it.bytesTotal > 0 ? Math.min(1, it.bytesDone / it.bytesTotal) : null;
            return { op: j.mode, phase: 'running', pct, bytesDone: it.bytesDone, bytesTotal: it.bytesTotal };
        }
    }
    const a = announced.get(modId);
    if (a) return { op: a, phase: 'queued', pct: null, bytesDone: 0, bytesTotal: 0 };
    return null;
}

// ── running ────────────────────────────────────────────────────────────────────────────────

export function summarize(job: ActivationJob): JobSummary {
    const failed = job.items.filter((i) => i.phase === 'failed');
    return {
        id: job.id,
        label: job.label,
        mode: job.mode,
        total: job.items.length,
        done: job.items.filter((i) => i.phase === 'done').length,
        failed,
        cancelled: job.items.filter((i) => i.phase === 'cancelled').length,
        wasCancelled: job.cancelRequested,
        items: job.items.map((i) => ({ ...i })),
        ...(job.error ? { error: job.error } : {}),
    };
}

const opts = new Map<number, RunOptions>();
/** A batch's own end toast, decided when its command answered. */
const endToasts = new Map<number, EndToast>();

/** A job's backend cancel token: unique in this window's life, `[A-Za-z0-9_.:-]`, ≤ 64. */
function newScope(id: number): string {
    return `actjob-${id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Queue a job. It starts as soon as the jobs before it are finished. */
export function runActivationJob(o: RunOptions): ActivationJobHandle {
    return queueJob(o, undefined);
}

/**
 * Queue a batch the backend runs as ONE command (an order list's activation: its plan, the
 * enables with their dependencies, one order commit). The job shows `mods` as its items (the
 * progress events move them through running → done), cancels through its scope, reports the
 * end with the batch's own toast, and does not depend on the screen that started it.
 */
export function runActivationBatch(o: BatchOptions): ActivationJobHandle {
    return queueJob(o, o);
}

function queueJob(o: RunOptions, batch: BatchOptions | undefined): ActivationJobHandle {
    const seen = new Set<string>();
    const items: JobItem[] = [];
    for (const m of o.mods || []) {
        if (!m || typeof m.id !== 'string' || !m.id || seen.has(m.id)) continue;
        seen.add(m.id);
        items.push({ id: m.id, name: m.name || m.id, phase: 'queued', bytesDone: 0, bytesTotal: 0 });
    }
    const id = nextId++;
    // A batch with nothing to turn on (only disables, or only the order) still needs a line in
    // the pill: the batch itself is its one item.
    if (batch && !items.length) items.push({ id: `#batch-${id}`, name: o.label || '', phase: 'queued', bytesDone: 0, bytesTotal: 0 });
    const job: ActivationJob = {
        id,
        label: o.label || (items.length === 1 ? items[0].name : ''),
        mode: o.mode === 'disable' ? 'disable' : 'enable',
        profileId: o.profileId ?? null,
        source: o.source || 'api',
        state: 'queued',
        items,
        cancelRequested: false,
        scope: newScope(id),
        batch,
    };
    jobs.push(job);
    opts.set(job.id, o);
    const done = new Promise<JobSummary>((res) => { resolvers.set(job.id, res); });
    promises.set(job.id, done);
    initActivationJobs();
    changed();
    void pump();
    return { id: job.id, done, cancel: () => cancelActivationJob(job.id) };
}

async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
        for (;;) {
            const next = jobs.find((j) => j.state === 'queued');
            if (!next) break;
            await runJob(next);
        }
    } finally {
        pumping = false;
    }
}

function isCancelledError(msg: string): boolean {
    return msg === 'CANCELLED' || msg.includes('CANCELLED');
}

async function runJob(job: ActivationJob): Promise<void> {
    const o = opts.get(job.id) || ({} as RunOptions);
    job.state = 'running';
    changed();
    const api = d();

    if (job.profileId) {
        let active: unknown = null;
        try { active = await api.invoke('get_active_profile_id'); } catch { active = null; }
        if (active && active !== job.profileId) {
            for (const it of job.items) { it.phase = 'failed'; it.error = 'actjob.errNotActive'; }
        }
    }

    if (job.batch) { await runBatch(job, job.batch); return; }

    for (const item of job.items) {
        if (item.phase !== 'queued') continue;
        if (job.cancelRequested) { item.phase = 'cancelled'; continue; }
        item.phase = 'running';
        current = { job, item, skip: false };
        changed();
        try {
            const res = job.mode === 'enable'
                ? await api.invoke('enable_mod', { modId: item.id, bypassSha: !!o.bypassSha, cancelScope: job.scope })
                : await api.invoke('disable_mod', { modId: item.id, cancelScope: job.scope });
            // A cancelled enable / disable answers Ok after the backend has undone the partial
            // copy, so the outcome comes from who asked for the stop, not from the reply.
            if (job.cancelRequested || current?.skip) item.phase = 'cancelled';
            else {
                item.phase = 'done';
                if (typeof res === 'string' && res.startsWith('WARNING_SPACE|')) item.warning = res;
            }
        } catch (e) {
            const msg = String((e as { message?: string })?.message ?? e);
            item.phase = isCancelledError(msg) || job.cancelRequested ? 'cancelled' : 'failed';
            item.error = msg;
        }
        if (item.phase === 'done' && item.bytesTotal > 0) item.bytesDone = item.bytesTotal;
        current = null;
        changed();
    }

    await endScope(job);
    job.state = job.cancelRequested ? 'cancelled' : 'done';
    finish(job, o);
}

/** The job is over: the backend forgets its cancel token. Only this job's: the global flag (and
 *  any other batch's Stop) is left as it is. */
async function endScope(job: ActivationJob): Promise<void> {
    try { await d().invoke('clear_mod_op_cancel', { scope: job.scope }); } catch { /* best-effort */ }
}

function isTerminal(p: ItemPhase): boolean {
    return p === 'done' || p === 'failed' || p === 'cancelled';
}

/** A backend batch: one command, its items moved by the progress events, its outcome mapped
 *  onto them when it answers. */
async function runBatch(job: ActivationJob, b: BatchOptions): Promise<void> {
    const pseudo = job.items.length === 1 && job.items[0].id.startsWith('#batch-');
    const refused = job.items.some((it) => it.phase === 'failed');
    if (!refused) {
        // The pill shows the batch from the start; the events move it to the mod in flight.
        current = { job, item: job.items[0], skip: false };
        if (pseudo) job.items[0].phase = 'running';
        changed();
        try {
            const out = (await b.run(job.scope)) || {};
            for (const f of out.failed || []) {
                const it = job.items.find((x) => x.id === f.id);
                if (it) { it.phase = 'failed'; it.error = f.error; }
            }
            if (out.cancelled) job.cancelRequested = true;
            for (const it of job.items) {
                // The batch item itself reached its end even when it stopped early: the order
                // of what did turn on is still placed.
                if (pseudo) { if (it.phase === 'running') it.phase = 'done'; continue; }
                if (isTerminal(it.phase)) continue;
                it.phase = job.cancelRequested ? 'cancelled' : 'done';
                if (it.phase === 'done' && it.bytesTotal > 0) it.bytesDone = it.bytesTotal;
            }
            if (out.toast) endToasts.set(job.id, out.toast);
        } catch (e) {
            const msg = String((e as { message?: string })?.message ?? e);
            const stopped = isCancelledError(msg) || job.cancelRequested;
            if (stopped) job.cancelRequested = true;
            for (const it of job.items) {
                if (isTerminal(it.phase)) continue;
                it.phase = stopped ? 'cancelled' : 'failed';
                if (!stopped) it.error = msg;
            }
            if (!stopped) {
                job.error = msg;
                const own = b.failToast?.(msg);
                if (own) endToasts.set(job.id, own);
            }
        }
        current = null;
        changed();
    }
    await endScope(job);
    job.state = job.cancelRequested ? 'cancelled' : 'done';
    finish(job, b);
}

function finish(job: ActivationJob, o: RunOptions): void {
    const s = summarize(job);
    // Finished jobs leave the list (the summary is the record); keeping them would make
    // modActivity scan an ever-growing history.
    const i = jobs.indexOf(job);
    if (i >= 0) jobs.splice(i, 1);
    opts.delete(job.id);
    promises.delete(job.id);
    const own = endToasts.get(job.id);
    endToasts.delete(job.id);
    const res = resolvers.get(job.id);
    resolvers.delete(job.id);
    changed();
    if (!o.silent) {
        if (own) d().toast(own.message, own.kind, own.ms);
        else report(s);
    }
    if (o.refreshAfter !== false && !jobs.some((j) => j.state === 'queued' || j.state === 'running')) {
        try { d().refresh(); } catch { /* library not mounted */ }
    }
    res?.(s);
}

function report(s: JobSummary): void {
    const api = d();
    const label = s.label || api.t(s.mode === 'enable' ? 'actjob.labelEnable' : 'actjob.labelDisable');
    const vars = { label, n: String(s.done), m: String(s.total), f: String(s.failed.length) };
    if (s.wasCancelled) {
        api.toast(api.t('actjob.summaryCancelled', vars), 'info', 5000);
    } else if (s.failed.length) {
        const names = s.failed.slice(0, 4).map((x) => x.name).join(', ') + (s.failed.length > 4 ? ', …' : '');
        api.toast(`${api.t('actjob.summaryFailed', vars)} ${names}`, 'warning', 7000);
    } else {
        api.toast(api.t(s.mode === 'enable' ? 'actjob.summaryEnabled' : 'actjob.summaryDisabled', vars), 'success', 4000);
    }
}

// ── cancelling: explicit only ───────────────────────────────────────────────────────────

/**
 * Stop a job. Queued: dropped, nothing ran. Running: the backend kills the copy in flight and
 * undoes it (the inverse operation), the mods not reached yet are left alone, the ones already
 * done stay done. Resolves once the job has stopped.
 */
export async function cancelActivationJob(id: number): Promise<void> {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    const p = promises.get(id);
    if (job.state === 'queued') {
        job.cancelRequested = true;
        for (const it of job.items) if (it.phase === 'queued') it.phase = 'cancelled';
        job.state = 'cancelled';
        finish(job, opts.get(id) || ({} as RunOptions));
        return;
    }
    if (job.cancelRequested) { await p; return; }
    job.cancelRequested = true;
    changed();
    // This job's scope only: another batch running on the backend keeps going.
    try { await d().invoke('cancel_mod_ops', { scope: job.scope }); } catch { /* the loop still stops between mods */ }
    await p;
}

/** Stop every job (the queue's "Cancel all"). */
export async function cancelAllActivationJobs(): Promise<void> {
    const ids = jobs.map((j) => j.id);
    // Queued ones first: they must not start while the running one is being stopped.
    for (const id of ids) {
        const j = jobs.find((x) => x.id === id);
        if (j && j.state === 'queued') await cancelActivationJob(id);
    }
    await Promise.all(jobs.map((j) => cancelActivationJob(j.id)));
}

// ── batches this module does not own ──────────────────────────────────────────────────

let externalCancel: (() => Promise<unknown> | unknown) | null = null;

/**
 * How to stop a batch another screen runs on the backend (Enable all, an order list): the
 * Library registers its own Cancel-all (mods-actions.ts). Registered rather than imported, so
 * the activity pill does not import the Library.
 */
export function registerExternalCancel(fn: () => Promise<unknown> | unknown): void {
    externalCancel = fn;
}

/** Stop the batches this module does not own, the way their own Cancel does. */
export async function cancelExternal(): Promise<void> {
    if (externalCancel) { await externalCancel(); return; }
    try { await d().invoke('cancel_mod_ops'); } catch { /* best-effort */ }
}

/**
 * The mod in flight is being skipped by someone else's kill (the toolbar's "cancel current
 * only"): count it as cancelled, let the job go on with the next one.
 */
export function markCurrentSkipped(): void {
    if (current) { current.skip = true; changed(); }
}
