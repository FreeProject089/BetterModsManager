// ai-report.ts — the check a report goes through before it is sent.
//
// Three passes, and only the last one can involve a model:
//   1. Masking (local, always): every secret BMM holds, user-folder names in paths, e-mails,
//      IP addresses, the Windows account and PC names — found in Rust (`ai_report_precheck`)
//      and shown as counts. "Mask before sending" starts ticked; the user can untick it.
//   2. "Already sent?" (local, always): compared with the reports sent from this PC in the
//      last 30 days (the same local history the Settings card lists).
//   3. An AI hint (optional, on click): category, severity, "looks like one of your earlier
//      reports" — only when the user enabled AI and chose a classifier. A hint, never a
//      verdict: it changes nothing in the report.
//
// When the first two find nothing, the report goes straight out, as before. When they find
// something, the panel opens and the next click on Send sends it the way the user chose.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { similarReports, providerBlock, pct, type HistoryEntry } from './ai-model.js';
import { ensureAiCss, loadAiView, reasonText, bcAuthArgs } from './ai-shared.js';

export interface ReportParts { title: string; desc: string; steps: string[] }

let _reviewedFor = '';
let _masked: ReportParts | null = null;
/** The panel the user actually saw. A re-rendered dialog has a new one, and then nothing counts
 *  as reviewed: a Send must never go out on choices made in a panel that no longer exists. */
let _panelEl: HTMLElement | null = null;

const key = (p: ReportParts) => JSON.stringify([p.title, p.desc, p.steps]);

function history(): HistoryEntry[] {
    try { return JSON.parse(localStorage.getItem('bmm_report_history') || '[]'); } catch { return []; }
}

function findingText(kind: string, n: number): string {
    const c = { n: String(n) };
    switch (kind) {
        case 'user_path': return t('ai.report.fUserPath', c);
        case 'email': return t('ai.report.fEmail', c);
        case 'ip': return t('ai.report.fIp', c);
        case 'token': return t('ai.report.fToken', c);
        case 'username': return t('ai.report.fUsername', c);
        case 'machine': return t('ai.report.fMachine', c);
        default: return `${kind}: ${n}`;
    }
}

function panel(): HTMLElement | null {
    let p = document.getElementById('fbm-precheck');
    if (p) return p;
    const foot = document.querySelector('#modal-feedback .fbm-foot');
    if (!foot || !foot.parentElement) return null;
    p = document.createElement('div');
    p.id = 'fbm-precheck';
    p.className = 'ai-precheck';
    p.hidden = true;
    foot.parentElement.insertBefore(p, foot);
    return p;
}

async function maskOne(text: string): Promise<{ text: string; findings: Array<{ kind: string; count: number }> }> {
    if (!text) return { text, findings: [] };
    try { return (await invoke('ai_report_precheck', { text })) as any; } catch { return { text, findings: [] }; }
}

/**
 * Call before sending. `proceed: false` = the panel is showing something the user should see
 * first; the dialog stays open and the next Send goes through with their choices.
 */
export async function reviewBeforeSend(parts: ReportParts): Promise<{ proceed: boolean; parts: ReportParts }> {
    ensureAiCss();
    const k = key(parts);
    const p = panel();
    if (k === _reviewedFor && p && p === _panelEl && !p.hidden) {
        const mask = !!(p.querySelector('#aip-mask') as HTMLInputElement | null)?.checked;
        return { proceed: true, parts: mask && _masked ? _masked : parts };
    }
    const [mt, md, ...ms] = await Promise.all([maskOne(parts.title), maskOne(parts.desc), ...parts.steps.map(maskOne)]);
    const masked: ReportParts = { title: mt.text, desc: md.text, steps: ms.map((m) => m.text) };
    const counts = new Map<string, number>();
    for (const r of [mt, md, ...ms]) for (const f of r.findings || []) counts.set(f.kind, (counts.get(f.kind) || 0) + f.count);
    const similar = similarReports(parts.title, parts.desc, history());
    if (!counts.size && !similar.length) return { proceed: true, parts };
    if (!p) return { proceed: true, parts: counts.size ? masked : parts };

    _reviewedFor = k;
    _masked = masked;
    _panelEl = p;
    const view = await loadAiView();
    const block = providerBlock(view?.settings as any, 'report');
    p.hidden = false;
    p.innerHTML = `
      <div class="ai-sub">${escHtml(t('ai.report.title'))}</div>
      ${counts.size ? `<p class="ai-muted">${escHtml(t('ai.report.found'))}</p>
        <ul class="ai-list">${[...counts].map(([kind, n]) => `<li>${escHtml(findingText(kind, n))}</li>`).join('')}</ul>
        <label class="ai-check"><input type="checkbox" id="aip-mask" checked> <span>${escHtml(t('ai.report.mask'))}</span></label>` : ''}
      ${similar.length ? `<p class="ai-muted">${escHtml(t('ai.report.similar'))}</p>
        <ul class="ai-list">${similar.map((s) => `<li>${escHtml(String(s.entry.title || ''))} <span class="ai-muted">(${escHtml(String(s.entry.date || '').slice(0, 10))} · ${pct(s.score)}%)</span></li>`).join('')}</ul>` : ''}
      ${!block ? `<button type="button" class="btn btn-ghost btn-sm" id="aip-hint">${escHtml(t('ai.report.hintBtn'))}</button><div class="ai-muted" id="aip-hint-out" aria-live="polite"></div>` : ''}
      <p class="ai-muted">${escHtml(t('ai.report.decide'))}</p>`;
    p.querySelector('#aip-hint')?.addEventListener('click', async () => {
        const out = p.querySelector('#aip-hint-out');
        if (out) out.textContent = t('ai.suggest.loading');
        try {
            const known = history().slice(0, 8).map((h) => String(h.title || '')).filter(Boolean);
            const res: any = await invoke('ai_triage_report', {
                text: `${masked.title}\n${masked.desc}\n${masked.steps.join('\n')}`,
                known,
                ...(await bcAuthArgs(view?.settings)),
            });
            const tr = res?.triage || {};
            const bits: string[] = [];
            // « Réponses de Laya »: no percentages when the user hid them; a kept guess says so.
            const showP = tr.show_probs !== false;
            if (tr.category) bits.push(t('ai.report.hintCategory', { v: String(tr.category), p: showP && tr.category_p != null ? `${pct(tr.category_p)}%` : '—' }) + (tr.uncertain ? ` (${t('ai.lt.guessBadge')})` : ''));
            if (tr.severity) bits.push(t('ai.report.hintSeverity', { v: String(tr.severity), p: showP && tr.severity_p != null ? `${pct(tr.severity_p)}%` : '—' }));
            if (tr.duplicate_of != null && known[tr.duplicate_of]) bits.push(t('ai.report.hintDuplicate', { v: known[tr.duplicate_of] }));
            if (out) out.textContent = bits.length ? bits.join(' · ') : t('ai.report.hintNone');
        } catch (e) {
            if (out) out.textContent = reasonText(String((e as Error)?.message || e));
        }
    });
    return { proceed: false, parts };
}

/** Forget the review (the dialog was closed or re-rendered). */
export function resetReview(): void { _reviewedFor = ''; _masked = null; _panelEl = null; }
