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

import { t } from '../core/i18n.js';
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

/** A hard cap, not a preference. The store is read and rewritten on every single
 *  toast, so an unbounded history would make the app slower the longer you used
 *  it — the classic log that quietly becomes the performance problem. 200 covers
 *  far more than a session; past that, an entry has outlived any use. */
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

function save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(_cache || [])); } catch { /* history is not worth an error */ }
    _paintBadge();
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

export function markAllRead(): void { load().forEach(e => { e.read = true; }); save(); repaintPanel(); }

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
}

// ── Relative time ────────────────────────────────────────────────────────────

function relTime(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return t('notif.justNow') || 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h`;
    const d = Math.round(h / 24);
    if (d < 7) return `${d} j`;
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
    const list = load();
    const body = list.length
        ? `<ul class="nc-list">${list.map(entryHTML).join('')}</ul>`
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
        ${body}
        <div class="nc-foot">${escHtml(t('notif.sourcesNote') || 'Sources: this app. A linked BCWEB account will add its own here.')}</div>`;
}

let _panel: HTMLElement | null = null;

export function repaintPanel(): void {
    if (!_panel) return;
    _panel.innerHTML = panelHTML();
    _wirePanel();
}

function _wirePanel(): void {
    if (!_panel) return;
    _panel.querySelector('#nc-read-all')?.addEventListener('click', markAllRead);
    _panel.querySelector('#nc-clear')?.addEventListener('click', clearAll);
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
    const target = e.target as Node;
    if (_panel.contains(target) || document.getElementById('btn-notif-center')?.contains(target)) return;
    closePanel();
};
const _esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closePanel(); } };

export function toggleNotifCenter(): void {
    if (_panel) { closePanel(); return; }
    const btn = document.getElementById('btn-notif-center');
    if (!btn) return;

    _panel = document.createElement('div');
    _panel.className = 'nc-panel';
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
}
