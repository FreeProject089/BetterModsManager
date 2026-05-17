/**
 * user-logger.ts — Frontend Interaction Logging
 */
import { invoke } from '../core/api.js';
import { appState } from '../core/state.js';
import { toast } from './app.js';
import { debugUI } from '../features/debug/debug-ui.js';
const _debugUI = debugUI;
export function initInteractionLogging() {
    document.addEventListener('click', (e) => {
        const target = e.target;
        const btn = target.closest('button');
        const link = target.closest('a');
        if (btn) {
            const text = btn.innerText?.trim() || btn.title || btn.id || 'anonymous button';
            invoke('log_frontend_line', { line: `Click: Button [${text}]` });
        }
        else if (link) {
            const text = link.innerText?.trim() || link.href;
            invoke('log_frontend_line', { line: `Click: Link [${text}]` });
        }
    }, true);
    document.addEventListener('keydown', (e) => {
        const key = e.key?.toLowerCase() || '';
        if (e.ctrlKey && e.altKey && key === 'd') {
            e.preventDefault();
            if (appState.get('debugMode')) {
                _debugUI.toggle();
            }
            else {
                console.warn('[BMM-DEBUG] Access denied. Unlock Debug Mode in Settings (Ctrl+D) first.');
                toast((window.t ? window.t('settings.devToolsLocked') : 'DevTools locked. Unlock in Settings.'), 'warning');
            }
        }
        else if (e.ctrlKey && e.shiftKey && key === 'f') {
            if (window.bmmFSDMEnabled) {
                _debugUI.toggle();
            }
        }
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
                        toast((window.t ? window.t('settings.debugUnlocked') : 'Debug Mode Unlocked'), 'success');
                    }
                    else {
                        toast((window.t ? window.t('settings.debugHidden') : 'Debug Section Hidden'), 'info');
                    }
                }
            }
        }
    });
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
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            const key = e.key?.toUpperCase();
            if (['N', 'E', 'S', 'F'].includes(key)) {
                invoke('log_frontend_line', { line: `Shortcut: Ctrl+${key}` });
            }
        }
    });
    document.addEventListener('drop', (e) => {
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const names = Array.from(files).map(f => f.name).join(', ');
            invoke('log_frontend_line', { line: `Drop: ${files.length} file(s) [${names}]` });
        }
    });
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
    window.addEventListener('focus', () => invoke('log_frontend_line', { line: 'Window: Focus gained' }));
    window.addEventListener('blur', () => invoke('log_frontend_line', { line: 'Window: Focus lost' }));
    window.addEventListener('error', (e) => {
        invoke('log_frontend_line', { line: `[JS-ERROR] ${e.message} at ${e.filename}:${e.lineno}` });
    });
    window.addEventListener('unhandledrejection', (e) => {
        invoke('log_frontend_line', { line: `[JS-PROMISE-ERROR] ${e.reason}` });
    });
}
//# sourceMappingURL=user-logger.js.map