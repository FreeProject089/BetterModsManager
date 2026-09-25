// md-lite must stay a TEXT file.
//
// Its placeholders (inline code, math) were written as raw NUL and 0x01 bytes inside the
// source. That works at run time, but grep, ripgrep and every text gate that shells out to
// them see "Binary file matches" and skip the file entirely: the renderer that writes HTML
// into innerHTML was the one module the text checks could not read. The bytes are now the
// escape sequences \u0000 and \u0001, which mean the same thing to the JS engine.
//
// Both the source and the compiled module are read: tsc keeps an escape as written, so a
// raw byte in the output means somebody put one back in the source.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Every C0 control byte except tab, LF and CR.
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

describe('md-lite is a text file', () => {
    for (const rel of ['frontend/src/docs/md-lite.ts', 'frontend/js/docs/md-lite.js']) {
        test(`${rel} holds no raw control byte`, () => {
            const lines = readFileSync(join(ROOT, rel), 'latin1').split('\n');
            const bad = lines.map((l, i) => (CONTROL.test(l) ? i + 1 : 0)).filter(Boolean);
            assert.deepEqual(bad, [], `raw control byte(s) on line(s) ${bad.join(', ')} of ${rel} — write \\u0000 / \\u0001 instead`);
        });
    }

    test('the placeholders still work: code and math survive the inline pass', async () => {
        const { renderDocMarkdown } = await import(pathToFileURL(join(ROOT, 'frontend/js/docs/md-lite.js')).href);
        const html = renderDocMarkdown('Use `a*b*c` and `x<y`, then **bold**.', { trusted: true });
        assert.match(html, /<code>a\*b\*c<\/code>/);
        assert.match(html, /<code>x&lt;y<\/code>/);
        assert.match(html, /<b>bold<\/b>/);
        // A placeholder that leaked would show up as a control character or a bare index.
        assert.ok(!CONTROL.test(html), 'a placeholder byte leaked into the output');
    });
});

// md-lite was not alone. md-safe.ts, dep-graph.ts, mod-graph-view.ts and md-math.ts carried
// raw NUL / 0x1f bytes too (a regex range, a join separator, placeholders), and `grep` called
// each of them binary. So the rule is now the whole tree rather than a list of files somebody
// has to remember to extend: every .ts under frontend/src, and the .js tsc compiled from it.
describe('every TypeScript source is a text file', () => {
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
    const SRC = join(ROOT, 'frontend', 'src');
    const sources = walk(SRC).filter((f) => f.endsWith('.ts'));
    // DEL (0x7f) as well: md-safe's URL scrub range ended on a raw one.
    const CONTROL_OR_DEL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

    test('the walk found the tree', () => {
        assert.ok(sources.length > 100, `only ${sources.length} .ts file(s) under frontend/src: this test reads nothing`);
    });

    test('no .ts under frontend/src, nor its compiled .js, holds a raw control byte', () => {
        const bad = [];
        for (const ts of sources) {
            const js = join(ROOT, 'frontend', 'js', relative(SRC, ts)).replace(/\.ts$/, '.js');
            for (const f of [ts, js]) {
                if (f === js && !existsSync(js)) continue; // a .d.ts, or not compiled yet
                const lines = readFileSync(f, 'latin1').split('\n');
                lines.forEach((l, i) => { if (CONTROL_OR_DEL.test(l)) bad.push(`${relative(ROOT, f)}:${i + 1}`); });
            }
        }
        assert.deepEqual(bad, [], `raw control byte(s) at ${bad.join(', ')}: write the escape (\\u0000, \\u001f, \\u007f, …) instead`);
    });

    test('md-math placeholders still work: code is kept, maths is marked', async () => {
        const { markMath } = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/md-math.js')).href);
        const out = markMath('Inline `$$c$$` and\n```\n$$x$$\n```\nthen $$E = mc^2$$.');
        assert.ok(out.includes('`$$c$$`'), 'inline code was typeset');
        assert.ok(out.includes('```\n$$x$$\n```'), 'a fenced block was typeset');
        assert.match(out, /<span class="doc-math" data-tex="E = mc\^2">/);
        assert.ok(!CONTROL.test(out), 'a placeholder byte leaked into the output');
    });

    test('md-safe still strips control characters from a URL before judging its scheme', async () => {
        const { safeDocUrl } = await import(pathToFileURL(join(ROOT, 'frontend/js/docs/md-safe.js')).href);
        const nul = String.fromCharCode(0), us = String.fromCharCode(0x1f), del = String.fromCharCode(0x7f);
        // Every byte of the scrubbed range, at both ends, hidden inside the scheme.
        for (const c of [nul, us, del]) {
            assert.equal(safeDocUrl(`java${c}script:alert(1)`), false, `javascript: with 0x${c.charCodeAt(0).toString(16)} inside was accepted`);
            assert.equal(safeDocUrl(`https://example.com/a${c}b`), true, `0x${c.charCodeAt(0).toString(16)} was not scrubbed`);
        }
    });
});
