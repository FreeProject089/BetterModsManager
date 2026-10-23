// "Update available" on an App Catalog card comes from isNewerVersion. Against the COMPILED
// module, like every other test here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { isNewerVersion, compareVersions } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/apps/app-version.js')).href
);

describe('app catalogue: is the catalogue version newer', () => {
  test('numeric per segment, not alphabetical', () => {
    assert.equal(isNewerVersion('1.10.0', '1.9.3'), true);
    assert.equal(isNewerVersion('1.9.3', '1.10.0'), false);
    assert.equal(isNewerVersion('2', '1.99'), true);
  });
  test('same version, padded or prefixed, is not an update', () => {
    assert.equal(isNewerVersion('1.2', '1.2.0'), false);
    assert.equal(isNewerVersion('v1.2.0', '1.2.0'), false);
    assert.equal(isNewerVersion('1.2.0+build7', '1.2.0'), false);
  });
  test('a final release beats its pre-release, not the other way round', () => {
    assert.equal(isNewerVersion('1.0.0', '1.0.0-rc1'), true);
    assert.equal(isNewerVersion('1.0.0-rc1', '1.0.0'), false);
    assert.equal(isNewerVersion('1.0.0-rc2', '1.0.0-rc1'), true);
  });
  test('a missing side cannot be judged, so it never says update', () => {
    assert.equal(isNewerVersion('1.0', ''), false);
    assert.equal(isNewerVersion('', '1.0'), false);
    assert.equal(isNewerVersion(undefined, null), false);
  });
  test('compareVersions is symmetric', () => {
    assert.equal(compareVersions('1.2.3', '1.2.4') < 0, true);
    assert.equal(compareVersions('1.2.4', '1.2.3') > 0, true);
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  });
});
