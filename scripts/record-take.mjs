#!/usr/bin/env node
// record-take — puts BMM into a known state for a documentation recording, arms the session
// recorder, waits while YOU perform the interaction, then exports the .bmmreplay.
//
// Two modes, and which one a clip needs comes down to one detail of how BMM records.
//
// BMM's recorder sets `mousemove: false` — pointer POSITIONS are never captured, as a size
// optimisation. So no BMM replay has a moving cursor, not even one filmed by hand. What a human
// take does carry that an API-driven one cannot: click markers (rrweb keeps mouseInteraction),
// scroll, and typing. DOM changes are captured either way, whatever caused them.
//
// So:
//   • A clip whose content is a RESULT — a sync transferring, a benchmark running, a scheduled
//     task firing, storage bars moving — records fine with no one at the keyboard. Give the
//     scenario a `drive` list and it runs end to end.
//   • A click-through tutorial still wants a human, because the click markers are the "here is
//     where I pressed" affordance and nothing else supplies them.
//
//   node scripts/record-take.mjs --list
//   node scripts/record-take.mjs themes                        # assisted: state, then you perform
//   node scripts/record-take.mjs <scenario> --auto             # unattended, if it has a `drive`
//   node scripts/record-take.mjs themes --dry-run              # print the plan, touch nothing
//   node scripts/record-take.mjs themes --no-record            # just set the state up
//   node scripts/record-take.mjs themes --profile "My profile" # record against your own data
//
// Requires BMM to be running. See Update/Guides/Other/Recording_Plan_*.md for what each clip
// has to show.

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// ── the recording fixture ────────────────────────────────────────────────────
// Clips are recorded against a profile made FOR recording, not against your library and not
// against the tutorial's sandbox. The sandbox looked like the obvious choice and is not: it
// exists only while a tutorial is running, so its overlay would be in every frame, and the
// engine deletes it when the tutorial ends or at the next boot if a session crashed.
//
// This fixture is a normal profile pointing at throwaway folders in temp, holding a handful of
// example mods. It survives restarts, contains nothing of yours — so clips can be recorded
// UNMASKED and stay readable — and is designed so the documented clips are actually possible:
// two mods deliberately share a file for the conflicts clip, and one is packed wrong for the
// mapper clip.
const FIXTURE_NAME = 'Recording demo';
const FIXTURE_ROOT = join(tmpdir(), 'bmm-recording-fixture');
const FIXTURE_MODS = {
  'HD Texture Pack':      ['Data/Textures/hero.dds', 'Data/Textures/normal.dds', 'Data/Textures/sky.dds'],
  'HD Texture Pack Lite': ['Data/Textures/hero.dds'],           // shares hero.dds on purpose
  'Sound Overhaul':       ['Data/Sounds/ambient.ogg', 'Data/Sounds/ui-click.ogg'],
  'Badly Packed Mod':     ['hero.dds', 'readme.txt'],           // no Data/ — for the mapper clip
};

// ── scenarios ────────────────────────────────────────────────────────────────
// A step is one of:
//   { profile: 'name' }            activate a profile (name or id, fuzzy)
//   { enable: 'mod' }              enable a mod            { disable: 'mod' }
//   { disableAll: true }           turn everything off — the usual clean slate
//   { modpack: 'name', on: bool }  apply / clear a modpack
//   { deeplink: 'bmm://…' }        hand a deeplink to the OS (this is how you open a screen)
//   { wait: 1200 }                 pause, ms
//   { say: 'text' }                print an instruction for you, run nothing
//
// `perform` is what you do by hand once the recorder is armed. Keep it to one idea.
const SCENARIOS = {
  themes: {
    title: 'Themes & appearance',
    page: 'features/themes',
    full: true,                       // unmasked: the demo profile has no real data
    setup: [
      { profile: FIXTURE_NAME },
      { deeplink: 'bmm://theme/apply?id=default' },
      { wait: 800 },
    ],
    perform: [
      'Open Settings > Appearance and apply two built-in themes, pausing on each.',
      'Open the theme editor and change ONE colour token so the live re-render is visible.',
      'Close the editor. End on a settled screen.',
    ],
  },

  'command-palette': {
    title: 'Command palette & shortcuts',
    page: 'features/command-palette',
    full: true,
    setup: [{ profile: FIXTURE_NAME }, { deeplink: 'bmm://docs/open' }, { wait: 600 }],
    perform: [
      'Press Ctrl+K, type a few letters, arrow down, Enter — land on a screen.',
      'Ctrl+K again, switch to semantic mode, search a word BMM does not use (e.g. "delete").',
      'Open Settings > Keyboard shortcuts and rebind one row.',
    ],
  },

  conflicts: {
    title: 'Conflicts — who wins, and what comes back',
    page: 'how-it-works/conflicts',
    full: true,
    setup: [{ profile: FIXTURE_NAME }, { disableAll: true }, { wait: 500 }],
    perform: [
      'Enable mod A, then mod B — the two that share a file.',
      'Open the conflict view and show the overlapping file.',
      "Disable B and show A's file coming BACK. That restore is the point of the clip.",
    ],
  },

  profiles: {
    title: 'Profiles — switching moves no files',
    page: 'features/profiles',
    full: true,
    setup: [{ profile: FIXTURE_NAME }, { disableAll: true }, { wait: 500 }],
    perform: [
      'Create a profile, showing the three folders.',
      'Enable a mod, then SWITCH profiles and show the game folder is unchanged.',
      'This is the most misunderstood behaviour in BMM — linger on it.',
    ],
  },

  storage: {
    title: 'Storage & disk I/O',
    page: 'features/storage',
    full: true,
    setup: [{ profile: FIXTURE_NAME }, { deeplink: 'bmm://docs/open?article=storage-manager' }, { wait: 600 }],
    perform: [
      'Open the Storage Manager. Show Smart I/O and run Auto-Calibration once.',
      'Apply a per-disk MB/s cap, then show free space per profile.',
    ],
  },

  'privacy-masked': {
    title: 'The masking demo (bmm-demo.bmmreplay)',
    page: 'features/privacy-telemetry',
    full: false,                      // MASKED on purpose — masking is what it demonstrates
    setup: [{ profile: FIXTURE_NAME }, { wait: 500 }],
    perform: [
      'A short general tour: Library, a profile switch, a settings page.',
      'Names must be visibly masked — that is the whole point of this clip.',
    ],
  },

  // ── unattended clips ──────────────────────────────────────────────────────
  // `drive` runs WHILE recording, so --auto needs nobody. These work because what they show is
  // a result, not a gesture: no click markers are missing because nothing was clicked.
  'activation-auto': {
    title: 'Enable / disable — what the mod list does (unattended)',
    page: 'how-it-works/profiles-activation',
    full: true,
    setup: [{ profile: FIXTURE_NAME }, { disableAll: true }, { wait: 1500 }],
    // `enableFirst` rather than named mods: an unattended clip should not depend on what a
    // particular library happens to contain, or it only ever runs on the machine it was written
    // on. It takes them in list order, pausing between each so the list visibly fills in.
    drive: [
      { say: 'Enabling mods one at a time so the list fills in on camera' },
      { enableFirst: 3, every: 2500 },
      { wait: 2000 },
      { say: 'Now clearing them, which is the half people never see' },
      { disableAll: true, wait: 3000 },
    ],
  },
};

// ── plumbing ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const flagValue = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = has('--dry-run');
const NO_REC = has('--no-record');
// Record against one of your own profiles instead of the demo sandbox. Such a clip is forced
// MASKED below — your real mod names and folder paths would otherwise be baked into it.
const PROFILE_OVERRIDE = flagValue('--profile');
const name = (() => {
  const pi = args.indexOf('--profile');
  return args.find((a, i) => !a.startsWith('-') && !(pi >= 0 && i === pi + 1));
})();

// Handled at the bottom, once the token and BASE exist.
const FIXTURE_CMD = has('--setup-fixture') ? 'setup' : (has('--teardown-fixture') ? 'teardown' : null);

if (!FIXTURE_CMD && (has('--list') || !name)) {
  console.log('Scenarios:\n');
  for (const [k, s] of Object.entries(SCENARIOS)) {
    console.log(`  ${k.padEnd(18)} ${s.title}`);
    console.log(`  ${''.padEnd(18)} -> ${s.page}   ${s.full ? 'unmasked' : 'MASKED'}   ${s.drive ? '[--auto: unattended]' : '[you perform it]'}`);
  }
  console.log('\n  node scripts/record-take.mjs <scenario> [--auto] [--dry-run] [--no-record] [--profile "name"]');
  process.exit(name ? 1 : 0);
}
const scn = FIXTURE_CMD ? null : SCENARIOS[name];
if (!FIXTURE_CMD && !scn) { console.error(`Unknown scenario "${name}". Try --list.`); process.exit(1); }

const AUTO = has('--auto');
if (!FIXTURE_CMD && !AUTO && !scn.perform) {
  console.error(
    `"${name}" is an unattended clip — it has a \`drive\` list and nothing for you to perform.\n` +
    `  Run it with --auto.`
  );
  process.exit(1);
}
if (!FIXTURE_CMD && AUTO && !scn.drive) {
  console.error(
    `"${name}" has no \`drive\` list, so there is nothing to run unattended.\n` +
    `  It is a click-through clip: BMM records click markers only for real presses, and those\n` +
    `  are the "here is where I pressed" affordance. Run it without --auto and perform it.`
  );
  process.exit(1);
}
// A driven clip enables and disables mods, which deploys and removes real files. On the demo
// sandbox that is the point; on one of your own profiles it edits your game folder, so it has
// to be asked for.
if (!FIXTURE_CMD && AUTO && PROFILE_OVERRIDE && !has('--allow-writes')) {
  console.error(
    `--auto with --profile would enable/disable mods in "${PROFILE_OVERRIDE}", which writes to\n` +
    `  that profile's game folder. Add --allow-writes if that is what you want.`
  );
  process.exit(1);
}

// A scenario is unmasked because it records the demo sandbox, which holds nothing real. Point it
// at one of your own profiles and that reasoning is gone, so the unmasking goes with it —
// otherwise an override would silently bake real mod names and folder paths into a clip headed
// for a public site. --force-unmasked overrides the override, deliberately awkward to type.
const FORCED_MASK = !!PROFILE_OVERRIDE && !!(scn && scn.full) && !has('--force-unmasked');
const FULL = FORCED_MASK ? false : !!(scn && scn.full);

const DATA = join(process.env.APPDATA || '', 'com.bettermm.desktop', 'data.json');
// The token is read straight from data.json so it never has to be pasted anywhere — and it is
// never printed, not even in --dry-run.
let TOKEN = '', PORT = 51274;
try {
  if (!existsSync(DATA)) throw new Error(`data.json not found at ${DATA}`);
  const s = JSON.parse(readFileSync(DATA, 'utf8')).settings || {};
  TOKEN = s.api_token || '';
  PORT = Number(s.api_port) || 51274;
} catch (e) {
  console.error('Cannot read BMM settings:', e.message);
  process.exit(1);
}
const BASE = `http://127.0.0.1:${PORT}`;

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function health() {
  try {
    return await api('GET', '/api/health');
  } catch {
    console.error(
      `\n[x] Nothing answered on ${BASE}.\n` +
      `  - Is BMM running?\n` +
      `  - If it is: the port may have been taken when it started. BMM does NOT fall back to\n` +
      `    another port; it disables the API for the whole session and logs a line. Restart BMM.\n`
    );
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().trim();

/** Every list endpoint answers `{ ok, data: [...] }`. Two shapes are tolerated beyond that: the
 *  array under a named key (that is how /api/mods/all reports, under "profiles"), and a bare
 *  array. This wrapper exists because guessing the envelope is exactly the bug that bit this
 *  script — and a stub built from the same guess happily confirmed the guess. */
function list(payload, altKey) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (altKey && payload && Array.isArray(payload[altKey])) return payload[altKey];
  throw new Error(`unexpected response shape: ${JSON.stringify(payload).slice(0, 120)}`);
}

/** Resolve a human name to an id, refusing to guess when it is ambiguous. */
function resolve(items, wanted, label) {
  const w = norm(wanted);
  const exact = items.filter((x) => norm(x.name) === w || x.id === wanted);
  const pick = exact.length ? exact : items.filter((x) => norm(x.name).includes(w));
  if (pick.length === 1) return pick[0];
  if (!pick.length) {
    throw new Error(`no ${label} matches "${wanted}". Available: ${items.map((x) => x.name).join(', ')}`);
  }
  throw new Error(`"${wanted}" matches ${pick.length} ${label}s: ${pick.map((x) => x.name).join(', ')} - be more specific`);
}

function fireDeeplink(url) {
  // Deeplinks go through the OS, which is what makes them behave exactly as they do when a user
  // clicks one on a web page.
  return new Promise((res) => {
    const p = spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true });
    p.on('close', () => res());
    p.on('error', () => res());
  });
}

/** `wait` is a trailing pause, so `{ enable: 'x', wait: 2000 }` acts THEN waits. Handling wait
 *  first would have made that step a no-op that only slept — the action key silently ignored. */
async function runStep(step) {
  await runAction(step);
  if (step.wait && !isPureWait(step)) { console.log(`   - wait ${step.wait}ms`); if (!DRY) await sleep(step.wait); }
}
const ACTION_KEYS = ['say', 'deeplink', 'profile', 'disableAll', 'enable', 'disable', 'modpack', 'enableFirst'];
const isPureWait = (s) => s.wait != null && !ACTION_KEYS.some((k) => s[k] != null);

async function runAction(step) {
  if (isPureWait(step)) { console.log(`   - wait ${step.wait}ms`); if (!DRY) await sleep(step.wait); return; }
  if (step.say) { console.log(`   - ${step.say}`); return; }
  if (step.deeplink) { console.log(`   - deeplink ${step.deeplink}`); if (!DRY) await fireDeeplink(step.deeplink); return; }

  if (step.profile) {
    const wanted = PROFILE_OVERRIDE || step.profile;
    let p;
    try {
      p = resolve(list(await api('GET', '/api/profiles')), wanted, 'profile');
    } catch (e) {
      if (!PROFILE_OVERRIDE && step.profile === FIXTURE_NAME) {
        throw new Error(
          `${e.message}\n` +
          `     The recording fixture does not exist yet. Create it once:\n` +
          `        node scripts/record-take.mjs --setup-fixture\n` +
          `     Then scan it in BMM (Library > scan) so the example mods are picked up.\n` +
          `     Or record against one of your own profiles instead:\n` +
          `        node scripts/record-take.mjs ${name} --profile "<profile name>"\n` +
          `        The clip is then forced MASKED, so your real names never ship with it.`
        );
      }
      throw e;
    }
    console.log(`   - activate profile "${p.name}"${PROFILE_OVERRIDE ? '  [override]' : ''}`);
    if (!DRY) await api('POST', '/api/profiles/activate', { profile_id: p.id });
    return;
  }
  if (step.disableAll) {
    const mods = list(await api('GET', '/api/mods/active'));
    console.log(`   - disable ${mods.length} active mod(s)`);
    if (!DRY) for (const m of mods) await api('POST', '/api/mods/disable', { mod_id: m.id });
    return;
  }
  if (step.enableFirst) {
    const mods = list(await api('GET', '/api/mods')).slice(0, step.enableFirst);
    console.log(`   - enable the first ${mods.length} mod(s), ${step.every || 0}ms apart`);
    for (const m of mods) {
      console.log(`     · "${m.name}"`);
      if (!DRY) {
        await api('POST', '/api/mods/enable', { mod_id: m.id });
        if (step.every) await sleep(step.every);
      }
    }
    return;
  }
  if (step.enable || step.disable) {
    const m = resolve(list(await api('GET', '/api/mods')), step.enable || step.disable, 'mod');
    const on = !!step.enable;
    console.log(`   - ${on ? 'enable' : 'disable'} "${m.name}"`);
    if (!DRY) await api('POST', on ? '/api/mods/enable' : '/api/mods/disable', { mod_id: m.id });
    return;
  }
  if (step.modpack) {
    const mp = resolve(list(await api('GET', '/api/modpacks')), step.modpack, 'modpack');
    console.log(`   - modpack "${mp.name}" ${step.on ? 'on' : 'off'}`);
    if (!DRY) await api('POST', step.on ? '/api/modpacks/enable' : '/api/modpacks/disable', { modpack_id: mp.id });
    return;
  }
  console.log('   - (unknown step, skipped)', JSON.stringify(step));
}

/** Create the throwaway folders, the example mods, and the BMM profile pointing at them.
 *  Idempotent: run it as often as you like. */
async function setupFixture() {
  const dirs = { game: join(FIXTURE_ROOT, 'game'), mods: join(FIXTURE_ROOT, 'mods'), backup: join(FIXTURE_ROOT, 'backup') };
  console.log(`Fixture root: ${FIXTURE_ROOT}`);
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  // A game folder that already has one of the files, so enabling a mod visibly REPLACES
  // something and the original can be restored — which is what the conflicts clip shows.
  mkdirSync(join(dirs.game, 'Data', 'Textures'), { recursive: true });
  writeFileSync(join(dirs.game, 'Data', 'Textures', 'hero.dds'), 'original game texture\n');

  for (const [mod, files] of Object.entries(FIXTURE_MODS)) {
    for (const rel of files) {
      const p = join(dirs.mods, mod, ...rel.split('/'));
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, `${mod} :: ${rel}\n`);
    }
    console.log(`  - ${mod}  (${files.length} file(s))`);
  }

  const existing = list(await api('GET', '/api/profiles')).find((p) => p.name === FIXTURE_NAME);
  if (existing) {
    console.log(`\nProfile "${FIXTURE_NAME}" already exists — folders refreshed, profile left alone.`);
    return;
  }
  await api('POST', '/api/profiles', {
    name: FIXTURE_NAME,
    game_path: dirs.game,
    mods_path: dirs.mods,
    backup_path: dirs.backup,
    game_name: 'Recording fixture',
  });
  console.log(`\nCreated profile "${FIXTURE_NAME}". It is NOT activated — a scenario does that.`);
  console.log('Scan it once in BMM (Library > scan) so the example mods are picked up.');
}

/** Remove the profile and the temp folders. */
async function teardownFixture() {
  const p = list(await api('GET', '/api/profiles')).find((x) => x.name === FIXTURE_NAME);
  if (p) {
    // BMM refuses to delete the active profile, so step off it first.
    const other = list(await api('GET', '/api/profiles')).find((x) => x.id !== p.id);
    if (other) await api('POST', '/api/profiles/activate', { profile_id: other.id }).catch(() => {});
    await api('DELETE', `/api/profiles/${p.id}`);
    console.log(`Removed profile "${FIXTURE_NAME}".`);
  } else {
    console.log(`No profile named "${FIXTURE_NAME}".`);
  }
  try { rmSync(FIXTURE_ROOT, { recursive: true, force: true }); console.log(`Removed ${FIXTURE_ROOT}`); } catch { /* ignore */ }
}

const ask = (q) => new Promise((res) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a); });
});

// ── run ──────────────────────────────────────────────────────────────────────
(async () => {
  const h = await health();
  if (FIXTURE_CMD) {
    if (FIXTURE_CMD === 'setup') await setupFixture(); else await teardownFixture();
    return;
  }
  console.log(`\n${scn.title}`);
  console.log(`  page   : ${scn.page}`);
  if (FORCED_MASK) {
    console.log('  masking: MASKED - forced, because --profile points at a real profile.');
    console.log('           Names and paths record as bullets. Pass --force-unmasked only if you');
    console.log('           have checked what is on screen and are happy to publish it.');
  } else {
    console.log(`  masking: ${FULL ? 'UNMASKED (demo profile - no real data)' : 'MASKED (this clip demonstrates masking)'}`);
  }
  console.log(`  BMM    : ${BASE}${h && h.service ? ` (${h.service})` : ''}${DRY ? '   [DRY RUN - nothing will change]' : ''}\n`);

  if (DRY) {
    console.log('  NOTE   : in a dry run the profile is not really activated, so any step that');
    console.log('           resolves a mod list reads the CURRENTLY active profile. The names');
    console.log('           below are therefore indicative, not what a real take would touch.\n');
  }

  console.log('1. State');
  for (const s of scn.setup) {
    try { await runStep(s); } catch (e) { console.error(`   [x] ${e.message}`); process.exit(1); }
  }

  if (NO_REC) { console.log('\nState is set. --no-record, so the recorder was left alone.\n'); return; }

  console.log('\n2. Recorder');
  console.log(`   - on, ${FULL ? 'full (unmasked)' : 'masked'}`);
  if (!DRY) {
    await api('POST', '/api/recorder', { on: true, full: FULL, rust: true, js: true });
    await sleep(1200);   // let the first full snapshot land before anything moves
  }

  if (AUTO) {
    console.log('\n3. Driving (unattended)');
    for (const s of scn.drive) {
      try { await runStep(s); } catch (e) { console.error(`   [x] ${e.message}`); process.exit(1); }
      if (s.wait && !s.say) { /* a step may carry its own trailing pause */ }
    }
    if (DRY) { console.log('\n[DRY RUN] would export now.\n'); return; }
  } else {
    console.log('\n3. Your turn - perform this, then come back:');
    scn.perform.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
    console.log('\n   Move deliberately. A replay plays back at real speed, so hesitation reads as');
    console.log('   confusion. End on a settled screen, not mid-animation.');

    if (DRY) { console.log('\n[DRY RUN] would wait here, then export.\n'); return; }

    const a = await ask('\n   Press Enter to export, or type "x" to abort: ');
    if (norm(a) === 'x') {
      await api('POST', '/api/recorder', { on: false, full: false, rust: true, js: true });
      console.log('   Aborted. Recorder off, nothing exported.\n');
      return;
    }
  }

  console.log('\n4. Export');
  await api('POST', '/api/replay/export');
  await sleep(800);
  await api('POST', '/api/recorder', { on: false, full: false, rust: true, js: true });
  console.log('   - exported to the Replays folder, recorder off.');
  console.log(`   - rename it to ${scn.page.split('/').pop()}.bmmreplay and drop it into`);
  console.log('     "BMM Docs/docs/assets/replays/" - committed through git-lfs.');
  console.log('   - check it plays on the docs site before committing.\n');
})();
