// scripts/publish-bcweb-asset.mjs against a fake BCWEB (a loopback http server that answers the
// CI publish contract: presign → storage PUT → confirm). Pins what BCWEB's side checks
// (BCW/BCWEB/apps/api/test/asset-publish-key.test.mjs) from the client's side: the key goes to
// the API as a Bearer header and nowhere else, the storage PUT carries exactly the signed
// Content-Type and Content-Length, the declared SHA-256 is the file's, and the key is never
// printed, even when BCWEB refuses.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'publish-bcweb-asset.mjs');
const KEY = ['bck', 'fakeCiPublishKeyForTheTestOnly0123456789abc'].join('_');
const sha = (b) => createHash('sha256').update(b).digest('hex');

let server, base, mode = 'ok';
const seen = [];
const stored = new Map();

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url.startsWith('/store/')) {
        stored.set(req.url, body);
        res.writeHead(200); return res.end();
      }
      if (mode === 'refuse') return json(403, { error: 'slot_not_allowed' });
      const m = /^\/api\/ci\/assets\/([^/]+)(\/presign)?$/.exec(req.url);
      if (!m) return json(404, { error: 'not_found' });
      const b = JSON.parse(body.toString() || '{}');
      if (m[2]) return json(200, { url: `${base}/store/${m[1]}/ci-1-${b.filename}?X-Amz-Signature=secretsig`, storageKey: `platform/${m[1]}/ci-1-${b.filename}`, expiresIn: 900 });
      const got = stored.get(`/store/${m[1]}/ci-1-${b.filename}?X-Amz-Signature=secretsig`);
      if (!got || sha(got) !== b.sha256) return json(422, { error: 'hash_mismatch' });
      return json(200, { ok: true, sha256: sha(got), size: got.length });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

// Async on purpose: the fake BCWEB lives in THIS process, and spawnSync would block the event
// loop that has to answer the child's requests.
const run = (file, args, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [SCRIPT, file, ...args], { env: { ...process.env, BCWEB_ASSETS_TOKEN: KEY, BCWEB_API: `${base}/api`, ...env } });
  let stdout = '', stderr = '';
  c.stdout.on('data', (d) => { stdout += d; });
  c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => c.kill(), 30_000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});

describe('publish-bcweb-asset.mjs (fake BCWEB)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bmm-publish-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('presign, streamed PUT, confirm: Bearer to the API only, exact type and length, the file hash', async () => {
    const f = join(dir, 'laya-offline-1.zip');
    const bytes = Buffer.alloc(256 * 1024, 7);
    writeFileSync(f, bytes);
    seen.length = 0; mode = 'ok';
    const r = await run(f, ['--slot', 'bmm-laya-offline', '--version', '1']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url.split('?')[0]}`), [
      'POST /api/ci/assets/bmm-laya-offline/presign',
      'PUT /store/bmm-laya-offline/ci-1-laya-offline-1.zip',
      'PUT /api/ci/assets/bmm-laya-offline',
    ]);
    const [pre, put, confirm] = seen;
    assert.equal(pre.headers.authorization, `Bearer ${KEY}`);
    assert.equal(confirm.headers.authorization, `Bearer ${KEY}`);
    assert.equal(put.headers.authorization, undefined, 'the key never goes to the storage URL');
    assert.equal(put.headers['content-type'], 'application/zip');
    assert.equal(put.headers['content-length'], String(bytes.length));
    assert.ok(put.body.equals(bytes));
    const p = JSON.parse(pre.body.toString());
    assert.deepEqual(p, { filename: 'laya-offline-1.zip', contentType: 'application/zip', size: bytes.length, sha256: sha(bytes) });
    const c = JSON.parse(confirm.body.toString());
    assert.equal(c.sha256, sha(bytes));
    assert.equal(c.storageKey, 'platform/bmm-laya-offline/ci-1-laya-offline-1.zip');
    assert.equal(c.version, '1');
    const out = r.stdout + r.stderr;
    assert.ok(!out.includes(KEY) && !out.includes('secretsig'), 'neither the key nor the presigned URL is printed');
  });

  test('a JSON manifest goes up as application/json', async () => {
    const f = join(dir, 'update.json');
    writeFileSync(f, '{"version":"1.2.3"}');
    seen.length = 0; mode = 'ok';
    const r = await run(f, ['--slot', 'bmm-update-json', '--version', '1.2.3']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(seen[1].headers['content-type'], 'application/json');
  });

  test('a refusal fails the step and still prints no key', async () => {
    const f = join(dir, 'update-manifest.json');
    writeFileSync(f, '{}');
    mode = 'refuse';
    const r = await run(f, ['--slot', 'bmm-update-manifest']);
    mode = 'ok';
    assert.equal(r.status, 1);
    assert.match(r.stderr, /HTTP 403/);
    assert.ok(!(r.stdout + r.stderr).includes(KEY));
  });

  test('refuses to run without a key, with a bad slot, or over plain http to a remote host', async () => {
    const f = join(dir, 'u.json');
    writeFileSync(f, '{}');
    assert.equal((await run(f, ['--slot', 'x'], { BCWEB_ASSETS_TOKEN: '' })).status, 2);
    assert.equal((await run(f, ['--slot', '../etc'])).status, 2);
    assert.equal((await run(f, ['--slot', 'bmm-update-json'], { BCWEB_API: 'http://bettercommunity.ch/api' })).status, 2);
  });
});
