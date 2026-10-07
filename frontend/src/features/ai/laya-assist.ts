// laya-assist.ts — Laya in the feedback dialog (suggestion · bug · crash), while the report is
// being written.
//
// What it proposes: the kind of report, its category and severity, the part of the app it is
// about, a few tags, an earlier report it may repeat, and — for a crash — the crash report on
// this PC that fits the description. Each is a row with « Appliquer » / « Ignorer »: nothing is
// changed until the user clicks, and what was accepted is listed (and removable) above Send.
// Accepted labels travel with the report as `meta.laya`; nothing else does.
//
// When it runs:
//   · never with the master switch off (the panel is not even drawn) — Rust refuses anyway;
//   · while typing (debounced) only when nothing leaves the PC: the built-in engine, or the
//     user's own laya-serve on this machine;
//   · otherwise on the user's click, the report masked first (`ai_report_precheck`), exactly
//     like the existing « hint » before sending.
// The duplicate check is local and always on while the panel is shown: the report history
// stays on this PC.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { pct } from './ai-model.js';
import { ensureAiCss, loadAiView, reasonText, bcAuthArgs, offerInstall, installPromptHtml, wireInstallPrompt, type AiView } from './ai-shared.js';
import {
    proposalsFrom, pending, accept, unaccept, metaOf, likelyDuplicates, bestCrashFor, autoAssist,
    type Accepted, type Proposal, type ProposalField, type CrashDigest, type Triage, type LayaDecision,
} from './laya-assist-model.js';
import { kindWord, areaWord, categoryWord, severityWord } from './laya-words.js';

export interface AssistHost {
    kind: () => string;
    setKind: (k: string) => void;
    text: () => { title: string; desc: string; steps: string[] };
    crashes: string[];
    attached: () => string[];
    attach: (path: string) => void;
}

let _acc: Accepted = { tags: [] };
let _seen = new Set<string>();
let _props: Proposal[] = [];
let _digests: CrashDigest[] | null = null;
let _timer: number | undefined;
let _runId = 0;
let _lastText = '';

/** A new dialog: forget what was accepted, dismissed and proposed. */
export function resetReportAssist(): void {
    _acc = { tags: [] }; _seen = new Set(); _props = []; _digests = null; _lastText = '';
    if (_timer) window.clearTimeout(_timer);
}

/** `meta.laya` for the report being sent (only what the user accepted), or null. */
export function reportAssistMeta(): Accepted | null { return metaOf(_acc); }

function history(): any[] {
    try { const h = JSON.parse(localStorage.getItem('bmm_report_history') || '[]'); return Array.isArray(h) ? h : []; } catch { return []; }
}

function valueWord(field: ProposalField, v: string): string {
    switch (field) {
        case 'kind': return kindWord(v);
        case 'area': return areaWord(v);
        case 'category': return categoryWord(v);
        case 'severity': return severityWord(v);
        default: return v;
    }
}

function fieldWord(field: ProposalField): string {
    switch (field) {
        case 'kind': return t('laya.fb.fKind');
        case 'category': return t('laya.fb.fCategory');
        case 'severity': return t('laya.fb.fSeverity');
        case 'area': return t('laya.fb.fArea');
        case 'tag': return t('laya.fb.fTag');
        case 'duplicate': return t('laya.fb.fDuplicate');
        case 'attach': return t('laya.fb.fAttach');
        default: return field;
    }
}

function confText(p: Proposal): string {
    const bits: string[] = [];
    if (p.p != null) bits.push(`${pct(p.p)} %`);
    if (p.uncertain) bits.push(t('ai.lt.guessBadge'));
    return bits.length ? ` <span class="laya-fb-conf">(${escHtml(bits.join(' · '))})</span>` : '';
}

function rowHtml(p: Proposal): string {
    const shown = p.field === 'duplicate' || p.field === 'attach' ? (p.detail || p.value) : valueWord(p.field, p.value);
    return `<li class="laya-fb-row${p.uncertain ? ' is-guess' : ''}" data-pid="${escHtml(p.id)}">
        <span class="laya-fb-what"><span class="laya-fb-field">${escHtml(fieldWord(p.field))}</span> <b>${escHtml(shown)}</b>${confText(p)}</span>
        <span class="laya-fb-acts">
          <button type="button" class="btn btn-xs btn-accent" data-laya-ok="${escHtml(p.id)}">${escHtml(t('laya.fb.apply'))}</button>
          <button type="button" class="btn btn-xs btn-ghost" data-laya-no="${escHtml(p.id)}">${escHtml(t('laya.fb.ignore'))}</button>
        </span>
      </li>`;
}

function acceptedHtml(): string {
    const chips: Array<[ProposalField, string, string]> = [];
    if (_acc.category) chips.push(['category', _acc.category, categoryWord(_acc.category)]);
    if (_acc.severity) chips.push(['severity', _acc.severity, severityWord(_acc.severity)]);
    if (_acc.area) chips.push(['area', _acc.area, areaWord(_acc.area)]);
    for (const tag of _acc.tags) chips.push(['tag', tag, tag]);
    if (_acc.related) chips.push(['duplicate', _acc.related, _acc.related]);
    if (!chips.length) return '';
    return `<div class="laya-fb-accepted"><span class="ai-muted">${escHtml(t('laya.fb.accepted'))}</span>
      ${chips.map(([f, v, w]) => `<span class="laya-chip">${escHtml(fieldWord(f))}: ${escHtml(w)}<button type="button" class="laya-chip-x" data-laya-rm="${escHtml(f)}" data-v="${escHtml(v)}" aria-label="${escHtml(t('common.remove'))}">×</button></span>`).join('')}</div>`;
}

function draw(box: HTMLElement): void {
    const list = pending(_props, _seen);
    const rows = box.querySelector<HTMLElement>('[data-laya-rows]');
    if (rows) rows.innerHTML = list.length ? `<ul class="laya-fb-list">${list.map(rowHtml).join('')}</ul>` : '';
    const acc = box.querySelector<HTMLElement>('[data-laya-acc]');
    if (acc) acc.innerHTML = acceptedHtml();
}

function say(box: HTMLElement, msg: string): void {
    const s = box.querySelector<HTMLElement>('[data-laya-status]');
    if (s) s.textContent = msg;
}

/** Local proposals that need no model: an earlier report, the crash zip that fits. */
function localProposals(host: AssistHost): Proposal[] {
    const { title, desc } = host.text();
    const out: Proposal[] = [];
    for (const d of likelyDuplicates(title, desc, host.kind(), history())) {
        const label = String(d.entry.title || '').slice(0, 120);
        const ref = String(d.entry.id && d.entry.id !== 'N/A' ? d.entry.id : label);
        out.push({ id: `duplicate:${ref}`, field: 'duplicate', value: ref, p: d.score, uncertain: false, detail: `${label} (${String(d.entry.date || '').slice(0, 10)})` });
    }
    if (host.kind() === 'crash' && _digests) {
        const best = bestCrashFor(`${title} ${desc}`, _digests, host.attached());
        if (best) out.push({ id: `attach:${best.path}`, field: 'attach', value: best.path, p: null, uncertain: false, detail: best.path.split(/[\\/]/).pop() || best.path });
    }
    return out;
}

async function ask(box: HTMLElement, host: AssistHost, view: AiView | null, auto: boolean): Promise<void> {
    const run = ++_runId;
    const { title, desc, steps } = host.text();
    const raw = `${title}\n${desc}\n${steps.join('\n')}`.trim();
    if (raw.length < 20) { _props = localProposals(host); draw(box); return; }
    say(box, t('ai.suggest.loading'));
    // Masked before it goes anywhere (every secret BMM holds, user folders, e-mails, IPs…).
    let text = raw;
    try { text = String(((await invoke('ai_report_precheck', { text: raw })) as any)?.text ?? raw); } catch { /* Rust masks again */ }
    const known = history().slice(0, 8).map((h) => String(h?.title || '')).filter(Boolean);
    const [tr, as] = await Promise.all([
        invoke('ai_triage_report', { text, known, ...(await bcAuthArgs(view?.settings)) }).then((r: any) => r?.triage as Triage).catch((e) => { if (!auto) say(box, reasonText(String((e as Error)?.message || e))); return null; }),
        // Kind and area: the built-in engine or the user's own laya-serve only.
        autoAssist(view?.settings as any) || view?.settings?.classifier === 'local'
            ? invoke('ai_report_assist', { text }).then((r: any) => r as { kind?: LayaDecision; area?: LayaDecision }).catch(() => null)
            : Promise.resolve(null),
    ]);
    if (run !== _runId) return;
    if (tr && typeof tr.duplicate_of === 'number' && known[tr.duplicate_of]) {
        const v = known[tr.duplicate_of];
        _props = [{ id: `duplicate:${v}`, field: 'duplicate', value: v, p: tr.show_probs !== false && tr.duplicate_p != null ? Number(tr.duplicate_p) : null, uncertain: false, detail: v }];
    } else _props = [];
    _props = [...proposalsFrom(tr, as, { kind: host.kind(), accepted: _acc }, raw), ..._props, ...localProposals(host)];
    draw(box);
    const any = pending(_props, _seen).length > 0;
    say(box, tr || as ? (any ? '' : t('laya.fb.nothing')) : (box.querySelector('[data-laya-status]')?.textContent || ''));
}

/**
 * Draw the panel into `box` (the dialog's « #fbm-laya ») and wire it. Hidden, and inert, when
 * the master switch is off or no classifier is set and none can be installed.
 */
export async function mountReportAssist(box: HTMLElement, host: AssistHost): Promise<void> {
    ensureAiCss();
    const view = await loadAiView();
    const s = view?.settings;
    if (!s || !s.enabled || view?.status?.killSwitch) { box.hidden = true; return; }
    const install = offerInstall(view);
    const usable = !install && (s.classifier === 'embedded' || s.classifier === 'local' || (s.classifier === 'bettercommunity' && s.bc_consent)) && s.report_triage !== false;
    if (!usable && !install) { box.hidden = true; return; }
    const auto = autoAssist(s as any);
    box.hidden = false;
    box.className = 'laya-fb';
    box.innerHTML = `
      <div class="laya-fb-head">
        <span class="laya-fb-title">${escHtml(t('laya.fb.title'))}</span>
        <span class="ai-muted">${escHtml(auto ? t('laya.fb.subAuto') : t('laya.fb.subClick'))}</span>
        ${usable && !auto ? `<button type="button" class="btn btn-ghost btn-xs" data-laya-ask>${escHtml(t('laya.fb.ask'))}</button>` : ''}
      </div>
      ${install ? installPromptHtml(view) : ''}
      <div data-laya-rows></div>
      <div data-laya-acc></div>
      <div class="ai-muted" data-laya-status aria-live="polite"></div>`;
    wireInstallPrompt(box, () => { void mountReportAssist(box, host); });
    // The crash reports' masked excerpts, for « attach the one that fits » (local, gated).
    if (host.crashes.length && _digests === null) {
        invoke('ai_crash_digests', { paths: host.crashes.slice(0, 12) })
            .then((r: any) => { _digests = Array.isArray(r?.items) ? r.items : []; })
            .catch(() => { _digests = []; });
    }
    box.querySelector('[data-laya-ask]')?.addEventListener('click', () => { void ask(box, host, view, false); });
    box.addEventListener('click', (e) => {
        const el = e.target as HTMLElement;
        const ok = el.closest<HTMLElement>('[data-laya-ok]');
        const no = el.closest<HTMLElement>('[data-laya-no]');
        const rm = el.closest<HTMLElement>('[data-laya-rm]');
        if (ok) {
            const p = _props.find((x) => x.id === ok.dataset.layaOk);
            if (!p) return;
            _seen.add(p.id);
            if (p.field === 'kind') host.setKind(p.value);
            else if (p.field === 'attach') host.attach(p.value);
            else _acc = accept(_acc, p);
            draw(box);
        } else if (no) {
            _seen.add(String(no.dataset.layaNo));
            draw(box);
        } else if (rm) {
            const f = rm.dataset.layaRm as ProposalField;
            const v = String(rm.dataset.v || '');
            _acc = unaccept(_acc, f, v);
            _seen.delete(`${f}:${v}`);
            draw(box);
        }
    });
    if (!usable) return;
    // While typing: local proposals at once (no model), Laya after a pause — only when nothing
    // leaves this PC.
    const form = box.closest('.fbm') || document;
    const onInput = () => {
        if (_timer) window.clearTimeout(_timer);
        _timer = window.setTimeout(() => {
            const { title, desc } = host.text();
            const now = `${title}\n${desc}`;
            if (now === _lastText) return;
            _lastText = now;
            if (auto && desc.trim().length >= 40) void ask(box, host, view, true);
            else { _props = [..._props.filter((p) => p.field !== 'duplicate' && p.field !== 'attach'), ...localProposals(host)]; draw(box); }
        }, 1200);
    };
    form.querySelector('#fbm-title')?.addEventListener('input', onInput);
    form.querySelector('#fbm-desc')?.addEventListener('input', onInput);
    draw(box);
}

