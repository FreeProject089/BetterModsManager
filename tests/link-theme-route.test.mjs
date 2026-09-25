// A theme named by a link is downloaded by Rust, never by the webview.
//
// Security summary §9, "Theme install by link has no Rust second check": both theme link routes
// (`bmm://catalog/theme/install`, `bmm://theme/import`) fetched the URL from the webview and
// handed the text to `install_theme`, so none of the rules the plugin link path enforces in
// Rust (https after redirects, the host the dialog showed, a size cap, a safe theme id) applied.
// They now go through `link_install_theme` (src-tauri/src/commands/link_guard.rs), whose rules
// are tested in Rust (`link_guard::link_theme_tests`). This test pins the routing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'frontend', 'src', 'core', 'deep_link_manager.ts'), 'utf8');

/** The source of one `if (...) { ... }` / `else if (...) { ... }` block, from its condition. */
function block(from) {
    const start = src.indexOf(from);
    assert.ok(start >= 0, `no block starting with ${from}`);
    // The brace that ends the line (a return type such as `Promise<{ id: string }>` has one too).
    const m = /\{\r?\n/.exec(src.slice(start));
    assert.ok(m, `no body for ${from}`);
    let i = start + m.index;
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(start, i + 1);
}

test('both theme link routes install through link_install_theme', () => {
    for (const head of ["} else if (kind === 'theme') {", "if (action === 'theme/import') {"]) {
        const body = block(head);
        assert.match(body, /installThemeByLink\(/, `${head}: not routed through installThemeByLink`);
        assert.ok(!/\bfetch\(/.test(body), `${head}: the webview fetches the theme itself`);
        assert.ok(!/invoke\('install_theme'/.test(body), `${head}: calls install_theme with webview-fetched text`);
    }
});

test('the helper is the Rust command, not a fetch', () => {
    const helper = block('async function installThemeByLink(');
    assert.match(helper, /invoke\('link_install_theme'/);
    assert.ok(!/\bfetch\(/.test(helper));
});
