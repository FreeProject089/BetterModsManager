// settings-nav.ts — the Settings page's index and search.
//
// The page is some twenty-five cards, fourteen thousand pixels tall, and you found a setting by
// scrolling past the other twenty-four. This adds a sticky column beside the cards: a search
// field on top, then the cards listed under the groups of card-order.ts (SETTINGS_GROUPS).
//
// Non-invasive, like settings-fold.ts: nothing in index.html moves. `.settings-sections` is
// wrapped at runtime, so every `#view-settings .settings-sections > .glass-card` selector
// (command palette, Ask Laya, card-order, graphics-settings) still matches.
//
// The index follows the page, not a copy of it: a MutationObserver on the cards re-renders it
// when one is reordered, added (Laya's card mounts late) or re-rendered, and `langChanged`
// re-reads the titles.
//
// Search hides the cards that do not mention the query. Inside a card that matches only by
// its rows, the rows that do not match are hidden too — rows of the shared row families only
// (.set-row, .tc-setting, .sk-row), never arbitrary markup, so a control cannot be orphaned
// from its label. A folded card that matches is shown open while the search lasts, without
// touching its saved fold state.
//
// The index is also where the layout is edited (« Edit layout » under it, or the toolbar above
// the cards: one mode, card-order.ts owns it). In edit mode each entry is a row: drag it, or
// Alt+Up / Alt+Down, to move its card within its group (a card's group is fixed by
// SETTINGS_GROUPS, so a move never crosses one), and the eye hides the card from the page.
// Every change goes through card-order.ts, the same storage the toolbar writes.

import { t } from '../core/i18n.js';
import { uiIcon } from './icons.js';
import { initSettingsTabs } from './settings-tabs.js';
import {
    SETTINGS_GROUPS, settingsCardKey, LAYOUT_EVENT, isLayoutEditing, setLayoutEditing, isCardHidden,
    setCardHidden, hiddenCardCount, reorderSettingsCards, resetSettingsLayout,
} from '../features/settings/card-order.js';

const ROW_SEL = '.set-row, .tc-setting, .sk-row';
const HIDE = 'stg-filtered-out';
const OPEN = 'stg-search-open';

let _query = '';
let _observer: MutationObserver | null = null;
let _renderQueued = false;
let _spyQueued = false;
let _wired = false;

function view(): HTMLElement | null { return document.getElementById('view-settings'); }
function sections(): HTMLElement | null { return document.querySelector('#view-settings .settings-sections'); }
function cards(): HTMLElement[] {
    const c = sections();
    if (!c) return [];
    return Array.from(c.children).filter((el) => el instanceof HTMLElement && el.classList.contains('glass-card')) as HTMLElement[];
}
function scroller(): HTMLElement | null { return view()?.closest('.content-area') as HTMLElement | null; }

/** Lower-case, accents folded: « sécurité » matches « securite ». */
function norm(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The card's own title, without the « Learn more » link, badges or the fold chevron. */
function cardTitle(card: HTMLElement): string {
    const title = Array.from(card.querySelectorAll('.card-title'))
        .find((el) => el.closest('.glass-card') === card) as HTMLElement | undefined;
    if (!title) return '';
    const own = title.querySelector(':scope > [data-i18n], :scope > span') as HTMLElement | null;
    const src = (own || title).cloneNode(true) as HTMLElement;
    src.querySelectorAll('.lm-link, button, .badge, svg').forEach((n) => n.remove());
    return (src.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Text a search should see: the card minus the bits that are not settings. */
function cardText(card: HTMLElement): string {
    const clone = card.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.card-drag-handle, .bmm-fold-chevron, svg, script, style').forEach((n) => n.remove());
    return norm(clone.textContent || '');
}

// ── Layout ───────────────────────────────────────────────────────────────────

function ensureLayout(): HTMLElement | null {
    const v = view();
    const sec = sections();
    if (!v || !sec) return null;
    let layout = v.querySelector(':scope > .stg-layout') as HTMLElement | null;
    if (layout) return layout;

    layout = document.createElement('div');
    layout.className = 'stg-layout';
    layout.innerHTML = `
        <aside class="stg-index" id="settings-index">
            <div class="stg-index-top">
            <div class="stg-search">
                ${uiIcon('search', 14, { cls: 'stg-search-icon' })}
                <input type="search" class="form-input stg-search-input" id="settings-search"
                    spellcheck="false" autocomplete="off">
                <kbd class="stg-search-kbd" aria-hidden="true">Ctrl F</kbd>
                <button type="button" class="stg-search-clear" id="settings-search-clear" hidden>${uiIcon('close', 14)}</button>
            </div>
            <button type="button" class="stg-index-toggle" id="settings-index-hide">${uiIcon('panel-left-close', 16)}</button>
            </div>
            <div class="stg-search-count" id="settings-search-count" aria-live="polite"></div>
            <nav class="stg-nav" id="settings-index-nav"></nav>
            <div class="stg-index-foot" id="settings-index-foot"></div>
        </aside>
        <div class="stg-main">
            <button type="button" class="btn btn-ghost btn-sm stg-index-show" id="settings-index-show">
                ${uiIcon('panel-left-open', 16)}<span></span>
            </button>
            <div class="stg-empty" id="settings-search-empty" hidden>
                ${uiIcon('search', 24)}
                <p class="stg-empty-text"></p>
                <button type="button" class="btn btn-secondary btn-sm" id="settings-search-reset"></button>
            </div>
        </div>`;
    sec.parentElement!.insertBefore(layout, sec);
    layout.querySelector('.stg-main')!.insertBefore(sec, layout.querySelector('.stg-empty'));
    v.classList.add('stg-has-index');

    const input = layout.querySelector('#settings-search') as HTMLInputElement;
    input.addEventListener('input', () => applySearch(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; applySearch(''); }
        if (e.key === 'Enter') {
            const first = cards().find((c) => !c.classList.contains(HIDE));
            if (first) jumpTo(first, false);
        }
    });
    const clear = () => { input.value = ''; applySearch(''); input.focus(); };
    layout.querySelector('#settings-search-clear')!.addEventListener('click', clear);
    layout.querySelector('#settings-search-reset')!.addEventListener('click', clear);
    layout.querySelector('#settings-index-hide')!.addEventListener('click', () => {
        setIndexHidden(true);
        (document.getElementById('settings-index-show') as HTMLElement | null)?.focus();
    });
    layout.querySelector('#settings-index-show')!.addEventListener('click', () => {
        setIndexHidden(false);
        (document.getElementById('settings-index-hide') as HTMLElement | null)?.focus();
    });
    setIndexHidden(indexHiddenPref(), false);
    translateChrome(layout);
    return layout;
}

function translateChrome(layout: HTMLElement): void {
    const input = layout.querySelector('#settings-search') as HTMLInputElement;
    input.placeholder = t('settings.searchPh');
    input.setAttribute('aria-label', t('settings.searchPh'));
    layout.querySelector('#settings-index')!.setAttribute('aria-label', t('settings.indexLabel'));
    layout.querySelector('#settings-search-clear')!.setAttribute('aria-label', t('settings.searchClear'));
    layout.querySelector('#settings-search-reset')!.textContent = t('settings.searchClear');
    const hide = layout.querySelector('#settings-index-hide') as HTMLElement;
    hide.setAttribute('aria-label', t('settings.indexHide'));
    hide.title = t('settings.indexHide');
    const show = layout.querySelector('#settings-index-show') as HTMLElement;
    show.setAttribute('aria-label', t('settings.indexShow'));
    show.title = t('settings.indexShow');
    show.querySelector('span')!.textContent = t('settings.indexShowShort');
}

// ── Hiding the index ─────────────────────────────────────────────────────────
// The column can be put away to give the cards the whole width, and the choice is kept. A
// compact « Index » button above the cards brings it back. Narrow windows ignore it: there
// the index is the strip above the cards, which costs no width (settings-page.css).

const INDEX_HIDDEN_KEY = 'bmm.settings.indexHidden';

function indexHiddenPref(): boolean {
    try { return localStorage.getItem(INDEX_HIDDEN_KEY) === '1'; } catch { return false; }
}

function setIndexHidden(hidden: boolean, remember = true): void {
    const layout = document.querySelector('#view-settings .stg-layout') as HTMLElement | null;
    if (!layout) return;
    layout.classList.toggle('is-index-hidden', hidden);
    for (const id of ['#settings-index-hide', '#settings-index-show']) {
        const b = layout.querySelector(id) as HTMLElement | null;
        b?.setAttribute('aria-expanded', String(!hidden));
        b?.setAttribute('aria-controls', 'settings-index');
    }
    // A hidden index had nothing to measure: mark the current card now that it shows again.
    if (!hidden) queueSpy();
    if (!remember) return;
    try { localStorage.setItem(INDEX_HIDDEN_KEY, hidden ? '1' : '0'); } catch { /* storage off: forgotten on restart */ }
}

// ── Index ────────────────────────────────────────────────────────────────────

function renderIndex(): void {
    const nav = document.getElementById('settings-index-nav');
    if (!nav) return;
    const list = cards();
    // settingsCardKey also stamps data-card-key, which every lookup below reads.
    const keys = list.map((c, i) => settingsCardKey(c, i));

    const placed = new Set<string>();
    const groups: { label: string; items: HTMLElement[] }[] = [];
    for (const g of SETTINGS_GROUPS) {
        // Listed in the order the page shows them, not the order the group names them.
        const items = list.filter((_c, i) => g.keys.includes(keys[i]));
        items.forEach((c) => placed.add(c.dataset.cardKey || ''));
        if (items.length) groups.push({ label: t(g.label), items });
    }
    const rest = list.filter((c) => !placed.has(c.dataset.cardKey || ''));
    if (rest.length) groups.push({ label: t('settings.group.other'), items: rest });

    const editing = isLayoutEditing();
    nav.textContent = '';
    nav.classList.toggle('is-editing', editing);
    document.getElementById('settings-index')?.classList.toggle('is-editing', editing);
    for (const g of groups) {
        const box = document.createElement('div');
        box.className = 'stg-nav-group';
        const head = document.createElement('div');
        head.className = 'stg-nav-head';
        head.textContent = g.label;
        box.appendChild(head);
        const named = g.items.filter((card) => cardTitle(card));
        named.forEach((card, i) => {
            const name = cardTitle(card);
            const key = card.dataset.cardKey || '';
            const a = document.createElement('button');
            a.type = 'button';
            a.className = 'stg-nav-link';
            a.dataset.cardKey = key;
            a.textContent = name;
            a.title = name;
            a.addEventListener('click', () => {
                if (_dragMoved) return;   // the click that ends a drag is not « go to this card »
                jumpTo(card, true);
            });
            if (!editing) { box.appendChild(a); return; }
            box.appendChild(editRow(a, key, i, named.length));
        });
        nav.appendChild(box);
    }
    renderFoot();
    syncNavVisibility();
    queueSpy();
    if (_focusAfter) {
        const { key, part } = _focusAfter;
        _focusAfter = null;
        const row = nav.querySelector(`.stg-nav-row[data-card-key="${CSS.escape(key)}"]`);
        const want = row?.querySelector<HTMLButtonElement>(`[data-part="${part}"]:not([disabled])`)
            || row?.querySelector<HTMLButtonElement>('.stg-nav-link');
        want?.focus();
    }
}

// ── Edit mode ────────────────────────────────────────────────────────────────

let _focusAfter: { key: string; part: string } | null = null;
let _dragMoved = false;

function rowButton(part: string, icon: 'move-up' | 'move-down' | 'eye' | 'eye-off', label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stg-row-btn';
    b.dataset.part = part;
    b.innerHTML = uiIcon(icon, 14);
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
}

/** One entry in edit mode: grip, the link, move up / down, show / hide. */
function editRow(link: HTMLButtonElement, key: string, index: number, count: number): HTMLElement {
    const hidden = isCardHidden(key);
    const row = document.createElement('div');
    row.className = 'stg-nav-row' + (hidden ? ' is-hidden' : '');
    row.dataset.cardKey = key;
    const grip = document.createElement('span');
    grip.className = 'stg-row-grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.innerHTML = uiIcon('grip', 14);
    link.dataset.part = 'link';
    link.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    const up = rowButton('up', 'move-up', t('settings.layout.up'));
    const down = rowButton('down', 'move-down', t('settings.layout.down'));
    up.disabled = index === 0;
    down.disabled = index === count - 1;
    const eye = rowButton('eye', hidden ? 'eye-off' : 'eye', t(hidden ? 'settings.layout.show' : 'settings.layout.hide'));
    eye.setAttribute('aria-pressed', String(hidden));
    up.addEventListener('click', () => moveBy(key, -1, 'up'));
    down.addEventListener('click', () => moveBy(key, 1, 'down'));
    eye.addEventListener('click', () => { _focusAfter = { key, part: 'eye' }; setCardHidden(key, !hidden); });
    row.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const part = (e.target as HTMLElement).closest<HTMLElement>('[data-part]')?.dataset.part || 'link';
        moveBy(key, e.key === 'ArrowUp' ? -1 : 1, part);
    });
    row.addEventListener('pointerdown', (e) => startRowDrag(e, row));
    row.append(grip, link, up, down, eye);
    return row;
}

/** The keys of a group, in the order its rows show them. */
function groupKeys(box: Element): string[] {
    return Array.from(box.querySelectorAll<HTMLElement>('.stg-nav-row')).map((r) => r.dataset.cardKey || '');
}

function moveBy(key: string, delta: number, part: string): void {
    const row = document.querySelector(`#settings-index-nav .stg-nav-row[data-card-key="${CSS.escape(key)}"]`);
    const box = row?.closest('.stg-nav-group');
    if (!box) return;
    const keys = groupKeys(box);
    const i = keys.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    _focusAfter = { key, part };
    reorderSettingsCards(keys);   // the observer re-renders the index; focus follows the card
}

// Drag a row within its group: the rows move as you drag, the cards once, on release.
function startRowDrag(e: PointerEvent, row: HTMLElement): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.stg-row-btn')) return;
    const box = row.closest('.stg-nav-group');
    if (!box) return;
    const startY = e.clientY;
    let dragging = false;
    _dragMoved = false;
    const move = (ev: PointerEvent) => {
        if (!dragging) {
            if (Math.abs(ev.clientY - startY) < 4) return;
            dragging = true;
            _dragMoved = true;
            row.classList.add('is-dragging');
            document.body.style.userSelect = 'none';
        }
        const others = Array.from(box.querySelectorAll<HTMLElement>('.stg-nav-row')).filter((r) => r !== row);
        let placed = false;
        for (const sib of others) {
            const r = sib.getBoundingClientRect();
            if (ev.clientY < r.top + r.height / 2) {
                if (sib.previousElementSibling !== row) box.insertBefore(row, sib);
                placed = true;
                break;
            }
        }
        if (!placed && box.lastElementChild !== row) box.appendChild(row);
    };
    const end = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', end);
        document.removeEventListener('pointercancel', end);
        document.body.style.userSelect = '';
        row.classList.remove('is-dragging');
        if (!dragging) return;
        _focusAfter = { key: row.dataset.cardKey || '', part: 'link' };
        reorderSettingsCards(groupKeys(box));
        queueRender();   // repaint the up/down states, also when the row went back where it was
        setTimeout(() => { _dragMoved = false; }, 0);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
}

function footButton(cls: string, icon: 'edit' | 'reset' | 'check', label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-xs stg-foot-btn ${cls}`;
    b.innerHTML = `${uiIcon(icon, 14)}<span></span>`;
    b.querySelector('span')!.textContent = label;
    b.addEventListener('click', onClick);
    return b;
}

/** Under the index: « Edit layout » (and how many cards are hidden), or the edit controls. */
function renderFoot(): void {
    const foot = document.getElementById('settings-index-foot');
    if (!foot) return;
    foot.textContent = '';
    if (isLayoutEditing()) {
        const hint = document.createElement('p');
        hint.className = 'stg-foot-hint';
        hint.textContent = t('settings.layout.editHint');
        const row = document.createElement('div');
        row.className = 'stg-foot-row';
        row.append(
            footButton('btn-ghost', 'reset', t('cardorder.reset'), () => resetSettingsLayout()),
            footButton('btn-primary stg-foot-done', 'check', t('cardorder.editDone'), () => {
                setLayoutEditing(false);
                requestAnimationFrame(() => (document.querySelector('#settings-index-foot .stg-foot-edit') as HTMLElement | null)?.focus());
            }),
        );
        foot.append(hint, row);
        return;
    }
    foot.appendChild(footButton('btn-ghost stg-foot-edit', 'edit', t('cardorder.edit'), () => {
        // Search and edit do not mix: a filtered list would move cards you cannot see.
        const input = document.getElementById('settings-search') as HTMLInputElement | null;
        if (input?.value) { input.value = ''; applySearch(''); }
        setLayoutEditing(true);
        requestAnimationFrame(() => (document.querySelector('#settings-index-nav .stg-nav-link') as HTMLElement | null)?.focus());
    }));
    const n = hiddenCardCount();
    if (n) {
        const chip = document.createElement('span');
        chip.className = 'stg-foot-hidden';
        chip.innerHTML = `${uiIcon('eye-off', 12)}<span></span><b></b>`;
        chip.querySelector('span')!.textContent = t('settings.layout.hidden');
        chip.querySelector('b')!.textContent = String(n);
        foot.appendChild(chip);
    }
}

function jumpTo(card: HTMLElement, unfold: boolean): void {
    if (unfold && card.classList.contains('bmm-collapsed')) {
        (card.querySelector('.bmm-fold-chevron') as HTMLElement | null)?.click();
    }
    const sc = scroller();
    if (sc) {
        const top = card.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 16;
        sc.scrollTo({ top, behavior: 'smooth' });
    } else {
        card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    card.classList.remove('stg-flash');
    void card.offsetWidth;
    card.classList.add('stg-flash');
    setTimeout(() => card.classList.remove('stg-flash'), 1200);
    setActive(card.dataset.cardKey || '');
}

let _activeKey = '';
function setActive(key: string): void {
    let active: HTMLElement | null = null;
    document.querySelectorAll('#settings-index-nav .stg-nav-link').forEach((el) => {
        const on = (el as HTMLElement).dataset.cardKey === key;
        el.classList.toggle('is-active', on);
        if (on) { el.setAttribute('aria-current', 'true'); active = el as HTMLElement; } else el.removeAttribute('aria-current');
    });
    if (key === _activeKey) return;
    _activeKey = key;
    // Keep the active entry in sight inside the index itself (a column when wide, a strip
    // when narrow). Scrolls the index only: scrollIntoView would also move the page.
    const nav = document.getElementById('settings-index-nav');
    const a = active as HTMLElement | null;
    if (!nav || !a) return;
    const n = nav.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    if (r.top < n.top) nav.scrollTop -= n.top - r.top + 8;
    else if (r.bottom > n.bottom) nav.scrollTop += r.bottom - n.bottom + 8;
    if (r.left < n.left) nav.scrollLeft -= n.left - r.left + 8;
    else if (r.right > n.right) nav.scrollLeft += r.right - n.right + 8;
}

/** Scroll-spy: the active entry is the last visible card whose top has passed the fold line. */
function queueSpy(): void {
    if (_spyQueued) return;
    _spyQueued = true;
    requestAnimationFrame(() => {
        _spyQueued = false;
        const sc = scroller();
        if (!sc || !view()?.classList.contains('active')) return;
        const line = sc.getBoundingClientRect().top + 120;
        let current: HTMLElement | null = null;
        for (const c of cards()) {
            if (c.classList.contains(HIDE)) continue;
            if (c.getBoundingClientRect().top <= line) current = c;
            else { if (!current) current = c; break; }
        }
        // At the very bottom the last card may never cross the line.
        if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) {
            const vis = cards().filter((c) => !c.classList.contains(HIDE));
            if (vis.length) current = vis[vis.length - 1];
        }
        if (current) setActive(current.dataset.cardKey || '');
    });
}

// ── Search ───────────────────────────────────────────────────────────────────

/** Shortcut groups the search opened go back to how the user left them. */
function restoreFolds(card: HTMLElement): void {
    card.querySelectorAll<HTMLDetailsElement>('details.sk-group[data-stg-was-open]').forEach((g) => {
        g.open = g.dataset.stgWasOpen === '1';
        delete g.dataset.stgWasOpen;
    });
}

/** A block label (.stg-sub) whose rows the search all hid is hidden with them. */
function hideEmptySubs(card: HTMLElement): void {
    card.querySelectorAll<HTMLElement>('.stg-sub').forEach((sub) => {
        let el = sub.nextElementSibling;
        let any = false;
        while (el && !el.classList.contains('stg-sub')) {
            if (el.matches(ROW_SEL) && !el.classList.contains(HIDE)) { any = true; break; }
            el = el.nextElementSibling;
        }
        sub.classList.toggle(HIDE, !any);
    });
}

function applySearch(raw: string): void {
    _query = norm(raw);
    const q = _query;
    let shown = 0;
    for (const card of cards()) {
        const rows = Array.from(card.querySelectorAll(ROW_SEL)) as HTMLElement[];
        rows.forEach((r) => r.classList.remove(HIDE));
        card.querySelectorAll('.sk-group, .stg-sub').forEach((g) => g.classList.remove(HIDE));
        if (!q) {
            card.classList.remove(HIDE, OPEN);
            restoreFolds(card);
            continue;
        }
        const titleHit = norm(cardTitle(card)).includes(q);
        const textHit = titleHit || cardText(card).includes(q);
        if (!textHit) { card.classList.add(HIDE); card.classList.remove(OPEN); restoreFolds(card); continue; }
        card.classList.remove(HIDE);
        card.classList.add(OPEN);
        shown++;
        if (titleHit) { restoreFolds(card); continue; }
        const hits = rows.filter((r) => norm(r.textContent || '').includes(q));
        if (!hits.length) { restoreFolds(card); continue; } // the match is elsewhere in the card: show it whole
        rows.forEach((r) => { if (!hits.includes(r)) r.classList.add(HIDE); });
        card.querySelectorAll('.sk-group').forEach((g) => {
            const visible = Array.from(g.querySelectorAll('.sk-row')).some((r) => !r.classList.contains(HIDE));
            if (!visible) g.classList.add(HIDE);
            // A folded shortcut group that holds a match is shown open while the search lasts.
            if (g instanceof HTMLDetailsElement) {
                if (!g.dataset.stgWasOpen) g.dataset.stgWasOpen = g.open ? '1' : '0';
                g.open = visible;
            }
        });
        hideEmptySubs(card);
    }
    sections()?.classList.toggle('stg-searching', !!q);

    const count = document.getElementById('settings-search-count');
    if (count) count.textContent = q ? t('settings.searchCount', { n: String(shown) }) : '';
    const clear = document.getElementById('settings-search-clear');
    if (clear) clear.hidden = !q;
    const empty = document.getElementById('settings-search-empty');
    if (empty) {
        empty.hidden = !(q && shown === 0);
        const p = empty.querySelector('.stg-empty-text');
        if (p) p.textContent = t('settings.searchEmpty', { q: raw.trim() });
    }
    syncNavVisibility();
    queueSpy();
}

/** Hide the index entries of hidden cards, and the group headings left with none. */
function syncNavVisibility(): void {
    const hidden = new Set(cards().filter((c) => c.classList.contains(HIDE)).map((c) => c.dataset.cardKey || ''));
    // A card taken off the page is off the index too, except while editing (to bring it back)
    // and while searching (search still finds it, and shows it).
    const keepHidden = isLayoutEditing() || !!_query;
    document.querySelectorAll('#settings-index-nav .stg-nav-group').forEach((g) => {
        let any = false;
        g.querySelectorAll('.stg-nav-link').forEach((a) => {
            const key = (a as HTMLElement).dataset.cardKey || '';
            const off = hidden.has(key) || (!keepHidden && isCardHidden(key));
            const item = (a.closest('.stg-nav-row') as HTMLElement | null) || (a as HTMLElement);
            item.hidden = off;
            if (!off) any = true;
        });
        (g as HTMLElement).hidden = !any;
    });
}

function queueRender(): void {
    if (_renderQueued) return;
    _renderQueued = true;
    requestAnimationFrame(() => {
        _renderQueued = false;
        renderIndex();
        if (_query) applySearch((document.getElementById('settings-search') as HTMLInputElement | null)?.value || '');
    });
}

/** Idempotent: safe to call again after a re-render of the settings page. */
export function initSettingsNav(): void {
    const layout = ensureLayout();
    if (!layout) return;
    renderIndex();
    initSettingsTabs();

    const sec = sections();
    if (sec && !_observer) {
        // Only the card list itself: a card reordered, added or removed. Changes inside a
        // card do not move the index, and watching the subtree would re-render on every toggle.
        _observer = new MutationObserver(queueRender);
        _observer.observe(sec, { childList: true });
    }
    if (_wired) return;
    _wired = true;

    scroller()?.addEventListener('scroll', queueSpy, { passive: true });
    // Edit mode toggled (here or in the toolbar), a card hidden or shown, a layout reset.
    document.addEventListener(LAYOUT_EVENT, () => {
        const input = document.getElementById('settings-search') as HTMLInputElement | null;
        if (input) input.disabled = isLayoutEditing();
        queueRender();
    });
    document.addEventListener('langChanged', () => {
        const l = document.querySelector('#view-settings .stg-layout') as HTMLElement | null;
        if (l) translateChrome(l);
        queueRender();
    });
    // Ctrl+F on the Settings page finds a setting. Not when a dialog is open: those have
    // their own search (the translation sandbox binds Ctrl+F itself).
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f') return;
        if (!view()?.classList.contains('active')) return;
        if ((e.target as HTMLElement | null)?.closest?.('.modal-overlay')) return;
        if (document.querySelector('.modal-overlay.active')) return;
        const input = document.getElementById('settings-search') as HTMLInputElement | null;
        if (!input) return;
        e.preventDefault();
        // The search lives in the index: a hidden index comes back to be typed in.
        if (document.querySelector('#view-settings .stg-layout.is-index-hidden')) setIndexHidden(false);
        input.focus();
        input.select();
    });
}
