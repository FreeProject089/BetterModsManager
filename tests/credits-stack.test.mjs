// Credits → Technical stack is generated (scripts/gen-credits.mjs). The panel must list what
// BMM ships with the version that ships, a licence for every entry, the AI model pinned at the
// revision the lock pins, and nothing typed back into app.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const gen = JSON.parse(read('frontend/assets/credits-stack.gen.json'));
const byId = Object.fromEntries(gen.groups.map((g) => [g.id, g.items]));

test('the generated file is what the manifests say', () => {
  execFileSync(process.execPath, ['scripts/gen-credits.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
});

test('every group the panel knows is there, and every entry has a licence and a source', () => {
  for (const id of ['shell', 'ui', 'core', 'ai', 'art', 'docs', 'installer', 'site', 'tooling']) assert.ok(byId[id]?.length, `group ${id} is empty`);
  for (const g of gen.groups) for (const it of g.items) {
    assert.ok(it.license, `${g.id}/${it.name} has no licence`);
    assert.ok(it.source, `${g.id}/${it.name} has no source`);
    assert.ok(it.key && /^[a-z0-9-]+$/.test(it.key), `${g.id}/${it.name} key ${it.key}`);
  }
});

test('the versions are the resolved ones from Cargo.lock, not the requirements', () => {
  const lock = read('src-tauri/Cargo.lock');
  const tauri = byId.shell.find((x) => x.name === 'tauri');
  assert.match(tauri.version, /^2\.\d+\.\d+/);
  assert.ok(lock.includes(`name = "tauri"\nversion = "${tauri.version}"`) || lock.includes(`name = "tauri"\r\nversion = "${tauri.version}"`));
});

test('the AI group pins the model the lock pins', () => {
  const lock = JSON.parse(read('laya-model.lock.json'));
  const model = byId.ai.find((x) => x.key === 'laya-model');
  assert.equal(model.license, lock.model.license);
  assert.ok(model.url.endsWith(lock.model.revision));
  assert.ok(byId.ai.some((x) => x.name === 'ort') && byId.ai.some((x) => x.name === 'tokenizers'));
  assert.equal(byId.ai.find((x) => x.key === 'onnxruntime').version, lock.onnxruntime.version);
});

test('app.ts reads the generated list and the panel keeps its i18n', () => {
  const app = read('frontend/src/ui/app.ts');
  assert.ok(app.includes('assets/credits-stack.gen.json'));
  assert.doesNotMatch(app, /\{\s*name:\s*"[^"]+",\s*v:\s*"[^"]+",\s*key:/);
  const en = JSON.parse(read('frontend/Lang/en.json')), fr = JSON.parse(read('frontend/Lang/fr.json'));
  for (const g of gen.groups) for (const k of [`credits.group.${g.id}`, `credits.groupBlurb.${g.id}`]) {
    assert.ok(en[k] && fr[k], `${k} missing in en or fr`);
  }
});
