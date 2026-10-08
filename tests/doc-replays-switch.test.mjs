// The two "no session replays in the documentation" switches.
//
//   * Help & Other (in-app): `DocsReplays=false` in app.cfg -> `docs_replays_enabled` ->
//     docs/doc-replays.ts. Every replay embed renders as nothing and nothing fetches one.
//   * BMM Docs (site): `extra: bmm_replays: false` in mkdocs.yml, or BMM_DOCS_REPLAYS=off,
//     read by the hook tools/md_directives.py: blocks dropped, no .bmmreplay copied, no player.
//
// The Rust parser of the app.cfg line has its own tests in commands/settings.rs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

globalThis.localStorage ??= { getItem: () => 'en', setItem() {} };
const { renderDocMarkdown } = await import(pathToFileURL(join(ROOT, 'frontend/js/docs/md-lite.js')).href);
const replays = await import(pathToFileURL(join(ROOT, 'frontend/js/docs/doc-replays.js')).href);
const render = (md) => renderDocMarkdown(md, { trusted: true });

const DIRECTIVE = ':::replay{src="assets/replays/demo.bmmreplay" title="Demo"}\n:::';
const SITE_DIV = '<div class="bmm-replay"\n     data-src="assets/docs/replays/demo.bmmreplay"\n     data-title="Demo"></div>';
const CLIP_DIV = '<div class="bmm-replay" data-src="assets/docs/clips/demo.mp4" data-title="Clip"></div>';

test('Help & Other: replays render by default', () => {
    replays.setDocReplaysEnabled(true);
    assert.match(render(DIRECTIVE), /data-replay="assets\/replays\/demo\.bmmreplay"/);
    // (Text first: a body that STARTS with HTML is taken as HTML and passed through.)
    assert.match(render(`Intro\n\n${SITE_DIV}`), /class="dh-clip" data-kind="replay"/);
});

test('Help & Other: DocsReplays=false renders no replay, not even a note', () => {
    replays.setDocReplaysEnabled(false);
    try {
        const out = render(`Before\n\n${DIRECTIVE}\n\n${SITE_DIV}\n\nAfter`);
        assert.doesNotMatch(out, /bmmreplay|data-replay|dh-replay|data-kind="replay"/);
        assert.match(out, /Before/);
        assert.match(out, /After/);
        // A video clip is not a replay: it stays.
        assert.match(render(`Intro\n\n${CLIP_DIV}`), /data-kind="video"/);
    } finally {
        replays.setDocReplaysEnabled(true);
    }
});

test('Help & Other: the setting is read once from the backend, and a failed read keeps replays on', async () => {
    // A fresh module instance per case: the load is memoised on purpose.
    const fresh = async () => import(pathToFileURL(join(ROOT, 'frontend/js/docs/doc-replays.js')).href + `?t=${Math.random()}`);
    const off = await fresh();
    const calls = [];
    assert.equal(await off.loadDocReplaysSetting(async (cmd) => { calls.push(cmd); return false; }), false);
    await off.loadDocReplaysSetting(async (cmd) => { calls.push(cmd); return true; });
    assert.deepEqual(calls, ['docs_replays_enabled']);
    assert.equal(off.docReplaysEnabled(), false);
    const broken = await fresh();
    assert.equal(await broken.loadDocReplaysSetting(async () => { throw new Error('no bridge'); }), true);
});

test('Help & Other: the hub hides its own replay media and never fetches one when off', () => {
    const hub = read('frontend/src/docs/docs-hub.ts');
    assert.match(hub, /loadDocReplaysSetting\(invoke\)/, 'the hub must read the app.cfg switch');
    assert.match(hub, /m\.kind === 'replay' && m\.src && docReplaysEnabled\(\)/, 'article media');
    assert.match(hub, /async function playReplay\(url: string\) \{\r?\n\s*if \(!url \|\| !docReplaysEnabled\(\)\) return;/, 'player');
    assert.match(hub, /if \(kind !== 'video' && !docReplaysEnabled\(\)\) return;/, 'clip card fetch');
});

test('app.cfg: the key is registered, parsed and documented', () => {
    assert.match(read('src-tauri/src/main.rs'), /commands::settings::docs_replays_enabled,/);
    assert.match(read('src-tauri/src/commands/settings.rs'), /eq_ignore_ascii_case\("docsreplays"\)/);
    const doc = read('APP_CFG.md');
    assert.match(doc, /### `DocsReplays`/);
    assert.match(doc, /DocsReplays=false/);
});

// ── BMM Docs (mkdocs hook) ──────────────────────────────────────────────────────────────

const HOOK_DIR = join(ROOT, 'BMM Docs/tools');
const PY = ['python', 'python3', 'py'].find((p) => spawnSync(p, ['--version'], { encoding: 'utf8' }).status === 0);
const skipPy = !existsSync(join(HOOK_DIR, 'md_directives.py')) ? 'BMM Docs not checked out' : (!PY ? 'no python on PATH' : false);

function runHook(script, env = {}) {
    const r = spawnSync(PY, ['-c', script], {
        cwd: HOOK_DIR, encoding: 'utf8',
        env: { ...process.env, BMM_DOCS_REPLAYS: '', PYTHONIOENCODING: 'utf-8', ...env },
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
}

const PY_CASE = `
import json, md_directives as h
class F:
    def __init__(s, u): s.src_uri = u
class Files(list):
    def remove(s, f): list.remove(s, f)
page = '''Intro

<div class="bmm-replay"
     data-src="../assets/replays/apps.bmmreplay"
     data-title="Install"></div>

:::replay{src="x.bmmreplay"}
caption
:::

\`\`\`html
<div class="bmm-replay" data-src="doc.bmmreplay"></div>
\`\`\`

Outro'''
def run(cfg):
    files = Files([F('features/apps.md'), F('assets/replays/apps.bmmreplay'), F('assets/rrweb/rrweb.min.js'), F('assets/extra.css')])
    c = dict(cfg, extra_css=['assets/extra.css', 'assets/rrweb/bmm-replay.css'], extra_javascript=['assets/rrweb/rrweb.min.js'])
    c = h.on_config(c)
    out = h.on_page_markdown(page, config=c)
    return {'on': h.replays_enabled(c), 'files': [f.src_uri for f in h.on_files(files, c)],
            'css': c['extra_css'], 'js': c['extra_javascript'], 'md': out}
print(json.dumps({'default': run({'extra': {}}), 'yml_off': run({'extra': {'bmm_replays': False}}), 'yml_on': run({'extra': {'bmm_replays': True}})}))
`;

test('BMM Docs: replays are kept by default and with bmm_replays: true', { skip: skipPy }, () => {
    const r = runHook(PY_CASE);
    for (const k of ['default', 'yml_on']) {
        assert.equal(r[k].on, true);
        assert.match(r[k].md, /apps\.bmmreplay/);
        assert.ok(r[k].files.includes('assets/replays/apps.bmmreplay'));
        assert.deepEqual(r[k].js, ['assets/rrweb/rrweb.min.js']);
    }
});

test('BMM Docs: bmm_replays: false drops the blocks, the files and the player', { skip: skipPy }, () => {
    const { yml_off: r } = runHook(PY_CASE);
    assert.equal(r.on, false);
    assert.doesNotMatch(r.md, /apps\.bmmreplay|x\.bmmreplay|:::replay|caption/);
    assert.match(r.md, /Intro/);
    assert.match(r.md, /Outro/);
    // A page documenting the syntax keeps its example.
    assert.match(r.md, /doc\.bmmreplay/);
    assert.deepEqual(r.files, ['features/apps.md', 'assets/extra.css']);
    assert.deepEqual(r.css, ['assets/extra.css']);
    assert.deepEqual(r.js, []);
});

test('BMM Docs: BMM_DOCS_REPLAYS overrides mkdocs.yml both ways', { skip: skipPy }, () => {
    const off = runHook(PY_CASE, { BMM_DOCS_REPLAYS: 'off' });
    assert.equal(off.yml_on.on, false);
    assert.doesNotMatch(off.yml_on.md, /apps\.bmmreplay/);
    const on = runHook(PY_CASE, { BMM_DOCS_REPLAYS: 'on' });
    assert.equal(on.yml_off.on, true);
    assert.match(on.yml_off.md, /apps\.bmmreplay/);
});

test('BMM Docs: mkdocs.yml carries the switch, on', { skip: !existsSync(join(ROOT, 'BMM Docs/mkdocs.yml')) && 'BMM Docs not checked out' }, () => {
    assert.match(read('BMM Docs/mkdocs.yml'), /^\s+bmm_replays: true$/m);
});
