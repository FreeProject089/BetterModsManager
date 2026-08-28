// Turning a condition or a script into the one line a person reads in a list.
//
// Split out for the same reason as sched-time.ts and sched-why.ts: scheduler.ts reaches
// Tauri, the DOM and i18n before its first statement runs, so importing it from a test throws
// on `requestAnimationFrame is not defined`. Everything decided here is a pure function of its
// arguments, so it belongs where it can be exercised.
//
// Neither of these translates anything. They return the SUBJECT — which file, which app, the
// first real line of a script — and the caller puts the translated label in front of it. A
// module that called `t()` would drag i18n in and stop being testable, which is the whole
// point of it being here.

/** The shape these need, and no more of a condition than that. */
export interface CondLike {
    type?: string;
    params?: Record<string, unknown>;
    negate?: boolean;
}

/**
 * Which parameter identifies this condition, as text — or '' when none does.
 *
 * Picked GENERICALLY, first match wins, rather than from a table with a case per condition
 * type. Thirty-four types with a case each is thirty-four chances to forget one, and the one
 * forgotten silently goes back to naming only the type — which is the bug this exists to fix
 * ("File exists" is true of the type and useless about the task, which watches ONE file).
 *
 * The order is by how much each answers "which one": a path beats a free-text value.
 */
const SUBJECT_KEYS = ['path', 'app', 'url', 'name', 'id', 'source', 'value', 'text', 'days', 'from'];

export function condSubject(cond: CondLike | undefined, max = 42): string {
    if (!cond?.type) return '';
    const p = cond.params || {};
    for (const k of SUBJECT_KEYS) {
        const v = p[k];
        if (v === undefined || v === null || v === '') continue;
        const str = Array.isArray(v) ? v.join(', ') : String(v);
        if (!str.trim()) continue;
        // A path is identified by its last segment; the rest is where it happens to live,
        // and on Windows that is most of the characters.
        const short = k === 'path' ? (str.replace(/^.*[\\/]/, '') || str) : str;
        return short.length > max ? short.slice(0, max - 1) + '…' : short;
    }
    return '';
}

/** How many sub-conditions an `all` / `any` holds. -1 when it is neither. */
export function condChildCount(cond: CondLike | undefined): number {
    if (cond?.type !== 'all' && cond?.type !== 'any') return -1;
    const list = (cond.params || {}).conditions;
    return Array.isArray(list) ? list.length : 0;
}

/** Line comment markers, by script engine. `cmd` is the odd one: a word, not a symbol. */
const COMMENT: Record<string, string[]> = {
    powershell: ['#'],
    python: ['#'],
    bash: ['#'],
    cmd: ['REM ', '::'],
    node: ['//'],
    rust: ['//'],
};

/**
 * The first line of a script that says something.
 *
 * Comments and blank lines are skipped, because a probe opening with a licence header would
 * otherwise be summarised as its licence. Deliberately not a parser: a `#` inside a string is
 * read as a comment here, and being wrong about that costs one slightly odd summary line and
 * nothing else.
 */
export function scriptFirstLine(code: string, engine = 'powershell', max = 46): string {
    const marks = COMMENT[engine] || ['#', '//'];
    for (const raw of String(code || '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (marks.some((m) => line.toUpperCase().startsWith(m.toUpperCase()))) continue;
        return line.length > max ? line.slice(0, max - 1) + '…' : line;
    }
    return '';
}
