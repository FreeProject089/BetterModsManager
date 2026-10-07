// Share an activation order, and bring one in.
//
// Share: the backend writes the profile's order as a portable document (mods named by what
// survives another machine: fingerprint, repo id, name) and hands back a one-line code, a
// bmm://order link and a plain numbered list. This view copies one of them or saves a file.
//
// Import: paste a code, a link, a .json or a list of names (or open a file). The backend
// matches it to the library and answers a plan (order_share.rs `plan_import`); this view shows
// where each mod lands and what did not match, and hands the new order back to the order view
// as its DRAFT. Nothing changes on disk until the order view's "Apply order".
import { invoke, saveFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { raiseAboveAll } from '../../ui/layer.js';
import { installFocusTrap } from '../../ui/focus-trap.js';
import { type ImportPlan, landings, planCounts, pastedKind } from './order-share-model.js';

type Notify = (message: string, type?: string, duration?: number) => void;

interface OrderExport { doc: unknown; code: string; link: string; text: string }

function fill(key: string, vars: Record<string, string | number>): string {
    let s = t(key);
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
}

export async function copy(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* legacy route */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
}

const CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/** The order view's stylesheet (same id as load-order.ts, so it is linked once). */
function ensureCss(): void {
    if (document.getElementById('load-order-css')) return;
    const link = document.createElement('link');
    link.id = 'load-order-css';
    link.rel = 'stylesheet';
    link.href = 'css/load-order.css';
    document.head.appendChild(link);
}

/** A small modal above everything, with Escape, a focus trap and the focus given back. */
export function dialog(id: string, title: string, body: string, foot: string): { ov: HTMLElement; close: () => void; onClose: (fn: () => void) => void } {
    ensureCss();
    const opener = document.activeElement as HTMLElement | null;
    const ov = document.createElement('div');
    ov.className = 'modal-overlay open osh-overlay';
    raiseAboveAll(ov);
    ov.innerHTML = `
      <div class="modal glass osh-modal" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
        <div class="modal-header">
          <h3 id="${id}-title">${escHtml(title)}</h3>
          <button type="button" class="modal-close osh-x" aria-label="${escAttr(t('common.close'))}">${CLOSE}</button>
        </div>
        <div class="osh-body">${body}</div>
        <div class="modal-footer osh-foot">${foot}</div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    const hooks: (() => void)[] = [];
    const shown = () => ov.isConnected;
    const untrap = installFocusTrap(ov, shown);
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && shown()) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onEsc, true);
    function close(): void {
        if (!ov.isConnected) return;
        ov.remove();
        document.removeEventListener('keydown', onEsc, true);
        untrap();
        hooks.forEach((h) => h());
        try { if (opener && opener.isConnected) opener.focus({ preventScroll: true }); } catch { /* gone */ }
    }
    ov.querySelector('.osh-x')?.addEventListener('click', close);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    return { ov, close, onClose: (fn) => hooks.push(fn) };
}

/** The profile's order as a code, a link, text or a file. */
export async function openOrderShare(profileId: string | null, notify?: Notify): Promise<void> {
    let out: OrderExport;
    try {
        out = await invoke('mod_order_export', { profileId }) as OrderExport;
    } catch (e) {
        notify?.(fill('order.share.failed', { e: t(String(e)) }), 'error', 6000);
        return;
    }
    const n = Array.isArray((out.doc as any)?.mods) ? (out.doc as any).mods.length : 0;
    const { ov, close } = dialog('osh', t('order.share.title'), `
        <p class="osh-lede">${escHtml(fill('order.share.lede', { n }))}</p>
        <div class="osh-grid">
          <button type="button" class="btn btn-secondary btn-sm osh-copy" data-what="code">${escHtml(t('order.share.copyCode'))}</button>
          <button type="button" class="btn btn-secondary btn-sm osh-copy" data-what="link">${escHtml(t('order.share.copyLink'))}</button>
          <button type="button" class="btn btn-secondary btn-sm osh-copy" data-what="text">${escHtml(t('order.share.copyText'))}</button>
          <button type="button" class="btn btn-secondary btn-sm osh-save">${escHtml(t('order.share.save'))}</button>
        </div>
        <p class="osh-note">${escHtml(t('order.share.note'))}</p>
        <pre class="osh-pre" aria-label="${escAttr(t('order.share.copyText'))}">${escHtml(out.text)}</pre>`,
        `<span class="osh-status" aria-live="polite"></span>
         <button type="button" class="btn btn-primary btn-sm osh-done">${escHtml(t('common.close'))}</button>`);
    const status = ov.querySelector('.osh-status') as HTMLElement;
    ov.querySelectorAll<HTMLButtonElement>('.osh-copy').forEach((b) => b.addEventListener('click', async () => {
        const what = b.dataset.what === 'link' ? out.link : b.dataset.what === 'text' ? out.text : out.code;
        status.textContent = (await copy(what)) ? t('order.share.copied') : t('order.share.copyFailed');
    }));
    ov.querySelector('.osh-save')?.addEventListener('click', async () => {
        const dest = await saveFile({ defaultPath: 'activation-order.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (!dest) return;
        try {
            await invoke('write_text_file', { path: dest, content: JSON.stringify(out.doc, null, 2) });
            status.textContent = t('order.share.saved');
        } catch (e) {
            status.textContent = fill('order.share.failed', { e: t(String(e)) });
        }
    });
    ov.querySelector('.osh-done')?.addEventListener('click', close);
    (ov.querySelector('.osh-copy') as HTMLElement | null)?.focus();
}

/**
 * Paste or open an order and see where it lands. Resolves with the new order (a permutation of
 * the active mods) when the user takes it, or null. `prefill` is a code/link that arrived by a
 * deep link: previewed at once, never applied without a click.
 */
export function openOrderImport(profileId: string | null, prefill = ''): Promise<string[] | null> {
    return new Promise((resolve) => {
        let plan: ImportPlan | null = null;
        let result: string[] | null = null;
        let seq = 0;
        const { ov, close, onClose } = dialog('oim', t('order.import.title'), `
            <label class="osh-label" for="oim-text">${escHtml(t('order.import.paste'))}</label>
            <textarea id="oim-text" class="form-input osh-text" rows="4" spellcheck="false" placeholder="${escAttr(t('order.import.placeholder'))}"></textarea>
            <div class="osh-row">
              <button type="button" class="btn btn-ghost btn-sm" id="oim-file">${escHtml(t('order.import.open'))}</button>
              <span class="osh-kind" id="oim-kind"></span>
            </div>
            <input type="file" id="oim-input" accept=".json,.txt,.mm,.bmmorder,application/json,text/plain" hidden>
            <div class="osh-plan" id="oim-plan" aria-live="polite"></div>`,
            `<span class="osh-status" id="oim-status"></span>
             <button type="button" class="btn btn-secondary btn-sm" id="oim-cancel">${escHtml(t('common.cancel'))}</button>
             <button type="button" class="btn btn-primary btn-sm" id="oim-use" disabled>${escHtml(t('order.import.use'))}</button>`);
        onClose(() => resolve(result));
        const text = ov.querySelector('#oim-text') as HTMLTextAreaElement;
        const planEl = ov.querySelector('#oim-plan') as HTMLElement;
        const kind = ov.querySelector('#oim-kind') as HTMLElement;
        const status = ov.querySelector('#oim-status') as HTMLElement;
        const use = ov.querySelector('#oim-use') as HTMLButtonElement;
        const input = ov.querySelector('#oim-input') as HTMLInputElement;

        function renderPlan(p: ImportPlan): void {
            const c = planCounts(p);
            const rows = landings(p);
            const list = (items: string[]) => items.map((x) => `<li>${escHtml(x)}</li>`).join('');
            planEl.innerHTML = `
              <div class="osh-chips">
                <span class="osh-chip is-ok">${escHtml(fill('order.import.placed', { n: c.placed, m: p.total }))}</span>
                ${c.moved ? `<span class="osh-chip">${escHtml(fill('order.import.moved', { n: c.moved }))}</span>` : ''}
                ${p.handovers ? `<span class="osh-chip">${escHtml(fill('order.import.files', { n: p.handovers }))}</span>` : ''}
                ${c.missing ? `<span class="osh-chip is-warn">${escHtml(fill('order.import.missing', { n: c.missing }))}</span>` : ''}
                ${c.inactive ? `<span class="osh-chip is-warn">${escHtml(fill('order.import.inactive', { n: c.inactive }))}</span>` : ''}
              </div>
              ${!p.changed ? `<p class="osh-note">${escHtml(t('order.import.same'))}</p>` : `
              <ol class="osh-land">${rows.map((r) => `
                <li class="osh-land-row${r.move !== 'same' ? ' is-moved' : ''}${r.known ? '' : ' is-extra'}">
                  <span class="lo-pos">${r.to}</span>
                  <span class="osh-land-name">${escHtml(r.name)}</span>
                  <span class="osh-land-move" title="${escAttr(fill('order.import.fromTo', { n: r.from, m: r.to }))}">${r.move === 'same' ? '' : `${r.from}→${r.to}`}</span>
                  ${r.known ? '' : `<span class="lo-tag">${escHtml(t('order.import.kept'))}</span>`}
                </li>`).join('')}
              </ol>`}
              ${c.missing ? `<details class="osh-more"><summary>${escHtml(fill('order.import.missingList', { n: c.missing }))}</summary><ul>${list(p.missing)}</ul></details>` : ''}
              ${c.inactive ? `<details class="osh-more"><summary>${escHtml(fill('order.import.inactiveList', { n: c.inactive }))}</summary><p class="osh-note">${escHtml(t('order.import.inactiveHint'))}</p><ul>${list(p.inactive.map((r) => r.name))}</ul></details>` : ''}`;
            use.disabled = !p.changed;
        }

        async function preview(): Promise<void> {
            const raw = text.value;
            const k = pastedKind(raw);
            kind.textContent = k === 'empty' ? '' : t(`order.import.kind.${k}`);
            plan = null;
            use.disabled = true;
            if (k === 'empty') { planEl.innerHTML = ''; status.textContent = ''; return; }
            const mine = ++seq;
            status.textContent = t('order.import.reading');
            try {
                const p = await invoke('mod_order_import_preview', { profileId, text: raw }) as ImportPlan;
                if (mine !== seq) return;
                plan = p;
                status.textContent = '';
                renderPlan(p);
            } catch (e) {
                if (mine !== seq) return;
                planEl.innerHTML = '';
                status.textContent = t(String(e));
            }
        }

        let timer = 0;
        text.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void preview(); }, 250); });
        ov.querySelector('#oim-file')?.addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
            const f = input.files?.[0];
            if (!f) return;
            if (f.size > 2 * 1024 * 1024) { status.textContent = t('order.errTooLarge'); return; }
            const r = new FileReader();
            r.onload = () => { text.value = String(r.result || ''); void preview(); };
            r.readAsText(f);
        });
        ov.querySelector('#oim-cancel')?.addEventListener('click', close);
        use.addEventListener('click', () => {
            if (!plan?.changed) return;
            result = plan.result.slice();
            close();
        });
        if (prefill) { text.value = prefill; void preview(); }
        text.focus();
    });
}
