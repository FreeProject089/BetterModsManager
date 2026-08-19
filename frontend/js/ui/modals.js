/**
 * modals.ts — Generic Modals Initialization & Global Confirms
 */
import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';
import { askConfirm } from '../core/api.js';
export function initModals() {
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.close;
            const modal = document.getElementById(id);
            // Check if modal has data-prevent-close attribute set to 'true'
            if (modal && modal.getAttribute('data-prevent-close') === 'true') {
                return; // Prevent closing
            }
            invoke('log_frontend_line', { line: `Modal closed: ${id}` });
            modal?.classList.remove('open');
        });
    });
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.modal-close');
        if (btn) {
            const modal = btn.closest('.modal-overlay');
            // Check if modal has data-prevent-close attribute set to 'true'
            if (modal && modal.getAttribute('data-prevent-close') === 'true') {
                return; // Prevent closing
            }
            if (modal)
                modal.classList.remove('open');
        }
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            // Check if modal has data-prevent-close attribute set to 'true'
            if (overlay.getAttribute('data-prevent-close') === 'true') {
                return; // Prevent closing
            }
            if (e.target === overlay)
                overlay.classList.remove('open');
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
            // The in-app markup is missing, so ask natively instead — through the RUST
            // command, never window.confirm. In the Tauri webview the latter returns
            // immediately without asking anybody, so this branch used to cancel whatever the
            // caller was doing while looking like the user had declined.
            askConfirm(`${title}\n\n${message}`, { title }).then(resolve).catch(() => resolve(false));
            return;
        }
        titleEl.textContent = title;
        msgEl.innerHTML = message;
        const yesLabel = options.yesLabel || t('common.confirm') || 'CONFIRMER';
        const noLabel = options.noLabel || t('common.cancel') || 'Annuler';
        yesBtn.textContent = yesLabel;
        noBtn.textContent = noLabel;
        if (options.yesLabel)
            yesBtn.removeAttribute('data-i18n');
        else
            yesBtn.setAttribute('data-i18n', 'common.confirm');
        if (options.noLabel)
            noBtn.removeAttribute('data-i18n');
        else
            noBtn.setAttribute('data-i18n', 'common.cancel');
        if (type === 'danger') {
            yesBtn.className = 'btn btn-danger';
            iconContainer.style.background = 'rgba(239, 68, 68, 0.1)';
            iconContainer.style.color = 'var(--danger)';
        }
        else if (type === 'warning') {
            yesBtn.className = 'btn btn-warning'; // Assumes btn-warning exists or will use primary fallback
            iconContainer.style.background = 'rgba(245, 158, 11, 0.1)';
            iconContainer.style.color = '#f59e0b';
        }
        else {
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
        modal.onclick = (e) => { if (e.target === modal)
            cleanup(false); };
    });
};
// --- Global Dropdown System ---
let dropTimer;
window.showGlobalDropdown = (btn, menu) => {
    if (!menu)
        return;
    let portal = document.getElementById('global-dropdown-portal');
    if (!portal) {
        portal = document.createElement('div');
        portal.id = 'global-dropdown-portal';
        portal.style.cssText = 'position:fixed; top:0; left:0; pointer-events:none; z-index:999999;';
        document.body.appendChild(portal);
    }
    // Toggle logic: if already open for this button, close it
    if (window.currentDropdownBtn === btn) {
        window.closeGlobalDropdown(true);
        return;
    }
    portal.innerHTML = '';
    window.currentDropdownBtn = btn;
    const clone = menu.cloneNode(true);
    clone.classList.add('open');
    portal.appendChild(clone);
    const rect = btn.getBoundingClientRect();
    clone.style.position = 'fixed';
    clone.style.pointerEvents = 'auto';
    clone.style.visibility = 'hidden'; // measure before showing to avoid a flash
    clone.style.top = '0px';
    clone.style.left = '0px';
    clone.style.right = 'auto';
    // Clamp into the viewport so the menu is ALWAYS fully visible (never off-screen),
    // whatever the row height / compact mode / position in the list.
    const GAP = 4, MARGIN = 8;
    requestAnimationFrame(() => {
        const mw = clone.offsetWidth || 200;
        const mh = clone.offsetHeight || 100;
        // Clamp to the visible BMM app window (rounded, inset titlebar/borders),
        // not the raw viewport — otherwise the menu can spill outside the window
        // chrome. Fall back to the viewport if the container isn't found.
        const host = document.getElementById('app-window-outer');
        const hb = host ? host.getBoundingClientRect()
            : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        const minX = hb.left + MARGIN, maxX = hb.right - MARGIN;
        const minY = hb.top + MARGIN, maxY = hb.bottom - MARGIN;
        // Vertical: prefer below the button; flip above if it would overflow.
        let top = rect.bottom + GAP;
        if (top + mh > maxY) {
            const above = rect.top - GAP - mh;
            top = above >= minY ? above : Math.max(minY, maxY - mh);
        }
        // Horizontal: align right edge to the button, then clamp both sides.
        let left = rect.right - mw;
        if (left + mw > maxX)
            left = maxX - mw;
        if (left < minX)
            left = minX;
        clone.style.top = top + 'px';
        clone.style.left = left + 'px';
        clone.style.right = 'auto';
        clone.style.visibility = 'visible';
    });
    // Close behaviour: outside click closes immediately. Hover-out closes after a
    // grace delay, but ONLY via mouseenter/leave on the button & menu (not a global
    // mousemove) — this fixes the compact-mode "closes while my mouse is still on
    // it" bug, where fast movement over re-rendered rows was misread as leaving.
    let hoverTimeout;
    const cancelClose = () => { if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = undefined;
    } };
    const scheduleClose = () => { cancelClose(); hoverTimeout = setTimeout(() => window.closeGlobalDropdown(), 450); };
    const outsideClick = (e) => {
        if (!clone.contains(e.target) && !btn.contains(e.target)) {
            window.closeGlobalDropdown(true);
        }
    };
    clone.addEventListener('mouseenter', cancelClose);
    clone.addEventListener('mouseleave', scheduleClose);
    btn.addEventListener('mouseenter', cancelClose);
    btn.addEventListener('mouseleave', scheduleClose);
    document.addEventListener('mousedown', outsideClick);
    window.globalDropdownCleanup = () => {
        document.removeEventListener('mousedown', outsideClick);
        clone.removeEventListener('mouseenter', cancelClose);
        clone.removeEventListener('mouseleave', scheduleClose);
        btn.removeEventListener('mouseenter', cancelClose);
        btn.removeEventListener('mouseleave', scheduleClose);
        cancelClose();
        window.globalDropdownCleanup = null;
    };
    // Forward each cloned action to its matching ORIGINAL item. Matching by the
    // SAME selector list gives a robust 1:1 index — the old code indexed ALL
    // descendants (`querySelectorAll('*')`), which drifts if the clone is
    // re-rendered/translated and could forward the click to the wrong item
    // (e.g. "open active folder" doing nothing).
    const ACTION_SEL = '.dropdown-item, .btn-open-folder, .btn-open-active-folder, .btn-open-backup-folder, .btn-edit-mod, .btn-remove-mod';
    const cloneActions = Array.from(clone.querySelectorAll(ACTION_SEL));
    const origActions = Array.from(menu.querySelectorAll(ACTION_SEL));
    cloneActions.forEach((item, i) => {
        const element = item;
        // Prevent tooltip conflicts on dropdown items
        element.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            window.__dropdownOpen = true;
        });
        element.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            setTimeout(() => { window.__dropdownOpen = false; }, 100);
        });
        element.onclick = (e) => {
            e.stopPropagation();
            const orig = origActions[i];
            if (orig)
                orig.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            window.closeGlobalDropdown(true);
        };
    });
};
window.closeGlobalDropdown = (immediate = false) => {
    if (window.globalDropdownCleanup) {
        window.globalDropdownCleanup();
    }
    // Reset dropdown state to allow tooltips again
    window.__dropdownOpen = false;
    window.currentDropdownBtn = null;
    const portal = document.getElementById('global-dropdown-portal');
    const menu = portal?.querySelector('.mod-actions-dropdown-content');
    if (immediate) {
        window.cancelDropdownClose();
        if (portal) {
            portal.innerHTML = '';
            window.currentDropdownBtn = null;
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
                window.currentDropdownBtn = null;
            }
        }, 200);
    }, 100);
};
window.cancelDropdownClose = () => {
    if (dropTimer) {
        clearTimeout(dropTimer);
        dropTimer = undefined;
    }
    // Restore open state if it was in 'closing' phase
    const menu = document.querySelector('#global-dropdown-portal .mod-actions-dropdown-content');
    if (menu && menu.classList.contains('closing')) {
        menu.classList.remove('closing');
        menu.classList.add('open');
    }
};
//# sourceMappingURL=modals.js.map