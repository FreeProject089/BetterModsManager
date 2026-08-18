// The shared yes/no modal.
//
// Moved out of features/repo/repo.ts, where it had lived by accident: it drives
// #modal-confirm-generic and touches no repo state, but living there meant anything wanting a
// confirmation had to import a 4000-line module to get one — or write a second confirm, which
// is how the same question ends up asked two different ways.
//
// `isDanger` picks the affirmative button's colour. It defaults to TRUE: a confirm is asked
// because something is about to be hard to undo, and the safe default for a colour is the one
// that makes you read the sentence.

import { t } from '../core/i18n.js';

export const showConfirm = (title: string, message: string, isDanger = true): Promise<boolean> => {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm-generic');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const btnYes = document.getElementById('btn-confirm-yes');
        const btnCancel = document.getElementById('btn-confirm-cancel');
        const iconContainer = document.getElementById('confirm-icon-container');

        if (!modal || !btnYes || !btnCancel) return resolve(false);

        // Typed now that this is no longer inside a @ts-nocheck file: the title and message
        // elements are optional in a way the buttons are not — a confirm with no visible
        // heading is still answerable, one with no buttons is not, which is why only those
        // three abort above.
        if (titleEl) titleEl.textContent = title || t('common.confirm');
        if (messageEl) messageEl.textContent = message || "";
        
        if (isDanger) {
            btnYes.className = 'btn btn-danger';
            if (iconContainer) {
                iconContainer.style.background = 'rgba(239, 68, 68, 0.1)';
                iconContainer.style.color = 'var(--danger)';
            }
        } else {
            btnYes.className = 'btn btn-accent';
            if (iconContainer) {
                iconContainer.style.background = 'rgba(59, 130, 246, 0.1)';
                iconContainer.style.color = 'var(--accent)';
            }
        }

        const cleanup = () => {
            modal.classList.remove('open');
            btnYes.onclick = null;
            btnCancel.onclick = null;
            modal.onclick = null;
        };

        btnYes.onclick = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };
        modal.onclick = (e) => { if (e.target === modal) { cleanup(); resolve(false); } };

        modal.classList.add('open');
    });
};
