// Build the live destination catalog for funnel/journey/goal dropdowns. Prefers
// the auto-reported `stats.catalog` (the client enumerates its own pages, tabs,
// modals, diagrams and guides), unioned with what's actually been observed, and
// finally the static seeds below as a last-resort fallback. So nothing here needs
// hand-maintaining — new app destinations show up automatically.
export function buildCatalog(s: any) {
  const c = (s && s.catalog) || {};
  const uniq = (arr: any[]) => Array.from(new Set(arr.filter((x: any) => x != null && x !== ""))).sort() as string[];
  return {
    pages: uniq([...(c.pages || []), ...((s?.pages || []).map((p: any) => p.view)), ...ALL_PAGES]),
    modals: uniq([...(c.modals || []), ...(s?.modals_all || []), ...((s?.modals || []).map((m: any) => m.k)), ...ALL_MODALS]),
    diagrams: uniq([...(c.diagrams || []), ...ALL_DIAGRAMS]),
    tabs: uniq([...(c.tabs || [])]),
    guides: uniq([...(c.guides || [])]),
    events: uniq([...((s?.events || []).map((e: any) => e.event))]),
    features: uniq([...((s?.features || []).map((f: any) => f.k))]),
  };
}

export const ALL_PAGES = [
  "apps",
  "credits",
  "docs",
  "docs/basique",
  "docs/advanced",
  "docs/faq",
  "docs/plugins-api",
  "help",
  "help/feedback",
  "help/documentation",
  "help/about",
  "help/other",
  "library",
  "mapper",
  "modlist",
  "modpacks",
  "plugins",
  "plugins/catalogue",
  "plugins/installed",
  "profiles",
  "repo",
  "settings"
];

export const ALL_MODALS = [
  "apps-detail-modal", "apps-install-modal", "cr-app-modal",
  "export-progress-overlay", "ptb-welcome-modal", "update-available-modal",
  "modal-add-mod", "modal-advanced-perf-overlay", "modal-app-picker",
  "modal-archive-explorer", "modal-betahub-bugreport", "modal-betahub-feedback",
  "modal-chk-sha-lazy", "modal-conflict-file-selector", "modal-conflict-tree",
  "modal-conflict-warning", "modal-confirm-generic", "modal-contributor-detail",
  "modal-crash-report", "modal-delete-mod", "modal-delete-profile",
  "modal-docs-diagram", "modal-duplicate-folder-warning", "modal-edit-profile",
  "modal-global-conflicts", "modal-history", "modal-history-detail",
  "modal-i18n-sandbox", "modal-integrity", "modal-lang-select",
  "modal-launchpack", "modal-launchpack-delete", "modal-license",
  "modal-mapper-confirm", "modal-mapper-input", "modal-mod-tags",
  "modal-monitoring", "modal-new-profile", "modal-privacy",
  "modal-repo-browser", "modal-repo-history", "modal-repo-hub",
  "modal-repo-sync-summary", "modal-repo-update", "modal-repo-verify-detail",
  "modal-scheduler", "modal-security-choice", "modal-stack",
  "modal-storage", "modal-tos", "modal-update-notes", "modal-whitelist", "modal-bans",
  "modal-activation-warning",
  "theme-catalogue", "theme-editor", "benchmark", "interactive-tutorial"
];

export const ALL_DIAGRAMS = [
  "app-update", "backup-system", "best-practices", "betahub-reporting",
  "blake3-hashing", "cache-management", "code-stack", "conflict-management",
  "crash-reporting", "dedicated-hosting", "discord-rpc", "disk-io-limiter",
  "docker-deployment", "docs-logic", "engine-threads", "faq-deleted-mod",
  "faq-disk-full", "hosting-flow", "integrity-engine", "launch-packs",
  "lightweight-architecture", "mod-activation", "mod-architecture",
  "mod-mapper", "mod-sync", "mod-updates", "modding-mechanics",
  "modpack-flow", "resumable-downloads", "scheduler", "server-mode",
  "update-system"
];
