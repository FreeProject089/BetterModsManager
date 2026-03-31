export const codeStack = {
    titleKey: 'docs.diagram.codeStack.title',
    definition: `
flowchart TD
    LEGACY["<div class='node-content'><i class='icon-trash'></i> {{docs.diagram.codeStack.node.LEGACY}}</div>"]
    MIGRATION["<div class='node-content'><i class='icon-arrow-right'></i> {{docs.diagram.codeStack.node.MIGRATION}}</div>"]
    
    subgraph MODERN ["Modern Architecture (v0.9+)"]
        TS["<div class='node-content'><i class='icon-code'></i> {{docs.diagram.codeStack.node.TS}}</div>"]
        ESM["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.codeStack.node.ESM}}</div>"]
        IMPORT["<div class='node-content'><i class='icon-link'></i> {{docs.diagram.codeStack.node.IMPORT}}</div>"]
    end
    
    subgraph COMPILE ["Build Pipeline"]
        TSC["<div class='node-content'><i class='icon-command'></i> {{docs.diagram.codeStack.node.TSC}}</div>"]
        JS_OUT["<div class='node-content'><i class='icon-file-text'></i> {{docs.diagram.codeStack.node.JS_OUT}}</div>"]
    end
    
    LEGACY --> MIGRATION
    MIGRATION --> TS
    TS --> ESM
    ESM --> IMPORT
    TS --> TSC
    TSC --> JS_OUT
    JS_OUT -- Import --> IMPORT
    
    %% Styles
    classDef legacy fill:#ef44441A,stroke:#ef4444,color:#ef4444;
    classDef modern fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef compile fill:#a855f71A,stroke:#a855f7,color:#a855f7;
    
    class LEGACY,MIGRATION legacy;
    class TS,ESM,IMPORT modern;
    class TSC,JS_OUT compile;
`,
    explanationPrefix: 'docs.diagram.codeStack.node.'
};
