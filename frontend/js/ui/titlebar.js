/**
 * titlebar.ts — Window titlebar, resizing, and confirmation dialog
 */
import { invoke } from '../core/api.js';
let tauriWindow = null;
export async function initTitlebar() {
    try {
        if (window.__TAURI__?.window) {
            const w = window.__TAURI__.window;
            tauriWindow = w.appWindow || (typeof w.getCurrent === 'function' ? w.getCurrent() : null);
        }
        if (!tauriWindow || typeof tauriWindow.startResizing !== 'function') {
            try {
                const { appWindow, getCurrent } = await import('https://unpkg.com/@tauri-apps/api@1/window.js');
                tauriWindow = appWindow || getCurrent();
            }
            catch (_e) { /* ignore */ }
        }
        document.getElementById('tb-min')?.addEventListener('click', () => tauriWindow?.minimize());
        const toggleFullscreen = async () => {
            if (tauriWindow) {
                const isMax = await tauriWindow.isMaximized();
                if (isMax) {
                    await tauriWindow.unmaximize();
                }
                else {
                    await tauriWindow.maximize();
                }
            }
        };
        document.getElementById('tb-max')?.addEventListener('click', toggleFullscreen);
        if (tauriWindow) {
            const checkMaximized = async () => {
                const isMax = await tauriWindow.isMaximized();
                if (isMax) {
                    document.body.classList.add('is-maximized');
                }
                else {
                    document.body.classList.remove('is-maximized');
                }
            };
            tauriWindow.onResized(checkMaximized);
            checkMaximized();
        }
        document.getElementById('tb-close')?.addEventListener('click', () => {
            if (tauriWindow) {
                invoke('finalize_and_close_app').catch(() => tauriWindow.close());
            }
            else {
                window.close();
            }
        });
    }
    catch (err) {
        console.error("[BMM] Window API initialization failed:", err);
    }
    initResizing();
}
function initResizing() {
    const strips = document.querySelectorAll('.rs-edge, .rs-corner');
    strips.forEach(strip => {
        strip.addEventListener('mousedown', (e) => {
            const mouseEvent = e;
            if (mouseEvent.button !== 0)
                return;
            const dir = strip.dataset.direction;
            if (!dir)
                return;
            mouseEvent.preventDefault();
            mouseEvent.stopPropagation();
            invoke('start_resizing', { direction: dir }).catch(err => {
                console.error("[BMM] Native resize failed:", err);
            });
        });
    });
}
//# sourceMappingURL=titlebar.js.map