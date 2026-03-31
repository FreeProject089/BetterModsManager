export const resumableDownloads = {
    titleKey: 'docs.diagram.resumableDownloads.title',
    definition: `
flowchart TD
    START["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.resumableDownloads.node.START}}</div>"]
    CHECK["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.resumableDownloads.node.CHECK}}</div>"]
    
    subgraph RESUME ["<div class='group-label' data-cluster-id='RESUME'><i class='icon-refresh'></i> {{docs.diagram.resumableDownloads.cluster.RESUME}}</div>"]
        PARTIAL["<div class='node-content'><i class='icon-file-text'></i> {{docs.diagram.resumableDownloads.node.PARTIAL}}</div>"]
        RANGE["<div class='node-content'><i class='icon-arrow-right'></i> {{docs.diagram.resumableDownloads.node.RANGE}}</div>"]
    end
    
    STREAM["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.resumableDownloads.node.STREAM}}</div>"]
    VERIFY["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.resumableDownloads.node.VERIFY}}</div>"]
    DONE["<div class='node-content'><i class='icon-heart'></i> {{docs.diagram.resumableDownloads.node.DONE}}</div>"]
    
    START --> CHECK
    CHECK -- "<span class='label-info'>{{docs.diagram.edge.Existing}}</span>" --> PARTIAL
    CHECK -- "<span class='label-warning'>{{docs.diagram.edge.New}}</span>" --> STREAM
    PARTIAL --> RANGE
    RANGE --> STREAM
    STREAM --> VERIFY
    VERIFY -- "<span class='label-success'>{{docs.diagram.edge.OK}}</span>" --> DONE
    VERIFY -- "<span class='label-error'>{{docs.diagram.edge.Fail}}</span>" --> START
    
    %% Styles
    classDef main fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef logic fill:#22c55e1A,stroke:#22c55e,color:#22c55e;
    classDef warn fill:#ef44441A,stroke:#ef4444,color:#ef4444;
    
    class START,STREAM,DONE main;
    class CHECK,PARTIAL,RANGE logic;
    class VERIFY warn;
`,
    explanationPrefix: 'docs.diagram.resumableDownloads.node.'
};
//# sourceMappingURL=resumable-downloads.js.map