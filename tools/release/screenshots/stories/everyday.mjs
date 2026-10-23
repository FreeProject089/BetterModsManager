// « Everyday shortcuts »: the small things that save time. The command palette finds a mod and
// runs a command, BMM Tools measures the disk, a launch pack starts the game with its tools, and
// the docs answer a question without leaving the app.
import { world, pick, until } from './world.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The commands this story needs beyond the world: disk usage, launch packs. */
function extras() {
  const st = window.__demo;
  const MB = st.MB;
  st.packs = st.packs || [];
  Object.assign(window.__gifMock, {
    tools_disk_usage: () => {
      const profiles = st.profiles.map((p) => {
        const mods = st.mods.filter((m) => m.mod_folder_path.toLowerCase().startsWith(p.mods_path.toLowerCase() + '\\'))
          .map((m) => ({ id: m.id, name: m.name, path: m.mod_folder_path, bytes: m.size_bytes || 0 })).sort((a, b) => b.bytes - a.bytes);
        const tot = mods.reduce((s, x) => s + x.bytes, 0);
        return { id: p.id, name: p.name, mods_path: p.mods_path, mods_bytes: tot, backup_path: p.backup_path, backup_bytes: Math.round(tot * 0.12), mods };
      });
      const app = [{ id: 'cache', name: 'cache', path: '', bytes: 214 * MB }, { id: 'backups', name: 'backups', path: '', bytes: 61 * MB }, { id: 'logs', name: 'logs', path: '', bytes: 9 * MB }];
      const total = profiles.reduce((s, p) => s + p.mods_bytes + p.backup_bytes, 0) + app.reduce((s, a) => s + a.bytes, 0);
      return new Promise((ok) => setTimeout(() => ok({ profiles, app_data_path: 'C:\\Users\\Demo\\AppData\\Roaming\\BetterModManager', app_data: app, total_bytes: total, cancelled: false }), 1400));
    },
    get_launch_packs: () => st.packs.map((p) => ({ ...p })),
    create_launch_pack: (a) => {
      const id = `lp-${st.nextId++}`;
      st.packs.push({ id, name: a.name, executable_paths: a.exePaths.slice(), icon_path: null, created_at: new Date().toISOString() });
      return new Promise((ok) => setTimeout(() => ok({ id }), 500));
    },
    run_launch_pack: () => new Promise((ok) => setTimeout(() => ok(null), 600)),
  });
}

/** Ctrl+K, type, wait for the list, run the first match of `re` (or the first row). */
async function palette(h, text, re = null) {
  await h.combo('Control', 'k', 800);
  await h.type(null, text, { delay: 105 });
  await wait(1100);
  if (re) await h.click(await h.byText('.cmdp-item, .cp-item, [role="option"]', re), { pause: 1500 });
  else await h.key('Enter', 1500);
}

export const everyday = {
  name: 'everyday',
  title: { en: 'Everyday shortcuts', fr: 'Les raccourcis du quotidien' },
  desc: {
    en: 'The command palette finds a mod and runs a command, BMM Tools measures the disk, a launch pack starts the game with its tools, and the docs answer a question without leaving the app.',
    fr: 'La palette de commandes trouve un mod et lance une commande, BMM Tools mesure le disque, un launch pack démarre le jeu avec ses outils, et la doc répond sans quitter l’app.',
  },
  topics: ['other/palette', 'other/storage', 'other/launchpack'],
  docs: ['features/command-palette', 'features/tools', 'features/launch-packs'],
  pageInit: [world, extras],
  async setup(h) {
    await h.nav('library', 1500);
    await h.page.browserContext().overridePermissions(new URL(h.page.url()).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  },
  steps: [
    {
      id: 'palette',
      title: { en: 'Ctrl+K: find a mod, run a command', fr: 'Ctrl+K : trouver un mod, lancer une commande' },
      topics: ['other/palette'], docs: ['features/command-palette'],
      async run(h) {
        await palette(h, 'weather');
        await wait(1200);
        await palette(h, 'verify');
        await until(h, () => !!document.querySelector('#modal-integrity.open'), { timeout: 8000, what: 'the integrity report' });
        await wait(1800);
        await h.click('#modal-integrity .modal-close, #modal-integrity [data-close]', { pause: 700 });
      },
    },
    {
      id: 'tools',
      title: { en: 'BMM Tools: where the disk space went', fr: 'BMM Tools : où est passé l’espace disque' },
      topics: ['other/storage'], docs: ['features/tools'],
      async run(h) {
        await palette(h, 'tools');
        await h.type('#tools-search', 'disk', { delay: 110 });
        await wait(600);
        await h.click('.tools-rail-item[data-tool="disk"]', { pause: 800 });
        await h.click('.tools-pane [data-act="run"]', { pause: 2600 });
        await h.scroll('.tools-pane', 260, 900);
        await wait(1400);
        await h.key('Escape', 800);
      },
    },
    {
      id: 'launch-pack',
      title: { en: 'A launch pack: the game and its tools in one click', fr: 'Un launch pack : le jeu et ses outils en un clic' },
      topics: ['other/launchpack'], docs: ['features/launch-packs'],
      async run(h) {
        await h.click('#nav-settings', { pause: 1400 });
        await h.eval(() => document.getElementById('settings-launchpack-section')?.scrollIntoView({ block: 'center' }));
        await wait(800);
        await h.click('#btn-create-launchpack', { pause: 900 });
        await h.type('#lp-input-name', 'Northwind evening', { delay: 70 });
        await pick(h, 'D:\\Games\\Northwind Saga\\Northwind.exe');
        await h.click('#lp-btn-add-exe', { pause: 800 });
        await pick(h, 'C:\\Users\\Demo\\Apps\\save-keeper\\SaveKeeper.exe');
        await h.click('#lp-btn-add-exe', { pause: 800 });
        await pick(h, 'C:\\Program Files\\Frame Monitor\\FrameMonitor.exe');
        await h.click('#lp-btn-add-exe', { pause: 1200 });
        await h.click('#lp-btn-confirm', { pause: 1200 });
        await until(h, () => !!document.querySelector('#launchpack-list-container .btn-run-lp'), { what: 'the new launch pack' });
        await h.click('#launchpack-list-container .btn-run-lp', { pause: 1800 });
      },
    },
    {
      id: 'docs',
      title: { en: 'The answer is in the app', fr: 'La réponse est dans l’app' },
      topics: [], docs: ['index'],
      async run(h) {
        await h.click('#nav-docs', { pause: 1600 });
        await palette(h, 'conflicts', /Conflicts/);
        await wait(1200);
        await h.scroll('#view-docs', 520, 1600);
        await wait(1600);
      },
    },
  ],
};
