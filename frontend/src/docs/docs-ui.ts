import { t, getLang, getSynonyms } from '../core/i18n.js';
import { diagrams, openDiagram } from './interactive-docs.js';
import { invoke } from '../core/api.js';

interface DiagramIndexItem {
    text: string;
    diagramId: string;
    nodeId: string;
    diagramTitle: string;
    weight: number; // 1.0=title, 0.8=main node, 0.6=secondary, 0.4=edge
}

let diagramSearchIndex: DiagramIndexItem[] = [];

/** Active synonym lookup map — rebuilt on each lang change */
let SYNONYM_MAP = new Map<string, string[]>();

/** Rebuild the synonym lookup map from the current lang JSON files */
function rebuildSynonymMap(): void {
    SYNONYM_MAP = new Map<string, string[]>();
    const groups = getSynonyms(); // from all loaded lang files
    for (const [canonical, syns] of Object.entries(groups)) {
        const all = Array.from(new Set([canonical, ...syns].map(normStr)));
        for (const word of all) {
            if (!SYNONYM_MAP.has(word)) SYNONYM_MAP.set(word, []);
            const existing = SYNONYM_MAP.get(word)!;
            all.forEach(w => { if (!existing.includes(w)) existing.push(w); });
        }
    }
    console.log(`[Docs] Synonym map rebuilt: ${SYNONYM_MAP.size} entries.`);
}

function normStr(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function expandWord(word: string): string[] {
    const n = normStr(word);
    const syns = SYNONYM_MAP.get(n);
    return syns ? Array.from(new Set([n, ...syns])) : [n];
}

/** Levenshtein distance, capped at 3 for performance */
function levenshtein(a: string, b: string): number {
    if (Math.abs(a.length - b.length) > 3) return 4;
    const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[a.length][b.length];
}

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────
export function initDocsUI() {
    const dgStyle = document.createElement('style');
    dgStyle.textContent = `
        .docs-tab-content .glass-card, 
        .docs-tab-content details.faq-accordion {
            transition: opacity 0.3s ease, transform 0.3s ease, display 0.3s allow-discrete;
        }
        .diagram-reco-item:active { transform: scale(0.98); }
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
            0% { filter: drop-shadow(0 0 4px var(--accent)); stroke-width: 3px; opacity: 0.85; }
            100% { filter: drop-shadow(0 0 12px var(--accent)); stroke-width: 5px; opacity: 1; }
        }
        #mermaid-diagram-container svg { overflow: visible !important; }
        .docs-search-no-results {
            padding: 16px; text-align: center; color: var(--text-muted);
            font-size: 12px; display: flex; flex-direction: column;
            align-items: center; gap: 8px;
        }
        .docs-search-no-results svg { opacity: 0.4; }
    `;
    document.head.appendChild(dgStyle);

    setupTabs();
    setupVideoPlayers();
    buildDiagramIndex();
    setupSearch();
    initQuickLinks();

    window.addEventListener('online', setupVideoPlayers);
    window.addEventListener('offline', setupVideoPlayers);
    document.addEventListener('langChanged', () => {
        setupVideoPlayers();
        buildDiagramIndex(); // rebuildSynonymMap() is called inside
    });
}

// ─────────────────────────────────────────────────────────────
// Quick-link cards (app.cfg controlled)
// ─────────────────────────────────────────────────────────────
async function initQuickLinks() {
    const card1 = document.getElementById('quicklink-card-1');
    const card2 = document.getElementById('quicklink-card-2');
    const strip = document.getElementById('quicklinks-strip');
    if (!card1 && !card2) return;

    try {
        const cfg: { card1_disabled: boolean; card2_disabled: boolean } =
            await invoke('get_quicklinks_config');

        let anyVisible = false;
        if (!cfg.card1_disabled && card1) {
            card1.style.display = 'flex';
            anyVisible = true;
        }
        if (!cfg.card2_disabled && card2) {
            card2.style.display = 'flex';
            anyVisible = true;
        }
        if (!anyVisible && strip) strip.style.display = 'none';
    } catch {
        // If command fails (e.g. dev/browser env), show both by default
        if (card1) card1.style.display = 'flex';
        if (card2) card2.style.display = 'flex';
    }
}

// ─────────────────────────────────────────────────────────────
// Index building — weighted by content type
// ─────────────────────────────────────────────────────────────
function buildDiagramIndex() {
    // Always rebuild synonym map before indexing (syncs with current lang files)
    rebuildSynonymMap();
    diagramSearchIndex = [];
    console.log('[Docs] Building diagram search index...');

    for (const [id, diagram] of Object.entries(diagrams)) {
        const title = t(diagram.titleKey);

        // Weight 1.0 — Diagram title
        if (title && title !== diagram.titleKey) {
            diagramSearchIndex.push({ text: title, diagramId: id, nodeId: '', diagramTitle: title, weight: 1.0 });
        }

        // Weight 0.8 — Main nodes from definition HTML labels
        const nodeRegex = /([A-Z0-9_]+)\[['"]?<div[^>]*>.*?\{\{([a-zA-Z0-9._-]+)\}\}.*?<\/div>['"]?\]/g;
        let match;
        const processedNodes = new Map<string, string>();

        while ((match = nodeRegex.exec(diagram.definition)) !== null) {
            const nodeId = match[1];
            const labelKey = match[2];
            const label = t(labelKey);
            const descKey = diagram.explanationPrefix ? diagram.explanationPrefix + nodeId + '.desc' : null;
            const desc = descKey ? t(descKey) : '';

            if (label && label !== labelKey) {
                diagramSearchIndex.push({
                    text: `${label} ${desc}`.trim(),
                    diagramId: id, nodeId, diagramTitle: title, weight: 0.8
                });
                processedNodes.set(nodeId, label);
            }
        }

        // Weight 0.6 — Secondary nodes via explanationPrefix
        if (diagram.explanationPrefix) {
            const allPossibleNodeIds = Array.from(
                diagram.definition.matchAll(/([A-Z0-9_]+)(?:\[|\{|\|)/g)
            ).map(m => m[1]);
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
                        diagramId: id, nodeId, diagramTitle: title, weight: 0.6
                    });
                }
            });
        }

        // Weight 0.4 — Edge labels
        const edgeRegex = /--\s*"([^"]+)"\s*-->/g;
        let edgeMatch;
        while ((edgeMatch = edgeRegex.exec(diagram.definition)) !== null) {
            const raw = edgeMatch[1];
            const translated = raw.includes('{{')
                ? raw.replace(/\{\{([a-zA-Z0-9._-]+)\}\}/g, (_, k) => t(k))
                : raw;
            if (translated && translated.length > 2) {
                diagramSearchIndex.push({
                    text: translated, diagramId: id, nodeId: '',
                    diagramTitle: title, weight: 0.4
                });
            }
        }
    }

    console.log(`[Docs] Index built: ${diagramSearchIndex.length} items.`);
}

// ─────────────────────────────────────────────────────────────
// Tab management
// ─────────────────────────────────────────────────────────────
function setupTabs() {
    const tabBtns = document.querySelectorAll('.btn-docs-tab');
    const tabContents = document.querySelectorAll('.docs-tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement;
            const tabId = target.getAttribute('data-tab');

            tabBtns.forEach(b => {
                b.classList.remove('active');
            });

            target.classList.add('active');

            tabContents.forEach(content => {
                const c = content as HTMLElement;
                c.style.display = (c.id === `docs-tab-${tabId}`) ? 'block' : 'none';
            });
        });
    });
}

// ─────────────────────────────────────────────────────────────
// Video players
// ─────────────────────────────────────────────────────────────
function setupVideoPlayers() {
    const isOnline = navigator.onLine;
    const player1 = document.getElementById('docs-video-player-1');
    const player2 = document.getElementById('docs-video-player-2');
    if (!player1 || !player2) return;

    const vid1Online = t('docs.videos.tuto1.online');
    const vid1Offline = t('docs.videos.tuto1.offline');
    const vid2Online = t('docs.videos.tuto2.online');
    const vid2Offline = t('docs.videos.tuto2.offline');

    const renderPlayer = (container: HTMLElement, onlineUrl: string, offlineUrl: string) => {
        if (isOnline && onlineUrl && onlineUrl.includes('youtube.com')) {
            container.innerHTML = `<iframe width="100%" height="100%" src="${onlineUrl}?rel=0" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="position:absolute; inset:0;"></iframe>`;
        } else {
            container.innerHTML = `<video src="${offlineUrl}" controls style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;"></video>`;
        }
    };

    renderPlayer(player1, vid1Online, vid1Offline);
    renderPlayer(player2, vid2Online, vid2Offline);
}

// ─────────────────────────────────────────────────────────────
// Search setup + debounce
// ─────────────────────────────────────────────────────────────
let _searchDebounce: number | null = null;

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
            } else {
                p.classList.remove('active');
            }
        });

        const event = new Event('input');
        searchInput.dispatchEvent(event);
    });

    searchInput.addEventListener('input', (e) => {
        if (_searchDebounce) clearTimeout(_searchDebounce);
        _searchDebounce = window.setTimeout(() => {
            _runSearch(
                (e.target as HTMLInputElement).value.toLowerCase().trim(),
                searchMode, diagResultsContainer!, diagResultsList!
            );
        }, 150);
    });
}

function _runSearch(
    query: string,
    searchMode: string,
    diagResultsContainer: HTMLElement,
    diagResultsList: HTMLElement
) {
    if (query.length === 0) {
        diagResultsContainer.style.display = 'none';
        diagResultsList.innerHTML = '';
    }

    if (query.length > 0) {
        document.querySelectorAll('.docs-tab-content').forEach(el => (el as HTMLElement).style.display = 'block');
        const nav = document.querySelector('.docs-tabs-nav') as HTMLElement;
        if (nav) nav.style.opacity = '0.5';
    } else {
        const activeTabBtn = document.querySelector('.btn-docs-tab.active') as HTMLElement;
        if (activeTabBtn) activeTabBtn.click();
        const nav = document.querySelector('.docs-tabs-nav') as HTMLElement;
        if (nav) nav.style.opacity = '1';
    }

    // 1. Filter Glass Cards
    document.querySelectorAll('.docs-tab-content .glass-card:not(.faq-accordion)').forEach(card => {
        animateVisibility(card as HTMLElement, checkMatch(card.textContent?.toLowerCase() || '', query, searchMode));
    });

    // 2. Filter FAQ Accordions
    document.querySelectorAll('.docs-tab-content details.faq-accordion:not(.glass-card)').forEach(faq => {
        const match = checkMatch(faq.textContent?.toLowerCase() || '', query, searchMode);
        if (query !== '' && match) (faq as HTMLDetailsElement).open = true;
        else if (query === '') (faq as HTMLDetailsElement).open = false;
        animateVisibility(faq as HTMLElement, match);
    });

    // 3. Filter Diagram Gallery Buttons
    document.querySelectorAll('.docs-gallery-grid button, .docs-tab-content .glass-card button').forEach(btn => {
        if (btn.getAttribute('onclick')?.includes('openDiagram')) {
            const match = checkMatch(btn.textContent?.toLowerCase() || '', query, searchMode);
            (btn as HTMLElement).style.display = match !== false || query === '' ? 'inline-flex' : 'none';
            (btn as HTMLElement).style.opacity = match !== false || query === '' ? '1' : '0';
        }
    });

    // 4. Advanced Diagram Content Search
    if (query.length > 2) {
        const scoredMatches = diagramSearchIndex
            .map(item => {
                const raw = checkMatch(item.text, query, searchMode);
                if (raw === false) return null;
                return { ...item, score: (typeof raw === 'number' ? raw : 1) * item.weight };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

        // Deduplicate: best score per diagram+node
        const dedupMap = new Map<string, typeof scoredMatches[0]>();
        scoredMatches.forEach(item => {
            const key = `${item.diagramId}::${item.nodeId}`;
            const existing = dedupMap.get(key);
            if (!existing || item.score > existing.score) dedupMap.set(key, item);
        });

        const finalMatches = Array.from(dedupMap.values()).sort((a, b) => b.score - a.score).slice(0, 10);

        if (finalMatches.length > 0) {
            diagResultsContainer.style.display = 'block';
            diagResultsList.innerHTML = '';
            const isSemantic = searchMode === 'semantic';

            finalMatches.forEach(match => {
                const el = document.createElement('button');
                el.className = 'diagram-reco-chip';
                const scorePercent = Math.min(100, Math.round(match.score * 100));
                const badgeColor = scorePercent > 85 ? '#22c55e' : (scorePercent > 65 ? 'var(--accent)' : '#f59e0b');
                const contextDot = match.weight >= 1.0 ? '◆' : match.weight >= 0.8 ? '●' : match.weight >= 0.6 ? '○' : '›';
                const truncText = match.text.length > 52 ? match.text.substring(0, 52) + '…' : match.text;
                const truncDiagram = match.diagramTitle.length > 24 ? match.diagramTitle.substring(0, 24) + '…' : match.diagramTitle;

                el.innerHTML = `
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;opacity:0.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                    <span class="diagram-reco-text">${truncText}</span>
                    <span class="diagram-reco-diagram">${truncDiagram}</span>
                    <span class="diagram-reco-ctx">${contextDot}</span>
                    ${isSemantic ? `<span class="diagram-reco-score" style="background:${badgeColor}">${scorePercent}%</span>` : ''}
                `;
                el.addEventListener('click', () => {
                    (openDiagram as any)(match.diagramId, match.nodeId || undefined);
                });
                diagResultsList.appendChild(el);
            });
        } else {
            diagResultsContainer.style.display = 'block';
            diagResultsList.innerHTML = `
                <div class="docs-search-no-results">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        <line x1="8" y1="11" x2="14" y2="11"/>
                    </svg>
                    <span>${t('docs.search.noResults') || 'No diagrams found.'}</span>
                    ${searchMode === 'classic' ? `<span style="font-size:10px;color:var(--accent);cursor:pointer;" onclick="document.getElementById('btn-toggle-search-mode').click()">${t('docs.search.trySemantic') || 'Try Semantic →'}</span>` : ''}
                </div>
            `;
        }
    } else {
        diagResultsContainer.style.display = 'none';
    }
}

// ─────────────────────────────────────────────────────────────
// Core match engine
// ─────────────────────────────────────────────────────────────
function checkMatch(text: string, query: string, mode: string): boolean | number {
    if (query === '') return true;

    const normText = normStr(text);
    const normQuery = normStr(query);

    if (normText === normQuery) return 1.0;
    if (normText.startsWith(normQuery)) return 0.95;

    if (mode === 'classic') {
        if (normText.indexOf(normQuery) === -1) return false;
        const coverage = normQuery.length / normText.length;
        return 0.7 + (coverage * 0.2);
    } else {
        // Semantic: word-level with synonym expansion + fuzzy
        const queryWords = normQuery.split(/\s+/).filter(w => w.length > 2);
        if (queryWords.length === 0) return normText.includes(normQuery) ? 0.6 : false;

        const textWords = normText.split(/\s+/);
        let matchCount = 0;
        let weightedScore = 0;

        queryWords.forEach(qWord => {
            const expansions = expandWord(qWord);
            let bestScore = 0;

            for (const exp of expansions) {
                if (normText.includes(exp)) {
                    const isExact = new RegExp(`\\b${exp}\\b`, 'i').test(normText);
                    bestScore = Math.max(bestScore, isExact ? 1.0 : 0.75);
                }
                // Light fuzzy match for longer words
                if (bestScore < 0.5 && exp.length >= 5) {
                    for (const tw of textWords) {
                        if (tw.length >= 4) {
                            const dist = levenshtein(exp, tw);
                            if (dist === 1) bestScore = Math.max(bestScore, 0.7);
                            else if (dist === 2) bestScore = Math.max(bestScore, 0.45);
                        }
                    }
                }
            }

            if (bestScore > 0) { matchCount++; weightedScore += bestScore; }
        });

        if (matchCount === 0) return false;

        const wordRatio = matchCount / queryWords.length;
        const avgWeight = weightedScore / queryWords.length;
        const substringBonus = normText.includes(normQuery) ? 0.2 : 0;
        // Adaptive threshold: single words need higher precision
        const threshold = queryWords.length === 1 ? 0.45 : 0.32;
        const finalScore = (wordRatio * 0.35) + (avgWeight * 0.45) + substringBonus;
        return finalScore >= threshold ? finalScore : false;
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
