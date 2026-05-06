/**
 * modals.ts — Generic Modals Initialization & Global Confirms
 */

import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';

interface ConfirmOptions {
    yesLabel?: string;
    noLabel?: string;
}

declare global {
    interface Window {
        confirmCustom: (title: string, message: string, type?: string, options?: ConfirmOptions) => Promise<boolean>;
        showGlobalDropdown: (btn: HTMLElement, menu: HTMLElement) => void;
        closeGlobalDropdown: (immediate?: boolean) => void;
        cancelDropdownClose: () => void;
        bmmFSDMEnabled?: boolean;
    }
}

export function initModals(): void {
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = (btn as HTMLElement).dataset.close!;
            const modal = document.getElementById(id);
            
            // Check if modal has data-prevent-close attribute set to 'true'
            if (modal && modal.getAttribute('data-prevent-close') === 'true') {
                return; // Prevent closing
            }
            
            invoke('log_frontend_line', { line: `Modal closed: ${id}` });
            modal?.classList.remove('open');
        });
    });

    document.addEventListener('click', (e: MouseEvent) => {
        const btn = (e.target as Element).closest('.modal-close');
        if (btn) {
            const modal = btn.closest('.modal-overlay');
            
            // Check if modal has data-prevent-close attribute set to 'true'
            if (modal && modal.getAttribute('data-prevent-close') === 'true') {
                return; // Prevent closing
            }
            
            if (modal) modal.classList.remove('open');
        }
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e: Event) => {
            // Check if modal has data-prevent-close attribute set to 'true'
            if (overlay.getAttribute('data-prevent-close') === 'true') {
                return; // Prevent closing
            }
            
            if (e.target === overlay) (overlay as HTMLElement).classList.remove('open');
        });
    });
}

// --- Global Confirmation Utility ---
window.confirmCustom = (title: string, message: string, type: string = 'danger', options: ConfirmOptions = {}): Promise<boolean> => {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm-generic');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const yesBtn = document.getElementById('btn-confirm-yes') as HTMLButtonElement | null;
        const noBtn = document.getElementById('btn-confirm-cancel') as HTMLButtonElement | null;
        const iconContainer = document.getElementById('confirm-icon-container');

        if (!modal || !titleEl || !msgEl || !yesBtn) {
            const ok = window.confirm(`${title}\n\n${message}`);
            resolve(ok);
            return;
        }

        titleEl.textContent = title;
        msgEl.innerHTML = message;

        const yesLabel = options.yesLabel || t('common.confirm') || 'CONFIRMER';
        const noLabel = options.noLabel || t('common.cancel') || 'Annuler';

        yesBtn.textContent = yesLabel;
        noBtn!.textContent = noLabel;

        if (options.yesLabel) yesBtn.removeAttribute('data-i18n');
        else yesBtn.setAttribute('data-i18n', 'common.confirm');

        if (options.noLabel) noBtn!.removeAttribute('data-i18n');
        else noBtn!.setAttribute('data-i18n', 'common.cancel');

        if (type === 'danger') {
            yesBtn.className = 'btn btn-danger';
            iconContainer!.style.background = 'rgba(239, 68, 68, 0.1)';
            iconContainer!.style.color = 'var(--danger)';
        } else {
            yesBtn.className = 'btn btn-primary';
            iconContainer!.style.background = 'rgba(59, 130, 246, 0.1)';
            iconContainer!.style.color = 'var(--accent)';
        }

        modal.classList.add('open');

        const cleanup = (result: boolean): void => {
            modal.classList.remove('open');
            yesBtn.onclick = null;
            noBtn!.onclick = null;
            resolve(result);
        };

        yesBtn.onclick = () => cleanup(true);
        noBtn!.onclick = () => cleanup(false);
        modal.onclick = (e: MouseEvent) => { if (e.target === modal) cleanup(false); };
    });
};

// --- Global Dropdown System ---
let dropTimer: ReturnType<typeof setTimeout> | undefined;

window.showGlobalDropdown = (btn: HTMLElement, menu: HTMLElement): void => {
    if (!menu) return;
    
    let portal = document.getElementById('global-dropdown-portal');
    if (!portal) {
        portal = document.createElement('div');
        portal.id = 'global-dropdown-portal';
        portal.style.cssText = 'position:fixed; top:0; left:0; pointer-events:none; z-index:999999;';
        document.body.appendChild(portal);
    }

    // Toggle logic: if already open for this button, close it
    if ((window as any).currentDropdownBtn === btn) {
        window.closeGlobalDropdown(true);
        return;
    }

    portal.innerHTML = '';
    (window as any).currentDropdownBtn = btn;
    
    const clone = menu.cloneNode(true) as HTMLElement;
    clone.classList.add('open');
    portal.appendChild(clone);

    const rect = btn.getBoundingClientRect();
    clone.style.position = 'fixed';
    clone.style.top = (rect.bottom + 6) + 'px'; // Slightly more gap
    clone.style.left = (rect.left) + 'px';
    clone.style.pointerEvents = 'auto';

    // Hover-out closing behavior & click outside
    let hoverTimeout: ReturnType<typeof setTimeout> | undefined;

    const outsideClick = (e: MouseEvent) => {
        if (!clone.contains(e.target as Node) && !btn.contains(e.target as Node)) {
            window.closeGlobalDropdown(true);
        }
    };

    const mouseMove = (e: MouseEvent) => {
        if (!clone.contains(e.target as Node) && !btn.contains(e.target as Node)) {
            if (!hoverTimeout) {
                hoverTimeout = setTimeout(() => {
                    window.closeGlobalDropdown();
                }, 300); // 300ms delay before closing
            }
        } else {
            if (hoverTimeout) {
                clearTimeout(hoverTimeout);
                hoverTimeout = undefined;
            }
        }
    };

    document.addEventListener('mousedown', outsideClick);
    document.addEventListener('mousemove', mouseMove);

    (window as any).globalDropdownCleanup = () => {
        document.removeEventListener('mousedown', outsideClick);
        document.removeEventListener('mousemove', mouseMove);
        if (hoverTimeout) clearTimeout(hoverTimeout);
        (window as any).globalDropdownCleanup = null;
    };

    clone.querySelectorAll('.dropdown-item, .btn-open-folder, .btn-open-active-folder, .btn-open-backup-folder, .btn-edit-mod, .btn-remove-mod').forEach(item => {
        (item as HTMLElement).onclick = (e: MouseEvent) => {
            e.stopPropagation();
            const originalItems = Array.from(menu.querySelectorAll('*'));
            const idx = Array.from(clone.querySelectorAll('*')).indexOf(item);
            if (originalItems[idx]) {
                originalItems[idx].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
            window.closeGlobalDropdown(true);
        };
    });
};

window.closeGlobalDropdown = (immediate: boolean = false): void => {
    if ((window as any).globalDropdownCleanup) {
        (window as any).globalDropdownCleanup();
    }

    const portal = document.getElementById('global-dropdown-portal');
    const menu = portal?.querySelector('.mod-actions-dropdown-content') as HTMLElement | null;

    if (immediate) {
        window.cancelDropdownClose();
        if (portal) {
            portal.innerHTML = '';
            (window as any).currentDropdownBtn = null;
        }
        return;
    }

    // Clear any existing timer to prevent race conditions
    window.cancelDropdownClose();

    // 100ms grace period before starting the closing animation
    dropTimer = setTimeout(() => {
        if (menu) {
            menu.classList.remove('open');
            menu.classList.add('closing');
        }

        // Final removal timer (matches animation duration)
        dropTimer = setTimeout(() => {
            if (portal) {
                portal.innerHTML = '';
                (window as any).currentDropdownBtn = null;
            }
        }, 200);
    }, 100);
};

window.cancelDropdownClose = (): void => {
    if (dropTimer) {
        clearTimeout(dropTimer);
        dropTimer = undefined;
    }

    // Restore open state if it was in 'closing' phase
    const menu = document.querySelector('#global-dropdown-portal .mod-actions-dropdown-content') as HTMLElement | null;
    if (menu && menu.classList.contains('closing')) {
        menu.classList.remove('closing');
        menu.classList.add('open');
    }
};
