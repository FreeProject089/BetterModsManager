export const appUpdate = {
    titleKey: 'docs.diagram.update.title',
    definition: `
graph TD
    subgraph CHECK ["<div class='group-label' data-cluster-id='SYNC'><i class='icon-cloud'></i> {{docs.diagram.cluster.SYNC}}</div>"]
        CONN["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.update.node.CONN}}</div>"]
        VER_COMP{"<div class='node-content'><i class='icon-search'></i> {{docs.diagram.update.node.VER_COMP}}</div>"}
    end
    CONN --> VER_COMP
    VER_COMP -- "<span class='label-error' data-key='no'>{{docs.diagram.label.no}}</span>" --> F["<div class='node-content'><i class='icon-done'></i> {{docs.diagram.update.node.UP_TO_DATE}}</div>"]
    VER_COMP -- "<span class='label-success' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> MAN_CHK{"<div class='node-content'><i class='icon-search'></i> {{docs.diagram.update.node.MAN_CHK}}</div>"}

    subgraph INCREMENTAL ["<div class='group-label' data-cluster-id='DATA'><i class='icon-download'></i> {{docs.diagram.cluster.DATA}}</div>"]
        GET_MAN["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.update.node.GET_MAN}}</div>"]
        SHA_CHK{"<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.update.node.SHA_CHK}}</div>"}
        SKIP["<div class='node-content'><i class='icon-done'></i> {{docs.diagram.update.node.SKIP}}</div>"]
        DL_FILE["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.update.node.DL_FILE}}</div>"]
        HASH_VAL["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.update.node.HASH_VAL}}</div>"]
        ATOMIC["<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.update.node.ATOMIC}}</div>"]
    end

    subgraph FULL_INST ["<div class='group-label' data-cluster-id='FIX'><i class='icon-build'></i> {{docs.diagram.cluster.FIX}}</div>"]
        GET_BIN["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.update.node.GET_BIN}}</div>"]
        SWAP["<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.update.node.SWAP}}</div>"]
    end

    MAN_CHK -- "<span class='label-success' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> GET_MAN
    MAN_CHK -- "<span class='label-error' data-key='no'>{{docs.diagram.label.no}}</span>" --> GET_BIN
    GET_MAN --> SHA_CHK
    SHA_CHK -- "<span class='label-success' data-key='match'>{{docs.diagram.label.match}}</span>" --> SKIP
    SHA_CHK -- "<span class='label-error' data-key='changed'>{{docs.diagram.label.changed}}</span>" --> DL_FILE
    DL_FILE --> HASH_VAL
    HASH_VAL --> ATOMIC
    GET_BIN --> SWAP

    ATOMIC --> RESTART["<div class='node-content'><i class='icon-start'></i> {{docs.diagram.update.node.RESTART}}</div>"]
    SKIP -.-> RESTART
    SWAP --> RESTART

    %% Edge Styles
    linkStyle 0 stroke:#475569,stroke-width:2px;
    linkStyle 1 stroke:#ef4444,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#ef4444,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
    linkStyle 6 stroke:#10b981,stroke-width:2px;
    linkStyle 7 stroke:#10b981,stroke-width:2px;
    linkStyle 8 stroke:#10b981,stroke-width:2px;
    linkStyle 9 stroke:#10b981,stroke-width:2px;
    linkStyle 10 stroke:#ef4444,stroke-width:2px;
    linkStyle 11 stroke:#10b981,stroke-width:2px;
    linkStyle 12 stroke:#475569,stroke-width:1.5px,stroke-dasharray:4;
    linkStyle 13 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.update.node.'
};
