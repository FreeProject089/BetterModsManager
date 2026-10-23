// notification-center.ts — every notification the app has shown you, kept, grouped, and
// actionable.
//
// A toast is a three-second window onto something that already happened. Miss it and the
// information was gone, so this is the second place to look. It is deliberately NOT a second
// notification system: `toast()` (ui/app.ts) remains the only thing that speaks, and it records
// here. What is new is that both ask the same rules (core/notif-model.ts) what to do:
//
//   · one bell, one unread count (the taskbar badge mirrors it);
//   · entries grouped by where they came from: updates, followed repos, the scheduler, finished
//     background jobs, BetterCommunity, the app itself;
//   · per entry: Open (when the message knows where it leads), Snooze, Dismiss;
//   · per group, in Settings: in the app / also as a system notification / off (history only);
//   · do not disturb, by hand or on a daily schedule (quiet hours);
//   · the same event twice is one entry (×2) and one popup, not two;
//   · bounded: 200 entries, nothing older than 30 days;
//   · keyboard: ↑/↓ between entries, Enter opens, Delete dismisses, S snoozes, Esc closes and
//     gives the focus back to the bell.

import { t, getLang } from '../core/i18n.js';
import { escHtml, escAttr } from '../core/utils.js';
import * as N from '../core/notif-model.js';
import { goToSettings } from '../core/settings-link.js';

export type NotifEntry = N.NotifEntry;
export type { NotifAction } from '../core/notif-model.js';

const KEY = 'bmm.notifCenter';

let _cache: NotifEntry[] | null = null;

function storage(): Storage | null {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function load(): NotifEntry[] {
    if (_cache) return _cache;
    try {
        const raw = JSON.parse(storage()?.getItem(KEY) || '[]');
        const list = Array.isArray(raw) ? raw.filter((e) => e && typeof e.message === 'string' && typeof e.id === 'string') : [];
        _cache = N.pruneHistory(list, Date.now());
    } catch { _cache = []; }
    return _cache!;
}

// The badge repaints immediately; persistence is debounced, because a modpack apply toasts per
// mod and serialising the list forty times to write a value only read at startup is waste.
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistNow(): void {
    _saveTimer = null;
    try { storage()?.setItem(KEY, JSON.stringify(_cache || [])); } catch { /* history is not worth an error */ }
}
function save(): void {
    _paintBadge();
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(persistNow, 400);
}

// ── Preferences (Settings → Notifications) ───────────────────────────────────────────────

export function readNotifPrefs(): N.NotifPrefs {
    const s = storage();
    try { return N.parsePrefs(s?.getItem(N.PREFS_KEY), s?.getItem(N.LEGACY_MUTE_KEY)); }
    catch { return N.parsePrefs(null); }
}

export function writeNotifPrefs(p: N.NotifPrefs): void {
    try { storage()?.setItem(N.PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
    _paintBadge();
    repaintPanel();
}

/** Do not disturb right now (by hand or quiet hours). */
export function quietNow(): boolean { return N.isQuiet(readNotifPrefs(), new Date()); }

// ── Actions: what « Open » does ──────────────────────────────────────────────────────────
//
// An entry stores a serialisable { kind, arg }; the code that knows how to open it registers
// here. Kinds nobody registered simply show no Open button.

const _actions = new Map<string, (arg?: string) => unknown>();
export function registerNotifAction(kind: string, run: (arg?: string) => unknown): void { _actions.set(kind, run); }

function goToView(view: string): void {
    const nav = document.querySelector<HTMLElement>(`.nav-item[data-view="${CSS.escape(view)}"]`);
    nav?.click();
}

function builtInActions(): void {
    registerNotifAction('view', (v) => { if (v) goToView(v); });
    registerNotifAction('url', (u) => {
        if (u && /^https:\/\//i.test(u)) void import('../core/api.js').then((m) => m.invoke('open_external', { url: u })).catch(() => {});
    });
    registerNotifAction('activity', () => {
        void import('./activity-center.js').then((m) => m.toggleActivityCenter()).catch(() => {});
    });
    registerNotifAction('conflicts', (id) => {
        void import('../features/mods/conflicts-view.js').then((m) => m.openConflictsView(id || null)).catch(() => {});
    });
    registerNotifAction('settings', () => openNotifSettings());
    // A file an export wrote (ui/export-file.ts): open its folder.
    registerNotifAction('open-folder', (p) => {
        if (p) void import('../core/api.js').then((m) => m.invoke('open_folder', { path: p })).catch(() => {});
    });
}

/** Settings → the notification preferences, scrolled into view. */
export function openNotifSettings(): void {
    goToSettings('notif-source-list');
}

// ── Recording ────────────────────────────────────────────────────────────────────────────

export interface RecordOptions {
    /** Same key = same event (a progress message, a poll result): updates the entry. */
    key?: string;
    action?: N.NotifAction;
}

/**
 * Record something the app told the user. Called by `toast()` — do not call it alongside a
 * toast, or the same event lands in the list twice. Returns true when it folded into an
 * existing entry (a repeat).
 */
export function recordNotification(
    message: string,
    type: NotifEntry['type'] = 'info',
    source = 'BMM',
    opts: RecordOptions = {},
): boolean {
    if (!message || !message.trim()) return false;
    const r = N.addEntry(load(), { source, type, message, key: opts.key, action: opts.action }, Date.now());
    _cache = r.list;
    save();
    if (_panel) repaintPanel();
    return r.folded;
}

export function unreadCount(): number { return N.unreadOf(load(), Date.now()); }

/** Marks what is VISIBLE: with a filter on, the button next to three errors must not silently
 *  dismiss ninety entries you never saw. */
export function markAllRead(): void { visibleEntries().forEach((e) => { e.read = true; }); save(); repaintPanel(); }

export function clearAll(): void { _cache = []; save(); repaintPanel(); }

export function removeEntry(id: string): void {
    _cache = load().filter((e) => e.id !== id);
    save();
    repaintPanel();
}

export function snoozeEntry(id: string, preset: '1h' | '4h' | 'tomorrow'): void {
    const e = load().find((x) => x.id === id);
    if (!e) return;
    e.snoozedUntil = N.snoozeUntil(preset, new Date());
    e.read = true;
    save();
    repaintPanel();
}

export function wakeEntry(id: string): void {
    const e = load().find((x) => x.id === id);
    if (!e) return;
    delete e.snoozedUntil;
    e.read = false;
    save();
    repaintPanel();
}

function runAction(e: NotifEntry): boolean {
    const run = e.action ? _actions.get(e.action.kind) : undefined;
    if (!run) return false;
    e.read = true;
    save();
    closePanel();
    try { void run(e.action!.arg); } catch (err) { console.warn('[notif] action failed', err); }
    return true;
}

// ── System notifications ─────────────────────────────────────────────────────────────────

const NOTIFY_CMD = 'plugin:notification|notify';

/** Show an OS notification. Never throws: a platform that cannot must not turn a message into
 *  an error. Tauri's notification plugin; desktop grants it without asking. */
export async function sendSystemNotification(title: string, body: string): Promise<void> {
    const T = (window as any).__TAURI__;
    if (!T) return;
    try {
        const api = T.notification;
        if (api?.sendNotification) {
            let ok = true;
            try { ok = api.isPermissionGranted ? await api.isPermissionGranted() : true; } catch { ok = true; }
            if (!ok && api.requestPermission) ok = (await api.requestPermission()) === 'granted';
            if (ok) api.sendNotification({ title, body });
            return;
        }
        if (T.core?.invoke) await T.core.invoke(NOTIFY_CMD, { options: { title, body } });
    } catch { /* no system notifications here */ }
}

/** Whether BMM's window is the one in front (a system notification is for when it is not). */
export function appFocused(): boolean {
    try { return !document.hidden && document.hasFocus(); } catch { return true; }
}

export function groupLabel(g: N.NotifGroup): string { return t('notif.group.' + g); }

// ── The bell's unread badge ──────────────────────────────────────────────────────────────

function _paintBadge(): void {
    const btn = document.getElementById('btn-notif-center');
    if (!btn) return;
    const n = unreadCount();
    const quiet = quietNow();
    btn.classList.toggle('has-unread', n > 0);
    btn.classList.toggle('is-dnd', quiet);
    btn.setAttribute('data-count', n > 99 ? '99+' : String(n));
    // The count is on the button itself: a screen reader gets "Notifications (3)", not "button".
    btn.setAttribute('aria-label', `${t('notif.title')}${n ? ` (${n})` : ''}${quiet ? ` · ${t('notif.dndOn')}` : ''}`);
    _paintTaskbar(n);
}

/** Mirror the count onto the taskbar icon, only when it changes. */
let _lastBadge = -1;
function _paintTaskbar(n: number): void {
    const shown = Math.min(n, 99);
    if (shown === _lastBadge) return;
    _lastBadge = shown;
    import('../core/api.js')
        .then((m) => m.invoke('set_unread_badge', { count: shown }))
        .catch(() => { /* no badge on this platform */ });
}

// ── Relative time ────────────────────────────────────────────────────────────────────────

function relTime(ts: number, future = false): string {
    const secs = Math.round((ts - Date.now()) / 1000) * (future ? 1 : -1);
    if (secs < 60) return future ? t('notif.soon') : t('notif.justNow');
    try {
        const rtf = new Intl.RelativeTimeFormat(getLang() || undefined, { numeric: 'auto' });
        const sign = future ? 1 : -1;
        const mins = Math.round(secs / 60);
        if (mins < 60) return rtf.format(sign * mins, 'minute');
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return rtf.format(sign * hrs, 'hour');
        const days = Math.round(hrs / 24);
        if (days < 7) return rtf.format(sign * days, 'day');
    } catch { /* fall through to the absolute date */ }
    return new Date(ts).toLocaleDateString();
}

// ── The panel ────────────────────────────────────────────────────────────────────────────

const CSS_ID = 'notifications-css';
function ensureCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/notifications.css';
    document.head.appendChild(link);
}

const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS: Record<NotifEntry['type'], string> = {
    info:    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    success: '<path d="M20 6L9 17l-5-5"/>',
    warning: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    error:   '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
};
const I_CLOSE = svg('<path d="M18 6L6 18M6 6l12 12"/>');
const I_SNOOZE = svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6M22 6l-3-3"/>');
const I_OPEN = svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
const I_DND = svg('<path d="M10.3 21a2 2 0 0 0 3.4 0"/><path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="m2 2 20 20"/>');
const I_GEAR = svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>');

let _panel: HTMLElement | null = null;

// Filter / fold state lives here, not in the DOM: a repaint rebuilds the panel, and deleting an
// entry must not clear the search you were using to find it.
let _q = '';
let _type: 'all' | NotifEntry['type'] = 'all';
const _folded = new Set<string>();
let _snoozeMenu: string | null = null;
let _showSnoozed = false;

/** Entries matching the search and type filter, snoozed ones excluded. */
function visibleEntries(): NotifEntry[] {
    const q = _q.trim().toLowerCase();
    const now = Date.now();
    return load().filter((e) => !N.isSnoozed(e, now) &&
        (_type === 'all' || e.type === _type) &&
        (!q || e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q) || groupLabel(N.groupOf(e.source)).toLowerCase().includes(q)));
}

function entryHTML(e: NotifEntry, snoozed = false): string {
    const canOpen = !!(e.action && _actions.has(e.action.kind));
    const count = e.count && e.count > 1 ? `<span class="nc-count" title="${escAttr(t('notif.repeated', { n: String(e.count) }))}">×${e.count}</span>` : '';
    const when = snoozed && e.snoozedUntil
        ? `<span>${escHtml(t('notif.snoozedUntil', { when: relTime(e.snoozedUntil, true) }))}</span>`
        : `<time datetime="${new Date(e.ts).toISOString()}">${escHtml(relTime(e.ts))}</time>`;
    const menu = _snoozeMenu === e.id ? `<span class="nc-snooze-menu" role="group" aria-label="${escAttr(t('notif.snooze'))}">
            <button type="button" class="nc-act" data-snooze="1h" data-id="${e.id}">${escHtml(t('notif.snooze1h'))}</button>
            <button type="button" class="nc-act" data-snooze="4h" data-id="${e.id}">${escHtml(t('notif.snooze4h'))}</button>
            <button type="button" class="nc-act" data-snooze="tomorrow" data-id="${e.id}">${escHtml(t('notif.snoozeTomorrow'))}</button>
        </span>` : '';
    return `<li class="nc-item ${e.type}${e.read || snoozed ? '' : ' unread'}" data-id="${e.id}" tabindex="-1"
            aria-label="${escAttr(`${t('notif.t_' + e.type)}: ${e.message}`)}">
        <span class="nc-ico" aria-hidden="true">${svg(ICONS[e.type] || ICONS.info)}</span>
        <span class="nc-body">
            <span class="nc-msg">${escHtml(e.message)}</span>
            <span class="nc-meta"><span class="nc-src">${escHtml(e.source)}</span><span class="nc-dot" aria-hidden="true">·</span>${when}${count}</span>
            ${menu}
        </span>
        <span class="nc-row-acts">
            ${canOpen ? `<button type="button" class="nc-ibtn" data-open="${e.id}" title="${escAttr(e.action?.label || t('notif.open'))}" aria-label="${escAttr(e.action?.label || t('notif.open'))}">${I_OPEN}</button>` : ''}
            ${snoozed
                ? `<button type="button" class="nc-ibtn" data-wake="${e.id}" title="${escAttr(t('notif.wake'))}" aria-label="${escAttr(t('notif.wake'))}">${I_SNOOZE}</button>`
                : `<button type="button" class="nc-ibtn" data-snooze-menu="${e.id}" aria-expanded="${_snoozeMenu === e.id}" title="${escAttr(t('notif.snooze'))}" aria-label="${escAttr(t('notif.snooze'))}">${I_SNOOZE}</button>`}
            <button type="button" class="nc-ibtn nc-del" data-del="${e.id}" title="${escAttr(t('notif.remove'))}" aria-label="${escAttr(t('notif.remove'))}">${I_CLOSE}</button>
        </span>
    </li>`;
}

function panelHTML(): string {
    const all = load();
    const now = Date.now();
    const list = visibleEntries();
    const snoozed = all.filter((e) => N.isSnoozed(e, now));
    const prefs = readNotifPrefs();
    const quiet = N.isQuiet(prefs, new Date());
    const byClock = !prefs.dnd && quiet;
    const TYPES: ('all' | NotifEntry['type'])[] = ['all', 'error', 'warning', 'success', 'info'];
    const tools = all.length ? `
        <div class="nc-tools">
            <input type="search" class="input nc-search" id="nc-search" autocomplete="off"
                placeholder="${escAttr(t('notif.search'))}" aria-label="${escAttr(t('notif.search'))}"
                value="${escAttr(_q)}">
            <div class="nc-chips" role="group" aria-label="${escAttr(t('notif.filter'))}">
                ${TYPES.map((k) => `<button type="button" class="nc-chip${_type === k ? ' on' : ''}" data-type="${k}"
                    aria-pressed="${_type === k}">${escHtml(t('notif.f_' + k))}</button>`).join('')}
            </div>
        </div>` : '';

    const groups = N.groupEntries(list, now);
    const body = list.length
        ? groups.map((g) => {
            const folded = _folded.has(g.group);
            return `<section class="nc-group" data-group="${g.group}">
                <div class="nc-group-head">
                    <button type="button" class="nc-group-toggle" data-fold="${g.group}" aria-expanded="${!folded}">
                        <span class="nc-group-chev" aria-hidden="true">${svg('<path d="m9 18 6-6-6-6"/>')}</span>
                        <span class="nc-group-name">${escHtml(groupLabel(g.group))}</span>
                        <span class="nc-group-n">${g.entries.length}${g.unread ? ` · ${escHtml(t('notif.unreadN', { n: String(g.unread) }))}` : ''}</span>
                    </button>
                    ${g.unread ? `<button type="button" class="nc-act" data-read-group="${g.group}">${escHtml(t('notif.markRead'))}</button>` : ''}
                </div>
                ${folded ? '' : `<ul class="nc-list" role="list">${g.entries.map((e) => entryHTML(e)).join('')}</ul>`}
            </section>`;
        }).join('')
        : all.length && all.length > snoozed.length
        ? `<div class="nc-empty"><p>${escHtml(t('notif.noMatch'))}</p><p class="nc-empty-sub">${escHtml(t('notif.noMatchSub'))}</p></div>`
        : `<div class="nc-empty">
               ${svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>')}
               <p>${escHtml(t('notif.empty'))}</p>
               <p class="nc-empty-sub">${escHtml(t('notif.emptySub'))}</p>
           </div>`;

    const snoozedHTML = snoozed.length ? `<section class="nc-group nc-snoozed">
            <div class="nc-group-head">
                <button type="button" class="nc-group-toggle" data-show-snoozed aria-expanded="${_showSnoozed}">
                    <span class="nc-group-chev" aria-hidden="true">${svg('<path d="m9 18 6-6-6-6"/>')}</span>
                    <span class="nc-group-name">${escHtml(t('notif.snoozedTitle'))}</span>
                    <span class="nc-group-n">${snoozed.length}</span>
                </button>
            </div>
            ${_showSnoozed ? `<ul class="nc-list" role="list">${snoozed.map((e) => entryHTML(e, true)).join('')}</ul>` : ''}
        </section>` : '';

    return `
        <div class="nc-head">
            <strong id="nc-title">${escHtml(t('notif.title'))}</strong>
            <div class="nc-head-actions">
                <button type="button" class="nc-act nc-dnd${quiet ? ' on' : ''}" id="nc-dnd" aria-pressed="${prefs.dnd}"
                    title="${escAttr(byClock ? t('notif.dndQuietHours', { to: prefs.quiet.to }) : t('notif.dndTip'))}">${I_DND}<span>${escHtml(quiet ? t('notif.dndOn') : t('notif.dnd'))}</span></button>
                <button type="button" class="nc-act" id="nc-read-all"${list.some((e) => !e.read) ? '' : ' disabled'}>${escHtml(t('notif.markAllRead'))}</button>
                <button type="button" class="nc-act nc-act-danger" id="nc-clear"${all.length ? '' : ' disabled'}>${escHtml(t('notif.clearAll'))}</button>
            </div>
        </div>
        ${tools}
        <div class="nc-scroll">${body}${snoozedHTML}</div>
        <div class="nc-foot">
            <span>${escHtml(t('notif.keysHint'))}</span>
            <button type="button" class="nc-act" id="nc-settings">${I_GEAR}<span>${escHtml(t('notif.settings'))}</span></button>
        </div>`;
}

export function repaintPanel(): void {
    if (!_panel) return;
    const active = document.activeElement as HTMLElement | null;
    const focusId = active && _panel.contains(active) ? active.closest<HTMLElement>('.nc-item')?.dataset.id : undefined;
    const focusSel = active && _panel.contains(active) && active.id ? `#${active.id}` : null;
    const scroller = _panel.querySelector('.nc-scroll');
    const top = scroller ? scroller.scrollTop : 0;
    _panel.innerHTML = panelHTML();
    _wirePanel();
    const sc = _panel.querySelector('.nc-scroll');
    if (sc) sc.scrollTop = top;
    // Keep the keyboard where it was: a repaint must not throw the focus back to <body>.
    if (focusSel) (_panel.querySelector(focusSel) as HTMLElement | null)?.focus();
    else if (focusId) {
        const li = _panel.querySelector<HTMLElement>(`.nc-item[data-id="${CSS.escape(focusId)}"]`);
        (li || items()[0])?.focus();
    }
}

function items(): HTMLElement[] {
    return _panel ? [..._panel.querySelectorAll<HTMLElement>('.nc-item')] : [];
}

function _wirePanel(): void {
    if (!_panel) return;
    const search = _panel.querySelector('#nc-search') as HTMLInputElement | null;
    search?.addEventListener('input', () => {
        _q = search.value;
        repaintPanel();
        const again = _panel?.querySelector('#nc-search') as HTMLInputElement | null;
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
    _panel.querySelectorAll<HTMLElement>('[data-type]').forEach((b) => {
        b.addEventListener('click', () => { _type = b.dataset.type as any; repaintPanel(); });
    });
    _panel.querySelector('#nc-read-all')?.addEventListener('click', markAllRead);
    _panel.querySelector('#nc-clear')?.addEventListener('click', clearAll);
    _panel.querySelector('#nc-settings')?.addEventListener('click', () => { closePanel(); openNotifSettings(); });
    _panel.querySelector('#nc-dnd')?.addEventListener('click', () => {
        const p = readNotifPrefs();
        p.dnd = !p.dnd;
        writeNotifPrefs(p);
        (_panel?.querySelector('#nc-dnd') as HTMLElement | null)?.focus();
    });

    // Long entries expand on click; marked `clipped` only when the box really is shorter than
    // its content, so the hint never promises something that does not happen.
    _panel.querySelectorAll<HTMLElement>('.nc-item').forEach((li) => {
        const msg = li.querySelector('.nc-msg') as HTMLElement | null;
        if (msg && msg.scrollHeight > msg.clientHeight + 1) {
            li.classList.add('clipped');
            li.querySelector('.nc-body')?.setAttribute('data-more', t('notif.more'));
        }
    });
    if (!items().some((el) => el.tabIndex === 0)) { const f = items()[0]; if (f) f.tabIndex = 0; }
}

/** One delegated click handler for everything inside the panel (assigned once per panel). */
function onPanelClick(ev: MouseEvent): void {
    const el = ev.target as HTMLElement;
    const btn = el.closest<HTMLElement>('button');
    const find = (id?: string) => (id ? load().find((x) => x.id === id) : undefined);
    if (btn?.dataset.del) { ev.stopPropagation(); removeEntry(btn.dataset.del); return; }
    if (btn?.dataset.open) { const e = find(btn.dataset.open); if (e) runAction(e); return; }
    if (btn?.dataset.wake) { wakeEntry(btn.dataset.wake); return; }
    if (btn?.dataset.snoozeMenu) {
        const id = btn.dataset.snoozeMenu;
        _snoozeMenu = _snoozeMenu === id ? null : id;
        repaintPanel();
        (_panel?.querySelector(`[data-snooze][data-id="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus();
        return;
    }
    if (btn?.dataset.snooze && btn.dataset.id) { _snoozeMenu = null; snoozeEntry(btn.dataset.id, btn.dataset.snooze as any); return; }
    if (btn?.dataset.fold) { const g = btn.dataset.fold; if (_folded.has(g)) _folded.delete(g); else _folded.add(g); repaintPanel(); return; }
    if (btn?.hasAttribute('data-show-snoozed')) { _showSnoozed = !_showSnoozed; repaintPanel(); return; }
    if (btn?.dataset.readGroup) {
        const g = btn.dataset.readGroup;
        visibleEntries().filter((e) => N.groupOf(e.source) === g).forEach((e) => { e.read = true; });
        save(); repaintPanel(); return;
    }
    if (btn) return;
    const li = el.closest<HTMLElement>('.nc-item');
    if (li) { li.classList.toggle('expanded'); li.focus(); }
}

/** ↑/↓ Home/End move between entries; Enter opens (or expands); Delete dismisses; S snoozes. */
function onPanelKey(ev: KeyboardEvent): void {
    const li = (ev.target as HTMLElement).closest?.('.nc-item') as HTMLElement | null;
    const list = items();
    const i = li ? list.indexOf(li) : -1;
    const focusAt = (n: number) => {
        const target = list[Math.max(0, Math.min(list.length - 1, n))];
        if (!target) return;
        list.forEach((x) => { x.tabIndex = -1; });
        target.tabIndex = 0;
        target.focus();
        ev.preventDefault();
    };
    if (ev.key === 'ArrowDown') { if (i < 0 && (ev.target as HTMLElement).id === 'nc-search') focusAt(0); else if (i >= 0) focusAt(i + 1); return; }
    if (ev.key === 'ArrowUp' && i >= 0) { focusAt(i - 1); return; }
    if (ev.key === 'Home' && i >= 0) { focusAt(0); return; }
    if (ev.key === 'End' && i >= 0) { focusAt(list.length - 1); return; }
    if (!li || ev.target !== li) return;
    const id = li.dataset.id || '';
    const e = load().find((x) => x.id === id);
    if (!e) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (!runAction(e)) li.classList.toggle('expanded'); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        removeEntry(id);
        const after = items();
        (after[Math.min(i, after.length - 1)] || _panel?.querySelector<HTMLElement>('#nc-search') || _panel)?.focus();
        return;
    }
    if (ev.key === 's' || ev.key === 'S') {
        ev.preventDefault();
        snoozeEntry(id, '1h');
        const after = items();
        after[Math.min(i, after.length - 1)]?.focus();
    }
}

function closePanel(): void {
    if (!_panel) return;
    const hadFocus = _panel.contains(document.activeElement);
    _panel.remove();
    _panel = null;
    _snoozeMenu = null;
    const bell = document.getElementById('btn-notif-center');
    bell?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', _outside, true);
    document.removeEventListener('keydown', _esc, true);
    if (hadFocus) bell?.focus();
}

const _outside = (e: MouseEvent) => {
    if (!_panel) return;
    // composedPath(): still "inside" when the target sits in a shadow root or was replaced by
    // a repaint between the event firing and this handler running.
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const bell = document.getElementById('btn-notif-center');
    if (path.includes(_panel) || (bell && path.includes(bell))) return;
    const target = e.target as Node;
    if (_panel.contains(target) || bell?.contains(target)) return;
    closePanel();
};
const _esc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (_snoozeMenu) { _snoozeMenu = null; repaintPanel(); return; }
    closePanel();
};

export function toggleNotifCenter(): void {
    if (_panel) { closePanel(); return; }
    ensureCss();
    _q = ''; _type = 'all';   // a leftover filter reads as an empty history
    const btn = document.getElementById('btn-notif-center');
    if (!btn) return;
    wake();

    _panel = document.createElement('div');
    _panel.className = 'nc-panel';
    _panel.addEventListener('mousedown', (e) => e.stopPropagation());
    _panel.addEventListener('click', onPanelClick);
    _panel.addEventListener('keydown', onPanelKey);
    _panel.setAttribute('role', 'dialog');
    _panel.setAttribute('aria-labelledby', 'nc-title');
    document.body.appendChild(_panel);
    repaintPanel();

    // Opens UPWARD from the sidebar footer, in viewport coordinates on <body> (the footer
    // clips its overflow).
    const r = btn.getBoundingClientRect();
    _panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - _panel.offsetWidth - 8))}px`;
    _panel.style.bottom = `${Math.max(8, window.innerHeight - r.top + 8)}px`;

    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', _outside, true);
    document.addEventListener('keydown', _esc, true);

    // Keyboard in: the first entry, or the search field when the list is empty.
    (items()[0] || _panel.querySelector<HTMLElement>('#nc-search') || _panel.querySelector<HTMLElement>('#nc-dnd'))?.focus();

    // Opening it is the acknowledgement: the badge clears, but entries keep their unread dot
    // until the next paint so you can still see which ones arrived while you were away.
    const had = load().filter((e) => !e.read && !N.isSnoozed(e, Date.now()));
    if (had.length) { setTimeout(() => { had.forEach((e) => { e.read = true; }); save(); }, 900); }
}

/** Snoozed entries whose time came: back in the list, unread. */
function wake(): void {
    const r = N.wakeSnoozed(load(), Date.now());
    if (r.woke) { _cache = r.list; save(); if (_panel) repaintPanel(); }
}

// ── Finished background jobs ─────────────────────────────────────────────────────────────
//
// A long job (an install, a sync, a scan) that ends while BMM is not in front is exactly what a
// system notification is for. Spoken through toast() like everything else, under « Activity »,
// only for jobs that ran long enough to have been walked away from.

const LONG_JOB_MS = 15_000;
function watchActivity(): void {
    void import('../core/activity.js').then((A) => {
        const seen = new Set<string>(A.activityHistory().map((e) => e.id));
        A.subscribeActivity(() => {
            for (const e of A.activityHistory()) {
                if (seen.has(e.id)) continue;
                seen.add(e.id);
                const took = (e.endedAt || Date.now()) - e.startedAt;
                if (e.state === 'cancelled' || took < LONG_JOB_MS || appFocused()) continue;
                const msg = e.state === 'error'
                    ? t('notif.jobFailed', { job: e.title, err: e.error || '' })
                    : t('notif.jobDone', { job: e.title });
                (window as any).toast?.(msg, e.state === 'error' ? 'error' : 'success', 5000, '', 'Activity',
                    { key: `activity:${e.id}`, action: { kind: 'activity' } });
            }
        });
    }).catch(() => { /* no activity centre */ });
}

export function initNotificationCenter(): void {
    ensureCss();   // the Settings controls use it too, not only the panel
    builtInActions();
    document.getElementById('btn-notif-center')?.addEventListener('click', toggleNotifCenter);
    _paintBadge();
    wake();
    // Snoozes run out and quiet hours start and end while the app is open.
    setInterval(() => { wake(); _paintBadge(); }, 60_000);
    watchActivity();
    // Flush a pending write before the window goes: the notifications lost to the debounce
    // would be the last few of the session, precisely the unread ones.
    window.addEventListener('pagehide', () => { if (_saveTimer) { clearTimeout(_saveTimer); persistNow(); } });
}
