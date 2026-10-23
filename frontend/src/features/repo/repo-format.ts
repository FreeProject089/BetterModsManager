// The FORMAT of a repo folder's repo.json, on the Server Repo page: a badge that says
// « format 1.0 » or « legacy 0.3 — convert », and the dialog that converts it.
//
// Everything is decided in Rust (commands/repo_format.rs + repo_convert.rs): detection, the
// plan, the re-hash, the backup, the signature. This draws what it returns. The dialog always
// runs a DRY RUN first and shows it — what will be added, which hashes were wrong, which files
// are missing, whether the author id changes — and writes only on a second, explicit click.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, formatBytes } from '../../core/utils.js';
// window.toast, not ui/app.js: repo.ts imports this module and ui/app.ts imports repo.ts
// (through profiles.ts), so a static import here closed one more import cycle.
const toast = (msg: string, type = 'info', duration?: number): void => {
    try { (window as any).toast?.(msg, type, duration); } catch { /* the shell is not up */ }
};
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

/** One `bmm://repo-validate-progress` event: the hashing of Validate and of a conversion. */
export interface HashProgress { runId: string; ticket: number; phase: string; done: number; total: number; bytesDone: number; bytesTotal: number; current: string }

/** The markup of a run panel; `paintRun` fills it. */
export function runPanelHtml(): string {
    return `<div class="rp-run" role="status" aria-live="polite">
        <div class="rp-run-top"><span class="rp-run-phase" data-run="phase"></span><span class="rp-run-count rp-mono" data-run="count"></span></div>
        <div class="rp-run-bar is-indeterminate"><span data-run="bar"></span></div>
        <div class="rp-run-file rp-mono" data-run="file"></div>
    </div>`;
}

/** Paint a running hash into a run panel (`[data-run=phase|count|bar|file]` inside `root`). */
export function paintRun(root: ParentNode, p: HashProgress | null, phaseKey: string): void {
    const q = (sel: string) => root.querySelector<HTMLElement>(sel);
    const bar = q('[data-run="bar"]');
    const known = !!p && p.total > 0;
    bar?.parentElement?.classList.toggle('is-indeterminate', !known);
    if (bar) {
        const ratio = known ? (p!.bytesTotal ? p!.bytesDone / p!.bytesTotal : p!.done / p!.total) : 0;
        bar.style.width = known ? `${Math.min(100, Math.round(ratio * 100))}%` : '';
    }
    const phase = q('[data-run="phase"]');
    if (phase) phase.textContent = t(phaseKey);
    const count = q('[data-run="count"]');
    if (count) count.textContent = known ? t('repo.validate.progress', { done: String(p!.done), total: String(p!.total), size: formatBytes(p!.bytesDone), of: formatBytes(p!.bytesTotal) }) : '';
    const file = q('[data-run="file"]');
    if (file) file.textContent = p?.current || '';
}

/** Listen to the hashing progress of one run; returns the unlisten. */
export async function listenRun(runId: string, on: (p: HashProgress) => void): Promise<() => void> {
    const ev = (window as any).__TAURI__?.event;
    if (!ev?.listen) return () => {};
    return ev.listen('bmm://repo-validate-progress', (e: { payload: HashProgress }) => {
        if (e.payload?.runId === runId) on(e.payload);
    });
}

/** Plan, show, then convert on confirmation. Resolves when the dialog is gone: `true` when
 *  repo.json was written. The dialog opens AT ONCE, with the hashing progress in it: the dry
 *  run re-hashes every file and used to leave the page silent until it was done. */
export function openConvertDialog(path: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        let written = false;
        let running = '';
        let unlisten: () => void = () => {};
        const m = openModal({
            title: t('repo.convert.title'),
            subtitle: path,
            icon: uiIcon('reapply', 18),
            tone: 'accent',
            size: 'lg',
            className: 'rp-cv',
            body: runPanelHtml(),
            footer: `<button type="button" class="btn btn-secondary" data-cv="cancel">${escHtml(t('common.cancel'))}</button>`,
            closeLabel: t('common.close'),
            onClose: () => {
                unlisten();
                // Closed while hashing: stop the work nobody is waiting for any more.
                if (running) void invoke('repo_validate_cancel', { runId: running }).catch(() => {});
                resolve(written);
            },
        });
        const wire = () => m.q('[data-cv="cancel"]')?.addEventListener('click', () => m.close());
        wire();
        paintRun(m.body, null, 'repo.convert.phasePlan');

        const runId = `c${Date.now().toString(36)}`;
        void (async () => {
            unlisten = await listenRun(runId, (p) => paintRun(m.body, p, 'repo.convert.phasePlan'));
            running = runId;
            let plan: ConvertReport;
            try {
                plan = await invoke('repo_format_convert', { args: { path, dryRun: true, rehash: true, sign: true }, runId }) as ConvertReport;
            } catch (e) {
                running = '';
                if (!m.overlay.isConnected) return;
                if (/repo\.cancelled/.test(String(e))) { m.close(); return; }
                m.body.innerHTML = `<div class="rp-note rp-tone--bad">${uiIcon('error', 14)}<span class="rp-note-txt">${escHtml(errText(e))}</span></div>`;
                return;
            }
            running = '';
            if (!m.overlay.isConnected) return;
            if (plan.upToDate) {
                m.close();
                toast(t('repo.convert.upToDate', { v: plan.to }), 'success');
                void paintRepoFormat(path);
                return;
            }
            const tile = m.header.querySelector<HTMLElement>('.bms-icon');
            if (tile && (plan.signerChanges || plan.counts.filesMissing > 0)) tile.classList.add('bms-icon--warn');
            m.body.innerHTML = planBody(plan);
            if (m.footer) {
                // Cancel, then the one action, last — the house footer order.
                m.footer.innerHTML = `
                    <button type="button" class="btn btn-secondary" data-cv="cancel">${escHtml(t('common.cancel'))}</button>
                    <button type="button" class="btn btn-primary" data-cv="go">${uiIcon('reapply', 14)}<span>${escHtml(t(plan.from.status === 'current' ? 'repo.convert.goRepair' : 'repo.convert.go', { v: plan.to }))}</span></button>`;
                wire();
            }
            const go = m.q<HTMLButtonElement>('[data-cv="go"]')!;
            go.addEventListener('click', async () => {
                const sign = !!m.q<HTMLInputElement>('#rp-cv-sign')?.checked;
                go.disabled = true;
                const run = document.createElement('div');
                run.innerHTML = runPanelHtml();
                m.body.prepend(run);
                paintRun(run, null, 'repo.convert.phaseWrite');
                const runId2 = `${runId}w`;
                unlisten();
                unlisten = await listenRun(runId2, (p) => paintRun(run, p, 'repo.convert.phaseWrite'));
                running = runId2;
                try {
                    const done = await invoke('repo_format_convert', { args: { path, dryRun: false, rehash: true, sign }, runId: runId2 }) as ConvertReport;
                    running = '';
                    written = done.written;
                    m.close();
                    toast(t(done.signature === 'signed' ? 'repo.convert.doneSigned' : 'repo.convert.doneUnsigned', { v: done.to, backup: (done.backupPath || '').split(/[\\/]/).pop() || '' }), 'success', 7000);
                    void paintRepoFormat(path);
                } catch (e) {
                    running = '';
                    run.remove();
                    go.disabled = false;
                    if (!/repo\.cancelled/.test(String(e))) toast(errText(e), 'error');
                }
            });
        })();
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
