// « Build a plugin with a mod list »: Plugins & API → Create, a template, the plugin's identity,
// three mods picked for its list (one optional), the permissions it asks for, and the plugin
// saved to this PC (the preview on the right follows each field).
import { world, until } from './world.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const buildPlugin = {
  name: 'build-plugin',
  title: { en: 'Build a plugin with a mod list', fr: 'Créer un plugin avec une liste de mods' },
  desc: {
    en: 'Plugins & API → Create: a plugin that ships a list of mods, its permissions, the live preview, and the plugin saved on this PC.',
    fr: 'Plugins & API → Créer : un plugin qui fournit une liste de mods, ses permissions, l’aperçu en direct et le plugin enregistré sur ce PC.',
  },
  topics: ['other/pluginsapi'],
  docs: ['features/plugins'],
  pageInit: [world],
  async setup(h) { await h.nav('plugins', 1800); },
  steps: [
    {
      id: 'template',
      title: { en: 'Start from a template', fr: 'Partir d’un modèle' },
      topics: ['other/pluginsapi'], docs: ['features/plugins'],
      async run(h) {
        await h.click('#view-plugins [data-tab="create"]', { pause: 1300 });
        await h.click('.pc-tpl[data-tpl="server"]', { pause: 1100 });
      },
    },
    {
      id: 'identity',
      title: { en: 'Name it', fr: 'Lui donner un nom' },
      topics: ['other/pluginsapi'], docs: ['features/plugins'],
      async run(h) {
        await h.type('#pc-name', 'Weekend Server Mods', { delay: 55 });
        await h.type('#pc-game', 'Northwind Saga', { delay: 55 });
        await h.type('#pc-desc', 'The mods our weekend server runs.', { delay: 40 });
        await wait(900);
      },
    },
    {
      id: 'mods',
      title: { en: 'Pick the mods it ships', fr: 'Choisir les mods qu’il fournit' },
      topics: ['other/pluginsapi'], docs: ['features/plugins'],
      async run(h) {
        await h.click('.pc-step[data-step="contents"]', { pause: 1300 });
        await until(h, () => document.querySelectorAll('#pc-available-mods .plug-mod-item').length > 2, { what: 'the mod list' });
        for (const i of [0, 1, 2]) await h.click(await h.nth('#pc-available-mods .plug-mod-add-btn', i), { pause: 700 });
        await wait(900);
      },
    },
    {
      id: 'permissions',
      title: { en: 'Choose what it may do', fr: 'Choisir ce qu’il peut faire' },
      topics: ['other/pluginsapi'], docs: ['features/plugins'],
      async run(h) {
        await h.click('.pc-step[data-step="perms"]', { pause: 1200 });
        for (const i of [0, 1]) await h.click(await h.nth('#pc-perms .pc-perm-cb', i), { pause: 600 });
        await h.move('#pc-pv-name', 700);
        await wait(1100);
      },
    },
    {
      id: 'save',
      title: { en: 'Save it on this PC', fr: 'L’enregistrer sur ce PC' },
      topics: ['other/pluginsapi'], docs: ['features/plugins'],
      async run(h) {
        await h.click('.pc-step[data-step="share"]', { pause: 1200 });
        await h.click('#pc-save-local', { pause: 1600 });
        await wait(1400);
      },
    },
  ],
};
