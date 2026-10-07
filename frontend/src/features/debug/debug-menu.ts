// @ts-nocheck
/**
 * debug-menu.ts — the Settings debug card, and the small public face of DevTools.
 *
 * The DevTools UI itself (debug-ui.ts) is a large module and is only needed once somebody
 * opens it, so nothing here imports it statically: openDebugUI / toggleDebugUI load it on
 * first use. Code that only wants to ADD a panel imports registerDebugSection from here,
 * which costs a few hundred bytes and never loads the UI.
 */

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';

export { registerDebugSection, getDebugSections } from './debug-sections.js';
export type { DebugSection } from './debug-sections.js';

let _ui = null;
let _loading = null;

/** The DevTools UI module, loaded on first use. */
function loadDebugUI() {
    if (_ui) return Promise.resolve(_ui);
    if (!_loading) {
        _loading = import('./debug-ui.js')
            .then((m) => { _ui = m.debugUI; return _ui; })
            .finally(() => { _loading = null; });
    }
    return _loading;
}

/** True while the DevTools panel is on screen. Never loads the UI to answer. */
export function isDebugUIOpen() {
    return !!(_ui && _ui.isOpen);
}

/** Same contract as the old debugUI.toggle(force): opening is gated on debug mode unless
 *  force === true; closing always works. */
export async function toggleDebugUI(force = undefined) {
    // Closing something that was never built is a no-op — do not load it just to close it.
    if (force === false && !_ui) return;
    try {
        const ui = await loadDebugUI();
        ui.toggle(force);
    } catch (e) {
        console.error('[BMM-Debug] DevTools failed to load', e);
    }
}

/** Open DevTools on a given tab or registered section id. */
export async function openDebugUI(tabOrSectionId = undefined) {
    try {
        const ui = await loadDebugUI();
        ui.toggle(true);
        if (tabOrSectionId) ui.showTab?.(tabOrSectionId);
    } catch (e) {
        console.error('[BMM-Debug] DevTools failed to load', e);
    }
}

export function initDebugMenu() {
    // Show/Hide based on app.cfg (Prod=false or FSDM=true)
    Promise.all([invoke('is_debug_mode'), invoke('is_fsdm_mode')]).then(([isDebug, isFSDM]) => {
        window.bmmDebugEnabled = isDebug || isFSDM;
        window.bmmFSDMEnabled = isFSDM;

        // The DevTools UI is not built here: it is loaded and built on first open and
        // fully unloaded on close, so it costs nothing until used.

        const card = document.getElementById('debug-menu-card');
        if (card) {
            // Manual hide by default (even if enabled) per user request
            // Section is toggled via Ctrl+D on the Settings page (user-logger.ts)
            card.style.display = 'none';
        }
    }).catch(() => { /* no backend (browser preview): the card stays as the markup has it */ });

    const genCrashBtn = document.getElementById('btn-debug-gen-crash');
    if (genCrashBtn) {
        genCrashBtn.addEventListener('click', async () => {
            try {
                toast(t('common.loading'), 'info');
                const path = await invoke('trigger_manual_crash_report');
                toast(t('debug.reportGenerated', { path }), 'success', 5000);
            } catch (err) {
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
                } catch (err) {
                    toast((window.t ? window.t('common.error') : 'Failed') + ': ' + err, 'error');
                }
            }
        });
    }

    // Factory reset — like the full reset, but the backend keeps a timestamped
    // backup (data.before-reset-*.json) first, so it's recoverable.
    const factoryBtn = document.getElementById('btn-factory-reset');
    if (factoryBtn) {
        factoryBtn.addEventListener('click', async () => {
            const confirmed = confirm(
                (window.t ? window.t('settings.factoryResetConfirm') : '') ||
                'Reset BMM to a fresh install? Profiles, mods and settings are cleared. A backup of your current data is saved first. Continue?'
            );
            if (!confirmed) return;
            try {
                await invoke('factory_reset');
                localStorage.clear();
                toast((window.t ? window.t('common.success') : 'BMM reset — restarting'), 'warning');
                setTimeout(() => window.location.reload(), 1500);
            } catch (err) {
                toast((window.t ? window.t('common.error') : 'Failed') + ': ' + err, 'error');
            }
        });
    }

    const openDebugBtn = document.getElementById('btn-open-debug') || document.getElementById('dbg-open-menu');
    if (openDebugBtn) {
        openDebugBtn.addEventListener('click', () => {
            void toggleDebugUI(true); // Force open
        });
    }
}
