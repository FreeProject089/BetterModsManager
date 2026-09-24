// G5 (agent-icons-G5): the isometric icons, `iso:<name>`, bundled under assets/icons/iso.
//
// 83 third-party SVGs that the icon picker shows and any markdown document can name, loaded
// inside a webview where `withGlobalTauri` is on. They are built on the website side
// (BCW/BCWEB/apps/web/scripts/build-iso-icons.mjs) through an allow-list sanitiser; the BMM
// repository does not carry that sanitiser, so the same allow-list is applied here to what is
// COMMITTED, and a file that would lose anything to it fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { getItem: () => 'en', setItem() {} };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'frontend/assets/icons/iso');
const R = pathToFileURL(join(ROOT, 'frontend/js/')).href;
const { ISO_NAMES, isoRef, isoIconUrl } = await import(`${R}core/icon-cdn.js`);
const { iconImg } = await import(`${R}ui/rich-markdown.js`);
const { renderDocMarkdown } = await import(`${R}docs/md-lite.js`);

const svgs = readdirSync(DIR).filter((f) => f.endsWith('.svg')).sort();
const manifest = JSON.parse(readFileSync(join(DIR, 'icons.json'), 'utf8'));
const licences = readFileSync(join(DIR, 'LICENSES.txt'), 'utf8');

// The drawing vocabulary, and nothing else: no script, no style block (its CSS could fetch),
// no foreignObject (HTML), no image/use pointing out, no animation.
const TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'symbol', 'title', 'desc',
  'filter', 'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'femerge', 'femergenode', 'feflood', 'fecomposite']);

/** Everything in one file that the allow-list would remove. Empty = passes. */
function refusals(body) {
  const out = [];
  if (/<!--|<\?|<!DOCTYPE|<!\[CDATA\[/i.test(body)) out.push('comment / processing instruction / doctype');
  for (const m of body.matchAll(/<\/?([a-zA-Z_:][\w:.-]*)([^<>]*)>/g)) {
    const tag = m[1].toLowerCase();
    if (!TAGS.has(tag)) out.push(`<${m[1]}>`);
    for (const a of m[2].matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
      const name = a[1].toLowerCase(), val = a[2];
      if (name.startsWith('on')) out.push(`${a[1]}=`);
      if ((name === 'href' || name === 'xlink:href') && !/^#[\w:.-]+$/.test(val)) out.push(`${a[1]}="${val}"`);
      if (/javascript:|vbscript:|data:|expression\s*\(|@import|\\/i.test(val)) out.push(`${a[1]}="${val.slice(0, 40)}"`);
      for (const u of val.matchAll(/url\(\s*['"]?([^)'"]*)/gi)) if (!u[1].startsWith('#')) out.push(`url(${u[1]})`);
    }
  }
  // Every `<` in the file opens a tag the loop above read.
  const opened = (body.match(/</g) || []).length, read = [...body.matchAll(/<\/?[a-zA-Z_:][\w:.-]*[^<>]*>/g)].length;
  if (opened !== read) out.push(`${opened - read} stray "<"`);
  return out;
}

test('the family is there at all (a check over zero files passes)', () => {
  assert.ok(svgs.length >= 80, `only ${svgs.length} svg files in frontend/assets/icons/iso`);
  assert.ok(ISO_NAMES.length >= 80);
});

test('every bundled SVG passes the allow-list: no script, no handler, no external reference', () => {
  for (const f of svgs) {
    const body = readFileSync(join(DIR, f), 'utf8').trim();
    assert.match(body, /^<svg\b[^>]*\sviewBox="[^"]+"[^>]*>[\s\S]*<\/svg>$/, `${f}: not a single <svg> document`);
    assert.deepEqual(refusals(body), [], `${f}`);
    const urls = [...body.matchAll(/https?:\/\/[^\s"'<>)]+/gi)].map((m) => m[0]).filter((u) => u !== 'http://www.w3.org/2000/svg');
    assert.deepEqual(urls, [], `${f}: mentions ${urls.join(', ')}`);
  }
});

test('the allow-list is not vacuous (control)', () => {
  assert.notDeepEqual(refusals('<svg viewBox="0 0 1 1"><script>x</script></svg>'), []);
  assert.notDeepEqual(refusals('<svg viewBox="0 0 1 1" onload="x()"></svg>'), []);
  assert.notDeepEqual(refusals('<svg viewBox="0 0 1 1"><use href="https://evil.test/a.svg#x"/></svg>'), []);
  assert.notDeepEqual(refusals('<svg viewBox="0 0 1 1"><path style="fill:url(https://evil.test/p)"/></svg>'), []);
  assert.notDeepEqual(refusals('<svg viewBox="0 0 1 1"><style>*{}</style></svg>'), []);
  assert.deepEqual(refusals('<svg viewBox="0 0 1 1"><path fill="url(#g)" d="M0 0"/></svg>'), []);
});

test('the names agree: files, icons.json and ISO_NAMES in core/icon-cdn.ts', () => {
  const files = svgs.map((f) => f.replace(/\.svg$/, '')).sort();
  assert.deepEqual([...ISO_NAMES].sort(), files, 'ISO_NAMES and the files differ: rebuild with build-iso-icons.mjs and paste its name list');
  assert.deepEqual(manifest.icons.map((i) => i.n).sort(), files);
});

test('every icon is credited and every licence text is there', () => {
  for (const { n } of manifest.icons) assert.ok(licences.includes(`iso:${n}  <-  `), `${n} has no line in LICENSES.txt`);
  for (const set of manifest.sets) assert.ok(licences.includes(set.commit) && licences.includes(set.url), `${set.id}: source not recorded`);
  assert.ok(licences.includes('Copyright 2023 Mark Mankarious'));
  assert.ok(licences.includes('Copyright (c) 2018 Rich'));
  assert.ok(licences.includes('Copyright (c) 2018 Gbolahan Fawale'));
  assert.match(licences, /Apache License[\s\S]*Version 2\.0, January 2004[\s\S]*END OF TERMS AND CONDITIONS/);
});

test('a name resolves only inside the closed list, never to a path a document built', () => {
  assert.equal(isoRef('iso:server'), 'server');
  assert.equal(isoRef('isometric:Cube-Cloud'), 'cube-cloud');
  assert.equal(isoIconUrl('iso:server'), 'assets/icons/iso/server.svg');
  for (const bad of ['iso:../../index', 'iso:nope', 'iso:', 'server', 'iso:server.svg', 'iso:server?x=1']) assert.equal(isoIconUrl(bad), '', bad);
});

test('both markdown renderers draw :icon[iso:…] as the bundled image', () => {
  assert.match(iconImg('iso:server'), /<img class="md-inline-icon md-inline-icon--iso" src="assets\/icons\/iso\/server\.svg"/);
  assert.doesNotMatch(iconImg('iso:nope'), /assets\/icons\/iso/);
  const html = renderDocMarkdown('A :icon[iso:firewall] and :icon[iso:solid-chart-2].', { trusted: true });
  assert.match(html, /src="assets\/icons\/iso\/firewall\.svg"/);
  assert.match(html, /src="assets\/icons\/iso\/solid-chart-2\.svg"/);
  assert.doesNotMatch(renderDocMarkdown(':icon[iso:../x]', { trusted: true }), /assets\/icons\/iso/);
});

// The website builds these files and keeps its own copy; the two must not drift. BCW is a
// separate repository that is only present in a full working tree, so this says so when absent
// instead of passing over nothing.
const BCW = join(ROOT, 'BCW/BCWEB/apps/web/public/icons/iso');
test('the copy here is the website\'s copy', { skip: existsSync(BCW) ? false : 'BCW is not checked out beside BMM' }, () => {
  assert.deepEqual(readdirSync(BCW).sort(), readdirSync(DIR).sort());
  for (const f of readdirSync(DIR)) assert.equal(readFileSync(join(DIR, f), 'utf8'), readFileSync(join(BCW, f), 'utf8'), f);
});
