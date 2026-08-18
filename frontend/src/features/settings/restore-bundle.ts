// Putting a `.DATABMM` back.
//
// Export could write one and nothing could read it, so the archive was a backup you restored
// by opening it in a zip tool. This is the other half.
//
// The screen exists because of one asymmetry: exporting is safe and restoring is not. So
// nothing is written until you have SEEN what is in the file — its sections, their sizes,
// whether it is still the archive BMM wrote — and ticked what you want back. Rust does the
// looking (`inspect_data_bundle`) without unpacking anything.
//
// Built with DOM calls, not interpolated markup: the section names and the author id come out
// of a file somebody else may have written.

import { t } from '../../core/i18n.js';
import { invoke, pickFile } from '../../core/api.js';
import { showConfirm } from '../../ui/confirm.js';
import { recordNotification } from '../../ui/notification-center.js';

interface BundleSection { section: string; files: number; bytes: number; restorable: boolean }
interface BundleInfo {
    path: string;
    appVersion: string | null;
    created: string | null;
    signature: 'valid' | 'tampered' | 'malformed' | 'unsigned';
    authorId: string | null;
    sections: BundleSection[];
}
interface RestoreResult {
    restored: string[]; files: number; skipped: string[];
    backupOfPrevious: string | null;
    extras: Record<string, unknown> | null;
    navbar: unknown | null;
}

const OVERLAY_ID = 'bmm-restore-bundle';

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** A section's name in the reader's language; the archive's own key is the fallback, because a
 *  future BMM may write a section this one has no word for. */
const sectionLabel = (key: string) => t(`restore.s.${key}`, {}) === `restore.s.${key}` ? key : t(`restore.s.${key}`);

export async function openRestoreBundle(): Promise<void> {
    const path = await pickFile([{ name: 'BMM data bundle', extensions: ['DATABMM'] }]).catch(() => null);
    if (!path) return;

    let info: BundleInfo;
    try {
        info = await invoke('inspect_data_bundle', { path }) as BundleInfo;
    } catch (e) {
        (window as any).toast?.(t('restore.unreadable', { error: String(e) }), 'error');
        return;
    }

    document.getElementById(OVERLAY_ID)?.remove();
    const overlay = el('div', 'modal-overlay');
    overlay.id = OVERLAY_ID;
    const modal = el('div', 'modal');

    const head = el('div', 'modal-header');
    head.appendChild(el('h3', '', t('restore.title')));
    modal.appendChild(head);

    const body = el('div', 'modal-body');

    // What this file is, before what it contains. An archive from another machine or another
    // year is a normal thing to restore and an abnormal thing to restore by accident.
    const meta = el('div', 'restore-meta');
    meta.appendChild(el('div', 'restore-path', info.path));
    if (info.created || info.appVersion) {
        meta.appendChild(el('div', 'restore-when', t('restore.written', {
            when: info.created ? new Date(info.created).toLocaleString() : '—',
            version: info.appVersion || '—',
        })));
    }
    body.appendChild(meta);

    // The signature, stated in the words that match what it means. UNSIGNED is not a warning:
    // every archive written before signing existed is unsigned. TAMPERED is.
    const sig = el('div', `restore-sig ${info.signature}`);
    sig.textContent = t(`restore.sig.${info.signature}`);
    if (info.authorId) sig.appendChild(el('span', 'restore-author', ` ${info.authorId.slice(0, 16)}…`));
    body.appendChild(sig);

    // The sections, each a checkbox. Nothing is ticked by default — a restore dialog that
    // arrives pre-armed is one you can confirm without reading.
    const list = el('div', 'restore-list');
    const boxes: HTMLInputElement[] = [];
    for (const s of info.sections) {
        const row = el('label', `restore-row${s.restorable ? '' : ' off'}`);
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = s.section;
        cb.disabled = !s.restorable;
        boxes.push(cb);
        row.appendChild(cb);

        const txt = el('div', 'restore-row-txt');
        txt.appendChild(el('div', 'restore-row-title', sectionLabel(s.section)));
        txt.appendChild(el('div', 'restore-row-sub',
            t('restore.count', { n: String(s.files), size: mb(s.bytes) })));
        // The destructive one says so where it is ticked, not in a dialog afterwards.
        if (s.section === 'app_data.json') {
            txt.appendChild(el('div', 'restore-row-warn', t('restore.replaceWarn')));
        }
        if (!s.restorable) {
            txt.appendChild(el('div', 'restore-row-sub', t('restore.notRestorable')));
        }
        row.appendChild(txt);
        list.appendChild(row);
    }
    body.appendChild(list);
    modal.appendChild(body);

    const foot = el('div', 'modal-footer');
    const cancel = el('button', 'btn btn-ghost', t('common.cancel')) as HTMLButtonElement;
    cancel.type = 'button';
    cancel.addEventListener('click', () => overlay.remove());

    const go = el('button', 'btn btn-danger', t('restore.go')) as HTMLButtonElement;
    go.type = 'button';
    go.disabled = true;
    const sync = () => { go.disabled = !boxes.some((b) => b.checked && !b.disabled); };
    boxes.forEach((b) => b.addEventListener('change', sync));

    go.addEventListener('click', async () => {
        const sections = boxes.filter((b) => b.checked && !b.disabled).map((b) => b.value);
        const replacing = sections.includes('app_data.json');
        // Two confirmations only for the one that cannot be undone by re-ticking a box.
        const ok = await showConfirm(
            t('restore.confirmTitle'),
            replacing ? t('restore.confirmReplace') : t('restore.confirmBody', { n: String(sections.length) }),
        );
        if (!ok) return;

        go.disabled = true;
        go.textContent = t('restore.working');
        try {
            const r = await invoke('restore_data_bundle', { args: { path: info.path, sections } }) as RestoreResult;
            // localStorage is the frontend's to write — Rust hands these back rather than
            // guessing at a browser store it cannot reach.
            if (r.extras && typeof r.extras === 'object') {
                for (const [k, v] of Object.entries(r.extras)) {
                    try { if (typeof v === 'string') localStorage.setItem(k, v); } catch { /* private mode */ }
                }
            }
            if (r.navbar) {
                try { localStorage.setItem('bmm_navbar_config', JSON.stringify(r.navbar)); } catch { /* private mode */ }
            }
            overlay.remove();

            // The record has to OUTLIVE the reload, and a toast does not.
            //
            // Worth being precise about what protects it, because the obvious answer is
            // wrong. `extras` above is a localStorage blob from the archive and it contains
            // the notification centre's own key — but the centre holds an in-memory cache and
            // writes it back on a 400 ms debounce, so whatever is in memory wins a moment
            // later whichever order these two run in. The archive's old history is discarded
            // either way.
            //
            // Recording after extras is still the right order: it is correct on purpose
            // rather than by a timing accident, and it stays correct if that debounce ever
            // goes away.
            //
            // toast() records what it shows, so the summary is toasted (short, transient) and
            // the DETAIL is recorded directly, without a second toast: the backup path is far
            // too long for a bubble and is exactly the thing you go looking for tomorrow.
            (window as any).toast?.(t('restore.done', { n: String(r.files) }), 'success');
            recordNotification(
                t('restore.notif', {
                    n: String(r.files),
                    sections: (r.restored || []).map((k) => sectionLabel(k)).join(', ') || '—',
                }) + (r.backupOfPrevious ? ` ${t('restore.previousAt', { path: r.backupOfPrevious })}` : ''),
                'info',
                'Restore',
            );
            if (r.backupOfPrevious) {
                (window as any).toast?.(t('restore.previousAt', { path: r.backupOfPrevious }), 'info', 12000);
            }
            // A reload, because half this app reads its state at boot. Delayed so both
            // messages are readable first — and long enough for the centre's 400 ms debounced
            // save to have run, or the entry this whole block exists for would not survive it.
            setTimeout(() => window.location.reload(), 3000);
        } catch (e) {
            go.disabled = false;
            go.textContent = t('restore.go');
            (window as any).toast?.(t('restore.failed', { error: String(e) }), 'error');
        }
    });

    foot.appendChild(cancel);
    foot.appendChild(go);
    modal.appendChild(foot);
    overlay.appendChild(modal);
    document.getElementById('app-window-outer')?.appendChild(overlay);
}
