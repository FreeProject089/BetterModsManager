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
    watch: new Set(), event: new Set(), appStart: new Set(), once: new Set(), ...over,
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
