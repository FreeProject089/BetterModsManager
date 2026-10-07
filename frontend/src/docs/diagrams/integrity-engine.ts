// The integrity engine as the code runs it (src-tauri/src/commands/mods.rs + the Integrity dialog,
// features/settings/integrity-center.ts): a baseline is recorded in the background, a check
// re-reads one mod at a time and compares, and strict mode guards enabling a mod with no baseline.
// No colours here: the renderer (interactive-docs.ts) themes the diagram from the live tokens.
export const integrityEngine = {
    titleKey: 'docs.diagram.integrity.title',
    definition: `
    graph TD
        subgraph BASE_G ["<div class='group-label' data-cluster-id='IBASE'><i class='icon-database'></i> {{docs.diagram.integrity.cl.BASE}}</div>"]
            ADDED["<div class='node-content'><i class='icon-plus'></i> {{docs.diagram.integrity.node.ADDED}}</div>"]
            LAZY["<div class='node-content'><i class='icon-time'></i> {{docs.diagram.integrity.node.LAZY}}</div>"]
            BASELINE[("<div class='node-content'><i class='icon-key'></i> {{docs.diagram.integrity.node.BASELINE}}</div>")]
        end

        subgraph CHECK_G ["<div class='group-label' data-cluster-id='ICHECK'><i class='icon-verify'></i> {{docs.diagram.integrity.cl.CHECK}}</div>"]
            BTN["<div class='node-content'><i class='icon-shield'></i> {{docs.diagram.integrity.node.BTN}}</div>"]
            HASH["<div class='node-content'><i class='icon-files'></i> {{docs.diagram.integrity.node.HASH}}</div>"]
            COMPARE{"{{docs.diagram.integrity.node.COMPARE}}"}
            OK["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.integrity.node.OK}}</div>"]
            REPORT["<div class='node-content'><i class='icon-warning'></i> {{docs.diagram.integrity.node.REPORT}}</div>"]
        end

        subgraph GUARD_G ["<div class='group-label' data-cluster-id='IGUARD'><i class='icon-lock'></i> {{docs.diagram.integrity.cl.GUARD}}</div>"]
            ENABLE["<div class='node-content'><i class='icon-play'></i> {{docs.diagram.integrity.node.ENABLE}}</div>"]
            STRICT{"{{docs.diagram.integrity.node.STRICT}}"}
            ASK["<div class='node-content'><i class='icon-help'></i> {{docs.diagram.integrity.node.ASK}}</div>"]
            ACTIVATE["<div class='node-content'><i class='icon-done'></i> {{docs.diagram.integrity.node.ACTIVATE}}</div>"]
        end

        ADDED --> LAZY
        LAZY -- "<span class='label-info'>{{docs.diagram.label.calc}}</span>" --> BASELINE
        BTN --> HASH
        BASELINE -- "<span class='label-info'>{{docs.diagram.label.load}}</span>" --> COMPARE
        HASH --> COMPARE
        COMPARE -- "<span class='label-success'>{{docs.diagram.label.match}}</span>" --> OK
        COMPARE -- "<span class='label-danger'>{{docs.diagram.label.changed}}</span>" --> REPORT
        ENABLE --> STRICT
        STRICT -- "<span class='label-success'>{{docs.diagram.label.no}}</span>" --> ACTIVATE
        STRICT -- "<span class='label-warning'>{{docs.diagram.label.yes}}</span>" --> ASK
        ASK -- "<span class='label-warning'>{{docs.diagram.integrity.lbl.anyway}}</span>" --> ACTIVATE
    `,
    explanationPrefix: 'docs.diagram.integrity.node.'
};
