// BMM Tools: one dialog that gathers the diagnostics a mod library grows into.
//
// Opened from the command palette (category Tools, one entry per tool), from DevTools (its
// "Tools" section) and, when the person pins it, from the navbar (Customize the navbar →
// Modal → Tools). Loaded on demand from all three: nothing here is in the boot path.
//
// Every tool READS. None deletes or moves anything: each finding carries an "open folder" and
// the person decides. New backend work lives in src-tauri/src/commands/tools.rs; the hash
// checker, the conflict summary and the validators reuse commands that already existed
// (hash_file, file_meta, get_all_mod_conflicts, get_conflict_file_tree, bmm_validate).
//
// The thinking (hash comparison, conflict pairs, CSV rows) is in tools-model.ts, tested in node.

import { invoke, listen, pickFile, saveFile } from '../../core/api.js';
import { t, getLang } from '../../core/i18n.js';
import { escHtml, escAttr, formatBytes } from '../../core/utils.js';
import { openModal, type ModalHandle } from '../../ui/modal-shell.js';
import { uiIcon } from '../../ui/icons.js';
import {
    TOOLS, LINKED_COMMANDS, isToolId, compareHash, hashAlgoHint, normalizeHash, toCsv, conflictPairs,
    rowsFor, findingCount, progressPct, type ToolId,
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
 *  `{ text, path, kind?, sourceUrl? }`, answer `ValidateReport` — read by catalogReport(). */
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
let _busy = false;
const _results: Partial<Record<ToolId, any>> = {};
const _inputs: { hashPath?: string; validatePath?: string } = {};
let _unlisten: (() => void) | null = null;
let _profiles: { id: string; name: string }[] = [];
/** The palette's command list, handed in by core/commands.ts (importing it from here would
 *  close an import cycle: the palette loads this module). */
let _commands: () => any[] = () => [];
const allCommands = () => { try { return _commands() || []; } catch { return []; } };

const toolName = (id: ToolId) => t(`tools.${id}.name`);
const toolDesc = (id: ToolId) => t(`tools.${id}.desc`);
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
        body: `<div class="tools-hub"><nav class="tools-rail" aria-label="${escAttr(t('tools.title'))}"></nav><section class="tools-pane" aria-live="polite"></section></div>`,
        onClose: () => {
            if (_busy) void invoke('tools_cancel').catch(() => {});
            _unlisten?.(); _unlisten = null; _h = null; _busy = false;
        },
    });
    try {
        _unlisten = await listen('tools-progress', (p: any) => {
            if (!_h || p?.tool == null) return;
            const map: Record<string, ToolId> = { duplicates: 'duplicates', disk: 'disk' };
            if (map[p.tool] !== _active) return;
            setProgress(p.phase, p.done, p.total);
        });
    } catch { /* no progress events outside Tauri: the spinner text stays */ }
    _h.body.addEventListener('click', onClick);
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

function renderRail(): void {
    const rail = _h?.q('.tools-rail');
    if (!rail) return;
    const btn = (x: typeof TOOLS[number]) => {
        const n = findingCount(x.id, _results[x.id]);
        const done = _results[x.id] != null;
        return `<button type="button" class="tools-rail-item${x.id === _active ? ' is-active' : ''}" data-tool="${x.id}" aria-current="${x.id === _active ? 'true' : 'false'}">
            <span class="tools-rail-ic" aria-hidden="true">${uiIcon(x.icon as any, 16)}</span>
            <span class="tools-rail-txt"><span class="tools-rail-name">${esc(toolName(x.id))}</span></span>
            ${done ? `<span class="tools-badge${n ? ' is-warn' : ' is-ok'}">${n ? n : uiIcon('check', 12)}</span>` : ''}
        </button>`;
    };
    const lang = getLang() === 'fr' ? 'fr' : 'en';
    const cmds = allCommands();
    const linked = LINKED_COMMANDS.map((id) => cmds.find((c) => c.id === id)).filter(Boolean) as any[];
    rail.innerHTML = `
        <div class="tools-rail-group">${esc(t('tools.group.user'))}</div>
        ${TOOLS.filter((x) => x.audience === 'user').map(btn).join('')}
        <div class="tools-rail-group">${esc(t('tools.group.author'))}</div>
        ${TOOLS.filter((x) => x.audience === 'author').map(btn).join('')}
        ${linked.length ? `<div class="tools-rail-group">${esc(t('tools.group.more'))}</div>
        ${linked.map((c) => `<button type="button" class="tools-rail-item is-link" data-cmd="${escAttr(c.id)}">
            <span class="tools-rail-ic" aria-hidden="true">${uiIcon('external', 14)}</span>
            <span class="tools-rail-txt"><span class="tools-rail-name">${esc(c.title?.[lang] || c.id)}</span></span></button>`).join('')}` : ''}`;
}

// ── Pane ─────────────────────────────────────────────────────────────────────────────────

function profileOptions(selected?: string, withAll = false): string {
    const all = withAll ? `<option value="">${esc(t('tools.allProfiles'))}</option>` : '';
    return all + _profiles.map((p) => `<option value="${escAttr(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
}

function formHtml(id: ToolId): string {
    const run = `<button type="button" class="btn btn-primary btn-sm" data-act="run">${uiIcon('play', 14)} ${esc(t('tools.run'))}</button>`;
    switch (id) {
        case 'duplicates':
            return `<label class="tools-field"><span>${esc(t('tools.duplicates.minSize'))}</span>
                <input type="number" class="input-field tools-num" id="tools-dup-min" min="0" max="1048576" value="64"></label>${run}`;
        case 'conflicts':
            return `<label class="tools-field"><span>${esc(t('tools.profile'))}</span>
                <select class="input-field" id="tools-cf-profile">${profileOptions(undefined, true)}</select></label>${run}`;
        case 'diff': {
            if (_profiles.length < 2) return `<p class="tools-note">${esc(t('tools.diff.needTwo'))}</p>`;
            return `<label class="tools-field"><span>${esc(t('tools.diff.a'))}</span>
                <select class="input-field" id="tools-diff-a">${profileOptions(_profiles[0]?.id)}</select></label>
                <label class="tools-field"><span>${esc(t('tools.diff.b'))}</span>
                <select class="input-field" id="tools-diff-b">${profileOptions(_profiles[1]?.id)}</select></label>${run}`;
        }
        case 'hash':
            return `<div class="tools-field tools-grow"><span>${esc(t('tools.hash.file'))}</span>
                    <div class="tools-pick"><button type="button" class="btn btn-secondary btn-sm" data-act="pick-hash">${uiIcon('file', 14)} ${esc(t('tools.pickFile'))}</button>
                    <code class="tools-path" id="tools-hash-path">${esc(_inputs.hashPath || t('tools.noFile'))}</code></div></div>
                <label class="tools-field"><span>${esc(t('tools.hash.algo'))}</span>
                    <select class="input-field" id="tools-hash-algo"><option value="blake3">BLAKE3</option><option value="sha256">SHA-256</option></select></label>
                <label class="tools-field tools-grow"><span>${esc(t('tools.hash.expected'))}</span>
                    <input type="text" class="input-field tools-mono" id="tools-hash-expected" spellcheck="false" autocomplete="off" placeholder="${escAttr(t('tools.hash.expectedPh'))}"></label>${run}`;
        case 'validate':
            return `<label class="tools-field"><span>${esc(t('tools.validate.kind'))}</span>
                    <select class="input-field" id="tools-val-kind"><option value="auto">${esc(t('tools.validate.kindAuto'))}</option><option value="catalog">${esc(t('tools.validate.kindCatalog'))}</option></select></label>
                <div class="tools-field tools-grow"><span>${esc(t('tools.validate.file'))}</span>
                    <div class="tools-pick"><button type="button" class="btn btn-secondary btn-sm" data-act="pick-validate">${uiIcon('file', 14)} ${esc(t('tools.pickFile'))}</button>
                    <code class="tools-path" id="tools-val-path">${esc(_inputs.validatePath || t('tools.noFile'))}</code>
                    ${_inputs.validatePath ? `<button type="button" class="btn btn-ghost btn-sm" data-act="clear-validate">${esc(t('tools.clear'))}</button>` : ''}</div></div>
                <label class="tools-field tools-full"><span>${esc(t('tools.validate.text'))}</span>
                    <textarea class="input-field tools-mono" id="tools-val-text" rows="4" spellcheck="false" placeholder="${escAttr(t('tools.validate.textPh'))}"></textarea></label>${run}`;
        default:
            return run;
    }
}

function renderPane(): void {
    const pane = _h?.q('.tools-pane');
    if (!pane) return;
    const id = _active;
    pane.innerHTML = `
        <header class="tools-pane-head">
            <h3 class="tools-pane-title">${esc(toolName(id))}</h3>
            <p class="tools-pane-desc">${esc(toolDesc(id))}</p>
            <p class="tools-pane-safe">${uiIcon('shield-check', 12)} ${esc(t('tools.readOnly'))}</p>
        </header>
        <div class="tools-form">${formHtml(id)}</div>
        <div class="tools-progress" hidden>
            <div class="tools-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
            <span class="tools-progress-txt"></span>
            <button type="button" class="btn btn-ghost btn-sm" data-act="cancel">${uiIcon('stop', 14)} ${esc(t('tools.cancel'))}</button>
        </div>
        <div class="tools-actions"${_results[id] != null ? '' : ' hidden'}>
            <button type="button" class="btn btn-ghost btn-sm" data-act="copy">${uiIcon('copy', 14)} ${esc(t('tools.copyJson'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="json">${uiIcon('download', 14)} JSON</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="csv">${uiIcon('download', 14)} CSV</button>
        </div>
        <div class="tools-results">${_results[id] != null ? resultHtml(id, _results[id]) : `<p class="tools-empty">${esc(t('tools.notRun'))}</p>`}</div>`;
    if (_busy) showBusy(true);
}

function showBusy(on: boolean, text?: string): void {
    const pane = _h?.q('.tools-pane');
    if (!pane) return;
    const pr = pane.querySelector<HTMLElement>('.tools-progress');
    if (pr) pr.hidden = !on;
    pane.querySelectorAll<HTMLButtonElement>('[data-act="run"]').forEach((b) => { b.disabled = on; });
    const cancel = pane.querySelector<HTMLElement>('[data-act="cancel"]');
    if (cancel) cancel.hidden = !(on && (_active === 'duplicates' || _active === 'disk'));
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

function resultHtml(id: ToolId, r: any): string {
    if (r && r.__error) return `<p class="tools-error">${esc(r.__error)}</p>`;
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
            if (!n) return head + notes + `<p class="tools-empty">${esc(t('tools.duplicates.none'))}</p>`;
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
            if (!pairs.length) return head + `<p class="tools-empty">${esc(t('tools.conflicts.none'))}</p>`;
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
            return head + (profiles || `<p class="tools-empty">${esc(t('tools.disk.none'))}</p>`) + app;
        }
        case 'diff': {
            const n = findingCount('diff', r);
            const head = summary(t('tools.diff.summary', { a: r.a_name, b: r.b_name, n: String(n), s: String(r.same || 0) }), n ? 'warn' : 'ok');
            if (!n) return head + `<p class="tools-empty">${esc(t('tools.diff.none'))}</p>`;
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
        case 'orphans': {
            const items = r.items || [];
            const head = summary(t('tools.orphans.summary', { n: String(items.length), p: String(r.profiles_checked || 0), m: String(r.mods_checked || 0) }), items.length ? 'warn' : 'ok');
            if (!items.length) return head + `<p class="tools-empty">${esc(t('tools.orphans.none'))}</p>`;
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
    if (_busy || !_h) return;
    const id = _active;
    const q = <T extends HTMLElement>(sel: string) => _h!.q<T>(sel);
    let result: any = null;
    _busy = true;
    showBusy(true);
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
        result = { __error: `${t('tools.err.failed')} ${t(msg) !== msg ? t(msg) : msg.slice(0, 300)}` };
    } finally {
        _busy = false;
        if (_h) showBusy(false);
    }
    if (result == null || !_h) return;
    _results[id] = result;
    if (_active === id) { renderPane(); renderRail(); }
}

/** `catalog_validate`'s ValidateReport — `{ ok, variantLabel, signature: { status }, items,
 *  issues: [{ severity, code, path, message }] }` — in the pane's `{ format, ok, count,
 *  problems }` shape (the one bmm_validate answers in). Info-level notes are not problems. */
function catalogReport(r: any): any {
    const issues: any[] = Array.isArray(r?.issues) ? r.issues : [];
    const problems = issues
        .filter((i) => i?.severity === 'error' || i?.severity === 'warning')
        .map((i) => `${i.severity === 'error' ? '✗' : '!'} ${i.path ? `${i.path} — ` : ''}${i.message}`);
    const sig = r?.signature?.status && r.signature.status !== 'unsigned' ? ` · ${r.signature.status}` : '';
    return { format: `${r?.variantLabel || 'catalog'}${sig}`, ok: !!r?.ok, count: Number(r?.items || 0), problems };
}

async function exportResult(kind: 'json' | 'csv' | 'copy'): Promise<void> {
    const id = _active;
    const r = _results[id];
    if (r == null || r.__error) return;
    const json = JSON.stringify(r, null, 2);
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
        if (_busy) { toast(t('tools.busy'), 'info'); return; }
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
        case 'run': void run(); break;
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
        case 'clear-validate': _inputs.validatePath = undefined; renderPane(); break;
        case 'copy-hash': {
            const h = _results.hash?.hash;
            if (h) { try { await navigator.clipboard.writeText(h); toast(t('tools.copied'), 'success'); } catch { toast(t('tools.err.clipboard'), 'error'); } }
            break;
        }
        case 'cf-files': await toggleConflictFiles(Number(el.dataset.i)); break;
    }
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
