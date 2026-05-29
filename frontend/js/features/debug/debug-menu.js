// @ts-nocheck
/**
 * debug-menu.js — Debug Menu Logic
 */
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { debugUI } from './debug-ui.js';
export function initDebugMenu() {
    // Show/Hide based on app.cfg (Prod=false or FSDM=true)
    Promise.all([invoke('is_debug_mode'), invoke('is_fsdm_mode')]).then(([isDebug, isFSDM]) => {
        window.bmmDebugEnabled = isDebug || isFSDM;
        window.bmmFSDMEnabled = isFSDM;
        // NOTE: do NOT eagerly init the Debug UI — it builds a heavy panel + a
        // refresh loop. It is now lazily built on first open (debugUI.toggle)
        // and fully unloaded when closed, so it takes ~0 resources until used.
        const card = document.getElementById('debug-menu-card');
        if (card) {
            // Manual hide by default (even if enabled) per user request
            // Section is toggled via Alt+Shift+D (handled in user-logger.js)
            card.style.display = 'none';
        }
    });
    const genCrashBtn = document.getElementById('btn-debug-gen-crash');
    if (genCrashBtn) {
        genCrashBtn.addEventListener('click', async () => {
            try {
                toast(t('common.loading'), 'info');
                const path = await invoke('trigger_manual_crash_report');
                toast(`Report generated: ${path}`, 'success', 5000);
            }
            catch (err) {
                toast((window.t ? window.t('common.error') : 'Failed') + ': ' + err, 'error');
            }
        });
    }
    const resetAppBtn = document.getElementById('btn-debug-reset-app');
    if (resetAppBtn) {
        resetAppBtn.addEventListener('click', async () => {
            const confirmed = confirm(t('settings.debugResetConfirm') || "DANGER: This will delete everything (Profiles, Mods, Settings). Are you sure?");
            if (confirmed) {
                try {
                    // 1. Reset backend (data.json)
                    await invoke('reset_app_data');
                    // 2. Reset frontend (localStorage)
                    localStorage.clear();
                    // 3. Restart app
                    toast((window.t ? window.t('common.success') : 'System Reset'), "warning");
                    setTimeout(() => window.location.reload(), 1500);
                }
                catch (err) {
                    toast((window.t ? window.t('common.error') : 'Failed') + ': ' + err, 'error');
                }
            }
        });
    }
    const openDebugBtn = document.getElementById('btn-open-debug') || document.getElementById('dbg-open-menu');
    if (openDebugBtn) {
        openDebugBtn.addEventListener('click', () => {
            debugUI.toggle(true); // Force open
        });
    }
}
//# sourceMappingURL=debug-menu.js.map