// laya-debug.ts — the « Laya » section of the debug menu.
//
// What a developer (or a user sent here by support) needs to see when Laya « does nothing »:
//   · the engine: installed or not, loaded, the pinned model / revision / runtime, its size,
//     how many runs, the app's memory;
//   · the switches: master switch, `--no-ai` kill switch, the classifier, the generator;
//   · the answer settings that actually apply, per area (preset expanded by Rust);
//   · the last calls — feature, provider, latency, outcome, decision — WITHOUT any text: Rust
//     records no question, no report and no user-defined label (commands/ai_core.rs);
//   · a tester: a text and labels → raw probabilities (no threshold, temperature 1), through the
//     same gate as everything else (master switch off = refused);
//   · « Recharger le modèle » (drop the loaded session) and « Vider » (calls + crash-label cache).
//
// Registered through the debug menu's section registry (features/debug/debug-menu.ts,
// `registerDebugSection`), looked up at runtime so this file compiles whether or not the
// registry has landed; until it has, the section is simply not offered.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { fmtBytes, pct } from './ai-model.js';
import { ensureAiCss, reasonText } from './ai-shared.js';
import { featureWord, tuningAreaWord } from './laya-words.js';

interface Call { seq: number; at: number; feature: string; provider: string; ms: number; questions: number; ok: boolean; error?: string | null; decision?: string | null; abstained?: boolean | null; uncertain?: boolean | null }

/** The section's tab icon (inline SVG, as the registry expects). */
const ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

let _registered = false;
let _host: HTMLElement | null = null;
let _timer: number | undefined;

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
}

const yesNo = (v: unknown) => (v ? t('laya.dbg.yes') : t('laya.dbg.no'));

function row(k: string, v: string): string {
    return `<div class="laya-dbg-kv"><span>${escHtml(k)}</span><b>${escHtml(v)}</b></div>`;
}

function outcome(c: Call): string {
    if (!c.ok) return `${t('laya.dbg.failed')} (${c.error || '?'})`;
    if (c.abstained) return t('laya.dbg.abstained');
    const d = c.decision ? c.decision : c.abstained === false ? t('laya.dbg.accepted') : '—';
    return c.uncertain ? `${d} · ${t('ai.lt.guessBadge')}` : d;
}

async function refresh(): Promise<void> {
    const host = _host;
    if (!host) return;
    let st: any;
    let mem: any = null;
    try { st = await invoke('ai_laya_debug_state'); } catch (e) {
        const box = host.querySelector<HTMLElement>('[data-ldbg-state]');
        if (box) box.textContent = reasonText(String((e as Error)?.message || e));
        return;
    }
    try { mem = await invoke('get_debug_stats'); } catch { /* optional */ }
    if (host !== _host) return;
    const e = st?.embedded || {};
    const state = host.querySelector<HTMLElement>('[data-ldbg-state]');
    if (state) state.innerHTML = `
      <div class="laya-dbg-grid">
        ${row(t('laya.dbg.master'), yesNo(st?.enabled))}
        ${row(t('laya.dbg.kill'), yesNo(st?.killSwitch))}
        ${row(t('laya.dbg.classifier'), String(st?.classifier || '—'))}
        ${row(t('laya.dbg.generative'), String(st?.generative || '—'))}
        ${row(t('laya.dbg.installed'), e.installed ? `${yesNo(true)} (${String(e.source || '')})` : yesNo(false))}
        ${row(t('laya.dbg.loaded'), e.loaded ? `${yesNo(true)}${e.loadMs != null ? ` · ${e.loadMs} ms` : ''}` : yesNo(false))}
        ${row(t('laya.dbg.model'), `${String(e.model || '')} @ ${String(e.revision || '').slice(0, 12)}`)}
        ${row(t('laya.dbg.variant'), String(e.variant || ''))}
        ${row(t('laya.dbg.runtime'), String(e.runtime || ''))}
        ${row(t('laya.dbg.size'), e.sizeBytes ? fmtBytes(e.sizeBytes) : '—')}
        ${row(t('laya.dbg.runs'), String(e.runs ?? 0))}
        ${row(t('laya.dbg.memory'), mem?.memory_mb != null ? `${mem.memory_mb} MB` : '—')}
        ${row(t('laya.dbg.cache'), String(st?.cacheEntries ?? 0))}
      </div>`;
    const areas = host.querySelector<HTMLElement>('[data-ldbg-areas]');
    if (areas) areas.innerHTML = `<table class="laya-dbg-table"><thead><tr>
        <th>${escHtml(t('laya.dbg.area'))}</th><th>${escHtml(t('laya.dbg.preset'))}</th><th>${escHtml(t('laya.dbg.threshold'))}</th>
        <th>${escHtml(t('laya.dbg.margin'))}</th><th>${escHtml(t('laya.dbg.temperature'))}</th><th>${escHtml(t('laya.dbg.abstain'))}</th><th>${escHtml(t('laya.dbg.topk'))}</th></tr></thead>
      <tbody>${(Array.isArray(st?.areas) ? st.areas : []).map((a: any) => {
        const tu = a.tuning || {};
        return `<tr><td>${escHtml(tuningAreaWord(String(a.area)))}${a.own ? ' *' : ''}</td><td>${escHtml(String(tu.preset || ''))}</td><td>${pct(tu.threshold)} %</td><td>${pct(tu.margin)} %</td><td>${escHtml(String(tu.temperature ?? ''))}</td><td>${escHtml(String(tu.abstain || ''))}</td><td>${escHtml(String(tu.top_k ?? ''))}</td></tr>`;
    }).join('')}</tbody></table><p class="ai-muted">${escHtml(t('laya.dbg.ownNote'))}</p>`;
    const calls: Call[] = Array.isArray(st?.calls) ? st.calls : [];
    const list = host.querySelector<HTMLElement>('[data-ldbg-calls]');
    if (list) list.innerHTML = calls.length ? `<table class="laya-dbg-table"><thead><tr>
        <th>${escHtml(t('laya.dbg.when'))}</th><th>${escHtml(t('laya.dbg.feature'))}</th><th>${escHtml(t('laya.dbg.provider'))}</th>
        <th>${escHtml(t('laya.dbg.latency'))}</th><th>${escHtml(t('laya.dbg.questions'))}</th><th>${escHtml(t('laya.dbg.outcome'))}</th></tr></thead>
      <tbody>${calls.map((c) => `<tr class="${c.ok ? '' : 'is-bad'}"><td>${escHtml(new Date(c.at).toLocaleTimeString())}</td><td>${escHtml(featureWord(c.feature))}</td><td>${escHtml(c.provider)}</td><td>${c.ms} ms</td><td>${c.questions}</td><td>${escHtml(outcome(c))}</td></tr>`).join('')}</tbody></table>`
        : `<p class="ai-muted">${escHtml(t('laya.dbg.noCalls'))}</p>`;
    const avg = host.querySelector<HTMLElement>('[data-ldbg-avg]');
    const ok = calls.filter((c) => c.ok);
    if (avg) avg.textContent = ok.length ? t('laya.dbg.avg', { n: String(calls.length), ms: String(Math.round(ok.reduce((a, c) => a + c.ms, 0) / ok.length)), kept: String(st?.callsKept ?? '') }) : '';
}

/** Draw the panel into the debug menu's host. */
export async function mountLayaDebug(host: HTMLElement): Promise<void> {
    ensureAiCss();
    unmountLayaDebug();
    _host = host;
    host.innerHTML = `
      <div class="laya-dbg">
        <div class="laya-dbg-bar">
          <button type="button" class="btn btn-xs btn-ghost" data-ldbg-refresh>${escHtml(t('laya.dbg.refresh'))}</button>
          <button type="button" class="btn btn-xs btn-ghost" data-ldbg-unload>${escHtml(t('laya.dbg.unload'))}</button>
          <button type="button" class="btn btn-xs btn-ghost" data-ldbg-clear>${escHtml(t('laya.dbg.clear'))}</button>
          <span class="ai-muted" data-ldbg-msg aria-live="polite"></span>
        </div>
        <div class="ai-sub">${escHtml(t('laya.dbg.stateTitle'))}</div>
        <div data-ldbg-state></div>
        <div class="ai-sub">${escHtml(t('laya.dbg.areasTitle'))}</div>
        <div data-ldbg-areas></div>
        <div class="ai-sub">${escHtml(t('laya.dbg.callsTitle'))}</div>
        <p class="ai-muted">${escHtml(t('laya.dbg.callsNote'))}</p>
        <div class="ai-muted" data-ldbg-avg></div>
        <div data-ldbg-calls></div>
        <div class="ai-sub">${escHtml(t('laya.dbg.testTitle'))}</div>
        <textarea class="form-input laya-dbg-text" rows="3" data-ldbg-text aria-label="${escHtml(t('laya.dbg.testText'))}" placeholder="${escHtml(t('laya.dbg.testText'))}"></textarea>
        <input class="form-input" data-ldbg-labels aria-label="${escHtml(t('laya.dbg.testLabels'))}" placeholder="${escHtml(t('laya.dbg.testLabels'))}" value="${escHtml(t('laya.dbg.testLabelsDefault'))}">
        <button type="button" class="btn btn-xs btn-accent" data-ldbg-run>${escHtml(t('laya.dbg.testRun'))}</button>
        <div data-ldbg-out aria-live="polite"></div>
      </div>`;
    const msg = (s: string) => { const m = host.querySelector<HTMLElement>('[data-ldbg-msg]'); if (m) m.textContent = s; };
    host.querySelector('[data-ldbg-refresh]')?.addEventListener('click', () => { void refresh(); });
    host.querySelector('[data-ldbg-unload]')?.addEventListener('click', async () => {
        try { await invoke('ai_laya_debug_unload'); msg(t('laya.dbg.unloaded')); } catch (e) { msg(String(e)); }
        void refresh();
    });
    host.querySelector('[data-ldbg-clear]')?.addEventListener('click', async () => {
        try { await invoke('ai_laya_debug_clear'); msg(t('laya.dbg.cleared')); } catch (e) { msg(String(e)); }
        void refresh();
    });
    host.querySelector('[data-ldbg-run]')?.addEventListener('click', async () => {
        const out = host.querySelector<HTMLElement>('[data-ldbg-out]');
        const text = (host.querySelector('[data-ldbg-text]') as HTMLTextAreaElement | null)?.value || '';
        const labels = String((host.querySelector('[data-ldbg-labels]') as HTMLInputElement | null)?.value || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 32);
        if (!out) return;
        out.textContent = t('ai.suggest.loading');
        try {
            const r: any = await invoke('ai_laya_debug_classify', { text, labels });
            const probs: Array<{ id: string; p: number }> = Array.isArray(r?.probabilities) ? r.probabilities : [];
            out.innerHTML = `<ul class="laya-dbg-bars">${probs.map((p) => `<li><span>${escHtml(p.id)}</span><span class="laya-dbg-bar-track"><span class="laya-dbg-bar-fill" style="width:${pct(p.p)}%"></span></span><b>${(Number(p.p) || 0).toFixed(4)}</b></li>`).join('')}</ul>`;
        } catch (e) {
            out.textContent = reasonText(String((e as Error)?.message || e));
        }
        void refresh();
    });
    await refresh();
    // Live while the section is open; stopped by unmount.
    _timer = window.setInterval(() => { if (_host && _host.isConnected) void refresh(); else unmountLayaDebug(); }, 4000);
}
