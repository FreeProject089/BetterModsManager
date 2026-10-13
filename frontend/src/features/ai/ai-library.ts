// ai-library.ts — Mod Library → « Analyser la bibliothèque ».
//
// The per-mod « Suggest » (ai-suggest.ts), for many mods in one pass: Rust reads each mod's own
// files (README*, *.md, *.txt, changelog, version files, manifest variants, in folders and in
// .zip archives; 7z/rar are listed, not read), then — only if the user turned AI on — lets Laya
// rank tags from THEIR vocabulary (`ai_analyze_library`, commands/ai.rs → ai_hybrid.rs). Never a
// generated draft in a batch: that stays a click in the per-mod dialog.
//
// Scope: this profile's library (what the page shows), some profiles, or every profile. A
// profile's library is the mods whose folder sits under its mods folder (get_mods' rule); the
// same mod id reached from two profiles is analysed once. The same mod INSTALLED in two
// profiles (two entries, same name and version) can be analysed once too: its suggestions
// then apply to every copy (tags and links are merged in Rust, never replaced).
//
// Nothing is written until the user applies: a mod (its ticked rows), a profile's mods, or
// everything (« Apply all »). The two batch applies first show what will change (counted per
// field, guesses left out unless asked) and keep a snapshot of every mod they touch, so the
// last batch can be undone (`update_mod_meta` with the snapshot). Each field goes through
// `ai_apply_mod_metadata`, validated again in Rust.
import { invoke, listen } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { rowsFromSuggestions, toggleRow, buildFields, pct, providerBlock, type SuggestionRow, type AiSuggestion } from './ai-model.js';
import { ensureAiCss, loadAiView, sourceLabel, fieldLabel, reasonText } from './ai-shared.js';
import { installFocusTrap, ownsFocus } from '../../ui/focus-trap.js';
import { uiIcon } from '../../ui/icons.js';

export interface LibraryOpts {
    /** The library as the page holds it (id, name, description, tags…). */
    getMods: () => any[];
    tagName: (id: string) => string;
    /** A mod was updated by « Appliquer » (the Rust copy of it), or restored by « Undo ». */
    onApplied: (mod: any, res: any) => void;
}

interface Item {
    id: string; name: string; rows: SuggestionRow[]; notes: string[]; done: boolean; error?: string;
    /** The same mod installed in other profiles: applied together with this one. */
    copies: string[];
    /** Profile ids whose library holds this mod (or one of its copies). */
    profiles: string[];
}
interface ProfileLite { id: string; name: string; modsPath: string; color: string | null }
/** What `update_mod_meta` needs to put a mod back exactly as it was. */
interface Snap { id: string; name: string; author: string; description: string; version: string; tags: string[]; downloadLinks: any[]; dependencies: string[] }

const IC = (uiIcon('ai', 16));
const FIELDS = ['description', 'tags', 'version', 'author', 'name', 'links'] as const;

let _overlay: HTMLElement | null = null;
let _opener: HTMLElement | null = null;
let _running = false;

function overlay(): HTMLElement {
    if (_overlay && _overlay.isConnected) return _overlay;
    const o = document.createElement('div');
    o.className = 'modal-overlay ai-overlay';
    o.id = 'modal-ai-library';
    (document.getElementById('app-window-outer') || document.body).appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o && !_running) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && o.classList.contains('open') && ownsFocus(o) && !_running) close(); });
    installFocusTrap(o, () => o.classList.contains('open') && ownsFocus(o));
    _overlay = o;
    return o;
}

function close(): void {
    if (!_overlay?.classList.contains('open')) return;
    _overlay.classList.remove('open');
    const back = _opener; _opener = null;
    try { if (back?.isConnected) back.focus(); } catch { /* nothing to return to */ }
}

/** A mod the batch should look at first: no description, or no tag. */
export function isIncomplete(m: any): boolean {
    return !String(m?.description || '').trim() || !(Array.isArray(m?.tags) && m.tags.length);
}

/** A path as a comparable prefix: forward slashes, no `\\?\`, lower case, one trailing slash. */
export function normDir(p: unknown): string {
    const s = String(p || '').replace(/^\\\\\?\\/, '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return s ? `${s}/` : '';
}

/** Which profiles' libraries hold each mod: the mod's folder sits under the profile's mods folder. */
export function profilesOfMods(mods: any[], profiles: ProfileLite[]): Map<string, string[]> {
    const roots = profiles.map((p) => [p.id, normDir(p.modsPath)] as const).filter(([, r]) => r);
    const out = new Map<string, string[]>();
    for (const m of mods) {
        const dir = normDir(m?.mod_folder_path);
        out.set(String(m.id), roots.filter(([, r]) => dir.startsWith(r)).map(([id]) => id));
    }
    return out;
}

/** The same mod installed in several profiles: same name and version, different entries. */
export function copyKey(m: any): string {
    const name = String(m?.name || '').trim().toLowerCase();
    return name ? `${name}|${String(m?.version || '').trim().toLowerCase()}` : '';
}

/** One row per field when nothing is ticked: the first value of a scalar field, every tag/link. */
function autoPick(rows: SuggestionRow[], guesses: boolean): SuggestionRow[] {
    let out = rows.map((r) => ({ ...r, checked: false }));
    for (const r of rows) {
        if (!r.applicable || (r.uncertain && !guesses)) continue;
        if ((r.field !== 'tags' && r.field !== 'links') && out.some((x) => x.checked && x.field === r.field)) continue;
        out = toggleRow(out, r.key, true);
    }
    return out;
}

const snapOf = (m: any): Snap => ({
    id: String(m.id), name: String(m.name ?? ''), author: String(m.author ?? ''), description: String(m.description ?? ''),
    version: String(m.version ?? ''), tags: Array.isArray(m.tags) ? [...m.tags] : [],
    downloadLinks: Array.isArray(m.download_links) ? m.download_links.map((l: any) => ({ ...l })) : [],
    dependencies: Array.isArray(m.dependencies) ? [...m.dependencies] : [],
});

export async function openAnalyzeLibrary(opts: LibraryOpts): Promise<void> {
    ensureAiCss();
    const o = overlay();
    if (!o.classList.contains('open')) {
        const a = document.activeElement as HTMLElement | null;
        _opener = a && a !== document.body && !o.contains(a) ? a : null;
    }
    const view = await loadAiView();
    const block = providerBlock(view?.settings as any, 'mod');
    const here = opts.getMods() || [];

    // Every profile's library, read once per opening. If it cannot be read, the dialog is the
    // old one: this profile only.
    let profiles: ProfileLite[] = [];
    let activeId = '';
    let allMods: any[] = here;
    try {
        const [ps, act, all] = await Promise.all([invoke('get_profiles'), invoke('get_active_profile_id'), invoke('get_all_mods')]) as [any[], string | null, any[]];
        profiles = (Array.isArray(ps) ? ps : []).map((p) => ({ id: String(p.id), name: String(p.name || p.game_name || p.id), modsPath: String(p.mods_path || ''), color: p.color || null }));
        activeId = String(act || '');
        if (Array.isArray(all) && all.length) allMods = all;
    } catch { profiles = []; }
    const byId = new Map<string, any>();
    for (const m of allMods) byId.set(String(m.id), m);
    for (const m of here) byId.set(String(m.id), { ...(byId.get(String(m.id)) || {}), ...m });
    const memberOf = profilesOfMods([...byId.values()], profiles);
    // This profile's library is what the page shows (get_mods canonicalises; we compare text).
    if (activeId) for (const m of here) { const l = memberOf.get(String(m.id)) || []; if (!l.includes(activeId)) memberOf.set(String(m.id), [...l, activeId]); }
    const profName = (id: string) => profiles.find((p) => p.id === id)?.name || id;
    const modsOfProfiles = (ids: Set<string>) => [...byId.values()].filter((m) => (memberOf.get(String(m.id)) || []).some((p) => ids.has(p)));
    const multi = profiles.length > 1;

    let items: Item[] = [];
    let summary = '';
    let scopeProfiles = new Set<string>(activeId ? [activeId] : []);
    let scopeKind: 'here' | 'pick' | 'every' = 'here';
    let modsFilter: 'incomplete' | 'all' | null = null;
    let dedupe = true;
    let lastBatch: { label: string; snaps: Snap[] } | null = null;
    let notice = '';

    const shell = (body: string, foot: string) => {
        o.innerHTML = `
        <div class="modal bms modal--lg ai-modal ai-lib" role="dialog" aria-modal="true" aria-labelledby="ail-title">
          <div class="modal-header">
            <div class="bms-icon" aria-hidden="true">${IC}</div>
            <h2 class="modal-title" id="ail-title">${escHtml(t('ai.lib.title'))}</h2>
            <button type="button" class="modal-close" id="ail-close" aria-label="${escAttr(t('common.close'))}" ${_running ? 'disabled' : ''}>${uiIcon('close', 16)}</button>
          </div>
          <div class="modal-body ai-body">${body}</div>
          <div class="modal-footer ai-foot">${foot}</div>
        </div>`;
        o.querySelector('#ail-close')?.addEventListener('click', () => { if (!_running) close(); });
    };

    /** The mods the current scope covers, and how many of them are copies of one another. */
    const scoped = () => {
        const set = scopeKind === 'here' || !multi ? null : scopeKind === 'every' ? new Set(profiles.map((p) => p.id)) : scopeProfiles;
        const mods = set ? modsOfProfiles(set) : here;
        const groups = new Map<string, any[]>();
        for (const m of mods) { const k = copyKey(m); if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(m); }
        // Copies only when they live in different profiles' libraries (not two entries side by side).
        const dupGroups = [...groups.values()].filter((g) => g.length > 1 && new Set(g.flatMap((m) => memberOf.get(String(m.id)) || [])).size > 1);
        return { mods, dupGroups, dupCopies: dupGroups.reduce((n, g) => n + g.length - 1, 0) };
    };

    // ── 1. What to analyse ────────────────────────────────────────────────
    const start = () => {
        const s = scoped();
        const incomplete = s.mods.filter(isIncomplete);
        const filter = modsFilter || (incomplete.length ? 'incomplete' : 'all');
        const profRows = profiles.map((p) => {
            const n = modsOfProfiles(new Set([p.id])).length;
            return `<label class="ai-check ail-prof"><input type="checkbox" data-prof="${escAttr(p.id)}" ${scopeProfiles.has(p.id) ? 'checked' : ''}>
                <span class="ail-prof-dot"${/^#[0-9a-f]{3,8}$/i.test(p.color || '') ? ` style="--ail-dot:${p.color}"` : ''} aria-hidden="true"></span>
                <span class="ail-prof-name">${escHtml(p.name)}${p.id === activeId ? ` <span class="ai-muted">(${escHtml(t('ai.lib.current'))})</span>` : ''}</span>
                <span class="ai-muted">${escHtml(t('ai.lib.nMods', { n: String(n) }))}</span></label>`;
        }).join('');
        shell(`
            <p class="ai-lead">${escHtml(t('ai.lib.lead'))}</p>
            ${multi ? `<fieldset class="ail-group">
              <legend class="ail-legend">${escHtml(t('ai.lib.scopeProfiles'))}</legend>
              <label class="ai-check"><input type="radio" name="ail-where" value="here" ${scopeKind === 'here' ? 'checked' : ''}> <span>${escHtml(t('ai.lib.whereHere', { n: String(here.length) }))}</span></label>
              <label class="ai-check"><input type="radio" name="ail-where" value="pick" ${scopeKind === 'pick' ? 'checked' : ''}> <span>${escHtml(t('ai.lib.wherePick'))}</span></label>
              ${scopeKind === 'pick' ? `<div class="ail-profs">${profRows}</div>` : ''}
              <label class="ai-check"><input type="radio" name="ail-where" value="every" ${scopeKind === 'every' ? 'checked' : ''}> <span>${escHtml(t('ai.lib.whereEvery', { p: String(profiles.length), n: String(modsOfProfiles(new Set(profiles.map((p) => p.id))).length) }))}</span></label>
            </fieldset>` : ''}
            <fieldset class="ail-group">
              <legend class="ail-legend">${escHtml(t('ai.lib.scopeMods'))}</legend>
              <label class="ai-check"><input type="radio" name="ail-scope" value="incomplete" ${filter === 'incomplete' ? 'checked' : ''} ${incomplete.length ? '' : 'disabled'}> <span>${escHtml(t('ai.lib.scopeIncomplete', { n: String(incomplete.length) }))}</span></label>
              <label class="ai-check"><input type="radio" name="ail-scope" value="all" ${filter === 'all' ? 'checked' : ''}> <span>${escHtml(t('ai.lib.scopeAll', { n: String(s.mods.length) }))}</span></label>
            </fieldset>
            <fieldset class="ail-group">
              <legend class="ail-legend">${escHtml(t('ai.lib.scopeOptions'))}</legend>
              ${s.dupCopies ? `<label class="ai-check"><input type="checkbox" id="ail-dedupe" ${dedupe ? 'checked' : ''}> <span>${escHtml(t('ai.lib.dedupe', { n: String(s.dupGroups.length), c: String(s.dupCopies) }))}</span></label>` : ''}
              <label class="ai-check"><input type="checkbox" id="ail-laya" ${block ? 'disabled' : 'checked'}> <span>${escHtml(t('ai.lib.useLaya'))}${block ? ` <span class="ai-muted">(${escHtml(reasonText(block))})</span>` : ''}</span></label>
            </fieldset>`,
            `<span class="ai-muted ai-foot-note">${escHtml(t('ai.lib.nothingWritten'))}</span>
             <button type="button" class="btn btn-ghost btn-sm" id="ail-cancel">${escHtml(t('common.cancel'))}</button>
             <button type="button" class="btn btn-primary btn-sm" id="ail-go" ${s.mods.length ? '' : 'disabled'}>${escHtml(t('ai.lib.go'))}</button>`);
        o.querySelector('#ail-cancel')?.addEventListener('click', close);
        o.querySelectorAll<HTMLInputElement>('input[name="ail-where"]').forEach((r) => r.addEventListener('change', () => {
            scopeKind = r.value as typeof scopeKind;
            if (scopeKind === 'pick' && !scopeProfiles.size && activeId) scopeProfiles.add(activeId);
            modsFilter = null;
            start();
            o.querySelector<HTMLInputElement>(`input[name="ail-where"][value="${scopeKind}"]`)?.focus();
        }));
        o.querySelectorAll<HTMLInputElement>('input[data-prof]').forEach((cb) => cb.addEventListener('change', () => {
            const id = cb.dataset.prof || '';
            if (cb.checked) scopeProfiles.add(id); else scopeProfiles.delete(id);
            start();
            o.querySelector<HTMLInputElement>(`input[data-prof="${CSS.escape(id)}"]`)?.focus();
        }));
        o.querySelectorAll<HTMLInputElement>('input[name="ail-scope"]').forEach((r) => r.addEventListener('change', () => { modsFilter = r.value as 'incomplete' | 'all'; }));
        o.querySelector<HTMLInputElement>('#ail-dedupe')?.addEventListener('change', (e) => { dedupe = (e.target as HTMLInputElement).checked; });
        o.querySelector('#ail-go')?.addEventListener('click', () => {
            const which = (o.querySelector<HTMLInputElement>('input[name="ail-scope"]:checked')?.value) || 'all';
            const laya = !!o.querySelector<HTMLInputElement>('#ail-laya')?.checked && !block;
            const cur = scoped();
            const list = which === 'incomplete' ? cur.mods.filter(isIncomplete) : cur.mods;
            // One analysis per group of copies (the first one in the list stands for the others).
            const copiesOf = new Map<string, string[]>();
            let ids = list.map((m) => String(m.id));
            if (dedupe && cur.dupCopies) {
                const inList = new Set(ids);
                const drop = new Set<string>();
                for (const g of cur.dupGroups) {
                    const present = g.map((m) => String(m.id)).filter((id) => inList.has(id));
                    if (present.length < 2) continue;
                    // A copy outside the filter still gets the result: it is the same mod.
                    const [lead, ...rest] = g.map((m) => String(m.id)).sort((a, b) => (inList.has(b) ? 1 : 0) - (inList.has(a) ? 1 : 0));
                    copiesOf.set(lead, rest);
                    rest.forEach((id) => drop.add(id));
                }
                ids = ids.filter((id) => !drop.has(id));
            }
            void run(ids, laya, copiesOf);
        });
        o.querySelector<HTMLElement>('#ail-go')?.focus();
    };

    // ── 2. The run, with its progress ─────────────────────────────────────
    const run = async (ids: string[], laya: boolean, copiesOf: Map<string, string[]>) => {
        const total = ids.length;
        _running = true;
        lastBatch = null; notice = '';
        shell(`
            <div class="ai-lib-progress">
              <progress id="ail-bar" max="${Math.max(1, total)}" value="0"></progress>
              <div class="ai-muted" id="ail-count" aria-live="polite">${escHtml(t('ai.lib.progress', { done: '0', total: String(total) }))}</div>
            </div>`,
            `<button type="button" class="btn btn-ghost btn-sm" id="ail-stop">${escHtml(t('ai.lib.stop'))}</button>`);
        o.querySelector('#ail-stop')?.addEventListener('click', () => {
            void invoke('ai_analyze_cancel');
            const b = o.querySelector<HTMLButtonElement>('#ail-stop');
            if (b) { b.disabled = true; b.textContent = t('ai.lib.stopping'); }
        });
        const stop = await listen('ai-analyze-progress', (p: any) => {
            const bar = o.querySelector<HTMLProgressElement>('#ail-bar');
            const c = o.querySelector('#ail-count');
            if (bar) { bar.max = Math.max(1, Number(p?.total) || total); bar.value = Number(p?.done) || 0; }
            if (c) c.textContent = t('ai.lib.progress', { done: String(p?.done ?? 0), total: String(p?.total ?? total) });
        });
        try {
            const r: any = await invoke('ai_analyze_library', { modIds: ids, useProviders: laya, draft: false });
            items = (r?.items || []).map((it: any) => {
                const id = String(it.modId);
                const m = byId.get(id) || { id: it.modId, name: it.name };
                const copies = copiesOf.get(id) || [];
                const profs = [...new Set([id, ...copies].flatMap((x) => memberOf.get(x) || []))];
                return { id, name: String(m.name || it.name || it.modId), rows: rowsFromSuggestions((it.suggestions || []) as AiSuggestion[], m, opts.tagName), notes: it.notes || [], done: false, copies, profiles: profs };
            }).filter((it: Item) => it.rows.some((r) => r.applicable));
            // « Réponses de Laya » for the library: percent bars, and « apply without asking »
            // for Laya's tags (never a guess kept under the threshold, never a file's value).
            const tune = (r?.items || [])[0]?.tuning || {};
            showProbs = tune.showProbs !== false;
            autoApply = !!tune.autoApply;
            summary = r?.cancelled ? t('ai.lib.summaryStopped', { n: String(items.length), ms: String(Math.round((r?.ms || 0) / 100) / 10) }) : t('ai.lib.summary', { n: String(items.length), total: String(r?.total ?? total), s: String(Math.round((r?.ms || 0) / 100) / 10) });
        } catch (e) {
            summary = reasonText(String((e as Error)?.message || e));
            items = [];
        } finally {
            stop();
            _running = false;
        }
        review();
        if (autoApply) {
            for (const it of items) {
                let any = false;
                for (const r of it.rows) {
                    if (r.field === 'tags' && r.applicable && !r.uncertain && (r.source === 'laya' || r.source === 'embedded')) { it.rows = toggleRow(it.rows, r.key, true); any = true; }
                }
                if (any) await apply(it.id);
            }
        }
    };
    let showProbs = true;
    let autoApply = false;

    // ── 3. Review: per mod, per field; apply one, a profile's, or all ─────
    const rowHtml = (it: Item, r: SuggestionRow) => `
        <label class="ai-row${r.checked ? ' is-on' : ''}${r.applicable ? '' : ' is-hint'}">
          <input type="checkbox" data-mod="${escAttr(it.id)}" data-row="${escAttr(r.key)}" ${r.checked ? 'checked' : ''} ${r.applicable && !it.done ? '' : 'disabled'} aria-label="${escAttr(fieldLabel(r.field))}">
          <span class="ai-row-main">
            <span class="ai-row-head"><b>${escHtml(fieldLabel(r.field))}</b>
              <span class="ai-src ai-src-${escAttr(r.source)}">${escHtml(sourceLabel(r.source))}</span>
              <span class="ai-origin">${escHtml(r.origin)}</span>
              ${showProbs ? `<span class="ai-conf" title="${escAttr(t('ai.suggest.confidence'))}">${pct(r.confidence)}%</span>` : ''}
              ${r.uncertain ? `<span class="ai-src ai-src-unsure">${escHtml(t('ai.lt.guessBadge'))}</span>` : ''}</span>
            <span class="ai-value${r.field === 'description' ? ' ai-value-multi' : ''}">${escHtml(r.display)}</span>
          </span>
        </label>`;
    const itemHtml = (it: Item) => {
        const n = it.rows.filter((r) => r.checked).length;
        const shown = it.rows.filter((r) => r.applicable);
        const chips = multi && (scopeKind !== 'here') ? it.profiles.map((p) => `<span class="bms-chip ail-chip">${escHtml(profName(p))}</span>`).join('') : '';
        return `
        <details class="ai-lib-item${it.done ? ' is-done' : ''}" data-item="${escAttr(it.id)}" ${openIds.has(it.id) ? 'open' : ''}>
          <summary><span class="ai-lib-name">${escHtml(it.name)}</span>
            ${it.copies.length ? `<span class="bms-chip ail-chip" title="${escAttr(t('ai.lib.copiesHint'))}">${escHtml(t('ai.lib.copies', { n: String(it.copies.length + 1) }))}</span>` : ''}
            ${chips}
            <span class="ai-muted">${it.done ? escHtml(t('ai.lib.applied')) : escHtml(t('ai.lib.nSugg', { n: String(shown.length) }))}</span></summary>
          <div class="ai-rows">${shown.map((r) => rowHtml(it, r)).join('')}</div>
          ${it.error ? `<div class="ai-error">${escHtml(it.error)}</div>` : ''}
          ${it.done ? '' : `<div class="ai-lib-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-all="${escAttr(it.id)}">${escHtml(t('ai.lib.tickAll'))}</button>
            <button type="button" class="btn btn-primary btn-sm" data-apply="${escAttr(it.id)}" ${n ? '' : 'disabled'}>${escHtml(t('ai.lib.apply', { n: String(n) }))}</button></div>`}
        </details>`;
    };
    const openIds = new Set<string>();
    const pending = (list: Item[]) => list.filter((it) => !it.done);
    /** Sections per profile when the scope spans several; a mod in two profiles is listed in the first. */
    const sections = (): { id: string; label: string; items: Item[] }[] => {
        if (!multi || scopeKind === 'here') return [{ id: '', label: '', items }];
        const order = profiles.map((p) => p.id);
        const out = new Map<string, Item[]>();
        for (const it of items) {
            const p = order.find((id) => it.profiles.includes(id)) || '';
            if (!out.has(p)) out.set(p, []);
            out.get(p)!.push(it);
        }
        return [...out.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([id, list]) => ({ id, label: id ? profName(id) : t('ai.lib.otherMods'), items: list }));
    };
    const review = () => {
        const secs = sections();
        const left = pending(items).length;
        const list = items.length
            ? `<div class="ai-lib-list">${secs.map((s) => `${s.label ? `<div class="ail-sec">
                    <span class="ail-sec-title">${escHtml(s.label)}</span>
                    <span class="ai-muted">${escHtml(t('ai.lib.nMods', { n: String(s.items.length) }))}</span>
                    ${pending(s.items).length ? `<button type="button" class="btn btn-ghost btn-sm" data-apply-group="${escAttr(s.id)}">${escHtml(t('ai.lib.applyGroup', { n: String(pending(s.items).length) }))}</button>` : ''}
                </div>` : ''}${s.items.map(itemHtml).join('')}`).join('')}</div>`
            : `<div class="ai-empty">${escHtml(t('ai.lib.none'))}</div>`;
        const undoBar = lastBatch ? `<div class="ail-undo" role="status">
                ${uiIcon('success', 14)} <span>${escHtml(lastBatch.label)}</span>
                <button type="button" class="btn btn-ghost btn-sm" id="ail-undo">${uiIcon('undo', 14)} ${escHtml(t('ai.lib.undo'))}</button>
            </div>` : notice ? `<div class="ail-undo" role="status"><span>${escHtml(notice)}</span></div>` : '';
        shell(`<div class="ail-head"><div class="ai-muted ai-lib-summary">${escHtml(summary)}</div></div>${undoBar}${list}`,
            `<span class="ai-muted ai-foot-note">${escHtml(t('ai.lib.nothingWritten'))}</span>
             <button type="button" class="btn btn-ghost btn-sm" id="ail-again">${escHtml(t('ai.lib.again'))}</button>
             ${left ? `<button type="button" class="btn btn-secondary btn-sm" id="ail-apply-all">${uiIcon('check', 14)} ${escHtml(t('ai.lib.applyAll', { n: String(left) }))}</button>` : ''}
             <button type="button" class="btn btn-primary btn-sm" id="ail-done">${escHtml(t('common.close'))}</button>`);
        o.querySelector('#ail-done')?.addEventListener('click', close);
        o.querySelector('#ail-again')?.addEventListener('click', start);
        o.querySelector('#ail-apply-all')?.addEventListener('click', () => confirmBatch(pending(items), t('ai.lib.everything')));
        o.querySelector('#ail-undo')?.addEventListener('click', () => void undo());
        o.querySelectorAll<HTMLButtonElement>('[data-apply-group]').forEach((b) => b.addEventListener('click', () => {
            const s = sections().find((x) => x.id === (b.dataset.applyGroup || ''));
            if (s) confirmBatch(pending(s.items), s.label);
        }));
        o.querySelectorAll<HTMLDetailsElement>('details[data-item]').forEach((d) => d.addEventListener('toggle', () => { const id = d.dataset.item || ''; if (d.open) openIds.add(id); else openIds.delete(id); }));
        o.querySelectorAll<HTMLInputElement>('input[data-row]').forEach((cb) => cb.addEventListener('change', () => {
            const it = items.find((x) => x.id === cb.dataset.mod);
            if (!it) return;
            it.rows = toggleRow(it.rows, cb.dataset.row || '', cb.checked);
            repaintItem(it);
        }));
        o.querySelectorAll<HTMLButtonElement>('[data-all]').forEach((b) => b.addEventListener('click', () => {
            const it = items.find((x) => x.id === b.dataset.all);
            if (!it) return;
            // One value per scalar field: toggleRow keeps the first one ticked, the others off.
            for (const r of it.rows) if (r.applicable && !it.rows.some((x) => x.checked && x.field === r.field && x.key !== r.key && r.field !== 'tags' && r.field !== 'links')) it.rows = toggleRow(it.rows, r.key, true);
            repaintItem(it);
        }));
        o.querySelectorAll<HTMLButtonElement>('[data-apply]').forEach((b) => b.addEventListener('click', () => void apply(b.dataset.apply || '')));
    };
    const repaintItem = (it: Item) => {
        openIds.add(it.id);
        review();
        o.querySelector<HTMLElement>(`details[data-item="${CSS.escape(it.id)}"] summary`)?.focus();
    };

    /** Writes one mod's chosen rows to the mod and its copies; the snapshots go to `snaps`. */
    const writeItem = async (it: Item, rows: SuggestionRow[], snaps: Snap[]): Promise<number> => {
        const fields = buildFields(rows);
        if (!Object.keys(fields).length) return 0;
        let n = 0;
        try {
            for (const id of [it.id, ...it.copies]) {
                const before = byId.get(id);
                if (before) snaps.push(snapOf(before));
                const res: any = await invoke('ai_apply_mod_metadata', { modId: id, fields });
                if (res?.mod) byId.set(id, { ...(before || {}), ...res.mod });
                opts.onApplied(res?.mod, res);
                n++;
            }
            it.done = true;
            it.error = undefined;
        } catch (e) {
            it.error = String((e as Error)?.message || e);
        }
        return n;
    };
    const apply = async (id: string) => {
        const it = items.find((x) => x.id === id);
        if (!it) return;
        const snaps: Snap[] = [];
        const n = await writeItem(it, it.rows, snaps);
        if (n) { lastBatch = { label: t('ai.lib.appliedOne', { name: it.name, n: String(n) }), snaps }; notice = ''; }
        repaintItem(it);
    };

    // ── 4. Apply many: what will change, then the writes, then « Undo » ────
    const rowsFor = (it: Item, guesses: boolean, kinds: Set<string>) => {
        // What the user ticked stays as ticked (a guess included); otherwise one pick per field.
        const base = it.rows.some((r) => r.checked) ? it.rows : autoPick(it.rows, guesses);
        return base.map((r) => (r.checked && !kinds.has(r.field) ? { ...r, checked: false } : r));
    };
    const confirmBatch = (list: Item[], label: string) => {
        if (!list.length) return;
        const kinds = new Set<string>(FIELDS);
        let guesses = false;
        const paint = () => {
            const per = new Map<string, number>();
            let mods = 0, copies = 0, changes = 0;
            for (const it of list) {
                const rows = rowsFor(it, guesses, kinds).filter((r) => r.checked && r.applicable);
                if (!rows.length) continue;
                mods++; copies += it.copies.length; changes += rows.length;
                for (const r of rows) per.set(r.field, (per.get(r.field) || 0) + 1);
            }
            const allPer = new Map<string, number>();
            let nGuess = 0;
            for (const it of list) {
                const ticked = it.rows.some((r) => r.checked);
                for (const r of ticked ? it.rows : autoPick(it.rows, true)) if (r.checked) { allPer.set(r.field, (allPer.get(r.field) || 0) + 1); if (r.uncertain && !ticked) nGuess++; }
            }
            const profsTouched = new Set(list.filter((it) => rowsFor(it, guesses, kinds).some((r) => r.checked)).flatMap((it) => it.profiles));
            shell(`
                <div class="ail-confirm">
                  <p class="ai-lead">${escHtml(t('ai.lib.confirmLead', { what: label }))}</p>
                  <div class="ail-stats">
                    <div class="ail-stat"><b>${changes}</b><span>${escHtml(t('ai.lib.statChanges'))}</span></div>
                    <div class="ail-stat"><b>${mods + copies}</b><span>${escHtml(t('ai.lib.statMods'))}</span></div>
                    ${multi ? `<div class="ail-stat"><b>${profsTouched.size}</b><span>${escHtml(t('ai.lib.statProfiles'))}</span></div>` : ''}
                  </div>
                  <fieldset class="ail-group">
                    <legend class="ail-legend">${escHtml(t('ai.lib.confirmFields'))}</legend>
                    <div class="ail-kinds">${FIELDS.filter((f) => allPer.get(f)).map((f) => `<label class="ai-check"><input type="checkbox" data-kind="${f}" ${kinds.has(f) ? 'checked' : ''}> <span>${escHtml(fieldLabel(f))}</span> <span class="ai-muted">${per.get(f) || 0}</span></label>`).join('')}</div>
                    ${nGuess ? `<label class="ai-check"><input type="checkbox" id="ail-guesses" ${guesses ? 'checked' : ''}> <span>${escHtml(t('ai.lib.includeGuesses', { n: String(nGuess) }))}</span></label>` : ''}
                  </fieldset>
                  ${copies ? `<p class="ai-muted">${escHtml(t('ai.lib.confirmCopies', { n: String(copies) }))}</p>` : ''}
                  <p class="ai-muted">${escHtml(t('ai.lib.confirmUndo'))}</p>
                </div>`,
                `<button type="button" class="btn btn-ghost btn-sm" id="ail-back">${escHtml(t('ai.lib.back'))}</button>
                 <button type="button" class="btn btn-primary btn-sm" id="ail-go-all" ${changes ? '' : 'disabled'}>${escHtml(t('ai.lib.confirmGo', { n: String(changes), m: String(mods + copies) }))}</button>`);
            o.querySelector('#ail-back')?.addEventListener('click', review);
            o.querySelectorAll<HTMLInputElement>('input[data-kind]').forEach((cb) => cb.addEventListener('change', () => {
                if (cb.checked) kinds.add(cb.dataset.kind || ''); else kinds.delete(cb.dataset.kind || '');
                paint(); o.querySelector<HTMLInputElement>(`input[data-kind="${cb.dataset.kind}"]`)?.focus();
            }));
            o.querySelector<HTMLInputElement>('#ail-guesses')?.addEventListener('change', (e) => { guesses = (e.target as HTMLInputElement).checked; paint(); o.querySelector<HTMLElement>('#ail-guesses')?.focus(); });
            o.querySelector('#ail-go-all')?.addEventListener('click', () => void runBatch(list, guesses, kinds));
            o.querySelector<HTMLElement>('#ail-go-all')?.focus();
        };
        paint();
    };
    const runBatch = async (list: Item[], guesses: boolean, kinds: Set<string>) => {
        const work = list.map((it) => ({ it, rows: rowsFor(it, guesses, kinds) })).filter((w) => w.rows.some((r) => r.checked && r.applicable));
        _running = true;
        shell(`<div class="ai-lib-progress">
              <progress id="ail-bar" max="${Math.max(1, work.length)}" value="0"></progress>
              <div class="ai-muted" id="ail-count" aria-live="polite">${escHtml(t('ai.lib.applying', { done: '0', total: String(work.length) }))}</div>
            </div>`, '');
        const snaps: Snap[] = [];
        let mods = 0, failed = 0, done = 0;
        for (const w of work) {
            w.it.rows = w.rows;
            const n = await writeItem(w.it, w.rows, snaps);
            if (n) mods += n; else failed++;
            done++;
            const bar = o.querySelector<HTMLProgressElement>('#ail-bar');
            if (bar) bar.value = done;
            const c = o.querySelector('#ail-count');
            if (c) c.textContent = t('ai.lib.applying', { done: String(done), total: String(work.length) });
        }
        _running = false;
        lastBatch = snaps.length ? { label: t('ai.lib.appliedMany', { n: String(mods) }) + (failed ? ` ${t('ai.lib.failedN', { n: String(failed) })}` : ''), snaps } : null;
        notice = !snaps.length && failed ? t('ai.lib.failedN', { n: String(failed) }) : '';
        review();
        o.querySelector<HTMLElement>('#ail-undo')?.focus();
    };
    const undo = async () => {
        const b = lastBatch;
        if (!b) return;
        _running = true;
        let failed = 0;
        // Newest first: a mod written twice in one batch ends at its first snapshot.
        for (const s of [...b.snaps].reverse()) {
            try {
                await invoke('update_mod_meta', { modId: s.id, payload: { name: s.name, author: s.author, description: s.description, version: s.version, tags: s.tags, downloadLinks: s.downloadLinks, dependencies: s.dependencies } });
                const m = { ...(byId.get(s.id) || {}), id: s.id, name: s.name, author: s.author, description: s.description, version: s.version, tags: s.tags, download_links: s.downloadLinks, dependencies: s.dependencies };
                byId.set(s.id, m);
                opts.onApplied(m, { modId: s.id, undone: true });
            } catch { failed++; }
        }
        const restored = new Set(b.snaps.map((s) => s.id));
        for (const it of items) if (restored.has(it.id)) it.done = false;
        _running = false;
        lastBatch = null;
        notice = t('ai.lib.undone', { n: String(new Set(b.snaps.map((s) => s.id)).size) }) + (failed ? ` ${t('ai.lib.failedN', { n: String(failed) })}` : '');
        review();
    };

    o.classList.add('open');
    start();
}

/** The icon button beside « Check for updates » in the library toolbar. */
export function mountAnalyzeButton(opts: LibraryOpts): void {
    if (document.getElementById('btn-lib-ai-analyze')) return;
    const anchor = document.getElementById('btn-lib-check-updates');
    if (!anchor) return;
    ensureAiCss();
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'btn-lib-ai-analyze';
    b.className = 'btn btn-icon btn-ghost btn-compact-toggle';
    b.innerHTML = IC;
    const label = () => { b.title = t('ai.lib.button'); b.setAttribute('aria-label', t('ai.lib.button')); };
    label();
    document.addEventListener('langChanged', label);
    b.addEventListener('click', () => { void openAnalyzeLibrary(opts); });
    anchor.insertAdjacentElement('afterend', b);
}
