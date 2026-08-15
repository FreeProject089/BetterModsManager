// The frontend→Rust API map, against the COMPILED module.
//
// `invoke` is non-generic and returns Promise<any>, so this boundary is the one edge in the
// codebase with no compiler behind it. Every test here is a way the map could be quietly
// wrong about it — and a map that is quietly wrong about an unchecked boundary is worse
// than no map, because it gets believed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { parseInvokes, parseHandlerList, buildApiMap } =
    await import(pathToFileURL(join(here, '../frontend/js/features/dev/api-map.js')).href);

describe('parseInvokes', () => {
    test('all three quote styles', () => {
        // A checker that only knows single quotes reports a clean result on a file full of
        // double-quoted calls, and reads exactly like success.
        const src = "invoke('a_one');\ninvoke(\"b_two\");\ninvoke(`c_three`);";
        assert.deepEqual(parseInvokes(src).map((u) => u.name), ['a_one', 'b_two', 'c_three']);
    });

    test('a dynamic call is KEPT, with a null name', () => {
        // Dropping it would overstate this tool's own coverage: a dynamic invoke is a real
        // hole in every static check, and the count of them is the honest measure.
        assert.deepEqual(parseInvokes('invoke(cmd, args);'), [{ name: null, line: 1 }]);
    });

    test('the wrapper DECLARATION is not a call', () => {
        // `export async function invoke(command: string, …)` in core/api.ts. Counting it
        // reported the file that defines the bridge as having a dynamic invoke — a finding
        // about the tool, dressed as a finding about the code.
        assert.deepEqual(parseInvokes('export async function invoke(command, args = {}) {}'), []);
    });

    test('invoke() with nothing in it is not a call', () => {
        // It appears in the docs hub as prose: "<code>invoke()</code>".
        assert.deepEqual(parseInvokes("const html = '<code>invoke()</code>';"), []);
    });

    test('_invoke is a call — the raw bridge is still a caller', () => {
        // core/api.ts calls it directly for log_frontend_line, so the wrapper's own logging
        // cannot recurse. Missing it lists that command as having no caller.
        assert.deepEqual(parseInvokes("_invoke('log_frontend_line', {});").map((u) => u.name), ['log_frontend_line']);
    });

    test('a call in a comment is not a call', () => {
        assert.deepEqual(parseInvokes("// invoke('ghost_command');"), []);
    });

    test('the line number is the line in the SOURCE, comments and all', () => {
        const src = '/* a\n block\n comment */\ninvoke("x_one");';
        assert.equal(parseInvokes(src)[0].line, 4);
    });

    test('a method call is a call', () => {
        assert.deepEqual(parseInvokes("api.invoke('x_one');").map((u) => u.name), ['x_one']);
    });
});

describe('parseHandlerList', () => {
    const MAIN = `
        fn main() {
          .invoke_handler(tauri::generate_handler![
            commands::mods::scan_mods,
            commands::mods::delete_mod,
            // a comment in the list
            commands::repo::sync_repo,
            log_frontend_line,
          ])
        }`;

    test('module-qualified and bare names both parse', () => {
        // Handling only the qualified shape reported the bare ones as missing.
        const h = parseHandlerList(MAIN);
        assert.deepEqual(h.map((x) => x.name), ['scan_mods', 'delete_mod', 'sync_repo', 'log_frontend_line']);
        assert.deepEqual(h.map((x) => x.module), ['mods', 'mods', 'repo', 'main']);
    });

    test('a file with no handler list yields nothing rather than a guess', () => {
        assert.deepEqual(parseHandlerList('fn main() {}'), []);
    });
});

describe('buildApiMap', () => {
    const HANDLERS = [
        { name: 'scan_mods', module: 'mods' },
        { name: 'delete_mod', module: 'mods' },
        { name: 'sync_repo', module: 'repo' },
        { name: 'mcp_only_cmd', module: 'repo' },
    ];
    const FILES = [
        { path: 'features/mods/mods.ts', src: "invoke('scan_mods');\ninvoke('delete_mod');" },
        { path: 'features/repo/repo.ts', src: "invoke('sync_repo');\ninvoke('typo_command');" },
        { path: 'core/api.ts', src: 'invoke(name, args);' },
    ];

    test('callers, most-talkative first', () => {
        const m = buildApiMap(FILES, HANDLERS);
        assert.deepEqual(m.byCaller[0], { module: 'features/mods/mods.ts', commands: ['delete_mod', 'scan_mods'] });
    });

    test('a command with no frontend caller is reported, and never called unused', () => {
        // The MCP server, the CLI and bmm:// deeplinks all reach commands the UI never
        // touches. This cannot tell an MCP-only command from a forgotten one, and calling
        // it "unused" would invite deleting something the CLI depends on.
        assert.deepEqual(buildApiMap(FILES, HANDLERS).noFrontendCaller, ['mcp_only_cmd']);
    });

    test('a call to a command Rust does not expose is a rejected promise at runtime', () => {
        const m = buildApiMap(FILES, HANDLERS);
        assert.deepEqual(m.unregistered, [{ command: 'typo_command', module: 'features/repo/repo.ts', line: 2 }]);
    });

    test('a dynamic call counts as dynamic and not as a caller of anything', () => {
        const m = buildApiMap(FILES, HANDLERS);
        assert.deepEqual(m.dynamic, [{ module: 'core/api.ts', line: 1 }]);
        assert.equal(m.byCaller.some((c) => c.module === 'core/api.ts'), false);
    });

    test('per Rust module: how much of it the UI actually uses', () => {
        const m = buildApiMap(FILES, HANDLERS);
        assert.deepEqual(m.byRustModule, [
            { module: 'mods', called: 2, total: 2 },
            { module: 'repo', called: 1, total: 2 },
        ]);
    });

    test('counts describe the surface rather than judging it', () => {
        assert.deepEqual(buildApiMap(FILES, HANDLERS).counts, {
            registered: 4, called: 3, noFrontendCaller: 1, dynamic: 1, unregistered: 1,
        });
    });
});
