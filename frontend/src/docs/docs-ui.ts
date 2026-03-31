import { t, getLang } from '../core/i18n.js';
import { diagrams, openDiagram } from './interactive-docs.js';

interface DiagramIndexItem {
    text: string;
    diagramId: string;
    nodeId: string;
    diagramTitle: string;
}

let diagramSearchIndex: DiagramIndexItem[] = [];

export function initDocsUI() {
    setupTabs();
    setupVideoPlayers();
    buildDiagramIndex();
    setupSearch();
    
    window.addEventListener('online', setupVideoPlayers);
    window.addEventListener('offline', setupVideoPlayers);
    document.addEventListener('langChanged', setupVideoPlayers);
}

/**
 * Builds a searchable index of all text inside diagrams
 */
function buildDiagramIndex() {
    diagramSearchIndex = [];
    
    for (const [id, diagram] of Object.entries(diagrams)) {
        const title = t(diagram.titleKey);
        
        // Use a more global approach to find all labels and descriptions
        // 1. Process Nodes from definition
        const nodeRegex = /([A-Z0-9_]+)\["?<div[^>]*>.*?\{\{([a-zA-Z0-9._-]+)\}\}.*?<\/div>"?\]/g;
        let match;
        const processedNodes = new Map();

        while ((match = nodeRegex.exec(diagram.definition)) !== null) {
            const nodeId = match[1];
            const labelKey = match[2];
            const label = t(labelKey);
            
            // Look for associated description
            const descKey = diagram.explanationPrefix ? diagram.explanationPrefix + nodeId + '.desc' : null;
            const desc = descKey ? t(descKey) : '';
            
            if (label && label !== labelKey) {
                diagramSearchIndex.push({
                    text: `${label} ${desc}`.trim(),
                    diagramId: id,
                    nodeId: nodeId,
                    diagramTitle: title
                });
                processedNodes.set(nodeId, label);
            }
        }

        // 2. Index remaining Tasky help nodes that might not be in the primary definition regex
        if (diagram.explanationPrefix) {
            const allPossibleNodeIds = Array.from(diagram.definition.matchAll(/([A-Z0-9_]+)(?:\[|\{|\|)/g)).map(m => m[1]);
            const uniqueNodes = Array.from(new Set(allPossibleNodeIds));

            uniqueNodes.forEach(nodeId => {
                if (processedNodes.has(nodeId)) return;

                const expKey = diagram.explanationPrefix + nodeId;
                const expDescKey = expKey + '.desc';
                
                const label = t(expKey) !== expKey ? t(expKey) : nodeId;
                const desc = t(expDescKey) !== expDescKey ? t(expDescKey) : '';
                
                if (desc || (label && label !== nodeId)) {
                    diagramSearchIndex.push({
                        text: `${label} ${desc}`.trim(),
                        diagramId: id,
                        nodeId: nodeId,
                        diagramTitle: title
                    });
                }
            });
        }
    }
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.btn-docs-tab');
    const tabContents = document.querySelectorAll('.docs-tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement;
            const tabId = target.getAttribute('data-tab');

            // Update active state on buttons
            tabBtns.forEach(b => {
                b.classList.remove('active');
                (b as HTMLElement).style.background = 'transparent';
                (b as HTMLElement).style.color = 'var(--text-secondary)';
                (b as HTMLElement).style.border = '1px solid rgba(255,255,255,0.1)';
            });

            target.classList.add('active');
            target.style.background = 'var(--accent)';
            target.style.color = 'white';
            target.style.border = 'none';

            // Show corresponding content, hide others
            tabContents.forEach(content => {
                const c = content as HTMLElement;
                if (c.id === `docs-tab-${tabId}`) {
                    c.style.display = 'block';
                } else {
                    c.style.display = 'none';
                }
            });
        });
    });
}

function setupVideoPlayers() {
    const isOnline = navigator.onLine;
    const player1 = document.getElementById('docs-video-player-1');
    const player2 = document.getElementById('docs-video-player-2');

    if (!player1 || !player2) return;

    // Fetch localized sources
    const vid1Online = t('docs.videos.tuto1.online');
    const vid1Offline = t('docs.videos.tuto1.offline');
    const vid2Online = t('docs.videos.tuto2.online');
    const vid2Offline = t('docs.videos.tuto2.offline');

    const renderPlayer = (container: HTMLElement, onlineUrl: string, offlineUrl: string) => {
        if (isOnline && onlineUrl && onlineUrl.includes('youtube.com')) {
            container.innerHTML = `<iframe width="100%" height="100%" src="${onlineUrl}?rel=0" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="position:absolute; inset:0;"></iframe>`;
        } else {
            // Fallback to local MP4
            container.innerHTML = `<video src="${offlineUrl}" controls style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;"></video>`;
        }
    };

    renderPlayer(player1, vid1Online, vid1Offline);
    renderPlayer(player2, vid2Online, vid2Offline);
}

function setupSearch() {
    const searchInput = document.getElementById('docs-search-input') as HTMLInputElement;
    const modeToggle = document.getElementById('btn-toggle-search-mode');
    const modePills = document.querySelectorAll('.search-mode-pill');
    const diagResultsContainer = document.getElementById('docs-search-results-diagrams');
    const diagResultsList = document.getElementById('docs-diagram-results-list');
    
    let searchMode = 'classic';

    if (!searchInput || !modeToggle || !diagResultsContainer || !diagResultsList) return;

    modeToggle.addEventListener('click', () => {
        searchMode = searchMode === 'classic' ? 'semantic' : 'classic';
        
        modePills.forEach(pill => {
            const p = pill as HTMLElement;
            if (p.getAttribute('data-mode') === searchMode) {
                p.classList.add('active');
                p.style.background = 'var(--accent)';
                p.style.color = 'white';
            } else {
                p.classList.remove('active');
                p.style.background = 'transparent';
                p.style.color = 'var(--text-secondary)';
            }
        });

        const event = new Event('input');
        searchInput.dispatchEvent(event);
    });

    searchInput.addEventListener('input', (e) => {
        const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
        const advancedTabBtn = document.querySelector('.btn-docs-tab[data-tab="advanced"]') as HTMLElement;
        
        if (query.length === 0) {
            diagResultsContainer.style.display = 'none';
            diagResultsList.innerHTML = '';
        }

        if (query.length > 0 && advancedTabBtn && !advancedTabBtn.classList.contains('active')) {
             advancedTabBtn.click();
        }

        // 1. Filter Glass Cards
        const cards = document.querySelectorAll('#docs-tab-advanced .glass-card:not(.faq-accordion)');
        cards.forEach(card => {
            const content = card.textContent?.toLowerCase() || "";
            const match = checkMatch(content, query, searchMode);
            animateVisibility(card as HTMLElement, match);
        });

        // 2. Filter FAQ Accordions
        const faqs = document.querySelectorAll('#docs-tab-advanced details.faq-accordion:not(.glass-card)');
        faqs.forEach(faq => {
            const faqContent = faq.textContent?.toLowerCase() || "";
            const match = checkMatch(faqContent, query, searchMode);
            if (query !== '' && match) (faq as HTMLDetailsElement).open = true;
            else if (query === '') (faq as HTMLDetailsElement).open = false;
            animateVisibility(faq as HTMLElement, match);
        });

        // 3. Filter Diagram Gallery Buttons
        const galleryButtons = document.querySelectorAll('.docs-gallery-grid button, #docs-tab-advanced details.glass-card button');
        galleryButtons.forEach(btn => {
            if (btn.getAttribute('onclick')?.includes('openDiagram')) {
                const btnText = btn.textContent?.toLowerCase() || "";
                const match = checkMatch(btnText, query, searchMode);
                (btn as HTMLElement).style.display = match !== false || query === '' ? 'inline-flex' : 'none';
                (btn as HTMLElement).style.opacity = match !== false || query === '' ? '1' : '0';
            }
        });

        // 4. Advanced Diagram Content Search
        if (query.length > 2) {
            const diagramMatches = diagramSearchIndex
                .map(item => ({ ...item, score: checkMatch(item.text, query, searchMode) }))
                .filter(item => item.score !== false);
            
            if (diagramMatches.length > 0) {
                diagResultsContainer.style.display = 'block';
                diagResultsList.innerHTML = '';
                
                diagramMatches.sort((a, b) => {
                    const scoreA = typeof a.score === 'number' ? a.score : 1;
                    const scoreB = typeof b.score === 'number' ? b.score : 1;
                    return scoreB - scoreA;
                }).slice(0, 10).forEach(match => {
                    const el = document.createElement('div');
                    el.className = 'diagram-reco-item';
                    const scorePercent = Math.round((match.score as number || 1) * 100);
                    
                    el.style.cssText = `
                        padding: 10px 14px;
                        background: rgba(255,255,255,0.05);
                        border: 1px solid ${searchMode === 'semantic' ? 'rgba(188,116,255, 0.3)' : 'rgba(255,255,255,0.1)'};
                        border-radius: 8px;
                        cursor: pointer;
                        transition: all 0.2s;
                        display: flex;
                        flex-direction: column;
                        gap: 4px;
                        position: relative;
                        overflow: hidden;
                    `;
                    
                    const badgeColor = scorePercent > 90 ? 'var(--success)' : (scorePercent > 70 ? 'var(--accent)' : 'var(--warning)');
                    const scoreBadge = (searchMode === 'semantic') 
                        ? `<div style="position:absolute; top:0; right:0; font-size:9x; background:${badgeColor}; color:white; padding:2px 7px; border-bottom-left-radius:8px; font-weight:800; font-family:var(--font-mono); box-shadow: -2px 2px 10px rgba(0,0,0,0.3); z-index:2;">${scorePercent}%</div>` 
                        : '';

                    el.innerHTML = `
                        ${scoreBadge}
                        <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); line-height: 1.2;">${match.text.length > 80 ? match.text.substring(0, 80) + '...' : match.text}</div>
                        <div style="font-size: 10px; color: var(--accent); opacity: 0.9; display: flex; align-items: center; gap: 4px;">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                            ${match.diagramTitle}
                        </div>
                    `;
                    el.addEventListener('mouseenter', () => { el.style.background = 'rgba(255,255,255,0.08)'; el.style.borderColor = 'var(--accent)'; el.style.transform = 'translateX(4px)'; });
                    el.addEventListener('mouseleave', () => { el.style.background = 'rgba(255,255,255,0.05)'; el.style.borderColor = searchMode === 'semantic' ? 'rgba(188,116,255, 0.3)' : 'rgba(255,255,255,0.1)'; el.style.transform = 'translateX(0)'; });
                    el.addEventListener('click', () => {
                        (openDiagram as any)(match.diagramId, match.nodeId);
                    });
                    diagResultsList.appendChild(el);
                });
            } else {
                diagResultsContainer.style.display = 'none';
            }
        } else {
            diagResultsContainer.style.display = 'none';
        }
    });
}

function checkMatch(text: string, query: string, mode: string): boolean | number {
    if (query === '') return true;
    
    const normText = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const normQuery = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 1. Exact or anchored match (Premium)
    if (normText === normQuery) return 1.0;
    if (normText.startsWith(normQuery)) return 0.95;

    if (mode === 'classic') {
        const index = normText.indexOf(normQuery);
        if (index === -1) return false;
        
        // Standard substring match (Scoring based on proximity to start and coverage)
        const coverage = normQuery.length / normText.length;
        return 0.7 + (coverage * 0.2); 
    } else {
        const queryWords = normQuery.split(/\s+/).filter(w => w.length > 1);
        if (queryWords.length === 0) return normText.includes(normQuery) ? 0.7 : false;
        
        const matchingWords = queryWords.filter(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'i');
            return regex.test(normText) || normText.includes(word);
        });

        if (matchingWords.length === 0) return false;

        // Word-based inclusion score
        const wordRatio = matchingWords.length / queryWords.length;
        
        // Bonus for exact multi-word substring
        const exactSubstringBonus = normText.includes(normQuery) ? 0.15 : 0;
        
        const score = Math.min(0.9, (wordRatio * 0.75) + exactSubstringBonus);
        return score >= 0.4 ? score : false;
    }
}

function animateVisibility(el: HTMLElement, match: boolean | number) {
    const isVisible = match !== false;
    if (isVisible) {
        el.style.display = 'block';
        setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; }, 10);
    } else {
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        setTimeout(() => { if (el.style.opacity === '0') el.style.display = 'none'; }, 300);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
        #docs-tab-advanced .glass-card, 
        #docs-tab-advanced details.faq-accordion {
            transition: opacity 0.3s ease, transform 0.3s ease, display 0.3s allow-discrete;
        }
        .diagram-reco-item:active { transform: scale(0.98); }
    `;
    document.head.appendChild(style);
});

