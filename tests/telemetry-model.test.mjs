// Telemetry consent categories and the Laya usage statistics: which event belongs to which
// category, and what a Laya call is turned into. The rule under test: nothing from a question,
// a mod, a file or an error message leaves the model; only counts, booleans, field names and
// short codes. Runs the compiled, import-free model.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/core/telemetry-model.js')).href);

describe('categories', () => {
  test('each event has its category', () => {
    assert.equal(M.categoryOf('page_enter'), 'usage');
    assert.equal(M.categoryOf('click'), 'usage');
    assert.equal(M.categoryOf('perf'), 'perf');
    assert.equal(M.categoryOf('webvitals'), 'perf');
    assert.equal(M.categoryOf('$log_js'), 'errors');
    assert.equal(M.categoryOf('$log_rust'), 'errors');
    assert.equal(M.categoryOf('error'), 'errors');
    assert.equal(M.categoryOf('laya_use'), 'laya');
    assert.equal(M.categoryOf('laya_feedback'), 'laya');
    assert.equal(M.categoryOf('$replay'), 'replay');
  });
  test('"all on" is every category, and "any on" means telemetry on', () => {
    const all = M.allOn();
    assert.deepEqual(Object.keys(all).sort(), [...M.TELEMETRY_CATEGORIES].sort());
    assert.ok(M.TELEMETRY_CATEGORIES.every((k) => all[k] === true));
    assert.equal(M.anyOn({ usage: false, perf: false, errors: false, laya: false, replay: false }), false);
    assert.equal(M.anyOn({ laya: true }), true);
  });
  test('stored choice: absent or unreadable = on, an explicit false is kept', () => {
    assert.deepEqual(M.parseStoredCategories(null), { usage: true, perf: true, laya: true });
    assert.deepEqual(M.parseStoredCategories('{not json'), { usage: true, perf: true, laya: true });
    assert.deepEqual(M.parseStoredCategories('{"perf":false}'), { usage: true, perf: false, laya: true });
  });
});

describe('Laya usage statistics', () => {
  test('latency buckets', () => {
    assert.equal(M.latencyBucket(10), '<250');
    assert.equal(M.latencyBucket(600), '250-1000');
    assert.equal(M.latencyBucket(2000), '1-3s');
    assert.equal(M.latencyBucket(5000), '3-10s');
    assert.equal(M.latencyBucket(60000), '>10s');
    assert.equal(M.latencyBucket(NaN), '<250');
  });
  test('an error is only ever a code', () => {
    assert.equal(M.errorCode('embedded:runtime: C:\\Users\\alice\\model.gguf missing'), 'embedded:runtime');
    assert.equal(M.errorCode('timeout'), 'timeout');
    assert.equal(M.errorCode(new Error('Could not open C:\\Users\\alice\\mods\\x')), 'other');
    assert.equal(M.errorCode('Error: boom'), 'other');
  });
  test('a suggestion, then what the user kept: per-field accept / reject, no values', () => {
    const st = M.newObserverState();
    M.eventsForCommand(st, 'ai_get_settings', {}, true, { settings: { enabled: true, classifier: 'embedded' } }, 5);
    const sug = M.eventsForCommand(st, 'ai_suggest_mod_metadata', { modId: 'm1', useProviders: true }, true, {
      suggestions: [
        { field: 'tags', value: 'secret-mod-name', source: 'laya' },
        { field: 'category', value: 'Weapons', source: 'laya' },
        { field: 'author', value: 'Alice', source: 'files' },
      ],
    }, 1234);
    assert.equal(sug.length, 1);
    assert.equal(sug[0].event, 'laya_use');
    assert.equal(sug[0].props.provider, 'embedded');
    assert.equal(sug[0].props.latency_bucket, '1-3s');
    assert.equal(sug[0].props.abstained, false);
    assert.deepEqual(sug[0].props.suggested_fields, ['tags', 'category', 'author']);
    const fb = M.eventsForCommand(st, 'ai_apply_mod_metadata', { modId: 'm1', fields: { tags: ['x'] } }, true, null, 3);
    assert.deepEqual(fb.map((e) => [e.props.field, e.props.outcome]), [['tags', 'accepted'], ['category', 'rejected'], ['author', 'rejected']]);
    const text = JSON.stringify([sug, fb]);
    assert.ok(!/secret-mod-name|Weapons|Alice|m1/.test(text), 'no value, name or id leaves the model');
    // Applying twice does not count twice.
    assert.deepEqual(M.eventsForCommand(st, 'ai_apply_mod_metadata', { modId: 'm1', fields: {} }, true, null, 3), []);
  });
  test('no AI suggestion = an abstention', () => {
    const st = M.newObserverState();
    const [e] = M.eventsForCommand(st, 'ai_suggest_mod_metadata', { modId: 'm', useProviders: true }, true, { suggestions: [{ field: 'author', source: 'files' }], notes: ['no_model'] }, 50);
    assert.equal(e.props.abstained, true);
    assert.equal(e.props.error, 'no_model');
  });
  test('Ask: a count of hits and a confidence flag, never the question', () => {
    const st = M.newObserverState();
    const [e] = M.eventsForCommand(st, 'ai_ask', { request: { question: 'how do I install my private mod', scope: 'all' } }, true, { answer: { hits: [{}, {}], laya: false } }, 80);
    assert.equal(e.props.feature, 'ask');
    assert.equal(e.props.provider, 'rules');
    assert.equal(e.props.hits, 2);
    assert.ok(!JSON.stringify(e).includes('private mod'));
    assert.equal(M.askClickKind({ mod: 'id-123' }), 'mod');
    assert.equal(M.askClickKind({ page: 'settings' }), 'doc');
    assert.equal(M.askClickKind(null), 'other');
  });
  test('model install / uninstall, and unrelated commands say nothing', () => {
    const st = M.newObserverState();
    assert.deepEqual(M.eventsForCommand(st, 'ai_embedded_install', {}, true, null, 9000), [{ event: 'laya_model', props: { action: 'install', ok: true } }]);
    assert.deepEqual(M.eventsForCommand(st, 'ai_embedded_remove', {}, false, 'busy', 1), [{ event: 'laya_model', props: { action: 'uninstall', ok: false, error: 'busy' } }]);
    assert.deepEqual(M.eventsForCommand(st, 'ai_unknown_thing', {}, true, {}, 1), []);
  });
});
