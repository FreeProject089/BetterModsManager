export const discordRpc = {
    titleKey: 'docs.diagram.discordRpc.title',
    definition: `
flowchart TD
    EVENT["<div class='node-content'><i class='icon-flash'></i> {{docs.diagram.discordRpc.node.EVENT}}</div>"]
    SYNC["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.discordRpc.node.SYNC}}</div>"]
    
    subgraph BACKEND ["BMM Core (Rust)"]
        BRIDGE["<div class='node-content'><i class='icon-command'></i> {{docs.diagram.discordRpc.node.BRIDGE}}</div>"]
        SOCKET["<div class='node-content'><i class='icon-terminal'></i> {{docs.diagram.discordRpc.node.SOCKET}}</div>"]
    end
    
    subgraph EXTERNAL ["External Client"]
        DISCORD["<div class='node-content'><svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor' style='margin-right:8px; vertical-align:middle;'><path d='M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.069.069 0 0 0-.032.027C.533 9.048-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z'/></svg> {{docs.diagram.discordRpc.node.DISCORD}}</div>"]
        STATUS["<div class='node-content'><i class='icon-layout'></i> {{docs.diagram.discordRpc.node.STATUS}}</div>"]
    end
    
    EVENT --> SYNC
    SYNC --> BRIDGE
    BRIDGE --> SOCKET
    SOCKET --> DISCORD
    DISCORD --> STATUS
    
    %% Styles
    classDef highlight fill:#5865f2,stroke:#5865f2,color:#ffffff,stroke-width:2px;
    classDef logic fill:#5865f21A,stroke:#5865f2,color:#5865f2;
    classDef external fill:#ffffff0D,stroke:#ffffff26,color:#ffffff;
    
    class EVENT,BRIDGE,SOCKET highlight;
    class SYNC logic;
    class DISCORD,STATUS external;
`,
    explanationPrefix: 'docs.diagram.discordRpc.node.'
};
