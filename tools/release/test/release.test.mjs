// Unit tests for the pure parts of the release tool. Run: node --test tools/release/test/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { parseVersion, compareVersions, bumpVersion, previousVersion, VERSION_FILES, writeVersions, readVersions } from '../lib/version.mjs';
import { classifyCommit, groupCommits, renderCommitsMd, cleanSubject } from '../lib/commits.mjs';
import { formatSums, parseSums, sumsFilter, sumsTable } from '../lib/checksums.mjs';
import { updateReadme, readmeVersion } from '../lib/readme.mjs';
import { renderGithubRelease, ghCommand, assetProblems, orderAssets, changelogBody, GENERATED_MARK } from '../lib/notes.mjs';
import { cardText, cardSpecs, fitChips } from '../media/cards-text.mjs';
import { verdict, compareSummaries, tally, fmtNs } from '../bench/compare.mjs';
import { packBits, writePsd, literalPack } from '../lib/psd.mjs';
import { decodePng } from '../lib/png.mjs';
import { prefixLog, mergeLogs, secondsPerDay } from '../media/gource.mjs';

const unpackBits = (b) => { const out = []; for (let i = 0; i < b.length;) { const n = b[i++]; if (n < 128) { for (let k = 0; k <= n; k++) out.push(b[i++]); } else if (n > 128) { const v = b[i++]; for (let k = 0; k < 257 - n; k++) out.push(v); } } return out; };

describe('version', () => {
  test('parse', () => {
    assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: null });
    assert.deepEqual(parseVersion('v1.0.3-beta.2'), { major: 1, minor: 0, patch: 3, pre: 'beta.2' });
    assert.equal(parseVersion('1.2'), null);
    assert.equal(parseVersion('1.2.3.4'), null);
  });
  test('compare: release beats its pre-releases, numeric parts compare as numbers', () => {
    assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
    assert.equal(compareVersions('1.1.0', '1.1.0-beta.1'), 1);
    assert.equal(compareVersions('1.1.0-beta.10', '1.1.0-beta.2'), 1);
    assert.equal(compareVersions('1.0.2', 'v1.0.2'), 0);
  });
  test('bump', () => {
    assert.equal(bumpVersion('1.0.2', 'patch'), '1.0.3');
    assert.equal(bumpVersion('1.0.2', 'minor'), '1.1.0');
    assert.equal(bumpVersion('1.0.2', 'major'), '2.0.0');
    assert.equal(bumpVersion('1.0.2', 'pre'), '1.0.3-beta.1');
    assert.equal(bumpVersion('1.0.3-beta.1', 'pre'), '1.0.3-beta.2');
    assert.equal(bumpVersion('1.0.3-beta.2', 'release'), '1.0.3');
    assert.equal(bumpVersion('1.0.2', '1.4.0'), '1.4.0');
    assert.throws(() => bumpVersion('1.0.2', 'sideways'));
  });
  test('previous version', () => {
    assert.equal(previousVersion(['0.9.11', '1.0.1', '1.0.2', '1.0.3', 'laya-model-1'], '1.0.2'), '1.0.1');
    assert.equal(previousVersion(['1.0.2'], '1.0.2'), null);
  });
  test('rewrites touch only the version, CRLF kept', () => {
    const f = Object.fromEntries(VERSION_FILES.map((x) => [x.file, x]));
    const cargo = '[package]\r\nname = "better-mods-manager"\r\nversion = "1.0.2"\r\nedition = "2021"\r\n\r\n[dependencies]\r\nfoo = { version = "1.0.2" }\r\n';
    const out = f['src-tauri/Cargo.toml'].write(cargo, '1.0.3');
    assert.equal(out, cargo.replace('version = "1.0.2"\r\nedition', 'version = "1.0.3"\r\nedition'));
    assert.match(out, /foo = \{ version = "1\.0\.2" \}/);
    const lock = '{\n  "name": "x",\n  "version": "1.0.2",\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "1.0.2",\n      "license": "GPL"\n    },\n    "node_modules/a": {\n      "version": "1.0.2"\n    }\n  }\n}\n';
    const l2 = f['package-lock.json'].write(lock, '1.0.3');
    assert.equal((l2.match(/1\.0\.3/g) || []).length, 2);
    assert.match(l2, /"node_modules\/a": \{\n {6}"version": "1\.0\.2"/);
    const toml = '[app]\nid = "com.bettermm.desktop"\nversion = "1.0.2"\n[update]\nversion = "9"\n';
    assert.equal(f['BetterInstaller/examples/bmm/installer.toml'].read(f['BetterInstaller/examples/bmm/installer.toml'].write(toml, '2.0.0')), '2.0.0');
    assert.match(f['BetterInstaller/examples/bmm/installer.toml'].write(toml, '2.0.0'), /\[update\]\nversion = "9"/);
  });
  test('writeVersions: every file, no BOM, accents intact', () => {
    const d = mkdtempSync(join(tmpdir(), 'bmm-ver-'));
    mkdirSync(join(d, 'src-tauri')); mkdirSync(join(d, 'BetterInstaller/examples/bmm'), { recursive: true });
    writeFileSync(join(d, 'package.json'), '﻿{\n  "name": "b",\n  "version": "1.0.2",\n  "description": "Gestionnaire de mods — été"\n}\n');
    writeFileSync(join(d, 'src-tauri/tauri.conf.json'), '{\n  "productName": "Better Mod Manager",\n  "version": "1.0.2"\n}\n');
    writeFileSync(join(d, 'src-tauri/Cargo.toml'), '[package]\nname = "better-mods-manager"\nversion = "1.0.2"\ndescription = "Gestionnaire — déjà"\n');
    writeFileSync(join(d, 'BetterInstaller/examples/bmm/installer.toml'), '[app]\nversion = "1.0.2"\n');
    const res = writeVersions(d, '1.0.3');
    assert.ok(res.find((r) => r.file === 'package.json').hadBom);
    for (const v of readVersions(d)) if (!v.missing) { assert.equal(v.version, '1.0.3', v.file); assert.equal(v.bom, false, v.file); }
    const pkg = readFileSync(join(d, 'package.json'));
    assert.notEqual(pkg[0], 0xef);
    assert.match(pkg.toString('utf8'), /Gestionnaire de mods — été/);
    assert.match(readFileSync(join(d, 'src-tauri/Cargo.toml'), 'utf8'), /déjà/);
  });
});

describe('commits', () => {
  test('classification', () => {
    assert.equal(classifyCommit('feat(ui): activity centre'), 'features');
    assert.equal(classifyCommit('fix: crash on start'), 'fixes');
    assert.equal(classifyCommit('CI: Gitleaks false positive allowlisted; quinn-proto 0.11.19 (RUSTSEC-2026-0338)'), 'security');
    assert.equal(classifyCommit('CI: Gitleaks false positive allowlisted by fingerprint'), 'ci');
    assert.equal(classifyCommit('In-app docs: the site home is unwrapped to plain markdown'), 'docs');
    assert.equal(classifyCommit('Library: the selection bar no longer closes itself'), 'fixes');
    assert.equal(classifyCommit('Add a duplicate finder to BMM Tools'), 'features');
    assert.equal(classifyCommit('npm dependencies: cheerio removed, bump DOMPurify'), 'chore');
    assert.equal(classifyCommit('Sidebar spacing'), 'other');
  });
  test('grouping keeps the GROUPS order and drops empty groups', () => {
    const g = groupCommits([{ subject: 'Sidebar spacing' }, { subject: 'fix: x' }, { subject: 'feat: y' }]);
    assert.deepEqual(g.map((x) => x.id), ['features', 'fixes', 'other']);
  });
  test('render: hashes, dates, names, escaping, sub repos, FR heading', () => {
    const cm = (h, s) => ({ hash: h.repeat(40).slice(0, 40), short: h.repeat(8).slice(0, 8), date: '2026-10-13T10:00:00+02:00', author: 'Dev', subject: s });
    const md = renderCommitsMd({ version: '1.0.3', previous: '1.0.2', main: { from: 'a'.repeat(40), to: 'b'.repeat(40), fromLabel: 'tag v1.0.2', commits: [cm('c', 'fix: <script> | pipes'), cm('d', 'feat: new tool')], repoUrl: 'https://github.com/o/r' },
      subs: [{ name: 'BMM Docs', from: 'e'.repeat(40), to: 'f'.repeat(40), commits: [cm('1', 'docs: page')] }, { name: 'BCW', commits: [], note: 'pointer unchanged' }] });
    assert.match(md, /^# Commits in 1\.0\.3 \/ Commits de la 1\.0\.3/);
    assert.match(md, /\[`cccccccc`\]\(https:\/\/github\.com\/o\/r\/commit\/c{40}\) 2026-10-13 fix: &lt;script&gt;/);
    assert.match(md, /## Fixes \/ Corrections/);
    assert.match(md, /### BMM Docs/);
    assert.match(md, /\*pointer unchanged\*/);
    assert.doesNotMatch(md, /@/);
  });
  test('long subjects are trimmed', () => {
    assert.ok(cleanSubject('x '.repeat(300)).length <= 222);
  });
});

describe('checksums', () => {
  const h = (ch) => ch.repeat(64);
  test('format sorts, uses the binary marker and forward slashes', () => {
    const t = formatSums([{ path: 'media\\b.png', sha256: h('b') }, { path: 'BMM-Setup.exe', sha256: h('a') }]);
    assert.equal(t, `${h('a')} *BMM-Setup.exe\n${h('b')} *media/b.png\n`);
    assert.deepEqual(parseSums(t), [{ sha256: h('a'), path: 'BMM-Setup.exe' }, { sha256: h('b'), path: 'media/b.png' }]);
  });
  test('rejects bad hashes and duplicates', () => {
    assert.throws(() => formatSums([{ path: 'a', sha256: 'xyz' }]));
    assert.throws(() => formatSums([{ path: 'a', sha256: h('a') }, { path: 'a', sha256: h('b') }]));
  });
  test('filter skips logs and the list itself', () => {
    assert.equal(sumsFilter('SHA256SUMS.txt'), false);
    assert.equal(sumsFilter('logs/x.log'), false);
    assert.equal(sumsFilter('media/gifs/.chrome-profile/Default/LOCK'), false);
    assert.equal(sumsFilter('media/gifs/.frames/0001.png'), false);
    assert.equal(sumsFilter('bench/BENCHMARK.md'), true);
    assert.match(sumsTable([{ path: 'a', sha256: h('a') }]), /\| `a` \| `a{64}` \|/);
  });
});

describe('readme', () => {
  const md = '<img src=".github/screenshots/hero.png" alt="Better Mod Manager 1.0.2" />\n![Version](https://img.shields.io/badge/version-1.0.2-blue.svg)\n[What\'s new in 1.0.2](Update/changelog_v1.0.2_EN.md)\n## What\'s new in 1.0.2\nThe full list is in the [1.0.2 changelog](Update/changelog_v1.0.2_EN.md).\n**Activity centre** (new in 1.0.2)\n';
  test('moves only the version-dependent parts', () => {
    const r = updateReadme(md, readmeVersion(md), '1.0.3');
    assert.match(r.text, /badge\/version-1\.0\.3-blue/);
    assert.match(r.text, /alt="Better Mod Manager 1\.0\.3"/);
    assert.match(r.text, /## What's new in 1\.0\.3/);
    assert.match(r.text, /\[1\.0\.3 changelog\]\(Update\/changelog_v1\.0\.3_EN\.md\)/);
    assert.match(r.text, /\(new in 1\.0\.2\)/);
  });
  test('CRLF files keep their lines (the heading regex once ate the line breaks)', () => {
    const crlf = md.replace(/\n/g, '\r\n');
    const r = updateReadme(crlf, '1.0.2', '1.0.3');
    assert.equal(r.text.split('\r\n').length, crlf.split('\r\n').length);
    assert.match(r.text, /## What's new in 1\.0\.3\r\nThe full list/);
  });
  test('without a changelog, links stay', () => {
    const r = updateReadme(md, '1.0.2', '1.0.3', { changelog: false });
    assert.match(r.text, /changelog_v1\.0\.2_EN/);
    assert.match(r.text, /version-1\.0\.3/);
  });
  test('French wording', () => {
    const fr = '[Nouveautés de la 1.0.2](Update/changelog_v1.0.2_FR.md)\n## Nouveautés de la 1.0.2\n[journal des modifications 1.0.2](Update/changelog_v1.0.2_FR.md)\n';
    const r = updateReadme(fr, '1.0.2', '1.1.0');
    assert.doesNotMatch(r.text, /1\.0\.2/);
  });
});

describe('notes', () => {
  const assets = [{ name: 'BMM-Setup.exe', sha256: 'a'.repeat(64), size: 1 }, { name: 'bmm.bpkg', sha256: 'b'.repeat(64), size: 1 }];
  test('asset rules of 0.9.11', () => {
    assert.deepEqual(assetProblems(['BMM-Setup.exe', 'bmm.bpkg']), []);
    assert.equal(assetProblems(['BMM-Setup.exe', 'x.msi']).length, 1);
    assert.equal(assetProblems(['bmm-setup.EXE']).length, 1);
    assert.equal(assetProblems(['BMM-Setup.exe', 'a.zip']).length, 1);
    assert.deepEqual(orderAssets(['links.json', 'update.json', 'BMM-Setup.exe', 'lang-en.json']), ['BMM-Setup.exe', 'update.json', 'lang-en.json', 'links.json']);
  });
  test('render: mark, maintainer block, body, checksums', () => {
    const md = renderGithubRelease({ version: '1.0.3', assets, changelog: '# Changelog v1.0.3\n\nBody text.\n', expires: { 'update.json': '2026-10-21T00:00:00Z' } });
    assert.ok(md.startsWith(GENERATED_MARK));
    assert.match(md, /MAINTAINER NOTES/);
    assert.match(md, /# Better Mods Manager 1\.0\.3\n\nBody text\./);
    assert.match(md, /\| `BMM-Setup\.exe` \| `a{64}` \|/);
    assert.match(md, /update\.json 2026-10-21/);
    assert.equal(changelogBody('# T\n\nx'), 'x');
    assert.equal(ghCommand('1.0.3', ['BMM-Setup.exe'], 'n.md'), 'gh release create v1.0.3 "Release/1.0.3/BMM-Setup.exe" --title "Better Mods Manager 1.0.3" --latest --notes-file "n.md"');
  });
});

describe('card text', () => {
  test('version is always the argument', () => {
    const t = cardText('2.0.0', 'en', { en: { whatsNew: 'New in {version}' } });
    assert.equal(t.version, '2.0.0');
    assert.equal(t.whatsNew, 'New in 2.0.0');
    assert.equal(t.generic, false);
    assert.equal(cardText('2.0.0', 'fr').whatsNew, 'Les nouveautés de la 2.0.0');
    assert.equal(cardText('2.0.0', 'fr').generic, true);
  });
  test('specs carry the version in every file name', () => {
    const s = cardSpecs('3.1.4');
    assert.equal(s.length, 8);
    for (const x of s) assert.match(x.name, /^bmm-3\.1\.4-/);
  });
  test('chips that do not fit are dropped from the end', () => {
    const f = fitChips(['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'], 20, 300);
    assert.ok(f.items.length < 3 && f.total <= 300);
    assert.deepEqual(f.items, ['aaaaaaaaaa', 'bbbbbbbbbb'].slice(0, f.items.length));
  });
});

describe('benchmark verdicts', () => {
  const m = (v, half = v * 0.01, extra = {}) => ({ id: 'x', value: v, lo: v - half, hi: v + half, better: 'lower', unit: 'ns', ...extra });
  test('better / worse / same', () => {
    assert.equal(verdict(m(100), m(80)).verdict, 'better');
    assert.equal(verdict(m(100), m(130)).verdict, 'worse');
    assert.equal(verdict(m(100), m(103)).verdict, 'same');
    assert.equal(verdict(m(100, 20), m(80, 20)).verdict, 'same', 'overlapping intervals');
    assert.equal(verdict(null, m(1)).verdict, 'new');
    assert.equal(verdict(m(1), null).verdict, 'gone');
  });
  test('one-shot numbers need 15 %', () => {
    const one = (v) => ({ value: v, lo: null, hi: null, better: 'lower' });
    assert.equal(verdict(one(100), one(110)).verdict, 'same');
    assert.equal(verdict(one(100), one(80)).verdict, 'better');
  });
  test("Criterion's change interval through zero keeps it « same »", () => {
    assert.equal(verdict(m(100), m(80, 0.8, { criterionChange: { lo: -0.3, hi: 0.01 } })).verdict, 'same');
  });
  test('pairing and tally', () => {
    const rows = compareSummaries({ metrics: [{ ...m(100), id: 'a' }, { ...m(1), id: 'gone' }] }, { metrics: [{ ...m(50), id: 'a' }, { ...m(1), id: 'new' }] });
    assert.deepEqual(tally(rows), { better: 1, worse: 0, same: 0, new: 1, gone: 1 });
    assert.equal(fmtNs(1500), '1.50 µs');
  });
});

describe('psd / png', () => {
  test('PackBits round-trips', () => {
    for (const row of [[0, 0, 0, 0, 1, 2, 3, 3], Array(300).fill(7), Array.from({ length: 500 }, (_, i) => (i * 37) % 251), [5]]) {
      assert.deepEqual(unpackBits(packBits(Uint8Array.from(row))), row);
    }
    const r = Uint8Array.from(Array.from({ length: 300 }, (_, i) => i % 256));
    for (const p of [3, 4, 300]) assert.deepEqual(unpackBits(literalPack(r, p)), [...r]);
    assert.equal(literalPack(r, 4).length, 304);
  });
  test('layered PSD: signature, size, layer count, even channel data', () => {
    const w = 5, h = 3;
    const a = new Uint8Array(w * h * 4).fill(255);
    const b = new Uint8Array(w * h * 4); b.set([10, 20, 30, 255], (1 * w + 2) * 4);
    const psd = writePsd({ width: w, height: h, layers: [{ name: 'background', rgba: a }, { name: 'dot', rgba: b }], composite: a });
    assert.equal(psd.toString('ascii', 0, 4), '8BPS');
    assert.equal(psd.readUInt16BE(4), 1);
    assert.equal(psd.readUInt32BE(14), h);
    assert.equal(psd.readUInt32BE(18), w);
    const lmi = 26 + 4 + 4; // after empty colour mode data and image resources
    assert.equal(psd.readInt16BE(lmi + 8), 2);
    // first record bounds: full canvas; second: the single dot
    assert.deepEqual([psd.readInt32BE(lmi + 10), psd.readInt32BE(lmi + 14), psd.readInt32BE(lmi + 18), psd.readInt32BE(lmi + 22)], [0, 0, h, w]);
  });
  test('PNG decoder reads RGBA with every filter type', () => {
    const w = 3, h = 5;
    const rows = [];
    for (let y = 0; y < h; y++) { rows.push(y % 5); for (let x = 0; x < w * 4; x++) rows.push(0); }
    // filter bytes 0..4 on zero data decode to zero regardless of the filter
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); return Buffer.concat([l, Buffer.from(t), d, Buffer.alloc(4)]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
    const d = decodePng(png);
    assert.equal(d.width, w); assert.equal(d.height, h); assert.equal(d.data.length, w * h * 4);
    // a « Sub » row: each byte adds the one 4 bytes to its left
    const sub = [1, 1, 2, 3, 4, 1, 1, 1, 1, 0, 0, 0, 0];
    const png2 = Buffer.concat([png.subarray(0, 8), chunk('IHDR', (() => { const x = Buffer.from(ihdr); x.writeUInt32BE(1, 4); return x; })()), chunk('IDAT', deflateSync(Buffer.from(sub))), chunk('IEND', Buffer.alloc(0))]);
    assert.deepEqual([...decodePng(png2).data], [1, 2, 3, 4, 2, 3, 4, 5, 2, 3, 4, 5]);
  });
});

describe('gource log', () => {
  test('prefix, merge by time, speed', () => {
    const a = prefixLog('100|Ann|A|/src/a.ts\n300|Ann|M|/src/a.ts\nbroken line\n', 'BMM');
    const b = prefixLog('200|Bob|A|/docs/x.md\n', 'BMM Docs');
    assert.deepEqual(a, ['100|Ann|A|/BMM/src/a.ts', '300|Ann|M|/BMM/src/a.ts']);
    assert.deepEqual(mergeLogs([a, b]).map((l) => l.split('|')[0]), ['100', '200', '300']);
    assert.equal(secondsPerDay(0, 86400 * 100, 75), 0.75);
    assert.ok(!mergeLogs([a, b]).join('\n').includes('@'));
  });
});
