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
    | { kind: 'waitFor'; condition: Condition; timeoutSec: number }
    | { kind: 'if'; condition: Condition; then: Step[]; else: Step[] };

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
            await waitForCondition(step.condition, step.timeoutSec, ctx);
        } else if (step.kind === 'if') {
            const ok = await evalCondition(step.condition, ctx);
            await runSteps(ok ? step.then : step.else, task, ctx);
        }
    }
}

// Polls a condition until it becomes true or the timeout elapses (then throws,
// aborting the rest of the workflow). This is what makes "wait until all mods are
// active, then launch X" possible.
async function waitForCondition(cond: Condition, timeoutSec: number, ctx: Record<string, number>): Promise<void> {
    const deadline = Date.now() + Math.max(1, timeoutSec || 60) * 1000;
    const pollMs = 2000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (await evalCondition(cond, ctx)) return;
        if (Date.now() >= deadline) {
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
    }
    return false;
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
        ph.innerHTML = `<input type="number" class="input" id="sched-tr-min" min="1" value="${tr.everyMinutes}" style="max-width:120px"> min`;
        ph.querySelector('#sched-tr-min')?.addEventListener('input', (e) => { (_draft.trigger as any).everyMinutes = parseInt((e.target as HTMLInputElement).value) || 1; });
    } else if (tr.type === 'hourly') {
        ph.innerHTML = `<input type="number" class="input" id="sched-tr-h" min="1" value="${tr.everyHours}" style="max-width:120px"> h`;
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
        block.className = 'sched-step';
        block.style.marginLeft = `${depth * 14}px`;
        if (step.kind === 'action') {
            block.appendChild(actionEditor(step.action, () => { steps.splice(i, 1); renderStepsEditor(host, steps, depth); }));
        } else if (step.kind === 'delay') {
            block.innerHTML = `<div class="sched-step-head"><span class="sched-step-tag">${t('sched.delay') || 'Wait'}</span>
                <input type="number" class="input" min="0" value="${step.seconds}" style="max-width:90px"> s
                <button class="btn btn-xs btn-ghost sched-del" style="margin-left:auto;color:var(--danger)">✕</button></div>`;
            block.querySelector('input')?.addEventListener('input', (e) => { step.seconds = parseInt((e.target as HTMLInputElement).value) || 0; });
            block.querySelector('.sched-del')?.addEventListener('click', () => { steps.splice(i, 1); renderStepsEditor(host, steps, depth); });
        } else if (step.kind === 'waitFor') {
            block.innerHTML = `<div class="sched-step-head"><span class="sched-step-tag sched-wait">${t('sched.waitUntil') || 'WAIT UNTIL'}</span>
                <span class="sched-cond-label">${t('sched.condition') || 'condition:'}</span>
                <div class="sched-cond" style="flex:1"></div>
                <span style="font-size:11px;color:var(--text-muted)">${t('sched.timeout') || 'timeout'}</span>
                <input type="number" class="input sched-wait-to" min="1" value="${step.timeoutSec}" style="max-width:80px"> s
                <button class="btn btn-xs btn-ghost sched-del" style="color:var(--danger)">✕</button></div>`;
            block.querySelector('.sched-cond')?.appendChild(conditionEditor(step.condition));
            block.querySelector('.sched-wait-to')?.addEventListener('input', (e) => { step.timeoutSec = parseInt((e.target as HTMLInputElement).value) || 60; });
            block.querySelector('.sched-del')?.addEventListener('click', () => { steps.splice(i, 1); renderStepsEditor(host, steps, depth); });
        } else if (step.kind === 'if') {
            block.innerHTML = `<div class="sched-step-head"><span class="sched-step-tag sched-if">${t('sched.if') || 'IF'}</span>
                <span class="sched-cond-label">${t('sched.condition') || 'condition:'}</span>
                <div class="sched-cond" style="flex:1"></div>
                <button class="btn btn-xs btn-ghost sched-del" style="color:var(--danger)">✕</button></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.then') || 'THEN'}</div><div class="sched-then"></div><div class="sched-then-add"></div></div>
                <div class="sched-branch"><div class="sched-branch-label">${t('sched.else') || 'ELSE'}</div><div class="sched-else"></div><div class="sched-else-add"></div></div>`;
            block.querySelector('.sched-cond')?.appendChild(conditionEditor(step.condition));
            block.querySelector('.sched-del')?.addEventListener('click', () => { steps.splice(i, 1); renderStepsEditor(host, steps, depth); });
            renderStepsEditor(block.querySelector('.sched-then') as HTMLElement, step.then, depth + 1);
            renderStepsEditor(block.querySelector('.sched-else') as HTMLElement, step.else, depth + 1);
            renderAddRow(block.querySelector('.sched-then-add') as HTMLElement, step.then, depth + 1, host, steps, depth);
            renderAddRow(block.querySelector('.sched-else-add') as HTMLElement, step.else, depth + 1, host, steps, depth);
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
    };
    host.innerHTML = `
        <button class="btn btn-xs sched-chip sched-add-do" data-add="action" title="${escAttr(t('sched.legendDo') || '')}">${I.do} ${t('sched.addAction') || 'Action'}</button>
        <button class="btn btn-xs sched-chip sched-add-if" data-add="if" title="${escAttr(t('sched.legendIf') || '')}">${I.if} ${t('sched.addIf') || 'If/Else'}</button>
        <button class="btn btn-xs sched-chip sched-add-wait" data-add="waitFor" title="${escAttr(t('sched.legendWait') || '')}">${I.wait} ${t('sched.addWaitFor') || 'Wait until'}</button>
        <button class="btn btn-xs sched-chip sched-add-delay" data-add="delay" title="${escAttr(t('sched.legendDelay') || '')}">${I.delay} ${t('sched.addDelay') || 'Pause'}</button>`;
    const rerender = () => {
        if (rerenderHost) renderStepsEditor(rerenderHost, rerenderSteps!, rerenderDepth);
        else renderStepsEditor(host.previousElementSibling as HTMLElement || host.parentElement!.querySelector('.sched-steps') as HTMLElement, steps, depth);
    };
    host.querySelector('[data-add="action"]')?.addEventListener('click', () => { steps.push({ kind: 'action', action: { type: 'profile.activate', params: {} } }); rerender(); });
    host.querySelector('[data-add="if"]')?.addEventListener('click', () => { steps.push({ kind: 'if', condition: { type: 'always', params: {} }, then: [], else: [] }); rerender(); });
    host.querySelector('[data-add="waitFor"]')?.addEventListener('click', () => { steps.push({ kind: 'waitFor', condition: { type: 'allModsActive', params: {} }, timeoutSec: 120 }); rerender(); });
    host.querySelector('[data-add="delay"]')?.addEventListener('click', () => { steps.push({ kind: 'delay', seconds: 5 }); rerender(); });
}

const ACTION_TYPES: { v: string; label: string; needs?: string }[] = [
    { v: 'profile.activate', label: 'Activate profile', needs: 'profile' },
    { v: 'mod.enable', label: 'Enable mod', needs: 'mod' },
    { v: 'mod.disable', label: 'Disable mod', needs: 'mod' },
    { v: 'modpack.enable', label: 'Enable modpack', needs: 'modpack' },
    { v: 'modpack.disable', label: 'Disable modpack', needs: 'modpack' },
    { v: 'mods.enableAll', label: 'Enable all mods' },
    { v: 'mods.disableAll', label: 'Disable all mods' },
    { v: 'mods.scan', label: 'Scan mods folder' },
    { v: 'theme.set', label: 'Set theme', needs: 'theme' },
    { v: 'app.launch', label: 'Launch app', needs: 'app' },
    { v: 'notify', label: 'Show notification', needs: 'message' },
    { v: 'benchmark.run', label: 'Run benchmark', needs: 'benchmark' },
    { v: 'storage.diskBenchmark', label: 'Storage: benchmark a disk', needs: 'disk' },
    { v: 'storage.applyLimit', label: 'Storage: apply disk speed limit', needs: 'applyLimit' },
    { v: 'storage.calibration', label: 'Storage: Performance Auto-Calibration', needs: 'toggle' },
    { v: 'storage.smartIo', label: 'Storage: Smart I/O', needs: 'toggle' },
    { v: 'storage.flag', label: 'Storage: toggle a setting (advanced)', needs: 'flag' },
    { v: 'var.set', label: 'Set a value (for conditions)', needs: 'var' },
    { v: 'custom.command', label: 'Run custom command', needs: 'command' },
    { v: 'deeplink', label: 'Run bmm:// deeplink', needs: 'url' },
];

function actionEditor(action: Action, onDelete: () => void): HTMLElement {
    const el = document.createElement('div');
    const render = () => {
        const def = ACTION_TYPES.find(a => a.v === action.type);
        el.innerHTML = `<div class="sched-step-head">
            <span class="sched-step-tag sched-do">${t('sched.do') || 'DO'}</span>
            <select class="input sched-act-type" style="max-width:200px">
                ${ACTION_TYPES.map(a => `<option value="${a.v}"${action.type === a.v ? ' selected' : ''}>${escHtml(t('sched.act.' + a.v) || a.label)}</option>`).join('')}
            </select>
            <div class="sched-act-params" style="flex:1"></div>
            <button class="btn btn-xs btn-ghost sched-del" style="color:var(--danger)">✕</button></div>`;
        el.querySelector('.sched-act-type')?.addEventListener('change', (e) => {
            action.type = (e.target as HTMLSelectElement).value; action.params = {}; render();
        });
        el.querySelector('.sched-del')?.addEventListener('click', onDelete);
        renderParams(el.querySelector('.sched-act-params') as HTMLElement, def?.needs, action.params);
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
        <input class="input sched-b-mb" type="number" min="1" placeholder="MB" value="${escAttr(params.customMb || '')}" style="max-width:90px;display:${(params.size || 'M') === 'CUSTOM' ? 'inline-block' : 'none'}">
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
    else if (needs === 'var') host.innerHTML = `<input class="input sched-v-name" placeholder="name" value="${escAttr(params.name || '')}" style="max-width:140px"><input class="input sched-v-val" type="number" placeholder="value" value="${escAttr(params.value || '')}" style="max-width:120px;margin-left:6px">`;

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
}

function diskOptions(selected: string): string {
    return `<option value="">— ${t('sched.pick') || 'select'} —</option>` +
        _disks.map((d: any) => `<option value="${escAttr(d.mount_point)}"${d.mount_point === selected ? ' selected' : ''}>${escHtml(d.mount_point)}${d.name ? ' · ' + escHtml(d.name) : ''}</option>`).join('');
}

const COND_TYPES = ['always', 'value', 'profileActive', 'modEnabled', 'modDisabled', 'modpackActive', 'modpackInactive', 'allModsActive', 'appRunning', 'appNotRunning', 'fileExists', 'online', 'timeReached', 'dayOfWeek', 'timeRange', 'commandSucceeds'];
// Values a preceding action can capture (used by the `value` condition).
const VALUE_SOURCES = ['disk.read_mbps', 'disk.write_mbps', 'disk.suggested_limit', 'benchmark.mbps', 'benchmark.total_ms'];
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
        host.innerHTML = `<input class="input sched-cp-prog" placeholder="program" value="${escAttr(p.program || '')}" style="max-width:160px"> <input class="input sched-cp-args" placeholder="args" value="${escAttr(p.args || '')}" style="max-width:140px">`;
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
            <input class="input sched-cp-val" type="number" placeholder="value" value="${escAttr(p.value ?? '')}" style="max-width:110px">`;
        host.querySelector('.sched-cp-src')?.addEventListener('change', (e) => { p.source = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-op')?.addEventListener('change', (e) => { p.op = (e.target as HTMLSelectElement).value; });
        host.querySelector('.sched-cp-val')?.addEventListener('input', (e) => { p.value = (e.target as HTMLInputElement).value; });
    } else host.innerHTML = '';

    const cp = host.querySelector('.sched-cp') as HTMLSelectElement;
    if (cp) cp.addEventListener('change', () => { p.id = cp.value; });
    host.querySelector('.sched-cp-name')?.addEventListener('input', (e) => { p.name = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-cp-path')?.addEventListener('input', (e) => { p.path = (e.target as HTMLInputElement).value; });
    host.querySelector('.sched-cp-time')?.addEventListener('input', (e) => { p.time = (e.target as HTMLInputElement).value; });
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
