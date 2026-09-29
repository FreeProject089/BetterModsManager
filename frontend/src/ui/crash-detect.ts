// crash-detect.ts — "did BMM crash last time?", answered in one place.
//
// The crash notice used to both decide and open in one function (crash-report.ts). The launch
// deck now shows it as one of its steps, so the DECISION had to be reachable without the dialog
// — and without importing the app frame, which crash-report.ts does for its toasts. The rule
// lives here, once; crash-report.ts and the deck both ask it.

import { invoke, getSettings, updateSettings } from '../core/api.js';

interface StartupStatus { backend_crashed: boolean }

export interface CrashFinding {
    /** The newest crash report on disk, if there is one. */
    newest: string | null;
    /** The backend itself noticed the last session ended in a crash. */
    backendCrashed: boolean;
}

/**
 * Whether the last session crashed and the reader has not been told about it yet: the backend
 * says so, or there is a `crash_*` report newer than the last one shown. Null otherwise, and
 * null on any error — a check that fails must not invent a crash.
 */
export async function detectPreviousCrash(): Promise<CrashFinding | null> {
    try {
        const status = await invoke('get_startup_status') as StartupStatus;
        const settings: any = await getSettings();
        const reports = (await invoke('get_crash_reports') as string[]) || [];
        const newest = reports.length > 0 ? reports[0] : null;
        const backendCrashed = !!status?.backend_crashed;
        if (backendCrashed) {
            invoke('log_frontend_line', { line: 'Startup: Crash detected by backend.' }).catch(() => {});
            return { newest, backendCrashed };
        }
        if (newest && newest !== settings.last_seen_crash) {
            const name = newest.split(/[\\/]/).pop() || '';
            if (name.startsWith('crash_')) return { newest, backendCrashed };
        }
    } catch (e) {
        console.warn('Crash check failed:', e);
    }
    return null;
}

/** The notice was shown: remember which report, so the same crash is not announced twice. */
export async function markCrashSeen(finding: CrashFinding): Promise<void> {
    try {
        if (finding.newest) {
            const settings: any = await getSettings();
            settings.last_seen_crash = finding.newest;
            await updateSettings(settings);
        }
        invoke('log_frontend_line', { line: `Crash modal displayed for: ${finding.newest || 'unknown'}` }).catch(() => {});
    } catch (e) {
        console.warn('Crash check failed:', e);
    }
}
