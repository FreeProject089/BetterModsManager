/**
 * models.ts — TypeScript interfaces mirroring Rust backend models
 * Keep in sync with src-tauri/src/models/ and src-tauri/src/state.rs
 */

// ── Profile ──────────────────────────────────────────────

export interface Profile {
  id: string;
  name: string;
  game_name: string;
  game_path: string;
  mods_path: string;
  backup_path: string;
  active_mods: string[];
  color: string | null;
  icon: string | null;
  background_image: string | null;
  created_at: string;
  origin_repo_profile_id: string | null;
}

export interface ProfilePayload {
  name: string;
  gameName: string;
  gamePath: string;
  modsPath: string;
  backupPath: string;
  color?: string | null;
  icon?: string | null;
}

// ── Mod Entry ────────────────────────────────────────────

export type ModStatus = 'Enabled' | 'Disabled' | { Error: string };
export type ConflictCategory = 'Intra' | 'Inter';
export type ConflictStatus = 'Active' | 'Potential';

export interface ConflictReport {
  category: ConflictCategory;
  status: ConflictStatus;
  other_mod_id: string;
  other_mod_name: string;
  other_profile_name: string;
  file_count: number;
  activation_order: number;
}

export interface DownloadLink {
  url: string;
  link_type: string;
  label: string;
}

export interface ModEntry {
  id: string;
  name: string;
  version: string;
  author: string | null;
  description: string | null;
  dependencies: string[];
  enabled: boolean;
  conflicts: ConflictReport[];
  mod_folder_path: string;
  status: ModStatus;
  added_at: string;
  installed_files: string[];
  download_links: DownloadLink[];
  tags: string[];
  install_notes: string;
  activation_order: number;
  cached_files: string[] | null;
  last_scan_mtime: number;
  file_hashes: Record<string, string> | null;
}

export interface EnrichedMod extends ModEntry {
  shared_activations: SharedActivation[];
}

export interface SharedActivation {
  profile_name: string;
  game_path: string;
  active: boolean;
}

// ── Tags ─────────────────────────────────────────────────

export interface TagDef {
  id: string;
  name: string;
  color: string;
  icon: string;
}

// ── History ──────────────────────────────────────────────

export interface ActivityEvent {
  mod_id: string;
  mod_name: string;
  action: string;
  timestamp: string;
}

// ── Settings ─────────────────────────────────────────────

export interface AppSettings {
  language: string;
  github_token: string;
  shortcuts: Record<string, string>;
  onboarding_shown: boolean;
  last_seen_crash: string | null;
  auto_io_calibration: boolean;
  storage_alert_enabled: boolean;
  storage_warning_space_pct: number;
  storage_critical_space_pct: number;
  current_filter: string;
  current_sort_by: string;
  last_session_clean: boolean;
  auto_fill_metadata: boolean;
  cloudflared_path: string | null;
  discord_rpc_enabled: boolean;
}

// ── ModList (.MM format) ─────────────────────────────────

export interface ModList {
  format_version: string;
  name: string;
  description: string | null;
  game_name: string;
  game_path_hint: string;
  author: string | null;
  created_at: string;
  mods: ModListEntry[];
}

export interface ModListEntry {
  name: string;
  version: string;
  author: string | null;
  description: string | null;
  download_links: DownloadLink[];
  sort_priority: number;
  file_tree: ModFileEntry[];
  install_notes: string;
  tags: string[];
}

export interface ModFileEntry {
  relative_path: string;
  is_directory: boolean;
  size: number;
}

// ── Repo ─────────────────────────────────────────────────

export interface ServerRepo {
  name: string;
  description: string | null;
  author: string | null;
  author_id: string | null;
  signature: string | null;
  version: string;
  game_name: string;
  created_at: string;
  seed: string | null;
  upload_limit: number | null;
  profiles: RepoProfile[];
}

export interface RepoProfile {
  id: string;
  name: string;
  game_name: string;
  mods: RepoMod[];
}

export interface RepoMod {
  id: string;
  name: string;
  version: string;
  author: string | null;
  description: string | null;
  tags: RepoTag[];
  files: RepoFile[];
  download_links: DownloadLink[];
}

export interface RepoTag {
  id: string;
  name: string;
  color_bg: string;
  color_text: string;
}

export interface RepoFile {
  relative_path: string;
  size: number;
  sha256_hash: string;
  chunks: RepoChunk[] | null;
}

export interface RepoChunk {
  size: number;
  sha256_hash: string;
}

// ── Disk / Benchmark ─────────────────────────────────────

export interface DiskInfo {
  name: string;
  mount_point: string;
  total_space: number;
  available_space: number;
  used_space: number;
  disk_type: string;
  is_removable: boolean;
}

export interface BenchmarkResult {
  disk_name: string;
  read_speed_mbps: number;
  write_speed_mbps: number;
  iops: number;
  timestamp: string;
}

// ── Crash ────────────────────────────────────────────────

export interface CrashReport {
  id: string;
  timestamp: string;
  log_content: string;
  app_version: string;
  os_info: string;
}

// ── Update ───────────────────────────────────────────────

export interface UpdateInfo {
  version: string;
  notes: string;
  pub_date: string;
  url: string;
}

// ── Modpack System ────────────────────────────────────────────────────────────

export type DependencyMode = 'all' | 'none' | 'manual';

export interface ModpackFileRef {
  relative_path: string;
  sha256: string;
  size: number;
}

export interface ModpackModRef {
  mod_id: string;
  mod_name: string;
  mod_version: string;
  profile_id: string | null;
  profile_name: string | null;
  /** SHA-256 of the mod's primary/first file for cross-PC identification */
  sha256: string;
  file_manifest: ModpackFileRef[];
  include_dependencies: boolean;
  download_link: string | null;
  fallback_link: string | null;
  fallback_type: 'direct' | 'sr' | null;
}

export interface LocalModpack {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  multi_profile: boolean;
  dependency_mode: DependencyMode;
  mods: ModpackModRef[];
  sr_link: string | null;
  game_name: string | null;
}

// ── Server Repo Notification Payloads ────────────────────────────────────────

export interface ServerClientConnectedPayload {
  ip: string;
  creator_id: string | null;
  protocol: 'Local' | 'LAN' | 'WAN';
}

export interface ServerDownloadStartedPayload {
  ip: string;
  creator_id: string | null;
  file: string;
  total_size: number;
  protocol: 'Local' | 'LAN' | 'WAN';
}

export interface ServerDownloadFinishedPayload {
  ip: string;
  creator_id: string | null;
  file: string;
  total_size: number;
  protocol: 'Local' | 'LAN' | 'WAN';
}

export interface FileTreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileTreeNode[] | null;
}
