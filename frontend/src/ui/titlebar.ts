/**
 * titlebar.ts — Window titlebar, resizing, and confirmation dialog
 */

import { invoke } from '../core/api.js';
import { playCloseSound } from './sound-engine.js';

let tauriWindow: any = null;

export async function initTitlebar(): Promise<void> {
    try {
        if (window.__TAURI__?.window) {
            const w = window.__TAURI__.window as any;
            // Prefer getCurrent() — it returns the full WebviewWindow (with
            // startResizing / maximize / …). Fall back to appWindow.
            tauriWindow = (typeof w.getCurrent === 'function' ? w.getCurrent() : null) || w.appWindow || null;
        }
        // No CDN fallback: importing from unpkg violates the CSP, and the Tauri
        // global API (withGlobalTauri) is always present in the packaged WebView.

        document.getElementById('tb-min')?.addEventListener('click', () => tauriWindow?.minimize());

        const toggleFullscreen = async (): Promise<void> => {
            if (tauriWindow) {
                const isMax = await tauriWindow.isMaximized();
                if (isMax) {
                    await tauriWindow.unmaximize();
                } else {
                    await tauriWindow.maximize();
                }
            }
        };
        document.getElementById('tb-max')?.addEventListener('click', toggleFullscreen);

        if (tauriWindow) {
            const checkMaximized = async (): Promise<void> => {
                const isMax = await tauriWindow.isMaximized();
                if (isMax) {
                    document.body.classList.add('is-maximized');
                } else {
                    document.body.classList.remove('is-maximized');
                }
            };
            tauriWindow.onResized(checkMaximized);
            checkMaximized();
        }
        document.getElementById('tb-close')?.addEventListener('click', async () => {
            playCloseSound(); // fire immediately before animation starts
            await playVhsCloseAnimation();
            if (tauriWindow) {
                invoke('finalize_and_close_app').catch(() => tauriWindow.close());
            } else {
                window.close();
            }
        });
    } catch (err) {
        console.error("[BMM] Window API initialization failed:", err);
    }

    initResizing();
}

export function playVhsCloseAnimation(): Promise<void> {
    return new Promise(resolve => {
        const overlay = document.getElementById('vhs-close-overlay');
        const gsap = (window as any).gsap;
        if (!overlay || typeof gsap === 'undefined') { resolve(); return; }

        overlay.classList.add('active');

        const tl = gsap.timeline({ defaults: { ease: 'power2.in' }, onComplete: resolve });

        // Phase 1 (0.0s): Scanlines snap in + flicker (signal loss)
        tl.to('#vhs-scanlines', { opacity: 0.9, duration: 0.04, ease: 'none' }, 0);
        tl.to('#vhs-scanlines', { opacity: 0.25, duration: 0.04, ease: 'none' }, 0.04);
        tl.to('#vhs-scanlines', { opacity: 0.8, duration: 0.04, ease: 'none' }, 0.08);

        // Phase 1b (0.04s): Tasky pops in — CRT horizontal stretch entrance
        tl.fromTo('#vhs-tasky-wrap',
            { opacity: 0, scaleX: 1.6, scaleY: 0.5 },
            { opacity: 1, scaleX: 1, scaleY: 1, duration: 0.15, ease: 'back.out(2.5)' },
        0.04);

        // Phase 2 (0.10s): Black bars slam in from top & bottom
        tl.to('#vhs-top',    { height: '50%', duration: 0.28, ease: 'power2.in' }, 0.10);
        tl.to('#vhs-bottom', { height: '50%', duration: 0.28, ease: 'power2.in' }, 0.10);

        // Phase 2b (0.18s): Tasky squishes — CRT horizontal spread as vertical collapses
        tl.to('#vhs-tasky-wrap', {
            scaleX: 1.9, scaleY: 0.07, opacity: 0.85,
            duration: 0.18, ease: 'power2.in'
        }, 0.18);

        // Phase 2c (0.32s): Tasky stretches out to nothing (electron beam dissipates)
        tl.to('#vhs-tasky-wrap', {
            scaleX: 3.0, scaleY: 0, opacity: 0,
            duration: 0.08, ease: 'power3.in'
        }, 0.32);

        // Phase 3 (0.40s): Bright phosphor line snaps in
        tl.to('#vhs-line', { opacity: 1, duration: 0.02, ease: 'none' }, 0.40);

        // Phase 3b (0.42s): Line pulses vertically — phosphor glow spreading
        tl.to('#vhs-line', { scaleY: 4, duration: 0.05, ease: 'power2.out' }, 0.42);
        tl.to('#vhs-line', { scaleY: 1, duration: 0.05, ease: 'power2.in' }, 0.47);

        // Phase 4 (0.52s): Line collapses horizontally to a single bright point
        tl.to('#vhs-line', { scaleX: 0, duration: 0.13, ease: 'power4.in' }, 0.52);
        tl.to('#vhs-line', { opacity: 0, duration: 0.04 }, 0.64);

        // Phase 5 (0.63s): Cyan-white phosphor flash
        tl.to('#vhs-flash', { opacity: 1, duration: 0.02, ease: 'none' }, 0.63);
        tl.to('#vhs-flash', { opacity: 0, duration: 0.16, ease: 'power2.out' }, 0.65);

        // Phase 6 (0.80s+): Hold full black
        tl.to({}, { duration: 0.13 }, 0.80);
    });
}

function initResizing(): void {
    const strips = document.querySelectorAll('.rs-edge, .rs-corner');

    strips.forEach(strip => {
        strip.addEventListener('mousedown', (e: Event) => {
            const mouseEvent = e as MouseEvent;
            if (mouseEvent.button !== 0) return;

            const dir = (strip as HTMLElement).dataset.direction;
            if (!dir) return;

            mouseEvent.preventDefault();
            mouseEvent.stopPropagation();

            invoke('start_resizing', { direction: dir }).catch(err => {
                console.error("[BMM] Native resize failed:", err);
            });
        });
    });
}
