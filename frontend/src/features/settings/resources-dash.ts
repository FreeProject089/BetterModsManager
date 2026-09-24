// The resources dashboard (G6): at the top of the Storage manager.
//
// What BMM is doing to the machine, live, and the three controls that change it: the preset,
// game mode, and the queue. Live means the governor's 1 Hz sampler, which only runs while
// somebody is subscribed: the card subscribes when it is shown and unsubscribes as soon as it
// is no longer on screen (the modal closed, the container re-rendered). Nothing samples at rest.
import { invoke, listen } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { pushHistory, sparkPoints } from './resources-spark.js';
import { renderResourcesMatrix } from './resources-matrix.js';

interface Ticket { id: number; kind: string; subject: string; state: 'waiting' | 'running' | 'paused'; bytes_read: number; bytes_written: number; age_ms: number; }
interface Sample { t_ms: number; cpu_bmm: number; cpu_system: number; read_mbps: number; write_mbps: number; effective: string; game_active: boolean; task: { preset: string; remaining_ms: number } | null; tickets: Ticket[]; }
interface Status { preset: string; effective: string; task: { preset: string; remaining_ms: number } | null; game_active: boolean; game_manual: string; game_exes?: string[]; tickets: Ticket[]; }

const PRESETS = ['silent', 'balanced', 'max'] as const;

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const presetLabel = (p: string) => t('res.p.' + p) || p;
const kindLabel = (k: string) => t('res.k.' + k) || k;

let _unlisten: (() => void) | null = null;
let _subscribed = false;

async function stopLive(): Promise<void> {
    if (_unlisten) { try { _unlisten(); } catch { /* already gone */ } _unlisten = null; }
    if (_subscribed) { _subscribed = false; await invoke('resources_unsubscribe').catch(() => {}); }
}

/** Render the card into `host` and start the live feed. Safe to call on every re-render. */
export async function renderResourcesCard(host: HTMLElement): Promise<void> {
    await stopLive();
    const st = (await (invoke('resources_status') as Promise<Status>).catch(() => null));
    if (!st) { host.innerHTML = ''; return; }
    let cpu: number[] = [], sys: number[] = [], rd: number[] = [], wr: number[] = [];

    host.innerHTML = `
        <div class="res-card" style="border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:20px;background:var(--bg-card)">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
                <div>
                    <div style="font-weight:700">${esc(t('res.title') || 'How hard BMM works')}</div>
                    <div class="res-effective" style="font-size:12px;color:var(--text-muted)"></div>
                </div>
                <div class="res-presets" role="radiogroup" aria-label="${esc(t('res.title') || 'How hard BMM works')}" style="display:flex;gap:6px;flex-wrap:wrap">
                    ${PRESETS.map((p) => `<button type="button" class="btn btn-sm res-preset" role="radio" data-p="${p}" aria-checked="${st.preset === p}">${esc(presetLabel(p))}</button>`).join('')}
                </div>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">${esc(t('res.presetHint') || 'Quiet: one thing at a time, gently, for while you play. Balanced: what BMM always did. Everything for BMM: as fast as the disks allow.')}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px">
                ${[['cpu', t('res.cpuBmm') || 'BMM CPU'], ['sys', t('res.cpuSys') || 'PC CPU'], ['rd', t('res.read') || 'Read'], ['wr', t('res.write') || 'Write']].map(([k, l]) => `
                <div style="border:1px solid var(--border);border-radius:10px;padding:8px 10px;min-width:0">
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted)"><span>${esc(l)}</span><span class="res-v-${k}" style="font-variant-numeric:tabular-nums;color:var(--text-primary)">–</span></div>
                    <svg viewBox="0 0 120 28" preserveAspectRatio="none" style="width:100%;height:28px;display:block;margin-top:4px" aria-hidden="true"><polyline class="res-l-${k}" fill="none" stroke="var(--accent)" stroke-width="1.5" points=""/></svg>
                </div>`).join('')}
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
                <label style="font-size:13px;display:inline-flex;align-items:center;gap:8px">${esc(t('res.game') || 'Game mode')}
                    <select class="input res-game" style="max-width:180px">
                        ${['auto', 'on', 'off'].map((m) => `<option value="${m}"${st.game_manual === m ? ' selected' : ''}>${esc(t('res.game.' + m) || m)}</option>`).join('')}
                    </select>
                </label>
                <span class="res-game-state" style="font-size:12px"></span>
            </div>
            <details class="res-games" style="margin:-4px 0 12px">
                <summary style="cursor:pointer;font-size:12px;color:var(--text-muted)">${esc(t('res.gameExes') || 'Games BMM watches for')}</summary>
                <div style="font-size:12px;color:var(--text-muted);margin:6px 0">${esc(t('res.gameExesHint') || "Every profile's game folder already counts, and so does any game running in exclusive full screen. Add other games here, one per line: an executable name (eldenring.exe) or a full path.")}</div>
                <textarea class="input res-games-list" rows="3" spellcheck="false" style="width:100%;font-family:var(--font-mono, monospace);font-size:12px" placeholder="eldenring.exe">${esc((st.game_exes || []).join('\n'))}</textarea>
                <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
                    <button type="button" class="btn btn-sm res-games-save">${esc(t('res.gameExesSave') || 'Save the list')}</button>
                    <span class="res-games-msg" style="font-size:12px"></span>
                </div>
            </details>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px">
                <div style="font-weight:600;font-size:13px">${esc(t('res.queue') || 'What BMM is doing')}</div>
                <div style="display:flex;gap:6px">
                    <button type="button" class="btn btn-sm res-q-all" data-a="pause_all">${esc(t('res.pauseAll') || 'Pause all')}</button>
                    <button type="button" class="btn btn-sm res-q-all" data-a="resume_all">${esc(t('res.resumeAll') || 'Resume all')}</button>
                </div>
            </div>
            <div class="res-queue" style="display:flex;flex-direction:column;gap:4px"></div>
            <div class="res-matrix-host"></div>
        </div>`;

    const $ = <T extends Element>(sel: string) => host.querySelector(sel) as T | null;

    const paintHead = (effective: string, game: boolean, task: Status['task']) => {
        const eff = $('.res-effective');
        if (eff) {
            let txt = (t('res.inForce') || 'In force: {p}').replace('{p}', presetLabel(effective));
            if (game) txt += ` · ${t('res.byGame') || 'game mode'}`;
            else if (task) txt += ` · ${(t('res.byTask') || 'set by a task, {m} min left').replace('{m}', String(Math.ceil(task.remaining_ms / 60000)))}`;
            eff.textContent = txt;
        }
        const gs = $('.res-game-state') as HTMLElement | null;
        if (gs) { gs.textContent = game ? (t('res.gameOn') || 'A game is running: background work is paused') : (t('res.gameOff') || 'No game detected'); gs.style.color = game ? 'var(--warning)' : 'var(--text-muted)'; }
    };

    const paintQueue = (tickets: Ticket[]) => {
        const q = $('.res-queue') as HTMLElement | null;
        if (!q) return;
        if (!tickets.length) { q.innerHTML = `<div style="font-size:12px;color:var(--text-muted)">${esc(t('res.idle') || 'Nothing running.')}</div>`; return; }
        q.innerHTML = tickets.map((k) => `
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;min-width:0">
                <span class="pill" style="flex-shrink:0">${esc(kindLabel(k.kind))}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(k.subject)}">${esc(k.subject)}</span>
                <span style="flex-shrink:0;color:var(--text-muted)">${esc(t('res.st.' + k.state) || k.state)}</span>
                ${k.state === 'paused'
                    ? `<button type="button" class="btn btn-sm res-q" data-a="resume" data-id="${k.id}">${esc(t('res.resume') || 'Resume')}</button>`
                    : `<button type="button" class="btn btn-sm res-q" data-a="pause" data-id="${k.id}">${esc(t('res.pause') || 'Pause')}</button>`}
                <button type="button" class="btn btn-sm res-q" data-a="cancel" data-id="${k.id}">${esc(t('res.cancel') || 'Cancel')}</button>
            </div>`).join('');
    };

    const paintSample = (s: Sample) => {
        cpu = pushHistory(cpu, s.cpu_bmm); sys = pushHistory(sys, s.cpu_system); rd = pushHistory(rd, s.read_mbps); wr = pushHistory(wr, s.write_mbps);
        const set = (k: string, v: string, series: number[], ceil: number) => {
            const el = $(`.res-v-${k}`); if (el) el.textContent = v;
            $(`.res-l-${k}`)?.setAttribute('points', sparkPoints(series, 120, 28, ceil));
        };
        set('cpu', `${s.cpu_bmm.toFixed(0)} %`, cpu, 100);
        set('sys', `${s.cpu_system.toFixed(0)} %`, sys, 100);
        set('rd', `${s.read_mbps.toFixed(1)} MB/s`, rd, 1);
        set('wr', `${s.write_mbps.toFixed(1)} MB/s`, wr, 1);
        paintHead(s.effective, s.game_active, s.task ?? null);
        paintQueue(s.tickets);
    };

    paintHead(st.effective, st.game_active, st.task);
    paintQueue(st.tickets);
    // S1: the per disk × operation rules, collapsed under the card.
    const mh = $('.res-matrix-host') as HTMLElement | null;
    if (mh) {
        const disks = await (invoke('get_system_disks') as Promise<{ mount_point: string }[]>).catch(() => []);
        renderResourcesMatrix(mh, (disks || []).map((d) => String(d.mount_point || '')).filter(Boolean)).catch(() => {});
    }

    host.querySelectorAll<HTMLButtonElement>('.res-preset').forEach((b) => b.addEventListener('click', async () => {
        await invoke('resources_set_preset', { name: b.dataset.p, scope: 'persistent', ttlSecs: null, overridesGame: null }).catch(() => {});
        host.querySelectorAll('.res-preset').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));
    $('.res-game')?.addEventListener('change', (e) => { invoke('resources_game_mode', { mode: (e.target as HTMLSelectElement).value }).catch(() => {}); });
    // The manual game list: detection (every 5 s) reads it at its next look.
    $('.res-games-save')?.addEventListener('click', async () => {
        const ta = $('.res-games-list') as HTMLTextAreaElement | null;
        const msg = $('.res-games-msg') as HTMLElement | null;
        const exes = (ta?.value || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        try {
            const stored = await (invoke('resources_set_game_exes', { exes }) as Promise<string[]>);
            if (ta) ta.value = (stored || []).join('\n');
            if (msg) { msg.textContent = t('res.saved') || 'Saved.'; msg.style.color = 'var(--success)'; }
        } catch (err) {
            if (msg) { msg.textContent = String(err); msg.style.color = 'var(--danger)'; }
        }
    });
    host.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('.res-q, .res-q-all') as HTMLElement | null;
        if (!b) return;
        invoke('resources_queue', { action: b.dataset.a, id: b.dataset.id ? Number(b.dataset.id) : null }).catch(() => {});
    });

    // Live: subscribe while this card is on screen. A tick that finds it gone (modal closed or
    // re-rendered) ends the subscription, so the sampler stops when nobody looks.
    const onScreen = () => host.isConnected && host.offsetParent !== null;   // null under a display:none modal
    _unlisten = await listen('bmm://governor-tick', (ev: { payload: Sample }) => {
        if (!onScreen()) { stopLive(); return; }
        paintSample(ev.payload);
    });
    _subscribed = true;
    await invoke('resources_subscribe').catch(() => { _subscribed = false; });
}
