/**
 * crash-report.ts — Crash Detection and Reporting UI
 */

import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';
import { toast } from './app.js';

interface StartupStatus {
    backend_crashed: boolean;
}

export async function checkPreviousCrash(): Promise<void> {
    try {
        const startupStatus = await invoke('get_startup_status') as StartupStatus;
        const { getSettings, updateSettings } = await import('../core/api.js');
        const settings = await getSettings();

        const backendCrashed = startupStatus.backend_crashed;
        const reports = await invoke('get_crash_reports') as string[] || [];
        const newest = reports.length > 0 ? reports[0] : null;
        const lastSeen = settings.last_seen_crash;

        let shouldShow = false;

        if (backendCrashed) {
            shouldShow = true;
            invoke('log_frontend_line', { line: `Startup: Crash detected by backend.` });
        } else if (newest && newest !== lastSeen) {
            const isCrashFile = newest.split(/[\\/]/).pop()!.startsWith('crash_');
            if (isCrashFile) {
                shouldShow = true;
            }
        }

        if (shouldShow) {
            const pathEl = document.getElementById('crash-zip-path');
            if (pathEl && newest) {
                pathEl.textContent = newest;
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

export function initCrashReportUI(): void {
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

    const pathContainer = document.getElementById('crash-path-container');
    const openZip = async (): Promise<void> => {
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

    const pathEl = document.getElementById('crash-zip-path');
    if (pathEl) {
        pathEl.style.cursor = 'pointer';
        pathEl.addEventListener('click', openZip);
    }

    const openZipBtn = document.getElementById('btn-crash-open-zip');
    if (openZipBtn) {
        openZipBtn.addEventListener('click', openZip);
    }
}
