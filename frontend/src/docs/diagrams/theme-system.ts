import type { DiagramSpec } from '../diagram-spec.js';

// Themes as they work today: a theme is JSON (vars + optional CSS, fonts, assets, element
// overrides, HTML swaps). It comes from the bundled built-ins or drop-in presets, from the
// installed folder <app data>/themes/<id>/, from the catalogue or a .bmmtheme file
// (commands/themes.rs), or from the editor (features/themes/theme-editor.ts). applyTheme
// (theme-engine.ts) only writes <style> blocks over the --bmm-* tokens of css/tokens.css, then
// patches hardcoded inline colours and, on light themes, enforces contrast.
export const themeSystem: DiagramSpec = {
    id: 'theme-system',
    i18n: 'docs.diagram.theme-system',
    category: 'internals',
    dir: 'TB',
    article: 'theme-system',
    related: ['code-stack', 'app-catalog', 'one-click-install', 'i18n-system'],
    groups: [
        { id: 'SOURCES', dir: 'LR' },
        { id: 'EDIT', dir: 'LR' },
        { id: 'ENGINE' },
    ],
    nodes: [
        { id: 'BUILTIN', kind: 'data', group: 'SOURCES', icon: 'icon-package', refs: ['src-tauri/src/commands/themes.rs › list_builtin_themes', 'src-tauri/src/commands/themes.rs › set_builtin_hidden', 'scripts/check-theme-count.mjs'] },
        { id: 'INSTALLED', kind: 'data', group: 'SOURCES', icon: 'icon-folder', refs: ['src-tauri/src/commands/themes.rs › install_theme', 'src-tauri/src/commands/themes.rs › list_installed_themes'] },
        { id: 'CATALOG', kind: 'ui', group: 'SOURCES', icon: 'icon-cloud', refs: ['frontend/src/features/themes/theme-catalog.ts › fetchCatalog', 'src-tauri/src/commands/themes.rs › fetch_theme_catalogs'] },
        { id: 'FILE', kind: 'data', group: 'SOURCES', icon: 'icon-archive', link: 'one-click-install', refs: ['src-tauri/src/commands/themes.rs › import_theme', 'src-tauri/src/commands/themes.rs › export_theme', 'frontend/src/features/themes/theme-editor.ts › shareTheme'] },

        { id: 'EDITOR', kind: 'ui', group: 'EDIT', icon: 'icon-edit', refs: ['frontend/src/features/themes/theme-editor.ts › openEditor', 'frontend/src/features/themes/theme-editor.ts › saveThemeAs'] },
        { id: 'GEN', kind: 'front', group: 'EDIT', icon: 'icon-star', refs: ['frontend/src/features/themes/theme-editor.ts › genPalette'] },
        { id: 'PICK', kind: 'ui', group: 'EDIT', icon: 'icon-search', refs: ['frontend/src/features/themes/theme-editor.ts › togglePickToken', 'frontend/src/features/themes/theme-editor.ts › openElementOverrideEditor'] },

        { id: 'BOOT', kind: 'front', group: 'ENGINE', icon: 'icon-start', refs: ['frontend/src/features/themes/theme-engine.ts › restoreThemeAtBoot', 'frontend/src/features/themes/theme-engine.ts › activateTheme'] },
        { id: 'APPLY', kind: 'front', group: 'ENGINE', icon: 'icon-layers', refs: ['frontend/src/features/themes/theme-engine.ts › applyTheme', 'frontend/src/features/themes/theme-engine.ts › buildVarsCSS'] },
        { id: 'TOKENS', kind: 'data', group: 'ENGINE', icon: 'icon-code', refs: ['frontend/css/tokens.css', 'scripts/check-token-collisions.mjs'] },
        { id: 'PATCH', kind: 'front', group: 'ENGINE', icon: 'icon-refresh', refs: ['frontend/src/features/themes/theme-engine.ts › startPatchObserver', 'frontend/src/features/themes/theme-engine.ts › buildPatchCSS'] },
        { id: 'LIGHT', kind: 'decision', group: 'ENGINE', refs: ['frontend/src/features/themes/theme-engine.ts › isLightTheme', 'frontend/src/features/themes/theme-engine.ts › isContrastEnforced'] },
        { id: 'CONTRAST', kind: 'front', group: 'ENGINE', icon: 'icon-scales', refs: ['frontend/src/features/themes/theme-engine.ts › enforceLightContrast', 'frontend/src/features/themes/theme-engine.ts › clearAllEnforced'] },

        { id: 'LIVE', kind: 'outcome', icon: 'icon-check', refs: ['frontend/src/features/themes/theme-engine.ts › applyTheme', 'frontend/src/docs/docs-hub.ts'] },
    ],
    edges: [
        { from: 'BUILTIN', to: 'BOOT', label: 'atStart', thick: true },
        { from: 'INSTALLED', to: 'BOOT', label: 'atStart', thick: true },
        { from: 'CATALOG', to: 'INSTALLED', label: 'install' },
        { from: 'FILE', to: 'INSTALLED', label: 'import' },
        { from: 'BUILTIN', to: 'EDITOR', label: 'startFrom', dashed: true },
        { from: 'GEN', to: 'EDITOR', dashed: true },
        { from: 'PICK', to: 'EDITOR', dashed: true },
        { from: 'EDITOR', to: 'APPLY', label: 'preview', tone: 'info', dashed: true },
        { from: 'EDITOR', to: 'INSTALLED', label: 'save', tone: 'ok' },
        { from: 'BOOT', to: 'APPLY', thick: true },
        { from: 'APPLY', to: 'TOKENS', label: 'overrides', thick: true },
        { from: 'APPLY', to: 'PATCH' },
        { from: 'APPLY', to: 'LIGHT' },
        { from: 'LIGHT', to: 'CONTRAST', label: '~yes', tone: 'warn' },
        { from: 'TOKENS', to: 'LIVE', thick: true },
        { from: 'PATCH', to: 'LIVE' },
        { from: 'CONTRAST', to: 'LIVE' },
    ],
};
