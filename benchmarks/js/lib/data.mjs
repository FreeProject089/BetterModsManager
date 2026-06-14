// Deterministic synthetic data mirroring BMM's runtime shapes: mods, user tags,
// and an i18n dictionary. Seeded so every run benchmarks identical inputs.

// Tiny seeded PRNG (mulberry32) — reproducible across machines/Node versions.
export function rng(seed = 1234) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['Aircraft', 'Cockpit', 'Texture', 'Carrier', 'Weapon', 'Sound', 'Skin',
  'Livery', 'Terrain', 'Campaign', 'Mission', 'Engine', 'Radar', 'Nav', 'HUD',
  'Civil', 'Military', 'Helicopter', 'Tanker', 'Bomber', 'Fighter', 'Trainer'];

function word(r) { return WORDS[Math.floor(r() * WORDS.length)]; }

/** Generate `n` user tags (id + name + colors). */
export function makeTags(n, seed = 7) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `tag-${i}`,
    name: `${word(r)} ${word(r)}`,
    color_bg: '#222',
    color_text: '#fff',
  }));
}

/** Generate `n` mods, each referencing a few tag ids, mirroring S.allMods. */
export function makeMods(n, tags, seed = 42) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const tagCount = Math.floor(r() * 4);
    const modTags = Array.from({ length: tagCount }, () => tags[Math.floor(r() * tags.length)].id);
    return {
      id: `mod-${i}`,
      name: `${word(r)} ${word(r)} Mod ${i}`,
      enabled: r() > 0.5,
      activation_order: Math.floor(r() * n),
      tags: modTags,
    };
  });
}

/** A realistic i18n dictionary: some keys have {param} placeholders. */
export function makeDict(n = 600, seed = 99) {
  const r = rng(seed);
  const dict = {};
  for (let i = 0; i < n; i++) {
    const params = Math.floor(r() * 3); // 0..2 placeholders
    let s = `${word(r)} ${word(r)} ${word(r)}`;
    for (let p = 0; p < params; p++) s += ` {p${p}}`;
    dict[`key.section${i % 20}.item${i}`] = s;
  }
  return dict;
}
