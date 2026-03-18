export const crashReporting = {
    titleKey: 'docs.diagram.crash.title',
    definition: `
graph TD
    subgraph TRAP ["<div class='group-label' data-cluster-id='PROC'><i class='icon-flow'></i> {{docs.diagram.cluster.PROC}}</div>"]
        PANIC["<div class='node-content'><i class='icon-alert'></i> {{docs.diagram.crash.node.PANIC}}</div>"]
        CATCHER["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.crash.node.CATCHER}}</div>"]
    end
    subgraph ANALYSIS ["<div class='group-label' data-cluster-id='ANALYSIS'><i class='icon-search'></i> {{docs.diagram.cluster.ANALYSIS}}</div>"]
        DUMP["<div class='node-content'><i class='icon-file'></i> {{docs.diagram.crash.node.DUMP}}</div>"]
        SCRUB["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.crash.node.SCRUB}}</div>"]
    end
    subgraph UPLOAD ["<div class='group-label' data-cluster-id='SYNC'><i class='icon-network'></i> {{docs.diagram.cluster.SYNC}}</div>"]
        SEND["<div class='node-content'><i class='icon-cloud'></i> {{docs.diagram.crash.node.SEND}}</div>"]
    end
    PANIC -- "<span class='label-info' data-key='event'>{{docs.diagram.label.event}}</span>" --> CATCHER
    CATCHER -- "<span class='label-purple' data-key='trace'>{{docs.diagram.label.trace}}</span>" --> DUMP
    DUMP -- "<span class='label-success' data-key='privacy'>{{docs.diagram.label.privacy}}</span>" --> SCRUB
    SCRUB -- "<span class='label-purple' data-key='report'>{{docs.diagram.label.report}}</span>" --> SEND

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#8b5cf6,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#8b5cf6,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.crash.node.'
};
