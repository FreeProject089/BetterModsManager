// Reorderable settings glass-cards + shareable layout (short code / bmm:// link).
//
// Each direct `.glass-card` child of the settings container gets a stable key
// (its id, or a slug derived from its heading) and a drag handle. The order is
// persisted in localStorage and can be exported as a short code or a bmm:// link,
// then imported on another machine.

import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';

const ORDER_KEY = 'bmm_settings_card_order';
/** Cards the user took off the page (keys). Search still finds them; the layout code does not
 *  carry them (it is an order, and stays the format older builds read). */
const HIDDEN_KEY = 'bmm_settings_card_hidden';
/** Fired on document when the edit mode or a card's visibility changes (settings-nav.ts). */
export const LAYOUT_EVENT = 'bmm:settings-layout';

/**
 * The order the settings page opens in when nobody has rearranged it.
 *
 * The page grew a card at a time and read like it: Language, then auto-update, then a
 * catalogue index, then themes — four unrelated things before anything you came for. Twenty
 * four cards in the order they happened to be written is a list you scroll rather than read.
 *
 * Grouped by what you are DOING, most-reached-for first: how it looks, how it handles your
 * library, automation, performance, the accounts it talks to, privacy and security, then the
 * app's own housekeeping. Debug stays last because it always should.
 *
 * A key here that no longer exists is skipped, and a card missing from this list keeps its
 * place at the end — so adding a card without touching this file leaves it visible rather
 * than hidden, which is the failure mode worth designing against.
 *
 * This is the DEFAULT, not a lock: the page has been reorderable by drag for a while, and a
 * saved order still wins.
 */
/**
 * The same grouping, named: the Settings index (ui/settings-nav.ts) lists the cards under
 * these headings. One list feeds both the default order and the index, so a card cannot sit
 * in one group on the page and another in the index. `label` is an i18n key.
 */
export const SETTINGS_GROUPS: { id: string; label: string; keys: string[] }[] = [
    { id: 'look', label: 'settings.group.look', keys: [
        'k:settings.language',
        'k:themes.settingsTitle',
        'settings-graphics-card',
        'k:settings.taskyTitle',
        'k:settings.shortcutsTitle',
    ] },
    { id: 'library', label: 'settings.group.library', keys: [
        'settings-scan-updates-card',
        'settings-sha-card',
        'k:settings.tagsTitle',
        'settings-catalog-index-card',
    ] },
    { id: 'automation', label: 'settings.group.automation', keys: [
        'settings-scheduler-section',
        'settings-launchpack-section',
        'settings-identity-card',
    ] },
    { id: 'performance', label: 'settings.group.performance', keys: [
        'settings-storage-section',
        'settings-benchmark-section',
    ] },
    { id: 'accounts', label: 'settings.group.accounts', keys: [
        'k:settings.githubPatTitle',
        'settings-discord-rpc-card',
    ] },
    // Privacy and security. The two security cards sit together on purpose: one is system
    // access, the other is the app's own, and split across the page they read as a
    // duplicate rather than as two halves of one subject.
    { id: 'privacy', label: 'settings.group.privacy', keys: [
        'settings-privacy-section',
        'settings-ai-section',
        'settings-watcher-section',
        'settings-security-section',
        'settings-security-card',
    ] },
    // The app looking after itself. Debug stays last but for feedback, which was already
    // after it when it was unlisted.
    { id: 'app', label: 'settings.group.app', keys: [
        'settings-auto-update-card',
        'settings-old-installs-card',
        'k:settings.dataTitle',
        'k:settings.crashTitle',
        'k:betahub.cardTitle',
        'debug-menu-card',
        'settings-feedback-card',
    ] },
];

const DEFAULT_ORDER: string[] = SETTINGS_GROUPS.flatMap((g) => g.keys);

/** The stable key of a settings card (its id, its title's i18n key, or its position). */
export function settingsCardKey(card: HTMLElement, index: number): string {
    return cardKey(card, index);
}
const CODE_PREFIX = 'BMMUI1.';

function container(): HTMLElement | null {
    return document.querySelector('#view-settings .settings-sections');
}

function cardKey(card: HTMLElement, index: number): string {
    if (card.dataset.cardKey) return card.dataset.cardKey;
    let key = card.id;
    if (!key) {
        const title = card.querySelector('.card-title, h3');
        const i18n = title?.querySelector('[data-i18n]')?.getAttribute('data-i18n')
            || title?.getAttribute('data-i18n');
        key = i18n ? `k:${i18n}` : `idx:${index}`;
    }
    card.dataset.cardKey = key;
    return key;
}

function cards(): HTMLElement[] {
    const c = container();
    if (!c) return [];
    return Array.from(c.children).filter(el =>
        el instanceof HTMLElement && el.classList.contains('glass-card')) as HTMLElement[];
}

function saveOrder(): void {
    const order = cards().map((c, i) => cardKey(c, i));
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* private mode: this session only */ }
}

// ── Hidden cards ──────────────────────────────────────────────────────────────
function loadHidden(): Set<string> {
    try {
        const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
        return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    } catch { return new Set(); }
}
const _hidden: Set<string> = loadHidden();
function saveHidden(): void {
    try {
        if (_hidden.size) localStorage.setItem(HIDDEN_KEY, JSON.stringify([..._hidden]));
        else localStorage.removeItem(HIDDEN_KEY);
    } catch { /* private mode: this session only */ }
}
function paintHidden(): void {
    cards().forEach((c, i) => c.classList.toggle('stg-card-hidden', _hidden.has(cardKey(c, i))));
}
function emitLayout(): void {
    document.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: { editing: _editMode } }));
}

export function isCardHidden(key: string): boolean { return _hidden.has(key); }
export function hiddenCardCount(): number {
    const present = new Set(cards().map((c, i) => cardKey(c, i)));
    return [..._hidden].filter((k) => present.has(k)).length;
}
export function setCardHidden(key: string, hidden: boolean): void {
    if (hidden) _hidden.add(key); else _hidden.delete(key);
    saveHidden();
    paintHidden();
    emitLayout();
}

/**
 * Put `keys` (cards already on the page, e.g. one group's) in this order, in the places those
 * cards occupy now: every other card keeps its position. Saved like a drag on the page.
 */
export function reorderSettingsCards(keys: string[]): void {
    const c = container();
    if (!c) return;
    const list = cards();
    const keyOf = list.map((card, i) => cardKey(card, i));
    const wanted = new Set(keys);
    const slots = keyOf.map((k, i) => (wanted.has(k) ? i : -1)).filter((i) => i >= 0);
    if (slots.length !== keys.length) return;
    const next = keyOf.slice();
    slots.forEach((slot, j) => { next[slot] = keys[j]; });
    if (next.every((k, i) => k === keyOf[i])) return;
    const byKey = new Map(list.map((card, i) => [keyOf[i], card] as const));
    for (const k of next) { const el = byKey.get(k); if (el) c.appendChild(el); }
    saveOrder();
}

function applyOrder(order: string[]): void {
    const c = container();
    if (!c || !order?.length) return;
    const list = cards();
    const byKey = new Map<string, HTMLElement>();
    list.forEach((card, i) => byKey.set(cardKey(card, i), card));
    // Re-append in saved order; unknown cards keep their place at the end.
    for (const key of order) {
        const card = byKey.get(key);
        if (card) { c.appendChild(card); byKey.delete(key); }
    }
    // Any cards not in the saved order (new ones) stay after, in DOM order.
    for (const card of byKey.values()) c.appendChild(card);
}

// ── Drag & drop (pointer-based — reliable on complex cards) ────────────────────
let _dragEl: HTMLElement | null = null;
let _editMode = false;

function onPointerMove(e: PointerEvent): void {
    if (!_dragEl) return;
    const c = container();
    if (!c) return;
    const others = cards().filter(x => x !== _dragEl);
    let placed = false;
    for (const sib of others) {
        const r = sib.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { c.insertBefore(_dragEl, sib); placed = true; break; }
    }
    if (!placed) c.appendChild(_dragEl); // drop at the end
}

function onPointerUp(): void {
    document.removeEventListener('pointermove', onPointerMove);
    if (_dragEl) {
        _dragEl.classList.remove('card-dragging');
        _dragEl = null;
        saveOrder();
    }
    document.body.style.userSelect = '';
}

function makeDraggable(card: HTMLElement, index: number): void {
    cardKey(card, index);
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

    if (card.dataset.reorderWired) return;
    card.dataset.reorderWired = '1';

    const handle = document.createElement('button');
    handle.className = 'card-drag-handle';
    handle.type = 'button';
    handle.title = t('cardorder.drag') || 'Drag to reorder';
    handle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;
    card.appendChild(handle);

    // In Edit mode the WHOLE card is the drag handle (pointerdown anywhere on it
    // starts the drag). Outside edit mode this does nothing, so normal clicks work.
    card.addEventListener('pointerdown', (e) => {
        if (!_editMode) return;
        e.preventDefault();
        e.stopPropagation();
        _dragEl = card;
        card.classList.add('card-dragging');
        document.body.style.userSelect = 'none';
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp, { once: true });
    });
}

export function isLayoutEditing(): boolean { return _editMode; }
/** One edit mode for both doors: the toolbar above the cards and the index beside them. */
export function setLayoutEditing(on: boolean): void {
    if (on === _editMode) return;
    setEditMode(on);
    emitLayout();
}

/** Default order, every card shown. */
export function resetSettingsLayout(): void {
    try { localStorage.removeItem(ORDER_KEY); } catch { /* nothing saved to remove */ }
    _hidden.clear();
    saveHidden();
    if (_originalOrder.length) applyOrder(_originalOrder);
    paintHidden();
    emitLayout();
    toast(t('cardorder.resetDone') || 'Default order restored', 'info');
}

function setEditMode(on: boolean): void {
    _editMode = on;
    const c = container();
    if (c) c.classList.toggle('cardorder-editing', on);
    const btn = document.getElementById('cardorder-editbtn');
    if (btn) {
        btn.textContent = on ? (t('cardorder.editDone') || 'Done') : (t('cardorder.edit') || 'Edit layout');
        btn.classList.toggle('btn-accent', on);
        btn.classList.toggle('btn-ghost', !on);
    }
}

// ── Share / import ────────────────────────────────────────────────────────────
function exportCode(): string {
    const order = cards().map((c, i) => cardKey(c, i));
    try { return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(order)))); }
    catch { return ''; }
}
function parseCode(raw: string): string[] | null {
    let s = raw.trim();
    const urlMatch = s.match(/[?&]code=([^&\s]+)/);
    if (urlMatch) s = decodeURIComponent(urlMatch[1]);
    const m = s.match(new RegExp('^' + CODE_PREFIX.replace('.', '\\.') + '(.+)$'));
    if (!m) return null;
    try {
        const arr = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
        return Array.isArray(arr) ? arr : null;
    } catch { return null; }
}

function renderToolbar(): void {
    const c = container();
    if (!c || document.getElementById('cardorder-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'cardorder-bar';
    bar.className = 'cardorder-bar';
    bar.innerHTML = `
        <span class="cardorder-hint">⇅ ${t('cardorder.hintEdit') || 'Turn on Edit layout, then drag cards to reorder'}</span>
        <div class="cardorder-actions">
            <button class="btn btn-xs btn-ghost" id="cardorder-editbtn">${t('cardorder.edit') || 'Edit layout'}</button>
            <button class="btn btn-xs btn-ghost" id="cardorder-navbar">${t('navedit.title') || 'Customize navigation'}</button>
            <button class="btn btn-xs btn-ghost" id="cardorder-share">${t('cardorder.share') || 'Share layout'}</button>
            <button class="btn btn-xs btn-ghost" id="cardorder-import">${t('cardorder.import') || 'Import'}</button>
            <button class="btn btn-xs btn-ghost" id="cardorder-reset">${t('cardorder.reset') || 'Reset'}</button>
        </div>
        <div class="cardorder-import-row" id="cardorder-import-row" style="display:none">
            <input class="input" id="cardorder-import-input" placeholder="${t('cardorder.importPh') || 'Paste layout code or bmm:// link'}">
            <button class="btn btn-xs btn-accent" id="cardorder-import-apply">${t('common.apply') || 'Apply'}</button>
        </div>`;
    c.insertBefore(bar, c.firstChild);

    bar.querySelector('#cardorder-editbtn')?.addEventListener('click', () => setLayoutEditing(!_editMode));
    bar.querySelector('#cardorder-navbar')?.addEventListener('click', () => {
        import('../../ui/navbar-customize.js').then(m => m.openNavbarEditor()).catch(() => {});
    });
    bar.querySelector('#cardorder-share')?.addEventListener('click', async () => {
        // Copy a READY-TO-USE bmm:// deeplink (clicking it on another machine
        // applies this exact layout). The import box also still accepts it.
        const link = `bmm://settings/layout?code=${encodeURIComponent(exportCode())}`;
        try { await navigator.clipboard.writeText(link); } catch {}
        toast(t('cardorder.copiedLink') || 'bmm:// layout link copied to clipboard', 'success');
    });
    bar.querySelector('#cardorder-import')?.addEventListener('click', () => {
        const row = bar.querySelector('#cardorder-import-row') as HTMLElement;
        row.style.display = row.style.display === 'none' ? 'flex' : 'none';
    });
    bar.querySelector('#cardorder-import-apply')?.addEventListener('click', () => {
        const val = (bar.querySelector('#cardorder-import-input') as HTMLInputElement).value;
        const order = parseCode(val);
        if (!order) { toast(t('cardorder.badCode') || 'Invalid layout code', 'error'); return; }
        applyOrder(order); saveOrder();
        toast(t('cardorder.applied') || 'Layout applied', 'success');
        (bar.querySelector('#cardorder-import-row') as HTMLElement).style.display = 'none';
    });
    // Default order live (no refresh), and every hidden card back.
    bar.querySelector('#cardorder-reset')?.addEventListener('click', resetSettingsLayout);
}

let _wired = false;
let _originalOrder: string[] = [];   // DOM order before any saved layout was applied
export function initCardReorder(): void {
    const c = container();
    if (!c) return;
    // Capture the pristine (HTML-defined) order ONCE, before applying anything,
    // so Reset can restore it instantly without a refresh.
    // Reset goes back to the DEFAULT, not to the order the HTML happens to be written in —
    // otherwise the button labelled "reset" hands you the jumble the default exists to fix.
    // Filtered to cards that are really there, then followed by anything the list does not
    // name, so a new card is never dropped.
    if (!_originalOrder.length) {
        const present = new Set(cards().map((card, i) => cardKey(card, i)));
        const known = DEFAULT_ORDER.filter((k) => present.has(k));
        const rest = cards().map((card, i) => cardKey(card, i)).filter((k) => !known.includes(k));
        _originalOrder = [...known, ...rest];
    }
    renderToolbar();
    cards().forEach((card, i) => makeDraggable(card, i));
    paintHidden();
    if (!_wired) {
        _wired = true;
        try {
            const saved = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null');
            // A saved order always wins; the default only decides what a fresh install sees.
            applyOrder(Array.isArray(saved) && saved.length ? saved : _originalOrder);
        } catch {}
        paintHidden();
        // Re-translate the toolbar live when the language changes (no refresh).
        document.addEventListener('langChanged', () => {
            const bar = document.getElementById('cardorder-bar');
            if (bar) { bar.remove(); renderToolbar(); setEditMode(_editMode); }
        });
    }
    // A pending layout from a bmm:// deeplink (set by the scheme handler).
    const pending = sessionStorage.getItem('bmm_pending_layout');
    if (pending) {
        sessionStorage.removeItem('bmm_pending_layout');
        const order = parseCode(pending);
        if (order) { applyOrder(order); saveOrder(); toast(t('cardorder.applied') || 'Layout applied', 'success'); }
    }
}
