// How a custom page runs — the sandbox, drawn from the code that enforces it.
//
// Every claim in this diagram is checkable against src-tauri/src/commands/custom_pages.rs:
// the bmmpage:// protocol handler, the CSP it emits, the grants it consults, the per-page
// storage, and the confinement (a `..` refusal plus a canonicalised starts_with check).
export const customPages = {
    titleKey: 'docs.diagram.customPages.title',
    definition: `
flowchart TD
    NAV["<div class='node-content'><i class='icon-nav'></i> {{docs.diagram.customPages.node.NAV}}</div>"]
    FRAME["<div class='node-content'><i class='icon-window'></i> {{docs.diagram.customPages.node.FRAME}}</div>"]

    subgraph BUNDLE ["The bundle (one folder)"]
        INDEX["<div class='node-content'><i class='icon-file'></i> {{docs.diagram.customPages.node.INDEX}}</div>"]
        SUBS["<div class='node-content'><i class='icon-files'></i> {{docs.diagram.customPages.node.SUBS}}</div>"]
        ASSETS["<div class='node-content'><i class='icon-box'></i> {{docs.diagram.customPages.node.ASSETS}}</div>"]
        SDK["<div class='node-content'><i class='icon-code'></i> {{docs.diagram.customPages.node.SDK}}</div>"]
    end

    PROTO["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.customPages.node.PROTO}}</div>"]
    CSP["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.customPages.node.CSP}}</div>"]

    subgraph GRANTS ["Only what was granted"]
        STORE["<div class='node-content'><i class='icon-database'></i> {{docs.diagram.customPages.node.STORE}}</div>"]
        NET["<div class='node-content'><i class='icon-globe'></i> {{docs.diagram.customPages.node.NET}}</div>"]
        DENY["<div class='node-content'><i class='icon-ban'></i> {{docs.diagram.customPages.node.DENY}}</div>"]
    end

    NAV --> FRAME
    FRAME -->|"bmmpage://&lt;id&gt;/index.html"| PROTO
    PROTO --> INDEX
    INDEX -->|"&lt;a href='about.html'&gt;"| SUBS
    SUBS --> PROTO
    INDEX --> ASSETS
    INDEX --> SDK
    PROTO --> CSP
    CSP --> SDK
    SDK --> STORE
    SDK --> NET
    CSP --> DENY

    %% Styles
    classDef host fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef files fill:#f59e0b1A,stroke:#f59e0b,color:#f59e0b;
    classDef guard fill:#ef44441A,stroke:#ef4444,color:#ef4444;
    classDef ok fill:#10b9811A,stroke:#10b981,color:#10b981;

    class NAV,FRAME host;
    class INDEX,SUBS,ASSETS,SDK files;
    class PROTO,CSP,DENY guard;
    class STORE,NET ok;
`,
    explanationPrefix: 'docs.diagram.customPages.node.'
};
