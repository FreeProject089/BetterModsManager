// @ts-nocheck
/**
 * update-notes.js — Update notes, PTB modal, auto-update, licenses, markdown rendering
 * Extracted from app.js for modularity
 */
import { invoke } from '../core/api.js';
import { lucideIconUrl, phosphorIconUrl } from '../core/icon-cdn.js';
import { t } from '../core/i18n.js';
import { toast, openExternal } from './app.js';
import { escHtml, escAttr } from '../core/utils.js';
import { raiseAboveAll } from './layer.js';
import { getLinks } from '../core/links-config.js';
import { expandDocBlocks, headingSlug } from './rich-markdown.js';
// Imported for its side effect: it registers the delegated `:::tabs` handler.
import '../docs/md-hydrate.js';
import { uiIcon } from './icons.js';
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
    const renderFolderTree = (items, depth = 0) => {
        return items.map(item => {
            const paddingLeft = 12 + depth * 16;
            const fullPath = item.path;
            if (item.is_folder) {
                const isExpanded = expandedFolders.has(fullPath);
                return `
                    <div class="tree-folder" style="padding-left:${paddingLeft}px">
                        <div class="tree-folder-header ${isExpanded ? 'expanded' : ''}" data-folder="${escAttr(fullPath)}" style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate(${isExpanded ? '90deg' : '0'}); transition: transform 0.2s;" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
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
                <div class="ptb-sidebar-item ${allNotes.length > 0 && note === defaultNote ? 'active' : ''}" data-path="${escAttr(fullPath)}" style="padding:8px ${paddingLeft + 8}px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:var(--transition); border-left:2px solid transparent; min-width:0;">
                    ${uiIcon('file', 14, { style: 'flex-shrink:0;' })}
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">${escHtml(item.name)}</span>
                </div>
            `;
        }).join('');
    };
    const renderHeader = () => `
        <div class="ptb-header-title">
            <div class="ptb-header-icon">
                ${uiIcon('file', 18)}
            </div>
            <span>${t('update.title')}</span>
        </div>
        <button class="ptb-modal-close" id="close-update-notes">
            ${uiIcon('close', 18)}
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
    modal.addEventListener('click', e => { if (e.target === modal)
        modal.remove(); });
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
    const contentArea = modal.querySelector('#update-notes-content-target');
    // Use a named function to avoid duplicate listeners if modal already existed
    const handleModalClick = async (e) => {
        const link = e.target.closest('a');
        if (link) {
            const href = link.getAttribute('href');
            if (href) {
                e.preventDefault();
                e.stopPropagation();
                if (href.startsWith('http')) {
                    invoke('open_external_url', { url: href }).catch(err => window.open(href, '_blank'));
                }
                else if (href.toLowerCase().includes('.md')) {
                    // Fuzzy match filename (ignoring path and common suffixes like _EN/_FR)
                    const fileName = href.split('/').pop()?.toLowerCase().replace(/(_en|_fr)\.md$/, '.md');
                    if (fileName) {
                        const items = Array.from(modal.querySelectorAll('.ptb-sidebar-item'));
                        const targetItem = items.find(el => {
                            const p = el.dataset.path?.toLowerCase() || '';
                            const cleanP = p.replace(/(_en|_fr)\.md$/, '.md');
                            return cleanP.endsWith(fileName) || p.endsWith(fileName);
                        });
                        if (targetItem) {
                            targetItem.click();
                        }
                        else {
                            toast(t('update.pageNotFound', { name: fileName }) || "Page not found: " + fileName, "warning");
                        }
                    }
                }
            }
            return;
        }
        const item = e.target.closest('.ptb-sidebar-item');
        if (!item)
            return;
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
            contentArea.innerHTML = renderContent(note);
            if (contentArea)
                contentArea.scrollTop = 0;
        }
        else {
            console.warn('Note not found for path:', path);
            if (contentArea)
                contentArea.innerHTML = renderContent(null);
        }
    };
    // Remove old listener if exists (if modal was already in DOM)
    modal.removeEventListener('click', modal._bmm_click_handler);
    modal._bmm_click_handler = handleModalClick;
    modal.addEventListener('click', handleModalClick);
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
        btn.innerHTML = (uiIcon('check', 14) + ' ') + (t('update.copied') || 'Copied!');
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
export function renderMarkdown(md, opts = {}) {
    if (!md)
        return '';
    // Down-convert the site's GitBook-style directives (:::note, ::::cards, :badge,
    // :icon, :kbd, …) to marked-renderable constructs first, so Release/Update notes
    // and the Community blog all render the SAME rich markdown as BCWEB.
    md = expandDocBlocks(md, opts);
    let html = '';
    if (typeof marked !== 'undefined') {
        marked.setOptions({ renderer: new marked.Renderer() });
        html = marked.parse(md);
    }
    else {
        html = md.replace(/\n/g, '<br>');
    }
    // Give ## / ### headings anchor ids so the generated ::toc links can jump to them.
    html = html.replace(/<(h[23])>([\s\S]*?)<\/\1>/g, (_m, tag, inner) => {
        const text = inner.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').trim();
        return `<${tag} id="${headingSlug(text)}">${inner}</${tag}>`;
    });
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
        if (tLower === 'tip' || tLower === 'astuce')
            alertClass = 'tip';
        else if (tLower === 'important')
            alertClass = 'important';
        else if (tLower === 'warning' || tLower === 'avertissement')
            alertClass = 'warning';
        else if (tLower === 'caution' || tLower === 'attention')
            alertClass = 'caution';
        else if (tLower === 'note' || tLower === 'remarque')
            alertClass = 'note';
        const title = t(`update.alert.${alertClass}`);
        // Icon per type (lucide, CSS-masked → inherits the alert's accent colour) so
        // callouts look like the website's instead of a bare title.
        const iconName = { note: 'info', tip: 'lightbulb', important: 'message-square-warning', warning: 'triangle-alert', caution: 'flame' }[alertClass] || 'info';
        const iconHtml = `<span class="md-alert-icon md-inline-icon md-inline-icon--mask" data-lucide="${iconName}"></span>`;
        return `<blockquote class="md-alert md-alert-${alertClass}"><div class="md-alert-title">${iconHtml}${title}</div><p>`;
    });
    // Add Copy buttons to code blocks. The click is handled by a delegated listener
    // (see below) instead of an inline onclick — inline handlers get stripped by the
    // HTML sanitiser and are a CSP smell.
    html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (match, attrs, content) => {
        return `
        <div class="md-code-block" style="position: relative; margin: 10px 0;">
            <pre style="margin: 0; padding-top: 36px; position: relative;"><code${attrs}>${content}</code></pre>
            <button type="button" class="md-copy-btn" style="position: absolute; top: 8px; right: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: var(--text-secondary); border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer; transition: 0.2s; text-transform: uppercase;">${t('update.copy') || 'Copy'}</button>
        </div>`;
    });
    // ── Sanitise (CWE-79) ──────────────────────────────────────────────────────
    // Blog/notes bodies can contain author-written raw HTML. Strip anything that can
    // execute (scripts, on* handlers, javascript: URLs, arbitrary iframes) while
    // keeping the doc-block markup, media and embeds. This matters most in BMM: the
    // webview can call Tauri commands, so an unsanitised post = potential RCE.
    html = sanitizeMd(html);
    return `<div class="md-body">${html}</div>`;
}
// DOMPurify config shared by every renderMarkdown call. Allows the elements our
// markdown produces (details/summary, kbd, media, YouTube iframes, doc-block divs)
// and re-materialises the lucide mask icons + gates iframes to YouTube via hooks.
let _purifyReady = false;
function ensurePurify() {
    const DP = globalThis.DOMPurify;
    if (!DP || _purifyReady)
        return DP;
    _purifyReady = true;
    DP.addHook('afterSanitizeAttributes', (node) => {
        // Lucide icon → real CSS mask (the url was carried on data-lucide so it
        // survived sanitisation; we only ever build it from [a-z0-9-], so it's safe).
        // Phosphor, the same way: `data-ph` carries the `<weight>/<file>` path.
        if (node.getAttribute && node.getAttribute('data-ph')) {
            const url = phosphorIconUrl(String(node.getAttribute('data-ph')));
            if (url) {
                node.style.webkitMask = `url('${url}') center/contain no-repeat`;
                node.style.mask = `url('${url}') center/contain no-repeat`;
            }
        }
        if (node.getAttribute && node.getAttribute('data-lucide')) {
            const name = String(node.getAttribute('data-lucide')).replace(/[^a-z0-9-]/g, '');
            const url = lucideIconUrl(name);
            // '' when remote icons are switched off: no mask, so the span stays empty
            // rather than becoming a 404-shaped gap.
            if (url) {
                node.style.webkitMask = `url('${url}') center/contain no-repeat`;
                node.style.mask = `url('${url}') center/contain no-repeat`;
            }
        }
        // `style` stays in ADD_ATTR (cards and badges carry a colour), but its VALUE is the risk:
        // `position:fixed;inset:0;z-index:99999` from a Community article or a member's comment
        // draws a full-window overlay INSIDE the BMM webview (which has IPC) — clickjacking with
        // no script needed. Strip the whole attribute when it carries an overlay/expression/script
        // URL, the same filter the docs renderer uses (docs/md-safe.ts).
        const st = node.getAttribute && node.getAttribute('style');
        if (st && /expression\s*\(|javascript\s*:|position\s*:\s*(fixed|sticky|absolute)|url\s*\(\s*['"]?\s*(?:javascript|data:text\/html)/i.test(st)) {
            node.removeAttribute('style');
        }
        // Only YouTube (no-cookie) iframes are allowed; anything else is neutralised.
        if (node.tagName === 'IFRAME') {
            const src = node.getAttribute('src') || '';
            if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com\//i.test(src)) {
                node.parentNode && node.parentNode.removeChild(node);
                return;
            }
            node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
        }
        // External links open safely.
        if (node.tagName === 'A' && node.getAttribute('target') === '_blank')
            node.setAttribute('rel', 'noopener noreferrer');
    });
    return DP;
}
export function sanitizeMd(html) {
    const DP = ensurePurify();
    // Fail CLOSED: if DOMPurify is somehow unavailable, escape the markup to inert text rather
    // than returning raw HTML (the old branch said "fail closed" and did the opposite).
    if (!DP || typeof DP.sanitize !== 'function')
        return escHtml(html);
    return DP.sanitize(html, {
        ADD_TAGS: ['iframe', 'video', 'source'],
        ADD_ATTR: ['target', 'allow', 'allowfullscreen', 'frameborder', 'controls', 'loading', 'data-lucide', 'style', 'tabindex', 'download'],
        FORBID_TAGS: ['style', 'form', 'input'], // <style>/<form> can be abused; <button> stays (copy btn)
        ALLOW_DATA_ATTR: true,
    });
}
// Delegated handler for the code-block "Copy" buttons (replaces the old inline
// onclick, which the sanitiser strips). Registered once.
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('.md-copy-btn');
        if (!btn)
            return;
        const code = btn.closest('.md-code-block')?.querySelector('code');
        if (!code)
            return;
        navigator.clipboard?.writeText(code.innerText).then(() => {
            const prev = btn.innerHTML;
            btn.innerHTML = t('update.copied') || 'Copied!';
            setTimeout(() => { btn.innerHTML = prev; }, 2000);
        }).catch(() => { });
    });
    // `:::tabs` is wired ONCE, in docs/md-hydrate.ts, for every surface that draws that
    // strip — bundled pages, a plugin's own documentation, and this one. Two document
    // listeners doing the same toggle is two copies of one rule, and the second copy is
    // the one that stops matching when the markup changes.
    // Delegated handler for :::replay embeds (a play card in rendered markdown). Loads the
    // replay viewer lazily on click — no cost until someone actually watches a recording.
    document.addEventListener('click', (e) => {
        const el = e.target?.closest?.('.bmm-replay-embed');
        const src = el?.dataset?.src;
        if (!src)
            return;
        import('../features/settings/replay-watcher.js').then((m) => m.playReplayFromUrl(src)).catch(() => { });
    });
}
// Inject markdown body styles once
(function injectMarkdownStyles() {
    if (document.getElementById('md-body-styles'))
        return;
    const style = document.createElement('style');
    style.id = 'md-body-styles';
    style.textContent = `
        .md-body { font-size: 13.5px; line-height: 1.7; color: var(--text-secondary); font-family: var(--font-sans, inherit); }
        .md-body h1 { font-size: 20px; font-weight: 700; color: var(--text-primary); margin: 0 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
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
            color: var(--bmm-text-primary);
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
            color: var(--bmm-text-primary);
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
        .md-alert-tip .md-alert-title { color: var(--bmm-success); }
        
        .md-alert-important { border-left-color: #a855f7; background: rgba(168, 85, 247, 0.1) !important; }
        .md-alert-important .md-alert-title { color: var(--bmm-purple); }
        
        .md-alert-warning { border-left-color: #f59e0b; background: rgba(245, 158, 11, 0.1) !important; }
        .md-alert-warning .md-alert-title { color: var(--bmm-warning); }
        
        .md-alert-caution { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1) !important; }
        .md-alert-caution .md-alert-title { color: var(--bmm-danger); }
        
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
            color: var(--bmm-success);
            border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .md-badge-refine {
            background: rgba(59, 130, 246, 0.15);
            color: var(--bmm-info);
            border: 1px solid rgba(59, 130, 246, 0.3);
        }
        .md-badge-improved {
            background: rgba(245, 158, 11, 0.15);
            color: var(--bmm-warning);
            border: 1px solid rgba(245, 158, 11, 0.3);
        }
        .md-badge-fixed {
            background: rgba(239, 68, 68, 0.15);
            color: var(--bmm-danger);
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .md-badge-visual {
            background: rgba(168, 85, 247, 0.15);
            color: var(--bmm-purple);
            border: 1px solid rgba(168, 85, 247, 0.3);
        }
        .md-badge-major {
            background: rgba(249, 115, 22, 0.15);
            color: #f97316;
            border: 1px solid rgba(249, 115, 22, 0.3);
        }
        /* Site directive output (shared by Community + Release/Update notes):
           inline icons, coloured :badge chips, cards, columns, collapsibles, toc. */
        .md-body .md-inline-icon { width: 1.05em; height: 1.05em; vertical-align: -0.16em; display: inline-block; opacity: 0.95; }
        .md-body .md-inline-icon--mask { background-color: currentColor; }
        .md-body .md-alert-title { display: flex; align-items: center; gap: 7px; }
        .md-body .md-alert-icon { width: 1.05em; height: 1.05em; flex: none; opacity: 1; }
        .md-body .md-kbd-combo { display: inline-flex; align-items: center; gap: 4px; vertical-align: middle; }
        .md-body .md-kbd-plus { color: var(--bmm-text-muted, var(--text-muted)); font-size: 0.8em; }
        .md-body .md-kbd { font: 600 0.82em ui-monospace, monospace; background: var(--bmm-bg-elevated, rgba(255,255,255,0.06)); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-bottom-width: 2px; border-radius: 5px; padding: 1.5px 7px; min-width: 1.1em; text-align: center; display: inline-block; }
        .md-body .community-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 14px 0; }
        .md-body .community-cards .community-inline-card { margin: 0; }
        .md-body .community-columns { display: flex; flex-wrap: wrap; gap: 16px; margin: 14px 0; }
        .md-body .community-column { flex: 1; min-width: 200px; }
        .md-body .community-column > :first-child, .md-body .community-inline-card-body > :first-child, .md-body .community-details-body > :first-child { margin-top: 0; }
        .md-body .community-column > :last-child, .md-body .community-inline-card-body > :last-child, .md-body .community-details-body > :last-child { margin-bottom: 0; }
        .md-body .community-details { border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 12px; padding: 4px 14px; margin: 12px 0; background: var(--bmm-bg-elevated, rgba(255,255,255,0.03)); }
        .md-body .community-details > summary { cursor: pointer; font-weight: 600; padding: 8px 0; list-style: none; }
        .md-body .community-details > summary::-webkit-details-marker { display: none; }
        .md-body .community-details[open] > summary { border-bottom: 1px solid var(--border, rgba(255,255,255,0.08)); margin-bottom: 8px; }
        .md-body .community-details-body { padding-bottom: 8px; }
        .md-body .community-align { margin: 12px 0; }
        .md-body .md-toc { border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 12px; padding: 12px 16px; margin: 8px 0 18px; background: var(--bmm-bg-elevated, rgba(255,255,255,0.03)); }
        .md-body .md-toc-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--bmm-text-muted, var(--text-muted)); margin-bottom: 6px; }
        .md-body .md-toc-item { display: block; text-decoration: none; color: var(--bmm-text-secondary, var(--text-secondary)); font-size: 13px; padding: 3px 0; }
        .md-body .md-toc-item:hover { color: var(--bmm-accent, #f97316); }
        .md-body .md-toc-l3 { padding-left: 14px; font-size: 12.5px; opacity: 0.85; }
        .md-body .community-inline-card-title { display: inline-flex; align-items: center; gap: 6px; }
        .md-body .community-inline-badge { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 8px; font-size: 11px; font-weight: 700;
            color: var(--bc, var(--bmm-accent, #f97316)); background: color-mix(in srgb, var(--bc, #f97316) 15%, transparent);
            border: 1px solid color-mix(in srgb, var(--bc, #f97316) 40%, transparent); vertical-align: 1px; }
        .md-body .community-inline-card { border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 12px; padding: 12px 14px; margin: 10px 0;
            background: var(--bmm-bg-elevated, rgba(255,255,255,0.03)); }
        .md-body .community-inline-card-title { display: block; font-weight: 700; font-size: 15px; color: var(--bmm-accent, #f97316); text-decoration: none; margin-bottom: 3px; }
        .md-body .community-inline-card-title:hover { text-decoration: underline; }
        .md-body .community-inline-card-body { font-size: 13px; color: var(--bmm-text-muted, var(--text-muted)); white-space: pre-wrap; }
    `;
    document.head.appendChild(style);
})();
// ── Auto Update System ──────────────────────────────────
//
// check (startup, « Check now », optional background interval) → notification (badge on the
// update buttons; the dialog the first time a version is seen, a clickable toast after that,
// nothing while « Remind me tomorrow » holds) → dialog (notes, size, channel) → download
// (progress, speed, time left; resumable) → verify (signature + SHA-256, in Rust) → install now
// (BMM closes) or on the next launch (staged, verified again before it runs).
//
// Settings live in localStorage, as they always have: bmm_auto_update_enabled,
// bmm_prerelease_enabled (= the channel), plus the keys below.
const AUTO_UPDATE_KEY = 'bmm_auto_update_enabled';
const PRERELEASE_KEY = 'bmm_prerelease_enabled';
const INTERVAL_KEY = 'bmm_update_interval_h';
const LAST_CHECK_KEY = 'bmm_update_last_check';
const SNOOZE_KEY = 'bmm_update_snooze';
const SEEN_KEY = 'bmm_update_seen';
/** BetterInstaller installs: « install on next launch » is a flag; its updater downloads itself. */
const NEXT_LAUNCH_BI_KEY = 'bmm_update_next_launch_bi';
/** The version installed from a pre-release: that build keeps following the pre-release channel. */
const INSTALLED_PRE_KEY = 'bmm_installed_prerelease';
const SNOOZE_MS = 24 * 3600 * 1000;
const STAGED_COUNTDOWN_S = 10;
const store = {
    get(k) { try {
        return localStorage.getItem(k);
    }
    catch {
        return null;
    } },
    set(k, v) {
        try {
            if (v === null)
                localStorage.removeItem(k);
            else
                localStorage.setItem(k, v);
        }
        catch { /* private mode */ }
    },
};
function isAutoUpdateEnabled() {
    return store.get(AUTO_UPDATE_KEY) !== 'false'; // Default to enabled
}
function setAutoUpdateEnabled(enabled) {
    store.set(AUTO_UPDATE_KEY, enabled ? 'true' : 'false');
}
export function isPreReleaseEnabled() {
    return store.get(PRERELEASE_KEY) === 'true'; // Default OFF: the stable channel
}
function setPreReleaseEnabled(enabled) {
    store.set(PRERELEASE_KEY, enabled ? 'true' : 'false');
}
function intervalHours() {
    const h = Number(store.get(INTERVAL_KEY) || '0');
    return h === 6 || h === 24 ? h : 0;
}
/** Numeric dotted compare, the suffix ignored: enough for the « already installed? » checks here
 *  (the real version rule, with pre-release tags, is Rust's `is_newer`). */
function cmpVersion(a, b) {
    const p = (v) => (String(v || '').match(/\d+(?:\.\d+)*/)?.[0] || '0').split('.').map(Number);
    const x = p(a), y = p(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d)
            return d;
    }
    return 0;
}
const mb = (n) => ((n || 0) / 1048576).toFixed(1);
function relTime(at) {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 60)
        return t('update.justNow') || 'just now';
    const m = Math.round(s / 60);
    if (m < 60)
        return t('update.minutesAgo', { n: m }) || `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48)
        return t('update.hoursAgo', { n: h }) || `${h} h ago`;
    return t('update.daysAgo', { n: Math.round(h / 24) }) || `${Math.round(h / 24)} days ago`;
}
function recordCheck(result, version = '') {
    store.set(LAST_CHECK_KEY, JSON.stringify({ at: Date.now(), result, version }));
    renderLastCheck();
}
function lastCheck() {
    try {
        const v = JSON.parse(store.get(LAST_CHECK_KEY) || 'null');
        return v && typeof v.at === 'number' ? v : null;
    }
    catch {
        return null;
    }
}
function renderLastCheck() {
    const el = document.getElementById('upd-last-check');
    if (!el)
        return;
    const lc = lastCheck();
    el.textContent = !lc
        ? (t('update.never') || 'Never checked yet')
        : lc.result === 'error'
            ? (t('update.lastCheckFailed', { when: relTime(lc.at) }) || `Last check failed: ${relTime(lc.at)}`)
            : (t('update.lastCheck', { when: relTime(lc.at) }) || `Last check: ${relTime(lc.at)}`);
}
function isSnoozed(version) {
    try {
        const s = JSON.parse(store.get(SNOOZE_KEY) || 'null');
        return !!s && s.version === version && Date.now() < s.until;
    }
    catch {
        return false;
    }
}
/** The channel buttons, the interval buttons and the last-check line of the settings card. */
function initUpdateSettings(isDisabled) {
    const press = (group, attr, value) => {
        group?.querySelectorAll(`[${attr}]`).forEach((b) => {
            b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
        });
    };
    const channel = document.getElementById('upd-channel');
    press(channel, 'data-channel', isPreReleaseEnabled() ? 'prerelease' : 'stable');
    channel?.querySelectorAll('[data-channel]').forEach((b) => {
        b.disabled = isDisabled;
        b.addEventListener('click', () => {
            const pre = b.dataset.channel === 'prerelease';
            if (pre === isPreReleaseEnabled())
                return;
            setPreReleaseEnabled(pre);
            press(channel, 'data-channel', pre ? 'prerelease' : 'stable');
            toast(pre
                ? (t('settings.preReleaseEnabled') || 'Pre-releases enabled')
                : (t('settings.preReleaseDisabled') || 'Pre-releases disabled'), 'info', 3000, '', 'Updates');
            // Re-check at once so the effect is visible.
            void performUpdateCheck(true);
        });
    });
    const interval = document.getElementById('upd-interval');
    press(interval, 'data-interval', String(intervalHours()));
    interval?.querySelectorAll('[data-interval]').forEach((b) => {
        b.disabled = isDisabled;
        b.addEventListener('click', () => {
            store.set(INTERVAL_KEY, b.dataset.interval || '0');
            press(interval, 'data-interval', String(intervalHours()));
            scheduleBackgroundChecks();
        });
    });
    renderLastCheck();
    // Keeps « 5 min ago » true while the settings page stays open.
    setInterval(renderLastCheck, 60_000);
}
let bgTimer = null;
/** A tick every 15 minutes, comparing with the last check rather than counting on a long timer
 *  (which a sleeping PC stretches): after a night in sleep, the first tick checks. */
function scheduleBackgroundChecks() {
    if (bgTimer) {
        clearInterval(bgTimer);
        bgTimer = null;
    }
    if (intervalHours() === 0)
        return;
    bgTimer = setInterval(() => {
        const h = intervalHours();
        if (!h || !isAutoUpdateEnabled())
            return;
        const lc = lastCheck();
        if (!lc || Date.now() - lc.at >= h * 3600 * 1000)
            void performUpdateCheck(false);
    }, 15 * 60 * 1000);
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
                scheduleBackgroundChecks();
                toast(chk.checked
                    ? (t('settings.autoUpdateEnabled') || 'Auto-update enabled')
                    : (t('settings.autoUpdateDisabled') || 'Auto-update disabled'), 'info');
            });
        }
    }
    initUpdateSettings(isDisabled);
    // « Check now »: the sidebar button and the settings one.
    const sidebarBtn = document.getElementById('btn-check-updates');
    if (sidebarBtn && !isDisabled) {
        sidebarBtn.addEventListener('click', () => { void performUpdateCheck(true); });
    }
    const settingsBtn = document.getElementById('btn-settings-check-update');
    if (settingsBtn && !isDisabled) {
        settingsBtn.addEventListener('click', () => { void performUpdateCheck(true); });
    }
    updateCheckButtonsState();
    if (isDisabled)
        return;
    // An update chosen « on next launch » runs first; the regular check waits for the next start.
    const staged = await checkStagedUpdate();
    if (!staged && isAutoUpdateEnabled()) {
        setTimeout(() => { void performUpdateCheck(false); }, 3000);
    }
    scheduleBackgroundChecks();
}
/**
 * The release check, merged with BetterInstaller's when BMM was installed by it.
 *
 * BetterInstaller's updater (`uninstall.exe --check-update`) reads the STABLE feed only
 * (`releases/latest/download/update.json`). It used to overwrite every answer, so a person on the
 * pre-release channel with a BetterInstaller install was told « up to date » forever. Now a newer
 * pre-release from the release check wins, and installs through BMM-Setup.exe (`force_setup`).
 * When the release check fails (rate limit, offline mirror) BetterInstaller's answer is used alone.
 */
async function resolveUpdateInfo() {
    let current = '';
    try {
        current = String(await invoke('get_app_version') || '');
    }
    catch { /* the check still runs */ }
    const installedPre = store.get(INSTALLED_PRE_KEY);
    const onPreBuild = !!current && installedPre === current;
    if (installedPre && current && !onPreBuild)
        store.set(INSTALLED_PRE_KEY, null);
    let info = null;
    let ghErr = null;
    try {
        info = await invoke('check_for_update', {
            includePrerelease: isPreReleaseEnabled() || onPreBuild,
            apiBaseUrl: getLinks().autoupdate_api,
            // Empty string disables it, which is what an older links.json yields — the
            // Rust side treats blank as absent rather than as a URL to try.
            fallbackApiUrl: getLinks().autoupdate_api_fallback || '',
        });
    }
    catch (e) {
        ghErr = e;
    }
    let bi = null;
    try {
        bi = await invoke('check_update_via_installer');
    }
    catch { /* unavailable: keep the release check */ }
    if (bi && !bi.error) {
        if (info && info.is_prerelease && info.has_update) {
            info.force_setup = true;
            return info;
        }
        const base = info || {
            current_version: bi.current_version || current,
            release_url: 'https://github.com/FreeProject089/BetterModsManager/releases/latest',
            release_notes: '', download_url: '', manifest_url: null, is_prerelease: false,
            major_bump: false, download_size: 0, channel: 'stable',
        };
        base.has_update = !!bi.update_available;
        base.current_version = bi.current_version ?? base.current_version;
        base.latest_version = bi.latest_version ?? base.latest_version;
        if (bi.notes)
            base.release_notes = bi.notes;
        base.via_installer = true;
        return base;
    }
    if (!info)
        throw ghErr;
    return info;
}
let checking = false;
async function performUpdateCheck(manual = false) {
    if (checking)
        return;
    checking = true;
    const sidebarBtn = document.getElementById('btn-check-updates');
    const statusMsg = document.getElementById('update-status-msg');
    const buttons = [sidebarBtn, document.getElementById('btn-settings-check-update')];
    if (sidebarBtn) {
        sidebarBtn.classList.add('checking');
        sidebarBtn.querySelector('span').textContent = t('settings.checking') || 'Checking...';
    }
    if (statusMsg) {
        statusMsg.innerHTML = `<span style="color:var(--accent)">${t('settings.checking') || 'Checking...'}</span>`;
    }
    try {
        const info = await resolveUpdateInfo();
        recordCheck(info.has_update ? 'update' : 'uptodate', info.latest_version || '');
        if (info.has_update) {
            buttons.forEach(btn => { if (btn)
                btn.classList.add('has-update'); });
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--success)">✓ ${t('settings.updateAvailable') || 'Update available'}: v${escHtml(info.latest_version)}</span>`;
            }
            if (manual) {
                showUpdateAvailableModal(info);
            }
            else if (!isSnoozed(info.latest_version)) {
                // The dialog the first time this version is seen; a toast that opens it after that.
                if (store.get(SEEN_KEY) !== info.latest_version) {
                    store.set(SEEN_KEY, info.latest_version);
                    showUpdateAvailableModal(info);
                }
                else {
                    notifyUpdate(info);
                }
            }
        }
        else {
            buttons.forEach(btn => { if (btn)
                btn.classList.remove('has-update'); });
            if (manual) {
                toast(t('settings.upToDate') || 'You are running the latest version!', 'success', 3000, '', 'Updates');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--success)">✓ ${t('settings.upToDate') || 'Up to date'} (v${escHtml(info.current_version)})</span>`;
            }
        }
    }
    catch (err) {
        const errStr = String(err);
        recordCheck('error');
        // Network trouble and « nothing published » are not failures worth a red toast.
        if (errStr.includes('NETWORK_ERROR') || errStr.includes('NO_RELEASE') || errStr.includes('RATE_LIMITED')) {
            if (statusMsg) {
                statusMsg.innerHTML = errStr.includes('NO_RELEASE')
                    ? `<span style="color:var(--warning)">⚠ ${t('settings.noRelease') || 'No releases yet'}</span>`
                    : `<span style="color:var(--text-muted)">— ${t('settings.updateUnavailable') || 'Unavailable'}</span>`;
            }
            if (manual) {
                toast(errStr.includes('NO_RELEASE')
                    ? (t('settings.noRelease') || 'No releases on GitHub yet.')
                    : (t('settings.updateUnavailable') || 'Unavailable'), 'info', 3000, '', 'Updates');
            }
        }
        else {
            console.warn('[BMM] Update check failed:', err);
            if (manual) {
                toast((t('settings.updateCheckFailed') || 'Update check failed') + ': ' + err, 'error', 5000, '', 'Updates');
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
        checking = false;
    }
}
/** A toast that opens the dialog when clicked (the « Updates » notification source). */
function notifyUpdate(info) {
    toast(t('update.availableToast', { version: info.latest_version }) || `BMM v${info.latest_version} is available.`, 'info', 10000, '', 'Updates');
    setTimeout(() => {
        const el = document.querySelector('#toast-container .toast:last-child');
        if (!el)
            return;
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => showUpdateAvailableModal(info), { once: true });
    }, 0);
}
/** The Tauri event listener, read off the global (see the note in the incremental path). */
function tauriListen() {
    return window.__TAURI__?.event?.listen;
}
function showUpdateAvailableModal(info) {
    const existing = document.getElementById('update-available-modal');
    if (existing)
        existing.remove();
    // Use the rich markdown renderer (badges, GitHub-style alerts, code copy
    // buttons, tables…) instead of a raw marked.parse — much nicer notes.
    const releaseNotes = info.release_notes ? renderMarkdown(info.release_notes) : '';
    const isPre = !!info.is_prerelease;
    const viaBi = !!info.via_installer && !info.force_setup;
    const canQuick = !!info.manifest_url && !info.major_bump && !viaBi;
    const sizeText = info.download_size > 0 ? (t('update.sizeMb', { size: mb(info.download_size) }) || `${mb(info.download_size)} MB`) : '';
    const channelText = info.channel === 'prerelease' ? (t('update.channelPre') || 'Pre-release') : (t('update.channelStable') || 'Stable');
    // What vouches for the installer, said before anything is downloaded: the signed
    // update-manifest.json, the checksum in the release's update.json, or nothing (BMM asks).
    const verification = info.verification || (info.manifest_url ? 'signed' : 'unverified');
    const verificationText = verification === 'signed'
        ? (t('update.verifiedSigned') || "Checked with the publisher's signature before it runs.")
        : verification === 'update-json'
            ? (t('update.verifiedUpdateJson') || 'Checked against the checksum the release declares (its update.json) before it runs.')
            : (t('update.verifiedNone') || 'This release declares no checksum BMM can use: BMM will tell you and ask before running the installer.');
    // « Install on next launch » keeps a SIGNED installer only (stage_update re-verifies it at start).
    const canStage = viaBi || !!info.manifest_url;
    // The house shell (.modal-overlay > .modal.modal--md): Tasky and the version in the header,
    // the diff, the notes and the progress in the body, the ways out in the footer.
    const modal = document.createElement('div');
    modal.id = 'update-available-modal';
    modal.className = 'modal-overlay open';
    modal.innerHTML = `
        <div id="upd-card" class="modal bms modal--md" role="dialog" aria-modal="true" aria-labelledby="upd-title">
            <div class="modal-header">
                <img src="assets/Tasky_Happy.png" alt="" class="upd-tasky">
                <div class="bms-titles">
                    <span class="upd-kicker${isPre ? ' is-pre' : ''}">
                        ${uiIcon('star', 12)}
                        ${isPre ? (t('update.preReleaseTag') || 'PRE-RELEASE') : (t('update.newVersion') || 'NEW VERSION')}
                    </span>
                    <h2 class="modal-title" id="upd-title">${t('settings.updateAvailableTitle') || 'Update Available!'}</h2>
                    <p class="bms-sub">${t('settings.newVersionReady') || 'A new version of Better Mod Manager is ready.'}</p>
                    <div class="upd-sub-meta">
                        ${sizeText ? `<span>${uiIcon('package', 12)} ${escHtml(sizeText)}</span>` : ''}
                        <span>${uiIcon('git-branch', 12)} ${escHtml(channelText)}</span>
                        ${viaBi && !info.release_tag ? '' : `<span id="upd-verification" title="${escAttr(info.verification_note || '')}">${uiIcon(verification === 'unverified' ? 'warning' : 'shield-check', 12)} ${escHtml(verificationText)}</span>`}
                    </div>
                </div>
                <button type="button" class="modal-close" id="close-update-modal" aria-label="${escAttr(t('common.close') || 'Close')}">${uiIcon('close', 16)}</button>
            </div>

            <div class="modal-body">
                <div class="upd-diff">
                    <div class="upd-ver is-old">
                        <div class="upd-ver-label">${t('settings.currentVersion') || 'CURRENT'}</div>
                        <div class="upd-ver-num">v${escHtml(info.current_version)}</div>
                    </div>
                    <div class="upd-arrow" aria-hidden="true">${uiIcon('arrow-right', 16)}</div>
                    <div class="upd-ver is-new">
                        <div class="upd-ver-label">${t('settings.latestVersion') || 'LATEST'}</div>
                        <div class="upd-ver-num">v${escHtml(info.latest_version)}</div>
                    </div>
                </div>

                ${releaseNotes ? `
                <div class="upd-notes">
                    <div class="upd-notes-head">
                        ${uiIcon('file', 12)}
                        ${t('settings.releaseNotes') || "WHAT'S NEW"}
                        <span style="flex:1;"></span>
                        <span class="upd-notes-v">v${escHtml(info.latest_version)}</span>
                    </div>
                    <div class="upd-notes-scroll">
                        ${releaseNotes}
                    </div>
                </div>
                ` : ''}

                <!-- Download → verify → install -->
                <div id="upd-progress" class="upd-progress" hidden>
                    <div class="upd-steps">
                        <span class="upd-step" data-step="download">${t('update.stepDownload') || 'Download'}</span>
                        <span class="upd-step" data-step="verify">${t('update.stepVerify') || 'Verify'}</span>
                        <span class="upd-step" data-step="install">${t('update.stepInstall') || 'Install'}</span>
                    </div>
                    <div class="upd-progress-head">
                        <span id="upd-progress-label" class="upd-progress-label"></span>
                        <span id="upd-progress-pct" class="upd-progress-pct"></span>
                    </div>
                    <div class="upd-progress-track">
                        <div id="upd-progress-bar" class="upd-progress-bar" style="width:0%;"></div>
                    </div>
                    <div id="upd-progress-meta" class="upd-progress-meta"></div>
                </div>

                <!-- Why the update did not go through, and the way out that always works -->
                <div id="upd-error" class="upd-error" role="alert" hidden>
                    ${uiIcon('warning', 16, { style: 'flex-shrink:0;margin-top:1px' })}
                    <div class="upd-error-body">
                        <div class="upd-error-title">${t('update.failedTitle') || 'The update did not go through'}</div>
                        <div class="upd-error-msg" id="upd-error-msg"></div>
                        <div class="upd-error-actions">
                            <button type="button" class="btn btn-primary btn-sm" id="btn-upd-retry">${uiIcon('refresh', 12)} ${t('update.retry') || 'Try again'}</button>
                            <button type="button" class="btn btn-ghost btn-sm" id="btn-upd-release-page">${uiIcon('external', 12)} ${t('update.openReleasePage') || 'Download from the release page'}</button>
                        </div>
                    </div>
                </div>

                <!-- The installer could not be checked: what failed, and the person's choice -->
                <div id="upd-unverified" role="alertdialog" aria-live="assertive"></div>

                ${info.major_bump ? `
                <div class="upd-major">
                    ${uiIcon('warning', 16, { style: 'flex-shrink:0;margin-top:1px' })}
                    <div>${t('update.majorManual') || 'This is a <b>major version</b>.'}</div>
                </div>
                ` : ''}
            </div>

            <div class="modal-footer">
                <div class="modal-footer-start">
                    <a class="upd-gh" href="${escAttr(info.release_url)}" target="_blank">${t('settings.viewOnGithub') || 'View release on GitHub'}</a>
                    ${canQuick ? `<button type="button" class="btn btn-ghost btn-sm" id="btn-incremental-update" data-tooltip="${escAttr(t('update.quickUpdateTip') || '')}">${uiIcon('download', 12)} ${t('update.quickUpdate') || 'Quick Update'}</button>` : ''}
                </div>
                <button type="button" class="btn btn-ghost" id="btn-update-later">${t('update.remindLater') || 'Remind me tomorrow'}</button>
                ${canStage ? `<button type="button" class="btn btn-secondary" id="btn-update-next">${uiIcon('clock', 12)} ${t('update.installNextLaunch') || 'Install on next launch'}</button>` : ''}
                <button type="button" class="btn btn-primary" id="btn-download-install-update">${uiIcon('download', 12)} ${t('update.installNow') || 'Install now'}</button>
            </div>
        </div>
    `;
    (document.getElementById('app-window-outer') || document.body).appendChild(modal);
    raiseAboveAll(modal);
    // Release notes are the surface most likely to carry a command someone will copy.
    void import('./code-highlight.js').then((m) => m.highlightIn(modal)).catch(() => { });
    const q = (sel) => modal.querySelector(sel);
    const progress = q('#upd-progress');
    const bar = q('#upd-progress-bar');
    const label = q('#upd-progress-label');
    const pct = q('#upd-progress-pct');
    const meta = q('#upd-progress-meta');
    const errorBox = q('#upd-error');
    const actionBtns = ['#btn-download-install-update', '#btn-update-next', '#btn-incremental-update', '#btn-update-later']
        .map((s) => q(s)).filter(Boolean);
    const close = () => modal.remove();
    const setBusy = (busy) => actionBtns.forEach((b) => { b.disabled = busy; });
    const setStep = (step) => {
        const order = ['download', 'verify', 'install'];
        const at = step ? order.indexOf(step) : -1;
        modal.querySelectorAll('.upd-step').forEach((el) => {
            const i = order.indexOf(el.dataset.step || '');
            el.classList.toggle('is-done', at >= 0 && i < at);
            el.classList.toggle('is-active', i === at);
        });
    };
    const showProgress = (text) => {
        errorBox.hidden = true;
        progress.hidden = false;
        progress.classList.remove('is-done');
        bar.style.width = '0%';
        label.textContent = text;
        pct.textContent = '';
        meta.textContent = '';
        setStep('download');
    };
    // Failures land in the modal, in words, next to the one way out that always works: the
    // release page, where the installer can be downloaded and run by hand.
    const showUpdateError = (err) => {
        (q('#upd-error-msg')).textContent = String(err).replace(/^Error:\s*/, '');
        errorBox.hidden = false;
        progress.hidden = true;
        setBusy(false);
    };
    // Size, speed and time left, from the last few seconds of progress events.
    let samples = [];
    const onProgress = (evt) => {
        const d = evt?.payload || {};
        if (d.phase === 'downloading') {
            setStep('download');
            const now = performance.now();
            samples.push({ at: now, bytes: d.received });
            while (samples.length > 2 && now - samples[0].at > 4000)
                samples.shift();
            const secs = (now - samples[0].at) / 1000;
            const speed = secs > 0.3 ? Math.max(0, (d.received - samples[0].bytes) / secs) : 0;
            const p = d.total > 0 ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
            bar.style.width = p + '%';
            pct.textContent = p + '%';
            label.textContent = t('update.dlProgress', { done: mb(d.received), total: mb(d.total) }) || `Downloading ${mb(d.received)} / ${mb(d.total)} MB`;
            const parts = [];
            if (speed > 0) {
                parts.push(t('update.speed', { speed: mb(speed) }) || `${mb(speed)} MB/s`);
                const left = d.total > d.received ? (d.total - d.received) / speed : 0;
                if (left >= 1) {
                    parts.push(left < 90
                        ? (t('update.etaSec', { n: Math.ceil(left) }) || `about ${Math.ceil(left)} s left`)
                        : (t('update.etaMin', { n: Math.ceil(left / 60) }) || `about ${Math.ceil(left / 60)} min left`));
                }
            }
            if (d.resumed)
                parts.push(t('update.dlResumed') || 'resumed where it stopped');
            meta.textContent = parts.join(' · ');
        }
        else if (d.phase === 'verifying') {
            setStep('verify');
            bar.style.width = '100%';
            pct.textContent = '';
            label.textContent = info.manifest_url
                ? (t('update.verifying') || 'Checking the signature and the SHA-256...')
                : (t('update.verifyingChecksum') || 'Checking the file against the checksum the release declares...');
            meta.textContent = '';
        }
        else if (d.phase === 'launching') {
            setStep('install');
            progress.classList.add('is-done');
            label.textContent = t('update.launching') || 'Starting the installer. BMM closes now.';
        }
    };
    // The installer could not be checked (no usable update.json, or a file that does not match
    // what the release declares): say what failed and let the person choose. « Cancel » has the
    // focus; only « Install anyway » runs it, naming the exact bytes it was shown.
    const unverifiedBox = q('#upd-unverified');
    const clearUnverified = () => { unverifiedBox.innerHTML = ''; };
    const showUnverified = (u) => {
        setBusy(false);
        progress.hidden = true;
        errorBox.hidden = true;
        const mismatch = u.kind === 'mismatch';
        const title = mismatch
            ? (t('update.mismatchTitle') || 'The downloaded file does not match what the release declares')
            : (t('update.unverifiedTitle') || 'This installer could not be checked');
        const lead = mismatch
            ? (t('update.mismatchLead') || 'It may be corrupted or tampered with. Installing it is not recommended.')
            : (t('update.unverifiedLead') || 'Nothing confirms that this file is the one the publisher released. Install it only if you trust where it comes from.');
        const gh = u.github_matches === true
            ? (t('update.githubDigestMatch') || 'For information: the file matches the checksum GitHub publishes for it.')
            : u.github_matches === false
                ? (t('update.githubDigestNoMatch') || 'The file does NOT match the checksum GitHub publishes for it.')
                : '';
        unverifiedBox.innerHTML = `
            <div class="${mismatch ? 'upd-error' : 'upd-major'}">
                ${uiIcon('warning', 16, { style: 'flex-shrink:0;margin-top:1px' })}
                <div class="upd-error-body">
                    <div class="upd-error-title">${escHtml(title)}</div>
                    <div class="upd-error-msg">${escHtml(lead)}</div>
                    <div class="upd-error-msg">${escHtml(String(u.detail || ''))}</div>
                    ${gh ? `<div class="upd-error-msg">${escHtml(gh)}</div>` : ''}
                    <div class="upd-error-msg"><code>${escHtml(String(u.file || ''))} · SHA-256 ${escHtml(String(u.sha256))}</code></div>
                    <div class="upd-error-actions">
                        <button type="button" class="btn btn-primary btn-sm" id="btn-upd-cancel">${escHtml(t('update.cancel') || 'Cancel')}</button>
                        <button type="button" class="btn btn-ghost btn-sm" id="btn-upd-unv-page">${uiIcon('external', 12)} ${escHtml(t('update.openReleasePage') || 'Download from the release page')}</button>
                        <button type="button" class="btn ${mismatch ? 'btn-danger' : 'btn-secondary'} btn-sm" id="btn-upd-anyway">${escHtml(t('update.installAnyway') || 'Install anyway')}</button>
                    </div>
                </div>
            </div>`;
        const cancel = unverifiedBox.querySelector('#btn-upd-cancel');
        cancel?.addEventListener('click', clearUnverified);
        unverifiedBox.querySelector('#btn-upd-unv-page')?.addEventListener('click', () => {
            openExternal(info.release_url || 'https://github.com/FreeProject089/BetterModsManager/releases/latest');
        });
        unverifiedBox.querySelector('#btn-upd-anyway')?.addEventListener('click', () => { void runInstall('now', String(u.sha256)); });
        cancel?.focus();
    };
    /** The installer details a refused, unchecked download carries (`UNVERIFIED:{json}`), or null. */
    const unverifiedOf = (err) => {
        const msg = String(err).replace(/^Error:\s*/, '');
        if (!msg.startsWith('UNVERIFIED:'))
            return null;
        try {
            const u = JSON.parse(msg.slice('UNVERIFIED:'.length));
            return u && u.sha256 ? u : null;
        }
        catch {
            return null;
        }
    };
    // « Install now » and « Install on next launch ».
    let lastAction = 'now';
    const runInstall = async (mode, confirmSha256 = null) => {
        lastAction = mode;
        clearUnverified();
        setBusy(true);
        samples = [];
        showProgress(mode === 'next' ? (t('update.staging') || 'Downloading for the next launch...') : (t('update.downloading') || 'Downloading...'));
        const listen = tauriListen();
        let unlisten = null;
        // A BetterInstaller install that could not get an installer downloaded: its own
        // <install>/uninstall.exe --update (delta + signature + rollback) is the fallback.
        const viaMaintenanceExe = async () => {
            label.textContent = t('update.viaInstaller') || "Starting BetterInstaller's updater...";
            setStep('install');
            await invoke('update_via_installer');
        };
        try {
            if (listen)
                unlisten = await listen('update-download-progress', onProgress);
            if (viaBi) {
                // « Next launch » is a flag here: BetterInstaller's updater downloads by itself.
                if (mode === 'next') {
                    store.set(NEXT_LAUNCH_BI_KEY, info.latest_version);
                    toast(t('update.nextLaunchBi') || 'The update installs the next time you start BMM.', 'success', 5000, '', 'Updates');
                    close();
                    return;
                }
                // No release to download from (the GitHub check failed): the installed updater.
                if (!info.release_tag) {
                    await viaMaintenanceExe();
                    return; // BMM is exiting; the updater window takes over
                }
            }
            // That build follows the pre-release channel from now on (resolveUpdateInfo).
            if (isPre)
                store.set(INSTALLED_PRE_KEY, info.latest_version);
            // The backend downloads and checks the installer itself: against the release's SIGNED
            // update-manifest.json when it has one (`url` only chooses among its entries), else
            // against the checksum its update.json declares, re-reading the release by `tag`. A
            // BetterInstaller install is then updated in place (BMM-Setup.exe --update --wait-pid
            // <pid> --launch). `confirmSha256` comes only from « Install anyway ».
            const args = { url: info.download_url, manifestUrl: info.manifest_url || null };
            if (mode === 'next') {
                const st = await invoke('stage_update', args);
                setStep('install');
                progress.classList.add('is-done');
                label.textContent = t('update.stagedToast', { version: st.version }) || `v${st.version} installs on the next start.`;
                toast(t('update.stagedToast', { version: st.version }) || `v${st.version} installs on the next start.`, 'success', 6000, '', 'Updates');
                setTimeout(close, 1500);
                return;
            }
            try {
                await invoke('download_and_install_update', { ...args, tag: info.release_tag || null, confirmSha256 });
            }
            catch (e) {
                if (viaBi && !unverifiedOf(e)) {
                    await viaMaintenanceExe();
                    return;
                }
                throw e;
            }
        }
        catch (err) {
            const u = unverifiedOf(err);
            if (u)
                showUnverified(u);
            else
                showUpdateError(err);
        }
        finally {
            if (unlisten)
                unlisten();
        }
    };
    // Quick Update: the interface and language files the signed manifest lists, without the
    // installer (the version number does not change).
    const runQuick = async () => {
        lastAction = 'quick';
        setBusy(true);
        showProgress(t('update.fetchingManifest') || 'Fetching update manifest...');
        const listen = tauriListen();
        let unlisten = null;
        try {
            const manifest = await invoke('fetch_update_manifest', { url: info.manifest_url });
            label.textContent = t('update.applyingUpdate') || 'Applying update...';
            if (listen) {
                unlisten = await listen('update-progress', (evt) => {
                    const d = evt.payload;
                    const p = Math.round(((d.index + 1) / d.total) * 100);
                    bar.style.width = p + '%';
                    pct.textContent = `${d.index + 1} / ${d.total}`;
                    meta.textContent = d.file;
                    setStep(d.status === 'verifying' ? 'verify' : d.status === 'applied' ? 'install' : 'download');
                });
            }
            const result = await invoke('apply_incremental_update', { manifest });
            bar.style.width = '100%';
            setStep('install');
            progress.classList.add('is-done');
            if (result.errors && result.errors.length > 0) {
                toast(t('toast.updatePartial', { applied: result.applied, errors: result.errors.length }) || `Update partial: ${result.applied} applied, ${result.errors.length} errors`, 'warning', 5000, '', 'Updates');
            }
            else {
                toast(t('update.incrementalSuccess') || 'Update applied! Restart BMM to complete.', 'success', 5000, '', 'Updates');
            }
            label.textContent = t('update.done') || 'Done! Restart BMM to apply changes.';
            setBusy(false);
        }
        catch (err) {
            showUpdateError(err);
        }
        finally {
            if (unlisten)
                unlisten();
        }
    };
    q('#btn-download-install-update')?.addEventListener('click', () => { void runInstall('now'); });
    q('#btn-update-next')?.addEventListener('click', () => { void runInstall('next'); });
    q('#btn-incremental-update')?.addEventListener('click', () => { void runQuick(); });
    q('#btn-upd-retry')?.addEventListener('click', () => {
        if (lastAction === 'quick')
            void runQuick();
        else
            void runInstall(lastAction);
    });
    q('#btn-upd-release-page')?.addEventListener('click', () => {
        openExternal(info.release_url || 'https://github.com/FreeProject089/BetterModsManager/releases/latest');
    });
    q('#btn-update-later')?.addEventListener('click', () => {
        store.set(SNOOZE_KEY, JSON.stringify({ version: info.latest_version, until: Date.now() + SNOOZE_MS }));
        // The dialog comes back once the snooze is over.
        store.set(SEEN_KEY, null);
        toast(t('update.remindedToast') || 'BMM reminds you about this version tomorrow.', 'info', 3000, '', 'Updates');
        close();
    });
    q('#close-update-modal')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal)
        close(); });
}
/**
 * « Install on next launch », the next launch: a verified installer staged by `stage_update`
 * (or, for a BetterInstaller install, the flag), offered with a short countdown that can be
 * stopped. True when a prompt is shown.
 */
async function checkStagedUpdate() {
    const biVersion = store.get(NEXT_LAUNCH_BI_KEY);
    if (biVersion) {
        let current = '';
        try {
            current = String(await invoke('get_app_version') || '');
        }
        catch { /* unknown */ }
        if (current && cmpVersion(biVersion, current) > 0) {
            showStagedPrompt({ version: biVersion, size: 0 }, 'bi');
            return true;
        }
        store.set(NEXT_LAUNCH_BI_KEY, null);
    }
    let staged = null;
    try {
        staged = await invoke('staged_update');
    }
    catch { /* none */ }
    if (staged) {
        showStagedPrompt(staged, 'file');
        return true;
    }
    return false;
}
function showStagedPrompt(staged, kind) {
    document.getElementById('update-staged-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'update-staged-modal';
    modal.className = 'modal-overlay open';
    modal.innerHTML = `
        <div class="modal bms modal--sm" role="dialog" aria-modal="true" aria-labelledby="upd-staged-title">
            <div class="modal-header">
                <img src="assets/Tasky_Happy.png" alt="" class="upd-tasky">
                <div class="bms-titles">
                    <h2 class="modal-title" id="upd-staged-title">${t('update.stagedTitle') || 'Update ready to install'}</h2>
                    <p class="bms-sub" id="upd-staged-body"></p>
                </div>
            </div>
            <div class="modal-body">
                <div id="upd-staged-error" class="upd-error" role="alert" hidden>
                    ${uiIcon('warning', 16, { style: 'flex-shrink:0;margin-top:1px' })}
                    <div class="upd-error-body">
                        <div class="upd-error-title">${t('update.failedTitle') || 'The update did not go through'}</div>
                        <div class="upd-error-msg" id="upd-staged-error-msg"></div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-ghost" id="btn-staged-discard">${t('update.stagedDiscard') || 'Discard'}</button>
                <button type="button" class="btn btn-secondary" id="btn-staged-later">${t('update.stagedNotNow') || 'Not now'}</button>
                <button type="button" class="btn btn-primary" id="btn-staged-install">${uiIcon('download', 12)} ${t('update.installNow') || 'Install now'}</button>
            </div>
        </div>
    `;
    (document.getElementById('app-window-outer') || document.body).appendChild(modal);
    raiseAboveAll(modal);
    const body = modal.querySelector('#upd-staged-body');
    const installBtn = modal.querySelector('#btn-staged-install');
    let left = STAGED_COUNTDOWN_S;
    let timer = null;
    const stop = () => { if (timer) {
        clearInterval(timer);
        timer = null;
    } };
    const renderBody = () => {
        body.textContent = timer
            ? (t('update.stagedBody', { version: staged.version, n: left }) || `v${staged.version} installs in ${left} s.`)
            : (t('update.stagedReady', { version: staged.version }) || `v${staged.version} is downloaded and verified.`);
    };
    const install = async () => {
        stop();
        renderBody();
        installBtn.disabled = true;
        installBtn.innerHTML = uiIcon('loader', 12, { style: 'animation:spin 1s linear infinite' }) + ' ' + (t('update.installing') || 'Installing...');
        try {
            if (kind === 'bi') {
                store.set(NEXT_LAUNCH_BI_KEY, null);
                await invoke('update_via_installer');
            }
            else {
                await invoke('install_staged_update');
            }
        }
        catch (err) {
            modal.querySelector('#upd-staged-error-msg').textContent = String(err).replace(/^Error:\s*/, '');
            modal.querySelector('#upd-staged-error').hidden = false;
            installBtn.disabled = false;
            installBtn.innerHTML = uiIcon('refresh', 12) + ' ' + (t('update.retry') || 'Try again');
        }
    };
    timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
            void install();
            return;
        }
        renderBody();
    }, 1000);
    renderBody();
    installBtn.addEventListener('click', () => { void install(); });
    modal.querySelector('#btn-staged-later')?.addEventListener('click', () => { stop(); modal.remove(); });
    modal.querySelector('#btn-staged-discard')?.addEventListener('click', async () => {
        stop();
        if (kind === 'bi')
            store.set(NEXT_LAUNCH_BI_KEY, null);
        else {
            try {
                await invoke('discard_staged_update');
            }
            catch { /* already gone */ }
        }
        modal.remove();
    });
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
        if (found)
            activeNote = found;
    }
    const renderHeader = () => `
        <div class="ptb-header-title">
            <div class="ptb-header-icon">
                ${uiIcon('file', 18)}
            </div>
            <span>${t('settings.notesTitle')}</span>
        </div>
        <button class="update-modal-close" id="close-ptb-modal">
            ${uiIcon('close', 18)}
        </button>
    `;
    const renderFolderTree = (items, depth = 0) => {
        return items.map(item => {
            const paddingLeft = 12 + depth * 16;
            if (item.is_folder) {
                return `
                    <div class="tree-folder" style="padding-left:${paddingLeft}px">
                        <div class="tree-folder-header" data-folder="${escAttr(item.path)}" style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">
                            ${uiIcon('folder', 12)}
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
                    <div class="ptb-sidebar-item ${allNotes.length > 0 && note === activeNote ? 'active' : ''}" data-path="${escAttr(item.path)}" style="padding:8px ${paddingLeft + 8}px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:var(--transition); border-left:2px solid transparent; min-width:0;">
                        ${uiIcon('file', 14, { style: 'flex-shrink:0;' })}
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">${escHtml(item.name)}</span>
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
                }
                else if (href.endsWith('.md')) {
                    const fileName = href.split('/').pop();
                    if (fileName) {
                        const targetItem = Array.from(modal.querySelectorAll('.ptb-sidebar-item')).find(el => el.dataset.path?.endsWith(fileName));
                        if (targetItem) {
                            targetItem.click();
                        }
                        else {
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
// ── Terms of Service (TOS) ─────────────────────────────────
export async function openEulaModal(showButtons = false) {
    const modal = document.getElementById('modal-tos');
    const contentEl = document.getElementById('tos-content');
    if (!modal || !contentEl)
        return;
    modal.classList.add('open');
    // Toggle UI based on whether buttons are shown or just viewing
    const footer = modal.querySelector('.modal-footer');
    const closeBtn = document.getElementById('btn-tos-close');
    if (footer) {
        footer.style.setProperty('display', showButtons ? 'flex' : 'none', 'important');
    }
    if (closeBtn) {
        closeBtn.style.display = showButtons ? 'none' : '';
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
    const acceptBtn = document.getElementById('btn-tos-accept');
    if (acceptBtn) {
        acceptBtn.onclick = () => {
            markEulaAccepted();
            modal.classList.remove('open');
        };
    }
    // Setup Quit button
    const quitBtn = document.getElementById('btn-tos-quit');
    if (quitBtn) {
        quitBtn.onclick = () => {
            invoke('exit_app');
        };
    }
}
// ── Privacy Policy ─────────────────────────────────────────
export async function openPrivacyModal() {
    const modal = document.getElementById('modal-privacy');
    const contentEl = document.getElementById('privacy-content');
    if (!modal || !contentEl)
        return;
    modal.classList.add('open');
    contentEl.textContent = t('common.loading');
    try {
        const { getLang } = await import('../core/i18n.js');
        const text = await invoke('get_privacy_text', { lang: getLang() });
        contentEl.innerHTML = renderMarkdown(text);
    }
    catch (err) {
        contentEl.textContent = t('common.error') + ' (Privacy): ' + err;
    }
    const closeBtn = document.getElementById('btn-privacy-close');
    if (closeBtn)
        closeBtn.onclick = () => modal.classList.remove('open');
    modal.onclick = (e) => { if (e.target === modal)
        modal.classList.remove('open'); };
    // An explicit accept, but only while the policy has not been accepted yet. Field
    // feedback: the modal offered nothing but the X, so a first-run user could only
    // DISMISS the policy — never agree to it — and reopening it later still behaved as
    // if they had never seen it. Once accepted, the footer never reappears: reading the
    // policy again is not a request to re-consent.
    const body = modal.querySelector('.legal-body');
    modal.querySelector('#privacy-accept-row')?.remove();
    if (body && localStorage.getItem(PRIVACY_SEEN_KEY) !== 'true') {
        const row = document.createElement('div');
        row.id = 'privacy-accept-row';
        row.style.cssText = 'display:flex;justify-content:flex-end;padding:12px 0 0;border-top:1px solid var(--border);margin-top:14px';
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = t('privacy.accept') || 'I have read the policy';
        btn.addEventListener('click', () => {
            try {
                localStorage.setItem(PRIVACY_SEEN_KEY, 'true');
            }
            catch { /* best effort */ }
            markPrivacyAccepted();
            row.remove();
            modal.classList.remove('open');
        });
        row.append(btn);
        body.append(row);
    }
}
// Global expose for onclick
window.openLicenseModal = openLicenseModal;
window.openEulaModal = openEulaModal; // legacy alias
window.openTosModal = openEulaModal; // current name (Terms of Service)
window.openPrivacyModal = openPrivacyModal;
window.checkPtbMode = checkPtbMode;
// ── Auto EULA on First Start ────────────────────────────────
const EULA_ACCEPTED_KEY = 'bmm_eula_accepted';
/** WHICH terms were accepted, not merely that some were. See `legal_fingerprint` in Rust. */
const EULA_HASH_KEY = 'bmm_eula_accepted_hash';
const PRIVACY_HASH_KEY = 'bmm_privacy_seen_hash';
/** The fingerprint of the documents currently installed, or nulls if they cannot be read. */
async function legalHashes() {
    try {
        const r = await invoke('legal_fingerprint');
        return { tos: r?.tos ?? null, privacy: r?.privacy ?? null };
    }
    catch {
        // An old build without the command, or an install missing the documents. Either way
        // we cannot tell whether the terms changed, and guessing "they did" would re-open the
        // modal on every launch forever.
        return { tos: null, privacy: null };
    }
}
/**
 * Whether the reader has already accepted THIS text.
 *
 * Migration: an install from before fingerprints exists carries the bare `true` and no hash.
 * That flag is adopted rather than ignored, and adopting is the CORRECT answer, not just the
 * kind one — at the moment of migration the documents on disk are the ones that shipped with
 * the build they accepted, because they have not updated yet. Re-prompting there would be
 * asking somebody to re-read a document that did not change.
 */
function acceptedCurrent(key, hashKey, current) {
    const legacy = localStorage.getItem(key) === 'true';
    const stored = localStorage.getItem(hashKey);
    if (!current)
        return legacy || !!stored; // cannot verify → do not nag
    if (stored)
        return stored === current;
    if (legacy) {
        localStorage.setItem(hashKey, current);
        return true;
    }
    return false;
}
export async function checkAutoEula() {
    try {
        const isEnabled = await invoke('is_auto_eula_enabled');
        const { tos } = await legalHashes();
        const isAccepted = acceptedCurrent(EULA_ACCEPTED_KEY, EULA_HASH_KEY, tos);
        if (isEnabled && !isAccepted) {
            // Show EULA modal with mandatory buttons
            await openEulaModal(true);
            return true; // it was shown → genuine first start
        }
    }
    catch (e) {
        console.warn('[BMM] Auto EULA check failed:', e);
    }
    return false;
}
// Show the Privacy Policy once, right after the TOS on first start — and again whenever
// its text changes, which is the whole point of the fingerprint.
const PRIVACY_SEEN_KEY = 'bmm_privacy_seen';
export async function checkAutoPrivacy(force = false) {
    try {
        const { privacy } = await legalHashes();
        if (!force && acceptedCurrent(PRIVACY_SEEN_KEY, PRIVACY_HASH_KEY, privacy))
            return;
        await openPrivacyModal();
        localStorage.setItem(PRIVACY_SEEN_KEY, 'true');
        if (privacy)
            localStorage.setItem(PRIVACY_HASH_KEY, privacy);
    }
    catch (e) {
        console.warn('[BMM] Auto privacy check failed:', e);
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
/** The Privacy Policy was accepted: its hash locally (what the start-up window reads) and a
 *  consent receipt (core/consent.ts): which version, which text, which language, when. */
export function markPrivacyAccepted(source = 'app') {
    legalHashes().then(({ privacy }) => { if (privacy) {
        try {
            localStorage.setItem(PRIVACY_HASH_KEY, privacy);
        }
        catch { /* private mode */ }
    } });
    void import('../core/consent.js').then((m) => m.recordConsent({ doc: 'privacy', choice: 'accepted', source })).catch(() => { });
}
export function markEulaAccepted() {
    localStorage.setItem(EULA_ACCEPTED_KEY, 'true');
    // Proof of WHICH terms were accepted, kept in the consent ledger (core/consent.ts).
    void import('../core/consent.js').then((m) => m.recordConsent({ doc: 'tos', choice: 'accepted', source: 'app' })).catch(() => { });
    // Record WHAT was accepted. Fire-and-forget: the bool above is already written, so a
    // failure here costs one extra prompt on the next launch, never a lost acceptance.
    legalHashes().then(({ tos }) => { if (tos)
        localStorage.setItem(EULA_HASH_KEY, tos); });
}
window.markEulaAccepted = markEulaAccepted;
// ── Language Selection on First Start ──────────────────────
const LANG_SELECTED_KEY = 'bmm_lang_selected';
export async function checkLangSelect() {
    const alreadySelected = localStorage.getItem(LANG_SELECTED_KEY) === 'true';
    if (!alreadySelected) {
        await openLangSelectModal();
    }
}
async function openLangSelectModal() {
    const { getLanguages, setLang, getLang } = await import('../core/i18n.js');
    const existing = document.getElementById('modal-lang-select');
    if (existing)
        existing.remove();
    // The house shell, and a question that must be answered: no ×, Escape and a click on the
    // dim do nothing (data-prevent-close). The language list opens over the footer, so the
    // body lets it out (.langsel-body).
    const modal = document.createElement('div');
    modal.id = 'modal-lang-select';
    modal.className = 'modal-overlay open';
    modal.setAttribute('data-prevent-close', 'true');
    function buildContent() {
        const languages = getLanguages();
        const appLang = getLang();
        const current = languages.find(l => l.code === appLang) || languages.find(l => l.active) || languages[0];
        const getFlag = (l) => {
            if (!l || !l.flag)
                return '⚪';
            const f = l.flag.trim();
            if (f.length === 2) {
                const code = f.toLowerCase();
                return `<img src="https://flagcdn.com/w20/${code}.png" width="20" height="14" style="border-radius:2px;object-fit:cover;vertical-align:middle" data-onerror="text" data-onerror-text="${f.toUpperCase()}">`;
            }
            return `<span style="margin-right:6px">${f}</span>`;
        };
        return `
        <div class="modal bms modal--sm" role="dialog" aria-modal="true" aria-labelledby="lang-select-title" data-modal-kind="question">
            <div class="modal-header">
                <img src="assets/Tasky_Happy.png" alt="" class="upd-tasky">
                <div class="bms-titles">
                    <h2 class="modal-title" id="lang-select-title">${t('onboarding.lang_title')}</h2>
                    <p class="bms-sub">${t('onboarding.lang_desc')}</p>
                </div>
            </div>

            <div class="modal-body langsel-body">
            <!-- Language dropdown -->
            <div style="position:relative">
                <button id="lang-select-toggle" style="
                    width:100%; display:flex; align-items:center; gap:10px;
                    padding:10px 14px; border-radius:10px; cursor:pointer;
                    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12);
                    color:var(--text-primary); font-size:14px; font-weight:600;
                    transition:all 0.2s;
                ">
                    <span id="lang-select-flag">${getFlag(current)}</span>
                    <span id="lang-select-name" style="flex:1; text-align:left">${current ? current.name : ''}</span>
                    ${uiIcon('chevron-up', 12, { style: 'transition:transform 0.2s', id: 'lang-select-chevron' })}
                </button>

                <div id="lang-select-menu" style="
                    display:none; position:absolute; bottom:calc(100% + 8px); left:0; right:0;
                    background:var(--bmm-bg-elevated); border:1px solid var(--bmm-border);
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
                            ${l.active ? (uiIcon('check', 14, { style: 'color:var(--accent)' })) : ''}
                        </button>
                    `).join('')}
                </div>
            </div>

            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-primary" id="lang-select-confirm">${t('common.ok')} →</button>
            </div>
        </div>
        `;
    }
    modal.innerHTML = buildContent();
    (document.getElementById('app-window-outer') || document.body).appendChild(modal);
    raiseAboveAll(modal, 10400);
    function rerender() {
        modal.innerHTML = buildContent();
        attachListeners();
    }
    function attachListeners() {
        const toggle = document.getElementById('lang-select-toggle');
        const menu = document.getElementById('lang-select-menu');
        const chevron = document.getElementById('lang-select-chevron');
        const confirm = document.getElementById('lang-select-confirm');
        if (!toggle || !menu || !confirm)
            return;
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.style.display === 'block';
            menu.style.display = isOpen ? 'none' : 'block';
            if (chevron)
                chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
        });
        menu.querySelectorAll('.lang-select-opt').forEach(opt => {
            opt.addEventListener('click', async (e) => {
                e.stopPropagation();
                const { setLang } = await import('../core/i18n.js');
                await setLang(opt.dataset.lang);
                rerender();
            });
        });
        document.addEventListener('click', () => {
            if (menu)
                menu.style.display = 'none';
            if (chevron)
                chevron.style.transform = '';
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
window.checkPtbMode = checkPtbMode;
window.openGuide = (name) => checkPtbMode(true, name);
//# sourceMappingURL=update-notes.js.map