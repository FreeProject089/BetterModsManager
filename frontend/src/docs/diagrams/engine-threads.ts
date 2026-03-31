export const engineThreads = {
    titleKey: 'docs.diagram.engineThreads.title',
    definition: `
flowchart LR
    subgraph FRONTEND ["FRONTEND (Javascript)"]
        UI["<div class='node-content'><i class='icon-layout'></i> {{docs.diagram.engineThreads.node.UI}}</div>"]
        BRIDGE_JS["<div class='node-content'><i class='icon-message'></i> {{docs.diagram.engineThreads.node.BRIDGE_JS}}</div>"]
    end
    
    subgraph BACKEND ["BACKEND (Rust)"]
        CORE["<div class='node-content'><i class='icon-command'></i> {{docs.diagram.engineThreads.node.CORE}}</div>"]
        TOKIO["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.engineThreads.node.TOKIO}}</div>"]
        
        subgraph WORKERS ["Worker Pool (I/O)"]
            FS["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.engineThreads.node.FS}}</div>"]
            NET["<div class='node-content'><i class='icon-globe'></i> {{docs.diagram.engineThreads.node.NET}}</div>"]
        end
    end
    
    UI --> BRIDGE_JS
    BRIDGE_JS --> CORE
    CORE --> TOKIO
    TOKIO -- Spawn --> FS
    TOKIO -- Spawn --> NET
    
    FS -- Done --> CORE
    NET -- Done --> CORE
    CORE -- Success --> BRIDGE_JS
    BRIDGE_JS -- Render --> UI
    
    %% Styles
    classDef ui fill:#f59e0b0D,stroke:#f59e0b,color:#f59e0b;
    classDef rust fill:#3b82f60D,stroke:#3b82f6,color:#3b82f6;
    classDef worker fill:#22c55e1A,stroke:#22c55e,color:#22c55e,stroke-dasharray: 4;
    
    class UI,BRIDGE_JS ui;
    class CORE,TOKIO rust;
    class FS,NET worker;
`,
    explanationPrefix: 'docs.diagram.engineThreads.node.'
};
