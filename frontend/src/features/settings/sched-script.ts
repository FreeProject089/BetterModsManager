// An automation, exported as a script that runs OUTSIDE BMM.
//
// Automations are the one builder of Plugins & API: what is written there is saved as a task
// (it runs in BMM, on its trigger) or exported. This module is the export half that is not a
// .bmmpa: it turns the task's steps into the script engine's vocabulary (plugins.ts, registered
// in core/script-engine.ts), which then writes PowerShell, CMD, Python, Node…
//
// A script is not a task. It has no trigger, no permissions, no conditions BMM can evaluate,
// and it reaches BMM only through bmm:// links and the local API. So each step either has a
// script form (listed in SCRIPT_FORM) or becomes a comment that says it runs only inside BMM —
// never a silently dropped step. `skipped` lists those, and the export dialog shows the list.
//
// Import-free, so it loads in node for the tests (tests/sched-script.test.mjs).

export interface ScriptAction { action_type: string; target_id: string; extra: Record<string, unknown> }

type Map1 = (p: Record<string, any>) => ScriptAction;
const a = (action_type: string, target_id = '', extra: Record<string, unknown> = {}): ScriptAction => ({ action_type, target_id, extra });

/** The task actions that have a script form, and that form. */
export const SCRIPT_FORM: Record<string, Map1> = {
    'mod.enable': (p) => a('enable_mod', String(p.id || '')),
    'mod.disable': (p) => a('disable_mod', String(p.id || '')),
    'profile.activate': (p) => a('activate_profile', String(p.id || '')),
    'modpack.enable': (p) => a('enable_modpack', String(p.id || '')),
    'modpack.disable': (p) => a('disable_modpack', String(p.id || '')),
    'plugin.apply': (p) => a('apply_plugin', String(p.id || '')),
    'app.launch': (p) => a('launch_app', String(p.id || '')),
    'launchpack.run': (p) => a('run_launchpack', String(p.id || '')),
    'task.run': (p) => a('run_task', String(p.id || '')),
    'mods.checkUpdates': () => a('check_mod_updates'),
    'open.url': (p) => a('open_url', '', { url: String(p.url || '') }),
    'notify': (p) => a('show_message', '', { message: String(p.message || '') }),
    'log.print': (p) => a('log', '', { message: String(p.message ?? p.text ?? '') }),
    'app.stop': (p) => a('close_process', '', { process_name: String(p.name || '') }),
    'restart': () => a('restart'),
};

/** The formats where a local-API call is written as code; elsewhere it is a comment. */
export const API_CODE_FORMATS = ['ps1', 'bat', 'py', 'js'] as const;

const jsonStr = (s: string) => JSON.stringify(s);

/**
 * One local-API call in the script's own language. The token is read from BMM_TOKEN, never
 * written into the file, and the address is the API's own (`base`).
 */
export function apiCallCode(format: string, method: string, path: string, body: string, base: string): string | null {
    const url = `${base}${path}`;
    const hasBody = method !== 'GET' && body.trim() !== '';
    switch (format) {
        case 'ps1':
            return `Invoke-RestMethod -Method ${method} -Uri ${jsonStr(url).replace(/^"|"$/g, "'")} -Headers @{ Authorization = "Bearer $env:BMM_TOKEN" }`
                + (hasBody ? ` -ContentType 'application/json' -Body '${body.replace(/'/g, "''")}'` : '');
        case 'bat':
            return `curl -s -X ${method} "${url}" -H "Authorization: Bearer %BMM_TOKEN%"`
                + (hasBody ? ` -H "Content-Type: application/json" -d "${body.replace(/"/g, '\\"')}"` : '');
        case 'py':
            return `requests.request(${jsonStr(method)}, ${jsonStr(url)}, headers={"Authorization": "Bearer " + os.environ.get("BMM_TOKEN", ""), "Content-Type": "application/json"}`
                + (hasBody ? `, data=${jsonStr(body)}` : '') + ', timeout=30)';
        case 'js':
            return `await fetch(${jsonStr(url)}, { method: ${jsonStr(method)}, headers: { Authorization: 'Bearer ' + (process.env.BMM_TOKEN || ''), 'Content-Type': 'application/json' }`
                + (hasBody ? `, body: ${jsonStr(body)}` : '') + ' });';
    }
    return null;
}

export interface ScriptPlan { actions: ScriptAction[]; skipped: { n: number; type: string }[] }

/**
 * The steps, in the engine's vocabulary. Only the top level is exported: a branch, a loop or a
 * wait-for are things BMM decides while it runs, and a script cannot ask BMM's conditions —
 * each becomes a comment naming it. `label` gives a step's name for those comments.
 */
export function toScriptActions(steps: any[], format: string, base: string, label: (step: any) => string): ScriptPlan {
    const out: ScriptAction[] = [];
    const skipped: { n: number; type: string }[] = [];
    (steps || []).forEach((st, i) => {
        const n = i + 1;
        if (!st || st.disabled) return;
        if (st.kind === 'delay') { out.push(a('wait', '', { duration_ms: Math.max(0, Number(st.seconds) || 0) * 1000 })); return; }
        if (st.kind === 'action') {
            const type = String(st.action?.type || '');
            const p = (st.action?.params || {}) as Record<string, any>;
            if (type === 'api.call') {
                const code = apiCallCode(format, String(p.method || 'GET').toUpperCase(), String(p.path || ''), String(p.body || ''), base);
                if (code) { out.push(a('raw_code', '', { code })); return; }
            } else if (SCRIPT_FORM[type]) {
                out.push(SCRIPT_FORM[type](p));
                return;
            }
            skipped.push({ n, type });
            out.push(a('comment', '', { text: `${n}. ${label(st)} (BMM only)` }));
            return;
        }
        skipped.push({ n, type: String(st.kind || '') });
        out.push(a('comment', '', { text: `${n}. ${label(st)} (BMM only)` }));
    });
    return { actions: out, skipped };
}
