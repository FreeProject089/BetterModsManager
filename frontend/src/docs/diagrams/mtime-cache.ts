export const mtimeCache = {
    titleKey: 'docs.diagram.mtime.title',
    definition: `
    graph TD
        subgraph INPUT ["<div class='group-label' data-cluster-id='SCAN'><i class='icon-play'></i> {{docs.diagram.cluster.SCAN}}</div>"]
            MOD["<div class='node-content'><i class='icon-file'></i> {{docs.diagram.mtime.node.MOD}}</div>"]
        end
        subgraph LOGIC ["<div class='group-label' data-cluster-id='LOGIC'><i class='icon-cog'></i> {{docs.diagram.cluster.LOGIC}}</div>"]
            MT_CHECK["<div class='node-content'><i class='icon-time'></i> {{docs.diagram.mtime.node.MT_CHECK}}</div>"]
            COMPARE["<div class='node-content'><i class='icon-compare'></i> {{docs.diagram.mtime.node.COMPARE}}</div>"]
        end
        subgraph OUTPUT ["<div class='group-label' data-cluster-id='RESULT'><i class='icon-bolt'></i> {{docs.diagram.cluster.RESULT}}</div>"]
            SKIP["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.mtime.node.SKIP}}</div>"]
            REHASH["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.mtime.node.REHASH}}</div>"]
        end

        MOD -- "<span class='label-info' data-key='scan'>{{docs.diagram.label.scan}}</span>" --> MT_CHECK
        MT_CHECK -- "<span class='label-info' data-key='check'>{{docs.diagram.label.check}}</span>" --> COMPARE
        COMPARE -- "<span class='label-success' data-key='hit'>{{docs.diagram.label.hit}}</span>" --> SKIP
        COMPARE -- "<span class='label-warning' data-key='miss'>{{docs.diagram.label.miss}}</span>" --> REHASH

        %% Edge Styles
        linkStyle 0 stroke:#3b82f6,stroke-width:2px;
        linkStyle 1 stroke:#3b82f6,stroke-width:2px;
        linkStyle 2 stroke:#10b981,stroke-width:2px;
        linkStyle 3 stroke:#f59e0b,stroke-width:2px;
    `,
    explanationPrefix: 'docs.diagram.mtime.node.'
};
