// @ts-nocheck
/**
 * update-notes.js — Update notes, PTB modal, auto-update, licenses, markdown rendering
 * Extracted from app.js for modularity
 */
import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';
import { toast } from './app.js';
import { escHtml, escAttr } from '../core/utils.js';
// Persistence for expanded folders in the release notes tree
const expandedFolders = new Set();
// ── Navbar Version Button ────────────────────────────────
export function initNavbarVersion() {
    // Relying on inline onclick in index.html for nav-version-btn
}
// ── Update notes modal ───────────────────────────────────
export async function openUpdateNotesModal() {
    const { getLang } = await import('../core/i18n.js');
    const lang = getLang();
    let folderStructure = [];
    try {
        folderStructure = await invoke('get_update_folder_structure', { lang });
    }
    catch (e) {
        console.error(e);
    }
    // Flatten folder structure to get all notes with their paths
    const allNotesMap = new Map();
    async function loadNotesFromStructure(structure, basePath = '') {
        for (const item of structure) {
            const itemPath = item.path;
            if (item.is_folder) {
                await loadNotesFromStructure(item.children, itemPath);
            }
            else {
                try {
                    const subDir = basePath ? basePath.split('/').join('\\') : null;
                    const notes = await invoke('get_update_notes', { subDir, lang });
                    const note = notes.find((n) => n.filename === item.name);
                    if (note) {
                        allNotesMap.set(itemPath, { ...note, path: itemPath });
                    }
                }
                catch (e) {
                    console.error(e);
                }
            }
        }
    }
    await loadNotesFromStructure(folderStructure);
    const allNotes = Array.from(allNotesMap.values());
    let modal = document.getElementById('modal-update-notes');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-update-notes';
        modal.className = 'modal-overlay';
        document.getElementById('app-window-outer').appendChild(modal);
    }
    // Render folder tree
    // IMPORTANT: always compute a full nested path, otherwise files in subfolders won't be clickable.
    const renderFolderTree = (items, depth = 0) => {
        return items.map(item => {
            const paddingLeft = 12 + depth * 16;
            const fullPath = item.path;
            if (item.is_folder) {
                const isExpanded = expandedFolders.has(fullPath);
                return `
                    <div class="tree-folder" style="padding-left:${paddingLeft}px">
                        <div class="tree-folder-header ${isExpanded ? 'expanded' : ''}" data-folder="${escAttr(fullPath)}" style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transform: rotate(${isExpanded ? '90deg' : '0'}); transition: transform 0.2s;"><path d="M9 18l6-6-6-6"/></svg>
                            ${escHtml(item.name)}
                        </div>
                        <div class="tree-folder-children" style="display:${isExpanded ? 'block' : 'none'}">
                            ${renderFolderTree(item.children, depth + 1)}
                        </div>
                    </div>
                `;
            }
            const note = allNotes.find(n => n.path === fullPath);
            return `
                <div class="archive-sidebar-item ${allNotes.length > 0 && note === allNotes[0] ? 'active' : ''}" data-path="${escAttr(fullPath)}" style="padding:8px ${paddingLeft + 8}px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:var(--transition); border-left:2px solid transparent;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(item.name)}</span>
                </div>
            `;
        }).join('');
    };
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
                        ${renderFolderTree(folderStructure)}
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
    modal.addEventListener('click', e => { if (e.target === modal)
        modal.classList.remove('open'); });
    // Folder toggle logic
    modal.querySelectorAll('.tree-folder-header').forEach(header => {
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            const folderPath = header.dataset.folder;
            const children = header.nextElementSibling;
            if (children) {
                const isNowOpen = children.style.display === 'none';
                children.style.display = isNowOpen ? 'block' : 'none';
                header.classList.toggle('expanded');
                // Update persistent state
                if (isNowOpen)
                    expandedFolders.add(folderPath);
                else
                    expandedFolders.delete(folderPath);
                // Animate chevron
                const svg = header.querySelector('svg');
                if (svg)
                    svg.style.transform = `rotate(${isNowOpen ? '90deg' : '0'})`;
            }
        });
    });
    // Sidebar selection logic with event delegation
    const contentArea = modal.querySelector('#archive-content');
    modal.addEventListener('click', async (e) => {
        const item = e.target.closest('.archive-sidebar-item');
        if (!item)
            return;
        e.stopPropagation();
        // Remove active from all items
        modal.querySelectorAll('.archive-sidebar-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const path = item.dataset.path;
        console.log('Clicked item with path:', path);
        // Auto-expand parent folders and save state
        let parent = item.parentElement;
        while (parent) {
            if (parent.classList.contains('tree-folder-children')) {
                parent.style.display = 'block';
                const header = parent.previousElementSibling;
                if (header && header.classList.contains('tree-folder-header')) {
                    header.classList.add('expanded');
                    const folderPath = header.dataset.folder;
                    if (folderPath)
                        expandedFolders.add(folderPath);
                    const svg = header.querySelector('svg');
                    if (svg)
                        svg.style.transform = 'rotate(90deg)';
                }
            }
            parent = parent.parentElement;
        }
        let note = allNotes.find(n => n.path === path);
        // If note not found in pre-loaded notes, try to load it on-demand
        if (!note && path) {
            try {
                const { getLang } = await import('../core/i18n.js');
                const lang = getLang();
                const pathParts = path.split('/');
                const fileName = pathParts[pathParts.length - 1];
                const subDir = pathParts.slice(0, -1).join('\\');
                console.log('Loading note on-demand:', { fileName, subDir, lang });
                const notes = await invoke('get_update_notes', { subDir, lang });
                const foundNote = notes.find((n) => n.filename === fileName);
                if (foundNote) {
                    note = { ...foundNote, path };
                }
            }
            catch (err) {
                console.error('Failed to load note on-demand:', err);
            }
        }
        if (note) {
            contentArea.innerHTML = renderMarkdown(note.content);
            contentArea.scrollTop = 0;
        }
        else {
            console.warn('Note not found for path:', path);
            contentArea.innerHTML = `<p style="color:var(--text-muted)">${t('update.none') || 'No content'}</p>`;
        }
    });
}
export function initUpdateNotes() {
    const btn = document.getElementById('btn-show-updates');
    if (!btn)
        return;
    btn.addEventListener('click', openUpdateNotesModal);
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
    if (!md)
        return '';
    let html = '';
    if (typeof marked !== 'undefined') {
        marked.setOptions({ renderer: new marked.Renderer() });
        html = marked.parse(md);
    }
    else {
        html = md.replace(/\n/g, '<br>');
    }
    // Replace badges with styled spans
    // FR badges
    html = html.replace(/\[NOUVEAU\]/g, '<span class="md-badge md-badge-new">' + t('update.badge.new') + '</span>');
    html = html.replace(/\[RAFFINEMENT\]/g, '<span class="md-badge md-badge-refine">' + t('update.badge.refine') + '</span>');
    html = html.replace(/\[AMÉLIORÉ\]/g, '<span class="md-badge md-badge-improved">' + t('update.badge.improved') + '</span>');
    html = html.replace(/\[FIXÉ\]/g, '<span class="md-badge md-badge-fixed">' + t('update.badge.fixed') + '</span>');
    html = html.replace(/\[VISUEL\]/g, '<span class="md-badge md-badge-visual">' + t('update.badge.visual') + '</span>');
    // EN badges
    html = html.replace(/\[NEW\]/g, '<span class="md-badge md-badge-new">' + t('update.badge.new') + '</span>');
    html = html.replace(/\[REFINE\]/g, '<span class="md-badge md-badge-refine">' + t('update.badge.refine') + '</span>');
    html = html.replace(/\[IMPROVED\]/g, '<span class="md-badge md-badge-improved">' + t('update.badge.improved') + '</span>');
    html = html.replace(/\[FIXED\]/g, '<span class="md-badge md-badge-fixed">' + t('update.badge.fixed') + '</span>');
    html = html.replace(/\[VISUAL\]/g, '<span class="md-badge md-badge-visual">' + t('update.badge.visual') + '</span>');
    return `<div class="md-body">${html}</div>`;
}
// Inject markdown body styles once
(function injectMarkdownStyles() {
    if (document.getElementById('md-body-styles'))
        return;
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
        
        .md-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-right: 6px;
            margin-bottom: 4px;
        }
        .md-badge-new {
            background: rgba(16, 185, 129, 0.15);
            color: #10b981;
            border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .md-badge-refine {
            background: rgba(59, 130, 246, 0.15);
            color: #3b82f6;
            border: 1px solid rgba(59, 130, 246, 0.3);
        }
        .md-badge-improved {
            background: rgba(245, 158, 11, 0.15);
            color: #f59e0b;
            border: 1px solid rgba(245, 158, 11, 0.3);
        }
        .md-badge-fixed {
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .md-badge-visual {
            background: rgba(168, 85, 247, 0.15);
            color: #a855f7;
            border: 1px solid rgba(168, 85, 247, 0.3);
        }
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
    }
    catch (e) {
        console.warn('[BMM] Failed to check update disabled status:', e);
    }
    const updateCheckButtonsState = () => {
        const isAuto = isAutoUpdateEnabled();
        const sidebarBtn = document.getElementById('btn-check-updates');
        const settingsBtn = document.getElementById('btn-settings-check-update');
        [sidebarBtn, settingsBtn].forEach(btn => {
            if (!btn)
                return;
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
        }
        else {
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
            openUpdateNotesModal();
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
        }
        else {
            if (showNoUpdateToast) {
                toast(t('settings.upToDate') || 'You are running the latest version!', 'success');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--success)">✓ ${t('settings.upToDate') || 'Up to date'} (v${escHtml(info.current_version)})</span>`;
            }
        }
    }
    catch (err) {
        console.warn('[BMM] Update check failed:', err);
        const errStr = String(err);
        if (errStr.includes('NO_RELEASE')) {
            if (showNoUpdateToast) {
                toast(t('settings.noRelease') || 'No releases published on GitHub yet.', 'info');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--warning)">⚠ ${t('settings.noRelease') || 'No releases yet'}</span>`;
            }
        }
        else {
            if (showNoUpdateToast) {
                toast((t('settings.updateCheckFailed') || 'Update check failed') + ': ' + err, 'error');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--danger)">✗ ${t('settings.updateCheckFailed') || 'Check failed'}</span>`;
            }
        }
    }
    finally {
        if (sidebarBtn) {
            sidebarBtn.classList.remove('checking');
            sidebarBtn.querySelector('span').textContent = t('settings.checkUpdates') || 'Check for Updates';
        }
    }
}
function showUpdateAvailableModal(info) {
    const existing = document.getElementById('update-available-modal');
    if (existing)
        existing.remove();
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
                if (!filename.includes('.'))
                    filename += '.exe';
                await invoke('download_and_install_update', { url: info.download_url, filename });
                downloadBtn.innerHTML = t('common.installing');
            }
            catch (err) {
                toast(t('common.error') + ' : ' + String(err), 'error');
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = originalContent;
            }
        });
    }
    modal.querySelector('#close-update-modal').addEventListener('click', () => modal.remove());
    modal.querySelector('#btn-update-later').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal)
        modal.remove(); });
}
// ── PTB (Public Test Build) Modal ───────────────────────
const PTB_DISMISSED_KEY = 'bmm_ptb_dismissed';
export async function checkPtbMode(force = false, initialFileName = null) {
    if (!force && sessionStorage.getItem(PTB_DISMISSED_KEY))
        return;
    try {
        const isPtb = await invoke('is_ptb_mode');
        if (!isPtb && !force)
            return;
        const { getLang } = await import('../core/i18n.js');
        const lang = getLang();
        const folderStructure = await invoke('get_update_folder_structure', { lang });
        showPtbModal(folderStructure, lang, initialFileName);
    }
    catch (e) {
        console.warn('[BMM] PTB check failed:', e);
    }
}
async function showPtbModal(folderStructure, lang, initialFileName = null) {
    const existing = document.getElementById('ptb-welcome-modal');
    if (existing)
        existing.remove();
    // Flatten folder structure to get all notes with their paths
    const allNotesMap = new Map();
    async function loadNotesFromStructure(structure, basePath = '') {
        for (const item of structure) {
            const itemPath = item.path;
            if (item.is_folder) {
                await loadNotesFromStructure(item.children, itemPath);
            }
            else {
                try {
                    const subDir = basePath ? basePath.split('/').join('\\') : null;
                    const notes = await invoke('get_update_notes', { subDir, lang });
                    const note = notes.find((n) => n.filename === item.name);
                    if (note) {
                        allNotesMap.set(itemPath, { ...note, path: itemPath });
                    }
                }
                catch (e) {
                    console.error(e);
                }
            }
        }
    }
    await loadNotesFromStructure(folderStructure);
    const allNotes = Array.from(allNotesMap.values());
    if (allNotes.length === 0)
        return;
    const modal = document.createElement('div');
    modal.id = 'ptb-welcome-modal';
    modal.className = 'update-modal-backdrop';
    let activeNote = allNotes[0];
    if (initialFileName) {
        const found = allNotes.find(n => n.filename.includes(initialFileName));
        if (found)
            activeNote = found;
    }
    const renderHeader = () => `
        <div class="ptb-header-title">
            <div class="ptb-header-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <span>${t('settings.notesTitle')}</span>
        </div>
        <button class="update-modal-close" id="close-ptb-modal">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;
    const renderFolderTree = (items, depth = 0) => {
        return items.map(item => {
            const paddingLeft = 12 + depth * 16;
            if (item.is_folder) {
                return `
                    <div class="tree-folder" style="padding-left:${paddingLeft}px">
                        <div class="tree-folder-header" data-folder="${escAttr(item.path)}" style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                            ${escHtml(item.name)}
                        </div>
                        <div class="tree-folder-children" style="display:none">
                            ${renderFolderTree(item.children, depth + 1)}
                        </div>
                    </div>
                `;
            }
            else {
                const note = allNotes.find(n => n.path === item.path);
                return `
                    <div class="ptb-sidebar-item ${allNotes.length > 0 && note === allNotes[0] ? 'active' : ''}" data-path="${escAttr(item.path)}" style="padding:8px ${paddingLeft + 8}px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:var(--transition); border-left:2px solid transparent;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(item.name)}</span>
                    </div>
                `;
            }
        }).join('');
    };
    const renderSidebar = () => {
        return `<div class="ptb-sidebar">${renderFolderTree(folderStructure)}</div>`;
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
    // Folder toggle logic
    modal.querySelectorAll('.tree-folder-header').forEach(header => {
        header.addEventListener('click', () => {
            const children = header.nextElementSibling;
            if (children) {
                children.style.display = children.style.display === 'none' ? 'block' : 'none';
            }
        });
    });
    modal.addEventListener('click', (e) => {
        const item = e.target.closest('.ptb-sidebar-item');
        if (item) {
            const path = item.dataset.path;
            const note = allNotes.find(n => n.path === path);
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
    modal.addEventListener('click', (e) => { if (e.target === modal)
        close(); });
}
// ── Licenses ──────────────────────────────────────────────
export async function openLicenseModal() {
    const modal = document.getElementById('modal-license');
    const contentEl = document.getElementById('license-content');
    if (!modal || !contentEl)
        return;
    modal.classList.add('open');
    contentEl.textContent = t('common.loading');
    try {
        const text = await invoke('get_license_text');
        contentEl.textContent = text;
    }
    catch (err) {
        contentEl.textContent = t('common.error') + " (License): " + err;
    }
}
// ── EULA ──────────────────────────────────────────────────
export async function openEulaModal(showButtons = false) {
    const modal = document.getElementById('modal-eula');
    const contentEl = document.getElementById('eula-content');
    if (!modal || !contentEl)
        return;
    modal.classList.add('open');
    // Toggle UI based on whether buttons are shown or just viewing
    const footer = modal.querySelector('.modal-footer');
    const closeBtn = document.getElementById('btn-eula-close');
    if (footer) {
        footer.style.setProperty('display', showButtons ? 'flex' : 'none', 'important');
    }
    if (closeBtn) {
        closeBtn.style.display = showButtons ? 'none' : 'block';
    }
    // Prevent closing if buttons are shown (mandatory acceptance)
    modal.setAttribute('data-prevent-close', showButtons ? 'true' : 'false');
    contentEl.textContent = t('common.loading');
    try {
        const { getLang } = await import('../core/i18n.js');
        const lang = getLang();
        const text = await invoke('get_eula_text', { lang });
        contentEl.innerHTML = renderMarkdown(text);
    }
    catch (err) {
        contentEl.textContent = t('common.error') + " (EULA): " + err;
    }
    // Setup Accept button
    const acceptBtn = document.getElementById('btn-eula-accept');
    if (acceptBtn) {
        acceptBtn.onclick = () => {
            markEulaAccepted();
            modal.classList.remove('open');
        };
    }
    // Setup Quit button
    const quitBtn = document.getElementById('btn-eula-quit');
    if (quitBtn) {
        quitBtn.onclick = () => {
            invoke('exit_app');
        };
    }
}
// Global expose for onclick
window.openLicenseModal = openLicenseModal;
window.openEulaModal = openEulaModal;
window.checkPtbMode = checkPtbMode;
// ── Auto EULA on First Start ────────────────────────────────
const EULA_ACCEPTED_KEY = 'bmm_eula_accepted';
export async function checkAutoEula() {
    try {
        const isEnabled = await invoke('is_auto_eula_enabled');
        const isAccepted = localStorage.getItem(EULA_ACCEPTED_KEY) === 'true';
        if (isEnabled && !isAccepted) {
            // Show EULA modal with mandatory buttons
            await openEulaModal(true);
        }
    }
    catch (e) {
        console.warn('[BMM] Auto EULA check failed:', e);
    }
}
// ── Auto Show Release Notes on Startup ─────────────────────
const RELEASE_NOTES_SHOWN_KEY = 'bmm_release_notes_shown';
export async function checkShowReleaseNotes() {
    try {
        const wasShown = localStorage.getItem(RELEASE_NOTES_SHOWN_KEY) === 'true';
        if (!wasShown) {
            // Show release notes modal
            await openUpdateNotesModal();
            localStorage.setItem(RELEASE_NOTES_SHOWN_KEY, 'true');
        }
    }
    catch (e) {
        console.warn('[BMM] Auto release notes check failed:', e);
    }
}
export function markEulaAccepted() {
    localStorage.setItem(EULA_ACCEPTED_KEY, 'true');
}
window.markEulaAccepted = markEulaAccepted;
//# sourceMappingURL=update-notes.js.map