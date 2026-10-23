// The in-app interactive diagrams (frontend/src/docs/diagrams/*.ts), checked as data.
//
// 1. Every openDiagram('…') in the markup must exist in the registry.
//    A missing id is not an error the user can see: openDiagram() used to log to the console and
//    return, so the button appeared to do nothing at all. `lightweight-architecture` sat broken
//    that way: one of five ids in index.html, the only one absent from the registry.
//
// 2. Every spec is well-formed: unique ids, edges between nodes that exist, groups that exist,
//    a known kind, a known category, ≤ 16 nodes (a picture with more is two pictures).
//
// 3. Every code reference resolves. A node's detail panel lists « Where in the code »: a path, or
//    'path › symbol'. The path must exist and the symbol must still appear in that file as a whole
//    word. This is the half that matters most: a diagram is only worth reading while it describes
//    the code that runs, and a rename or a move is exactly the change nobody thinks to carry into a
//    picture. Here it fails the build instead.
//
// 4. Every text the spec needs exists in en.json AND fr.json (title, summary, groups, node label
//    and description, edge labels), so no diagram renders a raw key in either language.
//
// 5. Every `icon-*` class a node uses exists in the CSS (an undefined one renders as NOTHING).
//
// Specs are TypeScript; they are transpiled here with the project's own `typescript` package
// (type-only imports vanish), so this gate does not depend on a fresh `tsc` output.
//
//   --lang-extra <dir>   also read every *.json in <dir> as { en: {…}, fr: {…} } fragments
//   --only a,b           check only these diagram ids (authoring a few at a time)

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require(join(ROOT, 'node_modules/typescript'));
const argv = process.argv.slice(2);
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const ONLY = argVal('--only') ? new Set(argVal('--only').split(',').map((s) => s.trim()).filter(Boolean)) : null;
const LANG_EXTRA = argVal('--lang-extra');

const errors = [];
const warns = [];
const fail = (msg) => errors.push(msg);

const html = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');
const registrySrc = readFileSync(join(ROOT, 'frontend/src/docs/interactive-docs.ts'), 'utf8');

// ── the registry ───────────────────────────────────────────────────────────────────────────
// The block itself, so a stray quoted id elsewhere in the file cannot vouch for itself.
const block = registrySrc.match(/export const diagrams\s*=\s*\{([\s\S]*?)\n\};/);
if (!block) {
  console.error('✗ could not find the `diagrams` registry in interactive-docs.ts');
  process.exit(1);
}
const registered = new Map([...block[1].matchAll(/'([a-z0-9-]+)'\s*:\s*([A-Za-z0-9_]+)/g)].map((m) => [m[1], m[2]]));

// Both spellings the markup uses: onclick="openDiagram('x')" and the action router's
// data-act="openDiagram" data-act-args='["x"]'.
const used = [
  ...[...html.matchAll(/openDiagram\(\s*['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]),
  ...[...html.matchAll(/data-act="openDiagram"\s+data-act-args='\["([a-z0-9-]+)"/g)].map((m) => m[1]),
];
for (const id of new Set(used)) if (!registered.has(id)) fail(`index.html opens diagram "${id}", which is not registered (the button would do nothing)`);

// The reverse question, as a warning: a diagram nobody links to is written, translated and
// shipped, and unreachable except from the gallery. Not a failure: parking one deliberately is
// legitimate; but it should be a decision, not a drift.
const hub = readFileSync(join(ROOT, 'frontend/src/docs/docs-hub.ts'), 'utf8');
const unreachable = [...registered.keys()].filter((id) => !hub.includes(`'${id}'`) && !html.includes(id));

// ── load the specs ─────────────────────────────────────────────────────────────────────────
const DIAG = join(ROOT, 'frontend/src/docs/diagrams');
const specs = [];
const exportOwner = new Map(); // export name → file
for (const f of readdirSync(DIAG).filter((x) => x.endsWith('.ts')).sort()) {
  const src = readFileSync(join(DIAG, f), 'utf8');
  // A runtime import would make the spec depend on the DOM (i18n, the vendor loader); the
  // generator in diagram-spec.ts does the work, a spec is data.
  if (!ONLY || src.includes('i18n:')) {
    for (const m of src.matchAll(/^\s*import\s+(?!type\b)[^;]*from\s+['"]([^'"]+)['"]/gm)) {
      fail(`${f}: runtime import of "${m[1]}" (a spec is data; use \`import type\`)`);
    }
  }
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  let mod;
  try {
    mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  } catch (e) {
    fail(`${f}: does not load (${e.message})`);
    continue;
  }
  const found = Object.entries(mod).filter(([, v]) => v && typeof v === 'object' && Array.isArray(v.nodes) && typeof v.i18n === 'string');
  if (!found.length && !ONLY) fail(`${f}: exports no diagram spec`);
  for (const [name, spec] of found) {
    exportOwner.set(name, f);
    specs.push({ file: f, name, spec, src });
  }
}

const NODE_ID = /^[A-Z][A-Z0-9_]*$/;
// Words mermaid's grammar owns. `end` closes a subgraph; the others start statements.
const RESERVED = new Set(['END', 'GRAPH', 'SUBGRAPH', 'STYLE', 'CLASS', 'CLASSDEF', 'CLICK', 'LINKSTYLE', 'FLOWCHART', 'DEFAULT']);
const KINDS = new Set(['ui', 'front', 'rust', 'data', 'ext', 'decision', 'outcome']);
const CATS = new Set(['mods', 'profiles', 'integrity', 'sharing', 'updates', 'automation', 'laya', 'internals']);
const TONES = new Set(['ok', 'warn', 'danger', 'info']);
const MAX_NODES = 16;
const SEP = ' › ';

// Article ids the docs hub knows, for `article:`.
const articleIds = new Set([
  ...[...hub.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
  ...[...hub.matchAll(/devArticle\(\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
]);

// Languages (+ fragments while authoring).
const load = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const en = load('frontend/Lang/en.json');
const fr = load('frontend/Lang/fr.json');
if (LANG_EXTRA) {
  for (const f of readdirSync(LANG_EXTRA).filter((x) => x.endsWith('.json'))) {
    const frag = JSON.parse(readFileSync(join(LANG_EXTRA, f), 'utf8'));
    Object.assign(en, frag.en || {});
    Object.assign(fr, frag.fr || {});
  }
}

// CSS icon classes.
let cssAll = '';
for (const f of readdirSync(join(ROOT, 'frontend/css')).filter((x) => x.endsWith('.css'))) cssAll += readFileSync(join(ROOT, 'frontend/css', f), 'utf8');
const definedIcons = new Set([...cssAll.matchAll(/\.(icon-[a-z0-9-]+)/g)].map((m) => m[1]));

const fileCache = new Map();
const readCode = (p) => {
  if (!fileCache.has(p)) fileCache.set(p, readFileSync(join(ROOT, p), 'utf8'));
  return fileCache.get(p);
};
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let refCount = 0;
let nodeCount = 0;
const seenIds = new Map();
for (const { file, name, spec: s } of specs) {
  if (ONLY && !ONLY.has(s.id)) continue;
  const at = `${file} (${s.id || name})`;
  if (!/^[a-z0-9-]+$/.test(s.id || '')) { fail(`${at}: id must be kebab-case`); continue; }
  if (seenIds.has(s.id)) fail(`${at}: id "${s.id}" also used by ${seenIds.get(s.id)}`);
  seenIds.set(s.id, file);
  if (s.i18n !== `docs.diagram.${s.id}`) fail(`${at}: i18n must be "docs.diagram.${s.id}"`);
  if (!CATS.has(s.category)) fail(`${at}: unknown category "${s.category}"`);
  if (s.dir !== 'TB' && s.dir !== 'LR') fail(`${at}: dir must be TB or LR`);
  if (!registered.has(s.id)) fail(`${at}: not registered in interactive-docs.ts`);
  else if (registered.get(s.id) !== name) fail(`${at}: registered as ${registered.get(s.id)}, exported as ${name}`);
  if (s.article && !articleIds.has(s.article)) fail(`${at}: article "${s.article}" is not a docs-hub article id`);
  for (const r of s.related || []) if (!registered.has(r)) fail(`${at}: related diagram "${r}" is not registered`);

  const groups = new Map((s.groups || []).map((g) => [g.id, g]));
  for (const g of s.groups || []) {
    if (!NODE_ID.test(g.id)) fail(`${at}: group id "${g.id}" must be UPPER_SNAKE`);
    if (g.parent && !groups.has(g.parent)) fail(`${at}: group ${g.id} has unknown parent ${g.parent}`);
    if (!(s.nodes || []).some((n) => n.group === g.id) && !(s.groups || []).some((c) => c.parent === g.id)) fail(`${at}: group ${g.id} is empty`);
  }
  const ids = new Set();
  if (s.nodes.length > MAX_NODES) fail(`${at}: ${s.nodes.length} nodes (max ${MAX_NODES}); split it into two diagrams`);
  if (s.nodes.length < 2) fail(`${at}: fewer than 2 nodes`);
  for (const n of s.nodes) {
    nodeCount++;
    if (!NODE_ID.test(n.id) || RESERVED.has(n.id)) fail(`${at}: node id "${n.id}" must be UPPER_SNAKE and not a mermaid keyword`);
    if (ids.has(n.id)) fail(`${at}: duplicate node ${n.id}`);
    if (groups.has(n.id)) fail(`${at}: node ${n.id} has the same id as a group`);
    ids.add(n.id);
    if (!KINDS.has(n.kind)) fail(`${at}: node ${n.id} has unknown kind "${n.kind}"`);
    if (n.group && !groups.has(n.group)) fail(`${at}: node ${n.id} is in unknown group ${n.group}`);
    if (n.link && !registered.has(n.link)) fail(`${at}: node ${n.id} links to unregistered diagram "${n.link}"`);
    if (n.icon && !definedIcons.has(n.icon)) fail(`${at}: node ${n.id} uses icon class ${n.icon}, which no CSS defines (it would render as nothing)`);
    if (!Array.isArray(n.refs) || !n.refs.length) { fail(`${at}: node ${n.id} has no code reference`); continue; }
    for (const ref of n.refs) {
      refCount++;
      const i = ref.indexOf(SEP);
      const path = (i < 0 ? ref : ref.slice(0, i)).trim();
      const symbol = i < 0 ? null : ref.slice(i + SEP.length).trim();
      if (/^[a-zA-Z]:|^\/|\\|\.\.\//.test(path)) { fail(`${at}: node ${n.id}: ref "${ref}" must be a repo-relative path with forward slashes`); continue; }
      const abs = resolve(ROOT, path);
      if (!existsSync(abs)) { fail(`${at}: node ${n.id}: "${path}" does not exist`); continue; }
      if (!symbol) continue;
      if (!/^[A-Za-z_$][\w$]*$/.test(symbol)) { fail(`${at}: node ${n.id}: symbol "${symbol}" is not a single identifier`); continue; }
      if (statSync(abs).isDirectory()) { fail(`${at}: node ${n.id}: "${path}" is a folder; a symbol needs a file`); continue; }
      if (!new RegExp(`(?<![\\w$])${escRe(symbol)}(?![\\w$])`).test(readCode(path))) {
        fail(`${at}: node ${n.id}: "${symbol}" no longer appears in ${path}`);
      }
    }
  }
  const edgePairs = new Set();
  for (const e of s.edges) {
    if (!ids.has(e.from)) fail(`${at}: edge from unknown node ${e.from}`);
    if (!ids.has(e.to)) fail(`${at}: edge to unknown node ${e.to}`);
    if (e.tone && !TONES.has(e.tone)) fail(`${at}: edge ${e.from}→${e.to} has unknown tone ${e.tone}`);
    if (e.label && !/^~?[a-zA-Z][a-zA-Z0-9_]*$/.test(e.label)) fail(`${at}: edge ${e.from}→${e.to} label "${e.label}" must be a key segment`);
    const pair = `${e.from}>${e.to}`;
    if (edgePairs.has(pair)) fail(`${at}: two edges ${e.from}→${e.to} (the hover could not tell them apart)`);
    edgePairs.add(pair);
  }
  for (const n of s.nodes) if (!s.edges.some((e) => e.from === n.id || e.to === n.id)) fail(`${at}: node ${n.id} is not connected to anything`);

  // Texts.
  const keys = [`${s.i18n}.title`, `${s.i18n}.summary`];
  for (const g of s.groups || []) keys.push(`${s.i18n}.g.${g.id}`);
  for (const n of s.nodes) keys.push(`${s.i18n}.n.${n.id}`, `${s.i18n}.n.${n.id}.desc`);
  for (const e of s.edges) if (e.label) keys.push(e.label.startsWith('~') ? `docs.diagram.common.${e.label.slice(1)}` : `${s.i18n}.e.${e.label}`);
  for (const k of new Set(keys)) {
    for (const [lang, d] of [['en', en], ['fr', fr]]) {
      if (typeof d[k] !== 'string' || !d[k].trim()) fail(`${at}: missing ${lang} text "${k}"`);
    }
  }
}

// The viewer builds these keys from the kind and category names (t(`docs.diagram.kind.${k}`)),
// which check-i18n-keys cannot see: a missing one would print as its own key in the legend.
for (const k of KINDS) for (const key of [`docs.diagram.kind.${k}`, `docs.diagram.kind.${k}.desc`]) {
  for (const [lang, d] of [['en', en], ['fr', fr]]) if (typeof d[key] !== 'string') fail(`missing ${lang} text "${key}" (legend)`);
}
for (const c of CATS) for (const [lang, d] of [['en', en], ['fr', fr]]) {
  if (typeof d[`docs.diagram.cat.${c}`] !== 'string') fail(`missing ${lang} text "docs.diagram.cat.${c}" (gallery)`);
}

// Every spec file is registered, every registered id has a spec.
if (!ONLY) {
  const specIds = new Set(specs.map((x) => x.spec.id));
  for (const id of registered.keys()) if (!specIds.has(id)) fail(`interactive-docs.ts registers "${id}", but no spec in diagrams/ has that id`);
}

if (unreachable.length && !ONLY) {
  warns.push(`${unreachable.length} diagram(s) no article links to (reachable from the gallery only): ${unreachable.sort().join(', ')}`);
}
for (const w of warns) console.warn(`⚠ ${w}`);
if (errors.length) {
  console.error(`✗ ${errors.length} diagram problem(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`✓ ${ONLY ? ONLY.size : specs.length} diagram(s): ${nodeCount} nodes, ${refCount} code references resolve, texts in en+fr, ${new Set(used).size} markup id(s) registered`);
