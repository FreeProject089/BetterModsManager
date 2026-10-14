// bc-v2-legal.ts — BMM's Terms and Privacy Policy as BetterCommunity v2 publishes them
// (`bmm-terms`, `bmm-privacy`, ADR 0018 §4), and asking again when they change there.
//
// v2 mode only. The start-up window keeps asking for the texts this build ships, with their local
// receipts (consent.ts). This adds one case: v2 publishes ANOTHER version than the one shipped
// (the owner updated a text between two releases). Then the person is shown that version's title,
// version and page, and answers Accept, Refuse or Later. Accept and Refuse leave a receipt in the
// v2 consent ledger (`kind: legal`, `source: reaccept`, the revision shown), kept on this PC as the
// server answered it (bc_v2.rs `bc_v2_legal_answer`, listed in « My consents »). Later records
// nothing and asks again at the next start.
import { invoke } from './api.js';
import { t, getLang } from './i18n.js';
import { escHtml, escAttr } from './utils.js';
import { openModal } from '../ui/modal-shell.js';

interface LegalDoc {
    doc: 'tos' | 'privacy';
    document: string;
    state: 'unpublished' | 'current' | 'accepted' | 'pending';
    shipped: string | null;
    text: { title: string; version: string; revision: string; language: string; url: string } | null;
}

let _shown = false;

/** Ask v2 where BMM's texts stand; prompt for the pending ones. Silent when nothing is pending,
 *  in v1 mode, or offline. Once per session. */
export async function checkBcV2Legal(): Promise<void> {
    if (_shown) return;
    let r: any;
    try { r = await invoke('bc_v2_legal_status', { lang: getLang() || 'en' }, { quiet: true }); } catch { return; }
    const pending: LegalDoc[] = (Array.isArray(r?.documents) ? r.documents : []).filter((d: LegalDoc) => d.state === 'pending' && d.text);
    if (!pending.length) return;
    _shown = true;
    promptLegal(pending);
}

function label(doc: LegalDoc): string {
    return doc.doc === 'tos' ? t('bcv2.legal.terms') : t('bcv2.legal.privacy');
}

function promptLegal(docs: LegalDoc[]): void {
    const rows = docs.map((d, i) => `
        <li class="bcv2-legal-row">
            <b>${escHtml(d.text?.title || label(d))}</b>
            <div class="bcv2-legal-meta">${escHtml(t('bcv2.legal.version', { v: d.text?.version || '?' }))}${d.shipped ? ` · ${escHtml(t('bcv2.legal.shipped', { v: d.shipped }))}` : ''}</div>
            ${d.text?.url ? `<button type="button" class="btn btn-ghost btn-sm" data-bcv2-read="${i}" data-url="${escAttr(d.text.url)}">${escHtml(t('bcv2.legal.read'))}</button>` : ''}
        </li>`).join('');
    const m = openModal({
        title: t('bcv2.legal.title'),
        size: 'md',
        dismissible: false,
        body: `<p class="modal-message">${escHtml(t('bcv2.legal.intro'))}</p>
            <ul class="bcv2-legal-list" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px">${rows}</ul>
            <p class="modal-message" style="font-size:12px;color:var(--text-muted)">${escHtml(t('bcv2.legal.receipt'))}</p>`,
        footer: `<button type="button" class="btn btn-ghost" id="bcv2-legal-later">${escHtml(t('bcv2.legal.later'))}</button>
            <button type="button" class="btn btn-ghost" id="bcv2-legal-refuse">${escHtml(t('bcv2.legal.refuse'))}</button>
            <button type="button" class="btn btn-primary" id="bcv2-legal-accept">${escHtml(t('bcv2.legal.accept'))}</button>`,
    });
    m.dialog.querySelectorAll<HTMLElement>('[data-bcv2-read]').forEach((b) => b.addEventListener('click', () => {
        const url = b.dataset.url || '';
        if (/^https?:\/\//i.test(url)) (window as any).openExternal?.(url);
    }));
    const answer = async (choice: 'accepted' | 'refused'): Promise<void> => {
        let outdated = false;
        let failed = false;
        for (const d of docs) {
            try {
                const r: any = await invoke('bc_v2_legal_answer', { document: d.document, choice, lang: getLang() || 'en' }, { quiet: true });
                if (r?.state === 'outdated') outdated = true;
                if (r?.state === 'refused') failed = true;
            } catch { failed = true; }
        }
        m.close();
        const toast = (window as any).toast;
        if (outdated) { _shown = false; void checkBcV2Legal(); return; }
        if (failed) toast?.(t('bcv2.legal.failed'), 'warning');
        else toast?.(choice === 'accepted' ? t('bcv2.legal.accepted') : t('bcv2.legal.refused'), choice === 'accepted' ? 'success' : 'info');
    };
    m.q('#bcv2-legal-accept')?.addEventListener('click', () => { void answer('accepted'); });
    m.q('#bcv2-legal-refuse')?.addEventListener('click', () => { void answer('refused'); });
    m.q('#bcv2-legal-later')?.addEventListener('click', () => m.close());
}

/** The v2 legal answers kept on this PC, as rows for « My consents ». */
export async function bcV2LegalRows(): Promise<string> {
    let r: any;
    try { r = await invoke('bc_v2_legal_answers', {}, { quiet: true }); } catch { return ''; }
    const answers: any[] = Array.isArray(r?.answers) ? r.answers.slice().reverse() : [];
    if (!answers.length) return '';
    const rows = answers.map((a) => `<li class="consent-row">
        <div class="consent-row-head"><b>${escHtml(String(a.document || ''))}</b> <span class="consent-choice">${escHtml(a.choice === 'accepted' ? t('consent.choice.accepted') : t('bcv2.legal.refusedShort'))}</span>
            <span class="consent-at">${escHtml(a.at ? new Date(a.at).toLocaleString() : '')}</span></div>
        <div class="consent-row-meta">v${escHtml(String(a.version || '?'))} · ${escHtml(String(a.language || '?'))} · ${escHtml(t('bcv2.legal.revision', { r: String(a.revision || '?') }))}</div>
        ${a.server_hash ? `<div class="consent-row-hash" title="SHA-256">${escHtml(String(a.server_hash))}</div>` : ''}
    </li>`).join('');
    return `<h4 style="margin:14px 0 6px">${escHtml(t('bcv2.legal.ledgerTitle'))}</h4><ol class="consent-list">${rows}</ol>`;
}
