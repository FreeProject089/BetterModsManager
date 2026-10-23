import type { DiagramSpec } from '../diagram-spec.js';

// Discord Rich Presence (commands/discord.rs): off by default (settings.discord_rpc_enabled). Every
// update goes through set_discord_presence, which checks the setting, connects the IPC client once
// (kept in AppState.discord_client) and sets the activity: details + state text, the BMM logo with
// the version and creator id, and two buttons whose URLs come from links.json.
export const discordRpc: DiagramSpec = {
    id: 'discord-rpc',
    i18n: 'docs.diagram.discord-rpc',
    category: 'automation',
    dir: 'TB',
    article: 'integrations',
    related: ['scheduler', 'mcp-server', 'profile-system'],
    groups: [
        { id: 'TRIGGER', dir: 'LR' },
        { id: 'CORE' },
        { id: 'DISCORD' },
    ],
    nodes: [
        { id: 'SETTING', kind: 'ui', group: 'TRIGGER', icon: 'icon-toggle', refs: ['frontend/src/features/settings/settings.ts › initDiscordRpcSettings', 'frontend/src/features/settings/settings.ts › setDiscordRpc', 'src-tauri/src/state.rs › discord_rpc_enabled'] },
        { id: 'EVENTS', kind: 'front', group: 'TRIGGER', icon: 'icon-activity', refs: ['frontend/src/features/settings/settings.ts › updateDiscordStatus', 'frontend/src/features/misc/flappy-tasky.ts › presence'] },
        { id: 'INIT', kind: 'rust', group: 'TRIGGER', icon: 'icon-start', refs: ['src-tauri/src/commands/discord.rs › init_discord_rpc', 'src-tauri/src/main.rs › init_discord_rpc'] },

        { id: 'PRESENCE', kind: 'rust', group: 'CORE', icon: 'icon-message', refs: ['src-tauri/src/commands/discord.rs › set_discord_presence'] },
        { id: 'ENABLED', kind: 'decision', group: 'CORE', refs: ['src-tauri/src/commands/discord.rs › set_discord_presence', 'src-tauri/src/state.rs › discord_rpc_enabled'] },
        { id: 'CONNECT', kind: 'rust', group: 'CORE', icon: 'icon-link', refs: ['src-tauri/src/commands/discord.rs › DISCORD_CLIENT_ID', 'src-tauri/src/state.rs › discord_client'] },
        { id: 'LINKS', kind: 'data', group: 'CORE', icon: 'icon-file', refs: ['src-tauri/src/commands/discord.rs › load_rpc_links', 'src-tauri/src/commands/discord.rs › rpc_links_from_json', 'src-tauri/src/commands/discord.rs › REMOTE_LINKS_URL'] },
        { id: 'ACTIVITY', kind: 'rust', group: 'CORE', icon: 'icon-user', refs: ['src-tauri/src/commands/discord.rs › set_discord_presence', 'src-tauri/src/commands/security.rs › get_creator_id'] },
        { id: 'NONE', kind: 'outcome', group: 'CORE', icon: 'icon-stop', refs: ['src-tauri/src/commands/discord.rs › set_discord_presence'] },

        { id: 'CLIENT', kind: 'ext', group: 'DISCORD', icon: 'icon-message', refs: ['src-tauri/src/commands/discord.rs › DiscordIpcClient'] },
        { id: 'SHOWN', kind: 'outcome', group: 'DISCORD', icon: 'icon-check', refs: ['src-tauri/src/commands/discord.rs › set_discord_presence'] },
    ],
    edges: [
        { from: 'SETTING', to: 'INIT', label: 'toggle', tone: 'info' },
        { from: 'SETTING', to: 'EVENTS', label: 'ifOn', dashed: true },
        { from: 'INIT', to: 'PRESENCE', label: 'ifOn', tone: 'info' },
        { from: 'EVENTS', to: 'PRESENCE', thick: true },

        { from: 'PRESENCE', to: 'ENABLED', thick: true },
        { from: 'ENABLED', to: 'NONE', label: '~no', tone: 'warn' },
        { from: 'ENABLED', to: 'CONNECT', label: '~yes', tone: 'ok', thick: true },
        { from: 'CONNECT', to: 'CLIENT', label: 'ipc', dashed: true },
        { from: 'CONNECT', to: 'NONE', label: '~fail', tone: 'danger', dashed: true },
        { from: 'CONNECT', to: 'ACTIVITY', thick: true },
        { from: 'LINKS', to: 'ACTIVITY', label: '~reads', dashed: true },
        { from: 'ACTIVITY', to: 'CLIENT', label: 'setActivity', thick: true },
        { from: 'CLIENT', to: 'SHOWN', thick: true },
    ],
};
