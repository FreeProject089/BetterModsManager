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

import { t } from '../core/i18n.js';
import { uiIcon } from './icons.js';
import { SETTINGS_GROUPS, settingsCardKey } from '../features/settings/card-order.js';

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
            <div class="stg-search">
                ${uiIcon('search', 14, { cls: 'stg-search-icon' })}
                <input type="search" class="form-input stg-search-input" id="settings-search"
                    spellcheck="false" autocomplete="off">
                <kbd class="stg-search-kbd" aria-hidden="true">Ctrl F</kbd>
                <button type="button" class="stg-search-clear" id="settings-search-clear" hidden>${uiIcon('close', 14)}</button>
            </div>
            <div class="stg-search-count" id="settings-search-count" aria-live="polite"></div>
            <nav class="stg-nav" id="settings-index-nav"></nav>
        </aside>
        <div class="stg-main">
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

    nav.textContent = '';
    for (const g of groups) {
        const box = document.createElement('div');
        box.className = 'stg-nav-group';
        const head = document.createElement('div');
        head.className = 'stg-nav-head';
        head.textContent = g.label;
        box.appendChild(head);
        for (const card of g.items) {
            const name = cardTitle(card);
            if (!name) continue;
            const a = document.createElement('button');
            a.type = 'button';
            a.className = 'stg-nav-link';
            a.dataset.cardKey = card.dataset.cardKey || '';
            a.textContent = name;
            a.title = name;
            a.addEventListener('click', () => jumpTo(card, true));
            box.appendChild(a);
        }
        nav.appendChild(box);
    }
    syncNavVisibility();
    queueSpy();
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

function applySearch(raw: string): void {
    _query = norm(raw);
    const q = _query;
    let shown = 0;
    for (const card of cards()) {
        const rows = Array.from(card.querySelectorAll(ROW_SEL)) as HTMLElement[];
        rows.forEach((r) => r.classList.remove(HIDE));
        card.querySelectorAll('.sk-group').forEach((g) => g.classList.remove(HIDE));
        if (!q) {
            card.classList.remove(HIDE, OPEN);
            continue;
        }
        const titleHit = norm(cardTitle(card)).includes(q);
        const textHit = titleHit || cardText(card).includes(q);
        if (!textHit) { card.classList.add(HIDE); card.classList.remove(OPEN); continue; }
        card.classList.remove(HIDE);
        card.classList.add(OPEN);
        shown++;
        if (titleHit) continue;
        const hits = rows.filter((r) => norm(r.textContent || '').includes(q));
        if (!hits.length) continue; // the match is elsewhere in the card: show it whole
        rows.forEach((r) => { if (!hits.includes(r)) r.classList.add(HIDE); });
        card.querySelectorAll('.sk-group').forEach((g) => {
            const visible = Array.from(g.querySelectorAll('.sk-row')).some((r) => !r.classList.contains(HIDE));
            if (!visible) g.classList.add(HIDE);
        });
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
    document.querySelectorAll('#settings-index-nav .stg-nav-group').forEach((g) => {
        let any = false;
        g.querySelectorAll('.stg-nav-link').forEach((a) => {
            const off = hidden.has((a as HTMLElement).dataset.cardKey || '');
            (a as HTMLElement).hidden = off;
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
        input.focus();
        input.select();
    });
}
