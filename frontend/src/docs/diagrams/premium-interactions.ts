export const premiumInteractions = {
    titleKey: 'docs.diagram.premium.title',
    definition: `
    graph LR
        subgraph USER ["<div class='group-label' data-cluster-id='USER'><i class='icon-user'></i> {{docs.diagram.cluster.USER}}</div>"]
            LEAVE["<div class='node-content'><i class='icon-mouse'></i> {{docs.diagram.premium.node.LEAVE}}</div>"]
        end
        subgraph SYSTEM ["<div class='group-label' data-cluster-id='LOGIC'><i class='icon-cog'></i> {{docs.diagram.cluster.LOGIC}}</div>"]
            TIMER["<div class='node-content'><i class='icon-time'></i> {{docs.diagram.premium.node.TIMER}}</div>"]
            DETECT["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.premium.node.DETECT}}</div>"]
        end
        subgraph REACTION ["<div class='group-label' data-cluster-id='RENDER'><i class='icon-layout'></i> {{docs.diagram.cluster.RENDER}}</div>"]
            CATCH["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.premium.node.CATCH}}</div>"]
            CLOSE["<div class='node-content'><i class='icon-close'></i> {{docs.diagram.premium.node.CLOSE}}</div>"]
        end

        LEAVE -- "<span class='label-info' data-key='leave'>100ms</span>" --> TIMER
        TIMER -- "<span class='label-info' data-key='poll'>{{docs.diagram.label.poll}}</span>" --> DETECT
        DETECT -- "<span class='label-success' data-key='reEntry'>{{docs.diagram.label.reEntry}}</span>" --> CATCH
        DETECT -- "<span class='label-danger' data-key='deadZone'>{{docs.diagram.label.deadZone}}</span>" --> CLOSE

        %% Edge Styles
        linkStyle 0 stroke:#3b82f6,stroke-width:2px;
        linkStyle 1 stroke:#3b82f6,stroke-width:2px;
        linkStyle 2 stroke:#10b981,stroke-width:2px;
        linkStyle 3 stroke:#ef4444,stroke-width:2px;
    `,
    explanationPrefix: 'docs.diagram.premium.node.'
};
