export const modUpdates = {
    titleKey: 'docs.diagram.modUpdates.title',
    definition: `
flowchart TD
    subgraph LINK ["How a mod is linked"]
        SYNC["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.modUpdates.node.SYNC}}</div>"]
        CONFIG["<div class='node-content'><i class='icon-settings'></i> {{docs.diagram.modUpdates.node.CONFIG}}</div>"]
        GLOBAL["<div class='node-content'><i class='icon-cloud'></i> {{docs.diagram.modUpdates.node.GLOBAL}}</div>"]
    end

    ID["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.modUpdates.node.ID}}</div>"]
    CHECK["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.modUpdates.node.CHECK}}</div>"]
    COMPARE["<div class='node-content'><i class='icon-layout'></i> {{docs.diagram.modUpdates.node.COMPARE}}</div>"]

    subgraph RESULT ["Result"]
        TAG["<div class='node-content'><i class='icon-bolt'></i> {{docs.diagram.modUpdates.node.TAG}}</div>"]
        PICK["<div class='node-content'><i class='icon-list'></i> {{docs.diagram.modUpdates.node.PICK}}</div>"]
        SYNCDELTA["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.modUpdates.node.SYNCDELTA}}</div>"]
    end

    SYNC --> ID
    CONFIG --> ID
    GLOBAL --> ID
    ID --> CHECK
    CHECK --> COMPARE
    COMPARE -->|"new != installed"| TAG
    TAG --> PICK
    PICK --> SYNCDELTA
    SYNCDELTA -.-> CHECK

    %% Styles
    classDef src fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef core fill:#f59e0b1A,stroke:#f59e0b,color:#f59e0b;
    classDef out fill:#10b9811A,stroke:#10b981,color:#10b981;

    class SYNC,CONFIG,GLOBAL src;
    class ID,CHECK,COMPARE core;
    class TAG,PICK,SYNCDELTA out;
`,
    explanationPrefix: 'docs.diagram.modUpdates.node.'
};
