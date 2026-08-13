// Calendar arithmetic for the scheduler — the part with no app in it.
//
// Split out of scheduler.ts on purpose: everything here is a pure function of a trigger
// and a Date, so it can be tested directly. The rest of the scheduler cannot — it talks
// to Tauri, the DOM and i18n from its first line, which is exactly why the timing bug
// below survived so long unnoticed.
//
// THE BUG THIS EXISTS TO FIX: `dailyAt` / `weeklyAt` / `monthlyAt` used to be evaluated
// by matching the current hour and minute. That only fires if BMM happens to be running
// during that one minute — a daily 03:00 backup on a machine that boots at 09:00 never
// ran once, and nothing said so. The question here is instead "has the last window gone
// by unserved", which is answerable whenever the app happens to be awake.

/** A calendar trigger: the three that recur at a wall-clock time. */
export type CalendarTrigger =
    | { type: 'dailyAt'; time: string }
    | { type: 'weeklyAt'; time: string; days: number[] }   // 0=Sun..6=Sat
    | { type: 'monthlyAt'; day: number; time: string };    // day-of-month 1..31

export function parseHm(time: string): { h: number; m: number } {
    // `?? 0` after the destructuring, not just inside the map: a string with no colon
    // yields a ONE-element array, so `m` is undefined and never reaches the map's `|| 0`.
    // The clamp then turned that undefined into NaN and setHours(h, NaN) produces an
    // Invalid Date — a task whose next run is silently never.
    const parts = String(time || '').split(':').map((n) => parseInt(n, 10) || 0);
    const h = parts[0] ?? 0;
    const m = parts[1] ?? 0;
    return { h: Math.min(23, Math.max(0, h)), m: Math.min(59, Math.max(0, m)) };
}

/** `base`'s date at h:m local, seconds and ms zeroed. */
export function atTime(base: Date, h: number, m: number): Date {
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d;
}

const daysInMonth = (year: number, month: number): number => new Date(year, month + 1, 0).getDate();

/** The most recent instant this trigger was due at, at or before `now`. Null when there
 *  is none within a sane lookback (a weekly with no days selected; a monthly day-31 in a
 *  year that somehow has no 31st). */
export function prevCalendarDue(tr: CalendarTrigger, now: Date): number | null {
    const { h, m } = parseHm(tr.time);
    if (tr.type === 'dailyAt') {
        const today = atTime(now, h, m);
        if (today.getTime() <= now.getTime()) return today.getTime();
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        return y.getTime();
    }
    if (tr.type === 'weeklyAt') {
        if (!tr.days?.length) return null;
        // Eight days back covers every case: the same weekday a week ago is the furthest
        // the answer can be.
        for (let i = 0; i < 8; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const at = atTime(d, h, m);
            if (tr.days.includes(at.getDay()) && at.getTime() <= now.getTime()) return at.getTime();
        }
        return null;
    }
    // Monthly. A day-31 task simply HAS no window in a 30-day month — skipping that month
    // is the honest reading of "the 31st", and quietly firing on the 30th instead would be
    // inventing a schedule the user did not ask for.
    for (let i = 0; i < 13; i++) {
        const probe = new Date(now.getFullYear(), now.getMonth() - i, 1);
        if (tr.day > daysInMonth(probe.getFullYear(), probe.getMonth())) continue;
        const at = atTime(new Date(probe.getFullYear(), probe.getMonth(), tr.day), h, m);
        if (at.getTime() <= now.getTime()) return at.getTime();
    }
    return null;
}

/** The next instant this trigger is due at, strictly after `from`. Null if there is none
 *  within a year's lookahead. */
export function nextCalendarDue(tr: CalendarTrigger, from: Date): number | null {
    const { h, m } = parseHm(tr.time);
    const nowMs = from.getTime();
    if (tr.type === 'dailyAt') {
        const today = atTime(from, h, m);
        if (today.getTime() > nowMs) return today.getTime();
        const d = new Date(today);
        d.setDate(d.getDate() + 1);
        return d.getTime();
    }
    if (tr.type === 'weeklyAt') {
        if (!tr.days?.length) return null;
        for (let i = 0; i < 8; i++) {
            const d = new Date(from);
            d.setDate(d.getDate() + i);
            const at = atTime(d, h, m);
            if (tr.days.includes(at.getDay()) && at.getTime() > nowMs) return at.getTime();
        }
        return null;
    }
    for (let i = 0; i < 14; i++) {
        const probe = new Date(from.getFullYear(), from.getMonth() + i, 1);
        if (tr.day > daysInMonth(probe.getFullYear(), probe.getMonth())) continue;
        const at = atTime(new Date(probe.getFullYear(), probe.getMonth(), tr.day), h, m);
        if (at.getTime() > nowMs) return at.getTime();
    }
    return null;
}

/** Is a calendar task owed a run?
 *
 *  `since` is the later of its last run and its creation — the creation half matters:
 *  without it, saving a daily 21:00 task at 22:00 would count today's window as missed
 *  and fire the instant you pressed Save.
 *
 *  `catchUp` false narrows it back to the live window (~90s), so a run missed while BMM
 *  was closed stays missed. At most ONE run is ever owed, however long BMM was away:
 *  prevCalendarDue returns the most recent window, not every window since.
 */
export function calendarDue(
    tr: CalendarTrigger,
    now: Date,
    since: number,
    catchUp: boolean,
): boolean {
    const due = prevCalendarDue(tr, now);
    if (due === null) return false;
    if (since >= due) return false;
    if (!catchUp && now.getTime() - due > 90_000) return false;
    return true;
}
