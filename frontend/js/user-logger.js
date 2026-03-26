/**
 * user-logger.js — Frontend Interaction Logging
 */

import { invoke } from './api.js';
import { appState } from './state.js';
import { toast } from './app.js';
import { debugUI } from './debug-ui.js';

/** Global interaction logger */
export function initInteractionLogging() {
    // Log clicks
    document.addEventListener('click', (e) => {
        const target = e.target;
        const btn = target.closest('button');
        const link = target.closest('a');

        if (btn) {
            const text = btn.innerText?.trim() || btn.title || btn.id || 'anonymous button';
            invoke('log_frontend_line', { line: `Click: Button [${text}]` });
        } else if (link) {
            const text = link.innerText?.trim() || link.href;
            invoke('log_frontend_line', { line: `Click: Link [${text}]` });
        }
    }, true);

    // Keyboard toggle
    document.addEventListener('keydown', e => {
        const key = e.key.toLowerCase();

        // Ctrl+Alt+D: Toggle DevTools (ONLY if unlocked via Ctrl+D in Settings)
        if (e.ctrlKey && e.altKey && key === 'd') {
            e.preventDefault();
            if (appState.get('debugMode')) {
                debugUI.toggle();
            } else {
                console.warn('[BMM-DEBUG] Access denied. Unlock Debug Mode in Settings (Ctrl+D) first.');
                toast('DevTools locked. Unlock in Settings.', 'warning');
            }
        }
        // Ctrl+Shift+F: Toggle DevTools (Legacy FSDM)
        else if (e.ctrlKey && e.shiftKey && key === 'f') {
            if (window.bmmFSDMEnabled) {
                debugUI.toggle();
            }
        }
        // Ctrl+D: Unlock Debug Mode (ONLY in Settings)
        else if (e.ctrlKey && !e.altKey && !e.shiftKey && key === 'd') {
            const settingsView = document.getElementById('view-settings');
            if (settingsView && settingsView.classList.contains('active')) {
                e.preventDefault();
                const card = document.getElementById('debug-menu-card') || document.getElementById('settings-debug-section');
                if (card) {
                    const isHidden = card.style.display === 'none';
                    card.style.display = isHidden ? 'block' : 'none';
                    if (isHidden) {
                        appState.set('debugMode', true);
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        toast('Debug Mode Unlocked', 'success');
                    } else {
                        // We don't necessarily lock it back, but we hide the section
                        toast('Debug Section Hidden', 'info');
                    }
                }
            }
        }
    });

    // Log scrolls (debounced)
    let scrollTimeout;
    document.addEventListener('scroll', (e) => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            const target = e.target === document ? document.documentElement : e.target;
            if (target && target.scrollTop > 0) {
                const view = document.querySelector('.view.active')?.id || 'unknown';
                invoke('log_frontend_line', { line: `Scroll: View [${view}] at ${target.scrollTop}px` });
            }
        }, 1000);
    }, true);

    // Log keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            const key = e.key?.toUpperCase();
            if (['N', 'E', 'S', 'F'].includes(key)) {
                invoke('log_frontend_line', { line: `Shortcut: Ctrl+${key}` });
            }
        }
    });

    // Log drag-and-drop
    document.addEventListener('drop', (e) => {
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const names = Array.from(files).map(f => f.name).join(', ');
            invoke('log_frontend_line', { line: `Drop: ${files.length} file(s) [${names}]` });
        }
    });

    // Log toggle/checkbox changes
    document.addEventListener('change', (e) => {
        const t = e.target;
        if (t.type === 'checkbox' || t.classList?.contains('toggle-switch')) {
            const id = t.id || t.name || 'unknown';
            invoke('log_frontend_line', { line: `Toggle: [${id}] = ${t.checked}` });
        }
        if (t.tagName === 'SELECT') {
            const id = t.id || t.name || 'unknown';
            invoke('log_frontend_line', { line: `Select: [${id}] = ${t.value}` });
        }
    });

    // Log window focus/blur
    window.addEventListener('focus', () => invoke('log_frontend_line', { line: 'Window: Focus gained' }));
    window.addEventListener('blur', () => invoke('log_frontend_line', { line: 'Window: Focus lost' }));

    // Log unhandled JS errors
    window.addEventListener('error', (e) => {
        invoke('log_frontend_line', { line: `[JS-ERROR] ${e.message} at ${e.filename}:${e.lineno}` });
    });

    window.addEventListener('unhandledrejection', (e) => {
        invoke('log_frontend_line', { line: `[JS-PROMISE-ERROR] ${e.reason}` });
    });
}
