// The editable sources of every picture the media step makes, in one place:
//   Release/<v>/media/source/psd/   layered PSDs (groups, sRGB profile) + a .txt of the words of each text layer
//   Release/<v>/media/source/svg/   layered SVGs (Inkscape layers; text stays text)
//   Release/<v>/media/source/README.md   every file and its layers, in English and French
// Every PSD is read back (lib/psd.mjs readPsd): size, layer names, groups, ICC profile, and its
// composite compared with the PNG it was made with. A PSD that does not read, or does not
// match, is a failed check, not a note.

import { readFileSync, existsSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readPsd, layerNames } from '../lib/psd.mjs';
import { decodePng } from '../lib/png.mjs';
import { writeText } from '../lib/util.mjs';
import { screenshotSvg } from '../screenshots/shoot.mjs';

/**
 * Compare a PSD composite (RGB) with a PNG (RGBA) over the PNG's opaque pixels.
 * Returns { mean, max, pixels } (0..255 per channel), or null when the sizes differ.
 */
export function compareComposite(psd, png) {
  if (psd.width !== png.width || psd.height !== png.height) return null;
  let sum = 0, max = 0, n = 0;
  for (let i = 0; i < png.width * png.height; i++) {
    if (png.data[i * 4 + 3] !== 255) continue;
    for (let c = 0; c < 3; c++) { const d = Math.abs(psd.composite[i * 3 + c] - png.data[i * 4 + c]); sum += d; if (d > max) max = d; }
    n++;
  }
  return { mean: n ? sum / (n * 3) : 0, max, pixels: n };
}

/** Read a PSD back and check it against its PNG. Returns { file, ok, problems[], width, height, layers[], groups[], icc }. */
export function verifyPsd(psdFile, pngFile = null, { expect = null } = {}) {
  const problems = [];
  let psd;
  try { psd = readPsd(readFileSync(psdFile)); } catch (e) { return { file: psdFile, ok: false, problems: [`does not read: ${e.message}`], layers: [] }; }
  if (psd.depth !== 8 || psd.mode !== 3) problems.push(`not 8-bit RGB (depth ${psd.depth}, mode ${psd.mode})`);
  if (!psd.icc || psd.icc.toString('ascii', 36, 40) !== 'acsp') problems.push('no ICC profile');
  const names = layerNames(psd);
  if (!names.length) problems.push('no layers');
  if (expect && (psd.width !== expect.w || psd.height !== expect.h)) problems.push(`size ${psd.width}×${psd.height}, expected ${expect.w}×${expect.h}`);
  let diff = null;
  if (pngFile && existsSync(pngFile)) {
    const png = decodePng(readFileSync(pngFile));
    diff = compareComposite(psd, png);
    if (!diff) problems.push(`composite ${psd.width}×${psd.height} vs PNG ${png.width}×${png.height}`);
    else if (diff.mean > 1.5) problems.push(`composite differs from the PNG (mean ${diff.mean.toFixed(2)})`);
  }
  const groups = [...new Set(psd.layers.filter((l) => l.divider === 1 || l.divider === 2).map((l) => l.name))];
  return { file: psdFile, ok: !problems.length, problems, width: psd.width, height: psd.height, layers: names, groups, icc: !!psd.icc, diff };
}

/**
 * Copy the screenshot compositions' PSDs into source/psd (screenshot-<name>.psd) and write
 * their layered SVGs into source/svg, linked to ../../screenshots/layers/.
 */
export function collectScreenshots({ mediaDir, shots, version }) {
  const psdDir = join(mediaDir, 'source', 'psd'), svgDir = join(mediaDir, 'source', 'svg');
  mkdirSync(psdDir, { recursive: true }); mkdirSync(svgDir, { recursive: true });
  const out = [];
  for (const s of shots) {
    const name = `screenshot-${s.name}`;
    if (s.psd && existsSync(s.psd)) copyFileSync(s.psd, join(psdDir, `${name}.psd`));
    writeText(join(svgDir, `${name}.svg`), screenshotSvg(s.name, s.w, s.h, version, { tasky: s.tasky, prefix: '../../screenshots/layers/' }));
    out.push({ name, png: s.png, psd: join(psdDir, `${name}.psd`), w: s.w, h: s.h });
  }
  return out;
}

const KIND = [
  [/^hero-flat/, 'Flat README banner (1.0.3 style)', 'Bannière README plate (style 1.0.3)'],
  [/^hero/, 'README hero, semi-3D', 'Hero du README, semi-3D'],
  [/^screenshot-/, 'Screenshot composition (window + Tasky)', 'Capture composée (fenêtre + Tasky)'],
  [/^bmm-/, 'Release card', 'Carte de version'],
];
const kindOf = (n, fr) => { const k = KIND.find(([re]) => re.test(n)); return k ? k[fr ? 2 : 1] : ''; };

/**
 * Verify every PSD of source/psd against the PNG named in `pngs` ({ base name: png path }) and
 * write source/README.md. Returns { results, bad }.
 */
export function writeSourcesReadme({ mediaDir, version, pngs = {} }) {
  const psdDir = join(mediaDir, 'source', 'psd');
  const files = existsSync(psdDir) ? readdirSync(psdDir).filter((f) => f.endsWith('.psd')).sort() : [];
  const results = files.map((f) => ({ name: basename(f, '.psd'), ...verifyPsd(join(psdDir, f), pngs[basename(f, '.psd')] ?? null) }));
  const row = (r, fr) => `| \`psd/${r.name}.psd\` | ${kindOf(r.name, fr)} | ${r.width}×${r.height} | ${r.layers.join(' · ')} | ${r.ok ? (fr ? 'relu, conforme' : 'read back, matches') : `**${r.problems.join('; ')}**`} |`;
  const md = `# BMM ${version}: editable sources / sources modifiables

Generated by \`tools/release\` (media step). Généré par \`tools/release\` (étape media).

## English

- \`psd/\`: one layered PSD per picture (8-bit RGB, sRGB profile embedded). Layers are grouped
  (Background, Product shot or Windows, Tasky on the screenshots, Brand, Text, Screenshots). Text layers are pixels:
  the words are in the \`.txt\` next to each card's PSD, and editable as text in the SVG of the same name.
- \`svg/\`: the same pictures as layered SVG (Inkscape layers, also read by Illustrator and Affinity).
  The screenshots' SVGs link their layers from \`../../screenshots/layers/\`.
- Every PSD below was read back after it was written: size, layers, profile, and its flattened image
  compared with the PNG.

| File | What | Size | Layers (group / layer) | Check |
|---|---|---|---|---|
${results.map((r) => row(r, false)).join('\n')}

## Français

- \`psd/\` : un PSD à calques par image (RVB 8 bits, profil sRGB intégré). Les calques sont groupés
  (Arrière-plan, Capture ou Fenêtres, Tasky sur les captures, Marque, Texte, Captures). Les calques de texte sont des
  pixels : le texte est dans le \`.txt\` à côté du PSD de chaque carte, et modifiable comme texte dans le SVG du même nom.
- \`svg/\` : les mêmes images en SVG à calques (calques Inkscape, lus aussi par Illustrator et Affinity).
  Les SVG des captures lient leurs calques depuis \`../../screenshots/layers/\`.
- Chaque PSD ci-dessous a été relu après écriture : taille, calques, profil, et son image aplatie
  comparée au PNG.

| Fichier | Quoi | Taille | Calques (groupe / calque) | Vérification |
|---|---|---|---|---|
${results.map((r) => row(r, true)).join('\n')}
`;
  writeText(join(mediaDir, 'source', 'README.md'), md);
  return { results, bad: results.filter((r) => !r.ok) };
}
