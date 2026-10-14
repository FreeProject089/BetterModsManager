// BMM Tools: one dialog that gathers the diagnostics a mod library grows into.
//
// Opened from the command palette (category Tools, one entry per tool), from DevTools (its
// "Tools" section) and, when the person pins it, from the navbar (Customize the navbar →
// Modal → Tools). Loaded on demand from all three: nothing here is in the boot path.
//
// Layout: a searchable rail (icon, name, one line on what it does, grouped) and a pane with
// the tool's form, then ONE results area that is always in one of four states: not run yet,
// running (progress and Cancel for the tools that walk folders), failed (the message and
// Retry), or done (a summary line, the export bar, the findings).
//
// Every tool READS, except the cache cleaner, which measures first and deletes only the fixed
// cache folders the person ticked, after a confirmation that names their size. Each finding
// carries an "open folder" and the person decides. Backend work lives in
// src-tauri/src/commands/tools.rs; the hash checker, the conflict summary and the validators
// reuse commands that already existed (hash_file, file_meta, get_all_mod_conflicts,
// get_conflict_file_tree, bmm_validate). The long scans also appear in the activity centre
// (core/activity-sources.ts COMMANDS, channel `tools`).
//
// The thinking (hash comparison, conflict pairs, CSV rows, log filter) is in tools-model.ts,
// tested in node.

import { invoke, listen, pickFile, saveFile } from '../../core/api.js';
import { t, getLang } from '../../core/i18n.js';
import { escHtml, escAttr, formatBytes } from '../../core/utils.js';
import { openModal, type ModalHandle } from '../../ui/modal-shell.js';
import { showConfirm } from '../../ui/confirm.js';
import { uiIcon } from '../../ui/icons.js';
import {
    TOOLS, TOOL_GROUPS, LINKED_COMMANDS, isToolId, isLongTool, filterTools, compareHash, hashAlgoHint,
    normalizeHash, toCsv, conflictPairs, rowsFor, findingCount, progressPct, filterLog, cacheSelection,
    type ToolId,
} from './tools-model.js';

const CSS_ID = 'tools-hub-css';
function ensureCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/tools-hub.css';
    document.head.appendChild(link);
}

/** The catalogue validator: `catalog_validate` (commands/catalog_convert.rs), args
 *  `{ text, path, kind?, sourceUrl? }`, answer `ValidateReport`, read by catalogReport(). */
const CATALOG_VALIDATE = 'catalog_validate';

const esc = (x: unknown) => escHtml(String(x ?? ''));
// ui/app's toast through the window: importing ui/app from here would close an import cycle
// (ui/app → … → core/commands → this module).
const toast = (msg: string, kind = 'info', ms?: number) => { try { (window as any).toast?.(msg, kind, ms); } catch { /* no toast host */ } };
/** "Exported → <folder>", like ui/app's toastSaved. */
const toastSaved = (msg: string, path: string) => toast(`${msg} → ${parentDir(path)}`, 'success', 6000);
const ICON_HUB = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';

let _h: ModalHandle | null = null;
let _active: ToolId = 'duplicates';
/** The tool running right now (one at a time), or null. */
let _running: ToolId | null = null;
let _search = '';
const _results: Partial<Record<ToolId, any>> = {};
const _inputs: {
    hashPath?: string; validatePath?: string; diffA?: string; diffB?: string;
    logId?: string; logText?: string; logLevel?: string; logQ?: string; logList?: any[];
    cacheIds?: string[];
} = {};
let _unlisten: (() => void) | null = null;
let _profiles: { id: string; name: string }[] = [];
/** The palette's command list, handed in by core/commands.ts (importing it from here would
 *  close an import cycle: the palette loads this module). */
let _commands: () => any[] = () => [];
const allCommands = () => { try { return _commands() || []; } catch { return []; } };

const toolName = (id: ToolId) => t(`tools.${id}.name`);
const toolDesc = (id: ToolId) => t(`tools.${id}.desc`);
/** The one line under the name in the rail. */
const toolShort = (id: ToolId) => t(`tools.${id}.short`);
const toolMeta = (id: ToolId) => TOOLS.find((x) => x.id === id)!;
const parentDir = (p: string) => String(p || '').replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');

async function openFolder(path: string): Promise<void> {
    if (!path) return;
    try { await invoke('open_folder', { path }); } catch (e) { toast(`${t('tools.err.openFolder')} ${String(e).slice(0, 120)}`, 'error'); }
}

/** A folder button. `dir` = the path IS a folder; otherwise its containing folder opens (a
 *  file handed to the file manager would be opened, not shown). */
function folderBtn(path: string, dir = false): string {
    if (!path) return '';
    const target = dir ? path : parentDir(path);
    return `<button type="button" class="btn btn-ghost btn-sm tools-icon-btn" data-open="${escAttr(target)}" data-tooltip="${escAttr(t('tools.openFolder'))}" aria-label="${escAttr(t('tools.openFolder'))}">${uiIcon('open-folder', 14)}</button>`;
}

// ── Open / mount ─────────────────────────────────────────────────────────────────────────

/** Open the hub, on `tool` when given. Re-focuses it (and switches tool) when already open. */
export async function openToolsHub(tool?: string, commands?: () => any[]): Promise<void> {
    ensureCss();
    if (typeof commands === 'function') _commands = commands;
    if (isToolId(tool)) _active = tool;
    if (_h && _h.overlay.isConnected) { renderRail(); renderPane(); return; }
    try { _profiles = ((await invoke('get_profiles')) as any[] || []).map((p) => ({ id: String(p.id), name: String(p.name || p.id) })); } catch { _profiles = []; }
    _h = openModal({
        title: t('tools.title'),
        subtitle: t('tools.subtitle'),
        icon: ICON_HUB,
        size: 'xl',
        tall: true,
        className: 'tools-modal',
        body: `<div class="tools-hub">
            <nav class="tools-rail" aria-label="${escAttr(t('tools.title'))}">
                <label class="tools-search">${uiIcon('search', 14)}
                    <input type="search" class="input-field" id="tools-search" placeholder="${escAttr(t('tools.searchPh'))}" aria-label="${escAttr(t('tools.searchPh'))}" autocomplete="off"></label>
                <div class="tools-rail-list"></div>
            </nav>
            <section class="tools-pane" aria-live="polite"></section></div>`,
        onClose: () => {
            if (_running) void invoke('tools_cancel').catch(() => {});
            _unlisten?.(); _unlisten = null; _h = null; _running = null;
        },
    });
    try {
        _unlisten = await listen('tools-progress', (p: any) => {
            if (!_h || p?.tool == null || !_running) return;
            const map: Record<string, ToolId> = { duplicates: 'duplicates', disk: 'disk', largefiles: 'largefiles', deployed: 'deployed' };
            if (map[p.tool] !== _active || _running !== _active) return;
            setProgress(p.phase, p.done, p.total);
        });
    } catch { /* no progress events outside Tauri: the spinner text stays */ }
    _h.body.addEventListener('click', onClick);
    _h.body.addEventListener('input', onInput);
    _h.body.addEventListener('change', onChange);
    renderRail();
    renderPane();
}

/** DevTools → Tools: one card per tool, each opening the hub on it. */
export function mountToolsDebug(host: HTMLElement): void {
    host.innerHTML = `
        <div class="debug-pane-pad">
            <p class="debug-pane-intro">${esc(t('tools.debugIntro'))}</p>
            <div class="debug-studio-grid">
                ${TOOLS.map((x) => `
                <section class="debug-studio-card">
                    <div class="debug-studio-head">
                        <span class="debug-studio-icon" aria-hidden="true">${uiIcon(x.icon as any, 16)}</span>
                        <h4>${esc(toolName(x.id))}</h4>
                    </div>
                    <p class="debug-hint">${esc(toolDesc(x.id))}</p>
                    <button type="button" class="debug-btn debug-btn-primary debug-btn-sm" data-tools-open="${x.id}">${esc(t('tools.open'))}</button>
                </section>`).join('')}
            </div>
        </div>`;
    host.querySelectorAll<HTMLElement>('[data-tools-open]').forEach((b) =>
        b.addEventListener('click', () => {
            // Through the palette's opener when it is there, so the hub gets the command list.
            const w = window as any;
            if (typeof w.openToolsHub === 'function') w.openToolsHub(b.dataset.toolsOpen);
            else void openToolsHub(b.dataset.toolsOpen);
        }));
}

// ── Rail ─────────────────────────────────────────────────────────────────────────────────

function groupName(g: string): string {
    switch (g) {
        case 'library': return t('tools.group.library');
        case 'profiles': return t('tools.group.profiles');
        case 'space': return t('tools.group.space');
        case 'app': return t('tools.group.app');
        default: return t('tools.group.author');
    }
}

function renderRail(): void {
    const rail = _h?.q('.tools-rail-list');
    if (!rail) return;
    const shown = filterTools(TOOLS, _search, (x) => `${toolName(x.id)} ${toolShort(x.id)} ${toolDesc(x.id)}`);
    const btn = (x: typeof TOOLS[number]) => {
        const r = _results[x.id];
        const done = r != null && !r.__error;
        const n = findingCount(x.id, r);
        const state = _running === x.id
            ? `<span class="tools-badge is-run" aria-label="${escAttr(t('tools.state.running'))}">${uiIcon('loader', 12)}</span>`
            : r?.__error ? `<span class="tools-badge is-bad">!</span>`
            : done ? `<span class="tools-badge${n ? ' is-warn' : ' is-ok'}">${n ? n : uiIcon('check', 12)}</span>` : '';
        return `<button type="button" class="tools-rail-item${x.id === _active ? ' is-active' : ''}" data-tool="${x.id}" aria-current="${x.id === _active ? 'true' : 'false'}">
            <span class="tools-rail-ic" aria-hidden="true">${uiIcon(x.icon as any, 16)}</span>
            <span class="tools-rail-txt" title="${escAttr(`${toolName(x.id)}: ${toolShort(x.id)}`)}"><span class="tools-rail-name">${esc(toolName(x.id))}</span><span class="tools-rail-desc">${esc(toolShort(x.id))}</span></span>
            ${state}
        </button>`;
    };
    const lang = getLang() === 'fr' ? 'fr' : 'en';
    const cmds = allCommands();
    const linked = LINKED_COMMANDS.map((id) => cmds.find((c) => c.id === id)).filter(Boolean) as any[];
    const groups = TOOL_GROUPS.map((g) => {
        const list = shown.filter((x) => x.group === g);
        return list.length ? `<div class="tools-rail-group">${esc(groupName(g))}</div>${list.map(btn).join('')}` : '';
    }).join('');
    rail.innerHTML = (groups || `<p class="tools-rail-none">${esc(t('tools.searchNone'))}</p>`)
        + (linked.length && !_search.trim() ? `<div class="tools-rail-group">${esc(t('tools.group.more'))}</div>
        ${linked.map((c) => `<button type="button" class="tools-rail-item is-link" data-cmd="${escAttr(c.id)}">
            <span class="tools-rail-ic" aria-hidden="true">${uiIcon('external', 14)}</span>
            <span class="tools-rail-txt"><span class="tools-rail-name">${esc(c.title?.[lang] || c.id)}</span></span></button>`).join('')}` : '');
}

// ── Pane ─────────────────────────────────────────────────────────────────────────────────

function profileOptions(selected?: string, withAll = false): string {
    const all = withAll ? `<option value="">${esc(t('tools.allProfiles'))}</option>` : '';
    return all + _profiles.map((p) => `<option value="${escAttr(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
}

function pickRow(act: string, label: string, path: string | undefined, id: string, clearAct = ''): string {
    return `<div class="tools-field tools-grow"><span>${esc(label)}</span>
        <div class="tools-pick"><button type="button" class="btn btn-secondary btn-sm" data-act="${act}">${uiIcon('file', 14)} ${esc(t('tools.pickFile'))}</button>
        <code class="tools-path" id="${id}">${esc(path || t('tools.noFile'))}</code>
        ${clearAct && path ? `<button type="button" class="btn btn-ghost btn-sm" data-act="${clearAct}">${esc(t('tools.clear'))}</button>` : ''}</div></div>`;
}

function formHtml(id: ToolId): string {
    const runLabel = id === 'cache' ? t('tools.cache.measure') : id === 'logs' ? t('tools.logs.load') : t('tools.run');
    const run = `<button type="button" class="btn btn-primary btn-sm" data-act="run">${uiIcon(id === 'logs' ? 'file-text' : 'play', 14)} ${esc(runLabel)}</button>`;
    switch (id) {
        case 'duplicates':
            return `<label class="tools-field"><span>${esc(t('tools.duplicates.minSize'))}</span>
                <input type="number" class="input-field tools-num" id="tools-dup-min" min="0" max="1048576" value="64"></label>${run}`;
        case 'conflicts':
            return `<label class="tools-field"><span>${esc(t('tools.profile'))}</span>
                <select class="input-field" id="tools-cf-profile">${profileOptions(undefined, true)}</select></label>${run}`;
        case 'deployed':
            return `<label class="tools-field"><span>${esc(t('tools.profile'))}</span>
                <select class="input-field" id="tools-dep-profile">${profileOptions(undefined, true)}</select></label>${run}`;
        case 'largefiles':
            return `<label class="tools-field"><span>${esc(t('tools.profile'))}</span>
                    <select class="input-field" id="tools-lf-profile">${profileOptions(undefined, true)}</select></label>
                <label class="tools-field"><span>${esc(t('tools.largefiles.minMb'))}</span>
                    <input type="number" class="input-field tools-num" id="tools-lf-min" min="1" max="1048576" value="50"></label>
                <label class="tools-field"><span>${esc(t('tools.largefiles.limit'))}</span>
                    <input type="number" class="input-field tools-num" id="tools-lf-limit" min="1" max="500" value="50"></label>${run}`;
        case 'dupprofiles':
            return `<label class="tools-field"><span>${esc(t('tools.dupprofiles.threshold'))}</span>
                <select class="input-field" id="tools-dp-th">${[1, 0.9, 0.8, 0.6].map((v) => `<option value="${v}"${v === 0.8 ? ' selected' : ''}>${Math.round(v * 100)} %</option>`).join('')}</select></label>${run}`;
        case 'diff': {
            if (_profiles.length < 2) return `<p class="tools-note">${esc(t('tools.diff.needTwo'))}</p>`;
            return `<label class="tools-field"><span>${esc(t('tools.diff.a'))}</span>
                <select class="input-field" id="tools-diff-a">${profileOptions(_profiles[0]?.id)}</select></label>
                <label class="tools-field"><span>${esc(t('tools.diff.b'))}</span>
                <select class="input-field" id="tools-diff-b">${profileOptions(_profiles[1]?.id)}</select></label>${run}`;
        }
        case 'logs': {
            const list = _inputs.logList || [{ id: 'current', kind: 'current' }];
            const label = (x: any) => x.id === 'current' ? t('tools.logs.current')
                : `${x.kind === 'crash' ? t('tools.logs.crash') : t('tools.logs.session')} · ${new Date((x.modified || 0) * 1000).toLocaleString()}${x.archived ? ` · ${t('tools.logs.archived')}` : ''}`;
            return `<label class="tools-field tools-grow"><span>${esc(t('tools.logs.which'))}</span>
                    <select class="input-field" id="tools-log-id">${list.map((x: any) => `<option value="${escAttr(x.id)}"${x.id === (_inputs.logId || 'current') ? ' selected' : ''}>${esc(label(x))}</option>`).join('')}</select></label>
                <label class="tools-field"><span>${esc(t('tools.logs.level'))}</span>
                    <select class="input-field" id="tools-log-level">${['all', 'warn', 'error'].map((v) => `<option value="${v}"${(_inputs.logLevel || 'all') === v ? ' selected' : ''}>${esc(v === 'all' ? t('tools.logs.lvAll') : v === 'warn' ? t('tools.logs.lvWarn') : t('tools.logs.lvError'))}</option>`).join('')}</select></label>
                <label class="tools-field tools-grow"><span>${esc(t('tools.logs.filter'))}</span>
                    <input type="search" class="input-field" id="tools-log-q" value="${escAttr(_inputs.logQ || '')}" placeholder="${escAttr(t('tools.logs.filterPh'))}" autocomplete="off"></label>${run}`;
        }
        case 'cache':
            return `<p class="tools-note tools-full">${esc(t('tools.cache.how'))}</p>${run}`;
        case 'hash':
            return pickRow('pick-hash', t('tools.hash.file'), _inputs.hashPath, 'tools-hash-path')
                + `<label class="tools-field"><span>${esc(t('tools.hash.algo'))}</span>
                    <select class="input-field" id="tools-hash-algo"><option value="blake3">BLAKE3</option><option value="sha256">SHA-256</option></select></label>
                <label class="tools-field tools-grow"><span>${esc(t('tools.hash.expected'))}</span>
                    <input type="text" class="input-field tools-mono" id="tools-hash-expected" spellcheck="false" autocomplete="off" placeholder="${escAttr(t('tools.hash.expectedPh'))}"></label>${run}`;
        case 'validate':
            return `<label class="tools-field"><span>${esc(t('tools.validate.kind'))}</span>
                    <select class="input-field" id="tools-val-kind"><option value="auto">${esc(t('tools.validate.kindAuto'))}</option><option value="catalog">${esc(t('tools.validate.kindCatalog'))}</option></select></label>
                ${pickRow('pick-validate', t('tools.validate.file'), _inputs.validatePath, 'tools-val-path', 'clear-validate')}
                <label class="tools-field tools-full"><span>${esc(t('tools.validate.text'))}</span>
                    <textarea class="input-field tools-mono" id="tools-val-text" rows="4" spellcheck="false" placeholder="${escAttr(t('tools.validate.textPh'))}"></textarea></label>${run}`;
        case 'jsondiff':
            return pickRow('pick-diff-a', t('tools.jsondiff.a'), _inputs.diffA, 'tools-jd-a')
                + pickRow('pick-diff-b', t('tools.jsondiff.b'), _inputs.diffB, 'tools-jd-b') + run;
        default:
            return run;
    }
}

function renderPane(): void {
    const pane = _h?.q('.tools-pane');
    if (!pane) return;
    const id = _active;
    const meta = toolMeta(id);
    pane.innerHTML = `
        <header class="tools-pane-head">
            <span class="tools-pane-ic" aria-hidden="true">${uiIcon(meta.icon as any, 18)}</span>
            <div class="tools-pane-titles">
                <h3 class="tools-pane-title">${esc(toolName(id))}</h3>
                <p class="tools-pane-desc">${esc(toolDesc(id))}</p>
            </div>
            <p class="tools-pane-safe${meta.writes ? ' is-writes' : ''}">${uiIcon(meta.writes ? 'alert' : 'shield-check', 12)} ${esc(meta.writes ? t('tools.writesAfterConfirm') : t('tools.readOnly'))}</p>
        </header>
        <div class="tools-form">${formHtml(id)}</div>
        <div class="tools-out">${outHtml(id)}</div>`;
    if (_running === id) showRunning(true);
}

/** The results area: not run · running · failed · done. */
function outHtml(id: ToolId): string {
    const r = _results[id];
    const progress = `<div class="tools-progress" hidden>
            <div class="tools-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
            <span class="tools-progress-txt"></span>
            <button type="button" class="btn btn-ghost btn-sm" data-act="cancel"${isLongTool(id) ? '' : ' hidden'}>${uiIcon('stop', 14)} ${esc(t('tools.cancel'))}</button>
        </div>`;
    if (r == null) {
        return progress + `<div class="tools-state is-idle">${uiIcon(toolMeta(id).icon as any, 24)}
            <p class="tools-state-title">${esc(t('tools.notRun'))}</p>
            <p class="tools-state-sub">${esc(t('tools.notRunSub'))}</p></div>`;
    }
    if (r.__error) {
        return progress + `<div class="tools-state is-error" role="alert">${uiIcon('error', 24)}
            <p class="tools-state-title">${esc(t('tools.err.title'))}</p>
            <p class="tools-state-sub tools-mono">${esc(r.__error)}</p>
            <button type="button" class="btn btn-secondary btn-sm" data-act="run">${uiIcon('refresh', 14)} ${esc(t('tools.retry'))}</button></div>`;
    }
    const exportable = id !== 'cache' || (r.items || []).length;
    return progress + `<div class="tools-result-bar">
            <span class="tools-result-when">${esc(t('tools.ranAt', { time: new Date(r.__at || Date.now()).toLocaleTimeString() }))}</span>
            ${exportable ? `<span class="tools-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-act="copy">${uiIcon('copy', 14)} ${esc(t('tools.copyJson'))}</button>
                <button type="button" class="btn btn-ghost btn-sm" data-act="json">${uiIcon('download', 14)} ${esc(t('tools.saveJson'))}</button>
                <button type="button" class="btn btn-ghost btn-sm" data-act="csv">${uiIcon('download', 14)} ${esc(t('tools.saveCsv'))}</button>
            </span>` : ''}
        </div>
        <div class="tools-results">${resultHtml(id, r)}</div>`;
}

function showRunning(on: boolean, text?: string): void {
    const pane = _h?.q('.tools-pane');
    if (!pane) return;
    const pr = pane.querySelector<HTMLElement>('.tools-progress');
    if (pr) pr.hidden = !on;
    pane.querySelectorAll<HTMLElement>('.tools-state, .tools-result-bar, .tools-results').forEach((el) => { el.hidden = on; });
    pane.querySelectorAll<HTMLButtonElement>('[data-act="run"]').forEach((b) => { b.disabled = on; });
    if (on) setProgress('start', 0, 0, text);
}

function setProgress(phase: string, done: number, total: number, text?: string): void {
    const pane = _h?.q('.tools-pane');
    if (!pane) return;
    const pct = progressPct(done, total);
    const bar = pane.querySelector<HTMLElement>('.tools-bar');
    const fill = bar?.querySelector<HTMLElement>('span');
    if (bar && fill) {
        bar.classList.toggle('is-indeterminate', pct == null);
        fill.style.width = pct == null ? '' : `${pct}%`;
        if (pct != null) bar.setAttribute('aria-valuenow', String(pct)); else bar.removeAttribute('aria-valuenow');
    }
    const txt = pane.querySelector<HTMLElement>('.tools-progress-txt');
    if (txt) {
        const key = `tools.phase.${phase}`;
        const label = text || (t(key) !== key ? t(key) : t('tools.phase.start'));
        txt.textContent = pct == null ? label : `${label} ${done} / ${total}`;
    }
}

// ── Results ──────────────────────────────────────────────────────────────────────────────

function summary(text: string, tone: 'ok' | 'warn' | 'info' = 'info'): string {
    return `<p class="tools-summary is-${tone}">${esc(text)}</p>`;
}
const none = (key: string) => `<p class="tools-empty">${uiIcon('check', 14)} ${esc(t(key))}</p>`;
const pct = (v: number) => `${Math.round((Number(v) || 0) * 100)} %`;

function deployedKind(k: string): string {
    switch (k) {
        case 'mod_folder_missing': return t('tools.deployed.k.mod_folder_missing');
        case 'missing_target': return t('tools.deployed.k.missing_target');
        case 'broken_link': return t('tools.deployed.k.broken_link');
        case 'missing_source': return t('tools.deployed.k.missing_source');
        case 'unsafe_path': return t('tools.deployed.k.unsafe_path');
        case 'no_file_list': return t('tools.deployed.k.no_file_list');
        default: return t('tools.deployed.k.stale_link');
    }
}
function deployedHint(k: string): string {
    switch (k) {
        case 'mod_folder_missing': return t('tools.deployed.h.mod_folder_missing');
        case 'missing_target': return t('tools.deployed.h.missing_target');
        case 'broken_link': return t('tools.deployed.h.broken_link');
        case 'missing_source': return t('tools.deployed.h.missing_source');
        case 'unsafe_path': return t('tools.deployed.h.unsafe_path');
        case 'no_file_list': return t('tools.deployed.h.no_file_list');
        default: return t('tools.deployed.h.stale_link');
    }
}
function nameIssue(code: string): string {
    switch (code) {
        case 'trim': return t('tools.names.i.trim');
        case 'spaces': return t('tools.names.i.spaces');
        case 'separators': return t('tools.names.i.separators');
        case 'version_in_name': return t('tools.names.i.version_in_name');
        case 'version_empty': return t('tools.names.i.version_empty');
        case 'version_prefix': return t('tools.names.i.version_prefix');
        default: return t('tools.names.i.version_format');
    }
}
function cacheName(id: string): string {
    switch (id) {
        case 'catalog_cache': return t('tools.cache.t.catalog_cache');
        case 'mod_cache': return t('tools.cache.t.mod_cache');
        case 'update_leftovers': return t('tools.cache.t.update_leftovers');
        default: return t('tools.cache.t.crash_archive');
    }
}
function cacheHint(id: string): string {
    switch (id) {
        case 'catalog_cache': return t('tools.cache.h.catalog_cache');
        case 'mod_cache': return t('tools.cache.h.mod_cache');
        case 'update_leftovers': return t('tools.cache.h.update_leftovers');
        default: return t('tools.cache.h.crash_archive');
    }
}

function resultHtml(id: ToolId, r: any): string {
    switch (id) {
        case 'duplicates': {
            const n = (r.mod_groups?.length || 0) + (r.file_groups?.length || 0);
            const head = summary(t('tools.duplicates.summary', {
                m: String(r.mod_groups?.length || 0), f: String(r.file_groups?.length || 0),
                w: formatBytes(r.wasted_bytes || 0), s: String(r.files_scanned || 0), h: String(r.files_hashed || 0),
            }), n ? 'warn' : 'ok');
            const notes = [
                r.truncated ? `<p class="tools-note">${esc(t('tools.duplicates.truncated'))}</p>` : '',
                r.cancelled ? `<p class="tools-note">${esc(t('tools.cancelled'))}</p>` : '',
            ].join('');
            if (!n) return head + notes + none('tools.duplicates.none');
            const mods = (r.mod_groups || []).map((g: any) => `
                <div class="tools-group">
                    <div class="tools-group-head">${uiIcon('package', 14)} <b>${esc(g.mods[0]?.name)}</b> <span class="tools-chip">${esc(t('tools.duplicates.copies', { n: String(g.mods.length) }))}</span></div>
                    ${g.mods.map((m: any) => `<div class="tools-row"><span class="tools-row-main">${esc(m.name)} <span class="tools-muted">${esc(m.version)}</span></span>
                        <span class="tools-chip">${esc(m.profile_name || t('tools.noProfile'))}</span><code class="tools-path">${esc(m.path)}</code>${folderBtn(m.path)}</div>`).join('')}
                </div>`).join('');
            const files = (r.file_groups || []).slice(0, 200).map((g: any) => `
                <div class="tools-group">
                    <div class="tools-group-head">${uiIcon('file', 14)} <b>${esc(formatBytes(g.size))}</b> × ${g.files.length}
                        <span class="tools-chip is-warn">${esc(t('tools.duplicates.wasted', { w: formatBytes(g.wasted) }))}</span>
                        <code class="tools-hash" title="${escAttr(g.hash)}">${esc(String(g.hash).slice(0, 16))}…</code></div>
                    ${g.files.map((f: any) => `<div class="tools-row"><span class="tools-row-main">${esc(f.mod_name)}</span><code class="tools-path">${esc(f.path)}</code>${folderBtn(f.path)}</div>`).join('')}
                </div>`).join('');
            const more = (r.file_groups?.length || 0) > 200 ? `<p class="tools-note">${esc(t('tools.moreInExport', { n: String(r.file_groups.length - 200) }))}</p>` : '';
            return head + notes
                + (r.mod_groups?.length ? `<h4 class="tools-h">${esc(t('tools.duplicates.modsTitle'))}</h4>${mods}` : '')
                + (r.file_groups?.length ? `<h4 class="tools-h">${esc(t('tools.duplicates.filesTitle'))}</h4>${files}${more}` : '');
        }
        case 'conflicts': {
            const pairs = r as any[];
            const active = pairs.filter((p) => p.active).length;
            const head = summary(t('tools.conflicts.summary', { n: String(pairs.length), a: String(active) }), pairs.length ? 'warn' : 'ok');
            if (!pairs.length) return head + none('tools.conflicts.none');
            return head + pairs.slice(0, 300).map((p, i) => `
                <div class="tools-group">
                    <div class="tools-row">
                        <span class="tools-chip ${p.active ? 'is-bad' : 'is-warn'}">${esc(t(p.active ? 'tools.conflicts.active' : 'tools.conflicts.potential'))}</span>
                        <span class="tools-row-main"><b>${esc(p.aName)}</b> ↔ <b>${esc(p.bName)}</b>${p.inter && p.otherProfile ? ` <span class="tools-muted">(${esc(p.otherProfile)})</span>` : ''}</span>
                        <span class="tools-chip">${esc(t('tools.conflicts.files', { n: String(p.files) }))}</span>
                        <button type="button" class="btn btn-ghost btn-sm" data-act="cf-files" data-i="${i}">${esc(t('tools.conflicts.showFiles'))}</button>
                    </div>
                    <div class="tools-cf-files" data-cf="${i}" hidden></div>
                </div>`).join('')
                + (pairs.length > 300 ? `<p class="tools-note">${esc(t('tools.moreInExport', { n: String(pairs.length - 300) }))}</p>` : '');
        }
        case 'disk': {
            const head = summary(t('tools.disk.summary', { t: formatBytes(r.total_bytes || 0), p: String(r.profiles?.length || 0) }), 'info')
                + (r.cancelled ? `<p class="tools-note">${esc(t('tools.cancelled'))}</p>` : '');
            const max = Math.max(1, ...(r.profiles || []).map((p: any) => p.mods_bytes + p.backup_bytes), ...(r.app_data || []).map((x: any) => x.bytes));
            const bar = (b: number) => `<span class="tools-size-bar" aria-hidden="true"><span style="width:${Math.max(1, Math.round((b / max) * 100))}%"></span></span>`;
            const profiles = (r.profiles || []).map((p: any) => `
                <div class="tools-group">
                    <div class="tools-group-head">${uiIcon('profile', 14)} <b>${esc(p.name)}</b> <span class="tools-chip">${esc(formatBytes(p.mods_bytes + p.backup_bytes))}</span></div>
                    <div class="tools-row"><span class="tools-row-main">${esc(t('tools.disk.mods'))}</span>${bar(p.mods_bytes)}<span class="tools-num-cell">${esc(formatBytes(p.mods_bytes))}</span>${folderBtn(p.mods_path, true)}</div>
                    <div class="tools-row"><span class="tools-row-main">${esc(t('tools.disk.backups'))}</span>${bar(p.backup_bytes)}<span class="tools-num-cell">${esc(formatBytes(p.backup_bytes))}</span>${folderBtn(p.backup_path, true)}</div>
                    ${(p.mods || []).length ? `<details class="tools-details"><summary>${esc(t('tools.disk.perMod', { n: String(p.mods.length) }))}</summary>
                        ${p.mods.slice(0, 100).map((m: any) => `<div class="tools-row"><span class="tools-row-main">${esc(m.name)}</span>${bar(m.bytes)}<span class="tools-num-cell">${esc(formatBytes(m.bytes))}</span>${folderBtn(m.path)}</div>`).join('')}
                    </details>` : ''}
                </div>`).join('');
            const app = (r.app_data || []).length ? `
                <h4 class="tools-h">${esc(t('tools.disk.appData'))} ${folderBtn(r.app_data_path, true)}</h4>
                <div class="tools-group">${r.app_data.slice(0, 60).map((x: any) => `<div class="tools-row"><code class="tools-row-main">${esc(x.name)}</code>${bar(x.bytes)}<span class="tools-num-cell">${esc(formatBytes(x.bytes))}</span></div>`).join('')}</div>` : '';
            return head + (profiles || none('tools.disk.none')) + app;
        }
        case 'largefiles': {
            const files = r.files || [];
            const head = summary(t('tools.largefiles.summary', { n: String(files.length), s: String(r.files_scanned || 0), t: formatBytes(r.bytes_scanned || 0), m: formatBytes(r.min_bytes || 0) }), files.length ? 'warn' : 'ok')
                + (r.cancelled ? `<p class="tools-note">${esc(t('tools.cancelled'))}</p>` : '');
            if (!files.length) return head + none('tools.largefiles.none');
            const max = Math.max(1, ...files.map((f: any) => f.bytes));
            return head + `<div class="tools-group">${files.map((f: any) => `<div class="tools-row">
                    <span class="tools-num-cell">${esc(formatBytes(f.bytes))}</span>
                    <span class="tools-size-bar" aria-hidden="true"><span style="width:${Math.max(1, Math.round((f.bytes / max) * 100))}%"></span></span>
                    <span class="tools-row-main">${esc(f.mod_name || '')}${f.mod_name ? ' ' : ''}<span class="tools-chip">${esc(f.area === 'backups' ? t('tools.disk.backups') : t('tools.disk.mods'))}</span> <span class="tools-muted">${esc(f.profile_name)}</span></span>
                    <code class="tools-path">${esc(f.path)}</code>${folderBtn(f.path)}</div>`).join('')}</div>`;
        }
        case 'deployed': {
            const items = r.items || [];
            const real = items.filter((x: any) => x.kind !== 'no_file_list');
            const head = summary(t('tools.deployed.summary', { n: String(real.length), p: String(r.profiles_checked || 0), m: String(r.mods_checked || 0), f: String(r.files_checked || 0) }), real.length ? 'warn' : 'ok')
                + (r.truncated ? `<p class="tools-note">${esc(t('tools.moreInExport', { n: '…' }))}</p>` : '')
                + (r.cancelled ? `<p class="tools-note">${esc(t('tools.cancelled'))}</p>` : '');
            if (!items.length) return head + none('tools.deployed.none');
            const kinds = ['mod_folder_missing', 'missing_target', 'broken_link', 'stale_link', 'missing_source', 'unsafe_path', 'no_file_list'];
            return head + kinds.map((k) => {
                const list = items.filter((x: any) => x.kind === k);
                if (!list.length) return '';
                return `<h4 class="tools-h">${esc(deployedKind(k))} <span class="tools-chip">${list.length}</span></h4>
                    <p class="tools-note">${esc(deployedHint(k))}</p>
                    <div class="tools-group">${list.slice(0, 300).map((x: any) => `<div class="tools-row">
                        <span class="tools-row-main">${esc(x.mod_name || t('tools.deployed.noMod'))}</span>
                        <span class="tools-chip">${esc(x.profile_name)}</span>
                        <code class="tools-path">${esc(x.path)}</code>${k === 'unsafe_path' ? '' : folderBtn(x.path, k === 'mod_folder_missing' || k === 'no_file_list')}</div>`).join('')}
                    ${list.length > 300 ? `<p class="tools-note">${esc(t('tools.moreInExport', { n: String(list.length - 300) }))}</p>` : ''}</div>`;
            }).join('');
        }
        case 'names': {
            const mods = r.mods || [];
            const head = summary(t('tools.names.summary', { n: String(mods.length), m: String(r.mods_checked || 0) }), mods.length ? 'warn' : 'ok');
            if (!mods.length) return head + none('tools.names.none');
            return head + `<p class="tools-note">${esc(t('tools.names.note'))}</p><div class="tools-group">${mods.slice(0, 400).map((m: any) => `<div class="tools-row tools-row-top">
                    <span class="tools-row-main"><b>${esc(m.name)}</b> <span class="tools-muted">${esc(m.version || '—')}</span>${m.profile_name ? ` <span class="tools-chip">${esc(m.profile_name)}</span>` : ''}
                    <ul class="tools-list">${m.issues.map((i: any) => `<li>${esc(nameIssue(i.code))}${i.suggestion ? `: <code class="tools-mono">${esc(i.suggestion)}</code>` : ''}</li>`).join('')}</ul></span></div>`).join('')}</div>
                ${mods.length > 400 ? `<p class="tools-note">${esc(t('tools.moreInExport', { n: String(mods.length - 400) }))}</p>` : ''}`;
        }
        case 'dupprofiles': {
            const pairs = r.pairs || [];
            const head = summary(t('tools.dupprofiles.summary', { n: String(pairs.length), p: String(r.profiles_checked || 0) }), pairs.length ? 'warn' : 'ok');
            if (!pairs.length) return head + none('tools.dupprofiles.none');
            return head + `<div class="tools-group">${pairs.map((p: any) => `<div class="tools-row">
                    <span class="tools-row-main"><b>${esc(p.a_name)}</b> ↔ <b>${esc(p.b_name)}</b></span>
                    <span class="tools-chip${p.identical ? ' is-warn' : ''}">${esc(p.identical ? t('tools.dupprofiles.identical') : t('tools.dupprofiles.similar', { p: pct(p.similarity) }))}</span>
                    <span class="tools-muted">${esc(t('tools.dupprofiles.counts', { s: String(p.shared), a: String(p.only_a), b: String(p.only_b) }))}</span>
                    ${p.same_game_path ? `<span class="tools-chip is-bad">${esc(t('tools.dupprofiles.sameGame'))}</span>` : ''}
                    ${p.same_mods_path ? `<span class="tools-chip is-warn">${esc(t('tools.dupprofiles.sameMods'))}</span>` : ''}</div>`).join('')}</div>`;
        }
        case 'cache': {
            const items = r.items || [];
            const sel = new Set(_inputs.cacheIds || items.filter((c: any) => c.id !== 'crash_archive').map((c: any) => c.id));
            const chosen = cacheSelection(r, [...sel] as string[]);
            const cleaned = r.cleaned ? summary(t('tools.cache.cleaned', { b: formatBytes(r.cleaned.freed_bytes || 0) }), (r.cleaned.errors || []).length ? 'warn' : 'ok')
                + ((r.cleaned.errors || []).length ? `<ul class="tools-list tools-mono">${r.cleaned.errors.slice(0, 20).map((e: string) => `<li>${esc(t(e.split(': ').pop() || '') !== (e.split(': ').pop() || '') ? `${e.split(': ')[0]}: ${t(e.split(': ').pop() || '')}` : e)}</li>`).join('')}</ul>` : '') : '';
            return cleaned + summary(t('tools.cache.summary', { t: formatBytes(r.total_bytes || 0) }), 'info')
                + `<div class="tools-group">${items.map((c: any) => `<label class="tools-row tools-check">
                    <input type="checkbox" data-cache-id="${escAttr(c.id)}"${sel.has(c.id) && !c.busy && (c.bytes || c.entries) ? ' checked' : ''}${c.busy || (!c.bytes && !c.entries) ? ' disabled' : ''}>
                    <span class="tools-row-main"><b>${esc(cacheName(c.id))}</b><br><span class="tools-hint">${esc(cacheHint(c.id))}</span>${c.busy ? `<br><span class="tools-chip is-warn">${esc(t('tools.cache.busy'))}</span>` : ''}</span>
                    <span class="tools-num-cell">${esc(formatBytes(c.bytes || 0))}</span>
                    ${folderBtn(c.path, true)}</label>`).join('')}</div>
                <div class="tools-cache-go">
                    <button type="button" class="btn btn-danger btn-sm" data-act="cache-clean"${chosen.ids.length ? '' : ' disabled'}>${uiIcon('delete', 14)} ${esc(t('tools.cache.clean', { b: formatBytes(chosen.bytes) }))}</button>
                </div>`;
        }
        case 'logs': {
            const head = summary(t('tools.logs.summary', { n: String(r.lines.length), t: String(r.total), e: String(r.errors), w: String(r.warnings) }), r.errors ? 'warn' : 'info')
                + (r.clipped ? `<p class="tools-note">${esc(t('tools.logs.clipped', { n: String(r.lines.length) }))}</p>` : '');
            if (!r.total) return head + none('tools.logs.empty');
            if (!r.lines.length) return head + `<p class="tools-empty">${esc(t('tools.logs.noMatch'))}</p>`;
            return head + `<pre class="tools-log" tabindex="0">${r.lines.map((l: any) => `<span class="tools-log-line is-${l.level}"><span class="tools-log-n">${l.n}</span>${esc(l.text)}</span>`).join('')}</pre>`;
        }
        case 'jsondiff': {
            const n = findingCount('jsondiff', r);
            const head = summary(t('tools.jsondiff.summary', { a: String(r.a_count), b: String(r.b_count), p: String(r.added?.length || 0), m: String(r.removed?.length || 0), c: String(r.changed?.length || 0), s: String(r.same || 0) }), n ? 'warn' : 'ok');
            const notes = (!r.a_list || !r.b_list ? `<p class="tools-note">${esc(t('tools.jsondiff.noList'))}</p>` : '')
                + ((r.meta_changed || []).length ? `<p class="tools-note">${esc(t('tools.jsondiff.meta', { f: r.meta_changed.join(', ') }))}</p>` : '');
            if (!n) return head + notes + none('tools.jsondiff.none');
            const sec = (title: string, list: any[], fields = false) => list.length ? `<h4 class="tools-h">${esc(title)} <span class="tools-chip">${list.length}</span></h4>
                <div class="tools-group">${list.slice(0, 500).map((e: any) => `<div class="tools-row"><code class="tools-mono">${esc(e.key)}</code><span class="tools-row-main">${esc(e.name && e.name !== e.key ? e.name : '')}</span>${fields ? `<span class="tools-muted">${esc((e.fields || []).join(', '))}</span>` : ''}</div>`).join('')}</div>` : '';
            return head + notes + sec(t('tools.jsondiff.added'), r.added || []) + sec(t('tools.jsondiff.removed'), r.removed || []) + sec(t('tools.jsondiff.changed'), r.changed || [], true);
        }
        case 'orphans': {
            const items = r.items || [];
            const head = summary(t('tools.orphans.summary', { n: String(items.length), p: String(r.profiles_checked || 0), m: String(r.mods_checked || 0) }), items.length ? 'warn' : 'ok');
            if (!items.length) return head + none('tools.orphans.none');
            const kinds = ['dangling_active', 'missing_folder', 'missing_profile_dir', 'unowned', 'unregistered'];
            return head + kinds.map((k) => {
                const list = items.filter((o: any) => o.kind === k);
                if (!list.length) return '';
                return `<h4 class="tools-h">${esc(t(`tools.orphans.k.${k}`))} <span class="tools-chip">${list.length}</span></h4>
                    <p class="tools-note">${esc(t(`tools.orphans.h.${k}`))}</p>
                    <div class="tools-group">${list.map((o: any) => `<div class="tools-row"><span class="tools-row-main">${esc(o.name)}</span>
                        ${o.profile_name ? `<span class="tools-chip">${esc(o.profile_name)}</span>` : ''}
                        ${o.path ? `<code class="tools-path">${esc(o.path)}</code>${k === 'missing_folder' || k === 'missing_profile_dir' ? '' : folderBtn(o.path)}` : ''}</div>`).join('')}</div>`;
            }).join('');
        }
        case 'diff': {
            const n = findingCount('diff', r);
            const head = summary(t('tools.diff.summary', { a: r.a_name, b: r.b_name, n: String(n), s: String(r.same || 0) }), n ? 'warn' : 'ok');
            if (!n) return head + none('tools.diff.none');
            const section = (key: string, rows: string[]) => rows.length ? `<h4 class="tools-h">${esc(t(`tools.diff.${key}`, { a: r.a_name, b: r.b_name }))} <span class="tools-chip">${rows.length}</span></h4><div class="tools-group">${rows.join('')}</div>` : '';
            const one = (s: any) => `<div class="tools-row"><span class="tools-row-main">${esc(s.name)} <span class="tools-muted">${esc(s.version)}</span></span><span class="tools-chip">${esc(t(s.enabled ? 'tools.on' : 'tools.off'))}</span></div>`;
            const two = (f: (x: any) => string) => (p: any) => `<div class="tools-row"><span class="tools-row-main">${esc(p.a.name)}</span><span class="tools-cmp"><span>${esc(f(p.a))}</span> → <span>${esc(f(p.b))}</span></span></div>`;
            const onoff = (x: any) => t(x.enabled ? 'tools.on' : 'tools.off');
            return head
                + section('onlyA', (r.only_a || []).map(one))
                + section('onlyB', (r.only_b || []).map(one))
                + section('version', (r.version || []).map(two((x) => x.version || '—')))
                + section('enabled', (r.enabled || []).map(two(onoff)))
                + section('order', (r.order || []).map(two((x) => `#${x.order}`)));
        }
        case 'hash': {
            const v = r.verdict as string;
            const tone = v === 'match' ? 'ok' : v === 'mismatch' || v === 'invalid' ? 'warn' : 'info';
            return summary(t(`tools.hash.v.${v}`), tone as any) + `
                <div class="tools-group">
                    <div class="tools-row"><span class="tools-row-main">${esc(t('tools.hash.file'))}</span><code class="tools-path">${esc(r.path)}</code>${folderBtn(r.path)}</div>
                    <div class="tools-row"><span class="tools-row-main">${esc(t('tools.hash.size'))}</span><span class="tools-num-cell">${esc(formatBytes(r.size || 0))}</span></div>
                    <div class="tools-row"><span class="tools-row-main">${esc(r.algo === 'sha256' ? 'SHA-256' : 'BLAKE3')}</span><code class="tools-hash tools-select" id="tools-hash-out">${esc(r.hash)}</code>
                        <button type="button" class="btn btn-ghost btn-sm" data-act="copy-hash">${uiIcon('copy', 14)} ${esc(t('tools.copy'))}</button></div>
                    ${r.expected ? `<div class="tools-row"><span class="tools-row-main">${esc(t('tools.hash.expected'))}</span><code class="tools-hash">${esc(normalizeHash(r.expected))}</code></div>` : ''}
                </div>`;
        }
        case 'validate': {
            const problems: string[] = r.problems || [];
            const fmt = r.format ? r.format : t('tools.validate.unknown');
            const head = summary(r.ok ? t('tools.validate.ok', { f: fmt, n: String(r.count || 0) }) : t('tools.validate.bad', { f: fmt, n: String(problems.length) }), r.ok ? 'ok' : 'warn');
            return head + (problems.length ? `<ul class="tools-list">${problems.map((p) => `<li>${esc(t(p))}</li>`).join('')}</ul>` : '');
        }
    }
    return '';
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
    if (_running || !_h) return;
    const id = _active;
    const q = <T extends HTMLElement>(sel: string) => _h!.q<T>(sel);
    let result: any = null;
    _running = id;
    showRunning(true);
    renderRail();
    try {
        switch (id) {
            case 'duplicates': {
                const kb = Math.max(0, Math.min(1048576, Number(q<HTMLInputElement>('#tools-dup-min')?.value || 64) || 0));
                result = await invoke('tools_find_duplicates', { minSizeKb: kb, maxHash: 20000 });
                break;
            }
            case 'conflicts': {
                const pid = q<HTMLSelectElement>('#tools-cf-profile')?.value || '';
                const [map, mods, byProfile] = await Promise.all([
                    invoke('get_all_mod_conflicts') as Promise<Record<string, any[]>>,
                    invoke('get_all_mods') as Promise<any[]>,
                    pid ? (invoke('get_mods_all_profiles') as Promise<Record<string, any>>) : Promise.resolve(null),
                ]);
                const names: Record<string, string> = {};
                for (const m of mods || []) names[String(m.id)] = String(m.name || m.id);
                const scope = pid && byProfile ? new Set<string>((byProfile[pid]?.mods || []).map((m: any) => String(m.id))) : null;
                result = conflictPairs(map, names, scope);
                break;
            }
            case 'disk':
                result = await invoke('tools_disk_usage');
                break;
            case 'deployed':
                result = await invoke('tools_check_deployed', { profileId: q<HTMLSelectElement>('#tools-dep-profile')?.value || null });
                break;
            case 'largefiles': {
                const min = Math.max(1, Math.min(1048576, Number(q<HTMLInputElement>('#tools-lf-min')?.value || 50) || 50));
                const limit = Math.max(1, Math.min(500, Number(q<HTMLInputElement>('#tools-lf-limit')?.value || 50) || 50));
                result = await invoke('tools_large_files', { profileId: q<HTMLSelectElement>('#tools-lf-profile')?.value || null, minMb: min, limit });
                break;
            }
            case 'names':
                result = await invoke('tools_names_report');
                break;
            case 'dupprofiles':
                result = await invoke('tools_duplicate_profiles', { threshold: Number(q<HTMLSelectElement>('#tools-dp-th')?.value || 0.8) });
                break;
            case 'cache':
                result = await invoke('tools_cache_preview');
                break;
            case 'logs': {
                const logId = q<HTMLSelectElement>('#tools-log-id')?.value || 'current';
                _inputs.logId = logId;
                try { _inputs.logList = await invoke('tools_log_list') as any[]; } catch { /* keep the old list */ }
                _inputs.logText = await invoke('tools_log_read', { id: logId }) as string;
                result = logView();
                break;
            }
            case 'diff': {
                const a = q<HTMLSelectElement>('#tools-diff-a')?.value || '';
                const b = q<HTMLSelectElement>('#tools-diff-b')?.value || '';
                if (!a || !b || a === b) { toast(t('tools.diff.pickTwo'), 'warning'); return; }
                result = await invoke('tools_profile_diff', { profileA: a, profileB: b });
                break;
            }
            case 'orphans':
                result = await invoke('tools_find_orphans');
                break;
            case 'jsondiff': {
                if (!_inputs.diffA || !_inputs.diffB) { toast(t('tools.jsondiff.pickTwo'), 'warning'); return; }
                result = await invoke('tools_json_diff', { pathA: _inputs.diffA, pathB: _inputs.diffB });
                break;
            }
            case 'hash': {
                const path = _inputs.hashPath;
                if (!path) { toast(t('tools.pickFirst'), 'warning'); return; }
                const expected = q<HTMLInputElement>('#tools-hash-expected')?.value || '';
                const sel = q<HTMLSelectElement>('#tools-hash-algo');
                // A pasted "sha256:…" names its algorithm: follow it rather than report a mismatch.
                const algo = hashAlgoHint(expected) || sel?.value || 'blake3';
                if (sel) sel.value = algo;
                const [meta, hash] = await Promise.all([
                    invoke('file_meta', { path }) as Promise<any>,
                    invoke('hash_file', { path, algo }) as Promise<string>,
                ]);
                result = { path, size: meta?.size || 0, algo, hash, expected, verdict: compareHash(hash, expected) };
                break;
            }
            case 'validate': {
                const kind = q<HTMLSelectElement>('#tools-val-kind')?.value || 'auto';
                const text = q<HTMLTextAreaElement>('#tools-val-text')?.value || '';
                const path = text.trim() ? null : (_inputs.validatePath || null);
                if (!path && !text.trim()) { toast(t('tools.validate.needInput'), 'warning'); return; }
                if (kind === 'catalog') {
                    result = catalogReport(await invoke(CATALOG_VALIDATE, { path, text: text.trim() ? text : null }));
                    break;
                }
                result = await invoke('bmm_validate', { path, text: text.trim() ? text : null });
                break;
            }
        }
    } catch (e) {
        const msg = String((e as any)?.message || e);
        result = { __error: t(msg) !== msg ? t(msg) : msg.slice(0, 300) };
    } finally {
        _running = null;
    }
    if (_h && result == null) { showRunning(false); renderRail(); return; }
    if (result == null || !_h) return;
    if (typeof result === 'object' && !Array.isArray(result) && !result.__error) result.__at = Date.now();
    else if (Array.isArray(result)) (result as any).__at = Date.now();
    _results[id] = result;
    renderRail();
    if (_active === id) renderPane();
}

/** The loaded log, through the current level and text filter. */
function logView(): any {
    const v: any = filterLog(_inputs.logText || '', { level: _inputs.logLevel || 'all', q: _inputs.logQ || '', limit: 3000 });
    v.id = _inputs.logId || 'current';
    v.__at = Date.now();
    return v;
}

/** `catalog_validate`'s ValidateReport (`{ ok, variantLabel, signature: { status }, items,
 *  issues: [{ severity, code, path, message }] }`) in the pane's `{ format, ok, count,
 *  problems }` shape (the one bmm_validate answers in). Info-level notes are not problems. */
function catalogReport(r: any): any {
    const issues: any[] = Array.isArray(r?.issues) ? r.issues : [];
    const problems = issues
        .filter((i) => i?.severity === 'error' || i?.severity === 'warning')
        .map((i) => `${i.severity === 'error' ? '✗' : '!'} ${i.path ? `${i.path}: ` : ''}${i.message}`);
    const sig = r?.signature?.status && r.signature.status !== 'unsigned' ? ` · ${r.signature.status}` : '';
    return { format: `${r?.variantLabel || 'catalog'}${sig}`, ok: !!r?.ok, count: Number(r?.items || 0), problems };
}

async function cacheClean(): Promise<void> {
    const r = _results.cache;
    if (!r || r.__error || _running) return;
    const chosen = cacheSelection(r, _inputs.cacheIds || (r.items || []).filter((c: any) => c.id !== 'crash_archive').map((c: any) => c.id));
    if (!chosen.ids.length) return;
    const names = chosen.ids.map(cacheName).join(', ');
    const ok = await showConfirm(t('tools.cache.confirmTitle'), t('tools.cache.confirmMsg', { names, b: formatBytes(chosen.bytes) }), true);
    if (!ok) return;
    _running = 'cache';
    showRunning(true, t('tools.cache.cleaning'));
    let cleaned: any = null;
    try {
        cleaned = await invoke('tools_cache_clean', { ids: chosen.ids, confirmed: true });
    } catch (e) {
        cleaned = { freed_bytes: 0, errors: [String((e as any)?.message || e)] };
    }
    // Measure again, so the sizes shown are the ones on disk now.
    let fresh: any = null;
    try { fresh = await invoke('tools_cache_preview'); } catch { fresh = { ...r }; }
    _running = null;
    _results.cache = { ...fresh, cleaned, __at: Date.now() };
    toast(t('tools.cache.cleaned', { b: formatBytes(cleaned?.freed_bytes || 0) }), (cleaned?.errors || []).length ? 'warning' : 'success', 6000);
    renderRail();
    if (_active === 'cache') renderPane();
}

async function exportResult(kind: 'json' | 'csv' | 'copy'): Promise<void> {
    const id = _active;
    const r = _results[id];
    if (r == null || r.__error) return;
    const json = JSON.stringify(r, (k, v) => (k === '__at' ? undefined : v), 2);
    if (kind === 'copy') {
        try { await navigator.clipboard.writeText(json); toast(t('tools.copied'), 'success'); } catch { toast(t('tools.err.clipboard'), 'error'); }
        return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const path = await saveFile({ defaultPath: `bmm-${id}-${stamp}.${kind}`, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
    if (!path) return;
    const content = kind === 'json' ? json : toCsv(rowsFor(id, r));
    try { await invoke('write_text_file', { path, content }); toastSaved(t('tools.exported'), path); } catch (e) { toast(`${t('tools.err.failed')} ${String(e).slice(0, 160)}`, 'error'); }
}

async function onClick(e: Event): Promise<void> {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tool], [data-cmd], [data-act], [data-open]');
    if (!el || !_h) return;
    if (el.dataset.tool && isToolId(el.dataset.tool)) {
        // Switching while a scan runs is fine: the scan keeps going and its tool shows a
        // spinner in the rail; its result lands there when it ends.
        _active = el.dataset.tool;
        renderRail(); renderPane();
        return;
    }
    if (el.dataset.cmd) {
        const c = allCommands().find((x) => x.id === el.dataset.cmd);
        if (c) { _h.close(); c.run(); }
        return;
    }
    if (el.dataset.open != null) { void openFolder(el.dataset.open); return; }
    switch (el.dataset.act) {
        case 'run':
            if (_running && _running !== _active) { toast(t('tools.busy'), 'info'); return; }
            void run();
            break;
        case 'cancel': void invoke('tools_cancel').catch(() => {}); setProgress('cancelling', 0, 0); break;
        case 'copy': case 'json': case 'csv': void exportResult(el.dataset.act as any); break;
        case 'pick-hash': {
            const p = await pickFile([]);
            if (p) { _inputs.hashPath = p; const c = _h.q('#tools-hash-path'); if (c) c.textContent = p; }
            break;
        }
        case 'pick-validate': {
            const p = await pickFile([{ name: 'BMM', extensions: ['json', 'mm', 'bmp', 'cbmp', 'bmmcat', 'bmmpa', 'bmmnav', 'bmmlaunch', 'bmmplug', 'databmm', 'bmmreplay'] }, { name: '*', extensions: ['*'] }]);
            if (p) { _inputs.validatePath = p; renderPane(); }
            break;
        }
        case 'pick-diff-a': case 'pick-diff-b': {
            const p = await pickFile([{ name: 'JSON', extensions: ['json', 'bmmcat'] }, { name: '*', extensions: ['*'] }]);
            if (!p) break;
            if (el.dataset.act === 'pick-diff-a') _inputs.diffA = p; else _inputs.diffB = p;
            const c = _h.q(el.dataset.act === 'pick-diff-a' ? '#tools-jd-a' : '#tools-jd-b');
            if (c) c.textContent = p;
            break;
        }
        case 'clear-validate': _inputs.validatePath = undefined; renderPane(); break;
        case 'copy-hash': {
            const h = _results.hash?.hash;
            if (h) { try { await navigator.clipboard.writeText(h); toast(t('tools.copied'), 'success'); } catch { toast(t('tools.err.clipboard'), 'error'); } }
            break;
        }
        case 'cache-clean': await cacheClean(); break;
        case 'cf-files': await toggleConflictFiles(Number(el.dataset.i)); break;
    }
}

let _logDeb: ReturnType<typeof setTimeout> | null = null;
function onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (el.id === 'tools-search') {
        _search = el.value;
        renderRail();
        return;
    }
    if (el.id === 'tools-log-q') {
        _inputs.logQ = el.value;
        if (_logDeb) clearTimeout(_logDeb);
        _logDeb = setTimeout(refilterLog, 150);
    }
}

function onChange(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (el.id === 'tools-log-level') { _inputs.logLevel = el.value; refilterLog(); return; }
    if (el.dataset.cacheId != null && _h) {
        _inputs.cacheIds = [..._h.body.querySelectorAll<HTMLInputElement>('[data-cache-id]')].filter((x) => x.checked).map((x) => x.dataset.cacheId || '');
        const r = _results.cache;
        const btn = _h.q<HTMLButtonElement>('[data-act="cache-clean"]');
        if (r && btn) {
            const chosen = cacheSelection(r, _inputs.cacheIds);
            btn.disabled = !chosen.ids.length;
            btn.innerHTML = `${uiIcon('delete', 14)} ${esc(t('tools.cache.clean', { b: formatBytes(chosen.bytes) }))}`;
        }
    }
}

/** The log's filters changed: re-filter what is loaded, without reading it again. */
function refilterLog(): void {
    if (_inputs.logText == null || _active !== 'logs' || !_h) return;
    _results.logs = logView();
    const out = _h.q('.tools-results');
    if (out) out.innerHTML = resultHtml('logs', _results.logs);
    renderRail();
}

async function toggleConflictFiles(i: number): Promise<void> {
    const host = _h?.q<HTMLElement>(`[data-cf="${i}"]`);
    const p = (_results.conflicts || [])[i];
    if (!host || !p) return;
    if (!host.hidden) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = `<p class="tools-note">${esc(t('tools.phase.start'))}</p>`;
    try {
        const tree: any = await invoke('get_conflict_file_tree', { modId: p.a, otherModId: p.b });
        const files: string[] = tree?.files || [];
        host.innerHTML = files.length
            ? `<ul class="tools-list tools-mono">${files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>${tree.truncated ? `<p class="tools-note">${esc(t('tools.moreInExport', { n: String((tree.total || 0) - files.length) }))}</p>` : ''}`
            : `<p class="tools-note">${esc(t('tools.conflicts.noFiles'))}</p>`;
    } catch (e) {
        host.innerHTML = `<p class="tools-error">${esc(String(e).slice(0, 200))}</p>`;
    }
}
