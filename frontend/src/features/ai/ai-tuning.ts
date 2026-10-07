// ai-tuning.ts — the « Réponses » tab of the Laya dialog (laya-hub.ts).
//
// How sure Laya must be before BMM shows or uses an answer, per feature; the user's own tasks
// (labels with a description and examples); a « Tester » box; import / export / reset. Short on
// purpose: one preset row with one line under it, and everything else behind expanders.
//
// Rust decides (commands/ai_tuning.rs): it validates every save and applies the settings at
// each AI call. This card edits a copy and sends it to `ai_laya_save`.
import { invoke, askConfirm } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { ensureAiCss, reasonText } from './ai-shared.js';
import { initCollapsibleSettingsCards } from '../../ui/settings-fold.js';
import {
    AREAS, PRESETS, SOURCES, ACTIONS, REPORT_CATEGORIES, RANGES, LIMITS,
    normConfig, normTuning, storedFor, effective, withPreset, setOverride, parseExamples, examplesText,
    newTask, taskProblem, forSave, exportText, parseImport, bars, summary, usedLabels,
    type Area, type LayaConfig, type PresetTable, type Tuning, type CustomTask, type LabelDef, type Preset,
} from './ai-tuning-model.js';
import { uiIcon } from '../../ui/icons.js';

const CARD_ID = 'laya-tuning-card';
/** « Mes tâches », its own tab: the same draft, rendered into a second card. */
const TASKS_ID = 'laya-tasks-card';

interface View { config: any; presets: PresetTable; limits?: any }

let _draft: LayaConfig | null = null;
let _presets: PresetTable = {};
let _area: Area | 'global' = 'global';
let _edit: number = -1;          // the task being edited (-1: none)
let _hintKind: 'tags' | 'triage' = 'tags';
let _tags: { id: string; name: string }[] = [];
let _dirty = false;

function ensureCss(): void {
    ensureAiCss();
    if (typeof document === 'undefined' || document.getElementById('ai-tuning-css')) return;
    const link = document.createElement('link');
    link.id = 'ai-tuning-css';
    link.rel = 'stylesheet';
    link.href = 'css/ai-tuning.css';
    document.head.appendChild(link);
}

const presetName = (p: Preset): string => t(`ai.lt.preset.${p}`);
const presetHint = (p: Preset): string => t(`ai.lt.presetHint.${p}`);
const areaName = (a: Area | 'global'): string => t(`ai.lt.area.${a}`);
const sourceName = (s: string): string => t(`ai.lt.src.${s}`);
const actionName = (a: string): string => t(`ai.lt.act.${a}`);

/** A Rust key (« laya.cfg.badMargin », « laya.cfg.tooLong|task ») in words. */
function errText(raw: string): string {
    const key = String(raw || '').split('|')[0];
    if (key.startsWith('laya.') || key.startsWith('ai.task.')) {
        const s = t(key);
        if (s !== key) return s;
    }
    return reasonText(raw);
}

/** Put the card (once) in `host` — a pane of the Laya dialog (laya-hub.ts) — then fill it. */
export async function mountLayaTuning(host: HTMLElement, tasksHost?: HTMLElement): Promise<void> {
    ensureCss();
    let card = document.getElementById(CARD_ID);
    if (!card) {
        card = document.createElement('div');
        card.className = 'ai-card laya-pane-card lt-card';
        card.id = CARD_ID;
        host.appendChild(card);
    }
    if (!document.getElementById(TASKS_ID)) {
        const tc = document.createElement('div');
        tc.className = 'ai-card laya-pane-card lt-card lt-tasks-card';
        tc.id = TASKS_ID;
        (tasksHost || host).appendChild(tc);
    }
    await load();
    render(card);
    if (!(card as any)._ltWired) {
        (card as any)._ltWired = true;
        document.addEventListener('langChanged', () => { if (card?.isConnected) render(card as HTMLElement); });
    }
}

async function load(): Promise<void> {
    try {
        const v = await invoke('ai_laya_get') as View;
        _draft = normConfig(v?.config);
        _presets = v?.presets || {};
    } catch {
        _draft = null;
    }
    try {
        const tags: any = await invoke('get_tags');
        _tags = Array.isArray(tags) ? tags.map((x: any) => ({ id: String(x?.id ?? ''), name: String(x?.name ?? '') })).filter((x) => x.name) : [];
    } catch { _tags = []; }
    _dirty = false;
}

function refold(): void {
    try { initCollapsibleSettingsCards(); } catch { /* no Settings view */ }
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** The card's own words for its header: a title, the pill the hub reads, one line. */
function headHtml(title: string, pillId: string, pill: string, lead: string): string {
    return `<header class="laya-page-h">
        <h3 class="card-title ai-card-title"><span>${escHtml(title)}</span>
          <span class="ai-pill" id="${pillId}">${escHtml(pill)}</span></h3>
        <p class="ai-muted lt-lead">${escHtml(lead)}</p>
      </header>`;
}

function render(card: HTMLElement): void {
    const tasksCard = document.getElementById(TASKS_ID);
    const openIds = [card, tasksCard].flatMap((c) => c ? [...c.querySelectorAll('details[open]')].map((d) => d.id) : []).filter(Boolean);
    if (!_draft) {
        card.innerHTML = `<h3 class="card-title ai-card-title"><span>${escHtml(t('ai.hub.tabAnswers'))}</span></h3><p class="ai-muted">${escHtml(t('ai.settings.unavailable'))}</p>`;
        if (tasksCard) tasksCard.innerHTML = `<h3 class="card-title ai-card-title"><span>${escHtml(t('ai.lt.tasks'))}</span></h3><p class="ai-muted">${escHtml(t('ai.settings.unavailable'))}</p>`;
        refold();
        return;
    }
    const cfg = _draft;
    const sum = summary(cfg);
    const stored = storedFor(cfg, _area);
    const own = _area !== 'global' && !!cfg.features[_area];
    const locked = _area !== 'global' && !own;
    const eff = _area === 'global' ? stored : effective(cfg, _area, _presets);
    const pill = presetName(sum.preset) + (sum.overrides ? ` · ${t('ai.hub2.nOwn', { n: String(sum.overrides) })}` : '');
    const nOn = cfg.tasks.filter((x) => x.enabled).length;
    const tasksPill = sum.tasks ? t('ai.hub2.tasksPill', { n: String(sum.tasks), on: String(nOn) }) : t('ai.hub2.noTasksPill');
    const areaOpts = (['global', ...AREAS] as (Area | 'global')[]).map((a) => `<option value="${a}"${a === _area ? ' selected' : ''}>${escHtml(areaName(a))}</option>`).join('');
    card.innerHTML = `
      ${headHtml(t('ai.hub.tabAnswers'), 'lt-pill', pill, t('ai.lt.lead'))}
      <section class="laya-sec" aria-labelledby="lt-style-h">
        <header class="laya-sec-h laya-sec-h--row">
          <h4 class="laya-sec-title" id="lt-style-h">${escHtml(t('ai.hub2.styleTitle'))}</h4>
          <div class="lt-row">
            <label class="ai-lbl" for="lt-area">${escHtml(t('ai.lt.for'))}</label>
            <select id="lt-area" class="form-input lt-area">${areaOpts}</select>
          </div>
        </header>
        ${_area !== 'global' ? `<label class="ai-check"><input type="checkbox" id="lt-own" ${own ? 'checked' : ''}> <span>${escHtml(t('ai.lt.own'))}</span></label>` : ''}
        <fieldset class="lt-fs" ${locked ? 'disabled' : ''}>
          <div class="lt-presets" role="radiogroup" aria-labelledby="lt-style-h">
            ${PRESETS.map((p) => `<button type="button" class="lt-chip${stored.preset === p ? ' is-on' : ''}" role="radio" aria-checked="${stored.preset === p}" data-preset="${p}"><span class="lt-chip-name">${escHtml(presetName(p))}</span><span class="lt-chip-hint">${escHtml(presetHint(p))}</span></button>`).join('')}
          </div>
          <p class="ai-muted lt-hint" id="lt-preset-hint">${escHtml(locked ? t('ai.lt.followsGlobal') : '')}</p>
          <details class="ai-more" id="lt-fine"${stored.preset === 'custom' ? ' open' : ''}>
            <summary>${escHtml(t('ai.hub2.fineAdv'))}</summary>
            ${fineHtml(stored.preset === 'custom' ? stored : eff)}
          </details>
        </fieldset>
      </section>
      <details class="ai-more" id="lt-test"><summary>${escHtml(t('ai.lt.test'))}</summary>${testHtml(cfg)}</details>
      <details class="ai-more" id="lt-hints"><summary>${escHtml(t('ai.lt.hints'))}</summary>${hintsHtml(cfg)}</details>
      <details class="ai-more" id="lt-adv"><summary>${escHtml(t('ai.hub2.ltAdvanced'))}</summary>
        <label class="ai-check"><input type="checkbox" id="lt-programs" ${cfg.allow_program_changes ? 'checked' : ''}> <span>${escHtml(t('ai.lt.programs'))}</span></label>
        <p class="ai-muted">${escHtml(t('ai.hub2.ltFileLead'))}</p>
        <div class="ai-actions lt-file">
          <button type="button" class="btn btn-ghost btn-sm" id="lt-export">${escHtml(t('ai.lt.export'))}</button>
          <button type="button" class="btn btn-ghost btn-sm lt-import" id="lt-import-btn">${escHtml(t('ai.lt.import'))}</button><input type="file" id="lt-import" accept=".json,application/json" hidden>
          <button type="button" class="btn btn-ghost btn-sm lt-reset" id="lt-reset">${escHtml(t('ai.lt.reset'))}</button>
        </div>
      </details>
      <div class="ai-actions">
        <span class="ai-muted" id="lt-status" aria-live="polite">${_dirty ? escHtml(t('ai.lt.unsaved')) : ''}</span>
        <button type="button" class="btn btn-primary btn-sm" id="lt-save">${escHtml(t('common.save'))}</button>
      </div>`;
    if (tasksCard) {
        tasksCard.innerHTML = `
          ${headHtml(t('ai.lt.tasks'), 'lt-tasks-pill', tasksPill, t('ai.lt.tasksLead'))}
          <section class="laya-sec" id="lt-tasks">${tasksHtml(cfg)}</section>
          <div class="ai-actions">
            <span class="ai-muted" id="lt-tasks-status" aria-live="polite">${_dirty ? escHtml(t('ai.lt.unsaved')) : ''}</span>
            <button type="button" class="btn btn-primary btn-sm" id="lt-tasks-save">${escHtml(t('common.save'))}</button>
          </div>`;
    }
    for (const id of openIds) (card.querySelector<HTMLDetailsElement>('#' + id) || tasksCard?.querySelector<HTMLDetailsElement>('#' + id))?.setAttribute('open', '');
    wire(card);
    refold();
}

function pct(v: number): string { return `${Math.round(v * 100)} %`; }

function fineHtml(tu: Tuning): string {
    const range = (k: keyof typeof RANGES, v: number, fmt: (v: number) => string) => {
        const r = RANGES[k];
        return `<label class="ai-lbl" for="lt-${k}">${escHtml(t(`ai.lt.f.${k}`))}</label>
          <span class="lt-range"><input type="range" id="lt-${k}" data-num="${k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}">
          <output for="lt-${k}" id="lt-${k}-v">${escHtml(fmt(v))}</output></span>
          <small class="lt-fhint">${escHtml(t(`ai.lt.fh.${k}`))}</small>`;
    };
    return `
      <div class="lt-grid">
        ${range('threshold', tu.threshold, pct)}
        ${range('margin', tu.margin, pct)}
        ${range('temperature', tu.temperature, (v) => v.toFixed(2))}
        ${range('top_k', tu.top_k, (v) => String(v))}
        ${range('max_labels', tu.max_labels, (v) => String(v))}
        <label class="ai-lbl" for="lt-abstain">${escHtml(t('ai.lt.f.abstain'))}</label>
        <select id="lt-abstain" class="form-input">
          <option value="unknown"${tu.abstain === 'unknown' ? ' selected' : ''}>${escHtml(t('ai.lt.abstain.unknown'))}</option>
          <option value="flag"${tu.abstain === 'flag' ? ' selected' : ''}>${escHtml(t('ai.lt.abstain.flag'))}</option>
        </select>
        <small class="lt-fhint"></small>
      </div>
      <label class="ai-check"><input type="checkbox" data-bool="multi_label" ${tu.multi_label ? 'checked' : ''}> <span>${escHtml(t('ai.lt.f.multi'))}</span></label>
      <label class="ai-check"><input type="checkbox" data-bool="show_probs" ${tu.show_probs ? 'checked' : ''}> <span>${escHtml(t('ai.lt.f.show'))}</span></label>
      <label class="ai-check"><input type="checkbox" data-bool="auto_apply" ${tu.auto_apply ? 'checked' : ''}> <span>${escHtml(t('ai.lt.f.auto'))}</span></label>`;
}

function tasksHtml(cfg: LayaConfig): string {
    const rows = cfg.tasks.map((tk, i) => `
      <div class="lt-task${tk.enabled ? '' : ' is-off'}" data-i="${i}">
        <label class="lt-task-on" title="${escAttr(t('ai.lt.taskOn'))}"><input type="checkbox" data-task-on="${i}" ${tk.enabled ? 'checked' : ''} aria-label="${escAttr(t('ai.lt.taskOn'))}"></label>
        <span class="lt-task-name"><b>${escHtml(tk.name || tk.id)}</b><small>${escHtml(t('ai.lt.taskLine', { n: String(usedLabels(tk.labels).length), src: sourceName(tk.source), id: tk.id }))}</small></span>
        <span class="lt-task-btns">
          <button type="button" class="btn btn-ghost btn-xs" data-task-edit="${i}">${escHtml(t('ai.lt.edit'))}</button>
          ${tk.source.startsWith('mod_') ? `<button type="button" class="btn btn-ghost btn-xs" data-task-run="${i}">${escHtml(t('ai.lt.run'))}</button>` : ''}
          <button type="button" class="btn btn-ghost btn-xs" data-task-del="${i}" aria-label="${escAttr(t('ai.lt.delete'))}">${escHtml(t('ai.lt.delete'))}</button>
        </span>
      </div>
      ${_edit === i ? taskEditorHtml(tk, i) : ''}`).join('');
    return `
      <div class="lt-tasks">${rows || `<p class="ai-muted lt-empty">${escHtml(t('ai.lt.noTasks'))}</p>`}</div>
      <div class="ai-actions"><button type="button" class="btn btn-ghost btn-sm" id="lt-task-new" ${cfg.tasks.length >= LIMITS.tasks ? 'disabled' : ''}>${escHtml(t('ai.lt.newTask'))}</button></div>
      <div class="lt-run" id="lt-run" aria-live="polite"></div>`;
}

function labelRowsHtml(labels: LabelDef[], scope: string, fixedIds = false): string {
    return labels.map((l, j) => `
      <div class="lt-label" data-scope="${scope}" data-j="${j}">
        ${fixedIds ? `<span class="lt-label-id">${escHtml(l.id)}</span>` : `<input class="form-input lt-l-id" data-f="id" value="${escAttr(l.id)}" maxlength="${LIMITS.labelId}" placeholder="${escAttr(t('ai.lt.ph.label'))}" aria-label="${escAttr(t('ai.lt.ph.label'))}" spellcheck="false">`}
        <input class="form-input lt-l-desc" data-f="description" value="${escAttr(l.description)}" maxlength="${LIMITS.description}" placeholder="${escAttr(t('ai.lt.ph.desc'))}" aria-label="${escAttr(t('ai.lt.ph.desc'))}">
        <input class="form-input lt-l-ex" data-f="examples" value="${escAttr(examplesText(l.examples))}" placeholder="${escAttr(t('ai.lt.ph.examples'))}" aria-label="${escAttr(t('ai.lt.ph.examples'))}">
        ${fixedIds ? '' : `<button type="button" class="btn btn-ghost btn-xs lt-l-del" data-l-del="${j}" aria-label="${escAttr(t('ai.lt.delLabel'))}">${uiIcon('delete', 14)}</button>`}
      </div>`).join('');
}

function taskEditorHtml(tk: CustomTask, i: number): string {
    const opt = (v: string, cur: string, label: string) => `<option value="${escAttr(v)}"${v === cur ? ' selected' : ''}>${escHtml(label)}</option>`;
    const problem = taskProblem(tk, _draft?.tasks || []);
    return `
      <div class="lt-editor" data-edit="${i}">
        <div class="lt-grid2">
          <label class="ai-lbl" for="lt-t-name">${escHtml(t('ai.lt.t.name'))}</label>
          <input id="lt-t-name" class="form-input" value="${escAttr(tk.name)}" maxlength="${LIMITS.taskName}">
          <label class="ai-lbl" for="lt-t-source">${escHtml(t('ai.lt.t.source'))}</label>
          <select id="lt-t-source" class="form-input">${SOURCES.map((s) => opt(s, tk.source, sourceName(s))).join('')}</select>
          <label class="ai-lbl" for="lt-t-action">${escHtml(t('ai.lt.t.action'))}</label>
          <select id="lt-t-action" class="form-input" ${tk.source.startsWith('mod_') ? '' : 'disabled'}>${ACTIONS.map((a) => opt(a, tk.action, actionName(a))).join('')}</select>
          <label class="ai-lbl" for="lt-t-template">${escHtml(t('ai.lt.t.question'))}</label>
          <input id="lt-t-template" class="form-input" value="${escAttr(tk.template)}" maxlength="${LIMITS.template}" placeholder="${escAttr(t('ai.lt.ph.question'))}">
        </div>
        <div class="ai-sub">${escHtml(t('ai.lt.t.labels'))}</div>
        <div class="lt-labels">${labelRowsHtml(tk.labels, 'task')}</div>
        <div class="ai-actions">
          <button type="button" class="btn btn-ghost btn-xs" id="lt-l-add" ${tk.labels.length >= LIMITS.labels ? 'disabled' : ''}>${escHtml(t('ai.lt.addLabel'))}</button>
        </div>
        <label class="ai-check"><input type="checkbox" id="lt-t-own" ${tk.tuning ? 'checked' : ''}> <span>${escHtml(t('ai.lt.t.own'))}</span></label>
        ${tk.tuning ? `<select id="lt-t-preset" class="form-input lt-small">${PRESETS.filter((p) => p !== 'custom').map((p) => opt(p, tk.tuning?.preset || 'balanced', presetName(p))).join('')}</select>` : ''}
        <p class="ai-muted lt-id">${escHtml(t('ai.lt.t.idLine', { id: tk.id }))}</p>
        ${problem ? `<p class="ai-err" id="lt-t-problem">${escHtml(errText(problem))}</p>` : ''}
        <div class="ai-actions"><button type="button" class="btn btn-primary btn-xs" id="lt-t-done">${escHtml(t('ai.lt.done'))}</button></div>
      </div>`;
}

function hintsHtml(cfg: LayaConfig): string {
    const isTags = _hintKind === 'tags';
    let rows: LabelDef[];
    if (isTags) {
        rows = _tags.map((tg) => cfg.labels.mod_tags.find((h) => h.id.toLowerCase() === tg.name.toLowerCase()) || { id: tg.name, description: '', examples: [] }).slice(0, LIMITS.hints);
    } else {
        rows = REPORT_CATEGORIES.map((c) => cfg.labels.triage.find((h) => h.id === c) || { id: c, description: '', examples: [] });
    }
    const tmpl = isTags ? cfg.labels.templates.mod_tags : cfg.labels.templates.triage;
    return `
      <p class="ai-muted">${escHtml(t('ai.lt.hintsLead'))}</p>
      <div class="lt-row">
        <select id="lt-hint-kind" class="form-input lt-small" aria-label="${escAttr(t('ai.lt.hints'))}">
          <option value="tags"${isTags ? ' selected' : ''}>${escHtml(t('ai.lt.hintTags'))}</option>
          <option value="triage"${!isTags ? ' selected' : ''}>${escHtml(t('ai.lt.hintTriage'))}</option>
        </select>
      </div>
      <input id="lt-hint-template" class="form-input" value="${escAttr(tmpl)}" maxlength="${LIMITS.template}" placeholder="${escAttr(t('ai.lt.ph.question'))}" aria-label="${escAttr(t('ai.lt.t.question'))}">
      <div class="lt-labels">${rows.length ? labelRowsHtml(rows, isTags ? 'tags' : 'triage', true) : `<p class="ai-muted lt-empty">${escHtml(t('ai.lt.noTags'))}</p>`}</div>`;
}

function testHtml(cfg: LayaConfig): string {
    const tasks = cfg.tasks.map((tk, i) => `<option value="${i}">${escHtml(tk.name || tk.id)}</option>`).join('');
    return `
      <div class="lt-row">
        <select id="lt-test-with" class="form-input lt-small" aria-label="${escAttr(t('ai.lt.testWith'))}">
          <option value="adhoc">${escHtml(t('ai.lt.testAdhoc'))}</option>${tasks}
        </select>
      </div>
      <input id="lt-test-labels" class="form-input" placeholder="${escAttr(t('ai.lt.ph.testLabels'))}" aria-label="${escAttr(t('ai.lt.ph.testLabels'))}" spellcheck="false">
      <textarea id="lt-test-text" class="form-input" rows="3" placeholder="${escAttr(t('ai.lt.ph.testText'))}" aria-label="${escAttr(t('ai.lt.ph.testText'))}"></textarea>
      <div class="ai-actions"><button type="button" class="btn btn-ghost btn-sm" id="lt-test-go">${escHtml(t('ai.lt.testGo'))}</button></div>
      <div class="lt-out" id="lt-test-out" aria-live="polite"></div>`;
}

/** The answer of a test or a run: the decision in words, then the percent bars. */
export function decisionHtml(r: any): string {
    const label = String(r?.label ?? 'none');
    const show = r?.showProbs !== false;
    const head = r?.abstained
        ? t('ai.lt.out.unknown', { why: t(`ai.lt.why.${r?.reason || 'none'}`) })
        : r?.uncertain ? t('ai.lt.out.guess', { label }) : t('ai.lt.out.answer', { label });
    const rows = bars(Array.isArray(r?.probabilities) ? r.probabilities : [], show);
    return `<div class="lt-verdict${r?.abstained ? ' is-unsure' : r?.uncertain ? ' is-guess' : ''}">${escHtml(head)}</div>
      ${rows.map((b) => `<div class="lt-bar" title="${escAttr(`${b.id} ${b.pct} %`)}"><span class="lt-bar-l">${escHtml(b.id === 'none' ? t('ai.lt.none') : b.id)}</span>
        <span class="lt-bar-t"><span class="lt-bar-f" style="width:${b.pct}%"></span></span><span class="lt-bar-v">${b.pct} %</span></div>`).join('')}`;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function wire(card: HTMLElement): void {
    const q = <T extends HTMLElement>(sel: string) => card.querySelector<T>(sel);
    const cfg = _draft as LayaConfig;
    const say = status;
    const changed = () => { _dirty = true; say(t('ai.lt.unsaved')); };
    const rerender = () => render(card);

    // Which feature is being tuned.
    q<HTMLSelectElement>('#lt-area')?.addEventListener('change', (e) => { _area = (e.target as HTMLSelectElement).value as Area | 'global'; rerender(); });
    q<HTMLInputElement>('#lt-own')?.addEventListener('change', (e) => {
        if (_area === 'global') return;
        _draft = setOverride(cfg, _area, (e.target as HTMLInputElement).checked);
        changed(); rerender();
    });

    const setTuning = (next: Tuning) => {
        if (!_draft) return;
        if (_area === 'global') _draft = { ..._draft, global: next };
        else _draft = { ..._draft, features: { ..._draft.features, [_area]: next } };
        changed();
    };
    const cur = (): Tuning => storedFor(_draft as LayaConfig, _area);

    card.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => {
        const p = b.dataset.preset as Preset;
        const now = _area === 'global' ? effective({ ...(cfg), features: {} }, 'tasks', _presets) : effective(cfg, _area, _presets);
        setTuning(withPreset(cur(), p, p === 'custom' ? (cur().preset === 'custom' ? cur() : now) : undefined));
        rerender();
    }));
    // Any number moved = « Personnalisé ».
    card.querySelectorAll<HTMLInputElement>('[data-num]').forEach((inp) => inp.addEventListener('input', () => {
        const k = inp.dataset.num as keyof Tuning;
        const v = Number(inp.value);
        const shown = card.querySelector('#lt-' + k + '-v');
        if (shown) shown.textContent = k === 'threshold' || k === 'margin' ? pct(v) : k === 'temperature' ? v.toFixed(2) : String(v);
        const base = cur().preset === 'custom' ? cur() : withPreset(cur(), 'custom', _area === 'global' ? cur() : effective(cfg, _area, _presets));
        setTuning(normTuning({ ...base, [k]: v, preset: 'custom' }));
        card.querySelectorAll('[data-preset]').forEach((c) => { const on = (c as HTMLElement).dataset.preset === 'custom'; c.classList.toggle('is-on', on); c.setAttribute('aria-checked', String(on)); });
    }));
    q<HTMLSelectElement>('#lt-abstain')?.addEventListener('change', (e) => {
        const base = cur().preset === 'custom' ? cur() : withPreset(cur(), 'custom', _area === 'global' ? cur() : effective(cfg, _area, _presets));
        setTuning({ ...base, abstain: (e.target as HTMLSelectElement).value === 'flag' ? 'flag' : 'unknown', preset: 'custom' });
        rerender();
    });
    card.querySelectorAll<HTMLInputElement>('[data-bool]').forEach((inp) => inp.addEventListener('change', () => {
        const k = inp.dataset.bool as 'multi_label' | 'show_probs' | 'auto_apply';
        // Showing the bars and auto-apply are preferences, not part of a preset.
        const base = k === 'multi_label' && cur().preset !== 'custom' ? withPreset(cur(), 'custom', _area === 'global' ? cur() : effective(cfg, _area, _presets)) : cur();
        setTuning({ ...base, [k]: inp.checked });
        if (k === 'multi_label') rerender();
    }));

    const tasksCard = document.getElementById(TASKS_ID);
    if (tasksCard) wireTasks(tasksCard, changed, rerender);
    tasksCard?.querySelector('#lt-tasks-save')?.addEventListener('click', () => void save(card));
    wireHints(card, changed, rerender);
    wireTest(card);

    q<HTMLInputElement>('#lt-programs')?.addEventListener('change', (e) => { if (_draft) _draft = { ..._draft, allow_program_changes: (e.target as HTMLInputElement).checked }; changed(); });
    q('#lt-save')?.addEventListener('click', () => void save(card));
    q('#lt-export')?.addEventListener('click', () => {
        if (!_draft) return;
        try {
            const blob = new Blob([exportText(_draft)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'bmm-laya-settings.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            say(t('ai.lt.exported'), 'ok');
        } catch (e) { say(errText(String((e as Error)?.message || e)), 'err'); }
    });
    q('#lt-import-btn')?.addEventListener('click', () => q<HTMLInputElement>('#lt-import')?.click());
    q<HTMLInputElement>('#lt-import')?.addEventListener('change', async (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = '';
        if (!f) return;
        if (f.size > LIMITS.bytes) { say(errText('laya.cfg.tooBig'), 'err'); return; }
        const r = parseImport(await f.text());
        if (!r.ok) { say(errText(r.error), 'err'); return; }
        // Rust checks it strictly and saves it; the screen shows what was stored.
        try {
            const v = await invoke('ai_laya_save', { config: r.value }) as View;
            _draft = normConfig(v?.config); _presets = v?.presets || _presets; _dirty = false; _edit = -1;
            render(card); status(t('ai.lt.imported'), 'ok');
        } catch (err) { say(errText(String((err as Error)?.message || err)), 'err'); }
    });
    q('#lt-reset')?.addEventListener('click', async () => {
        if (!(await askConfirm(t('ai.lt.resetConfirm')))) return;
        try {
            const v = await invoke('ai_laya_save', { config: { ...normConfig({}), allow_program_changes: false } }) as View;
            _draft = normConfig(v?.config); _presets = v?.presets || _presets; _dirty = false; _edit = -1; _area = 'global';
            render(card); status(t('ai.lt.resetDone'), 'ok');
        } catch (err) { say(errText(String((err as Error)?.message || err)), 'err'); }
    });
}

/** Both action rows (Answers, My tasks) say the same thing: they save the same draft. */
function status(msg: string, tone: '' | 'ok' | 'err' = ''): void {
    for (const id of ['lt-status', 'lt-tasks-status']) {
        const o = document.getElementById(id);
        if (o) { o.textContent = msg; o.className = `ai-muted${tone ? ` ai-${tone}` : ''}`; }
    }
}

async function save(card: HTMLElement): Promise<void> {
    if (!_draft) return;
    const bad = _draft.tasks.map((tk) => taskProblem(tk, _draft?.tasks || [])).find(Boolean);
    if (bad) { status(errText(bad), 'err'); return; }
    try {
        const v = await invoke('ai_laya_save', { config: forSave(_draft) }) as View;
        _draft = normConfig(v?.config); _presets = v?.presets || _presets; _dirty = false; _edit = -1;
        render(card);
        status(t('ai.lt.saved'), 'ok');
    } catch (e) {
        status(errText(String((e as Error)?.message || e)), 'err');
    }
}

function wireTasks(card: HTMLElement, changed: () => void, rerender: () => void): void {
    const cfg = () => _draft as LayaConfig;
    const setTask = (i: number, tk: CustomTask) => { const tasks = cfg().tasks.slice(); tasks[i] = tk; _draft = { ...cfg(), tasks }; changed(); };
    card.querySelector('#lt-task-new')?.addEventListener('click', () => {
        const tk = newTask(t('ai.lt.newTaskName'), cfg().tasks.map((x) => x.id));
        _draft = { ...cfg(), tasks: [...cfg().tasks, tk] };
        _edit = cfg().tasks.length - 1;
        changed(); rerender();
        card.querySelector<HTMLInputElement>('#lt-t-name')?.focus();
    });
    card.querySelectorAll<HTMLInputElement>('[data-task-on]').forEach((b) => b.addEventListener('change', () => {
        const i = Number(b.dataset.taskOn); setTask(i, { ...cfg().tasks[i], enabled: b.checked }); rerender();
    }));
    card.querySelectorAll<HTMLButtonElement>('[data-task-edit]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.taskEdit); _edit = _edit === i ? -1 : i; rerender(); }));
    card.querySelectorAll<HTMLButtonElement>('[data-task-del]').forEach((b) => b.addEventListener('click', async () => {
        const i = Number(b.dataset.taskDel);
        if (!(await askConfirm(t('ai.lt.deleteConfirm', { name: cfg().tasks[i]?.name || '' })))) return;
        _draft = { ...cfg(), tasks: cfg().tasks.filter((_, j) => j !== i) };
        _edit = -1; changed(); rerender();
    }));
    card.querySelectorAll<HTMLButtonElement>('[data-task-run]').forEach((b) => b.addEventListener('click', () => void runTask(card, Number(b.dataset.taskRun))));

    const ed = card.querySelector<HTMLElement>('.lt-editor');
    if (!ed) return;
    const i = Number(ed.dataset.edit);
    const tk = () => cfg().tasks[i];
    const field = <T extends HTMLElement>(id: string) => ed.querySelector<T>('#' + id);
    field<HTMLInputElement>('lt-t-name')?.addEventListener('input', (e) => setTask(i, { ...tk(), name: (e.target as HTMLInputElement).value }));
    field<HTMLInputElement>('lt-t-template')?.addEventListener('input', (e) => setTask(i, { ...tk(), template: (e.target as HTMLInputElement).value }));
    field<HTMLSelectElement>('lt-t-source')?.addEventListener('change', (e) => {
        const source = (e.target as HTMLSelectElement).value as CustomTask['source'];
        setTask(i, { ...tk(), source, action: source.startsWith('mod_') ? tk().action : 'none' }); rerender();
    });
    field<HTMLSelectElement>('lt-t-action')?.addEventListener('change', (e) => setTask(i, { ...tk(), action: (e.target as HTMLSelectElement).value as CustomTask['action'] }));
    field<HTMLInputElement>('lt-t-own')?.addEventListener('change', (e) => {
        setTask(i, { ...tk(), tuning: (e.target as HTMLInputElement).checked ? { ...storedFor(cfg(), 'tasks'), preset: 'balanced' } : null }); rerender();
    });
    field<HTMLSelectElement>('lt-t-preset')?.addEventListener('change', (e) => {
        const p = (e.target as HTMLSelectElement).value as Preset;
        setTask(i, { ...tk(), tuning: { ...(tk().tuning || storedFor(cfg(), 'tasks')), preset: p } });
    });
    ed.querySelectorAll<HTMLElement>('.lt-label').forEach((row) => {
        const j = Number(row.dataset.j);
        row.querySelectorAll<HTMLInputElement>('[data-f]').forEach((inp) => inp.addEventListener('input', () => {
            const labels = tk().labels.slice();
            const l = { ...labels[j] };
            if (inp.dataset.f === 'examples') l.examples = parseExamples(inp.value); else (l as any)[inp.dataset.f as string] = inp.value;
            labels[j] = l;
            setTask(i, { ...tk(), labels });
        }));
    });
    ed.querySelectorAll<HTMLButtonElement>('[data-l-del]').forEach((b) => b.addEventListener('click', () => {
        const j = Number(b.dataset.lDel); setTask(i, { ...tk(), labels: tk().labels.filter((_, k) => k !== j) }); rerender();
    }));
    field('lt-l-add')?.addEventListener('click', () => { setTask(i, { ...tk(), labels: [...tk().labels, { id: '', description: '', examples: [] }] }); rerender(); });
    field('lt-t-done')?.addEventListener('click', () => {
        const p = taskProblem(tk(), cfg().tasks);
        if (p) { rerender(); return; }
        _edit = -1; rerender();
    });
}

function wireHints(card: HTMLElement, changed: () => void, rerender: () => void): void {
    card.querySelector<HTMLSelectElement>('#lt-hint-kind')?.addEventListener('change', (e) => { _hintKind = (e.target as HTMLSelectElement).value === 'triage' ? 'triage' : 'tags'; rerender(); });
    card.querySelector<HTMLInputElement>('#lt-hint-template')?.addEventListener('input', (e) => {
        if (!_draft) return;
        const v = (e.target as HTMLInputElement).value;
        _draft = { ..._draft, labels: { ..._draft.labels, templates: { ..._draft.labels.templates, [_hintKind === 'tags' ? 'mod_tags' : 'triage']: v } } };
        changed();
    });
    card.querySelectorAll<HTMLElement>('#lt-hints .lt-label').forEach((row) => {
        const id = row.querySelector('.lt-label-id')?.textContent || '';
        row.querySelectorAll<HTMLInputElement>('[data-f]').forEach((inp) => inp.addEventListener('input', () => {
            if (!_draft) return;
            const key = _hintKind === 'tags' ? 'mod_tags' : 'triage';
            const list = _draft.labels[key].slice();
            let k = list.findIndex((h) => h.id.toLowerCase() === id.toLowerCase());
            if (k < 0) { list.push({ id, description: '', examples: [] }); k = list.length - 1; }
            const h = { ...list[k] };
            if (inp.dataset.f === 'examples') h.examples = parseExamples(inp.value); else h.description = inp.value;
            list[k] = h;
            _draft = { ..._draft, labels: { ..._draft.labels, [key]: list } };
            changed();
        }));
    });
}

function wireTest(card: HTMLElement): void {
    const withSel = card.querySelector<HTMLSelectElement>('#lt-test-with');
    const labelsIn = card.querySelector<HTMLInputElement>('#lt-test-labels');
    withSel?.addEventListener('change', () => { if (labelsIn) labelsIn.hidden = withSel.value !== 'adhoc'; });
    card.querySelector('#lt-test-go')?.addEventListener('click', async () => {
        const out = card.querySelector<HTMLElement>('#lt-test-out');
        const text = card.querySelector<HTMLTextAreaElement>('#lt-test-text')?.value || '';
        if (!out || !_draft) return;
        if (!text.trim()) { out.innerHTML = `<p class="ai-err">${escHtml(t('ai.task.noText'))}</p>`; return; }
        let labels: LabelDef[]; let template = ''; let tuning: Tuning;
        if (withSel && withSel.value !== 'adhoc') {
            const tk = _draft.tasks[Number(withSel.value)];
            labels = usedLabels(tk?.labels || []); template = tk?.template || '';
            tuning = tk?.tuning || storedFor(_draft, 'tasks');
        } else {
            labels = String(labelsIn?.value || '').split(',').map((s) => s.trim()).filter(Boolean).map((id) => ({ id, description: '', examples: [] }));
            tuning = storedFor(_draft, 'tasks');
        }
        if (labels.length < 2) { out.innerHTML = `<p class="ai-err">${escHtml(t('ai.task.labelsFew'))}</p>`; return; }
        out.innerHTML = `<p class="ai-muted">${escHtml(t('ai.lt.testing'))}</p>`;
        try {
            const r = await invoke('ai_laya_test', { text, labels, template, tuning });
            out.innerHTML = decisionHtml(r);
        } catch (e) { out.innerHTML = `<p class="ai-err">${escHtml(errText(String((e as Error)?.message || e)))}</p>`; }
    });
}

async function runTask(card: HTMLElement, i: number): Promise<void> {
    const out = card.querySelector<HTMLElement>('#lt-run');
    const tk = _draft?.tasks[i];
    if (!out || !tk) return;
    if (_dirty) { out.innerHTML = `<p class="ai-err">${escHtml(t('ai.lt.saveFirst'))}</p>`; return; }
    out.innerHTML = `<p class="ai-muted">${escHtml(t('ai.lt.running', { name: tk.name }))}</p>`;
    try {
        const r: any = await invoke('ai_laya_run_task', { taskId: tk.id });
        const items: any[] = Array.isArray(r?.items) ? r.items : [];
        const can = tk.action !== 'none';
        const rows = items.slice(0, 200).map((it, k) => {
            const labels: string[] = Array.isArray(it?.labels) ? it.labels.map((s: any) => String(s?.id ?? s)) : [];
            const ok = !it?.abstained && labels.length > 0;
            return `<div class="lt-res" data-k="${k}">
              <span class="lt-res-name">${escHtml(String(it?.name || it?.modId || ''))}</span>
              <span class="lt-res-ans${it?.abstained ? ' is-unsure' : it?.uncertain ? ' is-guess' : ''}">${escHtml(it?.abstained ? t('ai.lt.none') : labels.join(', '))}${r?.showProbs !== false && ok ? ` · ${Math.round((Number(it?.p) || 0) * 100)} %` : ''}</span>
              ${can && ok ? `<button type="button" class="btn btn-ghost btn-xs" data-apply="${k}">${escHtml(actionName(tk.action))}</button>` : ''}
            </div>`;
        }).join('');
        out.innerHTML = `<p class="ai-muted">${escHtml(t('ai.lt.ranLine', { n: String(items.length), total: String(r?.total ?? items.length) }))}</p>${rows}`;
        const apply = async (k: number, btn?: HTMLButtonElement | null) => {
            const it = items[k];
            const labels: string[] = Array.isArray(it?.labels) ? it.labels.map((s: any) => String(s?.id ?? s)) : [];
            try {
                await invoke('ai_laya_apply_task', { modId: it.modId, taskId: tk.id, labels });
                if (btn) { btn.disabled = true; btn.textContent = t('ai.lt.applied'); }
            } catch (e) { if (btn) btn.title = errText(String((e as Error)?.message || e)); }
        };
        out.querySelectorAll<HTMLButtonElement>('[data-apply]').forEach((b) => b.addEventListener('click', () => void apply(Number(b.dataset.apply), b)));
        // « Appliquer sans demander »: only answers that passed the threshold, never a flagged guess.
        if (r?.autoApply && can) {
            for (const b of out.querySelectorAll<HTMLButtonElement>('[data-apply]')) {
                const k = Number(b.dataset.apply);
                if (!items[k]?.uncertain) await apply(k, b);
            }
        }
    } catch (e) {
        out.innerHTML = `<p class="ai-err">${escHtml(errText(String((e as Error)?.message || e)))}</p>`;
    }
}
