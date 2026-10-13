// The FORMAT of a repo folder's repo.json, on the Server Repo page: a badge that says
// « format 1.0 » or « legacy 0.3 — convert », and the dialog that converts it.
//
// Everything is decided in Rust (commands/repo_format.rs + repo_convert.rs): detection, the
// plan, the re-hash, the backup, the signature. This draws what it returns. The dialog always
// runs a DRY RUN first and shows it — what will be added, which hashes were wrong, which files
// are missing, whether the author id changes — and writes only on a second, explicit click.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
import { uiIcon } from '../../ui/icons.js';
import { openModal } from '../../ui/modal-shell.js';

type FormatStatus = 'current' | 'legacy' | 'needs_conversion' | 'newer_minor' | 'too_new' | 'invalid';

export interface FormatInfo {
    version: string;
    declared: boolean;
    status: FormatStatus;
    missing: string[];
}
export interface FormatReport {
    manifestPath: string;
    info: FormatInfo;
    label: string;
    current: string;
    signed: boolean;
}
interface Change { kind: string; path: string; before?: string; after?: string }
interface ConvertReport {
    manifestPath: string;
    from: FormatInfo;
    fromLabel: string;
    to: string;
    dryRun: boolean;
    upToDate: boolean;
    written: boolean;
    backupPath: string | null;
    wasSigned: boolean;
    signature: 'signed' | 'unsigned' | 'kept';
    signerChanges: boolean;
    authorId: string | null;
    changes: Change[];
    counts: { keysAdded: number; hashesFilled: number; hashesChanged: number; filesMissing: number };
    warnings: string[];
}

/** An error from Rust is an i18n key, sometimes with `:detail` after it. */
function errText(e: unknown): string {
    const raw = String(e ?? '');
    const [key, ...rest] = raw.split(':');
    const said = t(key);
    if (said && said !== key) return rest.length ? `${said} (${rest.join(':').trim()})` : said;
    return raw;
}

/** The words for a format, in the UI's language. */
export function formatLabel(info: FormatInfo): string {
    switch (info.status) {
        case 'current':
        case 'newer_minor': return t('repo.format.label', { v: info.version });
        case 'legacy':
        case 'needs_conversion': return t('repo.format.legacy', { v: info.version });
        case 'too_new': return t('repo.format.tooNew', { v: info.version });
        default: return t('repo.format.invalid');
    }
}

function tone(status: FormatStatus): 'ok' | 'warn' | 'bad' | 'info' {
    if (status === 'current') return 'ok';
    if (status === 'legacy' || status === 'newer_minor') return 'info';
    if (status === 'needs_conversion') return 'warn';
    return 'bad';
}

function explain(r: FormatReport): string {
    switch (r.info.status) {
        case 'current': return t('repo.format.currentHint');
        case 'legacy': return t('repo.format.legacyHint', { cur: r.current });
        case 'needs_conversion': return t('repo.format.needsHint', { cur: r.current });
        case 'newer_minor': return t('repo.format.newerHint');
        case 'too_new': return t('repo.format.tooNewHint');
        default: return t('repo.format.invalidHint');
    }
}

let lastPath = '';
let seq = 0;

/** Read the folder's manifest format and paint the badge. Empty path = hide it. */
export async function paintRepoFormat(path: string): Promise<FormatReport | null> {
    const slot = document.getElementById('repo-host-format');
    lastPath = path.trim();
    const mine = ++seq;
    if (!slot) return null;
    if (!lastPath) {
        slot.hidden = true;
        slot.innerHTML = '';
        document.dispatchEvent(new CustomEvent('bmm:repo-format', { detail: null }));
        return null;
    }
    let report: FormatReport | null = null;
    let error = '';
    try { report = await invoke('repo_format_inspect', { path: lastPath }) as FormatReport; }
    catch (e) { error = errText(e); }
    if (mine !== seq) return report; // a newer folder was picked meanwhile
    slot.hidden = false;
    if (!report) {
        slot.innerHTML = `<span class="rp-fmt rp-tone--bad">${uiIcon('alert', 12)}<span>${escHtml(t('repo.format.none'))}</span></span>
            <span class="rp-fmt-why">${escHtml(error)}</span>`;
        document.dispatchEvent(new CustomEvent('bmm:repo-format', { detail: { ok: false } }));
        return null;
    }
    const st = report.info.status;
    const canConvert = st === 'legacy' || st === 'needs_conversion';
    slot.innerHTML = `
        <span class="rp-fmt rp-tone--${tone(st)}" title="${escHtml(report.manifestPath)}">
            ${uiIcon(st === 'current' ? 'check' : st === 'too_new' || st === 'invalid' ? 'alert' : 'history', 12)}
            <span>${escHtml(formatLabel(report.info))}</span>
        </span>
        <span class="rp-fmt-why">${escHtml(explain(report))}</span>
        ${canConvert ? `<button type="button" class="btn btn-secondary btn-sm rp-fmt-go" id="btn-repo-format-convert">${uiIcon('reapply', 14)}<span>${escHtml(t('repo.format.convertBtn'))}</span></button>` : ''}`;
    slot.querySelector('#btn-repo-format-convert')?.addEventListener('click', () => { void openConvertDialog(lastPath); });
    document.dispatchEvent(new CustomEvent('bmm:repo-format', { detail: { ok: st !== 'too_new' && st !== 'invalid', status: st } }));
    return report;
}

const KIND_ORDER = ['format', 'signature_removed', 'hash_changed', 'size_changed', 'file_missing', 'hash_filled', 'chunks_updated', 'key_added', 'value_normalised', 'unknown_key'];
const SHOWN = 200;

function changeRows(changes: Change[]): string {
    const sorted = [...changes].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const rows = sorted.slice(0, SHOWN).map((c) => {
        const arrow = c.before != null && c.after != null ? `${escHtml(c.before)} → ${escHtml(c.after)}`
            : c.after != null ? `+ ${escHtml(c.after)}`
            : c.before != null ? `− ${escHtml(c.before)}` : '';
        return `<li class="rp-cv-row rp-cv-${escHtml(c.kind)}"><span class="rp-cv-kind">${escHtml(t(`repo.convert.kind.${c.kind}`))}</span><code class="rp-cv-path">${escHtml(c.path)}</code><span class="rp-cv-val">${arrow}</span></li>`;
    }).join('');
    const more = sorted.length > SHOWN ? `<li class="rp-cv-more">${escHtml(t('repo.convert.more', { n: String(sorted.length - SHOWN) }))}</li>` : '';
    return `<ol class="rp-cv-list">${rows}${more}</ol>`;
}

function planBody(r: ConvertReport): string {
    const tiles = [
        [r.counts.keysAdded, t('repo.convert.cKeys'), 'info'],
        [r.counts.hashesFilled, t('repo.convert.cFilled'), 'info'],
        [r.counts.hashesChanged, t('repo.convert.cChanged'), r.counts.hashesChanged ? 'warn' : 'info'],
        [r.counts.filesMissing, t('repo.convert.cMissing'), r.counts.filesMissing ? 'bad' : 'info'],
    ].map(([n, l, k]) => `<div class="rp-sum-tile rp-tone--${k}"><b>${n}</b><span>${escHtml(String(l))}</span></div>`).join('');
    const notes: string[] = [];
    if (r.wasSigned) notes.push(t(r.signerChanges ? 'repo.convert.noteSigner' : 'repo.convert.noteResign'));
    else notes.push(t('repo.convert.noteSignNew'));
    notes.push(t('repo.convert.noteBackup'));
    // Rust words its warnings for the CLI. The two common ones are said here in the UI's
    // language (the missing-files one is already the red tile); anything else is shown as is.
    const warnings = r.warnings
        .filter((w) => !/listed in the manifest are not in the folder/.test(w))
        .map((w) => (w.startsWith('files_base_url') ? t('repo.convert.warnRemote') : w));
    const warn = warnings.length
        ? `<div class="rp-note rp-tone--warn">${uiIcon('warning', 14)}<span class="rp-note-txt">${warnings.map(escHtml).join('<br>')}</span></div>` : '';
    return `
        <p class="rp-cv-lead">${escHtml(t('repo.convert.lead', { from: formatLabel(r.from), to: r.to }))}</p>
        <div class="rp-sum-grid">${tiles}</div>
        ${r.signerChanges ? `<div class="rp-note rp-tone--warn">${uiIcon('key', 14)}<span class="rp-note-txt"><b>${escHtml(t('repo.convert.signerT'))}</b>${escHtml(t('repo.convert.signerD'))}</span></div>` : ''}
        ${warn}
        <ul class="rp-cv-notes">${notes.map((n) => `<li>${escHtml(n)}</li>`).join('')}</ul>
        <label class="checkbox-container rp-check-row"><input type="checkbox" id="rp-cv-sign" checked><span>${escHtml(t('repo.convert.optSign'))}</span></label>
        <details class="rp-fold" ${r.changes.length <= 12 ? 'open' : ''}>
            <summary class="rp-fold-h"><span>${escHtml(t('repo.convert.changes'))}</span> <span class="rp-count">${r.changes.length}</span></summary>
            ${changeRows(r.changes)}
        </details>`;
}

/** Plan, show, then convert on confirmation. */
export async function openConvertDialog(path: string): Promise<void> {
    let plan: ConvertReport;
    try {
        plan = await invoke('repo_format_convert', { args: { path, dryRun: true, rehash: true, sign: true } }) as ConvertReport;
    } catch (e) {
        toast(errText(e), 'error');
        return;
    }
    if (plan.upToDate) {
        toast(t('repo.convert.upToDate', { v: plan.to }), 'success');
        void paintRepoFormat(path);
        return;
    }
    // Cancel, then the one action, last — the house footer order.
    const footer = `
        <button type="button" class="btn btn-secondary" data-cv="cancel">${escHtml(t('common.cancel'))}</button>
        <button type="button" class="btn btn-primary" data-cv="go">${uiIcon('reapply', 14)}<span>${escHtml(t('repo.convert.go', { v: plan.to }))}</span></button>`;
    const m = openModal({
        title: t('repo.convert.title'),
        subtitle: plan.manifestPath,
        icon: uiIcon('reapply', 18),
        tone: plan.signerChanges || plan.counts.filesMissing ? 'warn' : 'accent',
        size: 'lg',
        className: 'rp-cv',
        body: planBody(plan),
        footer,
        closeLabel: t('common.close'),
    });
    m.q('[data-cv="cancel"]')?.addEventListener('click', () => m.close());
    const go = m.q<HTMLButtonElement>('[data-cv="go"]')!;
    go.addEventListener('click', async () => {
        const sign = !!m.q<HTMLInputElement>('#rp-cv-sign')?.checked;
        go.disabled = true;
        try {
            const done = await invoke('repo_format_convert', { args: { path, dryRun: false, rehash: true, sign } }) as ConvertReport;
            m.close();
            toast(t(done.signature === 'signed' ? 'repo.convert.doneSigned' : 'repo.convert.doneUnsigned', { v: done.to, backup: (done.backupPath || '').split(/[\\/]/).pop() || '' }), 'success', 7000);
            void paintRepoFormat(path);
        } catch (e) {
            go.disabled = false;
            toast(errText(e), 'error');
        }
    });
}

/** Wire the badge to the host folder field. */
export function initRepoFormat(): void {
    const input = document.getElementById('repo-host-path') as HTMLInputElement | null;
    if (!input || input.dataset.fmtWired) return;
    input.dataset.fmtWired = '1';
    input.addEventListener('input', () => { void paintRepoFormat(input.value); });
    document.addEventListener('langChanged', () => { if (lastPath) void paintRepoFormat(lastPath); });
    if (input.value) void paintRepoFormat(input.value);
}
