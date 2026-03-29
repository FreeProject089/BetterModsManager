export const moddingMechanics = {
    titleKey: 'docs.diagram.mech.title',
    definition: `
graph TD
    subgraph MOD ["<div class='group-label' data-cluster-id='INPUT'><i class='icon-folder'></i> {{docs.diagram.cluster.INPUT}}</div>"]
        CONTENT["<div class='node-content'><i class='icon-file'></i> {{docs.diagram.modding.node.CONTENT}}</div>"]
    end
    subgraph BMM ["<div class='group-label' data-cluster-id='CORE'><i class='icon-build'></i> {{docs.diagram.cluster.CORE}}</div>"]
        STACK["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.modding.node.STACK}}</div>"]
        BACKUP["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.modding.node.BACKUP}}</div>"]
    end
    subgraph GAME ["<div class='group-label' data-cluster-id='EXTERNAL'><i class='icon-disk'></i> {{docs.diagram.cluster.EXTERNAL}}</div>"]
        OVERWRITE["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.modding.node.OVERWRITE}}</div>"]
    end
    CONTENT["<div class='node-content'><i class='icon-file'></i> {{docs.diagram.modding.node.CONTENT}}</div>"] -- "<span class='label-info' data-key='inject'>{{docs.diagram.label.inject}}</span>" --> STACK["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.modding.node.STACK}}</div>"]
    STACK -- "<span class='label-success' data-key='protect'>{{docs.diagram.label.protect}}</span>" --> BACKUP["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.modding.node.BACKUP}}</div>"]
    BACKUP -- "<span class='label-info' data-key='access'>{{docs.diagram.label.access}}</span>" --> OVERWRITE["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.modding.node.OVERWRITE}}</div>"]

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#3b82f6,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.modding.node.'
};
//# sourceMappingURL=modding-mechanics.js.map