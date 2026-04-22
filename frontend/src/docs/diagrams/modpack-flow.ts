export const modpackFlow = {
    titleKey: 'modpack.qModpacks',
    definition: `
graph TD
    subgraph CREATION ["<div class='group-label' data-cluster-id='CREATION'><i class='icon-edit'></i> {{docs.diagram.cluster.CREATION}}</div>"]
        SELECT["<div class='node-content'><i class='icon-package'></i> {{docs.diagram.modpack.node.SELECT}}</div>"]
        HASH["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.modpack.node.HASH}}</div>"]
        SAVE["<div class='node-content'><i class='icon-disk'></i> {{docs.diagram.modpack.node.SAVE}}</div>"]
    end
    
    subgraph SHARING ["<div class='group-label' data-cluster-id='SHARING'><i class='icon-network'></i> {{docs.diagram.cluster.SHARING}}</div>"]
        EXPORT["<div class='node-content'><i class='icon-export'></i> {{docs.diagram.modpack.node.EXPORT}}</div>"]
        IMPORT["<div class='node-content'><i class='icon-import'></i> {{docs.diagram.modpack.node.IMPORT}}</div>"]
    end
    
    subgraph ACTIVATION ["<div class='group-label' data-cluster-id='ACTION'><i class='icon-play'></i> {{docs.diagram.cluster.ACTION}}</div>"]
        MATCH["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.modpack.node.MATCH}}</div>"]
        APPLY["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.modpack.node.APPLY}}</div>"]
    end

    SELECT -- "<span class='label-info'>{{docs.diagram.label.collect}}</span>" --> HASH
    HASH -- "<span class='label-success'>{{docs.diagram.label.ready}}</span>" --> SAVE
    SAVE -- "<span class='label-info'>{{docs.diagram.label.share}}</span>" --> EXPORT
    EXPORT -- "<span class='label-warning'>{{docs.diagram.label.p2p}}</span>" --> IMPORT
    IMPORT -- "<span class='label-info'>{{docs.diagram.label.verify}}</span>" --> MATCH
    MATCH -- "<span class='label-success'>{{docs.diagram.label.ok}}</span>" --> APPLY

    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#3b82f6,stroke-width:2px;
    linkStyle 3 stroke:#f59e0b,stroke-width:2px;
    linkStyle 4 stroke:#3b82f6,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.modpack.node.'
};
