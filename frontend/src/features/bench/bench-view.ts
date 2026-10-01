// The live monitor's pure parts (benchmark.ts), apart so a test can import them without the app.

/** The part of the session the charts show, as inclusive indices into benchmarkData: the
 *  drag zoom when there is one, else the time window (1 / 5 / 15 min or all) ending at the
 *  last sample, or around the replayed moment when it lies before that window. */
export function viewBounds(data: { timestamp: number }[], range: number | null, z: { from: number; to: number } | null, seek: number | null): [number, number] {
    const n = data.length;
    if (!n) return [0, -1];
    const firstAt = (ts: number) => { let i = 0; while (i < n - 1 && data[i].timestamp < ts) i++; return i; };
    const lastAt = (ts: number) => { let i = n - 1; while (i > 0 && data[i].timestamp > ts) i--; return i; };
    if (z) {
        const a = firstAt(z.from), b = lastAt(z.to);
        if (b - a >= 1) return [a, b];
    }
    if (range == null) return [0, n - 1];
    let a = firstAt(data[n - 1].timestamp - range), b = n - 1;
    if (seek != null && seek < a) {
        a = firstAt(data[seek].timestamp - range / 2);
        b = lastAt(data[a].timestamp + range);
    }
    return [a, b];
}
