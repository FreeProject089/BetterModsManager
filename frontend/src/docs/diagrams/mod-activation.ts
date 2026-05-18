export const modActivation = {
    titleKey: 'docs.diagram.modact.title',
    definition: `
graph TD
    subgraph ENABLE_G ["<div class='group-label' data-cluster-id='ACTIVATE'><i class='icon-check'></i> {{docs.diagram.cluster.ACTIVATE}}</div>"]
        EN_START["<div class='node-content'><i class='icon-plus'></i> {{docs.diagram.modact.node.ENABLE}}</div>"]
        CHECK_OWN["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.modact.node.CHECK_OWNER}}</div>"]
        BACKUP["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.modact.node.BACKUP}}</div>"]
        COPY["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.modact.node.COPY}}</div>"]
        EN_DONE["<div class='node-content'><i class='icon-play'></i> {{docs.diagram.modact.node.DONE_ON}}</div>"]
    end

    subgraph DISABLE_G ["<div class='group-label' data-cluster-id='DEACTIVATE'><i class='icon-x'></i> {{docs.diagram.cluster.DEACTIVATE}}</div>"]
        DIS_START["<div class='node-content'><i class='icon-minus'></i> {{docs.diagram.modact.node.DISABLE}}</div>"]
        FIND_SURV["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.modact.node.FIND_SURVIVOR}}</div>"]
        HAS_SURV{"{{docs.diagram.modact.node.HAS_SURVIVOR}}"}
        CHECK_ORIG{"{{docs.diagram.modact.node.HAS_ORIGINAL}}"}
        RESTORE_MOD["<div class='node-content'><i class='icon-build'></i> {{docs.diagram.modact.node.RESTORE_MOD}}</div>"]
        RESTORE_ORIG["<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.modact.node.RESTORE_ORIG}}</div>"]
        DEL_FILE["<div class='node-content'><i class='icon-trash'></i> {{docs.diagram.modact.node.DELETE}}</div>"]
        DIS_DONE["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.modact.node.DONE_OFF}}</div>"]
    end

    EN_START -- "<span class='label-info'>{{docs.diagram.label.perFile}}</span>" --> CHECK_OWN
    CHECK_OWN -- "<span class='label-info'>{{docs.diagram.label.free}}</span>" --> BACKUP
    CHECK_OWN -- "<span class='label-warning'>{{docs.diagram.label.alreadyOwned}}</span>" --> COPY
    BACKUP --> COPY
    COPY -- "<span class='label-success'>{{docs.diagram.label.done}}</span>" --> EN_DONE

    DIS_START -- "<span class='label-info'>{{docs.diagram.label.perFile}}</span>" --> FIND_SURV
    FIND_SURV --> HAS_SURV
    HAS_SURV -- "<span class='label-success'>{{docs.diagram.label.yes}}</span>" --> RESTORE_MOD
    HAS_SURV -- "<span class='label-warning'>{{docs.diagram.label.no}}</span>" --> CHECK_ORIG
    CHECK_ORIG -- "<span class='label-success'>{{docs.diagram.label.yes}}</span>" --> RESTORE_ORIG
    CHECK_ORIG -- "<span class='label-danger'>{{docs.diagram.label.no}}</span>" --> DEL_FILE
    RESTORE_MOD --> DIS_DONE
    RESTORE_ORIG --> DIS_DONE
    DEL_FILE --> DIS_DONE

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#f59e0b,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
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
