// A bmm:// link must never change telemetry consent on its own, and never unmask replay.
//
// Any web page can open a bmm:// link. `bmm://telemetry/consent?enabled=1&full=1` used to turn
// telemetry on AND switch session replay to UNMASKED with no prompt at all. These hold the
// rule (against the COMPILED module) and the wiring (against the handler's source).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseTelemetryLink, planTelemetryLink } = await import(
    pathToFileURL(join(ROOT, 'frontend/js/core/telemetry-link.js')).href
);
const plan = (qs) => planTelemetryLink(parseTelemetryLink(new URLSearchParams(qs)));

describe('planTelemetryLink', () => {
    test('the audited link: consent is only a request, unmasking is dropped', () => {
        const p = plan('enabled=1&full=1');
        assert.equal(p.widens, true, 'turning consent on must go through the consent dialog');
        assert.equal(p.refusedUnmasked, true);
        assert.notEqual(p.apply.replayFull, true);
        assert.equal('replayFull' in p.apply, false);
    });

    test('full=1 is never applied, whatever alias or combination carries it', () => {
        for (const qs of ['full=1', 'full=true', 'replayFull=1', 'replay=1&full=1', 'consent=1&replayFull=true&bench=1']) {
            const p = plan(qs);
            assert.notEqual(p.apply.replayFull, true, qs);
            assert.equal(p.refusedUnmasked, true, qs);
        }
    });

    test('full=0 (masking back on) is kept and needs no consent dialog', () => {
        const p = plan('full=0');
        assert.equal(p.apply.replayFull, false);
        assert.equal(p.widens, false);
        assert.equal(p.empty, false);
    });

    test('anything that turns collection on widens', () => {
        for (const qs of ['enabled=1', 'consent=true', 'replay=1', 'bench=1']) assert.equal(plan(qs).widens, true, qs);
        for (const qs of ['enabled=0', 'replay=0', 'bench=0']) assert.equal(plan(qs).widens, false, qs);
    });

    test('a link carrying only full=1 leaves nothing to do', () => {
        assert.equal(plan('full=1').empty, true);
        assert.equal(plan('').empty, true);
    });
});

describe('the bmm://telemetry route', () => {
    const src = readFileSync(join(ROOT, 'frontend/src/core/deep_link_manager.ts'), 'utf8');
    const start = src.indexOf("action === 'telemetry/consent'");
    const end = src.indexOf("action === 'recorder/set'", start);
    const branch = src.slice(start, end);

    test('the branch exists where it is looked for', () => {
        assert.ok(start > 0 && end > start, 'telemetry branch not found — update this test');
    });

    test('never applies settings directly — it goes through the planner and the in-app confirmation', () => {
        assert.doesNotMatch(branch, /applyTelemetrySettings/, 'the link applies telemetry settings with no prompt');
        assert.match(branch, /planTelemetryLink/);
        assert.match(branch, /confirmTelemetryFromLink/);
    });
});
