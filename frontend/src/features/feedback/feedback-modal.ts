// feedback-modal.ts — the one dialog behind "Report a bug" and "Suggestion / Feedback".
//
// Built on demand, in BetterCommunity's own look: a kind selector (suggestion · bug · crash),
// what happened, what to attach (screenshots, crash zips, logs, DxDiag), who you are — and a
// Send that goes to the feedback centre through bc-feedback.ts. When links.json empties
// `feedback_endpoint`, the older BetaHub forms are opened instead, untouched.
import { invoke, pickFiles, pickFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { usesBetterCommunity, submitFeedback, fetchFeedbackConfig, testFeedbackEndpoint, textToBase64, explainFeedbackError, feedbackWebUrl, type FeedbackKind, type FeedbackAttachment } from './bc-feedback.js';

type Kind = FeedbackKind;
interface OpenOpts { crashZip?: string }

const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const base = (p: string): string => p.split(/[\\/]/).pop() || p;
const IC = {
    bug: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>',
    bulb: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
    crash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    send: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    image: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
    zip: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M4 22V4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2Z"/><path d="M10 12v-1"/><path d="M10 18v-2"/><path d="M10 7V6"/></svg>',
    x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    site: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
};

let _overlay: HTMLElement | null = null;
let _kind: Kind = 'bug';
let _shots: string[] = [];
let _zips: string[] = [];
let _steps: string[] = [''];
let _busy = false;
/**
 * Measured size of each picked file, in WIRE bytes (base64), keyed by path.
 *
 * Measured, not estimated: the budget shown has to be the budget enforced, and the thing that
 * gets refused is the encoded payload. Filled when a file is picked; a path that has not been
 * measured yet simply does not count towards the bar until it has.
 */
const _sizes = new Map<string, number>();

function overlay(): HTMLElement {
    if (_overlay) return _overlay;
    const o = document.createElement('div');
    o.className = 'modal-overlay fbm-overlay';
    o.id = 'modal-feedback';
    // Into the app FRAME, not <body>. The Tauri window is transparent and the app is a rounded
    // rectangle inset 40px from its top/left — the gap Tasky leans out of. A `.modal-overlay`
    // parked on <body> stays `position: fixed; inset: 0`, so its dim and the dialog's shadow
    // paint across that invisible margin: the shadow appears to float on nothing beside the
    // mascot, which is what "la shadow se met sur la partie invisible" is. Inside the frame,
    // mascot.css pins the overlay to the app rectangle and #app-window-outer's `contain: paint`
    // clips it at the rounded edge — the same thing every other hand-built overlay here does.
    (document.getElementById('app-window-outer') || document.body).appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o && !_busy) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && o.classList.contains('open') && !_busy) close(); });
    _overlay = o;
    return o;
}
function close(): void { _overlay?.classList.remove('open'); }

/** Open the dialog. `kind` picks the tab; a crash zip pre-attaches itself. */
export async function openFeedback(kind: Kind = 'bug', opts: OpenOpts = {}): Promise<void> {
    if (!usesBetterCommunity()) {
        // links.json says BetaHub: the older forms, untouched.
        const m = await import('../betahub/betahub-modals.js');
        if (kind === 'feedback') m.openFeedbackModal(); else m.openBugReportModal(opts.crashZip);
        return;
    }
    _kind = kind; _shots = []; _zips = opts.crashZip ? [opts.crashZip] : []; _steps = ['']; _busy = false;
    const [linked, crashes, cfg] = await Promise.all([
        invoke('has_bcweb_api_key').then((v) => !!v).catch(() => false),
        invoke('get_crash_reports').then((v) => (Array.isArray(v) ? (v as string[]) : [])).catch(() => [] as string[]),
        fetchFeedbackConfig(),
    ]);
    if (_kind === 'crash' && !_zips.length && crashes.length) _zips = [crashes[0]];
    render(linked, crashes, cfg);
    overlay().classList.add('open');
    requestAnimationFrame(() => (document.getElementById('fbm-title') as HTMLInputElement | null)?.focus());
}

function kindBtn(k: Kind, icon: string): string {
    return `<button type="button" class="fbm-kind${_kind === k ? ' is-on' : ''}" data-kind="${k}" role="tab" aria-selected="${_kind === k}">${icon}<span><b>${esc(t(`fbm.kind.${k}`))}</b><small>${esc(t(`fbm.kindHint.${k}`))}</small></span></button>`;
}

function render(linked: boolean, crashes: string[], cfg: Awaited<ReturnType<typeof fetchFeedbackConfig>>): void {
    const o = overlay();
    const offline = !cfg;
    const disabled = cfg && !cfg.enabled;
    const maxMB = cfg?.maxAttachMB ?? 25;
    const maxN = cfg?.maxAttachments ?? 6;
    const needContact = !linked && !!cfg?.requireContact;
    o.innerHTML = `
    <div class="modal fbm" role="dialog" aria-labelledby="fbm-heading">
        <div class="fbm-head">
            <span class="fbm-head-icon">${IC.site}</span>
            <div class="fbm-head-text">
                <h3 class="modal-title" id="fbm-heading">${esc(t('fbm.title'))}</h3>
                <div class="fbm-head-sub">${esc(t('fbm.sub'))}</div>
            </div>
            <button type="button" class="fbm-close" id="fbm-close" aria-label="${esc(t('common.close') || 'Close')}">${IC.x}</button>
        </div>
        <div class="fbm-main">
        <aside class="fbm-rail">
            ${offline ? `<div class="fbm-banner fbm-banner-warn">${esc(t('fbm.offline'))}</div>` : disabled ? `<div class="fbm-banner fbm-banner-warn">${esc(t('feedback.disabled'))}</div>` : ''}
            <div class="fbm-rail-lbl">${esc(t('fbm.kindPick'))}</div>
            <div class="fbm-kinds" role="tablist">${kindBtn('feedback', IC.bulb)}${kindBtn('bug', IC.bug)}${kindBtn('crash', IC.crash)}</div>
        </aside>
        <div class="fbm-body">
            <section class="fbm-sec">
                <div class="fbm-sec-title">${esc(t('fbm.what'))}</div>
                <label class="fbm-lbl" for="fbm-title">${esc(t('fbm.fTitle'))}</label>
                <input class="form-input fbm-input" id="fbm-title" maxlength="200" placeholder="${esc(t(`fbm.fTitlePh.${_kind}`))}">
                <label class="fbm-lbl" for="fbm-desc">${esc(t('fbm.fDesc'))} <span class="fbm-count" id="fbm-count">0</span></label>
                <textarea class="form-input fbm-input fbm-textarea" id="fbm-desc" rows="5" maxlength="6000" placeholder="${esc(t(`fbm.fDescPh.${_kind}`))}"></textarea>
            </section>

            <!-- Everything past "what happened" folds away.
                 All of it used to be open at once: steps, two attach buttons, the crash-zip
                 list, two long diagnostic checkboxes, two contact fields and a paragraph of
                 hint — a wall of controls in front of someone who came here to type one
                 sentence about a bug. Folded, the dialog asks for a title and a description
                 and nothing else; the rest is one line each, and each line SAYS what it holds
                 (fbm-fold-sum, kept live by updateSummaries) so folding never hides a
                 decision. Nothing was removed. -->
            <details class="fbm-fold" id="fbm-steps-wrap" ${_kind === 'feedback' ? 'hidden' : ''}>
                <summary><span class="fbm-fold-t">${esc(t('fbm.fSteps'))}</span><span class="fbm-fold-sum" id="fbm-steps-sum"></span></summary>
                <div class="fbm-fold-in">
                    <div id="fbm-steps"></div>
                    <button type="button" class="btn btn-ghost btn-xs" id="fbm-add-step">+ ${esc(t('fbm.addStep'))}</button>
                </div>
            </details>

            <details class="fbm-fold" id="fbm-attach-wrap">
                <summary><span class="fbm-fold-t">${esc(t('fbm.attachFold'))}</span><span class="fbm-fold-sum" id="fbm-attach-sum"></span></summary>
                <div class="fbm-fold-in">
                    <!-- Two DROP TARGETS rather than two grey buttons in a row. They say what
                         they take and how big it may be, and they carry the running total —
                         which is the number that decides whether Send will work, and it used
                         to be invisible until the server refused the whole submission. -->
                    <div class="fbm-attach-row">
                        <button type="button" class="fbm-drop" id="fbm-add-shots">
                            <span class="fbm-drop-ico">${IC.image}</span>
                            <span class="fbm-drop-t">${esc(t('fbm.addShots'))}</span>
                            <span class="fbm-drop-h">${esc(t('fbm.addShots.h'))}</span>
                        </button>
                        <button type="button" class="fbm-drop" id="fbm-add-zip">
                            <span class="fbm-drop-ico">${IC.zip}</span>
                            <span class="fbm-drop-t">${esc(t('fbm.addZip'))}</span>
                            <span class="fbm-drop-h">${esc(t('fbm.addZip.h'))}</span>
                        </button>
                    </div>
                    <div class="fbm-budget" id="fbm-budget" data-max="${maxMB}" data-maxn="${maxN}"></div>
                    <div class="fbm-files" id="fbm-files"></div>
                    ${crashes.length ? `<div class="fbm-crashes"><div class="fbm-lbl">${esc(t('fbm.crashList'))}</div>${crashes.slice(0, 6).map((p) => `<label class="fbm-crash"><input type="checkbox" data-zip="${esc(p)}" ${_zips.includes(p) ? 'checked' : ''}> <span class="fbm-crash-name">${esc(base(p))}</span></label>`).join('')}</div>` : ''}
                    <label class="fbm-check"><input type="checkbox" id="fbm-logs" ${_kind !== 'feedback' ? 'checked' : ''}> <span>${esc(t('fbm.includeLogs'))}</span></label>
                    <label class="fbm-check"><input type="checkbox" id="fbm-dx" ${_kind === 'crash' ? 'checked' : ''}> <span>${esc(t('fbm.includeDx'))}</span></label>
                </div>
            </details>

            <!-- Open from the start only when the server insists on a contact: a required
                 field behind a fold is a dead end you only find by pressing Send. -->
            <details class="fbm-fold" id="fbm-contact-wrap" ${needContact ? 'open' : ''}>
                <summary><span class="fbm-fold-t">${esc(t('fbm.contact'))}</span><span class="fbm-fold-sum" id="fbm-contact-sum"></span></summary>
                <div class="fbm-fold-in">
                ${linked
                    ? `<div class="fbm-linked">${IC.check} <span>${esc(t('fbm.contactLinked'))}</span></div>`
                    : `<div class="fbm-grid2">
                        <div><label class="fbm-lbl" for="fbm-email">${esc(t('fbm.email'))}${needContact ? ' *' : ''}</label><input class="form-input fbm-input" id="fbm-email" type="email" placeholder="you@example.com"></div>
                        <div><label class="fbm-lbl" for="fbm-discord">${esc(t('fbm.discord'))}</label><input class="form-input fbm-input" id="fbm-discord" placeholder="username"></div>
                       </div>
                       <div class="fbm-hint">${esc(t('fbm.contactHint'))}</div>`}
                </div>
            </details>
        </div>
        </div>
        <div class="fbm-foot">
            <!-- The quality meter used to be a block of its own — label, tier, track, tip, four
                 stacked rows above the buttons. It is coaching, not a control, so it rides the
                 footer now: one track, the tier, and the single next thing to improve. -->
            <div class="fbm-quality" id="fbm-quality" title="${esc(t('fbm.quality'))}">
                <div class="fbm-quality-track"><div class="fbm-quality-fill" id="fbm-quality-fill"></div></div>
                <div class="fbm-quality-line">
                    <span class="fbm-quality-tier" id="fbm-quality-tier"></span>
                    <span class="fbm-quality-tip" id="fbm-quality-tip"></span>
                </div>
            </div>
            <span class="fbm-status" id="fbm-status"></span>
            <button type="button" class="btn btn-ghost btn-sm" id="fbm-cancel">${esc(t('common.cancel') || 'Cancel')}</button>
            <button type="button" class="btn btn-primary btn-sm fbm-send" id="fbm-send" ${disabled ? 'disabled' : ''}>${IC.send} <span>${esc(t('fbm.send'))}</span></button>
        </div>
    </div>`;
    wire(o, linked, crashes, cfg);
}

function renderSteps(): void {
    const host = document.getElementById('fbm-steps'); if (!host) return;
    host.innerHTML = _steps.map((s, i) => `<div class="fbm-step"><span class="fbm-step-n">${i + 1}</span><input class="form-input fbm-input" data-step="${i}" value="${esc(s)}" placeholder="${esc(t('fbm.stepPh'))}"><button type="button" class="fbm-step-del" data-del="${i}" aria-label="${esc(t('common.remove') || 'Remove')}">${IC.x}</button></div>`).join('');
    updateQuality();
}
/**
 * Measure every picked file and redraw the budget bar.
 *
 * `read_file_base64` is what the send path uses, so the number here is exactly the number that
 * will travel — no estimate, no 4/3 arithmetic that drifts from reality. Files already
 * measured are skipped, so re-picking is free.
 */
async function measurePicked(): Promise<void> {
    for (const path of [..._shots, ..._zips]) {
        if (_sizes.has(path)) continue;
        try { _sizes.set(path, String(await invoke('read_file_base64', { path })).length); }
        catch { _sizes.set(path, 0); }   // unreadable here means unreadable at send time too
        renderBudget();
    }
    renderBudget();
}

/** The "how much of the allowance is used" line, in the units that get refused. */
function renderBudget(): void {
    const el = document.getElementById('fbm-budget'); if (!el) return;
    const maxMB = Number(el.dataset.max || 25);
    const maxN = Number(el.dataset.maxn || 6);
    const paths = [..._shots, ..._zips];
    const known = paths.filter((p) => _sizes.has(p));
    const used = known.reduce((a, p) => a + (_sizes.get(p) || 0), 0);
    const max = maxMB * 1024 * 1024;
    const pct = Math.min(100, Math.round((used / max) * 100));
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    const over = used > max || paths.length > maxN;
    if (!paths.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div class="fbm-budget-bar"><div class="fbm-budget-fill${over ? ' is-over' : ''}" style="width:${pct}%"></div></div>
        <div class="fbm-budget-line${over ? ' is-over' : ''}">
            ${esc(t('fbm.budget').replace('{used}', mb(used)).replace('{max}', mb(max)).replace('{n}', String(paths.length)).replace('{maxn}', String(maxN)))}
            ${known.length < paths.length ? ` <span class="fbm-budget-wait">${esc(t('fbm.budget.measuring'))}</span>` : ''}
        </div>`;
}

function renderFiles(): void {
    const host = document.getElementById('fbm-files'); if (!host) return;
    const items = [..._shots.map((p) => ({ p, kind: 'shot' })), ..._zips.map((p) => ({ p, kind: 'zip' }))];
    host.innerHTML = items.length ? items.map((it) => `<span class="fbm-file fbm-file-${it.kind}">${it.kind === 'shot' ? IC.image : IC.zip} <span>${esc(base(it.p))}</span><button type="button" data-rm="${esc(it.p)}" aria-label="${esc(t('common.remove') || 'Remove')}">${IC.x}</button></span>`).join('') : `<span class="fbm-files-empty">${esc(t('fbm.noFiles'))}</span>`;
    for (const cb of Array.from(document.querySelectorAll<HTMLInputElement>('input[data-zip]'))) cb.checked = _zips.includes(cb.dataset.zip || '');
    renderBudget();
    updateQuality();
}

// A live "how good is this report" meter. Scores the pieces that make a report actionable —
// a title, enough detail, steps (for a bug/crash), an attachment, a way to reply — and points
// at the single most valuable thing still missing. Never blocks Send; it only coaches.
type Tier = 'weak' | 'fair' | 'good' | 'great';
function scoreQuality(): { pct: number; tier: Tier; tipKey: string } {
    const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
    const title = q<HTMLInputElement>('fbm-title')?.value.trim() || '';
    const desc = q<HTMLTextAreaElement>('fbm-desc')?.value.trim() || '';
    const hasFiles = _shots.length > 0 || _zips.length > 0;
    const logs = !!q<HTMLInputElement>('fbm-logs')?.checked;
    const stepsN = _steps.map((s) => s.trim()).filter(Boolean).length;
    const linked = !!document.querySelector('.fbm-linked');
    const email = q<HTMLInputElement>('fbm-email')?.value.trim() || '';
    const wantsSteps = _kind !== 'feedback';
    // Weights sum to 100. With no steps (a suggestion), the detail carries that weight instead.
    const wTitle = 15, wAttach = 15, wContact = 10;
    const wDesc = wantsSteps ? 45 : 60;
    const wSteps = wantsSteps ? 15 : 0;
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
    const sTitle = title.length >= 6 ? wTitle : title.length > 0 ? wTitle * 0.5 : 0;
    const sDesc = desc.length < 10 ? 0 : clamp01((desc.length - 10) / 210) * wDesc;
    const sSteps = wantsSteps ? (stepsN >= 2 ? wSteps : stepsN === 1 ? wSteps * 0.6 : 0) : 0;
    const sAttach = hasFiles ? wAttach : logs ? wAttach * 0.4 : 0;
    const sContact = (linked || email) ? wContact : 0;
    const pct = Math.round(sTitle + sDesc + sSteps + sAttach + sContact);
    const tier: Tier = pct >= 80 ? 'great' : pct >= 60 ? 'good' : pct >= 35 ? 'fair' : 'weak';
    let tipKey = 'fbm.q.tipReady';
    if (desc.length < 60) tipKey = 'fbm.q.tipDesc';
    else if (wantsSteps && stepsN === 0) tipKey = 'fbm.q.tipSteps';
    else if (!hasFiles) tipKey = 'fbm.q.tipAttach';
    else if (title.length < 6) tipKey = 'fbm.q.tipTitle';
    else if (!linked && !email) tipKey = 'fbm.q.tipContact';
    return { pct, tier, tipKey };
}
/**
 * What each folded row is currently holding, said on the row itself.
 *
 * The whole point of folding is that you do not have to look inside; that only works if the
 * outside is honest. "Include the app log" is checked by default for a bug — fold it away
 * silently and the report carries a file the person never agreed to. So the summary names it,
 * and it re-reads the live controls on every input/change rather than caching a guess.
 */
function updateSummaries(): void {
    const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
    const set = (id: string, txt: string, filled: boolean) => {
        const el = q(id); if (!el) return;
        el.textContent = txt;
        el.classList.toggle('is-set', filled);
    };
    const none = t('fbm.sumNone');

    const stepsN = _steps.map((s) => s.trim()).filter(Boolean).length;
    set('fbm-steps-sum', stepsN ? t('fbm.sumSteps').replace('{n}', String(stepsN)) : none, stepsN > 0);

    const files = _shots.length + _zips.length;
    const bits: string[] = [];
    if (files) bits.push(t('fbm.sumFiles').replace('{n}', String(files)));
    if (q<HTMLInputElement>('fbm-logs')?.checked) bits.push(t('fbm.sumLogs'));
    if (q<HTMLInputElement>('fbm-dx')?.checked) bits.push(t('fbm.sumDx'));
    set('fbm-attach-sum', bits.length ? bits.join(' · ') : none, bits.length > 0);

    const linked = !!document.querySelector('.fbm-linked');
    const email = q<HTMLInputElement>('fbm-email')?.value.trim() || '';
    const discord = q<HTMLInputElement>('fbm-discord')?.value.trim() || '';
    const who = linked ? t('fbm.sumContactLinked') : email || discord || t('fbm.sumContactOpt');
    set('fbm-contact-sum', who, linked || !!email || !!discord);
}

function updateQuality(): void {
    updateSummaries();
    const fill = document.getElementById('fbm-quality-fill');
    const tierEl = document.getElementById('fbm-quality-tier');
    const tipEl = document.getElementById('fbm-quality-tip');
    if (!fill || !tierEl || !tipEl) return;
    const { pct, tier, tipKey } = scoreQuality();
    const color = tier === 'great' ? 'var(--bmm-success)' : tier === 'good' ? 'var(--accent)' : tier === 'fair' ? 'var(--bmm-warning)' : 'var(--bmm-danger)';
    fill.style.width = `${pct}%`;
    fill.style.background = color;
    tierEl.textContent = t(`fbm.q.${tier}`);
    tierEl.className = `fbm-quality-tier fbm-q-${tier}`;
    tipEl.textContent = t(tipKey);
}

function wire(o: HTMLElement, linked: boolean, crashes: string[], cfg: Awaited<ReturnType<typeof fetchFeedbackConfig>>): void {
    const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
    q('fbm-close')?.addEventListener('click', close);
    q('fbm-cancel')?.addEventListener('click', close);
    for (const b of Array.from(o.querySelectorAll<HTMLButtonElement>('.fbm-kind'))) {
        b.addEventListener('click', () => {
            _kind = (b.dataset.kind as Kind) || 'bug';
            for (const x of Array.from(o.querySelectorAll<HTMLButtonElement>('.fbm-kind'))) { x.classList.toggle('is-on', x === b); x.setAttribute('aria-selected', String(x === b)); }
            const title = q<HTMLInputElement>('fbm-title'); if (title) title.placeholder = t(`fbm.fTitlePh.${_kind}`);
            const desc = q<HTMLTextAreaElement>('fbm-desc'); if (desc) desc.placeholder = t(`fbm.fDescPh.${_kind}`);
            const steps = q('fbm-steps-wrap'); if (steps) steps.hidden = _kind === 'feedback';
            const logs = q<HTMLInputElement>('fbm-logs'); if (logs) logs.checked = _kind !== 'feedback';
            const dx = q<HTMLInputElement>('fbm-dx'); if (dx) dx.checked = _kind === 'crash';
            if (_kind === 'crash' && !_zips.length && crashes.length) { _zips = [crashes[0]]; renderFiles(); }
            updateQuality();
        });
    }
    const desc = q<HTMLTextAreaElement>('fbm-desc');
    desc?.addEventListener('input', () => { const c = q('fbm-count'); if (c) c.textContent = String(desc.value.length); });
    // Any typing or toggle re-scores the report quality (steps/files call updateQuality themselves).
    o.addEventListener('input', updateQuality);
    o.addEventListener('change', updateQuality);
    renderSteps(); renderFiles();
    q('fbm-steps')?.addEventListener('input', (e) => { const el = e.target as HTMLInputElement; if (el.dataset.step != null) _steps[Number(el.dataset.step)] = el.value; });
    q('fbm-steps')?.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-del]'); if (!b) return; _steps.splice(Number(b.dataset.del), 1); if (!_steps.length) _steps = ['']; renderSteps(); });
    q('fbm-add-step')?.addEventListener('click', () => { if (_steps.length < 30) { _steps.push(''); renderSteps(); (document.querySelector(`[data-step="${_steps.length - 1}"]`) as HTMLInputElement | null)?.focus(); } });
    q('fbm-add-shots')?.addEventListener('click', async () => {
        const files = await pickFiles([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]);
        for (const f of files) if (!_shots.includes(f)) _shots.push(f);
        renderFiles(); void measurePicked();
    });
    q('fbm-add-zip')?.addEventListener('click', async () => {
        const f = await pickFile([{ name: 'Archives', extensions: ['zip'] }]);
        if (f && !_zips.includes(f)) { _zips.push(f); renderFiles(); void measurePicked(); }
    });
    q('fbm-files')?.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rm]'); if (!b) return; const p = b.dataset.rm || ''; _shots = _shots.filter((x) => x !== p); _zips = _zips.filter((x) => x !== p); renderFiles(); });
    o.querySelector('.fbm-crashes')?.addEventListener('change', (e) => { const cb = e.target as HTMLInputElement; const p = cb.dataset.zip || ''; if (!p) return; if (cb.checked) { if (!_zips.includes(p)) _zips.push(p); } else _zips = _zips.filter((x) => x !== p); renderFiles(); });
    // The coaching line points at something that is now behind a fold, so make it the way in:
    // clicking "Add steps to reproduce" opens the steps row and puts the cursor in it. Telling
    // someone what is missing and leaving them to find the control is worse than not telling them.
    const tip = q('fbm-quality-tip');
    tip?.addEventListener('click', () => {
        const target = ({
            'fbm.q.tipSteps': ['fbm-steps-wrap', '[data-step="0"]'],
            'fbm.q.tipAttach': ['fbm-attach-wrap', '#fbm-add-shots'],
            'fbm.q.tipContact': ['fbm-contact-wrap', '#fbm-email'],
            'fbm.q.tipDesc': ['', '#fbm-desc'],
            'fbm.q.tipTitle': ['', '#fbm-title'],
        } as Record<string, [string, string]>)[scoreQuality().tipKey];
        if (!target) return;
        const [foldId, sel] = target;
        if (foldId) { const d = q<HTMLDetailsElement>(foldId); if (d && !d.hidden) d.open = true; }
        const el = o.querySelector<HTMLElement>(sel);
        el?.scrollIntoView({ block: 'nearest' });
        el?.focus();
    });
    q('fbm-send')?.addEventListener('click', () => send(linked, cfg));
}

// A small proof-of-work: a report is only sent after the client has spent some CPU finding a
// nonce whose SHA-256 of `challenge:nonce` starts with `targetBits` zero bits. It is friction
// against a script firing reports in a loop (on top of the client throttle) and is recorded on
// the report; capped by a time budget so a slow machine never hangs on it.
async function proofOfWork(challenge: string, targetBits = 13, maxMs = 2500): Promise<{ nonce: number; bits: number; ms: number } | null> {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const enc = new TextEncoder();
    const started = Date.now();
    const lead = (b: Uint8Array): number => { let z = 0; for (const x of b) { if (x === 0) { z += 8; } else { z += Math.clz32(x) - 24; break; } } return z; };
    let best = { nonce: 0, bits: 0 };
    for (let nonce = 1; nonce < 50_000_000; nonce++) {
        const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${nonce}`));
        const z = lead(new Uint8Array(buf));
        if (z > best.bits) best = { nonce, bits: z };
        if (z >= targetBits) return { nonce, bits: z, ms: Date.now() - started };
        if ((nonce & 511) === 0 && Date.now() - started > maxMs) break; // best effort within the budget
    }
    return { ...best, ms: Date.now() - started };
}

async function send(linked: boolean, cfg: Awaited<ReturnType<typeof fetchFeedbackConfig>>): Promise<void> {
    if (_busy) return;
    const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
    const status = q('fbm-status');
    const title = q<HTMLInputElement>('fbm-title')?.value.trim() || '';
    const desc = q<HTMLTextAreaElement>('fbm-desc')?.value.trim() || '';
    const email = q<HTMLInputElement>('fbm-email')?.value.trim() || '';
    const discord = q<HTMLInputElement>('fbm-discord')?.value.trim() || '';
    const say = (msg: string, tone: '' | 'err' | 'ok' = '') => { if (status) { status.textContent = msg; status.className = `fbm-status${tone ? ` fbm-status-${tone}` : ''}`; } };
    if (desc.length < 10) { say(t('fbm.tooShort'), 'err'); q('fbm-desc')?.focus(); return; }
    if (!linked && cfg?.requireContact && !email) { say(t('feedback.contactRequired'), 'err'); q('fbm-email')?.focus(); return; }
    const maxN = cfg?.maxAttachments ?? 6; const maxBytes = (cfg?.maxAttachMB ?? 25) * 1024 * 1024;
    _busy = true;
    const btn = q<HTMLButtonElement>('fbm-send'); if (btn) btn.disabled = true;
    try {
        say(t('fbm.packing'));
        const attachments: FeedbackAttachment[] = [];
        let bytes = 0;
        // Budget what TRAVELS, not what the file weighs.
        //
        // This measured `data.length * 0.75` — the DECODED size — against the server's
        // maxAttachMB. But an attachment goes out as base64 inside the JSON, so a submission
        // the client considered "25 MB, within budget" was a ~34 MB HTTP request. Anything in
        // front of the API with a body limit below that answers 413, and the app had already
        // decided it was inside the limit, so the message made no sense.
        //
        // Counting the encoded length is also strictly safer against the server's own check,
        // which compares DECODED bytes to the same number: encoded is always larger, so a
        // request that fits here cannot trip it there.
        const add = async (path: string, type: string) => {
            if (attachments.length >= maxN) return;
            const data = await invoke('read_file_base64', { path }) as string;
            const wire = data.length;                     // what actually goes on the wire
            if (bytes + wire > maxBytes) { toast(t('fbm.skippedBig').replace('{f}', base(path)), 'warning'); return; }
            bytes += wire; attachments.push({ name: base(path), type, data });
        };
        for (const p of _shots) await add(p, /\.png$/i.test(p) ? 'image/png' : /\.gif$/i.test(p) ? 'image/gif' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg');
        for (const p of _zips) await add(p, 'application/zip');
        if (q<HTMLInputElement>('fbm-logs')?.checked) {
            let logs = '';
            try { const { debugHub } = await import('../debug/debug.js'); logs = (debugHub as any)?.logs?.length ? (debugHub as any).logs.map((l: any) => `[${String(l.level).toUpperCase()}] ${l.message}`).join('\n') : ''; } catch { logs = ''; }
            if (logs && attachments.length < maxN) attachments.push({ name: 'bmm_frontend.log', type: 'text/plain', data: textToBase64(logs) });
        }
        if (q<HTMLInputElement>('fbm-dx')?.checked) {
            const diag = await invoke('get_dxdiag_report').catch(() => null);
            if (diag && attachments.length < maxN) attachments.push({ name: 'dxdiag_report.txt', type: 'text/plain', data: textToBase64(String(diag)) });
        }
        const steps = _steps.map((s) => s.trim()).filter(Boolean);
        const body = steps.length ? `${desc}\n\n${t('fbm.fSteps')}\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : desc;
        // Anti-spam friction: a bit of proof-of-work before the report goes out. Shown so the
        // brief wait reads as "checking", not "stuck".
        if (status) status.innerHTML = `<span class="fbm-pow"><span class="fbm-pow-dot"></span>${esc(t('fbm.pow') || 'Anti-spam check…')}</span>`;
        const pow = await proofOfWork(`${_kind}|${title}|${body.slice(0, 200)}|${Date.now()}`);
        say(t('fbm.sending'));
        const r = await submitFeedback({ kind: _kind, title: title || undefined, body, email: email || undefined, discord: discord || undefined, meta: { pow: pow || undefined, steps: steps.length, crashZips: _zips.length, screenshots: _shots.length }, attachments });
        try {
            const history = JSON.parse(localStorage.getItem('bmm_report_history') || '[]');
            history.unshift({ id: r.id || 'N/A', type: _kind === 'feedback' ? 'feedback' : 'bug', title: title || t(`fbm.kind.${_kind}`), source: 'bc', date: new Date().toISOString() });
            localStorage.setItem('bmm_report_history', JSON.stringify(history.slice(0, 50)));
            document.getElementById('bh-history-refresh')?.click();
        } catch { /* private mode */ }
        close();
        toast(r.linked ? t('feedback.sentLinked') : t('fbm.sent'), 'success');
    } catch (e) {
        const queued = explainFeedbackError(e);
        if (queued) close(); else say(String((e as Error)?.message || e), 'err');
    } finally {
        _busy = false;
        if (btn) btn.disabled = false;
    }
}

/** The settings card's badge and the "goes to" line follow the transport. */
export function initFeedbackCard(): void {
    const badge = document.getElementById('fbc-badge');
    const where = document.getElementById('fbc-where');
    const bc = usesBetterCommunity();
    if (badge) { badge.textContent = bc ? 'BetterCommunity' : 'BetaHub'; badge.classList.toggle('is-bc', bc); }
    if (where) {
        const a = where.querySelector('a');
        if (a) { a.href = bc ? feedbackWebUrl() : 'https://app.betahub.io'; a.textContent = bc ? t('fbc.followSite') : 'BetaHub'; }
        where.hidden = !bc;
    }
    wireEndpointTest();
}

/** "Test the endpoint" — a real GET against whatever the link config points at. */
function wireEndpointTest(): void {
    const btn = document.getElementById('btn-fbc-test') as HTMLButtonElement | null;
    const out = document.getElementById('fbc-test-out');
    if (!btn || !out || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        out.className = 'fbc-test-out';
        out.textContent = t('fbc.testing');
        const r = await testFeedbackEndpoint();
        btn.disabled = false;
        if (r.state === 'no_url') { out.className = 'fbc-test-out is-warn'; out.textContent = t('fbc.testNoUrl'); return; }
        if (r.state === 'unreachable') {
            out.className = 'fbc-test-out is-bad';
            out.textContent = t('fbc.testFail').replace('{url}', r.url).replace('{why}', r.why || '');
            return;
        }
        if (r.state === 'disabled') { out.className = 'fbc-test-out is-warn'; out.textContent = t('fbc.testOff'); return; }
        const c = r.cfg ?? ({} as NonNullable<typeof r.cfg>);
        // The limits are echoed because they are the ones a failed Send will quote back.
        out.className = 'fbc-test-out is-ok';
        out.textContent = t('fbc.testOk')
            .replace('{kinds}', Object.entries(c.kinds || {}).filter(([, on]) => on).map(([k]) => t(`fbm.kind.${k}`) || k).join(', ') || '—')
            .replace('{kb}', String(c.maxBodyKB ?? '?'))
            .replace('{n}', String(c.maxAttachments ?? '?'))
            .replace('{mb}', String(c.maxAttachMB ?? '?'));
    });
}
