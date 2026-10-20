// « My icons »: the zip the picker exports must read back byte for byte, because it is the only
// way a set of icons travels between machines. (The SVG sanitiser needs a DOM and is exercised
// in the app preview; the container format is pure.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mine = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/icon-mine.js')).href);

test('a stored zip reads back with the same names and bytes', async () => {
    const files = [
        { name: 'alpha.svg', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>') },
        { name: 'bravo.png', bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]) },
    ];
    const back = await mine.readZip(mine.makeZip(files));
    assert.deepEqual(back.map((f) => f.name), ['alpha.svg', 'bravo.png']);
    assert.deepEqual(back.map((f) => Array.from(f.bytes)), files.map((f) => Array.from(f.bytes)));
});

test('a file that is not a zip is refused instead of read as one', async () => {
    await assert.rejects(() => mine.readZip(new TextEncoder().encode('not a zip at all, just some text padded out')));
});

test('only image data URLs of the allowed kinds are kept from a bundle', () => {
    assert.equal(mine.cleanIconData('data:text/html;base64,PGI+'), null);
    assert.equal(mine.cleanIconData('javascript:alert(1)'), null);
    assert.ok(mine.cleanIconData('data:image/png;base64,iVBORw0KGgo='));
});
