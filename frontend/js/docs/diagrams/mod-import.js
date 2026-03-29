export const modImport = {
    titleKey: 'docs.diagram.import.title',
    definition: `
graph TD
    subgraph SCAN ["<div class='group-label' data-cluster-id='STORAGE'><i class='icon-search'></i> {{docs.diagram.cluster.STORAGE}}</div>"]
        WALK["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.import.node.WALK}}</div>"]
        MATCH["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.import.node.MATCH}}</div>"]
    end
    subgraph META ["<div class='group-label' data-cluster-id='INPUT'><i class='icon-layers'></i> {{docs.diagram.cluster.INPUT}}</div>"]
        READ_MM["<div class='node-content'><i class='icon-file'></i> {{docs.diagram.import.node.READ_MM}}</div>"]
        GEN_HASH["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.import.node.GEN_HASH}}</div>"]
        ICON_CROP["<div class='node-content'><i class='icon-image'></i> {{docs.diagram.import.node.ICON_CROP}}</div>"]
    end
    subgraph INDEX ["<div class='group-label' data-cluster-id='UI'><i class='icon-database'></i> {{docs.diagram.cluster.UI}}</div>"]
        ADD_DB["<div class='node-content'><i class='icon-add'></i> {{docs.diagram.import.node.ADD_DB}}</div>"]
        UI_REFRESH["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.import.node.UI_REFRESH}}</div>"]
    end
    WALK["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.import.node.WALK}}</div>"] -- "<span class='label-success' data-key='scan'>{{docs.diagram.label.scan}}</span>" --> MATCH["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.import.node.MATCH}}</div>"]
    MATCH -- "<span class='label-success' data-key='match'>{{docs.diagram.label.match}}</span>" --> READ_MM["<div class='node-content'><i class='icon-file'></i> {{docs.diagram.import.node.READ_MM}}</div>"]
    READ_MM -- "<span class='label-success' data-key='parse'>{{docs.diagram.label.parse}}</span>" --> GEN_HASH["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.import.node.GEN_HASH}}</div>"]
    GEN_HASH -- "<span class='label-success' data-key='secure'>{{docs.diagram.label.secure}}</span>" --> ICON_CROP["<div class='node-content'><i class='icon-image'></i> {{docs.diagram.import.node.ICON_CROP}}</div>"]
    ICON_CROP -- "<span class='label-success' data-key='gfx'>{{docs.diagram.label.gfx}}</span>" --> ADD_DB["<div class='node-content'><i class='icon-add'></i> {{docs.diagram.import.node.ADD_DB}}</div>"]
    ADD_DB -- "<span class='label-success' data-key='indexed'>{{docs.diagram.label.indexed}}</span>" --> UI_REFRESH["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.import.node.UI_REFRESH}}</div>"]

    %% Edge Styles
    linkStyle 0 stroke:#10b981,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#10b981,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.import.node.'
};
//# sourceMappingURL=mod-import.js.map