// The four regular expressions Semgrep's detect-redos flagged in the in-app markdown renderer and
// the icon resolver, run on adversarial input against a time budget.
//
// Reviewed 2026-09-25 as FALSE positives (the lines carry a `nosemgrep` with the reason): in
// `[a-z0-9]+(?:-[a-z0-9]+)*` every repetition must start with a hyphen, and in the GFM table
// separator every repetition must start with `|`, so no run of input can be split two ways and a
// failing match backtracks linearly. This file is the evidence, and the guard: an edit that makes
// one of them catastrophic blows the budget here instead of freezing the docs viewer on a plugin
// README (untrusted input).
//
// The CONTROL test runs a known catastrophic pattern through the same harness. If the harness
// could not see a ReDoS, the control would pass and this whole file would prove nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { phosphorRef, isoRef } = await import(pathToFileURL(join(ROOT, 'frontend/js/core/icon-cdn.js')).href);
const { renderDocMarkdown } = await import(pathToFileURL(join(ROOT, 'frontend/js/docs/md-lite.js')).href);

const BUDGET_MS = 250;   // a linear pass over 40 000 characters takes well under 1 ms
const N = 40_000;

function timed(fn) {
    const t0 = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t0) / 1e6;
}

test('control: the harness does catch a catastrophic pattern', () => {
    // (a+)+$ on "aaaa…!" is exponential; 24 characters already take well over the budget.
    const evil = /^(a+)+$/;
    const ms = timed(() => evil.test('a'.repeat(24) + '!'));
    assert.ok(ms > BUDGET_MS, `the control ran in ${ms.toFixed(1)} ms: this machine or harness cannot show a ReDoS`);
});

test('icon-cdn: phosphorRef on adversarial names stays linear', () => {
    for (const s of ['ph:' + 'a'.repeat(N) + '!', 'ph:' + 'a-'.repeat(N) + '!', 'ph-bold:' + 'aa-'.repeat(N) + '-', 'phosphor:' + 'a'.repeat(N) + '-']) {
        const ms = timed(() => phosphorRef(s));
        assert.ok(ms < BUDGET_MS, `phosphorRef took ${ms.toFixed(1)} ms on ${s.slice(0, 16)}…`);
    }
    assert.equal(phosphorRef('ph-bold:arrow-right'), 'bold/arrow-right-bold', 'the pattern still matches what it is for');
});

test('icon-cdn: isoRef on adversarial names stays linear', () => {
    for (const s of ['iso:' + 'a'.repeat(N) + '!', 'iso:' + 'a-'.repeat(N) + '!', 'isometric:' + 'ab-'.repeat(N) + '--']) {
        const ms = timed(() => isoRef(s));
        assert.ok(ms < BUDGET_MS, `isoRef took ${ms.toFixed(1)} ms on ${s.slice(0, 16)}…`);
    }
    assert.equal(isoRef('iso:cube-cloud'), 'cube-cloud');
});

test('md-lite: a hostile README (icon names, table separators) renders within budget', () => {
    const docs = [
        ':icon[ph:' + 'a-'.repeat(N) + '!]',
        '| a | b |\n|' + '-'.repeat(N) + 'x\n',
        '| a | b |\n|' + '--|'.repeat(N / 3) + 'x\n',
        '| a | b |\n|' + ' --  |'.repeat(N / 6) + ' x\n',
        '| a | b |\n|' + ':--: |'.repeat(N / 6) + '::\n',
        '| a | b |\n|--' + ' '.repeat(N) + 'x\n',
    ];
    for (const md of docs) {
        const ms = timed(() => renderDocMarkdown(md, { trusted: true }));
        assert.ok(ms < BUDGET_MS * 4, `renderDocMarkdown took ${ms.toFixed(1)} ms on ${JSON.stringify(md.slice(0, 24))}…`);
    }
    assert.match(renderDocMarkdown('| a | b |\n|---|:--:|\n| 1 | 2 |\n', { trusted: true }), /<table/, 'tables still render');
});
