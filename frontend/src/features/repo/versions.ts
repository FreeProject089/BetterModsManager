// Mod versions compared as numbers: the frontend twin of `repo_follow::version_cmp` (Rust),
// for the few checks made here. « 1.10 » is newer than « 1.9 », « v2 » equals « 2.0.0 »,
// « 1.0.0-beta » is older than « 1.0.0 », and a version that is not a dotted number is only
// "different". Pinned by tests/repo-versions.test.mjs.

function parse(v: string): { nums: number[]; pre: string | null } | null {
    const s = String(v ?? '').trim().replace(/^v/i, '').split('+')[0];
    const dash = s.indexOf('-');
    const core = dash >= 0 ? s.slice(0, dash) : s;
    const pre = dash >= 0 ? s.slice(dash + 1).toLowerCase() : null;
    if (!core || !/^\d+(\.\d+)*$/.test(core)) return null;
    return { nums: core.split('.').map(Number), pre };
}

/** -1 / 0 / 1, or null when either side is not a dotted number. */
export function versionCmp(a: string, b: string): number | null {
    const x = parse(a), y = parse(b);
    if (!x || !y) return null;
    const n = Math.max(x.nums.length, y.nums.length);
    for (let i = 0; i < n; i++) {
        const d = (x.nums[i] || 0) - (y.nums[i] || 0);
        if (d) return d > 0 ? 1 : -1;
    }
    if (x.pre === y.pre) return 0;
    if (x.pre === null) return 1;
    if (y.pre === null) return -1;
    return x.pre > y.pre ? 1 : -1;
}

/** Is `remote` an update over `local`? Never a downgrade; not numbers = different. */
export function isNewerVersion(remote: string, local: string): boolean {
    const c = versionCmp(remote, local);
    if (c !== null) return c > 0;
    return String(remote ?? '').trim().toLowerCase() !== String(local ?? '').trim().toLowerCase();
}

/** A repo URL the way BMM records it (`repo::normalize_repo_url`). */
export function normRepoUrl(u: string): string {
    let s = String(u ?? '').trim();
    if (s.endsWith('/repo.json')) s = s.slice(0, -'/repo.json'.length);
    return s.replace(/\/+$/, '').toLowerCase();
}
