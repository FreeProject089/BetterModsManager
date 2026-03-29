export const bestPractices = {
    titleKey: 'docs.diagram.tips.title',
    definition: `
graph TD
    subgraph ORG ["<div class='group-label' data-cluster-id='INPUT'><i class='icon-user'></i> {{docs.diagram.cluster.INPUT}}</div>"]
        FOLDER_STR["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.tips.node.FOLDER_STR}}</div>"]
        ONE_PROFILE["<div class='node-content'><i class='icon-user'></i> {{docs.diagram.tips.node.ONE_PROFILE}}</div>"]
    end
    subgraph SAFETY ["<div class='group-label' data-cluster-id='SYNC'><i class='icon-verify'></i> {{docs.diagram.cluster.SYNC}}</div>"]
        NO_ACTIVE_DEL["<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.tips.node.NO_ACTIVE_DEL}}</div>"]
        PRE_CHECK["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.tips.node.PRE_CHECK}}</div>"]
    end
    subgraph SUCCESS ["<div class='group-label' data-cluster-id='READY'><i class='icon-done'></i> {{docs.diagram.cluster.READY}}</div>"]
        CLEAN_GAME["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.tips.node.CLEAN_GAME}}</div>"]
    end
    FOLDER_STR["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.tips.node.FOLDER_STR}}</div>"] -- "<span class='label-info' data-key='structure'>{{docs.diagram.label.structure}}</span>" --> PRE_CHECK["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.tips.node.PRE_CHECK}}</div>"]
    ONE_PROFILE["<div class='node-content'><i class='icon-user'></i> {{docs.diagram.tips.node.ONE_PROFILE}}</div>"] -- "<span class='label-info' data-key='logic'>{{docs.diagram.label.logic}}</span>" --> PRE_CHECK
    PRE_CHECK -- "<span class='label-success' data-key='safety'>{{docs.diagram.label.safety}}</span>" --> NO_ACTIVE_DEL["<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.tips.node.NO_ACTIVE_DEL}}</div>"]
    NO_ACTIVE_DEL -- "<span class='label-success' data-key='ready'>{{docs.diagram.label.ready}}</span>" --> CLEAN_GAME["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.tips.node.CLEAN_GAME}}</div>"]

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#3b82f6,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.tips.node.'
};
//# sourceMappingURL=best-practices.js.map