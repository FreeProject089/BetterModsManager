export const modArchitecture = {
    titleKey: 'docs.diagram.mod_arch.title',
    definition: `
flowchart TD
    subgraph MOD_FILES ["{{docs.diagram.mod_arch.cluster.MOD_STRUCTURE}}"]
        Mod1["<div class='node-content'><span class="diagram-icon" style="display:inline-block; vertical-align:middle; margin-right:4px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg></span> {{docs.diagram.mod_arch.node.Mod1}}</div>"]
        Mod2["<div class='node-content'><span class="diagram-icon" style="display:inline-block; vertical-align:middle; margin-right:4px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg></span> {{docs.diagram.mod_arch.node.Mod2}}</div>"]
    end

    Mod1 -- "{{docs.diagram.mod_arch.edge.SELECT}}" --- SCAN
    Mod2 -- "{{docs.diagram.mod_arch.edge.SELECT}}" --- SCAN

    subgraph BMM_LOGIC ["<div class='group-label'><i class='icon-flow'></i> {{docs.diagram.mod_arch.cluster.BMM_LOGIC}}</div>"]
        direction TB
        SCAN["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.mod_arch.node.SCAN}}</div>"]
        PRIO["<div class='node-content'><i class='icon-scales'></i> {{docs.diagram.mod_arch.node.PRIO}}</div>"]
        SYNC["<div class='node-content'><i class='icon-build'></i> {{docs.diagram.mod_arch.node.SYNC}}</div>"]
        
        SCAN ==>|{{docs.diagram.mod_arch.edge.DETECT}}| PRIO
        PRIO ==>|{{docs.diagram.mod_arch.edge.RESOLVE}}| SYNC
    end

    subgraph GAME_DIR ["{{docs.diagram.mod_arch.cluster.GAME_DIR}}"]
        direction TB
        G_Root["<div class='node-content'><span class="diagram-icon" style="display:inline-block; vertical-align:middle; margin-right:4px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg></span> {{docs.diagram.mod_arch.node.G_Root}}</div>"]
        G_Sub["<div class='node-content'><span class="diagram-icon" style="display:inline-block; vertical-align:middle; margin-right:4px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg></span> {{docs.diagram.mod_arch.node.G_Sub}}</div>"]
    end

    SYNC ==>|{{docs.diagram.mod_arch.edge.INJECT}}| G_Sub

    linkStyle 4 stroke:#f59e0b,stroke-width:3px
`,
    explanationPrefix: 'docs.diagram.mod_arch.node.'
};
