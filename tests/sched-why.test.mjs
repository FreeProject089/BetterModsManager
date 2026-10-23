// Why a task has not run.
//
// The ORDER is the whole design: a task that is both disabled and not due reads as disabled,
// because turning it on is the thing that would change something. These tests are about that
// ordering, not about the wording — the wording lives in the dictionaries.
//
// Against sched-why.js, not scheduler.js. The first version of this file imported the latter
// and died on `requestAnimationFrame is not defined` — which is exactly why the deciding half
// was split out, and the same reason sched-time.ts and sched-vars.ts exist.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { reasonNotRunning } = await import(
    pathToFileURL(join(here, '../frontend/js/features/settings/sched-why.js')).href
);

const task = (over = {}) => ({
    id: 't1', name: 'T', enabled: true,
    trigger: { type: 'dailyAt', time: '03:00' }, ...over,
});

/** Nothing has fired yet, unless a test says otherwise. */
const fired = (over = {}) => ({
    watch: new Set(), event: new Set(), appStart: new Set(), once: new Set(),
    after: new Set(), cond: new Set(), probe: new Set(), ...over,
});

describe('reasonNotRunning', () => {
    test('off beats everything else', () => {
        // Disabled AND missing a file to watch: reported as disabled, because turning it on is
        // the thing that would change something.
        const r = reasonNotRunning(
            task({ enabled: false, trigger: { type: 'watchFile', path: '' } }), fired(), null,
        );
        assert.equal(r.key, 'sched.why.off');
    });

    test('a manual task is not broken, and says so', () => {
        assert.equal(
            reasonNotRunning(task({ trigger: { type: 'manual' } }), fired(), null).key,
            'sched.why.manual',
        );
    });

    test('a watch with no file differs from a watch that is waiting', () => {
        assert.equal(
            reasonNotRunning(task({ trigger: { type: 'watchFile', path: '' } }), fired(), null).key,
            'sched.why.watchNoPath',
        );
        // Never polled: the first poll records and does not fire, so "armed but nothing seen
        // yet" is a real state and must not look like a fault.
        const arming = reasonNotRunning(
            task({ trigger: { type: 'watchFile', path: 'C:/a/b.log' } }), fired(), null,
        );
        assert.equal(arming.key, 'sched.why.watchArming');
        assert.equal(arming.v, 'b.log', 'the file name, not the whole path');

        const idle = reasonNotRunning(
            task({ trigger: { type: 'watchFile', path: 'C:/a/b.log' } }),
            fired({ watch: new Set(['t1']) }), null,
        );
        assert.equal(idle.key, 'sched.why.watchIdle');
    });

    test('an event trigger names the event it is waiting for', () => {
        const r = reasonNotRunning(
            task({ trigger: { type: 'onEvent', event: 'bmm.mod.missing' } }), fired(), null,
        );
        assert.equal(r.v, 'bmm.mod.missing');
        assert.equal(
            reasonNotRunning(task({ trigger: { type: 'onEvent', event: '' } }), fired(), null).key,
            'sched.why.eventNone',
        );
    });

    test('app start tells you which side of the launch you are on', () => {
        const before = reasonNotRunning(task({ trigger: { type: 'appStart' } }), fired(), null);
        assert.equal(before.key, 'sched.why.appStartSoon');
        const after = reasonNotRunning(
            task({ trigger: { type: 'appStart' } }), fired({ appStart: new Set(['t1']) }), null,
        );
        assert.equal(after.key, 'sched.why.appStartDone');
    });

    test('a once trigger that already ran says so instead of a date', () => {
        const done = reasonNotRunning(
            task({ trigger: { type: 'once', at: '2020-01-01T09:00' }, lastRun: 1 }), fired(), null,
        );
        assert.equal(done.key, 'sched.why.onceDone');

        const bad = reasonNotRunning(
            task({ trigger: { type: 'once', at: 'not a date' } }), fired(), null,
        );
        assert.equal(bad.key, 'sched.why.onceBadDate');
    });

    test('an ordinary calendar task gets a time, not a reason', () => {
        const r = reasonNotRunning(task(), fired(), Date.parse('2026-08-28T03:00:00'));
        assert.equal(r.key, 'sched.why.dueAt');
        assert.ok(r.v && r.v.length > 0);
    });

    test('no next time is its own answer, not an empty one', () => {
        // A calendar trigger that can never come round again — a monthly 31st in a calendar
        // that skips it, a weekly with no day picked. Silence here is what this whole change
        // is replacing.
        const r = reasonNotRunning(task({ trigger: { type: 'weeklyAt', time: '08:00', days: [] } }), fired(), null);
        assert.equal(r.key, 'sched.why.noNext');
    });
});

describe('the triggers that wait on something other than a clock', () => {
    test('after another task: no task picked, and a task that has been deleted', () => {
        assert.equal(
            reasonNotRunning(task({ trigger: { type: 'afterTask', taskId: '' } }), fired(), null).key,
            'sched.why.afterNone',
        );
        // The one that matters: a chain whose first half was deleted looks exactly like a
        // working chain from the outside, and says nothing at all without this.
        assert.equal(
            reasonNotRunning(
                task({ trigger: { type: 'afterTask', taskId: 'gone' } }), fired(), null,
                { nameOf: () => null },
            ).key,
            'sched.why.afterGone',
        );
    });

    test('after another task: the NAME is reported, never the id', () => {
        const r = reasonNotRunning(
            task({ trigger: { type: 'afterTask', taskId: 't2' } }),
            fired({ after: new Set(['t1']) }),
            null,
            { nameOf: (id) => (id === 't2' ? 'Nightly sync' : null) },
        );
        assert.equal(r.key, 'sched.why.afterIdle');
        assert.equal(r.v, 'Nightly sync');
    });

    test('a script probe with no permission says so instead of quoting an interval', () => {
        // The failure this exists for: "next check in 5 min" about a probe that will never
        // run once, because the grant it needs was never given.
        const r = reasonNotRunning(
            task({ trigger: { type: 'script', code: 'exit 0', everyMinutes: 5 } }),
            fired({ probe: new Set(['t1']) }),
            null,
            { mayRunScripts: false },
        );
        assert.equal(r.key, 'sched.why.probeNoPerm');

        const ok = reasonNotRunning(
            task({ trigger: { type: 'script', code: 'exit 0', everyMinutes: 5 } }),
            fired({ probe: new Set(['t1']) }),
            null,
            { mayRunScripts: true },
        );
        assert.equal(ok.key, 'sched.why.probeIdle');
        assert.equal(ok.v, '5');
    });

    test('an empty script is reported as empty, permission or not', () => {
        assert.equal(
            reasonNotRunning(
                task({ trigger: { type: 'script', code: '   ' } }), fired(), null,
                { mayRunScripts: true },
            ).key,
            'sched.why.probeNone',
        );
    });

    test('a condition trigger distinguishes "never read" from "read and false"', () => {
        const arming = reasonNotRunning(
            task({ trigger: { type: 'condition', condition: { type: 'fileExists', params: {} } } }),
            fired(), null,
        );
        assert.equal(arming.key, 'sched.why.condArming');
        const idle = reasonNotRunning(
            task({ trigger: { type: 'condition', condition: { type: 'fileExists', params: {} } } }),
            fired({ cond: new Set(['t1']) }), null,
        );
        assert.equal(idle.key, 'sched.why.condIdle');
    });

    test('disabled still beats every one of them', () => {
        assert.equal(
            reasonNotRunning(
                task({ enabled: false, trigger: { type: 'afterTask', taskId: '' } }), fired(), null,
            ).key,
            'sched.why.off',
        );
    });
});
