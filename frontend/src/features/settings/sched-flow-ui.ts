// The presentation block of a task — the pure half.
//
// `task.ui` is everything about a task that is only about how it LOOKS and where it is FILED:
// the flow editor's comment frames and reroute points, and the automation list's folder and
// tags. Versioned (`v: 1`), optional, and never read by the executor: a task without it runs
// exactly as before, and a task opened by an older BMM keeps it untouched (schedules.json is
// stored as plain JSON, unknown fields included).
//
// Hand-placed node positions are NOT here: they predate this block and live in `task.layout`
// (sched-flow-model.ts), keyed by step path with a stamp. Old automations, with neither,
// open laid out automatically — the flow has always drawn a task with no layout that way.
//
// Pure on purpose (no DOM, no i18n), like sched-flow-model.ts: tests/sched-flow-ui.test.mjs.

/** A colour for a frame, named by role so every theme paints it with its own tokens. */
export type Tone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
export const TONES: readonly Tone[] = ['accent', 'info', 'success', 'warning', 'danger', 'neutral'];

/** A titled, coloured box drawn behind nodes. Nodes whose centre is inside move with it. */
export interface FlowFrame {
    id: string;
    title: string;
    tone: Tone;
    x: number; y: number; w: number; h: number;
    /** Folded to its title bar: the nodes inside are hidden, their wires end on the bar. */
    collapsed?: boolean;
}

export interface FlowUi {
    v: 1;
    frames?: FlowFrame[];
    /** Waypoints a wire is bent through, by wire key (`from>to`, see edgeKey), in world units. */
    reroutes?: Record<string, [number, number][]>;
    /** The list's folder, one level, free text. */
    folder?: string;
    /** The list's tags. */
    tags?: string[];
}

export const FRAME_PAD = 24;
export const FRAME_HEAD = 30;
const MAX_FRAMES = 64;
const MAX_POINTS = 12;

const num = (v: unknown, lo = -1e6, hi = 1e6): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : 0;
};
const text = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

/**
 * The block as it may be stored: every field checked, junk dropped, `undefined` when nothing is
 * left — so a task that never used any of it saves without a `ui` field at all.
 */
export function normalizeUi(raw: unknown): FlowUi | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, any>;
    const out: FlowUi = { v: 1 };
    if (Array.isArray(r.frames)) {
        const frames: FlowFrame[] = [];
        const seen = new Set<string>();
        for (const f of r.frames.slice(0, MAX_FRAMES)) {
            if (!f || typeof f !== 'object') continue;
            const id = text(f.id, 40) || `f${frames.length + 1}`;
            if (seen.has(id)) continue;
            seen.add(id);
            frames.push({
                id,
                title: text(f.title, 80),
                tone: (TONES as readonly string[]).includes(f.tone) ? f.tone : 'neutral',
                x: num(f.x), y: num(f.y), w: num(f.w, 80, 20000), h: num(f.h, FRAME_HEAD, 20000),
                ...(f.collapsed === true ? { collapsed: true } : {}),
            });
        }
        if (frames.length) out.frames = frames;
    }
    if (r.reroutes && typeof r.reroutes === 'object') {
        const rr: Record<string, [number, number][]> = {};
        for (const [k, pts] of Object.entries(r.reroutes as Record<string, unknown>)) {
            if (!/^[\w.#:-]{1,120}>[\w.#:-]{1,120}$/.test(k) || !Array.isArray(pts)) continue;
            const clean = pts.slice(0, MAX_POINTS).filter((p) => Array.isArray(p) && p.length === 2).map((p) => [num(p[0]), num(p[1])] as [number, number]);
            if (clean.length) rr[k] = clean;
        }
        if (Object.keys(rr).length) out.reroutes = rr;
    }
    const folder = text(r.folder, 60);
    if (folder) out.folder = folder;
    if (Array.isArray(r.tags)) {
        const tags = [...new Set(r.tags.map((x: unknown) => text(x, 24).toLowerCase()).filter(Boolean))].slice(0, 8) as string[];
        if (tags.length) out.tags = tags;
    }
    return out.frames || out.reroutes || out.folder || out.tags ? out : undefined;
}

/** Drop the reroutes of wires that no longer exist (a step removed, a lane folded away). */
export function pruneReroutes(ui: FlowUi | undefined, keys: Set<string>): FlowUi | undefined {
    if (!ui?.reroutes) return ui;
    const rr: Record<string, [number, number][]> = {};
    for (const [k, v] of Object.entries(ui.reroutes)) if (keys.has(k)) rr[k] = v;
    const next: FlowUi = { ...ui };
    if (Object.keys(rr).length) next.reroutes = rr; else delete next.reroutes;
    return normalizeUi(next);
}

/** The stable name of a wire: the two ends. A path shifts when a step is inserted before it,
 *  and the reroute is then dropped on save rather than bending some other wire. */
export function edgeKey(e: { from: string; to: string }): string {
    return `${e.from}>${e.to}`;
}

export interface Box { id: string; x: number; y: number; w: number; h: number }

/** A frame around these boxes, with room for its title bar. */
export function frameAround(boxes: Box[], id: string, title: string, tone: Tone = 'accent'): FlowFrame {
    if (!boxes.length) return { id, title, tone, x: 0, y: 0, w: 320, h: 160 };
    const x0 = Math.min(...boxes.map((b) => b.x)) - FRAME_PAD;
    const y0 = Math.min(...boxes.map((b) => b.y)) - FRAME_PAD - FRAME_HEAD;
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + FRAME_PAD;
    const y1 = Math.max(...boxes.map((b) => b.y + b.h)) + FRAME_PAD;
    return { id, title, tone, x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

/** The boxes a frame holds: their centre is inside it. Decided when a drag STARTS, so a node
 *  dragged out of a frame is not pulled back by the next move. */
export function insideFrame(f: FlowFrame, boxes: Box[]): string[] {
    return boxes.filter((b) => {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h;
    }).map((b) => b.id);
}

/** Every box hidden by a folded frame, and which frame hides it (the smallest, when nested). */
export function hiddenBy(frames: FlowFrame[] | undefined, boxes: Box[]): Map<string, FlowFrame> {
    const out = new Map<string, FlowFrame>();
    const folded = (frames || []).filter((f) => f.collapsed).sort((a, b) => a.w * a.h - b.w * b.h);
    for (const f of folded) for (const id of insideFrame(f, boxes)) if (!out.has(id)) out.set(id, f);
    return out;
}

export type AlignHow = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter';

/** Where each box goes to line up with the others. Returns only the boxes that move. */
export function align(boxes: Box[], how: AlignHow): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    if (boxes.length < 2) return out;
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    const top = Math.min(...boxes.map((b) => b.y));
    const bottom = Math.max(...boxes.map((b) => b.y + b.h));
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    for (const b of boxes) {
        let { x, y } = b;
        if (how === 'left') x = left;
        else if (how === 'right') x = right - b.w;
        else if (how === 'top') y = top;
        else if (how === 'bottom') y = bottom - b.h;
        else if (how === 'hcenter') x = cx - b.w / 2;
        else if (how === 'vcenter') y = cy - b.h / 2;
        x = Math.round(x); y = Math.round(y);
        if (x !== b.x || y !== b.y) out[b.id] = { x, y };
    }
    return out;
}

/** Equal gaps between the boxes, the outer two staying where they are. */
export function distribute(boxes: Box[], axis: 'h' | 'v'): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    if (boxes.length < 3) return out;
    const key = axis === 'h' ? 'x' : 'y';
    const size = axis === 'h' ? 'w' : 'h';
    const sorted = [...boxes].sort((a, b) => a[key] - b[key]);
    const first = sorted[0], last = sorted[sorted.length - 1];
    const span = last[key] + last[size] - first[key];
    const used = sorted.reduce((n, b) => n + b[size], 0);
    const gap = (span - used) / (sorted.length - 1);
    let at = first[key];
    for (const b of sorted) {
        const v = Math.round(at);
        if (v !== b[key]) out[b.id] = { x: axis === 'h' ? v : b.x, y: axis === 'v' ? v : b.y };
        at += b[size] + gap;
    }
    return out;
}

// ── Clipboard ────────────────────────────────────────────────────────────────────────────────

const CLIP_MAGIC = 'bmmFlowClip';

/** Steps as clipboard text: JSON a person can read, marked so a paste knows it is ours. */
export function clipText(steps: unknown[]): string {
    return JSON.stringify({ [CLIP_MAGIC]: 1, steps }, null, 1);
}

/**
 * Steps from clipboard text, or null when it is not ours. Only the SHAPE is checked here — a
 * pasted step is then exactly what a typed one is: the draft is saved through the editor, and a
 * run asks for every permission as usual. Nothing pasted is granted anything.
 */
export function readClip(textIn: string): { kind: string; [k: string]: any }[] | null {
    let doc: any;
    try { doc = JSON.parse(String(textIn || '')); } catch { return null; }
    if (!doc || doc[CLIP_MAGIC] !== 1 || !Array.isArray(doc.steps)) return null;
    const steps = doc.steps.filter((s: any) => s && typeof s === 'object' && typeof s.kind === 'string' && s.kind.length < 24);
    return steps.length ? JSON.parse(JSON.stringify(steps)) : null;
}

// ── The list ─────────────────────────────────────────────────────────────────────────────────

/** Tasks grouped by folder, folders sorted, the unfiled ones first. */
export function byFolder<T extends { ui?: FlowUi; name?: string }>(tasks: T[]): { folder: string; tasks: T[] }[] {
    const map = new Map<string, T[]>();
    for (const tk of tasks) {
        const f = tk.ui?.folder || '';
        (map.get(f) || map.set(f, []).get(f)!).push(tk);
    }
    return [...map.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0]))).map(([folder, list]) => ({ folder, tasks: list }));
}

/** Every tag in use, most used first. */
export function allTags(tasks: { ui?: FlowUi }[]): string[] {
    const n = new Map<string, number>();
    for (const tk of tasks) for (const g of tk.ui?.tags || []) n.set(g, (n.get(g) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g);
}

/** Does a task match the search box? Name, description, folder, tags: what someone remembers. */
export function matches(tk: { name?: string; description?: string; ui?: FlowUi }, needle: string, tag: string): boolean {
    if (tag && !(tk.ui?.tags || []).includes(tag)) return false;
    const q = needle.trim().toLowerCase();
    if (!q) return true;
    return `${tk.name || ''} ${tk.description || ''} ${tk.ui?.folder || ''} ${(tk.ui?.tags || []).join(' ')}`.toLowerCase().includes(q);
}

// ── What a step still needs ──────────────────────────────────────────────────────────────────

/**
 * The fields a step cannot run without, per action: one name, or a list of names of which ONE
 * is enough (a list from a path OR a URL). Only the cases where the runner would stop with
 * « nothing to do » — a field that has a default is not here. Read from the runner's own
 * early returns (scheduler.ts runAction, sched-pkg.ts), so the inspector says it before the
 * run does.
 */
export const REQUIRED: Record<string, (string | string[])[]> = {
    'pkg.install': ['file'],
    'pkg.verify': ['file'],
    'modlist.verify': [['path', 'file']],
    'gate.report': ['server'],
    'game.launch': ['exe'],
    'ui.ask': ['message'],
    'modlist.apply': [['path', 'url']],
    'import.file': [['path', 'url']],
    'custom.command': ['program'],
    'custom.script': ['code'],
    'http.request': ['url'],
    'wait.http': ['url'],
    'wait.hook': ['name'],
    'plugin.asset': ['pluginId', 'path'],
    'task.setEnabled': ['taskId'],
    'profile.activate': ['id'],
    'mod.enable': ['id'],
    'mod.disable': ['id'],
    'theme.set': ['id'],
};

const filled = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== '';

/** The required fields this step leaves empty, by parameter name (or `a / b` for « one of »). */
export function stepProblems(step: { kind?: string; action?: { type?: string; params?: Record<string, unknown> }; [k: string]: any } | undefined): string[] {
    if (!step || step.disabled) return [];
    if (step.kind === 'call' && !filled(step.block)) return ['block'];
    if (step.kind === 'forEach' && step.source === 'list' && !filled(step.listName)) return ['listName'];
    if (step.kind !== 'action') return [];
    const rule = REQUIRED[String(step.action?.type || '')];
    if (!rule) return [];
    const p = step.action?.params || {};
    const out: string[] = [];
    for (const r of rule) {
        if (Array.isArray(r)) { if (!r.some((k) => filled(p[k]))) out.push(r.join(' / ')); }
        else if (!filled(p[r])) out.push(r);
    }
    return out;
}
