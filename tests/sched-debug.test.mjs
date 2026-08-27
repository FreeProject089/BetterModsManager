// What the debugger SHOWS you, against the compiled module.
//
// The panel is a window onto a run, and a window that renders the same variable twice — or
// hides the half a comparison is actually reading — sends somebody looking for a bug that is
// not there. That is the whole of what these tests cover.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const here = dirname(fileURLToPath(import.meta.url));
const { snapshot } = await import(
    pathToFileURL(join(here, '../frontend/js/features/settings/sched-debug.js')).href
);

const ctx = (over = {}) => ({ nums: {}, text: {}, ...over });

describe('snapshot', () => {
    test('a name in both bags appears ONCE, marked as both', () => {
        // The ordinary case: one capture writes the text and its number. Two rows would read
        // as two variables; one row showing only the number hides what a string comparison is
        // reading.
        const rows = snapshot(ctx({ text: { n: '42' }, nums: { n: 42 } }));
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0], ['n', 'text + num', '42']);
    });

    test('a shared value shows only when nothing in the run claims the name', () => {
        // Substitution prefers the run's own value, so showing the shared one under the same
        // name would show a value the next step will not use.
        const both = snapshot(ctx({ text: { p: 'run' }, shared: { p: 'stored' } }));
        assert.deepEqual(both.map((r) => r[2]), ['run']);

        const only = snapshot(ctx({ shared: { p: 'stored' } }));
        assert.deepEqual(only[0], ['p', 'shared', 'stored']);
    });

    test('lists and maps are shown as their JSON, not as [object Object]', () => {
        const rows = snapshot(ctx({ lists: { xs: ['a', 'b'] }, maps: { m: { k: 'v' } } }));
        const byName = Object.fromEntries(rows.map((r) => [r[0], r[2]]));
        assert.equal(byName.xs, '["a","b"]');
        assert.equal(byName.m, '{"k":"v"}');
    });

    test('rows are sorted, so the same run reads the same way twice', () => {
        const rows = snapshot(ctx({ text: { zebra: '1', apple: '2' } }));
        assert.deepEqual(rows.map((r) => r[0]), ['apple', 'zebra']);
    });

    test('an empty context is an empty list, not a row saying nothing', () => {
        assert.deepEqual(snapshot(ctx()), []);
    });
});
