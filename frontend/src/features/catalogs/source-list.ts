// The catalogue source list: one component, two places.
//
//   · App catalogue → Sources tab (kinds: app)
//   · Settings → Catalogue index → « Catalogs you follow » (every kind)
//
// Each row: name, address, kind, official / partner / yours, signature state, last refresh,
// item count, status, an on/off switch, and the actions that fit the row (reorder, edit,
// details, retry, remove). Official rows come with BMM (links.json) and are read-only.
//
// The thinking is in source-list-model.ts (tested in node), the writes in source-store.ts.

import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { uiIcon } from '../../ui/icons.js';
import { openModal } from '../../ui/modal-shell.js';
import { showConfirm } from '../../ui/confirm.js';
import { invoke, pickFile, saveFile } from '../../core/api.js';
import { fetchCatalog, normalizeAny } from '../../core/catalog-read.js';
import { fetchSourceText } from '../../core/source-fetch.js';
import {
    isDisabled, originOf, originLabel, looksLikeIndex, parseCatalogIndex, importIndexForType,
} from './catalog-index.js';
import { writeSources } from './catalog-sources.js';
import {
    officialSources, listFollowed, addFollowed, removeFollowed, editFollowed, moveFollowed,
    toggleFollowed, readLabels, followableKinds,
} from './source-store.js';
import {
    makeRow, groupRows, failedRows, exportDoc, parseImport, ageParts,
    type SourceRow, type SourceStatusIn,
} from './source-list-model.js';

const toast = (msg: string, kind = 'info', ms?: number) => { try { (window as any).toast?.(msg, kind, ms); } catch { /* no toast host */ } };

const CSS_ID = 'catalog-sources-css';
export function ensureSourceListCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/catalog-sources.css';
    document.head.appendChild(link);
}

// ── What the fetchers said ─────────────────────────────────────────────────────────────

interface Seen extends SourceStatusIn { at: number }
/** Per URL (lower case): the newest thing any fetcher said about it. */
const _seen = new Map<string, Seen>();
/** Partner catalogues the official app catalogue named on the last load. */
let _appPartners: string[] = [];

function remember(url: string, st: Seen): void {
    const k = url.toLowerCase();
    const prev = _seen.get(k);
    if (!prev || st.at >= prev.at) _seen.set(k, st);
}

/** What `fetch_app_catalogs` reported (App catalogue → load). */
export interface AppSourceReport { url: string; tier: string; ok: boolean; error?: string | null; items: number; name?: string | null; ms?: number }

export function setAppSourceReport(list: AppSourceReport[], at = Date.now()): void {
    _appPartners = [];
    for (const s of list || []) {
        if (!s?.url) continue;
        if (s.tier === 'partner') _appPartners.push(s.url);
        remember(s.url, {
            at, lastTry: at, state: s.ok ? 'ok' : 'error', items: s.items,
            ...(s.ok ? { lastOk: at } : {}), ...(s.error ? { error: String(s.error) } : {}), ...(s.name ? { name: String(s.name) } : {}),
        });
    }
}

/** A bundle source answered (or not) from the frontend's own reader. */
export function noteSourceResult(url: string, ok: boolean, items: number, error?: string): void {
    const at = Date.now();
    remember(url, { at, lastTry: at, state: ok ? 'ok' : 'error', items, ...(ok ? { lastOk: at } : {}), ...(error ? { error } : {}) });
}

function absorbHub(list: Array<{ url: string; state: string; error?: string; items: number; lastOk?: number; lastTry?: number; signature?: string }>): void {
    for (const s of list || []) {
        if (!s?.url || s.state === 'pending') continue;
        remember(s.url, { at: s.lastTry || s.lastOk || 0, state: s.state, error: s.error, items: s.items, lastOk: s.lastOk, signature: s.signature });
    }
}

const statusOf = (url: string): Seen | undefined => _seen.get(String(url).toLowerCase());

// ── Checking one source ────────────────────────────────────────────────────────────────

export interface TestResult {
    ok: boolean;
    /** The document is a catalogue INDEX (lists catalogues, holds no items). */
    index?: { total: number; kinds: Record<string, number> };
    items?: number;
    name?: string;
    variant?: string;
    signature?: string;
    warnings?: number;
    error?: string;
}

/** Fetch and read a source the way the catalogue screens will. Never throws. */
export async function testSource(kind: string, url: string, force = true): Promise<TestResult> {
    const u = String(url || '').trim();
    if (!/^https?:\/\/[^/\s]+/i.test(u) && !u.startsWith('bundle:')) return { ok: false, error: t('catsrc.err.badUrl') };
    if (u.startsWith('bundle:')) return { ok: true };
    let text = '';
    try {
        text = (await fetchCatalog(u, { force, quiet: true, noPrompt: true })).text;
    } catch {
        try { text = await fetchSourceText(u, true); } catch (e) { return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }; }
    }
    let doc: unknown;
    try { doc = JSON.parse(text); } catch { return { ok: false, error: t('catsrc.err.notJson') }; }
    if (looksLikeIndex(doc)) {
        const { index } = parseCatalogIndex(doc);
        const kinds: Record<string, number> = {};
        for (const e of index.catalogs) kinds[e.type] = (kinds[e.type] || 0) + 1;
        return { ok: true, index: { total: index.catalogs.length, kinds } };
    }
    try {
        const n = await normalizeAny(doc, kind, u);
        const errs = n.issues.filter((i) => i.severity === 'error');
        const res: TestResult = {
            ok: !n.refused,
            items: n.catalog.items?.length ?? 0,
            name: n.catalog.name || undefined,
            variant: n.variantLabel,
            signature: n.signature?.status,
            warnings: n.issues.filter((i) => i.severity === 'warning').length,
        };
        if (n.refused) res.error = errs[0]?.message || t('catsrc.err.refused');
        return res;
    } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
    }
}

async function checkAndRemember(kind: string, url: string): Promise<TestResult> {
    const r = await testSource(kind, url, true);
    const at = Date.now();
    remember(url, {
        at, lastTry: at, state: r.ok ? 'ok' : 'error', items: r.items ?? (r.index ? 0 : undefined),
        ...(r.ok ? { lastOk: at } : {}), ...(r.error ? { error: r.error } : {}), ...(r.signature ? { signature: r.signature } : {}), ...(r.name ? { name: r.name } : {}),
    });
    return r;
}

// ── Words ──────────────────────────────────────────────────────────────────────────────

export function kindLabel(kind: string): string {
    const k = `settings.catIndex.type.${kind}`;
    const v = t(k);
    return v === k ? kind : v;
}

function tierLabel(row: SourceRow): string {
    if (row.tier === 'official') return t('catsrc.tier.official');
    if (row.tier === 'partner') return t('catsrc.tier.partner');
    return t('catsrc.tier.custom');
}

function healthLabel(row: SourceRow): string {
    switch (row.health) {
        case 'ok': return row.items != null ? t('catsrc.health.okN', { n: String(row.items) }) : t('catsrc.health.ok');
        case 'stale': return t('catsrc.health.stale');
        case 'error': return t('catsrc.health.error');
        case 'pending': return t('catsrc.health.pending');
        case 'off': return t('catsrc.health.off');
        default: return t('catsrc.health.unknown');
    }
}

function sigLabel(s?: string): string {
    switch (s) {
        case 'verified': return t('catsrc.sig.verified');
        case 'invalid': return t('catsrc.sig.invalid');
        case 'unknown_key': return t('catsrc.sig.unknownKey');
        case 'unsigned': return t('catsrc.sig.unsigned');
        default: return '';
    }
}

function ageLabel(ms?: number): string {
    const a = ageParts(ms);
    if (!a) return '';
    if (a.unit === 's') return t('catsrc.age.now');
    if (a.unit === 'm') return t('catsrc.age.m', { n: String(a.n) });
    if (a.unit === 'h') return t('catsrc.age.h', { n: String(a.n) });
    return t('catsrc.age.d', { n: String(a.n) });
}

// ── Rows ───────────────────────────────────────────────────────────────────────────────

async function buildRows(kinds: string[]): Promise<SourceRow[]> {
    const labels = readLabels();
    const rows: SourceRow[] = [];
    for (const kind of kinds) {
        for (const url of officialSources(kind)) {
            rows.push(makeRow({ kind, url, tier: 'official', enabled: true, label: labels[url], status: statusOf(url) }));
        }
        if (kind === 'app') {
            for (const url of _appPartners) rows.push(makeRow({ kind, url, tier: 'partner', enabled: true, label: labels[url], status: statusOf(url) }));
        }
        for (const url of await listFollowed(kind)) {
            const via = originOf(url) || undefined;
            rows.push(makeRow({ kind, url, tier: 'custom', enabled: !isDisabled(url), label: labels[url], via, status: statusOf(url) }));
        }
    }
    return rows;
}

/** The sources that are switched on, were fetched, and failed, for the kinds given. */
export async function failedSources(kinds: string[]): Promise<SourceRow[]> {
    return failedRows(await buildRows(kinds));
}

function rowHtml(r: SourceRow, i: number, n: number, multiKind: boolean): string {
    const custom = r.tier === 'custom';
    const sig = sigLabel(r.signature);
    const age = r.lastOk ? ageLabel(r.lastOk) : '';
    const meta: string[] = [];
    if (multiKind) meta.push(`<span class="csl-chip">${escHtml(kindLabel(r.kind))}</span>`);
    meta.push(`<span class="csl-chip csl-tier-${r.tier}">${escHtml(tierLabel(r))}</span>`);
    if (r.via) meta.push(`<span class="csl-chip" data-tooltip="${escAttr(r.via)}">${escHtml(t('catsrc.via', { i: originLabel(r.via) }))}</span>`);
    if (sig) meta.push(`<span class="csl-chip csl-sig-${escAttr(r.signature || '')}">${uiIcon(r.signature === 'verified' ? 'shield-check' : 'shield', 12)} ${escHtml(sig)}</span>`);
    if (age) meta.push(`<span class="csl-meta-txt">${escHtml(t('catsrc.lastOk', { a: age }))}</span>`);
    const btn = (act: string, icon: string, label: string, extra = '') =>
        `<button type="button" class="btn btn-ghost btn-sm csl-icon-btn${extra}" data-csl="${act}" data-tooltip="${escAttr(label)}" aria-label="${escAttr(label)}">${uiIcon(icon as any, 14)}</button>`;
    return `<li class="csl-row is-${r.health}${r.enabled ? '' : ' is-off'}" data-kind="${escAttr(r.kind)}" data-url="${escAttr(r.url)}" data-tier="${r.tier}">
        <span class="csl-state" data-state="${r.health}" ${r.error ? `data-tooltip="${escAttr(r.error)}"` : ''}><span class="csl-dot" aria-hidden="true"></span>${escHtml(healthLabel(r))}</span>
        <div class="csl-main">
            <div class="csl-name">${escHtml(r.name)}</div>
            <code class="csl-url" title="${escAttr(r.url)}">${escHtml(r.url)}</code>
            <div class="csl-meta">${meta.join('')}</div>
            ${r.health === 'error' && r.error ? `<div class="csl-err">${uiIcon('alert', 12)} ${escHtml(r.error)}</div>` : ''}
        </div>
        <div class="csl-actions">
            ${custom ? `<label class="toggle-switch csl-switch" data-tooltip="${escAttr(r.enabled ? t('catsrc.act.disable') : t('catsrc.act.enable'))}">
                <input type="checkbox" data-csl="toggle" ${r.enabled ? 'checked' : ''} aria-label="${escAttr(t('catsrc.act.enabled'))}"><span class="toggle-slider"></span></label>` : ''}
            ${custom ? btn('up', 'move-up', t('catsrc.act.up'), i === 0 ? ' is-hidden' : '') : ''}
            ${custom ? btn('down', 'move-down', t('catsrc.act.down'), i === n - 1 ? ' is-hidden' : '') : ''}
            ${r.health === 'error' || r.health === 'stale' ? btn('retry', 'refresh', t('catsrc.act.retry')) : ''}
            ${btn('details', 'info', t('catsrc.act.details'))}
            ${custom ? btn('edit', 'edit', t('catsrc.act.edit')) : ''}
            ${custom ? btn('remove', 'delete', t('catsrc.act.remove'), ' csl-danger') : ''}
        </div>
    </li>`;
}

// ── The component ──────────────────────────────────────────────────────────────────────

export interface SourceListOptions {
    /** The kinds this list shows and can add. Default: every followable kind. */
    kinds?: string[];
    /** Called after any change (add, remove, toggle, move, import), with the kinds touched. */
    onChanged?: (kinds: string[]) => void | Promise<void>;
    /** How to re-check app sources (the App catalogue reloads itself). */
    retryApps?: () => Promise<void>;
    /** Show the official-vs-yours explanation. Default true. */
    explain?: boolean;
    /** Check the sources as soon as the list is drawn. Default true; a list inside a closed
     *  fold passes false and calls `refresh()` when it is opened, so nothing is fetched at
     *  start for a panel nobody looked at. */
    autoRefresh?: boolean;
}

export interface SourceListHandle {
    render(): Promise<void>;
    /** Re-check every followed source (`force` ignores the 10-minute freshness). */
    refresh(force?: boolean): Promise<void>;
}

export function mountSourceList(host: HTMLElement, opts: SourceListOptions = {}): SourceListHandle {
    ensureSourceListCss();
    const kinds = (opts.kinds && opts.kinds.length ? opts.kinds : followableKinds());
    const multi = kinds.length > 1;
    let busy = false;
    let rows: SourceRow[] = [];

    const changed = async (k: string[]) => { try { await opts.onChanged?.(k); } catch { /* the caller's own problem */ } };

    host.classList.add('csl');
    host.innerHTML = `
        ${opts.explain === false ? '' : `<details class="csl-explain">
            <summary>${uiIcon('help', 14)} ${escHtml(t('catsrc.explain.title'))}</summary>
            <p>${escHtml(t('catsrc.explain.official'))}</p>
            <p>${escHtml(t('catsrc.explain.custom'))}</p>
            <p>${escHtml(t('catsrc.explain.order'))}</p>
        </details>`}
        <div class="csl-toolbar">
            <button type="button" class="btn btn-primary btn-sm" data-csl="add">${uiIcon('add', 14)} ${escHtml(t('catsrc.act.add'))}</button>
            <button type="button" class="btn btn-secondary btn-sm" data-csl="check">${uiIcon('refresh', 14)} ${escHtml(t('catsrc.act.check'))}</button>
            <span class="csl-spacer"></span>
            <button type="button" class="btn btn-ghost btn-sm" data-csl="import">${uiIcon('import', 14)} ${escHtml(t('catsrc.act.import'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-csl="export">${uiIcon('export', 14)} ${escHtml(t('catsrc.act.export'))}</button>
        </div>
        <p class="csl-summary" aria-live="polite"></p>
        <div class="csl-body"></div>`;

    const body = host.querySelector<HTMLElement>('.csl-body')!;
    const summary = host.querySelector<HTMLElement>('.csl-summary')!;

    async function render(): Promise<void> {
        rows = await buildRows(kinds);
        const custom = rows.filter((r) => r.tier === 'custom');
        const failed = failedRows(rows);
        summary.textContent = t('catsrc.summary', {
            n: String(rows.length), y: String(custom.length),
            off: String(custom.filter((r) => !r.enabled).length), f: String(failed.length),
        });
        if (!rows.length) {
            body.innerHTML = `<div class="csl-empty">${uiIcon('globe', 24)}<p class="csl-empty-title">${escHtml(t('catsrc.empty.title'))}</p><p>${escHtml(t('catsrc.empty.sub'))}</p></div>`;
            return;
        }
        body.innerHTML = groupRows(rows).map((g) => {
            const own = g.rows.filter((r) => r.tier === 'custom');
            let ci = 0;
            const items = g.rows.map((r) => rowHtml(r, r.tier === 'custom' ? ci++ : 0, own.length, multi)).join('');
            const noneOwn = !own.length ? `<li class="csl-none">${escHtml(t('catsrc.noneOwn'))}</li>` : '';
            return `<section class="csl-group">${multi ? `<h4 class="csl-group-h">${escHtml(kindLabel(g.kind))}</h4>` : ''}<ul class="csl-list">${items}${noneOwn}</ul></section>`;
        }).join('');
    }

    async function refresh(force = false): Promise<void> {
        if (busy) return;
        busy = true;
        host.classList.add('is-busy');
        try {
            const hub = await import('./catalog-hub.js');
            absorbHub(hub.catalogIndexStatus());
            const extra = kinds.includes('app')
                ? (await listFollowed('app')).filter((u) => !isDisabled(u) && /^https?:/i.test(u)).map((url) => ({ url, kind: 'app' }))
                : [];
            await render();
            absorbHub(await hub.refreshCatalogIndex({ force, extra }));
            // Official rows of the kinds the hub does not fetch: one quiet check each, only
            // when nothing is known about them yet (or on an explicit re-check).
            for (const kind of kinds) {
                if (kind === 'app' && opts.retryApps) continue;
                for (const url of officialSources(kind)) {
                    if (force || !statusOf(url)) await checkAndRemember(kind, url);
                }
            }
            if (force && kinds.includes('app') && opts.retryApps) await opts.retryApps();
        } catch { /* a row that could not be checked keeps what it had */ }
        finally {
            busy = false;
            host.classList.remove('is-busy');
            await render();
        }
    }

    host.addEventListener('click', async (e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-csl]');
        if (!el || el.tagName === 'INPUT') return;
        const li = el.closest<HTMLElement>('.csl-row');
        const kind = li?.dataset.kind || '';
        const url = li?.dataset.url || '';
        const row = rows.find((r) => r.kind === kind && r.url === url);
        switch (el.dataset.csl) {
            case 'add': openSourceEditor({ kinds, onSaved: async (k) => { await render(); await changed([k]); } }); break;
            case 'check': await refresh(true); toast(t('catsrc.checked'), 'info'); break;
            case 'export': await exportSources(rows); break;
            case 'import': {
                const touched = await importSources(kinds);
                if (touched.length) { await render(); await changed(touched); }
                break;
            }
            case 'up': case 'down':
                await moveFollowed(kind, url, el.dataset.csl === 'up' ? -1 : 1);
                await render(); await changed([kind]);
                break;
            case 'retry':
                if (kind === 'app' && opts.retryApps && row?.tier !== 'custom') { await opts.retryApps(); }
                else {
                    el.setAttribute('disabled', '');
                    const r = await checkAndRemember(kind, url);
                    if (kind === 'app' && opts.retryApps && r.ok) await opts.retryApps();
                    toast(r.ok ? t('catsrc.retryOk') : t('catsrc.retryFail', { e: r.error || '' }), r.ok ? 'success' : 'warning', 6000);
                }
                await render();
                break;
            case 'details': if (row) openSourceDetails(row); break;
            case 'edit': if (row) openSourceEditor({ kinds, row, onSaved: async (k) => { await render(); await changed([k]); } }); break;
            case 'remove': {
                if (!row) return;
                const ok = await showConfirm(t('catsrc.remove.title'), t('catsrc.remove.msg', { name: row.name, url: row.url }), true);
                if (!ok) return;
                try {
                    await removeFollowed(kind, url);
                    toast(t('catsrc.removed'), 'success');
                    await render(); await changed([kind]);
                } catch (err) { toast(`${t('common.error')}: ${String(err).slice(0, 160)}`, 'error'); }
                break;
            }
        }
    });

    host.addEventListener('change', async (e) => {
        const el = e.target as HTMLInputElement;
        if (el?.dataset?.csl !== 'toggle') return;
        const li = el.closest<HTMLElement>('.csl-row');
        if (!li) return;
        toggleFollowed(li.dataset.url || '', el.checked);
        await render();
        await changed([li.dataset.kind || '']);
    });

    void render().then(() => (opts.autoRefresh === false ? undefined : refresh(false)));
    return { render, refresh };
}

// ── Details ────────────────────────────────────────────────────────────────────────────

export function openSourceDetails(row: SourceRow): void {
    const st = statusOf(row.url);
    const line = (k: string, v: string, mono = false) => v ? `<div class="csl-dl-row"><dt>${escHtml(k)}</dt><dd${mono ? ' class="csl-mono"' : ''}>${escHtml(v)}</dd></div>` : '';
    const when = (ms?: number) => (ms ? new Date(ms).toLocaleString() : '');
    openModal({
        title: row.name,
        subtitle: t('catsrc.details.sub'),
        icon: uiIcon('globe', 18),
        size: 'md',
        className: 'csl-modal',
        body: `<dl class="csl-dl">
            ${line(t('catsrc.details.url'), row.url, true)}
            ${line(t('catsrc.details.kind'), kindLabel(row.kind))}
            ${line(t('catsrc.details.tier'), tierLabel(row))}
            ${line(t('catsrc.details.status'), healthLabel(row))}
            ${line(t('catsrc.details.error'), row.error || (row.health === 'error' ? String(st?.error || '') : ''))}
            ${line(t('catsrc.details.items'), row.items != null ? String(row.items) : '')}
            ${line(t('catsrc.details.signature'), sigLabel(row.signature))}
            ${line(t('catsrc.details.lastOk'), when(row.lastOk))}
            ${line(t('catsrc.details.lastTry'), when(st?.lastTry))}
            ${line(t('catsrc.details.via'), row.via || '')}
        </dl>
        <p class="csl-note">${escHtml(row.tier === 'official' ? t('catsrc.explain.official') : row.tier === 'partner' ? t('catsrc.details.partnerNote') : t('catsrc.details.customNote'))}</p>`,
        footer: `<button type="button" class="btn btn-secondary btn-sm" data-copy-url>${uiIcon('copy', 14)} ${escHtml(t('catsrc.details.copy'))}</button>`,
    }).dialog.querySelector('[data-copy-url]')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(row.url); toast(t('catsrc.copied'), 'success'); } catch { /* clipboard blocked */ }
    });
}

// ── Add / edit ─────────────────────────────────────────────────────────────────────────

export function openSourceEditor(o: { kinds: string[]; row?: SourceRow; kind?: string; onSaved?: (kind: string) => void | Promise<void> }): void {
    ensureSourceListCss();
    const editing = !!o.row;
    const kinds = o.kinds.length ? o.kinds : followableKinds();
    const startKind = o.row?.kind || o.kind || kinds[0];
    const labels = readLabels();
    let tested: { url: string; kind: string; r: TestResult } | null = null;
    const h = openModal({
        title: editing ? t('catsrc.editor.editTitle') : t('catsrc.editor.addTitle'),
        subtitle: t('catsrc.editor.sub'),
        icon: uiIcon(editing ? 'edit' : 'add', 18),
        size: 'md',
        className: 'csl-modal',
        initialFocus: '#csl-ed-url',
        body: `<div class="csl-form">
            ${kinds.length > 1 ? `<label class="csl-field"><span>${escHtml(t('catsrc.editor.kind'))}</span>
                <select class="input-field" id="csl-ed-kind" ${editing ? 'disabled' : ''}>${kinds.map((k) => `<option value="${escAttr(k)}"${k === startKind ? ' selected' : ''}>${escHtml(kindLabel(k))}</option>`).join('')}</select></label>` : ''}
            <label class="csl-field"><span>${escHtml(t('catsrc.editor.url'))}</span>
                <input type="text" class="input-field csl-mono" id="csl-ed-url" spellcheck="false" autocomplete="off" placeholder="https://…/catalog.json" value="${escAttr(o.row?.url || '')}"></label>
            <label class="csl-field"><span>${escHtml(t('catsrc.editor.name'))}</span>
                <input type="text" class="input-field" id="csl-ed-name" maxlength="120" placeholder="${escAttr(t('catsrc.editor.namePh'))}" value="${escAttr((o.row && labels[o.row.url]) || '')}"></label>
            ${kinds.includes('app') && !editing ? `<p class="csl-note">${escHtml(t('catsrc.editor.bundleHint'))}</p>` : ''}
            <div class="csl-test" aria-live="polite"></div>
        </div>`,
        footer: `<button type="button" class="btn btn-secondary btn-sm" data-ed="test">${uiIcon('play', 14)} ${escHtml(t('catsrc.editor.test'))}</button>
            <span class="csl-spacer"></span>
            <button type="button" class="btn btn-ghost btn-sm" data-ed="cancel">${escHtml(t('common.cancel'))}</button>
            <button type="button" class="btn btn-primary btn-sm" data-ed="save">${escHtml(editing ? t('catsrc.editor.save') : t('catsrc.editor.add'))}</button>`,
    });
    const q = <T extends HTMLElement>(s: string) => h.q<T>(s);
    const kindNow = () => q<HTMLSelectElement>('#csl-ed-kind')?.value || startKind;
    const urlNow = () => (q<HTMLInputElement>('#csl-ed-url')?.value || '').trim();
    const out = q<HTMLElement>('.csl-test')!;
    const saveBtn = q<HTMLButtonElement>('[data-ed="save"]')!;

    const paintTest = (r: TestResult) => {
        if (r.index) {
            const mine = Object.entries(r.index.kinds).filter(([k]) => kinds.includes(k)).reduce((n, [, v]) => n + v, 0);
            out.innerHTML = `<div class="csl-test-box is-info">${uiIcon('list', 14)} <div><b>${escHtml(t('catsrc.test.index', { n: String(r.index.total) }))}</b><br>${escHtml(mine ? t('catsrc.test.indexImport', { n: String(mine) }) : t('catsrc.test.indexNone'))}</div></div>`;
            saveBtn.textContent = mine ? t('catsrc.editor.addIndex', { n: String(mine) }) : t('catsrc.editor.add');
            saveBtn.disabled = !mine;
            return;
        }
        saveBtn.disabled = false;
        saveBtn.textContent = editing ? t('catsrc.editor.save') : t('catsrc.editor.add');
        if (!r.ok) { out.innerHTML = `<div class="csl-test-box is-bad">${uiIcon('error', 14)} <div><b>${escHtml(t('catsrc.test.fail'))}</b><br><span class="csl-mono">${escHtml(r.error || '')}</span></div></div>`; return; }
        const bits = [
            r.items != null ? t('catsrc.test.items', { n: String(r.items) }) : '',
            r.variant || '', sigLabel(r.signature),
            r.warnings ? t('catsrc.test.warnings', { n: String(r.warnings) }) : '',
        ].filter(Boolean).join(' · ');
        out.innerHTML = `<div class="csl-test-box is-ok">${uiIcon('success', 14)} <div><b>${escHtml(r.name ? t('catsrc.test.okNamed', { name: r.name }) : t('catsrc.test.ok'))}</b><br>${escHtml(bits)}</div></div>`;
        const nameEl = q<HTMLInputElement>('#csl-ed-name');
        if (nameEl && !nameEl.value && r.name) nameEl.placeholder = r.name;
    };

    const runTest = async (): Promise<TestResult | null> => {
        const url = urlNow();
        if (!url) { out.innerHTML = `<div class="csl-test-box is-bad">${escHtml(t('catsrc.err.badUrl'))}</div>`; return null; }
        out.innerHTML = `<div class="csl-test-box">${uiIcon('loader', 14)} ${escHtml(t('catsrc.test.running'))}</div>`;
        const r = await checkAndRemember(kindNow(), url);
        tested = { url, kind: kindNow(), r };
        paintTest(r);
        return r;
    };

    h.dialog.addEventListener('click', async (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ed]');
        if (!b) return;
        if (b.dataset.ed === 'cancel') { h.close(); return; }
        if (b.dataset.ed === 'test') { await runTest(); return; }
        if (b.dataset.ed !== 'save') return;
        const url = urlNow();
        const kind = kindNow();
        const name = (q<HTMLInputElement>('#csl-ed-name')?.value || '').trim();
        if (!/^https?:\/\/[^/\s]+/i.test(url) && !url.startsWith('bundle:')) { toast(t('catsrc.err.badUrl'), 'warning'); return; }
        // Not tested yet (or changed since): test now, so an index is caught before it is
        // saved as a catalogue that would contain nothing.
        const r = tested && tested.url === url && tested.kind === kind ? tested.r : await runTest();
        saveBtn.disabled = true;
        try {
            if (r?.index && !editing) {
                const doc = JSON.parse(await fetchSourceText(url, true));
                let added = 0;
                for (const k of kinds) {
                    const res = await importIndexForType(doc, k, url,
                        async (u) => { await invoke('add_community_source', { url: u }); }, writeSources);
                    added += res.added;
                }
                toast(t('catsrc.indexAdded', { n: String(added) }), added ? 'success' : 'info');
                h.close();
                await o.onSaved?.(kind);
                return;
            }
            if (editing && o.row) {
                await editFollowed(o.row.kind, o.row.url, url, name);
                toast(t('catsrc.saved'), 'success');
            } else {
                const ok = await addFollowed(kind, url, { name });
                if (!ok) { toast(t('apps.sources.already'), 'info'); saveBtn.disabled = false; return; }
                toast(r && !r.ok ? t('catsrc.addedFailing') : t('catsrc.added'), r && !r.ok ? 'warning' : 'success', 6000);
            }
            h.close();
            await o.onSaved?.(kind);
        } catch (err) {
            const m = String((err as Error)?.message ?? err);
            toast(t(m) !== m ? t(m) : `${t('common.error')}: ${m.slice(0, 160)}`, 'error');
            saveBtn.disabled = false;
        }
    });
    q<HTMLInputElement>('#csl-ed-url')?.addEventListener('input', () => { tested = null; out.innerHTML = ''; saveBtn.disabled = false; saveBtn.textContent = editing ? t('catsrc.editor.save') : t('catsrc.editor.add'); });
}

// ── Import / export ────────────────────────────────────────────────────────────────────

async function exportSources(rows: SourceRow[]): Promise<void> {
    const doc = exportDoc(rows, readLabels());
    if (!(doc as any).sources.length) { toast(t('catsrc.export.none'), 'info'); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    const path = await saveFile({ defaultPath: `bmm-catalog-sources-${stamp}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return;
    try {
        await invoke('write_text_file', { path, content: JSON.stringify(doc, null, 2) });
        toast(t('catsrc.export.done', { n: String((doc as any).sources.length) }), 'success', 6000);
    } catch (e) { toast(`${t('common.error')}: ${String(e).slice(0, 160)}`, 'error'); }
}

/** Import a sources file. Returns the kinds that changed. */
async function importSources(kinds: string[]): Promise<string[]> {
    const path = await pickFile([{ name: 'JSON', extensions: ['json'] }]).catch(() => null);
    if (!path) return [];
    let doc: unknown;
    try { doc = JSON.parse(await invoke('read_file_text', { path }) as string); } catch { toast(t('catsrc.err.notJson'), 'error'); return []; }
    const { sources, dropped } = parseImport(doc, kinds[0] || 'app');
    const mine = sources.filter((s) => kinds.includes(s.kind));
    const other = sources.length - mine.length;
    if (!mine.length) { toast(t('catsrc.import.none'), 'info', 6000); return []; }
    const ok = await showConfirm(t('catsrc.import.title'), t('catsrc.import.msg', { n: String(mine.length) }), false);
    if (!ok) return [];
    let added = 0;
    const touched = new Set<string>();
    for (const s of mine) {
        try {
            if (await addFollowed(s.kind, s.url, { name: s.name, enabled: s.enabled })) { added += 1; touched.add(s.kind); }
        } catch { /* one bad line must not stop the rest */ }
    }
    toast(t('catsrc.import.done', { n: String(added), s: String(mine.length - added + dropped + other) }), added ? 'success' : 'info', 7000);
    return [...touched];
}
