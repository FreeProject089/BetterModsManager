// Saved activation-order lists: build an order from any mods (active or not), keep it, give
// it to one or several profiles, or turn its mods on in one step.
//
// The dialog edits a DRAFT of one list at a time. Every change asks the backend for the plan
// of that draft (commands/order_lists.rs `order_list_plan`): each entry resolved against the
// library, strongest identity first, with how it was found (id, fingerprint, repo id, name)
// and where it stands in the chosen profile (active, inactive, missing). Nothing is dropped:
// an entry that answers to nothing stays in the list, marked missing.
//
// Two actions change the game, each behind its own confirmation:
//   * Apply order: the ACTIVE mods the list names take its order in the selected profiles,
//     in the slots they hold; nothing is enabled. Only the files that change hands are copied.
//   * Activate: on the active profile, every installed mod of the list that is off is turned
//     on (the same path as a click: dependencies, the SHA gate, the governor, Cancel), then
//     the list's mods are placed on top in its order. "Only this list" first turns off the
//     active mods the list neither names nor needs.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { dialog, copy } from './order-share.js';
import {
    type OrderList, type OrderEntry, type ListPlan, type LibraryMod, type PlanRow,
    addMods, moveEntry, removeEntry, pickable, sameList, activationCounts, qualityCounts, isWeakMatch,
} from './order-lists-model.js';

type Notify = (message: string, type?: string, duration?: number) => void;

interface ProfileLite { id: string; name: string; game_name?: string }

interface ActivateReport {
    enabled: number; already_active: number; missing: number; disabled: number;
    failed: { id: string; name: string; error: string }[]; moved: number; cancelled: boolean;
}

interface ApplyOutcome { profile_id: string; profile_name: string; placed: number; moved: number; error: string | null }

interface ImportedList { name: string | null; game: string | null; entries: OrderEntry[]; matches: { quality: string }[] }

function fill(key: string, vars: Record<string, string | number>): string {
    let s = t(key);
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
}

const I = {
    up: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    remove: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

const blank = (): OrderList => ({ id: '', name: '', description: '', profile_ids: [], entries: [] });
const clone = (l: OrderList): OrderList => JSON.parse(JSON.stringify(l));

/**
 * Open the lists dialog. `profileId`: the profile the order view was opened for (default: the
 * active one), whose state the rows show first and which "From this profile" copies.
 * Resolves when the dialog closes, with whether anything changed in the game.
 */
export function openOrderLists(profileId: string | null = null, notify?: Notify): Promise<boolean> {
    return new Promise((resolve) => {
        void (async () => {
            let lists: OrderList[] = [];
            let profiles: ProfileLite[] = [];
            let library: LibraryMod[] = [];
            let activeId: string | null = null;
            try {
                [lists, profiles, library, activeId] = await Promise.all([
                    invoke('order_list_all') as Promise<OrderList[]>,
                    invoke('get_profiles') as Promise<ProfileLite[]>,
                    invoke('get_all_mods') as Promise<LibraryMod[]>,
                    invoke('get_active_profile_id') as Promise<string | null>,
                ]);
            } catch (e) {
                notify?.(fill('orderList.loadFailed', { e: t(String(e)) }), 'error', 7000);
                resolve(false);
                return;
            }
            lists = Array.isArray(lists) ? lists : [];
            profiles = Array.isArray(profiles) ? profiles : [];
            library = Array.isArray(library) ? library : [];
            const viewProfile = profileId || activeId || profiles[0]?.id || null;
            run(lists, profiles, library, activeId, viewProfile, notify, resolve);
        })();
    });
}

function run(
    initial: OrderList[], profiles: ProfileLite[], library: LibraryMod[], activeId: string | null,
    viewProfile: string | null, notify: Notify | undefined, resolve: (changed: boolean) => void,
): void {
    let lists = initial;
    let saved: OrderList | null = null;   // the stored version of the open list (null = new)
    let draft: OrderList | null = null;
    let plan: ListPlan | null = null;
    let planFor = viewProfile;
    let mode: 'edit' | 'apply' | 'activate' = 'edit';
    let busy = false;
    let changedGame = false;
    let seq = 0;
    let query = '';
    const nameOfProfile = (id: string) => profiles.find((p) => p.id === id)?.name || id;

    const { ov, close, onClose } = dialog('olm', t('orderList.title'), `
        <div class="olm-wrap">
          <aside class="olm-side">
            <div class="olm-side-tools">
              <button type="button" class="btn btn-secondary btn-sm olm-new">${escHtml(t('orderList.new'))}</button>
              <button type="button" class="btn btn-ghost btn-sm olm-from" title="${escAttr(t('orderList.fromProfileTip'))}">${escHtml(t('orderList.fromProfile'))}</button>
              <button type="button" class="btn btn-ghost btn-sm olm-import">${escHtml(t('orderList.import'))}</button>
            </div>
            <ul class="olm-lists" aria-label="${escAttr(t('orderList.saved'))}"></ul>
          </aside>
          <section class="olm-main" aria-live="polite"></section>
        </div>`,
        `<span class="osh-status olm-status" aria-live="polite"></span>
         <button type="button" class="btn btn-primary btn-sm olm-done">${escHtml(t('common.close'))}</button>`);
    ov.querySelector('.osh-modal')?.classList.add('olm-modal');
    onClose(() => resolve(changedGame));
    const side = ov.querySelector('.olm-lists') as HTMLElement;
    const main = ov.querySelector('.olm-main') as HTMLElement;
    const status = ov.querySelector('.olm-status') as HTMLElement;
    const say = (m: string) => { status.textContent = m; };

    function renderSide(): void {
        side.innerHTML = lists.length ? lists.map((l) => {
            const scope = l.profile_ids.length
                ? l.profile_ids.map(nameOfProfile).join(', ')
                : t('orderList.anyProfile');
            const on = draft && saved && saved.id === l.id;
            return `<li><button type="button" class="olm-pick${on ? ' is-open' : ''}" data-id="${escAttr(l.id)}">
                <span class="olm-pick-name">${escHtml(l.name)}</span>
                <span class="olm-pick-meta">${escHtml(fill('orderList.count', { n: l.entries.length }))} · ${escHtml(scope)}</span>
              </button></li>`;
        }).join('') : `<li class="olm-none">${escHtml(t('orderList.none'))}</li>`;
    }

    const dirty = () => !!draft && !sameList(saved, draft);

    function chip(r: PlanRow): string {
        const q = `<span class="olm-q olm-q-${escAttr(r.quality)}${isWeakMatch(r.quality, r.version_differs) ? ' is-weak' : ''}" title="${escAttr(t(`orderList.q.${r.quality}Tip`))}">${escHtml(t(`orderList.q.${r.quality}`))}</span>`;
        const st = r.state === 'active'
            ? `<span class="olm-st is-on">${escHtml(fill('orderList.st.active', { n: r.position }))}</span>`
            : r.state === 'inactive'
                ? `<span class="olm-st is-off">${escHtml(t(r.in_profile ? 'orderList.st.inactive' : 'orderList.st.outside'))}</span>`
                : `<span class="olm-st is-missing">${escHtml(t(r.quality === 'ambiguous' ? 'orderList.st.ambiguous' : 'orderList.st.missing'))}</span>`;
        return q + st;
    }

    function renderEdit(): string {
        const d = draft!;
        const rows = plan?.rows || [];
        const qc = qualityCounts(rows);
        const scopeBoxes = profiles.map((p) => `
            <label class="olm-check"><input type="checkbox" class="olm-scope" value="${escAttr(p.id)}"${d.profile_ids.includes(p.id) ? ' checked' : ''}> ${escHtml(p.name)}</label>`).join('');
        const picks = pickable(library, d.entries, query, 60);
        return `
          <div class="olm-fields">
            <label class="osh-label" for="olm-name">${escHtml(t('orderList.name'))}</label>
            <input id="olm-name" class="form-input olm-name" maxlength="120" value="${escAttr(d.name)}" placeholder="${escAttr(t('orderList.namePlaceholder'))}">
            <fieldset class="olm-scope-set">
              <legend class="osh-label">${escHtml(t('orderList.scope'))}</legend>
              <p class="osh-note">${escHtml(t('orderList.scopeHint'))}</p>
              <div class="olm-checks">${scopeBoxes || `<span class="osh-note">${escHtml(t('orderList.noProfiles'))}</span>`}</div>
            </fieldset>
          </div>
          <div class="olm-view">
            <label class="osh-label" for="olm-for">${escHtml(t('orderList.viewFor'))}</label>
            <select id="olm-for" class="olm-for">
              ${profiles.map((p) => `<option value="${escAttr(p.id)}"${p.id === planFor ? ' selected' : ''}>${escHtml(p.name)}${p.id === activeId ? ` ${escHtml(t('orderList.activeMark'))}` : ''}</option>`).join('')}
            </select>
          </div>
          <div class="osh-chips">
            <span class="osh-chip">${escHtml(fill('orderList.count', { n: rows.length }))}</span>
            ${plan ? `<span class="osh-chip is-ok">${escHtml(fill('orderList.sum.active', { n: plan.already_active }))}</span>` : ''}
            ${plan && plan.to_activate.length ? `<span class="osh-chip">${escHtml(fill('orderList.sum.inactive', { n: plan.to_activate.length }))}</span>` : ''}
            ${plan && plan.missing + plan.ambiguous ? `<span class="osh-chip is-warn">${escHtml(fill('orderList.sum.missing', { n: plan.missing + plan.ambiguous }))}</span>` : ''}
            ${qc.name + qc.name_version ? `<span class="osh-chip">${escHtml(fill('orderList.sum.byName', { n: qc.name + qc.name_version }))}</span>` : ''}
          </div>
          <div class="lo-edge">${escHtml(t('order.first'))}</div>
          <ol class="olm-entries">
            ${d.entries.length ? d.entries.map((e, i) => {
                const r = rows[i];
                const renamed = r?.mod_name ? `<span class="olm-now">${escHtml(fill('orderList.nowCalled', { m: r.mod_name }))}</span>` : '';
                return `<li class="olm-entry${r && r.state !== 'active' ? ` is-${escAttr(r.state)}` : ''}">
                  <span class="lo-pos">${i + 1}</span>
                  <span class="olm-entry-main">
                    <span class="olm-entry-name">${escHtml(e.name)}${e.version ? ` <span class="olm-ver">${escHtml(e.version)}</span>` : ''}</span>
                    ${renamed}
                    <span class="olm-chips">${r ? chip(r) : ''}</span>
                  </span>
                  <span class="lo-moves">
                    <button type="button" class="lo-mv olm-up" data-i="${i}" title="${escAttr(t('order.moveUp'))}" aria-label="${escAttr(t('order.moveUp'))}"${i === 0 ? ' disabled' : ''}>${I.up}</button>
                    <button type="button" class="lo-mv olm-down" data-i="${i}" title="${escAttr(t('order.moveDown'))}" aria-label="${escAttr(t('order.moveDown'))}"${i === d.entries.length - 1 ? ' disabled' : ''}>${I.down}</button>
                    <button type="button" class="lo-mv olm-rm" data-i="${i}" title="${escAttr(t('orderList.remove'))}" aria-label="${escAttr(t('orderList.remove'))}">${I.remove}</button>
                  </span>
                </li>`;
            }).join('') : `<li class="lo-empty">${escHtml(t('orderList.emptyList'))}</li>`}
          </ol>
          <div class="lo-edge lo-edge-last">${escHtml(t('order.last'))}</div>
          <details class="osh-more olm-add"${d.entries.length ? '' : ' open'}>
            <summary>${escHtml(t('orderList.add'))}</summary>
            <input type="search" class="form-input olm-search" value="${escAttr(query)}" placeholder="${escAttr(t('orderList.searchPlaceholder'))}" aria-label="${escAttr(t('orderList.searchPlaceholder'))}">
            <ul class="olm-picks">
              ${picks.map((m) => `<li><button type="button" class="olm-addone" data-id="${escAttr(m.id)}">
                  <span class="olm-entry-name">${escHtml(m.name)}${m.version ? ` <span class="olm-ver">${escHtml(m.version)}</span>` : ''}</span>
                  <span class="olm-st ${m.enabled ? 'is-on' : 'is-off'}">${escHtml(t(m.enabled ? 'orderList.pick.on' : 'orderList.pick.off'))}</span>
                </button></li>`).join('') || `<li class="olm-none">${escHtml(t('orderList.pick.none'))}</li>`}
            </ul>
          </details>
          <div class="olm-actions">
            <button type="button" class="btn btn-primary btn-sm olm-save"${dirty() && draft!.name.trim() ? '' : ' disabled'}>${escHtml(t('orderList.save'))}</button>
            <button type="button" class="btn btn-secondary btn-sm olm-go-activate"${saved ? '' : ' disabled'} title="${escAttr(t('orderList.activateTip'))}">${escHtml(t('orderList.activate'))}</button>
            <button type="button" class="btn btn-secondary btn-sm olm-go-apply"${saved ? '' : ' disabled'} title="${escAttr(t('orderList.applyTip'))}">${escHtml(t('orderList.apply'))}</button>
            <button type="button" class="btn btn-ghost btn-sm olm-share"${saved ? '' : ' disabled'}>${escHtml(t('order.share.btn'))}</button>
            <button type="button" class="btn btn-ghost btn-sm olm-delete"${saved ? '' : ' disabled'}>${escHtml(t('orderList.delete'))}</button>
          </div>
          ${saved && dirty() ? `<p class="osh-note">${escHtml(t('orderList.saveFirst'))}</p>` : ''}`;
    }

    function renderApply(): string {
        const pre = new Set(saved!.profile_ids.length ? saved!.profile_ids : [planFor || '']);
        return `
          <h4 class="olm-h">${escHtml(fill('orderList.applyTitle', { m: saved!.name }))}</h4>
          <p class="osh-note">${escHtml(t('orderList.applyLede'))}</p>
          <div class="olm-checks">${profiles.map((p) => `
            <label class="olm-check"><input type="checkbox" class="olm-target" value="${escAttr(p.id)}"${pre.has(p.id) ? ' checked' : ''}> ${escHtml(p.name)}</label>`).join('')}
          </div>
          <div class="olm-result"></div>
          <div class="olm-actions">
            <button type="button" class="btn btn-primary btn-sm olm-apply-go">${escHtml(t('orderList.applyGo'))}</button>
            <button type="button" class="btn btn-secondary btn-sm olm-back">${escHtml(t('common.cancel'))}</button>
          </div>`;
    }

    function renderActivate(p: ListPlan | null, exclusive: boolean): string {
        const c = activationCounts(p, exclusive);
        const names = (xs: { name: string }[]) => xs.map((x) => `<li>${escHtml(x.name)}</li>`).join('');
        const missingRows = (p?.rows || []).filter((r) => r.state === 'missing');
        return `
          <h4 class="olm-h">${escHtml(fill('orderList.activateTitle', { m: saved!.name, p: activeId ? nameOfProfile(activeId) : '' }))}</h4>
          <p class="osh-note">${escHtml(t('orderList.activateLede'))}</p>
          ${!p ? `<p class="osh-note">${escHtml(t('order.import.reading'))}</p>` : `
          <div class="osh-chips">
            <span class="osh-chip${c.enable ? ' is-ok' : ''}">${escHtml(fill('orderList.act.enable', { n: c.enable }))}</span>
            <span class="osh-chip">${escHtml(fill('orderList.act.already', { n: c.already }))}</span>
            ${c.missing ? `<span class="osh-chip is-warn">${escHtml(fill('orderList.act.missing', { n: c.missing }))}</span>` : ''}
            ${c.disable ? `<span class="osh-chip is-warn">${escHtml(fill('orderList.act.disable', { n: c.disable }))}</span>` : ''}
          </div>
          ${c.enable ? `<details class="osh-more" open><summary>${escHtml(fill('orderList.act.enableList', { n: c.enable }))}</summary><ol>${names(p.to_activate)}</ol></details>` : ''}
          ${c.missing ? `<details class="osh-more"><summary>${escHtml(fill('orderList.act.missingList', { n: c.missing }))}</summary><ul>${names(missingRows)}</ul></details>` : ''}
          <label class="olm-check olm-excl"><input type="checkbox" class="olm-exclusive"${exclusive ? ' checked' : ''}> ${escHtml(t('orderList.exclusive'))}</label>
          ${c.disable ? `<details class="osh-more" open><summary>${escHtml(fill('orderList.act.disableList', { n: c.disable }))}</summary><ul>${names(p.to_deactivate)}</ul></details>` : ''}`}
          <div class="olm-result"></div>
          <div class="olm-actions">
            <button type="button" class="btn btn-primary btn-sm olm-activate-go"${p && (c.enable || c.disable || p.order_changed || c.already) ? '' : ' disabled'}>${escHtml(exclusive ? t('orderList.activateOnlyGo') : t('orderList.activateGo'))}</button>
            <button type="button" class="btn btn-secondary btn-sm olm-back">${escHtml(t('common.cancel'))}</button>
            <button type="button" class="btn btn-ghost btn-sm olm-cancel-op" hidden>${escHtml(t('orderList.stop'))}</button>
          </div>`;
    }

    let exclusive = false;
    let activePlan: ListPlan | null = null;

    function render(): void {
        renderSide();
        if (!draft) {
            main.innerHTML = `<p class="osh-note olm-intro">${escHtml(t('orderList.intro'))}</p>`;
            return;
        }
        main.innerHTML = mode === 'apply' ? renderApply() : mode === 'activate' ? renderActivate(activePlan, exclusive) : renderEdit();
    }

    async function refreshPlan(): Promise<void> {
        if (!draft) return;
        const mine = ++seq;
        try {
            const p = await invoke('order_list_plan', { entries: draft.entries, profileId: planFor }) as ListPlan;
            if (mine !== seq) return;
            plan = p;
        } catch (e) {
            if (mine !== seq) return;
            plan = null;
            say(t(String(e)));
        }
        if (mode === 'edit') {
            // Keep the focus where it was across the redraw (the search box, a move button).
            const focusQ = document.activeElement?.classList.contains('olm-search');
            render();
            if (focusQ) {
                const q = main.querySelector<HTMLInputElement>('.olm-search');
                q?.focus();
                q?.setSelectionRange(q.value.length, q.value.length);
            }
        }
    }

    function open(l: OrderList | null, asNew?: OrderList): void {
        saved = l ? clone(l) : null;
        draft = asNew ? asNew : l ? clone(l) : blank();
        plan = null;
        mode = 'edit';
        query = '';
        render();
        void refreshPlan();
        main.querySelector<HTMLInputElement>('.olm-name')?.focus();
    }

    function edit(next: OrderList): void {
        draft = next;
        render();
        void refreshPlan();
    }

    async function save(): Promise<boolean> {
        if (!draft || busy) return false;
        busy = true;
        try {
            const out = await invoke('order_list_save', { list: draft }) as OrderList;
            lists = [out, ...lists.filter((l) => l.id !== out.id)];
            saved = clone(out);
            draft = clone(out);
            say(t('orderList.saved'));
            return true;
        } catch (e) {
            say(t(String(e)));
            return false;
        } finally {
            busy = false;
            render();
            void refreshPlan();
        }
    }

    async function fromProfile(): Promise<void> {
        try {
            const res = await invoke('mod_order_get', { profileId: planFor }) as [{ id: string }[], unknown];
            const ids = (Array.isArray(res?.[0]) ? res[0] : []).map((m) => m.id);
            const byId = new Map(library.map((m) => [m.id, m]));
            const mods = ids.map((id) => byId.get(id)).filter(Boolean) as LibraryMod[];
            const base = blank();
            base.name = planFor ? fill('orderList.fromProfileName', { p: nameOfProfile(planFor) }) : '';
            if (planFor) base.profile_ids = [planFor];
            open(null, { ...base, entries: addMods([], mods) });
        } catch (e) {
            say(t(String(e)));
        }
    }

    function importList(): void {
        const { ov: iov, close: iclose } = dialog('olmi', t('orderList.importTitle'), `
            <label class="osh-label" for="olmi-text">${escHtml(t('order.import.paste'))}</label>
            <textarea id="olmi-text" class="form-input osh-text" rows="5" spellcheck="false" placeholder="${escAttr(t('order.import.placeholder'))}"></textarea>
            <div class="osh-plan olmi-plan" aria-live="polite"></div>`,
            `<span class="osh-status olmi-status"></span>
             <button type="button" class="btn btn-secondary btn-sm olmi-cancel">${escHtml(t('common.cancel'))}</button>
             <button type="button" class="btn btn-primary btn-sm olmi-use" disabled>${escHtml(t('orderList.importUse'))}</button>`);
        const text = iov.querySelector('#olmi-text') as HTMLTextAreaElement;
        const planEl = iov.querySelector('.olmi-plan') as HTMLElement;
        const st = iov.querySelector('.olmi-status') as HTMLElement;
        const use = iov.querySelector('.olmi-use') as HTMLButtonElement;
        let got: ImportedList | null = null;
        let timer = 0;
        let iseq = 0;
        const read = async () => {
            const raw = text.value;
            got = null;
            use.disabled = true;
            if (!raw.trim()) { planEl.innerHTML = ''; st.textContent = ''; return; }
            const mine = ++iseq;
            st.textContent = t('order.import.reading');
            try {
                const r = await invoke('order_list_parse', { text: raw }) as ImportedList;
                if (mine !== iseq) return;
                got = r;
                st.textContent = '';
                const qs = r.matches.map((m) => m.quality);
                const count = (k: string) => qs.filter((q) => q === k).length;
                const found = qs.filter((q) => q !== 'missing' && q !== 'ambiguous').length;
                planEl.innerHTML = `
                  <div class="osh-chips">
                    <span class="osh-chip is-ok">${escHtml(fill('order.import.placed', { n: found, m: qs.length }))}</span>
                    ${(['id', 'content', 'source', 'name_version', 'name'] as const).filter((k) => count(k)).map((k) => `<span class="osh-chip">${escHtml(t(`orderList.q.${k}`))}: ${count(k)}</span>`).join('')}
                    ${count('missing') + count('ambiguous') ? `<span class="osh-chip is-warn">${escHtml(fill('orderList.sum.missing', { n: count('missing') + count('ambiguous') }))}</span>` : ''}
                  </div>
                  <ol class="osh-land">${r.entries.map((e, i) => `
                    <li class="osh-land-row"><span class="lo-pos">${i + 1}</span><span class="osh-land-name">${escHtml(e.name)}</span>
                    <span class="olm-q olm-q-${escAttr(qs[i])}">${escHtml(t(`orderList.q.${qs[i]}`))}</span></li>`).join('')}
                  </ol>`;
                use.disabled = !r.entries.length;
            } catch (e) {
                if (mine !== iseq) return;
                planEl.innerHTML = '';
                st.textContent = t(String(e));
            }
        };
        text.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void read(); }, 250); });
        iov.querySelector('.olmi-cancel')?.addEventListener('click', iclose);
        use.addEventListener('click', () => {
            if (!got) return;
            const base = blank();
            base.name = got.name || t('orderList.importedName');
            base.game = got.game;
            base.entries = got.entries;
            iclose();
            open(null, base);
            say(t('orderList.importedDraft'));
        });
        text.focus();
    }

    async function share(): Promise<void> {
        if (!saved) return;
        try {
            const out = await invoke('order_list_export', { id: saved.id }) as { code: string };
            say((await copy(out.code)) ? t('orderList.shareCopied') : t('order.share.copyFailed'));
        } catch (e) {
            say(fill('order.share.failed', { e: t(String(e)) }));
        }
    }

    let confirmDelete = false;
    async function del(): Promise<void> {
        if (!saved || busy) return;
        if (!confirmDelete) { confirmDelete = true; say(fill('orderList.deleteConfirm', { m: saved.name })); return; }
        confirmDelete = false;
        try {
            await invoke('order_list_delete', { id: saved.id });
            lists = lists.filter((l) => l.id !== saved!.id);
            saved = null;
            draft = null;
            say(t('orderList.deleted'));
            render();
        } catch (e) {
            say(t(String(e)));
        }
    }

    async function goActivate(): Promise<void> {
        if (!saved) return;
        if (!activeId) { say(t('order.errNoProfile')); return; }
        mode = 'activate';
        activePlan = null;
        render();
        try {
            activePlan = await invoke('order_list_plan', { entries: saved.entries, profileId: activeId }) as ListPlan;
        } catch (e) {
            say(t(String(e)));
        }
        if (mode === 'activate') render();
    }

    async function activate(): Promise<void> {
        if (!saved || busy) return;
        busy = true;
        const go = main.querySelector<HTMLButtonElement>('.olm-activate-go');
        const stop = main.querySelector<HTMLButtonElement>('.olm-cancel-op');
        if (go) go.disabled = true;
        if (stop) stop.hidden = false;
        say(t('orderList.activating'));
        try {
            const r = await invoke('order_list_activate', { id: saved.id, exclusive, profileId: activeId, bypassSha: false }) as ActivateReport;
            changedGame = true;
            const msg = fill(r.cancelled ? 'orderList.activatedCancelled' : 'orderList.activated', { n: r.enabled, d: r.disabled, f: r.moved, m: r.missing });
            notify?.(msg, r.failed.length || r.cancelled ? 'warning' : 'success', 6000);
            const failed = r.failed.map((f) => `<li>${escHtml(f.name)}: ${escHtml(f.error.startsWith('MISSING_SHA|') ? t('orderList.failedSha') : t(f.error))}</li>`).join('');
            const res = main.querySelector('.olm-result');
            if (res) res.innerHTML = `<p class="osh-note">${escHtml(msg)}</p>${failed ? `<details class="osh-more" open><summary>${escHtml(fill('orderList.failed', { n: r.failed.length }))}</summary><ul>${failed}</ul></details>` : ''}`;
            say(msg);
            dispatchBmmAction(BMM_ACTIONS.ORDER_APPLIED, { moved: r.moved });
            refreshMods();
            activePlan = await invoke('order_list_plan', { entries: saved.entries, profileId: activeId }).catch(() => activePlan) as ListPlan | null;
        } catch (e) {
            say(fill('orderList.activateFailed', { e: t(String(e)) }));
        } finally {
            busy = false;
            try { await invoke('clear_mod_op_cancel'); } catch { /* best-effort */ }
            if (stop) stop.hidden = true;
            if (go) go.disabled = false;
        }
    }

    async function apply(): Promise<void> {
        if (!saved || busy) return;
        const ids = [...main.querySelectorAll<HTMLInputElement>('.olm-target:checked')].map((c) => c.value);
        if (!ids.length) { say(t('orderList.errNoProfile')); return; }
        busy = true;
        say(t('order.applying'));
        try {
            const out = await invoke('order_list_apply', { id: saved.id, profileIds: ids }) as ApplyOutcome[];
            changedGame = true;
            const res = main.querySelector('.olm-result');
            if (res) res.innerHTML = `<ul class="olm-outcomes">${out.map((o) => `<li>${escHtml(o.profile_name || o.profile_id)}: ${escHtml(o.error
                ? fill('orderList.applyOneFailed', { e: t(o.error) })
                : fill('orderList.applyOne', { n: o.placed, f: o.moved }))}</li>`).join('')}</ul>`;
            const bad = out.filter((o) => o.error).length;
            say(bad ? fill('orderList.applyPartial', { n: out.length - bad, m: out.length }) : fill('orderList.applied', { n: out.length }));
            dispatchBmmAction(BMM_ACTIONS.ORDER_APPLIED, { moved: out.reduce((a, o) => a + o.moved, 0) });
            refreshMods();
        } catch (e) {
            say(t(String(e)));
        } finally {
            busy = false;
        }
    }

    // ── Wiring (delegated on the dialog: the view is redrawn often) ────────────────────────
    ov.querySelector('.olm-new')?.addEventListener('click', () => open(null));
    ov.querySelector('.olm-from')?.addEventListener('click', () => { void fromProfile(); });
    ov.querySelector('.olm-import')?.addEventListener('click', importList);
    ov.querySelector('.olm-done')?.addEventListener('click', close);
    side.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.olm-pick');
        const l = b && lists.find((x) => x.id === b.dataset.id);
        if (l) open(l);
    });
    main.addEventListener('click', (e) => {
        const el = e.target as HTMLElement;
        const btn = el.closest<HTMLButtonElement>('button');
        if (!btn || !draft) return;
        const c = btn.classList;
        const i = Number(btn.dataset.i);
        if (c.contains('olm-up')) edit({ ...draft, entries: moveEntry(draft.entries, i, i - 1) });
        else if (c.contains('olm-down')) edit({ ...draft, entries: moveEntry(draft.entries, i, i + 1) });
        else if (c.contains('olm-rm')) edit({ ...draft, entries: removeEntry(draft.entries, i) });
        else if (c.contains('olm-addone')) {
            const m = library.find((x) => x.id === btn.dataset.id);
            if (m) edit({ ...draft, entries: addMods(draft.entries, [m]) });
        }
        else if (c.contains('olm-save')) void save();
        else if (c.contains('olm-delete')) void del();
        else if (c.contains('olm-share')) void share();
        else if (c.contains('olm-go-apply')) { mode = 'apply'; render(); }
        else if (c.contains('olm-go-activate')) void goActivate();
        else if (c.contains('olm-back')) { if (!busy) { mode = 'edit'; render(); void refreshPlan(); } }
        else if (c.contains('olm-apply-go')) void apply();
        else if (c.contains('olm-activate-go')) void activate();
        else if (c.contains('olm-cancel-op')) { void invoke('cancel_mod_ops').catch(() => {}); say(t('orderList.stopping')); }
    });
    main.addEventListener('input', (e) => {
        const el = e.target as HTMLInputElement;
        if (!draft) return;
        if (el.classList.contains('olm-name')) {
            draft = { ...draft, name: el.value };
            const s = main.querySelector<HTMLButtonElement>('.olm-save');
            if (s) s.disabled = !(dirty() && draft.name.trim());
        } else if (el.classList.contains('olm-search')) {
            query = el.value;
            render();
            const q = main.querySelector<HTMLInputElement>('.olm-search');
            q?.focus();
            q?.setSelectionRange(q.value.length, q.value.length);
        }
    });
    main.addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement;
        if (!draft) return;
        if (el.classList.contains('olm-scope')) {
            const ids = [...main.querySelectorAll<HTMLInputElement>('.olm-scope:checked')].map((x) => x.value);
            draft = { ...draft, profile_ids: ids };
            render();
        } else if (el.classList.contains('olm-for')) {
            planFor = el.value || planFor;
            void refreshPlan();
        } else if (el.classList.contains('olm-exclusive')) {
            exclusive = el.checked;
            render();
        }
    });

    render();
    (ov.querySelector('.olm-new') as HTMLElement | null)?.focus();
}

/** The mod list redraws itself from the backend after an activation or a reorder. */
function refreshMods(): void {
    const w = window as any;
    if (typeof w._refreshModsFn === 'function') w._refreshModsFn(false, true);
    else window.dispatchEvent(new CustomEvent('bmm://mods-updated'));
}
