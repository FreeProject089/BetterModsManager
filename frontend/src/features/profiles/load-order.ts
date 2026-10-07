// The activation order of a profile: which mod is applied first, and so which one wins a file
// two mods share (the LAST one — src-tauri/src/commands/mod_order.rs).
//
// A modal with the profile's active mods top to bottom, first applied first. The list is a
// DRAFT: drag a row, or select it and use Alt+↑/↓ (Alt+Home/End for top/bottom), or a sort
// helper, and every row's conflict indicator ("overrides 12 files from X" / "overridden by Y")
// follows at once — it is computed from the contested files the backend returned
// (load-order-model.ts), not asked for again per move. Nothing touches the game until
// "Apply order": the backend saves the order and re-copies ONLY the files that change hands,
// under the resource governor. "Re-apply" re-copies every contested file's winner — the repair
// for a game folder that no longer matches the order.
//
// Shortcuts are commands in core/commands.ts (load-order-keys.ts), scoped to this view: they
// show in Ctrl+K and are rebindable in Settings → Keyboard shortcuts.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { learnMore, LEARN_MORE_EVENT } from '../../core/learn-more.js';
import { raiseAboveAll } from '../../ui/layer.js';
import { installFocusTrap, ownsFocus } from '../../ui/focus-trap.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { bindOrderKeys } from './load-order-keys.js';
import {
    type OrderedMod, type ContestedFile, type SortKey,
    sameOrder, moveId, dropAt, sortOrder, handoverCount, rivalsUnder,
} from './load-order-model.js';

/** How a message reaches the user. The callers hand in ui/app.ts's toast(): importing app.ts
 *  from here would close an import cycle (app → profiles → … → commands → load-order → app).
 *  Opened from the palette before any caller handed one in, messages go to the view's own
 *  status line instead. */
export type Notify = (message: string, type?: string, duration?: number) => void;
let _notify: Notify | null = null;
let _fallback: ((message: string) => void) | null = null;
function toast(message: string, type = 'info', duration = 3000): void {
    if (_notify) { try { _notify(message, type, duration); return; } catch { /* fall through */ } }
    _fallback?.(message);
}

const CSS_ID = 'load-order-css';
function ensureCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/load-order.css';
    document.head.appendChild(link);
}

const I = {
    grip: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    top: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14"/><path d="m7 14 5-5 5 5"/><path d="M12 9v11"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    bottom: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20h14"/><path d="m7 10 5 5 5-5"/><path d="M12 15V4"/></svg>',
    close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

/** `{n}` / `{m}` / `{p}` / `{e}` placeholders, the house convention. */
function fill(key: string, vars: Record<string, string | number>): string {
    let s = t(key);
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
}

let _open: HTMLElement | null = null;

/**
 * Open the activation order of a profile (default: the active one). Resolves when the view
 * closes, with whether an order was applied.
 */
export async function openLoadOrder(profileId?: string | null, profileName?: string, notify?: Notify, opts: { importText?: string } = {}): Promise<boolean> {
    if (notify) _notify = notify;
    if (_open) {
        // "Learn more" hides the view rather than closing it (core/learn-more.ts takes the
        // `open` class off the overlay it sits in), so an unapplied draft survives the trip to
        // the docs: opening the view again brings it back as it was left.
        _open.classList.add('open');
        _open.querySelector<HTMLElement>('.lo-list')?.focus();
        // A shared order arriving while the view is open (a bmm://order link): its preview.
        if (opts.importText) _open.dispatchEvent(new CustomEvent('lo-import', { detail: opts.importText }));
        return false;
    }
    ensureCss();

    let mods: OrderedMod[] = [];
    let contested: ContestedFile[] = [];
    try {
        const res = await invoke('mod_order_get', { profileId: profileId ?? null }) as [OrderedMod[], ContestedFile[]] | null;
        mods = Array.isArray(res?.[0]) ? res![0] : [];
        contested = Array.isArray(res?.[1]) ? res![1] : [];
    } catch (e) {
        toast(fill('order.loadFailed', { e: t(String(e)) }), 'error', 7000);
        return false;
    }
    // The default placement of a bulk enable, read before the markup so the select is born
    // with it (the themed select mirrors the native one when it is built).
    const bulkMode = String(await invoke('order_bulk_mode_get').catch(() => 'top') || 'top');

    return new Promise<boolean>((resolve) => {
        const byId = new Map(mods.map((m) => [m.id, m]));
        const nameOf = (id: string) => byId.get(id)?.name || id;
        let saved = mods.map((m) => m.id);
        let draft = saved.slice();
        let selected: string | null = draft[0] ?? null;
        let busy = false;
        let applied = false;
        let confirmClose = false;
        let flash = '';

        // The focus goes back where it came from on close (the Storage Manager, a mod row…).
        const opener = document.activeElement as HTMLElement | null;
        const ov = document.createElement('div');
        ov.className = 'modal-overlay open lo-overlay';
        raiseAboveAll(ov);
        ov.innerHTML = `
      <div class="modal glass lo-modal" role="dialog" aria-modal="true" aria-labelledby="lo-title">
        <div class="modal-header lo-head">
          <div class="lo-head-text">
            <h3 id="lo-title">${escHtml(profileName ? fill('order.titleFor', { p: profileName }) : t('order.title'))}</h3>
            <p class="lo-lede">${escHtml(t('order.lede'))}</p>
          </div>
          ${learnMore('load-order', { compact: true, className: 'lo-learn' })}
          <button type="button" class="modal-close" id="lo-x" aria-label="${escAttr(t('common.close'))}">${I.close}</button>
        </div>
        <div class="lo-tools">
          <label class="lo-sort-label" for="lo-sort">${escHtml(t('order.sort'))}</label>
          <select id="lo-sort" class="lo-sort">
            <option value="current">${escHtml(t('order.sortCurrent'))}</option>
            <option value="name-asc">${escHtml(t('order.sortNameAsc'))}</option>
            <option value="name-desc">${escHtml(t('order.sortNameDesc'))}</option>
            <option value="oldest">${escHtml(t('order.sortOldest'))}</option>
            <option value="newest">${escHtml(t('order.sortNewest'))}</option>
          </select>
          <span class="lo-hint">${escHtml(t('order.dragHint'))}</span>
          <span class="lo-count" id="lo-count"></span>
          <button type="button" class="btn btn-ghost btn-sm" id="lo-share" title="${escAttr(t('order.share.tip'))}">${escHtml(t('order.share.btn'))}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="lo-import" title="${escAttr(t('order.import.tip'))}">${escHtml(t('order.import.btn'))}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="lo-lists" title="${escAttr(t('orderList.openTip'))}">${escHtml(t('orderList.open'))}</button>
          <label class="lo-bulk-label" for="lo-bulk" title="${escAttr(t('order.mode.tip'))}">${escHtml(t('order.mode.label'))}</label>
          <select id="lo-bulk" class="lo-bulk" title="${escAttr(t('order.mode.tip'))}">
            ${(['top', 'bottom', 'keep'] as const).map((m) => `<option value="${m}"${bulkMode === m ? ' selected' : ''}>${escHtml(t(`order.mode.${m}`))}</option>`).join('')}
          </select>
        </div>
        <div class="lo-body">
          <div class="lo-edge lo-edge-first">${escHtml(t('order.first'))}</div>
          <ol class="lo-list" id="lo-list" role="listbox" tabindex="0" aria-label="${escAttr(t('order.title'))}"></ol>
          <div class="lo-edge lo-edge-last">${escHtml(t('order.last'))}</div>
        </div>
        <div class="lo-live" id="lo-live" aria-live="polite"></div>
        <div class="modal-footer lo-foot">
          <button type="button" class="btn btn-ghost btn-sm" id="lo-reapply" title="${escAttr(t('order.reapplyTip'))}">${escHtml(t('order.reapply'))}</button>
          <span class="lo-status" id="lo-status"></span>
          <button type="button" class="btn btn-secondary btn-sm" id="lo-reset">${escHtml(t('order.reset'))}</button>
          <button type="button" class="btn btn-primary btn-sm lo-apply" id="lo-apply">${escHtml(t('order.apply'))}</button>
        </div>
      </div>`;
        (document.getElementById('app-window-outer') || document.body).appendChild(ov);
        _open = ov;

        const list = ov.querySelector('#lo-list') as HTMLOListElement;
        const status = ov.querySelector('#lo-status') as HTMLElement;
        const live = ov.querySelector('#lo-live') as HTMLElement;
        const count = ov.querySelector('#lo-count') as HTMLElement;
        _fallback = (m) => { flash = m; live.textContent = m; };
        const applyBtn = ov.querySelector('#lo-apply') as HTMLButtonElement;
        const resetBtn = ov.querySelector('#lo-reset') as HTMLButtonElement;
        const reapplyBtn = ov.querySelector('#lo-reapply') as HTMLButtonElement;
        const sortSel = ov.querySelector('#lo-sort') as HTMLSelectElement;
        const closeBtn = ov.querySelector('#lo-x') as HTMLButtonElement;

        const rivalText = (items: { name: string; files: number }[], key: string): string => {
            if (!items.length) return '';
            const first = fill(key, { n: items[0].files, m: items[0].name });
            return items.length > 1 ? `${first} ${fill('order.more', { n: items.length - 1 })}` : first;
        };

        function render(focusSelected = false): void {
            const rivals = rivalsUnder(contested, draft, nameOf);
            const changed = new Set(draft.filter((id, i) => saved[i] !== id));
            list.innerHTML = draft.length ? draft.map((id, i) => {
                const m = byId.get(id);
                const r = rivals.get(id)!;
                const over = rivalText(r.overrides, 'order.overrides');
                const under = rivalText(r.overriddenBy, 'order.overriddenBy');
                const tipOver = r.overrides.map((x) => fill('order.overrides', { n: x.files, m: x.name })).join('\n');
                const tipUnder = r.overriddenBy.map((x) => fill('order.overriddenBy', { n: x.files, m: x.name })).join('\n');
                const sel = id === selected;
                return `<li class="lo-row${sel ? ' is-selected' : ''}${changed.has(id) ? ' is-moved' : ''}" role="option" aria-selected="${sel}"
                    draggable="true" data-id="${escAttr(id)}" id="lo-row-${i}">
                  <span class="lo-grip" aria-hidden="true">${I.grip}</span>
                  <span class="lo-pos" title="${escAttr(fill('order.position', { n: i + 1 }))}">${i + 1}</span>
                  <span class="lo-main">
                    <span class="lo-name">${escHtml(m?.name || id)}${m?.archived ? ` <span class="lo-tag">${escHtml(t('order.archived'))}</span>` : ''}</span>
                    <span class="lo-rivals">
                      ${over ? `<span class="lo-chip lo-wins" title="${escAttr(tipOver)}">${escHtml(over)}</span>` : ''}
                      ${under ? `<span class="lo-chip lo-loses" title="${escAttr(tipUnder)}">${escHtml(under)}</span>` : ''}
                      ${!over && !under ? `<span class="lo-none">${escHtml(t('order.noConflict'))}</span>` : ''}
                    </span>
                  </span>
                  <span class="lo-moves">
                    <button type="button" class="lo-mv lo-mv-top" data-id="${escAttr(id)}" title="${escAttr(t('order.moveTop'))}" aria-label="${escAttr(t('order.moveTop'))}" ${i === 0 ? 'disabled' : ''}>${I.top}</button>
                    <button type="button" class="lo-mv lo-mv-up" data-id="${escAttr(id)}" title="${escAttr(t('order.moveUp'))}" aria-label="${escAttr(t('order.moveUp'))}" ${i === 0 ? 'disabled' : ''}>${I.up}</button>
                    <button type="button" class="lo-mv lo-mv-down" data-id="${escAttr(id)}" title="${escAttr(t('order.moveDown'))}" aria-label="${escAttr(t('order.moveDown'))}" ${i === draft.length - 1 ? 'disabled' : ''}>${I.down}</button>
                    <button type="button" class="lo-mv lo-mv-bottom" data-id="${escAttr(id)}" title="${escAttr(t('order.moveBottom'))}" aria-label="${escAttr(t('order.moveBottom'))}" ${i === draft.length - 1 ? 'disabled' : ''}>${I.bottom}</button>
                  </span>
                </li>`;
            }).join('') : `<li class="lo-empty">${escHtml(t('order.empty'))}</li>`;
            const selIdx = selected ? draft.indexOf(selected) : -1;
            if (selIdx >= 0) list.setAttribute('aria-activedescendant', `lo-row-${selIdx}`);
            else list.removeAttribute('aria-activedescendant');
            if (focusSelected && selIdx >= 0) {
                list.focus();
                list.querySelector<HTMLElement>(`#lo-row-${selIdx}`)?.scrollIntoView({ block: 'nearest' });
            }
            count.textContent = contested.length ? fill('order.contested', { n: contested.length }) : '';
            refreshFoot();
        }

        function refreshFoot(): void {
            const dirty = !sameOrder(saved, draft);
            if (flash) { status.textContent = flash; flash = ''; return; }
            applyBtn.disabled = busy || !dirty;
            resetBtn.disabled = busy || !dirty;
            reapplyBtn.disabled = busy || contested.length === 0;
            if (!dirty) {
                status.textContent = t('order.clean');
                status.classList.remove('is-dirty');
                confirmClose = false;
                closeBtn.removeAttribute('title');
                return;
            }
            const n = handoverCount(contested, saved, draft);
            status.textContent = n ? fill('order.pending', { n }) : t('order.pendingNone');
            status.classList.add('is-dirty');
        }

        function setDraft(next: string[], movedId?: string): void {
            if (busy || sameOrder(next, draft)) return;
            draft = next;
            if (movedId) {
                selected = movedId;
                live.textContent = fill('order.moved', { m: nameOf(movedId), n: draft.indexOf(movedId) + 1 });
            }
            render(!!movedId);
        }

        const move = (where: -1 | 1 | 'top' | 'bottom', id = selected) => {
            if (!id) return;
            setDraft(moveId(draft, id, where), id);
        };

        async function apply(): Promise<void> {
            if (busy || sameOrder(saved, draft)) return;
            busy = true;
            refreshFoot();
            status.textContent = t('order.applying');
            try {
                const moved = await invoke('mod_order_set', { profileId: profileId ?? null, order: draft }) as number | null;
                saved = draft.slice();
                applied = true;
                toast(fill('order.applied', { n: Number(moved) || 0 }), 'success', 5000);
                dispatchBmmAction(BMM_ACTIONS.ORDER_APPLIED, { moved: Number(moved) || 0 });
                refreshMods();
            } catch (e) {
                // The order is saved before the copy starts (mod_order.rs `commit`): a failure
                // here means the disk is behind the list, and Re-apply is how it catches up.
                saved = draft.slice();
                toast(fill('order.applyFailed', { e: t(String(e)) }), 'error', 10000);
            } finally {
                busy = false;
                render();
            }
        }

        async function reapply(): Promise<void> {
            if (busy) return;
            busy = true;
            refreshFoot();
            status.textContent = t('order.applying');
            try {
                const n = await invoke('mod_order_reapply', { profileId: profileId ?? null }) as number | null;
                toast(fill('order.reapplied', { n: Number(n) || 0 }), 'success', 5000);
            } catch (e) {
                toast(fill('order.applyFailed', { e: t(String(e)) }), 'error', 10000);
            } finally {
                busy = false;
                render();
            }
        }

        /** On screen — not merely in the DOM: "Learn more" hides the overlay without closing it.
         *  And holding the keyboard: a dialog opened over it (Share, Import) owns Tab, Escape
         *  and the arrows until it closes. */
        const shown = (): boolean => _open === ov && ov.isConnected && ov.classList.contains('open') && ownsFocus(ov);

        function close(): void {
            if (busy) return;
            if (!sameOrder(saved, draft) && !confirmClose) {
                // One more click to throw away an order that was never applied.
                confirmClose = true;
                status.textContent = t('order.discard');
                closeBtn.title = t('order.discard');
                closeBtn.focus();
                return;
            }
            ov.remove();
            _open = null;
            _fallback = null;
            document.removeEventListener('keydown', onEsc, true);
            untrap();
            try { if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true }); } catch { /* gone */ }
            resolve(applied);
        }
        const onEsc = (e: KeyboardEvent) => {
            // Only while on screen: hidden behind the docs, Escape belongs to the docs.
            if (e.key === 'Escape' && shown()) { e.stopPropagation(); close(); }
        };
        document.addEventListener('keydown', onEsc, true);
        // aria-modal="true" is a promise that Tab stays in here.
        const untrap = installFocusTrap(ov, shown);
        // Hidden by "Learn more": nothing to do but give the focus back to the page — the
        // draft, the Escape handler and the shortcuts wait (all gated on `shown`).
        ov.addEventListener(LEARN_MORE_EVENT, () => { (document.activeElement as HTMLElement | null)?.blur?.(); });

        // The shortcuts, as registry commands (load-order-keys.ts): live while this view is open.
        bindOrderKeys({
            'order.moveUp': () => move(-1),
            'order.moveDown': () => move(1),
            'order.moveTop': () => move('top'),
            'order.moveBottom': () => move('bottom'),
            'order.apply': () => { void apply(); },
        }, shown);

        // Plain arrows move the SELECTION (listbox navigation); Alt+arrows, the registry
        // commands above, move the MOD.
        list.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const i = selected ? draft.indexOf(selected) : -1;
            let next = -1;
            if (e.key === 'ArrowDown') next = Math.min(draft.length - 1, i + 1);
            else if (e.key === 'ArrowUp') next = Math.max(0, i - 1);
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = draft.length - 1;
            if (next < 0 || !draft.length) return;
            e.preventDefault();
            selected = draft[next];
            render(true);
        });

        list.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const btn = target.closest<HTMLButtonElement>('.lo-mv');
            if (btn) {
                // Which move is a CLASS, not a data attribute: nothing a listener here reads can be
                // smuggled in by foreign markup (tests/behaviour-attrs.test.mjs).
                const c = btn.classList;
                const where = c.contains('lo-mv-top') ? 'top' : c.contains('lo-mv-bottom') ? 'bottom' : c.contains('lo-mv-up') ? -1 : 1;
                move(where, btn.dataset.id || null);
                return;
            }
            const row = target.closest<HTMLElement>('.lo-row');
            if (row?.dataset.id) { selected = row.dataset.id; render(true); }
        });

        // Drag and drop: the drop line goes above or below the row under the pointer, by which
        // half of it the pointer is in.
        let dragId: string | null = null;
        const clearMarks = () => list.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
        list.addEventListener('dragstart', (e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('.lo-row');
            if (!row?.dataset.id || busy) { e.preventDefault(); return; }
            dragId = row.dataset.id;
            row.classList.add('is-dragging');
            try { e.dataTransfer?.setData('text/plain', dragId); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; } catch { /* some hosts refuse */ }
        });
        list.addEventListener('dragover', (e) => {
            if (!dragId) return;
            const row = (e.target as HTMLElement).closest<HTMLElement>('.lo-row');
            if (!row) return;
            e.preventDefault();
            const r = row.getBoundingClientRect();
            const after = e.clientY > r.top + r.height / 2;
            clearMarks();
            row.classList.add(after ? 'drop-after' : 'drop-before');
        });
        list.addEventListener('dragleave', (e) => {
            if (!list.contains(e.relatedTarget as Node)) clearMarks();
        });
        list.addEventListener('drop', (e) => {
            if (!dragId) return;
            e.preventDefault();
            const row = (e.target as HTMLElement).closest<HTMLElement>('.lo-row');
            const id = dragId;
            dragId = null;
            clearMarks();
            if (!row?.dataset.id) { render(); return; }
            const r = row.getBoundingClientRect();
            setDraft(dropAt(draft, id, row.dataset.id, e.clientY > r.top + r.height / 2), id);
        });
        list.addEventListener('dragend', () => { dragId = null; clearMarks(); list.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging')); });

        sortSel.addEventListener('change', () => {
            const key = (sortSel.value || 'current') as SortKey;
            const next = sortOrder(draft, byId, key, saved);
            if (!sameOrder(next, draft)) { draft = next; render(); }
        });
        // Share: the SAVED order (what is on disk), not an unapplied draft.
        ov.querySelector('#lo-share')?.addEventListener('click', () => {
            void import('./order-share.js').then((m) => m.openOrderShare(profileId ?? null, toast));
        });
        // Import: the shared order becomes the DRAFT; "Apply order" is still the one step that
        // touches the game, with the usual count of files changing hands.
        const importInto = (prefill = '') => {
            if (busy) return;
            void import('./order-share.js').then(async (m) => {
                const next = await m.openOrderImport(profileId ?? null, prefill);
                if (!next || next.length !== draft.length) return;
                sortSel.value = 'current';
                draft = next;
                live.textContent = t('order.import.drafted');
                render();
            });
        };
        ov.querySelector('#lo-import')?.addEventListener('click', () => importInto());
        // Saved lists: orders that may name inactive mods, applied to several profiles or
        // activated in one step (order-lists.ts). Coming back, the view re-reads the order only
        // when nothing unapplied would be lost: a list may have changed it on disk.
        ov.querySelector('#lo-lists')?.addEventListener('click', () => {
            if (busy) return;
            void import('./order-lists.js').then(async (m) => {
                const changed = await m.openOrderLists(profileId ?? null, toast);
                if (!changed || !sameOrder(saved, draft)) return;
                try {
                    const res = await invoke('mod_order_get', { profileId: profileId ?? null }) as [OrderedMod[], ContestedFile[]] | null;
                    mods = Array.isArray(res?.[0]) ? res![0] : [];
                    contested = Array.isArray(res?.[1]) ? res![1] : [];
                    byId.clear();
                    for (const x of mods) byId.set(x.id, x);
                    saved = mods.map((x) => x.id);
                    draft = saved.slice();
                    selected = draft[0] ?? null;
                    render();
                } catch { /* the view keeps what it had; reopening it reads again */ }
            });
        });
        // The default placement of a bulk enable (modpack, "Enable all", a list, a task, a
        // script): a setting, saved at once. It never moves anything by itself.
        const bulkSel = ov.querySelector('#lo-bulk') as HTMLSelectElement | null;
        if (bulkSel) {
            bulkSel.addEventListener('change', () => {
                void invoke('order_bulk_mode_set', { mode: bulkSel.value })
                    .then(() => { live.textContent = t('order.mode.saved'); })
                    .catch((e) => toast(t(String(e)), 'error', 6000));
            });
        }
        ov.addEventListener('lo-import', (e) => importInto(String((e as CustomEvent).detail || '')));
        applyBtn.addEventListener('click', () => { void apply(); });
        resetBtn.addEventListener('click', () => { draft = saved.slice(); sortSel.value = 'current'; render(); });
        reapplyBtn.addEventListener('click', () => { void reapply(); });
        closeBtn.addEventListener('click', close);
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });

        render();
        list.focus();
        dispatchBmmAction(BMM_ACTIONS.ORDER_OPENED, { profileId: profileId ?? null });
        if (opts.importText) importInto(opts.importText);
    });
}

/** The mod list redraws itself from the backend: the "#N" badges follow the new order. */
function refreshMods(): void {
    const w = window as any;
    if (typeof w._refreshModsFn === 'function') w._refreshModsFn(false, true);
    else window.dispatchEvent(new CustomEvent('bmm://mods-updated'));
}

/**
 * Place a block of active mods after a bulk enable — the one engine every bulk path ends with
 * (src-tauri/src/commands/order_share.rs): `top` the block wins, in its own order; `bottom` it
 * goes under what was already active; `keep` nothing moves. `mode` null = the setting.
 * Returns how many files changed hands, or null on failure.
 */
export async function arrangeBlock(ids: string[], mode: string | null, profileId?: string | null, notify?: Notify): Promise<number | null> {
    if (notify) _notify = notify;
    if (!ids.length) return 0;
    try {
        return Number(await invoke('mod_order_arrange', { profileId: profileId ?? null, ids, mode: mode || null })) || 0;
    } catch (e) {
        toast(fill('order.applyFailed', { e: t(String(e)) }), 'error', 8000);
        return null;
    }
}

/** A block on top, whatever the setting says ("Move to top" of several mods at once). */
export async function placeOnTop(ids: string[], profileId?: string | null, notify?: Notify): Promise<number | null> {
    return arrangeBlock(ids, 'top', profileId, notify);
}

