#!/usr/bin/env node
// record-take — puts BMM into a known state for a documentation recording, arms the session
// recorder, waits while YOU perform the interaction, then exports the .bmmreplay.
//
// Why it stops and waits instead of scripting the clicks too: rrweb records real pointer and
// input events. An action triggered through the API produces none, so a fully scripted take
// plays back with the interface changing and no cursor anywhere — which reads as a glitch, not
// a tutorial. So this automates the tedious half (arranging identical state before every take,
// and resetting between them) and leaves the half that has to look human to a human.
//
//   node scripts/record-take.mjs --list
//   node scripts/record-take.mjs themes
//   node scripts/record-take.mjs themes --dry-run     # print the plan, touch nothing
//   node scripts/record-take.mjs themes --no-record   # just set the state up
//
// Requires BMM to be running. See Update/Guides/Other/Recording_Plan_*.md for what each clip
// has to show.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

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
      { profile: 'demo' },
      { deeplink: 'bmm://theme/apply?id=default' },
      { wait: 800 },
    ],
    perform: [
      'Open Settings → Appearance and apply two built-in themes, pausing on each.',
      'Open the theme editor and change ONE colour token so the live re-render is visible.',
      'Close the editor. End on a settled screen.',
    ],
  },

  'command-palette': {
    title: 'Command palette & shortcuts',
    page: 'features/command-palette',
    full: true,
    setup: [{ profile: 'demo' }, { deeplink: 'bmm://docs/open' }, { wait: 600 }],
    perform: [
      'Press Ctrl+K, type a few letters, arrow down, Enter — land on a screen.',
      'Ctrl+K again, switch to semantic mode, search a word BMM does not use (e.g. "delete").',
      'Open Settings → Keyboard shortcuts and rebind one row.',
    ],
  },

  conflicts: {
    title: 'Conflicts — who wins, and what comes back',
    page: 'how-it-works/conflicts',
    full: true,
    setup: [{ profile: 'demo' }, { disableAll: true }, { wait: 500 }],
    perform: [
      'Enable mod A, then mod B — the two that share a file.',
      'Open the conflict view and show the overlapping file.',
      'Disable B and show A’s file coming BACK. That restore is the point of the clip.',
    ],
  },

  profiles: {
    title: 'Profiles — switching moves no files',
    page: 'features/profiles',
    full: true,
    setup: [{ profile: 'demo' }, { disableAll: true }, { wait: 500 }],
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
    setup: [{ profile: 'demo' }, { deeplink: 'bmm://docs/open?article=storage-manager' }, { wait: 600 }],
    perform: [
      'Open the Storage Manager. Show Smart I/O and run Auto-Calibration once.',
      'Apply a per-disk MB/s cap, then show free space per profile.',
    ],
  },

  'privacy-masked': {
    title: 'The masking demo (bmm-demo.bmmreplay)',
    page: 'features/privacy-telemetry',
    full: false,                      // MASKED on purpose — masking is what it demonstrates
    setup: [{ profile: 'demo' }, { wait: 500 }],
    perform: [
      'A short general tour: Library, a profile switch, a settings page.',
      'Names must be visibly ••••  — that is the whole point of this clip.',
    ],
  },
};

// ── plumbing ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const name = args.find((a) => !a.startsWith('-'));
const DRY = has('--dry-run');
const NO_REC = has('--no-record');

if (has('--list') || !name) {
  console.log('Scenarios:\n');
  for (const [k, s] of Object.entries(SCENARIOS)) {
    console.log(`  ${k.padEnd(18)} ${s.title}`);
    console.log(`  ${''.padEnd(18)} → ${s.page}   ${s.full ? 'unmasked' : 'MASKED'}`);
  }
  console.log('\n  node scripts/record-take.mjs <scenario> [--dry-run] [--no-record]');
  process.exit(name ? 1 : 0);
}
const scn = SCENARIOS[name];
if (!scn) { console.error(`Unknown scenario "${name}". Try --list.`); process.exit(1); }

const DATA = join(process.env.APPDATA || '', 'com.bettermm.desktop', 'data.json');
function readSettings() {
  if (!existsSync(DATA)) throw new Error(`data.json not found at ${DATA}`);
  const d = JSON.parse(readFileSync(DATA, 'utf8'));
  return d.settings || {};
}
// The token is read straight from data.json so it never has to be pasted anywhere — and it is
// never printed, not even in --dry-run.
let TOKEN = '', PORT = 51274;
try {
  const s = readSettings();
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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function health() {
  try {
    const h = await api('GET', '/api/health');
    return h;
  } catch {
    console.error(
      `\n✗ Nothing answered on ${BASE}.\n` +
      `  • Is BMM running?\n` +
      `  • If it is: the port may have been taken when it started — BMM does NOT fall back to\n` +
      `    another port, it disables the API for the whole session and logs a line. Restart BMM.\n`
    );
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().trim();

/** Resolve a human name to an id, refusing to guess when it is ambiguous. */
function resolve(list, wanted, label) {
  const w = norm(wanted);
  const exact = list.filter((x) => norm(x.name) === w || x.id === wanted);
  const pick = exact.length ? exact : list.filter((x) => norm(x.name).includes(w));
  if (pick.length === 1) return pick[0];
  if (!pick.length) {
    throw new Error(`no ${label} matches "${wanted}". Available: ${list.map((x) => x.name).join(', ')}`);
  }
  throw new Error(`"${wanted}" matches ${pick.length} ${label}s: ${pick.map((x) => x.name).join(', ')} — be more specific`);
}

function fireDeeplink(url) {
  // Deeplinks go through the OS, which is what makes them work identically to a user clicking
  // one on a web page.
  return new Promise((res) => {
    const p = spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true });
    p.on('close', () => res());
    p.on('error', () => res());
  });
}

async function runStep(step) {
  if (step.wait) { console.log(`   · wait ${step.wait}ms`); if (!DRY) await sleep(step.wait); return; }
  if (step.say) { console.log(`   · ${step.say}`); return; }
  if (step.deeplink) { console.log(`   · deeplink ${step.deeplink}`); if (!DRY) await fireDeeplink(step.deeplink); return; }

  if (step.profile) {
    const profiles = await api('GET', '/api/profiles');
    const p = resolve(profiles.profiles || profiles, step.profile, 'profile');
    console.log(`   · activate profile "${p.name}"`);
    if (!DRY) await api('POST', '/api/profiles/activate', { profile_id: p.id });
    return;
  }
  if (step.disableAll) {
    const active = await api('GET', '/api/mods/active');
    const mods = active.mods || active;
    console.log(`   · disable ${mods.length} active mod(s)`);
    if (!DRY) for (const m of mods) await api('POST', '/api/mods/disable', { mod_id: m.id });
    return;
  }
  if (step.enable || step.disable) {
    const all = await api('GET', '/api/mods');
    const m = resolve(all.mods || all, step.enable || step.disable, 'mod');
    const on = !!step.enable;
    console.log(`   · ${on ? 'enable' : 'disable'} "${m.name}"`);
    if (!DRY) await api('POST', on ? '/api/mods/enable' : '/api/mods/disable', { mod_id: m.id });
    return;
  }
  if (step.modpack) {
    const packs = await api('GET', '/api/modpacks');
    const mp = resolve(packs.modpacks || packs, step.modpack, 'modpack');
    console.log(`   · modpack "${mp.name}" ${step.on ? 'on' : 'off'}`);
    if (!DRY) await api('POST', step.on ? '/api/modpacks/enable' : '/api/modpacks/disable', { modpack_id: mp.id });
    return;
  }
  console.log('   · (unknown step, skipped)', JSON.stringify(step));
}

const ask = (q) => new Promise((res) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a); });
});

// ── run ──────────────────────────────────────────────────────────────────────
(async () => {
  const h = await health();
  console.log(`\n${scn.title}`);
  console.log(`  page   : ${scn.page}`);
  console.log(`  masking: ${scn.full ? 'UNMASKED (demo profile — no real data)' : 'MASKED (this clip demonstrates masking)'}`);
  console.log(`  BMM    : ${BASE} ${h?.service ? `(${h.service})` : ''}${DRY ? '   [DRY RUN — nothing will change]' : ''}\n`);

  console.log('1. State');
  for (const s of scn.setup) {
    try { await runStep(s); } catch (e) { console.error(`   ✗ ${e.message}`); process.exit(1); }
  }

  if (NO_REC) { console.log('\nState is set. --no-record, so the recorder was left alone.\n'); return; }

  console.log('\n2. Recorder');
  console.log(`   · on, ${scn.full ? 'full (unmasked)' : 'masked'}`);
  if (!DRY) {
    await api('POST', '/api/recorder', { on: true, full: !!scn.full, rust: true, js: true });
    await sleep(1200);   // let the first full snapshot land before anything moves
  }

  console.log('\n3. Your turn — perform this, then come back:');
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

  console.log('\n4. Export');
  await api('POST', '/api/replay/export');
  await sleep(800);
  await api('POST', '/api/recorder', { on: false, full: false, rust: true, js: true });
  console.log('   · exported to the Replays folder, recorder off.');
  console.log(`   · rename it to ${scn.page.split('/').pop()}.bmmreplay and drop it into`);
  console.log('     "BMM Docs/docs/assets/replays/" — committed through git-lfs.');
  console.log('   · check it plays on the docs site before committing.\n');
})();
