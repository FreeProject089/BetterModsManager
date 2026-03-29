export const lightweightArchitecture = {
    titleKey: 'docs.diagram.lightweight.title',
    definition: `
graph TD
    subgraph APP ["<div class='group-label' data-cluster-id='APP'><i class='icon-app'></i> BMM CORE</div>"]
        IO_LIMIT["<div class='node-content'><i class='icon-speed'></i> {{docs.diagram.lightweight.node.IO_LIMIT}}</div>"]
        SMART_COPY["<div class='node-content'><i class='icon-copy'></i> {{docs.diagram.lightweight.node.SMART_COPY}}</div>"]
    end

    subgraph PROFILES ["<div class='group-label' data-cluster-id='PROFILES'><i class='icon-users'></i> {{docs.diagram.lightweight.node.PROFILE}}</div>"]
        P1["<div class='node-content'><i class='icon-folder'></i> DCS Profile</div>"]
        P2["<div class='node-content'><i class='icon-folder'></i> BMS Profile</div>"]
    end

    subgraph FILESYSTEM ["<div class='group-label' data-cluster-id='FS'><i class='icon-disk'></i> STORAGE</div>"]
        BACKUP["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.lightweight.node.BACKUP}}</div>"]
        GAME_DIR["<div class='node-content'><i class='icon-folder-open'></i> GAME ROOT</div>"]
        RESTORE["<div class='node-content'><i class='icon-restore'></i> {{docs.diagram.lightweight.node.RESTORE}}</div>"]
    end

    P1 --> SMART_COPY
    P2 --> SMART_COPY
    SMART_COPY -- "<span class='label-info'>Throttled</span>" --> IO_LIMIT
    IO_LIMIT -- "<span class='label-success'>Safe Write</span>" --> GAME_DIR
    GAME_DIR -- "<span class='label-warning'>Originals</span>" --> BACKUP
    BACKUP -- "<span class='label-success'>On Disable</span>" --> RESTORE
    RESTORE --> GAME_DIR

    %% Style
    linkStyle 2 stroke:#60a5fa,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#f59e0b,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
    linkStyle 6 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.lightweight.node.'
};
