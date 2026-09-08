#!/usr/bin/env node
// The quick-test panel's field list, against the Rust body struct it claims to describe.
//
// `getEndpointDefs()` in plugins.ts is a hand-written copy of every request body the local API
// accepts: 108 endpoints, each with the field names, types and required flags the *Plugins &
// API → API & Script* screen builds its form from. Nothing compared it to the server.
//
// So it drifted, and drifted invisibly — serde ignores a field it does not know, which means a
// wrong name is not an error, it is a value that silently never arrives. When this check was
// written `POST /api/repo/gen` offered `useDocker` and `dockerOs` (the struct has
// `enableDocker` and `dockerHostType`), declared `serverVersion` TWICE with two different types
// — both fields share one DOM id, so the first was unreachable — and never offered `zipMods`
// at all. Every one of those is a box you can fill in that does nothing, or an option you
// cannot reach from the screen that exists to reach it.
//
// What it checks, per endpoint that takes a JSON body:
//   · every name the panel offers is a name the struct accepts (or one of its serde aliases);
//   · every field the struct REQUIRES is offered, and marked required;
//   · no name is offered twice;
//   · the declared type agrees with the Rust type's family.
//
//   node scripts/check-endpoint-fields.mjs           report
//   node scripts/check-endpoint-fields.mjs --check   exit 1 on any drift
import fs from 'node:fs';

const ROUTER = 'src-tauri/src/api/mod.rs';
const PANEL = 'frontend/src/features/plugins/plugins.ts';

const rs = fs.readFileSync(ROUTER, 'utf8');
const ts = fs.readFileSync(PANEL, 'utf8');

// ── Rust: the body structs ────────────────────────────────────────────────────────────
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** string | number | boolean | array | object — the families the panel can express. */
function family(ty) {
    let t = ty.trim();
    let m;
    while ((m = t.match(/^(?:Option|Box)<(.*)>$/s))) t = m[1].trim();
    if (/^Vec</.test(t)) return 'array';
    if (t === 'bool') return 'boolean';
    if (/^(?:u8|u16|u32|u64|usize|i8|i16|i32|i64|isize|f32|f64)$/.test(t)) return 'number';
    if (t === 'String' || t === 'str' || t === '&str') return 'string';
    if (/^serde_json::Value$/.test(t)) return null; // anything at all — no claim to check
    if (/^HashMap</.test(t) || /^BTreeMap</.test(t)) return 'object';
    return 'object';
}

// Comments go first, and they have to: a doc comment showing a JSON example
// (`/// [{ "profileId": "..." }]`) carries a closing brace, and a body matched by
// "everything up to the first }" then ends in the middle of the struct — reporting
// every field BELOW that comment as one the server does not accept. Two structs did
// exactly that when this was written, and the resulting failures pointed at working code.
const noComments = rs.replace(/\/\/[^\n]*/g, '');

const structs = new Map();
for (const m of noComments.matchAll(/((?:#\[[^\n]*\]\s*\n\s*)*)struct\s+(\w+)\s*\{/g)) {
    const attrs = m[1];
    if (!/derive\([^)]*Deserialize/.test(attrs)) continue;
    const renameAll = /rename_all\s*=\s*"camelCase"/.test(attrs);

    // Brace-balanced body: a field type can hold braces of its own.
    let i = m.index + m[0].length, depth = 1;
    while (i < noComments.length && depth > 0) {
        const c = noComments[i];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
    }
    const body = noComments.slice(m.index + m[0].length, i - 1);

    const fields = [];
    // Fields are comma-separated at depth 0, NOT line-separated: `struct X { a: String,
    // b: String }` is one line, and so is `#[serde(default)] version: Option<String>,`.
    // Reading line by line skipped both.
    const parts = [];
    let buf = '', d = 0;
    for (const c of body) {
        if (c === '<' || c === '(' || c === '[' || c === '{') d++;
        else if (c === '>' || c === ')' || c === ']' || c === '}') d--;
        if (c === ',' && d === 0) { parts.push(buf); buf = ''; continue; }
        buf += c;
    }
    if (buf.trim()) parts.push(buf);

    for (const part of parts) {
        const chunk = part.trim();
        if (!chunk) continue;
        // Peel the attributes off the front, wherever they sit.
        let rest = chunk, def = false, rename = null;
        const aliases = [];
        for (;;) {
            const a = rest.match(/^#\[[^\]]*\]\s*/s);
            if (!a) break;
            const at = a[0];
            if (/\bdefault\b/.test(at)) def = true;
            const r = at.match(/rename\s*=\s*"([^"]+)"/);
            if (r) rename = r[1];
            for (const x of at.matchAll(/alias\s*=\s*"([^"]+)"/g)) aliases.push(x[1]);
            rest = rest.slice(at.length);
        }
        const f = rest.trim().match(/^(?:pub\s+)?([a-z_][a-z0-9_]*)\s*:\s*([\s\S]+)$/i);
        if (!f) continue;
        const ty = f[2].trim();
        fields.push({
            wire: rename || (renameAll ? camel(f[1]) : f[1]),
            aliases,
            optional: def || /^Option</.test(ty),
            family: family(ty),
            rust: ty,
        });
    }
    if (fields.length) structs.set(m[2], fields);
}

// ── Rust: route → body struct ─────────────────────────────────────────────────────────
const rlines = rs.split('\n');
const routeStruct = new Map(); // "POST /api/x" → struct name
for (let i = 0; i < rlines.length; i++) {
    const m = rlines[i].match(/warp::path!\(([^)]*)\)/);
    if (!m || !/^\s*"api"/.test(m[1])) continue;
    const segs = [];
    for (const tok of m[1].split('/')) {
        const t = tok.trim();
        const q = t.match(/^"([^"]+)"/);
        if (q) segs.push(q[1]);
        else if (t === 'String') segs.push(':id');
    }
    const path = '/' + segs.join('/');
    let method = null, body = null;
    const tail = rlines[i].slice(m.index + m[0].length);
    const mm0 = tail.match(/warp::(get|post|put|delete|patch)\(\)/);
    if (mm0) method = mm0[1].toUpperCase();
    for (let j = i; j < Math.min(i + 16, rlines.length); j++) {
        if (j > i && /warp::path!\(/.test(rlines[j])) break;
        if (!method) {
            const mm = rlines[j].match(/warp::(get|post|put|delete|patch)\(\)/);
            if (mm) method = mm[1].toUpperCase();
        }
        const bm = rlines[j].match(/warp::body::json::<(\w+)>/);
        if (bm) { body = bm[1]; break; }
    }
    if (method && body) routeStruct.set(`${method} ${path}`, body);
}

if (routeStruct.size < 20) {
    // A parser that stops matching reports the panel as perfect. Refuse instead.
    console.error(`✗ only ${routeStruct.size} body route(s) parsed from ${ROUTER} — the extractor is stale, not the panel perfect`);
    process.exit(2);
}

// ── The panel: getEndpointDefs() ──────────────────────────────────────────────────────
const start = ts.indexOf('function getEndpointDefs()');
if (start < 0) { console.error(`✗ getEndpointDefs() not found in ${PANEL}`); process.exit(2); }
const defsSrc = ts.slice(start);

const heads = [...defsSrc.matchAll(/^[ \t]*method: '(\w+)', path: '([^']+)'/gm)];
if (heads.length < 50) { console.error(`✗ only ${heads.length} endpoint(s) parsed from ${PANEL}`); process.exit(2); }

const panel = [];
for (let i = 0; i < heads.length; i++) {
    const from = heads[i].index;
    const to = i + 1 < heads.length ? heads[i + 1].index : defsSrc.length;
    const block = defsSrc.slice(from, to);
    const fields = [];
    for (const f of block.matchAll(/\{\s*name:\s*'([^']+)',\s*type:\s*'(\w+)',\s*required:\s*(true|false)/g)) {
        fields.push({ name: f[1], type: f[2], required: f[3] === 'true' });
    }
    const hasFields = /\bfields:\s*\[/.test(block);
    panel.push({ method: heads[i][1], path: heads[i][2], fields, hasFields });
}

// ── Compare ───────────────────────────────────────────────────────────────────────────
let problems = 0, checked = 0;
const report = (ep, msg) => { problems++; console.error(`  ✗ ${ep.method} ${ep.path}: ${msg}`); };

for (const ep of panel) {
    const key = `${ep.method} ${ep.path.replace(/\/:[a-zA-Z_]+/g, '/:id')}`;
    const structName = routeStruct.get(key);
    if (!structName) continue;            // no JSON body struct — nothing to compare against
    const sf = structs.get(structName);
    if (!sf) continue;                    // struct parsed as empty (a newtype, a tuple) — skip
    checked++;

    const accepted = new Map();
    for (const f of sf) {
        accepted.set(f.wire, f);
        for (const a of f.aliases) accepted.set(a, f);
    }

    const seen = new Set();
    for (const pf of ep.fields) {
        if (seen.has(pf.name)) {
            // Two rows, one `id="uqt-f-<name>"`. The second wins and the first is unreachable.
            report(ep, `offers "${pf.name}" twice — both build the same input id, so one is dead`);
            continue;
        }
        seen.add(pf.name);
        // `choices[].repoProfileId` documents a key INSIDE an array field. The panel writes
        // sub-fields that way on purpose; only the outer name is a wire name.
        const nested = pf.name.match(/^([A-Za-z0-9_]+)\[\]\./);
        if (nested) {
            const outer = accepted.get(nested[1]);
            if (!outer) report(ep, `documents "${pf.name}", but ${structName} has no "${nested[1]}"`);
            else if (outer.family !== 'array') report(ep, `writes "${pf.name}" as a list, but ${structName}.${nested[1]} is ${outer.rust}`);
            continue;
        }
        const f = accepted.get(pf.name);
        if (!f) {
            report(ep, `offers "${pf.name}", which ${structName} does not accept — serde drops it in silence`);
            continue;
        }
        if (f.family && f.family !== pf.type && !(f.family === 'object' && pf.type === 'string')) {
            report(ep, `"${pf.name}" is declared ${pf.type} here and ${f.rust} (${f.family}) in ${structName}`);
        }
        if (!f.optional && !pf.required) {
            report(ep, `"${pf.name}" is required by ${structName} but offered as optional`);
        }
    }
    for (const f of sf) {
        if (seen.has(f.wire) || f.aliases.some((a) => seen.has(a))) continue;
        if (f.optional) {
            // Not a lie, but a hole: the one screen that exists to try a route cannot try
            // this option. `zipMods` sat in RepoGenBody unreachable from here for that reason.
            report(ep, `never offers "${f.wire}" (${f.rust}), so the form cannot send it`);
        } else {
            report(ep, `never offers "${f.wire}", which ${structName} requires`);
        }
    }
}

if (checked < 20) {
    console.error(`✗ only ${checked} endpoint(s) were actually compared — this check now proves nothing`);
    process.exit(2);
}

if (problems) {
    console.error('');
    console.error('  The quick-test form is generated from these declarations. A name the server does');
    console.error('  not accept is a box that does nothing; a missing one is an option the screen');
    console.error('  cannot reach. Fix the panel, or the struct.');
    if (process.argv.includes('--check')) process.exit(1);
} else {
    console.log(`✓ endpoint fields OK — ${checked} endpoint(s) compared against ${structs.size} body struct(s)`);
}
