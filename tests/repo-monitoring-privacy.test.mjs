// The public monitoring feed of every generated repo server carries no IP and no Creator ID.
//
// Security summary §9 #9: `monitoring.json` is public (no password, reachable over UPnP and a
// tunnel) and it listed each active downloader's IP address and Creator ID, personal data of
// third parties published by the user. The decision: publish aggregates only (active count,
// bytes, per-file progress); the detail stays with the host (BMM's own screen for the
// built-in server, tested in Rust by `repo_server::public_monitoring_tests`; the admin-password
// route `/admin/monitoring` for the standalone servers, whose dashboards log in first).
//
// Built from the TEMPLATES, so this tests what ships. The hybrid server has no monitoring
// route: it writes `monitoring.json` beside itself for the host's BMM to read from disk, and
// used to serve every file of its folder. It is started for real and asked for that file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const here = path.dirname(fileURLToPath(import.meta.url));
const T = path.join(here, '..', 'src-tauri', 'src', 'templates', 'mini-server');
const read = (f) => readFileSync(path.join(T, f), 'utf8');

const SERVERS = ['server.express.js.template', 'server.v2.bat.template', 'server.v2.sh.template', 'hub-server.js.template'];
const IPS = ['203.0.113.7', '198.51.100.9'];
const IDS = ['BC-SECRET-ONE', 'BC-SECRET-TWO'];

/** The template's own `publicMonitoring`, extracted and evaluated. */
function loadPublicMonitoring(src, name) {
    const start = src.indexOf('function publicMonitoring(');
    assert.ok(start >= 0, `${name}: no publicMonitoring function`);
    const end = src.indexOf('\n}\n', start);
    assert.ok(end > start, `${name}: publicMonitoring is not closed`);
    return new Function(`${src.slice(start, end + 2)}; return publicMonitoring;`)();
}

const FULL = {
    server: { version: '2', uptime: 5, totalBytes: 999, totalDls: 3, totalDownloads: 3, totalRepoSize: 10, modsDownloads: { a: 2, leak: IPS[0] } },
    active: [
        { ip: IPS[0], creatorId: IDS[0], file: 'mods/a/x.pak', downloaded: 10, total: 100, speed: 1, protocol: 'WAN', startTime: 1 },
        { ip: IPS[1], creatorId: IDS[1], file: 'mods/b/y.pak', downloaded: 5, total: 50, speed: 2, protocol: 'LAN', startTime: 2 },
    ],
    sessions: [{ ip: IPS[0], creatorId: IDS[0], bytes: 1, lastSeen: 1, files: ['x'] }],
    history: [{ ip: IPS[1], creatorId: IDS[1], event: 'CONNECTION', details: '', ts: 1 }],
};

for (const name of SERVERS) {
    test(`${name}: the public feed is aggregates only`, () => {
        const src = read(name);
        const pub = loadPublicMonitoring(src, name)(structuredClone(FULL));
        const text = JSON.stringify(pub);
        for (const s of [...IPS, ...IDS, '"ip"', 'creatorId', 'WAN', 'LAN']) {
            assert.ok(!text.includes(s), `${name}: the public feed carries ${s}: ${text}`);
        }
        assert.equal(pub.server.activeCount, 2);
        assert.equal(pub.server.activeBytes, 15);
        assert.equal(pub.active[0].downloaded, 10);
        assert.equal(pub.active[1].total, 50);
        assert.deepEqual(pub.sessions, []);
        assert.deepEqual(pub.history, []);
    });

    test(`${name}: the public route answers through publicMonitoring, the detail needs the admin password`, () => {
        const src = read(name);
        const lines = src.split('\n');
        // Every place that answers the public monitoring path.
        const routeAt = lines.findIndex((l) => /['`]\/(:folder\/)?monitoring\.json['`]/.test(l) && /app\.get|req\.url ===/.test(l));
        assert.ok(routeAt >= 0, `${name}: no public monitoring route`);
        const body = lines.slice(routeAt, routeAt + 6).join('\n');
        assert.match(body, /publicMonitoring\(/, `${name}: the public route must wrap its report in publicMonitoring`);
        const admin = lines.findIndex((l) => l.includes('/admin/monitoring') && /app\.get|req\.url ===/.test(l));
        assert.ok(admin >= 0, `${name}: no /admin/monitoring route for the host`);
        const adminBody = lines.slice(admin, admin + 3).join('\n');
        assert.match(adminBody, /authAdmin|isAuthorized\(\)/, `${name}: /admin/monitoring must check the admin password`);
    });
}

test('the standalone dashboards read the detail through the authenticated route', () => {
    for (const f of ['dashboard.html.template', 'server.v2.bat.template', 'server.v2.sh.template', 'hub-dashboard.html.template']) {
        const src = read(f);
        assert.ok(!/fetch\(['`]\/monitoring\.json['`]\)/.test(src), `${f}: a dashboard fetches the public feed without its password`);
        assert.ok(src.includes('/admin/monitoring'), `${f}: the dashboard does not read /admin/monitoring`);
    }
});

async function freePort() {
    return new Promise((resolve) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
}

async function get(port, p) {
    for (let i = 0; i < 50; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}${p}`);
            return { status: r.status, body: await r.text() };
        } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('the hybrid server never answered');
}

test('the hybrid server does not serve its own monitoring.json, log or lists', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bmm-hybrid-'));
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
    writeFileSync(path.join(dir, 'monitoring.json'), JSON.stringify([{ ip: IPS[0], creator_id: IDS[0] }]));
    writeFileSync(path.join(dir, 'bans.json'), JSON.stringify({ banned_ips: [IPS[1]], banned_keys: [] }));
    mkdirSync(path.join(dir, 'mods'));
    writeFileSync(path.join(dir, 'mods', 'a.txt'), 'mod');
    const child = spawn(process.execPath, [path.join(dir, 'server.js')], { cwd: dir, stdio: 'ignore', windowsHide: true });
    try {
        const repo = await get(port, '/repo.json');
        assert.equal(repo.status, 200, 'the manifest is still served');
        for (const p of ['/monitoring.json', '/MONITORING.json', '/mods/../monitoring.json', '/monitoring.json.', '/bans.json', '/server.log', '/server.js']) {
            const r = await get(port, p);
            assert.notEqual(r.status, 200, `${p} must not be served`);
            for (const s of [...IPS, ...IDS]) assert.ok(!r.body.includes(s), `${p} leaked ${s}`);
        }
    } finally {
        child.kill();
        await new Promise((r) => setTimeout(r, 200));
        rmSync(dir, { recursive: true, force: true });
    }
});
