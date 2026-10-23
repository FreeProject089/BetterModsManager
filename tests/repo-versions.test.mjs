// Mod versions compared as numbers (frontend/src/features/repo/versions.ts), against the
// COMPILED module. The Rust twin is repo_follow::version_cmp; the cases are the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { versionCmp, isNewerVersion, normRepoUrl } = await import(pathToFileURL(join(here, '../frontend/js/features/repo/versions.js')).href);

test('numbers, not text', () => {
    assert.equal(versionCmp('1.10.0', '1.9.0'), 1);
    assert.equal(versionCmp('v2', '2.0.0'), 0);
    assert.equal(versionCmp('1.0.0-beta', '1.0.0'), -1);
    assert.equal(versionCmp('1.0.0+build7', '1.0.0'), 0);
    assert.equal(versionCmp('summer-2026', '1.0'), null);
});

test('an update is newer, never a downgrade; not numbers = different', () => {
    assert.equal(isNewerVersion('1.10', '1.9'), true);
    assert.equal(isNewerVersion('1.0', '1.0.0'), false);
    assert.equal(isNewerVersion('1.5', '2.0'), false);
    assert.equal(isNewerVersion('beta', 'alpha'), true);
    assert.equal(isNewerVersion(' Alpha ', 'alpha'), false);
});

test('repo urls are recorded the way the sync records them', () => {
    assert.equal(normRepoUrl('HTTP://Host/Repo/repo.json'), 'http://host/repo');
    assert.equal(normRepoUrl('http://host/repo///'), 'http://host/repo');
});
