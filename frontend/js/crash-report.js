/**
 * crash-report.js — Crash Detection and Reporting UI
 */

import { invoke } from './api.js';
import { t } from './i18n.js';
import { toast } from './app.js';

/** Call on startup – shows crash modal if a recent zip was generated OR backend detected dirty session. */
export async function checkPreviousCrash() {
    try {
        const startupStatus = await invoke('get_startup_status');
        const { getSettings, updateSettings } = await import('./api.js');
        const settings = await getSettings();

        const backendCrashed = startupStatus.backend_crashed;
        const reports = await invoke('get_crash_reports') || [];
        const newest = reports.length > 0 ? reports[0] : null;
        const lastSeen = settings.last_seen_crash;

        let shouldShow = false;

        // ONLY show if:
        // 1. The backend explicitly detected a hard crash/orphan (backendCrashed).
        // 2. We have a NEW zip file that starts with "crash_".
        // We skip "session_" zips to avoid false positives from clean shutdowns 
        // that used to generate them or legacy files.
        if (backendCrashed) {
            shouldShow = true;
            invoke('log_frontend_line', { line: `Startup: Crash detected by backend.` });
        } else if (newest && newest !== lastSeen) {
            const isCrashFile = newest.split(/[\\/]/).pop().startsWith('crash_');
            if (isCrashFile) {
                shouldShow = true;
            }
        }

        if (shouldShow) {
            const pathEl = document.getElementById('crash-zip-path');
            if (pathEl && newest) {
                pathEl.textContent = newest;
                // Save this so we don't show it again
                settings.last_seen_crash = newest;
            }

            const modal = document.getElementById('modal-crash-report');
            if (modal) {
                modal.classList.add('open');
                await updateSettings(settings);
                invoke('log_frontend_line', { line: `Crash modal displayed for: ${newest || 'unknown'}` });
            }
        }
    } catch (e) {
        console.warn('Crash check failed:', e);
    }
}

export function initCrashReportUI() {
    // Open Crash Folder (settings card)
    const openFolderBtn = document.getElementById('btn-open-crash-folder');
    if (openFolderBtn) {
        openFolderBtn.addEventListener('click', async () => {
            try {
                await invoke('open_crash_folder');
            } catch (err) {
                toast(t('common.crashFolderError') + ': ' + err, 'error');
            }
        });
    }

    // New Container Click (Better UX)
    const pathContainer = document.getElementById('crash-path-container');
    const openZip = async () => {
        const pathEl = document.getElementById('crash-zip-path');
        const path = pathEl?.textContent?.trim();
        if (path && path !== '—') {
            try {
                await invoke('open_crash_zip', { path });
            } catch (err) {
                toast('Could not open zip: ' + err, 'error');
            }
        }
    };

    if (pathContainer) {
        pathContainer.addEventListener('click', openZip);
    }

    // Modal Path click (legacy support if layout changes back)
    const pathEl = document.getElementById('crash-zip-path');
    if (pathEl) {
        pathEl.style.cursor = 'pointer';
        pathEl.addEventListener('click', openZip);
    }

    // Crash modal: "Open in Explorer" button
    const openZipBtn = document.getElementById('btn-crash-open-zip');
    if (openZipBtn) {
        openZipBtn.addEventListener('click', openZip);
    }
}
