/**
 * modpack-activate.ts — "Activate a modpack": pick a pack, see what will change, run it as a job.
 *
 * Two steps in one house dialog (ui/modal-shell.ts):
 *  · pick   the packs, searchable, each with its state (off / partly on / on);
 *  · plan   for one pack, before anything is touched: the mods to enable, the ones already on,
 *           the missing ones, the file conflicts that will be live afterwards, the integrity
 *           warnings (no hashes, hashes that no longer match, check_modpack_integrity), and the
 *           options: only this pack (the other mods go off), where the block goes in the
 *           activation order, enabling the mods without hashes anyway.
 *
 * Activate hands the work to the activation job manager (core/activation-jobs.ts) the way an
 * order list's « Activate… » does: runActivationBatch, so the job runs in the background,
 * survives navigation, shows in the global pill, is cancelled by its Stop, and the cards play
 * their activation animation from its progress events. The dialog closes once it is queued.
 *
 * The plan itself is pure (modpack-plan-model.ts). No import of modpack-creator.ts / mods.ts /
 * app.ts: the caller passes a repair callback, and refresh and toast are reached on window.
 */
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { appState } from '../../core/state.js';
import { uiIcon } from '../../ui/icons.js';
import { openModal, type ModalHandle } from '../../ui/modal-shell.js';
import { runActivationBatch, runActivationJob, getActivationJobs } from '../../core/activation-jobs.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { planModpack, planConflicts, findLocal, type ModpackPlan, type LocalMod, type PackLike } from './modpack-plan-model.js';

const w = (): any => window as any;
const toast = (msg: string, kind: string, ms?: number): void => { try { w().toast?.(msg, kind, ms); } catch { /* no toast host */ } };

export interface ActivateOptions {
    /** Called once a job this dialog started has finished (the caller reloads its list). */
    onDone?: () => void;
    /** Opens the pack's repair dialog (missing / corrupted mods); `after` re-plans. */
    repair?: (pack: any, report: any, after: () => void) => void;
    /** Opened from the library's "Activate a modpack": a Back button to the pack list. */
    fromPicker?: boolean;
}

interface Data {
    packs: any[];
    all: LocalMod[];
    library: LocalMod[];
    activeId: string | null;
}

async function loadData(): Promise<Data> {
    const [packs, all, library, activeId] = await Promise.all([
        invoke('load_modpacks').catch(() => []),
        invoke('get_all_mods').catch(() => []),
        invoke('get_mods').catch(() => []),
        invoke('get_active_profile_id').catch(() => null),
    ]);
    return { packs: (packs as any[]) || [], all: (all as LocalMod[]) || [], library: (library as LocalMod[]) || [], activeId: (activeId as string) || null };
}

async function shaIndexFor(pack: PackLike): Promise<Record<string, string>> {
    const shas = Array.from(new Set((pack.mods || []).map((m) => m.sha256).filter((s): s is string => !!s)));
    if (!shas.length) return {};
    try {
        const map = (await invoke('find_local_mods_by_hashes', { hashes: shas })) as Record<string, string | null>;
        const out: Record<string, string> = {};
        for (const [sha, id] of Object.entries(map || {})) if (id) out[sha] = id;
        return out;
    } catch { return {}; }
}

/** off / partial / on, from ids only (cheap: the list shows it for every pack). */
function quickState(pack: any, mods: LocalMod[]): 'off' | 'partial' | 'on' {
    const found = (pack.mods || []).map((r: any) => findLocal(r, mods, {})).filter(Boolean) as LocalMod[];
    const on = found.filter((m) => m.enabled).length;
    return !found.length || !on ? 'off' : on < found.length ? 'partial' : 'on';
}

function stateChip(state: 'off' | 'partial' | 'on'): string {
    if (state === 'on') return `<span class="bms-chip bms-chip--ok"><span class="bms-dot"></span>${escHtml(t('modpack.act.stateOn'))}</span>`;
    if (state === 'partial') return `<span class="bms-chip bms-chip--warn"><span class="bms-dot"></span>${escHtml(t('modpack.act.statePartial'))}</span>`;
    return `<span class="bms-chip"><span class="bms-dot"></span>${escHtml(t('modpack.act.stateOff'))}</span>`;
}

function packMeta(pack: any): string {
    const n = (pack.mods || []).length;
    const where = pack.multi_profile ? t('modpack.multiProfile') : (pack.game_name || t('modpack.general'));
    return `${escHtml(t('modpack.modsCount', { count: String(n) }))} · ${escHtml(where)}`;
}

function setSub(m: ModalHandle, text: string): void {
    const sub = m.header.querySelector('.bms-sub, .modal-subtitle');
    if (sub) sub.textContent = text;
}

/** The library's "Activate a modpack": the list first. */
export async function openModpackPicker(opts: ActivateOptions = {}): Promise<void> {
    const data = await loadData();
    const m = openModal({
        title: t('modpack.quickApplyTitle'),
        subtitle: t('modpack.act.pickSub', { n: String(data.packs.length) }),
        icon: uiIcon('run', 18),
        size: 'md',
        tall: true,
        className: 'mpa',
        closeLabel: t('common.close'),
        body: '',
        footer: '',
    });
    renderPicker(m, data, opts);
}

function renderPicker(m: ModalHandle, data: Data, opts: ActivateOptions): void {
    setSub(m, t('modpack.act.pickSub', { n: String(data.packs.length) }));
    if (!data.packs.length) {
        m.body.innerHTML = `<div class="bms-empty"><div class="bms-empty-ic">${uiIcon('folders', 20)}</div><div class="bms-empty-t">${escHtml(t('modpack.noModpacks'))}</div><p class="bms-note">${escHtml(t('modpack.act.noPacksHint'))}</p></div>`;
        if (m.footer) m.footer.innerHTML = `<button type="button" class="btn btn-secondary" data-mpa="close">${escHtml(t('common.close'))}</button>`;
        m.footer?.querySelector('[data-mpa="close"]')?.addEventListener('click', () => m.close());
        return;
    }
    m.body.innerHTML = `
        <div class="mpa-toolbar">
            <label class="pg-search mpa-search">${uiIcon('search', 14)}<input type="search" class="pg-search-input" id="mpa-q" placeholder="${escAttr(t('common.search'))}" aria-label="${escAttr(t('common.search'))}" autocomplete="off"></label>
            <select id="mpa-filter" class="form-input mpa-filter" aria-label="${escAttr(t('modpack.filterAll'))}">
                <option value="all">${escHtml(t('modpack.filterAll'))}</option>
                <option value="single">${escHtml(t('modpack.singleProfile'))}</option>
                <option value="multi">${escHtml(t('modpack.multiProfile'))}</option>
            </select>
        </div>
        <ul class="mpa-packs" role="list">${data.packs.map((p, i) => `
            <li class="mpa-pack-row" data-i="${i}">
                <button type="button" class="mpa-pack-btn" data-i="${i}">
                    <span class="mpa-pack-ic" aria-hidden="true">${uiIcon('folders', 16)}</span>
                    <span class="mpa-pack-txt"><b>${escHtml(p.name || '')}</b><span>${packMeta(p)}</span></span>
                    ${stateChip(quickState(p, data.all))}
                    <span class="mpa-pack-go" aria-hidden="true">${uiIcon('chevron-right', 16)}</span>
                </button>
            </li>`).join('')}
        </ul>
        <p class="bms-note mpa-none" id="mpa-none" hidden>${escHtml(t('modpack.act.noMatch'))}</p>`;
    if (m.footer) m.footer.innerHTML = `<span class="modal-footer-note mpa-foot-note">${uiIcon('info', 14)}${escHtml(t('modpack.act.pickHint'))}</span><button type="button" class="btn btn-secondary" data-mpa="close">${escHtml(t('common.close'))}</button>`;
    m.footer?.querySelector('[data-mpa="close"]')?.addEventListener('click', () => m.close());

    const q = m.q<HTMLInputElement>('#mpa-q');
    const f = m.q<HTMLSelectElement>('#mpa-filter');
    const apply = () => {
        const needle = (q?.value || '').toLowerCase().trim();
        const kind = f?.value || 'all';
        let shown = 0;
        m.body.querySelectorAll<HTMLElement>('.mpa-pack-row').forEach((row) => {
            const p = data.packs[Number(row.dataset.i)];
            const ok = (!needle || String(p.name || '').toLowerCase().includes(needle))
                && (kind === 'all' || (kind === 'multi') === !!p.multi_profile);
            row.hidden = !ok;
            if (ok) shown++;
        });
        const none = m.q('#mpa-none');
        if (none) none.hidden = shown > 0;
    };
    q?.addEventListener('input', apply);
    f?.addEventListener('change', apply);
    m.body.querySelectorAll<HTMLElement>('.mpa-pack-btn').forEach((b) => {
        b.addEventListener('click', () => { void renderPlan(m, data.packs[Number(b.dataset.i)], { ...opts, fromPicker: true }); });
    });
    // Arrow keys move through the visible packs.
    m.body.querySelector('.mpa-packs')?.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (k !== 'ArrowDown' && k !== 'ArrowUp') return;
        const btns = [...m.body.querySelectorAll<HTMLElement>('.mpa-pack-row:not([hidden]) .mpa-pack-btn')];
        const i = btns.indexOf(document.activeElement as HTMLElement);
        const next = btns[Math.max(0, Math.min(btns.length - 1, i + (k === 'ArrowDown' ? 1 : -1)))];
        if (next) { e.preventDefault(); next.focus(); }
    });
    setTimeout(() => q?.focus(), 0);
}

/** From the modpacks page (or a pack's switch): the plan for that pack directly. */
export async function openModpackActivation(pack: any, opts: ActivateOptions = {}): Promise<void> {
    const m = openModal({
        title: t('modpack.act.title', { name: String(pack?.name || '') }),
        subtitle: t('modpack.act.planSub'),
        icon: uiIcon('run', 18),
        size: 'md',
        tall: true,
        className: 'mpa',
        closeLabel: t('common.close'),
        body: '',
        footer: '',
    });
    await renderPlan(m, pack, opts);
}

interface PlanState {
    exclusive: boolean;
    order: string;
    bypass: boolean;
}

function li(name: string, extra = ''): string {
    return `<li><span class="mpa-li-name">${escHtml(name)}</span>${extra}</li>`;
}

function section(cls: string, icon: string, title: string, n: number, inner: string, open: boolean): string {
    if (!n) return '';
    return `<details class="mpa-sec mpa-sec--${cls}"${open ? ' open' : ''}><summary>${icon}<span>${escHtml(title)}</span><span class="pg-count">${n}</span></summary><div class="mpa-sec-body">${inner}</div></details>`;
}

async function renderPlan(m: ModalHandle, pack: any, opts: ActivateOptions): Promise<void> {
    const title = m.header.querySelector('.modal-title');
    if (title) title.textContent = t('modpack.act.title', { name: String(pack?.name || '') });
    setSub(m, t('modpack.act.planSub'));
    m.body.innerHTML = `<div class="mpa-loading">${uiIcon('loader', 16, { cls: 'np-spin' })}<span>${escHtml(t('modpack.act.reading'))}</span></div>`;
    if (m.footer) m.footer.innerHTML = '';

    const data = await loadData();
    const fresh = data.packs.find((p) => p.id === pack?.id) || pack;
    const sha = await shaIndexFor(fresh);
    const st: PlanState = { exclusive: false, order: fresh.order_mode || '', bypass: false };
    let report: any = null;
    let reportState: 'skip' | 'pending' | 'done' | 'failed' = fresh.skip_integrity_check ? 'skip' : 'pending';

    const draw = (): void => {
        if (!m.overlay.isConnected) return;
        const plan = planModpack(fresh, data.all, sha, { exclusive: st.exclusive, library: data.library });
        const conflicts = planConflicts(plan, data.library.length ? data.library : data.all, ((appState.state as any).conflictCache || {}) as Record<string, any[]>);
        const otherOn = data.library.filter((x) => x.enabled && !plan.packOrder.includes(x.id)).length;
        const corrupted: any[] = report?.corruptedMods || [];
        const integrityN = plan.noHash.length + plan.invalid.length + corrupted.length;

        const tiles = [
            { k: 'enable', n: plan.toEnable.length, label: t('modpack.act.tEnable'), tone: 'accent' },
            { k: 'on', n: plan.alreadyOn.length, label: t('modpack.act.tOn'), tone: 'ok' },
            { k: 'missing', n: plan.missing.length, label: t('modpack.act.tMissing'), tone: plan.missing.length ? 'danger' : '' },
            { k: 'conflicts', n: conflicts.length, label: t('modpack.act.tConflicts'), tone: conflicts.length ? 'warn' : '' },
        ];
        const enableList = plan.toEnable.map((x, i) => li(x.name, `<span class="mpa-li-n">${i + 1}</span>`)).join('');
        const disableList = plan.toDisable.map((x) => li(x.name)).join('');
        const missingList = plan.missing.map((x) => li(x.label)).join('');
        const conflictList = conflicts.map((c) => `<li><span class="mpa-li-name">${escHtml(c.modName)}</span><span class="mpa-li-vs">${uiIcon('arrow-right', 12)}</span><span class="mpa-li-name">${escHtml(c.otherName)}</span><span class="mpa-li-meta">${escHtml(t(c.inPack ? 'modpack.act.conflictInPack' : 'modpack.act.conflictOutside', { n: String(c.files) }))}</span></li>`).join('');
        const integrityList = [
            ...plan.noHash.map((x) => li(x.name, `<span class="mpa-li-meta">${escHtml(t('modpack.act.noHash'))}</span>`)),
            ...plan.invalid.map((x) => li(x.name, `<span class="mpa-li-meta">${escHtml(t('modpack.act.invalidHash'))}</span>`)),
            ...corrupted.map((x) => li(x.mod_name || x.mod_id, `<span class="mpa-li-meta">${escHtml(t('modpack.act.corrupted'))}</span>`)),
        ].join('');
        const integrityChip = reportState === 'pending'
            ? `<span class="bms-chip">${uiIcon('loader', 12, { cls: 'np-spin' })}${escHtml(t('modpack.act.integrityChecking'))}</span>`
            : reportState === 'skip' ? `<span class="bms-chip">${uiIcon('shield', 12)}${escHtml(t('modpack.noCheckChip'))}</span>`
            : reportState === 'failed' ? `<span class="bms-chip bms-chip--warn">${uiIcon('warning', 12)}${escHtml(t('modpack.act.integrityFailed'))}</span>`
            : integrityN ? `<span class="bms-chip bms-chip--warn">${uiIcon('shield', 12)}${escHtml(t('modpack.act.integrityWarn', { n: String(integrityN) }))}</span>`
            : `<span class="bms-chip bms-chip--ok">${uiIcon('shield-check', 12)}${escHtml(t('modpack.act.integrityOk'))}</span>`;
        const canRepair = !!opts.repair && reportState === 'done' && ((report?.missingMods || []).length || corrupted.length);

        m.body.innerHTML = `
            <div class="mpa-head">
                <span class="mpa-pack-ic" aria-hidden="true">${uiIcon('folders', 18)}</span>
                <span class="mpa-pack-txt"><b>${escHtml(fresh.name || '')}</b><span>${packMeta(fresh)}</span></span>
                <span class="mpa-head-chips">${stateChip(plan.state)}${integrityChip}</span>
            </div>
            ${fresh.description ? `<p class="bms-note mpa-desc">${escHtml(fresh.description)}</p>` : ''}
            <div class="mpa-tiles">${tiles.map((x) => `<div class="mpa-tile${x.tone ? ' mpa-tile--' + x.tone : ''}"><b>${x.n}</b><span>${escHtml(x.label)}</span></div>`).join('')}</div>
            <div class="mpa-secs">
                ${section('enable', uiIcon('play', 14), t('modpack.act.secEnable'), plan.toEnable.length, `<ol class="mpa-list">${enableList}</ol>`, true)}
                ${section('disable', uiIcon('power', 14), t('modpack.act.secDisable'), plan.toDisable.length, `<ul class="mpa-list">${disableList}</ul>`, true)}
                ${section('missing', uiIcon('alert', 14), t('modpack.act.secMissing'), plan.missing.length, `<p class="bms-note">${escHtml(t('modpack.act.missingNote'))}</p><ul class="mpa-list">${missingList}</ul>`, true)}
                ${section('conflicts', uiIcon('warning', 14), t('modpack.act.secConflicts'), conflicts.length, `<p class="bms-note">${escHtml(t('modpack.act.conflictNote'))}</p><ul class="mpa-list">${conflictList}</ul>`, conflicts.length <= 4)}
                ${section('integrity', uiIcon('shield', 14), t('modpack.act.secIntegrity'), integrityN, `<ul class="mpa-list">${integrityList}</ul>`, true)}
                ${section('on', uiIcon('success', 14), t('modpack.act.secOn'), plan.alreadyOn.length, `<ul class="mpa-list">${plan.alreadyOn.map((x) => li(x.name)).join('')}</ul>`, false)}
            </div>
            ${canRepair ? `<div class="mpa-repair"><span>${escHtml(t('modpack.act.repairNote'))}</span><button type="button" class="btn btn-secondary btn-sm" data-mpa="repair">${uiIcon('download', 14)}${escHtml(t('modpack.act.repair'))}</button></div>` : ''}
            <fieldset class="mpa-opts">
                <legend class="bms-label">${escHtml(t('modpack.act.options'))}</legend>
                <label class="mpa-opt"><input type="checkbox" id="mpa-exclusive"${st.exclusive ? ' checked' : ''}><span><b>${escHtml(t('modpack.act.exclusive'))}</b><small>${escHtml(otherOn ? t('modpack.act.exclusiveHint', { n: String(otherOn) }) : t('modpack.act.exclusiveNone'))}</small></span></label>
                <label class="mpa-opt mpa-opt--select"><span><b>${escHtml(t('modpack.orderMode'))}</b><small>${escHtml(t('modpack.act.orderHint'))}</small></span>
                    <select id="mpa-order" class="form-input">
                        <option value=""${st.order === '' ? ' selected' : ''}>${escHtml(t('order.mode.default'))}</option>
                        <option value="top"${st.order === 'top' ? ' selected' : ''}>${escHtml(t('order.mode.top'))}</option>
                        <option value="bottom"${st.order === 'bottom' ? ' selected' : ''}>${escHtml(t('order.mode.bottom'))}</option>
                        <option value="keep"${st.order === 'keep' ? ' selected' : ''}>${escHtml(t('order.mode.keep'))}</option>
                    </select></label>
                ${plan.noHash.length ? `<label class="mpa-opt"><input type="checkbox" id="mpa-bypass"${st.bypass ? ' checked' : ''}><span><b>${escHtml(t('modpack.act.bypass', { n: String(plan.noHash.length) }))}</b><small>${escHtml(t('modpack.act.bypassHint'))}</small></span></label>` : ''}
            </fieldset>`;

        const work = plan.toEnable.length + plan.toDisable.length;
        const primary = plan.toEnable.length
            ? t('modpack.act.go', { n: String(plan.toEnable.length) })
            : work ? t('modpack.act.goExclusive', { n: String(plan.toDisable.length) })
            : plan.packOrder.length ? t('modpack.act.goOrder') : t('modpack.act.nothing');
        if (m.footer) {
            m.footer.innerHTML = `
                <div class="modal-footer-start">
                    ${opts.fromPicker ? `<button type="button" class="btn btn-ghost" data-mpa="back">${uiIcon('arrow-left', 14)}${escHtml(t('common.back'))}</button>` : ''}
                    <span class="modal-footer-note mpa-foot-note">${uiIcon('activity', 14)}${escHtml(t('modpack.act.bgNote'))}</span>
                </div>
                ${plan.alreadyOn.length ? `<button type="button" class="btn btn-outline-danger" data-mpa="off">${escHtml(t('modpack.deactivate'))}</button>` : ''}
                <button type="button" class="btn btn-primary" data-mpa="go"${plan.packOrder.length ? '' : ' disabled'}>${uiIcon('run', 14)}${escHtml(primary)}</button>`;
        }

        m.q<HTMLInputElement>('#mpa-exclusive')?.addEventListener('change', (e) => { st.exclusive = (e.target as HTMLInputElement).checked; draw(); });
        m.q<HTMLSelectElement>('#mpa-order')?.addEventListener('change', (e) => { st.order = (e.target as HTMLSelectElement).value; });
        m.q<HTMLInputElement>('#mpa-bypass')?.addEventListener('change', (e) => { st.bypass = (e.target as HTMLInputElement).checked; });
        m.q('[data-mpa="repair"]')?.addEventListener('click', () => {
            opts.repair?.(fresh, report, () => { void renderPlan(m, fresh, opts); });
        });
        m.q('[data-mpa="back"]')?.addEventListener('click', async () => {
            const d = await loadData();
            const ttl = m.header.querySelector('.modal-title');
            if (ttl) ttl.textContent = t('modpack.quickApplyTitle');
            renderPicker(m, d, opts);
        });
        m.q('[data-mpa="go"]')?.addEventListener('click', () => {
            startActivation(fresh, plan, st, data.activeId, opts);
            m.close();
        });
        m.q('[data-mpa="off"]')?.addEventListener('click', () => {
            startDeactivation(fresh, plan, data.activeId, opts);
            m.close();
        });
    };

    draw();
    setTimeout(() => m.q<HTMLElement>('[data-mpa="go"]:not([disabled])')?.focus(), 0);
    if (reportState === 'pending') {
        try { report = await invoke('check_modpack_integrity', { modpack: fresh }); reportState = 'done'; } catch { reportState = 'failed'; }
        // Keep what the reader set; redraw only the facts.
        const ex = m.q<HTMLInputElement>('#mpa-exclusive');
        if (ex) st.exclusive = ex.checked;
        const ord = m.q<HTMLSelectElement>('#mpa-order');
        if (ord) st.order = ord.value;
        const by = m.q<HTMLInputElement>('#mpa-bypass');
        if (by) st.bypass = by.checked;
        const focused = (document.activeElement as HTMLElement | null)?.dataset?.mpa;
        draw();
        if (focused) m.q<HTMLElement>(`[data-mpa="${focused}"]`)?.focus();
    }
}

function isCancelled(msg: string): boolean {
    return msg === 'CANCELLED' || msg.includes('CANCELLED');
}

/** Queue the pack as ONE background job: the others off (only this pack), the pack on in its
 *  order, then the block placed in the activation order. */
function startActivation(pack: any, plan: ModpackPlan, st: PlanState, profileId: string | null, opts: ActivateOptions): void {
    const label = t('modpack.act.jobLabel', { name: String(pack.name || '') });
    let jobId = -1;
    const stopped = (): boolean => !!getActivationJobs().find((j) => j.id === jobId)?.cancelRequested;
    const handle = runActivationBatch({
        mods: plan.toEnable.map((x) => ({ id: x.id, name: x.name })),
        mode: 'enable',
        profileId,
        label,
        source: 'modpack',
        run: async (scope) => {
            const failed: Array<{ id: string; name?: string; error: string }> = [];
            let cancelled = false;
            let enabled = 0;
            let disabled = 0;
            const step = async (cmd: 'enable_mod' | 'disable_mod', x: LocalMod): Promise<void> => {
                if (cancelled || stopped()) { cancelled = true; return; }
                try {
                    if (cmd === 'enable_mod') { await invoke('enable_mod', { modId: x.id, bypassSha: st.bypass, cancelScope: scope }, { quiet: true }); enabled++; }
                    else { await invoke('disable_mod', { modId: x.id, cancelScope: scope }, { quiet: true }); disabled++; }
                } catch (e) {
                    const msg = String((e as Error)?.message ?? e);
                    if (isCancelled(msg) || stopped()) { cancelled = true; return; }
                    failed.push({ id: x.id, name: x.name, error: msg });
                }
            };
            for (const x of plan.toDisable) await step('disable_mod', x);
            for (const x of plan.toEnable) await step('enable_mod', x);
            if (!cancelled && plan.packOrder.length) {
                try { await invoke('mod_order_arrange', { profileId: null, ids: plan.packOrder, mode: st.order || null }); } catch (e) {
                    failed.push({ id: '#order', name: t('modpack.orderMode'), error: String((e as Error)?.message ?? e) });
                }
            }
            if (!cancelled) dispatchBmmAction(BMM_ACTIONS.MODPACK_APPLIED, { name: pack?.name });
            const sha = failed.filter((f) => f.error.startsWith('MISSING_SHA|')).length;
            const parts = [t('modpack.act.doneLine', { on: String(enabled), off: String(disabled) })];
            if (plan.missing.length) parts.push(t('modpack.act.doneMissing', { n: String(plan.missing.length) }));
            if (failed.length) parts.push(t('modpack.act.doneFailed', { n: String(failed.length) }) + (sha ? ` (${t('modpack.act.doneSha', { n: String(sha) })})` : ''));
            const message = `${label} · ${parts.join(' · ')}`;
            return {
                failed: failed.filter((f) => !f.id.startsWith('#')),
                cancelled,
                toast: { message, kind: failed.length || cancelled || plan.missing.length ? 'warning' : 'success', ms: 6000 },
            };
        },
        failToast: (e) => ({ message: t('modpack.act.failed', { e: t(e) }), kind: 'error', ms: 7000 }),
    });
    jobId = handle.id;
    toast(t('modpack.act.queued', { name: String(pack.name || '') }), 'info', 2500);
    void handle.done.then(() => { try { opts.onDone?.(); } catch { /* list gone */ } });
}

/** The pack off: its mods that are on (and their dependencies, as the pack asks), one job. */
function startDeactivation(pack: any, plan: ModpackPlan, profileId: string | null, opts: ActivateOptions): void {
    const handle = runActivationJob({
        mods: plan.alreadyOn.map((x) => ({ id: x.id, name: x.name })),
        mode: 'disable',
        profileId,
        label: t('modpack.act.offLabel', { name: String(pack.name || '') }),
        source: 'modpack',
    });
    void handle.done.then(() => { try { opts.onDone?.(); } catch { /* list gone */ } });
}

/** A pack's switch turned off: no dialog, the pack's mods that are on go off as a job. */
export async function deactivateModpack(pack: any, opts: ActivateOptions = {}): Promise<void> {
    const data = await loadData();
    const sha = await shaIndexFor(pack);
    const plan = planModpack(pack, data.all, sha, { library: data.library });
    if (!plan.alreadyOn.length) return;
    startDeactivation(pack, plan, data.activeId, opts);
}

/** off / partial / on for a pack, by local id (the list's switch). */
export function modpackState(pack: any, mods: LocalMod[]): 'off' | 'partial' | 'on' {
    return quickState(pack, mods);
}
