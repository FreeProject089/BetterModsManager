// What a task would change, before running it.
//
// The whole feature rests on one honest claim: what is CERTAIN to happen and what is only
// maybe. Getting that wrong in the generous direction is the worse mistake — a preview that
// promises a change which never happens is one people stop reading.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { planOf, previewAgainst } = await import(
    pathToFileURL(join(here, '../frontend/js/features/settings/sched-preview.js')).href
);

const act = (type, id) => ({ kind: 'action', action: { type, params: { id } } });

describe('planOf', () => {
    test('a plain list of mod actions is certain', () => {
        const plan = planOf([act('mod.enable', 'a'), act('mod.disable', 'b')]);
        assert.deepEqual(plan.map((p) => [p.what, p.id, p.certain]), [
            ['enable', 'a', true], ['disable', 'b', true],
        ]);
    });

    test('a step that is switched off is not in the plan at all', () => {
        assert.deepEqual(planOf([{ ...act('mod.enable', 'a'), disabled: true }]), []);
    });

    test('either side of an if is a maybe', () => {
        const plan = planOf([{ kind: 'if', then: [act('mod.enable', 'a')], else: [act('mod.enable', 'b')] }]);
        assert.equal(plan.length, 2);
        assert.ok(plan.every((p) => !p.certain));
    });

    test('a try body is certain and its error handler is not', () => {
        // The body always starts. Only the handler depends on something going wrong.
        const plan = planOf([{ kind: 'try', steps: [act('mod.enable', 'a')], onError: [act('mod.disable', 'b')] }]);
        assert.equal(plan.find((p) => p.id === 'a').certain, true);
        assert.equal(plan.find((p) => p.id === 'b').certain, false);
    });

    test('a retry runs its body at least once', () => {
        const plan = planOf([{ kind: 'retry', times: 3, everySec: 1, steps: [act('mod.enable', 'a')] }]);
        assert.equal(plan[0].certain, true);
    });

    test('every parallel branch runs — they only run together', () => {
        const plan = planOf([{ kind: 'parallel', branches: [[act('mod.enable', 'a')], [act('mod.enable', 'b')]] }]);
        assert.equal(plan.length, 2);
        assert.ok(plan.every((p) => p.certain));
    });

    test('a loop body may run zero times', () => {
        const plan = planOf([{ kind: 'repeat', mode: 'while', steps: [act('mod.enable', 'a')] }]);
        assert.equal(plan[0].certain, false);
    });

    test('an ensure body only runs when the state has drifted', () => {
        const plan = planOf([{ kind: 'ensure', condition: {}, steps: [act('mod.enable', 'a')] }]);
        assert.equal(plan[0].certain, false);
    });

    test('nesting a certain body inside a maybe stays a maybe', () => {
        // The rule that makes the flag worth anything: certainty only ever narrows.
        const plan = planOf([{ kind: 'if', then: [{ kind: 'try', steps: [act('mod.enable', 'a')] }], else: [] }]);
        assert.equal(plan[0].certain, false);
    });

    test('a block call is reported, not silently skipped', () => {
        // Its steps are not read here. Saying so beats leaving half a task out of the answer.
        const plan = planOf([{ kind: 'call', block: 'repair/fetch' }]);
        assert.deepEqual([plan[0].what, plan[0].id], ['block', 'repair/fetch']);
    });

    test('a task with no mod actions plans nothing, rather than everything', () => {
        assert.deepEqual(planOf([act('notify', ''), act('mods.scan', '')]), []);
    });
});

describe('previewAgainst', () => {
    const enabled = new Set(['on']);
    const known = new Set(['on', 'off']);

    test('"already on" is a different answer from "would enable"', () => {
        const lines = previewAgainst(
            [{ what: 'enable', id: 'on', certain: true }, { what: 'enable', id: 'off', certain: true }],
            enabled, known,
        );
        assert.deepEqual(lines.map((l) => l.effect), ['already', 'change']);
    });

    test('a mod this machine does not have is unknown, not a change', () => {
        const lines = previewAgainst([{ what: 'enable', id: 'ghost', certain: true }], enabled, known);
        assert.equal(lines[0].effect, 'unknown');
    });

    test('disabling something already off changes nothing', () => {
        const lines = previewAgainst([{ what: 'disable', id: 'off', certain: true }], enabled, known);
        assert.equal(lines[0].effect, 'already');
    });

    test('a block is always unknown, because its steps were never read', () => {
        const lines = previewAgainst([{ what: 'block', id: 'x', certain: true }], enabled, known);
        assert.equal(lines[0].effect, 'unknown');
    });
});
