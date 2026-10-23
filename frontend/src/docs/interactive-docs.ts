// @ts-nocheck
// The interactive diagrams' registry and entry point, plus the Tasky help bubble the rest of the
// app uses for tooltips. The diagrams themselves are data (./diagrams/*.ts, see diagram-spec.ts);
// drawing and interaction live in diagram-viewer.ts.
import { t } from '../core/i18n.js';
import { setDiagramRegistry, openSpec, closeViewer } from './diagram-viewer.js';
import { resumableDownloads } from './diagrams/resumable-downloads.js';
import { modSync } from './diagrams/mod-sync.js';
import { profileSystem } from './diagrams/profile-system.js';
import { conflictManagement } from './diagrams/conflict-management.js';
import { appUpdate } from './diagrams/app-update.js';
import { modImport } from './diagrams/mod-import.js';
import { backupSystem } from './diagrams/backup-system.js';
import { perfMonitoring } from './diagrams/perf-monitoring.js';
import { serverMode } from './diagrams/server-mode.js';
import { profileCustomization } from './diagrams/profile-customization.js';
import { faqDiskFull } from './diagrams/faq-disk-full.js';
import { faqDeletedMod } from './diagrams/faq-deleted-mod.js';
import { crashReporting } from './diagrams/crash-reporting.js';
import { cacheManagement } from './diagrams/cache-management.js';
import { modArchitecture } from './diagrams/mod-architecture.js';
import { diskIoLimiter } from './diagrams/disk-io-limiter.js';
import { hostingFlow } from './diagrams/hosting-flow.js';
import { lightweightArchitecture } from './diagrams/lightweight-architecture.js';
import { oneClickInstall } from './diagrams/one-click-install.js';
import { discordRpc } from './diagrams/discord-rpc.js';
import { engineThreads } from './diagrams/engine-threads.js';
import { codeStack } from './diagrams/code-stack.js';
import { semanticSearch } from './diagrams/semantic-search.js';
import { integrityEngine } from './diagrams/integrity-engine.js';
import { mtimeCache } from './diagrams/mtime-cache.js';
import { modpackFlow } from './diagrams/modpack-flow.js';
import { bmmscriptFlow } from './diagrams/bmmscript-flow.js';
import { securitySystem } from './diagrams/security-system.js';
import { modMapper } from './diagrams/mod-mapper.js';
import { launchPacks } from './diagrams/launch-packs.js';
import { mcpServer } from './diagrams/mcp-server.js';
import { dockerDeployment } from './diagrams/docker-deployment.js';
import { modActivation } from './diagrams/mod-activation.js';
import { themeSystem } from './diagrams/theme-system.js';
import { appCatalog } from './diagrams/app-catalog.js';
import { blake3Hashing } from './diagrams/blake3-hashing.js';
import { scheduler } from './diagrams/scheduler.js';
import { updateSystem } from './diagrams/update-system.js';
import { offlineMode } from './diagrams/offline-mode.js';
import { telemetryPipeline } from './diagrams/telemetry-pipeline.js';
import { i18nSystem } from './diagrams/i18n-system.js';
import { customPages } from './diagrams/custom-pages.js';
import { deeplinks } from './diagrams/deeplinks.js';
import { layaPipeline } from './diagrams/laya-pipeline.js';
import { layaCrashAnalysis } from './diagrams/laya-crash-analysis.js';


// Diagram Registry
export const diagrams = {
    'bmmscript-flow': bmmscriptFlow,
    'custom-pages': customPages,
    'deeplinks': deeplinks,
    'resumable-downloads': resumableDownloads,
    'mod-sync': modSync,
    'profile-system': profileSystem,
    'conflict-management': conflictManagement,
    'app-update': appUpdate,
    'mod-import': modImport,
    'backup-system': backupSystem,
    'perf-monitoring': perfMonitoring,
    'server-mode': serverMode,
    'profile-customization': profileCustomization,
    'faq-disk-full': faqDiskFull,
    'faq-deleted-mod': faqDeletedMod,
    'crash-reporting': crashReporting,
    'cache-management': cacheManagement,
    'mod-architecture': modArchitecture,
    'disk-io-limiter': diskIoLimiter,
    'hosting-flow': hostingFlow,
    'lightweight-architecture': lightweightArchitecture,
    'one-click-install': oneClickInstall,
    'discord-rpc': discordRpc,
    'engine-threads': engineThreads,
    'code-stack': codeStack,
    'semantic-search': semanticSearch,
    'integrity-engine': integrityEngine,
    'mtime-cache': mtimeCache,
    'modpack-flow': modpackFlow,
    'security-system': securitySystem,
    'mod-mapper': modMapper,
    'launch-packs': launchPacks,
    'mcp-server': mcpServer,
    'docker-deployment': dockerDeployment,
    'mod-activation': modActivation,
    'theme-system': themeSystem,
    'app-catalog': appCatalog,
    'blake3-hashing': blake3Hashing,
    'scheduler': scheduler,
    'update-system': updateSystem,
    'offline-mode': offlineMode,
    'telemetry-pipeline': telemetryPipeline,
    'i18n-system': i18nSystem,
    'laya-pipeline': layaPipeline,
    'laya-crash-analysis': layaCrashAnalysis,
};

// Each spec carries its prefix; the docs hub and analytics read `titleKey`.
for (const s of Object.values(diagrams)) s.titleKey = `${s.i18n}.title`;
setDiagramRegistry(diagrams);

/**
 * Wire the dialog's close paths. Mermaid is NOT loaded here: it is 3.3 MB and only a diagram
 * needs it, so ensureMermaid() fetches it when one is actually opened. This runs at every
 * launch; most launches never open a diagram.
 */
export function initInteractiveDocs() {
    document.getElementById('btn-close-docs-diagram')?.addEventListener('click', closeDiagram);

    // Click on the dim area closes; a drag that ends there (a pan that overshot) does not.
    const modal = document.getElementById('modal-docs-diagram');
    if (modal) {
        let mouseMoved = false;
        modal.addEventListener('mousedown', () => { mouseMoved = false; });
        modal.addEventListener('mousemove', () => { mouseMoved = true; });
        modal.addEventListener('mouseup', (e) => {
            if (!mouseMoved && e.target.id === 'modal-docs-diagram') closeDiagram();
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !e.defaultPrevented && document.getElementById('modal-docs-diagram')?.classList.contains('active')) {
            // Answered here: the shell's global Escape must not press the × a second time.
            e.preventDefault();
            closeDiagram();
        }
    });
}

/**
 * Open a diagram by registry id, optionally selecting one of its nodes.
 * @param {string} id - The diagram ID from the registry
 * @param {string|null} highlightNodeId - a node id to select and centre
 */
export async function openDiagram(id, highlightNodeId = null) {
    if (!diagrams[id]) {
        // Console-only used to mean a diagram button that silently did nothing, which is how
        // `lightweight-architecture` sat broken: the click "worked", and nothing opened.
        console.error(`[Docs] Diagram "${id}" not found.`);
        (window as any).showToast?.(t('docs.diagram.missing'), 'error');
        return;
    }
    hideTaskyHelp();
    await openSpec(id, { highlight: highlightNodeId });
}

function closeDiagram() {
    const modal = document.getElementById('modal-docs-diagram');
    if (!modal) return;
    modal.classList.remove('active');
    hideTaskyHelp();
    closeViewer();
    setTimeout(() => {
        modal.style.display = 'none';
        const c = document.getElementById('mermaid-diagram-container');
        if (c) c.innerHTML = '';
    }, 250);
}

/**
 * Show Tasky explanation bubble globally
 * @param {string} key - The translation key for the text, or literal text if isLiteral is true
 * @param {string} iconClass - The CSS class for the eyes icon
 * @param {boolean} isLiteral - If true, treats the key as literal text
 */
let tooltipTimeout: number | null = null;
let hideTimeout: number | null = null;
let isTooltipVisible = false;
let lastTooltipKey: string | null = null;
let lastTooltipIcon: string | null = null;
let lastTooltipLiteral: boolean = false;

export function showTaskyHelp(key, iconClass = 'info', isLiteral = false) {
    // Respect user preference to disable tooltips. NOTE: this is the ONLY switch that
    // governs the help bubbles — the "Afficher Tasky" (corner mascot) toggle is
    // independent and must not silence tooltips.
    if ((window as any).__taskyTooltipEnabled === false) return;

    // An empty bubble is worse than none (field screenshot: a bare frame hovering
    // beside a control). If the key resolves to nothing — or to itself, which is
    // what an i18n miss returns — there is nothing to say, so say nothing.
    const _resolved = isLiteral ? String(key ?? '') : t(String(key ?? ''));
    if (!_resolved || !_resolved.trim() || (!isLiteral && _resolved === key)) return;

    // Don't show tooltips when dropdown is open
    if ((window as any).__dropdownOpen === true) return;

    // Clear any pending hide timeout
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }

    // If tooltip is already showing with same content, don't re-trigger
    if (isTooltipVisible && 
        lastTooltipKey === key && 
        lastTooltipIcon === iconClass && 
        lastTooltipLiteral === isLiteral) {
        return;
    }

    // Clear any existing show timeout
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
    }

    // Increased debounce to better filter out rapid hover changes
    tooltipTimeout = window.setTimeout(() => {
        // Double-check dropdown state before showing
        if ((window as any).__dropdownOpen === true) return;
        
        lastTooltipKey = key;
        lastTooltipIcon = iconClass;
        lastTooltipLiteral = isLiteral;
        isTooltipVisible = true;
        showTooltipImpl(key, iconClass, isLiteral);
        tooltipTimeout = null;
    }, 80); // Increased to 80ms for better stability
}

/**
 * Internal implementation for showing tooltip
 */
// Every `icon-*` class that actually has a mask-image rule in main.css. Used to
// guarantee the Tasky tooltip only ever applies a real icon (no missing-glyph box).
const DEFINED_TASKY_ICONS = new Set([
    'icon-option', 'icon-disk', 'icon-start', 'icon-search', 'icon-verify', 'icon-network',
    'icon-download', 'icon-layers', 'icon-blocks', 'icon-cloud', 'icon-build', 'icon-patch',
    'icon-check', 'icon-done', 'icon-flow', 'icon-user', 'icon-share', 'icon-group',
    'icon-delete', 'icon-trash', 'icon-link', 'icon-refresh', 'icon-image', 'icon-text',
    'icon-code', 'icon-save', 'icon-add', 'icon-alert', 'icon-folder', 'icon-file',
    'icon-lock', 'icon-list', 'icon-chart', 'icon-stop', 'icon-settings', 'icon-play',
    'icon-shield', 'icon-plus', 'icon-minus', 'icon-x', 'icon-info', 'icon-help',
    'icon-warning', 'icon-history', 'icon-package', 'icon-grid', 'icon-database', 'icon-heart',
    'icon-close', 'icon-maximize', 'icon-minimize', 'icon-edit', 'icon-toggle', 'icon-pin',
    'icon-activity', 'icon-app', 'icon-archive', 'icon-bolt', 'icon-box', 'icon-brain',
    'icon-cog', 'icon-command', 'icon-compare', 'icon-copy', 'icon-cpu', 'icon-drive',
    'icon-export', 'icon-flash', 'icon-globe', 'icon-import', 'icon-integrity', 'icon-intersect',
    'icon-key', 'icon-layout', 'icon-message', 'icon-meta', 'icon-meter', 'icon-mouse',
    'icon-priority', 'icon-req', 'icon-restore', 'icon-scales', 'icon-scissors', 'icon-script',
    'icon-server', 'icon-speed', 'icon-star', 'icon-stream', 'icon-sync', 'icon-terminal',
    'icon-time', 'icon-unlock', 'icon-users', 'icon-zap',
]);

function showTooltipImpl(key: string, iconClass: string, isLiteral: boolean) {

    const bubble = document.querySelector('.tasky-speech-bubble');
    const eyes = document.getElementById('tasky-bubble-eyes');
    const explanationEl = document.getElementById('tasky-explanation');
    const taskyContainer = document.getElementById('tasky-bubble-docs');
    
    if (!bubble || !explanationEl || !taskyContainer) return;

    // Show Container if hidden (for non-modal use)
    if (taskyContainer.style.display === 'none') {
        taskyContainer.style.display = 'flex';
        taskyContainer.style.pointerEvents = 'auto';
        setTimeout(() => taskyContainer.style.opacity = '1', 10);
    }

    // Icon Normalization
    let finalIcon = iconClass || 'icon-info';
    if (finalIcon === 'help') finalIcon = 'icon-help';
    if (finalIcon === 'info') finalIcon = 'icon-info';
    if (finalIcon === 'warning' || finalIcon === 'alert') finalIcon = 'icon-warning';
    if (finalIcon === 'verify') finalIcon = 'icon-verify';
    if (finalIcon === 'search') finalIcon = 'icon-search';
    if (finalIcon === 'layers') finalIcon = 'icon-layers';
    if (finalIcon === 'history') finalIcon = 'icon-history';
    if (finalIcon === 'play') finalIcon = 'icon-play';
    if (finalIcon === 'refresh') finalIcon = 'icon-refresh';
    if (finalIcon === 'minimize') finalIcon = 'icon-minimize';
    if (finalIcon === 'maximize') finalIcon = 'icon-maximize';
    if (finalIcon === 'close') finalIcon = 'icon-close';
    if (finalIcon === 'folder') finalIcon = 'icon-folder';
    if (finalIcon === 'edit') finalIcon = 'icon-edit';
    if (finalIcon === 'trash' || finalIcon === 'delete') finalIcon = 'icon-trash';
    if (finalIcon === 'toggle') finalIcon = 'icon-toggle';
    if (finalIcon === 'alert') finalIcon = 'icon-alert';
    if (finalIcon === 'package') finalIcon = 'icon-package';
    if (finalIcon === 'shield') finalIcon = 'icon-verify';
    if (finalIcon === 'network' || finalIcon === 'server') finalIcon = 'icon-database';
    if (finalIcon === 'user' || finalIcon === 'profiles') finalIcon = 'icon-user';
    if (finalIcon === 'library') finalIcon = 'icon-grid';
    if (finalIcon === 'list') finalIcon = 'icon-list';
    if (finalIcon === 'heart' || finalIcon === 'credits') finalIcon = 'icon-heart';
    if (finalIcon === 'settings') finalIcon = 'icon-settings';
    if (finalIcon === 'layers' || finalIcon === 'mapper') finalIcon = 'icon-layers';
    if (finalIcon === 'pin' || finalIcon === 'sticky' || finalIcon === 'icon-pin') finalIcon = 'icon-pin';

    // Universal safety net: a caller may pass a bare name ('grid', 'apps', …) that
    // no rule above maps. Prefix it, and if the resulting class isn't an actually
    // DEFINED icon (a mask-image rule in CSS), fall back to icon-info — so the
    // tooltip never shows a broken "tofu" box. Fixes navbar + anywhere else.
    if (!finalIcon.startsWith('icon-')) finalIcon = 'icon-' + finalIcon;
    if (!DEFINED_TASKY_ICONS.has(finalIcon)) finalIcon = 'icon-info';

    // Text content logic
    let exp = key;
    if (!isLiteral) {
        const descKey = key + '.desc';
        const descExp = t(descKey);
        // Priority 1: Use .desc if available. Priority 2: Use regular key if it's translated
        exp = (descExp && descExp !== descKey) ? descExp : t(key);
    }
    
    // Show if we have valid content (or if literal is requested).
    // Decode HTML entities that may have been left encoded when the value
    // came from a path that skipped the HTML parser (e.g. setAttribute).
    if (exp && (isLiteral || exp !== key)) {
        if (isLiteral && exp.includes('&')) {
            const tmp = document.createElement('textarea');
            tmp.innerHTML = exp;
            exp = tmp.value;
        }
        explanationEl.textContent = exp;
        bubble.classList.add('active');
        // Re-enable pointer events when showing
        bubble.style.pointerEvents = 'auto';
        
        if (eyes) {
            eyes.className = finalIcon;
            eyes.style.display = 'flex'; // Match CSS flex display
        }
        updateTaskyMascot('Tasky_Happy.png');

        // FORCE POSITION UPDATE IMMEDIATELY
        if (typeof (window as any).updateTaskyPosition === 'function') {
            (window as any).updateTaskyPosition(null); // Pass null to use last known coordinates
        }

        // Prevent Right-Side Clipping
        requestAnimationFrame(() => {
            const rect = bubble.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const margin = 30; // Safety margin
            
            if (rect.right > viewportWidth - margin) {
                const overflow = rect.right - (viewportWidth - margin);
                const newMaxWidth = Math.max(200, 440 - overflow);
                (bubble as HTMLElement).style.maxWidth = `${newMaxWidth}px`;
            } else {
                (bubble as HTMLElement).style.maxWidth = `440px`;
            }
        });
    } else {
        // Hide if invalid key
        bubble.classList.remove('active');
        if (taskyContainer) {
            taskyContainer.style.display = 'none';
            taskyContainer.style.opacity = '0';
        }
    }
}

/**
 * Hide Tasky explanation bubble globally
 */
export function hideTaskyHelp() {
    // Clear any pending show timeout
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
        tooltipTimeout = null;
    }

    // Clear any existing hide timeout
    if (hideTimeout) {
        clearTimeout(hideTimeout);
    }

    // Debounce hide to prevent flickering during rapid hover changes
    hideTimeout = window.setTimeout(() => {
        const bubble = document.querySelector('.tasky-speech-bubble');
        const taskyContainer = document.getElementById('tasky-bubble-docs');
        const modal = document.getElementById('modal-docs-diagram');

        if (bubble) {
            bubble.classList.remove('active');
            // Immediately disable pointer events when hiding
            bubble.style.pointerEvents = 'none';
        }
        updateTaskyMascot('Tasky.png');

        // If modal is NOT active, hide whole container immediately
        if (taskyContainer && (!modal || !modal.classList.contains('active'))) {
            taskyContainer.style.opacity = '0';
            taskyContainer.style.pointerEvents = 'none';
            taskyContainer.style.display = 'none';
        }

        // Reset state
        isTooltipVisible = false;
        lastTooltipKey = null;
        lastTooltipIcon = null;
        lastTooltipLiteral = false;
        hideTimeout = null;
    }, 30); // 30ms debounce for hide
}

/**
 * Navigation helper to jump to a specific FAQ or documentation section from outside the docs view
 * @param {string} targetKey - The translation key of the question/section (e.g. 'faq.qPat')
 */
export function openHelpTo(targetKey) {
    console.log(`[Docs] Navigating to help topic: ${targetKey}`);
    // 1. Switch to Documentation View
    const docsNavItem = document.querySelector('.nav-item[data-view="docs"]');
    if (docsNavItem)
        (docsNavItem as HTMLElement).click();
    // 2. Small delay to allow view switch and ensure DOM is ready
    setTimeout(() => {
        // 3. Switch to the correct tab: FAQ keys go to 'faq', others to 'advanced'
        const targetTab = targetKey.startsWith('faq.') ? 'faq' : 'advanced';
        const tabBtn = document.querySelector(`.btn-docs-tab[data-tab="${targetTab}"]`);
        if (tabBtn)
            (tabBtn as HTMLElement).click();
        // 4. Find the element with the target translation key
        const targetEl = document.querySelector(`[data-i18n="${targetKey}"]`);
        if (targetEl) {
            // 5. If it's inside an accordion (details), open it
            const accordion = targetEl.closest('.faq-accordion') || targetEl.closest('details');
            if (accordion)
                (accordion as HTMLDetailsElement).open = true;
            // 6. Scroll into view
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // 7. Brief highlight effect
            const container = (accordion || targetEl) as HTMLElement;
            container.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
            const originalShadow = container.style.boxShadow;
            const originalBorder = container.style.borderColor;
            container.style.boxShadow = '0 0 30px rgba(59, 130, 246, 0.3)';
            container.style.borderColor = 'var(--accent)';
            setTimeout(() => {
                container.style.boxShadow = originalShadow;
                container.style.borderColor = originalBorder;
            }, 2500);
        }
        else {
            console.warn(`[Docs] Target help key not found in DOM: ${targetKey}`);
        }
    }, 150);
}

/**
 * Change Tasky appearance
 */
let currentMascotUrl = ''; // Optimization to prevent flickering

function updateTaskyMascot(file) {
    const mascotImg = document.getElementById('tasky-mascot-img');
    if (!mascotImg) return;
    
    const newUrl = `assets/${file}`;
    if (currentMascotUrl === newUrl) return; // Only load if different
    
    mascotImg.src = newUrl;
    currentMascotUrl = newUrl;
}

window.openDiagram = openDiagram;
window.openDocs = openDiagram;
window.initInteractiveDocs = initInteractiveDocs;
window.showTaskyHelp = showTaskyHelp;
window.hideTaskyHelp = hideTaskyHelp;
window.openHelpTo = openHelpTo;

export default { initInteractiveDocs, openDiagram, showTaskyHelp, hideTaskyHelp, openHelpTo };