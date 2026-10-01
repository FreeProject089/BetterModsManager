// The benchmark's mini monitor, in its own small always-on-top window (mini-monitor.html,
// opened by commands/benchmark.rs open_mini_monitor).
//
// It used to be a panel floating inside BMM's own window: behind a game, or behind any other
// program, it could not be seen, which is the one place a "mini" monitor is for. Now it is a
// window of its own that stays on top.
//
// It imports nothing from the app (a window this small should not boot BMM): the theme tokens
// and the words come from the main window through localStorage (`bmm.mini.boot`, written by
// benchmark.ts right before it opens this window), the samples are the same `benchmark-point`
// events the full monitor draws. Its buttons: pause / resume the sampler (shared with the full
// monitor through `bmm://mini-monitor-rec`), back to the full monitor, close.

export const BOOT_KEY = 'bmm.mini.boot';
export const REC_EVENT = 'bmm://mini-monitor-rec';
export const EXPAND_EVENT = 'bmm://mini-monitor-expand';
export const CLOSED_EVENT = 'bmm://mini-monitor-closed';

export interface MiniBoot {
    tokens: Record<string, string>;
    labels: Record<string, string>;
    recording: boolean;
}

export interface MiniPoint { timestamp: number; cpu_usage: number; ram_usage: number; disk_read: number; disk_write: number; }

/** "412 MB", "1.3 GB" (the unit words come from the main window's language). */
export function fmtRam(mb: number, units: { mb: string; gb: string }): string {
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} ${units.gb}` : `${Math.round(mb)} ${units.mb}`;
}

/** Disk KB/s as "0 KB/s", "740 KB/s", "12.4 MB/s". */
export function fmtDisk(kbs: number, units: { kbs: string; mbs: string }): string {
    return kbs >= 1024 ? `${(kbs / 1024).toFixed(1)} ${units.mbs}` : `${Math.round(kbs)} ${units.kbs}`;
}

/** The last `n` values as a line in a w×h box, scaled to their own peak (0 at the bottom). */
export function linePoints(values: number[], w: number, h: number, floor = 1): [number, number][] {
    if (values.length < 2) return [];
    const top = Math.max(floor, ...values);
    return values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (Math.max(0, v) / top) * (h - 4)]);
}

const HISTORY = 60;

function start(): void {
    const T = (window as any).__TAURI__;
    let boot: MiniBoot = { tokens: {}, labels: {}, recording: true };
    try { boot = { ...boot, ...JSON.parse(localStorage.getItem(BOOT_KEY) || '{}') }; } catch { /* first open without a boot: bare labels */ }
    const root = document.documentElement;
    for (const [k, v] of Object.entries(boot.tokens || {})) if (k.startsWith('--') && v) root.style.setProperty(k, v);
    const L = (k: string, fb: string) => (boot.labels && boot.labels[k]) || fb;
    const $ = (id: string) => document.getElementById(id);

    document.title = L('title', 'Mini-Monitor');
    $('mm')?.setAttribute('aria-label', L('title', 'Mini-Monitor'));
    const setText = (id: string, v: string) => { const el = $(id); if (el && el.textContent !== v) el.textContent = v; };
    setText('mm-title', L('title', 'Mini-Monitor'));
    setText('mm-l-cpu', L('cpu', 'CPU'));
    setText('mm-l-ram', L('ram', 'RAM'));
    setText('mm-l-disk', L('disk', 'Disk'));
    for (const [id, k, fb] of [['mm-expand', 'expand', 'Open the full monitor'], ['mm-close', 'close', 'Close']] as const) {
        const b = $(id);
        b?.setAttribute('aria-label', L(k, fb));
        b?.setAttribute('title', L(k, fb));
    }

    let recording = boot.recording !== false;
    const recBtn = $('mm-rec');
    const paintRec = () => {
        $('mm')?.classList.toggle('is-paused', !recording);
        if (recBtn) {
            recBtn.innerHTML = recording
                ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
                : '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
            const w = recording ? L('pause', 'Pause') : L('resume', 'Resume');
            recBtn.setAttribute('aria-label', w);
            recBtn.setAttribute('title', w);
        }
        if (!recording) setText('mm-foot', L('paused', 'Paused'));
    };
    paintRec();

    const series: Record<'cpu' | 'ram' | 'disk', number[]> = { cpu: [], ram: [], disk: [] };
    const push = (k: keyof typeof series, v: number) => { const a = series[k]; a.push(Number.isFinite(v) ? v : 0); if (a.length > HISTORY) a.shift(); };
    const draw = (k: keyof typeof series, floor: number) => {
        const c = $(`mm-c-${k}`) as HTMLCanvasElement | null;
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth, h = c.clientHeight;
        if (w < 2 || h < 2) return;
        if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
        if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const pts = linePoints(series[k], w, h, floor);
        if (!pts.length) return;
        const color = getComputedStyle(root).getPropertyValue(c.dataset.c || '--bmm-accent').trim() || getComputedStyle(root).getPropertyValue('--bmm-accent').trim();
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
        ctx.globalAlpha = 0.18; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    };
    const units = { mb: L('mb', 'MB'), gb: L('gb', 'GB'), kbs: L('kbs', 'KB/s'), mbs: L('mbs', 'MB/s') };
    const onPoint = (p: MiniPoint) => {
        if (!p) return;
        push('cpu', p.cpu_usage); push('ram', p.ram_usage); push('disk', (p.disk_read || 0) + (p.disk_write || 0));
        setText('mm-v-cpu', `${(p.cpu_usage || 0).toFixed(1)} %`);
        setText('mm-v-ram', fmtRam(p.ram_usage || 0, units));
        setText('mm-v-disk', fmtDisk((p.disk_read || 0) + (p.disk_write || 0), units));
        draw('cpu', 5); draw('ram', 1); draw('disk', 64);
        if (recording) setText('mm-foot', `${L('updated', 'Updated')} ${new Date(p.timestamp * 1000).toLocaleTimeString()}`);
    };

    const ev = T?.event;
    const invoke = (cmd: string) => T?.core?.invoke ? T.core.invoke(cmd) : Promise.resolve();
    void ev?.listen('benchmark-point', (e: { payload: MiniPoint }) => onPoint(e.payload));
    void ev?.listen(REC_EVENT, (e: { payload: boolean }) => { recording = !!e.payload; paintRec(); });
    recBtn?.addEventListener('click', async () => {
        recording = !recording;
        paintRec();
        await invoke(recording ? 'start_benchmark' : 'stop_benchmark').catch(() => undefined);
        await ev?.emit(REC_EVENT, recording).catch(() => undefined);
    });
    $('mm-expand')?.addEventListener('click', async () => {
        await ev?.emit(EXPAND_EVENT, null).catch(() => undefined);
        await ev?.emit(CLOSED_EVENT, null).catch(() => undefined);
        await invoke('close_mini_monitor').catch(() => undefined);
    });
    $('mm-close')?.addEventListener('click', async () => {
        await ev?.emit(CLOSED_EVENT, null).catch(() => undefined);
        await invoke('close_mini_monitor').catch(() => undefined);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('mm-close')?.click(); });
    setText('mm-foot', recording ? L('waiting', 'Waiting for the first sample…') : L('paused', 'Paused'));
}

if (typeof document !== 'undefined' && document.getElementById('mm')) start();
