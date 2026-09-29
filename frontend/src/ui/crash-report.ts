/**
 * crash-report.ts — Crash Detection and Reporting UI
 */

import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';
import { toast } from './app.js';
import { openFeedback } from '../features/feedback/feedback-modal.js';
import { detectPreviousCrash, markCrashSeen } from './crash-detect.js';

/**
 * The stand-alone crash notice (the static #modal-crash-report). At start-up the launch deck
 * shows the same finding as one of its steps instead; this stays for the fallback path. The
 * decision itself lives in crash-detect.ts, shared by both.
 */
export async function checkPreviousCrash(): Promise<void> {
    const finding = await detectPreviousCrash();
    if (!finding) return;
    const pathEl = document.getElementById('crash-zip-path');
    if (pathEl && finding.newest) pathEl.textContent = finding.newest;
    const modal = document.getElementById('modal-crash-report');
    if (modal) {
        modal.classList.add('open');
        await markCrashSeen(finding);
    }
}

export function initCrashReportUI(): void {
    // Wire the "Manage & analyze" crash-reports modal button.
    import('../features/settings/crash-manager.js').then(m => m.initCrashManager()).catch(() => {});
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
                toast((t('crash.openZipError') || 'Could not open zip') + ': ' + err, 'error');
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

    // ── Report this crash (BetterCommunity feedback centre) ────
    // The button keeps its historical id, btn-crash-report-betahub: the markup is index.html's.
    const reportBtn = document.getElementById('btn-crash-report-betahub');
    if (reportBtn) {
        reportBtn.addEventListener('click', () => {
            const zipPathEl = document.getElementById('crash-zip-path');
            const zipPath = zipPathEl?.textContent?.trim();
            // Close crash modal first
            const crashModal = document.getElementById('modal-crash-report');
            if (crashModal) crashModal.classList.remove('open');
            // Open the feedback dialog on its crash tab, the crash zip pre-attached
            openFeedback('crash', { crashZip: zipPath && zipPath !== '—' ? zipPath : undefined }).catch(() => {});
        });
    }
}

