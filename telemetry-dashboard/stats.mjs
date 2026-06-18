// Derives the full dashboard payload from the events DB (pure SQL + light JS).
import { db, geoOf, isPrivateHost, live, pendingDeletionCount, retentionCohorts, listGoals } from './db.mjs';

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function gpuVendor(g) {
  const l = (g || '').toLowerCase();
  if (/(nvidia|geforce|rtx|gtx|quadro)/.test(l)) return 'NVIDIA';
  if (/(radeon|amd|firepro)/.test(l)) return 'AMD';
  if (/(intel|iris|uhd)/.test(l)) return 'Intel';
  return g ? 'Other' : 'Unknown';
}
function osFamily(o) {
  const l = (o || '').toLowerCase();
  if (l.includes('windows 11')) return 'Windows 11';
  if (l.includes('windows 10')) return 'Windows 10';
  if (l.includes('windows')) return 'Windows';
  if (l.includes('mac')) return 'macOS';
  if (l.includes('linux')) return 'Linux';
  return o || 'Unknown';
}
const tally = (rows) => Object.entries(rows.reduce((m, k) => (k && (m[k] = (m[k] || 0) + 1), m), {}))
  .map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);

export function computeStats(cfg) {
  // ── Per-user assembly ───────────────────────────────────────────────────────
  const users = {};
  const U = (id) => users[id] || (users[id] = { creator_id: id, config: {}, versions: [], names: [], ips: [], sessions: 0, session_ms: 0, first_seen: null, last_seen: null, benchmarks: [] });

  // latest $identify per user → config
  for (const row of db.prepare(`SELECT distinct_id, props FROM events WHERE event='$identify' ORDER BY ts_ms ASC`).all()) {
    const u = U(row.distinct_id);
    let s = {}; try { s = (JSON.parse(row.props).$set) || {}; } catch {}
    u.config = {
      os: s.os_caption || s.os, cpu: s.cpu, cores: s.cpu_cores, ram_gb: s.ram_gb,
      gpu: s.gpu, gpus: s.gpus, is_vm: s.is_vm, disk_count: s.disk_count, disk_total_gb: s.disk_total_gb,
      disks: s.disks, locale: s.locale, motherboard: s.motherboard, profiles: s.profiles_summary, private_ip: s.private_ip,
      // BMM-specific
      theme: s.theme, theme_kind: s.theme_kind, tasky: s.tasky,
    };
    if (s.app_version && !u.versions.includes(s.app_version)) u.versions.push(s.app_version);
    if (s.public_ip && !u.ips.includes(s.public_ip)) u.ips.push(s.public_ip);
    u._ip = s.public_ip || u._ip;
  }
  // session counts + spans
  for (const row of db.prepare(`SELECT distinct_id, MIN(ts) fs, MAX(ts) ls,
      SUM(event='session_start') ss, SUM(CASE WHEN event='session_end' THEN COALESCE(json_extract(props,'$.duration_sec'),0) ELSE 0 END) secs
      FROM events GROUP BY distinct_id`).all()) {
    const u = U(row.distinct_id); u.first_seen = row.fs; u.last_seen = row.ls; u.sessions = row.ss || 0; u.session_ms = (row.secs || 0) * 1000;
  }
  // creator names
  for (const row of db.prepare(`SELECT distinct_id, json_extract(props,'$.creator_name') nm FROM events WHERE nm IS NOT NULL`).all()) {
    const u = U(row.distinct_id); const n = String(row.nm).slice(0, 25); if (!u.names.includes(n)) u.names.push(n);
  }
  // benchmarks (last 3 per user)
  for (const b of db.prepare(`SELECT distinct_id, ts, total_ms, dataset_bytes, source, ops FROM benchmarks ORDER BY ts_ms DESC`).all()) {
    const u = U(b.distinct_id); if (u.benchmarks.length < 3) { let ops = {}; try { ops = JSON.parse(b.ops); } catch {} u.benchmarks.push({ ts: b.ts, total_ms: b.total_ms, dataset_bytes: b.dataset_bytes, source: b.source, ops }); }
  }
  for (const u of Object.values(users)) u.geo = geoOf(u._ip);

  const uArr = Object.values(users);
  const totSessions = uArr.reduce((s, u) => s + u.sessions, 0);
  const totSessMs = uArr.reduce((s, u) => s + u.session_ms, 0);

  // ── Totals ──────────────────────────────────────────────────────────────────
  const evTotal = db.prepare(`SELECT COUNT(*) n FROM events`).get().n;
  const pageviews = db.prepare(`SELECT COUNT(*) n FROM events WHERE event='page_enter'`).get().n;
  const benchTotal = db.prepare(`SELECT COUNT(*) n FROM benchmarks`).get().n;

  // ── 24h series ──────────────────────────────────────────────────────────────
  const since = Date.now() - 24 * 3600000;
  const sMap = {};
  for (const r of db.prepare(`SELECT substr(ts,1,13) hr, COUNT(*) events, SUM(event='session_start') sessions, SUM(event='page_enter') pageviews FROM events WHERE ts_ms>=? GROUP BY hr`).all(since))
    sMap[r.hr] = { hour: r.hr, events: r.events, sessions: r.sessions || 0, pageviews: r.pageviews || 0, users: 0 };
  for (const r of db.prepare(`SELECT substr(ts,1,13) hr, COUNT(DISTINCT distinct_id) users FROM events WHERE ts_ms>=? GROUP BY hr`).all(since))
    if (sMap[r.hr]) sMap[r.hr].users = r.users;
  const series = Object.values(sMap).sort((a, b) => a.hour.localeCompare(b.hour)).slice(-24);

  // ── Events / pages / funnels / perf ─────────────────────────────────────────
  const events = db.prepare(`SELECT event, COUNT(*) count FROM events GROUP BY event ORDER BY count DESC`).all().map(r => ({ event: r.event, count: r.count }));
  const enters = db.prepare(`SELECT json_extract(props,'$.view') view, COUNT(*) enters FROM events WHERE event='page_enter' GROUP BY view`).all();
  const dwell = db.prepare(`SELECT json_extract(props,'$.view') view, AVG(json_extract(props,'$.dwell_ms')) d FROM events WHERE event='page_leave' GROUP BY view`).all();
  const dwellMap = Object.fromEntries(dwell.map(d => [d.view, d.d]));
  const pages = enters.filter(e => e.view).map(e => ({ view: e.view, enters: e.enters, avg_dwell_ms: Math.round(dwellMap[e.view] || 0) })).sort((a, b) => b.enters - a.enters);
  const funnels = db.prepare(`SELECT json_extract(props,'$.from') f, json_extract(props,'$.view') v, COUNT(*) c FROM events WHERE event='page_enter' AND f IS NOT NULL GROUP BY f,v ORDER BY c DESC LIMIT 20`).all().map(r => ({ path: `${r.f}→${r.v}`, count: r.c }));
  const pf = db.prepare(`SELECT AVG(json_extract(props,'$.fps_avg')) fps, AVG(json_extract(props,'$.frametime_avg_ms')) ft, MAX(json_extract(props,'$.frametime_worst_ms')) worst, AVG(json_extract(props,'$.js_heap_mb')) heap FROM events WHERE event='perf'`).get();
  const byView = db.prepare(`SELECT json_extract(props,'$.view') view, AVG(json_extract(props,'$.fps_avg')) fps, AVG(json_extract(props,'$.frametime_avg_ms')) ft, COUNT(*) n FROM events WHERE event='perf' GROUP BY view`).all().filter(r => r.view).map(r => ({ view: r.view, fps: r1(r.fps), ft: r2(r.ft), n: r.n })).sort((a, b) => a.fps - b.fps);

  // ── Repos (public only) ─────────────────────────────────────────────────────
  const repos = db.prepare(`SELECT lower(json_extract(props,'$.host')) host, COUNT(*) count, MAX(json_extract(props,'$.url')) sample_url, MAX(json_extract(props,'$.repo_name')) repo_name, MAX(ts) last_seen FROM events WHERE event='repo_connect' GROUP BY host`).all()
    .filter(r => r.host && !isPrivateHost(r.host)).map(r => ({ ...r, geo: geoOf(r.host) })).sort((a, b) => b.count - a.count);

  // ── Geo / hardware / benchmarks ─────────────────────────────────────────────
  const countryTally = tally(uArr.map(u => u.geo?.country).filter(Boolean));
  const country_cc = {}; for (const u of uArr) if (u.geo?.cc) country_cc[u.geo.country] = u.geo.cc;
  const regions = tally(uArr.map(u => u.geo?.region ? `${u.geo.country} · ${u.geo.region}` : null).filter(Boolean)).slice(0, 12).map(x => ({ region: x.k, count: x.v }));
  const os = tally(uArr.map(u => osFamily(u.config.os)));
  const gpu = tally(uArr.map(u => gpuVendor(u.config.gpu)));
  const vm_count = uArr.filter(u => u.config.is_vm).length;

  const benchRows = db.prepare(`SELECT distinct_id, ts, total_ms, source, ops FROM benchmarks ORDER BY ts_ms DESC LIMIT 200`).all();
  const benchmarks_recent = benchRows.slice(0, 60).map(b => { let ops = {}; try { ops = JSON.parse(b.ops); } catch {} return { creator_id: b.distinct_id, ts: b.ts, total_ms: b.total_ms, source: b.source, ops }; });
  const opSum = {}, opN = {};
  for (const b of benchRows) { let ops = {}; try { ops = JSON.parse(b.ops); } catch {} for (const [k, v] of Object.entries(ops)) { opSum[k] = (opSum[k] || 0) + Number(v); opN[k] = (opN[k] || 0) + 1; } }
  const benchmarks_ops = Object.keys(opSum).map(k => ({ op: k, avg_ms: r2(opSum[k] / opN[k]), n: opN[k] })).sort((a, b) => b.avg_ms - a.avg_ms);

  // ── Live instances ──────────────────────────────────────────────────────────
  const now = Date.now();
  const liveArr = [...live.values()].filter(l => now - (l.last_seen || 0) < 180000).map(l => {
    const g = geoOf(l.public_ip);
    return { creator_id: l.creator_id, country: g?.country, cc: g?.cc, version: l.version, view: l.view, fps: l.fps, ft: l.ft, heap: l.heap, ago_s: Math.round((now - l.last_seen) / 1000), cpu: l.cpu, gpu: l.gpu, ram_gb: l.ram_gb, os: l.os, is_vm: l.is_vm };
  }).sort((a, b) => a.ago_s - b.ago_s);

  // Map points — APPROXIMATE only: round lat/lon to ~0.25° + jitter so no precise
  // home location is ever shown. City-level at most, aggregated by cell.
  const approx = (v) => Math.round(v * 4) / 4 + (Math.random() - 0.5) * 0.15;
  const cell = (lat, lon) => `${Math.round(lat * 2) / 2},${Math.round(lon * 2) / 2}`;
  const cluster = (rows, kind) => {
    const m = {};
    for (const r of rows) { const k = cell(r.geo.lat, r.geo.lon); (m[k] || (m[k] = { lat: r.geo.lat, lon: r.geo.lon, country: r.geo.country, count: 0 })).count++; }
    return Object.values(m).map(c => ({ lat: approx(c.lat), lon: approx(c.lon), country: c.country, count: c.count, kind }));
  };
  const map = {
    users: cluster(uArr.filter(u => u.geo?.lat != null), 'user'),
    repos: repos.filter(r => r.geo?.lat != null).map(r => ({ lat: approx(r.geo.lat), lon: approx(r.geo.lon), country: r.geo.country, host: r.host, count: r.count, kind: 'repo' })),
  };

  // Per-MINUTE activity for the last 60 minutes (precise, not hourly).
  const minSince = Date.now() - 60 * 60000;
  const minMap = {};
  for (let i = 59; i >= 0; i--) { const d = new Date(Date.now() - i * 60000); minMap[d.toISOString().slice(0, 16)] = { t: d.toISOString().slice(11, 16), events: 0, users: 0, pageviews: 0, sessions: 0 }; }
  for (const r of db.prepare(`SELECT substr(ts,1,16) m, COUNT(*) e, SUM(event='page_enter') pv, SUM(event='session_start') ss FROM events WHERE ts_ms>=? GROUP BY m`).all(minSince))
    if (minMap[r.m]) { minMap[r.m].events = r.e; minMap[r.m].pageviews = r.pv || 0; minMap[r.m].sessions = r.ss || 0; }
  for (const r of db.prepare(`SELECT substr(ts,1,16) m, COUNT(DISTINCT distinct_id) u FROM events WHERE ts_ms>=? GROUP BY m`).all(minSince))
    if (minMap[r.m]) minMap[r.m].users = r.u;
  const activity_min = Object.values(minMap);

  // ── BMM-specific aggregations ───────────────────────────────────────────────
  const themes = tally(uArr.map(u => u.config.theme).filter(Boolean));
  const theme_kind = tally(uArr.map(u => u.config.theme_kind).filter(Boolean));
  const languages = tally(uArr.map(u => u.config.locale).filter(Boolean));
  const tasky = {
    visible: uArr.filter(u => u.config.tasky?.visible).length,
    hidden: uArr.filter(u => u.config.tasky && u.config.tasky.visible === false).length,
    animations: uArr.filter(u => u.config.tasky?.animations).length,
    tooltips: uArr.filter(u => u.config.tasky?.tooltips).length,
  };
  const jx = (col) => `json_extract(props,'$.${col}')`;
  // Web vitals (BMM WebView, app-level + per entry view).
  const wv = db.prepare(`SELECT AVG(json_extract(props,'$.lcp')) lcp, AVG(json_extract(props,'$.cls')) cls, AVG(json_extract(props,'$.inp')) inp, AVG(json_extract(props,'$.fcp')) fcp, AVG(json_extract(props,'$.ttfb')) ttfb, COUNT(*) n FROM events WHERE event='webvitals'`).get();
  const webvitals = { lcp: r2(wv?.lcp), cls: Math.round((wv?.cls || 0) * 1000) / 1000, inp: r2(wv?.inp), fcp: r2(wv?.fcp), ttfb: r2(wv?.ttfb), n: wv?.n || 0 };

  const modals = db.prepare(`SELECT ${jx('name')} k, COUNT(*) v FROM events WHERE event='modal_open' AND k IS NOT NULL GROUP BY k ORDER BY v DESC LIMIT 30`).all().map(r => ({ k: r.k, v: r.v }));
  const features = db.prepare(`SELECT ${jx('name')} k, COUNT(*) v FROM events WHERE event='feature' AND k IS NOT NULL GROUP BY k ORDER BY v DESC LIMIT 40`).all().map(r => ({ k: r.k, v: r.v }));
  const tutorial = db.prepare(`SELECT ${jx('id')} k, COUNT(*) v FROM events WHERE event='tutorial' AND k IS NOT NULL GROUP BY k ORDER BY v DESC LIMIT 30`).all().map(r => ({ k: r.k, v: r.v }));

  return {
    totals: {
      users: uArr.length, events: evTotal, sessions: totSessions, pageviews,
      avg_session_min: totSessions ? r1(totSessMs / totSessions / 60000) : 0,
      pages_per_session: totSessions ? r1(pageviews / totSessions) : 0,
      valid_repos: repos.length, repo_connections: repos.reduce((s, r) => s + r.count, 0), benchmarks: benchTotal,
    },
    series, events, pages, funnels,
    perf: { fps_avg: r1(pf?.fps), frametime_avg_ms: r2(pf?.ft), frametime_worst_ms: r2(pf?.worst), heap_avg_mb: r1(pf?.heap), byView },
    geo: countryTally.map(x => ({ country: x.k, count: x.v })), country_cc, regions,
    os, gpu, vm_count,
    repos, map, activity_min,
    retention: retentionCohorts(8),
    themes, theme_kind, languages, tasky, modals, features, tutorial,
    webvitals, goals: listGoals(),
    live: liveArr, live_count: liveArr.length,
    benchmarks_recent, benchmarks_ops,
    users: uArr.map(u => ({
      creator_id: u.creator_id, versions: u.versions, ips: u.ips, names: u.names,
      country: u.geo?.country, city: u.geo?.city, region: u.geo?.region, cc: u.geo?.cc,
      config: u.config, sessions: u.sessions, first_seen: u.first_seen, last_seen: u.last_seen, benchmarks: u.benchmarks,
    })).sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen))),
    privacy: { retention_days: cfg.RETENTION_DAYS, delete_delay_h: cfg.DELETE_DELAY_H, pending_deletions: pendingDeletionCount() },
    updated: Date.now(),
  };
}
