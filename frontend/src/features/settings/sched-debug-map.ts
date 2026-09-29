// Where a debug run is standing, in each of the three editors.
//
// The runner knows a step by its PATH in the task's tree ("2.then.0" — the same path the run
// log records and the flow draws). Each editor shows that step differently: the flow as a node
// whose id IS the path, the blocks as the brick holding that step, the code as the line the
// statement starts on. This file is the translation, and nothing else — pure, so every rule is
// a test (tests/sched-debug-map.test.mjs), and the painting stays in the editors.
//
// How visual each mode gets is decided here too, as data: the flow draws the walk on the canvas
// (current node, breakpoint dots, values on hover), the blocks light the running brick, the
// code highlights the line and puts the breakpoints in a gutter.

import type { EditorMode } from './sched-modes.js';

/** One statement of a BMMScript body: the step it compiles to, and the line it starts on. */
export interface LineRow { path: string; line: number }

/** Where to show a step in one editor. */
export interface DebugTarget {
    mode: EditorMode;
    /** The flow: the node to mark (its id is the step's path). */
    nodeId?: string;
    /** The blocks: the step to light, by path in the draft. */
    path?: string;
    /** The code: the 1-based line to highlight. */
    line?: number;
}

/** What each mode shows while debugging. The panel reads this to say what to expect. */
export const MODE_VISUALS: Readonly<Record<EditorMode, readonly ('node' | 'brick' | 'line' | 'gutter' | 'hover' | 'walk')[]>> = {
    flow: ['node', 'walk', 'hover'],
    bricks: ['brick', 'walk'],
    code: ['line', 'gutter'],
};

/** A path and every path above it, nearest first: "2.then.0" → ["2.then.0", "2"]. */
export function ancestors(path: string): string[] {
    const out: string[] = [];
    const segs = String(path || '').split('.');
    for (let n = segs.length; n > 0; n--) {
        const p = segs.slice(0, n).join('.');
        // A path ends on a step index; "2.then" names a lane, not a step.
        if (/^\d+$/.test(segs[n - 1])) out.push(p);
    }
    return out;
}

/** The line a step starts on. A step the map does not know shows at its nearest known parent. */
export function lineForPath(map: readonly LineRow[], path: string): number | null {
    for (const p of ancestors(path)) {
        const hit = map.find((r) => r.path === p);
        if (hit) return hit.line;
    }
    return null;
}

/**
 * The step a click on this line means: the statement that STARTS there, else the innermost one
 * that started above it (a click on a statement's second line, or on a closing brace, is a
 * click on that statement).
 */
export function pathForLine(map: readonly LineRow[], line: number): string | null {
    const exact = map.filter((r) => r.line === line);
    if (exact.length) return exact.reduce((a, b) => (b.path.split('.').length > a.path.split('.').length ? b : a)).path;
    let best: LineRow | null = null;
    for (const r of map) if (r.line < line && (!best || r.line > best.line || (r.line === best.line && r.path.length > best.path.length))) best = r;
    return best ? best.path : null;
}

/** Where to show the step at `path` in `mode`. Null when the step has no place there. */
export function debugTargetFor(mode: EditorMode, path: string | null | undefined, lineMap: readonly LineRow[] = []): DebugTarget | null {
    if (!path) return null;
    if (mode === 'flow') return { mode, nodeId: path };
    if (mode === 'bricks') return { mode, path };
    const line = lineForPath(lineMap, path);
    return line === null ? null : { mode, line };
}

/**
 * Does the run stop before this step? A breakpoint is a PATH (set on a node, a brick or a
 * gutter line — all three name the same step), or a word from the panel's "run until" box.
 */
export function stopsAt(breaks: ReadonlySet<string>, path: string | null | undefined, labelHit: boolean): boolean {
    return labelHit || (!!path && breaks.has(path));
}

/**
 * The variables a step mentions: every `{name}` in its parameters, and the variable it writes
 * (`target`, `into`, `name` of a var.set). What the flow shows when you hover a node while a run
 * is paused — the values that step is about to read or overwrite, not all forty.
 */
export function varsOfStep(step: any): string[] {
    const out = new Set<string>();
    const visit = (v: unknown): void => {
        if (typeof v === 'string') {
            for (const m of v.matchAll(/\{([A-Za-z_][\w.]*)\}/g)) out.add(m[1]);
        } else if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    if (step?.kind === 'action') {
        const p = step.action?.params || {};
        visit(p);
        for (const k of ['target', 'into', 'var']) if (typeof p[k] === 'string' && p[k].trim()) out.add(p[k].trim());
        if (step.action?.type === 'var.set' && typeof p.name === 'string' && p.name.trim()) out.add(p.name.trim());
    } else if (step && typeof step === 'object') {
        visit(step.condition);
        if (step.condition?.params?.source) out.add(String(step.condition.params.source));
    }
    return [...out].sort();
}

/** One variable a field could use, and where it comes from. */
export interface KnownVar { name: string; from: 'step' | 'event' | 'shared' | 'builtin' | 'result' }

/** The names every run has: the clock, a newline, and what the last step left behind. */
export const BUILTIN_VARS: readonly string[] = ['date', 'time', 'now', 'stamp', 'nl', 'tab', 'task.name', 'task.id'];
export const RESULT_VARS: readonly string[] = ['last.ok', 'last.ms', 'last.out', 'http.status', 'http.body'];

/** What each trigger hands the run as `{event.*}`. */
const EVENT_VARS: Record<string, string[]> = {
    rss: ['event.title', 'event.link', 'event.id', 'event.published', 'event.count', 'event.feed'],
    afterTask: ['event.id', 'event.name', 'event.ok', 'event.ms', 'event.result'],
    script: ['event.stdout', 'event.exitCode'],
    onEvent: [],
};

/**
 * Every variable a field in this task could name, for the variable picker: what the steps
 * write (var.set, `into`, `target`, list/map names), what the trigger hands over, the shared
 * store, the built-ins and the results a step leaves. Sorted and de-duplicated — a picker that
 * offers `count` twice offers two things that are one.
 */
export function variablesOf(steps: readonly any[], trigger: any, shared: readonly string[] = []): KnownVar[] {
    const seen = new Map<string, KnownVar['from']>();
    const add = (name: string, from: KnownVar['from']) => {
        const n = String(name || '').trim();
        if (/^[A-Za-z_][\w.]*$/.test(n) && !seen.has(n)) seen.set(n, from);
    };
    const walk = (list: readonly any[]): void => {
        for (const st of list || []) {
            if (!st || typeof st !== 'object') continue;
            if (st.kind === 'action') {
                const p = st.action?.params || {};
                if (st.action?.type === 'var.set' || st.action?.type === 'math.set' || st.action?.type === 'var.ternary') add(p.name || p.target, 'step');
                for (const k of ['into', 'target']) if (typeof p[k] === 'string') add(p[k], 'step');
            }
            for (const k of ['then', 'else', 'steps', 'onError', 'default']) if (Array.isArray(st[k])) walk(st[k]);
            if (Array.isArray(st.cases)) for (const c of st.cases) walk(c?.steps || []);
            if (Array.isArray(st.branches)) for (const b of st.branches) walk(b || []);
            if (st.kind === 'forEach') { add('item.id', 'step'); add('item.name', 'step'); }
        }
    };
    walk(steps || []);
    for (const n of EVENT_VARS[String(trigger?.type || '')] || []) add(n, 'event');
    for (const n of shared) add(n, 'shared');
    for (const n of RESULT_VARS) add(n, 'result');
    for (const n of BUILTIN_VARS) add(n, 'builtin');
    return [...seen].map(([name, from]) => ({ name, from })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Insert `{name}` at the caret of a text value. Returns the new value and where the caret goes,
 * so the DOM half only has to assign them.
 */
export function insertVar(value: string, start: number, end: number, name: string): { value: string; caret: number } {
    const token = `{${name}}`;
    const a = Math.max(0, Math.min(start, value.length));
    const b = Math.max(a, Math.min(end, value.length));
    return { value: value.slice(0, a) + token + value.slice(b), caret: a + token.length };
}
