// The Storage Manager (Settings → Storage → Open the Storage Manager), as tabs.
//
// It used to be one long scroll: the resource governor's card, three switches, the hardware
// card, the space alerts and the disks, with the per-disk rules folded under the governor. The
// governor's presets, game mode and live queue were the part nobody understood, and the whole
// thing was redrawn (two disk enumerations, a new live subscription) on every toggle.
//
// Now: a sticky header (what is in force, and the tabs), one short first-use card, and five tabs,
// each opening with one plain line and a "Learn more" link to its section of the docs:
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
import { t } from '../../core/i18n.js';
import { learnMore } from '../../core/learn-more.js';
import { formatBytes, escHtml, escAttr } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
import { bindLifecycle } from './storage-live.js';
import { feed, readStatus, resetPainters, mountStatusStrip, mountIntensityPanel, mountGamePanel, mountLivePanel, type Status } from './resources-dash.js';
import { renderResourcesMatrix } from './resources-matrix.js';
import { gameHeadline, type GameView } from './resources-spark.js';

export type StorageTab = 'space' | 'intensity' | 'game' | 'live' | 'rules';

const ICON: Record<StorageTab, string> = {
    space: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
    intensity: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    game: '<line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59L2 15a3 3 0 0 0 5.2 2.04L9 15h6l1.8 2.04A3 3 0 0 0 22 15l-.7-6.41A4 4 0 0 0 17.32 5z"/>',
    live: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    rules: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
};

const TABS: { id: StorageTab; label: [string, string]; tip: [string, string] }[] = [
    { id: 'space', label: ['stm.tab.space', 'Disks & space'], tip: ['stm.tabTip.space', 'How full each disk is, which profiles live on it, space alerts, and a speed cap per disk.'] },
    { id: 'intensity', label: ['stm.tab.intensity', 'Work intensity'], tip: ['stm.tabTip.intensity', 'How much of your PC BMM may use for heavy work.'] },
    { id: 'game', label: ['stm.tab.game', 'Game mode'], tip: ['stm.tabTip.game', 'BMM steps aside while you play.'] },
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

    const introSeen = storeGet(INTRO_KEY) === '1';
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
            ${introSeen ? '' : `
            <div class="stm-intro" role="note">
                <div class="stm-intro-body">
                    <div class="stm-card-title">${esc(tr('stm.intro.title', 'What this window is for'))}</div>
                    <p>${esc(tr('stm.intro.body', 'BMM copies, unpacks and checks a lot of files. Here you see how full your disks are, choose how hard BMM may work (Work intensity), whether it steps aside while you play (Game mode), and watch what it is doing (Live activity). The defaults are safe: Balanced, with game detection on.'))}</p>
                </div>
                <div class="stm-intro-actions">
                    ${learnMore('storage-space')}
                    <button type="button" class="btn btn-sm stm-intro-ok">${esc(tr('stm.intro.dismiss', 'Got it'))}</button>
                </div>
            </div>`}
            ${TABS.map((x) => `<section class="stm-panel" role="tabpanel" id="stm-panel-${x.id}" aria-labelledby="stm-tab-${x.id}" data-panel="${x.id}" tabindex="0" hidden></section>`).join('')}
        </div>`;

    container.querySelector('.stm-intro-ok')?.addEventListener('click', () => {
        storeSet(INTRO_KEY, '1');
        container.querySelector('.stm-intro')?.remove();
    });

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

function activate(id: StorageTab): void {
    const container = containerEl();
    if (!container) return;
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
                await renderResourcesMatrix(panel, disks.map((d) => String(d.mount_point || '')).filter(Boolean));
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
            <div class="stm-row">
                <div class="stm-grow">
                    <label class="stm-card-title" for="chk-smart-io">${esc(t('storage.smartIoTitle'))}</label>
                    <div class="stm-help">${esc(t('storage.smartIoDesc'))}</div>
                    <div class="stm-help">${esc(tr('stm.smartIo.note', 'It only changes something under Balanced: switched off, a disk with no speed cap gets plain full-speed copies.'))}</div>
                </div>
                <label class="bmm-switch" data-tooltip="${escAttr(tr('stm.smartIo.tip', 'On: copies leave room for the rest of your PC. Off: copies use every core.'))}">
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

    const diskCard = (d: DiskInfo): string => {
        const used = Math.max(0, d.total_space_bytes - d.available_space_bytes);
        const usedPct = d.total_space_bytes > 0 ? Math.round(used / d.total_space_bytes * 100) : 0;
        const profileTotal: number = (window as any).__profileTotalPerDisk?.get(d.mount_point) || 0;
        const avail = d.available_space_bytes;
        const ratio = avail > 0 ? profileTotal / avail : 1;
        const warnRatio = Math.max(0, Math.min(99, 100 - warningPct)) / 100;
        const pState = profileTotal > avail ? 'is-crit' : ratio > warnRatio ? 'is-warn' : 'is-ok';
        const pills = (d.profiles_using || []).map((pu) => `<span class="stm-pill stm-use-${escAttr(pu.usage_type)}">${esc(pu.profile_name)} → ${esc(usage[pu.usage_type] ? tr(usage[pu.usage_type][0], usage[pu.usage_type][1]) : pu.usage_type)}</span>`).join('');
        return `
            <div class="stm-disk" data-mount="${escAttr(d.mount_point)}">
                <div class="stm-row">
                    <div class="stm-grow stm-disk-id">
                        <div class="stm-disk-name">${esc(d.name)} ${kindBadge(d)} <span class="stm-kind is-fs">${esc(d.file_system)}</span></div>
                        <div class="stm-disk-path">${esc(d.mount_point)}</div>
                    </div>
                    <label class="stm-limit" data-tooltip="${escAttr(tr('stm.space.limitTip', 'The most BMM may write to this disk each second. 0 = no limit. The same value as the rule “this disk, all operations”.'))}">
                        <span>${esc(tr('stm.space.limit', 'Speed cap'))}</span>
                        <input type="number" min="0" step="10" class="form-input disk-limit-input" data-mount="${escAttr(d.mount_point)}" value="${d.current_limit_mb_s || 0}">
                        <span>MB/s</span>
                    </label>
                </div>
                <div class="stm-bar-label"><span>${esc(tr('stm.space.used', 'Used'))}: ${esc(formatBytes(used))} / ${esc(formatBytes(d.total_space_bytes))}</span><span class="${level(usedPct, 70, 90)}">${usedPct}%</span></div>
                <div class="stm-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${usedPct}"><div class="stm-bar-fill ${level(usedPct, 70, 90)}" style="width:${usedPct}%"></div></div>
                ${profileTotal > 0 ? `
                <div class="stm-bar-label"><span>${esc(tr('stm.space.profiles', 'Profiles'))}: ${esc(formatBytes(profileTotal))} / ${esc(formatBytes(avail))} ${esc(t('storage.available') || 'available')}</span><span class="${pState}">${Math.round(ratio * 100)}%</span></div>
                <div class="stm-bar"><div class="stm-bar-fill ${pState}" style="width:${Math.min(ratio * 100, 100)}%"></div></div>
                ${pState === 'is-crit' ? `<div class="stm-alert is-crit" role="alert">${esc(t('storage.profilesCritical'))}</div>` : pState === 'is-warn' ? `<div class="stm-alert is-warn">${esc(t('storage.profilesWarning'))}</div>` : ''}` : ''}
                ${pills ? `<div class="stm-pills">${pills}</div>` : ''}
                <div class="stm-row">
                    <button type="button" class="btn btn-sm disk-bench-btn" data-mount="${escAttr(d.mount_point)}" data-tooltip="${escAttr(tr('stm.space.benchTip', 'Writes and reads a 50 MB test file to measure this disk, then suggests a speed cap.'))}">${esc(t('storage.benchmark'))}</button>
                    <span class="disk-bench-result stm-help"></span>
                </div>
            </div>`;
    };

    host.innerHTML = `
        <div class="stm-lead"><span>${esc(tr('stm.lead.space', 'How much room each disk has left and which profiles use it. You can also cap how fast BMM writes to each disk.'))}</span>${learnMore('storage-space', { compact: true })}</div>
        <div class="stm-card">
            <div class="stm-row">
                <div class="stm-grow">
                    <label class="stm-card-title" for="chk-auto-io">${esc(t('storage.autoCalibTitle'))}</label>
                    <div class="stm-help">${esc(t('storage.autoCalibDesc'))}</div>
                </div>
                <button type="button" id="btn-reset-limits" class="btn btn-sm" data-tooltip="${escAttr(tr('stm.space.resetTip', 'Every disk back to no speed cap.'))}">${esc(t('storage.resetBtn'))}</button>
                <label class="bmm-switch" data-tooltip="${escAttr(tr('stm.space.autoTip', 'On: BMM measures the disks your profiles use (again after 30 days) and sets their speed caps.'))}">
                    <input type="checkbox" id="chk-auto-io" ${isAuto ? 'checked' : ''}>
                    <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                </label>
            </div>
        </div>
        <div class="stm-card" id="storage-alert-thresholds-block">
            <div class="stm-row">
                <div class="stm-grow">
                    <label class="stm-card-title" for="chk-alert-enabled">${esc(t('storage.alertThresholds'))}</label>
                    <div class="stm-help">${esc(tr('stm.space.alertHint', 'Colours the profile bars before a disk fills up, and warns before enabling mods on a nearly full disk.'))}</div>
                </div>
                <label class="bmm-switch">
                    <input type="checkbox" id="chk-alert-enabled" ${alertEnabled ? 'checked' : ''}>
                    <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                </label>
            </div>
            ${alertEnabled ? `
            <div class="stm-row stm-thresholds">
                <label class="stm-grow"><span class="stm-help">${esc(t('storage.alertLimit'))}</span><input type="number" id="input-warning-pct" class="form-input" value="${warningPct}" min="1" max="99"></label>
                <label class="stm-grow"><span class="stm-help is-crit">${esc(t('storage.alertCritical'))}</span><input type="number" id="input-critical-pct" class="form-input" value="${criticalPct}" min="0" max="99"></label>
            </div>` : `<div class="stm-help">${esc(t('storage.alertDisabledHint'))}</div>`}
        </div>
        <div class="stm-disks">${disks.length ? disks.map(diskCard).join('') : `<div class="stm-help">${esc(t('storage.noDisks'))}</div>`}</div>`;

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
            const out = btn.parentElement?.querySelector<HTMLElement>('.disk-bench-result');
            const label = btn.textContent || '';
            btn.disabled = true;
            btn.textContent = t('storage.benchmarking');
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
    if (v.active) return `${gameHeadline(v, t)} — ${tr('stm.game.noticeOn', 'BMM steps aside until you stop playing.')}`;
    return tr('stm.game.noticeOff', 'Game mode ended: BMM works normally again.');
}
