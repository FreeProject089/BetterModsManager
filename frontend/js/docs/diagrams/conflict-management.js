export const conflictManagement = {
    titleKey: 'docs.diagram.conflict.title',
    definition: `
graph TD
    subgraph DETECTION ["<div class='group-label' data-cluster-id='STORAGE'><i class='icon-search'></i> {{docs.diagram.cluster.STORAGE}}</div>"]
        SCAN_CF["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.conflict.node.SCAN}}</div>"]
        MAP["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.conflict.node.MAP}}</div>"]
    end
    subgraph RESOLUTION ["<div class='group-label' data-cluster-id='PROC'><i class='icon-settings'></i> {{docs.diagram.cluster.PROC}}</div>"]
        PRIO["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.conflict.node.PRIO}}</div>"]
        OVERRIDE["<div class='node-content'><i class='icon-image-edit'></i> {{docs.diagram.conflict.node.OVERRIDE}}</div>"]
    end
    subgraph OUTPUT ["<div class='group-label' data-cluster-id='FINALIZING'><i class='icon-done'></i> {{docs.diagram.cluster.FINALIZING}}</div>"]
        REPORT["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.conflict.node.REPORT}}</div>"]
    end
    SCAN_CF["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.conflict.node.SCAN}}</div>"] -- "<span class='label-info' data-key='audit'>{{docs.diagram.label.audit}}</span>" --> MAP["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.conflict.node.MAP}}</div>"]
    MAP -- "<span class='label-purple' data-key='graph'>{{docs.diagram.label.graph}}</span>" --> PRIO["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.conflict.node.PRIO}}</div>"]
    PRIO -- "<span class='label-success' data-key='solve'>{{docs.diagram.label.solve}}</span>" --> OVERRIDE["<div class='node-content'><i class='icon-image-edit'></i> {{docs.diagram.conflict.node.OVERRIDE}}</div>"]
    OVERRIDE -- "<span class='label-purple' data-key='report'>{{docs.diagram.label.report}}</span>" --> REPORT["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.conflict.node.REPORT}}</div>"]

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#8b5cf6,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#8b5cf6,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.conflict.node.'
};
//# sourceMappingURL=conflict-management.js.map