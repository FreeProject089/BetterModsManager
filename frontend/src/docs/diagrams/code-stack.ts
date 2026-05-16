export const codeStack = {
    titleKey: 'docs.diagram.codeStack.title',
    definition: `
flowchart TD
    subgraph FRONTEND ["FRONTEND LAYER"]
        UI["<div class='node-content'><i class='icon-layout'></i> {{docs.diagram.codeStack.node.UI}}</div>"]
        TS["<div class='node-content'><i class='icon-code'></i> {{docs.diagram.codeStack.node.TS}}</div>"]
        TSC["<div class='node-content'><i class='icon-command'></i> {{docs.diagram.codeStack.node.TSC}}</div>"]
        BRIDGE["<div class='node-content'><i class='icon-message'></i> {{docs.diagram.codeStack.node.BRIDGE}}</div>"]
    end
    
    subgraph BACKEND ["BACKEND LAYER (Rust)"]
        CORE["<div class='node-content'><i class='icon-build'></i> {{docs.diagram.codeStack.node.CORE}}</div>"]
        TOKIO["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.codeStack.node.TOKIO}}</div>"]
        WARP["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.codeStack.node.WARP}}</div>"]
        REQWEST["<div class='node-content'><i class='icon-globe'></i> {{docs.diagram.codeStack.node.REQWEST}}</div>"]
    end
    
    subgraph STORAGE ["DATA LAYER"]
        SQLITE["<div class='node-content'><i class='icon-database'></i> {{docs.diagram.codeStack.node.SQLITE}}</div>"]
        FS["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.codeStack.node.FS}}</div>"]
    end
    
    UI --> TS
    TS --> TSC
    TSC --> BRIDGE
    BRIDGE -- IPC --> CORE
    CORE --> TOKIO
    TOKIO -- Async I/O --> FS
    TOKIO -- HTTP --> WARP
    TOKIO -- Client --> REQWEST
    CORE --> SQLITE
    
    %% Styles
    classDef frontend fill:#f59e0b1A,stroke:#f59e0b,color:#f59e0b;
    classDef backend fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef storage fill:#22c55e1A,stroke:#22c55e,color:#22c55e;
    
    class UI,TS,TSC,BRIDGE frontend;
    class CORE,TOKIO,WARP,REQWEST backend;
    class SQLITE,FS storage;
`,
    explanationPrefix: 'docs.diagram.codeStack.node.'
};
