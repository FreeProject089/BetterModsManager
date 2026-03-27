export const cacheManagement = {
    titleKey: 'docs.diagram.cache.title',
    definition: `
graph TD
    subgraph REQUEST ["<div class='group-label' data-cluster-id='INPUT'><i class='icon-user'></i> {{docs.diagram.cluster.INPUT}}</div>"]
        APP_REQ["<div class='node-content'><i class='icon-share'></i> {{docs.diagram.cache.node.REQ}}</div>"]
    end
    subgraph CACHE_LOGIC ["<div class='group-label' data-cluster-id='PROC'><i class='icon-flow'></i> {{docs.diagram.cluster.PROC}}</div>"]
        MEM_CACHE{"<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.cache.node.MEM}}</div>"}
        DISK_CACHE{"<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.cache.node.DISK}}</div>"}
    end
    subgraph FETCH ["<div class='group-label' data-cluster-id='SYNC'><i class='icon-network'></i> {{docs.diagram.cluster.SYNC}}</div>"]
        REMOTE["<div class='node-content'><i class='icon-cloud'></i> {{docs.diagram.cache.node.REMOTE}}</div>"]
    end
    APP_REQ --> MEM_CACHE
    MEM_CACHE -- "<span class='label-success' data-key='hit'>{{docs.diagram.label.hit}}</span>" --> DONE["<div class='node-content'><i class='icon-done'></i> {{docs.diagram.cache.node.DONE}}</div>"]
    MEM_CACHE -- "<span class='label-error' data-key='miss'>{{docs.diagram.label.miss}}</span>" --> DISK_CACHE
    DISK_CACHE -- "<span class='label-success' data-key='hit'>{{docs.diagram.label.hit}}</span>" --> DONE
    DISK_CACHE -- "<span class='label-error' data-key='miss'>{{docs.diagram.label.miss}}</span>" --> REMOTE
    REMOTE -- "<span class='label-info' data-key='data'>{{docs.diagram.label.data}}</span>" --> DONE

    %% Edge Styles
    linkStyle 0 stroke:#475569,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#ef4444,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#ef4444,stroke-width:2px;
    linkStyle 5 stroke:#3b82f6,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.cache.node.'
};
