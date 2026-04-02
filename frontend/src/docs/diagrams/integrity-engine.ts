export const integrityEngine = {
    titleKey: 'docs.diagram.integrity.title',
    definition: `
    graph LR
        subgraph TRIGGER ["<div class='group-label' data-cluster-id='TRIG'><i class='icon-play'></i> {{docs.diagram.cluster.TRIG}}</div>"]
            BTN["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.integrity.node.BTN}}</div>"]
        end
        subgraph PROCESS ["<div class='group-label' data-cluster-id='PROC'><i class='icon-cog'></i> {{docs.diagram.cluster.PROC}}</div>"]
            SCAN["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.integrity.node.SCAN}}</div>"]
            HASH["<div class='node-content'><i class='icon-key'></i> {{docs.diagram.integrity.node.HASH}}</div>"]
        end
        subgraph RESULT ["<div class='group-label' data-cluster-id='READY'><i class='icon-check'></i> {{docs.diagram.cluster.READY}}</div>"]
            COMPARE["<div class='node-content'><i class='icon-compare'></i> {{docs.diagram.integrity.node.COMPARE}}</div>"]
            REPORT["<div class='node-content'><i class='icon-layout'></i> {{docs.diagram.integrity.node.REPORT}}</div>"]
        end

        BTN -- "<span class='label-success' data-key='start'>{{docs.diagram.label.start}}</span>" --> SCAN
        SCAN -- "<span class='label-success' data-key='io'>{{docs.diagram.label.io}}</span>" --> HASH
        HASH -- "<span class='label-success' data-key='calc'>{{docs.diagram.label.calc}}</span>" --> COMPARE
        COMPARE -- "<span class='label-success' data-key='done'>{{docs.diagram.label.done}}</span>" --> REPORT

        %% Edge Styles
        linkStyle 0 stroke:#10b981,stroke-width:2px;
        linkStyle 1 stroke:#3b82f6,stroke-width:2px;
        linkStyle 2 stroke:#8b5cf6,stroke-width:2px;
        linkStyle 3 stroke:#10b981,stroke-width:2px;
    `,
    explanationPrefix: 'docs.diagram.integrity.node.'
};
