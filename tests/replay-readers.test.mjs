// « The .bmmreplay from crash reports and sessions don't work: unreadable. » One test per
// producer → reader pair, against the app's own reader (frontend/src/core/replay-body.ts,
// compiled). The Rust producers write their samples into tests/fixtures/replays/ from their own
// tests (src-tauri/src/commands/analytics.rs replay_readback_tests, crash.rs
// session_replay_entry_tests), so a writer that changes its envelope fails here.
//
// What was wrong, and is pinned below:
//   · saved and imported replays were read with fetch(convertFileSrc(path)), refused by the
//     asset protocol outside the app's folders → read through `read_replay_file` now;
//   · a crash report's replay went through a raw-text redaction that cut the JSON → the
//     structural scrub (fixture crash-zip-entry.bmmreplay is redacted AND valid);
//   · playReplayJson parsed raw JSON only, no gzip, no older envelope;
//   · a recorder joined late gave a stream without its Meta + FullSnapshot → a fresh checkout on
//     subscribe, and the reader starts at the first full snapshot.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = await import(pathToFileURL(join(ROOT, 'frontend/js/core/replay-body.js')).href);
const { buildReplay } = await import(pathToFileURL(join(ROOT, 'tools/release/screenshots/replay.mjs')).href);
const FIX = join(ROOT, 'tests/fixtures/replays');
const src = (p) => readFileSync(join(ROOT, p), 'utf8').split(String.fromCharCode(13)).join('');

const META = { type: 4, data: { href: 'tauri://localhost/', width: 1280, height: 800 }, timestamp: 1000 };
const FULL = { type: 2, data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { left: 0, top: 0 } }, timestamp: 1001 };
const INC = { type: 3, data: { source: 2, type: 2, id: 1, x: 1, y: 1 }, timestamp: 1500 };

function assertPlayable(r, label) {
  assert.equal(r.ok, true, `${label}: ${r.ok ? '' : `${r.problem} ${r.detail}`}`);
  assert.ok(r.bundle.events.length >= 2, label);
  assert.equal(r.bundle.events[0].type, 4, `${label}: starts with Meta`);
  assert.equal(r.bundle.events[1].type, 2, `${label}: then the full snapshot`);
}

describe('every real writer → the app reader', () => {
  for (const name of ['spool-finalize.bmmreplay', 'crash-zip-entry.bmmreplay', 'gzipped.bmmreplay']) {
    test(`${name} (written by the Rust tests)`, async () => {
      const p = join(FIX, name);
      assert.ok(existsSync(p), `${name} is missing: run cd src-tauri && cargo test replay`);
      assertPlayable(await R.parseReplayBytes(new Uint8Array(readFileSync(p))), name);
    });
  }

  test('the spool sample keeps its envelope fields', async () => {
    const r = await R.parseReplayBytes(new Uint8Array(readFileSync(join(FIX, 'spool-finalize.bmmreplay'))));
    assert.equal(r.bundle.bmmReplay, 1);
    assert.equal(r.bundle.console[0].msg, 'hello');
    assert.equal(r.bundle.repaired, undefined);
    assert.equal(r.repaired, false, 'a well-formed recording is played as it is');
  });

  test('the crash report sample has no secret left and still plays', () => {
    const text = readFileSync(join(FIX, 'crash-zip-entry.bmmreplay'), 'utf8');
    assert.ok(!text.includes('s3cr3t-0f-the-user-1234'));
    assertPlayable(R.parseReplayText(text), 'crash zip entry as text (read_crash_session → playReplayJson)');
  });

  test('the release recorder (tools/release/screenshots/replay.mjs buildReplay), plain and gzipped', async () => {
    const text = buildReplay([META, FULL, INC], { title: 'demo', markers: [{ at: 1200, label: 'x' }] });
    assertPlayable(R.parseReplayText(text), 'buildReplay');
    assertPlayable(await R.parseReplayBytes(new Uint8Array(gzipSync(Buffer.from(text)))), 'buildReplay gzipped (shrink-replays)');
  });

  test('Replay Studio and the old in-memory recorder: { bmmReplay, events } as JSON text', () => {
    const studio = JSON.stringify({ bmmReplay: 1, app: 'BetterModsManager', durationMs: 500, events: [META, FULL, INC], regions: [], edit: { trimStart: 0, trimEnd: 0, cuts: [] } });
    const r = R.parseReplayText(studio);
    assertPlayable(r, 'studio bundle');
    assert.deepEqual(r.bundle.regions, [], 'the studio fields travel with the events');
  });
});

describe('older and odd envelopes', () => {
  test('a bare event array, events as a JSON string, events under data / replay / recording', () => {
    for (const [label, doc] of [
      ['array', [META, FULL, INC]],
      ['string events', { bmmReplay: 1, events: JSON.stringify([META, FULL, INC]) }],
      ['data', { data: { events: [META, FULL, INC] } }],
      ['replay', { replay: { events: [META, FULL] } }],
      ['recording', { recording: { events: [META, FULL] }, title: 'kept' }],
    ]) assertPlayable(R.parseReplayText(JSON.stringify(doc)), label);
    assert.equal(R.parseReplayText(JSON.stringify({ recording: { events: [META, FULL] }, title: 'kept' })).bundle.title, 'kept');
  });

  test('one event per line (a spool segment), a cut last line, a BOM', () => {
    const nd = [META, FULL, INC].map((e) => JSON.stringify(e)).join('\n') + '\n{"type":3,"da';
    assertPlayable(R.parseReplayText(nd), 'ndjson');
    assertPlayable(R.parseReplayText('﻿' + JSON.stringify([META, FULL])), 'BOM');
  });

  test('a stream that joined late starts at its first full snapshot', () => {
    const late = R.parseReplayText(JSON.stringify({ events: [INC, INC, META, FULL, INC] }));
    assertPlayable(late, 'late start with a Meta');
    assert.equal(late.repaired, true);
    assert.equal(late.bundle.events.length, 3);
    const noMeta = R.parseReplayText(JSON.stringify({ events: [INC, FULL, INC] }));
    assertPlayable(noMeta, 'late start without a Meta: one is made up');
    assert.equal(noMeta.bundle.events[0].data.width, 1280);
  });

  test('what cannot be played says why', async () => {
    assert.deepEqual(pick(R.parseReplayText('')), ['empty']);
    assert.deepEqual(pick(R.parseReplayText('not json')), ['parse']);
    assert.deepEqual(pick(R.parseReplayText(JSON.stringify({ events: [META] }))), ['empty']);
    assert.deepEqual(pick(R.parseReplayText(JSON.stringify({ events: [META, INC, INC] }))), ['noSnapshot']);
    assert.deepEqual(pick(R.parseReplayText(JSON.stringify({ title: 'no events' }))), ['parse']);
    assert.deepEqual(pick(await R.parseReplayBytes(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))), ['parse']);
    assert.equal(R.replayProblemKey('noSnapshot'), 'watcher.noSnapshot');
    assert.equal(R.replayProblemKey('empty'), 'watcher.empty');
    assert.equal(R.replayProblemKey('parse'), 'watcher.badFile');
  });
});

function pick(r) { return r.ok ? ['ok'] : [r.problem]; }

describe('the wiring', () => {
  const w = src('frontend/src/features/settings/replay-watcher.ts');

  test('every in-app reader goes through the shared parser, files through the core', () => {
    assert.ok(!w.includes('.convertFileSrc('), 'no asset-protocol fetch for a replay file');
    assert.ok(w.includes("invoke('read_replay_file', { path })"));
    for (const fn of ['playReplayJson', 'playReplayFromUrl', 'importReplayFromUrl', 'loadAndPlay']) {
      const body = w.slice(w.indexOf(`function ${fn}(`));
      const end = body.indexOf('\n}\n');
      assert.match(body.slice(0, end), /parseReplayText|parseReplayBytes|playReplayFromUrl|readUrl/, fn);
      assert.doesNotMatch(body.slice(0, end), /JSON\.parse\(/, `${fn} parses through the shared reader`);
    }
  });

  test('the read command is registered and limited to replay files', () => {
    assert.ok(src('src-tauri/src/main.rs').includes('commands::analytics::read_replay_file,'));
    const a = src('src-tauri/src/commands/analytics.rs');
    assert.match(a, /pub async fn read_replay_file[\s\S]{0,400}\.bmmreplay[\s\S]{0,200}refused/);
  });

  test('the crash report writes the replay through the structural scrub', () => {
    const c = src('src-tauri/src/commands/crash.rs');
    assert.ok(c.includes('zip.write_all(&replay_entry_bytes(redactor, replay))?;'));
    assert.ok(!c.includes('zip.write_all(&redactor.scrub_bytes(replay))?;'));
  });

  test('a listener that joins a running recorder gets a fresh snapshot', () => {
    const rec = src('frontend/src/core/replay-recorder.ts');
    assert.match(rec, /export async function subscribeReplay[\s\S]{0,700}takeFullSnapshot\?\.\(true\)/);
  });
});
