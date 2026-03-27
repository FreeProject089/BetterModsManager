export const diskIoLimiter = {
    titleKey: 'docs.diagram.io.title',
    definition: `
graph TD
    subgraph APP ["<div class='group-label' data-cluster-id='ENGINE'><i class='icon-build'></i> {{docs.diagram.cluster.ENGINE}}</div>"]
        CONFIG["<div class='node-content'><i class='icon-settings'></i> {{docs.diagram.io.node.CONFIG}}</div>"]
        LIMITER["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.io.node.LIMITER}}</div>"]
    end
    subgraph THREAD ["<div class='group-label' data-cluster-id='PROC'><i class='icon-flow'></i> {{docs.diagram.cluster.PROC}}</div>"]
        READ_CHUNK["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.io.node.READ_CHUNK}}</div>"]
        SLEEP["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.io.node.SLEEP}}</div>"]
    end
    subgraph DISK ["<div class='group-label' data-cluster-id='STORAGE'><i class='icon-disk'></i> {{docs.diagram.cluster.STORAGE}}</div>"]
        WRITE_CHUNK["<div class='node-content'><i class='icon-add'></i> {{docs.diagram.io.node.WRITE_CHUNK}}</div>"]
    end
    CONFIG["<div class='node-content'><i class='icon-settings'></i> {{docs.diagram.io.node.CONFIG}}</div>"] -- "<span class='label-info' data-key='apply'>{{docs.diagram.label.apply}}</span>" --> LIMITER["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.io.node.LIMITER}}</div>"]
    LIMITER -- "<span class='label-info' data-key='start'>{{docs.diagram.label.start}}</span>" --> READ_CHUNK["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.io.node.READ_CHUNK}}</div>"]
    READ_CHUNK -- "<span class='label-info' data-key='calc'>{{docs.diagram.label.calc}}</span>" --> SLEEP["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.io.node.SLEEP}}</div>"]
    SLEEP -- "<span class='label-warning' data-key='wait'>{{docs.diagram.label.wait}}</span>" --> WRITE_CHUNK["<div class='node-content'><i class='icon-add'></i> {{docs.diagram.io.node.WRITE_CHUNK}}</div>"]
    WRITE_CHUNK -- "<span class='label-success' data-key='loop'>{{docs.diagram.label.loop}}</span>" --> READ_CHUNK

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#3b82f6,stroke-width:2px;
    linkStyle 2 stroke:#3b82f6,stroke-width:2px;
    linkStyle 3 stroke:#f59e0b,stroke-width:2px;
    linkStyle 4 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.io.node.'
};
