// The in-app interactive diagrams, as DATA.
//
// Each file in ./diagrams/ exports one DiagramSpec: nodes (with a kind and the code that implements
// them), groups, edges. Nothing in a spec is mermaid syntax, a colour or a sentence: the texts live
// in Lang/*.json under the spec's `i18n` prefix, the colours in css/diagrams.css, and the mermaid
// source is generated here. That is what keeps 40-odd diagrams in one visual language: a shape and a
// colour mean the same thing in every one of them, and the legend can be built from the data.
//
// Keys (P = spec.i18n, e.g. `docs.diagram.mod-activation`):
//   P.title  P.summary                       the diagram
//   P.g.<GROUP>                              a group (subgraph) title
//   P.n.<NODE>  P.n.<NODE>.desc              a node: 2-5 word label, then 1-3 sentences
//   P.e.<label>                              an edge label (1-3 words); `~x` = docs.diagram.common.x
//
// Code references (`refs`): 'path/from/repo/root.ext' or 'path › symbol'. scripts/check-diagrams.mjs
// fails when a path no longer exists or the symbol no longer appears in that file, so a rename or a
// move cannot leave a diagram pointing at code that is gone.

/** What a node IS. Decides its shape and colour, and its line in the legend. */
export type NodeKind =
    | 'ui'        // a screen, dialog, card or button the user sees            → rectangle, accent
    | 'front'     // front-end logic with no UI of its own (a TS module)       → rounded, cyan
    | 'rust'      // a Rust command, worker or backend function                → subroutine [[ ]], orange
    | 'data'      // a file, folder, database or cache on disk                 → cylinder, green
    | 'ext'       // outside BMM: the game, a server, the OS, Discord, a model → hexagon, purple
    | 'decision'  // a branch the code takes                                   → diamond, neutral
    | 'outcome';  // where a flow starts or ends: a state the user can observe → stadium, neutral

export const NODE_KINDS: readonly NodeKind[] = ['ui', 'front', 'rust', 'data', 'ext', 'decision', 'outcome'];

/** What an edge MEANS, when that matters: the happy path, a degraded one, a refusal. */
export type EdgeTone = 'ok' | 'warn' | 'danger' | 'info';

export type DiagramCategory = 'mods' | 'profiles' | 'integrity' | 'sharing' | 'updates' | 'automation' | 'laya' | 'internals';
export const CATEGORIES: readonly DiagramCategory[] = ['mods', 'profiles', 'integrity', 'sharing', 'updates', 'automation', 'laya', 'internals'];

export interface DiagramNode {
    /** UPPER_SNAKE, unique in the diagram. Also the i18n key segment. */
    id: string;
    kind: NodeKind;
    /** The group (subgraph) this node is drawn in. */
    group?: string;
    /** An `icon-*` mask class (css), drawn before the label. Optional. */
    icon?: string;
    /** Where it lives in the code: 'path' or 'path › symbol'. At least one. */
    refs: string[];
    /** Another diagram's id: the node drills into it. */
    link?: string;
}

export interface DiagramGroup {
    /** UPPER_SNAKE, unique in the diagram. */
    id: string;
    /** Nest inside another group. */
    parent?: string;
    /** Lay this group's nodes out across or down, whatever the diagram does. */
    dir?: 'LR' | 'TB';
}

export interface DiagramEdge {
    from: string;
    to: string;
    /** i18n segment under P.e.<label>, or `~x` for the shared docs.diagram.common.x. */
    label?: string;
    tone?: EdgeTone;
    /** A weaker link: optional, asynchronous, or "only if". */
    dashed?: boolean;
    /** The main path through the diagram. */
    thick?: boolean;
}

export interface DiagramSpec {
    /** The registry id ('mod-activation'). */
    id: string;
    /** i18n prefix: always `docs.diagram.<id>`. */
    i18n: string;
    category: DiagramCategory;
    /** TB: a flow that reads down. LR: a short pipeline that reads across. */
    dir: 'TB' | 'LR';
    groups?: DiagramGroup[];
    nodes: DiagramNode[];
    edges: DiagramEdge[];
    /** A docs-hub article id that explains the same subject in prose. */
    article?: string;
    /** Other diagram ids worth opening next. */
    related?: string[];
    /** Filled in by the registry (interactive-docs.ts) for the docs hub, which reads it. */
    titleKey?: string;
}

/** The separator in a code reference: 'src-tauri/src/commands/mods.rs › enable_mod_in'. */
export const REF_SEP = ' › ';

export function parseRef(ref: string): { path: string; symbol: string | null } {
    const i = ref.indexOf(REF_SEP);
    return i < 0 ? { path: ref.trim(), symbol: null } : { path: ref.slice(0, i).trim(), symbol: ref.slice(i + REF_SEP.length).trim() };
}

export const nodeKey = (s: DiagramSpec, id: string) => `${s.i18n}.n.${id}`;
export const groupKey = (s: DiagramSpec, id: string) => `${s.i18n}.g.${id}`;
export const edgeKey = (s: DiagramSpec, label: string) =>
    label.startsWith('~') ? `docs.diagram.common.${label.slice(1)}` : `${s.i18n}.e.${label}`;

// ── mermaid generation ─────────────────────────────────────────────────────────────────────────

/** Text that goes inside a quoted mermaid label, made safe for both mermaid and the HTML label. */
function esc(text: string): string {
    return String(text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '#quot;')
        // A newline ends a mermaid statement; a label is one line (the box wraps it).
        .replace(/[\r\n]+/g, ' ');
}

const SHAPE: Record<NodeKind, [string, string]> = {
    ui: ['[', ']'],
    front: ['(', ')'],
    rust: ['[[', ']]'],
    data: ['[(', ')]'],
    ext: ['{{', '}}'],
    decision: ['{', '}'],
    outcome: ['([', '])'],
};

/** The mermaid class a node of this kind carries (css/diagrams.css paints it). */
export const kindClass = (k: NodeKind) => `dgk_${k}`;
/** The mermaid id of a group. Prefixed so it can never collide with a node id. */
export const groupDomId = (id: string) => `G_${id}`;

/**
 * The mermaid source for a spec, in the language `tr` speaks. Labels are written into the source
 * already translated (escaped), so nothing downstream has to understand placeholders.
 */
export function buildMermaid(s: DiagramSpec, tr: (key: string) => string): string {
    const out: string[] = [`flowchart ${s.dir}`];
    const nodeLine = (n: DiagramNode, pad: string) => {
        const [a, b] = SHAPE[n.kind];
        const icon = n.icon ? `<i class='${n.icon}'></i>` : '';
        const label = `<span class='dg-n'>${icon}<span>${esc(tr(nodeKey(s, n.id)))}</span></span>`;
        out.push(`${pad}${n.id}${a}"${label}"${b}`);
    };
    const groups = s.groups || [];
    const drawGroup = (g: DiagramGroup, pad: string) => {
        out.push(`${pad}subgraph ${groupDomId(g.id)} ["<span class='dg-g'>${esc(tr(groupKey(s, g.id)))}</span>"]`);
        if (g.dir) out.push(`${pad}    direction ${g.dir}`);
        for (const child of groups.filter((c) => c.parent === g.id)) drawGroup(child, pad + '    ');
        for (const n of s.nodes.filter((n) => n.group === g.id)) nodeLine(n, pad + '    ');
        out.push(`${pad}end`);
    };
    for (const g of groups.filter((g) => !g.parent)) drawGroup(g, '    ');
    for (const n of s.nodes.filter((n) => !n.group)) nodeLine(n, '    ');

    s.edges.forEach((e, i) => {
        const arrow = e.thick ? '==>' : e.dashed ? '-.->' : '-->';
        const label = e.label ? `|"<span class='dg-el dg-tone-${e.tone || 'none'}' data-e='${i}'>${esc(tr(edgeKey(s, e.label)))}</span>"|` : '';
        out.push(`    ${e.from} ${arrow}${label} ${e.to}`);
    });
    // Class names only: the colours are in css/diagrams.css, from the live tokens.
    for (const k of NODE_KINDS) {
        const ids = s.nodes.filter((n) => n.kind === k).map((n) => n.id);
        if (ids.length) out.push(`    class ${ids.join(',')} ${kindClass(k)}`);
    }
    return out.join('\n');
}

/** Every i18n key a spec needs. The gate checks each one exists in en and fr. */
export function specKeys(s: DiagramSpec): string[] {
    const keys = [`${s.i18n}.title`, `${s.i18n}.summary`];
    for (const g of s.groups || []) keys.push(groupKey(s, g.id));
    for (const n of s.nodes) keys.push(nodeKey(s, n.id), `${nodeKey(s, n.id)}.desc`);
    for (const e of s.edges) if (e.label) keys.push(edgeKey(s, e.label));
    return [...new Set(keys)];
}

/**
 * Rank each node along the flow: the longest path from a source, ignoring the edges that close
 * a loop (found by a depth-first walk), so a "retry" arrow does not stretch the picture.
 */
export function rankNodes(s: DiagramSpec): Map<string, number> {
    const ids = s.nodes.map((n) => n.id);
    const out = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const e of s.edges) out.get(e.from)?.push(e.to);
    const state = new Map<string, 1 | 2>();
    const back = new Set<string>();
    const visit = (id: string) => {
        state.set(id, 1);
        for (const to of out.get(id) || []) {
            const st = state.get(to);
            if (st === 1) back.add(`${id}>${to}`);
            else if (!st) visit(to);
        }
        state.set(id, 2);
    };
    const hasIn = new Set(s.edges.map((e) => e.to));
    for (const id of ids) if (!hasIn.has(id) && !state.get(id)) visit(id);
    for (const id of ids) if (!state.get(id)) visit(id);
    const rank = new Map<string, number>(ids.map((id) => [id, 0]));
    const forward = s.edges.filter((e) => !back.has(`${e.from}>${e.to}`));
    for (let i = 0; i < ids.length; i++) {
        let changed = false;
        for (const e of forward) {
            const r = (rank.get(e.from) || 0) + 1;
            if (r > (rank.get(e.to) || 0)) { rank.set(e.to, r); changed = true; }
        }
        if (!changed) break;
    }
    return rank;
}
