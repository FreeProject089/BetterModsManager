export const serverMode = {
    titleKey: 'docs.diagram.server.title',
    definition: `
graph LR
    subgraph CLIENT ["<div class='group-label' data-cluster-id='CLIENT'><i class='icon-user'></i> {{docs.diagram.cluster.CLIENT}}</div>"]
        REQ["<div class='node-content'><i class='icon-cloud'></i> {{docs.diagram.server.node.REQ}}</div>"]
    end
    subgraph SERVER ["<div class='group-label' data-cluster-id='SERVER'><i class='icon-flow'></i> {{docs.diagram.cluster.SERVER}}</div>"]
        AUTH["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.server.node.AUTH}}</div>"]
        STREAM["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.server.node.STREAM}}</div>"]
    end
    subgraph DATA ["<div class='group-label' data-cluster-id='REPOSITORY'><i class='icon-disk'></i> {{docs.diagram.cluster.REPOSITORY}}</div>"]
        MODS["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.server.node.MODS}}</div>"]
        META["<div class='node-content'><i class='icon-code'></i> {{docs.diagram.server.node.META}}</div>"]
    end
    REQ["<div class='node-content'><i class='icon-cloud'></i> {{docs.diagram.server.node.REQ}}</div>"] -- "<span class='label-info' data-key='request'>{{docs.diagram.label.request}}</span>" --> AUTH["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.server.node.AUTH}}</div>"]
    AUTH -- "<span class='label-success' data-key='verified'>{{docs.diagram.label.verified}}</span>" --> STREAM["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.server.node.STREAM}}</div>"]
    STREAM -- "<span class='label-info' data-key='data'>{{docs.diagram.label.data}}</span>" --> MODS["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.server.node.MODS}}</div>"]
    STREAM -- "<span class='label-info' data-key='meta'>{{docs.diagram.label.meta}}</span>" --> META["<div class='node-content'><i class='icon-code'></i> {{docs.diagram.server.node.META}}</div>"]

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#3b82f6,stroke-width:2px;
    linkStyle 3 stroke:#3b82f6,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.server.node.'
};
//# sourceMappingURL=server-mode.js.map