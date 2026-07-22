// Telemetry pipeline — strictly opt-in, buffered locally, GDPR controls end-to-end.
export const telemetryPipeline = {
    titleKey: 'docs.diagram.telemetryPipeline.title',
    explanationPrefix: 'docs.diagram.telemetryPipeline.node.',
    definition: `
graph TD
    CONSENT{Opt-in consent?} -- "declined / not asked" --> NOTHING["Nothing collected"]
    CONSENT -- "accepted" --> EVENTS["Events: pages, clicks, perf, errors"]
    REPLAY["Session replay (masked by default)"] --> EVENTS

    EVENTS --> QUEUE["Local queue (jsonl, 10 MB cap)"]
    QUEUE --> ENDPOINT{Endpoint configured?}
    ENDPOINT -- no --> LOCAL["Stays on disk"]
    ENDPOINT -- yes --> GZIP["Gzip batch + packet id"]
    GZIP --> ALLOWLIST["HTTPS-only allow-list"]
    ALLOWLIST --> SERVER["Telemetry server"]

    GDPR["Export / per-packet deletion (72 h)"] --> SERVER
    GDPR --> QUEUE

    style CONSENT fill:#f97316,stroke:#fff,stroke-width:2px,color:#fff
    style NOTHING fill:#22c55e,stroke:#fff,stroke-width:2px,color:#fff
    style ALLOWLIST fill:#6366f1,stroke:#fff,stroke-width:2px,color:#fff
    `
};
