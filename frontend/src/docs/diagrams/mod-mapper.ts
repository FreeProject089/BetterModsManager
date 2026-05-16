import { t } from '../../core/i18n.js';

export const modMapper = {
    titleKey: 'docs.gallery.btn.modMapper',
    explanationPrefix: 'docs.diagram.mapper.node.',
    definition: `
flowchart TD
    subgraph INPUT ["{{docs.diagram.cluster.INPUT}}"]
        MOD_TREE["<div class='node-content'><i class='icon-folder'></i> {{docs.diagram.mapper.node.MOD_TREE}}</div>"]
        GAME_TREE["<div class='node-content'><i class='icon-package'></i> {{docs.diagram.mapper.node.GAME_TREE}}</div>"]
    end

    subgraph ACTION ["{{docs.diagram.cluster.USER}}"]
        SELECT["<div class='node-content'><i class='icon-search'></i> {{docs.diagram.mapper.node.SELECT}}</div>"]
        DBL_CLICK["<div class='node-content'><i class='icon-edit'></i> {{docs.diagram.mapper.node.DBL_CLICK}}</div>"]
        REGISTRY["<div class='node-content'><i class='icon-layers'></i> {{docs.diagram.mapper.node.REGISTRY}}</div>"]
        SMART_DETECT["<div class='node-content'><i class='icon-verify'></i> {{docs.diagram.mapper.node.SMART_DETECT}}</div>"]
    end

    subgraph EXECUTION ["{{docs.diagram.cluster.EXECUTION}}"]
        PREVIEW["<div class='node-content'><i class='icon-activity'></i> {{docs.diagram.mapper.node.PREVIEW}}</div>"]
        MOVE["<div class='node-content'><i class='icon-refresh'></i> {{docs.diagram.mapper.node.MOVE}}</div>"]
        SUCCESS["<div class='node-content'><i class='icon-check'></i> {{docs.diagram.mapper.node.SUCCESS}}</div>"]
    end

    MOD_TREE --> SELECT
    GAME_TREE --> DBL_CLICK
    SELECT -- "{{docs.diagram.mapper.edge.SELECT_DBL}}" --> DBL_CLICK
    DBL_CLICK -- "{{docs.diagram.mapper.edge.MAP_REG}}" --> REGISTRY
    REGISTRY -- "{{docs.diagram.mapper.edge.REG_DETECT}}" --> SMART_DETECT
    SMART_DETECT -- "{{docs.diagram.mapper.edge.DETECT_PREV}}" --> PREVIEW
    PREVIEW -- "{{docs.diagram.mapper.edge.PREV_MOVE}}" --> MOVE
    MOVE --> SUCCESS

    classDef default font-family:Inter;
`
};
