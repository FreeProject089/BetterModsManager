// The API surface between the frontend and Rust: who calls what, and what nobody calls.
//
// `invoke` here is non-generic and returns Promise<any>, so TypeScript checks nothing about
// these calls — not the name, not the arguments, not whether the command still exists. That
// makes the frontend→Rust boundary the one edge in this codebase with no compiler behind it,
// and the only map of it was a person's memory.
//
// check-invoke-names.mjs already answers one direction: does every invoke() reach a
// registered command. This answers the rest of the shape:
//
//   · which frontend module talks to which part of the Rust API, so "this change is in
//     mods.ts, what can it possibly break" has an answer.
//   · which registered commands the frontend never calls. NOT dead code — the MCP server,
//     the CLI and bmm:// deeplinks all reach commands the UI never touches — so this is
//     reported as "no frontend caller" and never as "unused".
//   · which invokes are DYNAMIC (`invoke(name)` rather than `invoke('name')`). Those are
//     invisible to every static check including this one, and a count of them is the
//     honest measure of how much of the surface is actually being checked.
//
// Pure functions of text, so this is testable and the script and any screen share one
// implementation.
import { stripComments } from './dep-graph.js';

export interface InvokeUse {
    /** The command name, or null when the call site passes a variable. */
    name: string | null;
    line: number;
}

/**
 * Every invoke() call in one module.
 *
 * All three quote styles, because a checker that only knows single quotes reports a clean
 * result on a file full of double-quoted calls — and reads exactly like success.
 *
 * A call whose argument is not a literal is kept with `name: null` rather than dropped. A
 * dynamic invoke is a real hole in the static check, and a tool that silently skips them
 * overstates its own coverage.
 */
export function parseInvokes(src: string): InvokeUse[] {
    const text = stripComments(String(src));
    const out: InvokeUse[] = [];
    const lineOf = (i: number) => text.slice(0, i).split('\n').length;

    // Names that ARE invoke under another name.
    //
    // `const { invoke: inv } = await import('../core/api.js')` and
    // `const inv = typeof invoke !== 'undefined' ? invoke : …` both make `inv(...)` a real
    // call, and matching only the literal word missed them. app.ts called
    // get_effective_api_port through exactly that alias, and this tool reported the command
    // as having no frontend caller — a wrong entry on the one list it publishes.
    const aliases = new Set<string>(['invoke', '_invoke']);
    for (const m of text.matchAll(/\binvoke\s*(?::|as)\s*([A-Za-z_$][\w$]*)/g)) aliases.add(m[1]);
    for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*\binvoke\b/g)) aliases.add(m[1]);
    const NAMES = [...aliases].map((a) => a.replace(/[$]/g, '\\$')).join('|');
    // `_invoke` too: core/api.ts calls the raw Tauri bridge directly for log_frontend_line,
    // to avoid the wrapper's own logging recursing forever. It is a real call to a real
    // command, and a map that misses it lists that command as having no caller.
    const CALL = new RegExp(`(\\bfunction\\s+|\\bconst\\s+|\\.)?\\b(?:${NAMES})(?:<[^>]*>)?\\s*\\(\\s*([^),]*)`, 'g');
    for (const m of text.matchAll(CALL)) {
        // `export async function invoke(command: string, …)` is the wrapper's DECLARATION in
        // core/api.ts, not a call. Counting it reported the one file that defines the bridge
        // as having a dynamic invoke — a finding about the tool, dressed as a finding about
        // the code.
        if (m[1] && m[1] !== '.') continue;
        const arg = m[2].trim();
        // `invoke()` with nothing in it cannot call anything. It appears in this codebase
        // inside documentation prose — "<code>invoke()</code>" in the docs hub — and
        // counting it inflated the dynamic-invoke number, which is the one number here
        // that is supposed to measure how much this tool cannot see.
        if (!arg) continue;
        const lit = arg.match(/^(['"`])([A-Za-z0-9_]+)\1$/);
        out.push({ name: lit ? lit[2] : null, line: lineOf(m.index ?? 0) });
    }
    return out;
}

/**
 * The commands Rust actually exposes, with the module each one lives in.
 *
 * Read from generate_handler! rather than from `#[tauri::command]`: a command can be written,
 * compiled and completely unreachable because nobody registered it, and "exists but
 * unreachable" is one of the bugs worth catching rather than hiding.
 *
 * The list holds two shapes — `commands::module::name` and a bare `name` for the few defined
 * in main.rs. Handling only the first reported the bare ones as missing.
 */
export function parseHandlerList(mainRs: string): { name: string; module: string }[] {
    const list = String(mainRs).match(/generate_handler!\s*\[([\s\S]*?)\]/);
    if (!list) return [];
    const out: { name: string; module: string }[] = [];
    for (const raw of list[1].split(',')) {
        const s = raw.replace(/\/\/.*$/gm, '').trim();
        if (!s) continue;
        const parts = s.split('::');
        out.push({ name: parts[parts.length - 1], module: parts.length > 1 ? parts[parts.length - 2] : 'main' });
    }
    return out;
}

export interface ApiMap {
    counts: { registered: number; called: number; noFrontendCaller: number; dynamic: number; unregistered: number };
    /** Frontend module → the commands it calls, most-talkative first. */
    byCaller: { module: string; commands: string[] }[];
    /** Rust module → how many of its commands the frontend calls, and how many it has. */
    byRustModule: { module: string; called: number; total: number }[];
    /** Registered and never called from the frontend. Reached by MCP/CLI/deeplinks, or not
     *  reached at all — this cannot tell those apart and does not pretend to. */
    noFrontendCaller: string[];
    /** Called and not registered: a runtime rejection waiting to happen. */
    unregistered: { command: string; module: string; line: number }[];
    /** invoke(variable) — a hole in every static check, including this one. */
    dynamic: { module: string; line: number }[];
}

export function buildApiMap(
    files: { path: string; src: string }[],
    handlers: { name: string; module: string }[],
): ApiMap {
    const registered = new Map(handlers.map((h) => [h.name, h.module]));
    const byCaller: { module: string; commands: string[] }[] = [];
    const called = new Set<string>();
    const unregistered: { command: string; module: string; line: number }[] = [];
    const dynamic: { module: string; line: number }[] = [];

    for (const f of files) {
        const names = new Set<string>();
        for (const u of parseInvokes(f.src)) {
            if (u.name == null) { dynamic.push({ module: f.path, line: u.line }); continue; }
            names.add(u.name);
            if (registered.has(u.name)) called.add(u.name);
            else unregistered.push({ command: u.name, module: f.path, line: u.line });
        }
        if (names.size) byCaller.push({ module: f.path, commands: [...names].sort() });
    }
    byCaller.sort((a, b) => b.commands.length - a.commands.length);

    const total = new Map<string, number>();
    const hit = new Map<string, number>();
    for (const h of handlers) {
        total.set(h.module, (total.get(h.module) ?? 0) + 1);
        if (called.has(h.name)) hit.set(h.module, (hit.get(h.module) ?? 0) + 1);
    }
    const byRustModule = [...total]
        .map(([module, n]) => ({ module, called: hit.get(module) ?? 0, total: n }))
        .sort((a, b) => b.total - a.total);

    const noFrontendCaller = handlers.map((h) => h.name).filter((n) => !called.has(n)).sort();

    return {
        counts: {
            registered: registered.size,
            called: called.size,
            noFrontendCaller: noFrontendCaller.length,
            dynamic: dynamic.length,
            unregistered: unregistered.length,
        },
        byCaller,
        byRustModule,
        noFrontendCaller,
        unregistered,
        dynamic,
    };
}
