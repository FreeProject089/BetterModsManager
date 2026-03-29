// @ts-nocheck
/**
 * update-notes.js — Update notes, PTB modal, auto-update, licenses, markdown rendering
 * Extracted from app.js for modularity
 */

import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';
import { toast } from './app.js';
import { escHtml, escAttr } from '../core/utils.js';

// ── Navbar Version Button ────────────────────────────────
export function initNavbarVersion() {
    const btn = document.getElementById('nav-version-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const showUpdatesBtn = document.getElementById('btn-show-updates');
        if (showUpdatesBtn) showUpdatesBtn.click();
    });
}

// ── Update notes modal ───────────────────────────────────
export function initUpdateNotes() {
    const btn = document.getElementById('btn-show-updates');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        let notes = [];
        let oldNotes = [];
        try {
            notes = await invoke('get_update_notes', { subDir: null });
            oldNotes = await invoke('get_update_notes', { subDir: 'Old_Update' });
        } catch (e) { console.error(e); }

        const allNotes = [...notes, ...oldNotes];

        let modal = document.getElementById('modal-update-notes');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-update-notes';
            modal.className = 'modal-overlay';
            document.getElementById('app-window-outer').appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal glass" style="max-width:900px; width:95%; height:80vh; display:flex; flex-direction:column;">
                <div class="modal-header" style="flex-shrink:0">
                    <h2 class="modal-title" style="display:flex; align-items:center; gap:10px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        ${t('update.title')}
                    </h2>
                    <button class="modal-close" id="close-update-notes"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <div class="modal-body" style="padding:0; flex:1; overflow:hidden;">
                    <div class="archive-modal-container" style="display:flex; height:100%;">
                        <div class="archive-sidebar" id="archive-sidebar" style="width:260px; background:rgba(0,0,0,0.2); border-right:1px solid var(--border); overflow-y:auto; padding:12px 0;">
                            
                            <div class="tree-group" style="margin-bottom:16px;">
                                <div class="tree-label" style="padding:0 16px 8px; font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:6px;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                                    Release Notes
                                </div>
                                ${notes.map((n, i) => `
                                    <div class="archive-sidebar-item ${i === 0 ? 'active' : ''}" data-index="${i}" style="padding:8px 16px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:var(--transition); border-left:2px solid transparent;">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(n.filename)}</span>
                                    </div>
                                `).join('')}
                            </div>

                            <div class="tree-group">
                                <div class="tree-label" style="padding:0 16px 8px; font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:6px;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                                    Archives
                                </div>
                                ${oldNotes.map((n, i) => `
                                    <div class="archive-sidebar-item" data-index="${notes.length + i}" style="padding:8px 16px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:var(--transition); border-left:2px solid transparent;">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(n.filename)}</span>
                                    </div>
                                `).join('')}
                            </div>

                        </div>
                        <div class="archive-content" id="archive-content" style="flex:1; overflow-y:auto; padding:32px; background:var(--bg-primary);">
                            ${allNotes.length > 0 ? renderMarkdown(allNotes[0].content) : `<p style="color:var(--text-muted)">${t('update.none')}</p>`}
                        </div>
                    </div>
                </div>
            </div>
        `;
        modal.classList.add('open');
        modal.querySelector('#close-update-notes').addEventListener('click', () => modal.classList.remove('open'));
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

        // Sidebar selection logic
        const sidebarItems = modal.querySelectorAll('.archive-sidebar-item');
        const contentArea = modal.querySelector('#archive-content');

        sidebarItems.forEach(item => {
            item.addEventListener('click', () => {
                sidebarItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const note = allNotes[item.dataset.index];
                contentArea.innerHTML = renderMarkdown(note.content);
                contentArea.scrollTop = 0;
            });
        });
    });
}

/**
 * Copies text to clipboard with a toast notification
 */
window.copyCodeToClipboard = (text, btn) => {
    navigator.clipboard.writeText(text).then(() => {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.remove('copied');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
};

// Simple Markdown renderer
export function renderMarkdown(md) {
    if (!md) return '';
    let html = '';
    if (typeof marked !== 'undefined') {
        marked.setOptions({ renderer: new marked.Renderer() });
        html = marked.parse(md);
    } else {
        html = md.replace(/\n/g, '<br>');
    }
    return `<div class="md-body">${html}</div>`;
}

// Inject markdown body styles once
(function injectMarkdownStyles() {
    if (document.getElementById('md-body-styles')) return;
    const style = document.createElement('style');
    style.id = 'md-body-styles';
    style.textContent = `
        .md-body { font-size: 13.5px; line-height: 1.7; color: var(--text-secondary); font-family: var(--font-sans, inherit); }
        .md-body h1 { font-size: 20px; font-weight: 700; color: #ffffff; margin: 0 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
        .md-body h2 { font-size: 16px; font-weight: 700; color: var(--text-primary); margin: 24px 0 10px; }
        .md-body h3 { font-size: 13px; font-weight: 700; color: var(--accent); margin: 18px 0 8px; }
        .md-body p { margin: 8px 0; }
        .md-body ul, .md-body ol { padding-left: 18px; margin: 8px 0; }
        .md-body li { color: var(--text-secondary); margin: 4px 0; }
        .md-body strong { color: var(--text-primary); font-weight: 700; }
        .md-body em { color: var(--text-muted); font-style: italic; }
        
        .md-body code { 
            font-family: var(--font-mono, monospace);
            background: rgba(255, 255, 255, 0.06);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            color: #e6edf3;
        }

        .md-body pre { 
            background: rgba(0, 0, 0, 0.2);
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
            margin: 12px 0;
            border: 1px solid var(--border);
        }
        
        .md-body pre code { 
            background: none !important;
            padding: 0 !important;
            border: none !important;
            font-size: 12px;
            color: #e6edf3;
        }
        
        .md-body blockquote {
            border-left: 3px solid var(--accent);
            padding: 2px 16px;
            margin: 16px 0;
            background: rgba(59, 130, 246, 0.05);
            border-radius: 0 8px 8px 0;
            color: var(--text-secondary);
        }
        
        .md-body hr { height: 1px; border: none; border-top: 1px solid var(--border); margin: 20px 0; }
        .md-body table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12.5px; }
        .md-body th { background: rgba(255,255,255,0.03); color: var(--text-primary); font-weight: 600; padding: 10px; text-align: left; border: 1px solid var(--border); }
        .md-body td { padding: 8px 10px; border: 1px solid var(--border); color: var(--text-secondary); }
        .md-body a { color: var(--accent); text-decoration: none; }
        .md-body a:hover { text-decoration: underline; }
    `;
    document.head.appendChild(style);
})();


// ── Auto Update System ──────────────────────────────────

const AUTO_UPDATE_KEY = 'bmm_auto_update_enabled';

function isAutoUpdateEnabled() {
    const val = localStorage.getItem(AUTO_UPDATE_KEY);
    return val !== 'false'; // Default to enabled
}

function setAutoUpdateEnabled(enabled) {
    localStorage.setItem(AUTO_UPDATE_KEY, enabled ? 'true' : 'false');
}

export async function initAutoUpdate() {
    let isDisabled = false;
    try {
        isDisabled = await invoke('is_update_disabled');
    } catch (e) {
        console.warn('[BMM] Failed to check update disabled status:', e);
    }

    const updateCheckButtonsState = () => {
        const isAuto = isAutoUpdateEnabled();
        const sidebarBtn = document.getElementById('btn-check-updates');
        const settingsBtn = document.getElementById('btn-settings-check-update');

        [sidebarBtn, settingsBtn].forEach(btn => {
            if (!btn) return;
            if (isDisabled) {
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                btn.onmouseenter = () => window.showTaskyHelp('update.disabledTip', 'icon-help');
                btn.onmouseleave = () => window.hideTaskyHelp();
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toast(t('update.disabled') || 'Updates are disabled.', 'warning');
                };
            }
        });
    };

    const chk = document.getElementById('chk-auto-update');
    if (chk) {
        if (isDisabled) {
            chk.checked = false;
            chk.disabled = true;
            const card = chk.closest('.settings-toggle-card');
            if (card) {
                card.style.opacity = '0.5';
                card.dataset.i18nTitle = 'update.disabled';
                card.onmouseenter = () => window.showTaskyHelp('update.disabledTip', 'icon-help');
                card.onmouseleave = () => window.hideTaskyHelp();
            }
        } else {
            chk.checked = isAutoUpdateEnabled();
            chk.addEventListener('change', () => {
                setAutoUpdateEnabled(chk.checked);
                updateCheckButtonsState();
                toast(chk.checked
                    ? (t('settings.autoUpdateEnabled') || 'Auto-update enabled')
                    : (t('settings.autoUpdateDisabled') || 'Auto-update disabled'), 'info');
            });
        }
    }

    // Sidebar button listener
    const sidebarBtn = document.getElementById('btn-check-updates');
    if (sidebarBtn && !isDisabled) {
        sidebarBtn.addEventListener('click', () => {
            const showUpdatesBtn = document.getElementById('btn-show-updates');
            if (showUpdatesBtn) showUpdatesBtn.click();
        });
    }

    // Settings button listener
    const settingsBtn = document.getElementById('btn-settings-check-update');
    if (settingsBtn && !isDisabled) {
        settingsBtn.addEventListener('click', () => performUpdateCheck(true));
    }

    // Apply initial state
    updateCheckButtonsState();

    // Auto-check on startup
    if (!isDisabled && isAutoUpdateEnabled()) {
        setTimeout(() => performUpdateCheck(false), 3000);
    }
}

async function performUpdateCheck(showNoUpdateToast = false) {
    const sidebarBtn = document.getElementById('btn-check-updates');
    const statusMsg = document.getElementById('update-status-msg');

    if (sidebarBtn) {
        sidebarBtn.classList.add('checking');
        sidebarBtn.querySelector('span').textContent = t('settings.checking') || 'Checking...';
    }
    if (statusMsg) {
        statusMsg.innerHTML = `<span style="color:var(--accent)">${t('settings.checking') || 'Checking...'}</span>`;
    }

    try {
        const info = await invoke('check_for_update');

        if (info.has_update) {
            showUpdateAvailableModal(info);
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--success)">✓ ${t('settings.updateAvailable') || 'Update available'}: v${escHtml(info.latest_version)}</span>`;
            }
        } else {
            if (showNoUpdateToast) {
                toast(t('settings.upToDate') || 'You are running the latest version!', 'success');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--success)">✓ ${t('settings.upToDate') || 'Up to date'} (v${escHtml(info.current_version)})</span>`;
            }
        }
    } catch (err) {
        console.warn('[BMM] Update check failed:', err);
        const errStr = String(err);
        if (errStr.includes('NO_RELEASE')) {
            if (showNoUpdateToast) {
                toast(t('settings.noRelease') || 'No releases published on GitHub yet.', 'info');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--warning)">⚠ ${t('settings.noRelease') || 'No releases yet'}</span>`;
            }
        } else {
            if (showNoUpdateToast) {
                toast((t('settings.updateCheckFailed') || 'Update check failed') + ': ' + err, 'error');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--danger)">✗ ${t('settings.updateCheckFailed') || 'Check failed'}</span>`;
            }
        }
    } finally {
        if (sidebarBtn) {
            sidebarBtn.classList.remove('checking');
            sidebarBtn.querySelector('span').textContent = t('settings.checkUpdates') || 'Check for Updates';
        }
    }
}

function showUpdateAvailableModal(info) {
    const existing = document.getElementById('update-available-modal');
    if (existing) existing.remove();

    const releaseNotes = info.release_notes
        ? (typeof marked !== 'undefined' ? marked.parse(info.release_notes) : info.release_notes.replace(/\n/g, '<br>'))
        : '';

    const modal = document.createElement('div');
    modal.id = 'update-available-modal';
    modal.className = 'update-modal-backdrop';
    modal.innerHTML = `
        <div class="update-modal-card">
            <button class="update-modal-close" id="close-update-modal">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>

            <div style="text-align:center;margin-bottom:24px">
                <div style="display:inline-flex;width:56px;height:56px;background:rgba(16,185,129,0.12);border-radius:16px;align-items:center;justify-content:center;margin-bottom:16px;border:1px solid rgba(16,185,129,0.25)">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2">
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                </div>
                <h2 style="font-size:20px;font-weight:800;color:var(--text-primary);margin-bottom:8px">
                    ${t('settings.updateAvailableTitle') || 'Update Available!'}
                </h2>
                <p style="font-size:13px;color:var(--text-muted)">
                    ${t('settings.newVersionReady') || 'A new version of Better Mod Manager is ready.'}
                </p>
            </div>

            <div style="display:flex;gap:12px;margin-bottom:20px">
                <div style="flex:1;padding:12px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:10px;text-align:center">
                    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:700;margin-bottom:4px">${t('settings.currentVersion') || 'CURRENT'}</div>
                    <div style="font-size:18px;font-weight:800;font-family:var(--font-mono);color:var(--danger)">v${escHtml(info.current_version)}</div>
                </div>
                <div style="display:flex;align-items:center;color:var(--text-muted)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </div>
                <div style="flex:1;padding:12px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:10px;text-align:center">
                    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:700;margin-bottom:4px">${t('settings.latestVersion') || 'LATEST'}</div>
                    <div style="font-size:18px;font-weight:800;font-family:var(--font-mono);color:var(--success)">v${escHtml(info.latest_version)}</div>
                </div>
            </div>

            ${releaseNotes ? `
                <div style="max-height:280px;overflow-y:auto;padding:12px;background:rgba(0,0,0,0.3);border-radius:10px;border:1px solid var(--border);margin-bottom:20px;font-size:12px;line-height:1.6;color:var(--text-secondary)" class="custom-scrollbar">
                    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:700;margin-bottom:8px">${t('settings.releaseNotes') || 'RELEASE NOTES'}</div>
                    ${releaseNotes}
                </div>
            ` : ''}

            <div style="display:flex;gap:10px">
                <button class="btn btn-ghost" id="btn-update-later" style="flex:1">
                    ${t('settings.later') || 'Later'}
                </button>
                <button class="btn btn-primary" id="btn-download-install-update" style="flex:2;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    ${t('settings.downloadUpdate') || 'Download Update'}
                </button>
            </div>

            <div style="text-align:center;margin-top:12px">
                <a href="${escAttr(info.release_url)}" target="_blank" style="font-size:11px;color:var(--accent);text-decoration:none">
                    ${t('settings.viewOnGithub') || 'View on GitHub →'}
                </a>
            </div>
        </div>
    `;
    document.getElementById('app-window-outer').appendChild(modal);

    const downloadBtn = modal.querySelector('#btn-download-install-update');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
            const originalContent = downloadBtn.innerHTML;
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Downloading...';
            try {
                let filename = info.download_url.split('/').pop() || 'setup.exe';
                if (!filename.includes('.')) filename += '.exe';
                await invoke('download_and_install_update', { url: info.download_url, filename });
                downloadBtn.innerHTML = t('common.installing');
            } catch (err) {
                toast(`Failed to download update: ${err}`, 'error');
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = originalContent;
            }
        });
    }

    modal.querySelector('#close-update-modal').addEventListener('click', () => modal.remove());
    modal.querySelector('#btn-update-later').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// ── PTB (Public Test Build) Modal ───────────────────────

const PTB_DISMISSED_KEY = 'bmm_ptb_dismissed';

export async function checkPtbMode(force = false, initialFileName = null) {
    if (!force && sessionStorage.getItem(PTB_DISMISSED_KEY)) return;

    try {
        const isPtb = await invoke('is_ptb_mode');
        if (!isPtb && !force) return;

        const currentNotes = await invoke('get_update_notes', { subDir: null });
        const oldNotes = await invoke('get_update_notes', { subDir: "Old_Update" });

        showPtbModal(currentNotes, oldNotes, initialFileName);
    } catch (e) {
        console.warn('[BMM] PTB check failed:', e);
    }
}

function showPtbModal(currentNotes, oldNotes, initialFileName = null) {
    const existing = document.getElementById('ptb-welcome-modal');
    if (existing) existing.remove();

    const allNotes = [...currentNotes, ...oldNotes];
    if (allNotes.length === 0) return;

    const modal = document.createElement('div');
    modal.id = 'ptb-welcome-modal';
    modal.className = 'update-modal-backdrop';

    let activeNote = allNotes[0];
    if (initialFileName) {
        const found = allNotes.find(n => n.filename.includes(initialFileName));
        if (found) activeNote = found;
    }

    const renderHeader = () => `
        <div class="ptb-header-title">
            <div class="ptb-header-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <span>${t('settings.notesTitle') || 'Notes de mise à jour'}</span>
        </div>
        <button class="update-modal-close" id="close-ptb-modal">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;

    const renderSidebar = () => {
        let html = '<div class="ptb-sidebar">';

        if (currentNotes.length > 0) {
            html += `
                <div class="ptb-sidebar-section">
                    <div class="ptb-sidebar-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        RELEASE NOTES
                    </div>
                    ${currentNotes.map(n => `
                        <div class="ptb-sidebar-item ${n.filename === activeNote.filename ? 'active' : ''}" data-file="${escAttr(n.filename)}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            ${escHtml(n.filename)}
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (oldNotes.length > 0) {
            html += `
                <div class="ptb-sidebar-section">
                    <div class="ptb-sidebar-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        ARCHIVES
                    </div>
                    ${oldNotes.map(n => `
                        <div class="ptb-sidebar-item ${n.filename === activeNote.filename ? 'active' : ''}" data-file="${escAttr(n.filename)}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            ${escHtml(n.filename)}
                        </div>
                    `).join('')}
                </div>
            `;
        }

        html += '</div>';
        return html;
    };

    const renderContent = (note) => {
        return `<div class="ptb-modal-body" style="overflow-y:auto; flex:1; padding:32px;">${renderMarkdown(note.content)}</div>`;
    };

    modal.innerHTML = `
        <div class="ptb-modal-card">
            <div class="ptb-modal-header">${renderHeader()}</div>
            <div class="ptb-modal-layout">
                ${renderSidebar()}
                <div id="ptb-content-target" style="flex:1; display:flex; flex-direction:column; overflow:hidden">
                    ${renderContent(activeNote)}
                </div>
            </div>
        </div>
    `;

    document.getElementById('app-window-outer').appendChild(modal);

    modal.addEventListener('click', (e) => {
        const item = e.target.closest('.ptb-sidebar-item');
        if (item) {
            const filename = item.dataset.file;
            const note = allNotes.find(n => n.filename === filename);
            if (note) {
                activeNote = note;
                modal.querySelectorAll('.ptb-sidebar-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                modal.querySelector('#ptb-content-target').innerHTML = renderContent(note);
                modal.querySelector('.ptb-modal-body').scrollTop = 0;
            }
        }
    });

    const close = () => {
        sessionStorage.setItem(PTB_DISMISSED_KEY, 'true');
        modal.remove();
    };
    modal.querySelector('#close-ptb-modal').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

// ── Licenses ──────────────────────────────────────────────
export async function openLicenseModal() {
    const modal = document.getElementById('modal-license');
    const contentEl = document.getElementById('license-content');
    if (!modal || !contentEl) return;

    modal.classList.add('open');
    contentEl.textContent = t('common.loading');

    try {
        const text = await invoke('get_license_text');
        contentEl.textContent = text;
    } catch (err) {
        contentEl.textContent = t('common.error') + " (License): " + err;
    }
}

// Global expose for onclick
window.openLicenseModal = openLicenseModal;
window.checkPtbMode = checkPtbMode;
