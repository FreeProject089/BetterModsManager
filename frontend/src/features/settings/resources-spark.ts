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


/** One matrix row's inputs → the rule to store (S1). An empty input is "inherit", so it is
 *  left out; a row with nothing set is `null`, which removes the rule. Numbers are floored
 *  and anything non-numeric or below 1 is dropped rather than stored. */
export function ruleFromInputs(v: { rate?: string; parallel?: string; buffer?: string; io?: string }): Record<string, unknown> | null {
    const num = (s?: string) => { const n = Math.floor(Number(String(s ?? '').trim())); return String(s ?? '').trim() !== '' && Number.isFinite(n) && n >= 1 ? n : undefined; };
    const out: Record<string, unknown> = {};
    const rate = num(v.rate), parallel = num(v.parallel), buffer = num(v.buffer);
    if (rate !== undefined) out.rate_mb_s = rate;
    if (parallel !== undefined) out.parallel = parallel;
    if (buffer !== undefined) out.buffer_kib = buffer;
    if (v.io === 'low' || v.io === 'normal') out.io_priority = v.io;
    return Object.keys(out).length ? out : null;
}

/** A pause-all in force (owner card 2): who set it and, unless the user did, when it ends. */
export interface PausedAll { by: string; age_ms: number; remaining_ms: number | null; }

/** The "everything is paused" line: who paused (`user`, `task:<name>`, `plugin:<id>`, `api`)
 *  and, for anything but the user's own pause, when it ends by itself (TASK_PAUSE_MAX, 30 min).
 *  Plain text: the caller puts it in `textContent`. `t` is i18n's (a parameter, so the tests
 *  can call it without the i18n module); an empty answer falls back to the English text. */
export function pausedAllText(p: PausedAll, t: (k: string) => string): string {
    const by = String(p.by || '');
    const [kind, ...rest] = by.split(':');
    const name = rest.join(':');
    let who: string;
    if (by === 'user') who = t('res.pausedBy.user') || 'Paused by you, until you resume it.';
    else if (kind === 'task' && name) who = (t('res.pausedBy.task') || 'Paused by the task “{n}”.').replace('{n}', name);
    else if (kind === 'plugin' && name) who = (t('res.pausedBy.plugin') || 'Paused by the plugin {n}.').replace('{n}', name);
    else if (by === 'api') who = t('res.pausedBy.api') || 'Paused through the local API.';
    else who = t('res.pausedBy.unknown') || 'Paused by an automation.';
    const left = p.remaining_ms == null ? ''
        : ' ' + (t('res.pausedLeft') || 'Resumes by itself in {m} min.').replace('{m}', String(Math.max(1, Math.ceil(p.remaining_ms / 60000))));
    return `${t('res.pausedAll') || 'Everything is paused: deploys and installs wait until it is resumed.'} ${who}${left}`;
}
