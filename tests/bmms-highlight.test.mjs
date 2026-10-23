// BMMScript's Prism grammar, run through the real Prism.
//
// A highlighting grammar is the sort of thing that looks right in the one snippet somebody
// pasted to check it. The cases below are the ones that go wrong silently: a `#` inside a
// string (which, ordered wrong, swallows the rest of the line), a keyword used as a
// parameter name, an action whose name is spelled like a statement, and the interpolation
// holes — which are the most useful thing it colours, because a mistyped `{item.nmae}` reads
// exactly like prose until it runs.
//
// It is deliberately NOT tested for "does it agree with the compiler". It is not a parser
// and must never become one: BMM has one BMMScript compiler, in Rust. This decides colours.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// The vendored browser build, which wants a `self`. It runs with `data-manual`, so loading
// it starts nothing — Prism.tokenize is a pure function over a string and a grammar.
globalThis.self = globalThis;
require(join(ROOT, 'frontend/assets/vendor/prism.min.js'));

const { registerBmmsLanguage } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/bmms-prism.js')).href
);
registerBmmsLanguage();

const G = globalThis.Prism.languages.bmms;

/** Flatten Prism's token tree to [type, text] pairs; plain strings are dropped. */
function marked(src) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (typeof n === 'string') continue;
      const text = typeof n.content === 'string' ? n.content : null;
      if (Array.isArray(n.content)) { out.push([n.type, flatten(n.content)]); walk(n.content); }
      else out.push([n.type, text]);
    }
  };
  const flatten = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(flatten).join('') : flatten(c.content));
  walk(globalThis.Prism.tokenize(src, G));
  return out;
}
const typesOf = (src) => marked(src).map(([t]) => t);
const textFor = (src, type) => marked(src).filter(([t]) => t === type).map(([, x]) => x);
/** Every character survives — the property that keeps the mirror aligned with the textarea. */
const roundTrip = (src) => {
  const flat = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(flat).join('') : flat(c.content));
  return globalThis.Prism.tokenize(src, G).map(flat).join('');
};

describe('the grammar is generated, not typed', () => {
  test('every keyword the Rust parser knows is in the pattern', () => {
    // The published vocabulary is what BCWEB's checker reads; the grammar is built from the
    // same generated list, so this catches the two drifting apart.
    const vocab = JSON.parse(readFileSync(join(ROOT, 'dist-assets/bmms-vocabulary.json'), 'utf8'));
    assert.ok(vocab.keywords.length > 30, `only ${vocab.keywords.length} keywords published`);
    for (const kw of vocab.keywords) {
      assert.deepEqual(typesOf(kw), ['keyword'], `\`${kw}\` is not coloured as a keyword`);
    }
  });
});

describe('tokenize', () => {
  test('every character comes back, in order', () => {
    for (const src of [
      '', 'do mods.scan()',
      'task "x" {\n  every day at 03:00\n}\n',
      '# comment\n\n\tdo notify(message: "hi {a.b}")\n',
      'weird $$ chars ~ and "unterminated',
      'set n = 3 + 4\nrepeat 5 times { stop }',
    ]) {
      assert.equal(roundTrip(src), src, JSON.stringify(src));
    }
  });

  test('a # inside a string is not a comment', () => {
    // Ordered the other way, the `#` starts a comment that eats the closing quote and every
    // statement after it on the line.
    const t = marked('do notify(message: "tag #1 here")');
    assert.ok(!t.some(([k]) => k === 'comment'), 'the # is inside quotes');
    assert.ok(textFor('do notify(message: "tag #1 here")', 'string')[0].includes('#1'));
  });

  test('interpolation holes are picked out of the string around them', () => {
    const inner = marked('do notify(message: "Could not disable {item.name} now")')
      .filter(([k]) => k === 'variable').map(([, x]) => x);
    assert.deepEqual(inner, ['{item.name}']);
  });

  test('a `name:` is a parameter even when the name is a keyword', () => {
    const props = textFor('do x(if: 1, message: "a")', 'property');
    assert.ok(props.includes('if'), 'a parameter called `if` must not colour as the statement');
    assert.ok(props.includes('message'));
  });

  test('the name after `do`/`call` is a function, even when it reads like a keyword', () => {
    assert.deepEqual(textFor('do mods.scan()', 'function'), ['mods.scan']);
    assert.deepEqual(textFor('do   stop()', 'function'), ['stop']);
    assert.deepEqual(textFor('call "Other task"', 'function'), []);   // a quoted name is a string
  });

  test('an unterminated string stops at the newline', () => {
    // A string running to EOF paints the whole rest of the task as text, which is how a
    // highlighter makes a file unreadable while you are still typing it.
    const t = marked('do notify(message: "oops\ndo mods.scan()');
    assert.ok(t.some(([k, x]) => k === 'function' && x === 'mods.scan'),
      'the second line must still be code');
  });

  test('durations, clock times and numbers', () => {
    assert.deepEqual(textFor('wait 30s', 'number'), ['30s']);
    assert.deepEqual(textFor('wait 1.5h', 'number'), ['1.5h']);
    assert.deepEqual(textFor('every day at 03:00', 'number'), ['03', '00']);
  });

  test('comments run to the end of the line, both spellings', () => {
    assert.deepEqual(textFor('# note\ndo stop()', 'comment'), ['# note']);
    assert.deepEqual(textFor('// note\ndo stop()', 'comment'), ['// note']);
  });

  test('a whole task tokenises into more than one colour', () => {
    const src = 'task "Nightly" {\n  every day at 03:00\n  do mods.scan()\n  if online and not modEnabled(id: "keep-me") {\n    wait 30s\n  }\n}';
    const kinds = new Set(typesOf(src));
    for (const want of ['keyword', 'string', 'function', 'property', 'number', 'punctuation']) {
      assert.ok(kinds.has(want), `nothing was coloured as ${want}`);
    }
  });
});
