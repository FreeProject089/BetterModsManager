// The parts of the HTTP action that are not the HTTP call.
//
// Split out for the same reason as sched-vars.ts and sched-time.ts: these are pure
// functions of their input, so they can be tested directly. scheduler.ts cannot be — it
// reaches Tauri, the DOM and localStorage before its first statement runs, so importing it
// from a test throws on `localStorage is not defined`.
//
// What is left in scheduler.ts after this is the `invoke` call itself and the assembly
// around it. The Rust side is covered by its own tests over real sockets; these cover the
// two pieces of logic that sit between a person's typing and that call.

/**
 * Header lines into a header map.
 *
 * Lines, not JSON, because that is the form people have them in — copied out of curl, or
 * out of an API's documentation. A JSON object here would mean escaping quotes inside a
 * field that already contains `{var}` braces.
 *
 * A line with no colon is skipped rather than treated as a header with an empty value: a
 * blank line between two headers is normal, and inventing `"": ""` from it would be
 * rejected by the backend and report a malformed header the person never wrote.
 */
export function parseHeaderLines(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of String(text || '').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i <= 0) continue;
        const name = line.slice(0, i).trim();
        // A trailing value may legitimately contain colons — `Date: Mon, 01 Jan 2026
        // 00:00:00 GMT` — so only the FIRST colon separates.
        if (name) out[name] = line.slice(i + 1).trim();
    }
    return out;
}

/**
 * Pull one value out of a JSON reply, by a dotted path like `data.0.version`.
 *
 * Numeric segments index arrays, so `data.0` is the first element rather than a key called
 * "0". Everything else is a property name.
 *
 * Throws when the body is not JSON at all — told apart from "the field is not there" on
 * purpose. A 500 whose body is an HTML error page and a 200 whose shape changed are
 * different problems, and reporting both as "empty" sends somebody looking in the wrong
 * place.
 *
 * A path that does not resolve yields an empty string, NOT the text "undefined". The value
 * goes into a variable a later step will compare against; `undefined` reads like a value
 * and would make `{x} == undefined` true for the wrong reason.
 */
export function readJsonPath(body: string, path: string): string {
    let doc: unknown;
    try {
        doc = JSON.parse(body);
    } catch {
        throw new Error('not-json');
    }
    let cur: any = doc;
    for (const seg of String(path || '').split('.').filter(Boolean)) {
        if (cur === null || cur === undefined) return '';
        cur = cur[/^\d+$/.test(seg) ? Number(seg) : seg];
    }
    if (cur === undefined || cur === null) return '';
    // An object or array is stringified rather than rendered as "[object Object]", which is
    // what String() would give and which tells the reader nothing about what came back.
    return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
}

/**
 * Whether a status should stop the step.
 *
 * Non-2xx throws unless the task opted in. Capturing an error page as though it were the
 * answer is the failure worth preventing: a 500 whose body is HTML would otherwise become
 * the value of a variable a later step trusts, and nothing on screen would say why.
 */
export function statusIsFailure(status: number, allowAnyStatus: boolean): boolean {
    if (allowAnyStatus) return false;
    return status < 200 || status >= 300;
}
