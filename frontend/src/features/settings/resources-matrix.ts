// Advanced storage rules (S1): per disk × per operation, under the resources card.
//
// Each cell is an input whose placeholder is what is IN FORCE and where it comes from, so an
// empty cell never hides a limit: "40 · this disk" says the value is inherited from the
// disk-wide rule. Typing a value stores a rule for exactly (disk, operation); clearing every
// cell of a row removes that rule. Values the hard bounds would rewrite are refused by the
// backend with the reason, not silently clamped.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
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
    host.innerHTML = `
        <details class="res-matrix" style="margin-top:12px">
            <summary style="cursor:pointer;font-weight:600;font-size:13px">${esc(t('res.adv') || 'Advanced: per disk and operation')}</summary>
            <div style="font-size:12px;color:var(--text-muted);margin:8px 0">${esc(t('res.advHint') || 'An empty cell inherits: this disk and operation, then this disk, then all disks, then the preset. The grey text is what is in force and where it comes from. Priority hints are ignored on network drives.')}</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
                <select class="input res-m-disk" style="max-width:200px">${disks.map((d) => `<option value="${esc(d)}">${esc(d === '*' ? (t('res.allDisks') || 'All disks') : d.toUpperCase())}</option>`).join('')}</select>
                <button type="button" class="btn btn-sm res-m-reset">${esc(t('res.resetDisk') || 'Back to defaults for this disk')}</button>
                <span class="res-m-msg" style="font-size:12px"></span>
            </div>
            <div class="res-m-table" style="overflow-x:auto"></div>
        </details>`;
    const q = <T extends Element>(s: string) => host.querySelector(s) as T | null;
    const msg = (text: string, ok: boolean) => { const m = q<HTMLElement>('.res-m-msg'); if (m) { m.textContent = text; m.style.color = ok ? 'var(--success)' : 'var(--danger)'; } };

    const paint = async () => {
        const disk = q<HTMLSelectElement>('.res-m-disk')?.value || '*';
        const cells = await (invoke('resources_matrix', { disk }) as Promise<Cell[]>).catch(() => [] as Cell[]);
        const table = q<HTMLElement>('.res-m-table');
        if (!table) return;
        // A column that acts on nothing for this operation is disabled, with the reason, rather
        // than taking a value that would change nothing.
        const na = t('res.na') || 'Does not apply to this operation: the value would change nothing.';
        const input = (op: string, key: string, val: unknown, ph: string, w = 70, on = true) =>
            `<input class="input res-m-in" data-op="${op}" data-k="${key}" type="number" min="1" value="${val == null ? '' : esc(String(val))}" placeholder="${esc(ph)}" title="${esc(on ? ph : `${ph} · ${na}`)}"${on ? '' : ' disabled aria-disabled="true"'} style="max-width:${w}px;width:100%">`;
        table.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="text-align:left;color:var(--text-muted)">
                <th style="padding:4px">${esc(t('res.col.op') || 'Operation')}</th>
                <th style="padding:4px">${esc(t('res.col.rate') || 'MB/s')}</th>
                <th style="padding:4px">${esc(t('res.col.par') || 'At once')}</th>
                <th style="padding:4px">${esc(t('res.col.buf') || 'Buffer KiB')}</th>
                <th style="padding:4px">${esc(t('res.col.io') || 'Priority')}</th>
            </tr></thead>
            <tbody>${cells.map((c) => {
                const mine = c.own;
                const on = c.applies || { rate: true, parallel: true, buffer: true, io: true };
                return `<tr>
                    <td style="padding:4px;white-space:nowrap">${esc(t('res.k.' + c.op) || c.op)}</td>
                    <td style="padding:4px">${input(c.op, 'rate', mine.rate_mb_s, `${c.rate_mb_s ?? '∞'} · ${src(c.src_rate)}`, 70, on.rate)}</td>
                    <td style="padding:4px">${input(c.op, 'parallel', mine.parallel, `${c.parallel} · ${src(c.src_parallel)}`, 60, on.parallel)}</td>
                    <td style="padding:4px">${input(c.op, 'buffer', mine.buffer_kib, `${c.buffer_kib} · ${src(c.src_buffer)}`, 90, on.buffer)}</td>
                    <td style="padding:4px"><select class="input res-m-in" data-op="${c.op}" data-k="io" style="max-width:130px" title="${esc(on.io ? `${c.io_priority} · ${src(c.src_io)}` : `${c.io_priority} · ${src(c.src_io)} · ${na}`)}"${on.io ? '' : ' disabled aria-disabled="true"'}>
                        <option value="">${esc((t('res.inherit') || 'inherit') + ` (${t('res.io.' + c.io_priority) || c.io_priority})`)}</option>
                        <option value="low"${mine.io_priority === 'low' ? ' selected' : ''}>${esc(t('res.io.low') || 'low')}</option>
                        <option value="normal"${mine.io_priority === 'normal' ? ' selected' : ''}>${esc(t('res.io.normal') || 'normal')}</option>
                    </select></td>
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
