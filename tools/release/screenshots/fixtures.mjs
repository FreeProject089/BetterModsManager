// Demo data for the README / release screenshots. Everything here is invented (example.org
// addresses, « Demo » user paths): no real profile, path, account or e-mail ever reaches a picture.
// The app's own browser mock (frontend/assets/mock-fixtures.json) answers invoke(); this file
// overrides and extends it in flight.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const FE = fileURLToPath(new URL('../../../frontend/', import.meta.url)).replace(/\\/g, '/');
// The shipped fixture stores paths with doubled backslashes; show them as a user would see them.
const fixPaths = (o) => JSON.parse(JSON.stringify(o).split('\\\\\\\\').join('\\\\'));
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
export function buildFixtures(base, { lang, version, frontend = null }) {
  const f = fixPaths(structuredClone(base));
  f.get_settings = { ...f.get_settings, language: lang, fs_security_mode: 'limited' };
  f.is_auto_eula_enabled = false;
  f.get_analytics_consent = false;
  f.get_app_version = version;
  f.ai_get_settings = { enabled: false, classifier: 'off', classifier_chosen: false, generative: 'off', mod_suggest: true, report_triage: true, description_drafts: true, ask: true, ask_generate: false, gen_local_url: 'http://127.0.0.1:11434/v1', gen_local_model: '', local_url: 'http://127.0.0.1:8765', local_allow_remote: false, external_url: '', external_model: '', bc_consent: false, timeout_ms: 20000, installer_choice: null, laya: {} };
  const dir = (frontend ? frontend.replace(/\\/g, '/').replace(/\/?$/, '/') : FE) + 'assets/builtin-themes/';
  f.list_builtin_themes = JSON.stringify(readdirSync(dir).filter(n => n.endsWith('.json')).sort().map(n => JSON.parse(readFileSync(dir + n, 'utf8'))));
  f.get_tags = [
    ...f.get_tags,
    { id: 'hd', name: 'hd', color: '#6366f1' },
    { id: 'weather', name: 'weather', color: '#0ea5e9' },
    { id: 'lighting', name: 'lighting', color: '#eab308' },
    { id: 'quality-of-life', name: 'quality-of-life', color: '#22c55e' },
    { id: 'ai', name: 'ai', color: '#ec4899' },
  ];
  f.get_repo_server_status = { port: 8000, lan_url: 'http://192.168.1.20:8000/repo.json', public_url: null, tunnel_url: null, upnp_success: false };
  f.repo_follow_list = [
    { url: 'https://mods.example.org/repo.json', name: 'Community Pack', due: false,
      follow: { enabled: true, interval_min: 360, action: 'notify', last_check: iso(42), last_version: '3.2.0', last_updates: 2, last_error: null } },
  ];
  const app = (id, title, description, category, price, tags, version, extra = {}) => ({
    id, title, description, md_link: null, category, price, tags, version, requirements: 'Windows 10/11',
    images: null, download: { url: `https://example.org/downloads/${id}.zip`, file_type: 'zip', size: 12400000, sha256: '9f2c4e1a7b3d5f60c8a2e4b6d8f0a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5' },
    official: true, partner: false, source_label: 'Official', ...extra,
  });
  f.fetch_app_catalogs = {
    apps: [
      app('texture-optimizer', 'Texture Optimizer', 'Batch-converts and compresses texture folders so large packs load faster.', 'utility', 'oss', ['textures', 'performance'], '2.3.0'),
      app('save-keeper', 'Save Keeper', 'Snapshots your save folders before a play session and restores them in one click.', 'utility', 'free', ['saves', 'backup'], '1.8.1'),
      app('shader-cache-cleaner', 'Shader Cache Cleaner', 'Clears stale shader caches after a driver or game update.', 'utility', 'free', ['cleanup'], '0.9.4'),
      app('load-order-helper', 'Load Order Helper', 'Reads plugin headers and suggests a sensible load order.', 'utility', 'oss', ['load-order'], '4.1.0'),
      app('screenshot-studio', 'Screenshot Studio', 'Captures, tags and compares in-game screenshots side by side.', 'other', 'freemium', ['screenshots'], '3.0.2'),
      app('config-editor', 'Config Editor', 'A safe editor for INI and JSON game settings, with diff and undo.', 'utility', 'free', ['config'], '1.2.0'),
      app('frame-monitor', 'Frame Monitor', 'A small overlay for frame time and CPU/GPU load while you test mods.', 'utility', 'oss', ['performance'], '5.0.0'),
      app('demo-game-launcher', 'Demo Game Launcher', 'Starts the demo game with a chosen profile and command-line options.', 'game', 'free', ['launcher'], '1.0.0'),
    ],
    sources_loaded: ['official'], sources_failed: [],
  };
  f.get_apps_state = {
    installed: {
      'save-keeper': { id: 'save-keeper', title: 'Save Keeper', install_path: 'C:\\Users\\Demo\\Apps\\save-keeper', exe_path: 'C:\\Users\\Demo\\Apps\\save-keeper\\SaveKeeper.exe', installed_at: iso(60 * 24 * 9), version: '1.8.1', usage_seconds: 5400, category: 'utility', thumb: null, is_managed: true, uninstaller: null },
      'config-editor': { id: 'config-editor', title: 'Config Editor', install_path: 'C:\\Users\\Demo\\Apps\\config-editor', exe_path: 'C:\\Users\\Demo\\Apps\\config-editor\\ConfigEditor.exe', installed_at: iso(60 * 24 * 30), version: '1.1.0', usage_seconds: 1200, category: 'utility', thumb: null, is_managed: true, uninstaller: null },
    },
    favorites: ['texture-optimizer'], history: [], community_sources: [],
  };
  const mods = f.get_all_mods;
  const sizes = [1820, 960, 140, 64, 410, 730, 220];
  const sized = (m) => ({ id: m.id, name: m.name, path: m.mod_folder_path || '', bytes: sizes[mods.indexOf(m) % 7] * 1048576 });
  f.tools_disk_usage = {
    profiles: (f.get_profiles || []).map((p, pi) => {
      const list = mods.filter(m => pi === 0 ? p.active_mods.includes(m.id) : true).map(sized).sort((a, b) => b.bytes - a.bytes);
      const tot = list.reduce((s, x) => s + x.bytes, 0);
      return { id: p.id, name: p.name, mods_path: p.mods_path, mods_bytes: tot, backup_path: p.backup_path, backup_bytes: Math.round(tot * 0.18), mods: list };
    }),
    app_data_path: 'C:\\Users\\Demo\\AppData\\Roaming\\BetterModManager',
    app_data: [
      { id: 'cache', name: 'cache', path: '', bytes: 312 * 1048576 },
      { id: 'backups', name: 'backups', path: '', bytes: 96 * 1048576 },
      { id: 'logs', name: 'logs', path: '', bytes: 18 * 1048576 },
    ],
    total_bytes: 0, cancelled: false,
  };
  f.tools_disk_usage.total_bytes = f.tools_disk_usage.profiles.reduce((s, p) => s + p.mods_bytes + p.backup_bytes, 0) + 426 * 1048576;
  return f;
}
