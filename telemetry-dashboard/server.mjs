// BMM Telemetry Dashboard — Express + SQLite collector & API.
//   node server.mjs            (config from .env)
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ingest, requestDeletion, decideDeletion, listDeletions, runDueDeletions, purgeRetention, eventOccurrences, userJourney,
  packetStatuses, sessionsList, funnel, listGoals, addGoal, delGoal } from './db.mjs';
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
// retention + due (72h-elapsed) deletions, hourly + at boot
function maintenance() { runDueDeletions(); purgeRetention(cfg.RETENTION_DAYS); }
maintenance();
setInterval(maintenance, 3600000);

const app = express();
app.use(express.json({ limit: '6mb' }));
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

app.use(express.static(path.join(__dirname, 'public')));

app.listen(cfg.PORT, () => {
  console.log(`\n  BMM Telemetry Dashboard (Express + SQLite)`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  Dashboard : http://localhost:${cfg.PORT}`);
  console.log(`  Ingest    : POST /batch/`);
  console.log(`  Retention : ${cfg.RETENTION_DAYS}d · erase delay ${cfg.DELETE_DELAY_H}h`);
  console.log(`  Admin     : ${cfg.ADMIN_KEY ? 'enabled (X-Admin-Key)' : 'set ADMIN_KEY in .env to enable approvals'}\n`);
});
