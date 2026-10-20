// WCAG 2.x contrast, pure. Used to measure the text of the release cards, the screenshot
// compositions, the benchmark report and the PDF, and by the tests that keep them at AA.

export const hexToRgb = (hex) => {
  const h = String(hex).replace('#', '');
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
/** Colour `fg` at `alpha` over `bg` (both #hex), as #hex. */
export const blend = (fg, bg, alpha) => {
  const a = hexToRgb(fg), b = hexToRgb(bg);
  return '#' + a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
};
/** Contrast ratio of two #hex colours (1 to 21). */
export function ratio(fg, bg) {
  const l1 = luminance(hexToRgb(fg)), l2 = luminance(hexToRgb(bg));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
export const AA = 4.5, AA_LARGE = 3;
