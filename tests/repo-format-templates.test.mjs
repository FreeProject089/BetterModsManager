// The mini-servers say what format their repo.json is in (startup log, /monitoring.json).
// Their `repoFormatOf` restates BMM's shape detection (src-tauri/src/commands/repo_format.rs)
// in a few lines of JS. These run it over the SAME fixtures the Rust tests use, so the two
// cannot drift apart: a server calling a 0.3 manifest « legacy 0.2 » sends its owner to
// convert for the wrong reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TPL = path.join(ROOT, 'src-tauri', 'src', 'templates', 'mini-server');
const FIX = path.join(ROOT, 'src-tauri', 'tests', 'repo_format');

function load(name) {
    const src = readFileSync(path.join(TPL, name), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('function repoFormatOf(');
    assert.ok(start >= 0, `${name}: no repoFormatOf`);
    const end = src.indexOf('\n}\n', start);
    return new Function(`${src.slice(start, end + 2)}; return repoFormatOf;`)();
}

const EXPECT = {
    'v0.1-first-export.json': 'legacy 0.1',
    'v0.2-signed.json': 'legacy 0.2',
    'v0.3-modpacks.json': 'legacy 0.3',
    'v0.4-hosting.json': 'legacy 0.4',
    'v1.0.json': 'format 1.0',
};

for (const name of ['server.express.js.template', 'hub-server.js.template', 'bmm-extras.js.template']) {
    test(`${name}: names every fixture's format like BMM does`, () => {
        const repoFormatOf = load(name);
        const files = readdirSync(FIX).filter((f) => f.endsWith('.json'));
        assert.deepEqual(files.sort(), Object.keys(EXPECT).sort(), 'a fixture was added: give it an expectation here');
        for (const f of files) {
            assert.equal(repoFormatOf(JSON.parse(readFileSync(path.join(FIX, f), 'utf8'))), EXPECT[f], f);
        }
        assert.equal(repoFormatOf([]), 'not a repo manifest');
        assert.equal(repoFormatOf({ formatVersion: '1.2' }), 'format 1.2');
    });
}

test('server.express.js.template: the admin dashboard keeps format_version when it rewrites repo.json', () => {
    const src = readFileSync(path.join(TPL, 'server.express.js.template'), 'utf8');
    const at = src.indexOf("app.post('/admin/update'");
    const body = src.slice(at, src.indexOf('});', at));
    assert.match(body, /format_version/, 'the rewrite must carry the declared format over');
});
