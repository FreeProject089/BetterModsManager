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

/** What a task asks to do beyond changing BMM's own state. Mirrors TaskPerms. */
export const RISK_LABEL: Record<string, string> = {
    command: 'Runs external programs',
    script: 'Runs scripts (PowerShell / CMD / Bash / Python)',
    deeplink: 'Fires bmm:// deeplinks',
    stopProcess: 'Stops running programs',
};

/** Action types that reach outside BMM whatever the permissions say. Kept as data rather
 *  than a regex over the type name: `custom.command` and `app.stop` share no prefix, and a
 *  future `foo.command` should not be flagged by accident. */
const REACHING_ACTIONS: Record<string, string> = {
    'custom.command': 'Runs an external program',
    'custom.script': 'Runs a script',
    'app.stop': 'Stops a program',
    'app.launch': 'Launches an app',
    'file.open': 'Opens a file or program',
    'folder.open': 'Opens a folder',
    'open.url': 'Opens a URL',
    'restart': 'Restarts BMM',
    'task.run': 'Runs another scheduled task',
};

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
    /** Permissions the file grants itself. */
    perms: string[];
    /** Human-readable reasons this task touches the world outside BMM. */
    reaching: string[];
    /** Every script body it carries, so a reviewer can read the actual code. */
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
            if (REACHING_ACTIONS[type]) {
                node.note = REACHING_ACTIONS[type];
                if (!out.reaching.includes(REACHING_ACTIONS[type])) out.reaching.push(REACHING_ACTIONS[type]);
            }
            if (type === 'custom.script' && typeof p.code === 'string') {
                out.scripts.push({ engine: String(p.engine || 'powershell'), code: p.code });
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
            for (const k of Object.keys(RISK_LABEL)) if (perms[k]) summary.perms.push(RISK_LABEL[k]);
        } else if (tk?.allowCustomCommands) {
            summary.perms.push(RISK_LABEL.command, RISK_LABEL.deeplink);
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
