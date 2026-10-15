// Where the automation editor finds the two things Plugins & API owns: the script engine (the
// code generator that turns steps into a .bat, .ps1, .py… that runs OUTSIDE BMM) and the local
// API's reference (every route, its method, its fields).
//
// The editor is scheduler.ts; the engine and the reference live in plugins.ts. Each importing
// the other would join two of the largest modules in one import cycle, so plugins.ts REGISTERS
// both here when it loads and the editor asks here. Import-free on purpose.

/** One step in the script engine's own vocabulary (plugins.ts `_collectActions`). */
export interface ScriptAction { action_type: string; target_id: string; extra: Record<string, unknown> }

export interface ScriptEngine {
    /** The formats it writes, in the order the menu offers them (`ps1`, `bat`, `py`…). */
    formats: string[];
    /** The script, or null when it could not be written (the engine says why itself). */
    generate: (format: string, actions: ScriptAction[]) => Promise<string | null>;
}

export interface ApiField { name: string; type: string; required: boolean; desc: string }
export interface ApiRoute { method: string; path: string; desc: string; auth: boolean; fields: ApiField[] | null; example?: string }

let _engine: ScriptEngine | null = null;
let _routes: (() => ApiRoute[]) | null = null;

export function registerScriptEngine(e: ScriptEngine): void { _engine = e; }
export function scriptEngine(): ScriptEngine | null { return _engine; }

export function registerApiRoutes(fn: () => ApiRoute[]): void { _routes = fn; }
/** Every documented route, or [] before Plugins & API has loaded. */
export function apiRoutes(): ApiRoute[] {
    try { return _routes ? _routes() : []; } catch { return []; }
}
