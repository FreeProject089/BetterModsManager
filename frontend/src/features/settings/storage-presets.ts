// The Storage Manager's rule presets (Rules per disk tab, above the table): what this PC has,
// which preset fits it and why, a preview of every change, Apply, and one Undo.
//
// Nothing is applied by choosing a card: choosing shows the preview, and Apply sends the plan's
// fingerprint, so Rust refuses a plan that changed since it was shown (a drive plugged in, an
// edit in another window). The plans are built in Rust from the real drives
// (commands/storage_presets.rs); this file only draws them.
//
// The card reads top to bottom in four steps: this PC (one tile per drive), the recommendation
// and its reason, the presets to choose from, and the diff of the chosen one with Apply.
import { invoke } from '../../core/api.js';
import { t, getLang } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { learnMore } from '../../core/learn-more.js';
import { sizeText } from './resources-spark.js';
import { PRESETS, presetName, changeRows, diskName, driveKindName, roleNames, reasonText, type Overview, type PresetId } from './storage-presets-core.js';

const tr = (key: string, en: string): string => { const v = t(key); return v && v !== key ? v : en; };
const esc = escHtml;

/** The app's toast, passed in by the caller: importing ui/app here closed an import cycle
 *  (ui/app → … → storage-modal → storage-presets → ui/app). */
export type PresetsToast = (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;

/** One small line icon per preset, so a card reads at a glance (trusted markup, no input). */
const PRESET_ICON: Record<PresetId, string> = {
    balanced: '<path d="M12 3v18"/><path d="M5 21h14"/><path d="m3 9 4-6 4 6a4 4 0 0 1-8 0Z"/><path d="m13 9 4-6 4 6a4 4 0 0 1-8 0Z"/>',
    quiet: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    performance: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    ssd_hdd: '<rect x="2" y="4" width="20" height="7" rx="2"/><rect x="2" y="13" width="20" height="7" rx="2"/><path d="M6 7.5h.01M6 16.5h.01"/>',
    space_watch: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    external: '<path d="M10 2h4v6h-4z"/><rect x="7" y="8" width="10" height="14" rx="2"/><path d="M10 13h4"/>',
};
const ICON_SPARK = '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 17v4M17 19h4"/>';
const ICON_UNDO = '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>';
const svg = (paths: string, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Draw the presets card in `host`. `onApplied` redraws whatever shows the rules; `toast` reports
 *  an apply, an undo or an error. */
export async function mountStoragePresets(host: HTMLElement, onApplied: () => void, toast: PresetsToast): Promise<void> {
    host.innerHTML = `<div class="stm-card stp"><div class="stm-loading">${esc(tr('stm.presets.reading', 'Reading your drives…'))}</div></div>`;
    let ov: Overview;
    try { ov = await invoke('storage_presets') as Overview; }
    catch (err) { host.innerHTML = `<div class="stm-card stp"><div class="stm-msg is-err">${esc(String(err))}</div></div>`; return; }

    let chosen: PresetId = ov.recommended;
    const lang = getLang();
    const size = (b: number) => sizeText(b, t, lang);
    const plan = (id: PresetId) => ov.plans.find((p) => p.id === id);
    const changeCount = (id: PresetId) => {
        const pl = plan(id);
        return pl ? pl.changes.rules.length + (pl.changes.preset ? 1 : 0) + (pl.changes.alert ? 1 : 0) : 0;
    };

    // This PC: one tile per drive (name, type, what the profiles keep on it, a free-space bar).
    const drives = ov.profile.drives.map((d) => {
        const freePct = d.total_bytes > 0 ? Math.round(d.free_bytes / d.total_bytes * 100) : 0;
        const usedPct = Math.max(0, Math.min(100, 100 - freePct));
        const low = freePct < 15;
        const free = tr('stm.presets.free', '{f} free of {t}').replace('{f}', size(d.free_bytes)).replace('{t}', size(d.total_bytes));
        return `<li class="stp-drive${d.roles.length ? ' is-used' : ''}${low ? ' is-low' : ''}">
            <div class="stp-drive-top">
                <span class="stp-drive-name">${esc(diskName(d.key, t))}</span>
                <span class="stp-kind is-${escAttr(d.kind)}">${esc(driveKindName(d.kind, d.external, t))}</span>
            </div>
            <div class="stm-bar stp-drive-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${usedPct}" aria-label="${escAttr(free)}"><div class="stm-bar-fill ${low ? 'is-crit' : usedPct > 70 ? 'is-warn' : 'is-ok'}" style="width:${usedPct}%"></div></div>
            <div class="stp-drive-free">${esc(free)}</div>
            <div class="stp-drive-roles">${d.roles.length
                ? esc(roleNames(d.roles, t))
                : `<span class="stp-drive-idle">${esc(tr('stm.presets.noRole', 'No profile files here'))}</span>`}</div>
        </li>`;
    }).join('');

    const cards = PRESETS.map((p) => {
        const pl = plan(p.id);
        const off = !pl?.available;
        const n = changeCount(p.id);
        const foot = off ? tr('stm.presets.notHere', 'Nothing to act on on this PC')
            : n === 0 ? tr('stm.presets.inForce', 'Already in force')
                : (n === 1 ? tr('stm.presets.changes1', '1 change') : tr('stm.presets.changesN', '{n} changes').replace('{n}', String(n)));
        return `<button type="button" class="stp-card${off ? ' is-off' : ''}" role="radio" data-id="${p.id}" aria-checked="false"${off ? ' aria-disabled="true"' : ''}>
            <span class="stp-card-ic">${svg(PRESET_ICON[p.id], 16)}</span>
            <span class="stp-card-main">
                <span class="stp-card-top">
                    <span class="stp-card-name">${esc(tr(p.name[0], p.name[1]))}</span>
                    ${p.id === ov.recommended ? `<span class="stm-badge">${esc(tr('stm.presets.recommended', 'Recommended'))}</span>` : ''}
                    ${ov.undo === p.id ? `<span class="stm-badge stp-badge-applied">${esc(tr('stm.presets.applied', 'Applied'))}</span>` : ''}
                </span>
                <span class="stp-card-desc">${esc(tr(p.desc[0], p.desc[1]))}</span>
                <span class="stp-card-foot${!off && n === 0 ? ' is-done' : ''}">${esc(foot)}</span>
            </span>
        </button>`;
    }).join('');

    const pcLine = tr('stm.presets.pcLine', '{d} drives · {c} threads').replace('{d}', String(ov.profile.drives.length)).replace('{c}', String(ov.profile.cores));
    host.innerHTML = `
        <section class="stm-card stp" aria-labelledby="stp-title">
            <div class="stp-head">
                <div class="stp-head-text">
                    <h3 class="stm-card-title" id="stp-title">${esc(tr('stm.presets.title', 'Presets for this PC'))}</h3>
                    <p class="stm-help">${esc(tr('stm.presets.lead', 'A ready-made set of rules, built from your drives. Choose one to see exactly what it changes, then apply it.'))} ${learnMore('storage-presets')}</p>
                </div>
                ${ov.undo ? `<button type="button" class="btn btn-sm btn-secondary stp-undo">${svg(ICON_UNDO, 14)}<span>${esc(tr('stm.presets.undo', 'Undo {p}').replace('{p}', presetName(ov.undo, t)))}</span></button>` : ''}
            </div>

            <div class="stp-block">
                <div class="stp-sub"><span>${esc(tr('stm.presets.pcTitle', 'This PC'))}</span><span class="stp-sub-meta">${esc(pcLine)}</span></div>
                <ul class="stp-drives">${drives || `<li class="stm-empty">${esc(t('storage.noDisks'))}</li>`}</ul>
            </div>

            <div class="stp-rec" role="note">
                <span class="stp-rec-ic">${svg(ICON_SPARK, 18)}</span>
                <div class="stp-rec-text">
                    <div class="stp-rec-title">${esc(tr('stm.presets.recTitle', 'Recommended for this PC: {p}').replace('{p}', presetName(ov.recommended, t)))}</div>
                    <p class="stp-rec-why">${esc(reasonText(ov.reasons, t))}</p>
                </div>
                <button type="button" class="btn btn-sm btn-ghost stp-rec-pick" hidden>${esc(tr('stm.presets.recShow', 'Show it'))}</button>
            </div>

            <div class="stp-block">
                <div class="stp-sub"><span id="stp-pick-title">${esc(tr('stm.presets.pickTitle', 'Choose a preset'))}</span><span class="stp-sub-meta">${esc(tr('stm.presets.pickHint', 'Nothing changes until you apply.'))}</span></div>
                <div class="stp-grid" role="radiogroup" aria-labelledby="stp-pick-title">${cards}</div>
            </div>

            <div class="stp-preview" aria-live="polite"></div>
        </section>`;

    const preview = host.querySelector<HTMLElement>('.stp-preview');
    const recPick = host.querySelector<HTMLButtonElement>('.stp-rec-pick');
    const kindLabel = (k: string) => (k === 'add' ? tr('stm.presets.kAdd', 'Added') : k === 'remove' ? tr('stm.presets.kRemove', 'Removed') : tr('stm.presets.kChange', 'Changed'));
    const mark = (k: string) => (k === 'add' ? '+' : k === 'remove' ? '−' : '~');

    const show = (id: PresetId) => {
        chosen = id;
        host.querySelectorAll<HTMLElement>('.stp-card').forEach((c) => {
            const on = c.dataset.id === id;
            c.setAttribute('aria-checked', String(on));
            c.tabIndex = on ? 0 : -1;
        });
        if (recPick) recPick.hidden = id === ov.recommended;
        const pl = plan(id);
        if (!preview || !pl) return;
        const rows = changeRows(pl.changes, t);
        const kept = pl.notes.filter(([code]) => code === 'cap_kept').map(([, d]) => diskName(d, t));
        const count = (k: string) => rows.filter((r) => r.kind === k).length;
        const counts: [string, string, string][] = [
            ['add', 'stm.presets.nAdded', '{n} added'],
            ['change', 'stm.presets.nChanged', '{n} changed'],
            ['remove', 'stm.presets.nRemoved', '{n} removed'],
        ];
        const chips = counts.filter(([k]) => count(k) > 0)
            .map(([k, key, en]) => `<span class="stp-count is-${k}"><b aria-hidden="true">${mark(k)}</b>${esc(tr(key, en).replace('{n}', String(count(k))))}</span>`).join('');
        const body = !pl.available
            ? `<p class="stp-preview-empty">${esc(tr('stm.presets.notHereLong', 'This PC has no drive this preset is for, so it would change nothing.'))}</p>`
            : rows.length
                ? `<ul class="stp-diff">${rows.map((r) => `<li class="stp-diff-row is-${r.kind}">
                        <span class="stp-diff-mark" title="${escAttr(kindLabel(r.kind))}" aria-label="${escAttr(kindLabel(r.kind))}">${mark(r.kind)}</span>
                        <span class="stp-diff-where">${esc(r.where)}</span>
                        <span class="stp-diff-vals">${r.before ? `<span class="stp-diff-before">${esc(r.before)}</span>` : ''}${r.before && r.after ? '<span class="stp-diff-arrow" aria-hidden="true">→</span>' : ''}${r.after ? `<span class="stp-diff-after">${esc(r.after)}</span>` : ''}</span>
                    </li>`).join('')}</ul>`
                : `<p class="stp-preview-empty is-done">${esc(tr('stm.presets.nothing', 'Everything this preset sets is already in force.'))}</p>`;
        preview.innerHTML = `
            <div class="stp-preview-head">
                <span class="stm-card-title">${esc(tr('stm.presets.previewTitle', 'What {p} changes').replace('{p}', presetName(id, t)))}</span>
                ${chips ? `<span class="stp-counts">${chips}</span>` : ''}
            </div>
            ${body}
            ${kept.length ? `<p class="stm-help">${esc(tr('stm.presets.capsKept', 'Speed caps kept as they are: {d}.').replace('{d}', kept.join(', ')))}</p>` : ''}
            <div class="stp-actions">
                <p class="stm-help">${esc(tr('stm.presets.replaces', 'Applying replaces the rules of the table below; one Undo puts them back.'))}</p>
                <button type="button" class="btn btn-sm btn-primary stp-apply"${!pl.available || !rows.length ? ' disabled' : ''}>${esc(tr('stm.presets.applyP', 'Apply {p}').replace('{p}', presetName(id, t)))}</button>
            </div>`;
        preview.querySelector('.stp-apply')?.addEventListener('click', () => void apply(pl.id, pl.fingerprint));
    };

    const apply = async (id: PresetId, fingerprint: string) => {
        const btn = preview?.querySelector<HTMLButtonElement>('.stp-apply');
        if (btn) btn.disabled = true;
        try {
            await invoke('storage_preset_apply', { id, fingerprint });
            toast(tr('stm.presets.appliedToast', '{p} applied. Undo is above the presets.').replace('{p}', presetName(id, t)), 'success');
            onApplied();
        } catch (err) {
            toast(`${t('common.error')}: ${err}`, 'error');
            void mountStoragePresets(host, onApplied, toast);
        }
    };

    host.querySelector('.stp-grid')?.addEventListener('click', (e) => {
        const c = (e.target as HTMLElement).closest<HTMLElement>('.stp-card');
        if (c?.dataset.id) show(c.dataset.id as PresetId);
    });
    recPick?.addEventListener('click', () => {
        show(ov.recommended);
        host.querySelector<HTMLElement>(`.stp-card[data-id="${ov.recommended}"]`)?.focus();
    });
    // The radio group's keys: arrows move the choice.
    host.querySelector('.stp-grid')?.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        const step = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const ids = PRESETS.map((p) => p.id);
        const next = ids[(ids.indexOf(chosen) + step + ids.length) % ids.length];
        show(next);
        host.querySelector<HTMLElement>(`.stp-card[data-id="${next}"]`)?.focus();
    });
    host.querySelector('.stp-undo')?.addEventListener('click', async () => {
        try {
            const done = await invoke('storage_preset_undo') as boolean;
            toast(done ? tr('stm.presets.undone', 'The previous rules are back.') : tr('stm.presets.noUndo', 'Nothing to undo.'), done ? 'success' : 'info');
            onApplied();
        } catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
    });
    show(chosen);
}
