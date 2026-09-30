// live-issues-core.ts: the pure half of live error reporting (no DOM, no invoke), so the rules
// are tested against the compiled module (tests/live-issues.test.mjs). The Rust side
// (src-tauri/src/commands/live_issues.rs) redacts, groups, queues and sends; this side only
// decides WHAT is worth handing over and keeps a burst from flooding the IPC bridge.

/** The operation a failed command belongs to: what the dashboard filters on. */
export function componentForCommand(cmd: string): string {
    const c = String(cmd || '').toLowerCase();
    if (/deploy|apply_profile|activate_mod|toggle_mod|undeploy|purge/.test(c)) return 'deploy';
    if (/install|download|import_mod|extract|unpack|catalog_install/.test(c)) return 'install';
    if (/backup|restore|snapshot/.test(c)) return 'backup';
    if (/sched|task_|trigger/.test(c)) return 'scheduler';
    if (/repo_|repo$|sync_/.test(c)) return 'repo';
    return 'ipc';
}

/** Commands never reported: the reporter's own, telemetry's own, logging. A failure there must
 *  not report itself in a loop. */
export function isIgnoredCommand(cmd: string): boolean {
    return /^(live_issue|analytics_|log_frontend_line|append_api_log|read_session_log_tail|replay_spool_)/.test(String(cmd || ''));
}

/** Only real errors: a cancel, an offline network or a validation message the user already saw
 *  as a toast is an expected condition, not an issue. */
export function shouldReportInvoke(kind: string): boolean {
    return kind === 'error';
}

/** Text of whatever was thrown (Error, string, Tauri error object). */
export function errorText(e: unknown): string {
    if (e == null) return 'unknown error';
    if (typeof e === 'string') return e;
    if (e instanceof Error) return `${e.name && e.name !== 'Error' ? e.name + ': ' : ''}${e.message}`;
    const o = e as any;
    if (typeof o.message === 'string') return o.message;
    try { return JSON.stringify(o).slice(0, 2000); } catch { return String(o); }
}
export function errorStack(e: unknown): string | undefined {
    const s = (e as any)?.stack;
    return typeof s === 'string' ? s.slice(0, 8000) : undefined;
}

/** At most `max` reports per `windowMs`, and the same text at most once per `sameMs`. The Rust
 *  side counts repeats anyway; this only keeps a render loop that throws 60 times a second from
 *  crossing the bridge 60 times a second. */
export class Throttle {
    private stamps: number[] = [];
    private last = new Map<string, number>();
    constructor(private max = 20, private windowMs = 10_000, private sameMs = 2_000) {}
    allow(key: string, now = Date.now()): boolean {
        this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
        const prev = this.last.get(key);
        if (prev != null && now - prev < this.sameMs) return false;
        if (this.stamps.length >= this.max) return false;
        this.stamps.push(now);
        this.last.set(key, now);
        if (this.last.size > 500) this.last.clear();
        return true;
    }
}
