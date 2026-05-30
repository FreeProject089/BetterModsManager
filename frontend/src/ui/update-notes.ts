// @ts-nocheck
/**
 * update-notes.js — Update notes, PTB modal, auto-update, licenses, markdown rendering
 * Extracted from app.js for modularity
 */

import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';
import { toast } from './app.js';
import { escHtml, escAttr } from '../core/utils.js';
import { getLinks } from '../core/links-config.js';

// Persistence for expanded folders in the release notes tree
const expandedFolders = new Set<string>();

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
    } catch (e) { console.error(e); }

    // Flatten folder structure to get all notes with their paths
    const allNotesMap = new Map<string, { filename: string; content: string; path: string }>();
    
    async function loadNotesFromStructure(structure: any[], basePath: string = '') {
        for (const item of structure) {
            const itemPath = item.path;
            if (item.is_folder) {
                await loadNotesFromStructure(item.children, itemPath);
            } else {
                try {
                    const subDir = basePath ? basePath.split('/').join('\\') : null;
                    const notes = await invoke('get_update_notes', { subDir, lang });
                    const note = notes.find((n: any) => n.filename === item.name);
                    if (note) {
                        allNotesMap.set(itemPath, { ...note, path: itemPath });
                    }
                } catch (e) { console.error(e); }
            }
        }
    }
    
    await loadNotesFromStructure(folderStructure);
    const allNotes = Array.from(allNotesMap.values());

    // Find the main .md file with language suffix at the root of Update folder (not in subdirectories)
    let defaultNote = allNotes[0];
    const langSuffix = lang === 'fr' ? '_FR.md' : '_EN.md';
    const rootLangFile = allNotes.find(n => n.path === n.filename && n.filename.endsWith(langSuffix));
    if (rootLangFile) {
        defaultNote = rootLangFile;
    }

    let modal = document.getElementById('modal-update-notes');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-update-notes';
        modal.className = 'update-modal-backdrop';
        document.getElementById('app-window-outer').appendChild(modal);
    }

    // Render folder tree
    // IMPORTANT: always compute a full nested path, otherwise files in subfolders won't be clickable.
    const renderFolderTree = (items: any[], depth: number = 0): string => {
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
                <div class="ptb-sidebar-item ${allNotes.length > 0 && note === defaultNote ? 'active' : ''}" data-path="${escAttr(fullPath)}" style="padding:8px ${paddingLeft + 8}px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:var(--transition); border-left:2px solid transparent;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(item.name)}</span>
                </div>
            `;
        }).join('');
    };

    const renderHeader = () => `
        <div class="ptb-header-title">
            <div class="ptb-header-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <span>${t('update.title')}</span>
        </div>
        <button class="ptb-modal-close" id="close-update-notes">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;

    const renderSidebar = () => {
        return `<div class="ptb-modal-sidebar">${renderFolderTree(folderStructure)}</div>`;
    };

    const renderContent = (note) => {
        return `<div class="ptb-modal-body" style="overflow-y:auto; flex:1; padding:40px 60px;">${note ? renderMarkdown(note.content) : `<p style="color:var(--text-muted)">${t('update.none')}</p>`}</div>`;
    };

    modal.innerHTML = `
        <div class="ptb-modal-card">
            <div class="ptb-modal-header">${renderHeader()}</div>
            <div class="ptb-modal-layout">
                ${renderSidebar()}
                <div id="update-notes-content-target" style="flex:1; display:flex; flex-direction:column; overflow:hidden">
                    ${renderContent(defaultNote)}
                </div>
            </div>
        </div>
    `;
    modal.classList.add('open');
    modal.querySelector('#close-update-notes')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

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
                if (isNowOpen) expandedFolders.add(folderPath);
                else expandedFolders.delete(folderPath);
                
                // Animate chevron
                const svg = header.querySelector('svg');
                if (svg) svg.style.transform = `rotate(${isNowOpen ? '90deg' : '0'})`;
            }
        });
    });

    // Sidebar selection logic with event delegation
    const contentArea = modal.querySelector('#update-notes-content-target');

    // Use a named function to avoid duplicate listeners if modal already existed
    const handleModalClick = async (e: MouseEvent) => {
        const link = (e.target as HTMLElement).closest('a');
        if (link) {
            const href = link.getAttribute('href');
            if (href) {
                e.preventDefault();
                e.stopPropagation();
                
                if (href.startsWith('http')) {
                    invoke('open_external_url', { url: href }).catch(err => window.open(href, '_blank'));
                } else if (href.toLowerCase().includes('.md')) {
                    // Fuzzy match filename (ignoring path and common suffixes like _EN/_FR)
                    const fileName = href.split('/').pop()?.toLowerCase().replace(/(_en|_fr)\.md$/, '.md');
                    if (fileName) {
                        const items = Array.from(modal.querySelectorAll('.ptb-sidebar-item')) as HTMLElement[];
                        const targetItem = items.find(el => {
                            const p = el.dataset.path?.toLowerCase() || '';
                            const cleanP = p.replace(/(_en|_fr)\.md$/, '.md');
                            return cleanP.endsWith(fileName) || p.endsWith(fileName);
                        });

                        if (targetItem) {
                            targetItem.click();
                        } else {
                            toast(t('update.pageNotFound', { name: fileName }) || "Page not found: " + fileName, "warning");
                        }
                    }
                }
            }
            return;
        }

        const item = (e.target as HTMLElement).closest('.ptb-sidebar-item') as HTMLElement;
        if (!item) return;
        
        e.stopPropagation();

        // Remove active from all items
        modal.querySelectorAll('.ptb-sidebar-item').forEach(i => i.classList.remove('active'));
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
                    if (folderPath) expandedFolders.add(folderPath);
                    const svg = header.querySelector('svg');
                    if (svg) svg.style.transform = 'rotate(90deg)';
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
                const foundNote = notes.find((n: any) => n.filename === fileName);
                if (foundNote) {
                    note = { ...foundNote, path };
                }
            } catch (err) {
                console.error('Failed to load note on-demand:', err);
            }
        }
        
        if (note) {
            contentArea.innerHTML = renderContent(note);
            if (contentArea) contentArea.scrollTop = 0;
        } else {
            console.warn('Note not found for path:', path);
            if (contentArea) contentArea.innerHTML = renderContent(null);
        }
    };

    // Remove old listener if exists (if modal was already in DOM)
    modal.removeEventListener('click', (modal as any)._bmm_click_handler);
    (modal as any)._bmm_click_handler = handleModalClick;
    modal.addEventListener('click', handleModalClick);
}



export function initUpdateNotes() {
    const btn = document.getElementById('btn-show-updates');
    if (!btn) return;
    btn.addEventListener('click', openUpdateNotesModal);
}

/**
 * Copies text to clipboard with a toast notification
 */
window.copyCodeToClipboard = (text, btn) => {
    navigator.clipboard.writeText(text).then(() => {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> ' + (t('update.copied') || 'Copied!');
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
    html = html.replace(/\[MAJOR\]/g, '<span class="md-badge md-badge-major">' + t('update.badge.major') + '</span>');
    html = html.replace(/\[MAJEUR\]/g, '<span class="md-badge md-badge-major">' + t('update.badge.major') + '</span>');
    
    // GitHub-style alerts
    html = html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|REMARQUE|ASTUCE|AVERTISSEMENT|ATTENTION)\](?:<br>)?\s*/gi, (match, type) => {
        const tLower = type.toLowerCase();
        let alertClass = 'note';
        if (tLower === 'tip' || tLower === 'astuce') alertClass = 'tip';
        else if (tLower === 'important') alertClass = 'important';
        else if (tLower === 'warning' || tLower === 'avertissement') alertClass = 'warning';
        else if (tLower === 'caution' || tLower === 'attention') alertClass = 'caution';
        else if (tLower === 'note' || tLower === 'remarque') alertClass = 'note';
        
        const title = t(`update.alert.${alertClass}`);
        return `<blockquote class="md-alert md-alert-${alertClass}"><div class="md-alert-title">${title}</div><p>`;
    });

    // Add Copy buttons to code blocks
    html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (match, attrs, content) => {
        return `
        <div class="md-code-block" style="position: relative; margin: 10px 0;">
            <pre style="margin: 0; padding-top: 36px; position: relative;"><code${attrs}>${content}</code></pre>
            <button class="md-copy-btn" onclick="let b=this; let code=this.previousElementSibling.innerText; navigator.clipboard.writeText(code).then(()=>{ b.innerHTML='${t('update.copied') || 'Copied!'}'; setTimeout(()=>b.innerHTML='${t('update.copy') || 'Copy'}', 2000) })" style="position: absolute; top: 8px; right: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: var(--text-secondary); border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer; transition: 0.2s; text-transform: uppercase;">${t('update.copy') || 'Copy'}</button>
        </div>`;
    });

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
            background: rgba(10, 17, 40, 0.85);
            backdrop-filter: blur(10px);
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
        
        .md-body blockquote.md-alert {
            padding: 12px 16px;
            background: rgba(0,0,0,0.1);
        }
        .md-alert-title {
            font-weight: 700;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .md-alert-note { border-left-color: var(--accent); background: rgba(59, 130, 246, 0.1) !important; }
        .md-alert-note .md-alert-title { color: var(--accent); }
        
        .md-alert-tip { border-left-color: #10b981; background: rgba(16, 185, 129, 0.1) !important; }
        .md-alert-tip .md-alert-title { color: #10b981; }
        
        .md-alert-important { border-left-color: #a855f7; background: rgba(168, 85, 247, 0.1) !important; }
        .md-alert-important .md-alert-title { color: #a855f7; }
        
        .md-alert-warning { border-left-color: #f59e0b; background: rgba(245, 158, 11, 0.1) !important; }
        .md-alert-warning .md-alert-title { color: #f59e0b; }
        
        .md-alert-caution { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1) !important; }
        .md-alert-caution .md-alert-title { color: #ef4444; }
        
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
        .md-badge-major {
            background: rgba(249, 115, 22, 0.15);
            color: #f97316;
            border: 1px solid rgba(249, 115, 22, 0.3);
        }
    `;
    document.head.appendChild(style);
})();


// ── Auto Update System ──────────────────────────────────

const AUTO_UPDATE_KEY = 'bmm_auto_update_enabled';
const PRERELEASE_KEY  = 'bmm_prerelease_enabled';

function isAutoUpdateEnabled() {
    const val = localStorage.getItem(AUTO_UPDATE_KEY);
    return val !== 'false'; // Default to enabled
}

function setAutoUpdateEnabled(enabled) {
    localStorage.setItem(AUTO_UPDATE_KEY, enabled ? 'true' : 'false');
}

export function isPreReleaseEnabled() {
    return localStorage.getItem(PRERELEASE_KEY) === 'true'; // Default OFF
}

function setPreReleaseEnabled(enabled) {
    localStorage.setItem(PRERELEASE_KEY, enabled ? 'true' : 'false');
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

    // Pre-release toggle
    const chkPre = document.getElementById('chk-prerelease') as HTMLInputElement | null;
    if (chkPre) {
        if (isDisabled) {
            chkPre.checked = false;
            chkPre.disabled = true;
        } else {
            chkPre.checked = isPreReleaseEnabled();
            chkPre.addEventListener('change', () => {
                setPreReleaseEnabled(chkPre.checked);
                toast(chkPre.checked
                    ? (t('settings.preReleaseEnabled') || 'Pre-releases enabled — you will receive beta builds')
                    : (t('settings.preReleaseDisabled') || 'Pre-releases disabled'), 'info');
                // Re-check immediately so the user sees the effect
                performUpdateCheck(true);
            });
        }
    }

    // Sidebar button listener
    const sidebarBtn = document.getElementById('btn-check-updates');
    if (sidebarBtn && !isDisabled) {
        sidebarBtn.addEventListener('click', () => {
            performUpdateCheck(true);
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
        const info = await invoke('check_for_update', { includePrerelease: isPreReleaseEnabled(), apiBaseUrl: getLinks().autoupdate_api });

        if (info.has_update) {
            showUpdateAvailableModal(info);
            [sidebarBtn, document.getElementById('btn-settings-check-update')].forEach(btn => {
                if (btn) btn.classList.add('has-update');
            });
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--success)">✓ ${t('settings.updateAvailable') || 'Update available'}: v${escHtml(info.latest_version)}</span>`;
            }
        } else {
            [sidebarBtn, document.getElementById('btn-settings-check-update')].forEach(btn => {
                if (btn) btn.classList.remove('has-update');
            });
            if (showNoUpdateToast) {
                toast(t('settings.upToDate') || 'You are running the latest version!', 'success');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--success)">✓ ${t('settings.upToDate') || 'Up to date'} (v${escHtml(info.current_version)})</span>`;
            }
        }
    } catch (err) {
        const errStr = String(err);
        // Silently swallow network/timeout errors — don't log as [RPC ERROR]
        if (errStr.includes('NETWORK_ERROR') || errStr.includes('NO_RELEASE')) {
            if (statusMsg) {
                statusMsg.innerHTML = errStr.includes('NO_RELEASE')
                    ? `<span style="color:var(--warning)">⚠ ${t('settings.noRelease') || 'No releases yet'}</span>`
                    : `<span style="color:var(--text-muted)">— ${t('settings.updateUnavailable') || 'Unavailable'}</span>`;
            }
            if (errStr.includes('NO_RELEASE') && showNoUpdateToast) {
                toast(t('settings.noRelease') || 'No releases on GitHub yet.', 'info');
            }
        } else {
            console.warn('[BMM] Update check failed:', err);
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

    // Use the rich markdown renderer (badges, GitHub-style alerts, code copy
    // buttons, tables…) instead of a raw marked.parse — much nicer notes.
    const releaseNotes = info.release_notes ? renderMarkdown(info.release_notes) : '';
    const isPre = !!info.is_prerelease;

    const modal = document.createElement('div');
    modal.id = 'update-available-modal';
    modal.style.cssText = `
        position:fixed;inset:0;z-index:10400;
        display:flex;align-items:center;justify-content:center;padding:24px;
        background:rgba(0,0,0,0.75);
        backdrop-filter:blur(8px);
        animation:fadeIn 0.18s ease;
    `;

    modal.innerHTML = `
        <div id="upd-card" style="
            width:100%;max-width:480px;
            background:linear-gradient(160deg,#0d1424 0%,#090e1a 100%);
            border:1px solid rgba(16,185,129,0.22);
            border-radius:20px;
            overflow:hidden;
            box-shadow:0 0 0 1px rgba(255,255,255,0.04) inset,0 8px 32px rgba(0,0,0,0.6),0 32px 80px rgba(0,0,0,0.4);
            animation:modalIn 0.28s cubic-bezier(0.22,1,0.36,1);
            position:relative;
        ">
            <!-- Glow accent -->
            <div style="position:absolute;top:-60px;right:-60px;width:200px;height:200px;background:radial-gradient(circle,rgba(16,185,129,0.12) 0%,transparent 70%);pointer-events:none;"></div>

            <!-- Close -->
            <button id="close-update-modal" style="
                position:absolute;top:12px;right:12px;z-index:2;
                width:28px;height:28px;border-radius:8px;border:none;cursor:pointer;
                background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.5);
                display:flex;align-items:center;justify-content:center;
                transition:background 0.15s,color 0.15s;
            " onmouseover="this.style.background='rgba(255,255,255,0.12)';this.style.color='#fff'"
               onmouseout="this.style.background='rgba(255,255,255,0.06)';this.style.color='rgba(255,255,255,0.5)'">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>

            <!-- Hero -->
            <div style="
                display:flex;align-items:center;gap:16px;
                padding:22px 24px 18px;
                background:linear-gradient(135deg,rgba(16,185,129,0.08) 0%,rgba(59,130,246,0.04) 100%);
                border-bottom:1px solid rgba(255,255,255,0.06);
            ">
                <img src="assets/Tasky_Happy.png" alt="Tasky" style="
                    width:54px;height:54px;object-fit:contain;flex-shrink:0;
                    filter:drop-shadow(0 4px 16px rgba(16,185,129,0.35));
                    animation:float 3s ease-in-out infinite;
                ">
                <div>
                    <div style="font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${isPre ? '#f59e0b' : '#10b981'};margin-bottom:4px;display:flex;align-items:center;gap:5px;">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="${isPre ? '#f59e0b' : '#10b981'}"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                        ${isPre ? (t('update.preReleaseTag') || 'PRE-RELEASE') : (t('update.newVersion') || 'NEW VERSION')}
                    </div>
                    <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.01em;line-height:1.2;">
                        ${t('settings.updateAvailableTitle') || 'Update Available!'}
                    </div>
                    <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:3px;">
                        ${t('settings.newVersionReady') || 'A new version of Better Mod Manager is ready.'}
                    </div>
                </div>
            </div>

            <!-- Body -->
            <div style="padding:18px 22px 20px;display:flex;flex-direction:column;gap:14px;">

                <!-- Version diff -->
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="flex:1;padding:10px 14px;border-radius:11px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.18);text-align:center;">
                        <div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:rgba(239,68,68,0.7);margin-bottom:4px;">${t('settings.currentVersion') || 'CURRENT'}</div>
                        <div style="font-size:20px;font-weight:800;color:#ef4444;font-family:var(--font-mono,monospace);letter-spacing:-0.02em;">v${escHtml(info.current_version)}</div>
                    </div>
                    <div style="color:rgba(255,255,255,0.2);flex-shrink:0;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </div>
                    <div style="flex:1;padding:10px 14px;border-radius:11px;background:rgba(16,185,129,0.07);border:1px solid rgba(16,185,129,0.22);text-align:center;">
                        <div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:rgba(16,185,129,0.7);margin-bottom:4px;">${t('settings.latestVersion') || 'LATEST'}</div>
                        <div style="font-size:20px;font-weight:800;color:#10b981;font-family:var(--font-mono,monospace);letter-spacing:-0.02em;">v${escHtml(info.latest_version)}</div>
                    </div>
                </div>

                <!-- Release notes -->
                ${releaseNotes ? `
                <div style="border-radius:12px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;background:rgba(0,0,0,0.18);">
                    <div style="display:flex;align-items:center;gap:7px;padding:9px 13px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.45);">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        ${t('settings.releaseNotes') || "WHAT'S NEW"}
                        <span style="flex:1;"></span>
                        <span style="font-weight:700;color:#10b981;letter-spacing:0;">v${escHtml(info.latest_version)}</span>
                    </div>
                    <div class="upd-notes-scroll" style="max-height:230px;overflow-y:auto;padding:6px 16px 12px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;">
                        ${releaseNotes}
                    </div>
                </div>
                ` : ''}

                <!-- Progress bar (incremental update) -->
                <div id="incremental-progress-section" style="display:none;border-radius:10px;padding:12px 14px;border:1px solid rgba(59,130,246,0.2);background:rgba(59,130,246,0.05);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span id="incremental-progress-label" style="font-size:12px;font-weight:600;color:var(--text-secondary);">Applying update...</span>
                        <span id="incremental-progress-count" style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">0 / 0</span>
                    </div>
                    <div style="height:3px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden;">
                        <div id="incremental-progress-bar" style="height:100%;background:linear-gradient(90deg,#10b981,#3b82f6);width:0%;transition:width 0.3s ease;border-radius:3px;"></div>
                    </div>
                    <div id="incremental-progress-file" style="font-size:10px;color:var(--text-muted);margin-top:5px;font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
                </div>

                <!-- Actions -->
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${info.manifest_url ? `
                    <button id="btn-incremental-update" style="
                        display:flex;align-items:center;justify-content:center;gap:9px;
                        padding:11px 16px;border-radius:11px;border:none;cursor:pointer;
                        background:linear-gradient(135deg,#10b981,#059669);
                        color:#fff;font-size:13px;font-weight:700;
                        box-shadow:0 4px 16px rgba(16,185,129,0.3);
                        transition:opacity 0.15s,transform 0.15s;
                    " onmouseover="this.style.opacity='0.9';this.style.transform='translateY(-1px)'"
                       onmouseout="this.style.opacity='1';this.style.transform='translateY(0)'">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                        <span>${t('update.quickUpdate') || 'Quick Update'}</span>
                        <span style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,0.18);">${t('update.recommended') || 'Recommended'}</span>
                    </button>
                    ` : ''}
                    <div style="display:flex;gap:8px;">
                        <button id="btn-update-later" style="
                            flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;
                            background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.5);
                            font-size:12px;font-weight:600;transition:background 0.15s,color 0.15s;
                        " onmouseover="this.style.background='rgba(255,255,255,0.08)';this.style.color='#fff'"
                           onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.color='rgba(255,255,255,0.5)'"
                        >${t('settings.later') || 'Later'}</button>
                        <button id="btn-download-install-update" style="
                            flex:2;display:flex;align-items:center;justify-content:center;gap:8px;
                            padding:10px 14px;border-radius:10px;cursor:pointer;
                            border:1px solid rgba(59,130,246,0.3);
                            background:rgba(59,130,246,0.1);color:rgba(255,255,255,0.75);
                            font-size:12px;font-weight:600;transition:background 0.15s,color 0.15s;
                        " onmouseover="this.style.background='rgba(59,130,246,0.2)';this.style.color='#fff'"
                           onmouseout="this.style.background='rgba(59,130,246,0.1)';this.style.color='rgba(255,255,255,0.75)'">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            ${t('update.fullInstaller') || 'Full Installer (.msi)'}
                        </button>
                    </div>
                </div>

                <!-- GitHub link -->
                <div style="text-align:center;">
                    <a href="${escAttr(info.release_url)}" target="_blank" style="font-size:11px;color:rgba(59,130,246,0.6);text-decoration:none;transition:color 0.15s;"
                       onmouseover="this.style.color='#3b82f6'" onmouseout="this.style.color='rgba(59,130,246,0.6)'">
                        ${t('settings.viewOnGithub') || 'View release on GitHub'} ↗
                    </a>
                </div>
            </div>
        </div>
    `;

    (document.getElementById('app-window-outer') || document.body).appendChild(modal);

    // Incremental update button
    const incrementalBtn = modal.querySelector('#btn-incremental-update');
    if (incrementalBtn && info.manifest_url) {
        incrementalBtn.addEventListener('click', async () => {
            const progressSection = modal.querySelector('#incremental-progress-section') as HTMLElement;
            const progressBar = modal.querySelector('#incremental-progress-bar') as HTMLElement;
            const progressLabel = modal.querySelector('#incremental-progress-label') as HTMLElement;
            const progressCount = modal.querySelector('#incremental-progress-count') as HTMLElement;
            const progressFile = modal.querySelector('#incremental-progress-file') as HTMLElement;

            incrementalBtn.disabled = true;
            const fullBtn = modal.querySelector('#btn-download-install-update') as HTMLButtonElement;
            if (fullBtn) fullBtn.disabled = true;
            progressSection.style.display = 'block';
            progressLabel.textContent = t('update.fetchingManifest') || 'Fetching manifest...';

            try {
                // Fetch the manifest
                const manifest = await invoke('fetch_update_manifest', { url: info.manifest_url });
                progressLabel.textContent = t('update.applyingUpdate') || 'Applying update...';

                // Listen to progress events
                const { listen } = await import('../../node_modules/@tauri-apps/api/event.js').catch(() => (window as any).__TAURI__?.event);
                let unlisten: (() => void) | null = null;
                if (listen) {
                    unlisten = await listen('update-progress', (evt: any) => {
                        const d = evt.payload;
                        const pct = Math.round(((d.index + 1) / d.total) * 100);
                        progressBar.style.width = pct + '%';
                        progressCount.textContent = `${d.index + 1} / ${d.total}`;
                        progressFile.textContent = d.file;
                        progressLabel.textContent = d.status === 'skipped'
                            ? (t('update.skipped') || 'Skipping unchanged files...')
                            : (t('update.applyingUpdate') || 'Applying update...');
                    });
                }

                // Apply the update
                const result: any = await invoke('apply_incremental_update', { manifest });
                if (unlisten) unlisten();

                progressBar.style.width = '100%';

                if (result.errors && result.errors.length > 0) {
                    toast(`Update partial: ${result.applied} applied, ${result.errors.length} errors`, 'warning');
                } else {
                    toast(t('update.incrementalSuccess') || `Update applied! ${result.applied} files updated, ${result.skipped} unchanged. Restart BMM to complete.`, 'success');
                }
                progressLabel.textContent = t('update.done') || 'Done! Restart BMM to apply changes.';
                progressSection.style.background = 'rgba(16,185,129,0.06)';
                progressSection.style.borderColor = 'rgba(16,185,129,0.2)';
            } catch (err) {
                toast(t('common.error') + ': ' + String(err), 'error');
                progressLabel.textContent = 'Error — try the full installer';
                incrementalBtn.disabled = false;
                if (modal.querySelector('#btn-download-install-update')) {
                    (modal.querySelector('#btn-download-install-update') as HTMLButtonElement).disabled = false;
                }
            }
        });
    }

    const downloadBtn = modal.querySelector('#btn-download-install-update');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
            const originalContent = downloadBtn.innerHTML;
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ' + (t('update.downloading') || 'Downloading...');
            try {
                let filename = info.download_url.split('/').pop() || 'setup.exe';
                if (!filename.includes('.')) filename += '.exe';
                await invoke('download_and_install_update', { url: info.download_url, filename });
                downloadBtn.innerHTML = t('common.installing');
            } catch (err) {
                toast(t('common.error') + ' : ' + String(err), 'error');
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

        const { getLang } = await import('../core/i18n.js');
        const lang = getLang();

        const folderStructure = await invoke('get_update_folder_structure', { lang });
        showPtbModal(folderStructure, lang, initialFileName);
    } catch (e) {
        console.warn('[BMM] PTB check failed:', e);
    }
}

async function showPtbModal(folderStructure, lang, initialFileName = null) {
    const existing = document.getElementById('ptb-welcome-modal');
    if (existing) existing.remove();

    // Flatten folder structure to get all notes with their paths
    const allNotesMap = new Map<string, { filename: string; content: string; path: string }>();
    
    async function loadNotesFromStructure(structure: any[], basePath: string = '') {
        for (const item of structure) {
            const itemPath = item.path;
            if (item.is_folder) {
                await loadNotesFromStructure(item.children, itemPath);
            } else {
                try {
                    const subDir = basePath ? basePath.split('/').join('\\') : null;
                    const notes = await invoke('get_update_notes', { subDir, lang });
                    const note = notes.find((n: any) => n.filename === item.name);
                    if (note) {
                        allNotesMap.set(itemPath, { ...note, path: itemPath });
                    }
                } catch (e) { console.error(e); }
            }
        }
    }
    
    await loadNotesFromStructure(folderStructure);
    const allNotes = Array.from(allNotesMap.values());

    if (allNotes.length === 0) return;

    const modal = document.createElement('div');
    modal.id = 'ptb-welcome-modal';
    modal.className = 'update-modal-backdrop';

    // Find the main .md file with language suffix at the root of Update folder (not in subdirectories)
    let activeNote = allNotes[0];
    const langSuffix = lang === 'fr' ? '_FR.md' : '_EN.md';
    const rootLangFile = allNotes.find(n => n.path === n.filename && n.filename.endsWith(langSuffix));
    if (rootLangFile) {
        activeNote = rootLangFile;
    }
    // Override with initialFileName if provided (for guides)
    if (initialFileName) {
        const found = allNotes.find(n => n.filename.includes(initialFileName));
        if (found) activeNote = found;
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

    const renderFolderTree = (items: any[], depth: number = 0): string => {
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
            } else {
                const note = allNotes.find(n => n.path === item.path);
                return `
                    <div class="ptb-sidebar-item ${allNotes.length > 0 && note === activeNote ? 'active' : ''}" data-path="${escAttr(item.path)}" style="padding:8px ${paddingLeft + 8}px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:var(--transition); border-left:2px solid transparent;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(item.name)}</span>
                    </div>
                `;
            }
        }).join('');
    };

    const renderSidebar = () => {
        return `<div class="ptb-modal-sidebar">${renderFolderTree(folderStructure)}</div>`;
    };

    const renderContent = (note) => {
        return `<div class="ptb-modal-body" style="overflow-y:auto; flex:1; padding:40px 60px;">${renderMarkdown(note.content)}</div>`;
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
    setTimeout(() => modal.classList.add('open'), 10);

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
        const link = e.target.closest('a');
        if (link) {
            e.preventDefault();
            const href = link.getAttribute('href');
            if (href) {
                if (href.startsWith('http')) {
                    invoke('open_external_url', { url: href }).catch(err => window.open(href, '_blank'));
                } else if (href.endsWith('.md')) {
                    const fileName = href.split('/').pop();
                    if (fileName) {
                        const targetItem = Array.from(modal.querySelectorAll('.ptb-sidebar-item')).find(el => el.dataset.path?.endsWith(fileName));
                        if (targetItem) {
                            targetItem.click();
                        } else {
                            toast((t('update.pageNotFound') || 'Page not found: {name}').replace('{name}', fileName), "warning");
                        }
                    }
                }
            }
            return;
        }

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

// ── EULA ──────────────────────────────────────────────────
export async function openEulaModal(showButtons = false) {
    const modal = document.getElementById('modal-eula');
    const contentEl = document.getElementById('eula-content');
    if (!modal || !contentEl) return;

    modal.classList.add('open');
    
    // Toggle UI based on whether buttons are shown or just viewing
    const footer = modal.querySelector('.modal-footer') as HTMLElement;
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
    } catch (err) {
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
    } catch (e) {
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
    } catch (e) {
        console.warn('[BMM] Auto release notes check failed:', e);
    }
}

export function markEulaAccepted() {
    localStorage.setItem(EULA_ACCEPTED_KEY, 'true');
}

window.markEulaAccepted = markEulaAccepted;

// ── Language Selection on First Start ──────────────────────
const LANG_SELECTED_KEY = 'bmm_lang_selected';

export async function checkLangSelect(): Promise<void> {
    const alreadySelected = localStorage.getItem(LANG_SELECTED_KEY) === 'true';
    if (!alreadySelected) {
        await openLangSelectModal();
    }
}

async function openLangSelectModal(): Promise<void> {
    const { getLanguages, setLang, getLang } = await import('../core/i18n.js');

    const existing = document.getElementById('modal-lang-select');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-lang-select';
    modal.className = 'modal-backdrop open';
    modal.style.cssText = `
        position: fixed; inset: 0; z-index: 10500;
        display: flex; align-items: center; justify-content: center;
        background: rgba(5, 8, 22, 0.85);
        backdrop-filter: blur(12px);
        animation: fadeIn 0.35s ease;
    `;

    function buildContent() {
        const languages = getLanguages();
        const appLang = getLang();
        const current = languages.find(l => l.code === appLang) || languages.find(l => l.active) || languages[0];

        const getFlag = (l) => {
            if (!l || !l.flag) return '⚪';
            const f = l.flag.trim();
            if (f.length === 2) {
                const code = f.toLowerCase();
                return `<img src="https://flagcdn.com/w20/${code}.png" width="20" height="14" style="border-radius:2px;object-fit:cover;vertical-align:middle" onerror="this.outerHTML='<span style=font-size:10px;font-weight:700>${f.toUpperCase()}</span>'">`;
            }
            return `<span style="margin-right:6px">${f}</span>`;
        };

        return `
        <div style="
            background: rgba(10, 17, 40, 0.92);
            border: 1px solid rgba(255,255,255,0.08);
            border-top: 2px solid rgba(59,130,246,0.6);
            border-radius: 20px;
            padding: 36px 32px 28px;
            min-width: 340px;
            max-width: 400px;
            box-shadow: 0 8px 8px -4px rgba(0,0,0,0.4), 0 32px 80px -8px rgba(0,0,0,0.8), 0 0 0 1px rgba(59,130,246,0.1), inset 0 1px 0 rgba(255,255,255,0.05);
            backdrop-filter: blur(32px);
            animation: modalIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
            text-align: center;
            position: relative;
        ">
            <!-- Tasky mascot -->
            <div style="margin-bottom:20px">
                <img src="assets/Tasky_Happy.png" alt="Tasky"
                    style="width:80px; height:80px; object-fit:contain;
                    filter: drop-shadow(0 6px 18px rgba(59,130,246,0.4));
                    animation: float 3s ease-in-out infinite;">
            </div>

            <!-- Title -->
            <p style="font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:var(--accent); margin-bottom:8px">TASKY</p>
            <h2 style="font-size:20px; font-weight:800; color:var(--text-primary); margin:0 0 6px">
                ${t('onboarding.lang_title')}
            </h2>
            <p style="font-size:13px; color:var(--text-muted); margin:0 0 24px; line-height:1.5">
                ${t('onboarding.lang_desc')}
            </p>

            <!-- Language dropdown -->
            <div style="position:relative; margin-bottom:16px">
                <button id="lang-select-toggle" style="
                    width:100%; display:flex; align-items:center; gap:10px;
                    padding:10px 14px; border-radius:10px; cursor:pointer;
                    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12);
                    color:var(--text-primary); font-size:14px; font-weight:600;
                    transition:all 0.2s;
                ">
                    <span id="lang-select-flag">${getFlag(current)}</span>
                    <span id="lang-select-name" style="flex:1; text-align:left">${current ? current.name : ''}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" id="lang-select-chevron" style="transition:transform 0.2s"><polyline points="18 15 12 9 6 15"/></svg>
                </button>

                <div id="lang-select-menu" style="
                    display:none; position:absolute; bottom:calc(100% + 8px); left:0; right:0;
                    background:rgba(10,17,40,0.98); border:1px solid rgba(255,255,255,0.1);
                    border-radius:12px; overflow:hidden; z-index:10;
                    box-shadow:0 -8px 32px rgba(0,0,0,0.5);
                    backdrop-filter:blur(20px);
                ">
                    ${languages.map(l => `
                        <button class="lang-select-opt" data-lang="${l.code}" style="
                            width:100%; display:flex; align-items:center; gap:10px;
                            padding:10px 14px; border:none; cursor:pointer;
                            background:${l.active ? 'rgba(59,130,246,0.12)' : 'transparent'};
                            color:${l.active ? 'var(--accent)' : 'var(--text-secondary)'};
                            font-size:13px; font-weight:${l.active ? '700' : '500'};
                            transition:background 0.15s;
                        ">
                            ${getFlag(l)}
                            <span style="flex:1;text-align:left">${l.name}</span>
                            ${l.active ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- Confirm button -->
            <button id="lang-select-confirm" style="
                width:100%; padding:12px; border-radius:12px; border:none; cursor:pointer;
                background: linear-gradient(135deg, var(--accent), #6366f1);
                color:#fff; font-size:14px; font-weight:700; letter-spacing:0.02em;
                box-shadow: 0 4px 16px rgba(59,130,246,0.4);
                transition: all 0.2s; transform: translateY(0);
            "
            onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 6px 20px rgba(59,130,246,0.5)'"
            onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 16px rgba(59,130,246,0.4)'"
            >
                ${t('common.ok')} →
            </button>
        </div>
        `;
    }

    modal.innerHTML = buildContent();
    (document.getElementById('app-window-outer') || document.body).appendChild(modal);

    function rerender() {
        modal.innerHTML = buildContent();
        attachListeners();
    }

    function attachListeners() {
        const toggle = document.getElementById('lang-select-toggle');
        const menu = document.getElementById('lang-select-menu');
        const chevron = document.getElementById('lang-select-chevron');
        const confirm = document.getElementById('lang-select-confirm');

        if (!toggle || !menu || !confirm) return;

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.style.display === 'block';
            menu.style.display = isOpen ? 'none' : 'block';
            if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
        });

        menu.querySelectorAll('.lang-select-opt').forEach(opt => {
            opt.addEventListener('click', async (e) => {
                e.stopPropagation();
                const { setLang } = await import('../core/i18n.js');
                await setLang((opt as HTMLElement).dataset.lang!);
                rerender();
            });
        });

        document.addEventListener('click', () => {
            if (menu) menu.style.display = 'none';
            if (chevron) chevron.style.transform = '';
        }, { once: true });

        confirm.addEventListener('click', () => {
            localStorage.setItem(LANG_SELECTED_KEY, 'true');
            document.removeEventListener('langChanged', rerender);
            modal.remove();
        });
    }

    attachListeners();
    document.addEventListener('langChanged', rerender);
}

// Global exposure
(window as any).checkPtbMode = checkPtbMode;
(window as any).openGuide = (name: string) => checkPtbMode(true, name);
