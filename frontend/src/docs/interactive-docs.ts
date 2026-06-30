// @ts-nocheck
import { t } from '../core/i18n.js';
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
import { moddingMechanics } from './diagrams/modding-mechanics.js';
import { faqDiskFull } from './diagrams/faq-disk-full.js';
import { faqDeletedMod } from './diagrams/faq-deleted-mod.js';
import { bestPractices } from './diagrams/best-practices.js';
import { crashReporting } from './diagrams/crash-reporting.js';
import { cacheManagement } from './diagrams/cache-management.js';
import { dedicatedHosting } from './diagrams/dedicated-hosting.js';
import { modArchitecture } from './diagrams/mod-architecture.js';
import { diskIoLimiter } from './diagrams/disk-io-limiter.js';
import { hostingFlow } from './diagrams/hosting-flow.js';
import { lightweightArchitecture } from './diagrams/lightweight-architecture.js';
import { oneClickInstall } from './diagrams/one-click-install.js';
import { docsLogic } from './diagrams/docs-logic.js';
import { discordRpc } from './diagrams/discord-rpc.js';
import { engineThreads } from './diagrams/engine-threads.js';
import { codeStack } from './diagrams/code-stack.js';
import { semanticSearch } from './diagrams/semantic-search.js';
import { integrityEngine } from './diagrams/integrity-engine.js';
import { mtimeCache } from './diagrams/mtime-cache.js';
import { premiumInteractions } from './diagrams/premium-interactions.js';
import { betahubReporting } from './diagrams/betahub-reporting.js';
import { modpackFlow } from './diagrams/modpack-flow.js';
import { securitySystem } from './diagrams/security-system.js';
import { modMapper } from './diagrams/mod-mapper.js';
import { launchPacks } from './diagrams/launch-packs.js';
import { mcpServer } from './diagrams/mcp-server.js';
import { dockerDeployment } from './diagrams/docker-deployment.js';
import { modActivation } from './diagrams/mod-activation.js';
import { themeSystem } from './diagrams/theme-system.js';
import { appCatalog } from './diagrams/app-catalog.js';
import { modUpdates } from './diagrams/mod-updates.js';
import { blake3Hashing } from './diagrams/blake3-hashing.js';
import { scheduler } from './diagrams/scheduler.js';
import { updateSystem } from './diagrams/update-system.js';


// Diagram Registry
export const diagrams = {
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
    'modding-mechanics': moddingMechanics,
    'faq-disk-full': faqDiskFull,
    'faq-deleted-mod': faqDeletedMod,
    'best-practices': bestPractices,
    'crash-reporting': crashReporting,
    'cache-management': cacheManagement,
    'dedicated-hosting': dedicatedHosting,
    'mod-architecture': modArchitecture,
    'disk-io-limiter': diskIoLimiter,
    'hosting-flow': hostingFlow,
    'lightweight-architecture': lightweightArchitecture,
    'one-click-install': oneClickInstall,
    'docs-logic': docsLogic,
    'discord-rpc': discordRpc,
    'engine-threads': engineThreads,
    'code-stack': codeStack,
    'semantic-search': semanticSearch,
    'integrity-engine': integrityEngine,
    'mtime-cache': mtimeCache,
    'premium-interactions': premiumInteractions,
    'betahub-reporting': betahubReporting,
    'modpack-flow': modpackFlow,
    'security-system': securitySystem,
    'mod-mapper': modMapper,
    'launch-packs': launchPacks,
    'mcp-server': mcpServer,
    'docker-deployment': dockerDeployment,
    'mod-activation': modActivation,
    'theme-system': themeSystem,
    'app-catalog': appCatalog,
    'mod-updates': modUpdates,
    'blake3-hashing': blake3Hashing,
    'scheduler': scheduler,
    'update-system': updateSystem,
};


// State
let currentDiagramID = null;
let panZoomInstance = null;
let isDragging = false;

/**
 * Initialize Mermaid and Documentation logic
 */
export function initInteractiveDocs() {
    console.log('[Docs] Initializing sub-system...');
    
    // Mermaid Config
    mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        useMaxWidth: false,
        htmlLabels: true, // Enable HTML labels for icons
        securityLevel: 'loose', // Required for HTML labels
        flowchart: {
            clusterPadding: 65, // Increased space to allow labels at the top without overlap
            nodeSpacing: 50,
            rankSpacing: 50,
            curve: 'basis'
        },
        themeVariables: {
            primaryColor: '#3b82f6',
            primaryTextColor: '#f1f5f9',
            primaryBorderColor: '#3b82f6',
            lineColor: '#475569',
            fontFamily: 'Inter, sans-serif',
            fontSize: '14px',
            mainBkg: '#1e293b'
        }
    });

    // Global listeners
    document.getElementById('btn-close-docs-diagram')?.addEventListener('click', closeDiagram);
    document.getElementById('btn-docs-reset-zoom')?.addEventListener('click', resetZoom);

    // Click outside to close (Robust version to avoid closing on drag)
    const modal = document.getElementById('modal-docs-diagram');
    if (modal) {
        let mouseMoved = false;
        
        modal.addEventListener('mousedown', (e) => {
            mouseMoved = false;
        });

        modal.addEventListener('mousemove', () => {
            mouseMoved = true;
        });

        modal.addEventListener('mouseup', (e) => {
            // Only close if it was a distinct click on the overlay, NOT a drag
            if (!mouseMoved && e.target.id === 'modal-docs-diagram') {
                closeDiagram();
            }
        });
    }

    // Close on Escape
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('modal-docs-diagram')?.classList.contains('active')) {
            closeDiagram();
        }
    });

    console.log('[Docs] Sub-system ready.');
}

/**
 * Open a specific diagram
 * @param {string} id - The diagram ID from the registry
 */
export async function openDiagram(id, highlightNodeId = null) {
    const diagram = diagrams[id];
    if (!diagram) {
        console.error(`[Docs] Diagram "${id}" not found.`);
        return;
    }

    const modal = document.getElementById('modal-docs-diagram');
    const container = document.getElementById('mermaid-diagram-container');
    const title = document.getElementById('docs-diagram-title');
    const taskyText = document.getElementById('tasky-explanation');

    currentDiagramID = id;
    title.textContent = t(diagram.titleKey);
    taskyText.textContent = t('docs.diagram.taskyInstruction');
    
    // Reset Tasky mascot to default
    updateTaskyMascot('Tasky.png');

    // Show modal
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);

    // Show Global Tasky
    const taskyContainer = document.getElementById('tasky-bubble-docs');
    if (taskyContainer) {
        taskyContainer.style.display = 'flex';
        setTimeout(() => taskyContainer.style.opacity = '1', 10);
    }

    // Render Mermaid
    try {
        container.innerHTML = '';
        const { render } = mermaid;
        
        // Pre-translate definitions (handles {{key}} placeholders)
        const translatedDefinition = diagram.definition.replace(/\{\{([a-zA-Z0-9._-]+)\}\}/g, (match, key) => t(key));
        
        const { svg } = await render('mermaid-svg-' + id, translatedDefinition);
        container.innerHTML = svg;

        // Make ALL diagrams theme-aware: mermaid injects classDef colours as high
        // specificity !important rules inside the SVG's own <style>. Rewrite the
        // generic "default" node colours to theme tokens so every diagram follows
        // the active theme (semantic colours like rust/shield are left intact).
        container.querySelectorAll('svg style').forEach(styleEl => {
            styleEl.textContent = (styleEl.textContent || '')
                .replace(/#1e293b/gi, 'var(--bmm-diagram-node)')
                .replace(/#0a0e17/gi, 'var(--bmm-bg-base)')
                .replace(/#111827/gi, 'var(--bmm-bg-elevated)')
                .replace(/#475569/gi, 'var(--bmm-diagram-node-border)')
                .replace(/#f1f5f9/gi, 'var(--bmm-diagram-node-text)')
                .replace(/#e2e8f0/gi, 'var(--bmm-diagram-node-text)')
                .replace(/#94a3b8/gi, 'var(--bmm-text-secondary)');
        });

        // Initialize Pan & Zoom
        initPanZoom();

        // Fix Cluster Labels Layout (Mermaid Centering override)
        // We use multiple calls to catch various render cycles
        fixClusterLabels();
        setTimeout(fixClusterLabels, 50);
        setTimeout(fixClusterLabels, 150);
        setTimeout(fixClusterLabels, 500);

        // Attach interactions
        attachNodeListeners(id);

        if (highlightNodeId) {
            // Give Mermaid enough time to finish all layout calculation stages
            setTimeout(() => applyNodeHighlight(highlightNodeId), 500);
        }
    } catch (err) {
        console.error('[Docs] Mermaid render error:', err);
        container.innerHTML = `<p style="color:var(--danger)">${t('common.error')}: Mermaid render error</p>`;
    }
}

/**
 * Robustly fix cluster (subgraph) label positioning.
 * Mermaid default centers labels in a small foreignObject.
 * We expand the foreignObject to match the cluster rect and align left.
 */
function fixClusterLabels() {
    const container = document.getElementById('mermaid-diagram-container');
    const svg = container.querySelector('svg');
    if (!svg) return;

    // Create a dedicated top layer for labels if it doesn't exist
    // We append it to the viewport group so it pans and zooms with the diagram
    const viewport = svg.querySelector('.svg-pan-zoom_viewport');
    if (!viewport) return; // Wait for pan-zoom to init

    let topLayer = viewport.querySelector('.top-labels-layer');
    if (!topLayer) {
        topLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        topLayer.setAttribute('class', 'top-labels-layer');
        viewport.appendChild(topLayer);
    }

    const clusters = svg.querySelectorAll('.cluster');
    clusters.forEach(cluster => {
        const rect = cluster.querySelector('rect.outer') || cluster.querySelector('rect');
        const labelGroup = cluster.querySelector('.cluster-label');
        if (!rect || !labelGroup) return;

        const foreign = labelGroup.querySelector('foreignObject');
        if (!foreign) return;

        // Get rect bounds in local coordinate system
        const rectBox = rect.getBBox();
        
        // Extract group ID and store it on the cluster element for easier access later
        const rawId = cluster.getAttribute('id') || "";
        const groupID = rawId.replace('cluster-', '');
        cluster.setAttribute('data-cluster-id', groupID);

        // Position the label at the top-left of its cluster
        // We shift it up by 12px to give breathing room to nodes inside
        foreign.setAttribute('x', rectBox.x);
        foreign.setAttribute('y', rectBox.y - 12); 
        foreign.setAttribute('width', Math.max(rectBox.width, 250)); 
        foreign.setAttribute('height', 80); 

        // Style the inner div for premium appearance
        const innerDiv = foreign.querySelector('div');
        if (innerDiv) {
            innerDiv.style.width = '100%';
            innerDiv.style.height = '100%';
            innerDiv.style.display = 'flex';
            innerDiv.style.flexDirection = 'column';
            innerDiv.style.alignItems = 'flex-start';
            innerDiv.style.justifyContent = 'flex-start';
            innerDiv.style.paddingLeft = '18px';
            innerDiv.style.paddingTop = '18px';
            innerDiv.style.boxSizing = 'border-box';
            innerDiv.style.textAlign = 'left';
            innerDiv.style.background = 'transparent';
            innerDiv.style.pointerEvents = 'none'; // Ensure label doesn't block cluster interaction
        }
        foreign.style.pointerEvents = 'none';


        // Ensure the labelGroup itself doesn't have a conflicting transform
        labelGroup.removeAttribute('transform');
        labelGroup.style.transform = 'none';
        
        // Move to the top layer for correct Z-index
        if (labelGroup.parentElement !== topLayer) {
            topLayer.appendChild(labelGroup);
        }
    });
}

/**
 * Internal helper to find the SVG path associated with a label
 */
// findPathForLabel is now integrated into the loop logic above for better sync

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
    // Respect user preference to disable tooltips
    if ((window as any).__taskyTooltipEnabled === false) return;

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
 * Close the modal
 */
function closeDiagram() {
    const modal = document.getElementById('modal-docs-diagram');
    modal.classList.remove('active');
    
    // Use the global helper to hide Tasky
    hideTaskyHelp();

    if (panZoomInstance) {
        panZoomInstance.destroy();
        panZoomInstance = null;
    }

    // Hide overlay after animation
    setTimeout(() => {
        modal.style.display = 'none';
        document.getElementById('mermaid-diagram-container').innerHTML = '';
        currentDiagramID = null;
    }, 250);
}

/**
 * Attach hover listeners to SVG elements (nodes, edges, clusters)
 */
function attachNodeListeners(diagramID) {
    const container = document.getElementById('mermaid-diagram-container');
    const diagram = diagrams[diagramID];
    const bubble = document.querySelector('.tasky-speech-bubble');
    const eyes = document.getElementById('tasky-bubble-eyes');
    const explanationEl = document.getElementById('tasky-explanation');

    // 1. Class Sync (Ensure .edgeLabel container gets the semantic class from inner span)
    const edgeLabels = Array.from(container.querySelectorAll('.edgeLabel'));
    console.log(`[Docs] Syncing ${edgeLabels.length} edge labels...`);
    edgeLabels.forEach(label => {
        const innerSpan = label.querySelector('span[class^="label-"]');
        if (innerSpan) {
            const cls = Array.from(innerSpan.classList).find(c => c.startsWith('label-'));
            if (cls) {
                console.log(`[Docs] Label sync: found ${cls} adding to parent`);
                label.classList.add(cls);
                label.classList.add(`${cls}-parent`);
            }
        }
    });

    // 2. Nodes (Steps)
    const nodes = container.querySelectorAll('.node');
    nodes.forEach(node => {
        const parts = node.id.split('-');
        const cleanId = parts[1]?.toLowerCase().replace(/_/g, '-');
        if (!cleanId) return;
        
        const isJumpLink = !!diagrams[cleanId];

        node.addEventListener('mouseenter', () => {
            if (isJumpLink) {
                node.style.cursor = 'pointer';
                const rect = node.querySelector('rect');
                if (rect) {
                    rect.style.strokeWidth = '3px';
                    rect.style.filter = 'drop-shadow(0 0 8px var(--accent))';
                }
            }
            showTaskyHelp(diagram.explanationPrefix + parts[1], node.querySelector('i')?.className);
        });

        node.addEventListener('mouseleave', () => {
            node.style.cursor = 'default';
            const rect = node.querySelector('rect');
            if (rect) {
                rect.style.strokeWidth = '1px';
                rect.style.filter = 'none';
            }
            hideTaskyHelp();
        });

        // Click to drill-down / jump
        node.addEventListener('click', () => {
            if (isJumpLink) {
                openDiagram(cleanId);
            }
        });
    });

    // 2. Edges (Arrows & Path interactions) - V3 Robust Class Matching
    const edgePaths = Array.from(container.querySelectorAll('.edgePath'));
    // edgeLabels already declared above in step 1

    // Helper to extract IDs from class (e.g., "LS-A LE-B")
    const getEdgePair = (el) => {
        if (!el) return null;
        const cls = Array.from(el.classList).join(' ');
        const sourceMatch = cls.match(/LS-([^\s]+)/);
        const targetMatch = cls.match(/LE-([^\s]+)/);
        return sourceMatch && targetMatch ? `${sourceMatch[1]}-${targetMatch[1]}` : null;
    };

    edgePaths.forEach((pathGroup) => {
        const pairKey = getEdgePair(pathGroup);
        if (!pairKey) return;

        const internalPath = pathGroup.querySelector('path');
        if (!internalPath) return;

        // Use a composite key: docs.diagram.edge.[DIAGRAM_ID].[SOURCE]_[TARGET]
        const edgeKey = `docs.diagram.edge.${diagramID}.${pairKey.replace('-', '_')}`;
        
        // Fallback to label-based if specific key doesn't exist (backwards compatibility)
        const label = edgeLabels.find(l => getEdgePair(l) === pairKey);
        const labelSpan = label ? label.querySelector('span') : null;
        const labelKeyFromData = labelSpan ? labelSpan.getAttribute('data-key') : null;
        const labelText = label ? label.textContent.trim() : null;

        pathGroup.addEventListener('mouseenter', () => {
            // Priority: Node-based key > data-key from span > Label-based key
            const exp = t(edgeKey);
            if (exp && exp !== edgeKey) {
                showTaskyHelp(edgeKey, 'network');
            } else if (labelKeyFromData) {
                showTaskyHelp(`docs.diagram.edge.${labelKeyFromData}`, 'network');
            } else if (labelText) {
                showTaskyHelp(`docs.diagram.edge.${labelText}`, 'network');
            } else {
                updateTaskyMascot('Tasky_yeux1.png');
            }
        });

        pathGroup.addEventListener('mouseleave', hideTaskyHelp);
    });

    edgeLabels.forEach((edge) => {
        const pairKey = getEdgePair(edge);
        if (!pairKey) return;

        const edgeKey = `docs.diagram.edge.${diagramID}.${pairKey.replace('-', '_')}`;
        const labelText = edge.textContent.trim();

        edge.addEventListener('mouseenter', () => {
            const labelSpan = edge.querySelector('span');
            const labelKeyFromData = labelSpan ? labelSpan.getAttribute('data-key') : null;
            
            const exp = t(edgeKey);
            if (exp && exp !== edgeKey) {
                showTaskyHelp(edgeKey, 'network');
            } else if (labelKeyFromData) {
                showTaskyHelp(`docs.diagram.edge.${labelKeyFromData}`, 'network');
            } else if (labelText) {
                showTaskyHelp(`docs.diagram.edge.${labelText}`, 'network');
            }
            updateTaskyMascot('Tasky_yeux1.png');
        });
        edge.addEventListener('mouseleave', hideTaskyHelp);
    });

    /**
     * Internal helper to find the SVG path associated with a label
     */
    // findPathForLabel is now integrated into the loop logic above for better sync

    // 3. Clusters (Logical Cards)
    const clusters = container.querySelectorAll('.cluster');
    clusters.forEach(cluster => {
        // ID Priority: data attribute (set in fixClusterLabels) > SVG ID
        let groupID = cluster.getAttribute('data-cluster-id');
        
        if (!groupID) {
             const rawId = cluster.getAttribute('id') || "";
             groupID = rawId.replace('cluster-', '');
        }

        if (groupID) {
            cluster.addEventListener('mouseenter', () => {
                // Try to find an icon class from any nested element (optional enhancement)
                const iconClass = cluster.querySelector('i')?.className;
                showTaskyHelp(`docs.diagram.cluster.${groupID}`, iconClass);
            });
            cluster.addEventListener('mouseleave', hideTaskyHelp);
        }
    });

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

/**
 * Initialize svg-pan-zoom on the rendered SVG
 */
function initPanZoom() {
    const svgElement = document.querySelector('#mermaid-diagram-container svg');
    if (!svgElement) return;

    // Remove fixed attributes and styles set by Mermaid to allow pan-zoom control
    svgElement.removeAttribute('width');
    svgElement.removeAttribute('height');
    svgElement.style.maxWidth = 'none';
    svgElement.style.width = '100%';
    svgElement.style.height = '100%';

    // Clear existing
    if (panZoomInstance) panZoomInstance.destroy();

    panZoomInstance = svgPanZoom(svgElement, {
        zoomEnabled: true,
        controlIconsEnabled: false,
        fit: true,
        center: true,
        minZoom: 0.05,
        maxZoom: 20,
        zoomScaleSensitivity: 0.4
    });

    // Force fit after a short delay to handle container transition
    setTimeout(() => {
        if (panZoomInstance) {
            panZoomInstance.resize();
            panZoomInstance.fit();
            panZoomInstance.center();
        }
    }, 50);
}

/**
 * Reset zoom and pan
 */
function resetZoom() {
    if (panZoomInstance) {
        panZoomInstance.reset();
        panZoomInstance.fit();
        panZoomInstance.center();
    }
}

/**
 * Apply a glow effect to a specific node with retry logic for async rendering
 */
function applyNodeHighlight(nodeId: string, retryCount = 0) {
    const container = document.getElementById('mermaid-diagram-container');
    if (!container) return;

    // 1. Try to find by specific node class (to avoid matching links/arrows)
    // We check for exact IDs, data-ids, and prefixed/suffixed Mermaid node patterns
    let svgNode: HTMLElement | null = 
                  container.querySelector(`.node[id="${nodeId}"]`) ||
                  container.querySelector(`.node[data-id="${nodeId}"]`) ||
                  container.querySelector(`.node[id*="-${nodeId}-"]`) || 
                  container.querySelector(`.node[id$="-${nodeId}"]`) ||
                  container.querySelector(`.mermaid-node[id*="${nodeId}"]`) ||
                  container.querySelector(`#${nodeId}`); // Generic ID fallback if no node class found
    
    // 1b. Last resort: any ID that looks like it belongs to our node
    if (!svgNode) {
        svgNode = container.querySelector(`[id*="-${nodeId}-"]:not(.edgePath):not(.link)`) || 
                  container.querySelector(`[id$="-${nodeId}"]:not(.edgePath):not(.link)`);
    }
    
    // 2. Fallback: Search by text content inside node labels
    if (!svgNode) {
        const allNodes = Array.from(container.querySelectorAll('.node, .mermaid-node'));
        for (const node of allNodes) {
             // Look for node-content div which we use in our definitions
            const contentDiv = node.querySelector('.node-content');
            if (contentDiv && contentDiv.textContent?.toLowerCase().includes(nodeId.toLowerCase())) {
                svgNode = node as HTMLElement;
                break;
            }
            
            // Generic label search
            const label = node.querySelector('.nodeLabel, .label');
            if (label && label.textContent?.toLowerCase().includes(nodeId.toLowerCase())) {
                svgNode = node as HTMLElement;
                break;
            }
        }
    }

    if (svgNode) {
        console.log(`[Docs] Highlighting node: ${nodeId}`);
        // Remove existing highlights
        container.querySelectorAll('.node-highlight-glow').forEach(el => el.classList.remove('node-highlight-glow'));
        
        // Apply highlight classes
        svgNode.classList.add('node-highlight-glow');
        
        // Ensure parent groups don't clip the filter (critical for SVG filters)
        let pNode = svgNode.parentElement;
        while (pNode && pNode.tagName !== 'svg') {
            (pNode as any).style.overflow = 'visible';
            pNode = pNode.parentElement;
        }


        // Show Tasky help
        const diagram = diagrams[currentDiagramID];
        if (diagram) {
            // Try to extract clean nodeId from the actual element ID if possible
            const parts = svgNode.id.split('-');
            const actualId = parts.length > 2 ? parts[parts.length-2] : nodeId;
            showTaskyHelp(diagram.explanationPrefix + actualId, svgNode.querySelector('i')?.className);
        }
    } else if (retryCount < 3) {
        // Retry logic: Mermaid rendering can be slow or multi-stage
        const delays = [200, 600, 1200];
        console.log(`[Docs] Highlighting node ${nodeId} retry ${retryCount + 1}...`);
        setTimeout(() => applyNodeHighlight(nodeId, retryCount + 1), delays[retryCount]);
    } else {
        console.warn(`[Docs] Node highlight failed after retries: ${nodeId}`);
    }
}

// Inject Enhanced Glow CSS
const dgStyle = document.createElement('style');
dgStyle.textContent = `
    .node-highlight-glow rect, 
    .node-highlight-glow polygon, 
    .node-highlight-glow circle, 
    .node-highlight-glow ellipse,
    .node-highlight-glow path {
        stroke: var(--accent) !important;
        stroke-width: 4px !important;
        filter: drop-shadow(0 0 6px var(--accent)) !important;
        animation: node-glow-pulse 1.5s infinite alternate ease-in-out !important;
        paint-order: markers stroke fill !important;
    }
    
    @keyframes node-glow-pulse {
        0% { 
            filter: drop-shadow(0 0 4px var(--accent)); 
            stroke-width: 3px;
            opacity: 0.85;
        }
        100% { 
            filter: drop-shadow(0 0 12px var(--accent)); 
            stroke-width: 5px;
            opacity: 1;
        }
    }
    
    /* Ensure the highlight isn't clipped by the SVG container */
    #mermaid-diagram-container svg { overflow: visible !important; }
`;
document.head.appendChild(dgStyle);


// Auto-init on load if not module
window.openDiagram = openDiagram;
window.openDocs = openDiagram;
window.initInteractiveDocs = initInteractiveDocs;
window.showTaskyHelp = showTaskyHelp;
window.hideTaskyHelp = hideTaskyHelp;
window.openHelpTo = openHelpTo;

// If imported as module, we need to export
export default { initInteractiveDocs, openDiagram, showTaskyHelp, hideTaskyHelp, openHelpTo };
