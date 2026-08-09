// The "Standalone Server (Lightweight)" button in Server Repo → Host pointed at this
// diagram id, and it was the one id in index.html with no entry in the registry — so
// openDiagram() logged to the console and returned, which reads as a dead button.
export const lightweightArchitecture = {
    titleKey: 'docs.diagram.lightweight.title',
    definition: `
graph TD
    subgraph BMM ["<div class='group-label' data-cluster-id='BMM'><i class='icon-app'></i> {{docs.diagram.cluster.BMM}}</div>"]
        REPO["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.lightweight.node.REPO}}</div>"]
        BUILD["<div class='node-content'><i class='icon-zap'></i> {{docs.diagram.lightweight.node.BUILD}}</div>"]
    end

    subgraph BUNDLE ["<div class='group-label' data-cluster-id='BUNDLE'><i class='icon-terminal'></i> {{docs.diagram.cluster.BUNDLE}}</div>"]
        BINARY["<div class='node-content'><i class='icon-terminal'></i> {{docs.diagram.lightweight.node.BINARY}}</div>"]
        LISTS["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.lightweight.node.LISTS}}</div>"]
    end

    subgraph SERVER ["<div class='group-label' data-cluster-id='SERVER'><i class='icon-server'></i> {{docs.diagram.cluster.SERVER}}</div>"]
        RUN["<div class='node-content'><i class='icon-server'></i> {{docs.diagram.lightweight.node.RUN}}</div>"]
    end

    subgraph CLIENTS ["<div class='group-label' data-cluster-id='CLIENTS'><i class='icon-globe'></i> {{docs.diagram.cluster.CLIENTS}}</div>"]
        CLIENT["<div class='node-content'><i class='icon-app'></i> {{docs.diagram.lightweight.node.CLIENT}}</div>"]
    end

    REPO -- "<span class='label-info'>+</span>" --> BUILD
    BUILD -- "<span class='label-success'>{{docs.diagram.label.ready}}</span>" --> BINARY
    BUILD -- "<span class='label-info'>+</span>" --> LISTS
    BINARY -- "<span class='label-info'>{{docs.diagram.lightweight.label.copy}}</span>" --> RUN
    LISTS -- "<span class='label-info'>{{docs.diagram.lightweight.label.copy}}</span>" --> RUN
    RUN -- "<span class='label-success'>HTTP</span>" --> CLIENT

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#3b82f6,stroke-width:2px;
    linkStyle 3 stroke:#bc74ff,stroke-width:2px;
    linkStyle 4 stroke:#bc74ff,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.lightweight.node.'
};
