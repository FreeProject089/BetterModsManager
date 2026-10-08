import type { DiagramSpec } from '../diagram-spec.js';

// Launch packs (commands/launch_pack.rs, features/settings/launch_packs.ts): a named list of
// programs that BMM turns, on save, into LaunchPacks/<id>/launcher.vbs (one hidden WshShell.Run
// per program), an icon.ico and a desktop-style .lnk. Running a pack is just starting that
// launcher through wscript; BMM does not check or wait for each program. A .bmmlaunch file
// carries only the decisions (name, programs, icon) and is rebuilt on import.
export const launchPacks: DiagramSpec = {
    id: 'launch-packs',
    i18n: 'docs.diagram.launch-packs',
    category: 'profiles',
    dir: 'TB',
    article: 'launch-packs',
    related: ['scheduler', 'deeplinks', 'mcp-server', 'backup-system'],
    groups: [
        { id: 'BUILD' },
        { id: 'FILES', dir: 'LR' },
        { id: 'RUN' },
    ],
    nodes: [
        { id: 'EDITOR', kind: 'ui', group: 'BUILD', icon: 'icon-edit', refs: ['frontend/src/features/settings/launch_packs.ts', 'src-tauri/src/commands/launch_pack.rs › scan_installed_apps', 'src-tauri/src/commands/launch_pack.rs › extract_exe_icon'] },
        { id: 'IMPORT', kind: 'rust', group: 'BUILD', icon: 'icon-import', refs: ['src-tauri/src/commands/launch_pack.rs › import_launch_pack', 'src-tauri/src/commands/launch_pack.rs › LaunchPackFile'] },
        { id: 'SAVE', kind: 'rust', group: 'BUILD', icon: 'icon-save', refs: ['src-tauri/src/commands/launch_pack.rs › create_launch_pack', 'src-tauri/src/commands/launch_pack.rs › update_launch_pack'] },
        { id: 'ICON', kind: 'rust', group: 'BUILD', icon: 'icon-image', refs: ['src-tauri/src/commands/launch_pack.rs › icon_to_ico', 'src-tauri/src/commands/image.rs › image_gate'] },
        { id: 'EXPORT', kind: 'rust', group: 'BUILD', icon: 'icon-export', refs: ['src-tauri/src/commands/launch_pack.rs › export_launch_pack'] },

        { id: 'DATA', kind: 'data', group: 'FILES', icon: 'icon-database', refs: ['src-tauri/src/models/launch_pack.rs › LaunchPack', 'src-tauri/src/commands/launch_pack.rs › get_launch_packs'] },
        { id: 'VBS', kind: 'data', group: 'FILES', icon: 'icon-script', refs: ['src-tauri/src/commands/launch_pack.rs › create_launch_pack'] },
        { id: 'LNK', kind: 'data', group: 'FILES', icon: 'icon-link', refs: ['src-tauri/src/commands/proc.rs › create_wscript_shortcut', 'src-tauri/src/commands/proc.rs › safe_lnk_stem'] },

        { id: 'TRIGGER', kind: 'ui', group: 'RUN', icon: 'icon-play', refs: ['frontend/src/features/settings/launch_packs.ts', 'frontend/src/core/deep_link_manager.ts', 'frontend/src/features/settings/scheduler.ts', 'src-tauri/src/mcp/tools/launch_packs.rs › run_launch_pack'] },
        { id: 'RUN_CMD', kind: 'rust', group: 'RUN', icon: 'icon-start', refs: ['src-tauri/src/commands/launch_pack.rs › run_launch_pack', 'src-tauri/src/commands/launch_pack.rs › pack_folder'] },
        { id: 'HAS_VBS', kind: 'decision', group: 'RUN', refs: ['src-tauri/src/commands/launch_pack.rs › run_launch_pack'] },
        { id: 'MISSING', kind: 'outcome', group: 'RUN', icon: 'icon-alert', refs: ['src-tauri/src/commands/launch_pack.rs › run_launch_pack'] },
        { id: 'APPS', kind: 'ext', group: 'RUN', icon: 'icon-app', refs: ['src-tauri/src/commands/proc.rs › hidden_command'] },
    ],
    edges: [
        { from: 'EDITOR', to: 'SAVE', thick: true },
        { from: 'IMPORT', to: 'SAVE', label: 'rebuilds', tone: 'info' },
        { from: 'SAVE', to: 'ICON', label: 'iconPicked', dashed: true },
        { from: 'SAVE', to: 'DATA', label: '~writes', thick: true },
        { from: 'SAVE', to: 'VBS', label: '~writes', thick: true },
        { from: 'SAVE', to: 'LNK', label: '~writes' },
        { from: 'DATA', to: 'EXPORT', label: '~reads', dashed: true },
        { from: 'TRIGGER', to: 'RUN_CMD', thick: true },
        { from: 'RUN_CMD', to: 'HAS_VBS', thick: true },
        { from: 'HAS_VBS', to: 'MISSING', label: '~no', tone: 'danger' },
        { from: 'VBS', to: 'HAS_VBS', label: '~reads', dashed: true },
        { from: 'HAS_VBS', to: 'APPS', label: 'wscript', tone: 'ok', thick: true },
        { from: 'LNK', to: 'APPS', label: 'doubleClick', tone: 'ok', dashed: true },
    ],
};
