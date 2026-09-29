// The resource governor's panels in the Storage Manager (G6, redrawn by agent-bmm-storage).
//
// What BMM is doing to the machine, and the controls that change it, split over the modal's
// tabs (storage-modal.ts draws the tabs and calls the mounters below):
//
//   · Work intensity — the preset, each with what it means for you, and what is in force;
//   · Game mode      — detect / force on / force off, and the games BMM watches for;
//   · Live activity  — four curves and the queue, with pause, resume and cancel.
//
// Live values come from the governor's 1 Hz sampler, which only runs while somebody is
// subscribed. `feed` is that subscription; storage-modal.ts turns it on only while the modal is
// open, a tab with live values is shown and the window is visible (storage-live.ts). A tick is
// painted through a coalescer (latest sample only, at most once per frame) and only writes the
// text and attributes that changed: the queue is updated row by row, by ticket id.
import { invoke, listen, pickFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { learnMore } from '../../core/learn-more.js';
import { pausedAllText, pushHistory, sparkPoints, gameHeadline, gameDetail, profileFolders, normGameDir, type PausedAll, type GameView, type GameOptions } from './resources-spark.js';
import { LiveFeed, reconcileKeyed, setAttr, setText, type FrameScheduler } from './storage-live.js';

export interface Ticket { id: number; kind: string; subject: string; state: 'waiting' | 'running' | 'paused'; bytes_read: number; bytes_written: number; age_ms: number; }
export interface Sample { t_ms: number; cpu_bmm: number; cpu_system: number; read_mbps: number; write_mbps: number; effective: string; game_active: boolean; task: { preset: string; remaining_ms: number } | null; tickets: Ticket[]; paused_all?: PausedAll | null; game?: GameView; }
export interface Status { preset: string; effective: string; task: { preset: string; remaining_ms: number } | null; game_active: boolean; game_manual: string; game_exes?: string[]; tickets: Ticket[]; paused_all?: PausedAll | null; game?: GameView; game_options?: GameOptions; }

export const PRESETS = ['silent', 'balanced', 'max'] as const;

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
/** t() with the English text when the key is missing (t() answers a miss with the key). */
const tr = (key: string, en: string): string => { const v = t(key); return v && v !== key ? v : en; };
const presetLabel = (p: string) => tr('res.p.' + p, p);
const kindLabel = (k: string) => tr('res.k.' + k, k);

// ── The live feed ────────────────────────────────────────────────────────────────────────────

/** Whatever the open modal has drawn registers a painter here; a tick paints them all. */
type Painter = (s: Sample) => void;
const painters = new Map<string, Painter>();

/** Forget every painter: the modal is being redrawn, the old nodes are gone. */
export function resetPainters(): void { painters.clear(); }

export function paintSample(s: Sample): void {
    for (const p of painters.values()) { try { p(s); } catch (e) { console.warn('[resources] paint:', e); } }
}

const browserScheduler: FrameScheduler = {
    frame: (cb) => { requestAnimationFrame(() => cb()); },
    later: (cb, ms) => { setTimeout(cb, ms); },
    now: () => performance.now(),
};

/** The one subscription to the sampler. storage-modal.ts decides when it is on. */
export const feed = new LiveFeed<Sample>(
    {
        invoke: (cmd, args) => invoke(cmd, args ?? {}, { quiet: true }),
        listen: (ev, cb) => listen(ev, cb as (e: unknown) => void),
    },
    paintSample,
    browserScheduler,
);

export async function readStatus(): Promise<Status | null> {
    return (invoke('resources_status') as Promise<Status>).catch(() => null);
}

// ── The line under the modal's title: what is in force, and why ─────────────────────────────

function effectiveText(effective: string, game: boolean, task: Status['task']): string {
    let txt = tr('res.inForce', 'In force: {p}').replace('{p}', presetLabel(effective));
    if (game) txt += ` · ${tr('res.byGame', 'game mode')}`;
    else if (task) txt += ` · ${tr('res.byTask', 'set by a task, {m} min left').replace('{m}', String(Math.ceil(task.remaining_ms / 60000)))}`;
    return txt;
}

/** The sticky status line: the preset in force and the game state, kept live. */
export function mountStatusStrip(host: HTMLElement, st: Status | null): void {
    host.innerHTML = `
        <span class="stm-chip stm-chip-preset" data-tooltip="${esc(tr('stm.inForceTip', 'The preset BMM uses right now. Game mode or a scheduled task can switch to another one for a while.'))}"></span>
        <span class="stm-chip stm-chip-game"></span>`;
    const pre = host.querySelector('.stm-chip-preset');
    const game = host.querySelector<HTMLElement>('.stm-chip-game');
    const paint = (effective: string, active: boolean, task: Status['task'], view?: GameView) => {
        setText(pre, effectiveText(effective, active, task));
        // Which game, when the detector knows (game_mode.rs GameView); the plain words otherwise.
        setText(game, view ? gameHeadline(view, t) : active ? tr('res.gameOn', 'A game is running: background work is paused') : tr('res.gameOff', 'No game detected'));
        game?.classList.toggle('is-on', active);
    };
    if (st) paint(st.effective, st.game_active, st.task, st.game);
    painters.set('strip', (s) => paint(s.effective, s.game_active, s.task ?? null, s.game));
}

// ── Work intensity ──────────────────────────────────────────────────────────────────────────

const PRESET_TEXT: Record<string, { you: [string, string]; detail: [string, string] }> = {
    silent: {
        you: ['stm.p.silent.you', 'BMM stays out of your way while you play or work. Deploys and installs take longer.'],
        detail: ['stm.p.silent.detail', 'One operation at a time, low priority, small copy steps.'],
    },
    balanced: {
        you: ['stm.p.balanced.you', 'The usual BMM: quick, and your PC stays usable. Recommended.'],
        detail: ['stm.p.balanced.detail', 'Two operations of each kind at once, normal priority. How BMM always worked.'],
    },
    max: {
        you: ['stm.p.max.you', 'Everything finishes as fast as your disks allow. Your PC may feel slow meanwhile.'],
        detail: ['stm.p.max.detail', 'Every processor core but one, large copy steps, no pauses while copying.'],
    },
};

/** The three presets as cards, each saying what it changes for the person choosing it. */
export function mountIntensityPanel(host: HTMLElement, st: Status | null): void {
    const cur = st?.preset || 'balanced';
    host.innerHTML = `
        <div class="stm-lead"><span>${esc(tr('stm.lead.intensity', 'Choose how much of your PC BMM may use for heavy work: enabling mods, installs, backups, archives, file checks.'))}</span>${learnMore('resources-presets', { compact: true })}</div>
        <div class="stm-presets" role="radiogroup" aria-label="${esc(tr('res.title', 'How hard BMM works'))}">
            ${PRESETS.map((p) => {
                const tx = PRESET_TEXT[p];
                return `<button type="button" class="stm-preset res-preset" role="radio" data-p="${p}" aria-checked="${cur === p}" tabindex="${cur === p ? 0 : -1}" data-tooltip="${esc(tr('stm.p.tip', 'Use this preset. It is saved and applies from the next operation on.'))}">
                    <span class="stm-preset-name">${esc(presetLabel(p))}${p === 'balanced' ? ` <span class="stm-badge">${esc(tr('stm.recommended', 'Recommended'))}</span>` : ''}</span>
                    <span class="stm-preset-you">${esc(tr(tx.you[0], tx.you[1]))}</span>
                    <span class="stm-preset-detail">${esc(tr(tx.detail[0], tx.detail[1]))}</span>
                </button>`;
            }).join('')}
        </div>
        <div class="stm-card stm-card-flat">
            <div class="stm-row">
                <span class="stm-card-title res-effective"></span>
                <span class="stm-msg res-p-msg" role="status"></span>
            </div>
            <div class="stm-help">${esc(tr('stm.inForceHint', 'While game mode is on, BMM works as if on Quiet. A scheduled task can also pick a preset for its own duration. Your choice comes back by itself afterwards.'))}</div>
        </div>
        <div class="stm-intensity-extra"></div>`;
    const eff = host.querySelector('.res-effective');
    const paint = (effective: string, game: boolean, task: Status['task']) => setText(eff, effectiveText(effective, game, task));
    if (st) paint(st.effective, st.game_active, st.task);
    painters.set('intensity', (s) => paint(s.effective, s.game_active, s.task ?? null));

    const group = host.querySelector<HTMLElement>('.stm-presets');
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.res-preset'));
    const msg = host.querySelector<HTMLElement>('.res-p-msg');
    const choose = async (b: HTMLButtonElement) => {
        try {
            await invoke('resources_set_preset', { name: b.dataset.p, scope: 'persistent', ttlSecs: null, overridesGame: null });
            buttons.forEach((x) => { x.setAttribute('aria-checked', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
            setText(msg, tr('res.saved', 'Saved.'));
            msg?.classList.remove('is-err');
            const now = await readStatus();
            if (now) paint(now.effective, now.game_active, now.task);
        } catch (err) {
            setText(msg, String(err));
            msg?.classList.add('is-err');
        }
    };
    buttons.forEach((b) => b.addEventListener('click', () => { void choose(b); }));
    // A radio group: the arrows move between the choices, Space or Enter picks one.
    group?.addEventListener('keydown', (e) => {
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (i < 0) return;
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        buttons[(i + step + buttons.length) % buttons.length].focus();
    });
}

// ── Game mode ───────────────────────────────────────────────────────────────────────────────
//
// Four cards: what is happening now (which game, from where, since when, what is held, the
// cooldown left, and "pause everything until I quit the game"); the mode; what game mode does
// (the kinds it holds, the cooldown, the notice, the full-screen-window signal); and the games
// it watches (each profile's folder, with a switch, and the programs the user added by name,
// by browsing, or by picking one that is running).

/** The kinds game mode may hold (config.rs GAME_PAUSABLE), with the words the user reads. */
const GAME_PAUSABLE: [kind: string, label: [string, string]][] = [
    ['hash', ['stm.game.k.hash', 'File checks (hashing)']],
    ['maintenance', ['stm.game.k.maintenance', 'Maintenance and disk benchmarks']],
    ['download', ['stm.game.k.download', 'Downloads (repositories, modpacks)']],
    ['scan', ['stm.game.k.scan', 'Folder scans']],
    ['extract', ['stm.game.k.extract', 'Unpacking archives']],
    ['compress', ['stm.game.k.compress', 'Packing archives']],
    ['image', ['stm.game.k.image', 'Image processing']],
];

export interface GameProfile { name: string; game_path: string; }

export function mountGamePanel(host: HTMLElement, st: Status | null, profiles: GameProfile[] = []): void {
    const manual = st?.game_manual || 'auto';
    let opts: GameOptions = st?.game_options || { pause: ['hash', 'maintenance'], leave_after_secs: 30, notify: true, fullscreen_window: false, ignored_dirs: [] };
    let exes: string[] = [...(st?.game_exes || [])];
    host.innerHTML = `
        <div class="stm-lead"><span>${esc(tr('stm.lead.game', 'While a game runs, BMM works quietly and its background tasks wait until you stop playing.'))}</span>${learnMore('resources-game', { compact: true })}</div>
        <div class="stm-card stm-game-now">
            <div class="stm-state res-game-state" role="status"></div>
            <div class="stm-help stm-game-detail"></div>
            <div class="stm-help stm-game-effect"></div>
            <div class="res-paused-all stm-game-paused" role="status" hidden><span class="res-paused-all-text"></span><button type="button" class="btn btn-sm res-q-all" data-a="resume_all">${esc(tr('res.resumeAll', 'Resume all'))}</button></div>
            <div class="stm-row">
                <button type="button" class="btn btn-sm stm-game-pause" hidden data-tooltip="${esc(tr('stm.game.pauseTip', 'Holds every operation, deploys included, and lets them go by themselves when game mode ends.'))}">${esc(tr('stm.game.pauseBtn', 'Pause everything until I quit the game'))}</button>
                <span class="stm-msg stm-game-msg" role="status"></span>
            </div>
        </div>
        <div class="stm-card">
            <div class="stm-row">
                <label class="stm-card-title stm-grow" for="stm-game-mode">${esc(tr('res.game', 'Game mode'))}</label>
                <select id="stm-game-mode" class="input res-game" data-tooltip="${esc(tr('stm.game.modeTip', 'Detect it: BMM notices a game by itself. Force on: act as if a game were running. Force off: never step aside.'))}">
                    ${['auto', 'on', 'off'].map((m) => `<option value="${m}"${manual === m ? ' selected' : ''}>${esc(tr('res.game.' + m, m))}</option>`).join('')}
                </select>
            </div>
            <div class="stm-help">${esc(tr('stm.game.modeHint', 'Detect it: BMM notices a game by itself. Force on: act as if a game were running. Force off: never step aside.'))}</div>
        </div>
        <div class="stm-card">
            <div class="stm-card-title">${esc(tr('stm.game.optsTitle', 'While you play'))}</div>
            <div class="stm-help">${esc(tr('stm.game.optsHint', 'BMM always works as if on Quiet: one operation at a time, low priority. Enabling mods, installs and backups are slowed, never held: a half-modded game folder is worse than a slow one. Tick what should wait until you stop playing:'))}</div>
            <div class="stm-checks">
                ${GAME_PAUSABLE.map(([k, l]) => `<label class="stm-check"><input type="checkbox" class="stm-game-kind" value="${k}"${opts.pause.includes(k) ? ' checked' : ''}> <span>${esc(tr(l[0], l[1]))}</span></label>`).join('')}
            </div>
            <label class="stm-row stm-inline" data-tooltip="${esc(tr('stm.game.cooldownTip', 'How long BMM waits after the game closes before it goes back to normal, so a launcher or a loading screen does not flip it back and forth. 5 to 600 seconds.'))}">
                <span>${esc(tr('stm.game.cooldown', 'Back to normal this many seconds after the game closes'))}</span>
                <input type="number" class="form-input stm-game-cooldown" min="5" max="600" step="5" value="${opts.leave_after_secs}">
            </label>
            <div class="stm-row">
                <div class="stm-grow"><label class="stm-card-title" for="stm-game-notify">${esc(tr('stm.game.notify', 'Tell me when game mode turns on or off'))}</label></div>
                <label class="bmm-switch"><input type="checkbox" id="stm-game-notify"${opts.notify ? ' checked' : ''}><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
            </div>
            <div class="stm-row">
                <div class="stm-grow">
                    <label class="stm-card-title" for="stm-game-fsw">${esc(tr('stm.game.fsw', 'Also count any full-screen window'))}</label>
                    <div class="stm-help">${esc(tr('stm.game.fswHint', 'Catches borderless games that are in no list. A full-screen video counts too, which is why it is off.'))}</div>
                </div>
                <label class="bmm-switch"><input type="checkbox" id="stm-game-fsw"${opts.fullscreen_window ? ' checked' : ''}><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
            </div>
            <div class="stm-row">
                <div class="stm-grow">
                    <label class="stm-card-title" for="stm-game-sched">${esc(tr('stm.game.sched', 'Hold scheduled tasks'))}</label>
                    <div class="stm-help">${esc(tr('stm.game.schedHint', 'A task that falls due while you play waits until game mode ends. A task you run by hand still runs.'))}</div>
                </div>
                <label class="bmm-switch"><input type="checkbox" id="stm-game-sched"${opts.hold_scheduler ? ' checked' : ''}><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
            </div>
            <span class="stm-msg stm-game-opts-msg" role="status"></span>
        </div>
        <div class="stm-card">
            <div class="stm-card-title">${esc(tr('res.gameExes', 'Games BMM watches for'))}</div>
            <div class="stm-help">${esc(tr('stm.game.detected', 'BMM looks every 5 seconds for a program running from one of your profiles\' game folders, for one listed here, and for any game in exclusive full screen.'))}</div>
            <div class="stm-sub">${esc(tr('stm.game.fromProfiles', 'From your profiles'))}</div>
            <div class="stm-game-dirs"></div>
            <div class="stm-sub">${esc(tr('stm.game.added', 'Programs you added'))}</div>
            <div class="stm-help">${esc(tr('stm.game.addedHint', 'For a game outside every profile: its executable name (eldenring.exe) or its full path.'))}</div>
            <div class="stm-pills stm-game-exes"></div>
            <div class="stm-row">
                <input type="text" class="form-input stm-grow stm-game-add-input" spellcheck="false" placeholder="eldenring.exe" aria-label="${esc(tr('stm.game.addLabel', 'Executable name or path'))}">
                <button type="button" class="btn btn-sm stm-game-add">${esc(tr('stm.game.add', 'Add'))}</button>
                <button type="button" class="btn btn-sm stm-game-browse" data-tooltip="${esc(tr('stm.game.browseTip', 'Choose the game\'s .exe file.'))}">${esc(tr('stm.game.browse', 'Browse…'))}</button>
                <button type="button" class="btn btn-sm stm-game-pick" data-tooltip="${esc(tr('stm.game.pickTip', 'Start the game, then pick it among the programs running now.'))}">${esc(tr('stm.game.pick', 'Pick a running program…'))}</button>
            </div>
            <div class="stm-game-picker" hidden></div>
            <span class="stm-msg res-games-msg" role="status"></span>
        </div>`;

    const $ = <T extends Element>(sel: string) => host.querySelector(sel) as T | null;
    const state = $<HTMLElement>('.res-game-state');
    const detail = $<HTMLElement>('.stm-game-detail');
    const effect = $<HTMLElement>('.stm-game-effect');
    const pauseBtn = $<HTMLButtonElement>('.stm-game-pause');
    const pausedBox = $<HTMLElement>('.stm-game-paused');
    const kindName = (k: string) => { const row = GAME_PAUSABLE.find((x) => x[0] === k); return row ? tr(row[1][0], row[1][1]) : k; };

    const paint = (view: GameView | null | undefined, active: boolean, paused: PausedAll | null | undefined) => {
        const v: GameView = view || { active, manual: 'auto', trigger: null, since_ms: null, leaving_in_ms: null, watched_dirs: [], paused_kinds: opts.pause, leave_after_secs: opts.leave_after_secs };
        setText(state, gameHeadline(v, t));
        state?.classList.toggle('is-on', v.active);
        setText(detail, gameDetail(v, profiles, t));
        setText(effect, v.active
            ? tr('stm.game.effectOn', 'Now: BMM works as if on Quiet. Held until you stop playing: {k}.').replace('{k}', v.paused_kinds.length ? v.paused_kinds.map(kindName).join(', ') : tr('stm.game.nothingHeld', 'nothing'))
            : '');
        const byGame = paused?.by === 'game';
        if (pausedBox) { if (pausedBox.hidden !== !byGame) pausedBox.hidden = !byGame; setText(pausedBox.querySelector('.res-paused-all-text'), byGame && paused ? pausedAllText(paused, t) : ''); }
        if (pauseBtn) { const show = v.active && !paused; if (pauseBtn.hidden !== !show) pauseBtn.hidden = !show; }
    };
    paint(st?.game, !!st?.game_active, st?.paused_all);
    painters.set('game', (s) => paint(s.game, s.game_active, s.paused_all));

    const refresh = () => readStatus().then((now) => { if (now) paint(now.game, now.game_active, now.paused_all); });

    host.querySelector('.res-game')?.addEventListener('change', (e) => {
        invoke('resources_game_mode', { mode: (e.target as HTMLSelectElement).value }).then(refresh).catch(() => {});
    });
    pauseBtn?.addEventListener('click', async () => {
        const msg = $<HTMLElement>('.stm-game-msg');
        try {
            await invoke('resources_queue', { action: 'pause_until_game_ends', id: null, by: 'user' });
            setText(msg, '');
            await refresh();
        } catch (err) { setText(msg, String(err)); msg?.classList.add('is-err'); }
    });
    host.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('.stm-game-paused .res-q-all') as HTMLElement | null;
        if (!b) return;
        invoke('resources_queue', { action: 'resume_all', id: null, by: 'user' }).then(refresh).catch(() => {});
    });

    // ── The options: saved as a whole on every change (the cooldown after a short pause) ──
    const optsMsg = $<HTMLElement>('.stm-game-opts-msg');
    const saveOpts = async (next: GameOptions) => {
        try {
            opts = await (invoke('resources_set_game_options', { options: next }) as Promise<GameOptions>);
            setText(optsMsg, tr('res.saved', 'Saved.'));
            optsMsg?.classList.remove('is-err');
            paintDirs();
            await refresh();
        } catch (err) {
            setText(optsMsg, String(err));
            optsMsg?.classList.add('is-err');
        }
    };
    host.querySelectorAll<HTMLInputElement>('.stm-game-kind').forEach((cb) => cb.addEventListener('change', () => {
        const pause = Array.from(host.querySelectorAll<HTMLInputElement>('.stm-game-kind')).filter((x) => x.checked).map((x) => x.value);
        void saveOpts({ ...opts, pause });
    }));
    let coolTimer: ReturnType<typeof setTimeout> | undefined;
    $<HTMLInputElement>('.stm-game-cooldown')?.addEventListener('input', (e) => {
        clearTimeout(coolTimer);
        const v = Math.round(Number((e.target as HTMLInputElement).value));
        coolTimer = setTimeout(() => { if (Number.isFinite(v)) void saveOpts({ ...opts, leave_after_secs: v }); }, 700);
    });
    $<HTMLInputElement>('#stm-game-notify')?.addEventListener('change', (e) => { void saveOpts({ ...opts, notify: (e.target as HTMLInputElement).checked }); });
    $<HTMLInputElement>('#stm-game-fsw')?.addEventListener('change', (e) => { void saveOpts({ ...opts, fullscreen_window: (e.target as HTMLInputElement).checked }); });
    $<HTMLInputElement>('#stm-game-sched')?.addEventListener('change', (e) => { void saveOpts({ ...opts, hold_scheduler: (e.target as HTMLInputElement).checked }); });

    // ── The profiles' folders, each with a switch ──
    const dirsHost = $<HTMLElement>('.stm-game-dirs');
    const paintDirs = () => {
        if (!dirsHost) return;
        const rows = profileFolders(profiles, opts.ignored_dirs);
        if (!rows.length) { dirsHost.innerHTML = `<div class="stm-help">${esc(tr('stm.game.noProfileDirs', 'No profile has a game folder yet.'))}</div>`; return; }
        dirsHost.innerHTML = rows.map((r) => `
            <div class="stm-game-dir">
                <div class="stm-grow"><div class="stm-game-dir-name">${esc(r.name)}</div><div class="stm-disk-path">${esc(r.path)}</div></div>
                ${r.wholeDrive
                    ? `<span class="stm-help">${esc(tr('stm.game.wholeDrive', 'A whole drive is never watched'))}</span>`
                    : `<label class="bmm-switch" data-tooltip="${esc(tr('stm.game.watchTip', 'Off: programs in this folder no longer count as a game.'))}"><input type="checkbox" class="stm-game-dir-on" data-dir="${esc(r.dir)}"${r.ignored ? '' : ' checked'} aria-label="${esc(tr('stm.game.watch', 'Watch this folder') + ' — ' + r.name)}"><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>`}
            </div>`).join('');
    };
    paintDirs();
    dirsHost?.addEventListener('change', (e) => {
        const cb = (e.target as HTMLElement).closest('.stm-game-dir-on') as HTMLInputElement | null;
        if (!cb) return;
        const dir = cb.dataset.dir || '';
        const ignored = new Set(opts.ignored_dirs.map(normGameDir));
        if (cb.checked) ignored.delete(dir); else ignored.add(dir);
        void saveOpts({ ...opts, ignored_dirs: [...ignored] });
    });

    // ── The programs the user added ──
    const exesHost = $<HTMLElement>('.stm-game-exes');
    const exesMsg = $<HTMLElement>('.res-games-msg');
    const paintExes = () => {
        if (!exesHost) return;
        exesHost.innerHTML = exes.length
            ? exes.map((x, i) => `<span class="stm-pill stm-game-exe" title="${esc(x)}">${esc(x)}<button type="button" class="stm-pill-x" data-i="${i}" aria-label="${esc(tr('stm.game.remove', 'Remove') + ' ' + x)}">×</button></span>`).join('')
            : `<span class="stm-help">${esc(tr('stm.game.noneAdded', 'None yet.'))}</span>`;
    };
    paintExes();
    const saveExes = async (next: string[]) => {
        try {
            exes = await (invoke('resources_set_game_exes', { exes: next }) as Promise<string[]>) || [];
            paintExes();
            setText(exesMsg, tr('res.saved', 'Saved.'));
            exesMsg?.classList.remove('is-err');
        } catch (err) {
            setText(exesMsg, String(err));
            exesMsg?.classList.add('is-err');
        }
    };
    const add = (value: string) => { const v = value.trim(); if (v) void saveExes([...exes, v]); };
    exesHost?.addEventListener('click', (e) => {
        const x = (e.target as HTMLElement).closest('.stm-pill-x') as HTMLElement | null;
        if (!x) return;
        const i = Number(x.dataset.i);
        void saveExes(exes.filter((_, j) => j !== i));
    });
    const input = $<HTMLInputElement>('.stm-game-add-input');
    $('.stm-game-add')?.addEventListener('click', () => { if (input) { add(input.value); input.value = ''; } });
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(input.value); input.value = ''; } });
    $('.stm-game-browse')?.addEventListener('click', async () => {
        const f = await pickFile([{ name: 'Programs', extensions: ['exe'] }]);
        if (f) add(f);
    });
    const picker = $<HTMLElement>('.stm-game-picker');
    $('.stm-game-pick')?.addEventListener('click', async () => {
        if (!picker) return;
        if (!picker.hidden) { picker.hidden = true; return; }
        picker.hidden = false;
        picker.innerHTML = `<div class="stm-help">${esc(tr('storage.loading', 'Loading…'))}</div>`;
        const list = await (invoke('list_running_processes') as Promise<{ name: string; exe: string | null; memMb: number }[]>).catch(() => []);
        const rows = runningCandidates(list || []);
        picker.innerHTML = rows.length
            ? `<div class="stm-help">${esc(tr('stm.game.pickHint', 'Heaviest first. Windows\' own programs are left out.'))}</div>` + rows.map((r) => `
                <button type="button" class="stm-pick-row" data-exe="${esc(r.exe)}" title="${esc(r.exe)}"><span class="stm-pick-name">${esc(r.name)}</span><span class="stm-disk-path">${esc(r.exe)}</span><span class="stm-help">${r.memMb} MB</span></button>`).join('')
            : `<div class="stm-help">${esc(tr('stm.game.pickNone', 'No program to offer. Start the game first.'))}</div>`;
    });
    picker?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('.stm-pick-row') as HTMLElement | null;
        if (!b) return;
        add(b.dataset.exe || '');
        picker.hidden = true;
    });
}

/** The running programs worth offering as a game: a path, not Windows' own, one row per exe,
 *  the heaviest 40. */
export function runningCandidates(list: { name: string; exe: string | null; memMb: number }[]): { name: string; exe: string; memMb: number }[] {
    const seen = new Set<string>();
    const out: { name: string; exe: string; memMb: number }[] = [];
    for (const p of list) {
        const exe = String(p.exe || '');
        const low = exe.toLowerCase().replace(/\//g, '\\');
        if (!exe || low.startsWith('c:\\windows\\') || seen.has(low)) continue;
        seen.add(low);
        out.push({ name: p.name || exe, exe, memMb: Number(p.memMb) || 0 });
        if (out.length >= 40) break;
    }
    return out;
}

// ── Live activity ───────────────────────────────────────────────────────────────────────────

const METERS: [key: string, label: [string, string], tip: [string, string]][] = [
    ['cpu', ['res.cpuBmm', 'BMM CPU'], ['stm.live.cpuTip', 'Share of the whole PC used by BMM (all cores together = 100 %).']],
    ['sys', ['res.cpuSys', 'PC CPU'], ['stm.live.sysTip', 'How busy the whole PC is, every program included.']],
    ['rd', ['res.read', 'Read'], ['stm.live.readTip', 'What BMM reads from your disks, in megabytes per second.']],
    ['wr', ['res.write', 'Write'], ['stm.live.writeTip', 'What BMM writes to your disks, in megabytes per second.']],
];

export function mountLivePanel(host: HTMLElement, st: Status | null): void {
    let cpu: number[] = [], sys: number[] = [], rd: number[] = [], wr: number[] = [];
    host.innerHTML = `
        <div class="stm-lead"><span>${esc(tr('stm.lead.live', 'Updated once a second while this tab is open. Nothing is measured while the Storage Manager is closed.'))}</span>${learnMore('resources-live', { compact: true })}</div>
        <div class="stm-meters">
            ${METERS.map(([k, l, tip]) => `
            <div class="stm-meter" data-tooltip="${esc(tr(tip[0], tip[1]))}">
                <div class="stm-meter-head"><span>${esc(tr(l[0], l[1]))}</span><span class="stm-meter-v res-v-${k}">–</span></div>
                <svg viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true"><polyline class="res-l-${k}" points=""/></svg>
            </div>`).join('')}
        </div>
        <div class="stm-card">
            <div class="stm-row">
                <div class="stm-card-title stm-grow">${esc(tr('res.queue', 'What BMM is doing'))}</div>
                <button type="button" class="btn btn-sm res-q-all" data-a="pause_all" data-tooltip="${esc(tr('stm.live.pauseAllTip', 'Pause everything BMM is doing, until you resume it.'))}">${esc(tr('res.pauseAll', 'Pause all'))}</button>
                <button type="button" class="btn btn-sm res-q-all" data-a="resume_all">${esc(tr('res.resumeAll', 'Resume all'))}</button>
            </div>
            <div class="stm-help">${esc(tr('stm.live.queueHint', 'Every heavy operation, running, paused or waiting. Pause keeps its place in line; Cancel stops it and removes the half-written file.'))}</div>
            <div class="res-paused-all" role="status" hidden><span class="res-paused-all-text"></span><button type="button" class="btn btn-sm res-q-all" data-a="resume_all">${esc(tr('res.resumeAll', 'Resume all'))}</button></div>
            <div class="stm-queue-idle">${esc(tr('res.idle', 'Nothing running.'))}</div>
            <div class="res-queue stm-queue"></div>
        </div>`;

    const $ = <T extends Element>(sel: string) => host.querySelector(sel) as T | null;
    const queue = $<HTMLElement>('.res-queue');
    const idle = $<HTMLElement>('.stm-queue-idle');

    // Owner card 2: a pause-all is said, with who set it and a Resume that calls resume_all.
    const paintPausedAll = (p: PausedAll | null | undefined) => {
        const box = $<HTMLElement>('.res-paused-all');
        if (!box) return;
        if (box.hidden !== !p) box.hidden = !p;
        setText($('.res-paused-all-text'), p ? pausedAllText(p, t) : '');
    };

    const makeRow = (): Element => {
        const row = document.createElement('div');
        row.className = 'stm-q-row';
        row.innerHTML = `<span class="pill stm-q-kind"></span><span class="stm-q-subject"></span><span class="stm-q-state"></span>`
            + `<button type="button" class="btn btn-sm res-q stm-q-toggle"></button>`
            + `<button type="button" class="btn btn-sm res-q" data-a="cancel">${esc(tr('res.cancel', 'Cancel'))}</button>`;
        return row;
    };
    const updateRow = (row: Element, k: Ticket) => {
        const id = String(k.id);
        setText(row.querySelector('.stm-q-kind'), kindLabel(k.kind));
        const subj = row.querySelector('.stm-q-subject');
        setText(subj, k.subject);
        setAttr(subj, 'title', k.subject);
        setText(row.querySelector('.stm-q-state'), tr('res.st.' + k.state, k.state));
        const toggle = row.querySelector('.stm-q-toggle');
        const a = k.state === 'paused' ? 'resume' : 'pause';
        setAttr(toggle, 'data-a', a);
        setText(toggle, a === 'resume' ? tr('res.resume', 'Resume') : tr('res.pause', 'Pause'));
        row.querySelectorAll('.res-q').forEach((b) => setAttr(b, 'data-id', id));
    };
    const paintQueue = (tickets: Ticket[]) => {
        if (!queue) return;
        if (idle && idle.hidden !== tickets.length > 0) idle.hidden = tickets.length > 0;
        reconcileKeyed(queue, tickets, (k) => String(k.id), makeRow, updateRow);
    };

    const paintLive = (s: Sample) => {
        cpu = pushHistory(cpu, s.cpu_bmm); sys = pushHistory(sys, s.cpu_system); rd = pushHistory(rd, s.read_mbps); wr = pushHistory(wr, s.write_mbps);
        const set = (k: string, v: string, series: number[], ceil: number) => {
            setText($(`.res-v-${k}`), v);
            setAttr($(`.res-l-${k}`), 'points', sparkPoints(series, 120, 28, ceil));
        };
        set('cpu', `${s.cpu_bmm.toFixed(0)} %`, cpu, 100);
        set('sys', `${s.cpu_system.toFixed(0)} %`, sys, 100);
        set('rd', `${s.read_mbps.toFixed(1)} MB/s`, rd, 1);
        set('wr', `${s.write_mbps.toFixed(1)} MB/s`, wr, 1);
        paintQueue(s.tickets);
        paintPausedAll(s.paused_all);
    };

    if (st) { paintQueue(st.tickets); paintPausedAll(st.paused_all); }
    painters.set('live', (s) => {
        // A status re-read (after a click) has no measurements: only the queue moves then.
        if (Number.isFinite(s.cpu_bmm)) paintLive(s);
        else { paintQueue(s.tickets); paintPausedAll(s.paused_all); }
    });

    host.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('.res-q, .res-q-all') as HTMLElement | null;
        if (!b) return;
        // `by: 'user'`: the dashboard's pause-all is the user's, the only one with no end.
        invoke('resources_queue', { action: b.dataset.a, id: b.dataset.id ? Number(b.dataset.id) : null, by: 'user' })
            .then(() => (invoke('resources_status') as Promise<Status>))
            .then((now) => { if (now) { paintQueue(now.tickets); paintPausedAll(now.paused_all); } })
            .catch(() => {});
    });
}
