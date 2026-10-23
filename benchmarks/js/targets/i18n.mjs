// Faithful mirror of frontend/src/core/i18n.ts `t()`, plus an optimized variant.
// The shipped version compiles a fresh RegExp per param on every call — the
// benchmark quantifies that against a single-pass replacement.

/** EXACT port of the shipped t(). `dict` stands in for the active-language map. */
export function t_shipped(dict, key, params = {}) {
  let str = dict[key] || key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v); // new RegExp per param
  }
  return str;
}

/**
 * Optimized: single linear scan over the string, substituting every `{name}`
 * token from `params` in one pass — no RegExp compilation, no repeated
 * full-string rescans. Identical output for the `{name}` placeholder format.
 */
export function t_optimized(dict, key, params = {}) {
  let str = dict[key] || key;
  if (str.indexOf('{') === -1) return str; // fast path: no placeholders
  let out = '';
  let i = 0;
  const n = str.length;
  while (i < n) {
    const open = str.indexOf('{', i);
    if (open === -1) { out += str.slice(i); break; }
    const close = str.indexOf('}', open + 1);
    if (close === -1) { out += str.slice(i); break; }
    out += str.slice(i, open);
    const name = str.slice(open + 1, close);
    out += Object.prototype.hasOwnProperty.call(params, name) ? params[name] : str.slice(open, close + 1);
    i = close + 1;
  }
  return out;
}
