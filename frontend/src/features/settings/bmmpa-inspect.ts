// Reading a `.bmmpa` without running it.
//
// A shared automation file is somebody else's code arriving as data. Deciding whether to
// trust it currently means importing it and reading the editor — which is exactly the
// wrong order, because importing is the commitment.
//
// This answers the questions a reviewer actually has, from the file alone:
//   · what would it do
//   · what does it want permission to do
//   · what does it reach outside BMM — programs, URLs, deeplinks
//
// Pure and side-effect free ON PURPOSE. It never invokes a command, never touches storage,
// never resolves a URL. That is not a style preference: the whole value of an inspector is
// that looking at a thing cannot be the thing happening.

/** The permission keys a task can grant itself. Mirrors TaskPerms.
 *
 *  Codes rather than sentences. The words live where they can be translated; a model that
 *  hands out English prose forces every view to print English, which is what the BCWEB
 *  copy of this actually did until its French moderation screen showed it. One client
 *  today is not a reason to build the shape that breaks with two. */
export const RISK_KEYS = ['command', 'script', 'deeplink', 'stopProcess'] as const;

/** Action types that reach outside BMM whatever the permissions say.
 *
 *  A Set of types, not a map to prose: the type IS the stable identifier and the words
 *  belong to whoever displays it. Data rather than a regex on the name — `custom.command`
 *  and `app.stop` share no prefix, and a future `foo.command` should not be flagged by
 *  accident. */
const REACHING_ACTIONS = new Set([
    'custom.command', 'custom.script', 'app.stop', 'app.launch', 'http.request',
    'file.open', 'folder.open', 'open.url', 'restart', 'task.run',
]);

export interface StepSummary {
    kind: string;
    /** For an action step: its type. */
    type?: string;
    /** Why this step is worth a reviewer's attention, if it is. */
    note?: string;
    /**
     * The step's own parameters, flattened to strings.
     *
     * Carried because a summary that says "Run custom command" and nothing else asks the
     * reviewer to trust a verb. WHICH program, with which arguments, against which URL, is
     * the entire question. Nothing is redacted: the author of the file put these values in
     * it, and a reviewer who cannot see the token a request would send cannot judge the
     * request.
     *
     * Script and command bodies are NOT duplicated here — they have their own section, with
     * a copy button and a 20 KB cap.
     */
    params?: Record<string, string>;
    /**
     * For an action that names another thing by id (`task.run`, `launchpack.run`, …): what
     * the id points at, if the FILE carries it. `null` means the file references something
     * it does not include — the single most useful thing this panel can tell you, because
     * such a task imports cleanly and then fails on a machine that never had it.
     */
    refKind?: string;
    refId?: string;
    refName?: string | null;
    children: StepSummary[];
}

export interface TaskSummary {
    name: string;
    description?: string;
    enabled: boolean;
    trigger: string;
    /** Permission CODES the file grants itself — see RISK_KEYS. */
    perms: string[];
    /** Action types by which this task touches the world outside BMM. */
    reaching: string[];
    /**
     * Every runnable body it carries, so a reviewer can read the actual code.
     *
     * Commands are in here beside scripts. `custom.command` with program `powershell` and
     * args `-Enc <base64>` is a script by any measure that matters to somebody deciding
     * whether to trust a file; listing only `custom.script` would let the same payload
     * through by spelling it differently. `engine` is the script engine, or `command` for
     * a program invocation.
     */
    scripts: { engine: string; code: string }[];
    /** Every external URL or program it names. */
    targets: string[];
    stepCount: number;
    steps: StepSummary[];
}

export interface InspectResult {
    /** How many launch packs / modpacks the file carries alongside its tasks. */
    includes?: { launchpacks: number; modpacks: number; plugins: number; blocks: number };
    /** References the file makes but does not satisfy. These import cleanly and fail later. */
    unresolved?: { kind: string; id: string }[];
    ok: boolean;
    error?: string;
    version?: number;
    exported?: string;
    tasks: TaskSummary[];
    /** True if ANY task asks for a permission or reaches outside BMM. */
    needsReview: boolean;
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** A trigger, in words. Falls back to the raw type rather than inventing a description —
 *  "unknown trigger: foo" tells a reviewer something; a blank does not. */
function describeTrigger(t: any): string {
    if (!t || typeof t !== 'object') return 'no trigger';
    switch (t.type) {
        case 'interval': return `every ${t.everyMinutes ?? '?'} min`;
        case 'dailyAt': return `daily at ${t.time ?? '?'}`;
        case 'weeklyAt': return `weekly at ${t.time ?? '?'}`;
        case 'monthlyAt': return `monthly at ${t.time ?? '?'}`;
        case 'appStart': return 'when BMM starts';
        case 'manual': return 'manually only';
        default: return `unknown trigger: ${String(t.type ?? '(none)')}`;
    }
}

/** Actions that name another thing by id, and what kind. Mirrors the scheduler's own map;
 *  kept here too because this file must stay importable without it (the BCWEB copy has no
 *  scheduler to read from). */
const REF_ACTIONS: Record<string, string> = {
    'task.run': 'task',
    'launchpack.run': 'launchpack',
    'modpack.enable': 'modpack',
    'modpack.disable': 'modpack',
    'profile.activate': 'profile',
    // A plugin is a dependency like a launch pack: the exporter carries its manifest in
    // `includes.plugins`, so a reviewer sees the plugin's name instead of an opaque id.
    // `plugin.delete` is absent on purpose — nothing is carried for something removed.
    'plugin.apply': 'plugin',
    'plugin.compare': 'plugin',
};

/**
 * Parameters as short strings, for display.
 *
 * Bodies are skipped — `code`, and the reassembled command — because they have their own
 * section with a copy button, and repeating a forty-line script inside a tree row makes the
 * tree unreadable for the exact file that most needs reading.
 *
 * Everything is capped. A parameter can hold a whole JSON document, and a reviewer scanning
 * a step list needs to see THAT it is there, at a length they can scan.
 */
function flattenParams(p: Record<string, any>): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p || {})) {
        if (k === 'code' || v === undefined || v === null || v === '') continue;
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (!s) continue;
        out[k] = s.length > 300 ? `${s.slice(0, 300)}…` : s;
    }
    return Object.keys(out).length ? out : undefined;
}

/** Walk every step, including the bodies of if / repeat / forEach / switch / try.
 *  A dangerous action hidden three levels inside a loop is still a dangerous action, and
 *  an inspector that only reads the top level is worse than none — it produces a clean
 *  report for a file that is not clean. */
function walkSteps(steps: any[], out: TaskSummary): StepSummary[] {
    return asArray(steps).map((st: any) => {
        const kind = String(st?.kind || 'action');
        const node: StepSummary = { kind, children: [] };

        if (kind === 'action') {
            const type = String(st?.action?.type || '');
            const p = st?.action?.params || {};
            node.type = type;
            if (REACHING_ACTIONS.has(type)) {
                node.note = type;
                if (!out.reaching.includes(type)) out.reaching.push(type);
            }
            if (type === 'custom.script' && typeof p.code === 'string') {
                out.scripts.push({ engine: String(p.engine || 'powershell'), code: p.code });
            }
            if (type === 'custom.command' && typeof p.program === 'string' && p.program.trim()) {
                // Reassembled as one line because that is what will run. Arguments listed
                // separately read as harmless nouns; `--output-document /etc/cron.d/x` does
                // not, and the reviewer should see the whole thing the way the shell will.
                const args = Array.isArray(p.args) ? p.args.map((a: unknown) => String(a)) : [];
                out.scripts.push({ engine: 'command', code: [p.program.trim(), ...args].join(' ') });
            }
            node.params = flattenParams(p);
            const refKind = REF_ACTIONS[type];
            if (refKind && p.id) { node.refKind = refKind; node.refId = String(p.id); }
            // Anything naming something outside BMM. Collected verbatim and NOT resolved —
            // an inspector that fetched a URL to describe it would be doing the thing it
            // exists to avoid.
            for (const k of ['program', 'url', 'path', 'name', 'exePath']) {
                const v = p[k];
                if (typeof v === 'string' && v.trim() && !out.targets.includes(v)) out.targets.push(v.trim());
            }
        }

        // A `call` names a BLOCK. It is a step KIND rather than an action, so REF_ACTIONS
        // could never have found it — and the runner ABORTS on a missing block, so an
        // unresolved one is a task that stops dead rather than one that does less.
        if (kind === 'call' && st?.block) {
          node.refKind = 'block';
          node.refId = String(st.block);
        }

        for (const key of ['steps', 'then', 'else', 'onError', 'default']) {
            if (Array.isArray(st?.[key])) node.children.push(...walkSteps(st[key], out));
        }
        // Parallel branches too, or every step inside one is invisible to a reviewer.
        if (Array.isArray(st?.branches)) {
            for (const b of st.branches) if (Array.isArray(b)) node.children.push(...walkSteps(b, out));
        }
        if (Array.isArray(st?.cases)) {
            for (const c of st.cases) if (Array.isArray(c?.steps)) node.children.push(...walkSteps(c.steps, out));
        }
        return node;
    });
}

const countSteps = (list: StepSummary[]): number =>
    list.reduce((n, s) => n + 1 + countSteps(s.children), 0);

/**
 * Inspect a `.bmmpa` document (already parsed from JSON).
 *
 * Takes a value, not a path or a string: reading a file and deciding what is in it are
 * different jobs, and keeping them apart is what lets this run identically in the app, in
 * a test, and on a server that must never touch the filesystem.
 */
export function inspectBmmpa(doc: unknown): InspectResult {
    const empty: InspectResult = { ok: false, tasks: [], needsReview: false };
    if (!doc || typeof doc !== 'object') return { ...empty, error: 'Not a .bmmpa document.' };
    const d = doc as Record<string, any>;

    // A bare array is accepted because importTasksFile accepts one — an inspector that
    // refused a file the importer would take is worse than useless, it is misleading.
    const tasks = Array.isArray(d) ? d : asArray(d.tasks);
    if (!Array.isArray(tasks) || !tasks.length) {
        return { ...empty, error: 'No automations in this file.' };
    }

    const out: TaskSummary[] = tasks.map((tk: any) => {
        const summary: TaskSummary = {
            name: String(tk?.name || '(unnamed)'),
            description: typeof tk?.description === 'string' ? tk.description : undefined,
            enabled: tk?.enabled !== false,
            trigger: describeTrigger(tk?.trigger),
            perms: [],
            reaching: [],
            scripts: [],
            targets: [],
            stepCount: 0,
            steps: [],
        };
        // The file's own claim about what it may do. Read from `perms`, falling back to the
        // legacy single flag — a task exported before permissions were split still grants
        // something, and reporting "no permissions" for it would be a lie of omission.
        const perms = tk?.perms && typeof tk.perms === 'object' ? tk.perms : null;
        if (perms) {
            for (const k of RISK_KEYS) if (perms[k]) summary.perms.push(k);
        } else if (tk?.allowCustomCommands) {
            summary.perms.push('command', 'deeplink');
        }
        summary.steps = walkSteps(tk?.steps, summary);
        summary.stepCount = countSteps(summary.steps);
        return summary;
    });

    // Resolve every reference against what the FILE carries, now that all tasks are read.
    //
    // Done here rather than during the walk because a task can call one declared later in
    // the file, and a resolver that only looked backwards would report half the references
    // as missing — worse than not resolving at all, because it would be wrong rather than
    // absent.
    const taskNames = new Map(tasks.slice(0, 500).map((tk: any) => [String(tk?.id ?? ''), String(tk?.name ?? '(unnamed)')]));
    const included: Record<string, Set<string>> = {
        launchpack: new Set(asArray(d.includes?.launchpacks).map((x: any) => String(x?.id ?? ''))),
        modpack: new Set(asArray(d.includes?.modpacks).map((x: any) => String(x?.id ?? x?.name ?? ''))),
        plugin: new Set(asArray(d.includes?.plugins).map((x: any) => String(x?.id ?? ''))),
        // Blocks arrive as ONE object of name → steps, not a list of rows — so the keys are
        // the ids, and asArray()[0] is the object rather than an entry.
        block: new Set(Object.keys(asArray(d.includes?.blocks)[0] || {})),
    };
    const unresolved: { kind: string; id: string }[] = [];
    const resolve = (nodes: StepSummary[]): void => {
        for (const n of nodes) {
            if (n.refId && n.refKind) {
                const name = n.refKind === 'task'
                    ? (taskNames.get(n.refId) ?? null)
                    : (included[n.refKind]?.has(n.refId) ? n.refId : null);
                n.refName = name;
                // A profile is never carried in a .bmmpa — it is machine-specific — so an
                // unresolved profile reference is normal and not worth flagging as a gap.
                if (name === null && n.refKind !== 'profile') unresolved.push({ kind: n.refKind, id: n.refId });
            }
            resolve(n.children);
        }
    };
    for (const tk of out) resolve(tk.steps);

    return {
        ok: true,
        version: typeof d.version === 'number' ? d.version : undefined,
        exported: typeof d.exported === 'string' ? d.exported : undefined,
        tasks: out,
        includes: {
            launchpacks: asArray(d.includes?.launchpacks).length,
            modpacks: asArray(d.includes?.modpacks).length,
            plugins: asArray(d.includes?.plugins).length,
            blocks: Object.keys(asArray(d.includes?.blocks)[0] || {}).length,
        },
        unresolved,
        needsReview: out.some((t) => t.perms.length > 0 || t.reaching.length > 0),
    };
}
