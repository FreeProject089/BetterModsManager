// key-pin.ts — BetterCommunity's refusals of this install's creator key, remembered.
//
// When BMM proves its Creator ID to BetterCommunity (`/api/link/upgrade`, `/api/link/request`),
// the server checks the proof against the key chain it PINNED for that id on first sight
// (BCWEB `acceptCreatorProof`, lib/creator-identity.mjs). Three refusals come from the pin:
//
//   · `key_fork`              — this chain skips the pinned key: the key store was lost and
//                               recreated, or somebody else started a chain for this id;
//   · `key_retired`           — this key is older than the pinned one (it was rotated away);
//   · `upgraded_key_required` — a v4 proof for an id that already has a v5 chain.
//
// They used to be swallowed with every other failure ("offline, or an older server"), so the
// first-pin land-grab (C8-C) was invisible from BMM: somebody else's chain could hold the id
// and this install kept retrying in silence. They are now kept here and shown on the Settings
// identity card, with the way out (the owner resets the pin on BetterCommunity).
//
// A leaf with no imports, so the parsing is tested against the compiled module in node.

export type KeyPinProblem = 'key_fork' | 'key_retired' | 'upgraded_key_required';

export const KEY_PIN_PROBLEMS: readonly KeyPinProblem[] = ['key_fork', 'key_retired', 'upgraded_key_required'];

const STORE_KEY = 'bc_key_pin_problem';

/**
 * The pin refusal carried by a failed `bc_api_post`, or null.
 *
 * The Rust command rejects a non-2xx with the response body (`{"error":"key_fork"}`) or with
 * `http_<code>` when the body is empty. Only the three pin errors count: `replayed`,
 * `invalid` or `unavailable` are not something the owner can fix by resetting a pin.
 */
export function pinProblemOf(err: unknown): KeyPinProblem | null {
    const raw = String((err as { message?: unknown })?.message ?? err ?? '').trim();
    let code = '';
    try { code = String(JSON.parse(raw)?.error ?? ''); } catch { return null; }
    return (KEY_PIN_PROBLEMS as readonly string[]).includes(code) ? (code as KeyPinProblem) : null;
}

export type StoredPinProblem = { error: KeyPinProblem; kid: string; at: number };

/** Remember a refusal (for the identity card, which may not be open when it happens). */
export function recordPinProblem(error: KeyPinProblem, kid = ''): void {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ error, kid, at: Date.now() })); } catch { /* private mode */ }
}

/** The last refusal, or null. A malformed entry reads as none rather than as a refusal. */
export function readPinProblem(): StoredPinProblem | null {
    try {
        const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        if (!v || !(KEY_PIN_PROBLEMS as readonly string[]).includes(v.error)) return null;
        return { error: v.error, kid: String(v.kid || ''), at: Number(v.at) || 0 };
    } catch { return null; }
}

/** The server accepted a proof: whatever it refused before is over. */
export function clearPinProblem(): void {
    try { localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
}
