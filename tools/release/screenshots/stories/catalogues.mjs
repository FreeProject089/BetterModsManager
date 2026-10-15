// « Find apps and content in the catalogues »: the App Catalog browsed and searched, an app's
// details opened, the sources it comes from, and a catalogue of your own made in the Create tab
// (name it, add an entry, check it). Demo data only (fixtures.mjs fetch_app_catalogs).
import { world, until } from './world.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const catalogues = {
  name: 'catalogues',
  title: { en: 'Find apps and content in the catalogues', fr: 'Trouver des applis et du contenu dans les catalogues' },
  desc: {
    en: 'The App Catalog: browse and search, an app’s details, where the list comes from, and a catalogue of your own built in the Create tab.',
    fr: 'L’App Catalog : parcourir et chercher, les détails d’une appli, d’où vient la liste, et son propre catalogue construit dans l’onglet Créer.',
  },
  topics: ['other/appcatalog', 'other/updates'],
  docs: ['features/apps'],
  pageInit: [world],
  async setup(h) { await h.nav('apps', 1800); },
  steps: [
    {
      id: 'browse',
      title: { en: 'Browse and search the catalogue', fr: 'Parcourir et chercher dans le catalogue' },
      topics: ['other/appcatalog'], docs: ['features/apps'],
      async run(h) {
        await wait(900);
        await h.click('#apps-search', { pause: 300 });
        await h.type(null, 'texture', { delay: 120 });
        await wait(1400);
        await h.combo('Control', 'a', 120);
        await h.key('Backspace', 900);
      },
    },
    {
      id: 'details',
      title: { en: 'Open an app’s details', fr: 'Ouvrir les détails d’une appli' },
      topics: ['other/appcatalog'], docs: ['features/apps'],
      async run(h) {
        await h.click('[data-app-id="texture-optimizer"]', { pause: 1200 });
        await until(h, () => !!document.querySelector('#apps-detail-modal.open'), { what: 'the details' });
        await wait(1800);
        await h.scroll('#apps-modal-body', 260, 900);
        await wait(1200);
        await h.click('#apps-modal-close-btn', { pause: 900 });
      },
    },
    {
      id: 'sources',
      title: { en: 'See where the list comes from', fr: 'Voir d’où vient la liste' },
      topics: ['other/appcatalog'], docs: ['features/apps'],
      async run(h) {
        await h.click('#apps-tab-sources', { pause: 1500 });
        await wait(1800);
      },
    },
    {
      id: 'create',
      title: { en: 'Make a catalogue of your own', fr: 'Créer son propre catalogue' },
      topics: ['other/appcatalog'], docs: ['features/apps'],
      async run(h) {
        await h.click('#apps-tab-create', { pause: 1400 });
        await h.type('#cr-name', 'Northwind Tools', { delay: 70 });
        await h.type('#cr-desc', 'Small helpers for Northwind Saga.', { delay: 45 });
        await wait(700);
        await h.click('[data-cr-step="entries"]', { pause: 1100 });
        await h.click('#cr-add-app', { pause: 1100 });
        await h.type('#cr-id', 'save-keeper', { delay: 60 });
        await h.type('#cr-title', 'Save Keeper', { delay: 60 });
        await h.type('#cr-description', 'Snapshots your saves before a session.', { delay: 35 });
        await h.type('#cr-dl-url', 'https://example.org/save-keeper.zip', { delay: 28 });
        await wait(1500);
        await h.click('#cr-app-save', { pause: 1300 });
        await h.click('[data-cr-step="check"]', { pause: 1800 });
      },
    },
  ],
};
