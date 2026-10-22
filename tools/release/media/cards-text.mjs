// Release card text (pure). The version always comes from the argument, never from a literal,
// so every card says the version being released.
//
// Per-release wording lives in tools/release/media/cards.<version>.json (or
// Release/<version>/media/cards.json):
//   { "shots": { "social": "notifications", "discord": "conflicts", "blog": ["library", "conflicts"], "square": … },
//     "en": { headline, subline, whatsNew, highlights: [{ icon, title, shot, crop }] },
//     "fr": { … } }
// The rules the owner set (2026-10): one headline of six words at most (a \n is kept as a line
// break), one subline of twelve words at most, three highlights of five words at most; written
// for players and modders, benefit first, no internal names. icon: a Lucide name
// (frontend/assets/icons/lucide.json). shot / crop: the screenshot (a shoot.mjs scene) and the
// part of it [x, y, w, h] (canvas px, 1640×1040) the « what's new » tile shows.
// Older files ({ sub, chips[], features[[t, d]] }) still read: sub becomes the subline,
// features the highlights. Without a file, a neutral text is used and the step warns.

export const FOOT = 'github.com/FreeProject089/BetterModsManager';
export const LIMITS = { headline: 6, subline: 12, highlight: 5, highlights: 3 };

const DEFAULTS = {
  en: {
    headline: 'Every game setup, one manager.',
    subline: 'Profiles, a mod library, modpacks and repos, in one Windows app.',
    whatsNew: (v) => `What's new in ${v}`,
    highlights: [
      { icon: 'user', title: 'A profile per setup' },
      { icon: 'package', title: 'Share a whole modpack' },
      { icon: 'server', title: 'Sync mods from a server' },
    ],
  },
  fr: {
    headline: 'Chaque config, un seul gestionnaire.',
    subline: 'Profils, bibliothèque de mods, modpacks et dépôts, dans une appli Windows.',
    whatsNew: (v) => `Les nouveautés de la ${v}`,
    highlights: [
      { icon: 'user', title: 'Un profil par config' },
      { icon: 'package', title: 'Partage un modpack entier' },
      { icon: 'server', title: 'Synchronise depuis un serveur' },
    ],
  },
};

/** The screenshot each format shows when the cards file names none (shoot.mjs scene names). */
export const DEFAULT_SHOTS = { social: 'library', discord: 'library', blog: ['library', 'repo-host'], square: 'library' };

const ICONS = ['bell', 'git-merge', 'history', 'wrench'];

/** highlights, or the features [[title, desc]] of an older file, or null. */
function highlightsOf(c) {
  if (Array.isArray(c?.highlights) && c.highlights.length) {
    return c.highlights.map((h, i) => ({ icon: h.icon || ICONS[i % ICONS.length], title: String(h.title ?? ''), shot: h.shot ?? null, crop: Array.isArray(h.crop) ? h.crop : null }));
  }
  if (Array.isArray(c?.features) && c.features.length) {
    return c.features.map(([title], i) => ({ icon: ICONS[i % ICONS.length], title, shot: null, crop: null }));
  }
  return null;
}

/**
 * The text of every card for `version` in `lang`, merged over the defaults.
 * custom = parsed cards JSON (or null). Returns { headline, subline, whatsNew, highlights
 * (three at most), shots, foot, version, generic }.
 */
export function cardText(version, lang, custom = null) {
  const d = DEFAULTS[lang] ?? DEFAULTS.en;
  const c = custom?.[lang] ?? null;
  return {
    version,
    headline: c?.headline ?? d.headline,
    subline: c?.subline ?? c?.sub ?? d.subline,
    whatsNew: typeof c?.whatsNew === 'string' ? c.whatsNew.replaceAll('{version}', version) : d.whatsNew(version),
    highlights: (highlightsOf(c) ?? d.highlights).slice(0, LIMITS.highlights),
    shots: { ...DEFAULT_SHOTS, ...(custom?.shots || {}) },
    foot: FOOT,
    generic: !c,
  };
}

const words = (s) => String(s).split(/[\s  ]+/).filter((w) => w && !/^[:;?!«»·—–-]+$/.test(w)).length;
/** The texts that break the owner's word limits: [« en headline: 7 words (6 at most) », …]. */
export function textProblems(custom) {
  const out = [];
  for (const lang of ['en', 'fr']) {
    const c = custom?.[lang];
    if (!c) continue;
    if (words(c.headline ?? '') > LIMITS.headline) out.push(`${lang} headline: ${words(c.headline)} words (${LIMITS.headline} at most)`);
    if (words(c.subline ?? '') > LIMITS.subline) out.push(`${lang} subline: ${words(c.subline)} words (${LIMITS.subline} at most)`);
    const hl = c.highlights || [];
    if (hl.length > LIMITS.highlights) out.push(`${lang}: ${hl.length} highlights (${LIMITS.highlights} at most)`);
    for (const h of hl) if (words(h.title) > LIMITS.highlight) out.push(`${lang} highlight « ${h.title} »: ${words(h.title)} words (${LIMITS.highlight} at most)`);
  }
  return out;
}

/** The two variants of every card: with Tasky placed in the composition, and without. */
export const VARIANTS = ['tasky', 'plain'];

/** File name of a card: bmm-<v>-<format>-<variant>[.fr] (no extension). */
export const cardFile = (spec, variant) => `${spec.base}-${variant}${spec.lang === 'fr' ? '.fr' : ''}`;

/**
 * Card list (base name, size, layout, language, safe zone) for a version. Names carry the
 * version. safe = the rectangle every text (and Tasky) stays inside: what each platform keeps
 * visible (X and Mastodon cut 1.91:1 from the centre, Discord rounds the corners, Instagram's
 * 3:4 grid shows the middle 810 px of a square, a blog header shared as a link is cut to 1.91:1).
 */
export function cardSpecs(version) {
  const both = (base) => [{ ...base, lang: 'en' }, { ...base, lang: 'fr' }];
  return [
    ...both({ base: `bmm-${version}-social-1200x630`, w: 1200, h: 630, layout: 'social', safe: { x: 64, y: 56, w: 1072, h: 518 } }),
    ...both({ base: `bmm-${version}-discord-960x540`, w: 960, h: 540, layout: 'discord', safe: { x: 52, y: 48, w: 856, h: 444 } }),
    ...both({ base: `bmm-${version}-blog-header-1600x600`, w: 1600, h: 600, layout: 'blog', safe: { x: 240, y: 64, w: 1120, h: 472 } }),
    ...both({ base: `bmm-${version}-square-1080`, w: 1080, h: 1080, layout: 'square', safe: { x: 135, y: 96, w: 810, h: 888 } }),
    ...both({ base: `bmm-${version}-whats-new-1200x675`, w: 1200, h: 675, layout: 'whatsnew', safe: { x: 56, y: 48, w: 1088, h: 579 } }),
  ];
}
