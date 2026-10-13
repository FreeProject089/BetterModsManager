// consent.ts — proof of consent, the frontend half (Rust: src-tauri/src/commands/consent_ledger.rs).
//
// Every privacy / Terms answer leaves a receipt in the local, append-only, hash-chained consent
// ledger: which document, which version, the SHA-256 of the exact text shown, the language, the
// answer (and per-category choices), when, where it was given (installer, first run, settings,
// link, import, CLI/MCP), the app version and an anonymous install id. Rust fills everything it
// can know itself (version, hash of the legal text, time, app version); the UI says what was
// answered and where.
//
// The ledger, not a localStorage flag, says whether a text was accepted. At start-up
// `prepareLaunchConsents` asks Rust what has no proof (an update from 1.0.x, an import, a changed
// text) and forgets the local "accepted" flags for it, so the start-up window asks again.
//
// Receipts leave the machine only when telemetry consent is on, or when the user presses « Send
// to the server » in My consents (Rust enforces it: consent_sync).

import { invoke } from './api.js';
import { t, getLang } from './i18n.js';
import { getLinks } from './links-config.js';
import { bcUsesV2 } from './bc-client.js';
import { escHtml } from './utils.js';
import { openModal } from '../ui/modal-shell.js';

export type ConsentDoc = 'tos' | 'privacy' | 'telemetry' | 'crash_reports';
export type ConsentChoice = 'accepted' | 'declined' | 'custom' | 'withdrawn' | 'reset';
/** `app` = a dialog inside BMM: Rust resolves it to `first_run` or `reconsent` from the ledger. */
export type ConsentSource = 'app' | 'installer' | 'settings' | 'link' | 'api' | 'cli' | 'mcp' | 'import';

export interface ConsentReceiptInput {
    doc: ConsentDoc;
    choice: ConsentChoice;
    source?: ConsentSource;
    lang?: string;
    categories?: Record<string, boolean>;
    /** The consent text exactly as it was on screen (telemetry dialogs). Hashed in Rust, never stored. */
    shownText?: string;
    note?: string;
}

/** The local keys the start-up window reads to decide whether the Terms / the Policy are due. */
const LEGAL_KEYS: Record<'tos' | 'privacy', string[]> = {
    tos: ['bmm_eula_accepted', 'bmm_eula_accepted_hash'],
    privacy: ['bmm_privacy_seen', 'bmm_privacy_seen_hash'],
};

/** The language the texts are shown in (the legal dialogs ask Rust for the file in this one). */
function currentLang(): string {
    try { return getLang() || ''; } catch { return ''; }
}

/** Record one answer. Best effort: the answer itself is the user's, the receipt our record of it;
 *  a failed write is logged, never turned into a refusal. Then offers the pending receipts to
 *  the server (sent only if telemetry consent is on). */
export async function recordConsent(input: ConsentReceiptInput): Promise<unknown | null> {
    try {
        const r = await invoke('consent_record', {
            input: {
                doc: input.doc,
                choice: input.choice,
                source: input.source ?? 'app',
                lang: input.lang ?? (currentLang() || null),
                categories: input.categories ?? null,
                shownText: input.shownText ?? null,
                note: input.note ?? null,
            },
        }, { quiet: true } as any);
        void syncConsents();
        return r;
    } catch (e) {
        console.warn('[BMM] consent receipt not written', e);
        return null;
    }
}

/** Before the start-up window: what has no receipt for the text in force is asked again. */
export async function prepareLaunchConsents(): Promise<string[]> {
    try {
        const r: any = await invoke('consent_prepare_launch', {}, { quiet: true } as any);
        const reask: string[] = Array.isArray(r?.reask) ? r.reask : [];
        for (const doc of ['tos', 'privacy'] as const) {
            if (!reask.includes(doc)) continue;
            for (const k of LEGAL_KEYS[doc]) { try { localStorage.removeItem(k); } catch { /* private mode */ } }
        }
        return reask;
    } catch {
        // An older backend: nothing to compare with, keep the local flags (do not nag).
        return [];
    }
}

/** Whether the ledger holds an accepting receipt for the version of `doc` in force. */
export async function hasProof(doc: ConsentDoc): Promise<boolean> {
    try {
        const r: any = await invoke('consent_status', {}, { quiet: true } as any);
        return r?.docs?.[doc]?.proof === true;
    } catch { return false; }
}

/** Send the receipts the server does not have yet. Rust refuses unless telemetry consent is on
 *  or `force` (the user pressed « Send to the server »). */
export async function syncConsents(force = false): Promise<any> {
    const links = getLinks();
    // BetterCommunity v2 consent ledger, only when app.cfg selects v2 (BCApiVersion=v2). Same
    // permission as the telemetry copy, enforced again in Rust (bc_v2.rs): telemetry consent on,
    // or `force` from « Send to the server ». Its result never replaces the telemetry one.
    if (bcUsesV2()) {
        const appKey = String((links as unknown as Record<string, unknown>).bc_v2_app_key || '');
        void invoke('consent_sync_bc_v2', { appKey, force }, { quiet: true } as any).catch(() => {});
    }
    try {
        return await invoke('consent_sync', { endpoint: links.analytics_endpoint || '', apiKey: links.analytics_key || '', force }, { quiet: true } as any);
    } catch (e) {
        return { sent: 0, error: String(e) };
    }
}

// Literal keys only (check-i18n-dynamic): one entry per value the ledger can hold.
const DOC_LABEL: Record<string, string> = {
    tos: 'consent.doc.tos', privacy: 'consent.doc.privacy', telemetry: 'consent.doc.telemetry', crash_reports: 'consent.doc.crash_reports',
};
const CHOICE_LABEL: Record<string, string> = {
    accepted: 'consent.choice.accepted', declined: 'consent.choice.declined', custom: 'consent.choice.custom',
    withdrawn: 'consent.choice.withdrawn', reset: 'consent.choice.reset',
};
const SOURCE_LABEL: Record<string, string> = {
    installer: 'consent.source.installer', 'installer-cli': 'consent.source.installer_cli', first_run: 'consent.source.first_run', reconsent: 'consent.source.reconsent',
    settings: 'consent.source.settings', link: 'consent.source.link', api: 'consent.source.api', cli: 'consent.source.cli',
    mcp: 'consent.source.mcp', import: 'consent.source.import',
};

function label(key: string | undefined, fallback: string, params: Record<string, string> = {}): string {
    if (!key) return fallback;
    const v = t(key, params);
    return v && v !== key ? v : fallback;
}

let _cssDone = false;
function ensureCss(): void {
    if (_cssDone) return;
    _cssDone = true;
    const st = document.createElement('style');
    st.textContent = `
.consent-ledger-modal .consent-summary{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;font-size:12px;color:var(--text-secondary);margin:6px 0 12px}
.consent-ledger-modal .consent-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.consent-ledger-modal .consent-row{border:1px solid var(--border);border-radius:10px;padding:8px 12px;background:var(--bg-secondary)}
.consent-ledger-modal .consent-row-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.consent-ledger-modal .consent-at{margin-left:auto;font-size:11px;color:var(--text-muted)}
.consent-ledger-modal .consent-row-meta{font-size:11px;color:var(--text-muted);margin-top:2px;overflow-wrap:anywhere}
.consent-ledger-modal .consent-row-hash{font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-top:2px;overflow-wrap:anywhere}
.consent-ledger-modal .consent-choice{font-size:11px;font-weight:600;color:var(--accent)}`;
    document.head.appendChild(st);
}

/** « My consents » (Settings → Privacy): every receipt, newest first, the chain check, export and
 *  « Send to the server ». */
export async function openMyConsents(): Promise<void> {
    let data: any;
    try { data = await invoke('consent_list'); } catch (e) { (window as any).toast?.(String(e), 'error'); return; }
    const receipts: any[] = Array.isArray(data?.receipts) ? data.receipts : [];
    const verify = data?.verify || {};
    const sync = data?.sync || {};

    const chain = verify.ok
        ? `<span class="kit-badge kit-badge-success">${escHtml(label('consent.chainOk', 'Chain intact'))}</span>`
        : `<span class="kit-badge kit-badge-danger">${escHtml(label('consent.chainBroken', 'Chain broken'))}: ${escHtml(String(verify.first_break?.reason || '?'))} (#${escHtml(String(verify.first_break?.seq ?? '?'))})</span>`;
    const rows = receipts.map((r) => {
        const cats = r.categories && Object.keys(r.categories).length
            ? Object.entries(r.categories).map(([k, v]) => `${escHtml(k)}=${v ? '1' : '0'}`).join(' · ')
            : '';
        const doc = label(DOC_LABEL[r.doc], r.doc);
        return `<li class="consent-row">
            <div class="consent-row-head"><b>${escHtml(doc)}</b> <span class="consent-choice" data-choice="${escHtml(r.choice)}">${escHtml(label(CHOICE_LABEL[r.choice], r.choice))}</span>
                <span class="consent-at">${escHtml(new Date(r.at).toLocaleString())}</span></div>
            <div class="consent-row-meta">#${escHtml(String(r.seq))} · ${escHtml(label(SOURCE_LABEL[r.source], r.source))} · v${escHtml(r.version || '?')} · ${escHtml(r.lang || '?')} · BMM ${escHtml(r.app_version || '?')}</div>
            ${cats ? `<div class="consent-row-meta">${cats}</div>` : ''}
            ${r.text_sha256 ? `<div class="consent-row-hash" title="SHA-256">${escHtml(r.text_sha256)}</div>` : ''}
            ${r.note ? `<div class="consent-row-meta">${escHtml(r.note)}</div>` : ''}
        </li>`;
    }).join('');
    const sent = Number(sync.sent_seq || 0);
    const total = receipts.length ? Number(receipts[0].seq || receipts.length) : 0;
    const body = `
        <p class="modal-message">${escHtml(label('consent.intro', 'Every answer you gave about the Terms, the Privacy Policy and telemetry, with the exact version and text you answered. Kept on this PC in an append-only, tamper-evident file.'))}</p>
        <div class="consent-summary">${chain}
            <span class="consent-install">${escHtml(label('consent.installId', 'Anonymous install id'))}: <code>${escHtml(String(data?.install_id || ''))}</code></span>
            <span class="consent-sync">${escHtml(label('consent.serverCopy', 'On the server'))}: ${sent} / ${total}${sync.last_error ? `: ${escHtml(String(sync.last_error))}` : ''}</span>
        </div>
        ${rows ? `<ol class="consent-list">${rows}</ol>` : `<p class="modal-message">${escHtml(label('consent.empty', 'No answer recorded yet.'))}</p>`}`;
    ensureCss();
    const m = openModal({
        title: label('consent.title', 'My consents'),
        size: 'lg',
        tall: true,
        className: 'consent-ledger-modal',
        closeLabel: t('common.close') || 'Close',
        body,
        footer: `<button type="button" class="btn btn-ghost" id="consent-send">${escHtml(label('consent.send', 'Send to the server'))}</button>
            <button type="button" class="btn btn-primary" id="consent-export">${escHtml(label('consent.export', 'Export (JSON)'))}</button>`,
    });
    m.q('#consent-export')?.addEventListener('click', async () => {
        const { saveFile } = await import('./api.js');
        const path = await saveFile({ defaultPath: 'bmm-consents.json', filters: [{ name: 'JSON', extensions: ['json'] }] }).catch(() => null);
        if (!path) return;
        try {
            const content = String(await invoke('consent_export'));
            await invoke('write_text_file', { path, content });
            (window as any).toast?.(label('consent.exported', 'Consent receipts exported'), 'success');
        } catch (e) { (window as any).toast?.(String(e), 'error'); }
    });
    m.q('#consent-send')?.addEventListener('click', async () => {
        const r = await syncConsents(true);
        if (r?.error) (window as any).toast?.(String(r.error), 'error');
        else if (r?.skipped === 'no_endpoint') (window as any).toast?.(label('consent.noEndpoint', 'No telemetry server is configured in this build.'), 'warning');
        else (window as any).toast?.(label('consent.sent', `Receipts sent: ${r?.sent ?? 0}`, { n: String(r?.sent ?? 0) }), 'success');
        m.close();
    });
}
