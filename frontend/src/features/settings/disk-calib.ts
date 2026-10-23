// When BMM may recalibrate a disk by itself (PLAN-BMM-RESOURCES-2026.md §3 and decision 2).
//
// Auto-calibration used to run at EVERY start: 50 MB written and fsynced on each disk BMM uses,
// two seconds after launch, then a MB/s limit set to 70% of the result. So most people carried
// a limit they never chose, re-measured every day while the game was maybe already starting.
// Now: once per disk, then again only when the last measurement is older than 30 days. The
// button in Storage & performance still measures whenever it is pressed.
//
// Pure, so the rule is a test; the timestamps live in localStorage (per machine, which is what a
// disk measurement is).

export const RECALIBRATE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const KEY = 'bmm.diskCalibratedAt';

export type CalibMap = Record<string, number>;

/** Does this disk need an automatic calibration now? */
export function calibrationDue(map: CalibMap, mount: string, now = Date.now()): boolean {
    const last = map[String(mount).toLowerCase()];
    return !(typeof last === 'number' && last > 0 && now - last < RECALIBRATE_AFTER_MS && last <= now);
}

export function withCalibrated(map: CalibMap, mount: string, now = Date.now()): CalibMap {
    return { ...map, [String(mount).toLowerCase()]: now };
}

export function readCalibMap(): CalibMap {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
}

export function writeCalibMap(map: CalibMap): void {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* private mode: measured again next time */ }
}
