// The HTTP action's logic, against the COMPILED module.
//
// Everything between what somebody types into the step and the invoke() call. The Rust side
// has its own tests over real sockets; these cover the two pieces in the middle, so that
// what remains unverified in this feature is the single invoke() line and nothing else.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseHeaderLines, readJsonPath, statusIsFailure } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/http-action.js')).href
);

describe('parseHeaderLines', () => {
  test('one header per line', () => {
    assert.deepEqual(parseHeaderLines('Authorization: Bearer abc\nAccept: application/json'), {
      Authorization: 'Bearer abc',
      Accept: 'application/json',
    });
  });

  test('only the FIRST colon separates', () => {
    // A date header carries colons in its value. Splitting on every colon would send
    // `Date: Mon, 01 Jan 2026 00` and silently drop the rest.
    assert.deepEqual(parseHeaderLines('Date: Mon, 01 Jan 2026 00:00:00 GMT'), {
      Date: 'Mon, 01 Jan 2026 00:00:00 GMT',
    });
  });

  test('a blank line is skipped, not turned into an empty header', () => {
    // Inventing `"": ""` would be rejected by the backend, reporting a malformed header
    // the person never wrote.
    assert.deepEqual(parseHeaderLines('A: 1\n\n\nB: 2'), { A: '1', B: '2' });
  });

  test('a line with no colon is skipped', () => {
    assert.deepEqual(parseHeaderLines('this is a note\nA: 1'), { A: '1' });
  });

  test('a leading colon is not a header with an empty name', () => {
    assert.deepEqual(parseHeaderLines(': value'), {});
  });

  test('CRLF is handled — the field is a textarea and people paste', () => {
    assert.deepEqual(parseHeaderLines('A: 1\r\nB: 2'), { A: '1', B: '2' });
  });

  test('empty input is an empty map, not a crash', () => {
    assert.deepEqual(parseHeaderLines(''), {});
    assert.deepEqual(parseHeaderLines(null), {});
  });
});

describe('readJsonPath', () => {
  const body = JSON.stringify({
    data: [{ version: '1.2.3', tags: ['a', 'b'] }, { version: '9' }],
    ok: true,
    count: 0,
    nested: { deep: { value: 'found' } },
    nothing: null,
  });

  test('a dotted path reads a nested value', () => {
    assert.equal(readJsonPath(body, 'nested.deep.value'), 'found');
  });

  test('a numeric segment indexes an array', () => {
    assert.equal(readJsonPath(body, 'data.0.version'), '1.2.3');
    assert.equal(readJsonPath(body, 'data.1.version'), '9');
  });

  test('an empty path returns the whole document', () => {
    assert.equal(readJsonPath(body, ''), body);
  });

  test('an object or array is stringified, not "[object Object]"', () => {
    assert.equal(readJsonPath(body, 'data.0.tags'), '["a","b"]');
  });

  test('false and 0 survive — they are values, not absences', () => {
    // A truthiness check here would turn `count: 0` into '' and a later comparison
    // against 0 would be false for the wrong reason.
    assert.equal(readJsonPath(body, 'count'), '0');
    assert.equal(readJsonPath(JSON.stringify({ ok: false }), 'ok'), 'false');
  });

  test('a missing field is empty, never the text "undefined"', () => {
    // 'undefined' reads like a value: `{x} == undefined` would be true for the wrong reason.
    assert.equal(readJsonPath(body, 'nope'), '');
    assert.equal(readJsonPath(body, 'data.99.version'), '');
    assert.equal(readJsonPath(body, 'nothing'), '');
  });

  test('walking THROUGH a missing branch is empty rather than a crash', () => {
    assert.equal(readJsonPath(body, 'nope.deeper.still'), '');
  });

  test('a body that is not JSON throws, and is told apart from "not found"', () => {
    // A 500 serving an HTML error page and a 200 whose shape changed are different
    // problems; reporting both as empty sends somebody looking in the wrong place.
    assert.throws(() => readJsonPath('<html>500</html>', 'a.b'), /not-json/);
  });
});

describe('statusIsFailure', () => {
  test('2xx is never a failure', () => {
    for (const s of [200, 201, 204, 299]) assert.equal(statusIsFailure(s, false), false);
  });

  test('4xx and 5xx stop the step by default', () => {
    for (const s of [400, 404, 500, 503]) assert.equal(statusIsFailure(s, false), true);
  });

  test('3xx counts as a failure — a redirect the client did not follow is not an answer', () => {
    assert.equal(statusIsFailure(304, false), true);
  });

  test('opting in makes every status pass', () => {
    // The server-watch preset relies on this: the point is to SEE a bad status and branch
    // on it, and the default would abort before reaching the check.
    for (const s of [404, 500, 0]) assert.equal(statusIsFailure(s, true), false);
  });

  test('a zero status — no answer at all — is a failure unless opted in', () => {
    assert.equal(statusIsFailure(0, false), true);
  });
});
