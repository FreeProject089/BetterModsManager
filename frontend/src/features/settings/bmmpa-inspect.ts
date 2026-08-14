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
    'custom.command', 'custom.script', 'app.stop', 'app.launch',
    'file.open', 'folder.open', 'open.url', 'restart', 'task.run',
]);

export interface StepSummary {
    kind: string;
    /** For an action step: its type. */
    type?: string;
    /** Why this step is worth a reviewer's attention, if it is. */
    note?: string;
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
            // Anything naming something outside BMM. Collected verbatim and NOT resolved —
            // an inspector that fetched a URL to describe it would be doing the thing it
            // exists to avoid.
            for (const k of ['program', 'url', 'path', 'name', 'exePath']) {
                const v = p[k];
                if (typeof v === 'string' && v.trim() && !out.targets.includes(v)) out.targets.push(v.trim());
            }
        }

        for (const key of ['steps', 'then', 'else', 'onError', 'default']) {
            if (Array.isArray(st?.[key])) node.children.push(...walkSteps(st[key], out));
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

    return {
        ok: true,
        version: typeof d.version === 'number' ? d.version : undefined,
        exported: typeof d.exported === 'string' ? d.exported : undefined,
        tasks: out,
        needsReview: out.some((t) => t.perms.length > 0 || t.reaching.length > 0),
    };
}
