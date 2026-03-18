export const backupSystem = {
    titleKey: 'docs.diagram.backup.title',
    definition: `
graph TD
    subgraph TRIG ["<div class='group-label' data-cluster-id='PROC'><i class='icon-flow'></i> {{docs.diagram.cluster.PROC}}</div>"]
        ACTIVATE["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.backup.node.ACTIVATE}}</div>"]
        DEACTIVATE["<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.backup.node.DEACTIVATE}}</div>"]
    end
    subgraph CORE ["<div class='group-label' data-cluster-id='STORAGE'><i class='icon-disk'></i> {{docs.diagram.cluster.STORAGE}}</div>"]
        EXIST_CHECK{"<div class='node-content'><i class='icon-search'></i> {{docs.diagram.backup.node.EXIST_CHECK}}</div>"}
        MOVE_TO_BKP["<div class='node-content'><i class='icon-share'></i> {{docs.diagram.backup.node.MOVE_TO_BKP}}</div>"]
        RESTORE_ORIG["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.backup.node.RESTORE_ORIG}}</div>"]
    end
    subgraph SAFETY ["<div class='group-label' data-cluster-id='SYNC'><i class='icon-verify'></i> {{docs.diagram.cluster.SYNC}}</div>"]
        INTEGRITY["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.backup.node.INTEGRITY}}</div>"]
    end
    ACTIVATE["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.backup.node.ACTIVATE}}</div>"] -- "<span class='label-info' data-key='init'>{{docs.diagram.label.init}}</span>" --> EXIST_CHECK{"<div class='node-content'><i class='icon-search'></i> {{docs.diagram.backup.node.EXIST_CHECK}}</div>"}
    EXIST_CHECK -- "<span class='label-success' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> MOVE_TO_BKP["<div class='node-content'><i class='icon-share'></i> {{docs.diagram.backup.node.MOVE_TO_BKP}}</div>"]
    EXIST_CHECK -- "<span class='label-error' data-key='no'>{{docs.diagram.label.no}}</span>" --> INTEGRITY["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.backup.node.INTEGRITY}}</div>"]
    DEACTIVATE["<div class='node-content'><i class='icon-delete'></i> {{docs.diagram.backup.node.DEACTIVATE}}</div>"] -- "<span class='label-info' data-key='init'>{{docs.diagram.label.init}}</span>" --> RESTORE_ORIG["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.backup.node.RESTORE_ORIG}}</div>"]
    MOVE_TO_BKP -- "<span class='label-success' data-key='secured'>{{docs.diagram.label.secured}}</span>" --> INTEGRITY
    RESTORE_ORIG -- "<span class='label-success' data-key='restored'>{{docs.diagram.label.restored}}</span>" --> INTEGRITY

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#10b981,stroke-width:2px;
    linkStyle 2 stroke:#ef4444,stroke-width:2px;
    linkStyle 3 stroke:#3b82f6,stroke-width:2px;
    linkStyle 4 stroke:#10b981,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.backup.node.'
};
