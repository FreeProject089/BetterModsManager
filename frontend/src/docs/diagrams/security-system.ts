export const securitySystem = {
    titleKey: 'docs.security',
    explanationPrefix: 'docs.diagram.security.node.',
    definition: `
    flowchart TD
        subgraph CL_USER ["{{docs.diagram.cluster.USER}}"]
            START["<div class='node-content'><i class='icon-toggle'></i> {{docs.diagram.security.node.START}}</div>"]
        end

        subgraph CL_CORE ["{{docs.diagram.cluster.CORE}}"]
            MODE_FULL["<div class='node-content'><i class='icon-unlock'></i> {{docs.diagram.security.node.MODE_FULL}}</div>"]
            MODE_LIM["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.security.node.MODE_LIM}}</div>"]
            RUST["<div class='node-content'><i class='icon-cpu'></i> {{docs.diagram.security.node.RUST}}</div>"]
        end

        subgraph CL_UI ["{{docs.diagram.cluster.UI}}"]
            JS["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.security.node.JS}}</div>"]
            SCOPE["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.security.node.SCOPE}}</div>"]
        end

        subgraph CL_STORAGE ["{{docs.diagram.cluster.STORAGE}}"]
            DISK["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.security.node.DISK}}</div>"]
        end

        START -- "<span class='label-info'>{{docs.diagram.edge.security.choice}}</span>" --> MODE_FULL
        START -- "<span class='label-info'>{{docs.diagram.edge.security.choice}}</span>" --> MODE_LIM

        MODE_FULL -- "<span class='label-success'>{{docs.diagram.edge.security.totalAccess}}</span>" --> JS
        MODE_LIM -- "<span class='label-purple'>{{docs.diagram.edge.security.restriction}}</span>" --> SCOPE

        JS -- "<span class='label-info'>{{docs.diagram.edge.security.JS_SCOPE}}</span>" --> SCOPE
        SCOPE -- "<span class='label-success'>{{docs.diagram.edge.security.SCOPE_DISK}}</span>" --> DISK

        RUST -- "<span class='label-purple'>{{docs.diagram.edge.security.RUST_DISK}}</span>" --> DISK
        MODE_FULL -. "{{docs.diagram.edge.security.config}}" .-> RUST
        MODE_LIM -. "{{docs.diagram.edge.security.config}}" .-> RUST

        RUST -. "{{docs.diagram.edge.security.whitelistUpdate}}" .-> SCOPE

        %% Styles — same translucent-accent palette as the other diagrams
        classDef user fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
        classDef core fill:#f59e0b1A,stroke:#f59e0b,color:#f59e0b;
        classDef ui fill:#a855f71A,stroke:#a855f7,color:#a855f7;
        classDef storage fill:#10b9811A,stroke:#10b981,color:#10b981;

        class START user;
        class MODE_FULL,MODE_LIM,RUST core;
        class JS,SCOPE ui;
        class DISK storage;
    `
};
