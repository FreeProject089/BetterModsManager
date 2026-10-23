// Every `sourceAccessHtml('x')` must have a `wireSourceAccess('x'` in the same file, and the
// wire call must sit at the top level of its function — never inside a callback.
//
// Both halves shipped broken. The block was mounted on four screens and wired on two, because
// on the other two the wire call landed INSIDE the "Add a source" click handler: nothing about
// the protected-source block existed until you pressed a button that has nothing to do with
// it, so the key list never filled and MANAGE KEYS did nothing.
//
// Neither failure says anything. Markup with no listeners looks exactly like markup whose
// listeners have not been reached yet, and a wire call in the wrong place looks, in a diff,
// exactly like one in the right place.
//
// The "inside a callback" test is deliberately crude — it looks for an arrow or `function`
// opening on the SAME line as, or the line before, the call. That is the shape the mistake
// actually took, and a crude check that catches the real failure beats a clever one that needs
// a parser.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'src');

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const HTML = /sourceAccessHtml\(\s*'([^']+)'/g;
const WIRE = /wireSourceAccess\(\s*'([^']+)'/g;

const problems = [];
for (const file of files(root)) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const mounted = [...src.matchAll(HTML)].map((m) => m[1]);
  if (!mounted.length) continue;
  const wired = new Map();
  for (const m of src.matchAll(WIRE)) {
    wired.set(m[1], src.slice(0, m.index).split('\n').length);
  }
  const rel = file.slice(root.length + 1).replace(/\\/g, '/');
  for (const p of new Set(mounted)) {
    if (!wired.has(p)) {
      problems.push(`${rel} — mounts '${p}' and never wires it`);
      continue;
    }
    const ln = wired.get(p);
    const here = lines[ln - 1] || '';
    const above = lines[ln - 2] || '';
    // A wire call whose own line, or the line above it, opens a callback.
    if (/=>\s*\{?\s*$|=>\s*\{|function\s*\([^)]*\)\s*\{\s*$/.test(above) && /^\s{6,}/.test(here)) {
      problems.push(`${rel}:${ln} — '${p}' is wired inside a callback; it must run when the markup is rendered`);
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} source-access mount(s) will not work:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  Markup with no listeners looks exactly like markup nobody has clicked yet.');
  process.exit(1);
}

console.log('✓ every source-access block is wired where its markup is rendered');
