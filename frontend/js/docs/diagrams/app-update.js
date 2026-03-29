export const appUpdate = {
    titleKey: 'docs.diagram.update.title',
    definition: `
graph TD
    subgraph CHECK ["<div class='group-label' data-cluster-id='SYNC'><i class='icon-cloud'></i> {{docs.diagram.cluster.SYNC}}</div>"]
        CONN["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.update.node.CONN}}</div>"]
        VER_COMP{"<div class='node-content'><i class='icon-search'></i> {{docs.diagram.update.node.VER_COMP}}</div>"}
    end
    subgraph DOWNLOAD ["<div class='group-label' data-cluster-id='DATA'><i class='icon-download'></i> {{docs.diagram.cluster.DATA}}</div>"]
        GET_BIN["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.update.node.GET_BIN}}</div>"]
        HASH_VAL["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.update.node.HASH_VAL}}</div>"]
    end
    subgraph INSTALL ["<div class='group-label' data-cluster-id='FIX'><i class='icon-build'></i> {{docs.diagram.cluster.FIX}}</div>"]
        SWAP["<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.update.node.SWAP}}</div>"]
        RESTART["<div class='node-content'><i class='icon-start'></i> {{docs.diagram.update.node.RESTART}}</div>"]
    end
    CONN["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.update.node.CONN}}</div>"] --> VER_COMP{"<div class='node-content'><i class='icon-search'></i> {{docs.diagram.update.node.VER_COMP}}</div>"}
    VER_COMP -- "<span class='label-error' data-key='no'>{{docs.diagram.label.no}}</span>" --> F["<div class='node-content'><i class='icon-done'></i> {{docs.diagram.update.node.UP_TO_DATE}}</div>"]
    VER_COMP -- "<span class='label-success' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> GET_BIN["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.update.node.GET_BIN}}</div>"]
    GET_BIN -- "<span class='label-success' data-key='success'>{{docs.diagram.label.success}}</span>" --> HASH_VAL["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.update.node.HASH_VAL}}</div>"]
    HASH_VAL -- "<span class='label-success' data-key='match'>{{docs.diagram.label.match}}</span>" --> SWAP["<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.update.node.SWAP}}</div>"]
    SWAP -- "<span class='label-success' data-key='done'>{{docs.diagram.label.done}}</span>" --> RESTART["<div class='node-content'><i class='icon-start'></i> {{docs.diagram.update.node.RESTART}}</div>"]

    %% Edge Styles
    linkStyle 0 stroke:#475569,stroke-width:2px;
    linkStyle 1 stroke:#ef4444,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#10b981,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.update.node.'
};
//# sourceMappingURL=app-update.js.map