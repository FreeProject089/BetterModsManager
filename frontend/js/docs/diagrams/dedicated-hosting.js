export const dedicatedHosting = {
    titleKey: 'docs.diagram.hosting.title',
    definition: `
graph TD
    subgraph PREP ["<div class='group-label' data-cluster-id='UI'><i class='icon-user'></i> {{docs.diagram.cluster.UI}}</div>"]
        TAB["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.hosting.node.TAB}}</div>"]
        SELECT["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.hosting.node.SELECT}}</div>"]
    end

    subgraph GEN ["<div class='group-label' data-cluster-id='ENGINE'><i class='icon-build'></i> {{docs.diagram.cluster.ENGINE}}</div>"]
        REPO_GEN["<div class='node-content'><i class='icon-settings'></i> {{docs.diagram.hosting.node.REPO_GEN}}</div>"]
        LOCAL_TEST["<div class='node-content'><i class='icon-play'></i> {{docs.diagram.hosting.node.LOCAL_TEST}}</div>"]
    end

    subgraph TRANS ["<div class='group-label' data-cluster-id='SYNC'><i class='icon-network'></i> {{docs.diagram.cluster.SYNC}}</div>"]
        SFTP["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.hosting.node.SFTP}}</div>"]
    end

    subgraph HOST ["<div class='group-label' data-cluster-id='SERVER'><i class='icon-flow'></i> {{docs.diagram.cluster.SERVER}}</div>"]
        WEBSRV["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.hosting.node.WEBSRV}}</div>"]
        CORS["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.hosting.node.CORS}}</div>"]
        HTTPS["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.hosting.node.HTTPS}}</div>"]
    end

    subgraph USER ["<div class='group-label' data-cluster-id='CLIENT'><i class='icon-user'></i> {{docs.diagram.cluster.CLIENT}}</div>"]
        URL["<div class='node-content'><i class='icon-link'></i> {{docs.diagram.hosting.node.URL}}</div>"]
    end

    TAB -- "<span class='label-info' data-key='proc'>{{docs.diagram.label.proc}}</span>" --> SELECT
    SELECT -- "<span class='label-success' data-key='ready'>{{docs.diagram.label.ready}}</span>" --> REPO_GEN
    REPO_GEN -- "<span class='label-info' data-key='apply'>{{docs.diagram.label.apply}}</span>" --> LOCAL_TEST
    LOCAL_TEST -- "<span class='label-info' data-key='data'>{{docs.diagram.label.data}}</span>" --> SFTP
    SFTP -- "<span class='label-info' data-key='data'>{{docs.diagram.label.data}}</span>" --> WEBSRV
    WEBSRV -- "<span class='label-warning' data-key='safety'>{{docs.diagram.label.safety}}</span>" --> CORS
    CORS -- "<span class='label-info' data-key='secure'>{{docs.diagram.label.secure}}</span>" --> HTTPS
    HTTPS -- "<span class='label-success' data-key='verified'>{{docs.diagram.label.verified}}</span>" --> URL

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#3b82f6,stroke-width:2px;
    linkStyle 3 stroke:#3b82f6,stroke-width:2px;
    linkStyle 4 stroke:#3b82f6,stroke-width:2px;
    linkStyle 5 stroke:#f59e0b,stroke-width:2px;
    linkStyle 6 stroke:#3b82f6,stroke-width:2px;
    linkStyle 7 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.hosting.node.'
};
//# sourceMappingURL=dedicated-hosting.js.map