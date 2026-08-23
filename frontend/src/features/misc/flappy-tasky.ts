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

interface Pipe { x: number; gapY: number; scored: boolean }

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
    const SIZE = 38, GAP = 138, PIPE_W = 54, SPACING = 190;
    const GRAVITY = 0.42, FLAP = -7.2, SPEED = 2.1;

    let y = H / 2, vy = 0, score = 0, best = readBest();
    let pipes: Pipe[] = [];
    let state: 'ready' | 'playing' | 'dead' = 'ready';
    let raf = 0;

    const reset = () => {
        y = H / 2; vy = 0; score = 0;
        // The first pipe starts a full screen away: dying before the game has been seen is
        // not a difficulty curve, it is a bug report.
        pipes = [{ x: W + 60, gapY: H / 2, scored: false }];
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
        vy = FLAP;
    };

    const step = () => {
        // Colours read every frame, so switching theme while it is open repaints it.
        const bg = css('--bmm-bg-base', '#12161c');
        const pipe = css('--accent', '#4f8cff');
        const line = css('--border', '#2a3140');

        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        if (state === 'playing') {
            vy += GRAVITY;
            y += vy;
            for (const p of pipes) p.x -= SPEED;
            if (pipes.length && pipes[pipes.length - 1].x < W - SPACING) {
                pipes.push({ x: W, gapY: 90 + Math.random() * (H - 180), scored: false });
            }
            pipes = pipes.filter((p) => p.x > -PIPE_W);
        }

        for (const p of pipes) {
            ctx.fillStyle = pipe;
            ctx.fillRect(p.x, 0, PIPE_W, p.gapY - GAP / 2);
            ctx.fillRect(p.x, p.gapY + GAP / 2, PIPE_W, H - (p.gapY + GAP / 2));
            ctx.strokeStyle = line;
            ctx.strokeRect(p.x, 0, PIPE_W, p.gapY - GAP / 2);
            ctx.strokeRect(p.x, p.gapY + GAP / 2, PIPE_W, H - (p.gapY + GAP / 2));

            if (state === 'playing') {
                const bx = 60;
                // Collision on the drawn box, and a little inside it. A hit registered on the
                // transparent corner of a PNG is a death nobody believes.
                const pad = 6;
                const hitX = bx + SIZE - pad > p.x && bx + pad < p.x + PIPE_W;
                const hitY = y + pad < p.gapY - GAP / 2 || y + SIZE - pad > p.gapY + GAP / 2;
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
