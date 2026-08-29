// Every route the API serves is listed in the API & Scripts panel, and every credential it
// accepts has a field there.
//
// The panel is the app's own API reference: pick an endpoint, fill the generated form, run it.
// Five routes were missing from it entirely — /api/catalogs, /api/hook, /api/keys,
// /api/repo/extras and /api/schedules/enabled — and two of those take a password. So the
// answer to "why is there no protected-source field on this endpoint" was that the endpoint
// was not on the screen at all.
//
// Nothing noticed, and the shape of the miss is why: check-api-docs compares the router to the
// four written API references, so the DOCUMENTATION was complete. The panel is a separate list
// in plugins.ts and nothing compared it to anything. The generated-script side already spoke
// all five (`follow_catalog`, `new_key`, `repo_take`, `signal`), so the API was reachable from
// a script and not from the screen whose job is to document the API.
//
// Two questions:
//   1. every route in the router has an entry here, for every method it answers
//   2. every credential field a handler reads is offered by that entry's form — a password
//      box that does not exist cannot be filled in
import fs from 'node:fs';

const ROUTER = 'src-tauri/src/api/mod.rs';
const PANEL = 'frontend/src/features/plugins/plugins.ts';
for (const f of [ROUTER, PANEL]) {
  if (!fs.existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}
const rs = fs.readFileSync(ROUTER, 'utf8');
const ts = fs.readFileSync(PANEL, 'utf8');

// ── the router ─────────────────────────────────────────────────────────────
const routes = new Map();          // path -> Set(method)
const creds = new Map();           // path -> Set(field)
const marks = [];
for (const m of rs.matchAll(/warp::path!\(([^)]*)\)/g)) {
  const parts = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (!parts.length || parts[0] !== 'api') continue;
  const path = `/${parts.join('/')}`;
  // The verb filter sits within a few lines of the path filter in every route here.
  // `m.end` is Python's; a JS match has `index` and the matched text.
  const after = m.index + m[0].length;
  const near = rs.slice(after, after + 220);
  const method = /warp::post\(\)/.test(near) ? 'POST'
    : /warp::delete\(\)/.test(near) ? 'DELETE'
      : /warp::put\(\)/.test(near) ? 'PUT' : 'GET';
  if (!routes.has(path)) routes.set(path, new Set());
  routes.get(path).add(method);
  marks.push({ at: m.index, path });
}
// A credential read belongs to the NEAREST PRECEDING route. Going forwards from a route by a
// fixed number of characters is what got this wrong twice before: it ran past the handler and
// picked up the next route's fields.
// `key` is matched EXACTLY. A source can be gated by an identity key as well as by a
// password, and that half was invisible here until /api/catalogs gained one — but
// `body.public_key` on /api/keys is a RESULT, not a credential, and a substring match
// would report it and teach people to ignore this check.
const CRED = /(?:body\.(\w*(?:password|passphrase)\w*)|query\.get\("(\w*(?:password|passphrase)\w*)"\)|body\.(authorized_keys)|body\.(key)\b|query\.get\("(key)"\))/gi;
// …and only within the ROUTER. `body.admin_password` also appears at line ~4816, inside the
// export worker that runs long after every route is declared — with nothing but "nearest
// preceding" to go on, that read was attributed to the last route in the file, /api/keys, and
// reported as a missing password box on an endpoint that makes a keypair. The routes all sit
// above the helpers, so the last one bounds the region.
const lastRoute = marks.length ? marks[marks.length - 1].at : 0;
for (const m of rs.matchAll(CRED)) {
  if (m.index > lastRoute + 3000) continue;
  const owner = marks.filter((k) => k.at < m.index).pop();
  if (!owner) continue;
  const field = (m[1] || m[2] || m[3] || m[4] || m[5]).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (!creds.has(owner.path)) creds.set(owner.path, new Set());
  creds.get(owner.path).add(field);
}

// ── the panel ──────────────────────────────────────────────────────────────
const defsAt = ts.indexOf('function getEndpointDefs()');
if (defsAt < 0) { console.error('✗ getEndpointDefs is not where this check looks — it cannot be trusted'); process.exit(2); }
const defs = ts.slice(defsAt, ts.indexOf('\nfunction ', defsAt + 30));
const entries = [...defs.matchAll(/method:\s*'(\w+)',\s*path:\s*'([^']+)'/g)]
  .map((m, i, all) => ({ method: m[1], path: m[2], at: m.index, end: i + 1 < all.length ? all[i + 1].index : defs.length }));

if (routes.size < 40 || entries.length < 40) {
  console.error(`✗ read ${routes.size} route(s) and ${entries.length} panel entr(ies) — too few to be right`);
  process.exit(2);
}

// `/api/mods/:id` in the panel is `path!("api" / "mods" / String)` in warp, whose literals are
// just api/mods. Compared on the literal prefix so a parameterised path is not a phantom.
const trim = (p) => p.replace(/\/:[^/]+$/, '');
const listed = new Set(entries.map((e) => `${e.method} ${trim(e.path)}`));

const problems = [];
for (const [path, methods] of routes) {
  for (const method of methods) {
    if (!listed.has(`${method} ${path}`)) problems.push(`${method} ${path} is served and is not in the panel`);
  }
}
for (const [path, fields] of creds) {
  const mine = entries.filter((e) => trim(e.path) === path);
  if (!mine.length) continue;                     // already reported above
  for (const f of fields) {
    const anywhere = mine.some((e) => new RegExp(`name:\\s*'${f}'`).test(defs.slice(e.at, e.end)));
    if (!anywhere) problems.push(`${path} accepts "${f}" and no form on the panel offers it`);
  }
}

if (problems.length) {
  console.error('✗ API panel:');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nThe panel is the app\'s own API reference. A route it does not list is a route');
  console.error('nobody can try, and a credential it does not offer is a protected source nobody');
  console.error('can reach from here.');
  process.exit(1);
}
console.log(`✓ API panel OK — ${routes.size} route(s) listed, ${[...creds.values()].reduce((n, s) => n + s.size, 0)} credential field(s) reachable`);
