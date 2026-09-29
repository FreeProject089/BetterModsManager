// Settings → Graphics & display: how BMM's own window is drawn. An app-wide setting, not a
// storage one (it was a tab of the Storage Manager for a day; the owner moved it here).
//
// One card, three things that already existed, in one place:
//   · the graphics card the window draws with: Automatic / Power saving / High performance /
//     Off (boot_flags.rs; "Off" is the old hardware-acceleration switch, merged: one control,
//     not two), applied at the next start, with a restart offered after asking;
//   · what really draws the window right now, read from WebGL, and a warning when WebView2
//     fell back to drawing with the processor although the PC has a card;
//   · "Reduce animations": the theme engine's own kill-switch (body.bmm-no-anim, which a theme
//     sets with --bmm-anim-speed: 0), made an app-wide choice that holds whatever the theme.
// And, folded, the hardware BMM detected (hw_detect.rs).
import { invoke, askConfirm } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { learnMore } from '../../core/learn-more.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { describeRenderer, gpuAdvice } from './resources-spark.js';
import { ensureStorageCss } from './storage-modal.js';

/** The app's toast, handed over by settings.ts: importing ui/app.ts from here would close one
 *  more import cycle (dep-graph.mjs counts them). */
type Toast = (message: string, type?: string) => void;
let toast: Toast = () => {};

const tr = (key: string, en: string): string => { const v = t(key); return v && v !== key ? v : en; };
const esc = escHtml;

export const CARD_ID = 'settings-graphics-card';
/** Read by the theme engine too (theme-engine.ts `appReducesAnimations`). */
export const REDUCE_ANIM_KEY = 'bmm.reduceAnimations';

export const GPU_MODES = ['auto', 'power_saving', 'high_performance', 'off'] as const;
const GPU_LABEL: Record<string, [string, string]> = {
    auto: ['stm.gfx.mode.auto', 'Automatic (recommended)'],
    power_saving: ['stm.gfx.mode.power_saving', 'Power saving'],
    high_performance: ['stm.gfx.mode.high_performance', 'High performance'],
    off: ['stm.gfx.mode.off', 'Off (drawn by the processor)'],
};
const GPU_HELP: Record<string, [string, string]> = {
    auto: ['stm.gfx.help.auto', 'Windows and WebView2 choose. A choice made in Windows Settings → Display → Graphics still applies.'],
    power_saving: ['stm.gfx.help.power_saving', 'Prefer the built-in graphics chip on a PC that has two: less battery and heat on a laptop. The window stays smooth.'],
    high_performance: ['stm.gfx.help.high_performance', 'Prefer the dedicated graphics card on a PC that has two: the smoothest animations, a little more power.'],
    off: ['stm.gfx.help.off', 'Draw without any graphics card. Only for a black, frozen or flickering window caused by a broken driver: everything gets slower.'],
};

interface GpuState { enabled: boolean; active: boolean; overridden: boolean; mode: string; active_mode: string; }

function storeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function storeSet(k: string, v: string | null): void { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* not remembered */ } }

export function reducesAnimations(): boolean { return storeGet(REDUCE_ANIM_KEY) === '1'; }

/** Apply the app-wide choice. The theme's own --bmm-anim-speed: 0 still turns animations off
 *  when this is off: either one is enough (theme-engine.ts reads the same key). */
export function applyReduceAnimations(on = reducesAnimations()): void {
    if (on) document.body.classList.add('bmm-no-anim');
    else {
        const speed = getComputedStyle(document.documentElement).getPropertyValue('--bmm-anim-speed').trim();
        document.body.classList.toggle('bmm-no-anim', speed === '0' || speed === '0.0');
    }
}

/** The renderer WebGL reports for this page: the card that really draws the window. */
function webglRenderer(): string {
    try {
        const canvas = document.createElement('canvas');
        const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
        if (!gl) return '';
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const raw = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        gl.getExtension('WEBGL_lose_context')?.loseContext();   // one context, released at once
        return raw;
    } catch { return ''; }
}

const ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>';

/** Build the card into the Settings page, after the Performance & Benchmark card (card-order.ts
 *  then places it with the other "how it looks" cards). Safe to call twice. */
export function mountGraphicsCard(): HTMLElement | null {
    const existing = document.getElementById(CARD_ID);
    if (existing) return existing;
    const anchor = document.getElementById('settings-benchmark-section') || document.querySelector('#view-settings .settings-sections > .glass-card:last-child');
    const parent = anchor?.parentElement;
    if (!anchor || !parent) return null;
    ensureStorageCss();
    const card = document.createElement('div');
    card.className = 'glass-card';
    card.id = CARD_ID;
    card.innerHTML = `
        <h3 class="card-title" style="display:flex;align-items:center;gap:10px">${ICON}<span data-i18n="gfx.cardTitle">${esc(tr('gfx.cardTitle', 'Graphics & display'))}</span>${learnMore('graphics', { compact: true, className: 'lm-end' })}</h3>
        <div class="stm stm-gfx-card">
            <div class="stm-lead"><span data-i18n="stm.lead.graphics">${esc(tr('stm.lead.graphics', 'Which graphics card draws BMM\'s window. It only concerns the interface, never your games or your mods.'))}</span></div>
            <div class="stm-card">
                <div class="stm-row">
                    <div class="stm-grow">
                        <label class="stm-card-title" for="stm-gfx-mode" data-i18n="stm.gfx.title">${esc(tr('stm.gfx.title', 'Graphics card for the interface'))}</label>
                        <div class="stm-help stm-gfx-help"></div>
                    </div>
                    <select id="stm-gfx-mode" class="input" data-i18n-tooltip="stm.gfx.tip" data-tooltip="${escAttr(tr('stm.gfx.tip', 'Applies the next time BMM starts.'))}"></select>
                </div>
                <div class="stm-note stm-gfx-note" role="status" hidden>
                    <span class="stm-gfx-note-text"></span>
                    <button type="button" class="btn btn-sm stm-gfx-restart" data-i18n="stm.gfx.restart" hidden>${esc(tr('stm.gfx.restart', 'Restart BMM now'))}</button>
                </div>
                <div class="stm-card-title" data-i18n="stm.gfx.now">${esc(tr('stm.gfx.now', 'Drawing the window right now'))}</div>
                <div class="stm-gfx-renderer"></div>
                <div class="stm-help stm-gfx-cards"></div>
                <div class="stm-alert is-warn stm-gfx-fallback" data-i18n="stm.gfx.fallback" hidden>${esc(tr('stm.gfx.fallback', 'BMM is drawn by the processor although this PC has a graphics card and you did not turn it off. The driver may be blocked or may have crashed: updating it usually fixes this.'))}</div>
            </div>
            <div class="stm-card">
                <div class="stm-row">
                    <div class="stm-grow">
                        <label class="stm-card-title" for="gfx-reduce-anim" data-i18n="gfx.reduceAnim">${esc(tr('gfx.reduceAnim', 'Reduce animations'))}</label>
                        <div class="stm-help" data-i18n="gfx.reduceAnimHint">${esc(tr('gfx.reduceAnimHint', 'Transitions and effects end at once, whatever the theme. Progress spinners keep turning, slowly. Applies immediately.'))}</div>
                    </div>
                    <label class="bmm-switch" data-i18n-tooltip="gfx.reduceAnimTip" data-tooltip="${escAttr(tr('gfx.reduceAnimTip', 'Also on by itself when Windows asks apps to show fewer animations.'))}">
                        <input type="checkbox" id="gfx-reduce-anim"${reducesAnimations() ? ' checked' : ''}>
                        <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                    </label>
                </div>
            </div>
            <details class="stm-card stm-gfx-hw" id="hw-card">
                <summary class="stm-card-title" data-i18n="storage.hwTitle">${esc(t('storage.hwTitle'))}</summary>
                <div id="hw-body" class="stm-help"></div>
                <div class="stm-help" data-i18n="storage.hwNote">${esc(t('storage.hwNote'))}</div>
            </details>
        </div>`;
    anchor.insertAdjacentElement('afterend', card);
    card.querySelector<HTMLInputElement>('#gfx-reduce-anim')?.addEventListener('change', (e) => {
        const on = (e.target as HTMLInputElement).checked;
        storeSet(REDUCE_ANIM_KEY, on ? '1' : null);
        applyReduceAnimations(on);
    });
    void fillGraphics(card);
    return card;
}

async function fillGraphics(host: HTMLElement): Promise<void> {
    let state = await (invoke('get_webview_gpu') as Promise<GpuState>).catch(() => null);
    const sel = host.querySelector<HTMLSelectElement>('#stm-gfx-mode');
    // The options are drawn with the saved mode selected: the house select mirrors the native
    // one when it is built, not when .value is changed later.
    if (sel) sel.innerHTML = GPU_MODES.map((m) => `<option value="${m}"${state?.mode === m ? ' selected' : ''}>${esc(tr(GPU_LABEL[m][0], GPU_LABEL[m][1]))}</option>`).join('');
    const help = host.querySelector<HTMLElement>('.stm-gfx-help');
    const note = host.querySelector<HTMLElement>('.stm-gfx-note');
    const noteText = host.querySelector<HTMLElement>('.stm-gfx-note-text');
    const restart = host.querySelector<HTMLButtonElement>('.stm-gfx-restart');
    const showHelp = (mode: string) => { if (help) help.textContent = tr(GPU_HELP[mode]?.[0] || '', GPU_HELP[mode]?.[1] || ''); };
    const label = (m: string) => tr(GPU_LABEL[m]?.[0] || '', GPU_LABEL[m]?.[1] || m);
    const show = (st: GpuState | null) => {
        if (!st || !sel) return;
        if (sel.value !== st.mode) sel.value = st.mode;
        sel.disabled = st.overridden;
        showHelp(st.mode);
        const pending = !st.overridden && st.mode !== st.active_mode;
        const text = st.overridden ? t('storage.gpuEnv')
            : pending ? tr('stm.gfx.pending', 'BMM started with “{a}”. “{b}” applies after a restart.').replace('{a}', label(st.active_mode)).replace('{b}', label(st.mode))
            : '';
        if (note) note.hidden = !text;
        if (noteText) noteText.textContent = text;
        if (restart) restart.hidden = !pending;
    };
    show(state);
    // The static labels carry data-i18n and follow a language switch by themselves; these are
    // written from code, so they are written again. Without this the card stayed in the
    // language BMM started in (seen: switch FR → EN, the whole card still French).
    const relabel = () => {
        if (!host.isConnected) { document.removeEventListener('langChanged', relabel); return; }
        if (sel) {
            const v = sel.value;
            sel.innerHTML = GPU_MODES.map((m) => `<option value="${m}"${v === m ? ' selected' : ''}>${esc(tr(GPU_LABEL[m][0], GPU_LABEL[m][1]))}</option>`).join('');
            sel.value = v;
        }
        show(state);
        paintRenderer();
        paintCards();
    };
    document.addEventListener('langChanged', relabel);
    sel?.addEventListener('change', async () => {
        showHelp(sel.value);
        try {
            state = await (invoke('set_webview_gpu_mode', { mode: sel.value }) as Promise<GpuState>);
            show(state);
            toast(t('storage.gpuRestart'), 'info');
        } catch (err) {
            show(state);
            toast(String(err), 'error');
        }
    });
    restart?.addEventListener('click', async () => {
        const ok = await askConfirm(tr('stm.gfx.restartAsk', 'Restart BMM now? Anything it is doing (a deploy, an install) stops.'), { type: 'warning' });
        if (ok) await invoke('app_restart').catch((err: unknown) => toast(String(err), 'error'));
    });

    // What draws the window now, from the page itself.
    const renderer = describeRenderer(webglRenderer());
    function paintRenderer(): void {
        const rEl = host.querySelector<HTMLElement>('.stm-gfx-renderer');
        if (!rEl) return;
        rEl.textContent = renderer.software
            ? tr('stm.gfx.software', 'The processor (software drawing, no graphics card)')
            : `${renderer.name}${renderer.api ? ` · ${renderer.api}` : ''}`;
        if (renderer.raw) rEl.setAttribute('data-tooltip', renderer.raw);
    }
    paintRenderer();
    let cardCount = -1;
    function paintCards(): void {
        const cards = host.querySelector<HTMLElement>('.stm-gfx-cards');
        if (!cards || cardCount < 0) return;
        cards.textContent = cardCount >= 2
            ? tr('stm.gfx.cards2', 'This PC has two graphics cards: Power saving and High performance choose between them.')
            : cardCount === 1 ? tr('stm.gfx.cards1', 'This PC has one graphics card: Power saving and High performance both use it.')
            : '';
    }

    // Detected hardware: text only, built with textContent (names come from drivers). The
    // first call can take the GPU driver's 3-second budget; it runs off the main thread.
    const hw: any = await invoke('get_hardware_info').catch(() => null);
    const body = host.querySelector<HTMLElement>('#hw-body');
    if (hw && body) {
        const line = (text: string) => { const d = document.createElement('div'); d.textContent = text; body.appendChild(d); };
        body.textContent = '';
        const feats = [hw.cpu?.avx512f && 'AVX-512', hw.cpu?.avx2 && 'AVX2', hw.cpu?.sse41 && 'SSE4.1', hw.cpu?.sha_ni && 'SHA-NI', hw.cpu?.aes_ni && 'AES-NI'].filter(Boolean);
        line(`CPU: ${t('storage.hwCpu', { n: String(hw.cpu?.logical_cores ?? '?') })}${feats.length ? ' · ' + feats.join(' · ') : ''}`);
        const gpus = (hw.gpus || []) as { name: string; software?: boolean; dedicated_mb?: number }[];
        if (hw.gpu_timed_out) line(`GPU: ${t('storage.hwGpuSlow')}`);
        else if (!gpus.length) line(`GPU: ${t('storage.hwNoGpu')}`);
        for (const g of gpus) line(`GPU: ${g.name}${g.software ? ` (${t('storage.hwSoftware')})` : g.dedicated_mb ? ` · ${Math.round(g.dedicated_mb / 1024)} GB` : ''}`);
        for (const d of (hw.disks || []) as any[]) {
            const kind = d.seek_penalty === true ? t('storage.hwSpinning') : d.seek_penalty === false ? t('storage.hwFlash') : '';
            line(`${d.mount} ${String(d.bus || 'unknown').toUpperCase()}${kind ? ' · ' + kind : ''}`);
        }
        const advice = gpuAdvice({ renderer, gpus, activeMode: state?.active_mode || 'auto' });
        if (!hw.gpu_timed_out) { cardCount = advice.cards; paintCards(); }
        const fb = host.querySelector<HTMLElement>('.stm-gfx-fallback');
        if (fb) fb.hidden = !advice.softwareFallback;
    }
}

/** Show the card: switch to Settings, then scroll to it once it is really on screen (switching
 *  views resets the scroll after this runs, so check and retry, like the CSP command does). */
export function openGraphicsSettings(): void {
    document.querySelector<HTMLElement>('.nav-item[data-view="settings"]')?.click();
    let tries = 0;
    const go = () => {
        const el = document.getElementById(CARD_ID) || mountGraphicsCard();
        if (el) {
            el.scrollIntoView({ block: 'start' });
            const r = el.getBoundingClientRect();
            if (el.isConnected && r.height > 0 && r.top > -50 && r.top < window.innerHeight) return;
        }
        if (++tries < 40) setTimeout(go, 100);
    };
    go();
}

/** Called once by settings.ts (before the cards are ordered). */
export function initGraphicsSettings(deps: { toast: Toast }): void {
    toast = deps.toast;
    mountGraphicsCard();
    applyReduceAnimations();
    (window as any).openGraphicsSettings = openGraphicsSettings;
}
