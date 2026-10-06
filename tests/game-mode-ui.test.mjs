// Game mode's second pass (agent-bmm-storage): the Game mode tab says WHICH game turned it on,
// from where and since when, what is held, when it ends; its profile folders can be ignored one
// by one; and "pause everything until I quit the game" reads as such.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const spark = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/resources-spark.js')).href);
const { gameHeadline, gameDetail, durationText, profileFolders, normGameDir, pausedAllText } = spark;
const none = () => '';

const view = (over = {}) => ({ active: false, manual: 'auto', trigger: null, since_ms: null, leaving_in_ms: null, watched_dirs: [], paused_kinds: ['hash', 'maintenance'], leave_after_secs: 30, ...over });
const profiles = [{ name: 'Skyrim SE', game_path: 'D:/Games/Skyrim' }, { name: 'Tools', game_path: 'E:\\Tools\\' }, { name: 'Whole drive', game_path: 'C:\\' }, { name: 'Unset', game_path: '' }];

test('durations read like a person would say them', () => {
  assert.equal(durationText(4200, none), '4 s');
  assert.equal(durationText(125000, none), '2 min');
  assert.equal(durationText(3900000, none), '1 h 5 min');
});

test('the headline names the game, or says why there is none', () => {
  assert.match(gameHeadline(view(), none), /No app detected/);
  const on = view({ active: true, trigger: { exe: 'D:\\Games\\Skyrim\\SkyrimSE.exe', name: 'SkyrimSE.exe', source: 'profile_folder', dir: 'd:\\games\\skyrim\\' }, since_ms: 720000 });
  assert.match(gameHeadline(on, none), /SkyrimSE\.exe/);
  assert.match(gameHeadline(view({ active: true, manual: 'on', trigger: { exe: '', name: '', source: 'forced' } }), none), /forced on/i);
  assert.match(gameHeadline(view({ manual: 'off' }), none), /off/i);
  assert.match(gameHeadline(view({ active: true, trigger: { exe: '', name: '', source: 'exclusive_fullscreen' } }), none), /full screen/i);
});

test('the detail says where it was found, since when, and the cooldown left', () => {
  const on = view({ active: true, trigger: { exe: 'D:\\Games\\Skyrim\\SkyrimSE.exe', name: 'SkyrimSE.exe', source: 'profile_folder', dir: 'd:\\games\\skyrim\\' }, since_ms: 720000 });
  const d = gameDetail(on, profiles, none);
  assert.match(d, /“Skyrim SE”/, 'the profile whose folder it runs from');
  assert.match(d, /12 min/);
  const listed = gameDetail(view({ active: true, trigger: { exe: 'x', name: 'x.exe', source: 'listed' }, since_ms: 1000 }), profiles, none);
  assert.match(listed, /your list/);
  const leaving = gameDetail(view({ active: true, trigger: { exe: 'x', name: 'x.exe', source: 'listed' }, since_ms: 60000, leaving_in_ms: 18000 }), profiles, none);
  assert.match(leaving, /18 s/, 'the game closed: when BMM goes back to normal');
});

test('profile folders: watched, ignored, or never (a whole drive, an unset folder)', () => {
  assert.equal(normGameDir('E:/Tools/'), 'e:\\tools\\');
  const rows = profileFolders(profiles, ['e:\\tools\\']);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by['Skyrim SE'].ignored, false);
  assert.equal(by['Skyrim SE'].dir, 'd:\\games\\skyrim\\');
  assert.equal(by['Tools'].ignored, true);
  assert.equal(by['Whole drive'].wholeDrive, true, 'a drive root is never watched, and the tab says so');
  assert.equal(by['Unset'], undefined, 'a profile with no game folder has nothing to watch');
});

test('a pause "until I close the app" says so and has no timer', () => {
  const txt = pausedAllText({ by: 'game', age_ms: 0, remaining_ms: null }, none);
  assert.match(txt, /until you close the app/);
  assert.doesNotMatch(txt, /Resumes by itself in/);
});

test('the Game mode tab wires the options, the lists and the pause', () => {
  const src = readFileSync(join(ROOT, 'frontend/src/features/settings/resources-dash.ts'), 'utf8');
  assert.match(src, /invoke\('resources_set_game_options', \{ options/);
  assert.match(src, /action: 'pause_until_game_ends'/);
  assert.match(src, /invoke\('list_running_processes'\)/, 'pick a running program');
  assert.match(src, /pickFile\(/, 'or browse for an .exe');
  const modal = readFileSync(join(ROOT, 'frontend/src/features/settings/storage-modal.ts'), 'utf8');
  assert.match(modal, /listen\('bmm:\/\/game-mode'/, 'the engage / disengage notice');
  const main = readFileSync(join(ROOT, 'src-tauri/src/main.rs'), 'utf8');
  assert.match(main, /"bmm:\/\/game-mode"/, 'emitted by the detector');
});
