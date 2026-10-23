// Technical Architecture: the licence badge is the short family, never the whole expression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { shortLicense } = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/licence-short.js')).href);

test('SPDX expressions shorten to their families', () => {
  assert.equal(shortLicense('GPL-3.0-only OR LicenseRef-Slint-Royalty-free-2.0 OR LicenseRef-Slint-Software-3.0'), 'GPL-3.0 / Slint');
  assert.equal(shortLicense('MIT OR Apache-2.0'), 'Apache-2.0 / MIT');
  assert.equal(shortLicense('Apache-2.0 OR MIT'), 'Apache-2.0 / MIT');
  assert.equal(shortLicense('(MIT OR GPL-3.0-or-later)'), 'GPL-3.0+ / MIT');
  assert.equal(shortLicense('CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception'), 'Apache-2.0 / CC0-1.0');
  assert.equal(shortLicense('Unlicense/MIT'), 'MIT / Unlicense');
  assert.equal(shortLicense('MIT'), 'MIT');
  assert.equal(shortLicense(''), '');
  assert.equal(shortLicense(null), '');
});

test('prose keeps the identifier it starts with, else says custom', () => {
  assert.equal(shortLicense('MIT, with glyphs from Google Material Design Icons (Apache-2.0)'), 'MIT');
  assert.equal(shortLicense('MIT (granted in the README; the LICENSE.md it points to is not in the repository)'), 'MIT');
  assert.equal(shortLicense('GSAP Standard License'), 'GSAP');
  assert.equal(shortLicense("Standard 'no charge' license: https://gsap.com/standard-license.", 'Custom'), 'Custom');
});

test('every licence in the generated stack fits a badge', () => {
  const gen = JSON.parse(readFileSync(join(ROOT, 'frontend/assets/credits-stack.gen.json'), 'utf8'));
  for (const g of gen.groups) for (const it of g.items) {
    const s = shortLicense(it.license);
    assert.ok(s && s.length <= 24, `${g.id}/${it.name}: "${it.license}" → "${s}"`);
  }
});
