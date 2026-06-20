// SQLite storage layer for the BMM telemetry dashboard.
// Everything is DERIVED from the `events` table via SQL, so retention and
// per-packet erasure are exact: delete the rows and every stat reflects it.

import Database from 'better-sqlite3';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'telemetry.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  packet_id TEXT, distinct_id TEXT, event TEXT, ts TEXT, ts_ms INTEGER, props TEXT
);
CREATE INDEX IF NOT EXISTS ix_ev_did ON events(distinct_id);
CREATE INDEX IF NOT EXISTS ix_ev_evt ON events(event);
CREATE INDEX IF NOT EXISTS ix_ev_ts  ON events(ts_ms);
CREATE INDEX IF NOT EXISTS ix_ev_pkt ON events(packet_id);

CREATE TABLE IF NOT EXISTS benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  packet_id TEXT, distinct_id TEXT, ts TEXT, ts_ms INTEGER,
  total_ms REAL, dataset_bytes INTEGER, source TEXT, ops TEXT
);
CREATE INDEX IF NOT EXISTS ix_b_did ON benchmarks(distinct_id);
CREATE INDEX IF NOT EXISTS ix_b_pkt ON benchmarks(packet_id);

CREATE TABLE IF NOT EXISTS geo ( key TEXT PRIMARY KEY, data TEXT, at INTEGER );

CREATE TABLE IF NOT EXISTS deletions (
  packet_id TEXT PRIMARY KEY, requested_at INTEGER, scheduled_at INTEGER,
  status TEXT, decided_at INTEGER, decided_by TEXT
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, target TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT
);
`);

// ── Settings (persistent key/value store) ──────────────────────────────────
const settingGet = db.prepare(`SELECT value FROM settings WHERE key=?`);
const settingSet = db.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
export function getSetting(key, fallback = null) {
  try { const r = settingGet.get(key); return r ? JSON.parse(r.value) : fallback; } catch { return fallback; }
}
export function setSetting(key, value) { settingSet.run(key, JSON.stringify(value)); }

const ins = {
  event: db.prepare(`INSERT INTO events(packet_id,distinct_id,event,ts,ts_ms,props) VALUES(?,?,?,?,?,?)`),
  bench: db.prepare(`INSERT INTO benchmarks(packet_id,distinct_id,ts,ts_ms,total_ms,dataset_bytes,source,ops) VALUES(?,?,?,?,?,?,?,?)`),
  geoUp: db.prepare(`INSERT INTO geo(key,data,at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data, at=excluded.at`),
};

// ── Geolocation (ip-api.com, cached in DB) ─────────────────────────────────────
const geoGet = db.prepare(`SELECT data FROM geo WHERE key=?`);
export function isPrivateHost(h) {
  if (!h) return true;
  const host = String(h).split(':')[0].toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return true;
  return false;
}
export function geoOf(key) {
  if (!key) return null;
  const r = geoGet.get(String(key).split(':')[0]);
  try { return r ? JSON.parse(r.data) : null; } catch { return null; }
}
const inflight = new Set();
function resolveGeo(key) {
  const k = String(key || '').split(':')[0];
  if (!k || isPrivateHost(k) || inflight.has(k) || geoGet.get(k)) return;
  inflight.add(k);
  https.get(`https://ip-api.com/json/${encodeURIComponent(k)}?fields=status,country,countryCode,regionName,city,lat,lon,query`, res => {
    let b = ''; res.on('data', d => b += d); res.on('end', () => {
      inflight.delete(k);
      try { const j = JSON.parse(b); if (j.status === 'success') ins.geoUp.run(k, JSON.stringify({ country: j.country, cc: j.countryCode, region: j.regionName, city: j.city, lat: j.lat, lon: j.lon }), Date.now()); } catch {}
    });
  }).on('error', () => inflight.delete(k));
}

// ── Live instances (ephemeral, in-memory) ──────────────────────────────────────
export const live = new Map();   // distinct_id -> { last_seen, fps, ft, heap, view, ...config }

// ── Ingest ─────────────────────────────────────────────────────────────────────
export function ingest(ev, packetId = '', realtime = false) {
  if (!ev || !ev.event) return;
  const id = ev.distinct_id || 'anon';
  const ts = ev.timestamp || new Date().toISOString();
  const ts_ms = Date.parse(ts) || Date.now();
  const props = ev.properties || {};
  ins.event.run(packetId || ev._pid || '', id, ev.event, ts, ts_ms, JSON.stringify(props));

  if (ev.event === '$identify') {
    const s = props.$set || {};
    if (s.public_ip) resolveGeo(s.public_ip);
  }
  if (ev.event === 'repo_connect') {
    const host = (props.host || '').toLowerCase();
    if (host && !isPrivateHost(host)) resolveGeo(host);
  }
  if (ev.event === 'benchmark') {
    ins.bench.run(packetId || '', id, ts, ts_ms, props.total_ms ?? null, props.dataset_bytes ?? null, props.source || null, JSON.stringify(props.ops || {}));
  }

  if (realtime && ev.event !== 'session_end') {
    const li = live.get(id) || {};
    li.last_seen = Date.now(); li.creator_id = id; li.view = props.view || li.view;
    if (ev.event === 'perf') { li.fps = props.fps_avg; li.ft = props.frametime_avg_ms; li.heap = props.js_heap_mb; }
    if (ev.event === '$identify') { const s = props.$set || {}; li.gpu = s.gpu; li.cpu = s.cpu; li.ram_gb = s.ram_gb; li.is_vm = s.is_vm; li.version = s.app_version; li.os = s.os_caption; li.public_ip = s.public_ip; }
    live.set(id, li);
  }
}

// ── Retention + per-packet erasure ─────────────────────────────────────────────
export function purgeRetention(days) {
  const cut = Date.now() - days * 86400000;
  const a = db.prepare(`DELETE FROM events WHERE ts_ms < ?`).run(cut);
  const b = db.prepare(`DELETE FROM benchmarks WHERE ts_ms < ?`).run(cut);
  return a.changes + b.changes;
}
export function erasePacket(pid) {
  const a = db.prepare(`DELETE FROM events WHERE packet_id=?`).run(pid);
  const b = db.prepare(`DELETE FROM benchmarks WHERE packet_id=?`).run(pid);
  return a.changes + b.changes;
}

// Deletion request lifecycle
const delGet = db.prepare(`SELECT * FROM deletions WHERE packet_id=?`);
export function requestDeletion(pid, delayH) {
  const ex = delGet.get(pid);
  if (ex && ex.status === 'pending') return ex;
  const row = { packet_id: pid, requested_at: Date.now(), scheduled_at: Date.now() + delayH * 3600000, status: 'pending', decided_at: null, decided_by: null };
  db.prepare(`INSERT INTO deletions(packet_id,requested_at,scheduled_at,status,decided_at,decided_by) VALUES(@packet_id,@requested_at,@scheduled_at,@status,@decided_at,@decided_by)
    ON CONFLICT(packet_id) DO UPDATE SET requested_at=@requested_at, scheduled_at=@scheduled_at, status='pending', decided_at=NULL, decided_by=NULL`).run(row);
  return row;
}
export function decideDeletion(pid, action, by) {
  const d = delGet.get(pid);
  if (!d) return null;
  if (action === 'approve') { erasePacket(pid); db.prepare(`UPDATE deletions SET status='done', decided_at=?, decided_by=? WHERE packet_id=?`).run(Date.now(), by || 'admin', pid); }
  else if (action === 'reject') { db.prepare(`UPDATE deletions SET status='rejected', decided_at=?, decided_by=? WHERE packet_id=?`).run(Date.now(), by || 'admin', pid); }
  return delGet.get(pid);
}
export function runDueDeletions() {
  const due = db.prepare(`SELECT packet_id FROM deletions WHERE status='pending' AND scheduled_at <= ?`).all(Date.now());
  for (const d of due) { erasePacket(d.packet_id); db.prepare(`UPDATE deletions SET status='done', decided_at=? WHERE packet_id=?`).run(Date.now(), d.packet_id); }
  return due.length;
}
export function listDeletions() {
  return db.prepare(`SELECT * FROM deletions ORDER BY requested_at DESC LIMIT 200`).all();
}
export function pendingDeletionCount() {
  return db.prepare(`SELECT COUNT(*) n FROM deletions WHERE status='pending'`).get().n;
}

// ── Storage size helpers ────────────────────────────────────────────────────────
/** Return the SQLite page_count * page_size in bytes (fast, no FS stat needed). */
export function storageBytes() {
  const sz = db.prepare(`SELECT page_count * page_size bytes FROM pragma_page_count(), pragma_page_size()`).get();
  return sz ? sz.bytes : 0;
}
const CONFIG_FILE = path.join(__dirname, 'config.json');

export function getStorageLimitMb() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (c.storage_limit_mb) return Number(c.storage_limit_mb);
    }
  } catch {}
  return process.env.STORAGE_LIMIT_MB ? Number(process.env.STORAGE_LIMIT_MB) : 5120;
}

export function setStorageLimitMb(mb) {
  const limit = Math.max(128, Number(mb) || 5120);
  let c = {};
  try { if (fs.existsSync(CONFIG_FILE)) c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  c.storage_limit_mb = limit;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2), 'utf8');
}

/**
 * If the DB exceeds the configured limit, delete the oldest events in batches
 * until under 95% of the limit (gives headroom before the next ingest).
 * Returns how many rows were deleted.
 */
export function enforceStorageLimit() {
  const limitBytes = getStorageLimitMb() * 1024 * 1024;
  if (storageBytes() <= limitBytes) return 0;
  let deleted = 0;
  const target = limitBytes * 0.85;
  const purgedPackets = new Set();
  while (storageBytes() > target) {
    // Delete the 1 000 oldest events at a time
    const batch = db.prepare(`SELECT id, packet_id FROM events ORDER BY ts_ms ASC LIMIT 1000`).all();
    if (!batch.length) break;
    // Collect which packet_ids we're about to erase (so we can mark them deleted for BMM)
    for (const r of batch) if (r.packet_id) purgedPackets.add(r.packet_id);
    const ids = batch.map(r => r.id);
    db.prepare(`DELETE FROM events WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    db.pragma('wal_checkpoint(PASSIVE)'); // flush WAL so page count shrinks
    deleted += ids.length;
    if (deleted > 500000) break; // safety cap
  }
  // Mark each affected packet as auto-purged in the deletions table so BMM shows them as deleted
  if (purgedPackets.size > 0) {
    const now = Date.now();
    const markDone = db.prepare(`INSERT INTO deletions(packet_id,requested_at,scheduled_at,status,decided_at,decided_by)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(packet_id) DO UPDATE SET status='done', decided_at=excluded.decided_at, decided_by=excluded.decided_by`);
    const tx = db.transaction(() => {
      for (const pid of purgedPackets) markDone.run(pid, now, now, 'done', now, 'auto_purge');
    });
    tx();
  }
  return deleted;
}


const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };

/** Recent occurrences of one event: who (distinct_id) + when + properties. */
export function eventOccurrences(name, limit = 60) {
  return db.prepare(`SELECT distinct_id, ts, props, packet_id FROM events WHERE event=? ORDER BY ts_ms DESC LIMIT ?`)
    .all(name, Math.min(500, limit | 0 || 60))
    .map(r => ({ distinct_id: r.distinct_id, ts: r.ts, packet_id: r.packet_id, props: parse(r.props) }));
}

/** A user's full event stream grouped into sessions (by session_id), newest first. */
export function userJourney(id, limit = 1500) {
  const rows = db.prepare(`SELECT event, ts, ts_ms, props FROM events WHERE distinct_id=? ORDER BY ts_ms ASC LIMIT ?`)
    .all(id, Math.min(5000, limit | 0 || 1500));
  const sessions = {};
  const order = [];
  for (const r of rows) {
    const p = parse(r.props);
    const sid = p.session_id || 'no-session';
    let s = sessions[sid];
    if (!s) { s = sessions[sid] = { session_id: sid, start: r.ts, end: r.ts, events: [] }; order.push(sid); }
    s.end = r.ts;
    s.events.push({ event: r.event, ts: r.ts,
      view: p.view, from: p.from, dwell_ms: p.dwell_ms, fps_avg: p.fps_avg,
      detail: summarizeProps(r.event, p) });
  }
  return order.map(sid => sessions[sid]).reverse();
}
function summarizeProps(event, p) {
  if (event === 'page_enter') return p.from ? `${p.from} → ${p.view}` : p.view;
  if (event === 'page_leave') return `${p.view} · ${Math.round((p.dwell_ms || 0) / 1000)}s`;
  if (event === 'perf') return `${p.fps_avg} fps · ${p.frametime_avg_ms}ms`;
  if (event === 'benchmark') return `${p.total_ms ? Math.round(p.total_ms) + 'ms' : ''} ${p.source || ''}`;
  if (event === 'repo_connect') return p.host || p.url;
  if (event === 'repo_host') return `name: ${p.creator_name}`;
  if (event === 'session_end') return `${p.duration_sec || 0}s · ${p.views_visited || 0} views`;
  const extra = Object.entries(p).filter(([k]) => !['session_id', 'seq', 'view'].includes(k)).slice(0, 3).map(([k, v]) => `${k}=${typeof v === 'object' ? '…' : v}`).join(' ');
  return extra;
}

/** Packet deletion statuses for a set of ids (for BMM to show "deleted"). */
export function packetStatuses(ids) {
  if (!ids.length) return {};
  const q = db.prepare(`SELECT packet_id, status, decided_at, scheduled_at FROM deletions WHERE packet_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const m = {}; for (const r of q) m[r.packet_id] = { status: r.status, decided_at: r.decided_at, scheduled_at: r.scheduled_at };
  return m;
}

/** Recent sessions across all users (newest first) with entry/exit views. */
export function sessionsList(limit = 60) {
  const rows = db.prepare(`SELECT distinct_id did, json_extract(props,'$.session_id') sid,
      MIN(ts) s, MAX(ts) e, MIN(ts_ms) sm, MAX(ts_ms) em, COUNT(*) ev, SUM(event='page_enter') pv
      FROM events WHERE sid IS NOT NULL AND sid<>'no-session'
      GROUP BY did, sid ORDER BY em DESC LIMIT ?`).all(Math.min(300, limit | 0 || 60));
  if (!rows.length) return [];
  const sids = rows.map(r => r.sid);
  const pe = db.prepare(`SELECT json_extract(props,'$.session_id') sid, json_extract(props,'$.view') v, ts_ms FROM events
      WHERE event='page_enter' AND sid IN (${sids.map(() => '?').join(',')}) ORDER BY ts_ms ASC`).all(...sids);
  const firstV = {}, lastV = {};
  for (const r of pe) { if (firstV[r.sid] === undefined) firstV[r.sid] = r.v; lastV[r.sid] = r.v; }
  return rows.map(r => ({ distinct_id: r.did, session_id: r.sid, start: r.s, end: r.e,
    duration_s: Math.round((r.em - r.sm) / 1000), events: r.ev, pageviews: r.pv || 0,
    entry: firstV[r.sid] || null, exit: lastV[r.sid] || null }));
}

/** Funnel: how many sessions pass through an ordered list of view steps. */
export function funnel(steps) {
  steps = (steps || []).map(s => String(s || '').trim()).filter(Boolean);
  if (steps.length < 2) return { steps: [], total: 0 };
  const pe = db.prepare(`SELECT json_extract(props,'$.session_id') sid, json_extract(props,'$.view') v FROM events WHERE event='page_enter' AND sid IS NOT NULL ORDER BY ts_ms ASC`).all();
  const bySid = {};
  for (const r of pe) (bySid[r.sid] || (bySid[r.sid] = [])).push(r.v);
  const match = (view, pat) => pat === '*' || pat === view;
  const counts = new Array(steps.length).fill(0);
  let total = 0;
  for (const seq of Object.values(bySid)) {
    total++;
    let si = 0;
    for (const v of seq) { if (match(v, steps[si])) { counts[si]++; si++; if (si >= steps.length) break; } }
  }
  return { total, steps: steps.map((s, i) => ({ step: s, count: counts[i], pct: total ? Math.round(counts[i] / total * 1000) / 10 : 0, drop: i > 0 ? counts[i - 1] - counts[i] : 0 })) };
}

// ── Goals ────────────────────────────────────────────────────────────────────
export function listGoals() {
  return db.prepare(`SELECT * FROM goals ORDER BY created_at DESC`).all().map(g => {
    let conv = 0, users = db.prepare(`SELECT COUNT(DISTINCT distinct_id) n FROM events`).get().n || 1;
    if (g.type === 'event') conv = db.prepare(`SELECT COUNT(DISTINCT distinct_id) n FROM events WHERE event=?`).get(g.target).n;
    else conv = db.prepare(`SELECT COUNT(DISTINCT distinct_id) n FROM events WHERE event='page_enter' AND json_extract(props,'$.view')=?`).get(g.target).n;
    return { ...g, conversions: conv, rate: Math.round(conv / users * 1000) / 10 };
  });
}
export function addGoal(name, type, target) { db.prepare(`INSERT INTO goals(name,type,target,created_at) VALUES(?,?,?,?)`).run(name, type, target, Date.now()); }
export function delGoal(id) { db.prepare(`DELETE FROM goals WHERE id=?`).run(id); }

/** Weekly cohort retention (epoch-week buckets) over the last `weeks` weeks. */
export function retentionCohorts(weeks = 8) {
  const WK = 604800000;
  const since = Date.now() - weeks * WK;
  const rows = db.prepare(`SELECT distinct_id, CAST(ts_ms/${WK} AS INT) wk FROM events WHERE ts_ms>=? GROUP BY distinct_id, wk`).all(since);
  const userWeeks = {};
  for (const r of rows) (userWeeks[r.distinct_id] || (userWeeks[r.distinct_id] = new Set())).add(r.wk);
  const nowWk = Math.floor(Date.now() / WK);
  const cohorts = {};
  for (const [, set] of Object.entries(userWeeks)) {
    const first = Math.min(...set);
    (cohorts[first] || (cohorts[first] = [])).push(set);
  }
  const result = [];
  const sortedWks = Object.keys(cohorts).map(Number).sort((a, b) => a - b);
  for (const cw of sortedWks) {
    const members = cohorts[cw];
    const size = members.length;
    const span = nowWk - cw; // how many weeks of data we can show
    const cells = [];
    for (let k = 0; k <= Math.min(span, weeks - 1); k++) {
      const retained = members.filter(set => set.has(cw + k)).length;
      cells.push({ week: k, pct: size ? Math.round(retained / size * 1000) / 10 : 0, count: retained });
    }
    result.push({ cohort_start: new Date(cw * WK).toISOString().slice(0, 10), size, cells });
  }
  return result.reverse();
}
