// The diagram viewer opens a node's detail (description, « Where in the code ») on a LEFT click.
//
// It used to be the right click: the stage's pointerup selected the node, then the click event
// that only a left button fires reached the shell's click handler, which read
// closest('[data-node]'), and mermaid stamps data-node="true" on every node <g>. So it selected
// the node "true" (none), clearing the pick it had just made. A right click fires no click event,
// so only the right click "worked". These checks keep the three halves of the fix in place.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const viewer = readFileSync(join(ROOT, 'frontend/src/docs/diagram-viewer.ts'), 'utf8');
const gallery = readFileSync(join(ROOT, 'frontend/src/docs/diagram-gallery.ts'), 'utf8');

/** The body of `function name(...) { ... }`, by brace matching. */
function fnBody(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `function ${name} exists`);
  let i = src.indexOf('{', src.indexOf(')', at));
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

const shell = fnBody(viewer, 'wireShell');
const code = (s) => s.replace(/\/\/[^\n]*/g, ''); // comments may name the old attribute

describe('diagram viewer: a node opens on left click', () => {
  test('the shell click handler never reads mermaid\'s data-node attribute', () => {
    assert.ok(!/\[data-node\]|'data-node'/.test(code(shell)), 'wireShell reads data-node again: mermaid sets data-node="true" on every node');
  });

  test('clicks inside the drawing are left to the stage pointerup', () => {
    assert.match(code(shell), /closest\('\.dgv-stage svg'\)\)\s*return/);
  });

  test('the panel links pick nodes through their own attribute', () => {
    assert.ok(!/data-node="/.test(code(viewer)), 'a panel link still uses data-node');
    assert.ok((viewer.match(/data-pick="\$\{esc\(/g) || []).length >= 2, 'the panel links carry data-pick');
    assert.match(code(shell), /closest\('\[data-pick\]'\)/);
  });

  test('selection follows the LEFT button only', () => {
    assert.match(code(shell), /'pointerdown',[^\n]*e\.button === 0/);
    assert.match(code(shell), /'pointerup',[\s\S]{0,80}e\.button !== 0/);
  });

  test('no context-menu-only feature in the viewer or the gallery', () => {
    for (const [name, src] of [['diagram-viewer.ts', viewer], ['diagram-gallery.ts', gallery]]) {
      assert.ok(!/['"](contextmenu|auxclick)['"]/.test(code(src)), `${name} listens for a right click`);
      assert.ok(!/\.button\s*===\s*2/.test(code(src)), `${name} acts on the right button`);
    }
  });
});
