// What fits in a feedback submission.
//
// Its own module, with no imports, because there are TWO ceilings and they are easy to
// confuse: both are "a size in MB" and one of them is 4/3 of the other. Keeping the
// arithmetic here means it can be exercised without loading the transport, the i18n layer,
// or the debug hub that installs global handlers the moment it is imported.
//
//   `maxAttachMB`  is about the FILES. The server decodes each attachment and compares the
//                  decoded bytes to this.
//   `maxRequestMB` is about the HTTP REQUEST. Attachments travel base64-encoded inside the
//                  JSON, so 25 MB of files is a ~34 MB body.
//
// The app has now got this wrong in both directions, and neither failure raises anything.
// Budgeting only decoded bytes let it build a request a third larger than it believed —
// anything in front of the API with a smaller body limit answers a bare `413 Content Too
// Large`, no JSON, no explanation, to an app convinced it was inside the limit. Budgeting
// only encoded bytes against `maxAttachMB` fixed that and broke the other end: files the
// server would have taken were refused at a limit the server itself advertised.
//
// So: both, each against the number that governs it.

export interface AttachBudget {
    /** Total number of attachments allowed. */
    maxAttachments: number;
    /** Total DECODED bytes allowed — the server's maxAttachMB. */
    maxBytes: number;
    /** Total ENCODED bytes allowed — what the request itself may weigh. */
    maxWire: number;
}

/** Running totals, as attachments are added. */
export interface AttachUsed { count: number; bytes: number; wire: number }

interface LimitsIn { maxAttachments?: number; maxAttachMB?: number; maxRequestMB?: number }

/** Resolve both ceilings from the server's published config. */
export function attachLimits(cfg?: LimitsIn | null): AttachBudget {
    const maxAttachments = Math.max(0, cfg?.maxAttachments ?? 6);
    const maxAttachMB = Math.max(0, cfg?.maxAttachMB ?? 25);
    // A server older than `maxRequestMB` does not send it. Guessing HIGH would reintroduce the
    // 413; the safe reading is the encoded size of a full attachment budget, which is exactly
    // what such a server was already accepting.
    const maxRequestMB = cfg?.maxRequestMB ?? Math.ceil(maxAttachMB * 4 / 3);
    return { maxAttachments, maxBytes: maxAttachMB * 1024 * 1024, maxWire: maxRequestMB * 1024 * 1024 };
}

/**
 * What a base64 payload weighs once decoded — EXACTLY, from the string.
 *
 * Four characters carry three bytes, less one for each `=` of padding. Taking the string
 * rather than its length matters at the boundary: estimating from the length alone is off by
 * up to two bytes, and those two bytes are visible — a submission of exactly the advertised
 * 25 MB came out over the 25 MB budget and was refused. A budget you cannot fill is a budget
 * that is wrong, and "25 MB refused at 25 MB" is a report nobody can act on.
 */
export function decodedLen(b64: string): number {
    const n = b64.length;
    if (n < 4) return 0;
    const pad = b64.charCodeAt(n - 1) === 61 ? (b64.charCodeAt(n - 2) === 61 ? 2 : 1) : 0;
    return (n / 4) * 3 - pad;
}

/** Whether one more attachment fits every ceiling. Takes the base64 itself: its length is what
 *  travels, and its padding is what decides what is stored. */
export function fitsBudget(used: AttachUsed, b64: string, lim: AttachBudget): boolean {
    if (used.count >= lim.maxAttachments) return false;
    return used.bytes + decodedLen(b64) <= lim.maxBytes && used.wire + b64.length <= lim.maxWire;
}
