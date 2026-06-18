export const scheduler = {
    titleKey: 'docs.diagram.scheduler.title',
    definition: `
flowchart TD
    subgraph WHEN ["When (trigger)"]
        TRIGGER["<div class='node-content'><i class='icon-time'></i> {{docs.diagram.scheduler.node.TRIGGER}}</div>"]
        OSTASK["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.scheduler.node.OSTASK}}</div>"]
    end

    ENGINE["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.scheduler.node.ENGINE}}</div>"]
    STEPS["<div class='node-content'><i class='icon-list'></i> {{docs.diagram.scheduler.node.STEPS}}</div>"]

    subgraph BLOCKS ["What (steps)"]
        ACTION["<div class='node-content'><i class='icon-bolt'></i> {{docs.diagram.scheduler.node.ACTION}}</div>"]
        COND["<div class='node-content'><i class='icon-flow'></i> {{docs.diagram.scheduler.node.COND}}</div>"]
        WAIT["<div class='node-content'><i class='icon-time'></i> {{docs.diagram.scheduler.node.WAIT}}</div>"]
    end

    DONE["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.scheduler.node.DONE}}</div>"]

    TRIGGER --> ENGINE
    OSTASK -.->|"bmm://schedule/run"| ENGINE
    ENGINE --> STEPS
    STEPS --> ACTION
    STEPS --> COND
    STEPS --> WAIT
    COND -->|"true / else"| ACTION
    WAIT -->|"state reached"| ACTION
    ACTION --> DONE

    %% Styles
    classDef when fill:#3b82f61A,stroke:#3b82f6,color:#3b82f6;
    classDef core fill:#f59e0b1A,stroke:#f59e0b,color:#f59e0b;
    classDef out fill:#10b9811A,stroke:#10b981,color:#10b981;

    class TRIGGER,OSTASK when;
    class ENGINE,STEPS,COND,WAIT core;
    class ACTION,DONE out;
`,
    explanationPrefix: 'docs.diagram.scheduler.node.'
};
