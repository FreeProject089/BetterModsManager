export const moddingMechanics = {
    titleKey: 'docs.diagram.mech.title',
    definition: `
graph TD
    subgraph MOD ["<div class='group-label' data-cluster-id='INPUT'><i class='icon-folder'></i> {{docs.diagram.cluster.INPUT}}</div>"]
        FILES["<div class='node-content'><i class='icon-file'></i> {{docs.diagram.mech.node.FILES}}</div>"]
    end

    subgraph BMM ["<div class='group-label' data-cluster-id='CORE'><i class='icon-build'></i> {{docs.diagram.cluster.CORE}}</div>"]
        SCAN["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.mech.node.SCAN}}</div>"]
        MERGE["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.mech.node.MERGE}}</div>"]
        BACKUP["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.mech.node.BACKUP}}</div>"]
        INJECT["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.mech.node.INJECT}}</div>"]
    end

    subgraph GAME ["<div class='group-label' data-cluster-id='EXTERNAL'><i class='icon-disk'></i> {{docs.diagram.cluster.EXTERNAL}}</div>"]
        READY["<div class='node-content'><i class='icon-play'></i> {{docs.diagram.mech.node.GAME}}</div>"]
    end

    FILES -- "<span class='label-info' data-key='scan'>{{docs.diagram.label.scan}}</span>" --> SCAN
    
    SCAN -- "<span class='label-success' data-key='no'>{{docs.diagram.label.no}}</span>" --> MERGE
    SCAN -- "<span class='label-warning' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> BACKUP
    
    MERGE --> INJECT
    BACKUP --> INJECT
    
    INJECT -- "<span class='label-success' data-key='done'>{{docs.diagram.label.done}}</span>" --> READY

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#f59e0b,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#10b981,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.mech.node.'
};
