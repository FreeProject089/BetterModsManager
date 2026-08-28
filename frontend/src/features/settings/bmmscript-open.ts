/**
 * bmmscript-open.ts — what happens when somebody double-clicks a `.bmmscript`.
 *
 * A shared script is someone else's code arriving as a file. The whole design question is
 * what "open" means, and the answer here is deliberately NOT "run":
 *
 *   · it is COMPILED first, so a broken file says which line is wrong instead of half
 *     running and stopping somewhere;
 *   · what it would do is SHOWN before anything happens;
 *   · a script that grants itself nothing beyond BMM's own actions runs on one click;
 *   · one that wants to launch programs, run shell scripts, fire deeplinks or kill
 *     processes cannot be run until the permissions have actually been read.
 *
 * That last split is the point. Every action a task can take without a permission is
 * something the person could do by hand in the app — so a one-click run of those is no more
 * dangerous than the buttons already on screen. The four permission-gated capabilities are
 * the ones that reach outside BMM, and they are exactly the ones worth stopping for.
 *
 * Nothing here imports the task into the scheduler. Running a file once and keeping it
 * forever are different intentions, and the screen offers them as different buttons.
 */

import { t } from '../../core/i18n.js';
import { invoke } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { raiseAboveAll } from '../../ui/layer.js';
import { escHtml, escAttr } from '../../core/utils.js';

/** The capabilities a task must be granted. Mirrors TaskPerms / RISK_KEYS.
 *
 *  Four of them are about reaching OUTSIDE BMM; `delete` is the odd one, and the reason
 *  this comment no longer says "the four that reach outside" — it destroys the user's own
 *  data from the inside, which no external gate would ever see. */
const RISKY = ['command', 'script', 'deeplink', 'stopProcess', 'delete'] as const;

const PERM_LABEL: Record<string, () => string> = {
    command: () => t('bms.perm.command') || 'run external programs',
    script: () => t('bms.perm.script') || 'run scripts (PowerShell, Python, Bash…)',
    deeplink: () => t('bms.perm.deeplink') || 'fire bmm:// links, which reach anything the app exposes',
    stopProcess: () => t('bms.perm.stopProcess') || 'stop running programs',
    delete: () => t('bms.perm.delete') || 'delete profiles, modpacks and mod folders',
};

interface Compiled { ok: boolean; task?: any; errors?: { line: number; col: number; message: string }[] }

/** Read a .bmmscript, compile it, and show what it would do. */
export async function openBmmScriptFile(path: string): Promise<void> {
    let source: string;
    try {
        source = await invoke('read_file_text', { path }) as string;
    } catch (e) {
        toast(`${t('bms.unreadable') || 'Could not read that file'}: ${e}`, 'error');
        return;
    }

    let res: Compiled;
    try {
        res = await invoke('bmms_compile', { source }) as Compiled;
    } catch (e) {
        toast(`${t('common.error') || 'Error'}: ${e}`, 'error');
        return;
    }

    if (!res.ok) {
        const e = (res.errors || [])[0];
        // The position, because this is the first thing the author sees about a file they
        // may not have written — "it is broken" with no line is not something anyone can act on.
        toast(e
            ? `${t('bms.badfile') || 'This script does not compile'} — ${t('sched.bmms.line') || 'Line'} ${e.line}:${e.col} — ${e.message}`
            : (t('bms.badfile') || 'This script does not compile'), 'error');
        return;
    }

    showReview(path, source, res.task);
}

function fileName(p: string): string {
    return p.split(/[\\/]/).pop() || p;
}

/** A short, honest description of every step, without running anything. */
function describe(steps: any[], depth = 0): string[] {
    const out: string[] = [];
    const pad = '  '.repeat(depth);
    for (const st of steps || []) {
        const k = st?.kind;
        if (k === 'action') {
            const p = st.action?.params || {};
            // The script BODY is shown, not summarised: it is the part a reviewer most needs
            // to read, and "runs a script" tells them nothing about what it does.
            if (st.action?.type === 'custom.script') {
                out.push(`${pad}▸ ${t('bms.d.script') || 'run a'} ${p.engine || '?'} ${t('bms.d.scriptSuffix') || 'script'}:`);
                for (const line of String(p.code || '').split('\n').slice(0, 40)) out.push(`${pad}    ${line}`);
                continue;
            }
            const args = Object.entries(p).map(([kk, vv]) => `${kk}: ${String(vv).slice(0, 60)}`).join(', ');
            out.push(`${pad}▸ ${st.action?.type}${args ? `(${args})` : ''}`);
            continue;
        }
        if (k === 'parallel') {
            out.push(`${pad}▸ ${t('bms.d.parallel') || 'at the same time:'}`);
            for (const b of st.branches || []) out.push(...describe(b, depth + 1));
            continue;
        }
        if (k === 'if') {
            out.push(`${pad}▸ if ${st.condition?.type || 'always'}`);
            out.push(...describe(st.then, depth + 1));
            if (st.else?.length) { out.push(`${pad}  else`); out.push(...describe(st.else, depth + 1)); }
            continue;
        }
        for (const key of ['steps', 'onError', 'default'] as const) {
            if (Array.isArray((st as any)[key]) && (st as any)[key].length) {
                out.push(`${pad}▸ ${k}`);
                out.push(...describe((st as any)[key], depth + 1));
            }
        }
        if (!['action', 'parallel', 'if', 'repeat', 'forEach', 'try', 'switch'].includes(k)) out.push(`${pad}▸ ${k}`);
    }
    return out;
}

/**
 * What a task grants itself, from BOTH sources.
 *
 * Exported and pure because it is the security decision this whole screen exists to make,
 * and a decision buried inside a DOM builder cannot be tested. An empty list means the file
 * can be run on one click; anything in it means the person has to read first.
 *
 * `allowCustomCommands` is the legacy single flag. A file written by an older BMM carries
 * only that, and reading `perms` alone would show it as asking for nothing — the one case
 * where being wrong matters most.
 */
export function grantedPermissions(task: any): string[] {
    const out = RISKY.filter((k) => task?.perms?.[k] === true) as string[];
    if (task?.allowCustomCommands === true) {
        for (const k of ['command', 'deeplink']) if (!out.includes(k)) out.push(k);
    }
    return out;
}

function showReview(path: string, source: string, task: any): void {
    const perms = grantedPermissions(task);
    const safe = perms.length === 0;

    document.getElementById('bmms-open')?.remove();
    const ov = document.createElement('div');
    ov.id = 'bmms-open';
    ov.className = 'modal-overlay open';
    raiseAboveAll(ov, 11200);
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = () => {
        document.body.style.overflow = prevOverflow;
        document.removeEventListener('keydown', onKey);
        ov.remove();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);

    const lines = describe(task?.steps || []);
    ov.innerHTML = `
    <div class="modal glass" style="max-width:720px; width:94%; max-height:88vh; display:flex; flex-direction:column;">
        <div class="modal-header" style="flex-shrink:0;">
            <h3>${escHtml(t('bms.title') || 'Run this script?')}</h3>
            <button class="modal-close" type="button" data-x>&times;</button>
        </div>
        <div class="modal-body" style="flex:1; min-height:0; overflow:auto;">
            <div class="bms-file">${escHtml(fileName(path))}</div>
            <div class="bms-name">${escHtml(task?.name || 'Untitled')}</div>
            ${task?.description ? `<p class="bms-desc">${escHtml(task.description)}</p>` : ''}

            ${safe
        ? `<div class="bms-safe">${escHtml(t('bms.safe') || 'This script asks for nothing beyond BMM’s own actions — everything it does, you could do by hand in the app.')}</div>`
        : `<div class="bms-risky">
                    <div class="bms-risky-t">${escHtml(t('bms.grants') || 'It grants itself:')}</div>
                    <ul>${perms.map((k) => `<li>${escHtml(PERM_LABEL[k]?.() || k)}</li>`).join('')}</ul>
                    <div class="bms-risky-n">${escHtml(t('bms.riskynote') || 'Read the steps below before running it. These four are the only things a task can do that you could not do with the buttons in the app.')}</div>
                   </div>`}

            <div class="bms-sec">${escHtml(t('bms.what') || 'What it would do')}</div>
            <pre class="bms-steps">${escHtml(lines.join('\n') || (t('bms.nosteps') || 'Nothing — it has no steps.'))}</pre>

            <details class="bms-src">
                <summary>${escHtml(t('bms.source') || 'The file, as written')}</summary>
                <pre>${escHtml(source)}</pre>
            </details>
        </div>
        <div class="modal-footer" style="flex-shrink:0;">
            <button class="btn" data-x>${escHtml(t('common.cancel') || 'Cancel')}</button>
            <span style="flex:1"></span>
            <button class="btn" data-import>${escHtml(t('bms.import') || 'Add to my tasks')}</button>
            <button class="btn btn-primary" data-run ${safe ? '' : 'disabled'}
                title="${escAttr(safe ? '' : (t('bms.readfirst') || 'Tick “I have read what it does” first'))}">
                ${escHtml(t('bms.run') || 'Run it now')}
            </button>
        </div>
    </div>`;

    // The confirmation only exists when there is something to confirm. A checkbox on a
    // harmless file is a habit that teaches people to tick without reading.
    if (!safe) {
        const foot = ov.querySelector('.modal-footer') as HTMLElement;
        const lbl = document.createElement('label');
        lbl.className = 'bms-ack';
        lbl.innerHTML = `<input type="checkbox"> ${escHtml(t('bms.ack') || 'I have read what it does')}`;
        foot.insertBefore(lbl, foot.querySelector('[data-import]'));
        lbl.querySelector('input')?.addEventListener('change', (e) => {
            (ov.querySelector('[data-run]') as HTMLButtonElement).disabled = !(e.target as HTMLInputElement).checked;
        });
    }

    ov.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });

    ov.querySelector('[data-run]')?.addEventListener('click', async () => {
        close();
        try {
            const { runTaskOnce } = await import('./scheduler.js');
            await runTaskOnce(task);
        } catch (e) {
            toast(`${t('common.error') || 'Error'}: ${e}`, 'error');
        }
    });

    ov.querySelector('[data-import]')?.addEventListener('click', async () => {
        close();
        try {
            const { importTaskObject } = await import('./scheduler.js');
            await importTaskObject(task);
            toast(t('bms.imported') || 'Added to your tasks.', 'success');
        } catch (e) {
            toast(`${t('common.error') || 'Error'}: ${e}`, 'error');
        }
    });
}

/** Wire the two ways a file arrives: already running, and opened from cold. */
export async function initBmmScriptOpen(): Promise<void> {
    try {
        const { listen } = (window as any).__TAURI__.event;
        await listen('bmmscript-file-opened', (e: { payload: string }) => { void openBmmScriptFile(e.payload); });
    } catch { /* not under Tauri — nothing can open a file at us */ }
    try {
        const pending = await invoke('get_pending_script_file') as string | null;
        // The same delay the deep-link manager uses: the app has to have finished drawing
        // before a modal on top of it means anything.
        if (pending) setTimeout(() => { void openBmmScriptFile(pending); }, 500);
    } catch { /* nothing pending */ }
}
