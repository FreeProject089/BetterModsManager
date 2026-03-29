export const resumableDownloads = {
    titleKey: 'docs.diagram.resumable.title',
    definition: `
graph TD
    subgraph STORAGE ["<div class='group-label' data-cluster-id='STORAGE'><i class='icon-disk'></i> {{docs.diagram.cluster.STORAGE}}</div>"]
        A["<div class='node-content'><i class='icon-start'></i> {{docs.diagram.resumable.node.START}}</div>"]
        B{"<div class='node-content'><i class='icon-search'></i> {{docs.diagram.resumable.node.EXISTS}}</div>"}
        E["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.resumable.node.VERIFY}}</div>"]
    end
    subgraph DATA ["<div class='group-label' data-cluster-id='DATA'><i class='icon-network'></i> {{docs.diagram.cluster.DATA}}</div>"]
        C["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.resumable.node.FULL}}</div>"]
        D{"<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.resumable.node.CHUNKED}}</div>"}
        G["<div class='node-content'><i class='icon-blocks'></i> {{docs.diagram.resumable.node.CHECK_CHUNKS}}</div>"]
        I["<div class='node-content'><i class='icon-cloud'></i> {{docs.diagram.resumable.node.RANGE}}</div>"]
    end
    subgraph FINALIZING ["<div class='group-label' data-cluster-id='FINALIZING'><i class='icon-build'></i> {{docs.diagram.cluster.FINALIZING}}</div>"]
        J["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.resumable.node.PATCH}}</div>"]
        K["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.resumable.node.FINAL}}</div>"]
        F["<div class='node-content'><i class='icon-done'></i> {{docs.diagram.resumable.node.DONE}}</div>"]
    end
    A["<div class='node-content'><i class='icon-start'></i> {{docs.diagram.resumable.node.START}}</div>"] -- "<span class='label-info' data-key='init'>{{docs.diagram.label.init}}</span>" --> B{"<div class='node-content'><i class='icon-search'></i> {{docs.diagram.resumable.node.EXISTS}}</div>"}
    B -- "<span class='label-error' data-key='no'>{{docs.diagram.label.no}}</span>" --> C["<div class='node-content'><i class='icon-download'></i> {{docs.diagram.resumable.node.FULL}}</div>"]
    B -- "<span class='label-success' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> D{"<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.resumable.node.CHUNKED}}</div>"}
    D -- "<span class='label-error' data-key='no'>{{docs.diagram.label.no}}</span>" --> E["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.resumable.node.VERIFY}}</div>"]
    E -- "<span class='label-success' data-key='match'>{{docs.diagram.label.match}}</span>" --> F["<div class='node-content'><i class='icon-done'></i> {{docs.diagram.resumable.node.DONE}}</div>"]
    E -- "<span class='label-error' data-key='fail'>{{docs.diagram.label.fail}}</span>" --> C
    D -- "<span class='label-success' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> G["<div class='node-content'><i class='icon-blocks'></i> {{docs.diagram.resumable.node.CHECK_CHUNKS}}</div>"]
    G -- "<span class='label-info' data-key='audit'>{{docs.diagram.label.audit}}</span>" --> H{"<div class='node-content'><i class='icon-alert'></i> {{docs.diagram.resumable.node.MISSING}}</div>"}
    H -- "<span class='label-error' data-key='no'>{{docs.diagram.label.no}}</span>" --> F
    H -- "<span class='label-success' data-key='yes'>{{docs.diagram.label.yes}}</span>" --> I["<div class='node-content'><i class='icon-cloud'></i> {{docs.diagram.resumable.node.RANGE}}</div>"]
    I -- "<span class='label-info' data-key='stream'>{{docs.diagram.label.stream}}</span>" --> J["<div class='node-content'><i class='icon-patch'></i> {{docs.diagram.resumable.node.PATCH}}</div>"]
    I -- "<span class='label-error' data-key='fail'>{{docs.diagram.label.fail}}</span>" --> C
    J -- "<span class='label-info' data-key='assemble'>{{docs.diagram.label.assemble}}</span>" --> K["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.resumable.node.FINAL}}</div>"]
    K -- "<span class='label-success' data-key='match'>{{docs.diagram.label.match}}</span>" --> F
    K -- "<span class='label-error' data-key='fail'>{{docs.diagram.label.fail}}</span>" --> C

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#ef4444,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#ef4444,stroke-width:2px;
    linkStyle 4 stroke:#10b981,stroke-width:2px;
    linkStyle 5 stroke:#ef4444,stroke-width:2px;
    linkStyle 6 stroke:#10b981,stroke-width:2px;
    linkStyle 7 stroke:#3b82f6,stroke-width:2px;
    linkStyle 8 stroke:#ef4444,stroke-width:2px;
    linkStyle 9 stroke:#10b981,stroke-width:2px;
    linkStyle 10 stroke:#3b82f6,stroke-width:2px;
    linkStyle 11 stroke:#ef4444,stroke-width:2px;
    linkStyle 12 stroke:#3b82f6,stroke-width:2px;
    linkStyle 13 stroke:#10b981,stroke-width:2px;
    linkStyle 14 stroke:#ef4444,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.resumable.node.'
};
//# sourceMappingURL=resumable-downloads.js.map