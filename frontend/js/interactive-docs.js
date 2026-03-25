import { t } from './i18n.js';
import { resumableDownloads } from './diagrams/resumable-downloads.js';
import { modSync } from './diagrams/mod-sync.js';
import { profileSystem } from './diagrams/profile-system.js';
import { conflictManagement } from './diagrams/conflict-management.js';
import { appUpdate } from './diagrams/app-update.js';
import { modImport } from './diagrams/mod-import.js';
import { backupSystem } from './diagrams/backup-system.js';
import { appArchitecture } from './diagrams/app-architecture.js';
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

// Diagram Registry
const diagrams = {
    'resumable-downloads': resumableDownloads,
    'mod-sync': modSync,
    'profile-system': profileSystem,
    'conflict-management': conflictManagement,
    'app-update': appUpdate,
    'mod-import': modImport,
    'backup-system': backupSystem,
    'app-architecture': appArchitecture,
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
    'one-click-install': oneClickInstall
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
export async function openDiagram(id) {
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
    taskyText.textContent = "Passez votre souris sur une étape pour que je vous explique !";
    
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
export function showTaskyHelp(key, iconClass = 'info', isLiteral = false) {
    const bubble = document.querySelector('.tasky-speech-bubble');
    const eyes = document.getElementById('tasky-bubble-eyes');
    const explanationEl = document.getElementById('tasky-explanation');
    const taskyContainer = document.getElementById('tasky-bubble-docs');
    
    if (!bubble || !explanationEl || !taskyContainer) return;

    // Show Container if hidden (for non-modal use)
    if (taskyContainer.style.display === 'none') {
        taskyContainer.style.display = 'flex';
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

    // Text content logic
    let exp = key;
    if (!isLiteral) {
        const descKey = key + '.desc';
        const descExp = t(descKey);
        // Priority 1: Use .desc if available. Priority 2: Use regular key if it's translated
        exp = (descExp && descExp !== descKey) ? descExp : t(key);
    }
    
    // Show if we have valid content (or if literal is requested)
    if (exp && (isLiteral || exp !== key)) {
        explanationEl.textContent = exp;
        bubble.classList.add('active');
        
        if (eyes) {
            eyes.className = finalIcon;
            eyes.style.display = 'flex'; // Match CSS flex display
        }
        updateTaskyMascot('Tasky_Happy.png');
    }
}

/**
 * Hide Tasky explanation bubble globally
 */
export function hideTaskyHelp() {
    const bubble = document.querySelector('.tasky-speech-bubble');
    const taskyContainer = document.getElementById('tasky-bubble-docs');
    const modal = document.getElementById('modal-docs-diagram');

    if (bubble) bubble.classList.remove('active');
    updateTaskyMascot('Tasky.png');

    // If modal is NOT active, hide the whole container after a delay
    if (taskyContainer && (!modal || !modal.classList.contains('active'))) {
        taskyContainer.style.opacity = '0';
        setTimeout(() => {
            if (taskyContainer.style.opacity === '0') {
                taskyContainer.style.display = 'none';
            }
        }, 200);
    }
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

// Auto-init on load if not module
window.openDiagram = openDiagram;
window.openDocs = openDiagram;
window.initInteractiveDocs = initInteractiveDocs;
window.showTaskyHelp = showTaskyHelp;
window.hideTaskyHelp = hideTaskyHelp;

// If imported as module, we need to export
export default { initInteractiveDocs, openDiagram, showTaskyHelp, hideTaskyHelp };
