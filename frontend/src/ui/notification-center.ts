// notification-center.ts — every notification the app has shown you, kept.
//
// A toast is a three-second window onto something that already happened. Miss it —
// you were in another window, you were reading the other half of the screen, it
// fired during a long scan — and the information is simply gone. There was no
// second place to look, so anything BMM had to say was said once or not at all.
//
// This is that second place. It is deliberately NOT a second notification system:
// nothing here decides what to show or when. `toast()` remains the only thing that
// speaks; this only remembers what it said, so the record and the toast can never
// disagree about what happened.
//
// Sources are pluggable because the app is not the only thing with something to
// tell you — see BCWEB below.

import { t, getLang } from '../core/i18n.js';
import { escHtml } from '../core/utils.js';

export interface NotifEntry {
    id: string;
    /** Who is speaking. Shown on the entry, because "where did this come from" is
     *  the first question about a message you did not see arrive. */
    source: string;
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
    ts: number;
    read?: boolean;
}

const KEY = 'bmm.notifCenter';

/** A hard cap, not a preference. Every toast walks this list — to collapse a repeat,
 *  and to recount the unread badge — so an unbounded history would make the app
 *  slower the longer you used it: the classic log that quietly becomes the
 *  performance problem. 200 covers far more than a session; past that, an entry has
 *  outlived any use. (Serialising it is debounced, see save(); walking it is not,
 *  which is why the cap still matters.) */
const MAX = 200;

let _cache: NotifEntry[] | null = null;

function load(): NotifEntry[] {
    if (_cache) return _cache;
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
        _cache = Array.isArray(raw) ? raw.filter(e => e && typeof e.message === 'string') : [];
    } catch { _cache = []; }
    return _cache!;
}

// The badge repaints immediately — it is one attribute write and the user is looking
// at it. Persistence is debounced, because save() runs on EVERY toast and a modpack
// apply toasts per mod: serialising up to 200 entries forty times in a row, to write
// a value that is only ever read at startup, is work nobody asked for. The comment
// above MAX warned about exactly this and the code did it anyway.
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistNow(): void {
    _saveTimer = null;
    try { localStorage.setItem(KEY, JSON.stringify(_cache || [])); } catch { /* history is not worth an error */ }
}
function save(): void {
    _paintBadge();
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(persistNow, 400);
}

/**
 * Record something the app told the user. Called by `toast()` — do not call it
 * alongside a toast, or the same event lands in the list twice.
 */
export function recordNotification(
    message: string,
    type: NotifEntry['type'] = 'info',
    source = 'BMM',
): void {
    if (!message || !message.trim()) return;
    const list = load();
    const now = Date.now();

    // Collapse an identical message repeated inside 2s into one entry. Batch
    // operations legitimately toast per item ("Mod X enabled" ×40 during a modpack
    // apply) and a list of forty identical lines is a list nobody reads.
    const last = list[0];
    if (last && last.message === message && last.source === source && now - last.ts < 2000) {
        last.ts = now;
        save();
        return;
    }

    list.unshift({ id: `n${now}_${Math.random().toString(36).slice(2, 8)}`, source, type, message, ts: now });
    if (list.length > MAX) list.length = MAX;
    save();
}

export function unreadCount(): number { return load().filter(e => !e.read).length; }

/** Marks what is VISIBLE. With a filter active, clearing everything would be a
 *  surprise: you searched down to three errors, and the button next to them would
 *  have silently dismissed ninety entries you never saw. */
export function markAllRead(): void { visibleEntries().forEach(e => { e.read = true; }); save(); repaintPanel(); }

export function clearAll(): void { _cache = []; save(); repaintPanel(); }

export function removeEntry(id: string): void {
    _cache = load().filter(e => e.id !== id);
    save();
    repaintPanel();
}

// ── The bell's unread badge ──────────────────────────────────────────────────

function _paintBadge(): void {
    const btn = document.getElementById('btn-notif-center');
    if (!btn) return;
    const n = unreadCount();
    btn.classList.toggle('has-unread', n > 0);
    btn.setAttribute('data-count', n > 99 ? '99+' : String(n));
    // The count is on the button itself, not only in a decorative dot: a screen
    // reader gets "3 unread notifications", not "button".
    btn.setAttribute('aria-label', `${t('notif.title') || 'Notifications'}${n ? ` (${n})` : ''}`);
    _paintTaskbar(n);
}

/** Mirror the count onto the taskbar icon.
 *
 *  Fire-and-forget, and only when it CHANGES. This runs from save(), which runs on
 *  every toast; asking the OS to redraw an icon forty times during a modpack apply is
 *  work for no visible difference. A failure is swallowed on purpose — the badge is
 *  a nicety, and a platform that cannot draw it must not turn a notification into an
 *  error. */
let _lastBadge = -1;
function _paintTaskbar(n: number): void {
    const shown = Math.min(n, 99);
    if (shown === _lastBadge) return;
    _lastBadge = shown;
    import('../core/api.js')
        .then(m => m.invoke('set_unread_badge', { count: shown }))
        .catch(() => { /* no badge on this platform */ });
}

// ── Relative time ────────────────────────────────────────────────────────────

function relTime(ts: number): string {
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return t('notif.justNow') || 'just now';

    // Intl does this properly in every language BMM ships, and in the ones it does
    // not. The hand-rolled version had `${d} j` — the French abbreviation for
    // "jour", hardcoded, shown to English readers as a bare "3 j". Units are exactly
    // the kind of string that looks too small to need translating and then is not
    // translated; the platform already knows them all.
    try {
        const rtf = new Intl.RelativeTimeFormat(getLang() || undefined, { numeric: 'auto' });
        const mins = Math.round(secs / 60);
        if (mins < 60) return rtf.format(-mins, 'minute');
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return rtf.format(-hrs, 'hour');
        const days = Math.round(hrs / 24);
        if (days < 7) return rtf.format(-days, 'day');
    } catch { /* fall through to the absolute date */ }
    return new Date(ts).toLocaleDateString();
}

// ── The panel ────────────────────────────────────────────────────────────────

const ICONS: Record<NotifEntry['type'], string> = {
    info:    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    success: '<path d="M20 6L9 17l-5-5"/>',
    warning: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    error:   '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
};

function entryHTML(e: NotifEntry): string {
    return `<li class="nc-item ${e.type}${e.read ? '' : ' unread'}" data-id="${e.id}">
        <span class="nc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${ICONS[e.type] || ICONS.info}</svg></span>
        <span class="nc-body">
            <span class="nc-msg">${escHtml(e.message)}</span>
            <span class="nc-meta"><span class="nc-src">${escHtml(e.source)}</span><span class="nc-dot">·</span><time datetime="${new Date(e.ts).toISOString()}">${escHtml(relTime(e.ts))}</time></span>
        </span>
        <button class="nc-del" data-del="${e.id}" title="${escHtml(t('notif.remove') || 'Remove')}" aria-label="${escHtml(t('notif.remove') || 'Remove')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
    </li>`;
}

function panelHTML(): string {
    const all = load();
    const list = visibleEntries();
    const TYPES: ('all' | NotifEntry['type'])[] = ['all', 'error', 'warning', 'success', 'info'];
    const chipLabel = (k: string) => t('notif.f_' + k) || k;
    const tools = all.length ? `
        <div class="nc-tools">
            <input type="search" class="input nc-search" id="nc-search" autocomplete="off"
                placeholder="${escHtml(t('notif.search') || 'Search messages and sources…')}"
                value="${escHtml(_q)}">
            <div class="nc-chips" role="group" aria-label="${escHtml(t('notif.filter') || 'Filter')}">
                ${TYPES.map(k => `<button type="button" class="nc-chip${_type === k ? ' on' : ''}" data-type="${k}"
                    aria-pressed="${_type === k}">${escHtml(chipLabel(k))}</button>`).join('')}
            </div>
        </div>` : '';
    // Two different empties mean two different things, and saying so saves the user
    // wondering whether the app forgot: nothing has happened yet, versus nothing
    // matches what you typed.
    const body = list.length
        ? `<ul class="nc-list">${list.map(entryHTML).join('')}</ul>`
        : all.length
        ? `<div class="nc-empty">
               <p>${escHtml(t('notif.noMatch') || 'Nothing matches.')}</p>
               <p class="nc-empty-sub">${escHtml(t('notif.noMatchSub') || 'Try a different word, or clear the filter.')}</p>
           </div>`
        : `<div class="nc-empty">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
               <p>${escHtml(t('notif.empty') || 'Nothing yet.')}</p>
               <p class="nc-empty-sub">${escHtml(t('notif.emptySub') || 'Everything BMM tells you will be kept here.')}</p>
           </div>`;
    return `
        <div class="nc-head">
            <strong>${escHtml(t('notif.title') || 'Notifications')}</strong>
            <div class="nc-head-actions">
                <button class="nc-act" id="nc-read-all">${escHtml(t('notif.markAllRead') || 'Mark all read')}</button>
                <button class="nc-act nc-act-danger" id="nc-clear">${escHtml(t('notif.clearAll') || 'Clear')}</button>
            </div>
        </div>
        ${tools}
        ${body}
        <div class="nc-foot">${escHtml(t('notif.sourcesNote') || 'Sources: this app. A linked BCWEB account will add its own here.')}</div>`;
}

let _panel: HTMLElement | null = null;

// Filter state lives here, not in the DOM, because repaintPanel() rebuilds the whole
// panel on every change — deleting one entry would otherwise clear the search you
// were in the middle of using to find it.
let _q = '';
let _type: 'all' | NotifEntry['type'] = 'all';

/** The entries currently visible. Search covers the message AND the source: "where
 *  did this come from" is half of what you are looking for when you go back through
 *  a list you did not read at the time. */
function visibleEntries(): NotifEntry[] {
    const q = _q.trim().toLowerCase();
    return load().filter(e =>
        (_type === 'all' || e.type === _type) &&
        (!q || e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q)));
}

export function repaintPanel(): void {
    if (!_panel) return;
    _panel.innerHTML = panelHTML();
    _wirePanel();
}

function _wirePanel(): void {
    if (!_panel) return;
    const search = _panel.querySelector('#nc-search') as HTMLInputElement | null;
    if (search) {
        search.addEventListener('input', () => {
            _q = search.value;
            repaintPanel();
            // The repaint replaced the field, so focus and caret have to be put back
            // or typing a second character silently goes nowhere.
            const again = _panel?.querySelector('#nc-search') as HTMLInputElement | null;
            if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        });
    }
    _panel.querySelectorAll<HTMLElement>('[data-type]').forEach(b => {
        b.addEventListener('click', () => { _type = b.dataset.type as any; repaintPanel(); });
    });
    _panel.querySelector('#nc-read-all')?.addEventListener('click', markAllRead);
    _panel.querySelector('#nc-clear')?.addEventListener('click', clearAll);
    // Clicking an entry expands it. Marked `clipped` only when the rendered box is
    // actually shorter than its content — guessing from string length is wrong at
    // every panel width, and a "click to read more" hint on a message that is fully
    // visible promises something that does not happen.
    _panel.querySelectorAll<HTMLElement>('.nc-item').forEach(li => {
        const msg = li.querySelector('.nc-msg') as HTMLElement | null;
        if (msg && msg.scrollHeight > msg.clientHeight + 1) {
            li.classList.add('clipped');
            li.querySelector('.nc-body')?.setAttribute('data-more', t('notif.more') || 'Click to read');
        }
        li.addEventListener('click', ev => {
            // Not when the target was the delete button, or reading a long entry
            // would delete it.
            if ((ev.target as HTMLElement).closest('[data-del]')) return;
            li.classList.toggle('expanded');
        });
    });

    _panel.querySelectorAll<HTMLElement>('[data-del]').forEach(b => {
        b.addEventListener('click', ev => { ev.stopPropagation(); removeEntry(b.dataset.del!); });
    });
}

function closePanel(): void {
    _panel?.remove();
    _panel = null;
    document.getElementById('btn-notif-center')?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', _outside, true);
    document.removeEventListener('keydown', _esc, true);
}

const _outside = (e: MouseEvent) => {
    if (!_panel) return;
    // composedPath() rather than contains(target): it reports the full chain the
    // event actually travelled, so it still says "inside" when the target sits in a
    // shadow root or has already been replaced by a repaint between the event firing
    // and this handler running. contains() gets both of those wrong.
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const bell = document.getElementById('btn-notif-center');
    if (path.includes(_panel) || (bell && path.includes(bell))) return;
    const target = e.target as Node;
    if (_panel.contains(target) || bell?.contains(target)) return;
    closePanel();
};
const _esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closePanel(); } };

export function toggleNotifCenter(): void {
    if (_panel) { closePanel(); return; }
    _q = ''; _type = 'all';   // a leftover filter reads as an empty history
    const btn = document.getElementById('btn-notif-center');
    if (!btn) return;

    _panel = document.createElement('div');
    _panel.className = 'nc-panel';
    // Stop the panel's own presses from ever reaching the document-level
    // outside-click handler. The z-index is the real fix; this makes the failure
    // mode impossible rather than unlikely, which matters for a handler whose job is
    // to close things.
    _panel.addEventListener('mousedown', e => e.stopPropagation());
    _panel.setAttribute('role', 'dialog');
    _panel.setAttribute('aria-label', t('notif.title') || 'Notifications');
    document.body.appendChild(_panel);
    repaintPanel();

    // Opens UPWARD from the sidebar footer — the house pattern for footer menus,
    // and the only direction with room: the button sits a few pixels off the
    // bottom edge. Positioned in viewport coordinates on <body> rather than
    // inside the footer, because the footer clips its overflow.
    const r = btn.getBoundingClientRect();
    _panel.style.left = `${Math.max(8, r.left)}px`;
    _panel.style.bottom = `${Math.max(8, window.innerHeight - r.top + 8)}px`;

    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', _outside, true);
    document.addEventListener('keydown', _esc, true);

    // Opening it is the acknowledgement — the badge clears, but entries keep their
    // unread accent until this paint is replaced, so you can still see at a glance
    // which ones arrived while you were away.
    const had = load().filter(e => !e.read);
    if (had.length) { setTimeout(() => { had.forEach(e => { e.read = true; }); save(); }, 900); }
}

export function initNotificationCenter(): void {
    document.getElementById('btn-notif-center')?.addEventListener('click', toggleNotifCenter);
    _paintBadge();
    // Flush a pending write before the window goes. Otherwise the notifications lost
    // to the debounce are the last few of the session — precisely the ones the user
    // had not read yet. `pagehide` fires where `beforeunload` is unreliable.
    window.addEventListener('pagehide', () => { if (_saveTimer) { clearTimeout(_saveTimer); persistNow(); } });
}
