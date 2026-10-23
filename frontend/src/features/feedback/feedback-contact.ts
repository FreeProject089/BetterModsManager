// feedback-contact.ts — does this report need an e-mail, and is the field shown at all.
//
// Import-free on purpose (like feedback-budget.ts) so the rule can be tested without a webview.
//
// The rule is the server's, restated: BetterCommunity asks for a contact only when it cannot
// tell who sent the report (`!userId && !email && requireContact` in routes/feedback.mjs). So
// "the account is used" must mean "the SERVER that receives the report will recognise the
// sender", not "some screen said linked". Three ways those two disagreed:
//
//   · the link status was asked of one server and the report posted to another (test mode
//     pointed the status check at the local BetterCommunity while reports went to the
//     production URL in links.json): linked here, a stranger there;
//   · the key is pinned and refused (pinProblem): the proof that identifies the sender fails;
//   · the server simply refused the proof (replay, clock, rotated key).
//
// The first two are known before Send and handled here. The third is only known from the
// answer, and the dialog then reveals the e-mail field instead of saying "an address is
// required" with nowhere to type one.

export interface ContactInput {
    state: 'linked' | 'anonymous' | 'unknown';
    pinProblem?: unknown;
    /** The link status and the report go to the same BetterCommunity origin. */
    sameServer: boolean;
    /** The project's `requireContact` (from /feedback/<project>/config). */
    requireContact: boolean;
}
export interface ContactPolicy {
    /** The account identifies the sender: no contact field, no requirement. */
    account: boolean;
    /** An e-mail must be typed before Send. */
    required: boolean;
}

export function contactPolicy(i: ContactInput): ContactPolicy {
    const account = i.state === 'linked' && !i.pinProblem && i.sameServer;
    return { account, required: !account && !!i.requireContact };
}

/** Same scheme+host+port. Unparseable URLs are never "the same". */
export function sameOrigin(a: string, b: string): boolean {
    try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/** Loose, like the server's zod `.email()` in spirit: something@something.tld, no spaces. */
export function looksLikeEmail(s: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim()) && s.trim().length <= 160;
}
