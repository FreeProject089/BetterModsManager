// laya-debug.ts — the « Laya » section of the debug menu.
//
// What a developer (or a user sent here by support) needs to see when Laya « does nothing »:
//   · the engine: installed or not, loaded, the pinned model / revision / runtime, its size,
//     how many runs, the app's memory — as status cards, the switches first;
//   · the answer settings that actually apply, per area (preset expanded by Rust);
//   · the last calls — feature, provider, latency, outcome, decision — WITHOUT any text: Rust
//     records no question, no report and no user-defined label (commands/ai_core.rs), with
//     p50 / p95 over what is kept;
//   · a tester: a text and labels → raw probabilities (no threshold, temperature 1), through the
//     same gate as everything else (master switch off = refused), drawn against the threshold
//     and margin of an area the developer picks;
//   · tools: a benchmark (N runs of a fixed sample through the tester), the integrity check of
//     the model files (`ai_laya_debug_verify`, gated), open the model folder, export the calls
//     as JSON (no text in them to begin with), copy a plain-text summary for a bug report;
//   · « Recharger le modèle » (drop the loaded session) and « Vider » (calls + crash-label cache).
//
// Registered through the debug menu's section registry (features/debug/debug-menu.ts,
// `registerDebugSection`), looked up at runtime so this file compiles whether or not the
// registry has landed; until it has, the section is simply not offered. The header and
// section bars use DevTools' own `.dbg-bar` language (debug.css), the rest is ai.css.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { fmtBytes, pct } from './ai-model.js';
import { ensureAiCss, reasonText } from './ai-shared.js';
import { featureWord, tuningAreaWord } from './laya-words.js';

interface Call { seq: number; at: number; feature: string; provider: string; ms: number; questions: number; ok: boolean; error?: string | null; decision?: string | null; abstained?: boolean | null; uncertain?: boolean | null }
interface Area { area: string; own?: boolean; tuning?: { preset?: string; threshold?: number; margin?: number; temperature?: number; abstain?: string; top_k?: number } }
type Tone = 'ok' | 'warn' | 'bad' | 'off' | 'info';

/** The section's tab icon (inline SVG, as the registry expects). */
const ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

/** The benchmark's fixed sample: never the user's text, always the same, so runs compare. */
const BENCH_TEXT = 'The game crashes on startup after I enabled two texture mods.';
const BENCH_LABELS = ['bug', 'crash', 'suggestion', 'question'];

let _registered = false;
let _host: HTMLElement | null = null;
let _timer: number | undefined;
let _last: any = null;
let _areas: Area[] = [];
let _benchStop = false;

/** Register the section once. Safe to call before the registry exists (it then does nothing). */
export async function registerLayaDebug(): Promise<void> {
    if (_registered) return;
    try {
        const m: any = await import('../debug/debug-menu.js');
        if (typeof m?.registerDebugSection !== 'function') return;
        m.registerDebugSection({ id: 'laya', titleKey: 'laya.dbg.title', icon: ICON, mount: mountLayaDebug, unmount: unmountLayaDebug });
        _registered = true;
    } catch { /* no debug menu in this build */ }
}

export function unmountLayaDebug(): void {
    if (_timer) window.clearInterval(_timer);
    _timer = undefined;
    _host = null;
    _benchStop = true;
}

// ── Small pieces ────────────────────────────────────────────────────────────────────────────

const yesNo = (v: unknown) => (v ? t('laya.dbg.yes') : t('laya.dbg.no'));
const esc = (s: unknown) => escHtml(String(s ?? ''));

function pill(text: string, tone: Tone): string {
    return `<span class="laya-dbg-pill" data-tone="${tone}">${esc(text)}</span>`;
}

/** A status card: label, value, the tone as a pill-coloured dot. */
function card(label: string, value: string, tone: Tone, sub = ''): string {
    return `<div class="laya-dbg-card" data-tone="${tone}"><span class="laya-dbg-card-k">${esc(label)}</span>`
        + `<span class="laya-dbg-card-v">${pill(value, tone)}</span>${sub ? `<span class="laya-dbg-card-sub">${esc(sub)}</span>` : ''}</div>`;
}

function kv(k: string, v: string): string {
    return `<div class="laya-dbg-kv"><span>${esc(k)}</span><b title="${esc(v)}">${esc(v)}</b></div>`;
}

function stat(label: string, value: string): string {
    return `<div class="laya-dbg-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

/** Nearest-rank percentile of a sorted list. */
function percentile(sorted: number[], p: number): number {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[i];
}

function latencyStats(ms: number[]): { n: number; min: number; max: number; mean: number; p50: number; p95: number } {
    const s = ms.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
    const sum = s.reduce((a, b) => a + b, 0);
    return { n: s.length, min: s[0] ?? 0, max: s[s.length - 1] ?? 0, mean: s.length ? Math.round(sum / s.length) : 0, p50: percentile(s, 50), p95: percentile(s, 95) };
}

function outcome(c: Call): { text: string; tone: Tone } {
    if (!c.ok) return { text: `${t('laya.dbg.failed')} (${c.error || '?'})`, tone: 'bad' };
    if (c.abstained) return { text: t('laya.dbg.abstained'), tone: 'warn' };
    const d = c.decision ? c.decision : c.abstained === false ? t('laya.dbg.accepted') : '';
    if (!d) return { text: t('laya.dbg.accepted'), tone: 'info' };
    return c.uncertain ? { text: `${d} · ${t('ai.lt.guessBadge')}`, tone: 'warn' } : { text: d, tone: 'ok' };
}

/** Set innerHTML only when it changed: the 4 s refresh must not flicker or reset scroll. */
function paint(el: HTMLElement | null, html: string): void {
    if (el && el.dataset.ldbgHtml !== html) { el.innerHTML = html; el.dataset.ldbgHtml = html; }
}

function sectionBar(id: string, titleKey: string, descKey: string, actions = ''): string {
    return `<div class="dbg-bar dbg-bar-section"><div class="dbg-bar-text"><h3 class="dbg-bar-title" id="${id}">${esc(t(titleKey))}</h3>`
        + `${descKey ? `<p class="dbg-bar-desc">${esc(t(descKey))}</p>` : ''}</div>${actions ? `<div class="debug-btn-row">${actions}</div>` : ''}</div>`;
}

// ── Rendering ───────────────────────────────────────────────────────────────────────────────

function renderState(st: any, mem: any): string {
    const e = st?.embedded || {};
    const cls = String(st?.classifier || '');
    const gen = String(st?.generative || '');
    const cards = [
        card(t('laya.dbg.master'), yesNo(st?.enabled), st?.enabled ? 'ok' : 'off'),
        card(t('laya.dbg.kill'), yesNo(st?.killSwitch), st?.killSwitch ? 'bad' : 'ok'),
        card(t('laya.dbg.classifier'), cls || '—', cls === 'embedded' || cls === 'local' ? 'ok' : cls && cls !== 'off' ? 'info' : 'off'),
        card(t('laya.dbg.generative'), gen || '—', gen && gen !== 'off' ? 'info' : 'off'),
        card(t('laya.dbg.installed'), yesNo(e.installed), e.installed ? 'ok' : 'warn', e.installed ? String(e.source || '') : ''),
        card(t('laya.dbg.loaded'), yesNo(e.loaded), e.loaded ? 'ok' : 'off', e.loaded && e.loadMs != null ? t('laya.dbg.loadMs', { ms: String(e.loadMs) }) : ''),
    ].join('');
    const details = [
        kv(t('laya.dbg.model'), `${String(e.model || '')} @ ${String(e.revision || '').slice(0, 12)}`),
        kv(t('laya.dbg.variant'), String(e.variant || '—')),
        kv(t('laya.dbg.runtime'), String(e.runtime || '—')),
        kv(t('laya.dbg.size'), e.sizeBytes ? fmtBytes(e.sizeBytes) : '—'),
        kv(t('laya.dbg.runs'), String(e.runs ?? 0)),
        kv(t('laya.dbg.memory'), mem?.memory_mb != null ? `${mem.memory_mb} MB` : '—'),
        kv(t('laya.dbg.cache'), String(st?.cacheEntries ?? 0)),
    ].join('');
    return `<div class="laya-dbg-cards">${cards}</div><div class="laya-dbg-grid">${details}</div>`;
}

function renderAreas(areas: Area[]): string {
    const rows = areas.map((a) => {
        const tu = a.tuning || {};
        return `<tr><td class="laya-dbg-name">${esc(tuningAreaWord(String(a.area)))}${a.own ? ` ${pill(t('laya.dbg.ownChip'), 'info')}` : ''}</td>`
            + `<td>${esc(tu.preset || '')}</td><td class="num">${pct(tu.threshold ?? 0)} %</td><td class="num">${pct(tu.margin ?? 0)} %</td>`
            + `<td class="num">${esc(tu.temperature ?? '')}</td><td>${esc(tu.abstain || '')}</td><td class="num">${esc(tu.top_k ?? '')}</td></tr>`;
    }).join('');
    if (!rows) return `<p class="debug-empty-state">${esc(t('laya.dbg.noAreas'))}</p>`;
    return `<div class="laya-dbg-scroll"><table class="laya-dbg-table"><thead><tr>
        <th scope="col">${esc(t('laya.dbg.area'))}</th><th scope="col">${esc(t('laya.dbg.preset'))}</th><th scope="col" class="num">${esc(t('laya.dbg.threshold'))}</th>
        <th scope="col" class="num">${esc(t('laya.dbg.margin'))}</th><th scope="col" class="num">${esc(t('laya.dbg.temperature'))}</th><th scope="col">${esc(t('laya.dbg.abstain'))}</th><th scope="col" class="num">${esc(t('laya.dbg.topk'))}</th></tr></thead>
      <tbody>${rows}</tbody></table></div><p class="laya-dbg-note">${esc(t('laya.dbg.ownNote'))}</p>`;
}

function renderCalls(calls: Call[], kept: unknown): string {
    if (!calls.length) return `<p class="debug-empty-state">${esc(t('laya.dbg.noCalls'))}</p>`;
    const ok = calls.filter((c) => c.ok);
    const s = latencyStats(ok.map((c) => Number(c.ms)));
    const rate = Math.round((ok.length / calls.length) * 100);
    const stats = `<div class="laya-dbg-stats">${[
        stat(t('laya.dbg.statCalls'), `${calls.length} / ${String(kept ?? '')}`),
        stat(t('laya.dbg.statOk'), `${rate} %`),
        stat('p50', ok.length ? `${s.p50} ms` : '—'),
        stat('p95', ok.length ? `${s.p95} ms` : '—'),
        stat(t('laya.dbg.statMax'), ok.length ? `${s.max} ms` : '—'),
    ].join('')}</div>`;
    const maxMs = Math.max(1, ...calls.map((c) => Number(c.ms) || 0));
    const rows = calls.map((c) => {
        const o = outcome(c);
        const w = Math.max(2, Math.round(((Number(c.ms) || 0) / maxMs) * 100));
        return `<tr class="${c.ok ? '' : 'is-bad'}"><td class="mono">${esc(new Date(c.at).toLocaleTimeString())}</td><td>${esc(featureWord(c.feature))}</td>`
            + `<td class="laya-dbg-narrow-hide">${esc(c.provider)}</td>`
            + `<td><span class="laya-dbg-lat"><span class="laya-dbg-lat-track" aria-hidden="true"><span class="laya-dbg-lat-fill" data-tone="${o.tone}" style="width:${w}%"></span></span><span class="mono">${esc(c.ms)} ms</span></span></td>`
            + `<td class="num laya-dbg-narrow-hide">${esc(c.questions)}</td><td>${pill(o.text, o.tone)}</td></tr>`;
    }).join('');
    return `${stats}<div class="laya-dbg-scroll"><table class="laya-dbg-table laya-dbg-calls"><thead><tr>
        <th scope="col">${esc(t('laya.dbg.when'))}</th><th scope="col">${esc(t('laya.dbg.feature'))}</th><th scope="col" class="laya-dbg-narrow-hide">${esc(t('laya.dbg.provider'))}</th>
        <th scope="col">${esc(t('laya.dbg.latency'))}</th><th scope="col" class="num laya-dbg-narrow-hide">${esc(t('laya.dbg.questions'))}</th><th scope="col">${esc(t('laya.dbg.outcome'))}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

/** The tester's result: one bar per label, the chosen area's threshold as a marker, a decision. */
function renderTest(r: any, area: Area | null): string {
    const probs: Array<{ id: string; p: number }> = (Array.isArray(r?.probabilities) ? r.probabilities : [])
        .map((p: any) => ({ id: String(p.id), p: Number(p.p) || 0 }))
        .sort((a: { p: number }, b: { p: number }) => b.p - a.p);
    if (!probs.length) return `<p class="debug-empty-state">${esc(t('laya.dbg.testNothing'))}</p>`;
    const th = area ? Number(area.tuning?.threshold) || 0 : null;
    const mg = area ? Number(area.tuning?.margin) || 0 : null;
    const top = probs[0];
    const second = probs[1]?.p ?? 0;
    let decision: string;
    let tone: Tone;
    if (th == null) { decision = t('laya.dbg.decRaw', { label: top.id }); tone = 'info'; }
    else if (top.p < th) { decision = t('laya.dbg.decBelow', { p: String(pct(top.p)), t: String(pct(th)) }); tone = 'warn'; }
    else if (mg != null && top.p - second < mg) { decision = t('laya.dbg.decAmbiguous', { m: String(pct(top.p - second)), need: String(pct(mg)) }); tone = 'warn'; }
    else { decision = t('laya.dbg.decAccept', { label: top.id }); tone = 'ok'; }
    const marker = th != null ? `<span class="laya-dbg-mark" style="left:${pct(th)}%" title="${esc(t('laya.dbg.thresholdMark', { t: String(pct(th)) }))}"></span>` : '';
    const bars = probs.map((p, i) => `<li class="${i === 0 ? 'is-top' : ''}${th != null && p.p >= th ? ' is-pass' : ''}"><span class="laya-dbg-lbl" title="${esc(p.id)}">${esc(p.id)}</span>`
        + `<span class="laya-dbg-bar-track"><span class="laya-dbg-bar-fill" style="width:${pct(p.p)}%"></span>${marker}</span><b class="mono">${p.p.toFixed(4)}</b></li>`).join('');
    return `<div class="laya-dbg-decision" data-tone="${tone}">${pill(decision, tone)}${th != null ? `<span class="laya-dbg-note">${esc(t('laya.dbg.thresholdMark', { t: String(pct(th)) }))}</span>` : ''}</div>`
        + `<ul class="laya-dbg-bars">${bars}</ul><p class="laya-dbg-note">${esc(t('laya.dbg.testRawNote'))}</p>`;
}

function verifyWhy(why: string): string {
    switch (why) {
        case 'unreadable': return t('laya.dbg.whyUnreadable');
        case 'hash_mismatch': return t('laya.dbg.whyHash');
        case 'size_mismatch': return t('laya.dbg.whySize');
        case 'unpinned': return t('laya.dbg.whyUnpinned');
        case 'empty': return t('laya.dbg.whyEmpty');
        default: return t('laya.dbg.whyOk');
    }
}

function renderVerify(r: any): string {
    if (!r?.installed) return `<p class="debug-empty-state">${esc(t('laya.dbg.noModel'))}</p>`;
    const files: any[] = Array.isArray(r.files) ? r.files : [];
    const bad = files.filter((f) => !f.ok).length;
    const head = bad
        ? pill(t('laya.dbg.verifyBad', { n: String(bad) }), 'bad')
        : pill(t('laya.dbg.verifyOk', { n: String(files.length), ms: String(r.ms ?? 0) }), 'ok');
    const rows = files.map((f) => `<tr class="${f.ok ? '' : 'is-bad'}"><td class="mono laya-dbg-name">${esc(f.name)}</td>`
        + `<td class="num mono">${f.size != null ? esc(fmtBytes(f.size)) : '—'}</td><td>${pill(f.ok && !f.why ? t('laya.dbg.whyOk') : verifyWhy(String(f.why || '')), f.ok ? 'ok' : 'bad')}</td>`
        + `<td class="num mono laya-dbg-narrow-hide">${esc(f.ms ?? 0)} ms</td></tr>`).join('');
    return `<div class="laya-dbg-decision">${head}</div><div class="laya-dbg-scroll"><table class="laya-dbg-table"><thead><tr>
        <th scope="col">${esc(t('laya.dbg.file'))}</th><th scope="col" class="num">${esc(t('laya.dbg.size'))}</th><th scope="col">${esc(t('laya.dbg.status'))}</th><th scope="col" class="num laya-dbg-narrow-hide">${esc(t('laya.dbg.hashTime'))}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

function renderBench(ms: number[], total: number): string {
    const s = latencyStats(ms);
    return `<div class="laya-dbg-stats">${[
        stat(t('laya.dbg.statFirst'), `${ms[0] ?? 0} ms`),
        stat('p50', `${s.p50} ms`),
        stat('p95', `${s.p95} ms`),
        stat(t('laya.dbg.statMin'), `${s.min} ms`),
        stat(t('laya.dbg.statMax'), `${s.max} ms`),
        stat(t('laya.dbg.statMean'), `${s.mean} ms`),
    ].join('')}</div><p class="laya-dbg-note">${esc(t('laya.dbg.benchDone', { n: String(ms.length), ms: String(total) }))} ${esc(t('laya.dbg.benchFirstNote'))}</p>`;
}

/** A plain-text summary for a bug report: switches, engine, call latency. No path, no text. */
function summaryText(): string {
    const st = _last || {};
    const e = st.embedded || {};
    const calls: Call[] = Array.isArray(st.calls) ? st.calls : [];
    const ok = calls.filter((c) => c.ok);
    const s = latencyStats(ok.map((c) => Number(c.ms)));
    const areas: Area[] = Array.isArray(st.areas) ? st.areas : [];
    return [
        'Laya',
        `enabled=${!!st.enabled} killSwitch=${!!st.killSwitch} classifier=${st.classifier || '-'} generative=${st.generative || '-'}`,
        `installed=${!!e.installed} source=${e.source || '-'} loaded=${!!e.loaded} loadMs=${e.loadMs ?? '-'} runs=${e.runs ?? 0}`,
        `model=${e.model || '-'}@${String(e.revision || '').slice(0, 12)} variant=${e.variant || '-'} runtime=${e.runtime || '-'} size=${e.sizeBytes || 0}`,
        `cacheEntries=${st.cacheEntries ?? 0} ownAreas=${areas.filter((a) => a.own).map((a) => a.area).join(',') || '-'}`,
        `calls=${calls.length} ok=${ok.length} failed=${calls.length - ok.length} p50=${s.p50}ms p95=${s.p95}ms max=${s.max}ms`,
        ...calls.filter((c) => !c.ok).slice(0, 5).map((c) => `fail ${c.feature}/${c.provider} ${c.error || '?'}`),
    ].join('\n');
}

async function refresh(): Promise<void> {
    const host = _host;
    if (!host) return;
    let st: any;
    let mem: any = null;
    try { st = await invoke('ai_laya_debug_state'); } catch (e) {
        paint(host.querySelector<HTMLElement>('[data-ldbg-state]'), `<p class="debug-empty-state">${esc(reasonText(String((e as Error)?.message || e)))}</p>`);
        return;
    }
    try { mem = await invoke('get_debug_stats'); } catch { /* optional */ }
    if (host !== _host) return;
    _last = st;
    _areas = Array.isArray(st?.areas) ? st.areas : [];
    paint(host.querySelector<HTMLElement>('[data-ldbg-state]'), renderState(st, mem));
    paint(host.querySelector<HTMLElement>('[data-ldbg-areas]'), renderAreas(_areas));
    paint(host.querySelector<HTMLElement>('[data-ldbg-calls]'), renderCalls(Array.isArray(st?.calls) ? st.calls : [], st?.callsKept));
    // The tester's area list is filled once: a refresh must not reset the developer's choice.
    const sel = host.querySelector<HTMLSelectElement>('[data-ldbg-area]');
    if (sel && sel.options.length <= 1 && _areas.length) {
        for (const a of _areas) {
            const o = document.createElement('option');
            o.value = String(a.area);
            o.textContent = tuningAreaWord(String(a.area));
            sel.appendChild(o);
        }
    }
}

/** Draw the panel into the debug menu's host. */
export async function mountLayaDebug(host: HTMLElement): Promise<void> {
    ensureAiCss();
    unmountLayaDebug();
    _host = host;
    _benchStop = false;
    const btn = (attr: string, key: string, kind = 'debug-btn-ghost') => `<button type="button" class="debug-btn ${kind} debug-btn-sm" ${attr}>${esc(t(key))}</button>`;
    host.innerHTML = `
      <div class="laya-dbg">
        <div class="dbg-bar">
          <div class="dbg-bar-text"><h2 class="dbg-bar-title">${esc(t('laya.dbg.title'))}</h2><p class="dbg-bar-desc">${esc(t('laya.dbg.headDesc'))}</p></div>
          <div class="debug-btn-row">
            ${btn('data-ldbg-refresh', 'laya.dbg.refresh', 'debug-btn-primary')}
            ${btn('data-ldbg-unload', 'laya.dbg.unload')}
            ${btn('data-ldbg-clear', 'laya.dbg.clear')}
            ${btn('data-ldbg-copy', 'laya.dbg.copySummary')}
          </div>
        </div>
        <p class="laya-dbg-msg" data-ldbg-msg role="status" aria-live="polite"></p>
        <section class="laya-dbg-sec" aria-labelledby="ldbg-h-state">
          ${sectionBar('ldbg-h-state', 'laya.dbg.stateTitle', '', `${btn('data-ldbg-verify', 'laya.dbg.verify')}${btn('data-ldbg-folder', 'laya.dbg.openFolder')}`)}
          <div class="laya-dbg-in">
            <div data-ldbg-state><p class="debug-empty-state">${esc(t('common.loading'))}</p></div>
            <div data-ldbg-verify-out aria-live="polite"></div>
          </div>
        </section>
        <section class="laya-dbg-sec" aria-labelledby="ldbg-h-areas">
          ${sectionBar('ldbg-h-areas', 'laya.dbg.areasTitle', '')}
          <div class="laya-dbg-in" data-ldbg-areas></div>
        </section>
        <section class="laya-dbg-sec" aria-labelledby="ldbg-h-calls">
          ${sectionBar('ldbg-h-calls', 'laya.dbg.callsTitle', 'laya.dbg.callsNote', btn('data-ldbg-export', 'laya.dbg.exportCalls'))}
          <div class="laya-dbg-in" data-ldbg-calls></div>
        </section>
        <section class="laya-dbg-sec" aria-labelledby="ldbg-h-test">
          ${sectionBar('ldbg-h-test', 'laya.dbg.testTitle', '')}
          <div class="laya-dbg-in laya-dbg-form">
            <label class="laya-dbg-field"><span>${esc(t('laya.dbg.testText'))}</span><textarea class="dbg-input laya-dbg-text" rows="3" data-ldbg-text></textarea></label>
            <label class="laya-dbg-field"><span>${esc(t('laya.dbg.testLabels'))}</span><input class="dbg-input" data-ldbg-labels value="${esc(t('laya.dbg.testLabelsDefault'))}"></label>
            <div class="laya-dbg-row">
              <label class="laya-dbg-field laya-dbg-grow"><span>${esc(t('laya.dbg.testArea'))}</span><select class="dbg-input" data-ldbg-area><option value="">${esc(t('laya.dbg.testRawOnly'))}</option></select></label>
              ${btn('data-ldbg-run', 'laya.dbg.testRun', 'debug-btn-primary')}
            </div>
            <div data-ldbg-out aria-live="polite"></div>
          </div>
        </section>
        <section class="laya-dbg-sec" aria-labelledby="ldbg-h-bench">
          ${sectionBar('ldbg-h-bench', 'laya.dbg.benchTitle', 'laya.dbg.benchNote')}
          <div class="laya-dbg-in laya-dbg-form">
            <div class="laya-dbg-row">
              <label class="laya-dbg-field"><span>${esc(t('laya.dbg.benchRuns'))}</span><select class="dbg-input" data-ldbg-bench-n><option>5</option><option selected>10</option><option>20</option><option>50</option></select></label>
              ${btn('data-ldbg-bench', 'laya.dbg.benchRun', 'debug-btn-primary')}
              ${btn('data-ldbg-bench-stop hidden', 'laya.dbg.benchStop')}
              <span class="laya-dbg-note" data-ldbg-bench-progress aria-live="polite"></span>
            </div>
            <div data-ldbg-bench-out></div>
          </div>
        </section>
      </div>`;
    const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
    const msg = (s: string, tone: Tone = 'info') => { const m = q('[data-ldbg-msg]'); if (m) { m.textContent = s; m.dataset.tone = tone; } };
    const fail = (e: unknown) => reasonText(String((e as Error)?.message || e));

    q('[data-ldbg-refresh]')?.addEventListener('click', () => { void refresh(); });
    q('[data-ldbg-unload]')?.addEventListener('click', async () => {
        try { await invoke('ai_laya_debug_unload'); msg(t('laya.dbg.unloaded'), 'ok'); } catch (e) { msg(fail(e), 'bad'); }
        void refresh();
    });
    q('[data-ldbg-clear]')?.addEventListener('click', async () => {
        try { await invoke('ai_laya_debug_clear'); msg(t('laya.dbg.cleared'), 'ok'); } catch (e) { msg(fail(e), 'bad'); }
        void refresh();
    });
    q('[data-ldbg-copy]')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(summaryText()); msg(t('laya.dbg.copied'), 'ok'); } catch { msg(t('laya.dbg.copyFailed'), 'bad'); }
    });
    q('[data-ldbg-export]')?.addEventListener('click', () => {
        // The calls carry no text (Rust records none); this is the same list, as a file.
        const calls = Array.isArray(_last?.calls) ? _last.calls : [];
        const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), callsKept: _last?.callsKept ?? null, calls }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `laya-calls-${Date.now()}.json`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        msg(t('laya.dbg.exported', { n: String(calls.length) }), 'ok');
    });
    q('[data-ldbg-folder]')?.addEventListener('click', async () => {
        const e = _last?.embedded || {};
        const dir = String(e.dir || e.folder || '');
        if (!dir) { msg(t('laya.dbg.noModel'), 'warn'); return; }
        try { await invoke('open_folder', { path: dir }); } catch (err) { msg(fail(err), 'bad'); }
    });
    q('[data-ldbg-verify]')?.addEventListener('click', async () => {
        const b = q<HTMLButtonElement>('[data-ldbg-verify]');
        const out = q('[data-ldbg-verify-out]');
        if (!out || !b) return;
        b.disabled = true;
        out.innerHTML = `<p class="laya-dbg-note">${esc(t('laya.dbg.verifying'))}</p>`;
        try { out.innerHTML = renderVerify(await invoke('ai_laya_debug_verify')); } catch (e) {
            out.innerHTML = `<p class="debug-empty-state">${esc(fail(e))}</p>`;
        } finally { b.disabled = false; }
    });
    q('[data-ldbg-run]')?.addEventListener('click', async () => {
        const out = q('[data-ldbg-out]');
        const b = q<HTMLButtonElement>('[data-ldbg-run]');
        const text = q<HTMLTextAreaElement>('[data-ldbg-text]')?.value || '';
        const labels = String(q<HTMLInputElement>('[data-ldbg-labels]')?.value || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 32);
        if (!out) return;
        if (!text.trim()) { out.innerHTML = `<p class="debug-empty-state">${esc(t('laya.dbg.testNeedText'))}</p>`; return; }
        if (!labels.length) { out.innerHTML = `<p class="debug-empty-state">${esc(t('laya.dbg.testNeedLabels'))}</p>`; return; }
        const areaId = q<HTMLSelectElement>('[data-ldbg-area]')?.value || '';
        const area = areaId ? _areas.find((a) => String(a.area) === areaId) || null : null;
        out.innerHTML = `<p class="laya-dbg-note">${esc(t('common.loading'))}</p>`;
        if (b) b.disabled = true;
        try {
            out.innerHTML = renderTest(await invoke('ai_laya_debug_classify', { text, labels }), area);
        } catch (e) {
            out.innerHTML = `<p class="debug-empty-state">${esc(fail(e))}</p>`;
        } finally { if (b) b.disabled = false; }
        void refresh();
    });
    q('[data-ldbg-bench-stop]')?.addEventListener('click', () => { _benchStop = true; });
    q('[data-ldbg-bench]')?.addEventListener('click', async () => {
        const b = q<HTMLButtonElement>('[data-ldbg-bench]');
        const stop = q<HTMLButtonElement>('[data-ldbg-bench-stop]');
        const prog = q('[data-ldbg-bench-progress]');
        const out = q('[data-ldbg-bench-out]');
        const n = Math.max(1, Math.min(50, Number(q<HTMLSelectElement>('[data-ldbg-bench-n]')?.value) || 10));
        if (!b || !out) return;
        b.disabled = true;
        if (stop) stop.hidden = false;
        _benchStop = false;
        out.textContent = '';
        const ms: number[] = [];
        const t0 = performance.now();
        try {
            for (let i = 0; i < n && !_benchStop && _host === host; i++) {
                if (prog) prog.textContent = t('laya.dbg.benchProgress', { i: String(i + 1), n: String(n) });
                const s = performance.now();
                await invoke('ai_laya_debug_classify', { text: BENCH_TEXT, labels: BENCH_LABELS });
                ms.push(Math.round(performance.now() - s));
            }
            if (ms.length) out.innerHTML = renderBench(ms, Math.round(performance.now() - t0));
        } catch (e) {
            out.innerHTML = `<p class="debug-empty-state">${esc(fail(e))}</p>${ms.length ? renderBench(ms, Math.round(performance.now() - t0)) : ''}`;
        } finally {
            b.disabled = false;
            if (stop) stop.hidden = true;
            if (prog) prog.textContent = '';
        }
        void refresh();
    });
    await refresh();
    // Live while the section is open; stopped by unmount.
    _timer = window.setInterval(() => { if (_host && _host.isConnected) void refresh(); else unmountLayaDebug(); }, 4000);
}
