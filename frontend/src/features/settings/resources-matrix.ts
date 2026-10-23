// Advanced storage rules (S1): per disk × per operation, the Storage Manager's "Rules per
// disk" tab (storage-modal.ts). The legend (what each column does) is folded above the table;
// a cell holding a rule of its own stands out, a column that does not apply is a dash.
//
// Each cell is an input whose placeholder is what is IN FORCE and where it comes from, so an
// empty cell never hides a limit: "40 · this disk" says the value is inherited from the
// disk-wide rule. Typing a value stores a rule for exactly (disk, operation); clearing every
// cell of a row removes that rule. Values the hard bounds would rewrite are refused by the
// backend with the reason, not silently clamped.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { learnMore } from '../../core/learn-more.js';
import { ruleFromInputs } from './resources-spark.js';

interface Cell {
    op: string; rate_mb_s: number | null; parallel: number; buffer_kib: number; io_priority: 'low' | 'normal';
    src_rate: string; src_parallel: string; src_buffer: string; src_io: string;
    own: { rate_mb_s?: number; parallel?: number; buffer_kib?: number; io_priority?: 'low' | 'normal' };
    /** Which columns act on this operation at all (resources_rules.rs `applies`). */
    applies?: { rate: boolean; parallel: boolean; buffer: boolean; io: boolean };
}

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const src = (s: string) => t('res.src.' + s) || s;

export async function renderResourcesMatrix(host: HTMLElement, mounts: string[]): Promise<void> {
    const disks = ['*', ...mounts.map((m) => m.toLowerCase())];
    // The legend: one line per column, plus how to read an empty, a grey and a disabled cell.
    const legend: [string, string, string][] = [
        [t('res.col.rate') || 'MB/s', 'stm.legend.rate', 'The most BMM may write to the disk each second for this operation. Everything writing at once shares it.'],
        [t('res.col.par') || 'At once', 'stm.legend.par', 'How many operations of this kind may run together.'],
        [t('res.col.buf') || 'Buffer KiB', 'stm.legend.buf', 'The size of each copy step. Larger is faster on an SSD, smaller is gentler on a hard disk.'],
        [t('res.col.io') || 'Priority', 'stm.legend.io', 'Low lets your other programs read and write first.'],
        [t('stm.legend.greyTerm') || 'Grey text', 'stm.legend.grey', 'The value in force now, and where it comes from: this rule, this disk, all disks, or the preset.'],
        [t('stm.legend.emptyTerm') || 'Empty cell', 'stm.legend.empty', 'Inherits. Only what you type is stored; clear a row to remove its rule.'],
        [t('stm.legend.offTerm') || 'Greyed-out cell', 'stm.legend.off', 'Does not apply to this operation, so it cannot be set.'],
    ];
    const tx = (k: string, en: string) => { const v = t(k); return v && v !== k ? v : en; };
    host.innerHTML = `
        <div class="res-matrix">
            <div class="stm-section-head">
                <h3 class="stm-card-title" id="stm-rules-title">${esc(tx('stm.rules.title', 'Your own rules'))}</h3>
                <p class="stm-help">${esc(tx('stm.lead.rulesShort', 'Optional. Type a value to override the preset for one disk and one kind of work.'))}</p>
            </div>
            <details class="stm-more stm-legend-more">
                <summary>${esc(tx('stm.legend.title', 'How to read this table'))}</summary>
                <div class="stm-more-body">
                    <dl class="stm-legend">${legend.map(([term, k, en]) => `<div><dt>${esc(term)}</dt><dd>${esc(tx(k, en))}</dd></div>`).join('')}</dl>
                    <div class="stm-help">${esc(t('res.advHint') || 'An empty cell inherits: this disk and operation, then this disk, then all disks, then the preset. The grey text is what is in force and where it comes from. Priority hints are ignored on network drives.')}</div>
                    ${learnMore('resources-rules')}
                </div>
            </details>
            <div class="stm-table-card" role="group" aria-labelledby="stm-rules-title">
                <div class="stm-toolbar">
                    <label class="stm-toolbar-field" for="stm-m-disk">
                        <span class="stm-toolbar-label">${esc(tx('stm.rules.disk', 'Disk'))}</span>
                        <select id="stm-m-disk" class="input res-m-disk" data-tooltip="${esc(tx('stm.rules.diskTip', 'The disk whose rules the table shows. All disks: rules every disk inherits.'))}">${disks.map((d) => `<option value="${esc(d)}">${esc(d === '*' ? (t('res.allDisks') || 'All disks') : d.toUpperCase())}</option>`).join('')}</select>
                    </label>
                    <span class="stm-msg res-m-msg" role="status"></span>
                    <button type="button" class="btn btn-sm btn-ghost res-m-reset" data-tooltip="${esc(tx('stm.rules.resetTip', 'Remove every rule of this disk: the preset decides again.'))}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg><span>${esc(t('res.resetDisk') || 'Back to defaults for this disk')}</span></button>
                </div>
                <div class="res-m-table stm-table-wrap"></div>
            </div>
        </div>`;
    const q = <T extends Element>(s: string) => host.querySelector(s) as T | null;
    const msg = (text: string, ok: boolean) => { const m = q<HTMLElement>('.res-m-msg'); if (m) { m.textContent = text; m.classList.toggle('is-err', !ok); } };

    const paint = async () => {
        const disk = q<HTMLSelectElement>('.res-m-disk')?.value || '*';
        const cells = await (invoke('resources_matrix', { disk }) as Promise<Cell[]>).catch(() => [] as Cell[]);
        const table = q<HTMLElement>('.res-m-table');
        if (!table) return;
        // A column that acts on nothing for this operation is disabled, with the reason, rather
        // than taking a value that would change nothing.
        const na = t('res.na') || 'Does not apply to this operation: the value would change nothing.';
        // An editable cell is an input (outlined, and filled with the accent when it holds a rule
        // of its own); a column that does not apply is a dash with the reason, keeping a value
        // stored there anyway so a save of the row does not drop it.
        const input = (op: string, key: string, val: unknown, ph: string, w = 70, on = true) => {
            const v = val == null ? '' : esc(String(val));
            if (!on) return `<span class="stm-cell-off" title="${esc(`${ph} · ${na}`)}" aria-label="${esc(na)}">–</span>${v ? `<input type="hidden" class="res-m-in" data-op="${op}" data-k="${key}" value="${v}">` : ''}`;
            return `<input class="input res-m-in${v ? ' is-set' : ''}" data-op="${op}" data-k="${key}" type="number" min="1" value="${v}" placeholder="${esc(ph)}" title="${esc(ph)}" style="max-width:${w}px;width:100%">`;
        };
        const tip = (k: string) => { const row = legend.find((l) => l[1] === k); return row ? esc(tx(row[1], row[2])) : ''; };
        table.innerHTML = `<table class="stm-table">
            <thead><tr>
                <th>${esc(t('res.col.op') || 'Operation')}</th>
                <th data-tooltip="${tip('stm.legend.rate')}">${esc(t('res.col.rate') || 'MB/s')}</th>
                <th data-tooltip="${tip('stm.legend.par')}">${esc(t('res.col.par') || 'At once')}</th>
                <th data-tooltip="${tip('stm.legend.buf')}">${esc(t('res.col.buf') || 'Buffer KiB')}</th>
                <th data-tooltip="${tip('stm.legend.io')}">${esc(t('res.col.io') || 'Priority')}</th>
            </tr></thead>
            <tbody>${cells.map((c) => {
                const mine = c.own;
                const on = c.applies || { rate: true, parallel: true, buffer: true, io: true };
                const own = [mine.rate_mb_s, mine.parallel, mine.buffer_kib, mine.io_priority].some((v) => v != null);
                return `<tr${own ? ' class="has-rule"' : ''}>
                    <td class="stm-table-op">${esc(t('res.k.' + c.op) || c.op)}</td>
                    <td>${input(c.op, 'rate', mine.rate_mb_s, `${c.rate_mb_s ?? '∞'} · ${src(c.src_rate)}`, 110, on.rate)}</td>
                    <td>${input(c.op, 'parallel', mine.parallel, `${c.parallel} · ${src(c.src_parallel)}`, 110, on.parallel)}</td>
                    <td>${input(c.op, 'buffer', mine.buffer_kib, `${c.buffer_kib} · ${src(c.src_buffer)}`, 120, on.buffer)}</td>
                    <td>${on.io ? `<select class="input res-m-in${mine.io_priority ? ' is-set' : ''}" data-op="${c.op}" data-k="io" style="max-width:130px" title="${esc(`${c.io_priority} · ${src(c.src_io)}`)}">
                        <option value="">${esc((t('res.inherit') || 'inherit') + ` (${t('res.io.' + c.io_priority) || c.io_priority})`)}</option>
                        <option value="low"${mine.io_priority === 'low' ? ' selected' : ''}>${esc(t('res.io.low') || 'low')}</option>
                        <option value="normal"${mine.io_priority === 'normal' ? ' selected' : ''}>${esc(t('res.io.normal') || 'normal')}</option>
                    </select>` : input(c.op, 'io', mine.io_priority, `${c.io_priority} · ${src(c.src_io)}`, 130, false)}</td>
                </tr>`;
            }).join('')}</tbody></table>`;
    };

    host.addEventListener('change', async (e) => {
        const el = e.target as HTMLElement;
        if (el.classList.contains('res-m-disk')) { paint(); return; }
        if (!el.classList.contains('res-m-in')) return;
        const op = el.dataset.op || '';
        const row: Record<string, string> = {};
        host.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`.res-m-in[data-op="${op}"]`).forEach((i) => { row[i.dataset.k || ''] = i.value; });
        const disk = q<HTMLSelectElement>('.res-m-disk')?.value || '*';
        try {
            await invoke('resources_set_rule', { disk, op, rule: ruleFromInputs(row) });
            msg(t('res.saved') || 'Saved.', true);
            paint();
        } catch (err) { msg(String(err), false); }
    });
    q('.res-m-reset')?.addEventListener('click', async () => {
        const disk = q<HTMLSelectElement>('.res-m-disk')?.value || '*';
        try { await invoke('resources_reset_rules', { disk }); msg(t('res.saved') || 'Saved.', true); paint(); } catch (err) { msg(String(err), false); }
    });
    await paint();
}
