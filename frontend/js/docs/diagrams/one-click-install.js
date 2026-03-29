export const oneClickInstall = {
    titleKey: 'docs.diagram.one_click.title',
    definition: `
graph TD
    subgraph TRIGGER ["<div class='group-label' data-cluster-id='INPUT'><i class='icon-play'></i> {{docs.diagram.cluster.TRIG}}</div>"]
        URL["<div class='node-content'><i class='icon-link'></i> {{docs.diagram.one_click.node.URL}}</div>"]
        PROTOCOL["<div class='node-content'><i class='icon-toggle'></i> {{docs.diagram.one_click.node.PROTOCOL}}</div>"]
    end
    subgraph LOGIC ["<div class='group-label' data-cluster-id='CORE'><i class='icon-layers'></i> {{docs.diagram.cluster.CORE}}</div>"]
        TASKY["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.one_click.node.TASKY}}</div>"]
        DUPE_CHECK["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.one_click.node.DUPE_CHECK}}</div>"]
    end
    subgraph EXEC ["<div class='group-label' data-cluster-id='STORAGE'><i class='icon-folder'></i> {{docs.diagram.cluster.STORAGE}}</div>"]
        DOWNLOAD["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.one_click.node.DOWNLOAD}}</div>"]
        EXTRACT["<div class='node-content'><i class='icon-package'></i> {{docs.diagram.one_click.node.EXTRACT}}</div>"]
    end

    URL -- "<span class='label-event' data-key='click'>{{docs.diagram.label.event}}</span>" --> PROTOCOL
    PROTOCOL -- "<span class='label-ipc' data-key='ipc'>{{docs.diagram.label.ipc}}</span>" --> TASKY
    TASKY -- "<span class='label-success' data-key='confirm'>{{docs.diagram.label.yes}}</span>" --> DUPE_CHECK
    DUPE_CHECK -- "<span class='label-logic' data-key='unique'>{{docs.diagram.label.logic}}</span>" --> DOWNLOAD
    DOWNLOAD -- "<span class='label-http' data-key='ddl'>{{docs.diagram.label.http}}</span>" --> EXTRACT
    EXTRACT -- "<span class='label-done' data-key='ready'>{{docs.diagram.label.done}}</span>" --> UI_REFRESH["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.import.node.UI_REFRESH}}</div>"]

    %% Edge Styles
    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#3b82f6,stroke-width:2px;
    linkStyle 2 stroke:#10b981,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#3b82f6,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.one_click.node.'
};
//# sourceMappingURL=one-click-install.js.map