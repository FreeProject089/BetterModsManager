// An automation exported as a script (features/settings/sched-script.ts).
//
// Pinned: a step with a script form keeps it, an API call is written in the script's language
// with the token read from BMM_TOKEN (never inline), and a step a script cannot carry is a
// comment that says so — never silently dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/sched-script.js')).href);
const act = (type, params = {}) => ({ kind: 'action', action: { type, params } });
const label = (st) => st.action?.type || st.kind;
const BASE = 'http://127.0.0.1:8085';

test('steps with a script form keep it, the others are comments', () => {
  const plan = S.toScriptActions([
    act('mod.enable', { id: 'm1' }),
    { kind: 'delay', seconds: 2 },
    act('nav.page', { page: 'library' }),
    { kind: 'if', condition: { type: 'always', params: {} }, then: [], else: [] },
    act('notify', { message: 'hi' }),
    { ...act('mod.disable', { id: 'm2' }), disabled: true },
  ], 'ps1', BASE, label);
  assert.deepEqual(plan.actions.map((a) => a.action_type), ['enable_mod', 'wait', 'comment', 'comment', 'show_message']);
  assert.equal(plan.actions[0].target_id, 'm1');
  assert.equal(plan.actions[1].extra.duration_ms, 2000);
  assert.deepEqual(plan.skipped.map((x) => x.n), [3, 4]);
});

test('an API call is code in the language, the token from the environment', () => {
  for (const fmt of S.API_CODE_FORMATS) {
    const plan = S.toScriptActions([act('api.call', { method: 'POST', path: '/api/mods/scan', body: '{"a":1}' })], fmt, BASE, label);
    assert.equal(plan.actions[0].action_type, 'raw_code', fmt);
    const code = plan.actions[0].extra.code;
    assert.match(code, /\/api\/mods\/scan/, fmt);
    assert.match(code, /BMM_TOKEN/, fmt);
  }
  const lua = S.toScriptActions([act('api.call', { method: 'GET', path: '/api/status' })], 'lua', BASE, label);
  assert.equal(lua.actions[0].action_type, 'comment');
  assert.equal(lua.skipped.length, 1);
});

test('a GET carries no body', () => {
  assert.doesNotMatch(S.apiCallCode('ps1', 'GET', '/api/status', '{"x":1}', BASE), /-Body/);
  assert.match(S.apiCallCode('ps1', 'POST', '/api/x', '{"x":1}', BASE), /-Body '\{"x":1\}'/);
});
