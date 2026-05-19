export const modActivation = {
    titleKey: 'docs.diagram.modact.title',
    definition: `
graph TD
    subgraph ENABLE_G ["<div class='group-label' data-cluster-id='ACTIVATE'><i class='icon-check'></i> {{docs.diagram.cluster.ACTIVATE}}</div>"]
        ENABLE["<div class='node-content'><i class='icon-plus'></i> {{docs.diagram.modact.node.ENABLE}}</div>"]
        CHECK_OWNER["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.modact.node.CHECK_OWNER}}</div>"]
        BACKUP["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.modact.node.BACKUP}}</div>"]
        COPY["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.modact.node.COPY}}</div>"]
        DONE_ON["<div class='node-content'><i class='icon-play'></i> {{docs.diagram.modact.node.DONE_ON}}</div>"]
    end

    subgraph DISABLE_G ["<div class='group-label' data-cluster-id='DEACTIVATE'><i class='icon-x'></i> {{docs.diagram.cluster.DEACTIVATE}}</div>"]
        DISABLE["<div class='node-content'><i class='icon-minus'></i> {{docs.diagram.modact.node.DISABLE}}</div>"]
        FIND_SURVIVOR["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.modact.node.FIND_SURVIVOR}}</div>"]
        HAS_SURVIVOR{"{{docs.diagram.modact.node.HAS_SURVIVOR}}"}
        HAS_ORIGINAL{"{{docs.diagram.modact.node.HAS_ORIGINAL}}"}
        RESTORE_MOD["<div class='node-content'><i class='icon-build'></i> {{docs.diagram.modact.node.RESTORE_MOD}}</div>"]
        RESTORE_ORIG["<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.modact.node.RESTORE_ORIG}}</div>"]
        DELETE["<div class='node-content'><i class='icon-trash'></i> {{docs.diagram.modact.node.DELETE}}</div>"]
        DONE_OFF["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.modact.node.DONE_OFF}}</div>"]
    end

    ENABLE -- "<span class='label-info'>{{docs.diagram.label.perFile}}</span>" --> CHECK_OWNER
    CHECK_OWNER -- "<span class='label-success'>{{docs.diagram.label.free}}</span>" --> BACKUP
    CHECK_OWNER -- "<span class='label-warning'>{{docs.diagram.label.alreadyOwned}}</span>" --> COPY
    BACKUP --> COPY
    COPY -- "<span class='label-success'>{{docs.diagram.label.done}}</span>" --> DONE_ON

    DISABLE -- "<span class='label-info'>{{docs.diagram.label.perFile}}</span>" --> FIND_SURVIVOR
    FIND_SURVIVOR --> HAS_SURVIVOR
    HAS_SURVIVOR -- "<span class='label-success'>{{docs.diagram.label.yes}}</span>" --> RESTORE_MOD
    HAS_SURVIVOR -- "<span class='label-warning'>{{docs.diagram.label.no}}</span>" --> HAS_ORIGINAL
    HAS_ORIGINAL -- "<span class='label-success'>{{docs.diagram.label.yes}}</span>" --> RESTORE_ORIG
    HAS_ORIGINAL -- "<span class='label-danger'>{{docs.diagram.label.no}}</span>" --> DELETE
    RESTORE_MOD --> DONE_OFF
    RESTORE_ORIG --> DONE_OFF
    DELETE --> DONE_OFF

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#f59e0b,stroke-width:2px;
    linkStyle 3 stroke:#6b7280,stroke-width:1.5px;
    linkStyle 4 stroke:#10b981,stroke-width:2px;
    linkStyle 5 stroke:#3b82f6,stroke-width:2px;
    linkStyle 6 stroke:#6b7280,stroke-width:1.5px;
    linkStyle 7 stroke:#10b981,stroke-width:2px;
    linkStyle 8 stroke:#f59e0b,stroke-width:2px;
    linkStyle 9 stroke:#10b981,stroke-width:2px;
    linkStyle 10 stroke:#ef4444,stroke-width:2px;
    linkStyle 11 stroke:#10b981,stroke-width:2px;
    linkStyle 12 stroke:#10b981,stroke-width:2px;
    linkStyle 13 stroke:#ef4444,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.modact.node.'
};
