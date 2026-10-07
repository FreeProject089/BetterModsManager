// The mapper's draft changes (frontend/src/features/mapper/mapper.ts): moves, deletions and new
// folders are queued, then written by Save (applyAllChanges).
//
// Save used to start with `if (pendingMoves.size === 0 && pendingDeletions.size === 0) return;`
// while the Save BUTTON was shown for any of the three kinds: queue only new folders, the button
// appears, the click does nothing, and the folders are never created. Every "is there anything
// pending?" question now goes through one function, and this test holds it there. mapper.ts
// drives the DOM at import, so the source is read rather than imported (as the Rust
// apply_incremental_update test does with its own command).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'frontend/src/features/mapper/mapper.ts'), 'utf8');

function body(name) {
    const start = src.indexOf(name);
    assert.ok(start >= 0, `${name} not found`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
    }
    throw new Error(`${name}: unbalanced`);
}

test('the pending count covers moves, deletions and new folders', () => {
    const b = body('export function pendingChangeCount(');
    for (const kind of ['pendingMoves', 'pendingDeletions', 'pendingNewFolders']) {
        assert.ok(b.includes(`${kind}.size`), kind);
    }
});

test('Save returns early only when nothing at all is pending', () => {
    const b = body('async function applyAllChanges(');
    const firstLine = b.split('\n').find((l) => l.includes('return')) || '';
    assert.match(firstLine, /pendingChangeCount\(\)\s*===\s*0/, firstLine);
    // And it does create the queued folders.
    assert.match(b, /pendingNewFolders\.entries\(\)/);
    assert.match(b, /invoke\('create_mod_folder'/);
});

test('the Save button and Save ask the same question', () => {
    // The button counted all three while Save counted two: that difference WAS the bug.
    assert.match(body('function updateSaveButtonVisibility('), /pendingChangeCount\(\)\s*>\s*0/);
    assert.doesNotMatch(body('async function applyAllChanges('), /pending(Moves|Deletions|NewFolders)\.size/);
});

test('Refresh discards every kind it warned about', () => {
    const at = src.indexOf("refreshBtn?.addEventListener('click'");
    const chunk = src.slice(at, src.indexOf('refreshMapperData', at));
    assert.match(chunk, /pendingChangeCount\(\)\s*>\s*0/);
    for (const kind of ['pendingMoves', 'pendingDeletions', 'pendingNewFolders']) {
        assert.ok(chunk.includes(`${kind}.clear()`), kind);
    }
});
