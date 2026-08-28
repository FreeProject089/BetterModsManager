import { t } from '../core/i18n.js';
import { raiseAboveAll } from './layer.js';

// One field, one question, one answer — and the reason it is not in features/repo any more.
//
// It was written for a repo download password and grew a `kind: 'text'` for asking about
// things that are not secrets, which is what it actually is: the app's one-field dialog.
// Living in features/repo/repo-sync.ts made that a lie the module graph could see. core/
// source-fetch has to ask for a password when a source answers 401, so it imported a REPO
// FEATURE from core — and repo-sync pulls in ui/app, profiles, mod-updates and the links
// config behind it. Measured: moving this one function took the import-cycle count from
// 100 to 93.
//
// Here it depends on `t` and on the layer helper, both leaves. Nothing else.
//
// repo-sync re-exports it, so the five callers that knew it by its old name still work.

/**
 * Ask for a password, or a passphrase.
 *
 * Three faults, one cause: it was appended to `document.body`.
 *
 * `#app-window-outer` carries `contain: paint`, so an overlay outside it dims the transparent
 * Tauri margins and the desktop behind them instead of the app — the "buggy shadow". It also
 * competes with the app frame for the top of the stack rather than sitting inside it, which
 * is why clicks went through it as though it were not there. Every other dialog in BMM is
 * mounted in the frame and raised with raiseAboveAll; this one had been written on its own.
 *
 * And it could not say the answer was wrong. It resolved, the caller failed, and the second
 * prompt looked exactly like the first — so a mistyped character read as a broken feature.
 * `error` is shown in the box, so a re-ask says why it is being asked again.
 */
export function promptRepoPassword(opts?: {
    title?: string;
    desc?: string;
    error?: string;
    /**
     * `text` when what is being asked for is not a secret.
     *
     * The same box is the right box for "type one thing and press Enter", but masking an
     * ADDRESS makes it impossible to check for the typo everybody makes in one — and it
     * signals "this is a secret" about something that is not.
     */
    kind?: 'password' | 'text';
    placeholder?: string;
    value?: string;
}): Promise<string | null> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        // Absolute INSIDE the frame, not fixed on the document: the dim belongs to the app,
        // and the rounded window corners are the app's edge.
        overlay.className = 'modal-overlay open';
        overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
        raiseAboveAll(overlay, 2000300);

        const box = document.createElement('div');
        box.className = 'modal glass';
        box.style.cssText = 'width:min(90vw,400px);padding:22px;';

        const title = document.createElement('div');
        title.textContent = opts?.title || t('repo.passwordPrompt.title') || 'Password required';
        title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:6px;color:var(--text-primary);';

        const desc = document.createElement('div');
        desc.textContent = opts?.desc || t('repo.passwordPrompt.desc')
            || 'This repository is protected. Enter its download password to continue.';
        desc.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-bottom:14px;line-height:1.5;';

        const input = document.createElement('input');
        input.type = opts?.kind === 'text' ? 'text' : 'password';
        input.className = 'input';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = opts?.value || '';
        input.placeholder = opts?.placeholder
            || (opts?.kind === 'text' ? '' : (t('repo.passwordPrompt.placeholder') || 'Download password'));
        input.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:14px;';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

        const cancel = document.createElement('button');
        cancel.className = 'btn btn-sm btn-ghost';
        cancel.textContent = t('common.cancel') || 'Cancel';

        const ok = document.createElement('button');
        ok.className = 'btn btn-sm btn-primary';
        ok.textContent = t('common.confirm') || 'Confirm';

        const done = (val: string | null) => {
            document.removeEventListener('keydown', onKey, true);
            try { overlay.remove(); } catch { /* already gone */ }
            resolve(val);
        };
        // Captured on the document, so Escape works before the input has focus and cannot be
        // swallowed by whatever is underneath.
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(null); }
        };
        document.addEventListener('keydown', onKey, true);

        cancel.onclick = () => done(null);
        // Empty is not an answer. Refusing here saves a round trip that would come back as
        // "wrong password", which is a different and misleading thing to be told.
        ok.onclick = () => { if (input.value) done(input.value); else input.focus(); };
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); if (input.value) done(input.value); }
        });

        row.append(cancel, ok);
        box.append(title, desc);
        if (opts?.error) {
            const err = document.createElement('div');
            err.textContent = opts.error;
            err.style.cssText = 'font-size:11.5px;color:var(--danger);background:color-mix(in srgb,'
                + ' var(--danger) 10%, transparent);border:1px solid color-mix(in srgb,'
                + ' var(--danger) 30%, transparent);border-radius:8px;padding:8px 10px;margin-bottom:12px;';
            box.append(err);
        }
        box.append(input, row);
        overlay.append(box);
        // Clicking the dim cancels, like every other dialog. Only the dim: a click that
        // started inside the box and drifted out while selecting text must not close it.
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(null); });
        (document.getElementById('app-window-outer') || document.body).append(overlay);
        setTimeout(() => input.focus(), 30);
    });
}
