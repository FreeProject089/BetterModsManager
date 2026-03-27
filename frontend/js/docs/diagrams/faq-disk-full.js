export const faqDiskFull = {
    titleKey: 'docs.diagram.faq_disk.title',
    definition: `
graph TD
    subgraph IO ["<div class='group-label' data-cluster-id='STORAGE'><i class='icon-disk'></i> {{docs.diagram.cluster.STORAGE}}</div>"]
        WRITE["<div class='node-content'><i class='icon-add'></i> {{docs.diagram.faq_disk.node.WRITE}}</div>"]
    end
    subgraph ERROR ["<div class='group-label' data-cluster-id='PROC'><i class='icon-flow'></i> {{docs.diagram.cluster.PROC}}</div>"]
        OS_ERR{"<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.faq_disk.node.OS_ERR}}</div>"}
        ABORT["<div class='node-content'><i class='icon-stop'></i> {{docs.diagram.faq_disk.node.ABORT}}</div>"]
    end
    subgraph RECOVERY ["<div class='group-label' data-cluster-id='FIX'><i class='icon-verify'></i> {{docs.diagram.cluster.FIX}}</div>"]
        NOTIF["<div class='node-content'><i class='icon-alert'></i> {{docs.diagram.faq_disk.node.NOTIF}}</div>"]
        PURGE["<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.faq_disk.node.PURGE}}</div>"]
    end
    WRITE["<div class='node-content'><i class='icon-add'></i> {{docs.diagram.faq_disk.node.WRITE}}</div>"] -- "<span class='label-success' data-key='io'>{{docs.diagram.label.io}}</span>" --> OS_ERR{"<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.faq_disk.node.OS_ERR}}</div>"}
    OS_ERR -- "<span class='label-success' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> ABORT["<div class='node-content'><i class='icon-stop'></i> {{docs.diagram.faq_disk.node.ABORT}}</div>"]
    ABORT -- "<span class='label-warning' data-key='rollback'>{{docs.diagram.label.rollback}}</span>" --> NOTIF["<div class='node-content'><i class='icon-alert'></i> {{docs.diagram.faq_disk.node.NOTIF}}</div>"]
    NOTIF -- "<span class='label-info' data-key='cleanup'>{{docs.diagram.label.cleanup}}</span>" --> PURGE["<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.faq_disk.node.PURGE}}</div>"]
    OS_ERR -- "<span class='label-error' data-key='no'>{{docs.diagram.label.no}}</span>" --> WRITE

    %% Edge Styles
    linkStyle 0 stroke:#10b981,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#f59e0b,stroke-width:2px;
    linkStyle 3 stroke:#3b82f6,stroke-width:2px;
    linkStyle 4 stroke:#ef4444,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.faq_disk.node.'
};
