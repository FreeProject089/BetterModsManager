// The activation order, from the Mod Library.
//
// The full order view (features/profiles/load-order.ts) is an editor: a draft you rearrange and
// then apply. The library is where you already are when you wonder "which of these two wins?",
// so it gets the same facts and the same four moves, applied at once:
//
//   - a toolbar button that opens the full order view for the library's profile;
//   - an "Activation order" box at the top of a mod's detail panel: its position, whom it
//     overrides and who overrides it (with file counts), and Top / Up / Down / Bottom;
//   - a right-click menu on a mod card with the same moves;
//   - Alt+↑ / Alt+↓ / Alt+Home / Alt+End on the selected mod, as registry commands
//     (load-order-keys.ts LIB_ORDER_KEYS: listed in Ctrl+K, rebindable in Settings).
//
// Nothing here decides anything: positions and rivals come from `mod_order_get`, a move is the
// model's moveId() (load-order-model.ts) sent to `mod_order_set`, which re-copies only the files
// that change hands (src-tauri/src/commands/mod_order.rs). The library shows the ACTIVE profile,
// the one picked in its profile selector, and so does every call here (profileId null).
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { appState } from '../../core/state.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { type OrderedMod, type Rival, moveId, sameOrder } from '../profiles/load-order-model.js';
import { bindLibOrderKeys } from '../profiles/load-order-keys.js';
import { uiIcon } from '../../ui/icons.js';

type Where = -1 | 1 | 'top' | 'bottom';

/** ui/app.ts's toast(), handed in by initLibOrder: importing app.ts from here would close an
 *  import cycle (app → … → mods → lib-order → app), the reason load-order.ts takes it the same way. */
type Notify = (message: string, type?: string, duration?: number) => void;
let toast: Notify = () => { /* not mounted yet */ };
const S = appState.state as any;

const I = {
    list: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 6h9"/><path d="M11 12h9"/><path d="M11 18h9"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>',
    top: (uiIcon('move-top', 12)),
    up: (uiIcon('chevron-up', 12)),
    down: (uiIcon('chevron-down', 12)),
    bottom: (uiIcon('move-bottom', 12)),
};

/** `{n}` / `{m}` / `{t}` / `{f}` placeholders, as load-order.ts fills them. */
function fill(key: string, vars: Record<string, string | number>): string {
    let s = t(key);
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
}

/** The chips and the move buttons are styled with the order view (css/load-order.css). */
function ensureCss(): void {
    if (document.getElementById('load-order-css')) return;
    const link = document.createElement('link');
    link.id = 'load-order-css';
    link.rel = 'stylesheet';
    link.href = 'css/load-order.css';
    document.head.appendChild(link);
}

// ── The order, read once per state of the library ─────────────────────────────
// Keyed on the profile and on which mods are active in which order: a toggle, a move or a
// profile switch changes the key, so the next read goes back to the backend; opening ten detail
// panels in a row does not.
let _cache: { key: string; mods: OrderedMod[] } | null = null;
function libKey(): string {
    const on = (S.allMods || []).filter((m: any) => m.enabled)
        .map((m: any) => `${m.id}:${m.activation_order}`).sort().join(',');
    return `${S.cachedActiveProfileId || ''}|${on}`;
}
async function readOrder(fresh = false): Promise<OrderedMod[]> {
    const key = libKey();
    if (!fresh && _cache && _cache.key === key) return _cache.mods;
    const res = await invoke('mod_order_get', { profileId: null }) as [OrderedMod[], unknown[]] | null;
    const mods = Array.isArray(res?.[0]) ? res![0] : [];
    _cache = { key, mods };
    return mods;
}

/** Where a mod sits among the ACTIVE mods, from the list the library already holds. */
function quickPosition(modId: string): { i: number; n: number } {
    const on = (S.allMods || []).filter((m: any) => m.enabled)
        .sort((a: any, b: any) => (a.activation_order ?? 0) - (b.activation_order ?? 0));
    return { i: on.findIndex((m: any) => m.id === modId), n: on.length };
}

let _busy = false;

/** Move one mod in the active profile's order, apply it, and redraw the library. */
export async function libMove(modId: string, where: Where): Promise<boolean> {
    if (_busy || !modId) return false;
    _busy = true;
    try {
        const mods = await readOrder(true);
        const order = mods.map((m) => m.id);
        if (!order.includes(modId)) { toast(t('order.lib.inactive'), 'info', 3500); return false; }
        const next = moveId(order, modId, where);
        if (sameOrder(order, next)) return false;
        const moved = Number(await invoke('mod_order_set', { profileId: null, order: next })) || 0;
        _cache = null;
        const name = mods.find((m) => m.id === modId)?.name || modId;
        toast(fill('order.lib.moved', { m: name, n: next.indexOf(modId) + 1, f: moved }), 'success', 4000);
        dispatchBmmAction(BMM_ACTIONS.ORDER_APPLIED, { moved, from: 'library' });
        const w = window as any;
        if (typeof w._refreshModsFn === 'function') await w._refreshModsFn(false, true);
        return true;
    } catch (e) {
        _cache = null;
        toast(fill('order.applyFailed', { e: t(String(e)) }), 'error', 8000);
        return false;
    } finally {
        _busy = false;
    }
}

/** The full order view, for the profile the library shows. */
export async function openLibOrder(): Promise<void> {
    const sel = document.getElementById('lib-profile-select') as HTMLSelectElement | null;
    const name = sel && sel.value ? sel.options[sel.selectedIndex]?.text?.trim() : '';
    const m = await import('../profiles/load-order.js');
    if (await m.openLoadOrder(null, name || undefined, toast)) {
        _cache = null;
        const w = window as any;
        if (typeof w._refreshModsFn === 'function') void w._refreshModsFn(false, true);
    }
}

// ── The detail panel's box ─────────────────────────────────────────────────────
const rivalChips = (items: Rival[] | undefined, key: string, cls: string): string =>
    (items || []).slice(0, 3).map((r) =>
        `<span class="lo-chip ${cls}" title="${escAttr(fill(key, { n: r.files, m: r.name }))}">${escHtml(fill(key, { n: r.files, m: r.name }))}</span>`,
    ).join('') + ((items || []).length > 3 ? `<span class="lo-none">${escHtml(fill('order.more', { n: (items || []).length - 3 }))}</span>` : '');

const moveButtons = (first: boolean, last: boolean): string => `
    <button type="button" class="lo-mv lob-mv lob-top" title="${escAttr(t('order.moveTop'))}" aria-label="${escAttr(t('order.moveTop'))}" ${first ? 'disabled' : ''}>${I.top}</button>
    <button type="button" class="lo-mv lob-mv lob-up" title="${escAttr(t('order.moveUp'))}" aria-label="${escAttr(t('order.moveUp'))}" ${first ? 'disabled' : ''}>${I.up}</button>
    <button type="button" class="lo-mv lob-mv lob-down" title="${escAttr(t('order.moveDown'))}" aria-label="${escAttr(t('order.moveDown'))}" ${last ? 'disabled' : ''}>${I.down}</button>
    <button type="button" class="lo-mv lob-mv lob-bottom" title="${escAttr(t('order.moveBottom'))}" aria-label="${escAttr(t('order.moveBottom'))}" ${last ? 'disabled' : ''}>${I.bottom}</button>`;

/** Which move a button is: a CLASS, never a data attribute (tests/behaviour-attrs.test.mjs). */
function whereOf(btn: Element): Where {
    const c = btn.classList;
    return c.contains('lob-top') ? 'top' : c.contains('lob-bottom') ? 'bottom' : c.contains('lob-up') ? -1 : 1;
}

/** Put the "Activation order" box at the top of a mod's detail panel (mods-details.ts). */
export function mountOrderSection(panel: HTMLElement, mod: any): void {
    const body = panel.querySelector('.detail-body');
    if (!body || !mod) return;
    ensureCss();
    const box = document.createElement('section');
    box.className = 'lib-order-box';
    box.setAttribute('aria-label', t('order.title'));
    const head = (pos: string) => `<div class="lob-head">
        <span class="lob-title">${escHtml(t('order.title'))}</span>
        ${pos ? `<span class="lob-pos">${escHtml(pos)}</span>` : ''}
        <button type="button" class="btn btn-xs btn-secondary lob-open">${escHtml(t('order.lib.openFull'))}</button>
      </div>`;
    body.insertBefore(box, body.firstChild);

    if (!mod.enabled) {
        box.innerHTML = head('') + `<p class="lob-note">${escHtml(t('order.lib.inactive'))}</p>`;
    } else {
        box.innerHTML = head('') + `<p class="lob-note">${escHtml(t('order.lib.loading'))}</p>`;
        void readOrder().then((mods) => {
            if (!box.isConnected) return;
            const i = mods.findIndex((m) => m.id === mod.id);
            if (i < 0) { box.innerHTML = head('') + `<p class="lob-note">${escHtml(t('order.lib.inactive'))}</p>`; return; }
            const m = mods[i];
            const chips = rivalChips(m.overrides, 'order.overrides', 'lo-wins') + rivalChips(m.overridden_by, 'order.overriddenBy', 'lo-loses');
            box.innerHTML = head(fill('order.lib.position', { n: i + 1, t: mods.length }))
                + `<div class="lob-rivals">${chips || `<span class="lo-none">${escHtml(t('order.noConflict'))}</span>`}</div>`
                + `<div class="lob-moves">${moveButtons(i === 0, i === mods.length - 1)}</div>`;
        }).catch((e) => {
            if (box.isConnected) box.innerHTML = head('') + `<p class="lob-note">${escHtml(fill('order.loadFailed', { e: t(String(e)) }))}</p>`;
        });
    }
    box.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        e.stopPropagation();
        if (target.closest('.lob-open')) { void openLibOrder(); return; }
        const btn = target.closest('.lob-mv');
        if (btn && !(btn as HTMLButtonElement).disabled) void libMove(mod.id, whereOf(btn));
    });
}

// ── Right-click on a mod card ────────────────────────────────────────────────────
function closeMenu(): void { document.getElementById('lib-order-menu-backdrop')?.remove(); }

function showMenu(x: number, y: number, modId: string): void {
    closeMenu();
    ensureCss();
    const mod = (S.allMods || []).find((m: any) => m.id === modId);
    if (!mod) return;
    const { i, n } = quickPosition(modId);
    const on = !!mod.enabled && i >= 0;
    const first = !on || i === 0;
    const last = !on || i === n - 1;
    const item = (cls: string, icon: string, key: string, off: boolean) =>
        `<button type="button" role="menuitem" class="lom-item ${cls}" ${off ? 'disabled' : ''}>${icon}<span>${escHtml(t(key))}</span></button>`;
    const backdrop = document.createElement('div');
    backdrop.id = 'lib-order-menu-backdrop';
    backdrop.className = 'lom-backdrop';
    backdrop.innerHTML = `<div class="lom" role="menu" aria-label="${escAttr(t('order.title'))}">
        <div class="lom-head">${escHtml(t('order.title'))}${on ? ` <span class="lob-pos">${escHtml(fill('order.lib.position', { n: i + 1, t: n }))}</span>` : ''}</div>
        ${on ? '' : `<div class="lom-note">${escHtml(t('order.lib.inactive'))}</div>`}
        ${item('lob-top', I.top, 'order.moveTop', first)}
        ${item('lob-up', I.up, 'order.moveUp', first)}
        ${item('lob-down', I.down, 'order.moveDown', last)}
        ${item('lob-bottom', I.bottom, 'order.moveBottom', last)}
        <div class="lom-sep"></div>
        ${item('lob-open', I.list, 'order.lib.openFull', false)}
      </div>`;
    // On <body>, not in #app-window-outer: that frame has contain: paint, which makes it the
    // containing block of fixed children and clips them, so a menu near the bottom was cut off.
    document.body.appendChild(backdrop);
    const menu = backdrop.querySelector('.lom') as HTMLElement;
    const r = menu.getBoundingClientRect();
    const wantX = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const wantY = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    menu.style.left = `${wantX}px`;
    menu.style.top = `${wantY}px`;
    (menu.querySelector('.lom-item:not([disabled])') as HTMLElement | null)?.focus();

    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeMenu(); });
    backdrop.addEventListener('contextmenu', (e) => { e.preventDefault(); closeMenu(); });
    backdrop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const items = [...menu.querySelectorAll<HTMLButtonElement>('.lom-item:not([disabled])')];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    });
    menu.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.lom-item') as HTMLButtonElement | null;
        if (!btn || btn.disabled) return;
        closeMenu();
        if (btn.classList.contains('lob-open')) void openLibOrder();
        else void libMove(modId, whereOf(btn));
    });
}

// ── Wiring (once, from initMods) ─────────────────────────────────────────────────
function libraryOnScreen(): boolean {
    return !!document.getElementById('view-library')?.classList.contains('active');
}

let _wired = false;
export function initLibOrder(notify: Notify): void {
    toast = notify;
    if (_wired) return;
    _wired = true;
    // Linked now, not on the first right-click: a menu measured before its stylesheet has
    // arrived is placed by its unstyled size and can run off the bottom of the window.
    ensureCss();

    // The toolbar button, next to the sort menu (whose "Activation order" sort it complements).
    const sort = document.getElementById('mod-sort');
    if (sort && !document.getElementById('btn-lib-order')) {
        const btn = document.createElement('button');
        btn.id = 'btn-lib-order';
        btn.type = 'button';
        btn.className = 'btn btn-icon btn-ghost btn-compact-toggle';
        btn.dataset.tasky = 'order.openTip';
        btn.dataset.taskyIcon = 'list';
        btn.setAttribute('aria-label', t('order.title'));
        btn.innerHTML = I.list;
        btn.addEventListener('click', () => { void openLibOrder(); });
        sort.insertAdjacentElement('afterend', btn);
        document.addEventListener('langChanged', () => btn.setAttribute('aria-label', t('order.title')));
    }

    // Right-click on a card. While mod operations run, the cancel menu (mods-list.ts, capture
    // phase) owns the right-click and stops it before it gets here.
    document.addEventListener('contextmenu', (e) => {
        if (!libraryOnScreen() || (S.processingMods && S.processingMods.size > 0)) return;
        const card = (e.target as HTMLElement).closest<HTMLElement>('#view-library .mod-card');
        if (!card?.dataset.id || (e.target as HTMLElement).closest('input, textarea, select, .mod-detail-panel')) return;
        e.preventDefault();
        showMenu(e.clientX, e.clientY, card.dataset.id);
    });

    // The keys: on the selected mod, while the library is on screen and nothing covers it.
    const selectedActive = (): string | null => {
        const id = S.selectedModId as string | null;
        const m = id ? (S.allMods || []).find((x: any) => x.id === id) : null;
        return m?.enabled ? id : null;
    };
    bindLibOrderKeys({
        'library.order.moveUp': () => { const id = selectedActive(); if (id) void libMove(id, -1); },
        'library.order.moveDown': () => { const id = selectedActive(); if (id) void libMove(id, 1); },
        'library.order.moveTop': () => { const id = selectedActive(); if (id) void libMove(id, 'top'); },
        'library.order.moveBottom': () => { const id = selectedActive(); if (id) void libMove(id, 'bottom'); },
    }, () => {
        if (!libraryOnScreen() || !selectedActive()) return false;
        if (document.querySelector('.modal-overlay.open, #lib-order-menu-backdrop')) return false;
        const a = document.activeElement as HTMLElement | null;
        return !(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable));
    });
}
