// Reading a list out of what somebody typed.
//
// The test that matters is the JSON one. A JSON array split on its commas produces items like
// `["a` and `"c"]` — not an error, not empty, just wrong. `for each` then runs a step against
// each of them and the task reports success. A failure that looks like data is the worst
// shape available here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { parseList } = await import(pathToFileURL(join(here, '../frontend/js/features/settings/sched-vars.js')).href);

describe('parseList', () => {
    test('a JSON array is parsed as JSON, not split on its commas', () => {
        assert.deepEqual(parseList('["a", "b", "c"]'), ['a', 'b', 'c']);
    });

    test('a hand-written line is split on the delimiter', () => {
        // Both shapes are what people actually paste: an API answers JSON, a person types
        // a, b, c.
        assert.deepEqual(parseList('a, b, c'), ['a', 'b', 'c']);
    });

    test('a custom delimiter', () => {
        assert.deepEqual(parseList('a|b|c', '|'), ['a', 'b', 'c']);
    });

    test('something that starts with [ but is not JSON falls back to splitting', () => {
        // Otherwise a typo silently produces an empty list, and the loop runs zero times
        // while the task reports success.
        assert.deepEqual(parseList('[broken, b'), ['[broken', 'b']);
    });

    test('a trailing comma is a typo, not an empty item', () => {
        // An empty item makes `for each` run a step against nothing.
        assert.deepEqual(parseList('a, b, '), ['a', 'b']);
        assert.deepEqual(parseList('a,,b'), ['a', 'b']);
    });

    test('an array in, an array out — already-parsed input is not re-parsed', () => {
        assert.deepEqual(parseList(['a', ' b ', '']), ['a', 'b']);
    });

    test('empty and nullish are an empty list, never [""]', () => {
        for (const v of ['', '   ', null, undefined]) assert.deepEqual(parseList(v), [], String(v));
    });

    test('numbers become strings, so every item compares the same way', () => {
        assert.deepEqual(parseList([1, 2]), ['1', '2']);
    });
});
