// integrity-report.ts — the two small integrity surfaces outside the Integrity dialog, drawn in
// its language (css/integrity.css, the .shc-* classes of features/settings/integrity-center.ts):
//
//   · the report of ONE check: a mod's files against its hashes (mod details → Verify), or the
//     game folder against the active mods (Library → Verify integrity). Static #modal-integrity.
//   · the question asked when a mod without a hash is enabled (mods-list.ts, MISSING_SHA).
//
// Both used to be inline-styled one-offs: a green paragraph or a list of "> path" lines on a
// black wash, and a generic yes/no confirm whose Escape meant "enable anyway". Same states,
// same colours and the same file lists as the dialog now, so a mismatch looks like a mismatch
// wherever it is reported.

import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { uiIcon } from '../../ui/icons.js';
import { openModal } from '../../ui/modal-shell.js';
import { ensureIntegrityCss } from '../settings/integrity-center.js';

const tr = (key: string, en: string): string => { const v = t(key); return v && v !== key ? v : en; };
const MAX = 200;

/** What get_mod_integrity returns (Rust serialises camelCase; older callers read is_valid). */
export interface ModReport { missing: string[]; modified: string[]; added: string[]; total?: number; isValid?: boolean; is_valid?: boolean }

/** Valid or not, whichever spelling the report used; with neither, the lists decide. */
export function reportIsValid(r: ModReport): boolean {
    if (typeof r.isValid === 'boolean') return r.isValid;
    if (typeof r.is_valid === 'boolean') return r.is_valid;
    return !(r.missing?.length || r.modified?.length || r.added?.length);
}

function issues(cls: string, title: string, items: string[]): string {
    if (!items.length) return '';
    return `<div class="shc-issues ${cls}"><div class="shc-issues-h">${escHtml(title)} <b>${items.length}</b></div><ul>`
        + items.slice(0, MAX).map((f) => `<li><code>${escHtml(f)}</code></li>`).join('')
        + (items.length > MAX ? `<li class="shc-more">${escHtml(tr('sha.andMore', 'and {n} more').replace('{n}', String(items.length - MAX)))}</li>` : '')
        + '</ul></div>';
}

const tile = (cls: string, label: string, n: number) => `<div class="shc-tile is-static ${cls}${n ? '' : ' is-zero'}">`
    + `<span class="shc-tile-top"><span class="shc-tile-label">${escHtml(label)}</span></span><b class="shc-tile-n">${n}</b></div>`;

const okBanner = (title: string, text: string) => `<div class="shc-ok">${uiIcon('shield-check', 20)}<div><div class="shc-ok-t">${escHtml(title)}</div><div class="shc-ok-d">${escHtml(text)}</div></div></div>`;

/** One mod against its own hashes. */
export function modReportHtml(name: string, r: ModReport): string {
    const ok = reportIsValid(r);
    const pill = `<span class="shc-pill ${ok ? 'is-verified' : 'is-mismatch'}"><span class="shc-dot" aria-hidden="true"></span>${escHtml(ok ? tr('sha.state.verified', 'Verified') : tr('sha.state.mismatch', 'Mismatch'))}</span>`;
    const files = typeof r.total === 'number' ? (r.total === 1 ? tr('sha.files1', '1 file') : tr('sha.filesN', '{n} files').replace('{n}', String(r.total))) : '';
    const head = `<div class="shc-report-head">${pill}<div class="shc-report-titles"><div class="shc-report-name">${escHtml(name)}</div>${files ? `<div class="shc-report-meta">${escHtml(files)}</div>` : ''}</div></div>`;
    if (ok) return `<div class="shc shc-report">${head}${okBanner(tr('integrity.ok', 'Integrity OK'), tr('integrity.modClean', ''))}</div>`;
    return `<div class="shc shc-report">${head}
        <div class="shc-tiles is-3">${tile('is-mod', tr('sha.rep.modifiedT', 'Changed since hashed'), r.modified.length)}${tile('is-miss', tr('sha.rep.missingT', 'Missing'), r.missing.length)}${tile('is-add', tr('sha.rep.addedT', 'Added since hashed'), r.added.length)}</div>
        ${issues('is-mod', tr('sha.rep.modifiedT', 'Changed since hashed'), r.modified)}${issues('is-miss', tr('sha.rep.missingT', 'Missing'), r.missing)}${issues('is-add', tr('sha.rep.addedT', 'Added since hashed'), r.added)}
        <p class="shc-lead">${escHtml(tr('sha.about.mismatch', 'A mismatch means the mod is no longer the one that was hashed: a damaged download or disk, a file you edited, or something else that wrote there. Look at the files listed before enabling it.'))}</p>
    </div>`;
}

/** The game folder against the active mods (verify_integrity: the altered paths). */
export function gameReportHtml(altered: string[]): string {
    if (!altered.length) return `<div class="shc shc-report">${okBanner(tr('integrity.ok', 'Integrity OK'), tr('integrity.okDesc', ''))}</div>`;
    return `<div class="shc shc-report">
        <div class="shc-report-head"><span class="shc-pill is-mismatch"><span class="shc-dot" aria-hidden="true"></span>${escHtml(tr('integrity.issues', 'Issues detected'))}</span></div>
        <p class="shc-lead">${escHtml(tr('integrity.issuesDesc', ''))}</p>
        ${issues('is-mod', tr('integrity.modified', 'Modified files'), altered.map(String))}
        <p class="shc-lead">${escHtml(tr('integrity.tip', ''))}</p>
    </div>`;
}

/** Fill and open the static #modal-integrity. `center` adds "Open Integrity…" (per-mod report). */
export function showIntegrityModal(html: string, subtitle: string, center: boolean): void {
    ensureIntegrityCss();
    const modal = document.getElementById('modal-integrity');
    const content = document.getElementById('integrity-report-content');
    if (!modal || !content) return;
    content.innerHTML = html;
    const sub = document.getElementById('integrity-report-sub');
    if (sub) { sub.textContent = subtitle; sub.hidden = !subtitle; }
    const btn = document.getElementById('integrity-open-center') as HTMLButtonElement | null;
    if (btn) {
        btn.hidden = !center;
        btn.onclick = () => { modal.classList.remove('open'); void (window as any).showHashingStats?.(); };
    }
    modal.classList.add('open');
}

/**
 * Enabling a mod that has no hash (strict integrity). Resolves 'hash' (queue it, leave it off),
 * 'anyway' (enable without a baseline) or null (dismissed: nothing happens, the switch stays off).
 */
export function askMissingHash(name: string): Promise<'hash' | 'anyway' | null> {
    ensureIntegrityCss();
    return new Promise((resolve) => {
        let answer: 'hash' | 'anyway' | null = null;
        const desc = tr('mods.sha.missingDesc', 'The mod "{name}" does not have a valid SHA hash. For security reasons, it is recommended to calculate the hash before enabling.')
            .replace('{name}', name);
        const m = openModal({
            title: tr('mods.sha.missingTitle', 'Missing Integrity Hash'),
            icon: uiIcon('shield', 20),
            tone: 'warn',
            size: 'sm',
            className: 'shc-modal',
            body: `<div class="shc shc-report">
                <div class="shc-report-head"><span class="shc-pill is-missing"><span class="shc-dot" aria-hidden="true"></span>${escHtml(tr('sha.state.missing', 'No hash'))}</span><div class="shc-report-titles"><div class="shc-report-name">${escHtml(name)}</div></div></div>
                <p class="shc-lead">${escHtml(desc)}</p>
                <p class="shc-lead">${escHtml(tr('sha.about.limit', 'A hash proves a mod has not changed; it does not prove the mod was safe to begin with. Re-hashing accepts the files as they are now as the new reference.'))}</p>
            </div>`,
            footer: `<button type="button" class="btn btn-ghost" data-a="anyway">${escHtml(tr('mods.sha.enableAnyway', 'Enable Anyway'))}</button>
                <button type="button" class="btn btn-primary" data-a="hash">${uiIcon('reapply', 14)}<span>${escHtml(tr('mods.sha.hashFirst', 'Hash it first'))}</span></button>`,
            closeLabel: tr('common.close', 'Close'),
            initialFocus: '[data-a="hash"]',
            onClose: () => resolve(answer),
        });
        m.dialog.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => {
            answer = b.dataset.a as 'hash' | 'anyway';
            m.close();
        }));
    });
}
