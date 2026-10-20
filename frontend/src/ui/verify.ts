// verify.ts — BMM's own « are you sure? » and « type a value » dialogs, on the house shell.
//
// Why not window.confirm / alert / prompt, or core/api.ts askConfirm: in the Tauri webview the
// first three either do nothing (the dialog plugin has no `confirm` command, so the call returns
// undefined at once) or, through askConfirm → `dlg_confirm`, open a bare Windows message box:
// no theme, no translation of its buttons, no keyboard rules of the app, and it blocks the whole
// window. These two use openModal (modal-shell.ts): themed, stacked above the dialog that asked
// (the Laya dialog, a settings drawer), Escape and the dim mean Cancel, focus comes back where it
// was. scripts/check-native-dialogs.mjs keeps new native calls out of frontend/src.
//
//   confirmAction({ title, message, confirmLabel, tone })  → Promise<boolean>
//   promptText({ title, message, label, value, validate }) → Promise<string | null>
import { t } from '../core/i18n.js';
import { escHtml, escAttr } from '../core/utils.js';
import { openModal, type ModalTone } from './modal-shell.js';
import { raiseAboveAll } from './layer.js';
import { uiIcon, type IconName } from './icons.js';

export interface ConfirmOptions {
    title: string;
    /** One or two short sentences: what happens, and whether it can be undone. Text, not HTML. */
    message?: string;
    /** Extra lines shown as a short list (what will be removed, what changes). Text. */
    details?: string[];
    /** The affirmative button: a verb (« Remove », « Reset »), never « OK ». */
    confirmLabel?: string;
    cancelLabel?: string;
    /** 'danger' for what cannot be undone (red button and icon), 'warn', or 'accent' (default). */
    tone?: ModalTone;
    /** Registry icon name for the tile. Default: by tone. */
    icon?: string;
}

function toneIcon(tone: ModalTone | undefined, icon?: string): string {
    if (icon) return uiIcon(icon as IconName, 18);
    return uiIcon(tone === 'danger' ? 'delete' : tone === 'warn' ? 'warning' : 'info', 18);
}

/** Ask a yes/no question in a BMM dialog. Resolves true only on the affirmative button. */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
        let answer = false;
        const danger = opts.tone === 'danger';
        const details = (opts.details || []).filter(Boolean);
        const body = `${opts.message ? `<p class="vfy-msg">${escHtml(opts.message)}</p>` : ''}${details.length ? `<ul class="vfy-list">${details.map((d) => `<li>${escHtml(d)}</li>`).join('')}</ul>` : ''}`;
        const m = openModal({
            title: opts.title,
            icon: toneIcon(opts.tone, opts.icon),
            tone: opts.tone,
            size: 'sm',
            className: 'vfy-modal',
            closeLabel: t('common.close'),
            body,
            footer: `<button type="button" class="btn btn-ghost" data-vfy="no">${escHtml(opts.cancelLabel || t('common.cancel'))}</button>
                <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-vfy="yes">${escHtml(opts.confirmLabel || t('common.confirm'))}</button>`,
            // The safe answer has the focus: Enter on an unread question must not destroy anything.
            initialFocus: danger ? '[data-vfy="no"]' : '[data-vfy="yes"]',
            onClose: () => resolve(answer),
        });
        raiseAboveAll(m.overlay);
        m.q('[data-vfy="no"]')?.addEventListener('click', () => { answer = false; m.close(); });
        m.q('[data-vfy="yes"]')?.addEventListener('click', () => { answer = true; m.close(); });
    });
}

export interface PromptOptions {
    title: string;
    message?: string;
    label: string;
    value?: string;
    placeholder?: string;
    multiline?: boolean;
    confirmLabel?: string;
    /** Return a message to refuse the value (shown under the field), or null to accept it. */
    validate?: (v: string) => string | null;
}

/** Ask for one value in a BMM dialog. Resolves the trimmed value, or null on Cancel. */
export function promptText(opts: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
        let answer: string | null = null;
        const field = opts.multiline
            ? `<textarea class="form-input vfy-input" id="vfy-input" rows="5" placeholder="${escAttr(opts.placeholder || '')}">${escHtml(opts.value || '')}</textarea>`
            : `<input type="text" class="form-input vfy-input" id="vfy-input" value="${escAttr(opts.value || '')}" placeholder="${escAttr(opts.placeholder || '')}" autocomplete="off" spellcheck="false">`;
        const m = openModal({
            title: opts.title,
            icon: uiIcon('edit', 18),
            size: 'sm',
            className: 'vfy-modal',
            closeLabel: t('common.close'),
            body: `${opts.message ? `<p class="vfy-msg">${escHtml(opts.message)}</p>` : ''}
                <label class="vfy-label" for="vfy-input">${escHtml(opts.label)}</label>${field}
                <p class="vfy-err" id="vfy-err" role="alert" hidden></p>`,
            footer: `<button type="button" class="btn btn-ghost" data-vfy="no">${escHtml(t('common.cancel'))}</button>
                <button type="button" class="btn btn-primary" data-vfy="yes">${escHtml(opts.confirmLabel || t('common.save'))}</button>`,
            initialFocus: '#vfy-input',
            onClose: () => resolve(answer),
        });
        raiseAboveAll(m.overlay);
        const input = m.q<HTMLInputElement | HTMLTextAreaElement>('#vfy-input')!;
        const err = m.q<HTMLElement>('#vfy-err');
        const accept = () => {
            const v = input.value.trim();
            const why = opts.validate ? opts.validate(v) : null;
            if (why) { if (err) { err.textContent = why; err.hidden = false; } input.focus(); return; }
            answer = v;
            m.close();
        };
        m.q('[data-vfy="no"]')?.addEventListener('click', () => m.close());
        m.q('[data-vfy="yes"]')?.addEventListener('click', accept);
        input.addEventListener('keydown', (e) => {
            const k = e as KeyboardEvent;
            if (k.key === 'Enter' && (!opts.multiline || k.ctrlKey)) { e.preventDefault(); accept(); }
        });
        try { if (!opts.multiline) (input as HTMLInputElement).select(); } catch { /* nothing to select */ }
    });
}
