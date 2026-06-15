export const blake3Hashing = {
    titleKey: 'docs.diagram.blake3.title',
    definition: `
    graph TD
        subgraph INPUT ["<div class='group-label' data-cluster-id='INPUT'><i class='icon-file'></i> {{docs.diagram.blake3.cluster.INPUT}}</div>"]
            FILES["<div class='node-content'><i class='icon-file'></i> {{docs.diagram.blake3.node.FILES}}</div>"]
        end
        subgraph ENGINE ["<div class='group-label' data-cluster-id='ENGINE'><i class='icon-cog'></i> {{docs.diagram.blake3.cluster.ENGINE}}</div>"]
            CHUNK["<div class='node-content'><i class='icon-list'></i> {{docs.diagram.blake3.node.CHUNK}}</div>"]
            PAR["<div class='node-content'><i class='icon-bolt'></i> {{docs.diagram.blake3.node.PAR}}</div>"]
            TREE["<div class='node-content'><i class='icon-compare'></i> {{docs.diagram.blake3.node.TREE}}</div>"]
            ROOT["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.blake3.node.ROOT}}</div>"]
        end
        subgraph USES ["<div class='group-label' data-cluster-id='USES'><i class='icon-bolt'></i> {{docs.diagram.blake3.cluster.USES}}</div>"]
            INTEG["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.blake3.node.INTEG}}</div>"]
            CHANGE["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.blake3.node.CHANGE}}</div>"]
            PACK["<div class='node-content'><i class='icon-package'></i> {{docs.diagram.blake3.node.PACK}}</div>"]
        end
        subgraph WIRE ["<div class='group-label' data-cluster-id='WIRE'><i class='icon-cloud'></i> {{docs.diagram.blake3.cluster.WIRE}}</div>"]
            REPO["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.blake3.node.REPO}}</div>"]
        end

        FILES -- "<span class='label-info'>{{docs.diagram.blake3.label.split}}</span>" --> CHUNK
        CHUNK -- "<span class='label-info'>{{docs.diagram.blake3.label.cores}}</span>" --> PAR
        PAR -- "<span class='label-info'>{{docs.diagram.blake3.label.merkle}}</span>" --> TREE
        TREE -- "<span class='label-success'>{{docs.diagram.blake3.label.root}}</span>" --> ROOT
        ROOT --> INTEG
        ROOT --> CHANGE
        ROOT --> PACK

        %% Edge Styles
        linkStyle 0 stroke:#3b82f6,stroke-width:2px;
        linkStyle 1 stroke:#6366f1,stroke-width:2px;
        linkStyle 2 stroke:#6366f1,stroke-width:2px;
        linkStyle 3 stroke:#10b981,stroke-width:2px;
        linkStyle 4 stroke:#10b981,stroke-width:1.5px;
        linkStyle 5 stroke:#10b981,stroke-width:1.5px;
        linkStyle 6 stroke:#10b981,stroke-width:1.5px;
    `,
    explanationPrefix: 'docs.diagram.blake3.node.'
};
