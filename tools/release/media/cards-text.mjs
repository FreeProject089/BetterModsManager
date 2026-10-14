// Release card text (pure). The version always comes from the argument, never from a literal,
// so every card says the version being released.
//
// Per-release wording lives in tools/release/media/cards.<version>.json (or
// Release/<version>/media/cards.json): { "en": { sub, chips[], whatsNew?, features[[t, d]] }, "fr": {…} }.
// Without one, a neutral text is used and the step warns that the cards say nothing specific.

export const FOOT = 'github.com/FreeProject089/BetterModsManager';

const DEFAULTS = {
  en: { kicker: 'Better Mods Manager', sub: 'Windows · Free and open source', chips: ['Profiles', 'Mod library', 'Modpacks', 'Server Repo'],
    whatsNew: (v) => `What's new in ${v}`,
    features: [['Profiles', 'One mod set per game setup'], ['Mod library', 'Enable, disable, tag, search'], ['Modpacks', 'Share a whole setup in one file'],
      ['Server Repo', 'Sync and host mod repositories'], ['Signed updates', 'Checked before they install'], ['Open source', 'GPL-3.0, on GitHub']] },
  fr: { kicker: 'Better Mods Manager', sub: 'Windows · Gratuit et libre', chips: ['Profils', 'Bibliothèque de mods', 'Modpacks', 'Server Repo'],
    whatsNew: (v) => `Les nouveautés de la ${v}`,
    features: [['Profils', 'Un jeu de mods par configuration'], ['Bibliothèque', 'Activer, désactiver, étiqueter, chercher'], ['Modpacks', 'Partager une configuration en un fichier'],
      ['Server Repo', 'Synchroniser et héberger des dépôts'], ['Mises à jour signées', 'Vérifiées avant installation'], ['Libre', 'GPL-3.0, sur GitHub']] },
};

/**
 * The text of every card for `version` in `lang`, merged over the defaults.
 * custom = parsed cards JSON (or null). Returns { kicker, sub, chips, whatsNew, features, foot, version, generic }.
 */
export function cardText(version, lang, custom = null) {
  const d = DEFAULTS[lang] ?? DEFAULTS.en;
  const c = custom?.[lang] ?? null;
  return {
    version,
    kicker: c?.kicker ?? d.kicker,
    sub: c?.sub ?? d.sub,
    chips: Array.isArray(c?.chips) && c.chips.length ? c.chips : d.chips,
    whatsNew: typeof c?.whatsNew === 'string' ? c.whatsNew.replaceAll('{version}', version) : d.whatsNew(version),
    features: Array.isArray(c?.features) && c.features.length ? c.features.slice(0, 6) : d.features,
    foot: FOOT,
    generic: !c,
  };
}

/** Card list (name, size, layout, language) for a version. Names carry the version. */
export function cardSpecs(version) {
  return [
    { name: `bmm-${version}-social-1200x630`, w: 1200, h: 630, layout: 'wide', lang: 'en', s: { tile: 1, left: 0.075, text: 1 } },
    { name: `bmm-${version}-social-1200x630.fr`, w: 1200, h: 630, layout: 'wide', lang: 'fr', s: { tile: 1, left: 0.075, text: 1 } },
    { name: `bmm-${version}-discord-960x540`, w: 960, h: 540, layout: 'wide', lang: 'en', s: { tile: 1, left: 0.07, text: 0.98 } },
    { name: `bmm-${version}-blog-header-1600x600`, w: 1600, h: 600, layout: 'wide', lang: 'en', s: { tile: 1.05, left: 0.12, text: 1 } },
    { name: `bmm-${version}-square-1080`, w: 1080, h: 1080, layout: 'square', lang: 'en' },
    { name: `bmm-${version}-square-1080.fr`, w: 1080, h: 1080, layout: 'square', lang: 'fr' },
    { name: `bmm-${version}-whats-new-1200x675`, w: 1200, h: 675, layout: 'features', lang: 'en' },
    { name: `bmm-${version}-whats-new-1200x675.fr`, w: 1200, h: 675, layout: 'features', lang: 'fr' },
  ];
}

/** Chip widths (estimated from the text) and how many fit in maxW. */
export function fitChips(list, fs, maxW) {
  const pad = fs * 0.9, gap = fs * 0.55;
  let ws = list.map((c) => c.length * fs * 0.56 + pad * 2);
  let items = list;
  const total = (w) => w.reduce((a, b) => a + b, 0) + gap * (w.length - 1);
  while (total(ws) > maxW && items.length > 1) { items = items.slice(0, -1); ws = ws.slice(0, -1); }
  return { items, widths: ws, total: total(ws), gap, h: fs * 2.1 };
}
