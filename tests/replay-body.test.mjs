// readReplayBody (frontend/src/core/replay-body.ts): the docs replays are stored gzipped under
// their .bmmreplay name once they pass the size budget, the older ones and every user export are
// plain JSON. The in-app viewer and the Help hub must read both, or the hub's « Play the recorded
// session » fails on every story recorded for 1.0.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readReplayBody } from '../frontend/js/core/replay-body.js';

const bundle = { title: 'demo', events: [{ type: 4, timestamp: 1 }, { type: 2, timestamp: 2 }] };

test('a plain JSON .bmmreplay is read as it is', async () => {
  const got = await readReplayBody(new Response(JSON.stringify(bundle)));
  assert.deepEqual(got, bundle);
});

test('a gzipped .bmmreplay (served without Content-Encoding) is inflated', async () => {
  const got = await readReplayBody(new Response(gzipSync(Buffer.from(JSON.stringify(bundle)))));
  assert.deepEqual(got, bundle);
});

test('a body that is neither throws, so the caller shows « unreadable file »', async () => {
  await assert.rejects(() => readReplayBody(new Response('not json')));
});
