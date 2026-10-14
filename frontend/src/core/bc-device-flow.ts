// bc-device-flow.ts — the BetterCommunity v2 sign-in (OAuth device flow, RFC 8628) as a state
// machine. PURE: no imports, no DOM, no Tauri, so tests/bc-v2.test.mjs drives the compiled file.
//
// The network half is Rust (bc_v2_auth.rs: bc_v2_device_start, bc_v2_device_poll); it keeps the
// device code and the tokens. This file decides what the dialog shows and when to ask again:
// every poll waits the server's `interval`, `slow_down` adds five seconds (Rust answers the new
// interval), and the code expires at its deadline whatever the server says.

export type FlowPhase = 'idle' | 'starting' | 'waiting' | 'approved' | 'denied' | 'expired' | 'error' | 'cancelled';

export interface FlowState {
    phase: FlowPhase;
    userCode: string;
    page: string;
    /** Seconds between two polls. */
    interval: number;
    /** ms since epoch; past it, the code is expired. */
    deadline: number;
    error: string;
    account: { name?: string; handle?: string } | null;
    /** Polls that found no answer (offline): shown, never fatal before the deadline. */
    offline: number;
}

export type FlowEvent =
    | { type: 'start' }
    | { type: 'started'; user_code: string; verification_uri_complete: string; interval: number; expires_in: number; now: number }
    | { type: 'start_failed'; error: string }
    | { type: 'polled'; state: string; interval?: number; account?: any; error?: string; offline?: boolean; now: number }
    | { type: 'tick'; now: number }
    | { type: 'cancel' };

export function initialFlow(): FlowState {
    return { phase: 'idle', userCode: '', page: '', interval: 5, deadline: 0, error: '', account: null, offline: 0 };
}

const FINAL: readonly FlowPhase[] = ['approved', 'denied', 'expired', 'error', 'cancelled'];
export function isFinal(s: FlowState): boolean { return FINAL.includes(s.phase); }

const clampInterval = (n: unknown, dflt: number): number => {
    const v = Number(n);
    return Number.isFinite(v) && v >= 1 ? Math.min(60, Math.round(v)) : dflt;
};

export function flowStep(s: FlowState, e: FlowEvent): FlowState {
    if (e.type === 'cancel') return isFinal(s) ? s : { ...s, phase: 'cancelled' };
    if (isFinal(s) && e.type !== 'start') return s;
    switch (e.type) {
        case 'start':
            return { ...initialFlow(), phase: 'starting' };
        case 'started':
            if (s.phase !== 'starting') return s;
            return {
                ...s, phase: 'waiting', userCode: String(e.user_code || ''), page: String(e.verification_uri_complete || ''),
                interval: clampInterval(e.interval, 5), deadline: e.now + Math.max(30, Number(e.expires_in) || 600) * 1000,
            };
        case 'start_failed':
            return { ...s, phase: 'error', error: String(e.error || 'error') };
        case 'tick':
            return s.phase === 'waiting' && e.now >= s.deadline ? { ...s, phase: 'expired' } : s;
        case 'polled': {
            if (s.phase !== 'waiting') return s;
            if (e.now >= s.deadline) return { ...s, phase: 'expired' };
            switch (e.state) {
                case 'pending': return { ...s, interval: clampInterval(e.interval, s.interval), offline: e.offline ? s.offline + 1 : 0 };
                case 'slow_down': return { ...s, interval: clampInterval(e.interval, Math.min(60, s.interval + 5)) };
                case 'approved': return { ...s, phase: 'approved', account: e.account || {} };
                case 'denied': return { ...s, phase: 'denied' };
                case 'expired': return { ...s, phase: 'expired' };
                default: return { ...s, phase: 'error', error: String(e.error || e.state || 'error') };
            }
        }
    }
    return s;
}

/** How long to wait before the next poll, or null when there is nothing more to ask. */
export function nextPollMs(s: FlowState): number | null {
    return s.phase === 'waiting' ? s.interval * 1000 : null;
}
