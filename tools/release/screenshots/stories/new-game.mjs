// « Set up a new game »: Northwind Saga from nothing. A profile for it, three mods from the
// archives just downloaded, switched on, the conflict they make settled, and the result in the
// game folder.
import { world, pick, stageArchive, until } from './world.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1048576;
const arc = (id, file, name, author, tags, bytes, packed, files, description) => ({
  id, file, match: file, name, author, tags, bytes, packed, description,
  files: files.map(([path, size]) => ({ path, size: Math.round(size * MB) })), copyMs: 900 + Math.min(1200, bytes / MB),
});
const ARCHIVES = [
  arc('nw-hd-textures', 'HD Texture Pack 3.2.0.zip', 'HD Texture Pack', 'Velkor', ['graphics', 'hd'], 1060 * MB, 820 * MB, [
    ['Data/textures/terrain/rock_01.dds', 180], ['Data/textures/terrain/rock_02.dds', 176], ['Data/textures/terrain/grass_01.dds', 240], ['Data/textures/terrain/snow_01.dds', 160],
    ['Data/textures/sky/clouds_01.dds', 96], ['Data/textures/sky/clouds_02.dds', 96], ['Data/textures/sky/sunset.dds', 64], ['Data/textures/water/ripple.dds', 48], ['Data/ui/hud.xml', 0.1],
  ], '4K textures for terrain, architecture and armour.'),
  arc('nw-weather', 'Dynamic Weather Overhaul-1.9.4.7z', 'Dynamic Weather Overhaul', 'Marrow', ['weather'], 369 * MB, 290 * MB, [
    ['Data/textures/sky/clouds_01.dds', 112], ['Data/textures/sky/clouds_02.dds', 112], ['Data/textures/sky/sunset.dds', 70], ['Data/textures/water/ripple.dds', 50],
    ['Data/lighting/sun.ini', 0.01], ['Data/sound/rain_loop.wav', 22], ['Data/sound/footsteps_rain.wav', 3],
  ], 'Storms, fog banks and seasonal snow with matching skies.'),
  arc('nw-patch', 'Unofficial Patch 4.0.1.zip', 'Unofficial Patch', 'Community', ['gameplay'], 6 * MB, 3 * MB, [
    ['Data/scripts/quests_fix.lua', 2], ['Data/dialogue/fixes.xml', 4],
  ], 'Over 900 fixes to quests, items and dialogue.'),
];

/** Add one archive through « Add a mod »: pick it, let the dialog read it, add. */
async function addArchive(h, a, { first = false } = {}) {
  await stageArchive(h, a);
  await h.click('#btn-add-mod', { pause: 900 });
  await pick(h, `D:\\Downloads\\${a.file}`);
  await h.click('#btn-pick-mod-archive', { pause: 1500 });
  await until(h, () => !!document.querySelector('#modal-add-mod .am-stats'), { what: 'the archive preview' });
  await wait(first ? 1600 : 900);
  await h.click('#btn-confirm-add-mod', { pause: 400 });
  await until(h, () => !document.getElementById('modal-add-mod')?.classList.contains('open'), { timeout: 10000, what: 'the copy to finish' });
  await wait(700);
}

export const newGame = {
  name: 'new-game',
  title: { en: 'Set up a new game', fr: 'Installer un nouveau jeu' },
  desc: {
    en: 'A profile for Northwind Saga, three mods added from their archives, switched on, the conflict they make settled, and the files in the game folder.',
    fr: 'Un profil pour Northwind Saga, trois mods ajoutés depuis leurs archives, activés, le conflit qu’ils créent réglé, et les fichiers dans le dossier du jeu.',
  },
  topics: ['basics/profiles', 'basics/scan', 'basics/activate', 'basics/conflicts'],
  docs: ['getting-started/first-launch', 'features/profiles', 'features/library', 'how-it-works/conflicts'],
  pageInit: world,
  pageInitArgs: { start: 'empty' },
  async setup(h) { await h.nav('profiles', 1500); },
  steps: [
    {
      id: 'create-profile',
      title: { en: 'Create a profile for the game', fr: 'Créer un profil pour le jeu' },
      topics: ['basics/profiles'], docs: ['features/profiles'],
      async run(h) {
        await h.click('#btn-new-profile', { pause: 900 });
        await h.type('#prof-name', 'Main playthrough', { delay: 60 });
        await h.type('#prof-game', 'Northwind Saga', { delay: 60 });
        await pick(h, 'D:\\Games\\Northwind Saga');
        await h.click('#btn-pick-game-path', { pause: 700 });
        await pick(h, 'D:\\Modding\\Northwind\\mods');
        await h.click('#btn-pick-mods-path', { pause: 1100 });
        await h.click('#btn-confirm-profile', { pause: 1600 });
        await until(h, () => window.__demo.profiles.some((p) => p.game_name === 'Northwind Saga'), { what: 'the profile to be created' });
        await until(h, () => !document.querySelector('#modal-new-profile.open'), { what: 'the dialog to close' });
        // The first profile ever gets a small celebration card: read it, then « Let's mod ».
        if (await h.eval(() => !!document.getElementById('fpc-go'))) {
          await wait(1400);
          await h.click('#fpc-go', { pause: 700 });
        }
        await wait(500);
      },
    },
    {
      id: 'add-mods',
      title: { en: 'Add mods from their archives', fr: 'Ajouter des mods depuis leurs archives' },
      topics: ['basics/scan'], docs: ['features/library'],
      async run(h) {
        await h.click('#nav-library', { pause: 1200 });
        await addArchive(h, ARCHIVES[0], { first: true });
        await addArchive(h, ARCHIVES[2]);
      },
    },
    {
      id: 'enable',
      title: { en: 'Switch them on', fr: 'Les activer' },
      topics: ['basics/activate'], docs: ['features/library', 'how-it-works/profiles-activation'],
      async run(h) {
        for (const id of ['nw-hd-textures', 'nw-patch']) {
          await h.click(`.mod-card[data-id="${id}"] .mod-toggle`, { pause: 500 });
          await until(h, (x) => window.__demo.profiles.find((p) => p.id === window.__demo.active)?.active_mods.includes(x), { timeout: 10000, what: `${id} to be enabled` }, id);
          await wait(900);
        }
      },
    },
    {
      id: 'conflict-warning',
      title: { en: 'One more: BMM sees the conflict coming', fr: 'Un de plus : BMM voit venir le conflit' },
      topics: ['basics/scan', 'basics/conflicts'], docs: ['features/library', 'how-it-works/conflicts'],
      async run(h) {
        await addArchive(h, ARCHIVES[1], { first: true });
        await h.click('.mod-card[data-id="nw-weather"] .mod-toggle', { pause: 500 });
        await until(h, () => window.__demo.profiles.find((p) => p.id === window.__demo.active)?.active_mods.includes('nw-weather'), { timeout: 10000, what: 'the weather mod to be enabled' });
        await wait(1200);
      },
    },
    {
      id: 'resolve',
      title: { en: 'Choose who wins the shared files', fr: 'Choisir qui gagne les fichiers partagés' },
      topics: ['basics/conflicts'], docs: ['how-it-works/conflicts', 'features/library'],
      async run(h) {
        await h.click('.mod-card[data-id="nw-hd-textures"] .tag-intra-conflict', { pause: 1500 });
        await h.click(await h.byText('.cv-modal [data-cv="win"]', /HD Texture Pack/), { pause: 1400 });
        await h.click('.cv-modal [data-cv="moves"]', { pause: 1800 });
        await h.click('.cv-modal [data-cv="apply"]', { pause: 2000 });
      },
    },
    {
      id: 'verify',
      title: { en: 'Check the game folder', fr: 'Vérifier le dossier du jeu' },
      topics: ['basics/integrity'], docs: ['features/library', 'how-it-works/integrity-hashing'],
      async run(h) {
        await h.click('#modal-conflicts-view .modal-close', { pause: 900 });
        await h.click('#btn-verify-integrity', { pause: 600 });
        await until(h, () => !!document.querySelector('.modal-overlay.open .integrity-report, #modal-integrity.open, .modal-overlay.open [class*="integrity"]'), { timeout: 8000, what: 'the integrity report' });
        await wait(2600);
      },
    },
    {
      id: 'in-the-game-folder',
      title: { en: 'What happened in the game folder', fr: 'Ce qui s’est passé dans le dossier du jeu' },
      topics: ['basics/activate', 'basics/conflicts'], docs: ['how-it-works/profiles-activation', 'how-it-works/conflicts'],
      explainer: 'activation.html',
    },
  ],
};
