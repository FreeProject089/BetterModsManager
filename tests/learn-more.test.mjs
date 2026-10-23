// The "Learn more" registry cannot point at nothing.
//
// core/learn-more.ts maps topic keys to a docs-hub article and/or a bundled documentation page.
// A renamed article or a page dropped from BMM Docs would otherwise leave a link on some screen
// that opens the docs home instead of the answer — which reads as "the button is broken".
//
// Checked against the SOURCES the app itself reads: the article ids declared in docs-hub.ts and
// the page paths in assets/docs/manifest.json (both as shipped). And every topic a screen asks
// for — `learnMore('x')`, `learnMoreEl('x')`, `openLearnMore('x')`, `data-learn-more="x"` — must
// exist in the registry, so a typo in a call site fails here instead of drawing nothing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend', 'src');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── the registry, read from the source (the module itself needs a DOM + i18n to import) ────
const lmSrc = read('frontend/src/core/learn-more.ts');
const body = lmSrc.slice(lmSrc.indexOf('export const LEARN_MORE'), lmSrc.indexOf('});', lmSrc.indexOf('export const LEARN_MORE')));
const REGISTRY = new Map();
for (const m of body.matchAll(/^\s*'([a-z0-9-]+)':\s*\{([^}]*)\}/gm)) {
  const fields = Object.fromEntries([...m[2].matchAll(/(article|page|hash):\s*'([^']*)'/g)].map((f) => [f[1], f[2]]));
  REGISTRY.set(m[1], fields);
}

// ── what exists ───────────────────────────────────────────────────────────────────────────
const hub = read('frontend/src/docs/docs-hub.ts');
// Articles are declared inside `articles: [ … ]` at 8 spaces; categories at 4. An article is an
// object literal that carries a `title:` — enough to tell it from anything else with an `id:`.
const ARTICLES = new Set([...hub.matchAll(/^ {8}id: '([a-z0-9-]+)'/gm)].map((m) => m[1]));
const manifest = JSON.parse(read('frontend/assets/docs/manifest.json'));
const PAGES = new Set(manifest.pages.map((p) => p.path));

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('learn-more registry', () => {
  test('the registry parsed, and the doc sources are the ones the app reads', () => {
    assert.ok(REGISTRY.size >= 20, `found ${REGISTRY.size} topics — the parser lost the registry`);
    assert.ok(ARTICLES.size >= 30, `found ${ARTICLES.size} articles in docs-hub.ts`);
    assert.ok(PAGES.size >= 30, `found ${PAGES.size} pages in the manifest`);
  });

  test('every topic points at an article or a page, and both exist', () => {
    const dead = [];
    for (const [topic, t] of REGISTRY) {
      if (!t.article && !t.page) dead.push(`${topic}: names neither an article nor a page`);
      if (t.article && !ARTICLES.has(t.article)) dead.push(`${topic}: article "${t.article}" is not in docs-hub.ts`);
      if (t.page && !PAGES.has(t.page)) dead.push(`${topic}: page "${t.page}" is not in assets/docs/manifest.json`);
      if (t.page && /\/$/.test(t.page)) dead.push(`${topic}: page "${t.page}" has a trailing slash — manifest paths do not`);
    }
    assert.deepEqual(dead, []);
  });

  test('every page opened has a bundled file in both languages', () => {
    const missing = [];
    for (const [topic, t] of REGISTRY) {
      if (!t.page) continue;
      const m = manifest.pages.find((p) => p.path === t.page);
      if (m && m.fr === false) missing.push(`${topic}: page "${t.page}" has no French version`);
    }
    assert.deepEqual(missing, []);
  });

  test('every topic a screen asks for is in the registry', () => {
    const unknown = [];
    let calls = 0;
    const CALL = /\b(?:learnMore|learnMoreEl|openLearnMore)\(\s*'([^']+)'|data-learn-more="([a-z0-9-]+)"/g;
    for (const file of walk(SRC)) {
      if (file.endsWith('learn-more.ts')) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(CALL)) {
        calls++;
        const topic = m[1] || m[2];
        if (!REGISTRY.has(topic)) unknown.push(`${file.slice(SRC.length + 1)}: "${topic}"`);
      }
    }
    assert.ok(calls >= 10, `only ${calls} Learn-more links found in the app — placements were lost`);
    assert.deepEqual(unknown, []);
  });

  test('the opener the helper calls is defined by the docs hub', () => {
    // openLearnMore() prefers window.openDocsPage and falls back to window.openDocsArticleById.
    assert.match(hub, /\(window as any\)\.openDocsPage\s*=/);
    assert.match(hub, /\(window as any\)\.openDocsArticleById\s*=/);
  });
});
