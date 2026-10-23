// The escaping helpers, against the COMPILED module.
//
// These are a security boundary, not formatting: mod names, profile names, repo names and
// plugin manifests all come from outside and end up inside innerHTML. `safeHtml` is the
// tagged template the UI builds markup with, and TrustedHtml is the explicit opt-out — so
// the thing worth pinning is that the opt-out is the ONLY way through.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { escHtml, escAttr, escJs, safeHtml, trustedHtml, formatBytes, truncate } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/core/utils.js')).href
);

describe('escHtml', () => {
  test('neutralises every character that can open a tag or close an attribute', () => {
    const out = escHtml(`<img src=x onerror="alert(1)">&'`);
    for (const ch of ['<', '>']) assert.ok(!out.includes(ch), `${ch} survived`);
    assert.ok(!/"/.test(out), 'a raw double quote can close an attribute');
    assert.ok(!/'/.test(out), 'a raw single quote can close an attribute');
  });

  test('escapes the ampersand FIRST, so an entity cannot be reconstructed', () => {
    // If & were escaped last, `&lt;` typed by a user would come back out as a real `<`.
    assert.equal(escHtml('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
  });

  test('null and undefined become an empty string, never the word "null"', () => {
    assert.equal(escHtml(null), '');
    assert.equal(escHtml(undefined), '');
  });

  test('leaves ordinary text untouched', () => {
    assert.equal(escHtml('A-10C Warthog'), 'A-10C Warthog');
  });

  test('escAttr is escHtml — attributes need the quotes gone too', () => {
    const s = `x" onload="evil()`;
    assert.equal(escAttr(s), escHtml(s));
    assert.ok(!escAttr(s).includes('"'));
  });
});

describe('escJs', () => {
  test('a single quote cannot close a JS string literal', () => {
    assert.equal(escJs("it's"), "it\\'s");
  });

  test('the backslash is escaped BEFORE the quote', () => {
    // Wrong order turns `\` + `'` into `\\'` → an escaped backslash followed by a LIVE quote.
    assert.equal(escJs("\\'"), "\\\\\\'");
  });
});

describe('safeHtml', () => {
  test('interpolated values are escaped', () => {
    const name = '<script>alert(1)</script>';
    const out = safeHtml`<span>${name}</span>`;
    assert.ok(!out.includes('<script>'), 'a value must never become markup');
    assert.match(out, /^<span>/, 'the literal parts stay as written');
  });

  test('trustedHtml is the only way through, and it is explicit', () => {
    const out = safeHtml`<div>${trustedHtml('<b>bold</b>')}</div>`;
    assert.equal(out, '<div><b>bold</b></div>');
  });

  test('a plain string that merely LOOKS like trusted html is still escaped', () => {
    assert.ok(!safeHtml`${'<b>x</b>'}`.includes('<b>'));
  });

  test('null interpolates as empty, not as "null"', () => {
    assert.equal(safeHtml`[${null}]`, '[]');
  });
});

describe('formatBytes', () => {
  test('zero is a special case, not 0 undefined', () => {
    assert.equal(formatBytes(0), '0 B');
  });

  test('scales through the units', () => {
    assert.match(formatBytes(1024), /^1(\.0+)? KB$/);
    assert.match(formatBytes(1024 ** 3), /^1(\.0+)? GB$/);
  });

  test('a size past the largest unit clamps instead of running off the table', () => {
    // Without the clamp this indexes past `sizes` and prints "undefined".
    assert.doesNotMatch(formatBytes(1024 ** 8), /undefined/);
  });
});

describe('truncate', () => {
  test('leaves a short string alone', () => {
    assert.equal(truncate('short', 10), 'short');
  });
  test('cuts and marks the cut', () => {
    assert.equal(truncate('abcdefghij', 4), 'abcd...');
  });
  test('null is empty, not a crash', () => {
    assert.equal(truncate(null, 5), '');
  });
});
