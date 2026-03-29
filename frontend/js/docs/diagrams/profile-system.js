export const profileSystem = {
    titleKey: 'docs.diagram.profile.title',
    definition: `
graph TD
    subgraph INPUT ["<div class='group-label' data-cluster-id='INPUT'><i class='icon-user'></i> {{docs.diagram.cluster.INPUT}}</div>"]
        CREATE["<div class='node-content'><i class='icon-add'></i> {{docs.diagram.profile.node.CREATE}}</div>"]
        SELECT["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.profile.node.SELECT}}</div>"]
    end
    subgraph LOGIC ["<div class='group-label' data-cluster-id='PROC'><i class='icon-flow'></i> {{docs.diagram.cluster.PROC}}</div>"]
        SAVE["<div class='node-content'><i class='icon-save'></i> {{docs.diagram.profile.node.SAVE}}</div>"]
        ACTIVE_CHECK{"<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.profile.node.ACTIVE_CHECK}}</div>"}
        CLEAN["<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.profile.node.CLEAN}}</div>"]
        DEPLOY["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.profile.node.DEPLOY}}</div>"]
    end
    subgraph READY ["<div class='group-label' data-cluster-id='READY'><i class='icon-done'></i> {{docs.diagram.cluster.READY}}</div>"]
        LAUNCH["<div class='node-content'><i class='icon-start'></i> {{docs.diagram.profile.node.LAUNCH}}</div>"]
    end
    CREATE["<div class='node-content'><i class='icon-add'></i> {{docs.diagram.profile.node.CREATE}}</div>"] -- "<span class='label-success' data-key='new'>{{docs.diagram.label.new}}</span>" --> SAVE["<div class='node-content'><i class='icon-save'></i> {{docs.diagram.profile.node.SAVE}}</div>"]
    SELECT["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.profile.node.SELECT}}</div>"] -- "<span class='label-info' data-key='use'>{{docs.diagram.label.use}}</span>" --> SAVE
    SAVE -- "<span class='label-info' data-key='audit'>{{docs.diagram.label.audit}}</span>" --> ACTIVE_CHECK{"<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.profile.node.ACTIVE_CHECK}}</div>"}
    ACTIVE_CHECK -- "<span class='label-success' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> LAUNCH["<div class='node-content'><i class='icon-start'></i> {{docs.diagram.profile.node.LAUNCH}}</div>"]
    ACTIVE_CHECK -- "<span class='label-error' data-key='no'>{{docs.diagram.label.no}}</span>" --> CLEAN["<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.profile.node.CLEAN}}</div>"]
    CLEAN -- "<span class='label-error' data-key='purged'>{{docs.diagram.label.purged}}</span>" --> DEPLOY["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.profile.node.DEPLOY}}</div>"]
    DEPLOY -- "<span class='label-success' data-key='synced'>{{docs.diagram.label.synced}}</span>" --> LAUNCH

    %% Edge Styles
    linkStyle 0 stroke:#10b981,stroke-width:2px;
    linkStyle 1 stroke:#3b82f6,stroke-width:2px;
    linkStyle 2 stroke:#3b82f6,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#ef4444,stroke-width:2px;
    linkStyle 5 stroke:#ef4444,stroke-width:2px;
    linkStyle 6 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.profile.node.'
};
//# sourceMappingURL=profile-system.js.map