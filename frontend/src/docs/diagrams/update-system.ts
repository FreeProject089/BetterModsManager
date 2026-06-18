export const updateSystem = {
    titleKey: 'docs.diagram.updateSystem.title',
    definition: `
flowchart TD
    subgraph SRC ["Sources"]
        REPO["<div class='node-content'><i class='icon-cloud'></i> {{docs.diagram.updateSystem.node.REPO}}</div>"]
        DIRECT["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.updateSystem.node.DIRECT}}</div>"]
    end

    CHECK["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.updateSystem.node.CHECK}}</div>"]
    FETCH["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.updateSystem.node.FETCH}}</div>"]
    COMPARE["<div class='node-content'><i class='icon-layout'></i> {{docs.diagram.updateSystem.node.COMPARE}}</div>"]

    subgraph MOD ["Mod content update"]
        DETECT["<div class='node-content'><i class='icon-bolt'></i> {{docs.diagram.updateSystem.node.DETECT}}</div>"]
        REDL["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.updateSystem.node.REDL}}</div>"]
    end

    subgraph APP ["BMM self-update"]
        MANIFEST["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.updateSystem.node.MANIFEST}}</div>"]
        VERIFY["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.updateSystem.node.VERIFY}}</div>"]
    end

    APPLY["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.updateSystem.node.APPLY}}</div>"]

    REPO --> CHECK
    DIRECT --> CHECK
    CHECK --> FETCH
    FETCH --> COMPARE
    COMPARE -->|"differs (version / sha256 / BLAKE3)"| DETECT
    DETECT --> REDL
    REDL --> APPLY
    REDL -.-> CHECK
    MANIFEST --> VERIFY
    VERIFY -->|"HTTPS + per-file sha256"| APPLY

    %% Styles
    classDef src fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef core fill:#f59e0b1A,stroke:#f59e0b,color:#f59e0b;
    classDef out fill:#10b9811A,stroke:#10b981,color:#10b981;

    class REPO,DIRECT,MANIFEST src;
    class CHECK,FETCH,COMPARE,VERIFY core;
    class DETECT,REDL,APPLY out;
`,
    explanationPrefix: 'docs.diagram.updateSystem.node.'
};
