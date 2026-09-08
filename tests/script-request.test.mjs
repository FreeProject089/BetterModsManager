// What a generated script actually sends, executed rather than read.
//
// Three CI gates already read this list as text — check-action-body-keys joins each case to
// its route and checks the key names, check-action-fields checks every value it reads is one
// a card can fill, check-generator-coverage checks which endpoints it can reach. All three
// are about the SHAPE of the list, and none of them runs it. So none of them can see that a
// pruned `0` disappears, that a comma-separated list arrives as one string, or that a JSON
// box holding a string of JSON goes out as a string.
//
// Those are the three ways this function has actually been wrong, so those are the tests.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { apiBodyFor, _prune, _json } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/plugins/script-request.js')).href
);

/** A card as the generator hands it over: a type, an optional target, and typed extras. */
const act = (action_type, extra = {}, target_id = '') => ({ action_type, target_id, extra });

describe('_prune', () => {
  test('drops empty strings, because an absent key and an empty one mean different things', () => {
    // The import routes read an ABSENT path as "open the picker" and an empty string as a
    // path that is empty, which fails. That distinction is the whole reason this exists.
    assert.deepEqual(_prune({ a: '', b: 'x' }), { b: 'x' });
  });

  test('drops null and undefined', () => {
    assert.deepEqual(_prune({ a: null, b: undefined, c: 1 }), { c: 1 });
  });

  test('KEEPS zero and false — they are answers, not absences', () => {
    // `0` is falsy and is the correct value for "no upload limit"; `false` is the correct
    // value for "do not delete extra files". A pruner written with `if (v)` would drop both
    // and the route would fall back to its default, which for deleteExtra is the opposite
    // of what was asked.
    assert.deepEqual(_prune({ limit: 0, wipe: false }), { limit: 0, wipe: false });
  });
});

describe('_json', () => {
  test('parses, so the body carries an object and not a string holding one', () => {
    assert.deepEqual(_json('{ "a": 1 }'), { a: 1 });
  });

  test('an empty box is an empty object, not an empty string', () => {
    assert.deepEqual(_json('   '), {});
  });

  test('text that will not parse is passed through, so the server can say why', () => {
    // Returning `{}` here would be worse than useless: the request would succeed and act on
    // an empty document, and the person would be told nothing about the typo.
    assert.equal(_json('{ oops'), '{ oops');
  });
});

describe('apiBodyFor — the shapes that were wrong before', () => {
  test('content_id sends the DOCUMENT, parsed', () => {
    // It used to send `id` and `path`, which that route does not declare: serde dropped both,
    // `doc` was absent, and every run answered 400.
    const r = apiBodyFor(act('content_id', { kind: 'modpack', doc: '{"name":"p"}' }));
    assert.equal(r.method, 'POST');
    assert.equal(r.path, '/api/content-id');
    assert.deepEqual(r.body, { kind: 'modpack', doc: { name: 'p' } });
  });

  test('a comma-separated list becomes an array, because a script has no multi-select', () => {
    const r = apiBodyFor(act('repo_gen_now', {
      outputDir: 'C:/out', authorName: 'me', profileIds: 'a, b ,c',
    }));
    assert.deepEqual(r.body.profileIds, ['a', 'b', 'c']);
  });

  test('and an empty list is an empty array, not [""]', () => {
    // `''.split(',')` is `['']`, and one empty id is not the same request as no ids —
    // the route refuses an empty list on purpose and would have been handed a non-empty one.
    const r = apiBodyFor(act('set_mod_order', { order: '', profileId: '' }));
    assert.equal(r.body.order, undefined, 'an empty order is pruned rather than sent as [""]');
  });

  test('set_mod_order trims and keeps the order given', () => {
    const r = apiBodyFor(act('set_mod_order', { order: ' m1 , m2 ', profileId: 'p1' }));
    assert.deepEqual(r.body, { order: ['m1', 'm2'], profileId: 'p1' });
  });

  test('an import with no path sends NO path, which is what opens the picker', () => {
    const r = apiBodyFor(act('import_modlist', { path: '' }));
    assert.deepEqual(r.body, {});
  });

  test('an import with a path runs unattended', () => {
    const r = apiBodyFor(act('import_modpack', { path: 'C:/p.bmp' }));
    assert.deepEqual(r.body, { path: 'C:/p.bmp' });
  });

  test('the escape hatch upper-cases its method and falls back to something harmless', () => {
    assert.equal(apiBodyFor(act('api_call', { method: 'post', path: '/api/x', body: '{"a":1}' })).method, 'POST');
    const bare = apiBodyFor(act('api_call', {}));
    assert.equal(bare.method, 'GET');
    assert.equal(bare.path, '/api/status', 'an empty path must not become a request to /');
    assert.deepEqual(bare.body, {});
  });

  test('a path parameter is interpolated, and named when it is missing', () => {
    assert.equal(apiBodyFor(act('uninstall_plugin', { id: 'my.plugin' })).path, '/api/plugins/my.plugin');
    // A generated script is read before it is run, so a missing id has to be VISIBLE in it.
    // An empty segment would make the path `/api/plugins/` — a different route, or a 404.
    assert.equal(apiBodyFor(act('uninstall_plugin', {})).path, '/api/plugins/PLUGIN_ID');
  });

  test('a hook name is percent-encoded, so a space does not truncate the path', () => {
    assert.equal(apiBodyFor(act('read_hook', { name: 'nightly done' })).path, '/api/hook/nightly%20done');
  });

  test('repo_manifest sends modsDir — the name the route declares', () => {
    // It sent `dir`, which GenerateManifestArgs does not have, so serde dropped it and every
    // run of this action generated a manifest from no source at all.
    const r = apiBodyFor(act('repo_manifest', { dir: 'C:/host' }));
    assert.deepEqual(r.body, { modsDir: 'C:/host' });
  });

  test('follow_catalog keeps `follow: false`, which is how you UNfollow', () => {
    const r = apiBodyFor(act('follow_catalog', { type: 'plugin', url: 'https://x/i.json', follow: 'false' }));
    assert.equal(r.body.follow, false);
    assert.equal('password' in r.body, false, 'an untouched password must be absent, not ""');
  });

  test('a non-API card returns null rather than a request to nowhere', () => {
    assert.equal(apiBodyFor(act('log', { message: 'hi' })), null);
    assert.equal(apiBodyFor(act('if_file_exists', { path: 'x' })), null);
  });

  test('target_id is used where the card has no field of its own', () => {
    assert.deepEqual(apiBodyFor(act('enable_mod', {}, 'mod-1')).body, { mod_id: 'mod-1' });
    assert.equal(apiBodyFor(act('delete_mod', {}, 'mod-1')).path, '/api/mods/mod-1');
  });

  test('every reads-only card asks with GET and an empty body', () => {
    for (const id of ['list_mods', 'list_profiles', 'list_schedules', 'list_catalogs', 'list_keys']) {
      const r = apiBodyFor(act(id));
      assert.equal(r.method, 'GET', `${id} should be a GET`);
      assert.deepEqual(r.body, {}, `${id} should send no body`);
    }
  });

  test('every path starts at /api/ — a relative one would resolve against the page', () => {
    // Belt and braces over the whole table rather than case by case: a typo that drops the
    // leading slash produces a request to somewhere else entirely, and nothing else looks.
    const ids = [
      'enable_mod', 'disable_mod', 'activate_profile', 'apply_plugin', 'sync_repo', 'gen_repo',
      'http_host', 'get_status', 'repo_list', 'update_mod', 'create_profile', 'follow_catalog',
      'repo_take', 'repo_sync_now', 'repo_gen_now', 'repo_host_now', 'content_id', 'open_view',
      'import_modlist', 'export_modlist', 'import_modpack', 'export_modpack', 'import_plugin',
      'export_plugin', 'uninstall_plugin', 'import_data', 'import_language', 'list_schedules',
      'list_catalogs', 'list_keys', 'read_hook', 'clear_hooks', 'mod_config', 'update_mods',
      'set_mod_order', 'api_call',
    ];
    for (const id of ids) {
      const r = apiBodyFor(act(id));
      assert.ok(r, `${id} should build a request`);
      assert.match(r.path, /^\/api\//, `${id} builds "${r.path}"`);
      assert.match(r.method, /^(GET|POST|PUT|DELETE)$/, `${id} uses "${r.method}"`);
    }
  });
});
