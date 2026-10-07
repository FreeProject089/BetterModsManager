// @ts-nocheck
// ── BMM Theme Catalogue ───────────────────────────────────────────────────────
// Fetches official / partner / community theme lists (same pattern as app-catalog) and shows
// them as a gallery: a card per theme with a miniature of the app painted in ITS colours, a
// toolbar to search and filter (source, dark/light), and a preview pane on the right with the
// palette and the action that fits (Apply, Install, Edit, Uninstall, Reinstall).
//
// The dialog is the house shell (openModal, modal--xl modal--tall); css/themes.css holds its
// content rules (.tcg-*).

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
// NOTE: this file is @ts-nocheck, so a wrong name here is a runtime ReferenceError and not
// a build error — scripts/check-undefined-names.mjs is what catches one.
import { enabledOnly } from '../catalogs/catalog-index.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { installTheme, activateTheme, getInstalledThemes, getActiveTheme, isLightTheme, BmmTheme } from './theme-engine.js';
import { fetchSourceText } from '../../core/source-fetch.js';
import { resolveEntryUrl } from '../../core/catalog-url.js';
import { openModal } from '../../ui/modal-shell.js';
import { uiIcon } from '../../ui/icons.js';


const OFFICIAL_CATALOG = 'https://raw.githubusercontent.com/BetterDCS/BMM_Themes/main/catalog.json';
const COMMUNITY_SRC_KEY = 'bmm_theme_community_sources';

let _handle: any = null;                          // the open dialog (openModal handle), or null
let _catalog: BmmTheme[] = [];
let _builtins: any[] = [];   // all built-in presets incl. hidden (_hidden flag)
let _filter = '';
let _communitySources: string[] = [];
let _src: 'all' | 'mine' | 'builtin' | 'catalog' = 'all';
let _mode: 'any' | 'dark' | 'light' = 'any';
let _selId: string | null = null;
let _loading = false;
let _presetsDir = '';

const PALETTE_SVG = (uiIcon('palette', 18));
const MOON_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';
const SUN_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

// ── Init & open ───────────────────────────────────────────────────────────────
export function initThemeCatalog(): void {
    // Register global opener
    (window as any).openThemeCatalog = openCatalog;
    // Load community sources from localStorage
    try { _communitySources = JSON.parse(localStorage.getItem(COMMUNITY_SRC_KEY) || '[]'); } catch {}
}

export async function openCatalog(): Promise<void> {
    if (_handle) { _handle.q('#theme-cat-search')?.focus(); return; }
    buildModal();
    _loading = true;
    renderCatalog();
    await fetchCatalog();
    _loading = false;
    if (!_selId) _selId = getActiveTheme()?.id || null;
    renderCatalog();
}

function closeModal(): void {
    _handle?.close();
}

// ── The dialog ────────────────────────────────────────────────────────────────
function buildModal(): void {
    const seg = (id: string, items: [string, string][], cur: string) => `<div class="bms-seg" role="group" id="${id}">${items.map(([v, label]) =>
        `<button type="button" class="bms-seg-btn" data-v="${escAttr(v)}" aria-pressed="${v === cur}">${label}</button>`).join('')}</div>`;
    _handle = openModal({
        id: 'modal-theme-catalog',
        title: t('themes.catalogue'),
        subtitle: t('themes.catalogueSub'),
        icon: PALETTE_SVG,
        size: 'xl',
        tall: true,
        className: 'tcg-modal',
        closeLabel: t('common.close'),
        initialFocus: '#theme-cat-search',
        body: `<style id="tcg-paints"></style><div class="tcg-layout">
                <div class="tcg-gridwrap"><div class="tcg-grid" id="theme-cat-list" role="listbox" aria-label="${escAttr(t('themes.catalogue'))}"></div></div>
                <aside class="tcg-detail" id="tcg-detail" aria-live="polite"></aside>
            </div>`,
        footer: `<div class="modal-footer-start">
                <button type="button" class="btn btn-ghost btn-sm" id="theme-cat-reset" title="${escAttr(t('themes.resetDefaultTip'))}">
                    ${uiIcon('reset', 12)}
                    ${escHtml(t('themes.resetDefault'))}
                </button>
                <span class="tcg-presets" id="tcg-presets" hidden>
                    <button type="button" class="btn btn-ghost btn-sm" id="tcg-presets-open">${escHtml(t('themes.presetsFolder'))}</button>
                    <button type="button" class="btn btn-ghost btn-sm" id="tcg-presets-rescan">${escHtml(t('themes.dropinRescan'))}</button>
                </span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" id="theme-cat-import-file">${escHtml(t('themes.importFile'))}</button>
            <button type="button" class="btn btn-primary btn-sm" id="theme-cat-build">${escHtml(t('themes.catalogues'))}</button>`,
        onClose: () => { _handle = null; _paints.clear(); },
    });
    const m = _handle;

    // The search and the filters are the toolbar band, between the header and the gallery.
    const bar = document.createElement('div');
    bar.className = 'modal-toolbar tcg-toolbar';
    bar.innerHTML = `
        <label class="tcg-search">
            ${uiIcon('search', 14)}
            <input id="theme-cat-search" class="form-input" type="search" spellcheck="false" autocomplete="off" placeholder="${escAttr(t('themes.searchPh'))}" aria-label="${escAttr(t('themes.searchPh'))}">
        </label>
        ${seg('tcg-src', [['all', escHtml(t('themes.filterAll'))], ['mine', escHtml(t('themes.mine'))], ['builtin', escHtml(t('themes.srcBuiltin'))], ['catalog', escHtml(t('themes.catalogThemes'))]], _src)}
        ${seg('tcg-mode', [['any', escHtml(t('themes.modeAny'))], ['dark', `${MOON_SVG}<span>${escHtml(t('themes.modeDark'))}</span>`], ['light', `${SUN_SVG}<span>${escHtml(t('themes.modeLight'))}</span>`]], _mode)}
        <button type="button" class="btn btn-ghost btn-sm tcg-refresh" id="theme-cat-refresh" title="${escAttr(t('common.refresh'))}" aria-label="${escAttr(t('common.refresh'))}">
            ${uiIcon('reapply', 14)}
        </button>`;
    m.dialog.insertBefore(bar, m.body);
    m.body.classList.add('modal-body--flush');

    const search = m.q<HTMLInputElement>('#theme-cat-search')!;
    search.value = _filter;
    search.addEventListener('input', () => { _filter = search.value.toLowerCase().trim(); renderCatalog(); });
    search.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown') return;
        const first = m.q<HTMLElement>('.tcg-card[aria-selected="true"]') || m.q<HTMLElement>('.tcg-card');
        if (!first) return;
        e.preventDefault();
        first.focus();
    });
    m.q('#tcg-src')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
        if (b) { _src = b.dataset.v as any; renderCatalog(); }
    });
    m.q('#tcg-mode')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
        if (b) { _mode = b.dataset.v as any; renderCatalog(); }
    });
    m.q('#theme-cat-reset')!.addEventListener('click', async () => {
        try {
            const { resetTheme } = await import('./theme-engine.js');
            resetTheme();                                     // clears the frontend + the ACTIVE_KEY boot reads
            await invoke('set_active_theme', { themeId: '' }).catch(() => {}); // best-effort clear the backend copy too
            toast(t('themes.resetDone'), 'success');
            renderCatalog();
        } catch (e) { toast(String(e), 'error'); }
    });
    m.q('#theme-cat-refresh')!.addEventListener('click', async () => {
        _loading = true; renderCatalog();
        await fetchCatalog(true);
        _loading = false; renderCatalog();
    });
    m.q('#theme-cat-import-file')!.addEventListener('click', importFromFile);
    m.q('#theme-cat-build')!.addEventListener('click', openThemeCatalogues);

    // ── Drop-in presets: say where the folder is, and rescan without a restart ──
    //
    // The scan only ran at boot, and the folder's path is different on every OS (it moved
    // once already, when the bundle id changed). "Put your themes in the presets folder"
    // is not actionable advice without the path and a way to pick them up now.
    (async () => {
        try { _presetsDir = await invoke('theme_presets_dir') as string; } catch { _presetsDir = ''; }
        const box = m.q<HTMLElement>('#tcg-presets');
        if (!_presetsDir || !box || !_handle) return;
        box.hidden = false;
        const open = m.q<HTMLElement>('#tcg-presets-open')!;
        open.title = `${t('themes.dropinTitle')}: ${_presetsDir}`;
        open.addEventListener('click', () => { void invoke('open_folder', { path: _presetsDir }); });
        m.q('#tcg-presets-rescan')!.addEventListener('click', async () => {
            const before = _builtins.length;
            await refreshBuiltins();
            const added = _builtins.length - before;
            toast(added > 0
                ? t('themes.dropinFound').replace('{n}', String(added))
                : t('themes.dropinNone'),
                added > 0 ? 'success' : 'info');
        });
    })();

    // The gallery: a click selects, a double-click applies, the arrows walk the grid.
    const grid = m.q<HTMLElement>('#theme-cat-list')!;
    grid.addEventListener('click', (e) => {
        const restore = (e.target as HTMLElement).closest('#btc-restore-all');
        if (restore) { void restoreAllDefaults(); return; }
        if ((e.target as HTMLElement).closest('[data-tcg-clear]')) { clearFilters(); return; }
        const card = (e.target as HTMLElement).closest<HTMLElement>('.tcg-card');
        if (card?.dataset.id) select(card.dataset.id);
    });
    grid.addEventListener('dblclick', (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('.tcg-card');
        const entry = card?.dataset.id ? entryById(card.dataset.id) : null;
        if (entry && canApply(entry)) void doApply(entry);
    });
    grid.addEventListener('keydown', (e) => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const cards = [...grid.querySelectorAll<HTMLElement>('.tcg-card')];
        const at = cards.indexOf(document.activeElement as HTMLElement);
        if (at < 0 || !cards.length) return;
        e.preventDefault();
        let to = at;
        if (e.key === 'ArrowRight') to = Math.min(cards.length - 1, at + 1);
        else if (e.key === 'ArrowLeft') to = Math.max(0, at - 1);
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = cards.length - 1;
        else {
            // Up / down: the nearest card in the next row, measured, since sections break rows.
            const r0 = cards[at].getBoundingClientRect();
            const down = e.key === 'ArrowDown';
            let best = -1, bestScore = Infinity;
            cards.forEach((c, i) => {
                const r = c.getBoundingClientRect();
                const dy = down ? r.top - r0.top : r0.top - r.top;
                if (dy < 4) return;
                const score = dy * 4 + Math.abs(r.left - r0.left);
                if (score < bestScore) { bestScore = score; best = i; }
            });
            if (best < 0) return;
            to = best;
        }
        cards[to].focus();
        cards[to].scrollIntoView({ block: 'nearest' });
        if (cards[to].dataset.id) select(cards[to].dataset.id, false);
    });
    m.q('#tcg-detail')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
        const entry = _selId ? entryById(_selId) : null;
        if (!b || !entry) return;
        const act = b.dataset.act;
        if (act === 'apply') void doApply(entry);
        else if (act === 'install') void doInstall(entry, b as HTMLButtonElement);
        else if (act === 'edit') { closeModal(); (window as any).openThemeEditor?.(entry.th.id); }
        else if (act === 'uninstall') void setBuiltinHidden(entry.th.id, true);
        else if (act === 'reinstall') void setBuiltinHidden(entry.th.id, false);
    });
}

function clearFilters(): void {
    _filter = ''; _src = 'all'; _mode = 'any';
    const box = _handle?.q('#theme-cat-search') as HTMLInputElement | null;
    if (box) { box.value = ''; box.focus(); }
    renderCatalog();
}

// ── Theme-catalog BUILDER ─────────────────────────────────────────────────────
// Pick installed/custom themes → export a catalog.json ({version,name,themes:[full
// theme objects, vars inline]}) that this app AND the BCWEB theme feed both consume.

/**
 * Following theme catalogues, and making one — on the screen every other kind uses.
 *
 * This was three controls in two places: *+ Community source* in the header, *Create theme
 * catalog* in the footer, and its own builder modal, none of which knew about the others.
 * Following by FILE was not possible at all, and a protected source had a block here that
 * four other kinds did not have. All of it is now ui/catalog-modal.ts, and what is left is
 * the part that is about themes.
 *
 * Themes keep a third choice the other kinds do not have — the body written into
 * catalog.json itself — because that is what every theme catalogue published so far
 * contains, and it stays the default. `inlineMode` is what asks for it.
 *
 * The gallery is NOT replaced. It previews and installs, which a list of names cannot do.
 */
async function openThemeCatalogues(): Promise<void> {
    const { openCatalogModal } = await import('../../ui/catalog-modal.js');
    const all = () => [...getInstalledThemes(), ...(_builtins || []).filter((b: any) => !b._hidden)];
    await openCatalogModal({
        id: 'theme',
        title: t('themes.cataloguesTitle'),
        subtitle: t('themes.cataloguesSub'),
        storeKey: COMMUNITY_SRC_KEY,
        feedField: 'themes',
        ext: 'bmmtheme',
        fallbackNoun: 'theme',
        inlineMode: true,
        indexType: 'theme',
        candidates: async () => all(),
        label: (th: any) => ({ name: th.name || th.id, sub: th.author || '' }),
        entryId: (th: any) => th.id,
        writeEntry: async (th: any, dir: string, file: string) => {
            const sep = dir.includes('\\') ? '\\' : '/';
            await invoke('write_text_file', { path: `${dir}${sep}${file}`, content: JSON.stringify(th, null, 2) });
            return true;
        },
        // An address means the body is fetched, so the body must NOT also be here:
        // resolveThemeBody short-circuits on `vars`, so a theme carrying both would have its
        // file written, referenced, and silently ignored.
        row: (th: any, address: string) => {
            // Inline: the WHOLE object, base64 preview, assets and fonts included. A theme
            // is self-contained JSON, so this works for a custom theme with images — at the
            // cost of everybody who follows the catalogue downloading every theme’s images
            // just to read the list.
            if (!address) return th;
            // Linked or packed: an ALLOWLIST, not a rest-spread. Dropping vars alone is
            // what makes resolveThemeBody fetch the body — but it left assets, fonts,
            // global_css and the page overrides in the index, so a “linked” theme still
            // shipped its megabytes inside catalog.json and the link bought nothing.
            // preview stays: the gallery draws it before anything is fetched.
            const { id, name, author, version, description, preview, mode, bmm_min_version } = th;
            return {
                id, name, author, version, description, preview, mode, bmm_min_version,
                download_url: address,
            };
        },
        looksLike: (doc: any) => !!doc && typeof doc === 'object' && Array.isArray(doc.themes),
        onChange: () => {
            // Re-read from storage rather than tracking it: the shared screen writes the
            // key, and this module holds its own copy read once at init.
            try { _communitySources = JSON.parse(localStorage.getItem(COMMUNITY_SRC_KEY) || '[]'); } catch { /* keep what we had */ }
            fetchCatalog(true).then(renderCatalog);
        },
        manageKeys: () => {
            (document.getElementById('nav-settings') as HTMLElement | null)?.click();
            setTimeout(() => document.getElementById('settings-identity-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
        },
    });
}

/**
 * The theme itself, whether the catalogue carried it or only pointed at it.
 *
 * A theme catalogue used to be the ONE kind in BMM whose entries had to contain the whole
 * thing inline — apps, plugins, modpacks, tutorials and automations all list an address and
 * fetch the file. So the obvious way to publish themes, a folder of `.bmmtheme` files with a
 * catalog.json beside them, was the one way that did not work; you had to paste every
 * theme's full body into the feed by hand, and re-paste it to publish a fix.
 *
 * Inline still works and is still the default the builder writes — nothing published so far
 * changes. This is the other half.
 *
 * A relative address resolves against the catalogue it came from, so the folder survives
 * being moved or forked. `resolveEntryUrl` decides what may be fetched, and it checks the
 * RESULT rather than the input, because an absolute `javascript:` URL passes through
 * resolution untouched.
 */
async function resolveThemeBody(entry: BmmTheme): Promise<BmmTheme> {
    // Carrying its own body: nothing to fetch, and no reason to touch the network.
    if (entry.vars && Object.keys(entry.vars).length) return entry;
    if (!entry.download_url) return entry;

    const url = resolveEntryUrl(entry.download_url, entry._src || '');
    if (!url) throw new Error(t('themes.badThemeUrl') || 'that address cannot be fetched');

    const raw = await fetchSourceText(url);
    let doc: any;
    try { doc = JSON.parse(raw); } catch { throw new Error(t('themes.notATheme') || 'that file is not a theme'); }
    // A document with no vars is not a theme, and installing one would register an entry that
    // changes nothing and cannot be told from a theme that failed to apply.
    if (!doc || typeof doc !== 'object' || !doc.vars || typeof doc.vars !== 'object') {
        throw new Error(t('themes.notATheme') || 'that file is not a theme');
    }
    // The catalogue's id and name win. A fetched file that calls itself something else would
    // otherwise install under a different id from the one the gallery just showed — so the
    // row stays on screen as un-installed while the theme sits in the list under another name.
    return { ...doc, id: entry.id, name: entry.name || doc.name };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchCatalog(force = false): Promise<void> {
    try {
        const isUrl = (s: string) => /^https?:\/\//i.test(s);
        // Filtered BEFORE the url/file split, not after. Local catalogs are read through a
        // separate loop below, so filtering only the URL half would leave a switched-off
        // local catalog loading — off for one kind of source and on for the other.
        //
        // enabledOnly re-reads localStorage on every call, which matters here:
        // `_communitySources` is read once at init, so a source switched off from Settings
        // would otherwise stay on until restart.
        const live = enabledOnly(_communitySources);
        const urlSources = live.filter(isUrl);
        const fileSources = live.filter(s => !isUrl(s));
        const all: BmmTheme[] = [];
        // URL sources + the official catalog go through the backend — it sends the site
        // identity header (so PRIVATE community catalogs resolve) and, unlike a browser
        // fetch, isn't bound by the CSP connect-src allowlist.
        // An `ssh://` source is one only the FRONTEND can reach: the target and its secret
        // live here and are never stored, so the backend has nothing to connect with. Read
        // them here and hand the raw documents to the same merger, rather than parsing and
        // deduplicating a second time in TypeScript — that rule exists once, in Rust.
        // The shared parser decides what an ssh:// source is — writing the test again here
        // would be the third copy of a rule that already has one home.
        const { parseSshSource } = await import('../repo/repo-ssh.js');
        const sshSources = urlSources.filter((u) => parseSshSource(u) !== null);
        const httpSources = urlSources.filter((u) => parseSshSource(u) === null);
        const extraDocs: string[] = [];
        for (const u of sshSources) {
            // One unreachable source must not empty the list, exactly as a failing HTTP one
            // does not — the backend skips those silently too.
            try { extraDocs.push(await fetchSourceText(u)); } catch { /* skipped */ }
        }
        try {
            const fromBackend: string = await invoke('fetch_theme_catalogs', {
                officialUrl: OFFICIAL_CATALOG,
                communityUrls: httpSources,
                extraDocs,
            });
            all.push(...(JSON.parse(fromBackend || '[]')));
        } catch {}
        // LOCAL FILE sources (e.g. a catalog you exported + "added as source") can't be
        // fetch()ed — the CSP blocks file:// — so read them through the Rust file reader.
        for (const path of fileSources) {
            try {
                const text: string = await invoke('read_file_text', { path });
                const json = JSON.parse(text);
                const list = Array.isArray(json) ? json : (json?.themes || []);
                all.push(...list);
            } catch {}
        }
        // Deduplicate by id
        const seen = new Set<string>();
        _catalog = all.filter(th => { if (seen.has(th.id)) return false; seen.add(th.id); return true; });
    } catch {
        _catalog = [];
    }
    // Built-in presets (incl. hidden ones, for reinstall).
    try { _builtins = JSON.parse(await invoke('list_builtin_themes_all') as string || '[]'); }
    catch { _builtins = []; }
}

// ── Render ────────────────────────────────────────────────────────────────────
type Src = 'mine' | 'builtin' | 'catalog';
interface Entry { th: any; src: Src; hidden: boolean; installed: boolean }

/** Every theme the gallery can show, once: yours (installed, in no catalogue, not built in),
 *  the built-in presets (hidden ones included, to reinstall), then the catalogues.
 *
 *  "Yours" exists because installed themes that came from nowhere but this machine (made in
 *  the editor, imported from a file) used to have no row anywhere in this dialog, which
 *  reads, correctly, as "my themes are gone". */
function allEntries(): Entry[] {
    const installed = new Set(getInstalledThemes().map((x) => x.id));
    const builtinIds = new Set(_builtins.map((b: any) => b.id));
    const catalogIds = new Set(_catalog.map((c: any) => c.id));
    const out: Entry[] = [];
    for (const th of getInstalledThemes()) {
        if (!builtinIds.has(th.id) && !catalogIds.has(th.id)) out.push({ th, src: 'mine', hidden: false, installed: true });
    }
    for (const th of _builtins) out.push({ th, src: 'builtin', hidden: !!th._hidden, installed: !th._hidden });
    for (const th of _catalog) out.push({ th, src: 'catalog', hidden: false, installed: installed.has(th.id) });
    return out;
}
const entryById = (id: string) => allEntries().find((e) => e.th.id === id) || null;

/** Light, dark, or unknown (a linked catalogue entry carries no colours until installed). */
function modeOf(th: any): 'light' | 'dark' | null {
    if (th.mode === 'light' || th.mode === 'dark') return th.mode;
    if (th.vars && (th.vars['--bmm-bg-base'] || Object.keys(th.vars).length === 0)) return isLightTheme(th) ? 'light' : 'dark';
    return null;
}

const matchesText = (th: any) => !_filter
    || (th.name || th.id || '').toLowerCase().includes(_filter)
    || (th.author || '').toLowerCase().includes(_filter)
    || (th.description || '').toLowerCase().includes(_filter);
const matchesMode = (th: any) => _mode === 'any' || modeOf(th) === _mode;

// A theme's colours go into a style attribute, so only values that ARE colours get there:
// a catalogue is somebody else's JSON, and `red;background:url(…)` is a string too.
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%/]+\)|hsla?\(\s*[\d.\s,%/deg]+\))$/i;
// BMM's own dark defaults (css/tokens.css), for the slots a theme leaves to them.
const DEFAULT_SWATCH = { bg: '#0a0e17', side: '#0d1117', card: '#111827', acc: '#3b82f6', tx: '#f1f5f9', tx2: '#94a3b8' };
function swatchOf(th: any): typeof DEFAULT_SWATCH {
    const v = th.vars || {};
    const pick = (keys: string[], dflt: string) => {
        for (const k of keys) { const c = String(v[k] || '').trim(); if (COLOR_RE.test(c)) return c; }
        return dflt;
    };
    const bg = pick(['--bmm-bg-base'], DEFAULT_SWATCH.bg);
    return {
        bg,
        side: pick(['--bmm-bg-sidebar', '--bmm-bg-base'], DEFAULT_SWATCH.side),
        card: pick(['--bmm-bg-elevated', '--bmm-bg-card'], DEFAULT_SWATCH.card),
        acc: pick(['--bmm-accent'], DEFAULT_SWATCH.acc),
        tx: pick(['--bmm-text-primary'], DEFAULT_SWATCH.tx),
        tx2: pick(['--bmm-text-secondary'], DEFAULT_SWATCH.tx2),
    };
}

/** A miniature of the app in the theme's colours: sidebar with its accent pill, a title bar
 *  with a button, two cards with two lines of text. */
// The colours go into ONE <style> owned by the dialog, as a class per palette, never into a
// style attribute: the light-theme patches in theme-engine match [style*="#0a0e17"] and the
// like, and would repaint a dark theme's miniature in the CURRENT theme's colours.
const _paints = new Map<string, string>();
function paintClass(th: any): string {
    const s = swatchOf(th);
    const decl = `--m-bg:${s.bg};--m-side:${s.side};--m-card:${s.card};--m-acc:${s.acc};--m-tx:${s.tx};--m-tx2:${s.tx2}`;
    let cls = _paints.get(decl);
    if (!cls) {
        cls = `tcg-p${_paints.size}`;
        _paints.set(decl, cls);
        const el = _handle?.q('#tcg-paints') as HTMLStyleElement | null;
        // Every value passed COLOR_RE in swatchOf, so nothing here can close the rule.
        if (el) el.textContent += `.${cls}{${decl}}` + String.fromCharCode(10);
    }
    return cls;
}

function mockHtml(th: any, big = false): string {
    return `<span class="tcg-mock ${paintClass(th)}${big ? ' is-big' : ''}" aria-hidden="true">
        <span class="tcg-mock-side"><i class="is-acc"></i><i></i><i></i><i></i></span>
        <span class="tcg-mock-main">
            <span class="tcg-mock-top"><i class="tcg-mock-title"></i><i class="tcg-mock-btn"></i></span>
            <span class="tcg-mock-card"><i></i><i class="is-short"></i></span>
            <span class="tcg-mock-card"><i></i><i class="is-short"></i></span>
        </span>
    </span>`;
}
const safePreview = (u: any) => (typeof u === 'string' && /^(https:\/\/|data:image\/(png|jpe?g|webp|gif);)/i.test(u) ? u : '');
function thumbHtml(th: any, big = false): string {
    const img = safePreview(th.preview);
    // A shipped screenshot wins when the theme carries no colours to paint (a linked entry).
    if (img && !(th.vars && Object.keys(th.vars).length)) return `<img class="tcg-img" src="${escAttr(img)}" alt="" loading="lazy">`;
    return mockHtml(th, big);
}

function badgesHtml(e: Entry, activeId: string | null): string {
    const md = modeOf(e.th);
    const out: string[] = [];
    if (md) out.push(`<span class="tcg-badge" title="${escAttr(md === 'light' ? t('themes.modeLight') : t('themes.modeDark'))}">${md === 'light' ? SUN_SVG : MOON_SVG}</span>`);
    if (e.th.id === activeId) out.push(`<span class="tcg-badge is-active">${escHtml(t('themes.active'))}</span>`);
    else if (e.hidden) out.push(`<span class="tcg-badge is-muted">${escHtml(t('themes.hiddenBadge'))}</span>`);
    else if (e.src === 'catalog' && e.installed) out.push(`<span class="tcg-badge is-ok">${escHtml(t('themes.installed'))}</span>`);
    return out.join('');
}

function cardHtml(e: Entry, activeId: string | null): string {
    const th = e.th;
    const name = th.name || th.id;
    const sel = th.id === _selId;
    return `<button type="button" class="tcg-card${th.id === activeId ? ' is-active' : ''}${e.hidden ? ' is-hidden' : ''}" role="option"
            data-id="${escAttr(th.id)}" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" title="${escAttr(name)}">
        <span class="tcg-thumb">${thumbHtml(th)}</span>
        <span class="tcg-meta">
            <span class="tcg-name">${escHtml(name)}</span>
            <span class="tcg-sub">${escHtml(th.author || (e.src === 'builtin' ? 'BMM' : ''))}</span>
        </span>
        <span class="tcg-badges">${badgesHtml(e, activeId)}</span>
    </button>`;
}

function renderCatalog(): void {
    if (!_handle) return;
    const listEl = _handle.q('#theme-cat-list') as HTMLElement | null;
    if (!listEl) return;
    const activeId = getActiveTheme()?.id || null;
    const all = allEntries();

    // The source buttons count what the search and the mode filter leave.
    const base = all.filter((e) => matchesText(e.th) && matchesMode(e.th));
    const counts: Record<string, number> = { all: base.length, mine: 0, builtin: 0, catalog: 0 };
    for (const e of base) counts[e.src]++;
    _handle.dialog.querySelectorAll('#tcg-src [data-v]').forEach((b: HTMLElement) => {
        b.setAttribute('aria-pressed', String(b.dataset.v === _src));
        const n = counts[b.dataset.v || ''] ?? 0;
        let c = b.querySelector('.tcg-n');
        if (!c) { c = document.createElement('span'); c.className = 'tcg-n'; b.appendChild(c); }
        c.textContent = String(n);
    });
    _handle.dialog.querySelectorAll('#tcg-mode [data-v]').forEach((b: HTMLElement) => b.setAttribute('aria-pressed', String(b.dataset.v === _mode)));

    if (_loading && !all.length) {
        listEl.innerHTML = Array.from({ length: 8 }, () => `<span class="tcg-card is-skeleton" aria-hidden="true"><span class="tcg-thumb"></span><span class="tcg-meta"><span class="tcg-skel"></span><span class="tcg-skel is-short"></span></span></span>`).join('');
        renderDetail(null, activeId);
        return;
    }

    const shown = base.filter((e) => _src === 'all' || e.src === _src);
    if (!shown.length) {
        listEl.innerHTML = `<div class="bms-empty tcg-empty">
            <div class="bms-empty-ic">${PALETTE_SVG}</div>
            <div class="bms-empty-t">${escHtml(all.length ? t('themes.noMatch') : t('themes.noCatalog'))}</div>
            ${all.length ? `<button type="button" class="btn btn-ghost btn-sm" data-tcg-clear>${escHtml(t('themes.clearFilters'))}</button>` : ''}
        </div>`;
        renderDetail(null, activeId);
        return;
    }
    if (!_selId || !shown.some((e) => e.th.id === _selId)) _selId = (shown.find((e) => e.th.id === activeId) || shown[0]).th.id;

    const anyHidden = _builtins.some((b) => b._hidden);
    const section = (src: Src, label: string, extra = '') => {
        const items = shown.filter((e) => e.src === src);
        if (!items.length) return '';
        return `<div class="tcg-sec" role="presentation"><span class="bms-label">${escHtml(label)}</span><span class="tcg-n">${items.length}</span>${extra}</div>`
            + items.map((e) => cardHtml(e, activeId)).join('');
    };
    listEl.innerHTML =
        // Yours first: it is the section you came to find.
        section('mine', t('themes.mine'))
        + section('builtin', t('themes.defaultThemes'), anyHidden ? `<button type="button" class="btn btn-ghost btn-xs" id="btc-restore-all">${escHtml(t('themes.restoreAll'))}</button>` : '')
        + section('catalog', t('themes.catalogThemes'))
        + (_loading ? `<div class="tcg-sec tcg-loading" role="presentation">${escHtml(t('common.loading'))}</div>` : '');
    if (!listEl.querySelector('.tcg-card[tabindex="0"]')) listEl.querySelector('.tcg-card')?.setAttribute('tabindex', '0');
    renderDetail(entryById(_selId), activeId);
}

function select(id: string, focusCard = true): void {
    _selId = id;
    const listEl = _handle?.q('#theme-cat-list') as HTMLElement | null;
    listEl?.querySelectorAll<HTMLElement>('.tcg-card').forEach((c) => {
        const on = c.dataset.id === id;
        c.setAttribute('aria-selected', String(on));
        c.tabIndex = on ? 0 : -1;
        if (on && focusCard && document.activeElement !== c) c.focus({ preventScroll: true });
    });
    renderDetail(entryById(id), getActiveTheme()?.id || null);
}

const canApply = (e: Entry) => !e.hidden && (e.src !== 'catalog' || e.installed);

function renderDetail(e: Entry | null, activeId: string | null): void {
    const el = _handle?.q('#tcg-detail') as HTMLElement | null;
    if (!el) return;
    if (!e) {
        el.innerHTML = `<div class="bms-empty"><div class="bms-empty-t">${escHtml(_loading ? t('common.loading') : t('themes.pickOne'))}</div></div>`;
        return;
    }
    const th = e.th;
    const md = modeOf(th);
    const isActive = th.id === activeId;
    const srcLabel = e.src === 'mine' ? t('themes.mine') : e.src === 'builtin' ? t('themes.builtin') : t('themes.catalogThemes');
    const sw = (slot: string, label: string) => `<span class="tcg-sw"><span class="tcg-sw-dot is-${slot}"></span><span>${escHtml(label)}</span></span>`;
    let primary = '';
    if (isActive) primary = `<button type="button" class="btn btn-secondary btn-sm" disabled>${escHtml(t('themes.active'))}</button>`;
    else if (e.hidden) primary = `<button type="button" class="btn btn-primary btn-sm" data-act="reinstall">${escHtml(t('themes.reinstall'))}</button>`;
    else if (e.src === 'catalog' && !e.installed) primary = `<button type="button" class="btn btn-primary btn-sm" data-act="install">${escHtml(t('themes.install'))}</button>`;
    else primary = `<button type="button" class="btn btn-primary btn-sm" data-act="apply">${escHtml(t('themes.activate'))}</button>`;
    const secondary = [
        e.src === 'mine' ? `<button type="button" class="btn btn-secondary btn-sm" data-act="edit">${escHtml(t('themes.edit'))}</button>` : '',
        e.src === 'builtin' && !e.hidden && !isActive ? `<button type="button" class="btn btn-ghost btn-sm tcg-danger" data-act="uninstall">${escHtml(t('themes.uninstall'))}</button>` : '',
    ].join('');
    el.innerHTML = `
        <div class="tcg-hero">${thumbHtml(th, true)}</div>
        <div class="tcg-d-head">
            <h3 class="tcg-d-name">${escHtml(th.name || th.id)}</h3>
            <div class="tcg-d-sub">${escHtml([th.author || (e.src === 'builtin' ? 'BMM' : ''), th.version ? `v${th.version}` : ''].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="tcg-d-badges">
            <span class="bms-chip">${escHtml(srcLabel)}</span>
            ${md ? `<span class="bms-chip">${md === 'light' ? SUN_SVG : MOON_SVG}${escHtml(md === 'light' ? t('themes.modeLight') : t('themes.modeDark'))}</span>` : ''}
            ${isActive ? `<span class="bms-chip bms-chip--accent"><span class="bms-dot"></span>${escHtml(t('themes.active'))}</span>`
                : e.installed && e.src === 'catalog' ? `<span class="bms-chip bms-chip--ok"><span class="bms-dot"></span>${escHtml(t('themes.installed'))}</span>` : ''}
        </div>
        ${th.description ? `<p class="tcg-d-desc">${escHtml(th.description)}</p>` : ''}
        ${th.vars && Object.keys(th.vars).length ? `<div class="tcg-d-block">
            <div class="bms-label">${escHtml(t('themes.palette'))}</div>
            <div class="tcg-palette ${paintClass(th)}">
                ${sw('bg', t('themes.swBackground'))}${sw('card', t('themes.swSurface'))}${sw('acc', t('themes.swAccent'))}${sw('tx', t('themes.swText'))}
            </div>
        </div>` : ''}
        <div class="tcg-d-actions">${secondary}<span class="bms-spacer"></span>${primary}</div>`;
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function doApply(e: Entry): Promise<void> {
    await activateTheme(e.th.id);
    // The dialog stays open and repaints in the new colours: the preview IS the answer.
    renderCatalog();
}

async function doInstall(e: Entry, btn?: HTMLButtonElement): Promise<void> {
    if (btn) { btn.disabled = true; btn.textContent = t('common.loading'); }
    try {
        const theme = await resolveThemeBody(e.th);
        await installTheme(theme);
        toast(`${t('themes.installed')}: ${theme.name}`, 'success');
    } catch (err) {
        toast(`${t('themes.fetchFailed')}: ${err}`, 'error');
    }
    renderCatalog();
}

async function refreshBuiltins(): Promise<void> {
    try { _builtins = JSON.parse(await invoke('list_builtin_themes_all') as string || '[]'); } catch {}
    const { loadBuiltinThemes } = await import('./theme-engine.js');
    await loadBuiltinThemes(); // refresh the BUILTIN_THEMES used by every selector
    renderCatalog();
}

async function setBuiltinHidden(id: string, hidden: boolean): Promise<void> {
    try {
        await invoke('set_builtin_hidden', { themeId: id, hidden });
        toast(hidden ? t('themes.uninstalled') : t('themes.reinstalled'), 'success');
    } catch (err) { toast(String(err), 'error'); }
    await refreshBuiltins();
}

async function restoreAllDefaults(): Promise<void> {
    try {
        const hidden: string[] = JSON.parse(await invoke('list_builtin_themes_all') as string || '[]')
            .filter((b: any) => b._hidden).map((b: any) => b.id);
        for (const id of hidden) await invoke('set_builtin_hidden', { themeId: id, hidden: false });
        await refreshBuiltins();
        toast(t('themes.restoredAll'), 'success');
    } catch (e) { toast(String(e), 'error'); }
}

// ── Community sources ─────────────────────────────────────────────────────────

async function importFromFile(): Promise<void> {
    const { pickFiles } = await import('../../core/api.js');
    // SEVERAL. Somebody who has been sent a set of themes had to import them one at a time,
    // reopening the picker for each — and the modal closed after the first one, so the
    // picker had to be found again too.
    const paths = await pickFiles([
        { name: 'BMM Theme (.bmmtheme / .json)', extensions: ['bmmtheme', 'zip', 'json'] },
        { name: 'All files', extensions: ['*'] },
    ]).catch(() => null);
    if (!paths?.length) return;

    const ok: string[] = [];
    const bad: string[] = [];
    for (const path of paths) {
        const base = String(path).replace(/^.*[/\\]/, '');
        try {
            const raw: string = await invoke('import_theme', { path });
            const theme: BmmTheme = JSON.parse(raw);
            await installTheme(theme);
            ok.push(theme.name || base);
        } catch { bad.push(base); }
    }

    // Named, not counted: "2 failed" out of nine leaves you diffing a folder by hand.
    if (bad.length) {
        toast(t('themes.importFailed').replace('{list}', bad.slice(0, 4).join(', ')), 'warning', 8000);
    }
    if (!ok.length) return;
    toast(`${t('themes.imported') || 'Imported'}: ${ok.slice(0, 4).join(', ')}${ok.length > 4 ? '…' : ''}`, 'success');

    // The catalogue stays open and redraws, so the imported themes appear in "Your themes"
    // where they now have a section. It used to close and open the EDITOR instead, which is
    // a different screen from the one the import was started on.
    await fetchCatalog(true);
    renderCatalog();
}
