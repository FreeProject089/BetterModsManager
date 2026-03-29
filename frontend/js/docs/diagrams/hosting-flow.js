export const hostingFlow = {
    titleKey: 'docs.diagram.hosting.title',
    definition: `
graph TD
    subgraph PREP ["<div class='group-label' data-cluster-id='PREP'><i class='icon-settings'></i> {{docs.diagram.cluster.PREP}}</div>"]
        SELECT["<div class='node-content'><i class='icon-list'></i> {{docs.diagram.hosting.node.SELECT}}</div>"]
        NAME["<div class='node-content'><i class='icon-user'></i> {{docs.diagram.hosting.node.NAME}}</div>"]
        FOLDER["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.hosting.node.FOLDER}}</div>"]
    end

    subgraph EXPORT ["<div class='group-label' data-cluster-id='EXPORT'><i class='icon-share'></i> {{docs.diagram.cluster.EXPORT}}</div>"]
        GEN["<div class='node-content'><i class='icon-zap'></i> {{docs.diagram.hosting.node.GEN}}</div>"]
    end

    subgraph HOSTING ["<div class='group-label' data-cluster-id='HOSTING'><i class='icon-server'></i> {{docs.diagram.cluster.HOSTING}}</div>"]
        BMM_HOST["<div class='node-content'><i class='icon-app'></i> {{docs.diagram.hosting.node.BMM_HOST}}</div>"]
        MINI_HOST["<div class='node-content'><i class='icon-terminal'></i> {{docs.diagram.hosting.node.MINI_HOST}}</div>"]
        SELF_HOST["<div class='node-content'><i class='icon-globe'></i> {{docs.diagram.hosting.node.SELF_HOST}}</div>"]
    end

    SELECT -- "<span class='label-info'>+</span>" --> NAME
    NAME -- "<span class='label-info'>+</span>" --> FOLDER
    FOLDER -- "<span class='label-success' data-key='ready'>{{docs.diagram.label.ready}}</span>" --> GEN

    GEN -- "<span class='label-info'>{{docs.diagram.label.method}}</span>" --> BMM_HOST
    GEN -- "<span class='label-info'>{{docs.diagram.label.method}}</span>" --> MINI_HOST
    GEN -- "<span class='label-info'>{{docs.diagram.label.method}}</span>" --> SELF_HOST

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#3b82f6,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#3b82f6,stroke-width:2px;
    linkStyle 4 stroke:#bc74ff,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.hosting.node.'
};
//# sourceMappingURL=hosting-flow.js.map