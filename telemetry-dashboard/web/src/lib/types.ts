// Loose-but-helpful types for the stats payload the backend pushes over SSE.
export interface KV {
  k: string;
  v: number;
}
export interface Totals {
  users: number;
  events: number;
  sessions: number;
  pageviews: number;
  avg_session_min: number;
  pages_per_session: number;
  valid_repos: number;
  repo_connections: number;
  benchmarks: number;
  live: number;
}
export interface LiveInstance {
  creator_id: string;
  status: "online" | "away" | "offline" | "crashed";
  country?: string;
  cc?: string;
  version?: string;
  view?: string;
  fps?: number;
  ft?: number;
  heap?: number;
  ago_s: number;
  started_at?: number;
  session_id?: string;
  cpu?: string;
  gpu?: string;
  ram_gb?: number;
  os?: string;
  is_vm?: boolean;
}
export interface UserRow {
  creator_id: string;
  versions: string[];
  ips: string[];
  names: string[];
  country?: string;
  city?: string;
  region?: string;
  cc?: string;
  lat?: number;
  lon?: number;
  config: any;
  sessions: number;
  first_seen?: string;
  last_seen?: string;
  benchmarks: any[];
}
export interface PageRow {
  view: string;
  enters: number;
  avg_dwell_ms: number;
  lcp?: number;
  cls?: number;
  inp?: number;
  fcp?: number;
  ttfb?: number;
  fps?: number;
  ft?: number;
  events?: number;
}
export interface Stats {
  updated: number;
  totals: Totals;
  series: any[];
  activity_min: any[];
  events: { event: string; count: number }[];
  pages: PageRow[];
  pages_vitals: any[];
  funnels: { path: string; count: number }[];
  perf: any;
  geo: { country: string; count: number }[];
  country_cc: Record<string, string>;
  regions: { region: string; count: number }[];
  os: KV[];
  gpu: KV[];
  vm_count: number;
  repos: any[];
  map: { users: any[]; repos: any[] };
  retention: any[];
  themes: KV[];
  theme_kind: KV[];
  languages: KV[];
  tasky: any;
  modals: KV[];
  features: KV[];
  tutorial: KV[];
  webvitals: any;
  webvitals_series: any[];
  goals: any[];
  live: LiveInstance[];
  live_count: number;
  benchmarks_recent: any[];
  benchmarks_ops: any[];
  users: UserRow[];
  privacy: { retention_days: number; delete_delay_h: number; pending_deletions: number };
}
