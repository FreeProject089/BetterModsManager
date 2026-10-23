// Shortcuts bound to any device (core/shortcut-model.ts) and the files that carry them.
//
// Pinned here: the written form of a mouse, wheel or gamepad binding, that an old keyboard-only
// string keeps its meaning, which device chords are refused (the wheel alone scrolls, Ctrl+wheel
// zooms, the left and right buttons click), what a shortcuts file may carry, and that an import
// lists every entry with nothing to land on instead of dropping it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/core/shortcut-model.js')).href);
const EN = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
const FR = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));
const COMMANDS = readFileSync(join(ROOT, 'frontend/src/core/commands.ts'), 'utf8');
const CUSTOM = readFileSync(join(ROOT, 'frontend/src/features/settings/custom-shortcuts.ts'), 'utf8');

describe('the written form', () => {
  test('keyboard keys stay keyboard keys', () => {
    for (const k of ['k', 'f5', 'arrowup', 'space', '-', ':', 'mediaplaypause']) assert.equal(M.deviceOf(k), 'key', k);
  });
  test('device keys are recognised', () => {
    assert.equal(M.deviceOf('mouse:3'), 'mouse');
    assert.equal(M.deviceOf('Mouse:4'), 'mouse');
    assert.equal(M.deviceOf('wheel:up'), 'wheel');
    assert.equal(M.deviceOf('pad:0-4'), 'pad');
    assert.equal(M.mouseKey(1), 'mouse:1');
    assert.equal(M.wheelKey(-3), 'wheel:up');
    assert.equal(M.wheelKey(120), 'wheel:down');
  });
  test('gamepad combinations are sorted, unique and short', () => {
    assert.equal(M.padKey([5, 0, 5]), 'pad:0-5');
    assert.equal(M.padKey([]), null);
    assert.equal(M.padKey([1, 2, 3, 4]), null);
    assert.deepEqual(M.padButtons('pad:2-7-9'), [2, 7, 9]);
    assert.equal(M.padLabel('pad:0-5'), 'A+RB');
  });
  test('only the middle, back, forward and extra buttons are bindable', () => {
    assert.equal(M.mouseRecordable(0), false);
    assert.equal(M.mouseRecordable(2), false);
    for (const b of [1, 3, 4, 5, 7]) assert.equal(M.mouseRecordable(b), true, String(b));
  });
});

describe('refused device chords', () => {
  test('the wheel alone, Ctrl+wheel and Shift+wheel are the page\'s', () => {
    assert.equal(M.deviceReserved({ key: 'wheel:up' }), 'scroll');
    assert.equal(M.deviceReserved({ ctrl: true, key: 'wheel:down' }), 'zoom');
    assert.equal(M.deviceReserved({ shift: true, key: 'wheel:up' }), 'hscroll');
    assert.equal(M.deviceReserved({ alt: true, key: 'wheel:up' }), null);
    assert.equal(M.deviceReserved({ ctrl: true, shift: true, key: 'wheel:up' }), null);
  });
  test('left and right buttons never; a gamepad takes no keyboard modifier', () => {
    assert.equal(M.deviceReserved({ key: 'mouse:0' }), 'click');
    assert.equal(M.deviceReserved({ ctrl: true, key: 'mouse:2' }), 'click');
    assert.equal(M.deviceReserved({ ctrl: true, key: 'mouse:3' }), null);
    assert.equal(M.deviceReserved({ ctrl: true, key: 'pad:0' }), 'mods');
    assert.equal(M.deviceReserved({ key: 'k' }), null);
  });
  test('reservedChord consults the device rule', () => {
    assert.match(COMMANDS, /export function reservedChord[\s\S]{0,200}deviceReserved\(c\)/);
  });
});

describe('shortcuts files', () => {
  test('binding strings: old ones pass, malformed device keys do not', () => {
    for (const v of ['', 'Ctrl+K', 'Ctrl+Shift+F2', 'Ctrl+Mouse:3', 'Alt+Wheel:up', 'Pad:0-4']) assert.equal(M.validBindingString(v), true, v);
    for (const v of ['Mouse:0', 'Mouse:2', 'Wheel:left', 'Pad:4-0', 'Pad:1-2-3-4', 'Foo:1', 'x'.repeat(41), 42]) assert.equal(M.validBindingString(v), false, String(v));
  });
  test('the file version moved to 2, and the importer reads 1 and 2', () => {
    assert.equal(M.SHORTCUTS_FILE_VERSION, 2);
    assert.match(COMMANDS, /v >= 1 && v <= SHORTCUTS_FILE_VERSION/);
  });
  test('missing entries are listed, never dropped', () => {
    const data = {
      bindings: { 'mods.scan': 'Ctrl+Q', 'plugin.thing': 'Ctrl+Mouse:3', 'custom.a1': 'Alt+1', 'custom.b2': 'Pad:0', 'nav.gone': '' },
      custom: [
        { id: 'custom.a1', kind: 'profile', target: 'p-here', label: 'Here' },
        { id: 'custom.b2', kind: 'modpack', target: 'm-gone', label: 'Gone pack' },
      ],
    };
    const known = new Set(['mods.scan']);
    const out = M.missingEntries(data, (id) => known.has(id), (kind, target) => target === 'p-here');
    assert.deepEqual(out.map((x) => [x.kind, x.id, x.keys]), [
      ['modpack', 'custom.b2', 'Pad:0'],
      ['command', 'plugin.thing', 'Ctrl+Mouse:3'],
    ]);
  });
  test('the import review offers reassign, skip and keep disabled, and keeps by default', () => {
    assert.match(CUSTOM, /new Map<string, RowChoice>\(missing\.map\(\(x\) => \[x\.id, 'disable'\]\)\)/);
    for (const k of ['skd.imp.reassign', 'skd.imp.skip', 'skd.imp.keep']) assert.ok(CUSTOM.includes(`'${k}'`), k);
  });
});

describe('the eyedropper reuses the automation guard', () => {
  test('sensitiveReason and factsOf, not a copy', () => {
    assert.match(CUSTOM, /import\('\.\/sched-nav\.js'\)/);
    assert.match(CUSTOM, /sensitiveReason\(factsOf\(el\)\)/);
    assert.match(CUSTOM, /custom-page-view/);
  });
});

describe('translations', () => {
  const keys = [
    'sk.dev.middle', 'sk.dev.back', 'sk.dev.forward', 'sk.dev.button', 'sk.dev.wheelUp', 'sk.dev.wheelDown', 'sk.disabledTag',
    'skd.kind.element', 'skd.lbl.element', 'skd.elGone', 'skd.elRefused', 'skd.pick.btn', 'skd.pick.hint', 'skd.pick.tip',
    'skd.why.disabled', 'skd.why.field', 'skd.why.consent', 'skd.why.credentials', 'skd.why.danger', 'skd.why.sandbox',
    'skd.why.self', 'skd.why.noSelector', 'skd.imp.title', 'skd.imp.sub', 'skd.imp.lede', 'skd.imp.go', 'skd.imp.done',
  ];
  test('every new key exists in both languages', () => {
    for (const k of keys) { assert.ok(EN[k], `en ${k}`); assert.ok(FR[k], `fr ${k}`); }
  });
});
