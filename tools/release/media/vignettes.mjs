// « What's new » tile vignettes: a feature shown by REAL pixels of its screenshot, zoomed until the
// words read at 1200 px, and recomposed to fill a tile instead of one wide crop squeezed into it.
// A vignette is a list of pieces cut from the screenshot (canvas px, 1640×1040, the coordinates of
// the shoot.mjs scene) placed on a small canvas of its own, plus vector parts drawn around them
// (wires between nodes, a frame, a highlight ring). The card scales the whole canvas to its tile.
// No piece cuts through a word: each crop stops on padding the UI already has.
//
// The coordinates follow the scenes of shoot.mjs; if a scene moves, re-measure (the media step's
// cards are reviewed by eye on every release) or the card falls back to the highlight's crop.

/** A piece: crop [x, y, w, h] of the shot drawn at (x, y) on the vignette canvas, scale s. */
const P = (crop, x, y, s) => ({ crop, x, y, s });

const AMBER = '#fbbf24', BLUE = '#3b82f6';

/**
 * Automations in Flow mode: three nodes (the trigger, a step, the notification) stepping down, each
 * out-port joined to the next in-port by a wire routed through the gap, with rounded corners.
 */
function flow() {
  const s = 1.3, nw = 200 * s, nh = 52 * s, dx = 20, gap = 30, e = 14, r = 7;
  const nodes = [[470, 497], [720, 497], [1222, 572]];
  const pieces = nodes.map(([x, y], i) => P([x, y, 200, 52], i * dx, i * (nh + gap), s));
  const f = (v) => v.toFixed(1);
  let wires = '';
  for (let i = 0; i < nodes.length - 1; i++) {
    const ox = i * dx + nw - 4 * s, oy = i * (nh + gap) + nh / 2;
    const ix = (i + 1) * dx + 3 * s, iy = (i + 1) * (nh + gap) + nh / 2;
    const my = (i + 1) * (nh + gap) - gap / 2, rx = ox + e, lx = ix - e;
    const d = `M${f(ox)} ${f(oy)}H${f(rx - r)}Q${f(rx)} ${f(oy)} ${f(rx)} ${f(oy + r)}V${f(my - r)}Q${f(rx)} ${f(my)} ${f(rx - r)} ${f(my)}H${f(lx + r)}Q${f(lx)} ${f(my)} ${f(lx)} ${f(my + r)}V${f(iy - r)}Q${f(lx)} ${f(iy)} ${f(lx + r)} ${f(iy)}H${f(ix)}`;
    wires += `<path d="${d}" fill="none" stroke="${BLUE}" stroke-opacity="0.3" stroke-width="7" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#93b4ff" stroke-width="2.2" stroke-linejoin="round"/>`;
    wires += `<circle cx="${f(ox)}" cy="${f(oy)}" r="4.5" fill="#0f172a" stroke="#93b4ff" stroke-width="2"/><circle cx="${f(ix)}" cy="${f(iy)}" r="4.5" fill="#0f172a" stroke="#93b4ff" stroke-width="2"/>`;
  }
  return { w: (nodes.length - 1) * dx + nw + e + 6, h: nodes.length * nh + (nodes.length - 1) * gap, pieces, over: wires };
}

/** Conflicts: the pair, its three shared files with the mod that wins each, the winner ringed in amber. */
function conflicts() {
  const s = 1.15;
  const head = P([640, 258, 270, 20], 4, 0, s);
  const top = 20 * s + 16;
  const left = P([644, 398, 98, 112], 0, top, s);
  const right = P([976, 398, 178, 112], 98 * s, top, s);
  const w = (98 + 178) * s;
  const btn = P([832, 287, 192, 24], 4, top + 112 * s + 16, s);
  // The middle row (rock_01.dds) is the one where the user picked the winner: ring it.
  const ry = top + 36 * s, rh = 40 * s;
  const ring = `<rect x="-3" y="${ry.toFixed(1)}" width="${(w + 6).toFixed(1)}" height="${rh.toFixed(1)}" rx="9" fill="${AMBER}" fill-opacity="0.07" stroke="${AMBER}" stroke-width="2"/>`;
  return { w, h: top + 112 * s + 16 + 24 * s, pieces: [head, left, right, btn], over: ring };
}

/** Laya: the « Laya is on » card rebuilt from its parts (icon, title, toggle, two chips) and one suggestion. */
function laya() {
  const s = 1.25, W = 320;
  const pieces = [
    P([340, 276, 42, 42], 14, 14, s),
    P([391, 278, 80, 22], 14 + 42 * s + 12, 14 + (42 * s - 22 * s) / 2, s),
    P([1286, 284, 48, 30], W - 14 - 48 * s, 14 + (42 * s - 30 * s) / 2, s),
    P([338, 329, 126, 24], 14, 14 + 42 * s + 14, s),
    P([730, 329, 162, 24], 14, 14 + 42 * s + 14 + 24 * s + 8, s),
  ];
  const cardH = 14 + 42 * s + 14 + 24 * s * 2 + 8 + 16;
  const frame = `<rect x="0.75" y="0.75" width="${W - 1.5}" height="${(cardH - 1.5).toFixed(1)}" rx="12" fill="#152a2b" stroke="#10b981" stroke-opacity="0.55" stroke-width="1.5"/>`;
  const sy = cardH + 16;
  pieces.push(P([321, 461, 246, 86], (W - 246 * s) / 2, sy, s));
  return { w: W, h: sy + 86 * s, pieces, under: frame };
}

/** shoot.mjs scene name → vignette. */
export const VIGNETTES = { 'automations-flow': flow, conflicts, laya };

/** The vignette of a scene, or null: { w, h, pieces: [{ crop, x, y, s }], under?, over? }. */
export function vignetteOf(shot) {
  const f = VIGNETTES[shot];
  return f ? f() : null;
}
