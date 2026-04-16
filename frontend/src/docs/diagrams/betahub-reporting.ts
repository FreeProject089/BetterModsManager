export const betahubReporting = {
    titleKey: 'docs.diagram.betahub.title',
    definition: `
graph TD
    subgraph POW ["<div class='group-label' data-cluster-id='POW'><i class='icon-lock'></i> Spam Protection (PoW)</div>"]
        CHALLENGE["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.betahub.node.CHALLENGE}}</div>"]
        SOLVER["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.betahub.node.SOLVER}}</div>"]
        NONCE["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.betahub.node.NONCE}}</div>"]
    end

    subgraph GATEWAY ["<div class='group-label' data-cluster-id='GATEWAY'><i class='icon-network'></i> API Gateway</div>"]
        VALIDATION["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.betahub.node.VALIDATION}}</div>"]
    end

    subgraph PRIVACY ["<div class='group-label' data-cluster-id='PRIVACY'><i class='icon-shield'></i> Data Privacy</div>"]
        PUBLIC["<div class='node-content'><i class='icon-info'></i> {{docs.diagram.betahub.node.PUBLIC}}</div>"]
        PRIVATE["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.betahub.node.PRIVATE}}</div>"]
    end

    subgraph CLOUD ["<div class='group-label' data-cluster-id='SYNC'><i class='icon-cloud'></i> BetaHub Cloud</div>"]
        SEND["<div class='node-content'><i class='icon-package'></i> {{docs.diagram.betahub.node.SEND}}</div>"]
    end

    CHALLENGE -- "<span class='label-info' data-key='init'>{{docs.diagram.label.init}}</span>" --> SOLVER
    SOLVER -- "<span class='label-purple' data-key='calc'>{{docs.diagram.label.calc}}</span>" --> NONCE
    NONCE -- "<span class='label-success' data-key='secure'>{{docs.diagram.label.secure}}</span>" --> VALIDATION
    
    VALIDATION -- "<span class='label-info' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> PUBLIC
    VALIDATION -- "<span class='label-purple' data-key='privacy'>{{docs.diagram.label.privacy}}</span>" --> PRIVATE
    
    PUBLIC -- "<span class='label-success' data-key='done'>{{docs.diagram.label.done}}</span>" --> SEND
    PRIVATE -- "<span class='label-success' data-key='done'>{{docs.diagram.label.done}}</span>" --> SEND

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#8b5cf6,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#3b82f6,stroke-width:2px;
    linkStyle 4 stroke:#8b5cf6,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
    linkStyle 6 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.betahub.node.'
};
