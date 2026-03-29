export const modSync = {
    titleKey: 'docs.diagram.sync.title',
    definition: `
graph TD
    subgraph CHECK ["<div class='group-label' data-cluster-id='STORAGE'><i class='icon-disk'></i> {{docs.diagram.cluster.STORAGE}}</div>"]
        SCAN["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.sync.node.SCAN}}</div>"]
        AUDIT["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.sync.node.AUDIT}}</div>"]
    end
    subgraph ACTION ["<div class='group-label' data-cluster-id='SYNC'><i class='icon-flow'></i> {{docs.diagram.cluster.SYNC}}</div>"]
        APPLY["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.sync.node.APPLY}}</div>"]
        CLEAN["<div class='node-content'><i class='icon-trash'></i> {{docs.diagram.sync.node.CLEAN}}</div>"]
    end
    subgraph UI_FEEDBACK ["<div class='group-label' data-cluster-id='UI'><i class='icon-user'></i> {{docs.diagram.cluster.UI}}</div>"]
        UPDATE["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.sync.node.UPDATE}}</div>"]
    end
    SCAN["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.sync.node.SCAN}}</div>"] -- "<span class='label-info' data-key='list'>{{docs.diagram.label.list}}</span>" --> AUDIT["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.sync.node.AUDIT}}</div>"]
    AUDIT -- "<span class='label-error' data-key='missing'>{{docs.diagram.label.missing}}</span>" --> APPLY["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.sync.node.APPLY}}</div>"]
    AUDIT -- "<span class='label-warning' data-key='obsolete'>{{docs.diagram.label.obsolete}}</span>" --> CLEAN["<div class='node-content'><i class='icon-trash'></i> {{docs.diagram.sync.node.CLEAN}}</div>"]
    APPLY -- "<span class='label-success' data-key='done'>{{docs.diagram.label.done}}</span>" --> UPDATE["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.sync.node.UPDATE}}</div>"]
    CLEAN -- "<span class='label-success' data-key='done'>{{docs.diagram.label.done}}</span>" --> UPDATE

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#ef4444,stroke-width:2px;
    linkStyle 2 stroke:#f59e0b,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.sync.node.'
};
//# sourceMappingURL=mod-sync.js.map