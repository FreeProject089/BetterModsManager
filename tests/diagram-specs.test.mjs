// The interactive diagrams are data (frontend/src/docs/diagrams/*.ts) turned into mermaid by
// diagram-spec.ts. What can go wrong between the two is invisible until a diagram is opened:
// a label with a quote ends the mermaid string and the whole diagram fails to parse, a shape
// bracket drifts and every "Rust command" draws as a plain box, an edge label loses the index
// the viewer uses to light it on hover. These tests run the generator over every real spec.
// (scripts/check-diagrams.mjs checks the specs themselves: refs, texts, ids.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS = join(ROOT, 'frontend/js/docs');
const S = await import(pathToFileURL(join(JS, 'diagram-spec.js')).href);

const specs = [];
for (const f of readdirSync(join(JS, 'diagrams')).filter((x) => x.endsWith('.js'))) {
  const mod = await import(pathToFileURL(join(JS, 'diagrams', f)).href);
  for (const v of Object.values(mod)) if (v && Array.isArray(v.nodes) && typeof v.i18n === 'string') specs.push(v);
}

const SHAPES = { ui: ['[', ']'], front: ['(', ')'], rust: ['[[', ']]'], data: ['[(', ')]'], ext: ['{{', '}}'], decision: ['{', '}'], outcome: ['([', '])'] };

describe('diagram-spec generator', () => {
  test('there are specs to check', () => {
    assert.ok(specs.length >= 40, `only ${specs.length} specs compiled`);
  });

  test('a hostile label cannot break out of its mermaid string', () => {
    const spec = {
      id: 'x', i18n: 'docs.diagram.x', category: 'mods', dir: 'TB',
      nodes: [{ id: 'A', kind: 'rust', refs: ['a'] }, { id: 'B', kind: 'decision', refs: ['b'] }],
      edges: [{ from: 'A', to: 'B', label: 'go', tone: 'ok' }],
    };
    const src = S.buildMermaid(spec, () => 'say "hi" <b>&\nnext');
    const lines = src.split('\n');
    const a = lines.find((l) => l.trim().startsWith('A['));
    assert.ok(a, 'node A is declared');
    // One quoted string per declaration: the label's own quote became #quot;
    assert.equal((a.match(/"/g) || []).length, 2);
    assert.ok(a.includes('#quot;hi#quot;') && a.includes('&lt;b&gt;&amp;'));
    assert.ok(!src.includes('\nnext'), 'a newline in a label must not start a statement');
  });

  for (const s of specs) {
    test(`${s.id}: every node, edge and kind reaches the mermaid source`, () => {
      const src = S.buildMermaid(s, (k) => k);
      assert.ok(src.startsWith(`flowchart ${s.dir}`));
      for (const n of s.nodes) {
        const [a, b] = SHAPES[n.kind];
        assert.ok(src.includes(`${n.id}${a}"`), `${n.id} is drawn as a ${n.kind}`);
        assert.ok(src.includes(`"${b}`), `${n.id} closes its ${n.kind} shape`);
        assert.ok(new RegExp(`class [A-Z0-9_,]*\\b${n.id}\\b[A-Z0-9_,]* dgk_${n.kind}`).test(src), `${n.id} carries dgk_${n.kind}`);
      }
      s.edges.forEach((e, i) => {
        assert.ok(src.includes(`${e.from} `) && src.includes(` ${e.to}`), `edge ${e.from}→${e.to}`);
        if (e.label) assert.ok(src.includes(`data-e='${i}'`), `edge ${i} label carries its index`);
      });
      for (const g of s.groups || []) assert.ok(src.includes(`subgraph G_${g.id} [`), `group ${g.id}`);
      // Exactly one `end` per subgraph, or mermaid closes the wrong one.
      assert.equal((src.match(/^\s*end$/gm) || []).length, (s.groups || []).length);
    });

    test(`${s.id}: specKeys covers title, summary, groups, nodes, descriptions, labels`, () => {
      const keys = new Set(S.specKeys(s));
      assert.ok(keys.has(`${s.i18n}.title`) && keys.has(`${s.i18n}.summary`));
      for (const n of s.nodes) assert.ok(keys.has(`${s.i18n}.n.${n.id}`) && keys.has(`${s.i18n}.n.${n.id}.desc`));
      for (const g of s.groups || []) assert.ok(keys.has(`${s.i18n}.g.${g.id}`));
    });

    test(`${s.id}: every code reference is a path, or a path and one symbol`, () => {
      for (const n of s.nodes) {
        assert.ok(n.refs.length > 0, `${n.id} has a reference`);
        for (const r of n.refs) {
          const { path, symbol } = S.parseRef(r);
          assert.ok(path && !path.includes('\\'), `${n.id}: ${r}`);
          if (symbol !== null) assert.match(symbol, /^[A-Za-z_$][\w$]*$/, `${n.id}: ${r}`);
        }
      }
    });
  }
});

describe('rankNodes (gallery thumbnails)', () => {
  test('a loop back does not stretch the ranks', () => {
    const s = { nodes: ['A', 'B', 'C'].map((id) => ({ id, kind: 'rust', refs: ['x'] })), edges: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }] };
    const r = S.rankNodes(s);
    assert.deepEqual([r.get('A'), r.get('B'), r.get('C')], [0, 1, 2]);
  });
  test('the longest path wins', () => {
    const s = { nodes: ['A', 'B', 'C', 'D'].map((id) => ({ id, kind: 'rust', refs: ['x'] })), edges: [
      { from: 'A', to: 'D' }, { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }] };
    assert.equal(S.rankNodes(s).get('D'), 3);
  });
  for (const s of specs) {
    test(`${s.id}: every node gets a rank`, () => {
      const r = S.rankNodes(s);
      for (const n of s.nodes) assert.ok(Number.isInteger(r.get(n.id)));
    });
  }
});
