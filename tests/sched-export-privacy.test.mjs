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

// Stripping `perms` on import only means something if every capability actually asks for its
// grant. Twenty actions fired a bmm:// link through the `dl()` helper and none of them did —
// so an imported task arrived with the `deeplink` box cleared, said it had asked for nothing,
// and could still fire `data/export-auto`. That link runs as origin `scheduler`, which the
// deep-link gate trusts: no dialog, and no refusal of a network path. `dir=\\host\share`
// copied the UNREDACTED data file — API token, repo passwords, GitHub token — off the machine.
describe('a task fires no deeplink it was not permitted to fire', () => {
    // Comments stripped first, and only WHOLE-LINE ones. Two probes were wrong before this
    // one read right: the first looked for the `bmm://` that ends the helper's preamble and
    // found the one in the comment above the gate; the second stripped `//…` anywhere, which
    // ate `bmm://` itself and every line that built the URL. Both reported a correct gate as
    // missing. A probe that finds something is the first suspect.
    const bare = src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/^[ \t]*\/\/[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ' '));
    const run = bare.slice(bare.indexOf('async function runAction'));

    test('the dl() helper asks for the deeplink permission before building the URL', () => {
        const dl = run.slice(run.indexOf('const dl = ('));
        const body = dl.slice(0, dl.indexOf('bmm://') + 8);
        assert.ok(body.includes('requirePerm('), 'dl() fires a bmm:// link with no permission check');
        assert.ok(/requirePerm\([^)]*'deeplink'/.test(body), body.slice(0, 400));
    });

    test('the actions that used dl() directly are covered by it', () => {
        // Named, so that moving one of them off dl() to a bare runDeepLink() is a failure
        // here rather than a silent return of the same hole.
        for (const a of ['data.exportAuto', 'replay.export', 'replay.import', 'recorder.set',
            'discord.rpc', 'telemetry.set', 'app.install', 'repo.connect', 'restart']) {
            const i = run.indexOf(`case '${a}':`);
            assert.ok(i > 0, `${a} is no longer a case in runAction`);
            const seg = run.slice(i, i + 260);
            assert.ok(/\bdl\(/.test(seg) || /requirePerm\([^)]*'deeplink'/.test(seg),
                `${a} fires a link without going through dl() or asking for 'deeplink'`);
        }
    });

    test('an old task keeps the capability it was consented to', () => {
        // taskPerms derives deeplink:true for a task written before `perms` existed, so this
        // is a box somebody ticked OFF taking effect — not a retroactive revocation.
        const tp = src.slice(src.indexOf('function taskPerms('), src.indexOf('function requirePerm('));
        assert.match(tp, /deeplink:\s*true/, 'a legacy task must keep its deeplinks');
    });
});
