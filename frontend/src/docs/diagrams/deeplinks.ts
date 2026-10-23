import type { DiagramSpec } from '../diagram-spec.js';

// Where a bmm:// link goes. main.rs claims the scheme and hands the URL to the running window
// (single instance) or keeps it until the window asks (cold start). Every link then passes ONE
// gate before anything happens (core/deeplink-guard.ts admitLink): hard limits refused
// whatever the answer, then an in-app dialog (Cancel by default) for anything that changes
// state, skipped only for the app's own trusted callers (scheduler, local API) that come in
// through core/link-dispatch.ts. The routes are the if-chain of core/deep_link_manager.ts;
// scripts/deeplink-map.mjs derives the route table (frontend/deeplinks.json) from it.
export const deeplinks: DiagramSpec = {
    id: 'deeplinks',
    i18n: 'docs.diagram.deeplinks',
    category: 'sharing',
    dir: 'TB',
    article: 'links-and-updates',
    related: ['app-catalog', 'security-system', 'scheduler', 'mcp-server'],
    groups: [
        { id: 'ENTRY', dir: 'LR' },
        { id: 'GATE' },
        { id: 'ROUTES', dir: 'LR' },
    ],
    nodes: [
        { id: 'LINK', kind: 'outcome', group: 'ENTRY', icon: 'icon-link', refs: ['scripts/deeplink-map.mjs › parseDeeplinks', 'frontend/deeplinks.json'] },
        { id: 'OS', kind: 'rust', group: 'ENTRY', icon: 'icon-app', refs: ['src-tauri/src/main.rs › register_bmm_protocol', 'src-tauri/src/main.rs › PENDING_DEEP_LINK', 'src-tauri/src/main.rs › get_pending_deep_link'] },
        { id: 'TRUSTED', kind: 'front', group: 'ENTRY', icon: 'icon-key', refs: ['frontend/src/core/link-dispatch.ts › trustedLinkDispatcher', 'frontend/src/features/settings/scheduler.ts', 'frontend/src/core/api_activity.ts'] },

        { id: 'HANDLER', kind: 'front', group: 'GATE', icon: 'icon-flow', refs: ['frontend/src/core/deep_link_manager.ts › initDeepLinks', 'frontend/src/core/deep_link_manager.ts › handleDeepLink', 'frontend/src/core/deeplink-guard.ts › windowOrigin'] },
        { id: 'LIMITS', kind: 'decision', group: 'GATE', icon: 'icon-shield', refs: ['frontend/src/core/deeplink-guard.ts › decideLink', 'frontend/src/core/deeplink-guard.ts › linkPathRefusal', 'frontend/src/core/deeplink-guard.ts › linkHttpsRefusal'] },
        { id: 'REFUSED', kind: 'outcome', group: 'GATE', icon: 'icon-x', refs: ['frontend/src/core/deep_link_manager.ts › GATE_UI'] },
        { id: 'ASK', kind: 'decision', group: 'GATE', icon: 'icon-help', refs: ['frontend/src/core/deeplink-guard.ts › admitLink', 'frontend/src/core/deeplink-guard.ts › PROMPT_FREE', 'frontend/src/core/deep_link_manager.ts › GATE_UI'] },

        { id: 'ACT', kind: 'front', group: 'ROUTES', icon: 'icon-bolt', refs: ['frontend/src/core/deep_link_manager.ts › handleDeepLink'] },
        { id: 'SCREEN', kind: 'ui', group: 'ROUTES', icon: 'icon-layout', refs: ['frontend/src/core/deep_link_manager.ts › handleDeepLink', 'frontend/src/features/repo/repo.ts › initRepo'] },
        { id: 'LINKCMD', kind: 'rust', group: 'ROUTES', icon: 'icon-lock', link: 'app-catalog', refs: ['src-tauri/src/commands/link_guard.rs › link_install_app', 'src-tauri/src/commands/link_guard.rs › link_launch_app', 'src-tauri/src/commands/link_guard.rs › link_export_app_data'] },
        { id: 'API', kind: 'front', group: 'ROUTES', icon: 'icon-code', link: 'mcp-server', refs: ['frontend/src/core/deep_link_manager.ts › getApiToken', 'frontend/src/core/api.ts › apiBase'] },

        { id: 'RESULT', kind: 'outcome', icon: 'icon-message', refs: ['frontend/src/core/deeplink-guard.ts › linkForLog'] },
    ],
    edges: [
        { from: 'LINK', to: 'OS', thick: true },
        { from: 'OS', to: 'HANDLER', label: 'external', thick: true },
        { from: 'TRUSTED', to: 'HANDLER', label: 'trusted', tone: 'info' },
        { from: 'HANDLER', to: 'LIMITS', thick: true },
        { from: 'HANDLER', to: 'REFUSED', label: 'switchedOff', tone: 'danger', dashed: true },
        { from: 'LIMITS', to: 'REFUSED', label: '~refused', tone: 'danger' },
        { from: 'LIMITS', to: 'ASK', label: '~ok', tone: 'ok', thick: true },
        { from: 'ASK', to: 'REFUSED', label: '~cancel', tone: 'warn' },
        { from: 'ASK', to: 'ACT', label: 'allowed', tone: 'ok', thick: true },
        { from: 'ASK', to: 'SCREEN', label: 'ownDialog', tone: 'info' },
        { from: 'ASK', to: 'API', label: 'allowed', tone: 'ok' },
        { from: 'ACT', to: 'LINKCMD', label: 'restricted', tone: 'info', dashed: true },
        { from: 'ACT', to: 'RESULT', thick: true },
        { from: 'SCREEN', to: 'RESULT' },
        { from: 'LINKCMD', to: 'RESULT' },
        { from: 'API', to: 'RESULT' },
    ],
};
