// The extras every generated standalone server loads (bmm-extras.js: status page, /health, the
// Atom feed, ETag/304, ranges, rate limit, scheduled jobs). The template ships with its own
// self-test (bmm-server/selftest.js in a generated folder): it is run here on the templates, as
// an owner would run it on their server, so a change that breaks it fails BMM's suite first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const T = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'src', 'templates', 'mini-server');

test('the shipped self-test passes on the templates', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bmm-extras-'));
    try {
        mkdirSync(path.join(dir, 'bmm-server'));
        copyFileSync(path.join(T, 'bmm-extras.js.template'), path.join(dir, 'bmm-extras.js'));
        copyFileSync(path.join(T, 'selftest.js.template'), path.join(dir, 'bmm-server', 'selftest.js'));
        const r = spawnSync(process.execPath, [path.join(dir, 'bmm-server', 'selftest.js')], { encoding: 'utf8', timeout: 60000 });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, /\d+ passed, 0 failed/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
