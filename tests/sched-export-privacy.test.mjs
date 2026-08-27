// What leaves this machine when somebody shares an automation.
//
// The export already dropped perms, enabled and osSchedule — three decisions the person
// importing has to make for themselves. It kept the run history, which is a different kind of
// thing: not a decision, a record of what happened here. Entries carry an error string, and an
// error string routinely carries a local path.
//
// scheduler.js cannot be imported in Node, so this reads the COMPILED source and checks the
// shape of the export payload. Cruder than calling the function, and it still fails if somebody
// puts `...task` back — which is the regression that matters.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../frontend/js/features/settings/scheduler.js'), 'utf8');

describe('a shared .bmmpa carries no local history', () => {
    test('there is exactly one place that shapes a task for export', () => {
        // Two would be two places to forget. The single-task path used to build its own
        // payload inline, and that is the one that kept the history.
        const fn = src.match(/function forExport\(/g) || [];
        assert.equal(fn.length, 1, 'forExport should be defined once');
    });

    test('it removes the three fields that describe THIS machine', () => {
        const body = src.slice(src.indexOf('function forExport('));
        const decl = body.slice(0, body.indexOf('return'));
        for (const field of ['history', 'lastRun', 'lastResult']) {
            assert.ok(decl.includes(field), `forExport should destructure away ${field}`);
        }
    });

    test('it still removes the three that are the importer\'s decision', () => {
        // The behaviour that was already right, pinned so a rewrite cannot drop it: an
        // imported task must arrive disabled, unpermissioned and not registered with Windows.
        const body = src.slice(src.indexOf('function forExport('));
        const ret = body.slice(body.indexOf('return'), body.indexOf('return') + 200);
        assert.ok(ret.includes('perms: {}'), ret);
        assert.ok(ret.includes('enabled: false'), ret);
        assert.ok(ret.includes('osSchedule: false'), ret);
    });

    test('no export path spreads a raw task any more', () => {
        assert.ok(
            !/tasks:\s*\[\{\s*\.\.\.task\b/.test(src),
            'an export is building a payload from a raw task again',
        );
    });
});
