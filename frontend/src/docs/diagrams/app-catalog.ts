export const appCatalog = {
    titleKey: 'docs.diagram.appCatalog.title',
    definition: `
flowchart TD
    subgraph SOURCES ["Sources"]
        OFFICIAL["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.appCatalog.node.OFFICIAL}}</div>"]
        PARTNER["<div class='node-content'><i class='icon-cloud'></i> {{docs.diagram.appCatalog.node.PARTNER}}</div>"]
        COMMUNITY["<div class='node-content'><i class='icon-terminal'></i> {{docs.diagram.appCatalog.node.COMMUNITY}}</div>"]
    end

    MERGE["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.appCatalog.node.MERGE}}</div>"]
    BROWSE["<div class='node-content'><i class='icon-layout'></i> {{docs.diagram.appCatalog.node.BROWSE}}</div>"]

    subgraph ACTIONS ["Per-app actions"]
        INSTALL["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.appCatalog.node.INSTALL}}</div>"]
        VERIFY["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.appCatalog.node.VERIFY}}</div>"]
        LAUNCH["<div class='node-content'><i class='icon-bolt'></i> {{docs.diagram.appCatalog.node.LAUNCH}}</div>"]
        UPDATE["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.appCatalog.node.UPDATE}}</div>"]
    end

    OFFICIAL --> MERGE
    PARTNER --> MERGE
    COMMUNITY --> MERGE
    MERGE --> BROWSE
    BROWSE --> INSTALL
    INSTALL --> VERIFY
    VERIFY --> LAUNCH
    LAUNCH -.-> UPDATE
    UPDATE -.-> INSTALL

    %% Styles
    classDef src fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef core fill:#f59e0b1A,stroke:#f59e0b,color:#f59e0b;
    classDef out fill:#10b9811A,stroke:#10b981,color:#10b981;

    class OFFICIAL,PARTNER,COMMUNITY src;
    class MERGE,BROWSE core;
    class INSTALL,VERIFY,LAUNCH,UPDATE out;
`,
    explanationPrefix: 'docs.diagram.appCatalog.node.'
};
