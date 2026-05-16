export const perfMonitoring = {
    titleKey: 'docs.diagram.perf.title',
    definition: `
graph TD
    subgraph SENSORS ["<div class='group-label' data-cluster-id='MONITORING'><i class='icon-flow'></i> {{docs.diagram.cluster.MONITORING}}</div>"]
        DISK_IO["<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.perf.node.DISK_IO}}</div>"]
        MEM_USE["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.perf.node.MEM_USE}}</div>"]
        NET_IO["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.perf.node.NET_IO}}</div>"]
    end
    subgraph ENGINE ["<div class='group-label' data-cluster-id='ENGINE'><i class='icon-build'></i> {{docs.diagram.cluster.ENGINE}}</div>"]
        TOKIO["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.perf.node.TOKIO}}</div>"]
        THROTTLE["<div class='node-content'><i class='icon-settings'></i> {{docs.diagram.perf.node.THROTTLE}}</div>"]
        QUEUE["<div class='node-content'><i class='icon-list'></i> {{docs.diagram.perf.node.QUEUE}}</div>"]
    end
    subgraph UI ["<div class='group-label' data-cluster-id='UI'><i class='icon-user'></i> {{docs.diagram.cluster.UI}}</div>"]
        STATS["<div class='node-content'><i class='icon-chart'></i> {{docs.diagram.perf.node.STATS}}</div>"]
        GRAPH["<div class='node-content'><i class='icon-activity'></i> {{docs.diagram.perf.node.GRAPH}}</div>"]
    end
    DISK_IO -- "<span class='label-success' data-key='data'>{{docs.diagram.label.data}}</span>" --> TOKIO
    MEM_USE -- "<span class='label-success' data-key='data'>{{docs.diagram.label.data}}</span>" --> TOKIO
    NET_IO -- "<span class='label-success' data-key='data'>{{docs.diagram.label.data}}</span>" --> TOKIO
    TOKIO -- "<span class='label-warning' data-key='throttle'>{{docs.diagram.label.throttle}}</span>" --> THROTTLE
    THROTTLE -- "<span class='label-purple' data-key='queue'>{{docs.diagram.label.queue}}</span>" --> QUEUE
    QUEUE -- "<span class='label-success' data-key='execute'>{{docs.diagram.label.execute}}</span>" --> DISK_IO
    TOKIO -- "<span class='label-purple' data-key='report'>{{docs.diagram.label.report}}</span>" --> STATS
    STATS -- "<span class='label-success' data-key='render'>{{docs.diagram.label.render}}</span>" --> GRAPH

    %% Edge Styles
    linkStyle 0 stroke:#10b981,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#f59e0b,stroke-width:2px;
    linkStyle 4 stroke:#8b5cf6,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
    linkStyle 6 stroke:#8b5cf6,stroke-width:2px;
    linkStyle 7 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.perf.node.'
};
//# sourceMappingURL=perf-monitoring.js.map