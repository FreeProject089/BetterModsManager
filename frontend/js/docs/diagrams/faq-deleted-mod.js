export const faqDeletedMod = {
    titleKey: 'docs.diagram.faq_del.title',
    definition: `
graph TD
    subgraph TRAP ["<div class='group-label' data-cluster-id='PROC'><i class='icon-flow'></i> {{docs.diagram.cluster.PROC}}</div>"]
        DEL["<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.faq_del.node.DEL}}</div>"]
    end
    subgraph SYNC ["<div class='group-label' data-cluster-id='STORAGE'><i class='icon-disk'></i> {{docs.diagram.cluster.STORAGE}}</div>"]
        SCAN["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.faq_del.node.SCAN}}</div>"]
        FOUND{"<div class='node-content'><i class='icon-alert'></i> {{docs.diagram.faq_del.node.FOUND}}</div>"}
    end
    subgraph FIX ["<div class='group-label' data-cluster-id='FIX'><i class='icon-verify'></i> {{docs.diagram.cluster.FIX}}</div>"]
        REMOVE["<div class='node-content'><i class='icon-trash'></i> {{docs.diagram.faq_del.node.REMOVE}}</div>"]
        RESTORE["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.faq_del.node.RESTORE}}</div>"]
    end
    DEL["<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.faq_del.node.DEL}}</div>"] -- "<span class='label-info' data-key='event'>{{docs.diagram.label.event}}</span>" --> SCAN["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.faq_del.node.SCAN}}</div>"]
    SCAN -- "<span class='label-info' data-key='audit'>{{docs.diagram.label.audit}}</span>" --> FOUND{"<div class='node-content'><i class='icon-alert'></i> {{docs.diagram.faq_del.node.FOUND}}</div>"}
    FOUND -- "<span class='label-success' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> REMOVE["<div class='node-content'><i class='icon-trash'></i> {{docs.diagram.faq_del.node.REMOVE}}</div>"]
    REMOVE -- "<span class='label-info' data-key='fix'>{{docs.diagram.label.fix}}</span>" --> RESTORE["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.faq_del.node.RESTORE}}</div>"]
    FOUND -- "<span class='label-error' data-key='no'>{{docs.diagram.label.no}}</span>" --> SCAN

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#3b82f6,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#3b82f6,stroke-width:2px;
    linkStyle 4 stroke:#ef4444,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.faq_del.node.'
};
