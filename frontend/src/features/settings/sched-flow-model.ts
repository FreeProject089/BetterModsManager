// The flow view of a scheduled task — the pure half.
//
// The scheduler's third editing mode draws a task as a graph: a trigger node, one node per step,
// lanes for every body a step carries (THEN / ELSE, a loop's body, each CASE, each parallel
// BRANCH, TRY / ON ERROR), and a join where the lanes meet again. It is a VIEW of `task.steps`,
// not a second model: nothing here owns a list of nodes. The graph is rebuilt from the step
// tree every time it is drawn, so the blocks, the code and the flow cannot disagree — there is
// only ever one tree.
//
// The only thing the flow adds to a task is where the person dragged a node. That is kept in
// `task.layout` as an OFFSET from the automatic position, keyed by the step's path in the tree
// and stamped with what the step was (its kind and action type). An offset rather than an
// absolute position, so inserting a step still pushes everything after it along; a stamp, so an
// edit made in the other two modes that moves a different step onto that path does not inherit
// somebody else's nudge. The executor never reads `layout`.
//
// Pure on purpose (no DOM, no Tauri, no i18n), like sched-preview.ts and sched-summary.ts: every
// rule here is a test in tests/sched-flow.test.mjs.

/** A step, as far as this module needs to know one. Structurally the scheduler's `Step`. */
export type AnyStep = { kind: string; [k: string]: any; disabled?: boolean; collapsed?: boolean };

/** Where the person moved nodes: path → [dx, dy, stamp]. Absent on a task never arranged by hand. */
export interface FlowLayout { v: 1; nudge: Record<string, [number, number, string]> }

// ── Geometry ────────────────────────────────────────────────────────────────────────────────
export const NODE_W = 232;
export const NODE_H = 58;
export const GAP_X = 64;
export const GAP_Y = 30;
export const GRID = 8;
export const JOIN_D = 12;
export const ADD_D = 30;

export type NodeType = 'trigger' | 'step' | 'join' | 'add';
export type LaneTag = 'then' | 'else' | 'body' | 'fix' | 'try' | 'catch' | 'case' | 'default' | 'branch';

export interface FlowNode {
    id: string;
    type: NodeType;
    /** For a step: its path in the tree ("2", "2.then.0", "3.cases.1.steps.0", "4.branches.1.0"). */
    path?: string;
    /** For an add node: the body it adds to, and at which index. */
    slot?: string;
    index?: number;
    kind?: string;
    x: number; y: number; w: number; h: number;
    /** The automatic position, before any nudge. */
    ax: number; ay: number;
}

export interface FlowEdge {
    id: string;
    from: string;
    to: string;
    kind: 'seq' | 'lane' | 'join' | 'loop' | 'bypass';
    lane?: LaneTag;
    /** 1-based number of a CASE or BRANCH lane. */
    n?: number;
    /** A "+" on this edge inserts into `slot` at `index`. */
    insert?: { slot: string; index: number };
    /** For loop / bypass edges: the y of the horizontal run, below or above the block. */
    via?: number;
}

export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[]; order: string[]; width: number; height: number }

// ── Paths ───────────────────────────────────────────────────────────────────────────────────

/** The bodies a step carries, in the order the editor shows them. Empty for a leaf. */
export function lanesOf(step: AnyStep, path: string): { slot: string; tag: LaneTag; n?: number; loop?: boolean }[] {
    const p = (k: string) => (path ? `${path}.${k}` : k);
    switch (step.kind) {
        case 'if': return [{ slot: p('then'), tag: 'then' }, { slot: p('else'), tag: 'else' }];
        case 'repeat': case 'forEach': case 'retry': return [{ slot: p('steps'), tag: 'body', loop: true }];
        case 'ensure': return [{ slot: p('steps'), tag: 'fix' }];
        case 'try': return [{ slot: p('steps'), tag: 'try' }, { slot: p('onError'), tag: 'catch' }];
        case 'switch': return [
            ...(Array.isArray(step.cases) ? step.cases : []).map((_c: any, i: number) => ({ slot: p(`cases.${i}.steps`), tag: 'case' as LaneTag, n: i + 1 })),
            { slot: p('default'), tag: 'default' },
        ];
        case 'parallel': return (Array.isArray(step.branches) ? step.branches : []).map((_b: any, i: number) => ({ slot: p(`branches.${i}`), tag: 'branch' as LaneTag, n: i + 1 }));
        default: return [];
    }
}

/** Follow a path from the root step list. `''` is the root list itself. */
export function resolve(root: AnyStep[], path: string): any {
    if (path === '') return root;
    let cur: any = root;
    for (const seg of path.split('.')) {
        if (cur == null) return undefined;
        cur = cur[/^\d+$/.test(seg) ? Number(seg) : seg];
    }
    return cur;
}

/** The body a step sits in, and its index there. */
export function slotOf(path: string): { slot: string; index: number } {
    const i = path.lastIndexOf('.');
    return i < 0 ? { slot: '', index: Number(path) } : { slot: path.slice(0, i), index: Number(path.slice(i + 1)) };
}

/** The path of a step object inside the tree, by identity. */
export function findPath(root: AnyStep[], target: AnyStep): string | null {
    let found: string | null = null;
    walkSteps(root, (st, path) => { if (found === null && st === target) found = path; });
    return found;
}

/** Every step in the tree, depth first, with its path. `visit` returning false skips its bodies. */
export function walkSteps(root: AnyStep[], visit: (st: AnyStep, path: string) => boolean | void, base = ''): void {
    (root || []).forEach((st, i) => {
        if (!st || typeof st !== 'object') return;
        const path = base ? `${base}.${i}` : String(i);
        if (visit(st, path) === false) return;
        for (const lane of lanesOf(st, path)) walkSteps(laneArray(st, lane.slot.slice(path.length + 1)), visit, lane.slot);
    });
}

/** Every body a step carries (THEN and ELSE, each case, each branch…). */
export function bodiesOf(step: AnyStep): AnyStep[][] {
    return lanesOf(step, '_').map((l) => laneArray(step, l.slot.slice(2)));
}

/** How many steps sit inside a step, at any depth. */
export function countInside(step: AnyStep): number {
    let n = 0;
    for (const body of bodiesOf(step)) walkSteps(body, () => { n++; });
    return n;
}

/** A body of `step` named by the part of the path after the step (`then`, `cases.1.steps`, `branches.0`). */
function laneArray(step: AnyStep, rel: string): AnyStep[] {
    let cur: any = step;
    for (const seg of rel.split('.')) cur = cur?.[/^\d+$/.test(seg) ? Number(seg) : seg];
    return Array.isArray(cur) ? cur : [];
}

/** What a step is, for the layout stamp: an offset only applies to the step it was made on. */
export function stampOf(step: AnyStep | undefined): string {
    if (!step) return '';
    return step.kind === 'action' ? `action:${String(step.action?.type || '')}` : step.kind;
}

// ── Layout ──────────────────────────────────────────────────────────────────────────────────

/**
 * The graph of a task: nodes with positions, edges, and the reading order used by the arrow keys.
 *
 * Left to right, like n8n: the trigger, then each step; a step with bodies opens its lanes to the
 * right, stacked, and a join closes them before the next step. Deterministic — the same tree
 * always gives the same picture — which is what "auto-layout" means here: drop every nudge and
 * this is where things go.
 */
export function buildGraph(steps: AnyStep[], layout?: FlowLayout | null): FlowGraph {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const order: string[] = ['trigger'];
    let eid = 0;
    const edge = (e: Omit<FlowEdge, 'id'>) => { edges.push({ id: `e${eid++}`, ...e }); };
    const node = (n: Omit<FlowNode, 'ax' | 'ay'>) => { const full = { ...n, ax: n.x, ay: n.y }; nodes.push(full); return full; };

    node({ id: 'trigger', type: 'trigger', x: 0, y: 0, w: NODE_W, h: NODE_H });

    /** Lay out one body. Returns its first and last node ids and its size. */
    const seq = (slot: string, list: AnyStep[], x: number, y: number, trailingAdd: boolean): { first: string; last: string; w: number; h: number; empty: boolean } => {
        if (!list.length) {
            const id = `${slot || 'root'}#add`;
            node({ id, type: 'add', slot, index: 0, x, y: y + (NODE_H - ADD_D) / 2, w: ADD_D, h: ADD_D });
            return { first: id, last: id, w: ADD_D, h: NODE_H, empty: true };
        }
        let cx = x;
        let h = NODE_H;
        let first = '';
        let prevExit = '';
        list.forEach((st, i) => {
            const path = slot ? `${slot}.${i}` : String(i);
            const b = block(st, path, cx, y);
            if (!first) first = b.entry;
            if (prevExit) edge({ from: prevExit, to: b.entry, kind: 'seq', insert: { slot, index: i } });
            prevExit = b.exit;
            cx += b.w + GAP_X;
            h = Math.max(h, b.h);
        });
        let w = cx - GAP_X - x;
        if (trailingAdd) {
            const id = `${slot || 'root'}#end`;
            node({ id, type: 'add', slot, index: list.length, x: cx, y: y + (NODE_H - ADD_D) / 2, w: ADD_D, h: ADD_D });
            edge({ from: prevExit, to: id, kind: 'seq' });
            w = cx + ADD_D - x;
            return { first, last: id, w, h, empty: false };
        }
        return { first, last: prevExit, w, h, empty: false };
    };

    const block = (st: AnyStep, path: string, x: number, y: number): { entry: string; exit: string; w: number; h: number } => {
        node({ id: path, type: 'step', path, kind: st.kind, x, y, w: NODE_W, h: NODE_H });
        order.push(path);
        const lanes = st.collapsed ? [] : lanesOf(st, path);
        if (!lanes.length) return { entry: path, exit: path, w: NODE_W, h: NODE_H };
        const lx = x + NODE_W + GAP_X;
        let ly = y;
        const done: { slot: string; last: string; empty: boolean; len: number; tag: LaneTag; n?: number; loop?: boolean }[] = [];
        let laneW = 0;
        for (const lane of lanes) {
            const list = laneArray(st, lane.slot.slice(path.length + 1));
            const r = seq(lane.slot, list, lx, ly, false);
            edge({ from: path, to: r.first, kind: 'lane', lane: lane.tag, n: lane.n, insert: r.empty ? undefined : { slot: lane.slot, index: 0 } });
            done.push({ slot: lane.slot, last: r.last, empty: r.empty, len: list.length, tag: lane.tag, n: lane.n, loop: lane.loop });
            laneW = Math.max(laneW, r.w);
            ly += r.h + GAP_Y;
        }
        const h = Math.max(NODE_H, ly - GAP_Y - y);
        const jx = lx + laneW + GAP_X / 2;
        const joinId = `${path}#join`;
        node({ id: joinId, type: 'join', path, x: jx, y: y + (NODE_H - JOIN_D) / 2, w: JOIN_D, h: JOIN_D });
        for (const d of done) edge({ from: d.last, to: joinId, kind: 'join', lane: d.tag, insert: d.empty ? undefined : { slot: d.slot, index: d.len } });
        // A loop goes back round: drawn under the whole block, from the join to the step.
        if (lanes.some((l) => l.loop)) edge({ from: joinId, to: path, kind: 'loop', via: y + h + GAP_Y / 2 });
        // `ensure` does nothing when the condition already holds: a bypass over the top.
        if (st.kind === 'ensure') edge({ from: path, to: joinId, kind: 'bypass', via: y - GAP_Y / 2 });
        const w = jx + JOIN_D - x;
        return { entry: path, exit: joinId, w, h: h + (lanes.some((l) => l.loop) ? GAP_Y : 0) };
    };

    const root = seq('', steps || [], NODE_W + GAP_X, 0, true);
    edge({ from: 'trigger', to: root.first, kind: 'seq', insert: root.empty ? undefined : { slot: '', index: 0 } });

    // Nudges, where the stamp still matches the step on that path.
    if (layout && layout.nudge) {
        for (const n of nodes) {
            if (n.type !== 'step' && n.type !== 'trigger') continue;
            const key = n.type === 'trigger' ? 'trigger' : n.path!;
            const nd = layout.nudge[key];
            if (!nd) continue;
            const want = n.type === 'trigger' ? 'trigger' : stampOf(resolve(steps, n.path!));
            if (nd[2] !== want) continue;
            n.x += nd[0];
            n.y += nd[1];
        }
    }
    let width = 0;
    let height = 0;
    for (const n of nodes) { width = Math.max(width, n.x + n.w); height = Math.max(height, n.y + n.h); }
    for (const e of edges) if (e.via !== undefined) height = Math.max(height, e.via + 4);
    return { nodes, edges, order, width, height };
}

/** Snap to the grid the canvas draws. */
export const snap = (v: number): number => Math.round(v / GRID) * GRID;

/** Record where a node was dropped, as an offset from its automatic place. Zero removes it. */
export function setNudge(layout: FlowLayout | undefined | null, key: string, dx: number, dy: number, stamp: string): FlowLayout {
    const out: FlowLayout = { v: 1, nudge: { ...(layout?.nudge || {}) } };
    if (!dx && !dy) delete out.nudge[key];
    else out.nudge[key] = [dx, dy, stamp];
    return out;
}

/**
 * Keep only the nudges that still describe a step on their path. Returns undefined when nothing
 * is left, so a task never arranged by hand is saved without a `layout` field at all — byte for
 * byte what the other two modes would have saved.
 */
export function pruneLayout(steps: AnyStep[], layout: FlowLayout | undefined | null): FlowLayout | undefined {
    if (!layout || !layout.nudge) return undefined;
    const keep: FlowLayout['nudge'] = {};
    for (const [k, v] of Object.entries(layout.nudge)) {
        if (!Array.isArray(v) || v.length !== 3) continue;
        const want = k === 'trigger' ? 'trigger' : stampOf(resolve(steps, k));
        if (want && v[2] === want && (v[0] || v[1])) keep[k] = [Number(v[0]) || 0, Number(v[1]) || 0, v[2]];
    }
    return Object.keys(keep).length ? { v: 1, nudge: keep } : undefined;
}

/** Re-key the nudges of one body after `delta` steps were inserted (+) or removed (−) at `from`. */
export function shiftNudges(layout: FlowLayout | undefined | null, slot: string, from: number, delta: number): FlowLayout | undefined {
    if (!layout || !layout.nudge) return layout || undefined;
    const prefix = slot ? `${slot}.` : '';
    const out: FlowLayout['nudge'] = {};
    for (const [k, v] of Object.entries(layout.nudge)) {
        if (k === 'trigger' || !k.startsWith(prefix)) { out[k] = v; continue; }
        const rest = k.slice(prefix.length);
        const seg = rest.split('.')[0];
        if (!/^\d+$/.test(seg) || Number(seg) < from) { out[k] = v; continue; }
        const moved = Number(seg) + delta;
        if (moved < 0) continue;
        out[prefix + moved + rest.slice(seg.length)] = v;
    }
    return { v: 1, nudge: out };
}

/** Drop the nudges of a step and everything inside it. */
export function dropNudges(layout: FlowLayout | undefined | null, path: string): FlowLayout | undefined {
    if (!layout || !layout.nudge) return layout || undefined;
    const out: FlowLayout['nudge'] = {};
    for (const [k, v] of Object.entries(layout.nudge)) if (k !== path && !k.startsWith(path + '.')) out[k] = v;
    return { v: 1, nudge: out };
}

/** A step for what was picked in the node palette: a control kind (`if`, `repeat`…) or an
 *  action (`action:<type>`). `make` is the scheduler's own default-step factory. */
export function paletteStep(v: string, make: (kind: string) => AnyStep): AnyStep {
    if (v.startsWith('action:')) {
        const st = make('action');
        st.action = { type: v.slice(7), params: {} };
        return st;
    }
    return make(v);
}

// ── Edits ───────────────────────────────────────────────────────────────────────────────────
// Each returns the new layout; the step tree is edited in place, the way every other editor of
// the draft does it (the undo stack snapshots the whole draft before).

export function insertStep(root: AnyStep[], layout: FlowLayout | undefined, slot: string, index: number, step: AnyStep): { path: string; layout: FlowLayout | undefined } {
    const arr = resolve(root, slot);
    if (!Array.isArray(arr)) throw new Error(`no body at ${slot || 'root'}`);
    const at = Math.max(0, Math.min(arr.length, index));
    arr.splice(at, 0, step);
    return { path: slot ? `${slot}.${at}` : String(at), layout: shiftNudges(layout, slot, at, +1) };
}

export function removeStep(root: AnyStep[], layout: FlowLayout | undefined, path: string): FlowLayout | undefined {
    const { slot, index } = slotOf(path);
    const arr = resolve(root, slot);
    if (!Array.isArray(arr) || index < 0 || index >= arr.length) return layout;
    arr.splice(index, 1);
    return shiftNudges(dropNudges(layout, path), slot, index + 1, -1);
}

/** Remove several steps, found by identity so removing one cannot shift the path of the next. */
export function removeSteps(root: AnyStep[], layout: FlowLayout | undefined, targets: AnyStep[]): FlowLayout | undefined {
    let out = layout;
    for (const st of targets) {
        const p = findPath(root, st);
        if (p !== null) out = removeStep(root, out, p);
    }
    return out;
}

export function duplicateStep(root: AnyStep[], layout: FlowLayout | undefined, path: string): { path: string; layout: FlowLayout | undefined } {
    const st = resolve(root, path);
    const { slot, index } = slotOf(path);
    return insertStep(root, layout, slot, index + 1, JSON.parse(JSON.stringify(st)));
}

/** Swap a step with its neighbour in the same body (`dir` −1 earlier, +1 later). */
export function moveStep(root: AnyStep[], layout: FlowLayout | undefined, path: string, dir: -1 | 1): { path: string; layout: FlowLayout | undefined } | null {
    const { slot, index } = slotOf(path);
    const arr = resolve(root, slot);
    const to = index + dir;
    if (!Array.isArray(arr) || to < 0 || to >= arr.length) return null;
    [arr[index], arr[to]] = [arr[to], arr[index]];
    const a = slot ? `${slot}.${index}` : String(index);
    const b = slot ? `${slot}.${to}` : String(to);
    // The nudges travel with their steps: swap the two subtrees' keys.
    let out = layout;
    if (out && out.nudge) {
        const next: FlowLayout['nudge'] = {};
        for (const [k, v] of Object.entries(out.nudge)) {
            if (k === a || k.startsWith(a + '.')) next[b + k.slice(a.length)] = v;
            else if (k === b || k.startsWith(b + '.')) next[a + k.slice(b.length)] = v;
            else next[k] = v;
        }
        out = { v: 1, nudge: next };
    }
    return { path: b, layout: out };
}

// ── Keyboard ────────────────────────────────────────────────────────────────────────────────

/** The node the arrow keys reach from `id`: Left/Right along the reading order, Up/Down across lanes. */
export function neighbour(g: FlowGraph, id: string, dir: 'left' | 'right' | 'up' | 'down'): string | null {
    const i = g.order.indexOf(id);
    if (dir === 'right') return i < 0 ? g.order[0] || null : g.order[i + 1] || null;
    if (dir === 'left') return i <= 0 ? null : g.order[i - 1];
    const cur = g.nodes.find((n) => n.id === id);
    if (!cur) return g.order[0] || null;
    const cx = cur.x + cur.w / 2;
    const cy = cur.y + cur.h / 2;
    let best: string | null = null;
    let score = Infinity;
    for (const n of g.nodes) {
        if (n.id === id || (n.type !== 'step' && n.type !== 'trigger')) continue;
        const dy = n.y + n.h / 2 - cy;
        if (dir === 'down' ? dy <= 4 : dy >= -4) continue;
        const s = Math.abs(dy) + 0.6 * Math.abs(n.x + n.w / 2 - cx);
        if (s < score) { score = s; best = n.id; }
    }
    return best;
}

// ── Last run ────────────────────────────────────────────────────────────────────────────────

export type RunMark = 'ok' | 'error' | 'stopped' | 'cancelled' | 'skipped';

/**
 * The executor records each action's path (scheduler.ts runTask → sched-runlog startStep). Every
 * ACTION the run reached is in the record; one that is not was skipped. A record written before
 * paths were recorded says nothing, and neither does this.
 */
export function actionPaths(steps: AnyStep[]): [any, string][] {
    const out: [any, string][] = [];
    walkSteps(steps, (st, path) => { if (st.kind === 'action' && st.action && typeof st.action === 'object') out.push([st.action, path]); });
    return out;
}

const RANK: Record<string, number> = { ok: 1, cancelled: 2, stopped: 3, error: 4 };

export function runMarks(steps: AnyStep[], record: { steps?: { path?: string; status?: string; error?: string }[] } | null | undefined): Map<string, { mark: RunMark; error?: string }> {
    const out = new Map<string, { mark: RunMark; error?: string }>();
    const rows = (record?.steps || []).filter((s) => typeof s.path === 'string' && s.path);
    if (!rows.length) return out;
    for (const r of rows) {
        const prev = out.get(r.path!);
        const mark = (['ok', 'error', 'stopped', 'cancelled'].includes(String(r.status)) ? r.status : 'ok') as RunMark;
        if (!prev || (RANK[mark] || 0) >= (RANK[prev.mark] || 0)) out.set(r.path!, { mark, error: r.error || prev?.error });
    }
    // Actions not reached are skipped; a container takes the worst of what ran inside it.
    const containers: string[] = [];
    walkSteps(steps, (st, path) => {
        if (st.kind === 'action' && !out.has(path)) out.set(path, { mark: 'skipped' });
        if (lanesOf(st, path).length) containers.push(path);
    });
    for (const c of containers.reverse()) {
        let worst: { mark: RunMark; error?: string } | null = null;
        for (const [p, m] of out) {
            if (!p.startsWith(c + '.') || m.mark === 'skipped') continue;
            if (!worst || (RANK[m.mark] || 0) > (RANK[worst.mark] || 0)) worst = m;
        }
        out.set(c, worst ? { mark: worst.mark, error: worst.error } : { mark: 'skipped' });
    }
    return out;
}

/**
 * The last run's marks, on the steps being EDITED.
 *
 * The record's paths describe the task as it was saved when it ran. The draft moves on: a step
 * inserted in front shifts every path after it, and marking by path would then put the failure
 * of step 3 on the step now at 3 — a different step, reported as broken. So a mark follows the
 * step's CONTENT: each saved action lends its mark to the draft action that is still exactly the
 * same (same kind, same type, same parameters), in order when several are identical. An action
 * edited since carries no mark, which is true: it has not run like that. Blocks take the worst of
 * what is marked inside them, in the draft's own tree.
 */
export function marksForDraft(saved: AnyStep[] | null | undefined, record: Parameters<typeof runMarks>[1], draft: AnyStep[]): Map<string, { mark: RunMark; error?: string }> {
    const out = new Map<string, { mark: RunMark; error?: string }>();
    if (!saved || !record) return out;
    const byPath = runMarks(saved, record);
    if (!byPath.size) return out;
    const pool = new Map<string, { mark: RunMark; error?: string }[]>();
    walkSteps(saved, (st, path) => {
        if (st.kind !== 'action') return;
        const m = byPath.get(path);
        if (!m) return;
        const key = JSON.stringify(st);
        (pool.get(key) || pool.set(key, []).get(key)!).push(m);
    });
    const containers: string[] = [];
    walkSteps(draft, (st, path) => {
        if (st.kind === 'action') {
            const m = pool.get(JSON.stringify(st))?.shift();
            if (m) out.set(path, m);
        }
        if (lanesOf(st, path).length) containers.push(path);
    });
    for (const c of containers.reverse()) {
        let worst: { mark: RunMark; error?: string } | null = null;
        let any = false;
        for (const [p, m] of out) {
            if (!p.startsWith(c + '.')) continue;
            any = true;
            if (m.mark === 'skipped') continue;
            if (!worst || (RANK[m.mark] || 0) > (RANK[worst.mark] || 0)) worst = m;
        }
        if (any) out.set(c, worst ? { mark: worst.mark, error: worst.error } : { mark: 'skipped' });
    }
    return out;
}

// ── Permissions ─────────────────────────────────────────────────────────────────────────────
//
// What a step will be REFUSED at run time without. This table is a mirror of the executor, not a
// second authority: every entry is one `requirePerm(task, …)` / `needPerm(…)` call in
// scheduler.ts, with the same key and the same message, and tests/sched-flow.test.mjs reads
// runAction and evalConditionRaw to prove the two lists are the same list. The executor still
// decides; this only lets the flow say so before the run does.

export type PermKey = 'command' | 'script' | 'deeplink' | 'stopProcess' | 'delete' | 'resources' | 'tasks' | 'network';
interface PermRule { perm: PermKey; label: string; when?: (p: Record<string, any>) => boolean }

const DL: PermRule = { perm: 'deeplink', label: 'sched.permDeeplink' };
const DEL: PermRule = { perm: 'delete', label: 'sched.permDelete' };
const RES: PermRule = { perm: 'resources', label: 'sched.permResources' };
const TASKS: PermRule = { perm: 'tasks', label: 'sched.permTasks' };
const NET: PermRule = { perm: 'network', label: 'sched.permNetwork' };

export const ACTION_PERMS: Record<string, PermRule> = {
    'app.stop': { perm: 'stopProcess', label: 'sched.permStopProcess' },
    'custom.command': { perm: 'command', label: 'sched.permRunCommand' },
    'custom.script': { perm: 'script', label: 'sched.permRunScript' },
    'http.request': { perm: 'command', label: 'sched.permHttp' },
    'resources.preset': RES, 'resources.gameMode': RES, 'resources.queue': RES,
    // Only its `run` mode executes the asset.
    'plugin.asset': { perm: 'script', label: 'sched.permRunScript', when: (p) => String(p.mode || 'read') === 'run' },
    // Only a .bmmbundle is followed (a catalogue); every other kind is imported locally.
    'import.file': { ...DL, when: (p) => String(p.kind || 'auto') === 'bundle' || (String(p.kind || 'auto') === 'auto' && /\.bmmbundle(?:[?#].*)?$/i.test(String(p.path || p.url || '').trim())) },
    'catalog.follow': DL, 'catalog.import': DL, 'catalog.entry': DL,
    'catalog.delete': DEL, 'profile.delete': DEL, 'mod.remove': DEL, 'modpack.delete': DEL,
    'task.setEnabled': TASKS, 'task.spawn': TASKS,
    // Without an id it does nothing at all, and asks for nothing.
    'task.run': { ...TASKS, when: (p) => !!p.id },
    // Every action that acts through a bmm:// link it builds (the runner's `dl()` helper).
    'modpack.create': DL, 'mod.add': DL, 'modlist.export': DL, 'modlist.import': DL, 'plugin.apply': DL,
    'plugin.compare': DL, 'mods.checkUpdates': DL, 'repo.connect': DL, 'repo.sync': DL, 'view.open': DL,
    'repo.gen': DL, 'repo.update': DL, 'repo.host': DL, 'app.install': DL, 'telemetry.consent': DL,
    'telemetry.set': DL, 'recorder.set': DL, 'replay.export': DL, 'replay.import': DL, 'discord.rpc': DL,
    'data.exportAuto': DL, 'restart': DL,
    // The notification steps reach the network (sched_net.rs holds the address rules).
    'webhook.send': NET, 'discord.send': NET, 'slack.send': NET,
};

export const CONDITION_PERMS: Record<string, PermRule> = {
    commandSucceeds: { perm: 'command', label: 'sched.perm.command' },
    catalogOk: { perm: 'command', label: 'sched.perm.net' },
    repoOk: { perm: 'command', label: 'sched.perm.net' },
};

export interface PermNeed { path: string; perm: PermKey; label: string; what: string }

function condNeeds(cond: any, path: string, out: PermNeed[]): void {
    if (!cond || typeof cond !== 'object') return;
    const r = CONDITION_PERMS[String(cond.type)];
    if (r) out.push({ path, perm: r.perm, label: r.label, what: `cond:${cond.type}` });
    if ((cond.type === 'all' || cond.type === 'any') && Array.isArray(cond.params?.conditions)) {
        for (const c of cond.params.conditions) condNeeds(c, path, out);
    }
}

/** Every permission the steps (and the trigger) will ask for when they run. Disabled steps ask for nothing. */
export function permNeeds(steps: AnyStep[], trigger?: any): PermNeed[] {
    const out: PermNeed[] = [];
    if (trigger?.type === 'script') out.push({ path: 'trigger', perm: 'script', label: 'sched.permRunScript', what: 'trigger:script' });
    if (trigger?.type === 'condition') condNeeds(trigger.condition, 'trigger', out);
    if (trigger?.type === 'rss') out.push({ path: 'trigger', perm: 'network', label: 'sched.permNetwork', what: 'trigger:rss' });
    walkSteps(steps, (st, path) => {
        if (st.disabled) return false;
        if (st.kind === 'action') {
            const type = String(st.action?.type || '');
            const r = ACTION_PERMS[type];
            if (r && (!r.when || r.when(st.action?.params || {}))) out.push({ path, perm: r.perm, label: r.label, what: type });
        }
        if (st.condition) condNeeds(st.condition, path, out);
        if (st.kind === 'switch') for (const c of st.cases || []) condNeeds(c?.condition, path, out);
        return true;
    });
    return out;
}

/** The needs the task has not been granted — decided by the scheduler's own `hasPerm`, passed in. */
export function missingPerms(task: { steps: AnyStep[]; trigger?: any }, has: (key: PermKey) => boolean): PermNeed[] {
    return permNeeds(task.steps || [], task.trigger).filter((n) => !has(n.perm));
}
