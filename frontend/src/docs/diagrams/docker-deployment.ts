import type { DiagramSpec } from '../diagram-spec.js';

// Running a standalone repo server in Docker. BMM does not run Docker itself: with "Docker"
// ticked, generate_mini_server_files (repo.rs) writes a Dockerfile picked from four templates
// (Node server or script server, Linux or Windows host), a docker-compose.yml and a private
// .env holding ADMIN_PASSWORD (docker_export.rs) next to repo.json. The owner then runs
// `docker compose up -d` on the machine that will serve the repo.
export const dockerDeployment: DiagramSpec = {
    id: 'docker-deployment',
    i18n: 'docs.diagram.docker-deployment',
    category: 'sharing',
    dir: 'TB',
    article: 'docker-deployment',
    related: ['hosting-flow', 'server-mode'],
    groups: [
        { id: 'BMM', dir: 'LR' },
        { id: 'FILES', dir: 'LR' },
        { id: 'HOST' },
    ],
    nodes: [
        { id: 'CARD', kind: 'ui', group: 'BMM', icon: 'icon-settings', refs: ['frontend/src/features/repo/repo-server.ts › initRepoServer', 'frontend/src/features/repo/repo.ts › initRepo'] },
        { id: 'GEN', kind: 'rust', group: 'BMM', icon: 'icon-build', refs: ['src-tauri/src/commands/repo.rs › generate_standalone_server', 'src-tauri/src/commands/repo.rs › generate_mini_server_files', 'src-tauri/src/commands/repo.rs › MiniServerExportOptions'] },
        { id: 'KIND', kind: 'decision', group: 'BMM', refs: ['src-tauri/src/commands/repo.rs › generate_mini_server_files'] },

        { id: 'SERVER', kind: 'data', group: 'FILES', icon: 'icon-script', refs: ['src-tauri/src/templates/mini-server/server.express.js.template', 'src-tauri/src/templates/mini-server/server.v2.sh.template', 'src-tauri/src/commands/repo.rs › write_access_starter'] },
        { id: 'DOCKERFILE', kind: 'data', group: 'FILES', icon: 'icon-box', refs: ['src-tauri/src/templates/docker/Dockerfile.server.linux.template', 'src-tauri/src/templates/docker/Dockerfile.linux.template', 'src-tauri/src/templates/docker/Dockerfile.server.windows.template'] },
        { id: 'COMPOSE', kind: 'data', group: 'FILES', icon: 'icon-file', refs: ['src-tauri/src/templates/docker/docker-compose.server.yml.template', 'src-tauri/src/templates/docker/docker-compose.yml.template'] },
        { id: 'ENV', kind: 'data', group: 'FILES', icon: 'icon-key', refs: ['src-tauri/src/commands/docker_export.rs › write_docker_files', 'src-tauri/src/commands/docker_export.rs › env_line'] },

        { id: 'UP', kind: 'ext', group: 'HOST', icon: 'icon-terminal', refs: ['src-tauri/src/templates/docker/docker-compose.server.yml.template'] },
        { id: 'VOLUMES', kind: 'data', group: 'HOST', icon: 'icon-folder', refs: ['src-tauri/src/templates/docker/docker-compose.yml.template'] },
        { id: 'CONTAINER', kind: 'ext', group: 'HOST', icon: 'icon-server', refs: ['src-tauri/src/templates/docker/Dockerfile.server.linux.template', 'src-tauri/src/templates/mini-server/server.express.js.template'] },
        { id: 'EXPOSE', kind: 'ext', group: 'HOST', icon: 'icon-globe', refs: ['src-tauri/src/templates/docker/docker-compose.yml.template'] },

        { id: 'CLIENTS', kind: 'outcome', icon: 'icon-users', link: 'server-mode', refs: ['src-tauri/src/commands/repo.rs › sync_server_repo'] },
    ],
    edges: [
        { from: 'CARD', to: 'GEN', thick: true },
        { from: 'GEN', to: 'SERVER', label: '~writes' },
        { from: 'GEN', to: 'KIND', label: 'docker', thick: true },
        { from: 'KIND', to: 'DOCKERFILE', thick: true },
        { from: 'KIND', to: 'COMPOSE' },
        { from: 'KIND', to: 'ENV' },
        { from: 'SERVER', to: 'UP' },
        { from: 'DOCKERFILE', to: 'UP', label: 'build', thick: true },
        { from: 'COMPOSE', to: 'UP' },
        { from: 'ENV', to: 'UP', label: 'envFile', dashed: true },
        { from: 'COMPOSE', to: 'VOLUMES', label: 'mounts', dashed: true },
        { from: 'UP', to: 'CONTAINER', thick: true },
        { from: 'VOLUMES', to: 'CONTAINER', dashed: true },
        { from: 'CONTAINER', to: 'EXPOSE', thick: true },
        { from: 'EXPOSE', to: 'CLIENTS', thick: true },
    ],
};
