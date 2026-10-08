/**
 * add-mod.ts — the "Add a mod" dialog (#modal-add-mod): source, detection preview, copy.
 *
 * mods-actions.ts opens the dialog (fields, tag list, dependency picker) and hands Add to
 * confirmAddModFlow() here. This file owns what is new:
 *  · the source: a folder or an archive, from the pickers or dropped on the window;
 *  · the preview, read without extracting anything (folder_tree for a folder,
 *    preview_under for an archive): name and version guessed from the file name, files,
 *    size, top-level content, which ACTIVE mods ship the same relative paths, and the
 *    integrity state (hashed in the background once added);
 *  · the copy itself: busy button, a progress band with the size and elapsed time (add_mod
 *    sends no progress events, so the bar says "working" rather than inventing a percent),
 *    a refusal said inline;
 *  · Laya: when AI is on, an option to open the existing suggest dialog on the new mod.
 *
 * No import of mods.ts / app.ts on purpose: both import this file's caller, and the
 * library refresh and the toast are reachable on window (set by those modules at boot).
 */
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { appState } from '../../core/state.js';
import { uiIcon } from '../../ui/icons.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { describeSource, summarize, filePaths, findConflicts, formatSize, type SourceSummary, type ConflictHit, type TreeEntryLike } from './add-mod-model.js';
import { parentFolder } from '../profiles/profile-folders-model.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const w = (): any => window as any;
const toast = (msg: string, kind: string, ms?: number): void => { try { w().toast?.(msg, kind, ms); } catch { /* no toast host */ } };

interface Detection {
    path: string;
    kind: 'folder' | 'archive';
    archiveType: string;
    summary: SourceSummary | null;
    archiveBytes: number;
    conflicts: ConflictHit[] | null;
    error: string;
}

let det: Detection | null = null;
let detGen = 0;
/** What the dialog filled in itself: replaced by the next source, kept once the user typed. */
const auto: { name: string; version: string } = { name: '', version: '' };
/** Active mods' file lists, read once per session per mod (they change only on rescan). */
const filesCache = new Map<string, string[]>();
let aiAvailable = false;
let busy = false;
let wired = false;
let timer: ReturnType<typeof setInterval> | null = null;

function isOpen(): boolean {
    return !!$('modal-add-mod')?.classList.contains('open');
}

function setHint(text: string, tone: '' | 'error' | 'ready' = ''): void {
    const hint = $('mod-add-hint');
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle('am-hint--error', tone === 'error');
    hint.classList.toggle('am-hint--ready', tone === 'ready');
    if (tone === 'error') hint.setAttribute('role', 'alert'); else hint.setAttribute('role', 'status');
}

/** Add stays off until there is a name and a source; the hint says which is missing. */
function refreshFooter(): void {
    if (busy) return;
    const name = ($<HTMLInputElement>('mod-name')?.value || '').trim();
    const src = ($<HTMLInputElement>('mod-folder')?.value || '').trim();
    const btn = $<HTMLButtonElement>('btn-confirm-add-mod');
    const missing: string[] = [];
    if (!src) missing.push(t('mod.add.needSource'));
    if (!name) missing.push(t('mod.add.needName'));
    if (btn) btn.disabled = missing.length > 0;
    const hint = $('mod-add-hint');
    if (hint?.classList.contains('am-hint--error')) return;
    if (missing.length) setHint(t('prof.need.lead', { what: missing.join(', ') }));
    else setHint(t('mod.add.ready'), 'ready');
}

function chip(text: string, tone = '', icon = ''): string {
    return `<span class="bms-chip${tone ? ' bms-chip--' + tone : ''}">${icon}${escHtml(text)}</span>`;
}

function renderPreview(): void {
    const box = $('mod-add-preview');
    const drop = $('mod-drop-zone');
    if (!box) return;
    if (!det) { box.hidden = true; box.innerHTML = ''; drop?.classList.remove('has-source'); return; }
    drop?.classList.add('has-source');
    box.hidden = false;
    const d = det;
    const kindChip = d.kind === 'archive'
        ? chip(t('mod.add.kindArchive', { type: d.archiveType.toUpperCase() }), 'accent', uiIcon('archive', 14))
        : chip(t('mod.add.kindFolder'), 'accent', uiIcon('folder', 14));
    const rows: string[] = [];
    if (d.error) {
        rows.push(`<div class="am-row am-row--error">${uiIcon('alert', 14)}<span>${escHtml(d.error)}</span></div>`);
    } else if (!d.summary) {
        rows.push(`<div class="am-row am-row--pending">${uiIcon('loader', 14, { cls: 'np-spin' })}<span>${escHtml(t(d.kind === 'archive' ? 'mod.add.readingArchive' : 'mod.add.readingFolder'))}</span></div>`);
    } else {
        const s = d.summary;
        const filesTxt = t('mod.add.files', { n: (s.capped ? s.files + '+' : String(s.files)) });
        const sizeTxt = d.kind === 'archive'
            ? t('mod.add.sizeArchive', { packed: formatSize(d.archiveBytes), full: formatSize(s.bytes) })
            : formatSize(s.bytes);
        rows.push(`<div class="am-stats">${kindChip}${chip(filesTxt, '', uiIcon('file', 14))}${chip(sizeTxt, '', uiIcon('hard-drive', 14))}${chip(t('mod.add.shaPending'), '', uiIcon('shield', 14))}</div>`);
        if (s.top.length) {
            rows.push(`<div class="am-row am-row--meta"><span class="am-k">${escHtml(t('mod.add.contains'))}</span><span class="am-top">${s.top.map((n) => `<code>${escHtml(n)}</code>`).join('')}</span></div>`);
        }
        if (!s.files) rows.push(`<div class="am-row am-row--warn">${uiIcon('warning', 14)}<span>${escHtml(t('mod.add.empty'))}</span></div>`);
        if (d.conflicts === null) {
            rows.push(`<div class="am-row am-row--pending">${uiIcon('loader', 14, { cls: 'np-spin' })}<span>${escHtml(t('mod.add.checkingConflicts'))}</span></div>`);
        } else if (!d.conflicts.length) {
            rows.push(`<div class="am-row am-row--ok">${uiIcon('success', 14)}<span>${escHtml(t('mod.add.noConflicts'))}</span></div>`);
        } else {
            const list = d.conflicts.slice(0, 4).map((c) => `<li><b>${escHtml(c.name)}</b> <span class="am-muted">${escHtml(t('mod.add.conflictFiles', { n: String(c.count) }))}</span>${c.sample.length ? ` <code title="${escAttr(c.sample.join('\n'))}">${escHtml(c.sample[0])}</code>` : ''}</li>`).join('');
            const more = d.conflicts.length > 4 ? `<li class="am-muted">${escHtml(t('mod.add.conflictMore', { n: String(d.conflicts.length - 4) }))}</li>` : '';
            rows.push(`<div class="am-row am-row--warn am-row--block">${uiIcon('warning', 14)}<div><span>${escHtml(t('mod.add.conflicts', { n: String(d.conflicts.length) }))}</span><ul class="am-conflicts">${list}${more}</ul></div></div>`);
        }
    }
    // The path is already in the Source field above; while reading, the kind says what is read.
    box.innerHTML = `${d.summary || d.error ? '' : `<div class="am-preview-h">${kindChip}</div>`}${rows.join('')}`;
}

async function enabledModFiles(gen: number): Promise<Array<{ id: string; name: string; files: string[] }> | null> {
    const mods = ((appState.state as any).allMods || []).filter((m: any) => m && m.enabled).slice(0, 80);
    const out: Array<{ id: string; name: string; files: string[] }> = [];
    let i = 0;
    const worker = async (): Promise<void> => {
        while (i < mods.length) {
            const m = mods[i++];
            let files = filesCache.get(m.id);
            if (!files) {
                try { files = ((await invoke('list_mod_files_recursive', { modId: m.id }, { quiet: true })) as string[]) || []; } catch { files = []; }
                filesCache.set(m.id, files);
            }
            if (gen !== detGen) return;
            out.push({ id: m.id, name: m.name || m.id, files });
        }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return gen === detGen ? out : null;
}

async function detect(path: string): Promise<void> {
    const gen = ++detGen;
    const info = describeSource(path);
    det = { path, kind: info.kind, archiveType: info.archiveType, summary: null, archiveBytes: 0, conflicts: null, error: '' };
    renderPreview();
    let entries: TreeEntryLike[] = [];
    try {
        if (info.kind === 'archive') {
            const p: any = await invoke('preview_under', { root: parentFolder(path), rel: info.base }, { quiet: true });
            entries = (p?.entries || []) as TreeEntryLike[];
            det.archiveBytes = Number(p?.size) || 0;
            if (gen !== detGen) return;
            det.summary = summarize(entries);
            if (p?.truncated) det.summary.capped = true;
        } else {
            entries = ((await invoke('folder_tree', { path }, { quiet: true })) as TreeEntryLike[]) || [];
            if (gen !== detGen) return;
            det.summary = summarize(entries, 5000);
        }
    } catch (e) {
        if (gen !== detGen) return;
        det.error = t('mod.add.readFailed', { e: t(String((e as Error)?.message || e)) });
        renderPreview();
        return;
    }
    renderPreview();
    const others = await enabledModFiles(gen);
    if (!others || gen !== detGen || !det) return;
    det.conflicts = findConflicts(filePaths(entries), others);
    renderPreview();
}

/** A source chosen (picker or drop): fill the path, guess name and version, read it. */
export function setAddModSource(path: string): void {
    const p = String(path || '').trim();
    if (!p) return;
    const folder = $<HTMLInputElement>('mod-folder');
    if (folder) { folder.value = p; folder.title = p; }
    const info = describeSource(p);
    const name = $<HTMLInputElement>('mod-name');
    if (name && (!name.value.trim() || name.value === auto.name)) { name.value = info.name; auto.name = info.name; }
    const ver = $<HTMLInputElement>('mod-version');
    if (ver && info.version && (!ver.value.trim() || ver.value === '1.0.0' || ver.value === auto.version)) { ver.value = info.version; auto.version = info.version; }
    setHint('');
    refreshFooter();
    void detect(p);
}

function setDropHover(on: boolean): void {
    $('mod-drop-zone')?.classList.toggle('is-over', on && isOpen());
}

/** Once: drag hover on the drop zone, the zone as a button, field edits. */
function wire(): void {
    if (wired) return;
    wired = true;
    void import('../../core/api.js').then(async (api) => {
        try {
            await api.listen('tauri://drag-enter', () => setDropHover(true));
            await api.listen('tauri://drag-over', () => setDropHover(true));
            await api.listen('tauri://drag-leave', () => setDropHover(false));
            await api.listen('tauri://drag-drop', () => setDropHover(false));
        } catch { /* a browser preview has no window drop */ }
    });
    const zone = $('mod-drop-zone');
    zone?.addEventListener('click', () => $('btn-pick-mod-folder')?.click());
    zone?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('btn-pick-mod-folder')?.click(); }
    });
    for (const id of ['mod-name', 'mod-version', 'mod-author', 'mod-desc']) {
        $(id)?.addEventListener('input', () => {
            const hint = $('mod-add-hint');
            if (hint?.classList.contains('am-hint--error')) setHint('');
            refreshFooter();
        });
    }
    $('mod-name')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); $<HTMLButtonElement>('btn-confirm-add-mod')?.click(); }
    });
}

/** Every time the dialog opens. */
export async function prepareAddModForm(): Promise<void> {
    wire();
    det = null;
    detGen++;
    auto.name = '';
    auto.version = '';
    busy = false;
    stopProgress();
    const folder = $<HTMLInputElement>('mod-folder');
    if (folder) folder.title = '';
    renderPreview();
    setHint('');
    refreshFooter();
    const row = $('mod-add-ai-row');
    if (row) row.hidden = true;
    try {
        const { loadAiView } = await import('../ai/ai-shared.js');
        const view = await loadAiView();
        const s: any = view?.settings;
        aiAvailable = !!(s && s.enabled && s.mod_suggest !== false);
    } catch { aiAvailable = false; }
    if (row) row.hidden = !aiAvailable;
    const box = $<HTMLInputElement>('mod-add-ai');
    if (box) box.checked = aiAvailable;
}

function startProgress(label: string): void {
    const band = $('mod-add-progress');
    const lab = $('mod-add-progress-label');
    const time = $('mod-add-progress-time');
    if (!band) return;
    band.hidden = false;
    if (lab) lab.textContent = label;
    try { band.scrollIntoView({ block: 'nearest' }); } catch { /* not laid out */ }
    const t0 = Date.now();
    const tick = () => {
        const s = Math.floor((Date.now() - t0) / 1000);
        if (time) time.textContent = s >= 1 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
    };
    tick();
    timer = setInterval(tick, 1000);
}

function stopProgress(): void {
    if (timer) { clearInterval(timer); timer = null; }
    const band = $('mod-add-progress');
    if (band) band.hidden = true;
}

function lockForm(on: boolean): void {
    const modal = $('modal-add-mod');
    modal?.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('.modal-body input, .modal-body button, .modal-body select').forEach((el) => { el.disabled = on; });
    $('mod-drop-zone')?.classList.toggle('is-locked', on);
}

/** Add: copy the source into the profile's mods folder (add_mod), then refresh the library. */
export async function confirmAddModFlow(): Promise<void> {
    if (busy) return;
    const name = ($<HTMLInputElement>('mod-name')?.value || '').trim();
    const folder = ($<HTMLInputElement>('mod-folder')?.value || '').trim();
    if (!name || !folder) {
        refreshFooter();
        (!folder ? $('btn-pick-mod-folder') : $('mod-name'))?.focus();
        return;
    }
    const version = ($<HTMLInputElement>('mod-version')?.value || '').trim() || '1.0.0';
    const author = ($<HTMLInputElement>('mod-author')?.value || '').trim();
    const description = ($<HTMLInputElement>('mod-desc')?.value || '').trim();
    const tagId = ($<HTMLSelectElement>('mod-tag')?.value || '');
    const modal = $('modal-add-mod') as any;
    const depInput = $('mod-dependency-input') as any;
    const download_links = modal?._pendingLinks || null;
    const dependencies = depInput?._selectedDeps || [];
    const askLaya = aiAvailable && !!$<HTMLInputElement>('mod-add-ai')?.checked;

    const btn = $<HTMLButtonElement>('btn-confirm-add-mod');
    const original = btn?.innerHTML || '';
    busy = true;
    if (btn) {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        btn.innerHTML = `${uiIcon('loader', 14, { cls: 'np-spin' })}<span>${escHtml(t('mod.add.copying'))}</span>`;
    }
    lockForm(true);
    const size = det && det.path === folder && det.summary ? (det.kind === 'archive' ? det.archiveBytes : det.summary.bytes) : 0;
    startProgress(size ? t('mod.add.copyingSize', { size: formatSize(size) }) : t('mod.add.copying'));
    setHint(t('mod.add.copyHint'));

    try {
        const entry: any = await invoke('add_mod', {
            payload: { name, modFolderPath: folder, author, description, version, tags: tagId ? [tagId] : [], downloadLinks: download_links, dependencies },
        });
        if (modal) modal._pendingLinks = null;
        if (depInput) depInput._selectedDeps = [];
        busy = false;
        stopProgress();
        lockForm(false);
        modal?.classList.remove('open');
        toast(t('mod.added', { name }), 'success');
        dispatchBmmAction(BMM_ACTIONS.MOD_ADDED, { name });
        try { await w()._refreshModsFn?.(false, true); } catch { /* library not mounted */ }
        if (askLaya && entry?.id) void openLaya(entry);
    } catch (err) {
        busy = false;
        stopProgress();
        lockForm(false);
        setHint(t('mod.add.failed', { e: t(String((err as Error)?.message || err)) }), 'error');
    } finally {
        if (btn) {
            btn.removeAttribute('aria-busy');
            btn.innerHTML = original;
        }
        if (!busy) refreshFooter();
    }
}

/** The existing suggest dialog (features/ai/ai-suggest.ts), on the mod just added. */
async function openLaya(entry: any): Promise<void> {
    try {
        const mods: any[] = (appState.state as any).allMods || [];
        const mod = mods.find((m) => m.id === entry.id) || entry;
        const { openAiSuggest } = await import('../ai/ai-suggest.js');
        await openAiSuggest(mod, {
            tagName: (id: string) => ((appState.state as any).userTags || []).find((x: any) => x.id === id)?.name || id,
            onApplied: (res) => {
                toast((res?.skippedTags || []).length ? t('ai.suggest.appliedSkipped') : t('ai.suggest.applied'), 'success');
                try { w()._refreshModsFn?.(false, true); } catch { /* library not mounted */ }
            },
        });
    } catch (e) {
        toast(`${t('common.error')} : ${String((e as Error)?.message || e)}`, 'error');
    }
}

/** True when a drop belongs to this dialog (it is open): the caller then stops there. */
export function takeDrop(paths: string[]): boolean {
    setDropHover(false);
    if (!isOpen() || busy || !paths?.length) return false;
    setAddModSource(paths[0]);
    return true;
}
