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

import {
    allCommands, bindingOf, setBinding, chordFromEvent, chordToStr, keycapsHtml, reservedChord, clashWith, scopeOf,
    readCustomShortcuts, saveCustomShortcut, deleteCustomShortcut, getCommand, exportShortcutData, importShortcutData,
    viewLabel, type Chord, type Command, type CustomShortcut, type CustomKind,
} from '../../core/commands.js';
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
    }
}

// ── The list of actions ───────────────────────────────────────────────────────────

interface Item { kind: 'command' | CustomKind; target: string; title: string; group: string; sub: string; }

const KIND_TITLE: Record<Item['kind'], string> = {
    command: 'skd.kind.command', settings: 'skd.kind.settings', profile: 'skd.kind.profile',
    modpack: 'skd.kind.modpack', automation: 'skd.kind.automation',
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
        sub: chordToStr(bindingOf(c.id)),
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

export interface EditorOptions { editId?: string; onDone: () => void; }

export function openShortcutEditor(opts: EditorOptions): void {
    const editing = opts.editId ? readCustomShortcuts().find((x) => x.id === opts.editId) || null : null;
    let picked: Item | null = editing
        ? { kind: editing.kind, target: editing.target, title: editing.label, group: t(KIND_TITLE[editing.kind]), sub: '' }
        : null;
    let chord: Chord | null = editing ? bindingOf(editing.id) : null;
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
            <div class="skd-picked" hidden>
              <span class="skd-picked-name"></span><span class="skd-picked-kind"></span>
              <button type="button" class="btn btn-ghost btn-sm skd-change">${escHtml(t('skd.change'))}</button>
            </div>
            <div class="skd-picker">
              <input type="search" class="input-field skd-q" placeholder="${escAttr(t('skd.searchPh'))}" aria-label="${escAttr(t('skd.searchPh'))}">
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
            m.q('.skd-picked-name')!.textContent = picked.title;
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

    const onKey = (e: KeyboardEvent) => {
        if (!recording) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') { recording = false; drawKeys(); return; }
        const ch = chordFromEvent(e);
        if (!ch) return;
        if (reserved(ch)) {
            warn.hidden = false;
            warn.innerHTML = uiIcon('warning', 12) + `<span>${escHtml(t('sk.reserved', { keys: chordToStr(ch) }))}</span>`;
            return;
        }
        chord = ch;
        recording = false;
        drawKeys();
    };
    // On window, in the capture phase: ahead of the global dispatcher (document, capture) and of
    // the dialog's own Escape, so a combination being recorded runs nothing and closes nothing.
    window.addEventListener('keydown', onKey, true);
    function stopRec(): void { window.removeEventListener('keydown', onKey, true); }

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
    rec.addEventListener('click', () => { recording = true; warn.hidden = true; drawKeys(); });
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
            saveCustomShortcut(cs, chord);
        }
        toast(t('skd.saved', { keys: chordToStr(chord) }), 'success', 2000);
        m.close();
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
    try {
        const text = await invoke('read_file_text', { path }) as string;
        const n = importShortcutData(JSON.parse(text));
        if (n < 0) { toast(t('skd.importBad'), 'error'); return; }
        toast(t('skd.imported', { n: String(n) }), 'success');
        onDone();
    } catch (e) { toast(t('skd.importBad') + ' (' + e + ')', 'error'); }
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
    .sk-dlg .skd-q { width: 100%; box-sizing: border-box; }
    .sk-dlg .skd-kinds { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
    .sk-dlg .skd-kind { padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-secondary); font-size: 11.5px; cursor: pointer; }
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
    `;
    document.head.appendChild(s);
}
