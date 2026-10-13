// Is the catalogue's version of an app newer than the one on this disk?
//
// The App Catalog card says "Update available" from this answer, so the wrong answer has a
// cost either way: a false yes reinstalls something for nothing, a false no hides a fix. The
// catalogue's `version` is free text, so this compares what it can and stays quiet otherwise.
//
//   · a leading `v` and build metadata (`+abc`) are ignored;
//   · the release part compares numerically per dot segment, so 1.10 is newer than 1.9;
//   · at an equal release, a final release is newer than its pre-release (1.0.0 > 1.0.0-rc1);
//   · either side missing → no update: an app installed without a version cannot be judged.

function parts(v: string): { main: string[]; pre: string } {
    const clean = v.trim().replace(/^v(?=\d)/i, '').split('+')[0];
    const dash = clean.indexOf('-');
    const main = (dash < 0 ? clean : clean.slice(0, dash)).split('.').map((s) => s.trim());
    return { main, pre: dash < 0 ? '' : clean.slice(dash + 1) };
}

function cmpSegment(a: string, b: string): number {
    return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

/** Compare two version strings: < 0, 0 or > 0. */
export function compareVersions(a: string, b: string): number {
    const pa = parts(a);
    const pb = parts(b);
    const n = Math.max(pa.main.length, pb.main.length);
    for (let i = 0; i < n; i++) {
        const c = cmpSegment(pa.main[i] ?? '0', pb.main[i] ?? '0');
        if (c !== 0) return c;
    }
    if (pa.pre === pb.pre) return 0;
    if (!pa.pre) return 1;      // 1.0.0 beats 1.0.0-rc1
    if (!pb.pre) return -1;
    return cmpSegment(pa.pre, pb.pre);
}

/** True when `next` (the catalogue's) is a newer version than `current` (the installed one). */
export function isNewerVersion(next?: string | null, current?: string | null): boolean {
    const a = String(next ?? '').trim();
    const b = String(current ?? '').trim();
    if (!a || !b) return false;
    return compareVersions(a, b) > 0;
}
