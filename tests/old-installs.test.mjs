// Old BMM installations: the dialog's pure part (frontend/src/features/settings/old-installs-model.ts).
// Nothing starts ticked, a non-removable row cannot be ticked, the run order is fixed, and a
// Rust error key with a detail reads as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/old-installs-model.js')).href);
const none = (k) => k;

const item = (o) => ({
    id: 'x', kind: 'install', label: 'Better Mod Manager', version: '0.9.5', installer: 'nsis', path: 'C:\\x',
    sizeBytes: 1024, removable: true, reason: null, warning: null, scope: 'user', target: null,
    canSilent: true, currentLine: false, source: null, ...o,
});

test('nothing is ticked when the dialog opens', () => {
    assert.equal(m.initialSelection([item({}), item({ id: 'y' })]).size, 0);
});

test('a row that is not removable cannot be ticked', () => {
    const locked = item({ id: 'data:roaming', kind: 'data', removable: false, reason: 'oldInstalls.reasonMigrationPending' });
    assert.equal(m.toggle(new Set(), locked, true).size, 0);
    const s = m.toggle(new Set(), item({}), true);
    assert.deepEqual([...s], ['x']);
    assert.equal(m.toggle(s, item({}), false).size, 0);
});

test('the plan runs uninstallers, then quick deletes, then data folders', () => {
    const items = [
        item({ id: 'd', kind: 'data' }),
        item({ id: 's', kind: 'shortcut' }),
        item({ id: 'c', kind: 'cache' }),
        item({ id: 'i', kind: 'install' }),
        item({ id: 'n', kind: 'install' }),
    ];
    const plan = m.planRemoval(items, new Set(['d', 's', 'c', 'i']));
    assert.deepEqual(plan.installs.map((i) => i.id), ['i']);
    assert.deepEqual(plan.quick.map((i) => i.id), ['s', 'c']);
    assert.deepEqual(plan.data.map((i) => i.id), ['d']);
    assert.equal(m.planSize(plan), 4);
});

test('a re-scan drops selections that vanished or became non-removable', () => {
    const sel = new Set(['a', 'b', 'gone']);
    const kept = m.pruneSelection(sel, [item({ id: 'a' }), item({ id: 'b', removable: false })]);
    assert.deepEqual([...kept], ['a']);
});

test('errors from Rust read as text, with their detail', () => {
    const t = (k) => (k === 'oldInstalls.errBackup' ? 'The backup failed' : k);
    assert.equal(m.errorText(t, 'oldInstalls.errBackup|disk full'), 'The backup failed (disk full)');
    assert.equal(m.errorText(none, 'plain failure'), 'plain failure');
});

test('sizes and the card line', () => {
    assert.equal(m.fmtSize(512), '512 B');
    assert.equal(m.fmtSize(1536), '1.5 KB');
    assert.equal(m.fmtSize(null), '');
    assert.equal(m.totalBytes([item({ sizeBytes: null })]), null);
    assert.equal(m.totalBytes([item({}), item({ sizeBytes: 1024 })]), 2048);
    assert.equal(m.cardStatus(none, null), 'Not scanned yet.');
    assert.equal(m.cardStatus(none, { items: [], migrated: true, runningExe: '', documentsDir: null }), 'Nothing left over from an older BMM.');
});
