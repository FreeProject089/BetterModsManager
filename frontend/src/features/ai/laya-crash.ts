// laya-crash.ts — Laya in « Rapports de crash & sessions » (features/settings/crash-manager.ts).
//
// · Groups: crash reports that are the same failure (same reason once numbers, addresses and
//   paths are set aside) share a group badge; clicking it shows only that group.
// · Causes: on the user's click, Laya labels ONE report per group (cached in Rust) with a
//   probable cause in two levels, a family then a cause (`ai_assist::CRASH_CAUSES`), through the
//   « Rapports de crash » answer settings — a kept guess says so, an abstention reads « cause
//   inconnue ». Each label carries its confidence, its evidence (the keywords and log lines of
//   the masked excerpt that back it up, paths masked in Rust) and a fixed, translated next step.
//   Families, then the causes of the family chosen, become filter chips with counts.
// · « Expliquer »: only when a generator is configured (otherwise the button is not drawn),
//   from the masked excerpt; a remote generator is named on the button before the click.
//
// All of it is behind the Rust gate: with the master switch off, `ai_crash_digests` refuses
// and this file draws nothing. The excerpts are masked and neutralised in Rust and shown here
// as text, never as HTML; « Expliquer »'s written answer goes through B.MD's untrusted path
// (laya-explain-md.ts). Nothing leaves the PC for the groups or the labels (the built-in
// engine, or the user's own laya-serve).
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { pct } from './ai-model.js';
import { ensureAiCss, reasonText } from './ai-shared.js';
import { groupCrashes, groupOf, spreadLabels, causeOf, labelCounts, familyCounts, filterFamily, evidenceOf, passes, type CrashDigest, type CrashGroup, type LayaDecision, type Evidence } from './laya-assist-model.js';
import { causeWord, familyWord, stepWord } from './laya-words.js';
import { announceCrashLabels, type CrashLabelled } from './laya-crash-events.js';

interface Entry { path: string; category: string; date?: string }

let _explain = { on: false, remote: false };
let _labels = new Map<string, LayaDecision>();
let _evidence = new Map<string, Evidence>();
let _filter = '';

/**
 * Add the Laya strip above the report list and the badges on its rows. `body` is the
 * manager's list container (rows carry `data-p` = the report path).
 */
export async function mountCrashInsights(body: HTMLElement, reports: Entry[]): Promise<void> {
    const crashes = reports.filter((r) => /crash/i.test(r.category));
    if (!crashes.length) return;
    let res: any;
    try { res = await invoke('ai_crash_digests', { paths: crashes.map((r) => r.path) }); } catch { return; }   // AI off / no local Laya: nothing drawn
    if (!body.isConnected) return;
    ensureAiCss();
    _explain = { on: !!res?.explain, remote: !!res?.explainRemote };
    const digests: CrashDigest[] = (Array.isArray(res?.items) ? res.items : []).map((d: any, i: number) => ({ path: String(d.path), excerpt: String(d.excerpt || ''), reason: String(d.reason || ''), date: i }));
    const groups = groupCrashes(digests);
    const byPath = groupOf(groups);
    _labels = new Map();
    _evidence = new Map();
    _filter = '';
    const strip = document.createElement('div');
    strip.className = 'laya-crash-strip';
    strip.innerHTML = `
      <div class="laya-crash-head">
        <span class="laya-fb-title">${escHtml(t('crashmgr.laya.title'))}</span>
        <span class="ai-muted">${escHtml(t('crashmgr.laya.groups', { n: String(digests.length), g: String(groups.length) }))}</span>
        <button type="button" class="btn btn-ghost btn-xs" data-laya-label>${escHtml(t('crashmgr.laya.label'))}</button>
      </div>
      <div class="laya-crash-chips" data-laya-fams role="group" aria-label="${escHtml(t('crashmgr.laya.filterFamily'))}"></div>
      <div class="laya-crash-chips" data-laya-chips role="group" aria-label="${escHtml(t('crashmgr.laya.filter'))}"></div>
      <div class="ai-muted" data-laya-step aria-live="polite"></div>
      <div class="ai-muted" data-laya-cstatus aria-live="polite"></div>`;
    body.prepend(strip);
    decorate(body, groups, byPath);
    strip.querySelector('[data-laya-label]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        const out = strip.querySelector<HTMLElement>('[data-laya-cstatus]');
        if (out) out.textContent = t('ai.suggest.loading');
        try {
            const reps = groups.map((g) => g.rep);
            const byRep = new Map<string, LayaDecision>();
            const evRep = new Map<string, Evidence>();
            const told: CrashLabelled[] = [];
            const digestOf = new Map(digests.map((d) => [d.path, d]));
            // At most 12 per call (Rust's bound): the groups in order, newest first.
            for (let i = 0; i < reps.length; i += 12) {
                const r: any = await invoke('ai_crash_label', { paths: reps.slice(i, i + 12) });
                for (const it of Array.isArray(r?.items) ? r.items : []) {
                    if (!it?.decision) continue;
                    byRep.set(String(it.path), it.decision as LayaDecision);
                    evRep.set(String(it.path), evidenceOf(it.evidence));
                    const c = causeOf(it.decision as LayaDecision);
                    const dg = digestOf.get(String(it.path));
                    told.push({
                        report: String(it.path).split(/[\\/]/).pop() || '', family: c?.family || 'unknown', cause: c?.id || 'unknown',
                        p: Number(c?.p) || 0, abstained: !c || c.id === 'unknown', uncertain: !!c?.uncertain, cached: !!it.cached,
                        reason: dg?.reason || '', excerpt: dg?.excerpt || '',
                    });
                }
            }
            // A scheduled task may be waiting for these (`bmm.ai.crashLabelled`, `bmm.ai.crashGroup`).
            announceCrashLabels(told);
            _labels = spreadLabels(groups, byRep);
            _evidence = spreadLabels(groups, evRep);
            if (out) out.textContent = '';
        } catch (err) {
            if (out) out.textContent = reasonText(String((err as Error)?.message || err));
        } finally { btn.disabled = false; }
        refresh(body, groups, byPath);
        // An Analyze panel already open gets its card now.
        body.querySelectorAll<HTMLElement>('.crashmgr-rowdetail[data-detail]').forEach((d) => {
            const p = (d.previousElementSibling as HTMLElement | null)?.dataset.p;
            if (p && d.style.display !== 'none') mountCause(d, p);
        });
    });
}

function refresh(body: HTMLElement, groups: CrashGroup[], byPath: Map<string, number>): void {
    decorate(body, groups, byPath);
    const strip = body.querySelector<HTMLElement>('.laya-crash-strip');
    if (strip) drawChips(strip, body, groups, byPath);
}

/** Two rows of chips: the families, then the causes of the family chosen; the step of a cause. */
function drawChips(strip: HTMLElement, body: HTMLElement, groups: CrashGroup[], byPath: Map<string, number>): void {
    const fams = strip.querySelector<HTMLElement>('[data-laya-fams]');
    const host = strip.querySelector<HTMLElement>('[data-laya-chips]');
    const step = strip.querySelector<HTMLElement>('[data-laya-step]');
    if (!fams || !host) return;
    const fam = filterFamily(_filter);
    const chip = (id: string, text: string) => `<button type="button" class="laya-chip laya-chip-btn${_filter === id ? ' is-on' : ''}" data-laya-filter="${escHtml(id)}" aria-pressed="${_filter === id}">${escHtml(text)}</button>`;
    const fc = familyCounts(_labels);
    fams.innerHTML = !fc.length && !_filter ? '' : [
        chip('', t('crashmgr.laya.all')),
        ...fc.map((c) => chip(`family:${c.id}`, `${familyWord(c.id)} (${c.n})`)),
        ...(_filter.startsWith('group:') ? [chip(_filter, t('crashmgr.laya.groupN', { n: _filter.slice(6) }))] : []),
    ].join('');
    host.innerHTML = fam ? labelCounts(_labels, fam).map((c) => chip(`cause:${c.id}`, `${causeWord(c.id)} (${c.n})`)).join('') : '';
    if (step) step.textContent = _filter.startsWith('cause:') ? t('crashmgr.laya.stepLine', { step: stepWord(_filter.slice(6)) }) : '';
    strip.querySelectorAll<HTMLElement>('[data-laya-filter]').forEach((b) => b.addEventListener('click', () => {
        _filter = b.dataset.layaFilter || '';
        refresh(body, groups, byPath);
    }));
}

/** Badges on the rows (group, cause) and the filter applied. */
function decorate(body: HTMLElement, groups: CrashGroup[], byPath: Map<string, number>): void {
    const sizes = new Map(groups.map((g) => [g.key, g.members.length]));
    body.querySelectorAll<HTMLElement>('.crashmgr-row[data-p]').forEach((row) => {
        const path = row.dataset.p || '';
        const g = byPath.get(path);
        const info = row.querySelector<HTMLElement>('.crashmgr-info');
        if (!info || g == null) return;
        let badges = info.querySelector<HTMLElement>('.laya-crash-badges');
        if (!badges) { badges = document.createElement('span'); badges.className = 'laya-crash-badges'; info.appendChild(badges); }
        const n = sizes.get(g) || 1;
        const c = causeOf(_labels.get(path));
        badges.innerHTML = `${n > 1 ? `<button type="button" class="laya-chip laya-chip-btn" data-laya-group="${g}">${escHtml(t('crashmgr.laya.similar', { n: String(n), g: String(g) }))}</button>` : ''}`
            + (c ? `<span class="laya-chip${c.uncertain ? ' is-guess' : ''}" data-tooltip="${escHtml(`${familyWord(c.family)} · ${stepWord(c.id)}`)}">${escHtml(causeWord(c.id))}${c.p != null ? ` · ${pct(c.p)} %` : ''}${c.uncertain ? ` · ${escHtml(t('ai.lt.guessBadge'))}` : ''}</span>` : '');
        badges.querySelector<HTMLElement>('[data-laya-group]')?.addEventListener('click', () => {
            _filter = `group:${g}`;
            refresh(body, groups, byPath);
        });
        const show = passes(path, _filter, _labels, byPath);
        row.hidden = !show;
        const detail = row.nextElementSibling as HTMLElement | null;
        if (detail?.dataset.detail !== undefined && !show) detail.style.display = 'none';
    });
    // A section whose rows are all filtered out folds its count, not the user's place.
    body.querySelectorAll<HTMLElement>('.crashmgr-group').forEach((sec) => {
        const rows = [...sec.querySelectorAll<HTMLElement>('.crashmgr-row')];
        sec.hidden = !!_filter && rows.length > 0 && rows.every((r) => r.hidden);
    });
}

/**
 * Laya's answer in a report's Analyze panel: family and cause with the confidence, the next
 * step, and the evidence (keywords, log lines). All of it text: the words are fixed
 * translations, the evidence comes from the masked excerpt and is escaped.
 */
function mountCause(detail: HTMLElement, path: string): void {
    detail.querySelector('[data-laya-cause-card]')?.remove();
    const c = causeOf(_labels.get(path));
    if (!c) return;
    const ev = _evidence.get(path) || { words: [], lines: [] };
    const hasEv = ev.words.length > 0 || ev.lines.length > 0;
    const box = document.createElement('div');
    box.className = 'laya-explain';
    box.dataset.layaCauseCard = '';
    const evidence = c.id === 'unknown' ? '' : hasEv
        ? `<div class="ai-muted">${escHtml(t('crashmgr.laya.evidence'))}</div>`
            + (ev.words.length ? `<div class="laya-crash-chips">${ev.words.map((w) => `<span class="laya-chip">${escHtml(w)}</span>`).join('')}</div>` : '')
            + (ev.lines.length ? `<pre class="crashmgr-pre">${escHtml(ev.lines.join('\n'))}</pre>` : '')
        : `<div class="ai-muted">${escHtml(t('crashmgr.laya.noEvidence'))}</div>`;
    box.innerHTML = `
      <div class="laya-crash-head">
        <span class="laya-fb-title">${escHtml(t('crashmgr.laya.causeTitle'))}</span>
        <span class="laya-chip">${escHtml(familyWord(c.family))}</span>
        <span class="laya-chip${c.uncertain ? ' is-guess' : ''}">${escHtml(causeWord(c.id))}${c.p != null ? ` · ${pct(c.p)} %` : ''}${c.uncertain ? ` · ${escHtml(t('ai.lt.guessBadge'))}` : ''}</span>
      </div>
      <p class="laya-explain-text">${escHtml(t('crashmgr.laya.stepLine', { step: stepWord(c.id) }))}</p>
      ${evidence}`;
    detail.prepend(box);
}

/** A report's Analyze panel: Laya's cause card (once labelled), and « Expliquer » when a generator is configured. */
export function mountDetail(detail: HTMLElement, path: string): void {
    mountExplain(detail, path);
    mountCause(detail, path);
}

/** « Expliquer » in a report's Analyze panel, when a generator is configured. */
export function mountExplain(detail: HTMLElement, path: string): void {
    if (!_explain.on || detail.querySelector('[data-laya-explain]')) return;
    const box = document.createElement('div');
    box.className = 'laya-explain';
    box.innerHTML = `<button type="button" class="btn btn-xs btn-ghost" data-laya-explain>${escHtml(_explain.remote ? t('crashmgr.laya.explainRemote') : t('crashmgr.laya.explain'))}</button>
      <div class="laya-explain-out" data-laya-explain-out aria-live="polite"></div>`;
    detail.prepend(box);
    box.querySelector('[data-laya-explain]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const out = box.querySelector<HTMLElement>('[data-laya-explain-out]');
        btn.disabled = true;
        if (out) out.textContent = t('ai.suggest.loading');
        try {
            const r: any = await invoke('ai_crash_explain', { path });
            // Model output is untrusted: B.MD's untrusted path, nothing that fetches (laya-explain-md.ts).
            const { paintExplain } = await import('./laya-explain-md.js');
            if (out) {
                out.innerHTML = `<div class="laya-explain-md"></div>`
                    + `<p class="ai-muted">${escHtml(t('crashmgr.laya.explainNote', { model: String(r?.model || '') }))}</p>`;
                const md = out.querySelector<HTMLElement>('.laya-explain-md');
                if (md) paintExplain(md, String(r?.text || ''));
            }
        } catch (err) {
            if (out) out.textContent = reasonText(String((err as Error)?.message || err));
        } finally { btn.disabled = false; }
    });
}
