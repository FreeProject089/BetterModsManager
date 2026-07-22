// Offline mode — how BMM detects real connectivity and pauses online features.
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
    EVENT --> GATES["requireOnline() / safeFetch()"]
    GATES --> PAUSED["Online features paused (toast)"]

    OFFLINE --> FAST["Re-probe every 15 s"]
    FAST --> PROBE
    ONLINE --> SLOW["Re-check every 120 s"]
    SLOW --> PROBE

    style OFFLINE fill:#ef4444,stroke:#fff,stroke-width:2px,color:#fff
    style ONLINE fill:#22c55e,stroke:#fff,stroke-width:2px,color:#fff
    style GATES fill:#6366f1,stroke:#fff,stroke-width:2px,color:#fff
    `
};
