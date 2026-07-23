// crash-manager.ts — a complete in-app Crash Reports & Sessions manager.
// List / analyze / open / export / delete crash report zips, and play / export /
// delete saved session recordings — all without importing anything by hand.

import { invoke, saveFile, pickFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { importReplayFromPath, playReplayJson } from './replay-watcher.js';

interface CrashEntry { name: string; path: string; size: number; date: string; category: string; }
interface SavedReplay { name: string; path: string; size: number; ts: number; }

let _wired = false;
/** Wire the "Manage & analyze" button in the Crash Reports settings card. */
export function initCrashManager(): void {
    const btn = document.getElementById('btn-crash-manager');
    if (btn && !_wired) { _wired = true; btn.addEventListener('click', openCrashManager); }
}

function fmtSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
/** `secs` may be a unix-seconds string (crash reports) or epoch-ms number (replays). */
function fmtDate(v: string | number): string {
    const n = Number(v);
    if (!n) return String(v || '');
    const ms = n > 1e12 ? n : n * 1000;  // seconds vs ms
    try { return new Date(ms).toLocaleString(); } catch { return String(v); }
}
function esc(s: string): string { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

// Session retention limits (configurable; applied to saved replays + session reports).
const KEEP_KEY = 'bmm_session_keep_count', SIZE_KEY = 'bmm_session_max_mb';
export const sessionKeepCount = (): number => Math.max(1, parseInt(localStorage.getItem(KEEP_KEY) || '30', 10) || 30);
export const sessionMaxMb = (): number => Math.max(0, parseInt(localStorage.getItem(SIZE_KEY) || '2048', 10) || 2048);
/** Apply the retention limits now (deletes oldest beyond count / total size). */
export async function pruneSessions(): Promise<number> {
    try { return await invoke('prune_sessions', { maxCount: sessionKeepCount(), maxMb: sessionMaxMb() }) as number; }
    catch { return 0; }
}

export async function openCrashManager(): Promise<void> {
    document.getElementById('crashmgr-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'crashmgr-overlay';
    overlay.className = 'modal-generic-overlay open';
    overlay.innerHTML = `
        <div class="modal-generic crashmgr-modal">
            <div class="crashmgr-head">
                <h3>${t('crashmgr.title') || 'Crash Reports & Sessions'}</h3>
                <button class="modal-close" id="crashmgr-close">✕</button>
            </div>
            <div class="crashmgr-tabs">
                <button class="crashmgr-tab active" data-tab="reports">${t('crashmgr.tabReports') || 'Crash reports'}</button>
                <button class="crashmgr-tab" data-tab="sessions">${t('crashmgr.tabSessions') || 'Saved sessions'}</button>
            </div>
            <div class="crashmgr-limits">
                <span>${t('crashmgr.keepLast') || 'Keep last'}</span>
                <input type="number" id="crashmgr-keep" min="1" value="${sessionKeepCount()}">
                <span>${t('crashmgr.maxSize') || 'Max total'}</span>
                <input type="number" id="crashmgr-maxmb" min="0" value="${sessionMaxMb()}"><span>MB</span>
                <button class="btn btn-xs btn-ghost" id="crashmgr-applylimits">${t('common.apply') || 'Apply'}</button>
                <span class="crashmgr-limits-hint">${t('crashmgr.limitsHint') || 'applies to saved sessions + session reports'}</span>
            </div>
            <div class="crashmgr-body" id="crashmgr-body"></div>
            <div class="crashmgr-actions">
                <button class="btn btn-ghost btn-sm" id="crashmgr-import">${t('crashmgr.import') || 'Import a session…'}</button>
                <button class="btn btn-ghost btn-sm" id="crashmgr-folder">${t('settings.crashOpenFolder') || 'Open folder'}</button>
                <button class="btn btn-primary btn-sm" id="crashmgr-done">${t('common.done') || 'Done'}</button>
            </div>
        </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);

    const body = overlay.querySelector('#crashmgr-body') as HTMLElement;
    const close = () => overlay.remove();
    overlay.querySelector('#crashmgr-close')?.addEventListener('click', close);
    overlay.querySelector('#crashmgr-done')?.addEventListener('click', close);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#crashmgr-folder')?.addEventListener('click', () => invoke('open_crash_folder').catch(() => {}));
    overlay.querySelector('#crashmgr-import')?.addEventListener('click', async () => {
        const src = await pickFile({ filters: [{ name: 'BMM Replay', extensions: ['bmmreplay', 'json'] }] }).catch(() => null);
        if (src) importReplayFromPath(String(src));
    });
    overlay.querySelector('#crashmgr-applylimits')?.addEventListener('click', async () => {
        const keep = (overlay.querySelector('#crashmgr-keep') as HTMLInputElement).value;
        const mb = (overlay.querySelector('#crashmgr-maxmb') as HTMLInputElement).value;
        localStorage.setItem(KEEP_KEY, String(Math.max(1, parseInt(keep, 10) || 30)));
        localStorage.setItem(SIZE_KEY, String(Math.max(0, parseInt(mb, 10) || 0)));
        const n = await pruneSessions();
        toast(`${t('crashmgr.pruned') || 'Pruned'}: ${n}`, 'success');
        render();
    });
    // Apply current limits whenever the manager opens, so the lists stay tidy.
    pruneSessions().then(() => render());

    let tab: 'reports' | 'sessions' = 'reports';
    overlay.querySelectorAll('.crashmgr-tab').forEach(b => b.addEventListener('click', () => {
        tab = (b as HTMLElement).dataset.tab as any;
        overlay.querySelectorAll('.crashmgr-tab').forEach(x => x.classList.toggle('active', x === b));
        render();
    }));

    const render = () => (tab === 'reports' ? renderReports() : renderSessions());

    const catClass = (c: string) => /crash/i.test(c) ? 'is-crash' : 'is-session';

    async function renderReports() {
        body.innerHTML = `<p class="crashmgr-empty">${t('common.loading') || 'Loading…'}</p>`;
        let reports: CrashEntry[] = [];
        try { reports = await invoke('list_crash_reports') as CrashEntry[]; } catch { /* none */ }
        if (!reports.length) { body.innerHTML = `<p class="crashmgr-empty">${t('crashmgr.noReports') || 'No crash reports — good news!'}</p>`; return; }
        // Group by category; each category is ONE collapsible section. Rows inside are
        // always visible. Recent (Crash/Session) open by default; archives collapsed.
        const groups: Record<string, CrashEntry[]> = {};
        for (const r of reports) (groups[r.category] ||= []).push(r);
        const order = ['Crash', 'Session', 'Archive/Crash', 'Archive/Session'];
        const cats = Object.keys(groups).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
        body.innerHTML = cats.map(cat => {
            const list = groups[cat];
            const openByDefault = cat === 'Crash' || cat === 'Session';
            return `<details class="crashmgr-group" ${openByDefault ? 'open' : ''}>
                <summary class="crashmgr-gsum">
                    <svg class="crashmgr-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="9 6 15 12 9 18"/></svg>
                    <span class="crashmgr-dot ${catClass(cat)}"></span>
                    <span class="crashmgr-gtitle">${esc(cat)}</span>
                    <span class="crashmgr-gcount">${list.length}</span>
                </summary>
                <div class="crashmgr-glist">${list.map(r => `
                    <div class="crashmgr-row" data-p="${esc(r.path)}" data-n="${esc(r.name)}">
                        <div class="crashmgr-info">
                            <span class="crashmgr-name">${esc(r.name)}</span>
                            <span class="crashmgr-meta">${esc(fmtDate(r.date))} · ${fmtSize(r.size)}</span>
                        </div>
                        <div class="crashmgr-row-actions">
                            <button class="btn btn-xs btn-ghost" data-act="analyze">${t('crashmgr.analyze') || 'Analyze'}</button>
                            <button class="btn btn-xs btn-ghost" data-act="open">${t('crashmgr.openZip') || 'Open'}</button>
                            <button class="btn btn-xs btn-ghost" data-act="export">${t('crashmgr.export') || 'Export'}</button>
                            <button class="btn btn-xs btn-ghost crashmgr-del" data-act="delete">${t('common.delete') || 'Delete'}</button>
                        </div>
                    </div>
                    <div class="crashmgr-rowdetail" data-detail style="display:none"></div>`).join('')}
                </div>
            </details>`;
        }).join('');
        body.querySelectorAll('.crashmgr-row [data-act]').forEach(b => b.addEventListener('click', () => onReportAction(b as HTMLElement)));
    }

    async function onReportAction(b: HTMLElement) {
        const row = b.closest('.crashmgr-row') as HTMLElement;
        const path = row.dataset.p!;
        const act = b.dataset.act!;
        if (act === 'open') { invoke('open_file', { path }).catch(e => toast(String(e), 'error')); return; }
        if (act === 'export') {
            const dest = await saveFile({ defaultPath: row.dataset.n || 'crash-report.zip', filters: [{ name: 'Zip', extensions: ['zip'] }] }).catch(() => null);
            if (dest) { try { await invoke('copy_file', { src: path, dest }); toast(t('crashmgr.exported') || 'Exported', 'success'); } catch (e) { toast(String(e), 'error'); } }
            return;
        }
        if (act === 'delete') {
            if (!confirm(t('crashmgr.confirmDelete') || 'Delete this crash report?')) return;
            try { await invoke('delete_crash_report', { path }); toast(t('crashmgr.deleted') || 'Deleted', 'success'); renderReports(); }
            catch (e) { toast(String(e), 'error'); }
            return;
        }
        if (act === 'analyze') {
            const detail = row.nextElementSibling as HTMLElement;
            if (!detail || detail.dataset.detail === undefined) return;
            if (detail.style.display !== 'none') { detail.style.display = 'none'; return; }   // toggle off
            detail.style.display = 'block';
            detail.innerHTML = `<p class="crashmgr-empty">${t('common.loading') || 'Loading…'}</p>`;
            try {
                const r = await invoke('read_crash_report', { path }) as { metadata: string; systemInfo: string; logs: string; files: string[]; hasSession: boolean; };
                // Which entries the backend will serve as text (mirrors its allow-list).
                const TEXT_EXTS = ['txt', 'md', 'log', 'json', 'cfg', 'toml', 'csv', 'yaml', 'yml', 'ini'];
                const isText = (n: string) => TEXT_EXTS.includes((n.split('.').pop() || '').toLowerCase());
                const filesList = r.files.map(fn => isText(fn)
                    ? `<button class="crashmgr-file" data-file="${esc(fn)}">${esc(fn)}</button>`
                    : `<span class="crashmgr-file crashmgr-file-bin" data-tooltip="${esc(t('crashmgr.notText') || 'Not a readable text file')}">${esc(fn)}</span>`
                ).join('');
                detail.innerHTML = `
                    ${r.hasSession ? `<button class="btn btn-xs btn-accent" data-play style="margin-bottom:8px">${t('crashmgr.playSession') || '▶ Play session'}</button>` : ''}
                    ${r.metadata ? `<h5>metadata</h5><pre class="crashmgr-pre">${esc(r.metadata)}</pre>` : ''}
                    ${r.logs ? `<h5>app logs (tail)</h5><pre class="crashmgr-pre">${esc(r.logs)}</pre>` : ''}
                    ${r.systemInfo ? `<details class="crashmgr-sub"><summary>system_info</summary><pre class="crashmgr-pre">${esc(r.systemInfo)}</pre></details>` : ''}
                    <details class="crashmgr-sub" open><summary>${t('crashmgr.files') || 'Files in report'} (${r.files.length})</summary>
                        <p class="crashmgr-fileshint">${t('crashmgr.filesHint') || 'Click a file to read its contents.'}</p>
                        <div class="crashmgr-filelist">${filesList}</div>
                        <div class="crashmgr-fileview" data-fileview hidden></div>
                    </details>`;
                detail.querySelector('[data-play]')?.addEventListener('click', async () => {
                    try { const json = await invoke('read_crash_session', { path }) as string; await playReplayJson(json); }
                    catch (e) { toast(String(e), 'error'); }
                });
                // Read-only per-file viewer. Content is rendered as escaped text in a
                // <pre> — never as HTML — and served through the sandboxed backend command.
                const fileview = detail.querySelector('[data-fileview]') as HTMLElement | null;
                detail.querySelectorAll('.crashmgr-file[data-file]').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        if (!fileview) return;
                        const entry = (btn as HTMLElement).dataset.file || '';
                        detail.querySelectorAll('.crashmgr-file.active').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        fileview.hidden = false;
                        fileview.innerHTML = `<p class="crashmgr-empty">${t('common.loading') || 'Loading…'}</p>`;
                        try {
                            const fd = await invoke('read_crash_report_file', { path, entry }) as { name: string; content: string; size: number; truncated: boolean };
                            fileview.innerHTML = `
                                <div class="crashmgr-fileview-head">
                                    <span class="crashmgr-fileview-name">${esc(fd.name)}</span>
                                    ${fd.truncated ? `<span class="crashmgr-fileview-trunc">${t('crashmgr.truncated') || 'truncated to 2 MB'}</span>` : ''}
                                    <button class="btn btn-xs btn-ghost" data-fileclose>${t('common.close') || 'Close'}</button>
                                </div>
                                <pre class="crashmgr-pre crashmgr-fileview-body">${esc(fd.content)}</pre>`;
                            fileview.querySelector('[data-fileclose]')?.addEventListener('click', () => {
                                fileview.hidden = true; fileview.innerHTML = '';
                                btn.classList.remove('active');
                            });
                        } catch (e) { fileview.innerHTML = `<p class="crashmgr-empty">${esc(String(e))}</p>`; }
                    });
                });
            } catch (e) { detail.innerHTML = `<p class="crashmgr-empty">${esc(String(e))}</p>`; }
        }
    }

    async function renderSessions() {
        body.innerHTML = `<p class="crashmgr-empty">${t('common.loading') || 'Loading…'}</p>`;
        let list: SavedReplay[] = [];
        try { list = await invoke('list_saved_replays') as SavedReplay[]; } catch { /* none */ }
        if (!list.length) { body.innerHTML = `<p class="crashmgr-empty">${t('crashmgr.noSessions') || 'No saved sessions. Enable the Session recorder to keep each session.'}</p>`; return; }
        body.innerHTML = list.map(s => `
            <div class="crashmgr-row">
                <div class="crashmgr-info">
                    <span class="crashmgr-name">${esc(s.name)}</span>
                    <span class="crashmgr-meta">${new Date(s.ts).toLocaleString()} · ${fmtSize(s.size)}</span>
                </div>
                <div class="crashmgr-row-actions">
                    <button class="btn btn-xs btn-accent" data-sact="play" data-p="${esc(s.path)}">${t('crashmgr.play') || '▶ Play'}</button>
                    <button class="btn btn-xs btn-ghost" data-sact="export" data-p="${esc(s.path)}" data-n="${esc(s.name)}">${t('crashmgr.export') || 'Export'}</button>
                    <button class="btn btn-xs btn-ghost crashmgr-del" data-sact="delete" data-p="${esc(s.path)}">${t('common.delete') || 'Delete'}</button>
                </div>
            </div>`).join('');
        body.querySelectorAll('[data-sact]').forEach(b => b.addEventListener('click', async () => {
            const el = b as HTMLElement; const path = el.dataset.p!; const act = el.dataset.sact!;
            if (act === 'play') { importReplayFromPath(path); return; }
            if (act === 'delete') {
                if (!confirm(t('crashmgr.confirmDeleteSession') || 'Delete this session?')) return;
                try { await invoke('delete_local_replay', { path }); toast(t('crashmgr.deleted') || 'Deleted', 'success'); renderSessions(); } catch (e) { toast(String(e), 'error'); }
                return;
            }
            if (act === 'export') {
                const dest = await saveFile({ defaultPath: el.dataset.n || 'session.bmmreplay', filters: [{ name: 'BMM Replay', extensions: ['bmmreplay'] }] }).catch(() => null);
                if (dest) { try { await invoke('copy_file', { src: path, dest }); toast(t('crashmgr.exported') || 'Exported', 'success'); } catch (e) { toast(String(e), 'error'); } }
            }
        }));
    }

    render();
}
