// The dependency and conflict graph, as a tree.
//
// The data was already there — every mod carries `dependencies`, and get_all_mod_conflicts
// reports which mods fight over which files. What was missing is the shape: a flat list of
// pairs answers "does A conflict with B" and never answers "what does installing A actually
// pull in, and which of those collide".
//
// Pure functions of their input, like sched-vars.ts and http-action.ts, so they can be
// tested directly. mods.ts cannot be: it reaches Tauri and the DOM before its first
// statement runs.
//
// Three things this refuses to do quietly, because each one produces a tree that looks
// correct and is not:
//
//   · a CYCLE is drawn once and marked, never followed. A → B → A is a thing people build
//     by accident, and a renderer that follows it recurses until the stack ends.
//   · a MISSING dependency is a node, not a gap. "Mod A needs Mod D" is the most useful
//     line in the tree when Mod D is not installed, and dropping it makes the tree agree
//     with a library that is broken.
//   · a mod reached by two paths appears under both, marked as a repeat the second time.
//     Deduplicating it would hide that two different things depend on it, which is exactly
//     what you need to know before removing it.

export interface GraphMod {
    id: string;
    name: string;
    dependencies?: string[];
    enabled?: boolean;
}

/** One conflicting pair, from get_all_mod_conflicts. `files` is how many they share. */
export interface GraphConflict {
    a: string;
    b: string;
    files: number;
}

export interface TreeNode {
    id: string;
    name: string;
    /** Not installed: the id was named as a dependency and nothing provides it. */
    missing: boolean;
    /** Already drawn higher in THIS branch — a cycle. Not descended into. */
    cycle: boolean;
    /** Already drawn elsewhere in the tree. Descended into once, then referenced. */
    repeat: boolean;
    /** Ids this node conflicts with, whether or not they are in this branch. */
    conflicts: string[];
    depth: number;
    children: TreeNode[];
}

/**
 * Build the dependency tree under one mod.
 *
 * `seen` is per-branch (a cycle), `drawn` is per-tree (a repeat). Two different questions
 * that a single visited-set would collapse: with one set, a diamond — A needs B and C, both
 * need D — would report D as a cycle, which is wrong and alarming.
 */
export function buildTree(
    rootId: string,
    mods: GraphMod[],
    conflicts: GraphConflict[] = [],
): TreeNode | null {
    const byId = new Map(mods.map((m) => [m.id, m]));
    const conflictsOf = new Map<string, string[]>();
    for (const c of conflicts) {
        (conflictsOf.get(c.a) ?? conflictsOf.set(c.a, []).get(c.a)!).push(c.b);
        (conflictsOf.get(c.b) ?? conflictsOf.set(c.b, []).get(c.b)!).push(c.a);
    }

    const root = byId.get(rootId);
    if (!root) return null;
    const drawn = new Set<string>();

    const walk = (id: string, branch: Set<string>, depth: number): TreeNode => {
        const mod = byId.get(id);
        const node: TreeNode = {
            id,
            name: mod?.name ?? id,
            missing: !mod,
            cycle: branch.has(id),
            repeat: !branch.has(id) && drawn.has(id),
            conflicts: conflictsOf.get(id) ?? [],
            depth,
            children: [],
        };
        // A cycle is drawn and stopped. A repeat is drawn and stopped too: descending again
        // would duplicate a whole subtree, and the second copy tells you nothing the first
        // did not — while making a wide graph unreadable.
        if (node.cycle || node.repeat || node.missing) return node;
        drawn.add(id);
        const next = new Set(branch);
        next.add(id);
        for (const dep of mod!.dependencies ?? []) {
            node.children.push(walk(dep, next, depth + 1));
        }
        return node;
    };
    return walk(rootId, new Set(), 0);
}

/** Every root: a mod nothing else depends on. Those are the trees worth drawing — starting
 *  from a leaf shows one node and hides the structure it belongs to. */
export function findRoots(mods: GraphMod[]): string[] {
    const depended = new Set<string>();
    for (const m of mods) for (const d of m.dependencies ?? []) depended.add(d);
    return mods.filter((m) => !depended.has(m.id)).map((m) => m.id);
}

/**
 * The tree as text, in the box-drawing form people actually paste into an issue.
 *
 *   Mod A
 *    ├── Mod B
 *    │    └── Mod D
 *    └── Mod C
 *
 * Text rather than only DOM because the first thing somebody does with a dependency tree is
 * show it to someone else, and a screenshot cannot be searched or quoted.
 */
export function renderTreeText(node: TreeNode): string {
    const lines: string[] = [];
    const mark = (n: TreeNode) => {
        const tags = [
            n.missing ? 'MISSING' : '',
            n.cycle ? 'cycle' : '',
            n.repeat ? 'seen above' : '',
            n.conflicts.length ? `conflicts: ${n.conflicts.length}` : '',
        ].filter(Boolean);
        return tags.length ? `${n.name}  [${tags.join(', ')}]` : n.name;
    };
    lines.push(mark(node));
    const walk = (children: TreeNode[], prefix: string) => {
        children.forEach((child, i) => {
            const last = i === children.length - 1;
            lines.push(`${prefix}${last ? '└── ' : '├── '}${mark(child)}`);
            // The continuation column: a vertical bar while siblings remain below, spaces
            // once this is the last one. Getting this wrong is what makes a printed tree
            // look like a different tree.
            walk(child.children, `${prefix}${last ? '     ' : '│    '}`);
        });
    };
    walk(node.children, ' ');
    return lines.join('\n');
}

/** Flatten a tree to the ids in it, once each. What "removing this would affect" needs. */
export function treeIds(node: TreeNode): string[] {
    const out = new Set<string>();
    const walk = (n: TreeNode) => { out.add(n.id); n.children.forEach(walk); };
    walk(node);
    return [...out];
}

/** Dependencies named by somebody and provided by nobody, across the whole library. */
export function missingDependencies(mods: GraphMod[]): { needer: string; missing: string }[] {
    const have = new Set(mods.map((m) => m.id));
    const out: { needer: string; missing: string }[] = [];
    for (const m of mods) {
        for (const d of m.dependencies ?? []) if (!have.has(d)) out.push({ needer: m.id, missing: d });
    }
    return out;
}
