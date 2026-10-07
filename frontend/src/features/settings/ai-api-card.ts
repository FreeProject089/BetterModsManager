// « API Laya locale » — the « API locale » tab of the Laya dialog (features/ai/laya-hub.ts),
// for the local Laya API (commands/ai_api.rs).
//
// Off by default. On, it lets programs on THIS PC ask the embedded Laya the same questions
// laya-serve answers (POST /v1/systemone), behind a token shown once. Short on purpose: one
// switch, one status line, the token when there is one to show, and everything else behind
// « Plus ».

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { ensureAiCss } from '../ai/ai-shared.js';

const CARD_ID = 'laya-api-card';

interface ApiStatus {
    enabled: boolean; running: boolean; port: number; url: string; allowedOrigins: string[];
    concurrency: number; hasToken: boolean; why: string | null; error: string | null;
    held: string | null; modelInstalled: boolean;
    stats: { served: number; refused: number; lastStatus: number; lastAtMs: number };
}

/** A token just minted: shown until the card is re-rendered by something else. */
let _freshToken = '';

function statusLine(st: ApiStatus): { cls: string; text: string } {
    if (st.running) {
        const held = st.held ? ` · ${t('ai.api.held.' + st.held)}` : '';
        return { cls: 'ai-pill ai-pill-on', text: `${t('ai.api.running')} ${st.url}${held}` };
    }
    if (st.error) {
        const [key, kind] = String(st.error).split('|');
        return { cls: 'ai-pill', text: (t(key) || key).replace('{why}', kind || '') };
    }
    return { cls: 'ai-pill', text: st.enabled ? t('ai.api.why.' + (st.why || 'off')) : t('ai.api.stopped') };
}

function render(card: HTMLElement, st: ApiStatus | null): void {
    if (!st) {
        card.innerHTML = `<h3 class="card-title">${escHtml(t('ai.api.title'))}</h3><p class="ai-muted">${escHtml(t('ai.settings.unavailable'))}</p>`;
        return;
    }
    const line = statusLine(st);
    const example = `curl -s -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\\n  -d '{"state":{"body":"The game crashes at start"},"questions":{"cat":{"type":"choice","criteria":["crash","ui"]}}}' \\\n  ${st.url}/v1/systemone`;
    card.innerHTML = `
      <header class="laya-page-h">
        <h3 class="card-title ai-card-title"><span>${escHtml(t('ai.api.title'))}</span>
          <span class="${line.cls}" id="ai-api-pill">${escHtml(line.text)}</span></h3>
        <p class="ai-muted">${escHtml(t('ai.api.intro'))}</p>
      </header>
      <div class="laya-switchrow">
        <span class="laya-switchrow-text"><b id="ai-api-on-l">${escHtml(t('ai.api.toggle'))}</b><small>${escHtml(t('ai.hub2.apiHint'))}</small></span>
        <label class="bmm-switch"><input type="checkbox" id="ai-api-on" ${st.enabled ? 'checked' : ''} aria-labelledby="ai-api-on-l"><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
      </div>
      ${_freshToken ? `
      <div class="ai-block" id="ai-api-token-box">
        <div class="ai-lbl">${escHtml(t('ai.api.tokenOnce'))}</div>
        <span class="ai-keyrow"><input class="form-input" id="ai-api-token" readonly value="${escAttr(_freshToken)}" spellcheck="false" autocomplete="off">
        <button type="button" class="btn btn-primary btn-sm" id="ai-api-copy">${escHtml(t('ai.api.copy'))}</button></span>
      </div>` : ''}
      <div class="ai-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="ai-api-test" ${st.running ? '' : 'disabled'}>${escHtml(t('ai.api.test'))}</button>
        <button type="button" class="btn btn-ghost btn-sm" id="ai-api-rotate" ${st.enabled ? '' : 'disabled'}>${escHtml(t('ai.api.rotate'))}</button>
        <span class="ai-muted" id="ai-api-status" aria-live="polite"></span>
      </div>
      <details class="ai-more" id="ai-api-more">
        <summary>${escHtml(t('ai.hub2.apiAdvanced'))}</summary>
        <div class="ai-grid">
          <label class="ai-lbl" for="ai-api-port">${escHtml(t('ai.api.port'))}</label>
          <input id="ai-api-port" class="form-input" type="number" min="1024" max="65535" value="${escAttr(String(st.port))}">
          <label class="ai-lbl" for="ai-api-conc">${escHtml(t('ai.api.concurrency'))}</label>
          <select id="ai-api-conc" class="form-input">
            <option value="1"${st.concurrency !== 2 ? ' selected' : ''}>1</option>
            <option value="2"${st.concurrency === 2 ? ' selected' : ''}>2</option>
          </select>
          <label class="ai-lbl" for="ai-api-origins">${escHtml(t('ai.api.origins'))}</label>
          <textarea id="ai-api-origins" class="form-input" rows="2" spellcheck="false" placeholder="http://localhost:5173">${escHtml((st.allowedOrigins || []).join('\n'))}</textarea>
        </div>
        <p class="ai-muted">${escHtml(t('ai.api.originsHint'))}</p>
        <div class="ai-actions"><button type="button" class="btn btn-primary btn-sm" id="ai-api-save">${escHtml(t('common.save'))}</button></div>
        <p class="ai-muted">${escHtml(t('ai.api.safety'))}</p>
        <pre class="ai-api-code">${escHtml(example)}</pre>
        <p class="ai-muted">${escHtml(t('ai.api.stats').replace('{served}', String(st.stats?.served ?? 0)).replace('{refused}', String(st.stats?.refused ?? 0)))}</p>
      </details>`;
    wire(card, st);
}

function say(card: HTMLElement, text: string): void {
    const s = card.querySelector('#ai-api-status');
    if (s) s.textContent = text;
}

function errText(e: unknown): string {
    const raw = String(e instanceof Error ? e.message : e ?? '');
    const [key, kind] = raw.split('|');
    const w = t(key);
    return w && w !== key ? w.replace('{why}', kind || '') : raw;
}

async function apply(card: HTMLElement, change: Record<string, unknown>): Promise<void> {
    try {
        const r: any = await invoke('ai_api_configure', { change });
        if (r?.token) _freshToken = String(r.token);
        render(card, r?.status || null);
    } catch (e) {
        say(card, errText(e));
    }
}

function wire(card: HTMLElement, st: ApiStatus): void {
    card.querySelector<HTMLInputElement>('#ai-api-on')?.addEventListener('change', (e) => {
        const on = (e.target as HTMLInputElement).checked;
        if (!on) _freshToken = '';
        void apply(card, { enabled: on });
    });
    card.querySelector('#ai-api-copy')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(_freshToken); say(card, t('ai.api.copied')); } catch { say(card, t('ai.api.copyFailed')); }
    });
    card.querySelector('#ai-api-rotate')?.addEventListener('click', async () => {
        try {
            const r: any = await invoke('ai_api_rotate_token');
            _freshToken = String(r?.token || '');
            render(card, r?.status || st);
            say(card, t('ai.api.rotated'));
        } catch (e) { say(card, errText(e)); }
    });
    card.querySelector('#ai-api-test')?.addEventListener('click', async () => {
        say(card, t('ai.api.testing'));
        try {
            const r: any = await invoke('ai_api_test');
            if (!r?.ok) { say(card, t('ai.api.testFail')); return; }
            say(card, r.ready ? t('ai.api.testOk') : t('ai.api.testOkNotReady'));
        } catch (e) { say(card, errText(e)); }
    });
    card.querySelector('#ai-api-save')?.addEventListener('click', () => {
        const port = parseInt((card.querySelector('#ai-api-port') as HTMLInputElement)?.value || '', 10);
        const concurrency = parseInt((card.querySelector('#ai-api-conc') as HTMLSelectElement)?.value || '1', 10);
        const origins = String((card.querySelector('#ai-api-origins') as HTMLTextAreaElement)?.value || '')
            .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        void apply(card, { port: Number.isFinite(port) ? port : undefined, concurrency, allowedOrigins: origins });
    });
}

/** Put the card (once) in `host` — a pane of the Laya dialog — and paint it. */
export async function mountAiApiCard(host: HTMLElement): Promise<void> {
    ensureAiCss();
    if (!document.getElementById('ai-api-css')) {
        const link = document.createElement('link');
        link.id = 'ai-api-css';
        link.rel = 'stylesheet';
        link.href = 'css/ai-api.css';
        document.head.appendChild(link);
    }
    let card = document.getElementById(CARD_ID);
    if (!card) {
        card = document.createElement('div');
        card.className = 'ai-card laya-pane-card';
        card.id = CARD_ID;
        host.appendChild(card);
    }
    const st = (await invoke('ai_api_status').catch(() => null)) as ApiStatus | null;
    render(card, st);
    if (!(card as any)._aiApiLang) {
        (card as any)._aiApiLang = true;
        // The AI card re-renders whole (features/ai/ai-settings.ts): repaint, since the master
        // switch there decides whether the API runs.
        document.addEventListener('bmm:ai-card-rendered', () => {
            const c = document.getElementById(CARD_ID);
            if (c?.isConnected) void (invoke('ai_api_status').catch(() => null) as Promise<ApiStatus | null>).then((s) => render(c, s));
        });
        document.addEventListener('langChanged', () => {
            if (!card?.isConnected) return;
            void (invoke('ai_api_status').catch(() => null) as Promise<ApiStatus | null>).then((s) => render(card as HTMLElement, s));
        });
    }
}
