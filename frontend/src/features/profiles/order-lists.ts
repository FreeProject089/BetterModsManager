// Saved activation-order lists: build an order from any mods (active or not), keep it, give
// it to one or several profiles, or turn its mods on in one step.
//
// The dialog edits a DRAFT of one list at a time. Every change asks the backend for the plan
// of that draft (commands/order_lists.rs `order_list_plan`): each entry resolved against the
// library, strongest identity first, with how it was found (id, fingerprint, repo id, name)
// and where it stands in the chosen profile (active, inactive, missing). Nothing is dropped:
// an entry that answers to nothing stays in the list, marked missing.
//
// Layout: saved lists on the left; on the right the open list's name and counts, the profiles
// it is meant for (toggle chips; the eye on a chip picks whose state the rows show, so the two
// questions "for whom" and "seen from where" are two different controls on the same chip),
// the list itself (scrolls on its own, drag or the arrows to reorder) and, beside it, the add
// panel (search the whole library, select several, keyboard ↑/↓/Enter, or append a profile's
// current order). The actions live in the dialog's footer: Delete apart on the left, the rest
// on the right with one primary.
//
// Two actions change the game, each behind its own confirmation:
//   * Apply order: the ACTIVE mods the list names take its order in the selected profiles,
//     in the slots they hold; nothing is enabled. Only the files that change hands are copied.
//   * Activate: on the active profile, every installed mod of the list that is off is turned
//     on (the same path as a click: dependencies, the SHA gate, the governor, Cancel), then
//     the list's mods are placed on top in its order. "Only this list" first turns off the
//     active mods the list neither names nor needs.
//
// Activate is ONE backend command (`order_list_activate`: one plan, the enables, one order
// commit), run as a job of core/activation-jobs.ts (`runActivationBatch`): it is queued behind
// the other activations, shows in the title bar's activity pill and on the library cards, is
// stopped by its own cancel scope (this dialog's Stop or the pill's Cancel; no other batch), and
// reports its end with the job manager's toast. Closing the dialog or leaving the view does not
// stop it; the dialog only shows the result if it is still open when the job ends.
import { invoke, saveFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { dialog, copy } from './order-share.js';
import { runActivationBatch, type ActivationJobHandle } from '../../core/activation-jobs.js';
import { loadNotesRenderer, paintNotes, openNotesEditor } from './order-notes.js';
import { notesLength } from './order-notes-model.js';
import {
    type OrderList, type OrderEntry, type ListPlan, type LibraryMod, type PlanRow,
    addMods, moveEntry, removeEntry, searchLibrary, sameList, activationCounts, qualityCounts, isWeakMatch,
    sourceHost, safeColor, stateCounts, dropIndex,
} from './order-lists-model.js';

type Notify = (message: string, type?: string, duration?: number) => void;

interface ProfileLite { id: string; name: string; game_name?: string; color?: string | null; active_mods?: string[] }

interface ActivateReport {
    enabled: number; already_active: number; missing: number; disabled: number;
    failed: { id: string; name: string; error: string }[]; moved: number; cancelled: boolean;
}

interface ApplyOutcome { profile_id: string; profile_name: string; placed: number; moved: number; error: string | null }

interface ImportedList { name: string | null; game: string | null; notes: string; entries: OrderEntry[]; matches: { quality: string }[] }

/** `order_list_export`'s answer: the code only when it is short enough, and always the file. */
interface ListExport { code: string | null; code_len: number; code_max: number; text: string; file: string; file_name: string; notes_len: number }

/** A list file read in the import box: bigger than this is refused before it is read (Rust caps it too). */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function fill(key: string, vars: Record<string, string | number>): string {
    let s = t(key);
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
}

const svg = (w: number, body: string, extra = '') => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
const I = {
    up: svg(13, '<path d="m18 15-6-6-6 6"/>'),
    down: svg(13, '<path d="m6 9 6 6 6-6"/>'),
    remove: svg(13, '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    plus: svg(14, '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    check: svg(11, '<polyline points="20 6 9 17 4 12"/>', ' stroke-width="3.2"'),
    eye: svg(14, '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    search: svg(14, '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    list: svg(20, '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
    note: svg(14, '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>'),
    edit: svg(14, '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    expand: svg(14, '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'),
    shield: svg(12, '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    file: svg(14, '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/>'),
    copy: svg(14, '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    globe: svg(12, '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    grip: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
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
                await loadNotesRenderer();
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
    initial: OrderList[], initialProfiles: ProfileLite[], library: LibraryMod[], activeId: string | null,
    viewProfile: string | null, notify: Notify | undefined, resolve: (changed: boolean) => void,
): void {
    let lists = initial;
    let profiles = initialProfiles;
    let saved: OrderList | null = null;   // the stored version of the open list (null = new)
    let draft: OrderList | null = null;
    let plan: ListPlan | null = null;
    let planFor = viewProfile;
    let mode: 'edit' | 'apply' | 'activate' = 'edit';
    let busy = false;
    let changedGame = false;
    let job: ActivationJobHandle | null = null;   // the activation this dialog started, while it runs
    let seq = 0;
    let query = '';
    let adding = false;                    // the add panel is open
    let notesEditor: { close: () => void } | null = null;
    // The rendered notes, kept between redraws (the view is redrawn on every plan answer, and
    // drawing diagrams again each time would flicker): rebuilt only when the text changes.
    let notesNode: HTMLElement | null = null;
    let notesKey = '';
    const picked = new Set<string>();      // mods selected in the add panel
    let hi = -1;                           // the add panel's highlighted result
    let applyTargets = new Set<string>();  // the profiles Apply order is about to touch
    let pendingFocus: string | null = null;
    const nameOfProfile = (id: string) => profiles.find((p) => p.id === id)?.name || id;

    const { ov, close, onClose } = dialog('olm', t('orderList.title'), `
        <div class="olm-wrap">
          <aside class="olm-side">
            <button type="button" class="btn btn-secondary btn-sm olm-new">${I.plus}<span>${escHtml(t('orderList.new'))}</span></button>
            <div class="olm-side-tools">
              <button type="button" class="btn btn-ghost btn-sm olm-from" title="${escAttr(t('orderList.fromProfileTip'))}">${escHtml(t('orderList.fromProfile'))}</button>
              <button type="button" class="btn btn-ghost btn-sm olm-import">${escHtml(t('orderList.import'))}</button>
            </div>
            <div class="olm-side-h"><span class="bms-label" id="olm-lists-h">${escHtml(t('orderList.savedLists'))}</span><span class="olm-side-n"></span></div>
            <ul class="olm-lists" aria-labelledby="olm-lists-h"></ul>
          </aside>
          <section class="olm-main"></section>
        </div>`,
        `<div class="olm-foot"></div>`);
    ov.querySelector('.osh-modal')?.classList.add('olm-modal');
    onClose(() => resolve(changedGame));
    const side = ov.querySelector('.olm-lists') as HTMLElement;
    const sideCount = ov.querySelector('.olm-side-n') as HTMLElement;
    const main = ov.querySelector('.olm-main') as HTMLElement;
    const foot = ov.querySelector('.olm-foot') as HTMLElement;
    let statusText = '';
    const say = (m: string) => {
        statusText = m;
        const s = foot.querySelector('.olm-status');
        if (s) s.textContent = m;
    };

    const dirty = () => !!draft && !sameList(saved, draft);
    const viewed = () => profiles.find((p) => p.id === planFor) || null;
    const swatch = (p: ProfileLite) => {
        const c = safeColor(p.color);
        return c ? ` style="--olm-pc:${escAttr(c)}"` : '';
    };

    // ── Left column ────────────────────────────────────────────────────────────────────────
    function renderSide(): void {
        sideCount.textContent = lists.length ? String(lists.length) : '';
        side.innerHTML = lists.length ? lists.map((l) => {
            const on = !!(draft && saved && saved.id === l.id);
            const targets = l.profile_ids.map((id) => profiles.find((p) => p.id === id)).filter(Boolean) as ProfileLite[];
            const scope = l.profile_ids.length
                ? `<span class="olm-pick-dots" aria-hidden="true">${targets.slice(0, 4).map((p) => `<span class="olm-dot"${swatch(p)}></span>`).join('')}</span>
                   <span class="olm-pick-scope">${escHtml(l.profile_ids.map(nameOfProfile).join(', '))}</span>`
                : `<span class="olm-pick-any">${I.globe}<span>${escHtml(t('orderList.anyProfile'))}</span></span>`;
            return `<li><button type="button" class="olm-pick${on ? ' is-open' : ''}" data-id="${escAttr(l.id)}"${on ? ' aria-current="true"' : ''}>
                <span class="olm-pick-top">
                  <span class="olm-pick-name">${escHtml(l.name)}</span>
                  ${on && dirty() ? `<span class="olm-unsaved-dot" title="${escAttr(t('orderList.unsaved'))}"></span>` : ''}
                  <span class="olm-pick-n">${escHtml(String(l.entries.length))}</span>
                </span>
                <span class="olm-pick-meta">${scope}</span>
              </button></li>`;
        }).join('') : `<li class="olm-none">${escHtml(t('orderList.none'))}</li>`;
    }

    // ── Chips ──────────────────────────────────────────────────────────────────────────────
    function chips(r: PlanRow): string {
        const p = viewed()?.name || '';
        if (r.state === 'missing') {
            // Not found / ambiguous: one chip says both how it was looked for and the outcome.
            const key = r.quality === 'ambiguous' ? 'orderList.q.ambiguous' : 'orderList.st.missing';
            return `<span class="olm-st is-missing" title="${escAttr(t(`orderList.q.${r.quality}Tip`))}">${escHtml(t(key))}</span>`;
        }
        const weak = isWeakMatch(r.quality, r.version_differs);
        const q = `<span class="olm-q olm-q-${escAttr(r.quality)}${weak ? ' is-weak' : ''}" title="${escAttr(t(`orderList.q.${r.quality}Tip`))}">${escHtml(t(`orderList.q.${r.quality}`))}</span>`;
        const st = r.state === 'active'
            ? `<span class="olm-st is-on" title="${escAttr(fill('orderList.st.activeTip', { p, n: r.position }))}">${escHtml(fill('orderList.st.active', { n: r.position }))}</span>`
            : `<span class="olm-st is-off" title="${escAttr(fill(r.in_profile ? 'orderList.st.inactiveTip' : 'orderList.st.outsideTip', { p }))}">${escHtml(t(r.in_profile ? 'orderList.st.inactive' : 'orderList.st.outside'))}</span>`;
        return st + q;
    }

    /** A profile chip: the toggle (meant for it or not) and, apart, the eye (show its state). */
    function profileChip(p: ProfileLite, on: boolean, cls: string, withEye: boolean): string {
        const isActive = p.id === activeId;
        const isViewed = withEye && p.id === planFor;
        const sub = [p.game_name ? t(p.game_name) || p.game_name : '', isActive ? t('orderList.activeProfile') : ''].filter(Boolean).join(' · ');
        return `<span class="olm-pc${on ? ' is-on' : ''}${isViewed ? ' is-viewed' : ''}"${swatch(p)}>
            <button type="button" class="olm-pc-tog ${cls}" data-pid="${escAttr(p.id)}" aria-pressed="${on}">
              <span class="olm-pc-box" aria-hidden="true">${I.check}</span>
              <span class="olm-dot" aria-hidden="true"></span>
              <span class="olm-pc-text">
                <span class="olm-pc-name">${escHtml(p.name)}${isActive ? `<span class="olm-pc-active" aria-hidden="true"></span>` : ''}</span>
                ${sub ? `<span class="olm-pc-sub">${escHtml(sub)}</span>` : ''}
              </span>
            </button>
            ${withEye ? `<button type="button" class="olm-pc-eye" data-pid="${escAttr(p.id)}" aria-pressed="${isViewed}" title="${escAttr(fill('orderList.viewState', { p: p.name }))}" aria-label="${escAttr(fill('orderList.viewState', { p: p.name }))}">${I.eye}</button>` : ''}
          </span>`;
    }

    // ── Edit view ──────────────────────────────────────────────────────────────────────────
    function renderEdit(): string {
        const d = draft!;
        const rows = plan?.rows || [];
        const sc = stateCounts(rows);
        const qc = qualityCounts(rows);
        const byName = qc.name + rows.filter((r) => r.quality === 'name_version' && r.version_differs).length;
        const anyScope = !d.profile_ids.length;
        const v = viewed();
        const hasNotes = !!(d.description || '').trim();
        const importedChip = `<span class="bms-chip olm-imported" title="${escAttr(t('orderList.importedTip'))}">${I.shield}${escHtml(t('orderList.importedBadge'))}</span>`;
        const counts = `
            <span class="bms-chip"><b>${rows.length || d.entries.length}</b>${escHtml(t('orderList.sum.total'))}</span>
            ${plan ? `<span class="bms-chip bms-chip--ok" title="${escAttr(t('orderList.sum.activeTip'))}"><span class="bms-dot"></span>${escHtml(fill('orderList.sum.active', { n: sc.active }))}</span>` : ''}
            ${plan ? `<span class="bms-chip" title="${escAttr(t('orderList.sum.inactiveTip'))}"><span class="bms-dot"></span>${escHtml(fill('orderList.sum.inactive', { n: sc.inactive }))}</span>` : ''}
            ${plan && sc.missing ? `<span class="bms-chip bms-chip--warn" title="${escAttr(t('orderList.sum.missingTip'))}"><span class="bms-dot"></span>${escHtml(fill('orderList.sum.missing', { n: sc.missing }))}</span>` : ''}
            ${plan && byName ? `<span class="bms-chip bms-chip--warn" title="${escAttr(t('orderList.q.nameTip'))}">${escHtml(fill('orderList.sum.byName', { n: byName }))}</span>` : ''}`;
        return `
          <header class="olm-head">
            <div class="olm-head-row">
              <input id="olm-name" class="form-input olm-name" maxlength="120" value="${escAttr(d.name)}" placeholder="${escAttr(t('orderList.namePlaceholder'))}" aria-label="${escAttr(t('orderList.name'))}">
              <span class="olm-unsaved"${dirty() ? '' : ' hidden'}${saved ? ` title="${escAttr(t('orderList.saveFirst'))}"` : ''}><span class="olm-unsaved-dot"></span>${escHtml(t('orderList.unsaved'))}</span>
              ${hasNotes ? '' : `<button type="button" class="btn btn-ghost btn-sm olm-notes-toggle" title="${escAttr(t('orderList.notesTip'))}">${I.note}<span>${escHtml(t('orderList.notesAdd'))}</span></button>`}
            </div>
            <div class="olm-counts" aria-live="polite">${counts}${d.imported ? importedChip : ''}</div>
          </header>
          ${hasNotes ? `
          <section class="olm-notesbox" aria-labelledby="olm-notes-h">
            <div class="olm-notes-h">
              <span class="bms-label" id="olm-notes-h">${escHtml(t('orderList.notes'))}</span>
              <span class="olm-notes-n">${escHtml(fill('orderList.notesChars', { n: notesLength(d.description || '').toLocaleString() }))}</span>
              <span class="bms-spacer"></span>
              <button type="button" class="btn btn-ghost btn-sm olm-notes-expand" title="${escAttr(t('orderList.notesExpandTip'))}">${I.expand}<span>${escHtml(t('orderList.notesExpand'))}</span></button>
              <button type="button" class="btn btn-ghost btn-sm olm-notes-toggle" title="${escAttr(t('orderList.notesTip'))}">${I.edit}<span>${escHtml(t('orderList.notesEdit'))}</span></button>
            </div>
            <div class="olm-desc-slot"></div>
          </section>` : ''}
          <section class="olm-targets" aria-labelledby="olm-tg-h">
            <div class="olm-targets-h">
              <span class="bms-label" id="olm-tg-h">${escHtml(t('orderList.scope'))}</span>
              <span class="olm-scope-state${anyScope ? ' is-any' : ''}">${anyScope ? `${I.globe}<span>${escHtml(t('orderList.scopeAny'))}</span>` : escHtml(fill('orderList.scopeSome', { n: d.profile_ids.length }))}</span>
              <span class="bms-spacer"></span>
              ${profiles.length ? `
              <button type="button" class="btn btn-ghost btn-sm olm-scope-all"${d.profile_ids.length === profiles.length ? ' disabled' : ''}>${escHtml(t('orderList.scopeAll'))}</button>
              <button type="button" class="btn btn-ghost btn-sm olm-scope-none"${anyScope ? ' disabled' : ''} title="${escAttr(t('orderList.scopeHint'))}">${escHtml(t('orderList.scopeNone'))}</button>` : ''}
            </div>
            <div class="olm-pchips" role="group" aria-labelledby="olm-tg-h">
              ${profiles.map((p) => profileChip(p, d.profile_ids.includes(p.id), 'olm-scope', true)).join('') || `<span class="osh-note">${escHtml(t('orderList.noProfiles'))}</span>`}
            </div>
          </section>
          <div class="olm-body${adding ? ' is-adding' : ''}">
            <section class="olm-listpane" aria-labelledby="olm-list-h">
              <div class="olm-list-h">
                <span class="bms-label" id="olm-list-h">${escHtml(t('orderList.order'))}</span>
                ${v ? `<span class="olm-viewing" title="${escAttr(t('orderList.viewingTip'))}"${swatch(v)}>${I.eye}<span>${escHtml(fill('orderList.viewingFor', { p: v.name }))}</span></span>` : ''}
                <span class="bms-spacer"></span>
                <button type="button" class="btn ${adding ? 'btn-ghost' : 'btn-secondary'} btn-sm olm-add-toggle" aria-expanded="${adding}" aria-controls="olm-addpane">${I.plus}<span>${escHtml(t('orderList.add'))}</span></button>
              </div>
              <div class="olm-scroll">
                <div class="lo-edge">${escHtml(t('order.first'))}</div>
                <ol class="olm-entries">
                  ${d.entries.length ? d.entries.map((e, i) => {
                      const r = rows[i];
                      const renamed = r?.mod_name ? `<span class="olm-now">${escHtml(fill('orderList.nowCalled', { m: r.mod_name }))}</span>` : '';
                      return `<li class="olm-entry${r && r.state !== 'active' ? ` is-${escAttr(r.state)}` : ''}" draggable="true" data-i="${i}">
                        <span class="lo-grip olm-grip" title="${escAttr(t('orderList.dragTip'))}">${I.grip}</span>
                        <span class="lo-pos">${i + 1}</span>
                        <span class="olm-entry-main">
                          <span class="olm-entry-line"><span class="olm-entry-name">${escHtml(e.name)}</span>${e.version ? `<span class="olm-ver">${escHtml(e.version)}</span>` : ''}</span>
                          <span class="olm-chips">${r ? chips(r) : ''}${renamed}</span>
                        </span>
                        <span class="lo-moves olm-row-acts">
                          <button type="button" class="lo-mv olm-up" data-i="${i}" title="${escAttr(t('order.moveUp'))}" aria-label="${escAttr(`${t('order.moveUp')}: ${e.name}`)}"${i === 0 ? ' disabled' : ''}>${I.up}</button>
                          <button type="button" class="lo-mv olm-down" data-i="${i}" title="${escAttr(t('order.moveDown'))}" aria-label="${escAttr(`${t('order.moveDown')}: ${e.name}`)}"${i === d.entries.length - 1 ? ' disabled' : ''}>${I.down}</button>
                          <button type="button" class="lo-mv olm-rm" data-i="${i}" title="${escAttr(t('orderList.remove'))}" aria-label="${escAttr(`${t('orderList.remove')}: ${e.name}`)}">${I.remove}</button>
                        </span>
                      </li>`;
                  }).join('') : `<li class="olm-empty">
                      <span class="bms-empty-ic">${I.list}</span>
                      <span>${escHtml(t('orderList.emptyList'))}</span>
                      ${adding ? '' : `<button type="button" class="btn btn-primary btn-sm olm-add-toggle">${I.plus}<span>${escHtml(t('orderList.add'))}</span></button>`}
                    </li>`}
                </ol>
                <div class="lo-edge lo-edge-last">${escHtml(t('order.last'))}</div>
              </div>
            </section>
            ${adding ? renderAddPane() : ''}
          </div>
          `;
    }

    function renderAddPane(): string {
        const v = viewed();
        return `
          <section class="olm-addpane" id="olm-addpane" aria-labelledby="olm-add-h">
            <div class="olm-add-h">
              <span class="bms-label" id="olm-add-h">${escHtml(t('orderList.add'))}</span>
              <span class="bms-spacer"></span>
              <button type="button" class="lo-mv olm-add-close" title="${escAttr(t('common.close'))}" aria-label="${escAttr(t('common.close'))}">${I.remove}</button>
            </div>
            <label class="olm-searchbox" title="${escAttr(t('orderList.pick.hint'))}">
              ${I.search}
              <input type="search" class="olm-search" value="${escAttr(query)}" placeholder="${escAttr(t('orderList.searchPlaceholder'))}" aria-label="${escAttr(t('orderList.searchPlaceholder'))}"
                role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="olm-picks">
            </label>
            <div class="olm-add-meta"><span class="olm-pick-count"></span><span class="olm-pick-hint">${escHtml(t('orderList.pick.hint'))}</span></div>
            <ul class="olm-picks" id="olm-picks" role="listbox" aria-multiselectable="true" aria-label="${escAttr(t('orderList.add'))}"></ul>
            <div class="olm-add-foot">
              ${v ? `<button type="button" class="btn btn-ghost btn-sm olm-add-profile" title="${escAttr(fill('orderList.addFromProfileTip', { p: v.name }))}">${escHtml(fill('orderList.addFromProfile', { p: v.name }))}</button>` : ''}
              <span class="bms-spacer"></span>
              <button type="button" class="btn btn-primary btn-sm olm-add-sel" disabled></button>
            </div>
          </section>`;
    }

    /** The results only: typing in the search box redraws this, never the whole view. */
    function renderPicks(): void {
        const ul = main.querySelector<HTMLElement>('.olm-picks');
        if (!ul || !draft) return;
        const rows = searchLibrary(library, draft.entries, query);
        const v = viewed();
        const activeSet = new Set(v?.active_mods || []);
        const isOn = (m: LibraryMod) => (v && Array.isArray(v.active_mods) ? activeSet.has(m.id) : !!m.enabled);
        if (hi >= rows.length) hi = rows.length - 1;
        ul.innerHTML = rows.length ? rows.map(({ mod: m, listed }, i) => {
            const host = sourceHost(m);
            const sel = picked.has(m.id);
            return `<li id="olm-pk-${i}" role="option" class="olm-pk${i === hi ? ' is-hi' : ''}${listed ? ' is-listed' : ''}" data-id="${escAttr(m.id)}"
                aria-selected="${sel}"${listed ? ' aria-disabled="true"' : ''}>
                <span class="olm-pc-box" aria-hidden="true">${I.check}</span>
                <span class="olm-pk-main">
                  <span class="olm-entry-line"><span class="olm-entry-name">${escHtml(m.name || m.id)}</span>${m.version ? `<span class="olm-ver">${escHtml(m.version)}</span>` : ''}</span>
                  <span class="olm-pk-src">${host ? escHtml(host) : escHtml(t('orderList.pick.local'))}</span>
                </span>
                ${listed
                    ? `<span class="olm-st is-listed">${escHtml(t('orderList.pick.inList'))}</span>`
                    : `<span class="olm-st ${isOn(m) ? 'is-on' : 'is-off'}">${escHtml(t(isOn(m) ? 'orderList.pick.on' : 'orderList.pick.off'))}</span>`}
              </li>`;
        }).join('') : `<li class="olm-pk-empty" role="presentation">${I.search}<span>${escHtml(t(library.length ? 'orderList.pick.none' : 'orderList.pick.emptyLib'))}</span></li>`;
        const count = main.querySelector('.olm-pick-count');
        if (count) count.textContent = fill('orderList.pick.results', { n: rows.length });
        const q = main.querySelector<HTMLInputElement>('.olm-search');
        if (q) {
            if (hi >= 0 && rows.length) q.setAttribute('aria-activedescendant', `olm-pk-${hi}`);
            else q.removeAttribute('aria-activedescendant');
        }
        const btn = main.querySelector<HTMLButtonElement>('.olm-add-sel');
        if (btn) {
            btn.disabled = !picked.size;
            btn.textContent = fill('orderList.addSelected', { n: picked.size });
        }
        ul.querySelector('.is-hi')?.scrollIntoView({ block: 'nearest' });
    }

    // ── Apply / Activate views ─────────────────────────────────────────────────────────────
    function renderApply(): string {
        return `
          <div class="olm-step">
            <h4 class="olm-h">${escHtml(fill('orderList.applyTitle', { m: saved!.name }))}</h4>
            <p class="osh-note">${escHtml(t('orderList.applyLede'))}</p>
            <div class="olm-targets-h">
              <span class="bms-label" id="olm-ap-h">${escHtml(t('orderList.applyTo'))}</span>
              <span class="bms-spacer"></span>
              <button type="button" class="btn btn-ghost btn-sm olm-target-all"${applyTargets.size === profiles.length ? ' disabled' : ''}>${escHtml(t('orderList.scopeAll'))}</button>
              <button type="button" class="btn btn-ghost btn-sm olm-target-none"${applyTargets.size ? '' : ' disabled'}>${escHtml(t('orderList.scopeNone'))}</button>
            </div>
            <div class="olm-pchips olm-pchips-free" role="group" aria-labelledby="olm-ap-h">
              ${profiles.map((p) => profileChip(p, applyTargets.has(p.id), 'olm-target', false)).join('')}
            </div>
            <div class="olm-result"></div>
          </div>`;
    }

    function renderActivate(p: ListPlan | null, exclusive: boolean): string {
        const c = activationCounts(p, exclusive);
        const names = (xs: { name: string }[]) => xs.map((x) => `<li>${escHtml(x.name)}</li>`).join('');
        const missingRows = (p?.rows || []).filter((r) => r.state === 'missing');
        return `
          <div class="olm-step">
            <h4 class="olm-h">${escHtml(fill('orderList.activateTitle', { m: saved!.name, p: activeId ? nameOfProfile(activeId) : '' }))}</h4>
            <p class="osh-note">${escHtml(t('orderList.activateLede'))}</p>
            ${!p ? `<p class="osh-note">${escHtml(t('order.import.reading'))}</p>` : `
            <div class="olm-counts">
              <span class="bms-chip${c.enable ? ' bms-chip--ok' : ''}"><span class="bms-dot"></span>${escHtml(fill('orderList.act.enable', { n: c.enable }))}</span>
              <span class="bms-chip"><span class="bms-dot"></span>${escHtml(fill('orderList.act.already', { n: c.already }))}</span>
              ${c.missing ? `<span class="bms-chip bms-chip--warn"><span class="bms-dot"></span>${escHtml(fill('orderList.act.missing', { n: c.missing }))}</span>` : ''}
              ${c.disable ? `<span class="bms-chip bms-chip--warn"><span class="bms-dot"></span>${escHtml(fill('orderList.act.disable', { n: c.disable }))}</span>` : ''}
            </div>
            ${c.enable ? `<details class="osh-more olm-card" open><summary>${escHtml(fill('orderList.act.enableList', { n: c.enable }))}</summary><ol>${names(p.to_activate)}</ol></details>` : ''}
            ${c.missing ? `<details class="osh-more olm-card"><summary>${escHtml(fill('orderList.act.missingList', { n: c.missing }))}</summary><ul>${names(missingRows)}</ul></details>` : ''}
            <label class="olm-excl${exclusive ? ' is-on' : ''}"><input type="checkbox" class="olm-exclusive"${exclusive ? ' checked' : ''}><span>${escHtml(t('orderList.exclusive'))}</span></label>
            ${c.disable ? `<details class="osh-more olm-card" open><summary>${escHtml(fill('orderList.act.disableList', { n: c.disable }))}</summary><ul>${names(p.to_deactivate)}</ul></details>` : ''}`}
            <div class="olm-result">${job ? `<p class="osh-note">${escHtml(t('orderList.background'))}</p>` : ''}</div>
          </div>`;
    }

    // ── Footer ─────────────────────────────────────────────────────────────────────────────
    function renderFoot(): void {
        const status = `<span class="osh-status olm-status" aria-live="polite">${escHtml(statusText)}</span>`;
        const closeBtn = `<button type="button" class="btn btn-ghost btn-sm olm-done">${escHtml(t('common.close'))}</button>`;
        let start = '';
        let end = '';
        if (draft && mode === 'edit') {
            const d = dirty();
            start = `<button type="button" class="btn btn-outline-danger btn-sm olm-delete${confirmDelete ? ' is-armed' : ''}"${saved ? '' : ' disabled'}>${escHtml(t('orderList.delete'))}</button>`;
            end = `
              <button type="button" class="btn btn-ghost btn-sm olm-share"${saved ? '' : ' disabled'}>${escHtml(t('order.share.btn'))}</button>
              <button type="button" class="btn btn-secondary btn-sm olm-go-apply"${saved ? '' : ' disabled'} title="${escAttr(t('orderList.applyTip'))}">${escHtml(t('orderList.apply'))}</button>
              <span class="olm-foot-sep" aria-hidden="true"></span>
              <button type="button" class="btn ${d ? 'btn-primary' : 'btn-secondary'} btn-sm olm-save"${d && draft.name.trim() ? '' : ' disabled'}>${escHtml(t('orderList.save'))}</button>
              <button type="button" class="btn ${d ? 'btn-secondary' : 'btn-primary'} btn-sm olm-go-activate"${saved ? '' : ' disabled'} title="${escAttr(t('orderList.activateTip'))}">${escHtml(t('orderList.activate'))}</button>`;
        } else if (draft && mode === 'apply') {
            end = `
              <button type="button" class="btn btn-secondary btn-sm olm-back">${escHtml(t('common.cancel'))}</button>
              <button type="button" class="btn btn-primary btn-sm olm-apply-go"${applyTargets.size ? '' : ' disabled'}>${escHtml(t('orderList.applyGo'))}</button>`;
        } else if (draft && mode === 'activate') {
            const c = activationCounts(activePlan, exclusive);
            const p = activePlan;
            end = `
              <button type="button" class="btn btn-ghost btn-sm olm-cancel-op"${busy ? '' : ' hidden'}>${escHtml(t('orderList.stop'))}</button>
              <button type="button" class="btn btn-secondary btn-sm olm-back">${escHtml(t('common.cancel'))}</button>
              <button type="button" class="btn btn-primary btn-sm olm-activate-go"${!busy && p && (c.enable || c.disable || p.order_changed || c.already) ? '' : ' disabled'}>${escHtml(exclusive ? t('orderList.activateOnlyGo') : t('orderList.activateGo'))}</button>`;
        }
        foot.innerHTML = `
          <div class="olm-foot-start">${start}</div>
          ${status}
          <div class="olm-foot-end">${end}${end ? '<span class="olm-foot-sep" aria-hidden="true"></span>' : ''}${closeBtn}</div>`;
    }

    let exclusive = false;
    let activePlan: ListPlan | null = null;
    let confirmDelete = false;

    /** A selector that finds the focused control again after a redraw. */
    function focusSelector(): string | null {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !ov.contains(el)) return null;
        if (el.id) return `#${CSS.escape(el.id)}`;
        const cls = [...el.classList].find((c) => c.startsWith('olm-') && c !== 'olm-pc-tog');
        const tog = el.classList.contains('olm-pc-tog') ? [...el.classList].find((c) => c === 'olm-scope' || c === 'olm-target') : null;
        const name = tog || cls;
        if (!name) return null;
        const key = el.dataset.i != null ? `[data-i="${CSS.escape(el.dataset.i)}"]` : el.dataset.pid != null ? `[data-pid="${CSS.escape(el.dataset.pid)}"]` : '';
        return `.${name}${key}`;
    }

    function render(): void {
        const sel = pendingFocus || focusSelector();
        pendingFocus = null;
        const keep = ['.olm-scroll', '.olm-pchips', '.olm-lists'].map((s) => [s, ov.querySelector(s)?.scrollTop || 0] as const);
        renderSide();
        main.classList.toggle('is-edit', !!draft && mode === 'edit');
        if (!draft) {
            main.innerHTML = `
              <div class="bms-empty olm-intro">
                <span class="bms-empty-ic">${I.list}</span>
                <span class="bms-empty-t">${escHtml(t('orderList.introTitle'))}</span>
                <span class="olm-intro-text">${escHtml(t('orderList.intro'))}</span>
                <button type="button" class="btn btn-primary btn-sm olm-new-main">${I.plus}<span>${escHtml(t('orderList.new'))}</span></button>
              </div>`;
        } else {
            const notesTop = main.querySelector('.olm-desc')?.scrollTop || 0;
            main.innerHTML = mode === 'apply' ? renderApply() : mode === 'activate' ? renderActivate(activePlan, exclusive) : renderEdit();
            mountNotes(notesTop);
            if (mode === 'edit' && adding) renderPicks();
        }
        renderFoot();
        for (const [s, top] of keep) { const el = ov.querySelector(s); if (el) el.scrollTop = top; }
        if (sel) {
            const el = ov.querySelector<HTMLElement>(sel);
            if (el && !(el as HTMLButtonElement).disabled) {
                el.focus({ preventScroll: true });
                if (el instanceof HTMLInputElement && (el.type === 'search' || el.type === 'text')) el.setSelectionRange(el.value.length, el.value.length);
            }
        }
    }

    /** The rendered notes into their slot: the same node while the text is the same. */
    function mountNotes(top: number): void {
        const slot = main.querySelector('.olm-desc-slot');
        if (!slot || !draft) return;
        const src = draft.description || '';
        const key = `${draft.imported ? 1 : 0}\u0000${src}`;
        if (!notesNode || key !== notesKey) {
            notesNode = document.createElement('div');
            notesNode.className = 'olm-desc dh-content';
            notesNode.tabIndex = 0;
            notesNode.setAttribute('role', 'region');
            notesNode.setAttribute('aria-label', t('orderList.notes'));
            paintNotes(notesNode, src, !!draft.imported);
            notesKey = key;
        }
        slot.replaceWith(notesNode);
        notesNode.scrollTop = top;
    }

    /** The notes in the large editor (or the large read view): every keystroke goes to the draft. */
    function editNotes(readOnly: boolean): void {
        if (!draft || notesEditor) return;
        notesEditor = openNotesEditor({
            listName: draft.name,
            value: draft.description || '',
            imported: !!draft.imported,
            readOnly,
            onInput: (value) => {
                if (!draft) return;
                draft = { ...draft, description: value };
                const mark = main.querySelector<HTMLElement>('.olm-unsaved');
                if (mark) mark.hidden = !dirty();
                renderFoot();
            },
            onSave: async () => (draft && draft.name.trim() ? save() : false),
            onClose: () => {
                notesEditor = null;
                pendingFocus = '.olm-notes-toggle';
                render();
            },
        });
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
        if (mode === 'edit') render();
    }

    function open(l: OrderList | null, asNew?: OrderList): void {
        saved = l ? clone(l) : null;
        draft = asNew ? asNew : l ? clone(l) : blank();
        plan = null;
        mode = 'edit';
        query = '';
        picked.clear();
        hi = -1;
        confirmDelete = false;
        adding = !draft.entries.length;
        render();
        void refreshPlan();
        main.querySelector<HTMLInputElement>('.olm-name')?.focus();
    }

    function edit(next: OrderList): void {
        draft = next;
        confirmDelete = false;
        render();
        void refreshPlan();
    }

    function addPicked(ids: string[]): void {
        if (!draft || !ids.length) return;
        const byId = new Map(library.map((m) => [m.id, m]));
        const mods = ids.map((id) => byId.get(id)).filter(Boolean) as LibraryMod[];
        const next = addMods(draft.entries, mods);
        const n = next.length - draft.entries.length;
        picked.clear();
        say(fill('orderList.addedN', { n }));
        edit({ ...draft, entries: next });
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

    /** The active mods of the profile shown, in its current order, as library mods. */
    async function profileOrder(): Promise<LibraryMod[]> {
        const res = await invoke('mod_order_get', { profileId: planFor }) as [{ id: string }[], unknown];
        const ids = (Array.isArray(res?.[0]) ? res[0] : []).map((m) => m.id);
        const byId = new Map(library.map((m) => [m.id, m]));
        return ids.map((id) => byId.get(id)).filter(Boolean) as LibraryMod[];
    }

    async function fromProfile(): Promise<void> {
        try {
            const mods = await profileOrder();
            const base = blank();
            base.name = planFor ? fill('orderList.fromProfileName', { p: nameOfProfile(planFor) }) : '';
            if (planFor) base.profile_ids = [planFor];
            open(null, { ...base, entries: addMods([], mods) });
        } catch (e) {
            say(t(String(e)));
        }
    }

    async function addFromProfile(): Promise<void> {
        if (!draft) return;
        try {
            const mods = await profileOrder();
            if (!draft) return;
            const next = addMods(draft.entries, mods);
            say(fill('orderList.addedN', { n: next.length - draft.entries.length }));
            edit({ ...draft, entries: next });
        } catch (e) {
            say(t(String(e)));
        }
    }

    function importList(): void {
        const { ov: iov, close: iclose } = dialog('olmi', t('orderList.importTitle'), `
            <label class="osh-label" for="olmi-text">${escHtml(t('orderList.importPaste'))}</label>
            <textarea id="olmi-text" class="form-input osh-text" rows="5" spellcheck="false" placeholder="${escAttr(t('order.import.placeholder'))}"></textarea>
            <div class="osh-row">
              <button type="button" class="btn btn-secondary btn-sm olmi-file">${I.file}<span>${escHtml(t('orderList.importFile'))}</span></button>
              <span class="osh-kind olmi-file-name"></span>
            </div>
            <input type="file" class="olmi-input" accept=".bmmorder,.json,.txt,application/json,text/plain" hidden>
            <div class="osh-plan olmi-plan" aria-live="polite"></div>`,
            `<span class="osh-status olmi-status"></span>
             <button type="button" class="btn btn-secondary btn-sm olmi-cancel">${escHtml(t('common.cancel'))}</button>
             <button type="button" class="btn btn-primary btn-sm olmi-use" disabled>${escHtml(t('orderList.importUse'))}</button>`);
        const text = iov.querySelector('#olmi-text') as HTMLTextAreaElement;
        const planEl = iov.querySelector('.olmi-plan') as HTMLElement;
        const st = iov.querySelector('.olmi-status') as HTMLElement;
        const use = iov.querySelector('.olmi-use') as HTMLButtonElement;
        const fileInput = iov.querySelector('.olmi-input') as HTMLInputElement;
        const fileName = iov.querySelector('.olmi-file-name') as HTMLElement;
        let got: ImportedList | null = null;
        let timer = 0;
        let iseq = 0;
        // A file is read whole and handed to the backend as is (it validates and caps it); the
        // text box shows its name rather than 20 000 characters of JSON.
        let fileText: string | null = null;
        const read = async () => {
            const raw = fileText ?? text.value;
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
                const notesN = notesLength(r.notes || '');
                planEl.innerHTML = `
                  <div class="osh-chips">
                    <span class="osh-chip is-ok">${escHtml(fill('order.import.placed', { n: found, m: qs.length }))}</span>
                    ${notesN ? `<span class="osh-chip" title="${escAttr(t('orderList.importedTip'))}">${escHtml(fill('orderList.importNotes', { n: notesN.toLocaleString() }))}</span>` : ''}
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
        text.addEventListener('input', () => {
            fileText = null;
            fileName.textContent = '';
            window.clearTimeout(timer);
            timer = window.setTimeout(() => { void read(); }, 250);
        });
        iov.querySelector('.olmi-file')?.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            const f = fileInput.files?.[0];
            fileInput.value = '';
            if (!f) return;
            if (f.size > MAX_FILE_BYTES) { st.textContent = t('order.errTooLarge'); return; }
            const r = new FileReader();
            r.onload = () => {
                fileText = String(r.result || '');
                text.value = '';
                fileName.textContent = f.name;
                void read();
            };
            r.onerror = () => { st.textContent = t('orderList.errFile'); };
            r.readAsText(f);
        });
        iov.querySelector('.olmi-cancel')?.addEventListener('click', iclose);
        use.addEventListener('click', () => {
            if (!got) return;
            const base = blank();
            base.name = got.name || t('orderList.importedName');
            base.game = got.game;
            base.entries = got.entries;
            // Somebody else's: the notes take the untrusted path, now and after saving.
            base.description = got.notes || '';
            base.imported = true;
            iclose();
            open(null, base);
            say(t('orderList.importedDraft'));
        });
        text.focus();
    }

    /**
     * Share the SAVED list: the one-line code when it is short enough for a chat window, and
     * the .bmmorder file always (the whole list, notes included). Past the code's ceiling the
     * dialog says so and the file is the primary way.
     */
    async function share(): Promise<void> {
        if (!saved) return;
        let out: ListExport;
        try {
            out = await invoke('order_list_export', { id: saved.id }) as ListExport;
        } catch (e) {
            say(fill('order.share.failed', { e: t(String(e)) }));
            return;
        }
        const n = (s: number) => s.toLocaleString();
        const hasCode = !!out.code;
        const { ov: sov, close: sclose } = dialog('olms', fill('orderList.shareTitle', { m: saved.name }), `
            <p class="osh-lede">${escHtml(t('orderList.shareLede'))}</p>
            <section class="olms-way${hasCode ? '' : ' is-off'}" aria-labelledby="olms-code-h">
              <div class="olms-way-h">
                <span class="olms-way-ic" aria-hidden="true">${I.copy}</span>
                <span class="olms-way-t" id="olms-code-h">${escHtml(t('orderList.shareCode'))}</span>
                <span class="olms-len${hasCode ? '' : ' is-over'}">${escHtml(fill('orderList.shareLen', { n: n(out.code_len), m: n(out.code_max) }))}</span>
              </div>
              <p class="osh-note">${escHtml(hasCode ? t('orderList.shareCodeLede') : t('orderList.shareTooLong'))}</p>
              <div class="olms-acts">
                <button type="button" class="btn ${hasCode ? 'btn-primary' : 'btn-secondary'} btn-sm olms-copy"${hasCode ? '' : ' disabled'}>${I.copy}<span>${escHtml(t('order.share.copyCode'))}</span></button>
                <button type="button" class="btn btn-ghost btn-sm olms-text">${escHtml(t('order.share.copyText'))}</button>
              </div>
            </section>
            <section class="olms-way" aria-labelledby="olms-file-h">
              <div class="olms-way-h">
                <span class="olms-way-ic" aria-hidden="true">${I.file}</span>
                <span class="olms-way-t" id="olms-file-h">${escHtml(t('orderList.shareFile'))}</span>
                <code class="olms-fname">${escHtml(out.file_name)}</code>
              </div>
              <p class="osh-note">${escHtml(out.notes_len ? fill('orderList.shareFileLedeNotes', { n: n(out.notes_len) }) : t('orderList.shareFileLede'))}</p>
              <div class="olms-acts">
                <button type="button" class="btn ${hasCode ? 'btn-secondary' : 'btn-primary'} btn-sm olms-save">${I.file}<span>${escHtml(t('orderList.shareSave'))}</span></button>
              </div>
            </section>`,
            `<span class="osh-status olms-status" aria-live="polite"></span>
             <button type="button" class="btn btn-secondary btn-sm olms-done">${escHtml(t('common.close'))}</button>`);
        const st = sov.querySelector('.olms-status') as HTMLElement;
        sov.querySelector('.olms-copy')?.addEventListener('click', async () => {
            if (!out.code) return;
            st.textContent = (await copy(out.code)) ? t('orderList.shareCopied') : t('order.share.copyFailed');
        });
        sov.querySelector('.olms-text')?.addEventListener('click', async () => {
            st.textContent = (await copy(out.text)) ? t('order.share.copied') : t('order.share.copyFailed');
        });
        sov.querySelector('.olms-save')?.addEventListener('click', async () => {
            const dest = await saveFile({ defaultPath: out.file_name, filters: [{ name: t('orderList.shareFileFilter'), extensions: ['bmmorder'] }] });
            if (!dest) return;
            try {
                await invoke('write_text_file', { path: dest, content: out.file });
                st.textContent = t('orderList.shareSaved');
                say(t('orderList.shareSaved'));
            } catch (e) {
                st.textContent = fill('order.share.failed', { e: t(String(e)) });
            }
        });
        sov.querySelector('.olms-done')?.addEventListener('click', sclose);
        (sov.querySelector(hasCode ? '.olms-copy' : '.olms-save') as HTMLElement | null)?.focus();
    }

    async function del(): Promise<void> {
        if (!saved || busy) return;
        if (!confirmDelete) {
            confirmDelete = true;
            say(fill('orderList.deleteConfirm', { m: saved.name }));
            pendingFocus = '.olm-delete';
            renderFoot();
            foot.querySelector<HTMLElement>('.olm-delete')?.focus();
            return;
        }
        confirmDelete = false;
        try {
            await invoke('order_list_delete', { id: saved.id });
            lists = lists.filter((l) => l.id !== saved!.id);
            saved = null;
            draft = null;
            say(t('orderList.deleted'));
            render();
            (ov.querySelector('.olm-new') as HTMLElement | null)?.focus();
        } catch (e) {
            say(t(String(e)));
        }
    }

    function goApply(): void {
        if (!saved) return;
        applyTargets = new Set(saved.profile_ids.length ? saved.profile_ids : planFor ? [planFor] : []);
        mode = 'apply';
        render();
        main.querySelector<HTMLElement>('.olm-target')?.focus();
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

    /** The profiles again (their active mods changed): the picker's on/off reads them. */
    async function reloadProfiles(): Promise<void> {
        try {
            const p = await invoke('get_profiles') as ProfileLite[];
            if (Array.isArray(p)) profiles = p;
        } catch { /* keep the old ones */ }
    }

    /** Start the activation as a job (see the header): the dialog may close while it runs. */
    async function activate(): Promise<void> {
        if (!saved || busy || job) return;
        const list = saved;
        const pid = activeId;
        const only = exclusive;
        let report: ActivateReport | null = null;
        busy = true;
        changedGame = true;
        job = runActivationBatch({
            mods: (activePlan?.to_activate || []).map((m) => ({ id: m.id, name: m.name })),
            mode: 'enable',
            profileId: pid,
            label: fill('orderList.jobLabel', { m: list.name }),
            source: 'order-list',
            run: async (scope) => {
                const r = await invoke('order_list_activate', { id: list.id, exclusive: only, profileId: pid, bypassSha: false, cancelScope: scope }) as ActivateReport;
                report = r;
                dispatchBmmAction(BMM_ACTIONS.ORDER_APPLIED, { moved: r.moved });
                const message = `${fill('orderList.jobLabel', { m: list.name })} · ${fill(r.cancelled ? 'orderList.activatedCancelled' : 'orderList.activated', { n: r.enabled, d: r.disabled, f: r.moved, m: r.missing })}`;
                return { failed: r.failed, cancelled: r.cancelled, toast: { message, kind: r.failed.length || r.cancelled ? 'warning' : 'success', ms: 6000 } };
            },
            failToast: (e) => ({ message: fill('orderList.activateFailed', { e: t(e) }), kind: 'error', ms: 7000 }),
        });
        render();
        say(t('orderList.activating'));
        const sum = await job.done;
        job = null;
        busy = false;
        // Closed meanwhile: the job manager's toast and library refresh said everything.
        if (!ov.isConnected) return;
        const r = report as ActivateReport | null;
        if (r) {
            const msg = fill(r.cancelled ? 'orderList.activatedCancelled' : 'orderList.activated', { n: r.enabled, d: r.disabled, f: r.moved, m: r.missing });
            const failed = r.failed.map((f) => `<li>${escHtml(f.name)}: ${escHtml(f.error.startsWith('MISSING_SHA|') ? t('orderList.failedSha') : t(f.error))}</li>`).join('');
            const res = main.querySelector('.olm-result');
            if (res) res.innerHTML = `<p class="osh-note">${escHtml(msg)}</p>${failed ? `<details class="osh-more olm-card" open><summary>${escHtml(fill('orderList.failed', { n: r.failed.length }))}</summary><ul>${failed}</ul></details>` : ''}`;
            say(msg);
        } else {
            // It never ran: refused before its turn (another profile became active) or stopped
            // while queued.
            const why = sum.error || sum.failed[0]?.error;
            say(why ? fill('orderList.activateFailed', { e: t(why) })
                : t('actjob.summaryCancelled', { label: fill('orderList.jobLabel', { m: list.name }), n: String(sum.done), m: String(sum.total), f: String(sum.failed.length) }));
        }
        void reloadProfiles();
        if (mode === 'activate' && saved) {
            activePlan = await invoke('order_list_plan', { entries: saved.entries, profileId: activeId }).catch(() => activePlan) as ListPlan | null;
        }
        renderFoot();
    }

    async function apply(): Promise<void> {
        if (!saved || busy) return;
        const ids = profiles.map((p) => p.id).filter((id) => applyTargets.has(id));
        if (!ids.length) { say(t('orderList.errNoProfile')); return; }
        busy = true;
        say(t('order.applying'));
        try {
            const out = await invoke('order_list_apply', { id: saved.id, profileIds: ids }) as ApplyOutcome[];
            changedGame = true;
            const res = main.querySelector('.olm-result');
            if (res) res.innerHTML = `<ul class="olm-outcomes">${out.map((o) => `<li class="${o.error ? 'is-bad' : 'is-ok'}"><span class="bms-dot"></span><b>${escHtml(o.profile_name || o.profile_id)}</b> ${escHtml(o.error
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

    function toggleAdding(open: boolean): void {
        adding = open;
        if (!open) { picked.clear(); hi = -1; }
        pendingFocus = open ? '.olm-search' : '.olm-add-toggle';
        render();
    }

    function setView(pid: string): void {
        if (!pid || pid === planFor) return;
        planFor = pid;
        plan = null;
        render();
        void refreshPlan();
    }

    // ── Wiring (delegated on the dialog: the view is redrawn often) ────────────────────────
    ov.querySelector('.olm-new')?.addEventListener('click', () => open(null));
    ov.querySelector('.olm-from')?.addEventListener('click', () => { void fromProfile(); });
    ov.querySelector('.olm-import')?.addEventListener('click', importList);
    side.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.olm-pick');
        const l = b && lists.find((x) => x.id === b.dataset.id);
        if (l) open(l);
    });

    foot.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!btn) return;
        const c = btn.classList;
        if (c.contains('olm-done')) close();
        if (!draft) return;
        if (c.contains('olm-save')) void save();
        else if (c.contains('olm-delete')) void del();
        else if (c.contains('olm-share')) void share();
        else if (c.contains('olm-go-apply')) goApply();
        else if (c.contains('olm-go-activate')) void goActivate();
        else if (c.contains('olm-back')) { if (!busy) { mode = 'edit'; render(); void refreshPlan(); } }
        else if (c.contains('olm-apply-go')) void apply();
        else if (c.contains('olm-activate-go')) void activate();
        else if (c.contains('olm-cancel-op')) { if (job) { void job.cancel(); say(t('orderList.stopping')); } }
    });

    main.addEventListener('click', (e) => {
        const el = e.target as HTMLElement;
        if (el.closest('.olm-new-main')) { open(null); return; }
        if (!draft) return;
        const opt = el.closest<HTMLElement>('.olm-pk');
        if (opt) {
            const id = opt.dataset.id || '';
            if (!id || opt.classList.contains('is-listed')) return;
            if (picked.has(id)) picked.delete(id); else picked.add(id);
            hi = Number(opt.id.replace('olm-pk-', ''));
            renderPicks();
            main.querySelector<HTMLInputElement>('.olm-search')?.focus({ preventScroll: true });
            return;
        }
        const btn = el.closest<HTMLButtonElement>('button');
        if (!btn) return;
        const c = btn.classList;
        const i = Number(btn.dataset.i);
        if (c.contains('olm-up')) { pendingFocus = i - 1 > 0 ? `.olm-up[data-i="${i - 1}"]` : `.olm-down[data-i="${i - 1}"]`; edit({ ...draft, entries: moveEntry(draft.entries, i, i - 1) }); }
        else if (c.contains('olm-down')) { pendingFocus = i + 1 < draft.entries.length - 1 ? `.olm-down[data-i="${i + 1}"]` : `.olm-up[data-i="${i + 1}"]`; edit({ ...draft, entries: moveEntry(draft.entries, i, i + 1) }); }
        else if (c.contains('olm-rm')) {
            const left = draft.entries.length - 1;
            pendingFocus = left ? `.olm-rm[data-i="${Math.min(i, left - 1)}"]` : '.olm-add-toggle';
            edit({ ...draft, entries: removeEntry(draft.entries, i) });
        }
        else if (c.contains('olm-scope')) {
            const pid = btn.dataset.pid || '';
            const ids = draft.profile_ids.includes(pid) ? draft.profile_ids.filter((x) => x !== pid) : [...draft.profile_ids, pid];
            draft = { ...draft, profile_ids: profiles.map((p) => p.id).filter((id) => ids.includes(id)) };
            render();
        }
        else if (c.contains('olm-scope-all')) { draft = { ...draft, profile_ids: profiles.map((p) => p.id) }; pendingFocus = '.olm-scope-none'; render(); }
        else if (c.contains('olm-scope-none')) { draft = { ...draft, profile_ids: [] }; pendingFocus = '.olm-scope-all'; render(); }
        else if (c.contains('olm-pc-eye')) { pendingFocus = `.olm-pc-eye[data-pid="${CSS.escape(btn.dataset.pid || '')}"]`; setView(btn.dataset.pid || ''); }
        else if (c.contains('olm-target')) {
            const pid = btn.dataset.pid || '';
            if (applyTargets.has(pid)) applyTargets.delete(pid); else applyTargets.add(pid);
            render();
        }
        else if (c.contains('olm-target-all')) { applyTargets = new Set(profiles.map((p) => p.id)); pendingFocus = '.olm-target-none'; render(); }
        else if (c.contains('olm-target-none')) { applyTargets = new Set(); pendingFocus = '.olm-target-all'; render(); }
        else if (c.contains('olm-notes-toggle')) editNotes(false);
        else if (c.contains('olm-notes-expand')) editNotes(true);
        else if (c.contains('olm-add-toggle')) toggleAdding(!adding);
        else if (c.contains('olm-add-close')) toggleAdding(false);
        else if (c.contains('olm-add-sel')) addPicked([...picked]);
        else if (c.contains('olm-add-profile')) void addFromProfile();
    });

    main.addEventListener('dblclick', (e) => {
        const opt = (e.target as HTMLElement).closest<HTMLElement>('.olm-pk');
        if (!opt || !draft || opt.classList.contains('is-listed') || !opt.dataset.id) return;
        picked.delete(opt.dataset.id);
        pendingFocus = '.olm-search';
        addPicked([opt.dataset.id]);
    });

    main.addEventListener('input', (e) => {
        const el = e.target as HTMLInputElement;
        if (!draft) return;
        if (el.classList.contains('olm-name')) {
            draft = { ...draft, name: el.value };
            const mark = main.querySelector<HTMLElement>('.olm-unsaved');
            if (mark) mark.hidden = !dirty();
            renderFoot();
        } else if (el.classList.contains('olm-search')) {
            query = el.value;
            hi = query ? 0 : -1;
            renderPicks();
        }
    });

    main.addEventListener('keydown', (e) => {
        const el = e.target as HTMLElement;
        if (!draft) return;
        // The search box drives the results (combobox): ↑/↓ move, Enter adds.
        if (el.classList.contains('olm-search')) {
            const opts = [...main.querySelectorAll<HTMLElement>('.olm-pk')];
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (!opts.length) return;
                e.preventDefault();
                hi = e.key === 'ArrowDown' ? Math.min(opts.length - 1, hi + 1) : Math.max(0, hi - 1);
                renderPicks();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (picked.size) { pendingFocus = '.olm-search'; addPicked([...picked]); return; }
                const opt = opts[hi];
                if (opt && !opt.classList.contains('is-listed') && opt.dataset.id) { pendingFocus = '.olm-search'; addPicked([opt.dataset.id]); }
            } else if (e.key === ' ' && hi >= 0 && e.ctrlKey) {
                // Ctrl+Space selects the highlighted result (a plain space is typed).
                e.preventDefault();
                const id = opts[hi]?.dataset.id;
                if (id && !opts[hi].classList.contains('is-listed')) { if (picked.has(id)) picked.delete(id); else picked.add(id); renderPicks(); }
            }
            return;
        }
        // Alt+↑/↓ on a row's controls moves the row, like the order view.
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            const row = el.closest<HTMLElement>('.olm-entry');
            if (!row) return;
            const i = Number(row.dataset.i);
            const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
            if (j < 0 || j >= draft.entries.length) return;
            e.preventDefault();
            const cls = [...el.classList].find((c) => c === 'olm-up' || c === 'olm-down' || c === 'olm-rm') || 'olm-rm';
            pendingFocus = `.${cls}[data-i="${j}"]`;
            edit({ ...draft, entries: moveEntry(draft.entries, i, j) });
        }
    });

    main.addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement;
        if (!draft) return;
        if (el.classList.contains('olm-exclusive')) {
            exclusive = el.checked;
            pendingFocus = '.olm-exclusive';
            render();
        }
    });

    // Drag and drop on the rows: the drop line goes above or below the row under the pointer.
    let dragFrom = -1;
    const clearMarks = () => main.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    main.addEventListener('dragstart', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.olm-entry');
        if (!row || !draft || busy) { if (row) e.preventDefault(); return; }
        dragFrom = Number(row.dataset.i);
        row.classList.add('is-dragging');
        try { e.dataTransfer?.setData('text/plain', String(dragFrom)); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; } catch { /* some hosts refuse */ }
    });
    main.addEventListener('dragover', (e) => {
        if (dragFrom < 0) return;
        const row = (e.target as HTMLElement).closest<HTMLElement>('.olm-entry');
        if (!row) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        clearMarks();
        row.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
    });
    main.addEventListener('drop', (e) => {
        if (dragFrom < 0 || !draft) return;
        e.preventDefault();
        const row = (e.target as HTMLElement).closest<HTMLElement>('.olm-entry');
        const from = dragFrom;
        dragFrom = -1;
        clearMarks();
        if (!row) return;
        const r = row.getBoundingClientRect();
        const to = dropIndex(from, Number(row.dataset.i), e.clientY > r.top + r.height / 2);
        if (to !== from) edit({ ...draft, entries: moveEntry(draft.entries, from, to) });
    });
    main.addEventListener('dragend', () => { dragFrom = -1; clearMarks(); main.querySelectorAll('.is-dragging').forEach((x) => x.classList.remove('is-dragging')); });

    render();
    (ov.querySelector('.olm-new') as HTMLElement | null)?.focus();
}

/** The mod list redraws itself from the backend after an activation or a reorder. */
function refreshMods(): void {
    const w = window as any;
    if (typeof w._refreshModsFn === 'function') w._refreshModsFn(false, true);
    else window.dispatchEvent(new CustomEvent('bmm://mods-updated'));
}
