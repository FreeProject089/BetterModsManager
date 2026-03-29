export const perfMonitoring = {
    titleKey: 'docs.diagram.perf.title',
    definition: `
graph TD
    subgraph SENSORS ["<div class='group-label' data-cluster-id='MONITORING'><i class='icon-flow'></i> {{docs.diagram.cluster.MONITORING}}</div>"]
        DISK_IO{"<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.perf.node.DISK_IO}}</div>"}
        MEM_USE["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.perf.node.MEM_USE}}</div>"]
    end
    subgraph ENGINE ["<div class='group-label' data-cluster-id='ENGINE'><i class='icon-build'></i> {{docs.diagram.cluster.ENGINE}}</div>"]
        THROTTLE["<div class='node-content'><i class='icon-settings'></i> {{docs.diagram.perf.node.THROTTLE}}</div>"]
        QUEUE["<div class='node-content'><i class='icon-list'></i> {{docs.diagram.perf.node.QUEUE}}</div>"]
    end
    subgraph UI ["<div class='group-label' data-cluster-id='UI'><i class='icon-user'></i> {{docs.diagram.cluster.UI}}</div>"]
        STATS["<div class='node-content'><i class='icon-chart'></i> {{docs.diagram.perf.node.STATS}}</div>"]
    end
    DISK_IO{"<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.perf.node.DISK_IO}}</div>"} -- "<span class='label-success' data-key='high'>{{docs.diagram.label.high}}</span>" --> THROTTLE["<div class='node-content'><i class='icon-settings'></i> {{docs.diagram.perf.node.THROTTLE}}</div>"]
    THROTTLE -- "<span class='label-warning' data-key='delay'>{{docs.diagram.label.delay}}</span>" --> QUEUE["<div class='node-content'><i class='icon-list'></i> {{docs.diagram.perf.node.QUEUE}}</div>"]
    QUEUE -- "<span class='label-success' data-key='next'>{{docs.diagram.label.next}}</span>" --> DISK_IO
    MEM_USE["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.perf.node.MEM_USE}}</div>"] -- "<span class='label-purple' data-key='report'>{{docs.diagram.label.report}}</span>" --> STATS["<div class='node-content'><i class='icon-chart'></i> {{docs.diagram.perf.node.STATS}}</div>"]
    DISK_IO -- "<span class='label-purple' data-key='report'>{{docs.diagram.label.report}}</span>" --> STATS

    %% Edge Styles
    linkStyle 0 stroke:#10b981,stroke-width:2px;
    linkStyle 1 stroke:#f59e0b,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#8b5cf6,stroke-width:2px;
    linkStyle 4 stroke:#8b5cf6,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.perf.node.'
};
//# sourceMappingURL=perf-monitoring.js.map