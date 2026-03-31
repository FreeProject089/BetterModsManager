export const semanticSearch = {
    titleKey: 'docs.diagram.semanticSearch.title',
    definition: `
flowchart TD
    INPUT["<div class='node-content'><i class='icon-terminal'></i> {{docs.diagram.semanticSearch.node.INPUT}}</div>"]
    
    subgraph ENGINE ["Search Engine"]
        CLASSIC["<div class='node-content'><i class='icon-bolt'></i> {{docs.diagram.semanticSearch.node.CLASSIC}}</div>"]
        SEMANTIC["<div class='node-content'><i class='icon-brain'></i> {{docs.diagram.semanticSearch.node.SEMANTIC}}</div>"]
        
        subgraph EMBED ["AI Embedding"]
            VEC["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.semanticSearch.node.VEC}}</div>"]
        end
    end
    
    RANK["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.semanticSearch.node.RANK}}</div>"]
    UI["<div class='node-content'><i class='icon-layout'></i> {{docs.diagram.semanticSearch.node.UI}}</div>"]
    
    INPUT --> CLASSIC
    INPUT --> SEMANTIC
    SEMANTIC --> VEC
    CLASSIC --> RANK
    VEC --> RANK
    RANK --> UI
    
    %% Styles
    classDef input fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef engine fill:#f59e0b1A,stroke:#f59e0b,color:#f59e0b;
    classDef ai fill:#a855f71A,stroke:#a855f7,color:#a855f7;
    
    class INPUT,UI input;
    class CLASSIC,RANK engine;
    class SEMANTIC,VEC ai;
`,
    explanationPrefix: 'docs.diagram.semanticSearch.node.'
};
