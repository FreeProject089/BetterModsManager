// Faithful mirror of frontend/src/core/utils.ts `escHtml()`, shipped vs optimized.
// The shipped version chains 5 .replace() calls (5 full-string scans + 4 intermediate
// strings) on every call; the optimized version does one .test() fast-path + a single
// .replace() pass. Both must produce identical output (asserted in bench.mjs).

/** EXACT port of the OLD shipped escHtml() — 5 chained .replace(). */
export function escHtml_shipped(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The optimized escHtml() now shipped: single pass, guarded by a .test() fast-path. */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escHtml_optimized(str) {
  if (str == null) return '';
  const s = String(str);
  return /[&<>"']/.test(s) ? s.replace(/[&<>"']/g, (c) => ESC_MAP[c]) : s;
}
