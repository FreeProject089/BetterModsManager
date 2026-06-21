// Scheduler / automation engine (frontend).
//
// The engine runs while BMM is open: a timer wakes every ~20s, finds due tasks,
// and executes their workflow. A workflow is a tree of steps — actions, delays,
// and if/else condition blocks — so the user can build genuinely free automations
// (activate a profile, enable a modpack, run a custom command, branch on state…).
//
// Persistence + custom-command execution live in the Rust backend
// (commands/scheduler.rs); everything else (timing, conditions, action dispatch)
// is here so it can reuse every existing invoke() action.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { toast } from '../../ui/app.js';

// ── Types ───────────────────────────────────────────────────────────────────
type Trigger =
    | { type: 'once'; at: string }                                  // ISO local datetime
    | { type: 'interval'; everyMinutes: number }                    // every N minutes
    | { type: 'hourly'; everyHours: number }                        // every N hours
    | { type: 'dailyAt'; time: string }                             // "HH:MM"
    | { type: 'weeklyAt'; time: string; days: number[] }            // 0=Sun..6=Sat
    | { type: 'monthlyAt'; day: number; time: string }              // day-of-month 1..31
    | { type: 'appStart' }                                          // once per app launch
    | { type: 'manual' };                                           // only via Run button / deeplink

interface Action { type: string; params: Record<string, any>; }
interface Condition { type: string; params: Record<string, any>; negate?: boolean; }
type Step =
    | { kind: 'action'; action: Action }
    | { kind: 'delay'; seconds: number }
    | { kind: 'waitFor'; condition: Condition; timeoutSec: number; pollSec?: number; onTimeout?: 'abort' | 'continue' }
    | { kind: 'if'; condition: Condition; then: Step[]; else: Step[] }
    // Loop: run `steps` repeatedly — while/until a condition, or a fixed number of
    // times — with a hard max-iterations safety cap and an optional pause between.
    | { kind: 'repeat'; mode: 'while' | 'until' | 'times'; condition?: Condition; times?: number; maxIters: number; everySec: number; steps: Step[] };

interface Task {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    trigger: Trigger;
    steps: Step[];
    allowCustomCommands: boolean;
    osSchedule?: boolean;   // also register a Windows Scheduled Task (runs when BMM is closed)
    lastRun?: number;       // epoch ms
    lastResult?: string;    // 'ok' | 'error: ...'
}

// ── State ───────────────────────────────────────────────────────────────────
let _tasks: Task[] = [];
let _timer: number | null = null;
const _appStartFired = new Set<string>();
const _onceFired = new Set<string>();

// Picker caches (filled when the modal opens)
let _profiles: any[] = [];
let _mods: any[] = [];
let _modpacks: any[] = [];
let _themes: any[] = [];
let _apps: any[] = [];
let _disks: any[] = [];

// ── Persistence ──────────────────────────────────────────────────────────────
async function loadTasks(): Promise<void> {
    try {
        const raw = await invoke('get_schedules');
        _tasks = Array.isArray(raw) ? raw : [];
    } catch { _tasks = []; }
}
async function saveTasks(): Promise<void> {
    try { await invoke('save_schedules', { tasks: _tasks }); }
    catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
}

// ── Engine ───────────────────────────────────────────────────────────────────
export async function initScheduler(): Promise<void> {
    await loadTasks();
    renderScheduleList();
    const btn = document.getElementById('btn-create-schedule');
    if (btn && !btn.dataset.wired) {
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => openTaskModal(null));
        // Add Export / Import .BMMPA buttons next to "New task".
        const row = btn.parentElement;
        if (row && !document.getElementById('sched-export-btn')) {
            const exp = document.createElement('button');
            exp.id = 'sched-export-btn';
            exp.className = 'btn btn-ghost btn-sm';
            exp.style.gap = '6px';
            exp.textContent = t('sched.exportBmmpa') || 'Export .BMMPA';
            exp.addEventListener('click', () => exportTasksFile());
            const imp = document.createElement('button');
            imp.id = 'sched-import-btn';
            imp.className = 'btn btn-ghost btn-sm';
            imp.style.gap = '6px';
            imp.textContent = t('sched.importBmmpa') || 'Import .BMMPA';
            imp.addEventListener('click', () => importTasksFile());
            row.appendChild(exp);
            row.appendChild(imp);
        }
    }
    if (!_langWired) {
        _langWired = true;
        document.addEventListener('langChanged', () => renderScheduleList());
    }
    startEngine();
}
let _langWired = false;

function startEngine(): void {
    if (_timer !== null) return;
    // Fire appStart tasks once shortly after launch.
    setTimeout(() => tick().catch(() => {}), 4000);
    _timer = window.setInterval(() => { tick().catch(() => {}); }, 20000);
}

function nextLocalMidnightOffset(time: string): { h: number; m: number } {
    const [h, m] = time.split(':').map(n => parseInt(n, 10) || 0);
    return { h, m };
}

function isDue(task: Task, now: Date): boolean {
    const tr = task.trigger;
    const last = task.lastRun || 0;
    const nowMs = now.getTime();
    switch (tr.type) {
        case 'appStart':
            if (_appStartFired.has(task.id)) return false;
            return true;
        case 'once': {
            if (_onceFired.has(task.id) || task.lastRun) return false;
            const at = new Date(tr.at).getTime();
            return !isNaN(at) && nowMs >= at;
        }
        case 'manual':
            return false; // only runs via the Run button or bmm://schedule/run
        case 'interval': {
            const gap = Math.max(1, tr.everyMinutes) * 60000;
            return nowMs - last >= gap;
        }
        case 'hourly': {
            const gap = Math.max(1, tr.everyHours) * 3600000;
            return nowMs - last >= gap;
        }
        case 'monthlyAt': {
            const { h, m } = nextLocalMidnightOffset(tr.time);
            if (now.getDate() !== tr.day) return false;
            if (now.getHours() !== h || now.getMinutes() !== m) return false;
            return nowMs - last >= 60000;
        }
        case 'dailyAt': {
            const { h, m } = nextLocalMidnightOffset(tr.time);
            if (now.getHours() !== h || now.getMinutes() !== m) return false;
            // Avoid double-firing within the same minute.
            return nowMs - last >= 60000;
        }
        case 'weeklyAt': {
            const { h, m } = nextLocalMidnightOffset(tr.time);
            if (!tr.days?.includes(now.getDay())) return false;
            if (now.getHours() !== h || now.getMinutes() !== m) return false;
            return nowMs - last >= 60000;
        }
    }
    return false;
}

async function tick(): Promise<void> {
    const now = new Date();
    for (const task of _tasks) {
        if (!task.enabled) continue;
        if (!isDue(task, now)) continue;
        if (task.trigger.type === 'appStart') _appStartFired.add(task.id);
        if (task.trigger.type === 'once') _onceFired.add(task.id);
        await runTask(task);
    }
}

/** The saved scheduler tasks (loaded if needed) — used to populate the script
 *  generator's "Run scheduled task" dropdown. */
export async function getTasks(): Promise<Task[]> {
    if (!_tasks.length) await loadTasks();
    return _tasks;
}

/** Runs one task by id — used by the bmm://schedule/run deeplink (Windows Task Scheduler). */
export async function runTaskById(id: string): Promise<void> {
    if (!_tasks.length) await loadTasks();
    const task = _tasks.find(t => t.id === id);
    if (task) await runTask(task);
}

/** (Re)registers or removes the Windows Scheduled Task mirror for a task. */
async function syncOsSchedule(task: Task): Promise<void> {
    try {
        if (task.osSchedule && task.enabled) {
            await invoke('register_os_schedule', { taskId: task.id, trigger: task.trigger });
        } else {
            await invoke('unregister_os_schedule', { taskId: task.id });
        }
    } catch (e) { toast(`${t('sched.osFail') || 'OS schedule error'}: ${e}`, 'error'); }
}

async function runTask(task: Task): Promise<void> {
    try {
        // Per-run variable store: actions (e.g. a benchmark) write measured values
        // here, and `value` conditions read them → "if disk speed > X then Apply".
        const ctx: Record<string, number> = {};
        await runSteps(task.steps, task, ctx);
        task.lastResult = 'ok';
        toast(`${t('sched.ran') || 'Ran'}: ${task.name}`, 'success');
    } catch (e) {
        task.lastResult = `error: ${e}`;
        toast(`${task.name} — ${e}`, 'error');
    }
    task.lastRun = Date.now();
    await saveTasks();
    renderScheduleList();
}

async function runSteps(steps: Step[], task: Task, ctx: Record<string, number>): Promise<void> {
    for (const step of steps || []) {
        if (step.kind === 'action') {
            await runAction(step.action, task, ctx);
        } else if (step.kind === 'delay') {
            await new Promise(r => setTimeout(r, Math.max(0, step.seconds) * 1000));
        } else if (step.kind === 'waitFor') {
            await waitForCondition(step.condition, step.timeoutSec, ctx, step.pollSec, step.onTimeout);
        } else if (step.kind === 'if') {
            const ok = await evalCondition(step.condition, ctx);
            await runSteps(ok ? step.then : step.else, task, ctx);
        } else if (step.kind === 'repeat') {
            const max = Math.max(1, Math.min(step.maxIters || 100, 100000));
            const gap = Math.max(0, step.everySec || 0) * 1000;
            if (step.mode === 'times') {
                const times = Math.min(Math.max(0, step.times || 1), max);
                for (let n = 0; n < times; n++) {
                    await runSteps(step.steps, task, ctx);
                    if (gap) await new Promise(r => setTimeout(r, gap));
                }
            } else {
                // while → run while the condition is true; until → run until it is.
                for (let n = 0; n < max; n++) {
                    const ok = step.condition ? await evalCondition(step.condition, ctx) : true;
                    if ((step.mode === 'while') ? !ok : ok) break;
                    await runSteps(step.steps, task, ctx);
                    if (gap) await new Promise(r => setTimeout(r, gap));
                }
            }
        }
    }
}

// Polls a condition until it becomes true or the timeout elapses (then throws,
// aborting the rest of the workflow). This is what makes "wait until all mods are
// active, then launch X" possible.
async function waitForCondition(cond: Condition, timeoutSec: number, ctx: Record<string, number>, pollSec = 2, onTimeout: 'abort' | 'continue' = 'abort'): Promise<void> {
    const deadline = Date.now() + Math.max(1, timeoutSec || 60) * 1000;
    const pollMs = Math.max(250, (pollSec || 2) * 1000);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (await evalCondition(cond, ctx)) return;
        if (Date.now() >= deadline) {
            // Either abort the whole task (default) or just stop waiting and carry on.
            if (onTimeout === 'continue') return;
            throw new Error(t('sched.waitTimeout') || 'Timed out waiting for condition');
        }
        await new Promise(r => setTimeout(r, pollMs));
    }
}

// ── Action dispatch ───────────────────────────────────────────────────────────
// Size preset → run_app_benchmark `scale` string.
const BENCH_SCALE: Record<string, string> = { S: 'small', M: 'medium', L: 'large', XL: 'xlarge' };

async function runAction(action: Action, task: Task, ctx: Record<string, number>): Promise<void> {
    const p = action.params || {};
    // Fire a bmm:// deeplink through the app's canonical handler (covers every
    // script-generator action that maps to a deeplink). Falls back to runDeepLink.
    const dl = (path: string, qp: Record<string, any> = {}) => {
        const qs = Object.entries(qp)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
        const url = `bmm://${path}${qs ? '?' + qs : ''}`;
        const fn = (window as any).__bmmDeeplink;
        return fn ? fn(url) : runDeepLink(url);
    };
    const b = (v: any) => (v ? 1 : 0);
    switch (action.type) {
        case 'profile.activate':
            await invoke('set_active_profile', { profileId: p.id }); break;
        case 'mod.enable':
            await invoke('enable_mod', { modId: p.id, bypassSha: true }); break;
        case 'mod.disable':
            await invoke('disable_mod', { modId: p.id }); break;
        case 'modpack.enable':
            await applyModpack(p.id, true); break;
        case 'modpack.disable':
            await applyModpack(p.id, false); break;
        case 'mods.enableAll':
            await invoke('toggle_all_mods', { enable: true, bypassSha: true }); break;
        case 'mods.disableAll':
            await invoke('toggle_all_mods', { enable: false, bypassSha: false }); break;
        case 'mods.scan':
            await invoke('scan_mods_folder'); break;
        case 'theme.set':
            await invoke('set_active_theme', { themeId: p.id }); break;
        case 'app.launch':
            await invoke('launch_app', { appId: p.id, exePath: p.exePath || '' }); break;
        case 'notify':
            toast(p.message || task.name, 'info'); break;
        case 'custom.command': {
            if (!task.allowCustomCommands) {
                throw new Error(t('sched.customDisabled') || 'Custom commands are disabled for this task');
            }
            const args = (p.args || '').trim() ? String(p.args).split(/\s+/) : [];
            await invoke('run_scheduled_command', {
                program: p.program, args, workingDir: p.workingDir || null, allow: true,
            });
            break;
        }
        case 'deeplink':
            await runDeepLink(p.url); break;

        // ── Benchmarks ────────────────────────────────────────────────────────
        case 'benchmark.run': {
            const dataset = p.dataset === 'real' ? 'real' : 'sandbox';
            const size = String(p.size || 'M').toUpperCase();
            const scale = size === 'CUSTOM'
                ? `custom:${Math.max(1, parseInt(p.customMb, 10) || 256)}`
                : (BENCH_SCALE[size] || 'medium');
            const sources: string[] = dataset === 'real'
                ? (Array.isArray(p.sources) ? p.sources : (p.sources ? [p.sources] : []))
                : [];
            const report: any = await invoke('run_app_benchmark', { mode: dataset, realSources: sources, scale });
            const totalMs = Number(report?.total_ms) || 0;
            const bytes = Number(report?.env?.dataset_bytes ?? report?.dataset_bytes) || 0;
            ctx['benchmark.total_ms'] = totalMs;
            if (bytes > 0 && totalMs > 0) ctx['benchmark.mbps'] = Math.round((bytes / 1048576) / (totalMs / 1000) * 10) / 10;
            toast(`${task.name}: benchmark ${Math.round(totalMs)} ms${ctx['benchmark.mbps'] ? ` · ${ctx['benchmark.mbps']} MB/s` : ''}`, 'info');
            break;
        }

        // ── Storage Manager ──────────────────────────────────────────────────
        case 'storage.calibration':
            await setSettingFlag('auto_io_calibration', !!p.enabled); break;
        case 'storage.smartIo':
            await setSettingFlag('smart_io_enabled', !!p.enabled); break;
        case 'storage.flag':                       // generic: toggle ANY boolean setting (e.g. a future "dcp")
            if (p.key) await setSettingFlag(String(p.key), !!p.enabled);
            break;
        case 'storage.diskBenchmark': {
            const mount = p.mountPoint || (await firstDiskMount());
            if (!mount) throw new Error('No disk to benchmark');
            const r: any = await invoke('benchmark_disk', { mountPoint: mount });
            ctx['disk.read_mbps'] = Number(r?.read_mb_s) || 0;
            ctx['disk.write_mbps'] = Number(r?.write_mb_s) || 0;
            ctx['disk.suggested_limit'] = Number(r?.suggested_limit) || 0;
            toast(`${task.name}: ${mount} ${ctx['disk.read_mbps']}↓ / ${ctx['disk.write_mbps']}↑ MB/s`, 'info');
            break;
        }
        case 'storage.applyLimit': {
            const mount = p.mountPoint || (await firstDiskMount());
            if (!mount) throw new Error('No disk selected');
            const limit = p.limitMbS != null && p.limitMbS !== ''
                ? Math.max(1, parseInt(p.limitMbS, 10) || 0)
                : Math.round(ctx['disk.suggested_limit'] || 0);
            await invoke('set_disk_limit', { mountPoint: mount, limitMbS: limit > 0 ? limit : null });
            toast(`${task.name}: ${mount} limit → ${limit > 0 ? limit + ' MB/s' : 'unlimited'}`, 'success');
            break;
        }
        case 'var.set':                            // store a literal value for later conditions
            ctx[String(p.name || 'var')] = Number(p.value) || 0; break;

        // ── New script-generator actions (executed via bmm:// deeplinks) ────────
        case 'modpack.create':   dl('modpack/create', { name: p.name, profile: p.profile }); break;
        case 'mod.add':          dl('install', { url: p.url, name: p.name }); break;
        case 'modlist.export':   dl('api', { method: 'POST', path: '/api/modlists/export' }); break;
        case 'modlist.import':   dl('api', { method: 'POST', path: '/api/modlists/import' }); break;
        case 'plugin.apply':     dl('plugin/activate', { id: p.id }); break;
        case 'plugin.compare':   dl('plugin/compare', { id: p.id }); break;
        case 'plugin.delete':    if (p.id) await invoke('uninstall_plugin', { pluginId: p.id }); break;
        case 'mods.checkUpdates': dl('mod/check-updates'); break;
        case 'file.open':        if (p.path) await invoke('open_file', { path: p.path }); break;
        case 'folder.open':      if (p.path) await invoke('open_folder', { path: p.path }); break;
        case 'repo.connect':     dl('repo/connect', { url: p.url, name: p.name }); break;
        case 'repo.sync':        dl('repo/sync', { url: p.url, profile: p.profile }); break;
        case 'repo.gen':         dl('repo/gen'); break;
        case 'repo.update':      dl('repo/update', { dir: p.dir }); break;
        case 'repo.host':        dl('repo/host', { dir: p.dir, port: p.port }); break;
        case 'app.install':      dl('app/install', { id: p.id, url: p.url, title: p.title }); break;
        case 'launchpack.run':   await invoke('run_launch_pack', { id: p.id }); break;
        case 'task.run':
            // Runs the sub-task to completion (it awaits), then records whether it
            // succeeded into ctx so a following IF / repeat can branch on the result
            // ("if task responded / did X"): value source `lasttask.ok` = 1 | 0.
            if (p.id) {
                await runTaskById(String(p.id));
                const sub = _tasks.find(tk => tk.id === p.id);
                ctx['lasttask.ok'] = sub && sub.lastResult === 'ok' ? 1 : 0;
                if (sub) toast(`${t('sched.subTaskDone') || 'Sub-task finished'}: ${sub.name} → ${sub.lastResult}`, ctx['lasttask.ok'] ? 'info' : 'warning');
            }
            break;
        case 'telemetry.consent': dl('telemetry/consent', { enabled: b(p.enabled) }); break;
        case 'telemetry.set':    dl('telemetry/set', { replay: b(p.replay), full: b(p.full), bench: b(p.bench) }); break;
        case 'recorder.set':     dl('recorder/set', { on: b(p.on), full: b(p.full), rust: b(p.rust), js: b(p.js) }); break;
        case 'replay.export':    dl('replay/export'); break;
        case 'replay.import':    dl('replay/import', { path: p.path, url: p.url }); break;
        case 'discord.rpc':      dl('discord/rpc', { enabled: b(p.enabled) }); break;
        case 'data.exportAuto':  dl('data/export-auto', { dir: p.dir, name: p.name, increment: p.increment }); break;
        case 'restart':          dl('restart'); break;
        case 'open.url': {
            const u = String(p.url || '');
            if (u) { try { await (window as any).__TAURI__?.shell?.open?.(u); } catch { window.open(u, '_blank'); } }
            break;
        }

        default:
            throw new Error(`Unknown action: ${action.type}`);
    }
}

/** Flip one boolean field in AppSettings and persist (read-modify-write). */
async function setSettingFlag(key: string, value: boolean): Promise<void> {
    const settings: any = await invoke('get_settings');
    settings[key] = value;
    await invoke('update_settings', { settings });
}
async function firstDiskMount(): Promise<string> {
    try {
        const disks: any[] = await invoke('get_system_disks');
        return disks?.[0]?.mount_point || '';
    } catch { return ''; }
}

async function applyModpack(modpackId: string, enable: boolean): Promise<void> {
    const packs: any[] = await invoke('load_modpacks').catch(() => []);
    const pack = packs.find(m => m.id === modpackId);
    if (!pack) throw new Error(`Modpack ${modpackId} not found`);
    const ids: string[] = (pack.mods || []).map((m: any) => m.mod_id).filter(Boolean);
    for (const id of ids) {
        if (enable) await invoke('enable_mod', { modId: id, bypassSha: true }).catch(() => {});
        else await invoke('disable_mod', { modId: id }).catch(() => {});
    }
}

async function runDeepLink(url: string): Promise<void> {
    if (!url || !/^bmm:\/\//i.test(url)) throw new Error('Invalid bmm:// URL');
    // Re-dispatch through the app's deeplink listener.
    window.dispatchEvent(new CustomEvent('bmm:deeplink', { detail: { url } }));
    try { (window as any).__TAURI__?.event?.emit?.('scheme-request-received', url); } catch {}
}

// ── Condition evaluation ──────────────────────────────────────────────────────
async function evalCondition(cond: Condition, ctx: Record<string, number> = {}): Promise<boolean> {
    let r = await evalConditionRaw(cond, ctx);
    return cond.negate ? !r : r;
}
async function evalConditionRaw(cond: Condition, ctx: Record<string, number>): Promise<boolean> {
    const p = cond.params || {};
    const now = new Date();
    switch (cond.type) {
        case 'always': return true;
        case 'value': {
            // Compare a captured value (e.g. disk.write_mbps, benchmark.mbps) to a threshold.
            const left = Number(ctx[String(p.source)] ?? NaN);
            const right = Number(p.value);
            if (Number.isNaN(left)) return false;
            switch (p.op) {
                case '>': return left > right;
                case '<': return left < right;
                case '>=': return left >= right;
                case '<=': return left <= right;
                case '==': return left === right;
                case '!=': return left !== right;
                default: return false;
            }
        }
        case 'profileActive': {
            const id = await invoke('get_active_profile_id').catch(() => null);
            return id === p.id;
        }
        case 'modEnabled': {
            const mods: any[] = await invoke('get_all_mods').catch(() => []);
            return !!mods.find(m => m.id === p.id)?.enabled;
        }
        case 'modDisabled': {
            const mods: any[] = await invoke('get_all_mods').catch(() => []);
            const m = mods.find(x => x.id === p.id);
            return !!m && !m.enabled;
        }
        case 'appRunning':
            return await invoke('is_process_running', { name: p.name || '' }).catch(() => false);
        case 'appNotRunning':
            return !(await invoke('is_process_running', { name: p.name || '' }).catch(() => false));
        case 'fileExists':
            return await invoke('path_exists', { path: p.path || '' }).catch(() => false);
        case 'online':
            return navigator.onLine;
        case 'timeReached': {
            const [h, m] = String(p.time || '00:00').split(':').map((n: string) => parseInt(n, 10) || 0);
            return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
        }
        case 'modpackActive': {
            const packs: any[] = await invoke('load_modpacks').catch(() => []);
            const pack = packs.find(m => m.id === p.id);
            if (!pack) return false;
            const ids: string[] = (pack.mods || []).map((m: any) => m.mod_id).filter(Boolean);
            if (!ids.length) return false;
            const mods: any[] = await invoke('get_all_mods').catch(() => []);
            const byId = new Map(mods.map(m => [m.id, m]));
            return ids.every(id => byId.get(id)?.enabled);
        }
        case 'modpackInactive': {
            const packs: any[] = await invoke('load_modpacks').catch(() => []);
            const pack = packs.find(m => m.id === p.id);
            if (!pack) return true;
            const ids: string[] = (pack.mods || []).map((m: any) => m.mod_id).filter(Boolean);
            const mods: any[] = await invoke('get_all_mods').catch(() => []);
            const byId = new Map(mods.map(m => [m.id, m]));
            return ids.every(id => !byId.get(id)?.enabled);
        }
        case 'allModsActive': {
            const activeId = await invoke('get_active_profile_id').catch(() => null);
            if (!activeId) return false;
            const mods: any[] = await invoke('get_mods').catch(() => []);
            return mods.length > 0 && mods.every(m => m.enabled);
        }
        case 'dayOfWeek':
            return Array.isArray(p.days) && p.days.includes(now.getDay());
        case 'timeRange': {
            const toMin = (s: string) => { const [h, m] = s.split(':').map((n: string) => parseInt(n, 10) || 0); return h * 60 + m; };
            const cur = now.getHours() * 60 + now.getMinutes();
            const a = toMin(p.from || '00:00'), b = toMin(p.to || '23:59');
            return a <= b ? (cur >= a && cur <= b) : (cur >= a || cur <= b);
        }
        case 'commandSucceeds': {
            const args = (p.args || '').trim() ? String(p.args).split(/\s+/) : [];
            try { await invoke('run_scheduled_command', { program: p.program, args, workingDir: p.workingDir || null, allow: true }); return true; }
            catch { return false; }
        }
        // ── File verification / comparison ─────────────────────────────────────
        case 'fileHash': {
            // True when the file's hash (blake3 default, or sha256) equals the
            // expected value. Used for "loop until <file> sha == <value>".
            try {
                const h = await invoke('hash_file', { path: p.path || '', algo: p.algo || 'blake3' }) as string;
                return (h || '').toLowerCase() === String(p.value || '').toLowerCase().replace(/^b3:/, '').trim();
            } catch { return false; }
        }
        case 'fileSize': {
            const m: any = await invoke('file_meta', { path: p.path || '' }).catch(() => null);
            if (!m || !m.exists) return false;
            return cmpNum(Number(m.size), p.op, Number(p.value));
        }
        case 'fileType': {
            const m: any = await invoke('file_meta', { path: p.path || '' }).catch(() => null);
            if (!m || !m.exists) return false;
            return String(m.ext || '').toLowerCase() === String(p.ext || '').toLowerCase().replace(/^\./, '');
        }
        case 'fileName': {
            const m: any = await invoke('file_meta', { path: p.path || '' }).catch(() => null);
            if (!m || !m.exists) return false;
            return String(m.name || '').toLowerCase().includes(String(p.value || '').toLowerCase());
        }
        case 'fileNewer': {
            // True when the file was modified within the last N minutes.
            const m: any = await invoke('file_meta', { path: p.path || '' }).catch(() => null);
            if (!m || !m.exists || !m.modified_ms) return false;
            const ageMin = (Date.now() - Number(m.modified_ms)) / 60000;
            return ageMin <= Math.max(0, Number(p.minutes) || 0);
        }
    }
    return false;
}

/** Numeric comparison shared by value/size conditions. */
function cmpNum(left: number, op: string, right: number): boolean {
    if (Number.isNaN(left) || Number.isNaN(right)) return false;
    switch (op) {
        case '>': return left > right;
        case '<': return left < right;
        case '>=': return left >= right;
        case '<=': return left <= right;
        case '!=': return left !== right;
        case '==': default: return left === right;
    }
}

// ── List rendering (glass-card) ───────────────────────────────────────────────
export function renderScheduleList(): void {
    const container = document.getElementById('scheduler-list-container');
    if (!container) return;
    if (!_tasks.length) {
        container.innerHTML = `<p style="font-size:12px;color:var(--text-muted);opacity:.75;margin:0">${
            t('sched.empty') || 'No scheduled tasks yet. Create one to automate BMM.'}</p>`;
        return;
    }
    container.innerHTML = '';
    for (const task of _tasks) {
        const row = document.createElement('div');
        row.className = 'sched-row';
        row.innerHTML = `
            <div class="sched-row-main">
                <label class="plug-toggle sched-toggle">
                    <input type="checkbox" ${task.enabled ? 'checked' : ''} data-act="toggle">
                    <span class="plug-toggle-slider"></span>
                </label>
                <div class="sched-row-text">
                    <strong>${escHtml(task.name)}</strong>
                    ${task.description ? `<span class="sched-row-desc">${escHtml(task.description)}</span>` : ''}
                    <span class="sched-row-sub">${escHtml(triggerLabel(task.trigger))} · ${stepCount(task.steps)} ${t('sched.steps') || 'steps'}${
                        task.lastRun ? ` · ${t('sched.last') || 'last'} ${new Date(task.lastRun).toLocaleString()}` : ''}</span>
                </div>
            </div>
            <div class="sched-row-actions">
                <button class="btn btn-xs btn-ghost" data-act="run" title="${escAttr(t('sched.runNow') || 'Run now')}">▶</button>
                <button class="btn btn-xs btn-ghost" data-act="edit">${t('common.edit') || 'Edit'}</button>
                <button class="btn btn-xs btn-ghost" data-act="del" style="color:var(--danger)">${t('common.delete') || 'Delete'}</button>
            </div>`;
        row.querySelector('[data-act="toggle"]')?.addEventListener('change', async (e) => {
            task.enabled = (e.target as HTMLInputElement).checked; await saveTasks();
            if (task.osSchedule) await syncOsSchedule(task);
        });
        row.querySelector('[data-act="run"]')?.addEventListener('click', () => runTask(task));
        row.querySelector('[data-act="edit"]')?.addEventListener('click', () => openTaskModal(task));
        row.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
            if (!await window.confirmCustom!(t('sched.delTitle') || 'Delete task', `${task.name}?`, 'danger',
                { yesLabel: t('common.delete') || 'Delete', noLabel: t('common.cancel') || 'Cancel' })) return;
            if (task.osSchedule) { try { await invoke('unregister_os_schedule', { taskId: task.id }); } catch {} }
            _tasks = _tasks.filter(x => x.id !== task.id); await saveTasks(); renderScheduleList();
        });
        container.appendChild(row);
    }
}

function stepCount(steps: Step[]): number {
    let n = 0;
    for (const s of steps || []) { n++; if (s.kind === 'if') n += stepCount(s.then) + stepCount(s.else); }
    return n;
}
function triggerLabel(tr: Trigger): string {
    switch (tr.type) {
        case 'once': return `${t('sched.trOnce') || 'Once'} ${new Date(tr.at).toLocaleString()}`;
        case 'interval': return `${t('sched.trEvery') || 'Every'} ${tr.everyMinutes} min`;
        case 'hourly': return `${t('sched.trEvery') || 'Every'} ${tr.everyHours} h`;
        case 'dailyAt': return `${t('sched.trDaily') || 'Daily at'} ${tr.time}`;
        case 'weeklyAt': return `${t('sched.trWeekly') || 'Weekly'} ${tr.time}`;
        case 'monthlyAt': return `${t('sched.trMonthly') || 'Monthly'} ${t('sched.day') || 'day'} ${tr.day} ${tr.time}`;
        case 'appStart': return t('sched.trAppStart') || 'On BMM start';
        case 'manual': return t('sched.trManual') || 'Manual only';
    }
}

// ── Modal builder ─────────────────────────────────────────────────────────────
let _editing: Task | null = null;
let _draft: Task;

async function loadPickers(): Promise<void> {
    const [profiles, mods, modpacks, builtin, installed, appsState] = await Promise.all([
        invoke('get_profiles').catch(() => []),
        invoke('get_all_mods').catch(() => []),
        invoke('load_modpacks').catch(() => []),
        invoke('list_builtin_themes').catch(() => '[]'),
        invoke('list_installed_themes').catch(() => '[]'),
        invoke('get_apps_state').catch(() => ({ installed: {} })),
    ]);
    _disks = await invoke('get_system_disks').catch(() => []) as any[];
    _profiles = profiles as any[];
    _mods = mods as any[];
    _modpacks = modpacks as any[];
    // The theme commands return a JSON *string* — parse before merging.
    const parse = (v: any): any[] => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };
    _themes = [...parse(builtin), ...parse(installed)].map((th: any) => ({ id: th.id, name: th.name || th.id }));
    // Installed apps for the "Launch app" picker.
    const inst = (appsState as any)?.installed || {};
    _apps = Object.entries(inst).map(([id, info]: any) => ({ id, name: info?.title || id, exe: info?.exe_path || '' }));
}

async function openTaskModal(task: Task | null): Promise<void> {
    await loadPickers();
    _editing = task;
    _draft = task ? JSON.parse(JSON.stringify(task)) : {
        id: `sched-${Date.now()}`, name: '', enabled: true,
        trigger: { type: 'interval', everyMinutes: 60 }, steps: [], allowCustomCommands: false,
    };
    let modal = document.getElementById('modal-scheduler');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-scheduler';
        modal.className = 'modal-generic-overlay';
        // Append INSIDE the app window (position:relative, overflow:hidden) so the
        // absolute 100%×100% overlay is bounded to the visible app, not the whole
        // document (which extends past the rounded window → oversized backdrop).
        (document.getElementById('app-window-outer') || document.body).appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal!.classList.remove('open'); });
    }
    renderModal(modal);
    modal.classList.add('open');
}

function renderModal(modal: HTMLElement): void {
    modal.innerHTML = `
      <div class="modal glass sched-modal">
        <div class="modal-header">
            <h2 class="modal-title" style="margin:0;font-size:1.15rem">${_editing ? (t('sched.editTitle') || 'Edit task') : (t('sched.newTitle') || 'New scheduled task')}</h2>
            <button class="modal-close" id="sched-close">&times;</button>
        </div>
        <div class="modal-body sched-body">
            <label class="sched-label">${t('sched.fName') || 'Name'}</label>
            <input class="input" id="sched-name" value="${escAttr(_draft.name)}" placeholder="${escAttr(t('sched.fNamePh') || 'e.g. Activate DCS profile every morning')}">

            <label class="sched-label">${t('sched.fDescription') || 'Description'} <span class="sched-hint-inline">${t('common.optional') || '(optional)'}</span></label>
            <textarea class="input" id="sched-desc" rows="2" placeholder="${escAttr(t('sched.fDescriptionPh') || 'What does this automation do?')}" style="resize:vertical">${escHtml(_draft.description || '')}</textarea>

            <label class="sched-label">${t('sched.fTrigger') || 'Trigger'} <span class="sched-hint-inline">${t('sched.fTriggerHint') || '— WHEN it runs'}</span></label>
            <div id="sched-trigger"></div>

            <label class="sched-label" style="margin-top:14px">${t('sched.fSteps') || 'Steps (run in order)'} <span class="sched-hint-inline">${t('sched.fStepsHint') || '— WHAT it does, top to bottom'}</span></label>
            <div class="sched-legend">
                <span><b class="sched-step-tag sched-do">${t('sched.do') || 'DO'}</b> ${t('sched.legendDo') || 'run an action (activate profile, enable modpack, launch app, run a command…)'}</span>
                <span><b class="sched-step-tag sched-if">${t('sched.if') || 'IF'}</b> ${t('sched.legendIf') || 'branch: do something only if a condition is true (else do other steps)'}</span>
                <span><b class="sched-step-tag sched-wait">${t('sched.waitUntil') || 'WAIT UNTIL'}</b> ${t('sched.legendWait') || 'pause until a state is reached (all mods active, app running…) then continue'}</span>
                <span><b class="sched-step-tag" style="background:rgba(148,163,184,.18);color:#94a3b8">${t('sched.delay') || 'WAIT'}</b> ${t('sched.legendDelay') || 'pause a fixed number of seconds'}</span>
            </div>
            <div id="sched-steps" class="sched-steps"></div>
            <div class="sched-add-row" id="sched-root-add"></div>

            <label class="plug-perm-global-card" style="margin-top:14px;display:flex;align-items:center;gap:10px;padding:10px 12px">
                <input type="checkbox" id="sched-allow-cmd" ${_draft.allowCustomCommands ? 'checked' : ''}>
                <span style="font-size:12px;color:var(--text-secondary)">${t('sched.allowCmd') || 'Allow this task to run custom external commands (runs real programs on your PC)'}</span>
            </label>

            <label class="plug-perm-global-card" style="margin-top:8px;display:flex;align-items:center;gap:10px;padding:10px 12px">
                <input type="checkbox" id="sched-os" ${_draft.osSchedule ? 'checked' : ''}>
                <span style="font-size:12px;color:var(--text-secondary)">${t('sched.osSchedule') || 'Run even when BMM is closed (registers a Windows Scheduled Task that launches BMM at the trigger time)'}</span>
            </label>
        </div>
        <div class="modal-footer sched-footer">
            <button class="btn btn-ghost" id="sched-cancel">${t('common.cancel') || 'Cancel'}</button>
            <button class="btn btn-primary" id="sched-save">${t('common.save') || 'Save'}</button>
        </div>
      </div>`;

    modal.querySelector('#sched-close')?.addEventListener('click', () => modal.classList.remove('open'));
    modal.querySelector('#sched-cancel')?.addEventListener('click', () => modal.classList.remove('open'));
    modal.querySelector('#sched-name')?.addEventListener('input', (e) => { _draft.name = (e.target as HTMLInputElement).value; });
    modal.querySelector('#sched-desc')?.addEventListener('input', (e) => { _draft.description = (e.target as HTMLTextAreaElement).value; });
    modal.querySelector('#sched-allow-cmd')?.addEventListener('change', (e) => { _draft.allowCustomCommands = (e.target as HTMLInputElement).checked; });
    modal.querySelector('#sched-os')?.addEventListener('change', (e) => { _draft.osSchedule = (e.target as HTMLInputElement).checked; });
    modal.querySelector('#sched-save')?.addEventListener('click', async () => {
        if (!_draft.name.trim()) { toast(t('sched.needName') || 'Name required', 'warning'); return; }
        if (_draft.osSchedule && (_draft.trigger.type as string) === 'appStart') {
            // appStart already runs on launch; OS task would be redundant but harmless.
        }
        const idx = _tasks.findIndex(x => x.id === _draft.id);
        if (idx >= 0) _tasks[idx] = _draft; else _tasks.push(_draft);
        await saveTasks();
        await syncOsSchedule(_draft);
        renderScheduleList(); modal.classList.remove('open');
    });

    renderTriggerEditor(modal.querySelector('#sched-trigger') as HTMLElement);
    renderStepsEditor(modal.querySelector('#sched-steps') as HTMLElement, _draft.steps);
    renderAddRow(modal.querySelector('#sched-root-add') as HTMLElement, _draft.steps);
}

function renderTriggerEditor(host: HTMLElement): void {
    const tr = _draft.trigger;
    const opt = (v: string, label: string) => `<option value="${v}" ${tr.type === v ? 'selected' : ''}>${label}</option>`;
    host.innerHTML = `
        <select class="input" id="sched-tr-type" style="max-width:240px">
            ${opt('interval', t('sched.trEvery') || 'Every N minutes')}
            ${opt('hourly', t('sched.trHourly') || 'Every N hours')}
            ${opt('dailyAt', t('sched.trDaily') || 'Daily at time')}
            ${opt('weeklyAt', t('sched.trWeekly') || 'Weekly on days')}
            ${opt('monthlyAt', t('sched.trMonthly') || 'Monthly on a day')}
            ${opt('once', t('sched.trOnce') || 'Once at date/time')}
            ${opt('appStart', t('sched.trAppStart') || 'On BMM start')}
            ${opt('manual', t('sched.trManual') || 'Manual only (Run button)')}
        </select>
        <div id="sched-tr-params" style="margin-top:8px"></div>`;
    host.querySelector('#sched-tr-type')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v === 'interval') _draft.trigger = { type: 'interval', everyMinutes: 60 };
        else if (v === 'hourly') _draft.trigger = { type: 'hourly', everyHours: 1 };
        else if (v === 'dailyAt') _draft.trigger = { type: 'dailyAt', time: '08:00' };
        else if (v === 'weeklyAt') _draft.trigger = { type: 'weeklyAt', time: '08:00', days: [1] };
        else if (v === 'monthlyAt') _draft.trigger = { type: 'monthlyAt', day: 1, time: '08:00' };
        else if (v === 'once') _draft.trigger = { type: 'once', at: new Date(Date.now() + 3600000).toISOString().slice(0, 16) };
        else if (v === 'manual') _draft.trigger = { type: 'manual' };
        else _draft.trigger = { type: 'appStart' };
        renderTriggerEditor(host);
    });
    const ph = host.querySelector('#sched-tr-params') as HTMLElement;
    if (tr.type === 'interval') {
        ph.innerHTML = `<input type="number" class="input" id="sched-tr-min" min="1" value="${tr.everyMinutes}" style="max-width:120px"> ${t('sched.unitMin') || 'min'}`;
        ph.querySelector('#sched-tr-min')?.addEventListener('input', (e) => { (_draft.trigger as any).everyMinutes = parseInt((e.target as HTMLInputElement).value) || 1; });
    } else if (tr.type === 'hourly') {
        ph.innerHTML = `<input type="number" class="input" id="sched-tr-h" min="1" value="${tr.everyHours}" style="max-width:120px"> ${t('sched.unitH') || 'h'}`;
        ph.querySelector('#sched-tr-h')?.addEventListener('input', (e) => { (_draft.trigger as any).everyHours = parseInt((e.target as HTMLInputElement).value) || 1; });
    } else if (tr.type === 'monthlyAt') {
        ph.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${t('sched.day') || 'Day'}</span>
            <input type="number" class="input" id="sched-tr-dom" min="1" max="31" value="${tr.day}" style="max-width:90px">
            <span style="font-size:12px;color:var(--text-muted)">${t('sched.atTime') || 'at'}</span>
            <input type="time" class="input" id="sched-tr-time" value="${tr.time}" style="max-width:140px">`;
        ph.querySelector('#sched-tr-dom')?.addEventListener('input', (e) => { (_draft.trigger as any).day = Math.min(31, Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1)); });
        ph.querySelector('#sched-tr-time')?.addEventListener('input', (e) => { (_draft.trigger as any).time = (e.target as HTMLInputElement).value; });
    } else if (tr.type === 'manual') {
        ph.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${t('sched.trManualHint') || 'Never runs automatically — use the ▶ Run button or a bmm://schedule/run link.'}</span>`;
    } else if (tr.type === 'dailyAt') {
        ph.innerHTML = `<input type="time" class="input" id="sched-tr-time" value="${tr.time}" style="max-width:140px">`;
        ph.querySelector('#sched-tr-time')?.addEventListener('input', (e) => { (_draft.trigger as any).time = (e.target as HTMLInputElement).value; });
    } else if (tr.type === 'weeklyAt') {
        const dayNames = (t('sched.dayNames') || 'Sun,Mon,Tue,Wed,Thu,Fri,Sat').split(',');
        ph.innerHTML = `<input type="time" class="input" id="sched-tr-time" value="${tr.time}" style="max-width:140px;margin-bottom:8px">
            <div style="display:flex;gap:4px;flex-wrap:wrap">${dayNames.map((d, i) =>
                `<button type="button" class="btn btn-xs ${tr.days.includes(i) ? 'btn-accent' : 'btn-ghost'}" data-day="${i}">${escHtml(d)}</button>`).join('')}</div>`;
        ph.querySelector('#sched-tr-time')?.addEventListener('input', (e) => { (_draft.trigger as any).time = (e.target as HTMLInputElement).value; });
        ph.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
            const i = parseInt((b as HTMLElement).dataset.day!); const days = (_draft.trigger as any).days as number[];
            const k = days.indexOf(i); if (k >= 0) days.splice(k, 1); else days.push(i); renderTriggerEditor(host);
        }));
    } else if (tr.type === 'once') {
        ph.innerHTML = `<input type="datetime-local" class="input" id="sched-tr-at" value="${escAttr(tr.at.slice(0, 16))}" style="max-width:220px">`;
        ph.querySelector('#sched-tr-at')?.addEventListener('input', (e) => { (_draft.trigger as any).at = new Date((e.target as HTMLInputElement).value).toISOString(); });
    } else {
        ph.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${t('sched.trAppStartHint') || 'Runs once each time BMM launches.'}</span>`;
    }
}

// Recursive step list editor.
function renderStepsEditor(host: HTMLElement, steps: Step[], depth = 0): void {
    host.innerHTML = '';
    steps.forEach((step, i) => {
        const block = document.createElement('div');
        block.className = 'sched-step sched-step-' + step.kind;
        // Indentation is handled entirely by the branch containers' padding (one
        // clean guide line per level) — NOT a per-step margin, which used to stack
        // on top of the branch padding and squeezed deep blocks into a tiny column.
        if (step.kind === 'action') {
            block.appendChild(actionEditor(step.action, () => { steps.splice(i, 1); renderStepsEditor(host, steps, depth); }));
        } else if (step.kind === 'delay') {
            block.innerHTML = `<div class="sched-step-head"><span class="sched-step-tag">${t('sched.delay') || 'Wait'}</span>
                <input type="number" class="input" min="0" value="${step.seconds}" style="max-width:90px"> ${t('sched.unitSec') || 's'}
                <button class="btn btn-xs btn-ghost sched-del" style="margin-left:auto;color:var(--danger)">${SCHED_X}</button></div>`;
            block.querySelector('input')?.addEventListener('input', (e) => { step.seconds = parseInt((e.target as HTMLInputElement).value) || 0; });
            block.querySelector('.sched-del')?.addEventListener('click', () => { steps.splice(i, 1); renderStepsEditor(host, steps, depth); });
        } else if (step.kind === 'waitFor') {
            const toMode = step.onTimeout || 'abort';
            block.innerHTML = `<div class="sched-step-head"><span class="sched-step-tag sched-wait">${t('sched.waitUntil') || 'WAIT UNTIL'}</span>
                <span class="sched-cond-label">${t('sched.condition') || 'condition:'}</span>
                <div class="sched-cond" style="flex:1"></div>
                <button class="btn btn-xs btn-ghost sched-del" style="color:var(--danger)">${SCHED_X}</button></div>
                <div class="sched-wait-opts">
                    <span class="sched-wait-lbl">${t('sched.checkEvery') || 'check every'}</span>
                    <input type="number" class="input sched-wait-poll" min="1" value="${step.pollSec || 2}" style="max-width:70px"> ${t('sched.unitSec') || 's'}
                    <span class="sched-wait-lbl">${t('sched.timeout') || 'timeout'}</span>
                    <input type="number" class="input sched-wait-to" min="1" value="${step.timeoutSec}" style="max-width:80px"> ${t('sched.unitSec') || 's'}
                    <span class="sched-wait-lbl">${t('sched.onTimeout') || 'on timeout'}</span>
                    <select class="input sched-wait-ot" style="max-width:150px">
                        <option value="abort"${toMode === 'abort' ? ' selected' : ''}>${t('sched.timeoutAbort') || 'stop the task (error)'}</option>
                        <option value="continue"${toMode === 'continue' ? ' selected' : ''}>${t('sched.timeoutContinue') || 'continue anyway'}</option>
                    </select>
                </div>`;
            block.querySelector('.sched-cond')?.appendChild(conditionEditor(step.condition));
            block.querySelector('.sched-wait-to')?.addEventListener('input', (e) => { step.timeoutSec = parseInt((e.target as HTMLInputElement).value) || 60; });
            block.querySelector('.sched-wait-poll')?.addEventListener('input', (e) => { step.pollSec = parseInt((e.target as HTMLInputElement).value) || 2; });
            block.querySelector('.sched-wait-ot')?.addEventListener('change', (e) => { step.onTimeout = (e.target as HTMLSelectElement).value as any; });
            block.querySelector('.sched-del')?.addEventListener('click', () => { steps.splice(i, 1); renderStepsEditor(host, steps, depth); });
        } else if (step.kind === 'if') {
            block.innerHTML = `<div class="sched-step-head"><span class="sched-step-tag sched-if">${t('sched.if') || 'IF'}</span>
                <span class="sched-cond-label">${t('sched.condition') || 'condition:'}</span>
                <div class="sched-cond" style="flex:1"></div>
                <button class="btn btn-xs btn-ghost sched-del" style="color:var(--danger)">${SCHED_X}</button></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.then') || 'THEN'}</div><div class="sched-then"></div><div class="sched-then-add"></div></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.else') || 'ELSE'}</div><div class="sched-else"></div><div class="sched-else-add"></div></div>`;
            block.querySelector('.sched-cond')?.appendChild(conditionEditor(step.condition));
            block.querySelector('.sched-del')?.addEventListener('click', () => { steps.splice(i, 1); renderStepsEditor(host, steps, depth); });
            renderStepsEditor(block.querySelector('.sched-then') as HTMLElement, step.then, depth + 1);
            renderStepsEditor(block.querySelector('.sched-else') as HTMLElement, step.else, depth + 1);
            renderAddRow(block.querySelector('.sched-then-add') as HTMLElement, step.then, depth + 1, host, steps, depth);
            renderAddRow(block.querySelector('.sched-else-add') as HTMLElement, step.else, depth + 1, host, steps, depth);
        } else if (step.kind === 'repeat') {
            const modeSel = (['while', 'until', 'times'] as const).map(m =>
                `<option value="${m}"${step.mode === m ? ' selected' : ''}>${escHtml(t('sched.loop.' + m) || m)}</option>`).join('');
            block.innerHTML = `<div class="sched-step-head">
                    <span class="sched-step-tag sched-repeat">${t('sched.repeat') || 'REPEAT'}</span>
                    <select class="input sched-rep-mode" style="max-width:130px">${modeSel}</select>
                    <span class="sched-rep-cond-wrap" style="display:${step.mode === 'times' ? 'none' : 'flex'};align-items:center;gap:6px;flex:1"><div class="sched-cond" style="flex:1"></div></span>
                    <span class="sched-rep-times-wrap" style="display:${step.mode === 'times' ? 'inline-flex' : 'none'};align-items:center;gap:6px"><input type="number" class="input sched-rep-times" min="1" value="${step.times || 3}" style="max-width:90px"> ${t('sched.loopTimes') || 'times'}</span>
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.loopMax') || 'max'}</span><input type="number" class="input sched-rep-max" min="1" value="${step.maxIters || 100}" style="max-width:90px">
                    <span style="font-size:11px;color:var(--text-muted)">${t('sched.loopEvery') || 'every'}</span><input type="number" class="input sched-rep-every" min="0" value="${step.everySec || 1}" style="max-width:80px"> ${t('sched.unitSec') || 's'}
                    <button class="btn btn-xs btn-ghost sched-del" style="color:var(--danger)">${SCHED_X}</button></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.loopBody') || 'LOOP'}</div><div class="sched-loop"></div><div class="sched-loop-add"></div></div>`;
            if (!step.condition) step.condition = { type: 'always', params: {} };
            block.querySelector('.sched-cond')?.appendChild(conditionEditor(step.condition));
            block.querySelector('.sched-rep-mode')?.addEventListener('change', (e) => { step.mode = (e.target as HTMLSelectElement).value as any; renderStepsEditor(host, steps, depth); });
            block.querySelector('.sched-rep-times')?.addEventListener('input', (e) => { step.times = parseInt((e.target as HTMLInputElement).value) || 1; });
            block.querySelector('.sched-rep-max')?.addEventListener('input', (e) => { step.maxIters = parseInt((e.target as HTMLInputElement).value) || 100; });
            block.querySelector('.sched-rep-every')?.addEventListener('input', (e) => { step.everySec = parseFloat((e.target as HTMLInputElement).value) || 0; });
            block.querySelector('.sched-del')?.addEventListener('click', () => { steps.splice(i, 1); renderStepsEditor(host, steps, depth); });
            renderStepsEditor(block.querySelector('.sched-loop') as HTMLElement, step.steps, depth + 1);
            renderAddRow(block.querySelector('.sched-loop-add') as HTMLElement, step.steps, depth + 1, host, steps, depth);
        }
        host.appendChild(block);
    });
}

function renderAddRow(host: HTMLElement, steps: Step[], depth = 0, rerenderHost?: HTMLElement, rerenderSteps?: Step[], rerenderDepth = 0): void {
    host.className = 'sched-add-row';
    const I = {
        do: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
        if: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
        wait: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        delay: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
        loop: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    };
    host.innerHTML = `
        <button class="btn btn-xs sched-chip sched-add-do" data-add="action" title="${escAttr(t('sched.legendDo') || '')}">${I.do} ${t('sched.addAction') || 'Action'}</button>
        <button class="btn btn-xs sched-chip sched-add-if" data-add="if" title="${escAttr(t('sched.legendIf') || '')}">${I.if} ${t('sched.addIf') || 'If/Else'}</button>
        <button class="btn btn-xs sched-chip sched-add-loop" data-add="repeat" title="${escAttr(t('sched.legendLoop') || '')}">${I.loop} ${t('sched.addLoop') || 'Loop'}</button>
        <button class="btn btn-xs sched-chip sched-add-wait" data-add="waitFor" title="${escAttr(t('sched.legendWait') || '')}">${I.wait} ${t('sched.addWaitFor') || 'Wait until'}</button>
        <button class="btn btn-xs sched-chip sched-add-delay" data-add="delay" title="${escAttr(t('sched.legendDelay') || '')}">${I.delay} ${t('sched.addDelay') || 'Pause'}</button>`;
    const rerender = () => {
        // Preserve the modal's scroll position so adding a step deep in a big task
        // doesn't yank the view back to the top (a real annoyance with lots of content).
        const body = document.querySelector('#modal-scheduler .sched-body') as HTMLElement | null;
        const top = body ? body.scrollTop : 0;
        if (rerenderHost) renderStepsEditor(rerenderHost, rerenderSteps!, rerenderDepth);
        else renderStepsEditor(host.previousElementSibling as HTMLElement || host.parentElement!.querySelector('.sched-steps') as HTMLElement, steps, depth);
        if (body) body.scrollTop = top;
    };
    host.querySelector('[data-add="action"]')?.addEventListener('click', () => { steps.push({ kind: 'action', action: { type: 'profile.activate', params: {} } }); rerender(); });
    host.querySelector('[data-add="if"]')?.addEventListener('click', () => { steps.push({ kind: 'if', condition: { type: 'always', params: {} }, then: [], else: [] }); rerender(); });
    host.querySelector('[data-add="repeat"]')?.addEventListener('click', () => { steps.push({ kind: 'repeat', mode: 'while', condition: { type: 'always', params: {} }, maxIters: 100, everySec: 1, steps: [] }); rerender(); });
    host.querySelector('[data-add="waitFor"]')?.addEventListener('click', () => { steps.push({ kind: 'waitFor', condition: { type: 'allModsActive', params: {} }, timeoutSec: 120 }); rerender(); });
    host.querySelector('[data-add="delay"]')?.addEventListener('click', () => { steps.push({ kind: 'delay', seconds: 5 }); rerender(); });
}

// group → optgroup label (matches the script generator's categories).
const ACTION_GROUPS: { g: string; label: string }[] = [
    { g: 'mods',    label: 'Mods & profiles' },
    { g: 'repo',    label: 'Repo & sharing' },
    { g: 'apps',    label: 'Apps & launch' },
    { g: 'look',    label: 'Appearance' },
    { g: 'perf',    label: 'Benchmarks & storage' },
    { g: 'privacy', label: 'Privacy & recorder' },
    { g: 'system',  label: 'System & flow' },
];

// icon per group (inline SVG, no emoji — matches the BMM icon-only rule).
const GROUP_ICON: Record<string, string> = {
    mods:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
    repo:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20z"/></svg>',
    apps:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    look:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><path d="M12 2a10 10 0 1 0 0 20a3 3 0 0 0 0-6h-1a2 2 0 0 1 0-4h3a4 4 0 0 0 0-8z"/></svg>',
    perf:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
    privacy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    system:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

// Clean inline X icon for delete buttons (replaces the raw ✕ glyph).
const SCHED_X = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

const ACTION_TYPES: { v: string; label: string; needs?: string; group: string }[] = [
    // ── Mods & profiles ──
    { v: 'profile.activate', label: 'Activate profile', needs: 'profile', group: 'mods' },
    { v: 'mod.enable', label: 'Enable mod', needs: 'mod', group: 'mods' },
    { v: 'mod.disable', label: 'Disable mod', needs: 'mod', group: 'mods' },
    { v: 'modpack.enable', label: 'Enable modpack', needs: 'modpack', group: 'mods' },
    { v: 'modpack.disable', label: 'Disable modpack', needs: 'modpack', group: 'mods' },
    { v: 'modpack.create', label: 'Create modpack', needs: 'mpCreate', group: 'mods' },
    { v: 'mod.add', label: 'Add a mod (from URL)', needs: 'modAdd', group: 'mods' },
    { v: 'modlist.export', label: 'Export a mod list (.mmlist)', group: 'mods' },
    { v: 'modlist.import', label: 'Import a mod list (.mmlist)', group: 'mods' },
    { v: 'mods.enableAll', label: 'Enable all mods', group: 'mods' },
    { v: 'mods.disableAll', label: 'Disable all mods', group: 'mods' },
    { v: 'mods.scan', label: 'Scan mods folder', group: 'mods' },
    { v: 'plugin.apply', label: 'Apply plugin modlist', needs: 'pluginId', group: 'mods' },
    { v: 'plugin.compare', label: 'Compare plugin', needs: 'pluginId', group: 'mods' },
    { v: 'plugin.delete', label: 'Delete plugin', needs: 'pluginId', group: 'mods' },
    { v: 'mods.checkUpdates', label: 'Check mod updates', group: 'mods' },
    // ── Repo & sharing ──
    { v: 'repo.connect', label: 'Connect repo', needs: 'repoConnect', group: 'repo' },
    { v: 'repo.sync', label: 'Sync repo', needs: 'repoSync', group: 'repo' },
    { v: 'repo.gen', label: 'Generate repo', group: 'repo' },
    { v: 'repo.update', label: 'Update repo', needs: 'repoUpdate', group: 'repo' },
    { v: 'repo.host', label: 'Host repo (HTTP)', needs: 'repoHost', group: 'repo' },
    // ── Apps & launch ──
    { v: 'app.launch', label: 'Launch app', needs: 'app', group: 'apps' },
    { v: 'file.open', label: 'Open / launch a file or program', needs: 'pathFile', group: 'apps' },
    { v: 'folder.open', label: 'Open a folder', needs: 'pathFolder', group: 'apps' },
    { v: 'app.install', label: 'Install app', needs: 'appInstall', group: 'apps' },
    { v: 'launchpack.run', label: 'Run launch pack', needs: 'lpId', group: 'apps' },
    // ── Appearance ──
    { v: 'theme.set', label: 'Set theme', needs: 'theme', group: 'look' },
    // ── Benchmarks & storage ──
    { v: 'benchmark.run', label: 'Run benchmark', needs: 'benchmark', group: 'perf' },
    { v: 'storage.diskBenchmark', label: 'Storage: benchmark a disk', needs: 'disk', group: 'perf' },
    { v: 'storage.applyLimit', label: 'Storage: apply disk speed limit', needs: 'applyLimit', group: 'perf' },
    { v: 'storage.calibration', label: 'Storage: Performance Auto-Calibration', needs: 'toggle', group: 'perf' },
    { v: 'storage.smartIo', label: 'Storage: Smart I/O', needs: 'toggle', group: 'perf' },
    { v: 'storage.flag', label: 'Storage: toggle a setting (advanced)', needs: 'flag', group: 'perf' },
    // ── Privacy & recorder ──
    { v: 'telemetry.consent', label: 'Telemetry consent', needs: 'toggle', group: 'privacy' },
    { v: 'telemetry.set', label: 'Telemetry options', needs: 'telemetry', group: 'privacy' },
    { v: 'recorder.set', label: 'Session recorder', needs: 'recorder', group: 'privacy' },
    { v: 'replay.export', label: 'Export replay', group: 'privacy' },
    { v: 'replay.import', label: 'Import replay', needs: 'replayImport', group: 'privacy' },
    // ── System & flow ──
    { v: 'notify', label: 'Show notification', needs: 'message', group: 'system' },
    { v: 'discord.rpc', label: 'Discord Rich Presence', needs: 'toggle', group: 'system' },
    { v: 'data.exportAuto', label: 'Export data (backup)', needs: 'exportAuto', group: 'system' },
    { v: 'var.set', label: 'Set a value (for conditions)', needs: 'var', group: 'system' },
    { v: 'task.run', label: 'Run another scheduled task', needs: 'taskId', group: 'system' },
    { v: 'restart', label: 'Restart BMM', group: 'system' },
    { v: 'open.url', label: 'Open a URL / link', needs: 'url', group: 'system' },
    { v: 'custom.command', label: 'Run custom command', needs: 'command', group: 'system' },
    { v: 'deeplink', label: 'Run bmm:// deeplink', needs: 'url', group: 'system' },
];

function actionEditor(action: Action, onDelete: () => void): HTMLElement {
    const el = document.createElement('div');
    const render = () => {
        const def = ACTION_TYPES.find(a => a.v === action.type) || ACTION_TYPES[0];
        // Build a grouped <optgroup> dropdown that mirrors the script generator's
        // categorised action catalogue.
        const groupsHtml = ACTION_GROUPS.map(grp => {
            const opts = ACTION_TYPES.filter(a => a.group === grp.g);
            if (!opts.length) return '';
            return `<optgroup label="${escAttr(t('sched.grp.' + grp.g) || grp.label)}">${opts.map(a => {
                const ad = t('sched.actd.' + a.v); const desc = ad === ('sched.actd.' + a.v) ? '' : ad;
                return `<option value="${a.v}"${action.type === a.v ? ' selected' : ''} data-icon="${escAttr(GROUP_ICON[a.group] || '')}" data-desc="${escAttr(desc)}">${escHtml(t('sched.act.' + a.v) || a.label)}</option>`;
            }).join('')}</optgroup>`;
        }).join('');
        el.className = 'sched-act-card';
        el.innerHTML = `
            <div class="sched-act-head">
                <span class="sched-act-icon">${GROUP_ICON[def.group] || ''}</span>
                <span class="sched-step-tag sched-do">${t('sched.do') || 'DO'}</span>
                <select class="input sched-act-type">${groupsHtml}</select>
                <button class="btn btn-xs btn-ghost sched-del" title="${escAttr(t('common.delete') || 'Delete')}" aria-label="delete">${SCHED_X}</button>
            </div>
            <div class="sched-act-params"></div>`;
        el.querySelector('.sched-act-type')?.addEventListener('change', (e) => {
            action.type = (e.target as HTMLSelectElement).value; action.params = {}; render();
        });
        el.querySelector('.sched-del')?.addEventListener('click', onDelete);
        const paramsHost = el.querySelector('.sched-act-params') as HTMLElement;
        renderParams(paramsHost, def?.needs, action.params);
        // Hide the params row entirely when an action needs no configuration.
        paramsHost.style.display = paramsHost.innerHTML.trim() ? '' : 'none';
    };
    render();
    return el;
}

function pickerOptions(list: any[], selected: string, labelKey = 'name'): string {
    return `<option value="">— ${t('sched.pick') || 'select'} —</option>` +
        list.map(o => `<option value="${escAttr(o.id)}" ${o.id === selected ? 'selected' : ''}>${escHtml(o[labelKey] || o.title || o.id)}</option>`).join('');
}

function renderParams(host: HTMLElement, needs: string | undefined, params: Record<string, any>): void {
    if (!needs) { host.innerHTML = ''; return; }
    if (needs === 'profile') host.innerHTML = `<select class="input sched-p" style="max-width:200px">${pickerOptions(_profiles, params.id)}</select>`;
    else if (needs === 'mod') host.innerHTML = `<select class="input sched-p" style="max-width:240px">${pickerOptions(_mods, params.id)}</select>`;
    else if (needs === 'modpack') host.innerHTML = `<select class="input sched-p" style="max-width:200px">${pickerOptions(_modpacks, params.id)}</select>`;
    else if (needs === 'theme') host.innerHTML = `<select class="input sched-p" style="max-width:200px">${pickerOptions(_themes, params.id)}</select>`;
    else if (needs === 'app') host.innerHTML = _apps.length
        ? `<select class="input sched-p" style="max-width:220px">${pickerOptions(_apps, params.id)}</select>`
        : `<input class="input sched-p" placeholder="${escAttr(t('sched.appIdPh') || 'app id (install an app first)')}" value="${escAttr(params.id || '')}" style="max-width:220px">`;
    else if (needs === 'message') host.innerHTML = `<input class="input sched-p" placeholder="${escAttr(t('sched.message') || 'message')}" value="${escAttr(params.message || '')}">`;
    else if (needs === 'url') host.innerHTML = `<input class="input sched-p" placeholder="bmm://mod/enable?id=…" value="${escAttr(params.url || '')}">`;
    else if (needs === 'command') host.innerHTML = `
        <div class="sched-cmd-builder">
            <label class="sched-cmd-label">${t('sched.cmdProgram') || '1. Program to run'}</label>
            <div class="sched-cmd-row">
                <input class="input sched-p-prog" placeholder="${escAttr(t('sched.programPh') || 'e.g. notepad.exe')}" value="${escAttr(params.program || '')}">
                <button type="button" class="btn btn-sm btn-secondary sched-browse-prog">${t('sched.choose') || 'Choose…'}</button>
            </div>
            <label class="sched-cmd-label">${t('sched.cmdArgs') || '2. Arguments'} <span class="sched-cmd-opt">${t('common.optional') || '(optional)'}</span></label>
            <input class="input sched-p-args" placeholder="${escAttr(t('sched.argsPh2') || 'e.g.  --profile DCS   (leave empty if none)')}" value="${escAttr(params.args || '')}">
            <details class="sched-cmd-adv">
                <summary>${t('sched.cmdAdvanced') || 'Advanced — working folder'}</summary>
                <div class="sched-cmd-row" style="margin-top:6px">
                    <input class="input sched-p-wd" placeholder="${escAttr(t('sched.workdirPh') || 'folder to run from (optional)')}" value="${escAttr(params.workingDir || '')}">
                    <button type="button" class="btn btn-sm btn-secondary sched-browse-wd">${t('sched.choose') || 'Choose…'}</button>
                </div>
            </details>
            <span class="sched-cmd-hint">${t('sched.cmdHint') || 'Tip: tick “Allow custom commands” at the bottom of this task, or it won’t run.'}</span>
        </div>`;
    else if (needs === 'benchmark') {
        const profOpts = _profiles.filter((p: any) => p.mods_path)
            .map((p: any) => `<option value="${escAttr(p.mods_path)}">${escHtml(p.name || p.id)}</option>`).join('');
        host.innerHTML = `
        <select class="input sched-b-dataset" style="max-width:120px">
            <option value="sandbox"${params.dataset !== 'real' ? ' selected' : ''}>${t('bench.sandbox') || 'Sandbox'}</option>
            <option value="real"${params.dataset === 'real' ? ' selected' : ''}>${t('bench.real') || 'Real'}</option>
        </select>
        <select class="input sched-b-size" style="max-width:100px">
            ${['S', 'M', 'L', 'XL', 'CUSTOM'].map(s => `<option value="${s}"${(params.size || 'M') === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
        <input class="input sched-b-mb" type="number" min="1" placeholder="${escAttr(t('sched.phMb') || 'MB')}" value="${escAttr(params.customMb || '')}" style="max-width:90px;display:${(params.size || 'M') === 'CUSTOM' ? 'inline-block' : 'none'}">
        <div class="sched-b-sources" style="display:${params.dataset === 'real' ? 'block' : 'none'};width:100%;margin-top:8px">
            <div class="sched-b-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>
            <button type="button" class="btn btn-sm sched-b-add-folder">${t('bench.addFolder') || '+ Folder'}</button>
            ${profOpts ? `<select class="input sched-b-add-profile" style="max-width:200px;margin-left:6px"><option value="">${t('bench.addProfile') || '+ Profile…'}</option>${profOpts}</select>` : ''}
        </div>`;
        // Sources picker (real mode): chips fed by a folder browser + profile dropdown.
        if (!Array.isArray(params.sources)) params.sources = params.sources ? [params.sources] : [];
        const chips = host.querySelector('.sched-b-chips') as HTMLElement;
        const renderChips = () => {
            const arr: string[] = params.sources;
            chips.innerHTML = arr.length ? arr.map((p, i) => `<span class="pill" style="display:inline-flex;align-items:center;gap:6px;max-width:100%">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px" title="${escAttr(p)}">${escHtml((p.split(/[\\/]/).pop() || p))}</span>
                <button type="button" class="sched-b-rm" data-i="${i}" style="background:none;border:0;color:var(--text-muted);cursor:pointer;display:inline-flex"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </span>`).join('') : `<span style="font-size:11px;color:var(--text-muted)">${t('bench.noProfile') || 'Pick profiles / folders (else sandbox is used)'}</span>`;
            chips.querySelectorAll('.sched-b-rm').forEach(b => b.addEventListener('click', () => { params.sources.splice(Number((b as HTMLElement).dataset.i), 1); renderChips(); }));
        };
        renderChips();
        host.querySelector('.sched-b-add-folder')?.addEventListener('click', async () => {
            const { pickFolder } = await import('../../core/api.js');
            const f = await pickFolder().catch(() => null);
            if (f && !params.sources.includes(f)) { params.sources.push(f); renderChips(); }
        });
        const ap = host.querySelector('.sched-b-add-profile') as HTMLSelectElement | null;
        ap?.addEventListener('change', () => { if (ap.value && !params.sources.includes(ap.value)) { params.sources.push(ap.value); renderChips(); } ap.value = ''; });
    }
    else if (needs === 'toggle') host.innerHTML = `<label style="font-size:12px;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" class="sched-en" ${params.enabled ? 'checked' : ''}> ${t('sched.enableOn') || 'Enable (uncheck = disable)'}</label>`;
    else if (needs === 'flag') host.innerHTML = `<input class="input sched-f-key" placeholder="${escAttr(t('sched.settingKey') || 'setting key (e.g. dcp)')}" value="${escAttr(params.key || '')}" style="max-width:180px"><label style="font-size:12px;margin-left:8px;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" class="sched-en" ${params.enabled ? 'checked' : ''}> on</label>`;
    else if (needs === 'disk') host.innerHTML = `<select class="input sched-disk" style="max-width:240px">${diskOptions(params.mountPoint)}</select>`;
    else if (needs === 'applyLimit') host.innerHTML = `<select class="input sched-disk" style="max-width:200px">${diskOptions(params.mountPoint)}</select><input class="input sched-limit" type="number" min="1" placeholder="${escAttr(t('sched.limitPh') || 'MB/s (empty = suggested)')}" value="${escAttr(params.limitMbS || '')}" style="max-width:200px;margin-left:6px">`;
    else if (needs === 'var') host.innerHTML = `<input class="input sched-v-name" placeholder="${escAttr(t('sched.phName') || 'name')}" value="${escAttr(params.name || '')}" style="max-width:140px"><input class="input sched-v-val" type="number" placeholder="${escAttr(t('sched.phValue') || 'value')}" value="${escAttr(params.value || '')}" style="max-width:120px;margin-left:6px">`;
    // ── New script-generator actions ──────────────────────────────────────────
    else if (needs === 'pathFile') host.innerHTML = `<input class="input sched-path" placeholder="${escAttr(t('sched.filePathPh') || 'file or .exe to open/launch')}" value="${escAttr(params.path || '')}" style="min-width:260px"><button type="button" class="btn btn-sm btn-secondary sched-browse-file" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button>`;
    else if (needs === 'pathFolder') host.innerHTML = `<input class="input sched-path" placeholder="${escAttr(t('sched.folderPathPh') || 'folder to open')}" value="${escAttr(params.path || '')}" style="min-width:260px"><button type="button" class="btn btn-sm btn-secondary sched-browse-folder" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button>`;
    else if (needs === 'pluginId') host.innerHTML = `<input class="input sched-p" placeholder="${escAttr(t('sched.pluginIdPh') || 'plugin id (from plugin.json)')}" value="${escAttr(params.id || '')}" style="max-width:260px">`;
    else if (needs === 'lpId')     host.innerHTML = `<input class="input sched-p" placeholder="${escAttr(t('sched.lpIdPh') || 'launch pack id')}" value="${escAttr(params.id || '')}" style="max-width:260px">`;
    else if (needs === 'taskId')   host.innerHTML = `<input class="input sched-p" placeholder="${escAttr(t('sched.taskIdPh') || 'scheduled task id')}" value="${escAttr(params.id || '')}" style="max-width:260px">`;
    else if (needs === 'repoConnect') host.innerHTML = `<input class="input sched-r-url" placeholder="${escAttr(t('sched.repoUrlPh') || 'repo.json URL')}" value="${escAttr(params.url || '')}" style="min-width:240px"><input class="input sched-r-name" placeholder="${escAttr(t('sched.repoNamePh') || 'name (optional)')}" value="${escAttr(params.name || '')}" style="max-width:180px;margin-left:6px">`;
    else if (needs === 'repoSync') host.innerHTML = `<input class="input sched-r-url" placeholder="${escAttr(t('sched.repoUrlPh') || 'repo.json URL')}" value="${escAttr(params.url || '')}" style="min-width:240px"><input class="input sched-r-prof" placeholder="${escAttr(t('sched.repoProfPh') || 'remote profile id')}" value="${escAttr(params.profile || '')}" style="max-width:180px;margin-left:6px">`;
    else if (needs === 'repoUpdate') host.innerHTML = `<input class="input sched-r-dir" placeholder="${escAttr(t('sched.repoDirPh') || 'repo folder')}" value="${escAttr(params.dir || '')}" style="min-width:240px"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button>`;
    else if (needs === 'repoHost') host.innerHTML = `<input class="input sched-r-dir" placeholder="${escAttr(t('sched.serveDirPh') || 'folder to serve')}" value="${escAttr(params.dir || '')}" style="min-width:220px"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button><input class="input sched-r-port" type="number" min="1" placeholder="port" value="${escAttr(params.port || '')}" style="max-width:100px;margin-left:6px">`;
    else if (needs === 'appInstall') host.innerHTML = `<input class="input sched-a-id" placeholder="${escAttr(t('sched.appIdPh2') || 'app id')}" value="${escAttr(params.id || '')}" style="max-width:140px"><input class="input sched-a-url" placeholder="${escAttr(t('sched.appUrlPh') || 'download URL')}" value="${escAttr(params.url || '')}" style="min-width:220px;margin-left:6px"><input class="input sched-a-title" placeholder="${escAttr(t('sched.appTitlePh') || 'title (optional)')}" value="${escAttr(params.title || '')}" style="max-width:160px;margin-left:6px">`;
    else if (needs === 'mpCreate') host.innerHTML = `
        <div class="sched-field"><label class="sched-flabel">${t('sched.mpNameLbl') || 'Modpack name'}</label>
            <input class="input sched-mp-name" placeholder="${escAttr(t('sched.mpNamePh') || 'e.g. My DCS pack')}" value="${escAttr(params.name || '')}" style="min-width:200px"></div>
        <div class="sched-field"><label class="sched-flabel">${t('sched.mpFromLbl') || 'From profile (its active mods)'}</label>
            <select class="input sched-mp-prof" style="min-width:200px">${pickerOptions(_profiles, params.profile)}</select></div>`;
    else if (needs === 'modAdd') host.innerHTML = `
        <div class="sched-field"><label class="sched-flabel">${t('sched.modUrlLbl') || 'Mod download URL'}</label>
            <input class="input sched-ma-url" placeholder="https://example.com/mod.zip" value="${escAttr(params.url || '')}" style="min-width:240px"></div>
        <div class="sched-field"><label class="sched-flabel">${t('sched.modNameLbl') || 'Display name (optional)'}</label>
            <input class="input sched-ma-name" placeholder="${escAttr(t('sched.modNamePh') || 'MyMod')}" value="${escAttr(params.name || '')}" style="min-width:160px"></div>`;
    else if (needs === 'telemetry') host.innerHTML = `<label class="sched-tg"><input type="checkbox" class="sched-tl-replay" ${params.replay ? 'checked' : ''}> ${t('sched.tlReplay') || 'Replay'}</label><label class="sched-tg"><input type="checkbox" class="sched-tl-full" ${params.full ? 'checked' : ''}> ${t('sched.tlFull') || 'Full (unmasked)'}</label><label class="sched-tg"><input type="checkbox" class="sched-tl-bench" ${params.bench ? 'checked' : ''}> ${t('sched.tlBench') || 'Benchmarks'}</label>`;
    else if (needs === 'recorder') host.innerHTML = `<label class="sched-tg"><input type="checkbox" class="sched-rc-on" ${params.on ? 'checked' : ''}> ${t('sched.rcOn') || 'Record'}</label><label class="sched-tg"><input type="checkbox" class="sched-rc-full" ${params.full ? 'checked' : ''}> ${t('sched.rcFull') || 'Full'}</label><label class="sched-tg"><input type="checkbox" class="sched-rc-rust" ${params.rust ? 'checked' : ''}> ${t('sched.rcRust') || 'Rust log'}</label><label class="sched-tg"><input type="checkbox" class="sched-rc-js" ${params.js ? 'checked' : ''}> ${t('sched.rcJs') || 'JS log'}</label>`;
    else if (needs === 'replayImport') host.innerHTML = `<input class="input sched-ri-path" placeholder="${escAttr(t('sched.replayPathPh') || 'local .bmmreplay path')}" value="${escAttr(params.path || '')}" style="min-width:220px"><input class="input sched-ri-url" placeholder="${escAttr(t('sched.replayUrlPh') || 'or URL')}" value="${escAttr(params.url || '')}" style="max-width:200px;margin-left:6px">`;
    else if (needs === 'exportAuto') host.innerHTML = `<input class="input sched-ea-dir" placeholder="${escAttr(t('sched.backupDirPh') || 'backup folder')}" value="${escAttr(params.dir || '')}" style="min-width:200px"><button type="button" class="btn btn-sm btn-secondary sched-browse-dir" style="margin-left:6px">${t('sched.choose') || 'Choose…'}</button><input class="input sched-ea-name" placeholder="bmm-backup-{date}" value="${escAttr(params.name || '')}" style="max-width:180px;margin-left:6px"><select class="input sched-ea-inc" style="max-width:150px;margin-left:6px">${['paren', 'underscore', 'timestamp', 'overwrite'].map(o => `<option value="${o}"${(params.increment || 'paren') === o ? ' selected' : ''}>${o}</option>`).join('')}</select>`;

    const sel = host.querySelector('.sched-p') as HTMLInputElement | HTMLSelectElement;
    if (sel) {
        const set = () => {
            if (needs === 'message') params.message = (sel as HTMLInputElement).value;
            else if (needs === 'url') params.url = (sel as HTMLInputElement).value;
            else params.id = (sel as HTMLInputElement).value;
        };
        sel.addEventListener('change', set);
        sel.addEventListener('input', set);
    }
    host.querySelector('.sched-p-prog')?.addEventListener('input', (e) => { params.program = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-args')?.addEventListener('input', (e) => { params.args = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-p-wd')?.addEventListener('input', (e) => { params.workingDir = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-browse-prog')?.addEventListener('click', async () => {
        const { pickFile } = await import('../../core/api.js');
        const f = await pickFile({ filters: [{ name: 'Programs', extensions: ['exe', 'bat', 'cmd', 'ps1', 'com'] }, { name: 'All files', extensions: ['*'] }] }).catch(() => null);
        if (f) { params.program = f; (host.querySelector('.sched-p-prog') as HTMLInputElement).value = f; }
    });
    host.querySelector('.sched-browse-wd')?.addEventListener('click', async () => {
        const { pickFolder } = await import('../../core/api.js');
        const d = await pickFolder().catch(() => null);
        if (d) { params.workingDir = d; (host.querySelector('.sched-p-wd') as HTMLInputElement).value = d; }
    });
    // benchmark / storage / var editors
    host.querySelector('.sched-b-dataset')?.addEventListener('change', (e) => {
        params.dataset = (e.target as HTMLSelectElement).value;
        const src = host.querySelector('.sched-b-sources') as HTMLElement | null;
        if (src) src.style.display = params.dataset === 'real' ? 'block' : 'none';
    });
    host.querySelector('.sched-b-size')?.addEventListener('change', (e) => {
        params.size = (e.target as HTMLSelectElement).value;
        const mb = host.querySelector('.sched-b-mb') as HTMLElement | null;
        if (mb) mb.style.display = params.size === 'CUSTOM' ? 'inline-block' : 'none';
    });
    host.querySelector('.sched-b-mb')?.addEventListener('input', (e) => { params.customMb = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-en')?.addEventListener('change', (e) => { params.enabled = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-f-key')?.addEventListener('input', (e) => { params.key = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-disk')?.addEventListener('change', (e) => { params.mountPoint = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-limit')?.addEventListener('input', (e) => { params.limitMbS = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-v-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-v-val')?.addEventListener('input', (e) => { params.value = (e.target as HTMLInputElement).value; });
    // ── New action params ──
    host.querySelector('.sched-r-url')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-r-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-r-prof')?.addEventListener('input', (e) => { params.profile = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-r-dir')?.addEventListener('input', (e) => { params.dir = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-r-port')?.addEventListener('input', (e) => { params.port = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-a-id')?.addEventListener('input', (e) => { params.id = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-a-url')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-a-title')?.addEventListener('input', (e) => { params.title = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-mp-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-mp-prof')?.addEventListener('change', (e) => { params.profile = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-ma-url')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-ma-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-tl-replay')?.addEventListener('change', (e) => { params.replay = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-tl-full')?.addEventListener('change', (e) => { params.full = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-tl-bench')?.addEventListener('change', (e) => { params.bench = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-rc-on')?.addEventListener('change', (e) => { params.on = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-rc-full')?.addEventListener('change', (e) => { params.full = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-rc-rust')?.addEventListener('change', (e) => { params.rust = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-rc-js')?.addEventListener('change', (e) => { params.js = (e.target as HTMLInputElement).checked; });
    host.querySelector('.sched-ri-path')?.addEventListener('input', (e) => { params.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-ri-url')?.addEventListener('input', (e) => { params.url = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-ea-dir')?.addEventListener('input', (e) => { params.dir = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-ea-name')?.addEventListener('input', (e) => { params.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-ea-inc')?.addEventListener('change', (e) => { params.increment = (e.target as HTMLSelectElement).value; });
    host.querySelector('.sched-browse-dir')?.addEventListener('click', async () => {
        const { pickFolder } = await import('../../core/api.js');
        const d = await pickFolder().catch(() => null);
        if (d) { params.dir = d; const inp = host.querySelector('.sched-r-dir, .sched-ea-dir') as HTMLInputElement | null; if (inp) inp.value = d; }
    });
    host.querySelector('.sched-path')?.addEventListener('input', (e) => { params.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-browse-file')?.addEventListener('click', async () => {
        const { pickFile } = await import('../../core/api.js');
        const f = await pickFile({ filters: [{ name: 'All files', extensions: ['*'] }] }).catch(() => null);
        if (f) { params.path = f; (host.querySelector('.sched-path') as HTMLInputElement).value = f; }
    });
    host.querySelector('.sched-browse-folder')?.addEventListener('click', async () => {
        const { pickFolder } = await import('../../core/api.js');
        const d = await pickFolder().catch(() => null);
        if (d) { params.path = d; (host.querySelector('.sched-path') as HTMLInputElement).value = d; }
    });
}

function diskOptions(selected: string): string {
    return `<option value="">— ${t('sched.pick') || 'select'} —</option>` +
        _disks.map((d: any) => `<option value="${escAttr(d.mount_point)}"${d.mount_point === selected ? ' selected' : ''}>${escHtml(d.mount_point)}${d.name ? ' · ' + escHtml(d.name) : ''}</option>`).join('');
}

const COND_TYPES = ['always', 'value', 'profileActive', 'modEnabled', 'modDisabled', 'modpackActive', 'modpackInactive', 'allModsActive', 'appRunning', 'appNotRunning', 'fileExists', 'fileHash', 'fileSize', 'fileType', 'fileName', 'fileNewer', 'online', 'timeReached', 'dayOfWeek', 'timeRange', 'commandSucceeds'];
// Values a preceding action can capture (used by the `value` condition).
const VALUE_SOURCES = ['disk.read_mbps', 'disk.write_mbps', 'disk.suggested_limit', 'benchmark.mbps', 'benchmark.total_ms', 'lasttask.ok'];
function conditionEditor(cond: Condition): HTMLElement {
    const el = document.createElement('div');
    const render = () => {
        el.innerHTML = `
            <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);margin-right:6px">
                <input type="checkbox" class="sched-neg" ${cond.negate ? 'checked' : ''}> ${t('sched.not') || 'NOT'}</label>
            <select class="input sched-cond-type" style="max-width:170px">
                ${COND_TYPES.map(c => `<option value="${c}" ${cond.type === c ? 'selected' : ''}>${escHtml(t('sched.cond.' + c) || c)}</option>`).join('')}
            </select>
            <span class="sched-cond-params"></span>`;
        el.querySelector('.sched-neg')?.addEventListener('change', (e) => { cond.negate = (e.target as HTMLInputElement).checked; });
        el.querySelector('.sched-cond-type')?.addEventListener('change', (e) => { cond.type = (e.target as HTMLSelectElement).value; cond.params = {}; render(); });
        renderCondParams(el.querySelector('.sched-cond-params') as HTMLElement, cond);
    };
    render();
    return el;
}

// File path input + Browse button, shared by every file-verification condition.
function condFileInput(p: Record<string, any>): string {
    return `<input class="input sched-cp-path" placeholder="${escAttr(t('sched.filePath') || 'C:\\path\\to\\file')}" value="${escAttr(p.path || '')}" style="min-width:230px"><button type="button" class="btn btn-sm btn-secondary sched-cp-browse" style="margin:0 6px">${t('sched.choose') || 'Choose…'}</button>`;
}

function renderCondParams(host: HTMLElement, cond: Condition): void {
    const p = cond.params || (cond.params = {});
    if (cond.type === 'profileActive') host.innerHTML = `<select class="input sched-cp" style="max-width:180px">${pickerOptions(_profiles, p.id)}</select>`;
    else if (cond.type === 'modEnabled' || cond.type === 'modDisabled') host.innerHTML = `<select class="input sched-cp" style="max-width:200px">${pickerOptions(_mods, p.id)}</select>`;
    else if (cond.type === 'modpackActive' || cond.type === 'modpackInactive') host.innerHTML = `<select class="input sched-cp" style="max-width:200px">${pickerOptions(_modpacks, p.id)}</select>`;
    else if (cond.type === 'appRunning' || cond.type === 'appNotRunning') host.innerHTML = `<input class="input sched-cp-name" placeholder="${escAttr(t('sched.appName') || 'app exe (e.g. DCS.exe)')}" value="${escAttr(p.name || '')}" style="max-width:200px">`;
    else if (cond.type === 'fileExists') host.innerHTML = `<input class="input sched-cp-path" placeholder="${escAttr(t('sched.filePath') || 'C:\\path\\to\\file')}" value="${escAttr(p.path || '')}" style="min-width:240px">`;
    else if (cond.type === 'timeReached') host.innerHTML = `<input type="time" class="input sched-cp-time" value="${escAttr(p.time || '17:00')}" style="max-width:140px">`;
    else if (cond.type === 'dayOfWeek') {
        const dayNames = (t('sched.dayNames') || 'Sun,Mon,Tue,Wed,Thu,Fri,Sat').split(',');
        if (!Array.isArray(p.days)) p.days = [];
        host.innerHTML = dayNames.map((d, i) => `<button type="button" class="btn btn-xs ${p.days.includes(i) ? 'btn-accent' : 'btn-ghost'}" data-d="${i}">${escHtml(d)}</button>`).join('');
        host.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
            const i = parseInt((b as HTMLElement).dataset.d!); const k = p.days.indexOf(i); if (k >= 0) p.days.splice(k, 1); else p.days.push(i); renderCondParams(host, cond);
        }));
    } else if (cond.type === 'timeRange') {
        host.innerHTML = `<input type="time" class="input sched-cp-from" value="${escAttr(p.from || '08:00')}" style="max-width:120px"> → <input type="time" class="input sched-cp-to" value="${escAttr(p.to || '18:00')}" style="max-width:120px">`;
        host.querySelector('.sched-cp-from')?.addEventListener('input', (e) => { p.from = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-cp-to')?.addEventListener('input', (e) => { p.to = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'commandSucceeds') {
        host.innerHTML = `<input class="input sched-cp-prog" placeholder="${escAttr(t('sched.phProgram') || 'program')}" value="${escAttr(p.program || '')}" style="max-width:160px"> <input class="input sched-cp-args" placeholder="${escAttr(t('sched.phArgs') || 'args')}" value="${escAttr(p.args || '')}" style="max-width:140px">`;
        host.querySelector('.sched-cp-prog')?.addEventListener('input', (e) => { p.program = (e.target as HTMLInputElement).value; });
        host.querySelector('.sched-cp-args')?.addEventListener('input', (e) => { p.args = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'value') {
        host.innerHTML = `
            <select class="input sched-cp-src" style="max-width:170px">
                ${VALUE_SOURCES.map(s => `<option value="${s}"${p.source === s ? ' selected' : ''}>${escHtml(s)}</option>`).join('')}
            </select>
            <select class="input sched-cp-op" style="max-width:70px">
                ${['>', '<', '>=', '<=', '==', '!='].map(o => `<option value="${o}"${p.op === o ? ' selected' : ''}>${o}</option>`).join('')}
            </select>
            <input class="input sched-cp-val" type="number" placeholder="${escAttr(t('sched.phValue') || 'value')}" value="${escAttr(p.value ?? '')}" style="max-width:110px">`;
        host.querySelector('.sched-cp-src')?.addEventListener('change', (e) => { p.source = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-op')?.addEventListener('change', (e) => { p.op = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.value = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileHash') {
        host.innerHTML = `${condFileInput(p)}
            <select class="input sched-cp-algo" style="max-width:110px">${['blake3', 'sha256'].map(a => `<option value="${a}"${(p.algo || 'blake3') === a ? ' selected' : ''}>${a}</option>`).join('')}</select>
            <input class="input sched-cp-val" placeholder="${escAttr(t('sched.expectedHash') || 'expected hash')}" value="${escAttr(p.value || '')}" style="min-width:200px">`;
        host.querySelector('.sched-cp-algo')?.addEventListener('change', (e) => { p.algo = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.value = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileSize') {
        host.innerHTML = `${condFileInput(p)}
            <select class="input sched-cp-op" style="max-width:70px">${['>', '<', '>=', '<=', '==', '!='].map(o => `<option value="${o}"${p.op === o ? ' selected' : ''}>${o}</option>`).join('')}</select>
            <input class="input sched-cp-val" type="number" min="0" placeholder="${escAttr(t('sched.sizeBytes') || 'size (bytes)')}" value="${escAttr(p.value ?? '')}" style="max-width:140px">`;
        host.querySelector('.sched-cp-op')?.addEventListener('change', (e) => { p.op = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.value = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileType') {
        host.innerHTML = `${condFileInput(p)}<input class="input sched-cp-ext" placeholder="${escAttr(t('sched.extPh') || 'extension e.g. zip')}" value="${escAttr(p.ext || '')}" style="max-width:120px">`;
        host.querySelector('.sched-cp-ext')?.addEventListener('input', (e) => { p.ext = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileName') {
        host.innerHTML = `${condFileInput(p)}<input class="input sched-cp-val" placeholder="${escAttr(t('sched.nameContains') || 'name contains…')}" value="${escAttr(p.value || '')}" style="max-width:160px">`;
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.value = (e.target as HTMLInputElement).value; });
    } else if (cond.type === 'fileNewer') {
        host.innerHTML = `${condFileInput(p)}<span style="font-size:11px;color:var(--text-muted)">${t('sched.modifiedWithin') || 'modified within last'}</span><input class="input sched-cp-min" type="number" min="1" value="${escAttr(p.minutes || 60)}" style="max-width:90px"> ${t('sched.unitMin') || 'min'}`;
        host.querySelector('.sched-cp-min')?.addEventListener('input', (e) => { p.minutes = (e.target as HTMLInputElement).value; });
    } else host.innerHTML = '';

    const cp = host.querySelector('.sched-cp') as HTMLSelectElement;
    if (cp) cp.addEventListener('change', () => { p.id = cp.value; });
    host.querySelector('.sched-cp-name')?.addEventListener('input', (e) => { p.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-cp-path')?.addEventListener('input', (e) => { p.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-cp-time')?.addEventListener('input', (e) => { p.time = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-cp-browse')?.addEventListener('click', async () => {
        const { pickFile } = await import('../../core/api.js');
        const f = await pickFile({ filters: [{ name: 'All files', extensions: ['*'] }] }).catch(() => null);
        if (f) { p.path = f; const inp = host.querySelector('.sched-cp-path') as HTMLInputElement | null; if (inp) inp.value = f; }
    });
}

// ── Share / import via .BMMPA (BMM Planification & Automation) ─────────────────
// A .BMMPA file is just a small JSON envelope holding the task list — easy to
// share. We reuse the gated write_text_file / read_file_text commands.
const BMMPA_MAGIC = 'BMMPA';

export async function exportTasksFile(): Promise<void> {
    if (!_tasks.length) { toast(t('sched.noTasks') || 'No tasks to export', 'info'); return; }
    const { saveFile } = await import('../../core/api.js');
    const path = await saveFile({ defaultPath: 'automations.bmmpa', filters: [{ name: 'BMM Automation', extensions: ['bmmpa'] }] }).catch(() => null);
    if (!path) return;
    const payload = JSON.stringify({ magic: BMMPA_MAGIC, version: 1, exported: new Date().toISOString(), tasks: _tasks }, null, 2);
    try {
        await invoke('write_text_file', { path, content: payload });
        toast(t('sched.exported') || 'Automations exported', 'success');
    } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
}

export async function importTasksFile(): Promise<void> {
    const { pickFile } = await import('../../core/api.js');
    const path = await pickFile({ filters: [{ name: 'BMM Automation', extensions: ['bmmpa', 'json'] }] }).catch(() => null);
    if (!path) return;
    try {
        const raw: string = await invoke('read_file_text', { path });
        const doc = JSON.parse(raw);
        const arr: any[] = Array.isArray(doc) ? doc : (doc.magic === BMMPA_MAGIC ? doc.tasks : doc.tasks);
        if (!Array.isArray(arr)) throw new Error('Not a valid .bmmpa file');
        let added = 0;
        for (const tk of arr) {
            if (tk && tk.name) {
                tk.id = `sched-${Date.now()}-${added}`;
                tk.osSchedule = false; // don't auto-register OS tasks on import
                _tasks.push(tk); added++;
            }
        }
        await saveTasks(); renderScheduleList();
        toast(`${added} ${t('sched.imported') || 'automation(s) imported'}`, 'success');
    } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
}
