export const profileCustomization = {
    titleKey: 'docs.diagram.custom.title',
    definition: `
graph TD
    subgraph INPUT ["<div class='group-label' data-cluster-id='INPUT'><i class='icon-user'></i> {{docs.diagram.cluster.INPUT}}</div>"]
        FILE["<div class='node-content'><i class='icon-image'></i> {{docs.diagram.custom.node.FILE}}</div>"]
        DESC["<div class='node-content'><i class='icon-text'></i> {{docs.diagram.custom.node.DESC}}</div>"]
    end
    subgraph PROCESSING ["<div class='group-label' data-cluster-id='PROC'><i class='icon-flow'></i> {{docs.diagram.cluster.PROC}}</div>"]
        B64["<div class='node-content'><i class='icon-code'></i> {{docs.diagram.custom.node.B64}}</div>"]
        CROP["<div class='node-content'><i class='icon-image-edit'></i> {{docs.diagram.custom.node.CROP}}</div>"]
    end
    subgraph STORAGE ["<div class='group-label' data-cluster-id='STORAGE'><i class='icon-disk'></i> {{docs.diagram.cluster.STORAGE}}</div>"]
        DB["<div class='node-content'><i class='icon-save'></i> {{docs.diagram.custom.node.DB}}</div>"]
        CACHE["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.custom.node.CACHE}}</div>"]
    end
    FILE["<div class='node-content'><i class='icon-image'></i> {{docs.diagram.custom.node.FILE}}</div>"] -- "<span class='label-info' data-key='load'>{{docs.diagram.label.load}}</span>" --> B64["<div class='node-content'><i class='icon-code'></i> {{docs.diagram.custom.node.B64}}</div>"]
    DESC["<div class='node-content'><i class='icon-text'></i> {{docs.diagram.custom.node.DESC}}</div>"] -- "<span class='label-info' data-key='write'>{{docs.diagram.label.write}}</span>" --> DB["<div class='node-content'><i class='icon-save'></i> {{docs.diagram.custom.node.DB}}</div>"]
    B64 -- "<span class='label-info' data-key='proc'>{{docs.diagram.label.proc}}</span>" --> CROP["<div class='node-content'><i class='icon-image-edit'></i> {{docs.diagram.custom.node.CROP}}</div>"]
    CROP -- "<span class='label-success' data-key='save'>{{docs.diagram.label.save}}</span>" --> DB
    DB -- "<span class='label-info' data-key='sync'>{{docs.diagram.label.sync}}</span>" --> CACHE["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.custom.node.CACHE}}</div>"]

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#3b82f6,stroke-width:2px;
    linkStyle 2 stroke:#3b82f6,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#3b82f6,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.custom.node.'
};
