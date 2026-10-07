// The Storage Manager's rule presets (Rules per disk tab, above the table): what this PC has,
// which preset fits it and why, a preview of every change, Apply, and one Undo.
//
// Nothing is applied by choosing a card: choosing shows the preview, and Apply sends the plan's
// fingerprint, so Rust refuses a plan that changed since it was shown (a drive plugged in, an
// edit in another window). The plans are built in Rust from the real drives
// (commands/storage_presets.rs); this file only draws them.
import { invoke } from '../../core/api.js';
import { t, getLang } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { learnMore } from '../../core/learn-more.js';
import { sizeText } from './resources-spark.js';
import { PRESETS, presetName, changeLines, diskName, driveKindName, roleNames, reasonText, type Overview, type PresetId } from './storage-presets-core.js';

const tr = (key: string, en: string): string => { const v = t(key); return v && v !== key ? v : en; };
const esc = escHtml;

/** The app's toast, passed in by the caller: importing ui/app here closed an import cycle
 *  (ui/app → … → storage-modal → storage-presets → ui/app). */
export type PresetsToast = (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;

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

    const drives = ov.profile.drives.map((d) => {
        const pct = d.total_bytes > 0 ? Math.round(d.free_bytes / d.total_bytes * 100) : 0;
        const free = tr('stm.presets.free', '{f} free of {t}').replace('{f}', size(d.free_bytes)).replace('{t}', size(d.total_bytes));
        return `<li class="stp-drive${d.roles.length ? ' is-used' : ''}">
            <span class="stp-drive-name">${esc(diskName(d.key, t))}</span>
            <span class="stm-kind">${esc(driveKindName(d.kind, d.external, t))}</span>
            <span class="stp-drive-free${pct < 15 ? ' is-low' : ''}">${esc(free)}</span>
            ${d.roles.length ? `<span class="stp-drive-roles">${esc(roleNames(d.roles, t))}</span>` : ''}
        </li>`;
    }).join('');

    const cards = PRESETS.map((p) => {
        const pl = plan(p.id);
        const off = !pl?.available;
        const n = pl ? pl.changes.rules.length + (pl.changes.preset ? 1 : 0) + (pl.changes.alert ? 1 : 0) : 0;
        return `<button type="button" class="stp-card" role="radio" data-id="${p.id}" aria-checked="false"${off ? ' aria-disabled="true"' : ''}>
            <span class="stp-card-top">
                <span class="stp-card-name">${esc(tr(p.name[0], p.name[1]))}</span>
                ${p.id === ov.recommended ? `<span class="stm-badge">${esc(tr('stm.presets.recommended', 'Recommended'))}</span>` : ''}
                ${ov.undo === p.id ? `<span class="stm-badge stp-badge-applied">${esc(tr('stm.presets.applied', 'Applied'))}</span>` : ''}
            </span>
            <span class="stp-card-desc">${esc(tr(p.desc[0], p.desc[1]))}</span>
            <span class="stp-card-foot">${esc(off ? tr('stm.presets.notHere', 'Nothing to act on on this PC')
                : n === 0 ? tr('stm.presets.inForce', 'Already in force') : (n === 1 ? tr('stm.presets.changes1', '1 change') : tr('stm.presets.changesN', '{n} changes').replace('{n}', String(n))))}</span>
        </button>`;
    }).join('');

    host.innerHTML = `
        <section class="stm-card stp" aria-labelledby="stp-title">
            <div class="stp-head">
                <div class="stp-head-text">
                    <h3 class="stm-card-title" id="stp-title">${esc(tr('stm.presets.title', 'Presets for this PC'))}</h3>
                    <p class="stm-help">${esc(tr('stm.presets.lead', 'A ready-made set of rules, built from your drives. Choose one to see exactly what it changes, then apply it.'))} ${learnMore('storage-presets')}</p>
                </div>
                ${ov.undo ? `<button type="button" class="btn btn-sm btn-ghost stp-undo">${esc(tr('stm.presets.undo', 'Undo {p}').replace('{p}', presetName(ov.undo, t)))}</button>` : ''}
            </div>
            <details class="stm-more stp-pc">
                <summary>${esc(tr('stm.presets.pcSummary', 'This PC: {d} drives, {c} threads').replace('{d}', String(ov.profile.drives.length)).replace('{c}', String(ov.profile.cores)))}</summary>
                <div class="stm-more-body"><ul class="stp-drives">${drives || `<li class="stm-help">${esc(t('storage.noDisks'))}</li>`}</ul></div>
            </details>
            <p class="stp-why"><strong>${esc(tr('stm.presets.whyTitle', 'Why {p}:').replace('{p}', presetName(ov.recommended, t)))}</strong> ${esc(reasonText(ov.reasons, t))}</p>
            <div class="stp-grid" role="radiogroup" aria-label="${escAttr(tr('stm.presets.title', 'Presets for this PC'))}">${cards}</div>
            <div class="stp-preview" aria-live="polite"></div>
        </section>`;

    const preview = host.querySelector<HTMLElement>('.stp-preview');
    const show = (id: PresetId) => {
        chosen = id;
        host.querySelectorAll<HTMLElement>('.stp-card').forEach((c) => {
            const on = c.dataset.id === id;
            c.setAttribute('aria-checked', String(on));
            c.tabIndex = on ? 0 : -1;
        });
        const pl = plan(id);
        if (!preview || !pl) return;
        const lines = changeLines(pl.changes, t);
        const kept = pl.notes.filter(([code]) => code === 'cap_kept').map(([, d]) => diskName(d, t));
        preview.innerHTML = `
            <div class="stp-preview-head">
                <span class="stm-card-title">${esc(tr('stm.presets.previewTitle', 'What {p} changes').replace('{p}', presetName(id, t)))}</span>
                <button type="button" class="btn btn-sm btn-primary stp-apply"${!pl.available || !lines.length ? ' disabled' : ''}>${esc(tr('stm.presets.apply', 'Apply'))}</button>
            </div>
            ${!pl.available ? `<p class="stm-help">${esc(tr('stm.presets.notHereLong', 'This PC has no drive this preset is for, so it would change nothing.'))}</p>`
            : lines.length ? `<ul class="stp-changes">${lines.map((l) => `<li class="stp-change is-${l.kind}"><span class="stp-change-mark" aria-hidden="true">${l.kind === 'add' ? '+' : l.kind === 'remove' ? '−' : '~'}</span><span>${esc(l.text)}</span></li>`).join('')}</ul>`
            : `<p class="stm-help">${esc(tr('stm.presets.nothing', 'Everything this preset sets is already in force.'))}</p>`}
            ${kept.length ? `<p class="stm-help">${esc(tr('stm.presets.capsKept', 'Speed caps kept as they are: {d}.').replace('{d}', kept.join(', ')))}</p>` : ''}
            <p class="stm-help">${esc(tr('stm.presets.replaces', 'Applying replaces the rules of the table below; one Undo puts them back.'))}</p>`;
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
