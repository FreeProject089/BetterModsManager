// A mod name is a free-form string: on repo sync it is set from the remote repo.json
// (`mod_entry.name`), and a modpack can be imported from a file or a deeplink. Both reach the
// modpack creator, whose "available mods" list and meta form build innerHTML. One row escaped
// its name (line ~863) and the picker beside it did not — a `<img src=x onerror=…>` mod name
// ran in the BMM webview, which reaches invoke (CWE-79). Pinned at the source: the module
// needs a DOM to import.
//
// The check is deliberately about the RAW field reference `${m.name`, not a regex built at
// runtime — a generated regex through a heredoc turned `\b` into a backspace once already and
// the test went green over the bug (see memory: generated-regex-backspace-trap).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'frontend/src/features/mods/modpack-creator.ts'), 'utf8');

// A `${expr` opening where `expr` begins with the field, before any escaper. `${m.name` is
// raw; `${escHtml(m.name` and `${escAttr(m.name` are not (the field does not start the expr).
function rawInterpolations(text, field) {
    const needle = '${' + field;
    const out = [];
    let i = 0;
    while ((i = text.indexOf(needle, i)) !== -1) {
        // The char after the field name must be a boundary (space, |, }, ), etc.), not more
        // identifier — so `${m.id` does not count as `${m.i`.
        const after = text[i + needle.length];
        if (!/[A-Za-z0-9_.]/.test(after || '')) out.push(text.slice(0, i).split('\n').length);
        i += needle.length;
    }
    return out;
}

describe('the modpack creator escapes untrusted strings before innerHTML', () => {
    for (const f of ['m.name', 'm.id', '_editingPack.name', '_editingPack.description', '_editingPack.game_name']) {
        test(`${f} is never interpolated raw`, () => {
            const bad = rawInterpolations(src, f);
            assert.deepEqual(bad, [], `${f} interpolated without escHtml/escAttr at line(s) ${bad.join(', ')}`);
        });
    }

    test('the probe distinguishes raw from escaped (self-check)', () => {
        assert.equal(rawInterpolations('a ${m.name} b', 'm.name').length, 1, 'a raw field is not detected');
        assert.equal(rawInterpolations('a ${m.name || m.id} b', 'm.name').length, 1);
        assert.equal(rawInterpolations('a ${escHtml(m.name)} b', 'm.name').length, 0, 'an escaped field is flagged');
        assert.equal(rawInterpolations('a ${m.names} b', 'm.name').length, 0, 'a longer identifier is not a false hit');
    });

    test('the available-mods list wraps the name in escHtml', () => {
        const i = src.indexOf('mp-mod-name');
        assert.ok(i > 0, 'available-mods row not found');
        const row = src.slice(i - 200, i + 120);
        assert.match(row, /escHtml\(m\.name/);
        assert.match(row, /data-name="\$\{escAttr\(/);
    });
});
