// The resources dashboard's pure parts (G6), apart so a test can import them without the
// app (resources-dash.ts reaches the Tauri API and the app state at import).
export const HISTORY = 60;
/** Keep the last HISTORY values of a series, oldest first.  */
export function pushHistory(arr: number[], v: number, max = HISTORY): number[] {
    const out = arr.concat([Number.isFinite(v) ? v : 0]);
    return out.length > max ? out.slice(out.length - max) : out;
}

/** An SVG polyline for a 0..ceil series in a w×h box.  */
export function sparkPoints(values: number[], w: number, h: number, ceil: number): string {
    if (!values.length) return '';
    const top = Math.max(ceil, ...values, 1e-9);
    const step = values.length > 1 ? w / (values.length - 1) : 0;
    return values.map((v, i) => `${(i * step).toFixed(1)},${(h - (Math.max(0, v) / top) * h).toFixed(1)}`).join(' ');
}

