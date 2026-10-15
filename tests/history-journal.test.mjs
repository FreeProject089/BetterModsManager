// The History window's journal (core/history-journal.ts) and its version list
// (ui/update-history.ts): what is recorded, what never is, and how versions are grouped.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = (p) => import(pathToFileURL(join(ROOT, 'frontend/js', p)).href);

// A localStorage for the module (Node has none).
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const J = await js('core/history-journal.js');

describe('settings changes', () => {
    beforeEach(() => { store.clear(); J._resetJournalForTests(); });

    test('a change is recorded with the values before and after', () => {
        J.onCommand('get_settings', {}, { language: 'fr', discord_rpc_enabled: true });
        J.onCommand('update_settings', { settings: { language: 'en', discord_rpc_enabled: true } }, null);
        const [e] = J.journalEntries();
        assert.equal(e.type, 'settings');
        assert.deepEqual(e.changes, [{ field: 'language', old: 'fr', new: 'en' }]);
    });

    test('secrets and noise are never written down', () => {
        const before = { github_token: 'a', api_token: 'b', window_width: 800, last_seen_crash: null, theme: 'dark' };
        const after = { github_token: 'c', api_token: 'd', window_width: 900, last_seen_crash: 'x', theme: 'dark' };
        assert.deepEqual(J.diffSettings(before, after), []);
        assert.ok(!JSON.stringify(store.get(J.JOURNAL_KEY) || '').includes('github_token'));
    });

    test('a burst on the same settings is one entry; a change undone in it leaves none', () => {
        J.onCommand('get_settings', {}, { a: 1 });
        J.onCommand('update_settings', { settings: { a: 2 } }, null, 1000);
        J.onCommand('update_settings', { settings: { a: 3 } }, null, 2000);
        assert.equal(J.journalEntries().length, 1);
        assert.deepEqual(J.journalEntries()[0].changes, [{ field: 'a', old: 1, new: 3 }]);
        J.onCommand('update_settings', { settings: { a: 1 } }, null, 3000);
        assert.equal(J.journalEntries().length, 0);
    });

    test('nothing is recorded without a snapshot to compare with', () => {
        J.onCommand('update_settings', { settings: { a: 2 } }, null);
        assert.equal(J.journalEntries().length, 0);
    });
});

describe('profiles and repos', () => {
    beforeEach(() => { store.clear(); J._resetJournalForTests(); });

    test('a profile switch names both profiles', () => {
        J.onCommand('get_profiles', {}, [{ id: 'p1', name: 'Main' }, { id: 'p2', name: 'Test' }]);
        J.onCommand('get_active_profile_id', {}, 'p1');
        J.onCommand('set_active_profile', { profileId: 'p2' }, null);
        const [e] = J.journalEntries();
        assert.equal(e.action, 'profile.switch');
        assert.equal(e.subject, 'Test');
        assert.deepEqual(e.changes, [{ field: 'profile', old: 'Main', new: 'Test' }]);
    });

    test('switching to the profile already active records nothing', () => {
        J.onCommand('get_active_profile_id', {}, 'p1');
        J.onCommand('set_active_profile', { profileId: 'p1' }, null);
        assert.equal(J.journalEntries().length, 0);
    });

    test('following a repo, and a secret in its patch never kept', () => {
        J.onCommand('repo_follow_set', { url: 'http://nas:8000', name: null, patch: { enabled: true } }, { name: 'NAS' });
        J.onCommand('repo_follow_set', { url: 'http://nas:8000', patch: { password: 'x', interval: 6 } }, { name: 'NAS' });
        const [a, b] = J.journalEntries();
        assert.equal(a.action, 'repo.follow');
        assert.equal(b.action, 'repo.followEdit');
        assert.deepEqual(b.changes.map((c) => c.field), ['interval']);
    });

    test('the journal is capped and prunes by age', () => {
        for (let i = 0; i < J.JOURNAL_MAX + 20; i++) J.recordHistory({ type: 'other', action: 'x', subject: String(i), at: i });
        assert.equal(J.journalEntries().length, J.JOURNAL_MAX);
        J.pruneJournal(1, 86_400_000 + 300);
        assert.ok(J.journalEntries().every((e) => e.at >= 300));
    });
});

const U = await js('ui/update-history-model.js');

describe('version list', () => {
    test('versions grouped, newest first, the changelog preferred', () => {
        const v = U.groupVersions([
            { filename: 'RELEASE_NOTES_0.9.10_EN.md', content: '', path: 'Old/RELEASE_NOTES_0.9.10_EN.md' },
            { filename: 'changelog_v1.0.2_EN.md', content: '## [NEW] A\n## [FIXED] B\n## [IMPROVED] C\n## [NEW] D', path: 'changelog_v1.0.2_EN.md' },
            { filename: 'github_release_v1.0.2_EN.md', content: '', path: 'Old/github_release_v1.0.2_EN.md' },
            { filename: 'Guide_EN.md', content: '', path: 'Guides/Guide_EN.md' },
        ]);
        assert.deepEqual(v.map((x) => x.version), ['1.0.2', '0.9.10']);
        assert.equal(v[0].kind, 'changelog');
        assert.equal(v[0].others.length, 1);
        assert.deepEqual(v[0].counts, { added: 2, improved: 1, fixed: 1 });
    });
});
