// Integrity (SHA): the dialog behind Settings → Hashes / SHA & Integrity, the command palette's
// "Hashing statistics" and the navbar shortcut (all three call window.showHashingStats).
//
// It used to be a progress ring and four numbers, redrawn whole every second (the switch under
// it lost its focus on each tick), with no way to see WHICH mods were in each number, and a
// second dialog to queue a re-hash. Now, in one dialog:
//
//   · four state tiles (verified / mismatch / no hash / not checked) that are also the filter;
//   · an activity line: background hashing (queue, current mod) or a check in progress, with
//     Cancel; it never blocks the list, and only its own text changes on a tick;
//   · the list, one row per mod: state, files, when it was hashed, the content id (monospace,
//     shortened, copy), Verify and Re-hash per row, and the files with their hashes on demand;
//   · Verify all / selected, Hash the missing ones, Re-hash, and an exported report (JSON / CSV).
//
// Rust stays the judge: get_hash_overview lists the states (no hash maps shipped), and a check is
// get_mod_integrity, one mod at a time, so Cancel stops between two mods.
import { invoke, listen, getSettings, updateSettings, saveFile } from '../../core/api.js';
import { t, getLang } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { learnMore } from '../../core/learn-more.js';
import { appState } from '../../core/state.js';
import { openModal, type ModalHandle } from '../../ui/modal-shell.js';
import { STATES, stateOf, stateName, countStates, filterRows, hashAlgo, shortHash, reportLine, reportJson, reportCsv, type HashRow, type HashState, type Report } from './integrity-model.js';

export type IntegrityToast = (message: string, type?: 'info' | 'success' | 'error' | 'warning', ms?: number) => void;

interface Stats { total_mods: number; hashed_mods: number; missing_mods: number; invalid_mods: number; valid_mods: number; queue_size: number; is_active: boolean; current_mod_name: string | null }

const tr = (key: string, en: string): string => { const v = t(key); return v && v !== key ? v : en; };
const esc = escHtml;
/** How many rows are drawn at once: a search narrows the rest. */
const ROW_CAP = 250;

const ICON = {
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    rehash: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
};
const svg = (paths: string, size = 14) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** This feature's stylesheet, linked the first time the card or the dialog needs it. */
export function ensureIntegrityCss(): void {
    if (document.getElementById('integrity-css')) return;
    const link = document.createElement('link');
    link.id = 'integrity-css';
    link.rel = 'stylesheet';
    link.href = 'css/integrity.css';
    document.head.appendChild(link);
}

const STATE_HINT: Record<HashState, [string, string]> = {
    verified: ['sha.hint.verified', 'Files match their hashes'],
    mismatch: ['sha.hint.mismatch', 'A file changed, appeared or vanished'],
    missing: ['sha.hint.missing', 'Never hashed yet'],
    unchecked: ['sha.hint.unchecked', 'Hashed, never compared'],
};

function when(s: string | null): string {
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString(getLang(), { dateStyle: 'medium', timeStyle: 'short' });
}

async function copy(text: string, toast: IntegrityToast): Promise<void> {
    try { await navigator.clipboard.writeText(text); toast(tr('sha.copied', 'Copied'), 'success', 1500); }
    catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
}

/** Keep the library's copy of a mod in step with what the dialog just learnt. */
function syncLibrary(id: string, invalid: boolean): void {
    const m = appState.state.allMods.find((x) => x.id === id);
    if (m) m.file_hashes_invalid = invalid;
}

// ── The settings card's summary line ───────────────────────────────────────────────────────

/** Fill the card's summary (one chip per state with its count, for every mod). Quiet on error:
 *  the card still has its buttons. */
export async function mountIntegritySummary(host: HTMLElement): Promise<void> {
    ensureIntegrityCss();
    try {
        const rows = await invoke('get_hash_overview', { profileId: null }) as HashRow[] | null;
        if (!Array.isArray(rows) || !rows.length) { host.hidden = true; return; }
        const c = countStates(rows);
        host.innerHTML = STATES.map((s) => `<span class="shc-pill is-${s}${c[s] ? '' : ' is-zero'}"><span class="shc-dot" aria-hidden="true"></span>${esc(stateName(s, t))}<b>${c[s]}</b></span>`).join('');
        host.hidden = false;
    } catch { host.hidden = true; }
}

// ── The dialog ─────────────────────────────────────────────────────────────────────────────

let _open: ModalHandle | null = null;

export async function openIntegrityCenter(toast: IntegrityToast, opts: { state?: HashState } = {}): Promise<void> {
    if (_open) { _open.close(); _open = null; }
    ensureIntegrityCss();

    const profiles = await (invoke('get_profiles') as Promise<{ id: string; name: string }[]>).catch(() => []);
    const active = await (invoke('get_active_profile_id') as Promise<string | null>).catch(() => null);
    let profileId: string | null = active && profiles.some((p) => p.id === active) ? active : null;

    let rows: HashRow[] = [];
    let filter: HashState | 'all' = opts.state || 'all';
    let query = '';
    const selected = new Set<string>();
    const reports = new Map<string, Report>();
    const queued = new Set<string>();
    const open = new Set<string>();
    let hashingId: string | null = null;
    let run: { cancel: boolean; i: number; n: number; name: string } | null = null;
    let stats: Stats | null = null;

    const select = document.createElement('select');
    select.className = 'input shc-profile';
    select.setAttribute('aria-label', tr('sha.scope', 'Which mods'));
    select.innerHTML = `<option value="">${esc(tr('sha.scopeAll', 'All profiles'))}</option>${profiles.map((p) => `<option value="${escAttr(p.id)}">${esc(p.name)}</option>`).join('')}`;
    select.value = profileId || '';

    const body = `
        <div class="shc">
            <div class="shc-tiles" role="group" aria-label="${escAttr(tr('sha.filterBy', 'Show mods by state'))}">
                <button type="button" class="shc-tile is-all" data-state="all" aria-pressed="false">
                    <span class="shc-tile-top"><span class="shc-tile-label">${esc(tr('sha.state.all', 'All mods'))}</span></span>
                    <b class="shc-tile-n" data-n="all">0</b>
                    <span class="shc-tile-hint">${esc(tr('sha.hint.all', 'Everything in this scope'))}</span>
                </button>
                ${STATES.map((s) => `<button type="button" class="shc-tile is-${s}" data-state="${s}" aria-pressed="false">
                    <span class="shc-tile-top"><span class="shc-dot" aria-hidden="true"></span><span class="shc-tile-label">${esc(stateName(s, t))}</span></span>
                    <b class="shc-tile-n" data-n="${s}">0</b>
                    <span class="shc-tile-hint">${esc(tr(STATE_HINT[s][0], STATE_HINT[s][1]))}</span>
                </button>`).join('')}
            </div>

            <div class="shc-activity" aria-live="polite">
                <span class="shc-act-dot" aria-hidden="true"></span>
                <div class="shc-act-text">
                    <div class="shc-act-title"></div>
                    <div class="bms-progress shc-act-bar" hidden><span></span></div>
                </div>
                <button type="button" class="btn btn-sm btn-secondary shc-act-cancel" hidden>${esc(tr('sha.cancel', 'Stop'))}</button>
                <label class="shc-act-lazy" data-tooltip="${escAttr(tr('settings.shaEnableLazyDesc', 'Automatically calculate missing hashes in the background'))}">
                    <span>${esc(tr('sha.lazyShort', 'Hash new mods in the background'))}</span>
                    <span class="bmm-switch"><input type="checkbox" class="shc-lazy" id="modal-chk-sha-lazy"><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></span>
                </label>
            </div>

            <details class="shc-about">
                <summary>${esc(tr('sha.about.title', 'What a hash protects, and what it does not'))}</summary>
                <div class="shc-about-body">
                    <p>${esc(tr('sha.about.what', 'When BMM hashes a mod, it records a fingerprint of every one of its files (BLAKE3, or SHA-256 for older baselines). Checking reads the files again and compares.'))}</p>
                    <p>${esc(tr('sha.about.mismatch', 'A mismatch means the mod is no longer the one that was hashed: a damaged download or disk, a file you edited, or something else that wrote there. Look at the files listed before enabling it.'))}</p>
                    <p>${esc(tr('sha.about.limit', 'A hash proves a mod has not changed; it does not prove the mod was safe to begin with. Re-hashing accepts the files as they are now as the new reference.'))}</p>
                    <p>${esc(tr('sha.about.strict', 'With strict integrity on (Settings), a mod without a valid hash cannot be enabled until it is hashed.'))}</p>
                    ${learnMore('integrity')}
                </div>
            </details>

            <div class="shc-listcard">
                <div class="shc-toolbar">
                    <label class="shc-check" title="${escAttr(tr('sha.selectShown', 'Select every mod shown'))}"><input type="checkbox" class="shc-all" aria-label="${escAttr(tr('sha.selectShown', 'Select every mod shown'))}"></label>
                    <label class="shc-search">${svg(ICON.search, 14)}<input type="search" class="form-input shc-q" placeholder="${escAttr(tr('sha.search', 'Search a mod or a content id'))}" aria-label="${escAttr(tr('sha.search', 'Search a mod or a content id'))}"></label>
                    <span class="shc-selcount" aria-live="polite"></span>
                    <button type="button" class="btn btn-sm btn-secondary shc-verify-sel" disabled>${esc(tr('sha.verifySel', 'Verify selected'))}</button>
                    <button type="button" class="btn btn-sm btn-ghost shc-rehash-sel" disabled>${esc(tr('sha.rehashSel', 'Re-hash selected'))}</button>
                </div>
                <div class="shc-list" role="list"></div>
                <div class="shc-cap" hidden></div>
            </div>
        </div>`;

    const footer = `
        <div class="modal-footer-start">
            <button type="button" class="btn btn-ghost btn-sm shc-export">${svg(ICON.export)}<span>${esc(tr('sha.export', 'Export report'))}</span></button>
            <button type="button" class="btn btn-ghost btn-sm shc-rehash-all">${svg(ICON.rehash)}<span>${esc(tr('sha.rehashAll', 'Re-hash…'))}</span></button>
        </div>
        <button type="button" class="btn btn-secondary shc-hash-missing">${esc(tr('sha.hashMissing', 'Hash the missing'))}</button>
        <button type="button" class="btn btn-primary shc-verify-all">${esc(tr('sha.verifyAll', 'Verify all shown'))}</button>`;

    let unlisten: (() => void) | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;

    const m = openModal({
        id: 'modal-sha-stats',
        title: tr('sha.title', 'Integrity (SHA)'),
        subtitle: tr('sha.subtitle', 'Check that your mod files are still exactly the ones BMM hashed.'),
        icon: svg(ICON.shield, 20),
        size: 'xl',
        tall: true,
        className: 'shc-modal',
        headerEnd: select,
        body,
        footer,
        closeLabel: t('common.close') || 'Close',
        initialFocus: '.shc-q',
        onClose: () => {
            if (run) run.cancel = true;
            clearInterval(poll);
            clearTimeout(reloadTimer);
            unlisten?.();
            _open = null;
        },
    });
    _open = m;
    const q = m.q;
    const list = q<HTMLElement>('.shc-list')!;

    // ── Drawing ──
    const shown = () => filterRows(rows, filter, query);

    const paintTiles = () => {
        const c = countStates(rows);
        m.dialog.querySelectorAll<HTMLElement>('[data-n]').forEach((el) => {
            const k = el.dataset.n as HashState | 'all';
            el.textContent = String(k === 'all' ? rows.length : c[k]);
        });
        m.dialog.querySelectorAll<HTMLElement>('.shc-tile').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.dataset.state === filter));
            const k = b.dataset.state as HashState | 'all';
            b.classList.toggle('is-zero', k !== 'all' && c[k] === 0);
        });
        const verifyAll = q<HTMLButtonElement>('.shc-verify-all');
        const n = shown().filter((r) => r.files > 0).length;
        if (verifyAll) {
            verifyAll.textContent = tr('sha.verifyAllN', 'Verify {n} shown').replace('{n}', String(n));
            verifyAll.disabled = !!run || n === 0;
        }
        const missing = q<HTMLButtonElement>('.shc-hash-missing');
        if (missing) {
            missing.textContent = tr('sha.hashMissingN', 'Hash {n} missing').replace('{n}', String(c.missing));
            missing.disabled = c.missing === 0;
        }
    };

    const rowHtml = (r: HashRow): string => {
        const s = stateOf(r);
        const rep = reports.get(r.id);
        const isQueued = queued.has(r.id);
        const isHashing = hashingId === r.id;
        const meta = [
            r.files ? (r.files === 1 ? tr('sha.files1', '1 file') : tr('sha.filesN', '{n} files').replace('{n}', String(r.files))) : tr('sha.noBaseline', 'No baseline'),
            r.hashed_at ? tr('sha.hashedOn', 'hashed {d}').replace('{d}', when(r.hashed_at)) : '',
        ].filter(Boolean).join(' · ');
        const busy = isHashing ? tr('sha.hashingNow', 'Hashing…') : isQueued ? tr('sha.queued', 'Queued') : '';
        const isOpen = open.has(r.id);
        return `<div class="shc-row is-${s}${isOpen ? ' is-open' : ''}" role="listitem" data-id="${escAttr(r.id)}">
            <input type="checkbox" class="shc-sel" aria-label="${escAttr(tr('sha.selectOne', 'Select {name}').replace('{name}', r.name))}"${selected.has(r.id) ? ' checked' : ''}>
            <span class="shc-pill is-${s}"><span class="shc-dot" aria-hidden="true"></span>${esc(stateName(s, t))}</span>
            <div class="shc-row-main">
                <div class="shc-row-name"><span class="shc-name" title="${escAttr(r.name)}">${esc(r.name)}</span>${r.version ? `<span class="shc-ver">${esc(r.version)}</span>` : ''}${r.enabled ? `<span class="shc-on">${esc(tr('sha.enabled', 'enabled'))}</span>` : ''}${busy ? `<span class="shc-busy">${esc(busy)}</span>` : ''}</div>
                <div class="shc-row-meta">${esc(meta)}${rep ? ` · <span class="shc-rep ${rep.isValid ? 'is-ok' : 'is-bad'}">${esc(reportLine(rep, t))}</span>` : ''}</div>
            </div>
            ${r.content_id ? `<span class="shc-cid" title="${escAttr(tr('sha.cidTip', 'Content id: the fingerprint of the whole mod. {id}').replace('{id}', r.content_id))}"><code>${esc(shortHash(r.content_id))}</code><button type="button" class="shc-icon-btn" data-copy="${escAttr(r.content_id)}" aria-label="${escAttr(tr('sha.copyCid', 'Copy the content id'))}">${svg(ICON.copy, 13)}</button></span>` : '<span class="shc-cid is-none" aria-hidden="true"></span>'}
            <div class="shc-row-acts">
                <button type="button" class="btn btn-sm btn-ghost" data-act="verify"${!r.files || run ? ' disabled' : ''}>${esc(tr('sha.verify', 'Verify'))}</button>
                <button type="button" class="btn btn-sm btn-ghost" data-act="rehash"${isQueued || isHashing ? ' disabled' : ''}>${esc(r.files ? tr('sha.rehash', 'Re-hash') : tr('sha.hash', 'Hash'))}</button>
                <button type="button" class="shc-icon-btn shc-expand" data-act="expand" aria-expanded="${isOpen}" aria-label="${escAttr(tr('sha.showFiles', 'Show the files and their hashes'))}"${r.files || rep ? '' : ' disabled'}>${svg(ICON.chevron, 14)}</button>
            </div>
            <div class="shc-detail"${isOpen ? '' : ' hidden'}></div>
        </div>`;
    };

    const paintSel = () => {
        const vis = shown().slice(0, ROW_CAP);
        const all = q<HTMLInputElement>('.shc-all');
        const nVis = vis.filter((r) => selected.has(r.id)).length;
        if (all) { all.checked = nVis > 0 && nVis === vis.length; all.indeterminate = nVis > 0 && nVis < vis.length; }
        const c = q<HTMLElement>('.shc-selcount');
        if (c) c.textContent = selected.size ? tr('sha.selected', '{n} selected').replace('{n}', String(selected.size)) : '';
        const v = q<HTMLButtonElement>('.shc-verify-sel');
        const h = q<HTMLButtonElement>('.shc-rehash-sel');
        if (v) v.disabled = !selected.size || !!run;
        if (h) h.disabled = !selected.size;
    };

    const paintList = () => {
        const all = shown();
        const vis = all.slice(0, ROW_CAP);
        if (!rows.length) {
            list.innerHTML = `<div class="bms-empty"><div class="bms-empty-ic">${svg(ICON.shield, 20)}</div><div class="bms-empty-t">${esc(tr('sha.empty', 'No mods in this scope'))}</div><div>${esc(tr('sha.emptyHint', 'Pick another profile above, or add mods to the library.'))}</div></div>`;
        } else if (!vis.length) {
            list.innerHTML = `<div class="bms-empty"><div class="bms-empty-t">${esc(tr('sha.noMatch', 'Nothing matches'))}</div><div>${esc(tr('sha.noMatchHint', 'Clear the search or choose another state.'))}</div></div>`;
        } else {
            list.innerHTML = vis.map(rowHtml).join('');
            for (const id of open) { const el = rowEl(id); if (el) void fillDetail(el, id); }
        }
        const cap = q<HTMLElement>('.shc-cap');
        if (cap) {
            cap.hidden = all.length <= ROW_CAP;
            cap.textContent = tr('sha.cap', 'Showing {a} of {b}. Search to narrow the list.').replace('{a}', String(ROW_CAP)).replace('{b}', String(all.length));
        }
        paintTiles();
        paintSel();
    };

    const rowEl = (id: string) => list.querySelector<HTMLElement>(`.shc-row[data-id="${CSS.escape(id)}"]`);
    const repaintRow = (id: string) => {
        const r = rows.find((x) => x.id === id);
        const el = rowEl(id);
        if (!r || !el) return;
        const tpl = document.createElement('template');
        tpl.innerHTML = rowHtml(r).trim();
        const next = tpl.content.firstElementChild as HTMLElement;
        el.replaceWith(next);
        if (open.has(id)) void fillDetail(next, id);
    };

    const fillDetail = async (rowNode: HTMLElement, id: string) => {
        const box = rowNode.querySelector<HTMLElement>('.shc-detail');
        if (!box) return;
        const rep = reports.get(id);
        const section = (cls: string, title: string, items: string[]) => items.length
            ? `<div class="shc-issues ${cls}"><div class="shc-issues-h">${esc(title)} <b>${items.length}</b></div><ul>${items.slice(0, 200).map((f) => `<li><code>${esc(f)}</code></li>`).join('')}${items.length > 200 ? `<li class="shc-more">${esc(tr('sha.andMore', 'and {n} more').replace('{n}', String(items.length - 200)))}</li>` : ''}</ul></div>`
            : '';
        const issues = rep && !rep.isValid
            ? section('is-mod', tr('sha.rep.modifiedT', 'Changed since hashed'), rep.modified)
                + section('is-miss', tr('sha.rep.missingT', 'Missing'), rep.missing)
                + section('is-add', tr('sha.rep.addedT', 'Added since hashed'), rep.added)
            : '';
        box.innerHTML = `${issues}<div class="shc-files"><div class="shc-issues-h">${esc(tr('sha.filesT', 'Files and their hashes'))}</div><div class="shc-files-list"><div class="stm-loading">${esc(t('storage.loading') || 'Loading…')}</div></div></div>`;
        const target = box.querySelector<HTMLElement>('.shc-files-list');
        try {
            const map = await invoke('get_mod_hashes', { modId: id }) as Record<string, string> | null;
            if (!target || !target.isConnected) return;
            const entries = Object.entries(map || {}).sort((a, b) => a[0].localeCompare(b[0]));
            if (!entries.length) { target.innerHTML = `<div class="shc-more">${esc(tr('sha.noBaseline', 'No baseline'))}</div>`; return; }
            const changed = new Set(rep?.modified || []);
            target.innerHTML = entries.slice(0, 300).map(([p, h]) => `<div class="shc-file${changed.has(p) ? ' is-changed' : ''}">
                <code class="shc-file-path" title="${escAttr(p)}">${esc(p)}</code>
                <span class="shc-algo">${hashAlgo(h)}</span>
                <code class="shc-hash" title="${escAttr(h)}">${esc(shortHash(h))}</code>
                <button type="button" class="shc-icon-btn" data-copy="${escAttr(h.startsWith('b3:') ? h.slice(3) : h)}" aria-label="${escAttr(tr('sha.copyHash', 'Copy the hash of {f}').replace('{f}', p))}">${svg(ICON.copy, 13)}</button>
            </div>`).join('') + (entries.length > 300 ? `<div class="shc-more">${esc(tr('sha.andMore', 'and {n} more').replace('{n}', String(entries.length - 300)))}</div>` : '');
        } catch (err) {
            if (target) target.innerHTML = `<div class="stm-msg is-err">${esc(String(err))}</div>`;
        }
    };

    const paintActivity = () => {
        const title = q<HTMLElement>('.shc-act-title');
        const bar = q<HTMLElement>('.shc-act-bar');
        const fill = bar?.querySelector<HTMLElement>('span');
        const cancel = q<HTMLButtonElement>('.shc-act-cancel');
        const box = q<HTMLElement>('.shc-activity');
        if (!title || !bar || !fill || !cancel || !box) return;
        let state: 'run' | 'bg' | 'idle' = 'idle';
        if (run) {
            state = 'run';
            title.textContent = tr('sha.act.run', 'Checking {i} of {n}: {name}').replace('{i}', String(run.i)).replace('{n}', String(run.n)).replace('{name}', run.name);
            bar.hidden = false;
            fill.style.width = `${run.n ? Math.round(run.i / run.n * 100) : 0}%`;
        } else if (stats && (stats.is_active || stats.queue_size > 0)) {
            state = 'bg';
            const cur = stats.current_mod_name ? tr('sha.act.bgNow', 'Hashing {name}').replace('{name}', stats.current_mod_name) : tr('sha.act.bg', 'Hashing in the background');
            title.textContent = `${cur} · ${tr('sha.act.queue', '{n} waiting').replace('{n}', String(stats.queue_size))}`;
            bar.hidden = false;
            fill.style.width = `${stats.total_mods ? Math.round(stats.hashed_mods / stats.total_mods * 100) : 0}%`;
        } else {
            const c = countStates(rows);
            title.textContent = tr('sha.act.idle', 'Nothing running. {h} of {n} mods have a baseline.').replace('{h}', String(rows.length - c.missing)).replace('{n}', String(rows.length));
            bar.hidden = true;
        }
        box.dataset.state = state;
        cancel.hidden = state !== 'run';
    };

    // ── Data ──
    const reload = async () => {
        try { rows = await invoke('get_hash_overview', { profileId }) as HashRow[]; }
        catch (err) { rows = []; toast(`${t('common.error')}: ${err}`, 'error'); }
        for (const id of [...selected]) if (!rows.some((r) => r.id === id)) selected.delete(id);
        paintList();
        paintActivity();
    };
    const reloadSoon = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => void reload(), 400); };
    const tick = async () => {
        try { stats = await invoke('get_hashing_stats', { profileId }) as Stats; } catch { stats = null; }
        paintActivity();
    };

    // ── Actions ──
    const verifyMany = async (ids: string[]) => {
        if (run) return;
        const targets = rows.filter((r) => ids.includes(r.id) && r.files > 0);
        const skipped = ids.length - targets.length;
        if (!targets.length) { toast(tr('sha.nothingToVerify', 'Nothing to verify: these mods have no hash yet. Hash them first.'), 'info'); return; }
        run = { cancel: false, i: 0, n: targets.length, name: '' };
        paintTiles(); paintSel();
        list.querySelectorAll<HTMLButtonElement>('[data-act="verify"]').forEach((b) => { b.disabled = true; });
        let ok = 0, bad = 0, failed = 0;
        for (const r of targets) {
            if (run.cancel) break;
            run.i++; run.name = r.name;
            paintActivity();
            try {
                const rep = await invoke('get_mod_integrity', { modId: r.id }) as Report;
                reports.set(r.id, rep);
                r.invalid = !rep.isValid;
                syncLibrary(r.id, !rep.isValid);
                if (rep.isValid) ok++; else bad++;
            } catch { failed++; }
            if (_open !== m) return;
            repaintRow(r.id);
        }
        const stopped = run.cancel;
        run = null;
        paintList();
        paintActivity();
        (window as any)._refreshModsFn?.(false, true);
        const parts = [tr('sha.done.ok', '{n} match').replace('{n}', String(ok))];
        if (bad) parts.push(tr('sha.done.bad', '{n} with differences').replace('{n}', String(bad)));
        if (failed) parts.push(tr('sha.done.failed', '{n} could not be read').replace('{n}', String(failed)));
        if (skipped) parts.push(tr('sha.done.skipped', '{n} without a hash skipped').replace('{n}', String(skipped)));
        toast(`${stopped ? tr('sha.done.stopped', 'Check stopped.') : tr('sha.done.title', 'Check finished.')} ${parts.join(' · ')}`, bad || failed ? 'warning' : 'success', 6000);
    };

    const rehashMany = async (ids: string[]) => {
        if (!ids.length) return;
        const hasMismatch = rows.some((r) => ids.includes(r.id) && stateOf(r) === 'mismatch');
        if (hasMismatch) {
            const yes = await window.confirmCustom(
                tr('sha.rehashWarnT', 'Accept the files as they are now?'),
                esc(tr('sha.rehashWarn', 'Some of these mods do not match their hashes. Re-hashing makes their current files the new reference, and the mismatch will no longer show. Do it only if you changed these files yourself.')),
                'warning',
                { yesLabel: tr('sha.rehashYes', 'Re-hash anyway'), noLabel: t('common.cancel') || 'Cancel' },
            );
            if (!yes) return;
        }
        let failed = 0;
        for (const id of ids) {
            try { await invoke('recalculate_mod_sha', { modId: id }); queued.add(id); reports.delete(id); }
            catch { failed++; }
        }
        paintList();
        toast(failed ? `${t('common.error')}: ${failed}` : tr('sha.queuedN', '{n} queued for hashing.').replace('{n}', String(ids.length - failed)), failed ? 'error' : 'success');
        void tick();
    };

    // ── Wiring ──
    select.addEventListener('change', () => {
        profileId = select.value || null;
        selected.clear(); open.clear();
        void reload(); void tick();
    });
    m.dialog.querySelector('.shc-tiles')?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.shc-tile');
        if (!b) return;
        const k = b.dataset.state as HashState | 'all';
        filter = filter === k ? 'all' : k;
        paintList();
    });
    let qTimer: ReturnType<typeof setTimeout> | undefined;
    q<HTMLInputElement>('.shc-q')?.addEventListener('input', (e) => {
        clearTimeout(qTimer);
        const v = (e.target as HTMLInputElement).value;
        qTimer = setTimeout(() => { query = v; paintList(); }, 120);
    });
    q<HTMLInputElement>('.shc-all')?.addEventListener('change', (e) => {
        const on = (e.target as HTMLInputElement).checked;
        for (const r of shown().slice(0, ROW_CAP)) { if (on) selected.add(r.id); else selected.delete(r.id); }
        list.querySelectorAll<HTMLInputElement>('.shc-sel').forEach((c) => { c.checked = on; });
        paintSel();
    });
    list.addEventListener('change', (e) => {
        const c = e.target as HTMLInputElement;
        if (!c.classList.contains('shc-sel')) return;
        const id = c.closest<HTMLElement>('.shc-row')?.dataset.id;
        if (!id) return;
        if (c.checked) selected.add(id); else selected.delete(id);
        paintSel();
    });
    m.dialog.addEventListener('click', (e) => {
        const cp = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
        if (cp) { void copy(cp.dataset.copy || '', toast); return; }
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.shc-row [data-act]');
        if (!b || b.disabled) return;
        const row = b.closest<HTMLElement>('.shc-row');
        const id = row?.dataset.id;
        if (!row || !id) return;
        if (b.dataset.act === 'verify') void verifyMany([id]);
        else if (b.dataset.act === 'rehash') void rehashMany([id]);
        else if (b.dataset.act === 'expand') {
            const on = !open.has(id);
            if (on) open.add(id); else open.delete(id);
            row.classList.toggle('is-open', on);
            b.setAttribute('aria-expanded', String(on));
            const box = row.querySelector<HTMLElement>('.shc-detail');
            if (box) box.hidden = !on;
            if (on) void fillDetail(row, id);
        }
    });
    q('.shc-verify-sel')?.addEventListener('click', () => void verifyMany([...selected]));
    q('.shc-rehash-sel')?.addEventListener('click', () => void rehashMany([...selected]));
    q('.shc-verify-all')?.addEventListener('click', () => void verifyMany(shown().map((r) => r.id)));
    q('.shc-act-cancel')?.addEventListener('click', () => { if (run) run.cancel = true; });
    q('.shc-hash-missing')?.addEventListener('click', async () => {
        try {
            await invoke('recalculate_all_hashes', { profileId, onlyMissing: true });
            for (const r of rows) if (!r.files) queued.add(r.id);
            paintList();
            toast(t('mods.sha.queued') || 'Queued', 'success');
            void tick();
        } catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
    });
    q('.shc-rehash-all')?.addEventListener('click', () => openRehashPrompt(toast, profileId, () => { void reload(); void tick(); }));
    q('.shc-export')?.addEventListener('click', async () => {
        const list2 = shown();
        const stamp = new Date().toISOString().slice(0, 10);
        const path = await saveFile({
            defaultPath: `bmm-integrity-${stamp}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'CSV', extensions: ['csv'] }],
        });
        if (!path) return;
        const scope = profileId ? (profiles.find((p) => p.id === profileId)?.name || profileId) : 'all';
        const content = /\.csv$/i.test(path) ? reportCsv(list2, reports) : reportJson(list2, reports, scope, new Date().toISOString());
        try {
            await invoke('write_text_file', { path, content });
            toast(tr('sha.exported', 'Report saved: {n} mods.').replace('{n}', String(list2.length)), 'success');
        } catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
    });

    const lazy = q<HTMLInputElement>('.shc-lazy');
    try { const s: any = await getSettings(); if (lazy) lazy.checked = s?.enable_lazy_sha_calculation ?? true; } catch { /* left as drawn */ }
    lazy?.addEventListener('change', async () => {
        try {
            const s: any = await getSettings();
            s.enable_lazy_sha_calculation = lazy.checked;
            await updateSettings(s);
            if (lazy.checked) await invoke('trigger_sha_background_population');
            const main = document.getElementById('chk-sha-lazy-calc') as HTMLInputElement | null;
            if (main) main.checked = lazy.checked;
            void tick();
        } catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
    });

    // Live: a mod starts or finishes hashing → its row says so, the list reloads once.
    try {
        const off = await listen('sha-status-changed', (e: { payload?: { mod_id?: string; status?: string } }) => {
            const p = e?.payload;
            if (!p?.mod_id) return;
            if (p.status === 'calculating') { hashingId = p.mod_id; repaintRow(p.mod_id); return; }
            if (hashingId === p.mod_id) hashingId = null;
            queued.delete(p.mod_id);
            reloadSoon();
        });
        if (_open === m) unlisten = off; else off();
    } catch { /* no live updates: the poll still moves the activity line */ }

    await reload();
    await tick();
    poll = setInterval(() => { if (_open === m) void tick(); }, 1500);
}

/** "Re-hash…": the missing ones only, or every mod (which accepts the current files as the new
 *  reference). `profileId` null = every profile. */
export function openRehashPrompt(toast: IntegrityToast, profileId: string | null = null, after?: () => void): void {
    ensureIntegrityCss();
    const body = `
        <p class="modal-message">${esc(tr('settings.shaRecalculateDesc', 'Choose which hashes to calculate.'))}</p>
        <div class="shc-choices">
            <button type="button" class="shc-choice" data-only="1">
                <span class="shc-choice-ic">${svg(ICON.shield, 18)}</span>
                <span class="shc-choice-text"><b>${esc(tr('settings.shaRecalcMissing', 'Only missing hashes'))}</b><span>${esc(tr('sha.choice.missing', 'Mods that have never been hashed. Nothing that exists is replaced.'))}</span></span>
            </button>
            <button type="button" class="shc-choice is-warn" data-only="0">
                <span class="shc-choice-ic">${svg(ICON.rehash, 18)}</span>
                <span class="shc-choice-text"><b>${esc(tr('settings.shaRecalcAll', 'Recalculate everything'))}</b><span>${esc(tr('sha.choice.all', 'Every mod gets a new baseline from its files as they are now. A mismatch found earlier disappears.'))}</span></span>
            </button>
        </div>`;
    const m = openModal({
        id: 'modal-sha-recalc',
        title: tr('settings.shaRecalculateTitle', 'Recalculate hashes'),
        subtitle: profileId ? tr('sha.scopeOne', 'This profile only') : tr('sha.scopeAll', 'All profiles'),
        icon: svg(ICON.rehash, 20),
        tone: 'warn',
        size: 'sm',
        body,
        footer: `<button type="button" class="btn btn-ghost" data-close-modal>${esc(t('common.cancel') || 'Cancel')}</button>`,
        closeLabel: t('common.close') || 'Close',
    });
    m.q('[data-close-modal]')?.addEventListener('click', () => m.close());
    m.body.addEventListener('click', async (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.shc-choice');
        if (!b) return;
        try {
            await invoke('recalculate_all_hashes', { profileId, onlyMissing: b.dataset.only === '1' });
            toast(t('mods.sha.queued') || 'Queued', 'success');
            m.close();
            after?.();
        } catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
    });
}
