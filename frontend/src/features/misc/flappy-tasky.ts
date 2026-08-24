import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';

// Flappy Tasky.
//
// Behind the logo, because that is where a thing like this belongs: findable, never in the
// way, and nothing else on the screen changes because it exists.
//
// It draws THE TASKY THAT IS ON SCREEN — `#app-mascot`'s current src — rather than a copy
// bundled here. Somebody who has themed their mascot has themed this too, without a line of
// code knowing that themes exist. Same for the colours: every one comes from a CSS variable,
// read at start, so a custom palette paints the game.
//
// Deliberately small. No library, one canvas, one rAF loop that runs ONLY while the window is
// open and the tab is visible — a hidden canvas still costs a frame every 16ms, and a mini
// game that warms a laptop after somebody closed it is a mini game that gets uninstalled.

const BEST_KEY = 'bmm.flappy.best';

interface Pipe { x: number; gapY: number; scored: boolean; gap: number }

let _open = false;

function css(name: string, fallback: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

function readBest(): number {
    try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch { return 0; }
}
function writeBest(n: number): void {
    try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* private mode */ }
}

/** Tell Discord, when Discord is listening. Failure is silence, never a popup. */
function presence(details: string, status: string): void {
    // The command itself checks whether Rich Presence is switched on, so there is nothing to
    // ask here — and nothing to get wrong by asking separately and disagreeing with it.
    void invoke('set_discord_presence', { details, status }).catch(() => {});
}

export function openFlappyTasky(): void {
    if (_open) return;
    _open = true;

    const ov = document.createElement('div');
    ov.className = 'flappy-overlay';
    ov.innerHTML = `
      <div class="flappy-panel">
        <div class="flappy-head">
          <span class="flappy-title">${t('flappy.title')}</span>
          <span class="flappy-score" id="flappy-score">0</span>
          <button class="flappy-close" id="flappy-close" aria-label="${t('common.close')}">&times;</button>
        </div>
        <canvas id="flappy-canvas" width="360" height="480" aria-label="${t('flappy.title')}"></canvas>
        <div class="flappy-foot" id="flappy-foot">${t('flappy.start')}</div>
      </div>`;
    // Inside the app frame: it carries `contain: paint`, so the overlay is clipped to the
    // rounded window instead of covering the transparent Tauri margins and Tasky himself.
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);

    const canvas = ov.querySelector('#flappy-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const scoreEl = ov.querySelector('#flappy-score') as HTMLElement;
    const footEl = ov.querySelector('#flappy-foot') as HTMLElement;

    // Whatever Tasky currently is. A custom mascot flies without this file knowing it exists.
    const bird = new Image();
    const live = document.getElementById('app-mascot') as HTMLImageElement | null;
    bird.src = live?.src || 'assets/Tasky_Happy.png';

    const W = canvas.width, H = canvas.height;
    const SIZE = 38, PIPE_W = 54;

    // ── difficulty ────────────────────────────────────────────────────────────
    //
    // A RAMP, not a setting. Every number here used to be constant, which meant one value had
    // to be forgiving enough for pipe one and interesting by pipe forty — and no single value
    // is both. It was tuned for the second and felt hostile in the first ten seconds.
    //
    // `ramp` goes 0 → 1 over the first RAMP_OVER pipes and stays there. Nothing steps: every
    // curve is continuous, so the game never gets suddenly harder at a threshold, which is the
    // version of progression people notice and resent.
    //
    // The vertical step between consecutive gaps is ramped too, and it is the one that matters
    // most: it decides whether the next gap is reachable from this one, and an unreachable gap
    // is not difficulty at any score.
    const RAMP_OVER = 22;
    const ramp = () => Math.min(1, score / RAMP_OVER);
    /** Eases the start further: the first few pipes are nearly flat, then it picks up. */
    const ease = () => { const r = ramp(); return r * r * (3 - 2 * r); };

    const GAP_START = 215, GAP_END = 150;
    const SPEED_START = 1.05, SPEED_END = 2.3;
    const STEP_START = 30, STEP_END = 96;
    const SPACING_START = 280, SPACING_END = 205;
    // On the ramp too, and this is the second attempt at this exact complaint. The last
    // tuning ramped everything EXCEPT gravity and the flap — the two numbers that decide how
    // fast Tasky falls between taps — and "it falls too much at the start" survived the whole
    // rework. What the ramp does not cover, the ramp does not fix.
    const GRAVITY_START = 0.20, GRAVITY_END = 0.36;
    const FLAP_START = -5.0, FLAP_END = -6.6;

    const gapNow = () => GAP_START + (GAP_END - GAP_START) * ease();
    const speedNow = () => SPEED_START + (SPEED_END - SPEED_START) * ease();
    const stepNow = () => STEP_START + (STEP_END - STEP_START) * ease();
    const spacingNow = () => SPACING_START + (SPACING_END - SPACING_START) * ease();
    const gravityNow = () => GRAVITY_START + (GRAVITY_END - GRAVITY_START) * ease();
    const flapNow = () => FLAP_START + (FLAP_END - FLAP_START) * ease();

    /** Keeps a gap centre off the very top and bottom, where it needs a perfect flap. */
    const marginNow = () => gapNow() / 2 + 26;
    const clampGap = (v: number) => Math.max(marginNow(), Math.min(H - marginNow(), v));

    let y = H / 2, vy = 0, score = 0, best = readBest();
    let pipes: Pipe[] = [];
    let state: 'ready' | 'playing' | 'dead' = 'ready';
    let raf = 0;

    const reset = () => {
        y = H / 2; vy = 0; score = 0;
        // The first pipe starts a full screen away: dying before the game has been seen is
        // not a difficulty curve, it is a bug report.
        // The first pipe is centred and a full screen away: dying before the game has been
        // seen is a bug report, not a difficulty curve.
        pipes = [{ x: W + 60, gapY: H / 2, scored: false, gap: GAP_START }];
        scoreEl.textContent = '0';
        state = 'ready';
        footEl.textContent = t('flappy.start');
    };

    const die = () => {
        state = 'dead';
        if (score > best) { best = score; writeBest(best); }
        footEl.textContent = t('flappy.dead').replace('{best}', String(best));
        presence(t('flappy.title'), t('flappy.rpcDead').replace('{n}', String(score)).replace('{best}', String(best)));
    };

    const flap = () => {
        if (state === 'dead') { reset(); return; }
        if (state === 'ready') {
            state = 'playing';
            footEl.textContent = '';
            presence(t('flappy.title'), t('flappy.rpcPlaying').replace('{n}', '0'));
        }
        vy = flapNow();
    };

    const step = () => {
        // Colours read every frame, so switching theme while it is open repaints it.
        const bg = css('--bmm-bg-base', '#12161c');
        const pipe = css('--accent', '#4f8cff');
        const line = css('--border', '#2a3140');

        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        if (state === 'playing') {
            vy += gravityNow();
            y += vy;
            const speed = speedNow();
            for (const p of pipes) p.x -= speed;
            if (pipes.length && pipes[pipes.length - 1].x < W - spacingNow()) {
                // Relative to the previous gap, not absolute: the next one is always reachable
                // from where this one leaves you.
                const prev = pipes[pipes.length - 1].gapY;
                const next = clampGap(prev + (Math.random() * 2 - 1) * stepNow());
                // The gap this pipe was BORN with. Reading gapNow() at draw time instead
                // would silently resize pipes already on screen the moment you scored,
                // which looks like the game cheating.
                pipes.push({ x: W, gapY: next, scored: false, gap: gapNow() });
            }
            pipes = pipes.filter((p) => p.x > -PIPE_W);
        }

        for (const p of pipes) {
            ctx.fillStyle = pipe;
            ctx.fillRect(p.x, 0, PIPE_W, p.gapY - p.gap / 2);
            ctx.fillRect(p.x, p.gapY + p.gap / 2, PIPE_W, H - (p.gapY + p.gap / 2));
            ctx.strokeStyle = line;
            ctx.strokeRect(p.x, 0, PIPE_W, p.gapY - p.gap / 2);
            ctx.strokeRect(p.x, p.gapY + p.gap / 2, PIPE_W, H - (p.gapY + p.gap / 2));

            if (state === 'playing') {
                const bx = 60;
                // Collision on the drawn box, and a little inside it. A hit registered on the
                // transparent corner of a PNG is a death nobody believes.
                const pad = 6;
                const hitX = bx + SIZE - pad > p.x && bx + pad < p.x + PIPE_W;
                const hitY = y + pad < p.gapY - p.gap / 2 || y + SIZE - pad > p.gapY + p.gap / 2;
                if (hitX && hitY) die();
                if (!p.scored && p.x + PIPE_W < bx) {
                    p.scored = true;
                    score += 1;
                    scoreEl.textContent = String(score);
                    // Told to Discord on every point: that is the whole reason somebody has it
                    // on, and a presence that only updates at the end shows a zero all game.
                    presence(t('flappy.title'), t('flappy.rpcPlaying').replace('{n}', String(score)));
                }
            }
        }

        if (bird.complete && bird.naturalWidth) ctx.drawImage(bird, 60, y, SIZE, SIZE);
        else { ctx.fillStyle = pipe; ctx.fillRect(60, y, SIZE, SIZE); }

        if (state === 'playing' && (y < -SIZE || y > H)) die();
        raf = requestAnimationFrame(step);
    };

    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); flap(); }
    };

    function close(): void {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
        ov.remove();
        _open = false;
        // Hand the presence back to whatever the app normally says. Leaving "Flappy Tasky"
        // up after the window is closed tells everybody you are playing a game you are not
        // playing — and restoring it by writing two strings HERE would be a second version of
        // the app's status, drifting from the real one the moment either changed.
        void import('../settings/settings.js').then((m) => m.updateDiscordStatus()).catch(() => {});
    }

    canvas.addEventListener('pointerdown', flap);
    ov.querySelector('#flappy-close')?.addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);

    reset();
    raf = requestAnimationFrame(step);
}

/** Wire the logo. Called once at start-up. */
export function initFlappyTasky(): void {
    const logo = document.getElementById('sidebar-brand');
    if (!logo || logo.dataset.flappy === '1') return;
    logo.dataset.flappy = '1';
    logo.style.cursor = 'pointer';
    logo.addEventListener('click', () => openFlappyTasky());
    // Keyboard too. It is a role="button" with a tabindex, so it announces itself as
    // activatable — and something that says it can be pressed and only answers a mouse is
    // worse than something that never claimed to.
    logo.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') { e.preventDefault(); openFlappyTasky(); }
    });
}
