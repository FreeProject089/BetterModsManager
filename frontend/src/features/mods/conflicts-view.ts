// The conflicts view: which mod wins each file two active mods share, and how to change it.
//
// One screen, three ways to resolve, one preview:
//   · reorder: the activation order is on the left (first applied at the top, the LAST one wins
//     a shared file); ↑/↓ move a mod a step, and every pair card offers « make X win », the
//     smallest move that puts X after the other one;
//   · keep one mod's copy of some files, whatever the order says (a per-file pin: excluding a
//     file from the other mods). Batch: tick files, choose whose copy to keep;
//   · disable a mod (its files go back to the next provider down, or the game's own).
// Everything edits a DRAFT. Each change asks the backend (`conflict_plan`) what the draft means
// — who wins every file, how each pair splits, which files would change hands — and the footer
// says how many files « Apply » would re-copy before anything touches the game. The rule itself
// is Rust's (mod_order.rs `winner_of`); this file never decides a winner.
//
// Opened from the library's conflict badge (focused on that mod), the order view, and the
// palette. The older « all profiles » list (inactive mods, other profiles on the same game
// folder) stays one click away: those conflicts have no winner to choose yet.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { openModal, type ModalHandle } from '../../ui/modal-shell.js';
import { uiIcon } from '../../ui/icons.js';
import { startActivity } from '../../core/activity.js';
import { runActivationJob } from '../../core/activation-jobs.js';
import * as M from './conflicts-model.js';

const CSS_ID = 'conflicts-view-css';
function ensureCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/conflicts-view.css';
    document.head.appendChild(link);
}

/** Rows drawn per pair before « show more »: two texture packs can share thousands of paths. */
const FILE_ROWS = 200;
/** Rows of the « what changes » list. */
const MOVE_ROWS = 200;

function say(message: string, type = 'info', duration = 4000): void {
    try { (window as any).toast?.(message, type, duration, '', 'Conflicts'); } catch { /* no toast host */ }
}

let _open: ModalHandle | null = null;

/** Open the view; `focusModId` filters the pairs to that mod's (the library badge). */
export async function openConflictsView(focusModId: string | null = null): Promise<void> {
    if (_open) { _open.close(); _open = null; }
    ensureCss();

    let view: M.PlanView;
    try {
        view = await invoke('conflict_plan', { profileId: null }) as M.PlanView;
    } catch (e) {
        say(String(e && (e as any).message || e) === 'order.errNoProfile' ? t('prof.noneActive') : String(e), 'error', 7000);
        return;
    }
    if (!view || !Array.isArray(view.order)) { say(t('prof.noneActive'), 'error'); return; }

    const saved: M.Draft = { order: view.order.slice(), pins: { ...(view.pins || {}) }, disable: [] };
    let draft = M.cloneDraft(saved);
    const names: Record<string, string> = { ...view.names };
    const nameOf = (id: string) => names[id] || id;

    // UI state that survives a repaint.
    let query = '';
    let onlyFocus = !!focusModId && view.order.includes(focusModId);
    const openPairs = new Set<string>();
    const shownRows = new Map<string, number>();
    const picked = new Map<string, Set<string>>();   // pair key -> selected paths
    let showMoves = false;
    let busy = false;
    let seq = 0;

    const pairKey = (p: M.PlanPair) => `${p.a}\u0000${p.b}`;

    const body = document.createElement('div');
    body.className = 'cv';
    const footer = document.createElement('div');
    footer.className = 'cv-foot';

    const legacyBtn = document.createElement('button');
    legacyBtn.type = 'button';
    legacyBtn.className = 'btn btn-sm btn-ghost';
    legacyBtn.textContent = t('cv.otherProfiles');
    legacyBtn.title = t('cv.otherProfilesTip');

    _open = openModal({
        id: 'modal-conflicts-view',
        title: t('cv.title'),
        subtitle: t('cv.subtitle'),
        icon: uiIcon('warning', 18),
        tone: 'warn',
        size: 'xl',
        tall: true,
        className: 'cv-modal',
        body,
        footer,
        headerEnd: legacyBtn,
        onClose: () => { _open = null; },
    });
    legacyBtn.addEventListener('click', () => {
        _open?.close();
        // Published on window by mods-conflicts.ts (loaded with the library); importing it here
        // would close an import cycle (mods-conflicts opens this view).
        try { void (window as any).openGlobalConflictModal?.(focusModId); } catch { /* library not mounted */ }
    });

    // ── Rendering ────────────────────────────────────────────────────────────────────────────

    const orderHTML = (): string => {
        const involved = new Set<string>();
        for (const p of view.pairs) { involved.add(p.a); involved.add(p.b); }
        const count = new Map<string, number>();
        for (const p of view.pairs) {
            count.set(p.a, (count.get(p.a) || 0) + p.files);
            count.set(p.b, (count.get(p.b) || 0) + p.files);
        }
        const rows = draft.order.map((id, i) => {
            const off = draft.disable.includes(id);
            const n = count.get(id) || 0;
            const focus = id === focusModId;
            return `<li class="cv-ord${off ? ' is-off' : ''}${focus ? ' is-focus' : ''}${involved.has(id) || off ? '' : ' is-quiet'}" data-id="${escAttr(id)}">
                <span class="cv-ord-pos">${i + 1}</span>
                <span class="cv-ord-name" title="${escAttr(nameOf(id))}">${escHtml(nameOf(id))}</span>
                ${off ? `<span class="cv-tag cv-tag-off">${escHtml(t('cv.willDisable'))}</span>`
                      : n ? `<span class="cv-tag" title="${escAttr(t('cv.sharedTip'))}">${n}</span>` : ''}
                <span class="cv-ord-tools">
                    <button type="button" class="cv-icon" data-cv="up" data-id="${escAttr(id)}" ${i === 0 ? 'disabled' : ''}
                        aria-label="${escAttr(t('cv.moveUp', { m: nameOf(id) }))}" title="${escAttr(t('cv.moveUpTip'))}">${uiIcon('chevron-up', 14)}</button>
                    <button type="button" class="cv-icon" data-cv="down" data-id="${escAttr(id)}" ${i === draft.order.length - 1 ? 'disabled' : ''}
                        aria-label="${escAttr(t('cv.moveDown', { m: nameOf(id) }))}" title="${escAttr(t('cv.moveDownTip'))}">${uiIcon('chevron-down', 14)}</button>
                    <button type="button" class="cv-icon" data-cv="disable" data-id="${escAttr(id)}" aria-pressed="${off}"
                        aria-label="${escAttr((off ? t('cv.keepOn') : t('cv.disable')) + ' ' + nameOf(id))}"
                        title="${escAttr(off ? t('cv.keepOn') : t('cv.disable'))}">${uiIcon(off ? 'undo' : 'power', 14)}</button>
                </span>
            </li>`;
        }).join('');
        return `<h3 class="cv-h">${escHtml(t('cv.orderTitle'))}</h3>
            <p class="cv-note">${escHtml(t('cv.orderNote'))}</p>
            <ol class="cv-ord-list">${rows}</ol>`;
    };

    const verdictText = (p: M.PlanPair): string => {
        const v = M.pairVerdict(p);
        if (v === 'b') return t('cv.allWin', { m: nameOf(p.b) });
        if (v === 'a') return t('cv.allWin', { m: nameOf(p.a) });
        if (v === 'other') return t('cv.thirdWins');
        return t('cv.split', { a: nameOf(p.a), na: String(p.a_wins), b: nameOf(p.b), nb: String(p.b_wins) });
    };

    const fileRow = (f: M.PlanFile, key: string, sel: Set<string>): string => {
        const base = f.path.replace(/^.*\//, '');
        const dir = f.path.slice(0, f.path.length - base.length).replace(/\/$/, '');
        const opts = [`<option value="">${escHtml(t('cv.byOrder'))}</option>`]
            .concat(f.mods.map((id) => `<option value="${escAttr(id)}"${draft.pins[f.path] === id ? ' selected' : ''}>${escHtml(t('cv.keepCopy', { m: nameOf(id) }))}</option>`))
            .join('');
        return `<li class="cv-file${f.pinned ? ' is-pinned' : ''}">
            <input type="checkbox" class="cv-check" data-cv="pick" data-pair="${escAttr(key)}" data-path="${escAttr(f.path)}"${sel.has(f.path) ? ' checked' : ''}
                aria-label="${escAttr(t('cv.selectFile', { f: f.path }))}">
            <span class="cv-file-path" title="${escAttr(f.path)}"><span class="cv-file-base">${escHtml(base)}</span>${dir ? `<span class="cv-file-dir">${escHtml(dir)}</span>` : ''}</span>
            <span class="cv-win" title="${escAttr(t('cv.onDiskTip'))}">${uiIcon('check', 12)}${escHtml(nameOf(f.winner))}${f.pinned ? `<span class="cv-tag cv-tag-pin">${escHtml(t('cv.pinned'))}</span>` : ''}</span>
            <select class="input cv-pin" data-cv="pin" data-path="${escAttr(f.path)}" aria-label="${escAttr(t('cv.winnerFor', { f: base }))}">${opts}</select>
        </li>`;
    };

    const pairHTML = (p: M.PlanPair): string => {
        const key = pairKey(p);
        const open = openPairs.has(key);
        const v = M.pairVerdict(p);
        const sel = picked.get(key) || new Set<string>();
        let files = '';
        if (open) {
            const all = M.filesOfPair(view.files, p.a, p.b);
            const limit = shownRows.get(key) || FILE_ROWS;
            const rows = all.slice(0, limit).map((f) => fileRow(f, key, sel)).join('');
            const more = all.length > limit
                ? `<button type="button" class="btn btn-sm btn-ghost cv-more" data-cv="more" data-pair="${escAttr(key)}">${escHtml(t('cv.showMore', { n: String(all.length - limit) }))}</button>`
                : '';
            const cut = view.files_total > view.files.length
                ? `<p class="cv-note">${escHtml(t('cv.listCut', { n: String(view.files.length), total: String(view.files_total) }))}</p>` : '';
            files = `<div class="cv-files">
                <div class="cv-batch" role="group" aria-label="${escAttr(t('cv.batchLabel'))}">
                    <label class="cv-all"><input type="checkbox" data-cv="pickall" data-pair="${escAttr(key)}"${sel.size && sel.size === all.length ? ' checked' : ''}>
                        ${escHtml(t('cv.selectAll', { n: String(all.length) }))}</label>
                    <span class="cv-batch-n" aria-live="polite">${sel.size ? escHtml(t('cv.selected', { n: String(sel.size) })) : ''}</span>
                    <span class="cv-batch-acts">
                        <button type="button" class="btn btn-sm btn-secondary" data-cv="batch" data-pair="${escAttr(key)}" data-mod="${escAttr(p.a)}"${sel.size ? '' : ' disabled'}>${escHtml(t('cv.keepCopy', { m: nameOf(p.a) }))}</button>
                        <button type="button" class="btn btn-sm btn-secondary" data-cv="batch" data-pair="${escAttr(key)}" data-mod="${escAttr(p.b)}"${sel.size ? '' : ' disabled'}>${escHtml(t('cv.keepCopy', { m: nameOf(p.b) }))}</button>
                        <button type="button" class="btn btn-sm btn-ghost" data-cv="batch" data-pair="${escAttr(key)}" data-mod=""${sel.size ? '' : ' disabled'}>${escHtml(t('cv.byOrder'))}</button>
                    </span>
                </div>
                <ul class="cv-file-list">${rows}</ul>${more}${cut}
            </div>`;
        }
        return `<div class="cv-pair${open ? ' is-open' : ''}" data-key="${escAttr(key)}">
            <button type="button" class="cv-pair-head" data-cv="toggle" data-pair="${escAttr(key)}" aria-expanded="${open}">
                ${uiIcon('chevron-right', 12, { cls: 'cv-chev' })}
                <span class="cv-pair-names"><span class="cv-n">${escHtml(nameOf(p.a))}</span><span class="cv-vs" aria-hidden="true">↔</span><span class="cv-n">${escHtml(nameOf(p.b))}</span></span>
                <span class="cv-pair-count">${escHtml(t('cv.files', { n: String(p.files) }))}</span>
                <span class="cv-pair-verdict cv-v-${v}">${escHtml(verdictText(p))}</span>
            </button>
            <div class="cv-pair-acts">
                ${p.b_wins !== p.files ? `<button type="button" class="btn btn-sm btn-secondary" data-cv="win" data-win="${escAttr(p.b)}" data-lose="${escAttr(p.a)}">${escHtml(t('cv.makeWin', { m: nameOf(p.b) }))}</button>` : ''}
                ${p.a_wins !== p.files ? `<button type="button" class="btn btn-sm btn-secondary" data-cv="win" data-win="${escAttr(p.a)}" data-lose="${escAttr(p.b)}">${escHtml(t('cv.makeWin', { m: nameOf(p.a) }))}</button>` : ''}
                <button type="button" class="btn btn-sm btn-ghost" data-cv="disable" data-id="${escAttr(p.a)}">${escHtml(t('cv.disableM', { m: nameOf(p.a) }))}</button>
                <button type="button" class="btn btn-sm btn-ghost" data-cv="disable" data-id="${escAttr(p.b)}">${escHtml(t('cv.disableM', { m: nameOf(p.b) }))}</button>
            </div>
            ${files}
        </div>`;
    };

    const pairsHTML = (): string => {
        let list = view.pairs;
        if (onlyFocus && focusModId) list = M.pairsOfMod(list, focusModId);
        list = list.filter((p) => M.pairMatches(p, names, query));
        const focusBox = focusModId && saved.order.includes(focusModId)
            ? `<label class="cv-focus"><input type="checkbox" data-cv="focus"${onlyFocus ? ' checked' : ''}> ${escHtml(t('cv.onlyMod', { m: nameOf(focusModId) }))}</label>` : '';
        const head = `<div class="cv-pairs-bar">
            <h3 class="cv-h">${escHtml(t('cv.pairsTitle', { n: String(view.pairs.length) }))}</h3>
            <input type="search" class="input cv-search" data-cv="search" value="${escAttr(query)}" autocomplete="off"
                placeholder="${escAttr(t('cv.search'))}" aria-label="${escAttr(t('cv.search'))}">
            ${focusBox}
        </div>`;
        if (!view.pairs.length) {
            return head + `<div class="cv-empty">${uiIcon('check', 32)}<p>${escHtml(t('cv.none'))}</p><p class="cv-note">${escHtml(t('cv.noneSub'))}</p></div>`;
        }
        if (!list.length) return head + `<div class="cv-empty"><p>${escHtml(t('cv.noMatch'))}</p></div>`;
        return head + list.map(pairHTML).join('');
    };

    const movesHTML = (): string => {
        if (!showMoves || !view.handovers.length) return '';
        const rows = view.handovers.slice(0, MOVE_ROWS).map((h) => `<li>
            <span class="cv-file-path" title="${escAttr(h.path)}">${escHtml(h.path)}</span>
            <span class="cv-move">${escHtml(nameOf(h.from))} → ${escHtml(h.to ? nameOf(h.to) : t('cv.gameFile'))}</span></li>`).join('');
        const more = view.handovers_total > MOVE_ROWS ? `<p class="cv-note">${escHtml(t('cv.listCut', { n: String(MOVE_ROWS), total: String(view.handovers_total) }))}</p>` : '';
        return `<section class="cv-moves" aria-label="${escAttr(t('cv.changesTitle'))}">
            <h3 class="cv-h">${escHtml(t('cv.changesTitle'))}</h3><ul>${rows}</ul>${more}</section>`;
    };

    const render = (): void => {
        const pairsEl = body.querySelector('.cv-pairs') as HTMLElement | null;
        const keepScroll = pairsEl ? pairsEl.scrollTop : 0;
        const active = document.activeElement as HTMLElement | null;
        const refocus = active && body.contains(active)
            ? (active.dataset.cv === 'search' ? '[data-cv="search"]'
                : active.dataset.cv && active.dataset.id ? `[data-cv="${active.dataset.cv}"][data-id="${CSS.escape(active.dataset.id)}"]`
                : active.dataset.cv && active.dataset.path ? `[data-cv="${active.dataset.cv}"][data-path="${CSS.escape(active.dataset.path)}"]`
                : active.dataset.cv && active.dataset.pair ? `[data-cv="${active.dataset.cv}"][data-pair="${CSS.escape(active.dataset.pair)}"]`
                : null)
            : null;
        body.innerHTML = `${movesHTML()}<div class="cv-grid">
            <section class="cv-order" aria-label="${escAttr(t('cv.orderTitle'))}">${orderHTML()}</section>
            <section class="cv-pairs" aria-label="${escAttr(t('cv.pairsTitle', { n: String(view.pairs.length) }))}">${pairsHTML()}</section>
        </div>`;
        const p2 = body.querySelector('.cv-pairs') as HTMLElement | null;
        if (p2) p2.scrollTop = keepScroll;
        if (refocus) {
            const el = body.querySelector<HTMLElement>(refocus);
            if (el) {
                el.focus();
                if (el instanceof HTMLInputElement && el.type === 'search') el.setSelectionRange(el.value.length, el.value.length);
            }
        }
        renderFooter();
    };

    const renderFooter = (): void => {
        const dirty = !M.sameDraft(draft, saved);
        const n = view.handovers_total;
        const status = !dirty
            ? t('cv.statusClean', { n: String(view.files_total), p: String(view.pairs.length) })
            : n || draft.disable.length
                ? t('cv.statusDirty', { n: String(n) }) + (draft.disable.length ? ' ' + t('cv.statusDisable', { n: String(draft.disable.length) }) : '')
                : t('cv.statusNoEffect');
        footer.innerHTML = `<span class="cv-status" role="status" aria-live="polite">${escHtml(status)}</span>
            <button type="button" class="btn btn-sm btn-ghost" data-cv="moves"${n ? '' : ' disabled'} aria-expanded="${showMoves}">${escHtml(showMoves ? t('cv.hideChanges') : t('cv.showChanges'))}</button>
            <button type="button" class="btn btn-secondary" data-cv="discard"${dirty ? '' : ' disabled'}>${escHtml(t('cv.discard'))}</button>
            <button type="button" class="btn btn-primary" data-cv="apply"${dirty && !busy ? '' : ' disabled'}>${escHtml(busy ? t('cv.applying') : t('cv.apply'))}</button>`;
    };

    // Each draft change asks the backend again; an older answer arriving late is dropped.
    const replan = async (): Promise<void> => {
        const mine = ++seq;
        try {
            const v = await invoke('conflict_plan', { profileId: null, ...M.planArgs(draft) }) as M.PlanView;
            if (mine !== seq || !v) return;
            view = v;
            Object.assign(names, v.names || {});
            render();
        } catch (e) {
            if (mine === seq) say(String(e), 'error', 7000);
        }
    };
    const change = (next: M.Draft): void => {
        draft = next;
        render();   // the order column moves at once; the winners follow when the plan answers
        void replan();
    };

    // ── Events: one delegated handler for the body and one for the footer ────────────────────

    body.addEventListener('click', (ev) => {
        const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-cv]');
        if (!el || !body.contains(el)) return;
        const act = el.dataset.cv;
        const id = el.dataset.id || '';
        const key = el.dataset.pair || '';
        if (act === 'up' || act === 'down') change({ ...M.cloneDraft(draft), order: M.moveId(draft.order, id, act === 'up' ? -1 : 1) });
        else if (act === 'disable') change(M.toggleDisable(draft, id));
        else if (act === 'win') change({ ...M.cloneDraft(draft), order: M.makeWinOver(draft.order, el.dataset.win || '', el.dataset.lose || '') });
        else if (act === 'toggle') {
            if (openPairs.has(key)) openPairs.delete(key); else openPairs.add(key);
            render();
        } else if (act === 'more') {
            shownRows.set(key, (shownRows.get(key) || FILE_ROWS) + FILE_ROWS);
            render();
        } else if (act === 'batch') {
            const sel = [...(picked.get(key) || [])];
            if (!sel.length) return;
            picked.delete(key);
            change({ ...M.cloneDraft(draft), pins: M.setPins(draft.pins, sel, el.dataset.mod || null) });
        }
    });
    body.addEventListener('change', (ev) => {
        const el = ev.target as HTMLElement;
        const act = el.dataset?.cv;
        if (act === 'pin') {
            const v = (el as HTMLSelectElement).value;
            change({ ...M.cloneDraft(draft), pins: M.setPins(draft.pins, [el.dataset.path || ''], v || null) });
        } else if (act === 'pick') {
            const key = el.dataset.pair || '';
            const set = picked.get(key) || new Set<string>();
            if ((el as HTMLInputElement).checked) set.add(el.dataset.path || ''); else set.delete(el.dataset.path || '');
            picked.set(key, set);
            render();
        } else if (act === 'pickall') {
            const key = el.dataset.pair || '';
            const [a, b] = key.split('\u0000');
            picked.set(key, (el as HTMLInputElement).checked ? new Set(M.filesOfPair(view.files, a, b).map((f) => f.path)) : new Set());
            render();
        } else if (act === 'focus') {
            onlyFocus = (el as HTMLInputElement).checked;
            render();
        }
    });
    body.addEventListener('input', (ev) => {
        const el = ev.target as HTMLInputElement;
        if (el.dataset?.cv !== 'search') return;
        query = el.value;
        render();
    });

    footer.addEventListener('click', async (ev) => {
        const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-cv]');
        if (!el) return;
        if (el.dataset.cv === 'moves') { showMoves = !showMoves; render(); return; }
        if (el.dataset.cv === 'discard') { picked.clear(); change(M.cloneDraft(saved)); return; }
        if (el.dataset.cv !== 'apply' || busy) return;
        busy = true;
        renderFooter();
        const job = startActivity({ kind: 'repair', title: t('cv.activity'), source: 'Conflicts' });
        try {
            const moved = Number(await invoke('conflict_apply', { profileId: null, order: draft.order, pins: draft.pins })) || 0;
            let off = 0;
            if (draft.disable.length) {
                // Through the activation queue like every other disable: its own Stop, the
                // library re-read at the end, and the backend puts kept files back after each.
                job.update({ detail: draft.disable.map(nameOf).join(', ') });
                const sum = await runActivationJob({
                    mods: draft.disable.map((id) => ({ id, name: nameOf(id) })),
                    mode: 'disable', label: t('cv.activity'), silent: true, source: 'conflicts',
                }).done;
                off = sum.done;
                for (const f of sum.failed) say(`${f.name}: ${f.error || ''}`, 'error', 8000);
            }
            const msg = t('cv.applied', { n: String(moved), d: String(off) });
            job.done(msg);
            say(msg, 'success', 6000);
            // The library's badges follow (its refresh re-reads the conflicts too).
            try { void (window as any)._refreshModsFn?.(false, true); } catch { /* library not mounted */ }
            // Start again from what is now saved.
            const fresh = await invoke('conflict_plan', { profileId: null }) as M.PlanView;
            if (fresh) {
                view = fresh;
                Object.assign(names, fresh.names || {});
                saved.order = fresh.order.slice();
                saved.pins = { ...(fresh.pins || {}) };
                saved.disable = [];
                draft = M.cloneDraft(saved);
                picked.clear();
            }
        } catch (e) {
            job.fail(e);
            say(String(e), 'error', 9000);
        } finally {
            busy = false;
            render();
        }
    });

    if (onlyFocus && focusModId) {
        // Open the focused mod's biggest pair: that is the question the badge asked.
        const first = M.pairsOfMod(view.pairs, focusModId)[0];
        if (first) openPairs.add(pairKey(first));
    }
    render();
}

(window as any).openConflictsView = openConflictsView;
