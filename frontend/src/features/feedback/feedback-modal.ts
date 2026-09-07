// feedback-modal.ts — the one dialog behind "Report a bug" and "Suggestion / Feedback".
//
// Built on demand, in BetterCommunity's own look: a kind selector (suggestion · bug · crash),
// what happened, what to attach (screenshots, crash zips, logs, DxDiag), who you are — and a
// Send that goes to the feedback centre through bc-feedback.ts. When links.json empties
// `feedback_endpoint`, the older BetaHub forms are opened instead, untouched.
import { invoke, pickFiles, pickFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { usesBetterCommunity, submitFeedback, fetchFeedbackConfig, textToBase64, explainFeedbackError, feedbackWebUrl, type FeedbackKind, type FeedbackAttachment } from './bc-feedback.js';

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

function overlay(): HTMLElement {
    if (_overlay) return _overlay;
    const o = document.createElement('div');
    o.className = 'modal-overlay fbm-overlay';
    o.id = 'modal-feedback';
    document.body.appendChild(o);
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
        ${offline ? `<div class="fbm-banner fbm-banner-warn">${esc(t('fbm.offline'))}</div>` : disabled ? `<div class="fbm-banner fbm-banner-warn">${esc(t('feedback.disabled'))}</div>` : ''}
        <div class="fbm-kinds" role="tablist">${kindBtn('feedback', IC.bulb)}${kindBtn('bug', IC.bug)}${kindBtn('crash', IC.crash)}</div>
        <div class="fbm-body">
            <section class="fbm-sec">
                <div class="fbm-sec-title">${esc(t('fbm.what'))}</div>
                <label class="fbm-lbl" for="fbm-title">${esc(t('fbm.fTitle'))}</label>
                <input class="form-input fbm-input" id="fbm-title" maxlength="200" placeholder="${esc(t(`fbm.fTitlePh.${_kind}`))}">
                <label class="fbm-lbl" for="fbm-desc">${esc(t('fbm.fDesc'))} <span class="fbm-count" id="fbm-count">0</span></label>
                <textarea class="form-input fbm-input fbm-textarea" id="fbm-desc" rows="5" maxlength="6000" placeholder="${esc(t(`fbm.fDescPh.${_kind}`))}"></textarea>
                <div class="fbm-steps" id="fbm-steps-wrap" ${_kind === 'feedback' ? 'hidden' : ''}>
                    <label class="fbm-lbl">${esc(t('fbm.fSteps'))}</label>
                    <div id="fbm-steps"></div>
                    <button type="button" class="btn btn-ghost btn-xs" id="fbm-add-step">+ ${esc(t('fbm.addStep'))}</button>
                </div>
            </section>
            <section class="fbm-sec">
                <div class="fbm-sec-title">${esc(t('fbm.attach'))} <span class="fbm-sec-hint">${esc(t('fbm.attachCap').replace('{n}', String(maxN)).replace('{mb}', String(maxMB)))}</span></div>
                <div class="fbm-attach-row">
                    <button type="button" class="btn btn-secondary btn-sm" id="fbm-add-shots">${IC.image} ${esc(t('fbm.addShots'))}</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="fbm-add-zip">${IC.zip} ${esc(t('fbm.addZip'))}</button>
                </div>
                <div class="fbm-files" id="fbm-files"></div>
                ${crashes.length ? `<div class="fbm-crashes"><div class="fbm-lbl">${esc(t('fbm.crashList'))}</div>${crashes.slice(0, 6).map((p) => `<label class="fbm-crash"><input type="checkbox" data-zip="${esc(p)}" ${_zips.includes(p) ? 'checked' : ''}> <span class="fbm-crash-name">${esc(base(p))}</span></label>`).join('')}</div>` : ''}
                <label class="fbm-check"><input type="checkbox" id="fbm-logs" ${_kind !== 'feedback' ? 'checked' : ''}> <span>${esc(t('fbm.includeLogs'))}</span></label>
                <label class="fbm-check"><input type="checkbox" id="fbm-dx" ${_kind === 'crash' ? 'checked' : ''}> <span>${esc(t('fbm.includeDx'))}</span></label>
            </section>
            <section class="fbm-sec">
                <div class="fbm-sec-title">${esc(t('fbm.contact'))}</div>
                ${linked
                    ? `<div class="fbm-linked">${IC.check} <span>${esc(t('fbm.contactLinked'))}</span></div>`
                    : `<div class="fbm-grid2">
                        <div><label class="fbm-lbl" for="fbm-email">${esc(t('fbm.email'))}${needContact ? ' *' : ''}</label><input class="form-input fbm-input" id="fbm-email" type="email" placeholder="you@example.com"></div>
                        <div><label class="fbm-lbl" for="fbm-discord">${esc(t('fbm.discord'))}</label><input class="form-input fbm-input" id="fbm-discord" placeholder="username"></div>
                       </div>
                       <div class="fbm-hint">${esc(t('fbm.contactHint'))}</div>`}
            </section>
        </div>
        <div class="fbm-quality" id="fbm-quality">
            <div class="fbm-quality-top">
                <span class="fbm-quality-lbl">${esc(t('fbm.quality'))}</span>
                <span class="fbm-quality-tier" id="fbm-quality-tier"></span>
            </div>
            <div class="fbm-quality-track"><div class="fbm-quality-fill" id="fbm-quality-fill"></div></div>
            <div class="fbm-quality-tip" id="fbm-quality-tip"></div>
        </div>
        <div class="fbm-foot">
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
function renderFiles(): void {
    const host = document.getElementById('fbm-files'); if (!host) return;
    const items = [..._shots.map((p) => ({ p, kind: 'shot' })), ..._zips.map((p) => ({ p, kind: 'zip' }))];
    host.innerHTML = items.length ? items.map((it) => `<span class="fbm-file fbm-file-${it.kind}">${it.kind === 'shot' ? IC.image : IC.zip} <span>${esc(base(it.p))}</span><button type="button" data-rm="${esc(it.p)}" aria-label="${esc(t('common.remove') || 'Remove')}">${IC.x}</button></span>`).join('') : `<span class="fbm-files-empty">${esc(t('fbm.noFiles'))}</span>`;
    for (const cb of Array.from(document.querySelectorAll<HTMLInputElement>('input[data-zip]'))) cb.checked = _zips.includes(cb.dataset.zip || '');
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
function updateQuality(): void {
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
        renderFiles();
    });
    q('fbm-add-zip')?.addEventListener('click', async () => {
        const f = await pickFile([{ name: 'Archives', extensions: ['zip'] }]);
        if (f && !_zips.includes(f)) { _zips.push(f); renderFiles(); }
    });
    q('fbm-files')?.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rm]'); if (!b) return; const p = b.dataset.rm || ''; _shots = _shots.filter((x) => x !== p); _zips = _zips.filter((x) => x !== p); renderFiles(); });
    o.querySelector('.fbm-crashes')?.addEventListener('change', (e) => { const cb = e.target as HTMLInputElement; const p = cb.dataset.zip || ''; if (!p) return; if (cb.checked) { if (!_zips.includes(p)) _zips.push(p); } else _zips = _zips.filter((x) => x !== p); renderFiles(); });
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
        const add = async (path: string, type: string) => {
            if (attachments.length >= maxN) return;
            const data = await invoke('read_file_base64', { path }) as string;
            const size = Math.floor(data.length * 0.75);
            if (bytes + size > maxBytes) { toast(t('fbm.skippedBig').replace('{f}', base(path)), 'warning'); return; }
            bytes += size; attachments.push({ name: base(path), type, data });
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
}
