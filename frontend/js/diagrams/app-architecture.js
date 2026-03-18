export const appArchitecture = {
    titleKey: 'docs.diagram.arch.title',
    definition: `
graph LR
    subgraph UI ["<div class='group-label' data-cluster-id='UI'><i class='icon-user'></i> {{docs.diagram.cluster.UI}}</div>"]
        JS["<div class='node-content'><i class='icon-code'></i> {{docs.diagram.arch.node.JS}}</div>"]
        JS_DEPS["<div class='node-content'><i class='icon-package'></i> {{docs.diagram.arch.node.JS_DEPS}}</div>"]
    end
    subgraph SYSTEM ["<div class='group-label' data-cluster-id='CORE'><i class='icon-flow'></i> {{docs.diagram.cluster.CORE}}</div>"]
        CORE["<div class='node-content'><i class='icon-build'></i> {{docs.diagram.arch.node.CORE}}</div>"]
        RUST_DEPS["<div class='node-content'><i class='icon-package'></i> {{docs.diagram.arch.node.RUST_DEPS}}</div>"]
        FS["<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.arch.node.FS}}</div>"]
        NET["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.arch.node.NET}}</div>"]
    end
    subgraph GAME ["<div class='group-label' data-cluster-id='EXTERNAL'><i class='icon-folder'></i> {{docs.diagram.cluster.EXTERNAL}}</div>"]
        MODS_DIR["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.arch.node.MODS_DIR}}</div>"]
    end

    JS -.-> JS_DEPS
    CORE -.-> RUST_DEPS

    JS["<div class='node-content'><i class='icon-code'></i> {{docs.diagram.arch.node.JS}}</div>"] -- "<span class='label-success' data-key='ipc'>{{docs.diagram.label.ipc}}</span>" --> CORE["<div class='node-content'><i class='icon-build'></i> {{docs.diagram.arch.node.CORE}}</div>"]
    CORE -- "<span class='label-success' data-key='io'>{{docs.diagram.label.io}}</span>" --> FS["<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.arch.node.FS}}</div>"]
    CORE -- "<span class='label-success' data-key='http'>{{docs.diagram.label.http}}</span>" --> NET["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.arch.node.NET}}</div>"]
    FS -- "<span class='label-success' data-key='redirect'>{{docs.diagram.label.redirect}}</span>" --> MODS_DIR["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.arch.node.MODS_DIR}}</div>"]

    %% Edge Styles
    linkStyle 0 stroke:#ffffff33,stroke-width:1px,stroke-dasharray: 4;
    linkStyle 1 stroke:#ffffff33,stroke-width:1px,stroke-dasharray: 4;
    linkStyle 2 stroke:#ef4444,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#10b981,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.arch.node.'
};
