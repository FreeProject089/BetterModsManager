// Where a bmm:// link goes.
//
// The routes named here were extracted from the router itself
// (frontend/src/core/deep_link_manager.ts) rather than from the documentation, and the two
// were diffed: 46 routes in code, every one documented. The three groups below are the
// distinction that actually matters to somebody writing a link — some act immediately, some
// open a screen and wait for a human, and one is a bridge onto the local HTTP API.
export const deeplinks = {
    titleKey: 'docs.diagram.deeplinks.title',
    definition: `
flowchart TD
    LINK["<div class='node-content'><i class='icon-link'></i> {{docs.diagram.deeplinks.node.LINK}}</div>"]
    OS["<div class='node-content'><i class='icon-window'></i> {{docs.diagram.deeplinks.node.OS}}</div>"]
    ROUTER["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.deeplinks.node.ROUTER}}</div>"]

    subgraph ACTS ["Acts straight away"]
        DIRECT["<div class='node-content'><i class='icon-bolt'></i> {{docs.diagram.deeplinks.node.DIRECT}}</div>"]
    end

    subgraph ASKS ["Opens a screen and waits"]
        UI["<div class='node-content'><i class='icon-window'></i> {{docs.diagram.deeplinks.node.UI}}</div>"]
    end

    subgraph BRIDGE ["Onto the local API"]
        APIL["<div class='node-content'><i class='icon-code'></i> {{docs.diagram.deeplinks.node.APIL}}</div>"]
        TOKEN["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.deeplinks.node.TOKEN}}</div>"]
    end

    TOAST["<div class='node-content'><i class='icon-bell'></i> {{docs.diagram.deeplinks.node.TOAST}}</div>"]

    LINK --> OS
    OS -->|"single instance"| ROUTER
    ROUTER --> DIRECT
    ROUTER --> UI
    ROUTER --> APIL
    APIL --> TOKEN
    DIRECT --> TOAST
    UI --> TOAST
    TOKEN --> TOAST

    %% Styles
    classDef entry fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef core fill:#f59e0b1A,stroke:#f59e0b,color:#f59e0b;
    classDef out fill:#10b9811A,stroke:#10b981,color:#10b981;
    classDef guard fill:#ef44441A,stroke:#ef4444,color:#ef4444;

    class LINK,OS entry;
    class ROUTER,APIL core;
    class DIRECT,UI,TOAST out;
    class TOKEN guard;
`,
    explanationPrefix: 'docs.diagram.deeplinks.node.'
};
