export const dockerDeployment = {
    titleKey: 'docs.diagram.dockerDeployment.title',
    explanationPrefix: 'docs.diagram.dockerDeployment.',
    definition: `
graph TD
    subgraph HOST["Machine hote (Windows / Linux / macOS)"]
        CMD["docker compose up -d"]
        DC["Docker Engine"]
        subgraph CONTAINER["Conteneur BMM Server"]
            APP["BMM Server :8080"]
            DATA["Volume ./data"]
            APP --- DATA
        end
        CMD --> DC
        DC --> CONTAINER
        NGROK["ngrok Agent"]
    end

    subgraph CLOUD["ngrok Cloud"]
        TUNNEL["Tunnel HTTPS - abc123.ngrok-free.app"]
    end

    subgraph CLIENTS["Clients BMM"]
        C1["Client 1"]
        C2["Client 2"]
        C3["Client 3"]
    end

    APP -->|"port 8080"| NGROK
    NGROK -->|"TLS tunnel"| TUNNEL
    C1 -->|"HTTPS"| TUNNEL
    C2 -->|"HTTPS"| TUNNEL
    C3 -->|"HTTPS"| TUNNEL

    style HOST fill:#0d1117,stroke:#06b6d4,stroke-width:2px,color:#e6edf3
    style CONTAINER fill:#0a1628,stroke:#22d3ee,stroke-width:1.5px,color:#e6edf3
    style CLOUD fill:#0a1220,stroke:#3b82f6,stroke-width:2px,color:#e6edf3
    style CLIENTS fill:#0a1220,stroke:#22c55e,stroke-width:2px,color:#e6edf3
    style APP fill:#06b6d4,stroke:#fff,stroke-width:2px,color:#fff
    style NGROK fill:#6366f1,stroke:#fff,stroke-width:2px,color:#fff
    style TUNNEL fill:#3b82f6,stroke:#fff,stroke-width:2px,color:#fff
    style CMD fill:#1e293b,stroke:#475569,stroke-width:1px,color:#94a3b8
    style DATA fill:#134e4a,stroke:#10b981,stroke-width:1px,color:#d1fae5
    style C1 fill:#14532d,stroke:#22c55e,stroke-width:1px,color:#d1fae5
    style C2 fill:#14532d,stroke:#22c55e,stroke-width:1px,color:#d1fae5
    style C3 fill:#14532d,stroke:#22c55e,stroke-width:1px,color:#d1fae5
    `
};
