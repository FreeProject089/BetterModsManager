// Copying the name of a thing, for every kind of thing.
//
// A mod card had two copy buttons — its local id and its content id — wired by hand in
// mods-list.ts. Nothing else had either, so the answer to "which modpack is that" was to open
// the JSON, and sharing an automation meant telling somebody a number that means nothing on
// their machine.
//
// Two ids, and the difference is the point:
//
//   · the LOCAL id names it here. It goes in a `bmm://` link, an API call, a task step.
//   · the CONTENT id names WHAT IT IS. The same pack on two machines has the same one, so it
//     is the one to quote when asking somebody whether they have it.
//
// Both are offered, labelled, and never silently swapped for each other.

import { invoke } from './api.js';
import { t } from './i18n.js';
import { escHtml, escAttr } from './utils.js';


/** What kinds have a content id. Mirrors `commands::content_ids::content_id_of`. */
export type IdKind = 'modpack' | 'plugin' | 'task';

const COPY_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

/**
 * The two buttons, as markup.
 *
 * `wireCopyIds` finds them by class, so a caller only has to drop this where it fits.
 */
export function copyIdButtons(kind: IdKind, localId: string): string {
    return `<button type="button" class="btn btn-xs btn-ghost bmm-copy-id"
                data-kind="${escAttr(kind)}" data-id="${escAttr(localId)}"
                data-tooltip="${escAttr(t('copyid.localHint'))}">${COPY_SVG} ${escHtml(t('copyid.local'))}</button>
            <button type="button" class="btn btn-xs btn-ghost bmm-copy-cid"
                data-kind="${escAttr(kind)}" data-id="${escAttr(localId)}"
                data-tooltip="${escAttr(t('copyid.contentHint'))}">${COPY_SVG} ${escHtml(t('copyid.content'))}</button>`;
}

/**
 * How to tell the user something. Injected rather than imported.
 *
 * `toast` lives in ui/app.ts, which reaches every feature screen, and every feature screen
 * reaches this — so importing it here closes an import cycle, statically OR dynamically (the
 * dep-graph gate counts both, and it is right to). Every caller already has `toast`; passing
 * it costs one argument and keeps this file at the bottom of the graph.
 */
export type Notify = (message: string, kind: 'success' | 'warning' | 'error', ms: number) => void;

async function put(notify: Notify, text: string, msgKey: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        // The value itself, shortened. "Copied" alone leaves somebody wondering WHICH of the
        // two buttons they pressed, which is the whole distinction this exists to make.
        notify(`${t(msgKey)} ${text.length > 28 ? `${text.slice(0, 28)}…` : text}`, 'success', 2500);
    } catch (e) {
        notify(`${t('common.error')}: ${e}`, 'error', 6000);
    }
}

/**
 * Wire every copy button inside `host`. Idempotent: safe to call after a repaint.
 */
export function wireCopyIds(host: ParentNode, notify: Notify): void {
    host.querySelectorAll<HTMLElement>('.bmm-copy-id').forEach((btn) => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = '1';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            void put(notify, btn.dataset.id || '', 'copyid.copiedLocal');
        });
    });
    host.querySelectorAll<HTMLElement>('.bmm-copy-cid').forEach((btn) => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = '1';
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const cid = await invoke('content_id_of', {
                    kind: btn.dataset.kind, id: btn.dataset.id,
                }) as string;
                await put(notify, cid, 'copyid.copiedContent');
            } catch (err) {
                // Derived, not stored, so it can fail for a real reason: a pack whose members
                // have no fingerprints yet, a plugin that was uninstalled between paint and
                // click. Saying which beats a silent no-op on a button.
                //
                // The Rust side answers with a KEY, not a sentence — `cid.errNoPlugin`. t()
                // returns the key on a miss, so printing `err` raw would put that literal in a
                // toast in both languages. Translate it, and keep anything that is not a key
                // (a panic message, an IO error) as-is rather than swallowing it.
                const raw = String(err);
                const key = raw.split('|')[0].trim();
                const said = key.startsWith('cid.') ? t(key) : raw;
                notify(`${t('copyid.errNoContent')} ${said}`, 'warning', 8000);
            }
        });
    });
}
