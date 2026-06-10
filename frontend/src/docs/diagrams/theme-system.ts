export const themeSystem = {
    titleKey: 'docs.diagram.themeSystem.title',
    definition: `
flowchart TD
    EDITOR["<div class='node-content'><i class='icon-layout'></i> {{docs.diagram.themeSystem.node.EDITOR}}</div>"]

    subgraph SOURCES ["Theme Sources"]
        PRESET["<div class='node-content'><i class='icon-bolt'></i> {{docs.diagram.themeSystem.node.PRESET}}</div>"]
        GEN["<div class='node-content'><i class='icon-brain'></i> {{docs.diagram.themeSystem.node.GEN}}</div>"]
        PICK["<div class='node-content'><i class='icon-terminal'></i> {{docs.diagram.themeSystem.node.PICK}}</div>"]
    end

    subgraph ENGINE ["Theme Engine"]
        TOKENS["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.themeSystem.node.TOKENS}}</div>"]
        OBSERVER["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.themeSystem.node.OBSERVER}}</div>"]
        CONTRAST["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.themeSystem.node.CONTRAST}}</div>"]
    end

    UI["<div class='node-content'><i class='icon-layout'></i> {{docs.diagram.themeSystem.node.UI}}</div>"]

    subgraph SHARE ["Sharing"]
        FILE["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.themeSystem.node.FILE}}</div>"]
        CATALOG["<div class='node-content'><i class='icon-cloud'></i> {{docs.diagram.themeSystem.node.CATALOG}}</div>"]
    end

    PRESET --> EDITOR
    GEN --> EDITOR
    PICK --> EDITOR
    EDITOR --> TOKENS
    TOKENS --> UI
    OBSERVER --> UI
    CONTRAST --> UI
    TOKENS -.-> OBSERVER
    TOKENS -.-> CONTRAST
    EDITOR --> FILE
    FILE <--> CATALOG

    %% Styles
    classDef src fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef engine fill:#f59e0b1A,stroke:#f59e0b,color:#f59e0b;
    classDef out fill:#10b9811A,stroke:#10b981,color:#10b981;

    class PRESET,GEN,PICK,EDITOR src;
    class TOKENS,OBSERVER,CONTRAST engine;
    class UI,FILE,CATALOG out;
`,
    explanationPrefix: 'docs.diagram.themeSystem.node.'
};
