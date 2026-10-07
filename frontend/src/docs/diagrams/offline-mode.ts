// Offline mode — how BMM detects real connectivity, and what being offline changes: a banner.
//
// It used to end in "requireOnline() / safeFetch() → online features paused", two helpers of
// core/offline.ts that no feature ever called (they were removed). Network features are NOT
// gated: one started while offline runs and reports its own network error. That is on purpose:
// a repo on the LAN, or the local API, works with no internet at all, and a gate keyed on
// reaching gstatic/Cloudflare would have blocked them. Same picture as BMM Docs,
// features/privacy-telemetry.md § Offline mode.
export const offlineMode = {
    titleKey: 'docs.diagram.offlineMode.title',
    explanationPrefix: 'docs.diagram.offlineMode.node.',
    definition: `
graph TD
    NAVIGATOR["navigator.onLine + events"] --> PROBE{Probe 2 endpoints}
    PROBE -- "any responds" --> ONLINE[Online]
    PROBE -- "both fail" --> OFFLINE[Offline state]

    OFFLINE --> BANNER["'No connection' banner"]
    OFFLINE --> EVENT["bmm-connectivity event"]
    BANNER --> NOTLOCK["A notice, not a lock:<br/>network features still run"]
    NOTLOCK --> OWNERR["Offline, they fail<br/>with their own error"]

    OFFLINE --> FAST["Re-probe every 15 s"]
    FAST --> PROBE
    ONLINE --> SLOW["Re-check every 120 s"]
    SLOW --> PROBE

    style OFFLINE fill:#ef4444,stroke:#fff,stroke-width:2px,color:#fff
    style ONLINE fill:#22c55e,stroke:#fff,stroke-width:2px,color:#fff
    style NOTLOCK fill:#6366f1,stroke:#fff,stroke-width:2px,color:#fff
    `
};
