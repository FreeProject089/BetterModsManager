/**
 * betahub-pow.ts — Proof-of-Work Captcha
 * Client-side SHA-256 PoW to prevent spam.
 * Finds a nonce such that SHA-256(challenge + nonce) starts with N zero bits.
 */

export interface PowResult {
    challenge: string;
    nonce: number;
    hash: string;
}

/**
 * Generate a random hex challenge string.
 */
function generateChallenge(length: number = 32): string {
    const arr = new Uint8Array(length / 2);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute SHA-256 of a string, returns hex string.
 */
async function sha256(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Check if a hex hash satisfies the difficulty (N leading zeros).
 * difficulty = 4 ≈ 1/16^4 ≈ 65536 iterations ≈ 1-2s avg.
 */
function satisfiesDifficulty(hash: string, difficulty: number): boolean {
    for (let i = 0; i < difficulty; i++) {
        if (hash[i] !== '0') return false;
    }
    return true;
}

export interface PowOptions {
    difficulty?: number;        // Number of leading hex zeros required (default: 4)
    onProgress?: (nonce: number) => void;  // Progress callback
    signal?: AbortSignal;       // Cancellation
}

/**
 * Solve Proof-of-Work.
 * Runs async in micro-batches to avoid freezing the UI thread.
 * @param difficulty Number of leading hex zeros (default 4, ~65K iterations, ~1-2s)
 */
export async function solvePoW(options: PowOptions = {}): Promise<PowResult> {
    const difficulty = options.difficulty ?? 4;
    const challenge = generateChallenge();
    let nonce = 0;

    // Run in async batches of 500 to yield to the event loop
    const BATCH_SIZE = 500;

    while (true) {
        if (options.signal?.aborted) {
            throw new DOMException('PoW aborted', 'AbortError');
        }

        // Process a batch synchronously
        for (let i = 0; i < BATCH_SIZE; i++) {
            const hash = await sha256(`${challenge}${nonce}`);
            if (satisfiesDifficulty(hash, difficulty)) {
                return { challenge, nonce, hash };
            }
            nonce++;
        }

        // Report progress every batch
        if (options.onProgress) {
            options.onProgress(nonce);
        }

        // Yield to event loop
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
}

/**
 * Verify a PoW solution (for client-side double-check).
 */
export async function verifyPoW(
    challenge: string,
    nonce: number,
    difficulty: number = 4
): Promise<boolean> {
    const hash = await sha256(`${challenge}${nonce}`);
    return satisfiesDifficulty(hash, difficulty);
}
