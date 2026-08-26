// How a scheduled task actually runs — trigger, rules, steps, and the two ways it can stop.
//
// The one thing this diagram exists to make visible is that a task is not a list of things
// that happen. It is a TRIGGER that asks *when*, rules that ask *whether*, and steps that
// carry state forward — and the state is the part people miss. An action writes a variable,
// a later condition reads it, and the whole shape of a useful task is that loop.
//
// The second thing is that a task ends in one of two ways: it finishes, or it stops on
// purpose. A guard clause and a failure are not the same event and the timeline shows them
// differently, so the diagram does too.
export const bmmscriptFlow = {
    titleKey: 'sched.bmms.title',
    definition: `
graph TD
    subgraph WHEN ["<div class='group-label' data-cluster-id='WHEN'><i class='icon-history'></i> {{docs.diagram.cluster.WHEN}}</div>"]
        CLOCK["<div class='node-content'><i class='icon-history'></i> {{docs.diagram.bmms.node.CLOCK}}</div>"]
        WATCH["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.bmms.node.WATCH}}</div>"]
        HAND["<div class='node-content'><i class='icon-play'></i> {{docs.diagram.bmms.node.HAND}}</div>"]
    end

    subgraph GATE ["<div class='group-label' data-cluster-id='GATE'><i class='icon-verify'></i> {{docs.diagram.cluster.GATE}}</div>"]
        COND["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.bmms.node.COND}}</div>"]
        PERM["<div class='node-content'><i class='icon-lock'></i> {{docs.diagram.bmms.node.PERM}}</div>"]
    end

    subgraph RUN ["<div class='group-label' data-cluster-id='ACTION'><i class='icon-play'></i> {{docs.diagram.cluster.ACTION}}</div>"]
        STEP["<div class='node-content'><i class='icon-package'></i> {{docs.diagram.bmms.node.STEP}}</div>"]
        VARS["<div class='node-content'><i class='icon-edit'></i> {{docs.diagram.bmms.node.VARS}}</div>"]
        WAIT["<div class='node-content'><i class='icon-network'></i> {{docs.diagram.bmms.node.WAIT}}</div>"]
    end

    subgraph END ["<div class='group-label' data-cluster-id='END'><i class='icon-check'></i> {{docs.diagram.cluster.END}}</div>"]
        DONE["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.bmms.node.DONE}}</div>"]
        STOP["<div class='node-content'><i class='icon-alert'></i> {{docs.diagram.bmms.node.STOP}}</div>"]
    end

    CLOCK -- "<span class='label-info'>{{docs.diagram.label.due}}</span>" --> COND
    WATCH -- "<span class='label-info'>{{docs.diagram.label.changed}}</span>" --> COND
    HAND -- "<span class='label-info'>{{docs.diagram.label.run}}</span>" --> COND
    COND -- "<span class='label-success'>{{docs.diagram.label.holds}}</span>" --> PERM
    COND -- "<span class='label-warning'>{{docs.diagram.label.skipped}}</span>" --> DONE
    PERM -- "<span class='label-success'>{{docs.diagram.label.granted}}</span>" --> STEP
    PERM -- "<span class='label-danger'>{{docs.diagram.label.refused}}</span>" --> STOP
    STEP -- "<span class='label-info'>{{docs.diagram.label.writes}}</span>" --> VARS
    VARS -- "<span class='label-info'>{{docs.diagram.label.reads}}</span>" --> COND
    STEP -- "<span class='label-info'>{{docs.diagram.label.awaits}}</span>" --> WAIT
    WAIT -- "<span class='label-warning'>{{docs.diagram.label.timeout}}</span>" --> STOP
    WAIT -- "<span class='label-success'>{{docs.diagram.label.arrived}}</span>" --> STEP
    STEP -- "<span class='label-success'>{{docs.diagram.label.last}}</span>" --> DONE

    linkStyle 0 stroke:#3b82f6,stroke-width:2px;
    linkStyle 1 stroke:#3b82f6,stroke-width:2px;
    linkStyle 2 stroke:#3b82f6,stroke-width:2px;
    linkStyle 3 stroke:#10b981,stroke-width:2px;
    linkStyle 4 stroke:#f59e0b,stroke-width:2px;
    linkStyle 5 stroke:#10b981,stroke-width:2px;
    linkStyle 6 stroke:#ef4444,stroke-width:2px;
    linkStyle 7 stroke:#3b82f6,stroke-width:2px;
    linkStyle 8 stroke:#3b82f6,stroke-width:2px,stroke-dasharray:4 3;
    linkStyle 9 stroke:#3b82f6,stroke-width:2px;
    linkStyle 10 stroke:#f59e0b,stroke-width:2px;
    linkStyle 11 stroke:#10b981,stroke-width:2px;
    linkStyle 12 stroke:#10b981,stroke-width:2px;
`,
    explanationPrefix: 'docs.diagram.bmms.node.'
};
