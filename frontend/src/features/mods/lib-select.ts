/**
 * lib-select.ts — the library's selection mode and its keyboard.
 *
 * Selection mode (#btn-lib-select): a click on a card ticks it instead of opening its details;
 * the bar under the filters (#lib-select-bar) counts the ticked mods and enables or disables
 * them as ONE activation job (core/activation-jobs.ts), so the cards play the same queued →
 * copying → done animation as everywhere else and the work survives navigation.
 *
 * Keyboard, on the list: ↑ ↓ PageUp PageDown Home End move between mods (the virtual list
 * scrolls to the one that is not drawn yet), Enter opens its details, Space switches it on or
 * off (ticks it in selection mode), Ctrl+A ticks every mod shown, Escape leaves selection mode.
 * One card at a time is in the Tab order (roving tabindex), so Tab leaves the list in one step.
 *
 * mods-list.ts reads isPicked / cardTabIndex when it draws a card; mods.ts hands this module
 * the few list operations it needs at boot. No import of either: both import this file.
 */
import { t } from '../../core/i18n.js';
import { runActivationJob } from '../../core/activation-jobs.js';

export interface LibSelectHost {
    /** The mods shown, in display order (filters and sort applied). */
    visible(): Array<{ id: string; name: string; enabled: boolean }>;
    /** Scroll the virtual list to this mod, draw it, and return its card. */
    reveal(id: string): HTMLElement | null;
    /** Redraw the drawn cards (selection classes changed). */
    redraw(): void;
    /** Open the details panel. */
    open(id: string): void;
}

let host: LibSelectHost | null = null;
let selecting = false;
const picked = new Set<string>();
let anchor: string | null = null;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

export function isSelecting(): boolean { return selecting; }
export function isPicked(id: string): boolean { return selecting && picked.has(id); }

/** 0 for the one card in the Tab order, -1 for the others. */
export function cardTabIndex(id: string, firstVisibleId?: string | null): number {
    if (anchor) return anchor === id ? 0 : -1;
    return firstVisibleId === id ? 0 : -1;
}

function viewport(): HTMLElement | null { return $('mod-list-viewport'); }

function cardOf(id: string): HTMLElement | null {
    const v = viewport();
    if (!v) return null;
    for (const c of Array.from(v.children) as HTMLElement[]) if (c.dataset.id === id) return c;
    return null;
}

/** The selection classes on the cards that are drawn (cheap: only the visible window). */
export function paintCard(card: HTMLElement): void {
    const id = card.dataset.id || '';
    const on = isPicked(id);
    card.classList.toggle('is-picked', on);
    if (selecting) card.setAttribute('aria-selected', on ? 'true' : 'false');
    else card.removeAttribute('aria-selected');
}

function paintAll(): void {
    viewport()?.querySelectorAll<HTMLElement>('.mod-card').forEach(paintCard);
    $('mod-list')?.classList.toggle('is-selecting', selecting);
    const v = viewport();
    if (v) {
        if (selecting) v.setAttribute('aria-multiselectable', 'true');
        else v.removeAttribute('aria-multiselectable');
    }
    renderBar();
}

function renderBar(): void {
    const bar = $('lib-select-bar');
    const btn = $('btn-lib-select');
    btn?.setAttribute('aria-pressed', selecting ? 'true' : 'false');
    btn?.classList.toggle('active', selecting);
    if (!bar) return;
    bar.hidden = !selecting;
    if (!selecting) return;
    const ids = [...picked];
    const vis = host?.visible() || [];
    const byId = new Map(vis.map((m) => [m.id, m]));
    const count = $('lib-select-count');
    if (count) count.textContent = t('lib.sel.count', { n: String(ids.length) });
    const off = ids.filter((id) => byId.get(id) && !byId.get(id)!.enabled).length;
    const on = ids.filter((id) => byId.get(id)?.enabled).length;
    const en = $<HTMLButtonElement>('btn-lib-select-enable');
    const dis = $<HTMLButtonElement>('btn-lib-select-disable');
    if (en) { en.disabled = !off; en.title = t('lib.sel.enableTip', { n: String(off) }); }
    if (dis) { dis.disabled = !on; dis.title = t('lib.sel.disableTip', { n: String(on) }); }
    const none = $<HTMLButtonElement>('btn-lib-select-none');
    if (none) none.disabled = !ids.length;
}

export function setSelecting(on: boolean): void {
    if (selecting === on) return;
    selecting = on;
    if (!on) picked.clear();
    paintAll();
}

export function togglePick(id: string): void {
    if (!selecting) return;
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    const c = cardOf(id);
    if (c) paintCard(c);
    renderBar();
}

function pickAllVisible(): void {
    for (const m of host?.visible() || []) picked.add(m.id);
    paintAll();
}

/** The ticked mods that need it, enabled or disabled as one background job. */
function runBulk(mode: 'enable' | 'disable'): void {
    const vis = host?.visible() || [];
    const byId = new Map(vis.map((m) => [m.id, m]));
    const mods = [...picked].map((id) => byId.get(id)).filter((m): m is { id: string; name: string; enabled: boolean } => !!m && (mode === 'enable' ? !m.enabled : m.enabled));
    if (!mods.length) return;
    runActivationJob({
        mods: mods.map((m) => ({ id: m.id, name: m.name })),
        mode,
        label: t(mode === 'enable' ? 'lib.sel.jobEnable' : 'lib.sel.jobDisable', { n: String(mods.length) }),
        source: 'library',
    });
    setSelecting(false);
}

function focusCard(id: string): void {
    const card = host?.reveal(id) || cardOf(id);
    if (!card) return;
    setAnchor(id);
    card.focus({ preventScroll: true });
}

function setAnchor(id: string): void {
    if (anchor === id) return;
    const prev = anchor ? cardOf(anchor) : null;
    if (prev) prev.tabIndex = -1;
    anchor = id;
    const now = cardOf(id);
    if (now) now.tabIndex = 0;
    // The first card was the default stop: once another one is, it leaves the Tab order.
    viewport()?.querySelectorAll<HTMLElement>('.mod-card[tabindex="0"]').forEach((c) => { if (c.dataset.id !== id) c.tabIndex = -1; });
}

function onKey(e: KeyboardEvent): void {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.mod-card');
    // Keys typed into a field or a button inside the card belong to that control.
    if (!card || e.target !== card) return;
    const id = card.dataset.id || '';
    const vis = host?.visible() || [];
    const i = vis.findIndex((m) => m.id === id);
    const go = (j: number) => { const m = vis[Math.max(0, Math.min(vis.length - 1, j))]; if (m) focusCard(m.id); };
    switch (e.key) {
        case 'ArrowDown': e.preventDefault(); go(i + 1); break;
        case 'ArrowUp': e.preventDefault(); go(i - 1); break;
        case 'PageDown': e.preventDefault(); go(i + 8); break;
        case 'PageUp': e.preventDefault(); go(i - 8); break;
        case 'Home': e.preventDefault(); go(0); break;
        case 'End': e.preventDefault(); go(vis.length - 1); break;
        case 'Enter':
            e.preventDefault();
            if (selecting) togglePick(id); else host?.open(id);
            break;
        case ' ':
        case 'Spacebar': {
            e.preventDefault();
            if (selecting) { togglePick(id); break; }
            const input = card.querySelector<HTMLInputElement>('.mod-toggle-input');
            if (input && !input.disabled) { input.checked = !input.checked; input.dispatchEvent(new Event('change')); }
            break;
        }
        case 'Escape':
            if (selecting) { e.preventDefault(); setSelecting(false); }
            break;
        case 'a':
        case 'A':
            if ((e.ctrlKey || e.metaKey) && selecting) { e.preventDefault(); pickAllVisible(); }
            break;
        default:
    }
}

/** At boot (mods.ts). Idempotent. */
export function initLibSelect(h: LibSelectHost): void {
    const first = !host;
    host = h;
    if (!first) return;
    $('btn-lib-select')?.addEventListener('click', () => setSelecting(!selecting));
    $('btn-lib-select-done')?.addEventListener('click', () => setSelecting(false));
    $('btn-lib-select-all')?.addEventListener('click', pickAllVisible);
    $('btn-lib-select-none')?.addEventListener('click', () => { picked.clear(); paintAll(); });
    $('btn-lib-select-enable')?.addEventListener('click', () => runBulk('enable'));
    $('btn-lib-select-disable')?.addEventListener('click', () => runBulk('disable'));
    const v = viewport();
    v?.addEventListener('keydown', onKey);
    v?.addEventListener('focusin', (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('.mod-card');
        if (card?.dataset.id) setAnchor(card.dataset.id);
    });
    // In selection mode a click on a card ticks it (its switch and its buttons still act).
    v?.addEventListener('click', (e) => {
        if (!selecting) return;
        const target = e.target as HTMLElement;
        const card = target.closest<HTMLElement>('.mod-card');
        if (!card?.dataset.id) return;
        if (target.closest('.mod-toggle, .mod-actions, button, a, input, select, .tag-conflict, .sha-status-icon')) return;
        e.stopPropagation();
        e.preventDefault();
        togglePick(card.dataset.id);
    }, true);
    paintAll();
}

/** After the list changed (filters, refresh): forget mods that are no longer shown. */
export function syncSelection(): void {
    if (!selecting || !host) { renderBar(); return; }
    const shown = new Set(host.visible().map((m) => m.id));
    for (const id of [...picked]) if (!shown.has(id)) picked.delete(id);
    renderBar();
}
