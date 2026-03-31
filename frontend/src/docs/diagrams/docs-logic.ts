export const docsLogic = {
    titleKey: 'docs.diagram.docsLogic.title',
    definition: `
flowchart TD
    %% Input Layer
    INPUT["<div class='node-content'><i class='icon-edit'></i> {{docs.search.inputLabel}}</div>"]
    
    %% Logic Decision
    subgraph ENGINE["Moteur de Recherche"]
        NORM["<div class='node-content'><i class='icon-refresh'></i> Normalisation<br/>(Accents + Casse)</div>"]
        
        CLASSIC{Classic Mode?}
        SEMANTIC{Semantic Mode?}
        
        INC_MATCH["<div class='node-content'><i class='icon-search'></i> String.includes()</div>"]
        
        subgraph SEM_PROC["Processus Sémantique"]
            SPLIT["<div class='node-content'><i class='icon-scissors'></i> Word Split</div>"]
            INTERSECT["<div class='node-content'><i class='icon-intersect'></i> Intersection</div>"]
            SCORE["<div class='node-content'><i class='icon-star'></i> weighted Scoring</div>"]
        end
    end
    
    INPUT --> NORM
    NORM --> CLASSIC
    NORM --> SEMANTIC
    
    CLASSIC -- Yes --> INC_MATCH
    SEMANTIC -- Yes --> SPLIT
    
    SPLIT --> INTERSECT
    INTERSECT --> SCORE
    
    %% Indexing Layer
    INDEX["<div class='node-content'><i class='icon-database'></i> {{docs.search.diagIndex}}</div>"]
    SCORE --> INDEX
    INC_MATCH --> INDEX
    
    %% Results Layer
    BADGE["<div class='node-content'><i class='icon-flash'></i> % Match Badge</div>"]
    INDEX --> BADGE
    
    RECO["<div class='node-content'><i class='icon-list'></i> {{docs.search.recoList}}</div>"]
    BADGE --> RECO
    
    %% UX Layer
    RECO -- Click --> GLOW["<div class='node-content'><i class='icon-flash'></i> {{docs.search.nodeGlow}}</div>"]
    GLOW --> CENTER["<div class='node-content'><i class='icon-check'></i> {{docs.search.autoCenter}}</div>"]
    
    %% Styles
    classDef main fill:#3b82f6,stroke:#3b82f6,color:#ffffff,stroke-width:2px;
    classDef logic fill:#3b82f61A,stroke:#3b82f6,stroke-dasharray: 5 5;
    class INPUT,RECO,GLOW,SCORE main;
    class ENGINE,SEM_PROC logic;
`,
    explanationPrefix: 'docs.diagram.docsLogic.node.'
};

