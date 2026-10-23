// The Storage Manager's Graphics tab (agent-bmm-storage): which card draws the window, said in
// words, and a software renderer recognised as such. The switches themselves are tested in
// Rust (boot_flags.rs: each mode puts exactly its fixed switch in the WebView2 arguments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { describeRenderer, gpuAdvice } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/resources-spark.js')).href);

test('an ANGLE renderer string becomes the card and the API', () => {
  const r = describeRenderer('ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(r.name, 'AMD Radeon RX 7800 XT');
  assert.equal(r.api, 'Direct3D 11');
  assert.equal(r.software, false);
  const i = describeRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(i.name, 'Intel(R) UHD Graphics 620');
});

test('software renderers are recognised: SwiftShader, WARP, llvmpipe, and no WebGL at all', () => {
  assert.equal(describeRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)').software, true);
  assert.equal(describeRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)').software, true);
  assert.equal(describeRenderer('llvmpipe (LLVM 15.0.7, 256 bits)').software, true);
  assert.equal(describeRenderer('').software, true, 'no WebGL context: nothing is drawing with a GPU');
});

test('the advice: warn when the window is software-drawn although a real card exists and the GPU is not off', () => {
  const real = [{ name: 'AMD Radeon RX 7800 XT', software: false }];
  const sw = describeRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  const hw = describeRenderer('ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(gpuAdvice({ renderer: sw, gpus: real, activeMode: 'auto' }).softwareFallback, true);
  assert.equal(gpuAdvice({ renderer: sw, gpus: real, activeMode: 'off' }).softwareFallback, false, 'the user turned it off: expected');
  assert.equal(gpuAdvice({ renderer: hw, gpus: real, activeMode: 'auto' }).softwareFallback, false);
  assert.equal(gpuAdvice({ renderer: hw, gpus: real, activeMode: 'auto' }).cards, 1);
  const two = [{ name: 'Intel UHD', software: false }, { name: 'NVIDIA RTX 4060 Laptop', software: false }, { name: 'Microsoft Basic Display Adapter', software: true }];
  assert.equal(gpuAdvice({ renderer: hw, gpus: two, activeMode: 'auto' }).cards, 2, 'software adapters do not count as a second card');
});

test('Graphics & display (a Settings card) sends the mode to set_webview_gpu_mode and offers a restart', () => {
  const src = readFileSync(join(ROOT, 'frontend/src/features/settings/graphics-settings.ts'), 'utf8');
  assert.match(src, /invoke\('set_webview_gpu_mode', \{ mode/);
  for (const m of ['auto', 'power_saving', 'high_performance', 'off']) assert.match(src, new RegExp(`'${m}'`), `the ${m} mode is not offered`);
  assert.match(src, /invoke\('app_restart'\)/, 'a changed setting applies after a restart: offer it');
  assert.match(src, /UNMASKED_RENDERER_WEBGL/, 'the renderer in use is read from WebGL');
});

// The owner (Sept 29): graphics is about the whole app, not storage. One app-wide card with the
// GPU choice (the old on/off switch merged into it as "Off"), the renderer in use, "Reduce
// animations", and the detected hardware; the Storage Manager keeps five tabs.
test('graphics is an app-wide Settings card, reachable from the palette, gone from the Storage Manager', () => {
  const modal = readFileSync(join(ROOT, 'frontend/src/features/settings/storage-modal.ts'), 'utf8');
  const tabs = modal.match(/const TABS[^=]*= \[([\s\S]*?)\n\];/)[1];
  assert.deepEqual([...tabs.matchAll(/id: '(\w+)'/g)].map((m) => m[1]), ['space', 'intensity', 'game', 'live', 'rules']);
  assert.doesNotMatch(modal, /set_webview_gpu/, 'no second graphics control in the Storage Manager');
  const settings = readFileSync(join(ROOT, 'frontend/src/features/settings/settings.ts'), 'utf8');
  assert.match(settings, /initGraphicsSettings\(\{ toast \}\)/);
  const cmds = readFileSync(join(ROOT, 'frontend/src/core/commands.ts'), 'utf8');
  assert.match(cmds, /id: 'settings\.graphics'[^\n]*callGlobal\('openGraphicsSettings'\)/);
  const card = readFileSync(join(ROOT, 'frontend/src/features/settings/graphics-settings.ts'), 'utf8');
  assert.match(card, /\(window as any\)\.openGraphicsSettings = /);
  assert.match(card, /learnMore\('graphics'/);
  assert.equal((card.match(/set_webview_gpu_mode/g) || []).length, 1, 'one control for the GPU');
  assert.doesNotMatch(card, /'set_webview_gpu'/, 'the old on/off switch is merged, not kept beside');
  const theme = readFileSync(join(ROOT, 'frontend/src/features/themes/theme-engine.ts'), 'utf8');
  assert.match(theme, /bmm\.reduceAnimations/, 'the theme engine keeps the app-wide choice when a theme is applied');
  assert.match(card, /REDUCE_ANIM_KEY = 'bmm\.reduceAnimations'/);
});

// Seen in the QA pass (2026-09-29): switch the language and the whole card stayed in the one
// BMM started in. Its fixed words carry data-i18n (every key present in both languages); the
// ones written from code are written again on `langChanged`.
test('the Graphics card follows a language switch', () => {
  const card = readFileSync(join(ROOT, 'frontend/src/features/settings/graphics-settings.ts'), 'utf8');
  const keys = [...card.matchAll(/data-i18n(?:-tooltip)?="([\w.]+)"/g)].map((m) => m[1]);
  for (const k of ['gfx.cardTitle', 'stm.lead.graphics', 'stm.gfx.title', 'stm.gfx.now', 'gfx.reduceAnim', 'gfx.reduceAnimHint', 'storage.hwTitle']) {
    assert.ok(keys.includes(k), `${k} is re-translated`);
  }
  const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
  for (const lang of ['en', 'fr']) {
    const L = JSON.parse(readFileSync(join(ROOT, `frontend/Lang/${lang}.json`), 'utf8'));
    for (const k of keys) assert.ok(get(L, k) ?? L[k], `${lang}: ${k}`);
  }
  assert.match(card, /document\.addEventListener\('langChanged', relabel\)/);
});
