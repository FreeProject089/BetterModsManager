// mapper-preview.ts — the mapper's "Final preview" dialog.
//
// Summary first (where it lands, how many files and folders, what is new, what replaces a
// game file, what other mods also write, how big), then the warnings that deserve a look,
// then the files: a tree grouped by top folder, or a flat list with a search. Both are
// virtualised, so a mod with tens of thousands of files scrolls like one with ten.
// The footer is the decision: "Back" or "Apply".
//
// The numbers come from mapper-preview-model.ts (pure, tested); this file only draws them.
import { t } from '../../core/i18n.js';
import { escHtml, formatBytes } from '../../core/utils.js';
import { bindModal, MODAL_CLOSE_SVG } from '../../ui/modal-shell.js';
import { buildPreview, gameFileSet, middleEllipsis, matchesQuery, matchesFilter, visibleRange, type PvItem, type PvModel, type PvFilter, type PvFile } from './mapper-preview-model.js';

export interface PreviewOpts {
    gamePath: string;
    files: PvFile[];
    moves: Array<[string, string]>;
    deletions: string[];
    gameTree: Array<{ path: string; is_dir: boolean; children?: unknown[] | null }>;
    conflicts: Array<{ other_mod_name: string; file_count: number }>;
    /** Number of queued changes (moves + deletions + new folders). 0 disables Apply. */
    pending: number;
    onApply: () => void;
}

const ROW_H = 32;
const IC = {
    folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>',
    chev: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
};

type Row = { kind: 'group'; name: string; count: number; bytes: number; overwrites: number; open: boolean } | { kind: 'file'; it: PvItem; rel: string };

let _overlay: HTMLElement | null = null;
let _release: (() => void) | null = null;
let _ro: ResizeObserver | null = null;

function close(): void {
    if (!_overlay) return;
    _overlay.classList.remove('open');
    _release?.(); _release = null;
    _ro?.disconnect(); _ro = null;
    const o = _overlay; _overlay = null;
    setTimeout(() => o.remove(), 180);
}

export function openMapperPreview(opts: PreviewOpts): void {
    close();
    const model: PvModel = buildPreview(opts.files, opts.moves, gameFileSet(opts.gameTree), opts.deletions);
    const T = model.totals;
    const conflictFiles = opts.conflicts.reduce((n, c) => n + (Number(c.file_count) || 0), 0);
    const state = { view: 'tree' as 'tree' | 'list', q: '', filter: 'all' as PvFilter, open: new Set<string>() };
    // Few groups: open them all. Many files: start folded so the tree reads as a table of contents.
    if (T.files <= 300) for (const g of model.groups) state.open.add(g.name);

    const o = document.createElement('div');
    o.className = 'modal-overlay mpv2-overlay';
    o.id = 'modal-mapper-preview';
    const tile = (n: number | string, label: string, tone = '') =>
        `<div class="mpv2-tile${tone ? ` is-${tone}` : ''}"><b>${escHtml(String(n))}</b><span>${escHtml(label)}</span></div>`;
    const warnings: string[] = [];
    if (T.overwrites) warnings.push(`<li class="mpv2-warn"><span>${IC.warn}</span><span>${escHtml(t('mapper.pv.warnOverwrite', { n: String(T.overwrites) }))}</span><button type="button" class="mpv2-link" data-show="overwrite">${escHtml(t('mapper.pv.show'))}</button></li>`);
    if (T.atRoot) warnings.push(`<li class="mpv2-warn"><span>${IC.warn}</span><span>${escHtml(t('mapper.pv.warnRoot', { n: String(T.atRoot) }))}</span><button type="button" class="mpv2-link" data-show="root">${escHtml(t('mapper.pv.show'))}</button></li>`);
    if (opts.conflicts.length) {
        const names = opts.conflicts.slice(0, 4).map((c) => `${c.other_mod_name} (${c.file_count})`).join(', ') + (opts.conflicts.length > 4 ? ', …' : '');
        warnings.push(`<li class="mpv2-warn"><span>${IC.warn}</span><span>${escHtml(t('mapper.pv.warnConflicts', { names }))}</span></li>`);
    }
    const dest = opts.gamePath || '';
    o.innerHTML = `
    <div class="modal bms modal--xl modal--tall mpv2" role="dialog" aria-modal="true" aria-labelledby="mpv2-title">
      <div class="modal-header">
        <div class="bms-titles">
          <h2 class="modal-title" id="mpv2-title">${escHtml(t('mapper.preview'))}</h2>
          <div class="bms-sub mpv2-dest" title="${escHtml(dest)}">${IC.folder}<code>${escHtml(middleEllipsis(dest, 70))}</code></div>
        </div>
        <button type="button" class="modal-close" id="mpv2-x" aria-label="${escHtml(t('common.close'))}">${MODAL_CLOSE_SVG}</button>
      </div>
      <div class="mpv2-tiles">
        ${tile(T.files, t('mapper.pv.files'))}
        ${tile(T.folders, t('mapper.pv.folders'))}
        ${tile(T.news, t('mapper.pv.new'), 'ok')}
        ${tile(T.overwrites, t('mapper.pv.overwrites'), T.overwrites ? 'warn' : '')}
        ${tile(conflictFiles, t('mapper.pv.conflicts'), conflictFiles ? 'warn' : '')}
        ${tile(formatBytes(T.bytes), t('mapper.pv.size'))}
      </div>
      ${warnings.length ? `<ul class="mpv2-warns">${warnings.join('')}</ul>` : ''}
      <div class="modal-toolbar mpv2-bar">
        <div class="mpv2-seg" role="tablist">
          <button type="button" role="tab" data-view="tree" class="is-on" aria-selected="true">${escHtml(t('mapper.pv.tree'))}</button>
          <button type="button" role="tab" data-view="list" aria-selected="false">${escHtml(t('mapper.pv.list'))}</button>
        </div>
        <label class="mpv2-search">${IC.search}<input type="search" id="mpv2-q" placeholder="${escHtml(t('mapper.pv.search'))}" aria-label="${escHtml(t('mapper.pv.search'))}"></label>
        <div class="mpv2-filters" role="group">
          ${(['all', 'moved', 'overwrite', 'root'] as PvFilter[]).map((f) => `<button type="button" data-filter="${f}" class="${f === 'all' ? 'is-on' : ''}">${escHtml(t(`mapper.pv.f.${f}`))}</button>`).join('')}
        </div>
      </div>
      <div class="modal-body modal-body--flush">
        <div class="mpv2-scroll" id="mpv2-scroll" tabindex="0"><div class="mpv2-spacer" id="mpv2-spacer"></div></div>
        <div class="mpv2-empty" id="mpv2-empty" hidden>${escHtml(T.files ? t('mapper.pv.noMatch') : t('mapper.noFiles'))}</div>
      </div>
      <div class="modal-footer mpv2-foot">
        <span class="modal-footer-note mpv2-foot-note">${escHtml(opts.pending ? t('mapper.pv.pending', { n: String(opts.pending) }) : t('mapper.pv.nothingPending'))}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="mpv2-back">${escHtml(t('mapper.pv.back'))}</button>
        <button type="button" class="btn btn-primary btn-sm" id="mpv2-apply" ${opts.pending ? '' : 'disabled'}>${escHtml(t('mapper.pv.apply'))}</button>
      </div>
    </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(o);
    _overlay = o;
    requestAnimationFrame(() => o.classList.add('open'));
    o.addEventListener('click', (e) => { if (e.target === o) close(); });
    const q = <E extends HTMLElement>(id: string) => o.querySelector<E>(`#${id}`);
    q('mpv2-x')?.addEventListener('click', close);
    q('mpv2-back')?.addEventListener('click', close);
    q('mpv2-apply')?.addEventListener('click', () => { close(); opts.onApply(); });
    _release = bindModal(o, { onClose: close, initialFocus: q<HTMLButtonElement>('mpv2-apply')?.disabled ? q('mpv2-back') : q('mpv2-apply') });

    const scroll = q<HTMLElement>('mpv2-scroll')!;
    const spacer = q<HTMLElement>('mpv2-spacer')!;
    const empty = q<HTMLElement>('mpv2-empty')!;
    let rows: Row[] = [];

    const rebuild = () => {
        const visible = model.items.filter((it) => matchesFilter(it, state.filter) && matchesQuery(it, state.q));
        rows = [];
        if (state.view === 'list') {
            for (const it of visible) rows.push({ kind: 'file', it, rel: it.dst });
        } else {
            // A search or a filter opens every group it matches: hiding the hit behind a fold
            // would make the search look broken.
            const forceOpen = !!state.q || state.filter !== 'all';
            let cur: Row | null = null;
            for (const it of visible) {
                if (!cur || cur.kind !== 'group' || cur.name !== it.top) {
                    cur = { kind: 'group', name: it.top, count: 0, bytes: 0, overwrites: 0, open: forceOpen || state.open.has(it.top) };
                    rows.push(cur);
                }
                cur.count++; cur.bytes += it.size; if (it.status === 'overwrite') cur.overwrites++;
                if (cur.open) rows.push({ kind: 'file', it, rel: it.top ? it.dst.slice(it.top.length + 1) : it.dst });
            }
        }
        spacer.style.height = `${rows.length * ROW_H}px`;
        empty.hidden = rows.length > 0;
        scroll.hidden = rows.length === 0;
        paint(true);
    };

    let lastFrom = -1, lastTo = -1;
    const paint = (force = false) => {
        const [from, to] = visibleRange(scroll.scrollTop, scroll.clientHeight || 400, ROW_H, rows.length);
        if (!force && from === lastFrom && to === lastTo) return;
        lastFrom = from; lastTo = to;
        // Rough character budget for the path column: the row minus badge, size and gaps.
        const chars = Math.max(20, Math.floor(((scroll.clientWidth || 700) - 190) / 7.4));
        let html = '';
        for (let i = from; i < to; i++) {
            const r = rows[i];
            const top = i * ROW_H;
            if (r.kind === 'group') {
                const label = r.name || t('mapper.pv.rootGroup');
                html += `<button type="button" class="mpv2-row mpv2-group${r.open ? ' is-open' : ''}${r.name ? '' : ' is-root'}" style="top:${top}px" data-group="${escHtml(r.name)}" aria-expanded="${r.open}">
                    <span class="mpv2-chev">${IC.chev}</span><span class="mpv2-gico">${IC.folder}</span>
                    <span class="mpv2-path">${escHtml(label)}</span>
                    <span class="mpv2-count">${escHtml(t('mapper.pv.nFiles', { n: String(r.count) }))}${r.overwrites ? ` <em>${escHtml(t('mapper.pv.nOver', { n: String(r.overwrites) }))}</em>` : ''}</span>
                    <span class="mpv2-size">${escHtml(formatBytes(r.bytes))}</span></button>`;
            } else {
                const it = r.it;
                const indent = state.view === 'tree';
                const full = `${dest ? dest.replace(/[\\/]+$/, '') + '\\' : ''}${it.dst}`;
                const tip = it.moved ? `${it.src} → ${full}` : full;
                html += `<div class="mpv2-row mpv2-file${indent ? ' is-indent' : ''} is-${it.status}" style="top:${top}px" title="${escHtml(tip)}">
                    <span class="mpv2-dot" aria-label="${escHtml(t(it.status === 'overwrite' ? 'mapper.pv.overwrites' : 'mapper.pv.new'))}"></span>
                    <span class="mpv2-path">${escHtml(middleEllipsis(r.rel, indent ? chars - 3 : chars))}</span>
                    ${it.moved ? `<span class="mpv2-tag">${escHtml(t('mapper.pv.movedTag'))}</span>` : ''}
                    <span class="mpv2-size">${escHtml(formatBytes(it.size))}</span></div>`;
            }
        }
        // Rows are positioned absolutely inside the spacer; replacing only the window keeps a
        // 50 000-file mod at ~40 nodes.
        spacer.innerHTML = html;
    };
    scroll.addEventListener('scroll', () => paint());
    _ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paint(true)) : null;
    _ro?.observe(scroll);

    spacer.addEventListener('click', (e) => {
        const g = (e.target as HTMLElement).closest<HTMLElement>('[data-group]');
        if (!g) return;
        const name = g.dataset.group || '';
        if (state.open.has(name)) state.open.delete(name); else state.open.add(name);
        rebuild();
    });
    for (const b of Array.from(o.querySelectorAll<HTMLButtonElement>('.mpv2-seg [data-view]'))) {
        b.addEventListener('click', () => {
            state.view = (b.dataset.view as 'tree' | 'list') || 'tree';
            for (const x of Array.from(o.querySelectorAll<HTMLButtonElement>('.mpv2-seg [data-view]'))) { x.classList.toggle('is-on', x === b); x.setAttribute('aria-selected', String(x === b)); }
            scroll.scrollTop = 0; rebuild();
        });
    }
    const setFilter = (f: PvFilter) => {
        state.filter = f;
        for (const x of Array.from(o.querySelectorAll<HTMLButtonElement>('.mpv2-filters [data-filter]'))) x.classList.toggle('is-on', x.dataset.filter === f);
        scroll.scrollTop = 0; rebuild();
    };
    for (const b of Array.from(o.querySelectorAll<HTMLButtonElement>('.mpv2-filters [data-filter]'))) b.addEventListener('click', () => setFilter((b.dataset.filter as PvFilter) || 'all'));
    // "Show" from a warning: that filter alone, so the search typed earlier does not hide it.
    for (const b of Array.from(o.querySelectorAll<HTMLButtonElement>('.mpv2-warns [data-show]'))) b.addEventListener('click', () => {
        const input = q<HTMLInputElement>('mpv2-q');
        if (input) input.value = '';
        state.q = '';
        setFilter((b.dataset.show as PvFilter) || 'all');
    });
    let timer = 0;
    q<HTMLInputElement>('mpv2-q')?.addEventListener('input', (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        clearTimeout(timer);
        timer = window.setTimeout(() => { state.q = v; scroll.scrollTop = 0; rebuild(); }, 120);
    });
    rebuild();
}
