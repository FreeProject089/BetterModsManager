// The Storage Manager (Settings → Storage → Open the Storage Manager), as tabs.
//
// It used to be one long scroll: the resource governor's card, three switches, the hardware
// card, the space alerts and the disks, with the per-disk rules folded under the governor. The
// governor's presets, game mode and live queue were the part nobody understood, and the whole
// thing was redrawn (two disk enumerations, a new live subscription) on every toggle.
//
// Now: a sticky header (what is in force, and the tabs), a one-line welcome shown the first time
// only, and five tabs, each opening with one short line and its essential controls; the long
// explanations and the "Learn more" link to the docs are folded under an expander:
//
//   Disks & space · Work intensity · Game mode · Live activity · Rules per disk
//
// (Graphics was a sixth tab for a day: it is about the whole window, not storage, and lives in
// Settings → Graphics & display now, graphics-settings.ts.)
//
// A tab is drawn the first time it is shown. The live feed runs only while the modal is open, a
// tab with live values is shown and the window is visible (storage-live.ts). Only a control
// that changes what another part shows redraws; a toggle updates its own card.
import { invoke, listen, getSettings, updateSettings } from '../../core/api.js';
import { t, getLang } from '../../core/i18n.js';
import { learnMore } from '../../core/learn-more.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
import { installFocusTrap, ownsFocus } from '../../ui/focus-trap.js';
import { bindLifecycle } from './storage-live.js';
import { feed, readStatus, resetPainters, mountStatusStrip, mountIntensityPanel, mountGamePanel, mountLivePanel, moreBlock, type Status } from './resources-dash.js';
import { renderResourcesMatrix } from './resources-matrix.js';
import { mountStoragePresets } from './storage-presets.js';
import { gameHeadline, sizeText, usedOfText, type GameView } from './resources-spark.js';

export type StorageTab = 'space' | 'intensity' | 'game' | 'live' | 'rules';

const ICON: Record<StorageTab, string> = {
    space: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
    intensity: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    game: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
    live: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    rules: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
};

const TABS: { id: StorageTab; label: [string, string]; tip: [string, string] }[] = [
    { id: 'space', label: ['stm.tab.space', 'Disks & space'], tip: ['stm.tabTip.space', 'How full each disk is, which profiles live on it, space alerts, and a speed cap per disk.'] },
    { id: 'intensity', label: ['stm.tab.intensity', 'Work intensity'], tip: ['stm.tabTip.intensity', 'How much of your PC BMM may use for heavy work.'] },
    { id: 'game', label: ['stm.tab.game', 'App mode'], tip: ['stm.tabTip.game', 'BMM steps aside while your app runs.'] },
    { id: 'live', label: ['stm.tab.live', 'Live activity'], tip: ['stm.tabTip.live', 'What BMM is doing right now, with pause and cancel.'] },
    { id: 'rules', label: ['stm.tab.rules', 'Rules per disk'], tip: ['stm.tabTip.rules', 'Optional fine rules for one disk and one kind of work.'] },
];
const TAB_IDS = TABS.map((x) => x.id);
const TAB_KEY = 'bmm.storage.tab';
const INTRO_KEY = 'bmm.storage.introSeen';

const tr = (key: string, en: string): string => { const v = t(key); return v && v !== key ? v : en; };
const esc = escHtml;

function storeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function storeSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* private mode: not remembered */ } }

/** The stylesheet is this feature's own file, linked the first time the modal opens (and by the
 *  Graphics & display card, which uses the same classes). */
export function ensureStorageCss(): void {
    if (document.getElementById('storage-modal-css')) return;
    const link = document.createElement('link');
    link.id = 'storage-modal-css';
    link.rel = 'stylesheet';
    link.href = 'css/storage-modal.css';
    document.head.appendChild(link);
}

interface Hooks {
    /** settings.ts: benchmark the disks the profiles use and apply the suggested limits. */
    runAutoBenchmarks(disks: DiskInfo[]): unknown;
    /** settings.ts: every per-disk limit back to unlimited. */
    resetStorageLimits(): unknown;
}
let hooks: Hooks | null = null;

interface DiskInfo {
    name: string; mount_point: string; kind: string; current_limit_mb_s: number | null;
    total_space_bytes: number; available_space_bytes: number; file_system: string;
    is_cloud?: boolean; cloud_provider?: string | null;
    profiles_using?: { profile_name: string; usage_type: string }[];
}

/** One render's data, fetched once and shared by the tabs that need it. */
interface RenderData { status: Promise<Status | null>; disks: Promise<DiskInfo[]>; }

let _tab: StorageTab = 'space';
let _seq = 0;
let _life: { refresh(): Promise<void>; dispose(): Promise<void> } | null = null;
let _data: RenderData | null = null;
/** The welcome line: shown on the first opening only, until dismissed or another tab is chosen
 *  (it is marked as seen as soon as it is shown, so it never comes back on a later opening). */
let _introOpen = false;
const _mounted = new Set<StorageTab>();

const overlayEl = () => document.getElementById('modal-storage');
const containerEl = () => document.getElementById('storage-disks-container');
const isOpen = () => !!overlayEl()?.classList.contains('open');

function validTab(v: unknown): StorageTab | null {
    return typeof v === 'string' && (TAB_IDS as string[]).includes(v) ? v as StorageTab : null;
}

/** Open the modal, on `tab` or on the tab shown last time. */
export function openStorageManager(tab?: string): void {
    const overlay = overlayEl();
    if (!overlay) return;
    overlay.classList.add('open');
    void renderStorageModal(validTab(tab) || undefined);
}

/** Redraw the modal if it is open (after a benchmark, a reset). Closed: nothing to do, and
 *  nothing is fetched: runAutoBenchmarks calls this at every start. */
export function refreshIfOpen(): void {
    if (isOpen()) void renderStorageModal(_tab);
}

export async function renderStorageModal(tab?: StorageTab): Promise<void> {
    const container = containerEl();
    const overlay = overlayEl();
    if (!container || !overlay) return;
    const seq = ++_seq;
    ensureStorageCss();
    // The previous render's feed and painters go first: its nodes are about to be replaced.
    const old = _life; _life = null;
    await old?.dispose();
    resetPainters();
    if (seq !== _seq) return;

    _tab = tab || validTab(storeGet(TAB_KEY)) || 'space';
    _mounted.clear();
    _data = {
        status: readStatus(),
        disks: (invoke('get_system_disks') as Promise<DiskInfo[]>).catch(() => []),
    };

    if (storeGet(INTRO_KEY) !== '1') { storeSet(INTRO_KEY, '1'); _introOpen = true; }
    container.innerHTML = `
        <div class="stm">
            <div class="stm-head">
                <div class="stm-status" aria-live="polite"></div>
                <div class="stm-tabs" role="tablist" aria-label="${escAttr(tr('storage.modalTitle', 'Storage Manager'))}">
                    ${TABS.map((x) => `<button type="button" class="stm-tab" role="tab" id="stm-tab-${x.id}" data-tab="${x.id}" aria-controls="stm-panel-${x.id}" aria-selected="false" tabindex="-1" aria-label="${escAttr(tr(x.label[0], x.label[1]))}" data-tooltip="${escAttr(tr(x.tip[0], x.tip[1]))}">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[x.id]}</svg>
                        <span>${esc(tr(x.label[0], x.label[1]))}</span></button>`).join('')}
                </div>
            </div>
            ${_introOpen ? `
            <div class="stm-intro" role="note">
                <span class="stm-intro-body">${esc(tr('stm.intro.short', 'Your disks, how hard BMM works, and app mode. The defaults are safe.'))}</span>
                <button type="button" class="btn btn-sm btn-ghost stm-intro-ok">${esc(tr('stm.intro.dismiss', 'Got it'))}</button>
            </div>` : ''}
            ${TABS.map((x) => `<section class="stm-panel" role="tabpanel" id="stm-panel-${x.id}" aria-labelledby="stm-tab-${x.id}" data-panel="${x.id}" tabindex="0" hidden></section>`).join('')}
        </div>`;

    container.querySelector('.stm-intro-ok')?.addEventListener('click', dropIntro);

    const tablist = container.querySelector<HTMLElement>('.stm-tabs');
    tablist?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.stm-tab');
        const id = validTab(b?.dataset.tab);
        if (id) activate(id);
    });
    // The tabs pattern: arrows, Home and End move between the tabs and show them.
    tablist?.addEventListener('keydown', (e) => {
        const i = TAB_IDS.indexOf(_tab);
        const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TAB_IDS.length - 1 : null;
        if (next == null) return;
        e.preventDefault();
        const id = TAB_IDS[(next + TAB_IDS.length) % TAB_IDS.length];
        activate(id);
        container.querySelector<HTMLElement>(`#stm-tab-${id}`)?.focus();
    });

    _life = bindLifecycle({ overlay, doc: document, MutationObserver }, feed, () => _tab);
    activate(_tab);

    const st = await _data.status;
    if (seq !== _seq) return;
    const strip = container.querySelector<HTMLElement>('.stm-status');
    if (strip) mountStatusStrip(strip, st);
}

function dropIntro(): void {
    _introOpen = false;
    containerEl()?.querySelector('.stm-intro')?.remove();
}

function activate(id: StorageTab): void {
    const container = containerEl();
    if (!container) return;
    if (_introOpen && id !== _tab) dropIntro();
    _tab = id;
    storeSet(TAB_KEY, id);
    container.querySelectorAll<HTMLElement>('.stm-tab').forEach((b) => {
        const on = b.dataset.tab === id;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
    });
    container.querySelectorAll<HTMLElement>('.stm-panel').forEach((p) => { p.hidden = p.dataset.panel !== id; });
    const panel = container.querySelector<HTMLElement>(`#stm-panel-${id}`);
    if (panel && !_mounted.has(id)) { _mounted.add(id); void mountTab(id, panel); }
    void _life?.refresh();
}

async function mountTab(id: StorageTab, panel: HTMLElement): Promise<void> {
    const seq = _seq;
    const data = _data;
    if (!data) return;
    panel.innerHTML = `<div class="stm-loading">${esc(tr('storage.loading', 'Loading…'))}</div>`;
    try {
        switch (id) {
            case 'space': await mountSpace(panel, await data.disks); break;
            case 'intensity': {
                const st = await data.status;
                if (seq !== _seq) return;
                mountIntensityPanel(panel, st);
                const extra = panel.querySelector<HTMLElement>('.stm-intensity-extra');
                if (extra) await mountSmartIo(extra);
                break;
            }
            case 'game': {
                const [st, profiles] = await Promise.all([data.status, (invoke('get_profiles') as Promise<{ name: string; game_path: string }[]>).catch(() => [])]);
                if (seq === _seq) mountGamePanel(panel, st, (profiles || []).map((p) => ({ name: String(p.name || ''), game_path: String(p.game_path || '') })));
                break;
            }
            case 'live': { const st = await data.status; if (seq === _seq) mountLivePanel(panel, st); break; }
            case 'rules': {
                const disks = await data.disks;
                if (seq !== _seq) return;
                // The presets first (a whole set of rules for this PC), then the table they fill.
                panel.innerHTML = '<div class="stm-presets-host"></div><div class="stm-matrix-host"></div>';
                const presets = panel.querySelector<HTMLElement>('.stm-presets-host');
                const matrix = panel.querySelector<HTMLElement>('.stm-matrix-host');
                if (presets) void mountStoragePresets(presets, () => { if (seq === _seq) refreshIfOpen(); }, toast);
                if (matrix) await renderResourcesMatrix(matrix, disks.map((d) => String(d.mount_point || '')).filter(Boolean));
                break;
            }
        }
    } catch (err) {
        if (seq === _seq) panel.innerHTML = `<div class="stm-msg is-err">${esc(t('storage.error', { err: String(err) }) || String(err))}</div>`;
    }
}

// ── Work intensity: Smart I/O, beside the presets ───────────────────────────────────────────

async function mountSmartIo(host: HTMLElement): Promise<void> {
    const settings: any = await getSettings();
    const smartIo = settings.smart_io_enabled !== false;
    host.innerHTML = `
        <div class="stm-card">
            <div class="stm-row stm-opt" data-tooltip="${escAttr(`${t('storage.smartIoDesc')} ${tr('stm.smartIo.note', 'It only changes something under Balanced: switched off, a disk with no speed cap gets plain full-speed copies.')}`)}">
                <label class="stm-grow stm-opt-label" for="chk-smart-io">${esc(t('storage.smartIoTitle'))} <span class="stm-help">${esc(tr('stm.smartIo.short', 'Copies leave room for the rest of your PC.'))}</span></label>
                <label class="bmm-switch">
                    <input type="checkbox" id="chk-smart-io" ${smartIo ? 'checked' : ''}>
                    <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                </label>
            </div>
        </div>`;
    host.querySelector<HTMLInputElement>('#chk-smart-io')?.addEventListener('change', async (e) => {
        const on = (e.target as HTMLInputElement).checked;
        const s: any = await getSettings();
        s.smart_io_enabled = on;
        await updateSettings(s);
        toast(t(on ? 'storage.smartIoOnToast' : 'storage.smartIoOffToast'), 'info');
    });
}

// ── Disks & space ───────────────────────────────────────────────────────────────────────────

/** A usage level as a class: the colours are theme tokens in storage-modal.css. */
const level = (pct: number, warn: number, crit: number) => pct > crit ? 'is-crit' : pct > warn ? 'is-warn' : 'is-ok';

function kindBadge(d: DiskInfo): string {
    if (d.is_cloud && d.cloud_provider) return `<span class="stm-kind is-cloud">${esc(d.cloud_provider)}</span>`;
    return `<span class="stm-kind">${esc(d.kind || '?')}</span>`;
}

async function mountSpace(host: HTMLElement, disks: DiskInfo[]): Promise<void> {
    const settings: any = await getSettings();
    const isAuto = settings.auto_io_calibration !== false;
    const alertEnabled = !!settings.storage_alert_enabled;
    const warningPct = settings.storage_warning_space_pct ?? 40;
    const criticalPct = settings.storage_critical_space_pct ?? 30;
    // Published for the profile cards, which use the same threshold (warningPct % free → ratio).
    (window as any).__storageWarnPct = Math.max(0, Math.min(99, 100 - warningPct)) / 100;
    const usage: Record<string, [string, string]> = {
        game_directory: ['storage.gameDir', 'Game Dir'], mod_folder: ['storage.modsDir', 'Mods'], backup: ['storage.backupDir', 'Backup'],
    };

    const lang = getLang();
    const size = (b: number) => sizeText(b, t, lang);
    // One compact row per disk: name and kind, the usage bar with "1.5 TB of 1.8 TB", the speed
    // cap and a secondary "Test". The profiles on it fold under one line.
    const diskCard = (d: DiskInfo): string => {
        const used = Math.max(0, d.total_space_bytes - d.available_space_bytes);
        const usedPct = d.total_space_bytes > 0 ? Math.round(used / d.total_space_bytes * 100) : 0;
        const profileTotal: number = (window as any).__profileTotalPerDisk?.get(d.mount_point) || 0;
        const avail = d.available_space_bytes;
        const ratio = avail > 0 ? profileTotal / avail : 1;
        const warnRatio = Math.max(0, Math.min(99, 100 - warningPct)) / 100;
        const pState = profileTotal > avail ? 'is-crit' : ratio > warnRatio ? 'is-warn' : 'is-ok';
        const uses = d.profiles_using || [];
        const pills = uses.map((pu) => `<span class="stm-pill stm-use-${escAttr(pu.usage_type)}">${esc(pu.profile_name)} · ${esc(usage[pu.usage_type] ? tr(usage[pu.usage_type][0], usage[pu.usage_type][1]) : pu.usage_type)}</span>`).join('');
        const title = d.name && d.name !== d.mount_point ? `${d.mount_point} ${d.name}` : d.mount_point;
        return `
            <div class="stm-disk" data-mount="${escAttr(d.mount_point)}">
                <div class="stm-disk-top">
                    <div class="stm-disk-name" title="${escAttr(`${d.mount_point} · ${d.file_system}`)}">${esc(title)} ${kindBadge(d)}</div>
                    <label class="stm-limit" data-tooltip="${escAttr(tr('stm.space.limitTip', 'The most BMM may write to this disk each second. 0 = no limit. The same value as the rule “this disk, all operations”.'))}">
                        <span>${esc(tr('stm.space.limitShort', 'Cap'))}</span>
                        <input type="number" min="0" step="10" class="form-input disk-limit-input" data-mount="${escAttr(d.mount_point)}" value="${d.current_limit_mb_s || 0}" aria-label="${escAttr(tr('stm.space.limit', 'Speed cap'))}">
                        <span>${esc(tr('stm.unit.mb', 'MB'))}/s</span>
                    </label>
                    <button type="button" class="btn btn-sm btn-ghost disk-bench-btn" data-mount="${escAttr(d.mount_point)}" data-tooltip="${escAttr(tr('stm.space.benchTip', 'Writes and reads a 50 MB test file to measure this disk, then suggests a speed cap.'))}">${esc(tr('stm.space.test', 'Test'))}</button>
                </div>
                <div class="stm-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${usedPct}" aria-label="${escAttr(usedOfText(used, d.total_space_bytes, t, lang))}"><div class="stm-bar-fill ${level(usedPct, 70, 90)}" style="width:${usedPct}%"></div></div>
                <div class="stm-bar-label"><span>${esc(usedOfText(used, d.total_space_bytes, t, lang))}</span><span class="${level(usedPct, 70, 90)}">${usedPct} %</span></div>
                ${profileTotal > 0 && pState !== 'is-ok' ? `<div class="stm-alert ${pState}"${pState === 'is-crit' ? ' role="alert"' : ''}>${esc(t(pState === 'is-crit' ? 'storage.profilesCritical' : 'storage.profilesWarning'))} <span class="stm-help">${esc(tr('stm.space.profilesNeed', 'Profiles: {p} for {a} free').replace('{p}', size(profileTotal)).replace('{a}', size(avail)))}</span></div>` : ''}
                ${uses.length ? `<details class="stm-more stm-disk-uses"><summary>${esc((uses.length === 1 ? tr('stm.space.usedBy1', 'Used by 1 profile folder') : tr('stm.space.usedByN', 'Used by {n} profile folders').replace('{n}', String(uses.length))))}${profileTotal > 0 ? ` · ${esc(size(profileTotal))}` : ''}</summary><div class="stm-more-body"><div class="stm-pills">${pills}</div></div></details>` : ''}
                <div class="disk-bench-result stm-help"></div>
            </div>`;
    };

    host.innerHTML = `
        <p class="stm-lead">${esc(tr('stm.lead.spaceShort', 'Room left on each disk, and how fast BMM may write to it.'))}</p>
        <div class="stm-disks">${disks.length ? disks.map(diskCard).join('') : `<div class="stm-empty">${esc(t('storage.noDisks'))}</div>`}</div>
        <div class="stm-card">
            <div class="stm-row stm-opt" data-tooltip="${escAttr(`${t('storage.autoCalibDesc')} ${tr('stm.space.autoTip', 'On: BMM measures the disks your profiles use (again after 30 days) and sets their speed caps.')}`)}">
                <label class="stm-grow stm-opt-label" for="chk-auto-io">${esc(tr('stm.space.autoShort', 'Set the speed caps by itself'))}</label>
                <button type="button" id="btn-reset-limits" class="btn btn-sm btn-ghost" data-tooltip="${escAttr(tr('stm.space.resetTip', 'Every disk back to no speed cap.'))}">${esc(tr('stm.space.resetShort', 'Reset all caps'))}</button>
                <label class="bmm-switch">
                    <input type="checkbox" id="chk-auto-io" ${isAuto ? 'checked' : ''}>
                    <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                </label>
            </div>
            <div class="stm-row stm-opt" id="storage-alert-thresholds-block" data-tooltip="${escAttr(tr('stm.space.alertHint', 'Colours the profile bars before a disk fills up, and warns before enabling mods on a nearly full disk.'))}">
                <label class="stm-grow stm-opt-label" for="chk-alert-enabled">${esc(tr('stm.space.alertShort', 'Warn me before a disk is full'))}</label>
                ${alertEnabled ? `
                <label class="stm-thresh"><span>${esc(tr('stm.space.warnAt', 'Warning'))}</span><input type="number" id="input-warning-pct" class="form-input" value="${warningPct}" min="1" max="99" aria-label="${escAttr(t('storage.alertLimit'))}"><span>%</span></label>
                <label class="stm-thresh is-crit"><span>${esc(tr('stm.space.critAt', 'Critical'))}</span><input type="number" id="input-critical-pct" class="form-input" value="${criticalPct}" min="0" max="99" aria-label="${escAttr(t('storage.alertCritical'))}"><span>%</span></label>` : ''}
                <label class="bmm-switch">
                    <input type="checkbox" id="chk-alert-enabled" ${alertEnabled ? 'checked' : ''}>
                    <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                </label>
            </div>
        </div>
        ${moreBlock(tr('stm.more', 'Learn more'), `
            <p class="stm-help">${esc(tr('stm.lead.space', 'How much room each disk has left and which profiles use it. You can also cap how fast BMM writes to each disk.'))}</p>
            <p class="stm-help">${esc(t('storage.autoCalibDesc'))}</p>
            ${alertEnabled ? '' : `<p class="stm-help">${esc(t('storage.alertDisabledHint'))}</p>`}
            ${learnMore('storage-space')}`)}`;

    const redraw = () => { _mounted.delete('space'); if (_tab === 'space') activate('space'); };

    host.querySelector<HTMLInputElement>('#chk-auto-io')?.addEventListener('change', async (e) => {
        const on = (e.target as HTMLInputElement).checked;
        const s: any = await getSettings();
        s.auto_io_calibration = on;
        await updateSettings(s);
        if (on) { toast(t('storage.autoCalibToast'), 'info'); hooks?.runAutoBenchmarks(disks); }
    });
    host.querySelector('#btn-reset-limits')?.addEventListener('click', () => { hooks?.resetStorageLimits(); });
    host.querySelector<HTMLInputElement>('#chk-alert-enabled')?.addEventListener('change', async (e) => {
        const s: any = await getSettings();
        s.storage_alert_enabled = (e.target as HTMLInputElement).checked;
        await updateSettings(s);
        redraw();
    });
    let thTimer: ReturnType<typeof setTimeout> | undefined;
    const saveThresholds = async () => {
        let w = parseInt((host.querySelector('#input-warning-pct') as HTMLInputElement | null)?.value || '', 10);
        let c = parseInt((host.querySelector('#input-critical-pct') as HTMLInputElement | null)?.value || '', 10);
        if (isNaN(w) || w < 1) w = 40;
        if (isNaN(c) || c < 0) c = 30;
        if (w < c) w = c + 1;
        const s: any = await getSettings();
        s.storage_warning_space_pct = w;
        s.storage_critical_space_pct = c;
        await updateSettings(s);
        redraw();
    };
    host.querySelectorAll('#input-warning-pct, #input-critical-pct').forEach((el) => el.addEventListener('input', () => {
        clearTimeout(thTimer);
        thTimer = setTimeout(saveThresholds, 800);
    }));

    host.querySelectorAll<HTMLInputElement>('.disk-limit-input').forEach((input) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
                let val = parseInt(input.value, 10);
                if (isNaN(val) || val < 0) val = 0;
                try {
                    await invoke('set_disk_limit', { mountPoint: input.dataset.mount, limitMbS: val === 0 ? null : val });
                    toast(t('common.success'), 'success');
                } catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
            }, 800);
        });
    });

    host.querySelectorAll<HTMLButtonElement>('.disk-bench-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const mountPoint = btn.dataset.mount || '';
            const out = btn.closest('.stm-disk')?.querySelector<HTMLElement>('.disk-bench-result');
            const label = btn.textContent || '';
            btn.disabled = true;
            btn.textContent = t('storage.benchmarking');
            if (out) out.textContent = '';
            try {
                const res: any = await invoke('benchmark_disk', { mountPoint });
                if (out) {
                    out.classList.remove('is-err');
                    out.innerHTML = `<span>↓ ${esc(String(res.read_mb_s))} MB/s</span> · <span>↑ ${esc(String(res.write_mb_s))} MB/s</span> · <span class="is-ok">${esc(t('storage.suggestedLimit'))}: ${esc(String(res.suggested_limit))} MB/s</span> <button type="button" class="btn btn-ghost btn-sm disk-apply-suggestion">${esc(t('storage.applySuggested'))}</button>`;
                    out.querySelector('.disk-apply-suggestion')?.addEventListener('click', async () => {
                        const input = btn.closest('.stm-disk')?.querySelector<HTMLInputElement>('.disk-limit-input');
                        if (input) input.value = String(res.suggested_limit);
                        try { await invoke('set_disk_limit', { mountPoint, limitMbS: res.suggested_limit }); toast(t('common.success'), 'success'); }
                        catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
                    });
                }
            } catch (err) {
                if (out) { out.textContent = `${t('common.error')}: ${err}`; out.classList.add('is-err'); }
            }
            btn.disabled = false;
            btn.textContent = label;
        });
    });
}

// ── Wiring ──────────────────────────────────────────────────────────────────────────────────

/** Called once by settings.ts. Publishes the opener for the deeplink, the palette and the
 *  low-space warning, and the refresh for the calibration code. */
export function initStorageModal(h: Hooks): void {
    hooks = h;
    (window as any).openStorageManager = openStorageManager;
    (window as any)._renderStorageModal = refreshIfOpen;
    // The keyboard of a modal dialog: Tab stays inside it, Escape closes it (the same close as
    // the ✕ — taking `.open` off, which the live feed's lifecycle watches). A dialog opened
    // over it (a confirmation, a picker) keeps its own keys: `ownsFocus`. A custom <select>
    // closing its menu on Escape marks the event handled, so that Escape closes the menu only.
    const ov = overlayEl();
    if (ov && !ov.dataset.kbd) {
        ov.dataset.kbd = '1';
        installFocusTrap(ov, () => isOpen() && ownsFocus(ov));
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || e.defaultPrevented || !isOpen() || !ownsFocus(ov)) return;
            e.preventDefault();
            ov.classList.remove('open');
        });
    }
    // Game mode turned on or off by itself (procs.rs → main.rs): say so, unless the user turned
    // the notice off in the Game mode tab. One listener for the whole session, nothing polled.
    void listen('bmm://game-mode', (e: { payload?: { view?: GameView; notify?: boolean } }) => {
        const p = e?.payload;
        if (!p?.view || !p.notify) return;
        toast(gameModeNotice(p.view), 'info', 5000);
    });
}

/** The engage / disengage notice. */
function gameModeNotice(v: GameView): string {
    if (v.active) return `${gameHeadline(v, t)}. ${tr('stm.game.noticeOn', 'BMM steps aside until you close the app.')}`;
    return tr('stm.game.noticeOff', 'App mode ended: BMM works normally again.');
}
