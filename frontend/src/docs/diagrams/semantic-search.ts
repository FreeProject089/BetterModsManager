import type { DiagramSpec } from '../diagram-spec.js';

// The three search boxes and what "semantic" really means in each, as the code runs today.
// There is no embedding and no vector anywhere: Semantic mode is query expansion through the
// `_synonyms` groups of the language files (core/i18n.ts getSynonyms). The Ctrl+K palette ranks
// every provider with core/search.ts (tiered scorer); the docs hub box counts matched terms
// (docs-hub.ts scoreHay). « Ask Laya » and the library's smart toggle are a separate path: a BM25
// index in Rust (commands/ask_core.rs) that Laya may re-rank when the embedded model is allowed.
export const semanticSearch: DiagramSpec = {
    id: 'semantic-search',
    i18n: 'docs.diagram.semantic-search',
    category: 'internals',
    dir: 'TB',
    article: 'semantic-search',
    related: ['laya-pipeline', 'i18n-system', 'mcp-server'],
    groups: [
        { id: 'BOXES', dir: 'LR' },
        { id: 'EXPAND' },
        { id: 'RANK' },
        { id: 'ASK' },
    ],
    nodes: [
        { id: 'PALETTE', kind: 'ui', group: 'BOXES', icon: 'icon-command', refs: ['frontend/src/core/commands.ts › openCommandPalette', 'frontend/src/core/commands.ts › pMode'] },
        { id: 'DOCS_BOX', kind: 'ui', group: 'BOXES', icon: 'icon-search', refs: ['frontend/src/docs/docs-hub.ts › searchView'] },
        { id: 'LIB_BOX', kind: 'ui', group: 'BOXES', icon: 'icon-list', refs: ['frontend/src/features/ai/ai-ask.ts › mountSmartSearch', 'frontend/src/features/ai/ai-smart-state.ts › smartRank'] },

        { id: 'MODE', kind: 'decision', group: 'EXPAND', refs: ['frontend/src/core/commands.ts › expand', 'frontend/src/docs/docs-hub.ts › expandTerms'] },
        { id: 'SYNONYMS', kind: 'data', group: 'EXPAND', icon: 'icon-text', refs: ['frontend/src/core/i18n.ts › getSynonyms', 'frontend/Lang/en.json › _synonyms'] },

        { id: 'PROVIDERS', kind: 'front', group: 'RANK', icon: 'icon-blocks', refs: ['frontend/src/core/search.ts › registerSearchProvider', 'frontend/src/core/search.ts › searchAll'] },
        { id: 'SCORER', kind: 'front', group: 'RANK', icon: 'icon-chart', refs: ['frontend/src/core/search.ts › scoreTerm', 'frontend/src/core/search.ts › scoreHit', 'frontend/src/core/search.ts › rank'] },
        { id: 'COUNT', kind: 'front', group: 'RANK', icon: 'icon-list', refs: ['frontend/src/docs/docs-hub.ts › scoreHay'] },

        { id: 'ASK_UI', kind: 'ui', group: 'ASK', icon: 'icon-message', refs: ['frontend/src/features/ai/ai-ask.ts › openAskLaya', 'src-tauri/src/commands/ai.rs › ai_ask'] },
        { id: 'BM25', kind: 'rust', group: 'ASK', icon: 'icon-database', refs: ['src-tauri/src/commands/ask_core.rs › Index', 'src-tauri/src/commands/ask_core.rs › intent_rules', 'src-tauri/src/commands/ask_index.gen.json'] },
        { id: 'RERANK', kind: 'rust', group: 'ASK', icon: 'icon-brain', link: 'laya-pipeline', refs: ['src-tauri/src/commands/ask_core.rs › usable_model', 'src-tauri/src/commands/ask_core.rs › RERANK_K'] },

        { id: 'RESULTS', kind: 'outcome', icon: 'icon-check', refs: ['frontend/src/features/ai/ai-ask.ts › runAskAction', 'src-tauri/src/commands/ask_core.rs › answer_tuned'] },
    ],
    edges: [
        { from: 'PALETTE', to: 'MODE', thick: true },
        { from: 'DOCS_BOX', to: 'MODE' },
        { from: 'MODE', to: 'SYNONYMS', label: 'semantic', tone: 'info' },
        { from: 'SYNONYMS', to: 'PROVIDERS', label: 'commandsOnly', tone: 'warn' },
        { from: 'SYNONYMS', to: 'COUNT', label: 'docsHub', tone: 'info' },
        { from: 'MODE', to: 'PROVIDERS', label: 'classic', thick: true },
        { from: 'PROVIDERS', to: 'SCORER', thick: true },
        { from: 'SCORER', to: 'RESULTS', thick: true },
        { from: 'COUNT', to: 'RESULTS' },

        { from: 'PROVIDERS', to: 'ASK_UI', label: 'question', dashed: true },
        { from: 'DOCS_BOX', to: 'ASK_UI', label: 'askButton', dashed: true },
        { from: 'LIB_BOX', to: 'BM25', label: 'smartOn', tone: 'info' },
        { from: 'ASK_UI', to: 'BM25', label: '~invoke', thick: true },
        { from: 'BM25', to: 'RERANK', label: 'layaAllowed', tone: 'ok', dashed: true },
        { from: 'BM25', to: 'RESULTS', label: 'retrievalOnly', tone: 'warn' },
        { from: 'RERANK', to: 'RESULTS', thick: true },
    ],
};
