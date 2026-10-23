// Custom pages stay editable, including the ones made from a starter.
//
// « Customise navigation » makes a page from one of eight starters by COPYING the starter's
// HTML, CSS and JS into a new bundle (create_custom_page). The page is then the user's own and
// must be editable like any other: edited, renamed, duplicated, reverted to its starter,
// deleted. This pins the model behind those actions (frontend/src/ui/custom-page-model.ts)
// and the wiring that makes them reachable from both the button's settings and « My pages ».
//
// Two rules that must not move: duplicating or reverting grants nothing (no page_set_grant,
// no copied permissions), and deleting a page takes its buttons with it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/custom-page-model.js')).href);

const memStore = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
};
const STARTERS = [
    { labelKey: 'navedit.tplBlank', html: '<h1>My page</h1>', css: 'body{}', js: '' },
    { labelKey: 'navedit.tplNotes', html: '<h1>Notes</h1>\n<textarea id="note"></textarea>', css: 'body{}', js: 'bmm.storage.get("n")' },
];
const fakeInvoke = (answers = {}) => {
    const calls = [];
    const invoke = async (cmd, args) => {
        calls.push([cmd, args]);
        if (cmd in answers) return typeof answers[cmd] === 'function' ? answers[cmd](args) : answers[cmd];
        return undefined;
    };
    return { invoke, calls };
};
const cfg = () => ({
    order: ['library', 'custom:a', 'custom:b', 'custom:c'],
    hidden: { 'custom:b': true },
    labels: { 'custom:a': 'stale' },
    custom: [
        { id: 'custom:a', label: 'Notes', kind: 'page', target: 'p1', icon: 'ui:file-text' },
        { id: 'custom:b', label: 'My notes', kind: 'page', target: 'p1' },
        { id: 'custom:c', label: 'Site', kind: 'url', target: 'https://example.com' },
    ],
});

describe('a starter page is an ordinary page that remembers its starter', () => {
    test('an unedited starter is recognised and recorded (pages made before the record)', () => {
        const store = memStore();
        const r = M.resolveOrigin('p1', { name: 'N', html: '  <h1>Notes</h1>\r\n<textarea id="note"></textarea> ', css: 'body{}', js: 'bmm.storage.get("n")' }, STARTERS, store);
        assert.deepEqual(r, { labelKey: 'navedit.tplNotes', migrated: true, modified: false });
        assert.equal(M.readOrigins(store).p1, 'navedit.tplNotes');
        // The second time it comes from the record.
        assert.equal(M.resolveOrigin('p1', { name: 'N', html: 'changed', css: '', js: '' }, STARTERS, store).migrated, false);
    });
    test('an edited page keeps its recorded starter and says it was edited', () => {
        const store = memStore({ [M.ORIGIN_KEY]: JSON.stringify({ p1: 'navedit.tplBlank' }) });
        assert.deepEqual(M.resolveOrigin('p1', { name: 'N', html: '<h1>Mine</h1>', css: '', js: '' }, STARTERS, store),
            { labelKey: 'navedit.tplBlank', migrated: false, modified: true });
    });
    test('an edited page with no record is the user\'s own: nothing is guessed', () => {
        const store = memStore();
        assert.equal(M.resolveOrigin('p9', { name: 'N', html: '<p>x</p>', css: '', js: '' }, STARTERS, store).labelKey, null);
        assert.deepEqual(M.readOrigins(store), {});
    });
    test('a broken or blocked store costs the preselection, nothing else', () => {
        assert.deepEqual(M.readOrigins(memStore({ [M.ORIGIN_KEY]: '{not json' })), {});
        assert.deepEqual(M.readOrigins(memStore({ [M.ORIGIN_KEY]: '["a"]' })), {});
        assert.deepEqual(M.readOrigins(null), {});
        assert.doesNotThrow(() => M.writeOrigin({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, 'p', 'k'));
    });
});

describe('editing a page', () => {
    test('a rename takes along the buttons still called by the old name, not the others', () => {
        const c = cfg();
        assert.equal(M.renameFollowers(c, 'p1', 'Notes', 'Journal'), 1);
        assert.equal(c.custom[0].label, 'Journal');
        assert.equal(c.custom[1].label, 'My notes');
        assert.equal(c.labels['custom:a'], undefined);
        assert.equal(M.renameFollowers(c, 'p1', 'Journal', '  '), 0);
    });
    test('copy names never collide', () => {
        assert.equal(M.copyName('Notes', ['Notes'], 'copy'), 'Notes (copy)');
        assert.equal(M.copyName('Notes', ['Notes', 'Notes (copy)', 'Notes (copy 2)'], 'copy'), 'Notes (copy 3)');
    });
    test('duplicating copies the bundle, grants nothing and keeps the starter', async () => {
        const store = memStore({ [M.ORIGIN_KEY]: JSON.stringify({ p1: 'navedit.tplNotes' }) });
        const { invoke, calls } = fakeInvoke({ duplicate_custom_page: { page: { id: 'p2', name: 'Notes (copy)' }, skipped: ['big.mp4'] } });
        const r = await M.duplicatePage({ invoke, store }, 'p1', 'Notes (copy)');
        assert.deepEqual(r, { id: 'p2', name: 'Notes (copy)', skipped: ['big.mp4'] });
        assert.deepEqual(calls.map((c) => c[0]), ['duplicate_custom_page']);
        assert.equal(M.readOrigins(store).p2, 'navedit.tplNotes');
    });
    test('reverting rewrites the code from the starter and grants nothing', async () => {
        const store = memStore();
        const { invoke, calls } = fakeInvoke();
        await M.revertToStarter({ invoke, store }, 'p1', 'Kept name', STARTERS[1]);
        assert.deepEqual(calls, [['update_custom_page', { id: 'p1', name: 'Kept name', html: STARTERS[1].html, css: STARTERS[1].css, js: STARTERS[1].js }]]);
        assert.equal(M.readOrigins(store).p1, 'navedit.tplNotes');
    });
    test('deleting a page removes its buttons, their order, names and visibility, and its record', async () => {
        const store = memStore({ [M.ORIGIN_KEY]: JSON.stringify({ p1: 'navedit.tplNotes', p2: 'x' }) });
        const { invoke, calls } = fakeInvoke();
        const c = cfg();
        const gone = await M.deletePage({ invoke, store }, c, 'p1');
        assert.deepEqual(gone, ['custom:a', 'custom:b']);
        assert.deepEqual(calls, [['delete_custom_page', { id: 'p1' }]]);
        assert.deepEqual(c.custom.map((x) => x.id), ['custom:c']);
        assert.deepEqual(c.order, ['library', 'custom:c']);
        assert.deepEqual(c.hidden, {});
        assert.deepEqual(c.labels, {});
        assert.deepEqual(M.readOrigins(store), { p2: 'x' });
    });
    test('a failed delete leaves the buttons alone', async () => {
        const invoke = async () => { throw new Error('locked'); };
        const c = cfg();
        await assert.rejects(M.deletePage({ invoke, store: memStore() }, c, 'p1'));
        assert.equal(c.custom.length, 3);
    });
});

describe('the editor is reachable and wired', () => {
    const src = readFileSync(join(ROOT, 'frontend/src/ui/navbar-customize.ts'), 'utf8');
    // Code only: the comments explain which calls are NOT made, by name.
    const model = readFileSync(join(ROOT, 'frontend/src/ui/custom-page-model.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    test('« Edit page » is on the button settings, its sidebar row and every row of « My pages »', () => {
        assert.match(src, /id="nbx-edit-code"/);
        assert.match(src, /data-editrow=/);
        assert.match(src, /data-editpage=/);
        // « My pages » lists every page, not only those without a button.
        assert.match(src, /const pages = _pagesCache\.filter\(\(p\) => p\.id !== draftPageId\)/);
    });
    test('the editor offers save, live preview, duplicate, revert, delete, icon and permissions', () => {
        for (const id of ['nbe-page-create', 'nbx-code-live', 'nbx-code-preview', 'nbx-code-dup', 'nbx-code-revert', 'nbx-code-del', 'nbx-code-icon', 'nbx-code-perms', 'nbe-page-name']) {
            assert.ok(src.includes(`id="${id}"`), `#${id} missing from the page editor`);
        }
        assert.match(src, /mountPermissions\(pane\.querySelector\('#nbx-code-perms'\)/);
    });
    test('a page made from a starter records the starter, and nothing grants silently', () => {
        assert.match(src, /writeOrigin\(originStore\(\), draftPageId!, tpl\.labelKey\)/);
        assert.doesNotMatch(model, /page_set_grant|page_set_net_origins|page_apply_reviewed_grants/);
    });
    test('deleting a page asks first, with BMM\'s own dialog', () => {
        const body = src.slice(src.indexOf('const confirmDeletePage'), src.indexOf('orphansEl.addEventListener'));
        assert.match(body, /await showConfirm\(/);
        assert.ok(body.indexOf('showConfirm') < body.indexOf('deletePage('));
    });
});

describe('the backend copy does not carry permissions', () => {
    const rs = readFileSync(join(ROOT, 'src-tauri/src/commands/custom_pages.rs'), 'utf8');
    const fn = rs.slice(rs.indexOf('pub fn duplicate_custom_page'), rs.indexOf('/// The tiny page-side SDK'));
    test('duplicate_custom_page copies the bundle only, never custom_pages_data', () => {
        assert.ok(fn.length > 100, 'duplicate_custom_page not found');
        assert.match(fn, /create_custom_page\(/);
        assert.match(fn, /import_page_dir\(/);
        assert.doesNotMatch(fn, /pages_data_root|grants|set_grant/);
    });
    test('it is registered as a command', () => {
        assert.match(readFileSync(join(ROOT, 'src-tauri/src/main.rs'), 'utf8'), /commands::custom_pages::duplicate_custom_page,/);
    });
});
