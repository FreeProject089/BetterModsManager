// The comment and test-module strippers behind scripts/check-governed.mjs.
//
// The failure that matters is a literal read as something else. A regex took the `//` in the
// Rust string "./a//b" for a line comment and cut the closing quote; the brace matching of the
// `#[cfg(test)] mod` blocks after it came out unbalanced, and every test module below that line
// was counted as app code — five false "new" sites in fs_utils.rs, on a clean HEAD.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { stripComments, stripTestModules } =
    await import(pathToFileURL(join(here, '../scripts/check-governed.mjs')).href);

const count = (rs) => stripTestModules(stripComments(rs)).split('thread::spawn').length - 1;

describe('stripComments', () => {
    test('a // inside a string is not a comment', () => {
        const rs = 'let p = "./a//b"; // gone';
        assert.equal(stripComments(rs), 'let p = "./a//b"; ');
        // net.rs: the old regex spared "://" but not the third slash of "file:///".
        assert.equal(stripComments('let u = "file:///etc/passwd"; // gone'), 'let u = "file:///etc/passwd"; ');
    });

    test('an escaped quote does not end the string', () => {
        const rs = 'let p = "say \\"x//y\\" now"; // gone';
        assert.equal(stripComments(rs), 'let p = "say \\"x//y\\" now"; ');
    });

    test('raw strings, with and without hashes, keep their // and quotes', () => {
        const rs = 'let a = r"c://x"; let b = r#"{"u":"http://h"}"#; let c = br##"a"#//"##; // gone';
        assert.equal(stripComments(rs), 'let a = r"c://x"; let b = r#"{"u":"http://h"}"#; let c = br##"a"#//"##; ');
    });

    test('char literals and lifetimes', () => {
        const rs = "fn f<'a>(x: &'a str) -> char { let q = '\"'; let e = '\\''; '/' } // gone";
        assert.equal(stripComments(rs), "fn f<'a>(x: &'a str) -> char { let q = '\"'; let e = '\\''; '/' } ");
    });

    test('nested block comments and doc comments go', () => {
        const rs = '/// doc par_iter\nfn f() { /* a /* thread::spawn */ b */ g() }';
        assert.equal(stripComments(rs), '\nfn f() {   g() }');
    });

    test('a raw identifier is not a raw string', () => {
        assert.equal(stripComments('let r#type = 1; // gone'), 'let r#type = 1; ');
    });
});

describe('stripTestModules', () => {
    test('the "./a//b" case: a later test module is still stripped', () => {
        const rs = [
            '#[cfg(test)]',
            'mod safe_relative_path_tests {',
            '    #[test] fn ordinary_mod_paths_pass() { check("./a//b"); }',
            '}',
            'fn app() {}',
            '#[cfg(test)]',
            'mod later_tests {',
            '    fn t() { std::thread::spawn(|| {}); }',
            '}',
        ].join('\n');
        assert.equal(count(rs), 0);
    });

    test('braces inside raw strings and char literals do not unbalance a module', () => {
        const rs = [
            '#[cfg(test)]',
            'mod t {',
            '    fn a() { let _ = r#"{"version":"1.2.3"}"#; let _ = \'{\'; let _ = "}}"; }',
            '    fn b() { std::thread::spawn(|| {}); }',
            '}',
            'fn app() { std::thread::spawn(|| {}); }',
        ].join('\n');
        assert.equal(count(rs), 1, 'only the app site is left');
    });

    test('an unbalanced module leaves the rest counted, never hidden', () => {
        const rs = '#[cfg(test)]\nmod t {\n fn x() { std::thread::spawn(|| {});\n';
        assert.equal(count(rs), 1);
    });
});
