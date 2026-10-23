// The repo servers BMM generates must not serve, read or write outside their own folder.
//
// Two holes, both CWE-22, both in the TEMPLATES (so what ships):
//
//  1. Every standalone server checked its resolved path with `abs.startsWith(__dirname)`. That
//     also accepts a SIBLING whose name merely starts with the same letters: a server in
//     /srv/repo served /srv/repo-private/secret.txt for `GET /..%2Frepo-private%2Fsecret.txt`
//     (decodeURIComponent turns %2F back into a slash; no client normalises an encoded one).
//  2. The multi-repo hub joined its `:folder` route parameter straight onto ROOT. Express
//     DECODES route parameters, so `/%2e%2e/admin/data` handed it '..' and
//     `/..%2F..%2Fx/admin/update` '../../x': read another directory's repo.json, and write
//     bans.json / whitelist.json / repo.json wherever a repo.json exists (admin password
//     required, which is why it was MEDIUM and not HIGH — but still outside the hub).
//
// The hybrid server is started for real (it needs nothing but node) and asked for the
// sibling's file. The hub needs Express, which BMM does not install, so its confinement
// function is lifted out of the template and exercised directly, and the template is checked
// to route every :folder through it before any handler runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const T = path.join(here, '..', 'src-tauri', 'src', 'templates', 'mini-server');
const read = (f) => readFileSync(path.join(T, f), 'utf8');
const SERVERS = ['server.express.js.template', 'server.hybrid.bat.template', 'server.hybrid.sh.template',
    'server.v2.bat.template', 'server.v2.sh.template', 'hub-server.js.template'];

/** A top-level `function name(...) { ... }` of a template, evaluated on its own. */
function lift(src, name, deps = {}) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `no function ${name}`);
    const end = src.indexOf('\n}\n', start);
    assert.ok(end > start, `function ${name} is not closed`);
    const names = Object.keys(deps);
    return new Function(...names, `${src.slice(start, end + 2)}; return ${name};`)(...names.map((k) => deps[k]));
}

for (const name of SERVERS) {
    test(`${name}: no bare prefix check is left, and insideDir rejects a sibling`, () => {
        const src = read(name).replace(/\r\n/g, '\n');
        assert.doesNotMatch(src, /\.startsWith\((__dirname|ROOT)\)/, `${name}: a startsWith(dir) confinement is still there`);
        const insideDir = lift(src, 'insideDir', { path });
        const root = path.resolve('/srv/repo');
        assert.equal(insideDir(root, root), true);
        assert.equal(insideDir(root, path.join(root, 'mods', 'a.pak')), true);
        assert.equal(insideDir(root, path.resolve('/srv/repo-private/secret.txt')), false, 'a sibling with the same prefix got in');
        assert.equal(insideDir(root, path.resolve('/srv')), false);
        assert.equal(insideDir(root, path.resolve(root, '..', 'repo', '..', 'repo2', 'x')), false);
    });
}

test('hub-server: repoDir accepts the hub root and its direct folders, nothing else', () => {
    const src = read('hub-server.js.template').replace(/\r\n/g, '\n');
    const insideDir = lift(src, 'insideDir', { path });
    const ROOT = path.resolve(mkdtempSync(path.join(tmpdir(), 'bmm-hub-')));
    try {
        const repoDir = lift(src, 'repoDir', { path, ROOT, insideDir });
        assert.equal(repoDir('.'), ROOT, 'the root repo');
        assert.equal(repoDir('alpha'), path.join(ROOT, 'alpha'));
        // What Express hands the handler for /%2e%2e/…, /..%2F..%2Fx/…, /a%2Fb/…, /a%5Cb/…
        for (const bad of ['..', '../x', '../../etc', 'a/b', 'a\\b', '..\\x', '', 'a\0b', 'C:', 'C:\\Windows', '/etc']) {
            assert.equal(repoDir(bad), null, `${JSON.stringify(bad)} was accepted as a repo folder`);
        }
        assert.equal(repoDir(undefined), null);
    } finally { rmSync(ROOT, { recursive: true, force: true }); }
});

test('hub-server: every :folder route goes through the guard, and no handler joins a raw folder onto ROOT', () => {
    const src = read('hub-server.js.template').replace(/\r\n/g, '\n');
    const guard = src.indexOf("app.param('folder'");
    assert.ok(guard > 0, 'no app.param(\'folder\') guard');
    assert.match(src.slice(guard, guard + 200), /repoDir\(folder\)[\s\S]*status\(404\)/);
    const firstRoute = src.search(/app\.(get|post|put|delete|use)\(\s*'\/:folder/);
    assert.ok(firstRoute > guard, 'a :folder route is registered before the guard');
    assert.doesNotMatch(src, /path\.join\(ROOT,\s*(folder|f)\b/, 'a handler still joins the raw route parameter onto ROOT');
});

async function freePort() {
    return new Promise((resolve) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
}
/** A raw GET: the path is sent exactly as written, no client-side normalisation. */
function rawGet(port, p) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { 'X-Creator-ID': 'BC-TEST' } }, (res) => {
            let body = ''; res.setEncoding('utf8');
            res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject); req.end();
    });
}
async function waitUp(port) {
    for (let i = 0; i < 60; i++) {
        try { return await rawGet(port, '/repo.json'); } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('the hybrid server never answered');
}

test('the v2 server, started for real, does not serve its own files: script, passwords, compose, .env', async () => {
    // Found while moving ADMIN_PASSWORD into a generated .env (2026-09-25): the v2 and Express
    // servers served ANY file of their folder, so server.js (admin password baked in),
    // access.json (download password) and docker-compose.yml went to whoever asked, and a new
    // .env would have followed. The hybrid server already had the root rule; now all do.
    const dir = mkdtempSync(path.join(tmpdir(), 'bmm-v2-'));
    const PW = 'ADMIN-PW-SENTINEL', DL = 'DL-PW-SENTINEL';
    const port = await freePort();
    const src = read('server.v2.sh.template')
        .replace('PORT_PLACEHOLDER', String(port)).replace('USE_CLOUDFLARE_PLACEHOLDER', 'false')
        .replace('USE_UPNP_PLACE_HOLDER', 'false').replace('CLOUDFLARE_BINARY_PLACEHOLDER', '')
        .replace('UPLOAD_LIMIT_PLACEHOLDER', '0').replace('ADMIN_PASSWORD_PLACEHOLDER', PW)
        .replace('PUBLIC_ORIGIN_PLACEHOLDER', '')
        .replace("server.listen(PORT, '0.0.0.0'", "server.listen(PORT, '127.0.0.1'")
        .replace(/^#!.*\n.*\n/, '');
    writeFileSync(path.join(dir, 'server.js'), src);
    writeFileSync(path.join(dir, 'repo.json'), '{"ok":true}');
    writeFileSync(path.join(dir, 'access.json'), JSON.stringify({ password: DL }));
    writeFileSync(path.join(dir, 'docker-compose.yml'), 'env_file:\n  - .env\n# ' + PW + '\n');
    writeFileSync(path.join(dir, '.env'), `ADMIN_PASSWORD=${PW}\n`);
    mkdirSync(path.join(dir, 'mods'));
    writeFileSync(path.join(dir, 'mods', 'a.txt'), 'mod');
    const child = spawn(process.execPath, [path.join(dir, 'server.js')], { cwd: dir, stdio: 'ignore', windowsHide: true });
    try {
        assert.equal((await waitUp(port)).status, 200, 'the manifest is still served');
        for (const p of ['/server.js', '/SERVER.JS', '/access.json', '/docker-compose.yml', '/.env', '/mods/..%2Fserver.js', '/node_modules/x']) {
            const r = await rawGet(port, p);
            assert.notEqual(r.status, 200, `${p} was served`);
            assert.ok(!r.body.includes(PW) && !r.body.includes(DL), `${p} leaked a password`);
        }
    } finally {
        child.kill();
        await new Promise((r) => setTimeout(r, 200));
        rmSync(dir, { recursive: true, force: true });
    }
});

test('every standalone server and the hub apply the root rule on the resolved path', () => {
    for (const name of ['server.express.js.template', 'server.hybrid.bat.template', 'server.hybrid.sh.template', 'server.v2.bat.template', 'server.v2.sh.template']) {
        const src = read(name);
        assert.match(src, /\['repo\.json', 'info\.json'\]\.includes\(_segs\[0\]\.toLowerCase\(\)\)/, `${name}: no root rule`);
    }
    assert.match(read('hub-server.js.template'), /\['repo\.json', 'info\.json'\]\.includes\(inRepo\[0\]\.toLowerCase\(\)\)/, 'hub: no per-repo rule');
});

test('the hybrid server, started for real, does not serve a sibling folder with the same prefix', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'bmm-confine-'));
    const dir = path.join(base, 'repo');
    const sibling = path.join(base, 'repo-private');
    mkdirSync(dir); mkdirSync(sibling); mkdirSync(path.join(sibling, 'mods'));
    const SECRET = ['SIBLING', 'CONTENT', 'MARKER'].join('-');   // joined: a literal reads as a key to gitleaks
    writeFileSync(path.join(sibling, 'secret.txt'), SECRET);
    writeFileSync(path.join(sibling, 'mods', 'x.txt'), SECRET);
    const port = await freePort();
    const src = read('server.hybrid.sh.template')
        .replace('PORT_PLACEHOLDER', String(port))
        .replace('USE_CLOUDFLARE_PLACEHOLDER', 'false')
        .replace('USE_UPNP_PLACE_HOLDER', 'false')
        .replace('CLOUDFLARE_BINARY_PLACEHOLDER', '')
        .replace('UPLOAD_LIMIT_PLACEHOLDER', '0')
        .replace("server.listen(PORT, '0.0.0.0'", "server.listen(PORT, '127.0.0.1'")
        .replace(/^#!.*\n.*\n/, '');
    writeFileSync(path.join(dir, 'server.js'), src);
    writeFileSync(path.join(dir, 'repo.json'), '{"ok":true}');
    mkdirSync(path.join(dir, 'mods'));
    writeFileSync(path.join(dir, 'mods', 'a.txt'), 'mod');
    const child = spawn(process.execPath, [path.join(dir, 'server.js')], { cwd: dir, stdio: 'ignore', windowsHide: true });
    try {
        const up = await waitUp(port);
        assert.equal(up.status, 200, 'the manifest is still served');
        assert.equal((await rawGet(port, '/mods/a.txt')).body, 'mod', 'a file of the repo is still served');
        for (const p of ['/..%2Frepo-private%2Fsecret.txt', '/%2e%2e%2frepo-private%2fsecret.txt',
            '/mods%2F..%2F..%2Frepo-private%2Fmods%2Fx.txt', '/..%5Crepo-private%5Csecret.txt']) {
            const r = await rawGet(port, p);
            assert.notEqual(r.status, 200, `${p} was served`);
            assert.ok(!r.body.includes(SECRET), `${p} leaked the sibling folder's file`);
        }
    } finally {
        child.kill();
        await new Promise((r) => setTimeout(r, 200));
        rmSync(base, { recursive: true, force: true });
    }
});
