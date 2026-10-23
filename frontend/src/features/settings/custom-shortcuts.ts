// custom-shortcuts.ts — « New shortcut »: pick an action, press its keys, choose where it works.
//
// The engine is core/commands.ts: one registry, one dispatcher, one overrides map. This file is
// the editor on top of it and what a custom shortcut does when pressed, loaded only when used.
//
// An action is either a registry command (it is simply given the keys, as the table would do), or
// a target the registry cannot list on its own: a Settings card, a profile, a modpack, an
// automation. Those become a custom shortcut (commands.ts saveCustomShortcut), registered as an
// ordinary command so the palette and the dispatcher know it like any other.
//
// The keys are refused when they belong to the system or to BMM (reservedChord), and a clash
// with another command in the same place is said before saving: saving takes the keys from it,
// so two commands never wait on the same combination.
//
// « Keys » means any device: a keyboard combination, a mouse button, a modified wheel turn or
// gamepad buttons (commands.ts startChordRecorder).
//
// « Pick in BMM » (the eyedropper) makes a shortcut out of any button on screen: the dialog steps
// aside, the controls light up under the pointer, a click records the one under it. What is
// stored is a selector, re-resolved at every press, and the click goes through the SAME guard as
// an automation's `nav.click` (sched-nav-model sensitiveReason, read off the element by
// sched-nav factsOf): nothing in a consent dialog, no credential form, no delete or danger
// control, and nothing inside a sandboxed custom page.

import {
    allCommands, bindingOf, setBinding, chordLabel, keycapsHtml, reservedChord, clashWith, scopeOf, parseChord,
    readCustomShortcuts, saveCustomShortcut, deleteCustomShortcut, getCommand, exportShortcutData, importShortcutData,
    isShortcutFile, shortcutFileCustom, refreshNavCommands, startChordRecorder, currentView,
    viewLabel, type Chord, type Command, type CustomShortcut, type CustomKind, type ImportDecision,
} from '../../core/commands.js';
import { missingEntries, type MissingEntry } from '../../core/shortcut-model.js';
import { getLang, t } from '../../core/i18n.js';
import { invoke, saveFile, pickFile } from '../../core/api.js';
import { goToSettings } from '../../core/settings-link.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { openModal } from '../../ui/modal-shell.js';
import { uiIcon } from '../../ui/icons.js';
import { toast } from '../../ui/app.js';

type L = { en: string; fr: string };
const tr = (s: L): string => (getLang() === 'fr' ? s.fr : s.en);

// ── What a custom shortcut does ─────────────────────────────────────────────────────

function settingsCard(key: string): HTMLElement | null {
    return (document.getElementById(key)
        || document.querySelector(`#view-settings .settings-sections > .glass-card[data-card-key="${CSS.escape(key)}"]`)) as HTMLElement | null;
}

export async function runCustomShortcut(cs: CustomShortcut): Promise<void> {
    if (cs.kind === 'settings') {
        const card = settingsCard(cs.target);
        if (!card) { toast(t('skd.gone'), 'warning'); return; }
        // goToSettings finds its target by id; a card known only by its data-card-key gets one.
        if (!card.id) card.id = 'stg-card-' + cs.target.replace(/[^\w-]+/g, '-');
        goToSettings(card.id);
        return;
    }
    if (cs.kind === 'profile') {
        // The library's profile selector is the switch the user would use, with its refreshes.
        const sel = document.getElementById('lib-profile-select') as HTMLSelectElement | null;
        if (sel && Array.from(sel.options).some((o) => o.value === cs.target)) {
            if (sel.value !== cs.target) { sel.value = cs.target; sel.dispatchEvent(new Event('change', { bubbles: true })); }
            toast(cs.label, 'success', 1800);
            return;
        }
        const profiles = (await invoke('get_profiles').catch(() => [])) as any[];
        if (!profiles.some((p) => p.id === cs.target)) { toast(t('skd.gone'), 'warning'); return; }
        await invoke('set_active_profile', { profileId: cs.target });
        await (window as any)._refreshModsFn?.(true);
        await (window as any)._refreshProfilesFn?.();
        toast(cs.label, 'success', 1800);
        return;
    }
    if (cs.kind === 'modpack') {
        // Opens the modpack's activation screen (what it will enable, then Confirm): a key press
        // must not change dozens of mods without showing which.
        const packs = (await invoke('load_modpacks').catch(() => [])) as any[];
        const pack = packs.find((p) => p.id === cs.target);
        if (!pack) { toast(t('skd.gone'), 'warning'); return; }
        const { openModpackActivation } = await import('../mods/modpack-activate.js');
        await openModpackActivation(pack);
        return;
    }
    if (cs.kind === 'automation') {
        const s = await import('./scheduler.js');
        const task = await s.findTask(cs.target);
        if (!task) { toast(t('skd.gone'), 'warning'); return; }
        toast(cs.label, 'info', 1800);
        await s.runTaskById(cs.target);
        return;
    }
    if (cs.kind === 'element') await runElement(cs);
}

// ── A picked control: find it again, check it, press it ─────────────────────────────

const VIEW_RE = /^[\w-]{1,60}$/;
function queryOne(sel: string): HTMLElement | null {
    try { return document.querySelector<HTMLElement>(sel); } catch { return null; }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function runElement(cs: CustomShortcut): Promise<void> {
    const { isShown, reveal } = await import('../../ui/tutorial-reveal.js');
    let el = queryOne(cs.target);
    // Not on screen and picked on another page: open that page first, as the user would, and
    // give it a moment to build its content.
    if ((!el || !isShown(el)) && cs.view && VIEW_RE.test(cs.view) && currentView() !== cs.view) {
        const v = CSS.escape(cs.view);
        document.querySelector<HTMLElement>(`.nav-item[data-view="${v}"], .nav-item[data-custom-id="${v}"]`)?.click();
        for (let i = 0; i < 20 && !(el && isShown(el)); i++) { await sleep(75); el = queryOne(cs.target); }
        // A page often draws itself twice on arrival (static markup, then its rendered content):
        // let it settle and look again, so the click lands on the element that stays.
        await sleep(200);
        el = queryOne(cs.target) || el;
    }
    if (el && !isShown(el)) reveal(el, null);   // a closed tab or <details>: opened, never forced
    if (!el || !el.isConnected || !isShown(el)) { toast(t('skd.elGone', { name: cs.label }), 'warning'); return; }
    const guard = await loadGuard();
    el = queryOne(cs.target) || el;              // the import above may have let the page redraw
    const why = guard(el);
    if (why) { toast(t('skd.elRefused', { name: cs.label, why: reasonText(why) }), 'warning'); return; }
    el.click();
}

/** The guard shared with automations' nav.click, plus what only a picked control can be. */
type Guard = (el: HTMLElement) => string | null;
let _guard: Guard | null = null;
async function loadGuard(): Promise<Guard> {
    if (_guard) return _guard;
    const [{ factsOf }, { sensitiveReason }] = await Promise.all([import('./sched-nav.js'), import('./sched-nav-model.js')]);
    _guard = (el) => {
        // A sandboxed custom page (or any frame) is its own world: BMM never reaches into it.
        if (el.closest('.custom-url-view, .custom-page-view, iframe')) return 'sandbox';
        if (el.closest('.sk-dlg, .skd-pick-layer')) return 'self';
        return sensitiveReason(factsOf(el));
    };
    return _guard;
}
const WHY_KEYS: Record<string, string> = {
    disabled: 'skd.why.disabled', field: 'skd.why.field', consent: 'skd.why.consent', credentials: 'skd.why.credentials',
    danger: 'skd.why.danger', sandbox: 'skd.why.sandbox', self: 'skd.why.self', noSelector: 'skd.why.noSelector',
};
function reasonText(why: string): string {
    return t(WHY_KEYS[why] || WHY_KEYS.danger);
}

/** What a picked control may be: a thing you press. */
const CLICKABLE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], .nav-item, [data-tab], summary';
const SEL_ATTRS = ['data-view', 'data-custom-id', 'data-tab', 'data-repo-tab', 'data-api-sec', 'data-act', 'data-action',
    'data-cmd', 'data-card-key', 'data-id', 'data-key', 'data-target', 'data-section', 'data-mode', 'data-filter', 'data-page'];
/** An id that a build or a counter made, which will not be the same next launch. */
const autoId = (id: string): boolean => /^\d|\d{4,}|[0-9a-f]{10,}|^(bms|ember|react|radix|ui-id|mui)[-_]/i.test(id);

/**
 * A selector that finds this element and only it: its id; else its tag and a data attribute,
 * alone or under the nearest ancestor with a stable id; else a short path of positions from that
 * ancestor. Null when none is unique: such a control cannot be found again, so it is refused.
 */
export function stableSelector(el: HTMLElement): string | null {
    const unique = (sel: string): boolean => {
        if (sel.length > 300) return false;
        try { const l = document.querySelectorAll(sel); return l.length === 1 && l[0] === el; } catch { return false; }
    };
    if (el.id && !autoId(el.id) && unique('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    const tag = el.tagName.toLowerCase();
    let anchor: HTMLElement | null = el.parentElement;
    while (anchor && !(anchor.id && !autoId(anchor.id))) anchor = anchor.parentElement;
    const anchorSel = anchor ? '#' + CSS.escape(anchor.id) : '';
    const own = Array.from(el.attributes).map((a) => a.name).filter((n) => n.startsWith('data-') && !SEL_ATTRS.includes(n));
    for (const name of [...SEL_ATTRS, ...own]) {
        const v = el.getAttribute(name);
        if (v === null || v.length > 80) continue;
        const s = `${tag}[${name}="${CSS.escape(v)}"]`;
        if (unique(s)) return s;
        if (anchorSel && unique(`${anchorSel} ${s}`)) return `${anchorSel} ${s}`;
    }
    if (anchor) {
        const steps: string[] = [];
        let cur: HTMLElement = el;
        while (cur !== anchor && steps.length < 6) {
            const parent: HTMLElement | null = cur.parentElement;
            if (!parent) return null;
            const tagName = cur.tagName;
            const same = Array.from(parent.children).filter((c) => c.tagName === tagName);
            steps.unshift(`${tagName.toLowerCase()}:nth-of-type(${same.indexOf(cur) + 1})`);
            cur = parent;
        }
        if (cur === anchor) {
            const s = `${anchorSel} > ${steps.join(' > ')}`;
            if (unique(s)) return s;
        }
    }
    return null;
}
/** What a control says, for its default shortcut name. */
function controlName(el: HTMLElement): string {
    const raw = el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('title') || el.textContent || '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 60);
}

export interface PickedControl { sel: string; name: string; view: string }
/**
 * The eyedropper. Resolves with the control clicked, or null on Escape / Cancel. The rest of BMM
 * stays usable with Shift held (to go to another page first); every other press is the pick's.
 */
export async function pickControl(): Promise<PickedControl | null> {
    const guard = await loadGuard();
    return new Promise((resolve) => {
        const layer = document.createElement('div');
        layer.className = 'skd-pick-layer';
        layer.innerHTML = `
          <div class="skd-pick-bar" role="status">
            ${uiIcon('pick', 16)}<span>${escHtml(t('skd.pick.hint'))}</span>
            <button type="button" class="btn btn-ghost btn-sm skd-pick-cancel">${escHtml(t('common.cancel'))}</button>
          </div>
          <div class="skd-pick-box" hidden></div>
          <div class="skd-pick-tip" hidden></div>`;
        (document.getElementById('app-window-outer') || document.body).appendChild(layer);
        const bar = layer.querySelector<HTMLElement>('.skd-pick-bar')!;
        const box = layer.querySelector<HTMLElement>('.skd-pick-box')!;
        const tip = layer.querySelector<HTMLElement>('.skd-pick-tip')!;
        let current: { el: HTMLElement; sel: string | null; why: string | null } | null = null;

        const candidate = (target: EventTarget | null): HTMLElement | null => {
            const n = target as HTMLElement | null;
            if (!n || !n.closest || layer.contains(n)) return null;
            return n.closest<HTMLElement>(CLICKABLE);
        };
        const judge = (el: HTMLElement) => {
            const why = guard(el);
            const sel = why ? null : stableSelector(el);
            return { el, sel, why: why || (sel ? null : 'noSelector') };
        };
        const paint = () => {
            if (!current || !current.el.isConnected) { box.hidden = true; tip.hidden = true; return; }
            // The layer sits in the app frame, which may be offset or transformed: place the
            // ring in the layer's own coordinates.
            const L = layer.getBoundingClientRect();
            const e = current.el.getBoundingClientRect();
            const r = { left: e.left - L.left, top: e.top - L.top, right: e.right - L.left, bottom: e.bottom - L.top, width: e.width, height: e.height };
            box.hidden = false;
            box.style.left = `${r.left - 3}px`; box.style.top = `${r.top - 3}px`;
            box.style.width = `${r.width + 6}px`; box.style.height = `${r.height + 6}px`;
            box.classList.toggle('is-refused', !!current.why);
            tip.hidden = false;
            tip.classList.toggle('is-refused', !!current.why);
            tip.textContent = current.why ? reasonText(current.why) : (controlName(current.el) || current.sel || '');
            const below = r.bottom + 34 < L.height;
            tip.style.left = `${Math.max(8, Math.min(r.left, L.width - 300))}px`;
            tip.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - 30)}px`;
        };
        const onMove = (e: MouseEvent) => {
            const el = candidate(e.target);
            if (!el) { current = null; paint(); return; }
            if (current?.el !== el) current = judge(el);
            paint();
        };
        // Every press belongs to the pick, except on its own bar or with Shift held.
        const passes = (e: Event) => (e as MouseEvent).shiftKey || bar.contains(e.target as Node);
        const block = (e: Event) => {
            if (passes(e)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        };
        const onClick = (e: Event) => {
            if (passes(e)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const el = candidate(e.target);
            if (!el) return;
            current = judge(el);
            if (current.why || !current.sel) {
                paint();
                tip.classList.remove('skd-shake'); void tip.offsetWidth; tip.classList.add('skd-shake');
                return;
            }
            const v = (el.closest('.view') as HTMLElement | null)?.id.replace(/^view-/, '') || '';
            done({ sel: current.sel, name: controlName(el), view: VIEW_RE.test(v) ? v : '' });
        };
        const onKey = (e: Event) => {
            if ((e as KeyboardEvent).key !== 'Escape') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            done(null);
        };
        const evs: Array<[string, (e: Event) => void]> = [
            ['mousemove', onMove as (e: Event) => void], ['click', onClick], ['auxclick', block],
            ['mousedown', block], ['mouseup', block], ['pointerdown', block], ['pointerup', block],
            ['dblclick', block], ['contextmenu', block], ['keydown', onKey],
        ];
        evs.forEach(([n, f]) => window.addEventListener(n, f, true));
        window.addEventListener('scroll', paint, true);
        layer.querySelector('.skd-pick-cancel')!.addEventListener('click', () => done(null));
        function done(v: PickedControl | null): void {
            evs.forEach(([n, f]) => window.removeEventListener(n, f, true));
            window.removeEventListener('scroll', paint, true);
            layer.remove();
            resolve(v);
        }
    });
}

// ── The list of actions ───────────────────────────────────────────────────────────

interface Item { kind: 'command' | CustomKind; target: string; title: string; group: string; sub: string; }

const KIND_TITLE: Record<Item['kind'], string> = {
    command: 'skd.kind.command', settings: 'skd.kind.settings', profile: 'skd.kind.profile',
    modpack: 'skd.kind.modpack', automation: 'skd.kind.automation', element: 'skd.kind.element',
};
const CAT_TITLE: Record<Command['category'], L> = {
    nav: { en: 'Navigation', fr: 'Navigation' }, profiles: { en: 'Profiles', fr: 'Profils' }, mods: { en: 'Mods', fr: 'Mods' },
    repo: { en: 'Server Repo', fr: 'Dépôt serveur' }, tools: { en: 'Tools', fr: 'Outils' },
    settings: { en: 'Settings', fr: 'Paramètres' }, help: { en: 'Help', fr: 'Aide' },
    scheduler: { en: 'Scheduler', fr: 'Planificateur' }, custom: { en: 'Your shortcuts', fr: 'Vos raccourcis' },
};

const CAT_ORDER: Command['category'][] = ['nav', 'profiles', 'mods', 'repo', 'tools', 'settings', 'scheduler', 'help'];
function commandItems(): Item[] {
    // Grouped in the order of the shortcuts table, not in the order they were registered.
    const cmds = allCommands().filter((c) => !c.contextual && c.category !== 'custom')
        .sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
    return cmds.map((c) => ({
        kind: 'command' as const, target: c.id, title: tr(c.title), group: tr(CAT_TITLE[c.category]),
        sub: chordLabel(bindingOf(c.id)),
    }));
}
function settingsItems(): Item[] {
    return Array.from(document.querySelectorAll<HTMLElement>('#view-settings .settings-sections > .glass-card')).map((card) => {
        const title = (card.querySelector('.card-title')?.textContent || '').trim();
        const key = card.id || card.dataset.cardKey || '';
        return { kind: 'settings' as const, target: key, title, group: t(KIND_TITLE.settings), sub: '' };
    }).filter((i) => i.target && i.title);
}
async function loadedItems(): Promise<Item[]> {
    const [profiles, packs, tasks] = await Promise.all([
        invoke('get_profiles').catch(() => []) as Promise<any[]>,
        invoke('load_modpacks').catch(() => []) as Promise<any[]>,
        import('./scheduler.js').then((s) => s.getTasks()).catch(() => []) as Promise<any[]>,
    ]);
    const named = (list: any[], kind: CustomKind): Item[] => (list || []).filter((x) => x && x.id)
        .map((x) => ({ kind, target: String(x.id), title: String(x.name || x.id), group: t(KIND_TITLE[kind]), sub: '' }));
    return [...named(profiles, 'profile'), ...named(packs, 'modpack'), ...named(tasks, 'automation')];
}
function defaultLabel(i: Item): string {
    if (i.kind === 'command') return i.title;
    return t(`skd.lbl.${i.kind}`, { name: i.title });
}

// ── The editor ────────────────────────────────────────────────────────────────────

export interface EditorOptions {
    editId?: string;
    onDone: () => void;
    /** Start with these keys (an imported shortcut being given a new action). */
    presetChord?: Chord | null;
    /** Start with this name (idem). */
    presetLabel?: string;
    /** Called after a save, with what the keys now run. */
    onSaved?: (name: string) => void;
}

export function openShortcutEditor(opts: EditorOptions): void {
    const editing = opts.editId ? readCustomShortcuts().find((x) => x.id === opts.editId) || null : null;
    let picked: Item | null = editing
        ? { kind: editing.kind, target: editing.target, title: editing.label, group: t(KIND_TITLE[editing.kind]), sub: '' }
        : null;
    let pickedView = editing?.view || '';
    let chord: Chord | null = editing ? bindingOf(editing.id) : opts.presetChord || null;
    let stopRecorder: (() => void) | null = null;
    let items: Item[] = [...commandItems(), ...settingsItems()];
    let filterKind: Item['kind'] | 'all' = 'all';
    let recording = false;
    let labelTouched = !!editing;
    let shownNow: Item[] = [];

    const views = Array.from(document.querySelectorAll<HTMLElement>('.nav-item[data-view]'))
        .map((n) => n.dataset.view || '').filter((v, i, a) => v && a.indexOf(v) === i);
    const kinds: Array<Item['kind'] | 'all'> = ['all', 'command', 'settings', 'profile', 'modpack', 'automation'];

    const m = openModal({
        title: t(editing ? 'skd.titleEdit' : 'skd.title'),
        subtitle: t('skd.sub'),
        icon: uiIcon('keyboard', 18),
        size: 'md',
        className: 'sk-dlg',
        closeLabel: t('common.close'),
        body: `
          <section class="skd-step">
            <h3 class="skd-h"><span class="skd-n">1</span>${escHtml(t('skd.step.action'))}</h3>
            ${opts.presetLabel ? `<p class="skd-note">${escHtml(t('skd.imp.reassignNote', { name: opts.presetLabel }))}</p>` : ''}
            <div class="skd-picked" hidden>
              <span class="skd-picked-name"></span><span class="skd-picked-kind"></span>
              <button type="button" class="btn btn-ghost btn-sm skd-change">${escHtml(t('skd.change'))}</button>
            </div>
            <div class="skd-picker">
              <div class="skd-qrow">
                <input type="search" class="input-field skd-q" placeholder="${escAttr(t('skd.searchPh'))}" aria-label="${escAttr(t('skd.searchPh'))}">
                <button type="button" class="btn btn-ghost btn-sm skd-eyedrop" data-tooltip="${escAttr(t('skd.pick.tip'))}">${uiIcon('pick', 14)}<span>${escHtml(t('skd.pick.btn'))}</span></button>
              </div>
              <div class="skd-kinds" role="group" aria-label="${escAttr(t('skd.step.action'))}">
                ${kinds.map((k) => `<button type="button" class="skd-kind" value="${k}" aria-pressed="${k === 'all'}">${escHtml(t(k === 'all' ? 'skd.kind.all' : KIND_TITLE[k]))}</button>`).join('')}
              </div>
              <div class="skd-list" role="listbox" aria-label="${escAttr(t('skd.step.action'))}"></div>
            </div>
          </section>
          <section class="skd-step">
            <h3 class="skd-h"><span class="skd-n">2</span>${escHtml(t('skd.step.keys'))}</h3>
            <button type="button" class="sk-rec"></button>
            <div class="sk-warn skd-warn" hidden></div>
          </section>
          <section class="skd-step skd-custom-only">
            <h3 class="skd-h"><span class="skd-n">3</span>${escHtml(t('skd.step.where'))}</h3>
            <div class="skd-row">
              <label class="skd-lbl" for="skd-scope">${escHtml(t('skd.scope'))}</label>
              <select id="skd-scope" class="input-field skd-scope">
                <option value="">${escHtml(t('skd.scopeAll'))}</option>
                ${views.map((v) => `<option value="${escAttr(v)}">${escHtml(t('skd.scopeOnly', { page: viewLabel(v) }))}</option>`).join('')}
              </select>
            </div>
            <div class="skd-row">
              <label class="skd-lbl" for="skd-name">${escHtml(t('skd.name'))}</label>
              <input type="text" id="skd-name" class="input-field skd-name" maxlength="80">
            </div>
          </section>`,
        footer: `<button type="button" class="btn btn-ghost skd-cancel">${escHtml(t('common.cancel'))}</button>
                 <button type="button" class="btn btn-primary skd-save">${uiIcon('save', 14)}<span>${escHtml(t('skd.save'))}</span></button>`,
        initialFocus: editing ? '.sk-rec' : '.skd-q',
        onClose: () => stopRec(),
    });

    const q = m.q<HTMLInputElement>('.skd-q')!;
    const list = m.q('.skd-list')!;
    const rec = m.q<HTMLButtonElement>('.sk-rec')!;
    const warn = m.q('.skd-warn')!;
    const scopeSel = m.q<HTMLSelectElement>('.skd-scope')!;
    const nameIn = m.q<HTMLInputElement>('.skd-name')!;
    const save = m.q<HTMLButtonElement>('.skd-save')!;
    if (editing) { scopeSel.value = editing.scope || ''; nameIn.value = editing.label; }

    const isCustom = () => !!picked && picked.kind !== 'command';
    const scopeKeyNow = (): string => {
        if (!picked) return 'global';
        if (picked.kind === 'command') return scopeOf(picked.target);
        return scopeSel.value ? 'page:' + scopeSel.value : 'global';
    };
    const selfId = (): string | undefined => (picked?.kind === 'command' ? picked.target : editing?.id);
    const clash = (): Command | null => clashWith(chord, scopeKeyNow(), selfId());
    const reserved = (c: Chord | null): boolean => reservedChord(c, picked?.kind === 'command' ? picked.target : undefined);

    const drawList = () => {
        const needle = q.value.trim().toLowerCase();
        const shown = items.filter((i) => (filterKind === 'all' || i.kind === filterKind)
            && (!needle || `${i.title} ${i.group} ${i.sub}`.toLowerCase().includes(needle)));
        if (!shown.length) { list.innerHTML = `<div class="skd-empty">${escHtml(t('skd.noMatch'))}</div>`; return; }
        let html = '';
        let group = '';
        shownNow = shown.slice(0, 300);
        shownNow.forEach((i, n) => {
            if (i.group !== group) { group = i.group; html += `<div class="skd-group">${escHtml(group)}</div>`; }
            html += `<button type="button" class="skd-item" role="option" value="${n}">
                <span class="skd-item-t">${escHtml(i.title)}</span>${i.sub ? `<span class="skd-item-k">${escHtml(i.sub)}</span>` : ''}</button>`;
        });
        list.innerHTML = html;
    };
    const drawPicked = () => {
        const box = m.q('.skd-picked')!;
        const picker = m.q('.skd-picker')!;
        box.hidden = !picked;
        picker.hidden = !!picked;
        if (picked) {
            const nameEl = m.q('.skd-picked-name')!;
            nameEl.textContent = picked.title;
            // A picked control: its selector on hover, for whoever wants to know what is stored.
            if (picked.kind === 'element') nameEl.setAttribute('title', picked.target); else nameEl.removeAttribute('title');
            m.q('.skd-picked-kind')!.textContent = picked.kind === 'command' ? picked.group : t(KIND_TITLE[picked.kind]);
        }
        m.dialog.querySelectorAll<HTMLElement>('.skd-custom-only').forEach((el) => { el.hidden = !isCustom(); });
        if (picked && !labelTouched) nameIn.value = defaultLabel(picked);
    };
    const drawKeys = () => {
        rec.classList.toggle('is-recording', recording);
        rec.innerHTML = recording ? escHtml(t('sk.pressKeys'))
            : chord ? keycapsHtml(chord) + `<span class="skd-rec-hint">${escHtml(t('skd.recAgain'))}</span>`
            : escHtml(t('skd.recStart'));
        const c = chord && !recording ? clash() : null;
        warn.hidden = !c;
        if (c) warn.innerHTML = uiIcon('warning', 12) + `<span>${escHtml(t('skd.clash', { name: tr(c.title) }))}</span>`;
        save.disabled = !picked || !chord || recording || (isCustom() && !nameIn.value.trim());
    };

    // Keys, a mouse button, a modified wheel turn or gamepad buttons. The recorder listens on
    // window, in the capture phase: ahead of the global dispatcher and of the dialog's own Escape,
    // so a combination being recorded runs nothing and closes nothing.
    function stopRec(): void { stopRecorder?.(); stopRecorder = null; }
    const startRec = () => {
        stopRec();
        recording = true;
        warn.hidden = true;
        drawKeys();
        stopRecorder = startChordRecorder({
            onCancel: () => { stopRec(); recording = false; drawKeys(); },
            onChord: (ch) => {
                if (reserved(ch)) {
                    warn.hidden = false;
                    warn.innerHTML = uiIcon('warning', 12) + `<span>${escHtml(t('sk.reserved', { keys: chordLabel(ch) }))}</span>`;
                    return;
                }
                chord = ch;
                stopRec();
                recording = false;
                drawKeys();
            },
        });
    };
    // The eyedropper: the dialog steps aside while the user points at a control.
    const eyedrop = async () => {
        stopRec(); recording = false;
        m.overlay.style.visibility = 'hidden';
        let got: PickedControl | null = null;
        try { got = await pickControl(); } finally { m.overlay.style.visibility = ''; }
        if (!m.overlay.isConnected) return;
        if (got) {
            picked = { kind: 'element', target: got.sel, title: got.name || got.sel, group: t(KIND_TITLE.element), sub: '' };
            pickedView = got.view;
            drawPicked();
            drawKeys();
            rec.focus();
        } else {
            m.q<HTMLElement>('.skd-eyedrop')?.focus();
        }
    };

    q.addEventListener('input', drawList);
    m.dialog.querySelectorAll<HTMLElement>('.skd-kind').forEach((b) => b.addEventListener('click', () => {
        filterKind = ((b as HTMLButtonElement).value || 'all') as any;
        m.dialog.querySelectorAll('.skd-kind').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        drawList();
    }));
    list.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('.skd-item') as HTMLElement | null;
        if (!b) return;
        // The button's value is its index in the list as drawn (no attribute to trust or parse).
        const it = shownNow[Number((b as HTMLButtonElement).value)];
        if (!it) return;
        picked = it;
        // A command keeps the keys it has, ready to be changed.
        if (it.kind === 'command' && !chord) chord = bindingOf(it.target);
        drawPicked();
        drawKeys();
        rec.focus();
    });
    m.q('.skd-change')!.addEventListener('click', () => { picked = null; drawPicked(); drawKeys(); q.focus(); });
    rec.addEventListener('click', startRec);
    m.q('.skd-eyedrop')!.addEventListener('click', () => { void eyedrop(); });
    scopeSel.addEventListener('change', drawKeys);
    nameIn.addEventListener('input', () => { labelTouched = true; drawKeys(); });
    m.q('.skd-cancel')!.addEventListener('click', () => m.close());
    save.addEventListener('click', () => {
        if (!picked || !chord) return;
        const c = clash();
        if (c) setBinding(c.id, null);   // the keys move here; the other command keeps working by palette
        if (picked.kind === 'command') {
            setBinding(picked.target, chord);
        } else {
            const cs: CustomShortcut = {
                id: editing?.id || 'custom.' + Math.random().toString(36).slice(2, 10),
                kind: picked.kind, target: picked.target, label: nameIn.value.trim().slice(0, 80) || defaultLabel(picked),
                scope: scopeSel.value || '',
            };
            if (picked.kind === 'element' && pickedView) cs.view = pickedView;
            saveCustomShortcut(cs, chord);
        }
        toast(t('skd.saved', { keys: chordLabel(chord) }), 'success', 2000);
        const name = picked.kind === 'command' ? picked.title : (nameIn.value.trim() || defaultLabel(picked));
        m.close();
        opts.onSaved?.(name);
        opts.onDone();
    });

    drawList();
    drawPicked();
    drawKeys();
    // Profiles, modpacks and automations come from the backend; the list grows when they arrive.
    void loadedItems().then((more) => { items = [...items, ...more]; if (!picked) drawList(); });
}

// ── The table's other actions ─────────────────────────────────────────────────────

export async function confirmDeleteCustom(id: string, onDone: () => void): Promise<void> {
    const c = getCommand(id);
    const ok = await (window as any).confirmCustom?.(t('sk.delete'),
        t('skd.deleteConfirm', { name: `<strong>${escHtml(c ? tr(c.title) : id)}</strong>` }), 'danger');
    if (!ok) return;
    deleteCustomShortcut(id);
    onDone();
}

export async function confirmResetAll(onDone: () => void): Promise<void> {
    const ok = await (window as any).confirmCustom?.(t('sk.resetAll'), escHtml(t('skd.resetAllConfirm')), 'danger');
    if (!ok) return;
    // Every built-in back to its default. Your own shortcuts are not defaults to go back to:
    // they stay, with their keys.
    const mine = new Set(readCustomShortcuts().map((x) => x.id));
    for (const c of allCommands()) if (!mine.has(c.id)) setBinding(c.id, undefined);
    onDone();
}

export async function exportShortcutsFile(): Promise<void> {
    const path = await saveFile({ defaultPath: 'bmm-shortcuts.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return;
    try {
        await invoke('write_text_file', { path, content: JSON.stringify(exportShortcutData(), null, 2) });
        toast(t('skd.exported'), 'success');
    } catch (e) { toast(t('common.error') + ' : ' + e, 'error'); }
}

export async function importShortcutsFile(onDone: () => void): Promise<void> {
    const path = await pickFile([{ name: 'JSON', extensions: ['json'] }]);
    if (!path) return;
    let data: any;
    try {
        data = JSON.parse(await invoke('read_file_text', { path }) as string);
    } catch (e) { toast(t('skd.importBad') + ' (' + e + ')', 'error'); return; }
    await importShortcutObject(data, onDone);
}

/** Import a parsed shortcuts file: at once when everything lands, else through the review. */
export async function importShortcutObject(data: any, onDone: () => void): Promise<void> {
    if (!isShortcutFile(data)) { toast(t('skd.importBad'), 'error'); return; }
    const missing = await findMissing(data);
    if (!missing.length) {
        const n = importShortcutData(data);
        toast(t('skd.imported', { n: String(n) }), 'success');
        onDone();
        return;
    }
    openImportReview(data, missing, onDone);
}

/**
 * The entries of a file with nothing to run here: a command this BMM does not have (a plugin's,
 * a custom page's, a newer version's), a profile, modpack or automation that is not on this
 * machine, a Settings card that is gone. A picked control counts as present when its page
 * exists: many controls are only built once their page is opened, and a press says so if not.
 */
async function findMissing(data: any): Promise<MissingEntry[]> {
    refreshNavCommands();
    const custom = shortcutFileCustom(data);
    const need = new Set(custom.map((c) => c.kind));
    const [profiles, packs, tasks] = await Promise.all([
        need.has('profile') ? (invoke('get_profiles').catch(() => []) as Promise<any[]>) : Promise.resolve([]),
        need.has('modpack') ? (invoke('load_modpacks').catch(() => []) as Promise<any[]>) : Promise.resolve([]),
        need.has('automation') ? (import('./scheduler.js').then((s) => s.getTasks()).catch(() => []) as Promise<any[]>) : Promise.resolve([]),
    ]);
    const ids = (l: any[]) => new Set((l || []).map((x) => String(x?.id ?? '')));
    const have: Record<string, Set<string>> = { profile: ids(profiles), modpack: ids(packs), automation: ids(tasks) };
    const byId = new Map(custom.map((c) => [c.id, c]));
    return missingEntries({ bindings: data.bindings, custom },
        (id) => !!getCommand(id),
        (kind, target) => {
            if (kind === 'settings') return !!settingsCard(target);
            if (kind === 'element') {
                if (queryOne(target)) return true;
                const cs = [...byId.values()].find((c) => c.kind === 'element' && c.target === target);
                const v = cs?.view || '';
                return !!v && VIEW_RE.test(v) && !!document.querySelector(`.nav-item[data-view="${CSS.escape(v)}"], .nav-item[data-custom-id="${CSS.escape(v)}"]`);
            }
            return have[kind]?.has(target) || false;
        });
}

type RowChoice = 'disable' | 'skip' | 'reassigned';

/**
 * « Some shortcuts have nothing to run here »: one row per such entry, each with three answers:
 * give its keys another action (the New shortcut dialog, keys filled in), skip it, or keep it
 * disabled. Keep disabled is the default, so closing on Import drops nothing silently.
 */
function openImportReview(data: any, missing: MissingEntry[], onDone: () => void): void {
    const choice = new Map<string, RowChoice>(missing.map((x) => [x.id, 'disable']));
    const reassignedTo = new Map<string, string>();
    const kindName = (k: string) => t(k === 'command' ? 'skd.imp.kindCommand' : KIND_TITLE[k as CustomKind] || 'skd.imp.kindCommand');
    const m = openModal({
        title: t('skd.imp.title'),
        subtitle: t('skd.imp.sub', { n: String(missing.length) }),
        icon: uiIcon('import', 18),
        tone: 'warn',
        size: 'md',
        className: 'sk-dlg sk-imp',
        closeLabel: t('common.close'),
        body: `<p class="skd-note">${escHtml(t('skd.imp.lede'))}</p>
          <div class="skd-imp-list" role="list">${missing.map((x, i) => `
            <div class="skd-imp-row" role="listitem" data-i="${i}">
              <div class="skd-imp-what">
                <span class="skd-imp-name">${escHtml(x.label)}</span>
                <span class="skd-imp-kind">${escHtml(kindName(x.kind))}</span>
              </div>
              <span class="skd-imp-keys">${x.keys ? keycapsHtml(parseChord(x.keys)) : escHtml(t('sk.notSet'))}</span>
              <div class="skd-imp-acts" role="group" aria-label="${escAttr(x.label)}">
                <button type="button" class="skd-kind" value="reassign">${uiIcon('edit', 12)}<span>${escHtml(t('skd.imp.reassign'))}</span></button>
                <button type="button" class="skd-kind" value="skip" aria-pressed="false">${escHtml(t('skd.imp.skip'))}</button>
                <button type="button" class="skd-kind" value="disable" aria-pressed="true">${escHtml(t('skd.imp.keep'))}</button>
              </div>
              <div class="skd-imp-done" hidden></div>
            </div>`).join('')}
          </div>`,
        footer: `<button type="button" class="btn btn-ghost skd-cancel">${escHtml(t('common.cancel'))}</button>
                 <button type="button" class="btn btn-primary skd-imp-go">${uiIcon('import', 14)}<span>${escHtml(t('skd.imp.go'))}</span></button>`,
    });
    const drawRow = (row: HTMLElement, x: MissingEntry) => {
        const c = choice.get(x.id)!;
        row.querySelectorAll<HTMLButtonElement>('.skd-imp-acts .skd-kind').forEach((b) => {
            if (b.value !== 'reassign') b.setAttribute('aria-pressed', String(b.value === c));
        });
        const doneEl = row.querySelector<HTMLElement>('.skd-imp-done')!;
        doneEl.hidden = c !== 'reassigned';
        if (c === 'reassigned') doneEl.innerHTML = uiIcon('success', 12) + `<span>${escHtml(t('skd.imp.reassignedTo', { name: reassignedTo.get(x.id) || '' }))}</span>`;
        row.querySelector('.skd-imp-acts')!.toggleAttribute('hidden', c === 'reassigned');
    };
    m.body.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('.skd-imp-acts .skd-kind') as HTMLButtonElement | null;
        const row = b?.closest('.skd-imp-row') as HTMLElement | null;
        if (!b || !row) return;
        const x = missing[Number(row.dataset.i)];
        if (!x) return;
        if (b.value === 'skip' || b.value === 'disable') { choice.set(x.id, b.value); drawRow(row, x); return; }
        // The existing action picker, its keys filled in. What it saves is saved at once; the
        // file's entry is then left out of the import, since its keys now belong to the new action.
        openShortcutEditor({
            presetChord: x.keys ? parseChord(x.keys) : null,
            presetLabel: x.label,
            onSaved: (name) => { choice.set(x.id, 'reassigned'); reassignedTo.set(x.id, name); drawRow(row, x); },
            onDone,     // the table under the review shows the new binding; the review stays open
        });
    });
    m.q('.skd-cancel')!.addEventListener('click', () => m.close());
    m.q('.skd-imp-go')!.addEventListener('click', () => {
        const decisions: Record<string, ImportDecision> = {};
        for (const [id, c] of choice) decisions[id] = c === 'disable' ? 'disable' : 'skip';
        const n = importShortcutData(data, decisions);
        const kept = [...choice.values()].filter((c) => c === 'disable').length;
        toast(t('skd.imp.done', { n: String(n), k: String(kept) }), 'success');
        m.close();
        onDone();
    });
}

// The dialog's look: one surface (css/modal-shell.css), steps split by a hairline, no frames.
const STYLE_ID = 'skd-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
    .sk-dlg .skd-step { padding: 12px 0; border-top: 1px solid var(--bmm-s06); }
    .sk-dlg .skd-step:first-child { padding-top: 0; border-top: 0; }
    .sk-dlg .skd-step[hidden] { display: none; }
    .sk-dlg .skd-h { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .sk-dlg .skd-n { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--bmm-s08); color: var(--text-secondary); font-size: 11px; }
    .sk-dlg .skd-picked { display: flex; align-items: center; gap: 8px; }
    .sk-dlg .skd-picked[hidden], .sk-dlg .skd-picker[hidden] { display: none; }
    .sk-dlg .skd-picked-name { font-weight: 600; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sk-dlg .skd-picked-kind { font-size: 11.5px; color: var(--text-muted); }
    .sk-dlg .skd-change { margin-left: auto; }
    .sk-dlg .skd-qrow { display: flex; align-items: center; gap: 6px; }
    .sk-dlg .skd-q { flex: 1; min-width: 0; width: 100%; box-sizing: border-box; }
    .sk-dlg .skd-eyedrop { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .sk-dlg .skd-note { margin: 0 0 8px; font-size: 12px; line-height: 1.45; color: var(--text-secondary); }
    .sk-dlg .skd-list, .sk-imp .skd-imp-list { overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--bmm-s10) transparent; }
    .sk-dlg .skd-list:hover, .sk-imp .skd-imp-list:hover { scrollbar-color: var(--bmm-s20) transparent; }
    .sk-imp .skd-imp-list { max-height: 340px; overflow-y: auto; }
    .sk-imp .skd-imp-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; align-items: center; padding: 8px 0; border-top: 1px solid var(--bmm-s06); }
    .sk-imp .skd-imp-row:first-child { border-top: 0; }
    .sk-imp .skd-imp-what { display: flex; flex-direction: column; min-width: 0; }
    .sk-imp .skd-imp-name { font-size: 12.5px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sk-imp .skd-imp-kind { font-size: 11px; color: var(--text-muted); }
    .sk-imp .skd-imp-keys { display: inline-flex; gap: 3px; justify-self: end; }
    .sk-imp .skd-imp-acts { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px; }
    .sk-imp .skd-imp-acts[hidden], .sk-imp .skd-imp-done[hidden] { display: none; }
    .sk-imp .skd-imp-done { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--success); }
    .sk-dlg .skd-kinds { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
    .sk-dlg .skd-kind { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-secondary); font-size: 11.5px; cursor: pointer; }
    .sk-dlg .skd-kind[aria-pressed="true"] { background: var(--bmm-accent-dim); border-color: transparent; color: var(--text-primary); }
    .sk-dlg .skd-list { max-height: 260px; overflow-y: auto; }
    .sk-dlg .skd-group { position: sticky; top: 0; padding: 8px 4px 4px; background: var(--bg-card, var(--bmm-bg-elevated)); font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--text-muted); }
    .sk-dlg .skd-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: 0; border-radius: 7px; background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; font-size: 12.5px; }
    .sk-dlg .skd-item:hover, .sk-dlg .skd-item:focus-visible { background: var(--bmm-s06); }
    .sk-dlg .skd-item-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sk-dlg .skd-item-k { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
    .sk-dlg .skd-empty { padding: 16px; text-align: center; color: var(--text-muted); font-size: 12px; }
    .sk-dlg .sk-rec { display: inline-flex; align-items: center; gap: 4px; min-height: 34px; padding: 4px 12px; border: 1px dashed var(--border); border-radius: 8px; background: transparent; color: var(--text-secondary); font-size: 12.5px; cursor: pointer; }
    .sk-dlg .sk-rec:hover { border-color: var(--accent); color: var(--text-primary); }
    .sk-dlg .sk-rec.is-recording { border-style: solid; }
    .sk-dlg .skd-rec-hint { margin-left: 8px; font-size: 11.5px; color: var(--text-muted); }
    .sk-dlg .skd-warn { margin-top: 8px; }
    .sk-dlg .skd-warn[hidden] { display: none; }
    .sk-dlg .skd-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0; }
    .sk-dlg .skd-lbl { font-size: 12.5px; color: var(--text-secondary); }
    .sk-dlg .skd-scope, .sk-dlg .skd-name { width: 260px; max-width: 60%; }
    .sk-dlg .modal-footer .btn { display: inline-flex; align-items: center; gap: 6px; }
    /* The eyedropper: a bar at the top, a ring around the control under the pointer, its name
       (or why it is refused) under it. Nothing here takes the pointer except the bar. */
    .skd-pick-layer { position: absolute; inset: 0; z-index: 2147483600; pointer-events: none; }
    .skd-pick-bar { position: absolute; top: 44px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
        padding: 8px 8px 8px 14px; border: 1px solid var(--accent); border-radius: 12px; background: var(--bmm-bg-elevated);
        color: var(--text-primary); font-size: 12.5px; box-shadow: var(--bmm-shadow-modal); pointer-events: auto; }
    .skd-pick-bar > .ic { color: var(--accent); flex: none; }
    .skd-pick-box { position: absolute; border: 2px solid var(--accent); border-radius: 8px; background: var(--bmm-accent-dim);
        transition: left .06s, top .06s, width .06s, height .06s; }
    .skd-pick-box.is-refused { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
    .skd-pick-box[hidden], .skd-pick-tip[hidden] { display: none; }
    .skd-pick-tip { position: absolute; max-width: 300px; padding: 4px 8px; border-radius: 6px; background: var(--accent); color: var(--bmm-text-on-accent);
        font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .skd-pick-tip.is-refused { background: var(--danger); color: var(--bmm-text-on-accent); }
    .skd-pick-tip.skd-shake { animation: skd-shake .3s ease; }
    @keyframes skd-shake { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
    @media (prefers-reduced-motion: reduce) { .skd-pick-tip.skd-shake { animation: none; } .skd-pick-box { transition: none; } }
    `;
    document.head.appendChild(s);
}
