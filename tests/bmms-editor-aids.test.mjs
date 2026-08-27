// The outline and the hover, against the COMPILED module.
//
// The interesting property is that the outline works on a script that does NOT compile. The
// moment you most want to see the shape of something is halfway through changing it, and a
// compiler answers "no" to that — so this is a line scan, and these tests are what stop
// somebody replacing it with a call to the real parser.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The module chain reaches core/i18n.js, which reads the saved language at import time. In
// Node there is no localStorage, so the import throws before a single test runs — the stub is
// what makes this file about the outline rather than about the browser.
const store = new Map();
globalThis.localStorage = globalThis.localStorage || {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

const here = dirname(fileURLToPath(import.meta.url));
const { outlineOf, offsetOfLine, explain } = await import(
    pathToFileURL(join(here, '../frontend/js/features/settings/bmms-editor-aids.js')).href
);

const SCRIPT = `task "Nightly" {
    every day at 03:00
    allow script

    do mods.scan()
    if online {
        do repo.sync()
    } else {
        stop
    }
    ensure modWins(id: "big") {
        do mods.order(id: "big", mode: "last")
    }
}
`;

describe('outlineOf', () => {
    test('finds the statements and nothing else', () => {
        const kinds = outlineOf(SCRIPT).map((r) => r.kind);
        // No 'do' after the else: that branch holds `stop`, which is not a statement head.
        assert.deepEqual(kinds, ['task', 'do', 'if', 'do', 'if', 'ensure', 'do']);
    });

    test('a closing brace is structure, not a row', () => {
        // Without this every block would appear twice in the list.
        assert.equal(outlineOf('do a()\n}\n}\n').length, 1);
    });

    test('depth comes from the indentation, so it matches what you see', () => {
        const rows = outlineOf(SCRIPT);
        assert.equal(rows[0].depth, 0, 'the task line');
        assert.equal(rows[1].depth, 1, 'a step inside it');
        assert.equal(rows[3].depth, 2, 'a step inside the if');
    });

    test('it still works on a script that does not compile', () => {
        // The whole reason this is a scan. A half-typed line and an unclosed brace are what
        // an editor looks like most of the time.
        const rows = outlineOf('task "X" {\n    do mods.sc\n    if onl');
        assert.equal(rows.length, 3);
        assert.deepEqual(rows.map((r) => r.kind), ['task', 'do', 'if']);
    });

    test('comments and blank lines are skipped', () => {
        assert.equal(outlineOf('# a note\n\n// another\n').length, 0);
    });

    test('the line number is where the caret has to go', () => {
        const rows = outlineOf(SCRIPT);
        const ensure = rows.find((r) => r.kind === 'ensure');
        const at = offsetOfLine(SCRIPT, ensure.line);
        assert.ok(SCRIPT.slice(at).startsWith('    ensure '), SCRIPT.slice(at, at + 20));
    });
});

describe('explain', () => {
    test('an action is explained by its own registry entry', () => {
        const said = explain('mods.scan');
        assert.ok(said, 'mods.scan should be explained');
        assert.ok(said.title.length > 0);
    });

    test('a word that is neither a keyword nor an action says nothing', () => {
        // A tooltip that says "this is a word" trains people to ignore tooltips.
        assert.equal(explain('somebodysVariable'), null);
        assert.equal(explain(''), null);
        assert.equal(explain('   '), null);
    });

    test('a keyword is explained, and never as the name of a missing string', () => {
        const said = explain('ensure');
        assert.ok(said);
        assert.ok(!said.body.startsWith('sched.kw.'), `leaked a key: ${said.body}`);
        assert.ok(!said.title.startsWith('sched.'), `leaked a key: ${said.title}`);
    });
});
