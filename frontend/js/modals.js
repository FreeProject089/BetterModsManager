/**
 * modals.js — Generic Modals Initialization & Global Confirms
 */

import { invoke } from './api.js';
import { t } from './i18n.js';

export function initModals() {
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.close;
            invoke('log_frontend_line', { line: `Modal closed: ${id}` });
            document.getElementById(id)?.classList.remove('open');
        });
    });

    // Support for .modal-close class anywhere inside a modal
    document.addEventListener('click', e => {
        const btn = e.target.closest('.modal-close');
        if (btn) {
            const modal = btn.closest('.modal-overlay');
            if (modal) modal.classList.remove('open');
        }
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
    });
}

// --- Global Confirmation Utility ---
window.confirmCustom = (title, message, type = 'danger', options = {}) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm-generic');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const yesBtn = document.getElementById('btn-confirm-yes');
        const noBtn = document.getElementById('btn-confirm-cancel');
        const iconContainer = document.getElementById('confirm-icon-container');

        if (!modal || !titleEl || !msgEl || !yesBtn) {
            // Fallback if modal is missing from DOM
            const ok = window.confirm(`${title}\n\n${message}`);
            resolve(ok);
            return;
        }

        titleEl.textContent = title;
        msgEl.innerHTML = message;

        // Button Labels
        const yesLabel = options.yesLabel || t('common.confirm') || 'CONFIRMER';
        const noLabel = options.noLabel || t('common.cancel') || 'Annuler';

        yesBtn.textContent = yesLabel;
        noBtn.textContent = noLabel;

        // Handle i18n attributes
        if (options.yesLabel) yesBtn.removeAttribute('data-i18n');
        else yesBtn.setAttribute('data-i18n', 'common.confirm');

        if (options.noLabel) noBtn.removeAttribute('data-i18n');
        else noBtn.setAttribute('data-i18n', 'common.cancel');

        // Styling based on type
        if (type === 'danger') {
            yesBtn.className = 'btn btn-danger';
            iconContainer.style.background = 'rgba(239, 68, 68, 0.1)';
            iconContainer.style.color = 'var(--danger)';
        } else {
            yesBtn.className = 'btn btn-primary';
            iconContainer.style.background = 'rgba(59, 130, 246, 0.1)';
            iconContainer.style.color = 'var(--accent)';
        }

        modal.classList.add('open');

        const cleanup = (result) => {
            modal.classList.remove('open');
            yesBtn.onclick = null;
            noBtn.onclick = null;
            resolve(result);
        };

        yesBtn.onclick = () => cleanup(true);
        noBtn.onclick = () => cleanup(false);
        // Also handle clicking overlay outside
        modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
    });
};
