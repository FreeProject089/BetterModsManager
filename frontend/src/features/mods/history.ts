// ── History ─────────────────────────────────────────────────────────────────────────────────
// One timeline of what changed in BMM, opened from the library (« History ») and the palette.
//
// Three sources, merged and sorted newest first:
//   mods       the active profile's log on disk (get_activity_history: enabled, disabled,
//              deleted, edited with the fields before and after);
//   journal    profiles, settings, repos and updates (core/history-journal.ts);
//   jobs       what the activity centre saw end (core/activity.ts: syncs, downloads, exports…),
//              except mod activations, which the mods' own log already tells one by one.
//
// The window groups the entries by day, filters them by type and by a search, and opens one to
// show what changed (before → after). Undo where the backend can do it: an edit of a mod's
// details is written back (update_mod_meta), an enable or a disable is reversed through the
// activation queue, a settings change is restored (get_settings → update_settings). Export
// writes the entries shown as JSON or CSV.
//
// Markup: #modal-history in index.html (the house dialog shell); the content is drawn here.

import { invoke, saveFile, addInvokeListener } from '../../core/api.js';
import { t, getLang } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { uiIcon } from '../../ui/icons.js';
import { appState } from '../../core/state.js';
import { activityHistory, clearActivityHistory, type ActivityEntry } from '../../core/activity.js';
import { runActivationJob } from '../../core/activation-jobs.js';
import {
    journalEntries, clearJournal, pruneJournal, subscribeJournal, initHistoryJournal,
    type HistoryType, type HistoryChange, type JournalEntry,
} from '../../core/history-journal.js';

/** ui/app.ts's toast, through the window: importing app.ts from here closes a module cycle
 *  (app → profiles → mods/settings → this → app). */
const toast = (message: string, type = 'info', ms?: number): void => { (window as any).toast?.(message, type, ms); };

type IconName = Parameters<typeof uiIcon>[0];
type Undo = 'mod-meta' | 'mod-enable' | 'mod-disable' | 'settings';

interface ModEvent { mod_id: string; mod_name: string; action: string; timestamp: string; details?: string | null }

export interface HxEntry {
    id: string;
    at: number;
    type: HistoryType;
    icon: IconName;
    tone: 'ok' | 'danger' | 'warn' | 'accent' | 'muted';
    /** The sentence, already translated. */
    text: string;
    detail?: string;
    changes?: HistoryChange[];
    undo?: Undo;
    modId?: string;
    state?: 'done' | 'error' | 'cancelled';
}

const CSS_ID = 'history-css';
const TYPES: Array<{ id: HistoryType | 'all'; key: string; icon: IconName }> = [
    { id: 'all', key: 'history.type.all', icon: 'history' },
    { id: 'mods', key: 'history.type.mods', icon: 'mod' },
    { id: 'profiles', key: 'history.type.profiles', icon: 'profile' },
    { id: 'settings', key: 'history.type.settings', icon: 'settings' },
    { id: 'updates', key: 'history.type.updates', icon: 'download' },
    { id: 'repos', key: 'history.type.repos', icon: 'server' },
    { id: 'other', key: 'history.type.other', icon: 'activity' },
];

let _mods: ModEvent[] = [];
let _profileName = '';
let _entries: HxEntry[] = [];
let _type: HistoryType | 'all' = 'all';
let _query = '';
let _open = new Set<string>();
let _clearArmed = 0;
let _wired = false;

function ensureCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/history.css';
    document.head.appendChild(link);
}

const modal = () => document.getElementById('modal-history');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

// ── Turning each source into entries ─────────────────────────────────────────────────────

function parseChanges(details: string | null | undefined): HistoryChange[] | null {
    if (!details) return null;
    try {
        const v = JSON.parse(details);
        return Array.isArray(v) && v.every((c) => c && typeof c.field === 'string') ? v : null;
    } catch { return null; }
}

export function fromModEvent(e: ModEvent, i: number): HxEntry {
    const at = Date.parse(e.timestamp) || 0;
    const name = e.mod_name || e.mod_id;
    const base = { id: `m${i}-${at}`, at, type: 'mods' as const, modId: e.mod_id };
    if (e.action.startsWith('Enabled')) {
        const deps = e.action !== 'Enabled';
        return { ...base, icon: 'power', tone: 'ok', text: t(deps ? 'history.s.enabledDeps' : 'history.s.enabled', { name }), undo: 'mod-disable' };
    }
    if (e.action === 'Disabled') return { ...base, icon: 'power', tone: 'muted', text: t('history.s.disabled', { name }), undo: 'mod-enable' };
    if (e.action === 'Deleted') return { ...base, icon: 'delete', tone: 'danger', text: t('history.s.deleted', { name }) };
    if (e.action === 'Modified') {
        const changes = parseChanges(e.details);
        if (changes?.length) {
            return { ...base, icon: 'edit', tone: 'accent', changes, undo: 'mod-meta',
                text: changes.length === 1 ? t('history.s.editedOne', { name, field: fieldLabel(changes[0].field) }) : t('history.s.edited', { name, n: String(changes.length) }) };
        }
        return { ...base, icon: 'edit', tone: 'accent', text: t('history.s.editedPlain', { name }), detail: e.details && !/laya_task/.test(e.details) ? e.details : (e.details ? t('history.s.byLaya') : undefined) };
    }
    return { ...base, icon: 'mod', tone: 'muted', text: `${e.action} · ${name}`, detail: e.details || undefined };
}

const JOURNAL_ICON: Record<string, IconName> = {
    'settings.change': 'settings', 'profile.switch': 'profile', 'profile.create': 'add', 'profile.edit': 'edit', 'profile.delete': 'delete',
    'repo.follow': 'bell', 'repo.followEdit': 'sliders', 'repo.unfollow': 'remove', 'source.add': 'link', 'source.remove': 'remove',
    'update.check': 'refresh', 'update.available': 'download', 'update.failed': 'warning', 'update.installed': 'success',
};

/** Each key written out in full, so a search for it finds where it is used. */
const JOURNAL_TEXT: Record<string, string> = {
    'profile.switch': 'history.s.profileSwitch', 'profile.create': 'history.s.profileCreate', 'profile.edit': 'history.s.profileEdit', 'profile.delete': 'history.s.profileDelete',
    'repo.follow': 'history.s.repoFollow', 'repo.followEdit': 'history.s.repoFollowEdit', 'repo.unfollow': 'history.s.repoUnfollow',
    'source.add': 'history.s.sourceAdd', 'source.remove': 'history.s.sourceRemove',
    'update.check': 'history.s.updateCheck', 'update.available': 'history.s.updateAvailable', 'update.failed': 'history.s.updateFailed', 'update.installed': 'history.s.updateInstalled',
};
export function fromJournal(e: JournalEntry): HxEntry {
    const icon = JOURNAL_ICON[e.action] || 'activity';
    const tone: HxEntry['tone'] = /delete|remove|unfollow|failed/.test(e.action) ? 'danger' : /installed|create|follow$|add$/.test(e.action) ? 'ok' : /available/.test(e.action) ? 'warn' : 'accent';
    let text: string;
    if (e.action === 'settings.change') {
        const n = e.changes?.length || 0;
        text = n === 1 ? t('history.s.settingOne', { field: fieldLabel(e.changes![0].field) }) : t('history.s.settings', { n: String(n) });
    } else {
        const key = JOURNAL_TEXT[e.action];
        text = key ? t(key, { name: e.subject, version: e.subject }) : `${e.action} · ${e.subject}`;
    }
    return { id: e.id, at: e.at, type: e.type, icon, tone, text, detail: e.detail, changes: e.changes, undo: e.action === 'settings.change' && e.changes?.length ? 'settings' : undefined };
}

function jobType(e: ActivityEntry): HistoryType {
    if (e.kind === 'sync' || e.kind === 'download') return 'repos';
    return 'other';
}

export function fromJob(e: ActivityEntry): HxEntry {
    const state = e.state === 'running' ? 'done' : e.state;
    const secs = e.endedAt && e.startedAt ? Math.max(0, Math.round((e.endedAt - e.startedAt) / 1000)) : null;
    const bits = [e.detail, e.error, secs !== null ? t('history.took', { s: String(secs) }) : ''].filter(Boolean);
    return {
        id: `a${e.id}`, at: e.endedAt || e.startedAt, type: jobType(e), state,
        icon: state === 'error' ? 'error' : state === 'cancelled' ? 'stop' : 'activity',
        tone: state === 'error' ? 'danger' : state === 'cancelled' ? 'muted' : 'ok',
        text: e.title, detail: bits.join(' · ') || undefined,
    };
}

function fieldLabel(f: string): string {
    const k = `detail.${f}`;
    const tr = t(k);
    if (tr !== k) return tr;
    return f.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
}

function collect(): HxEntry[] {
    const all: HxEntry[] = [
        ..._mods.map(fromModEvent),
        ...journalEntries().map(fromJournal),
        ...activityHistory().filter((e) => e.kind !== 'activation' && e.state !== 'running').map(fromJob),
    ];
    return all.sort((a, b) => b.at - a.at);
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────

function matches(e: HxEntry): boolean {
    if (_type !== 'all' && e.type !== _type) return false;
    if (!_query) return true;
    const hay = [e.text, e.detail || '', ...(e.changes || []).flatMap((c) => [c.field, show(c.old), show(c.new)])].join(' ').toLowerCase();
    return hay.includes(_query);
}

function show(v: unknown): string {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && !v.length) return '';
    return JSON.stringify(v, null, 2);
}

function dayKey(at: number): string { const d = new Date(at); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(at: number): string {
    const d = new Date(at), now = new Date();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (dayKey(at) === dayKey(now.getTime())) return t('history.today');
    if (dayKey(at) === dayKey(y.getTime())) return t('history.yesterday');
    return d.toLocaleDateString(getLang(), { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
const timeOf = (at: number) => new Date(at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' });

/** A mod's tags and dependencies are ids: show their names. */
function readable(field: string, v: unknown): string {
    if (Array.isArray(v)) {
        if (field === 'tags') return v.map((id) => (appState.get('userTags') as any[] || []).find((x) => x.id === id)?.name || id).join(', ');
        if (field === 'dependencies') return v.map((id) => (appState.get('allMods') as any[] || []).find((m) => m.id === id)?.name || id).join(', ');
    }
    return show(v);
}

function changesHtml(changes: HistoryChange[]): string {
    return `<div class="hx-diff" role="table" aria-label="${escAttr(t('history.changes'))}">
        <div class="hx-diff-row hx-diff-head" role="row"><span role="columnheader">${escHtml(t('history.field'))}</span><span role="columnheader">${escHtml(t('history.before'))}</span><span role="columnheader">${escHtml(t('history.after'))}</span></div>
        ${changes.map((c) => {
            const a = readable(c.field, c.old), b = readable(c.field, c.new);
            return `<div class="hx-diff-row" role="row">
                <span class="hx-diff-f" role="cell">${escHtml(fieldLabel(c.field))}</span>
                <span class="hx-diff-old${a ? '' : ' is-empty'}" role="cell">${escHtml(a || t('history.empty2'))}</span>
                <span class="hx-diff-new${b ? '' : ' is-empty'}" role="cell">${escHtml(b || t('history.empty2'))}</span>
            </div>`;
        }).join('')}
    </div>`;
}

function undoLabel(u: Undo): string {
    return u === 'mod-meta' ? t('history.undo.meta') : u === 'mod-enable' ? t('history.undo.enable') : u === 'mod-disable' ? t('history.undo.disable') : t('history.undo.settings');
}

function entryHtml(e: HxEntry): string {
    const open = _open.has(e.id);
    const expandable = !!(e.detail || e.changes?.length || e.undo);
    return `<li class="hx-item is-${e.tone}${open ? ' is-open' : ''}" data-id="${escAttr(e.id)}">
        <span class="hx-ic" aria-hidden="true">${uiIcon(e.icon, 14)}</span>
        <div class="hx-main">
            ${expandable
                ? `<button type="button" class="hx-line" data-hx="toggle" aria-expanded="${open}">`
                : '<div class="hx-line">'}
                <span class="hx-text">${escHtml(e.text)}</span>
                ${e.state === 'error' ? `<span class="hx-state is-danger">${escHtml(t('history.failed'))}</span>` : e.state === 'cancelled' ? `<span class="hx-state">${escHtml(t('history.cancelled'))}</span>` : ''}
                <time class="hx-time" datetime="${escAttr(new Date(e.at).toISOString())}" title="${escAttr(new Date(e.at).toLocaleString(getLang()))}">${escHtml(timeOf(e.at))}</time>
                ${expandable ? `<span class="hx-chev" aria-hidden="true">${uiIcon('chevron-down', 14)}</span>` : ''}
            ${expandable ? '</button>' : '</div>'}
            ${open ? `<div class="hx-detail">
                ${e.detail ? `<p class="hx-detail-t">${escHtml(e.detail)}</p>` : ''}
                ${e.changes?.length ? changesHtml(e.changes) : ''}
                ${e.undo ? `<div class="hx-actions"><button type="button" class="btn btn-secondary btn-sm" data-hx="undo">${uiIcon('undo', 14)}<span>${escHtml(undoLabel(e.undo))}</span></button></div>` : ''}
            </div>` : ''}
        </div>
    </li>`;
}

function render(): void {
    const list = $('history-list');
    const types = $('hx-types');
    if (!list) return;
    const counts: Record<string, number> = { all: 0 };
    for (const e of _entries) {
        const q = !_query || [e.text, e.detail || ''].join(' ').toLowerCase().includes(_query) || (e.changes || []).some((c) => `${c.field} ${show(c.old)} ${show(c.new)}`.toLowerCase().includes(_query));
        if (!q) continue;
        counts.all++;
        counts[e.type] = (counts[e.type] || 0) + 1;
    }
    if (types) {
        types.innerHTML = TYPES.map((x) => `<button type="button" class="hx-type" data-hx="type" data-type="${x.id}" aria-pressed="${x.id === _type}"${x.id !== 'all' && !counts[x.id] ? ' data-zero' : ''}>
            ${uiIcon(x.icon, 14)}<span>${escHtml(t(x.key))}</span><span class="hx-type-n">${counts[x.id] || 0}</span></button>`).join('');
    }
    const shown = _entries.filter(matches);
    if (!shown.length) {
        list.innerHTML = `<div class="bms-empty"><div class="bms-empty-ic" aria-hidden="true">${uiIcon('history', 24)}</div>
            <div class="bms-empty-t">${escHtml(_entries.length ? t('history.noMatch') : t('history.emptyAll'))}</div>
            ${_entries.length ? `<button type="button" class="btn btn-ghost btn-sm" data-hx="reset">${escHtml(t('history.showAll'))}</button>` : `<p class="hx-hint">${escHtml(t('history.emptyHint'))}</p>`}
        </div>`;
        return;
    }
    const parts: string[] = [];
    let day = '';
    for (const e of shown.slice(0, 500)) {
        const k = dayKey(e.at);
        if (k !== day) {
            if (day) parts.push('</ol></section>');
            day = k;
            parts.push(`<section class="hx-day"><h3 class="hx-day-h">${escHtml(dayLabel(e.at))}</h3><ol class="hx-items">`);
        }
        parts.push(entryHtml(e));
    }
    parts.push('</ol></section>');
    list.innerHTML = parts.join('');
}

function renderFoot(): void {
    const clear = $('hx-clear');
    if (clear) clear.textContent = _clearArmed ? t('history.clearConfirm') : t('history.clearAll2');
    clear?.classList.toggle('is-armed', !!_clearArmed);
}

// ── Open / load ──────────────────────────────────────────────────────────────────────────

async function load(): Promise<void> {
    _mods = [];
    _profileName = '';
    const activeId = await invoke('get_active_profile_id').catch(() => null);
    if (activeId) {
        try { _mods = (await invoke('get_activity_history', { profileId: activeId })) || []; } catch (err) { toast(`${t('history.error')} : ${err}`, 'error'); }
        try {
            const profs = await invoke('get_profiles');
            _profileName = (Array.isArray(profs) ? profs.find((p: any) => p.id === activeId)?.name : '') || '';
        } catch { /* the subtitle just goes without the name */ }
    }
    try {
        const s: any = await invoke('get_settings');
        const days = Number(s?.history_retention_days ?? 30);
        pruneJournal(days);
        syncRetention(days);
    } catch { /* keep the select as it is */ }
    _entries = collect();
}

function syncRetention(days: number): void {
    const sel = $<HTMLSelectElement>('history-retention');
    const custom = $<HTMLInputElement>('history-retention-custom-days');
    if (!sel) return;
    const preset = ['0', '7', '30', '90'].includes(String(days));
    sel.value = preset ? String(days) : 'custom';
    if (custom) { custom.hidden = preset; if (!preset) custom.value = String(days); }
}

export async function openHistory(type: HistoryType | 'all' = 'all'): Promise<void> {
    ensureCss();
    wire();
    const m = modal();
    if (!m) return;
    _type = type;
    _open = new Set();
    await load();
    const sub = $('hx-sub');
    if (sub) sub.textContent = _profileName ? t('history.subProfile', { name: _profileName }) : t('history.subNoProfile');
    render();
    renderFoot();
    m.classList.add('open');
    requestAnimationFrame(() => $<HTMLInputElement>('hx-search')?.focus({ preventScroll: true }));
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────

async function undo(e: HxEntry, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
        if (e.undo === 'mod-meta' && e.modId && e.changes) {
            const mods = (appState.get('allMods') as any[]) || [];
            const mod = mods.find((m) => m.id === e.modId);
            if (!mod) { toast(t('history.modNotFound'), 'error'); return; }
            const tags = (appState.get('userTags') as any[]) || [];
            const next = { ...mod };
            for (const c of e.changes) {
                if (c.field === 'dependencies' && Array.isArray(c.old)) next.dependencies = c.old.filter((id) => mods.some((m) => m.id === id));
                else if (c.field === 'tags' && Array.isArray(c.old)) next.tags = c.old.filter((id) => tags.some((x) => x.id === id));
                else next[c.field] = c.old;
            }
            await invoke('update_mod_meta', { modId: mod.id, payload: {
                name: next.name, version: next.version, author: next.author, description: next.description,
                tags: next.tags, downloadLinks: next.download_links, dependencies: next.dependencies,
            } });
            Object.assign(mod, next);
            appState.set('allMods', [...mods]);
            toast(t('history.revertSuccess'), 'success');
        } else if ((e.undo === 'mod-enable' || e.undo === 'mod-disable') && e.modId) {
            const mods = (appState.get('allMods') as any[]) || [];
            const mod = mods.find((m) => m.id === e.modId);
            if (!mod) { toast(t('history.modNotFound'), 'error'); return; }
            runActivationJob({ mods: [{ id: mod.id, name: mod.name }], mode: e.undo === 'mod-enable' ? 'enable' : 'disable', source: 'history' });
        } else if (e.undo === 'settings' && e.changes) {
            const s: any = await invoke('get_settings');
            for (const c of e.changes) s[c.field] = c.old;
            await invoke('update_settings', { settings: s });
            toast(t('history.undo.settingsDone'), 'success');
        }
        await load();
        render();
    } catch (err) {
        toast(t('history.revertError', { error: String(err) }), 'error');
    } finally {
        btn.disabled = false;
    }
}

function csvCell(v: unknown): string {
    const s = typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportAs(kind: 'json' | 'csv'): Promise<void> {
    const shown = _entries.filter(matches);
    if (!shown.length) { toast(t('history.nothingToExport'), 'info'); return; }
    const rows = shown.map((e) => ({ time: new Date(e.at).toISOString(), type: e.type, text: e.text, detail: e.detail || '', state: e.state || '', changes: e.changes || [] }));
    const content = kind === 'json'
        ? JSON.stringify({ exported: new Date().toISOString(), profile: _profileName || null, entries: rows }, null, 2)
        : ['time,type,text,detail,state,changes', ...rows.map((r) => [r.time, r.type, r.text, r.detail, r.state, r.changes.length ? r.changes : ''].map(csvCell).join(','))].join('\n');
    const name = `bmm-history-${new Date().toISOString().slice(0, 10)}.${kind}`;
    const path = await saveFile({ defaultPath: name, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] }).catch(() => null);
    if (path) {
        try { await invoke('write_text_file', { path, content }); toast(t('history.exported', { n: String(rows.length) }), 'success'); }
        catch (err) { toast(String(err), 'error'); }
        return;
    }
    if ((window as any).__TAURI__) return;   // the dialog was cancelled
    // The browser preview has no save dialog: a download does the same job.
    const url = URL.createObjectURL(new Blob([content], { type: kind === 'json' ? 'application/json' : 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function clearAll(): Promise<void> {
    if (!_clearArmed) {
        _clearArmed = window.setTimeout(() => { _clearArmed = 0; renderFoot(); }, 3500);
        renderFoot();
        return;
    }
    clearTimeout(_clearArmed);
    _clearArmed = 0;
    const activeId = await invoke('get_active_profile_id').catch(() => null);
    try {
        if (activeId) await invoke('clear_activity_history', { profileId: activeId });
        clearJournal();
        clearActivityHistory();
        _open.clear();
        await load();
        render();
        toast(t('history.cleared'), 'success');
    } catch (err) {
        toast(`${t('common.error')}: ${err}`, 'error');
    }
    renderFoot();
}

async function saveRetention(days: number): Promise<void> {
    try {
        const s: any = await invoke('get_settings');
        s.history_retention_days = days;
        await invoke('update_settings', { settings: s });
        pruneJournal(days);
        toast(t('history.retentionSaved'), 'success');
    } catch (err) {
        console.error('Failed to save retention settings', err);
    }
}

function wire(): void {
    if (_wired) return;
    const m = modal();
    if (!m) return;
    _wired = true;
    m.addEventListener('click', (ev) => {
        const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-hx]');
        if (!el) return;
        const item = el.closest<HTMLElement>('.hx-item');
        const entry = item ? _entries.find((x) => x.id === item.dataset.id) : undefined;
        switch (el.dataset.hx) {
            case 'type': _type = (el.dataset.type as HistoryType | 'all') || 'all'; render(); break;
            case 'reset': {
                _type = 'all'; _query = '';
                const box = $<HTMLInputElement>('hx-search');
                if (box) box.value = '';
                render();
                break;
            }
            case 'toggle':
                if (!entry) break;
                if (_open.has(entry.id)) _open.delete(entry.id); else _open.add(entry.id);
                item!.outerHTML = entryHtml(entry);
                break;
            case 'undo': if (entry) void undo(entry, el as HTMLButtonElement); break;
            case 'export-json': void exportAs('json'); break;
            case 'export-csv': void exportAs('csv'); break;
            case 'clear': void clearAll(); break;
        }
    });
    $('hx-search')?.addEventListener('input', (ev) => { _query = (ev.target as HTMLInputElement).value.toLowerCase().trim(); render(); });
    const sel = $<HTMLSelectElement>('history-retention');
    const custom = $<HTMLInputElement>('history-retention-custom-days');
    sel?.addEventListener('change', () => {
        if (sel.value === 'custom') { if (custom) { custom.hidden = false; custom.focus(); } return; }
        if (custom) custom.hidden = true;
        void saveRetention(parseInt(sel.value, 10) || 0);
    });
    custom?.addEventListener('change', () => {
        let d = parseInt(custom.value, 10);
        if (!Number.isFinite(d) || d < 1) { d = 1; custom.value = '1'; }
        void saveRetention(d);
    });
    // Open: what changes while it is open shows up.
    subscribeJournal(() => { if (m.classList.contains('open')) { _entries = collect(); render(); } });
}

/** The library button and the palette. */
export function initHistory(): void {
    initHistoryJournal({ addInvokeListener, invoke: (c, a) => invoke(c, a || {}, { quiet: true }) });
    const btn = document.getElementById('btn-show-history');
    if (btn && !(btn as any)._hxWired) {
        (btn as any)._hxWired = true;
        btn.addEventListener('click', () => { void openHistory(); });
    }
    (window as any).openHistory = (type?: HistoryType | 'all') => openHistory(type || 'all');
}
