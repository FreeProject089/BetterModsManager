import type { DiagramSpec } from '../diagram-spec.js';

// What BMM enforces at its trust boundaries today. The interface's own disk reach is the Tauri fs
// and asset:// scope set by fs_security_mode (main.rs › apply_fs_security_mode). Everything that
// arrives from outside is checked in Rust: bmm:// links (commands/link_guard.rs), the local API
// (api/mod.rs), custom pages (commands/custom_pages.rs), repository manifests and their files
// (commands/repo.rs › check_repo_signature) and app updates (commands/autoupdate.rs). Paths built
// from any of it go through fs_utils.rs › safe_relative_path.
export const securitySystem: DiagramSpec = {
    id: 'security-system',
    i18n: 'docs.diagram.security-system',
    category: 'integrity',
    dir: 'TB',
    article: 'security-system',
    related: ['custom-pages', 'integrity-engine', 'deeplinks', 'update-system'],
    groups: [
        { id: 'DISK' },
        { id: 'ENTRY', dir: 'LR' },
        { id: 'SIGNED' },
    ],
    nodes: [
        { id: 'UI', kind: 'ui', group: 'DISK', icon: 'icon-app', refs: ['frontend/src/ui/security-modal.ts › checkSecurityMode', 'src-tauri/src/commands/settings.rs › apply_fs_security_mode_command'] },
        { id: 'MODE', kind: 'decision', group: 'DISK', refs: ['src-tauri/src/main.rs › apply_fs_security_mode', 'src-tauri/src/state.rs › fs_security_mode'] },
        { id: 'FULL', kind: 'rust', group: 'DISK', icon: 'icon-unlock', refs: ['src-tauri/src/main.rs › apply_fs_security_mode'] },
        { id: 'LIMITED', kind: 'rust', group: 'DISK', icon: 'icon-lock', refs: ['src-tauri/src/main.rs › apply_fs_security_mode', 'src-tauri/src/commands/profile.rs › allow_directory'] },
        { id: 'PATHS', kind: 'rust', icon: 'icon-folder', refs: ['src-tauri/src/fs_utils.rs › safe_relative_path', 'src-tauri/src/fs_utils.rs › safe_folder_name'] },

        { id: 'OUTSIDE', kind: 'ext', icon: 'icon-globe', refs: ['src-tauri/src/commands/link_guard.rs', 'src-tauri/src/api/mod.rs'] },
        { id: 'LINKS', kind: 'rust', group: 'ENTRY', icon: 'icon-link', link: 'deeplinks', refs: ['src-tauri/src/commands/link_guard.rs › link_install_app', 'src-tauri/src/commands/link_guard.rs › path_refusal'] },
        { id: 'API', kind: 'rust', group: 'ENTRY', icon: 'icon-server', refs: ['src-tauri/src/api/mod.rs › host_allowed', 'src-tauri/src/api/mod.rs › ct_eq'] },
        { id: 'PAGES', kind: 'rust', group: 'ENTRY', icon: 'icon-layout', link: 'custom-pages', refs: ['src-tauri/src/commands/custom_pages.rs › require_cap_in', 'src-tauri/src/commands/custom_pages.rs › bmmpage_protocol'] },

        { id: 'REPO_SIG', kind: 'decision', group: 'SIGNED', refs: ['src-tauri/src/commands/repo.rs › check_repo_signature', 'src-tauri/src/commands/security.rs › verify_repo_signature', 'frontend/src/features/repo/repo-pin.ts › expectedRepoSignature'] },
        { id: 'REPO_HASH', kind: 'rust', group: 'SIGNED', icon: 'icon-verify', refs: ['src-tauri/src/commands/repo.rs › sync_server_repo', 'src-tauri/src/commands/repo.rs › compute_file_hash_and_chunks'] },
        { id: 'UPDATE', kind: 'decision', group: 'SIGNED', refs: ['src-tauri/src/commands/autoupdate.rs › verify_manifest_text', 'src-tauri/src/commands/autoupdate.rs › MANIFEST_PUBLIC_KEY_HEX'] },
        { id: 'INSTALLER', kind: 'rust', group: 'SIGNED', icon: 'icon-download', refs: ['src-tauri/src/commands/autoupdate.rs › installer_for', 'src-tauri/src/commands/autoupdate.rs › check_installer_bytes', 'src-tauri/src/commands/autoupdate.rs › download_and_install_update'] },

        { id: 'REFUSED', kind: 'outcome', icon: 'icon-stop', refs: ['src-tauri/src/commands/repo.rs › check_repo_signature', 'src-tauri/src/commands/autoupdate.rs › verify_manifest_text'] },
    ],
    edges: [
        { from: 'UI', to: 'MODE', thick: true },
        { from: 'MODE', to: 'FULL', label: 'full', tone: 'warn' },
        { from: 'MODE', to: 'LIMITED', label: 'limited', tone: 'ok' },
        { from: 'PATHS', to: 'REFUSED', label: 'escape', tone: 'danger' },
        { from: 'LINKS', to: 'PATHS', label: 'paths', dashed: true },
        { from: 'REPO_HASH', to: 'PATHS', label: 'paths', dashed: true },
        { from: 'INSTALLER', to: 'PATHS', label: 'paths', dashed: true },

        { from: 'OUTSIDE', to: 'LINKS', label: 'link' },
        { from: 'OUTSIDE', to: 'API', label: 'http' },
        { from: 'OUTSIDE', to: 'PAGES', label: 'page' },
        { from: 'OUTSIDE', to: 'REPO_SIG', label: 'manifest', thick: true },
        { from: 'OUTSIDE', to: 'UPDATE', label: 'release', thick: true },
        { from: 'LINKS', to: 'REFUSED', label: '~refused', tone: 'danger', dashed: true },
        { from: 'API', to: 'REFUSED', label: '~refused', tone: 'danger', dashed: true },
        { from: 'PAGES', to: 'REFUSED', label: '~refused', tone: 'danger', dashed: true },

        { from: 'REPO_SIG', to: 'REPO_HASH', label: 'validOrUnsigned', tone: 'ok', thick: true },
        { from: 'REPO_SIG', to: 'REFUSED', label: '~invalid', tone: 'danger' },
        { from: 'REPO_HASH', to: 'REFUSED', label: 'mismatch', tone: 'danger' },
        { from: 'UPDATE', to: 'INSTALLER', label: '~valid', tone: 'ok', thick: true },
        { from: 'UPDATE', to: 'REFUSED', label: '~invalid', tone: 'danger' },
        { from: 'INSTALLER', to: 'REFUSED', label: 'notListed', tone: 'danger' },
    ],
};
