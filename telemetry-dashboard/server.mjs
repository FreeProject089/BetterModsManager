// BMM Telemetry Dashboard — Express + SQLite collector & API.
//   node server.mjs            (config from .env)
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ingest, requestDeletion, decideDeletion, listDeletions, runDueDeletions, purgeRetention, eventOccurrences, userJourney,
  packetStatuses, sessionsList, funnel, listGoals, addGoal, delGoal,
  storageBytes, getStorageLimitMb, setStorageLimitMb, enforceStorageLimit, db } from './db.mjs';
import { computeStats } from './stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── .env (no dependency parser) ────────────────────────────────────────────────
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {}
const cfg = {
  PORT: parseInt(process.env.PORT || '8900', 10),
  API_KEY: process.env.API_KEY || '',
  ADMIN_KEY: process.env.ADMIN_KEY || '',
  RETENTION_DAYS: parseInt(process.env.RETENTION_DAYS || '180', 10),
  DELETE_DELAY_H: parseInt(process.env.DELETE_DELAY_H || '72', 10),
};

// ── Cached stats + live SSE push (no fixed-interval client polling) ────────────
let statsCache = { updated: 0 };
const sseClients = new Set();
function broadcast() { const data = `data: ${JSON.stringify(statsCache)}\n\n`; for (const r of sseClients) { try { r.write(data); } catch {} } }
let dirty = false;
function refresh() { try { statsCache = computeStats(cfg); broadcast(); } catch (e) { console.error('stats error', e); } }
refresh();
// Recompute on a slow heartbeat, but also promptly (≤1.2s) after new data arrives.
setInterval(refresh, 15000);
setInterval(() => { if (dirty) { dirty = false; refresh(); } }, 1200);
// retention + due (72h-elapsed) deletions + storage-limit enforcement, hourly + at boot
function maintenance() { runDueDeletions(); purgeRetention(cfg.RETENTION_DAYS); enforceStorageLimit(); }
maintenance();
setInterval(maintenance, 3600000);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization'); res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); req.method === 'OPTIONS' ? res.sendStatus(204) : next(); });

const okKey = (k) => !cfg.API_KEY || k === cfg.API_KEY;
const isAdmin = (req) => cfg.ADMIN_KEY && (req.get('X-Admin-Key') === cfg.ADMIN_KEY || req.query.admin_key === cfg.ADMIN_KEY || req.body?.admin_key === cfg.ADMIN_KEY);

// Ingest (PostHog-style batch). Each event tagged with the packet id.
app.post(['/batch', '/batch/', '/capture/'], (req, res) => {
  const doc = req.body || {};
  if (!okKey(doc.api_key)) return res.status(401).json({ error: 'bad key' });
  const pid = doc.packet_id || '';
  const batch = Array.isArray(doc.batch) ? doc.batch : (doc.event ? [doc] : []);
  for (const ev of batch) ingest(ev, pid, true);
  dirty = true;     // triggers a prompt SSE push
  res.json({ status: 1, received: batch.length, packet_id: pid });
});

// User-initiated erasure request (applied after the mandatory review delay).
app.post('/delete-request', (req, res) => {
  const { api_key, packet_id } = req.body || {};
  if (!okKey(api_key)) return res.status(401).json({ error: 'bad key' });
  if (!packet_id) return res.status(400).json({ error: 'missing packet_id' });
  const row = requestDeletion(String(packet_id), cfg.DELETE_DELAY_H);
  res.json({ status: 1, scheduled_at: row.scheduled_at, delay_hours: cfg.DELETE_DELAY_H });
});

app.get('/api/stats', (_req, res) => res.json(statsCache));

// Live stream — the dashboard updates in place whenever new data arrives.
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 4000\n\n');
  res.write(`data: ${JSON.stringify(statsCache)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Sessions list + per-session journey.
app.get('/api/sessions', (_req, res) => res.json({ sessions: sessionsList(80) }));
app.post('/api/funnel', (req, res) => res.json(funnel(req.body?.steps || [])));

// Goals (define + conversion). Read is open; write needs the admin key.
app.get('/api/goals', (_req, res) => res.json({ goals: listGoals() }));
app.post('/api/goals', (req, res) => { if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' }); const { name, type, target } = req.body || {}; if (!name || !target) return res.status(400).json({ error: 'bad' }); addGoal(name, type === 'page' ? 'page' : 'event', target); refresh(); res.json({ status: 1 }); });
app.delete('/api/goals/:id', (req, res) => { if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' }); delGoal(parseInt(req.params.id, 10)); refresh(); res.json({ status: 1 }); });

// Packet deletion statuses (BMM polls this to show "deleted").
app.get('/api/packet-status', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);
  res.json({ statuses: packetStatuses(ids) });
});

// Drill-down: recent occurrences of one event (who / when / props).
app.get('/api/event', (req, res) => {
  const name = String(req.query.name || '');
  if (!name) return res.status(400).json({ error: 'name required' });
  res.json({ event: name, occurrences: eventOccurrences(name, parseInt(req.query.limit || '60', 10)) });
});

// Drill-down: one user's full session-by-session journey.
app.get('/api/user', (req, res) => {
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id required' });
  res.json({ id, sessions: userJourney(id) });
});

// ── Admin: review / approve / reject deletions (no 72h wait) ───────────────────
app.get('/api/admin/deletions', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  res.json({ deletions: listDeletions(), delay_hours: cfg.DELETE_DELAY_H });
});
app.post('/api/admin/decide', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  const { packet_id, action } = req.body || {};
  if (!packet_id || !['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'bad request' });
  const row = decideDeletion(String(packet_id), action, 'dashboard');
  refresh();
  res.json({ status: 1, deletion: row });
});

// ── Admin: storage stats + limit ────────────────────────────────────────────────
app.get('/api/admin/storage', (_req, res) => {
  // Table sizes via sqlite page statistics
  const tables = db.prepare(`SELECT name AS tbl, pgsize bytes FROM dbstat WHERE aggregate=TRUE ORDER BY bytes DESC`).all()
    .map(r => {
      const rows = db.prepare(`SELECT COUNT(*) n FROM "${r.tbl}"`).pluck().get();
      return { table: r.tbl, bytes: r.bytes, rows };
    });
  // Replay chunks stored in events table (event='$replay')
  const replays = db.prepare(`SELECT json_extract(props,'$.session_id') session_id,
    json_extract(props,'$.distinct_id') distinct_id, COUNT(*) chunks,
    SUM(length(props)) bytes, MAX(ts_ms) last_ms
    FROM events WHERE event='$replay' GROUP BY session_id ORDER BY last_ms DESC LIMIT 200`).all();
  // Packets (distinct packet_ids)
  const packets = db.prepare(`SELECT packet_id, COUNT(*) events, SUM(length(props)) bytes, MAX(ts_ms) last_ms
    FROM events WHERE packet_id != '' GROUP BY packet_id ORDER BY last_ms DESC LIMIT 200`).all();
  res.json({ tables, replays, packets,
    storage_bytes: storageBytes(),
    storage_limit_mb: getStorageLimitMb() });
});

app.get('/api/admin/storage-limit', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  res.json({ limit_mb: getStorageLimitMb(), used_bytes: storageBytes() });
});
app.post('/api/admin/storage-limit', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  const mb = parseInt(req.body?.limit_mb, 10);
  if (!mb || mb < 128) return res.status(400).json({ error: 'limit_mb must be >= 128' });
  setStorageLimitMb(mb);
  const deleted = enforceStorageLimit();
  refresh();
  res.json({ status: 1, limit_mb: getStorageLimitMb(), deleted_rows: deleted });
});

app.get('/api/admin/backup', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  const events = db.prepare(`SELECT * FROM events ORDER BY ts_ms ASC`).all();
  const benchmarks = db.prepare(`SELECT * FROM benchmarks ORDER BY ts_ms ASC`).all();
  const goals = db.prepare(`SELECT * FROM goals`).all();
  res.json({ version: 1, exported_at: new Date().toISOString(), events, benchmarks, goals });
});
app.post('/api/admin/import', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  const doc = req.body || {};
  let ev = 0, be = 0, go = 0;
  const ins = db.transaction(() => {
    for (const r of doc.events || []) {
      try { db.prepare(`INSERT OR IGNORE INTO events(packet_id,distinct_id,event,ts,ts_ms,props) VALUES(?,?,?,?,?,?)`).run(r.packet_id,r.distinct_id,r.event,r.ts,r.ts_ms,r.props); ev++; } catch {}
    }
    for (const r of doc.benchmarks || []) {
      try { db.prepare(`INSERT OR IGNORE INTO benchmarks(packet_id,distinct_id,ts,ts_ms,total_ms,dataset_bytes,source,ops) VALUES(?,?,?,?,?,?,?,?)`).run(r.packet_id,r.distinct_id,r.ts,r.ts_ms,r.total_ms,r.dataset_bytes,r.source,r.ops); be++; } catch {}
    }
    for (const r of doc.goals || []) {
      try { db.prepare(`INSERT OR IGNORE INTO goals(name,type,target,created_at) VALUES(?,?,?,?)`).run(r.name,r.type,r.target,r.created_at); go++; } catch {}
    }
  });
  ins();
  refresh();
  res.json({ status: 1, imported: { events: ev, benchmarks: be, goals: go } });
});
app.get('/api/admin/audit', (_req, res) => res.json({ audit: [] }));
app.get('/api/admin/replay/download', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  const sid = String(req.query.session_id || '');
  if (!sid) return res.status(400).json({ error: 'session_id required' });
  const chunks = db.prepare(`SELECT props FROM events WHERE event='$replay' AND json_extract(props,'$.session_id')=? ORDER BY ts_ms ASC`).all(sid);
  const events = chunks.flatMap(c => { try { return JSON.parse(c.props).events || []; } catch { return []; } });
  res.json({ session_id: sid, events });
});
app.delete('/api/admin/replay', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  const sid = String(req.query.session_id || '');
  if (!sid) return res.status(400).json({ error: 'session_id required' });
  db.prepare(`DELETE FROM events WHERE event='$replay' AND json_extract(props,'$.session_id')=?`).run(sid);
  refresh();
  res.json({ status: 1 });
});
app.post('/api/admin/packet/delete', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  const pid = String(req.body?.packet_id || '');
  if (!pid) return res.status(400).json({ error: 'packet_id required' });
  const n = db.prepare(`DELETE FROM events WHERE packet_id=?`).run(pid).changes;
  refresh();
  res.json({ status: 1, deleted: n });
});

// ── Admin: user packet search + bulk ops ────────────────────────────────────────
// Search: GET /api/admin/user-packets?q=<creator_id_or_packet_id>
app.get('/api/admin/user-packets', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  // Match by exact creator_id OR partial packet_id prefix
  const packets = db.prepare(`
    SELECT packet_id, distinct_id, COUNT(*) events,
      SUM(length(props)) bytes, MIN(ts) first_event, MAX(ts) last_event, MIN(ts_ms) first_ms
    FROM events
    WHERE distinct_id = ? OR packet_id LIKE ?
    GROUP BY packet_id, distinct_id
    ORDER BY first_ms ASC
    LIMIT 200
  `).all(q, `${q}%`);
  // Enrich with deletion status
  const pids = packets.map(p => p.packet_id).filter(Boolean);
  const statuses = pids.length
    ? db.prepare(`SELECT packet_id, status, decided_at, decided_by FROM deletions WHERE packet_id IN (${pids.map(() => '?').join(',')})`).all(...pids)
    : [];
  const stMap = Object.fromEntries(statuses.map(s => [s.packet_id, s]));
  const result = packets.map(p => ({ ...p, deletion: stMap[p.packet_id] || null }));
  res.json({ q, packets: result });
});

// Bulk delete: POST /api/admin/user-packets/delete { packet_ids: [...] }
app.post('/api/admin/user-packets/delete', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  const ids = (req.body?.packet_ids || []).map(String).filter(Boolean).slice(0, 500);
  if (!ids.length) return res.status(400).json({ error: 'packet_ids required' });
  const now = Date.now();
  const by = `admin:${req.get('X-Admin-Fp') || 'unknown'}`;
  let total = 0;
  const markDone = db.prepare(`INSERT INTO deletions(packet_id,requested_at,scheduled_at,status,decided_at,decided_by)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(packet_id) DO UPDATE SET status='done', decided_at=excluded.decided_at, decided_by=excluded.decided_by`);
  const tx = db.transaction(() => {
    for (const pid of ids) {
      total += db.prepare(`DELETE FROM events WHERE packet_id=?`).run(pid).changes;
      db.prepare(`DELETE FROM benchmarks WHERE packet_id=?`).run(pid);
      markDone.run(pid, now, now, 'done', now, by);
    }
  });
  tx();
  refresh();
  res.json({ status: 1, deleted_events: total, packet_count: ids.length });
});

// Download packets as JSON: GET /api/admin/user-packets/download?packet_ids=id1,id2,...
app.get('/api/admin/user-packets/download', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin key required' });
  const ids = String(req.query.packet_ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 500);
  if (!ids.length) return res.status(400).json({ error: 'packet_ids required' });
  const rows = db.prepare(`SELECT * FROM events WHERE packet_id IN (${ids.map(() => '?').join(',')}) ORDER BY ts_ms ASC`).all(...ids);
  // Log download to audit (via deletions table as a comment — use console for now)
  const who = req.get('X-Admin-Fp') || 'unknown';
  console.log(`[AUDIT] packet download by ${who}: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? `…(${ids.length})` : ''}`);
  res.setHeader('Content-Disposition', `attachment; filename="packets-export-${Date.now()}.json"`);
  res.json({ exported_at: new Date().toISOString(), by: who, packet_ids: ids, events: rows });
});

app.use(express.static(path.join(__dirname, 'public')));


app.listen(cfg.PORT, () => {
  console.log(`\n  BMM Telemetry Dashboard (Express + SQLite)`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  Dashboard : http://localhost:${cfg.PORT}`);
  console.log(`  Ingest    : POST /batch/`);
  console.log(`  Retention : ${cfg.RETENTION_DAYS}d · erase delay ${cfg.DELETE_DELAY_H}h`);
  console.log(`  Admin     : ${cfg.ADMIN_KEY ? 'enabled (X-Admin-Key)' : 'set ADMIN_KEY in .env to enable approvals'}\n`);
});
