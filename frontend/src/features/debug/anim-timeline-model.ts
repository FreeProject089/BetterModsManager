// Animation Studio model: sequences of preset steps compiled to a GSAP timeline, the saved
// format (with its legacy single-step shape), import validation, and picker selectors.
//
// Pure and DOM-free (the selector builder takes its DOM queries as arguments), so all of it
// runs under node in tests/anim-timeline-model.test.mjs.
//
// STORAGE COMPATIBILITY. The original format was one preset per animation:
//   { id, name, selector, preset, duration, delay, stagger, ease, auto }
// A sequence adds `steps: AnimStep[]`. Every stored sequence ALSO keeps those top-level
// fields as a mirror of its first step (delay = first step's offset), so an older BMM that
// knows nothing about `steps` still finds a working single animation in the same record.

export type Preset = 'fadeIn' | 'slideUp' | 'slideDown' | 'pop' | 'pulse' | 'flyInLeft' | 'flyInRight' | 'stagger';
export const PRESET_KEYS: Preset[] = ['fadeIn', 'slideUp', 'slideDown', 'pop', 'pulse', 'flyInLeft', 'flyInRight', 'stagger'];

export const COMMON_EASES = [
  'none', 'power1.out', 'power2.out', 'power3.out', 'power1.inOut', 'power2.inOut', 'power2.in',
  'back.out(1.7)', 'back.inOut(1.4)', 'elastic.out(1, 0.4)', 'bounce.out', 'expo.out', 'circ.out', 'sine.inOut', 'steps(6)',
];

export interface AnimStep {
  selector: string;
  preset: Preset;
  duration: number;
  stagger: number;
  ease: string;
  /** Where the step starts: after the previous step ends, or with it. */
  at: 'after' | 'with';
  /** Seconds added to that start (negative overlaps). For the first step: an absolute delay. */
  offset: number;
}

export interface AnimSeq {
  id: string;
  name: string;
  auto: boolean;
  steps: AnimStep[];
  // Legacy mirror of steps[0], kept in storage for older builds.
  selector: string;
  preset: Preset;
  duration: number;
  delay: number;
  stagger: number;
  ease: string;
}

export const LIMITS = {
  steps: 20,
  anims: 200,
  name: 80,
  selector: 500,
  ease: 60,
  duration: [0, 30] as const,
  offset: [-30, 60] as const,
  stagger: [0, 5] as const,
};

const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
};

/** GSAP ease strings: names, dots, a parenthesised parameter list. Nothing executable. */
export function isPlausibleEase(e: string): boolean {
  return typeof e === 'string' && e.length > 0 && e.length <= LIMITS.ease && /^[A-Za-z][A-Za-z0-9.]*(\([0-9.,\s-]*\))?$/.test(e.trim());
}

export function newId(): string {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function defaultStep(selector = ''): AnimStep {
  return { selector, preset: 'stagger', duration: 0.5, stagger: 0.06, ease: 'power2.out', at: 'after', offset: 0 };
}

export function newAnim(): AnimSeq {
  return withMirror({ id: newId(), name: '', auto: false, steps: [defaultStep()] } as AnimSeq);
}

function normStep(raw: any): AnimStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const preset = PRESET_KEYS.includes(raw.preset) ? raw.preset as Preset : null;
  if (!preset) return null;
  const ease = typeof raw.ease === 'string' && isPlausibleEase(raw.ease) ? raw.ease.trim() : 'power2.out';
  return {
    selector: typeof raw.selector === 'string' ? raw.selector.trim().slice(0, LIMITS.selector) : '',
    preset,
    duration: clamp(raw.duration, LIMITS.duration, 0.5),
    stagger: clamp(raw.stagger, LIMITS.stagger, 0),
    ease,
    at: raw.at === 'with' ? 'with' : 'after',
    offset: clamp(raw.offset ?? raw.delay ?? 0, LIMITS.offset, 0),
  };
}

/** Top-level mirror of the first step, for builds that predate sequences. */
export function withMirror(a: AnimSeq): AnimSeq {
  const s = a.steps[0] || defaultStep();
  return { ...a, selector: s.selector, preset: s.preset, duration: s.duration, delay: Math.max(0, s.offset), stagger: s.stagger, ease: s.ease };
}

/** Any stored or imported record → a sequence, or null if it cannot be one. Legacy records
 *  (no `steps`) become a one-step sequence. */
export function normalizeAnim(raw: any): AnimSeq | null {
  if (!raw || typeof raw !== 'object') return null;
  let steps: AnimStep[];
  if (Array.isArray(raw.steps)) {
    steps = raw.steps.slice(0, LIMITS.steps).map(normStep).filter(Boolean) as AnimStep[];
  } else {
    const s = normStep({ ...raw, offset: raw.delay ?? 0 });
    steps = s ? [s] : [];
  }
  if (!steps.length) return null;
  const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : newId();
  return withMirror({
    id,
    name: typeof raw.name === 'string' ? raw.name.trim().slice(0, LIMITS.name) : '',
    auto: raw.auto === true,
    steps,
  } as AnimSeq);
}

/** A stored list, tolerant of junk: bad records are skipped, duplicate ids re-issued. */
export function normalizeList(raw: unknown): AnimSeq[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AnimSeq[] = [];
  for (const r of raw.slice(0, LIMITS.anims)) {
    const a = normalizeAnim(r);
    if (!a) continue;
    if (seen.has(a.id)) a.id = newId();
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

// ── presets as data ────────────────────────────────────────────────────────────────────

export interface TweenOp {
  selector: string;
  method: 'from' | 'fromTo';
  from?: Record<string, unknown>;
  vars: Record<string, unknown>;
  /** GSAP position parameter. */
  position: number | string;
}

/** What one preset asks GSAP for. Defaults reproduce the original single-anim studio. */
export function presetTween(s: AnimStep): { method: 'from' | 'fromTo'; from?: Record<string, unknown>; vars: Record<string, unknown> } {
  const base = { duration: s.duration, stagger: s.stagger, ease: s.ease };
  switch (s.preset) {
    case 'fadeIn': return { method: 'from', vars: { opacity: 0, ...base } };
    case 'slideUp': return { method: 'from', vars: { opacity: 0, y: 24, ...base } };
    case 'slideDown': return { method: 'from', vars: { opacity: 0, y: -24, ...base } };
    case 'pop': return { method: 'from', vars: { opacity: 0, scale: 0.85, ...base, ease: s.ease || 'back.out(1.7)' } };
    case 'pulse': return { method: 'fromTo', from: { scale: 1 }, vars: { scale: 1.06, ...base, duration: s.duration || 0.25, yoyo: true, repeat: 1, ease: s.ease || 'power1.inOut' } };
    case 'flyInLeft': return { method: 'from', vars: { opacity: 0, x: -40, ...base } };
    case 'flyInRight': return { method: 'from', vars: { opacity: 0, x: 40, ...base } };
    case 'stagger':
    default: return { method: 'from', vars: { opacity: 0, y: 20, scale: 0.96, ...base, duration: s.duration || 0.5, stagger: s.stagger || 0.06, ease: s.ease || 'power2.out' } };
  }
}

function stepLength(s: AnimStep, count = 1): number {
  const t = presetTween(s);
  const dur = Number(t.vars.duration) || 0;
  const reps = t.vars.yoyo ? 2 : 1;
  return dur * reps + (Number(t.vars.stagger) || 0) * Math.max(0, count - 1);
}

/** GSAP position for step i: the first is absolute, the rest relative to the previous one. */
export function positionOf(s: AnimStep, i: number): number | string {
  if (i === 0) return Math.max(0, s.offset);
  const sign = s.at === 'with' ? '<' : '>';
  return s.offset ? `${sign}${+s.offset.toFixed(3)}` : sign;
}

/**
 * Compile a sequence: the tween ops to add to one gsap.timeline(), plus a layout (start/end
 * per step, in seconds) for the studio's timeline strip. `counts[i]` is how many elements
 * step i matched (stagger widens a step); unknown counts are taken as 1.
 */
export function compileTimeline(a: AnimSeq, counts: number[] = []): { ops: TweenOp[]; layout: { start: number; end: number }[]; total: number } {
  const ops: TweenOp[] = [];
  const layout: { start: number; end: number }[] = [];
  let prevStart = 0, prevEnd = 0, total = 0;
  a.steps.forEach((s, i) => {
    const tw = presetTween(s);
    ops.push({ selector: s.selector, method: tw.method, from: tw.from, vars: tw.vars, position: positionOf(s, i) });
    const start = Math.max(0, i === 0 ? Math.max(0, s.offset) : (s.at === 'with' ? prevStart : prevEnd) + s.offset);
    const end = +(start + stepLength(s, counts[i] ?? 1)).toFixed(4);
    layout.push({ start: +start.toFixed(4), end });
    prevStart = start; prevEnd = end;
    total = Math.max(total, end);
  });
  return { ops, layout, total };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

// ── import / export ────────────────────────────────────────────────────────────────────

export const EXPORT_KIND = 'bmm-anims';

export function exportAnims(list: AnimSeq[]): string {
  return JSON.stringify({ kind: EXPORT_KIND, version: 2, anims: list.map(withMirror) }, null, 2);
}

export interface ImportResult {
  anims: AnimSeq[];
  /** Human-indexable problems: `#3: invalid selector`. */
  errors: string[];
}

/**
 * Validate an import. Accepts the export envelope or a bare array (what older builds kept
 * in localStorage). Imported animations never auto-run until the user turns that on: an
 * import is someone else's motion, applied to every page it matches.
 */
export function parseAnimImport(text: string, opts: { existingIds?: Iterable<string>; isValidSelector?: (s: string) => boolean } = {}): ImportResult {
  const res: ImportResult = { anims: [], errors: [] };
  let data: any;
  try { data = JSON.parse(text); } catch { res.errors.push('json'); return res; }
  const list = Array.isArray(data) ? data : (data && typeof data === 'object' && Array.isArray(data.anims) ? data.anims : null);
  if (!list) { res.errors.push('shape'); return res; }
  if (list.length > LIMITS.anims) res.errors.push('too_many');
  const ids = new Set(opts.existingIds || []);
  list.slice(0, LIMITS.anims).forEach((raw: any, i: number) => {
    const a = normalizeAnim(raw);
    if (!a) { res.errors.push(`#${i + 1}: invalid`); return; }
    const bad = opts.isValidSelector ? a.steps.find((s) => s.selector && !opts.isValidSelector!(s.selector)) : undefined;
    if (bad) { res.errors.push(`#${i + 1}: selector`); return; }
    if (ids.has(a.id)) a.id = newId();
    ids.add(a.id);
    a.auto = false;
    res.anims.push(withMirror(a));
  });
  return res;
}

// ── selectors for picked elements ──────────────────────────────────────────────────────

/** Minimal element shape the selector builder reads. A real Element satisfies it. */
export interface SelNode {
  id?: string;
  tagName: string;
  className?: unknown;
  parentElement: SelNode | null;
  children?: ArrayLike<SelNode>;
  getAttribute?(name: string): string | null;
}

/** CSS.escape where the platform has it, the spec algorithm otherwise (node tests). */
export function cssEscape(value: string): string {
  const native = (globalThis as any).CSS?.escape;
  if (typeof native === 'function') return native(value);
  const s = String(value);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) { out += '�'; continue; }
    if ((c >= 1 && c <= 31) || c === 127 || (i === 0 && c >= 48 && c <= 57) || (i === 1 && c >= 48 && c <= 57 && s.charCodeAt(0) === 45)) {
      out += '\\' + c.toString(16) + ' ';
      continue;
    }
    if (i === 0 && c === 45 && s.length === 1) { out += '\\' + s[i]; continue; }
    if (c >= 128 || c === 45 || c === 95 || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) { out += s[i]; continue; }
    out += '\\' + s[i];
  }
  return out;
}

// Classes that describe a moment (hover, open, selected) or belong to the studios: a
// selector built on them stops matching as soon as the state changes.
const UNSTABLE_CLASS = /^(rstudio|anim-|bmm-no-record|is-|has-|js-)|^(active|open|opened|selected|hover|hovered|focus|focused|show|shown|hidden|disabled|visible|current|loading)$/;
const STABLE_ATTRS = ['data-testid', 'data-id', 'data-tab', 'data-page', 'data-view', 'name', 'aria-label'];

function stableClasses(el: SelNode, max: number): string[] {
  const cn = typeof el.className === 'string' ? el.className : '';
  return cn.trim().split(/\s+/).filter((c) => c && !UNSTABLE_CLASS.test(c)).slice(0, max);
}

function segment(el: SelNode): string {
  const tag = el.tagName.toLowerCase();
  const cls = stableClasses(el, 2).map((c) => '.' + cssEscape(c)).join('');
  const parent = el.parentElement;
  const sibs = parent?.children ? Array.from(parent.children).filter((n) => n.tagName === el.tagName) : [];
  const nth = sibs.length > 1 ? `:nth-of-type(${sibs.indexOf(el) + 1})` : '';
  return tag + cls + nth;
}

/**
 * A selector for `el` that matches it alone when possible. Tries, in order: a unique id, a
 * stable attribute, tag + stable classes, then a short `>` path with :nth-of-type, anchored
 * on the nearest ancestor with a unique id. `count(sel)` is document.querySelectorAll(sel)
 * .length (injected so this runs without a DOM). Never returns an empty or dangling
 * selector: the worst case is the full path, which is always valid CSS.
 */
export function uniqueSelector(el: SelNode, count: (sel: string) => number, maxDepth = 7): string {
  const tag = el.tagName.toLowerCase();
  const unique = (s: string) => { try { return count(s) === 1; } catch { return false; } };
  if (el.id) {
    const s = '#' + cssEscape(el.id);
    if (unique(s)) return s;
  }
  for (const attr of STABLE_ATTRS) {
    const v = el.getAttribute?.(attr);
    if (v && v.length <= 80) {
      const s = `${tag}[${attr}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
      if (unique(s)) return s;
    }
  }
  const cls = stableClasses(el, 3);
  if (cls.length) {
    const s = tag + cls.map((c) => '.' + cssEscape(c)).join('');
    if (unique(s)) return s;
  }
  const parts: string[] = [];
  let cur: SelNode | null = el;
  for (let depth = 0; cur && depth < maxDepth; depth++) {
    const t = cur.tagName.toLowerCase();
    if (t === 'html' || t === 'body') break;
    if (depth > 0 && cur.id && unique('#' + cssEscape(cur.id))) { parts.unshift('#' + cssEscape(cur.id)); break; }
    parts.unshift(segment(cur));
    const path = parts.join(' > ');
    if (unique(path)) return path;
    cur = cur.parentElement;
  }
  return parts.join(' > ') || tag;
}

// ── ease preview ───────────────────────────────────────────────────────────────────────

/** SVG path of an ease curve in a w×h box (y up). Overshooting eases (back, elastic) are
 *  scaled to fit, with 0 and 1 kept visible. */
export function easeCurvePath(fn: (p: number) => number, w: number, h: number, samples = 48): string {
  const ys: number[] = [];
  for (let i = 0; i <= samples; i++) {
    let y = 0;
    try { y = Number(fn(i / samples)); } catch { y = i / samples; }
    ys.push(Number.isFinite(y) ? y : 0);
  }
  const lo = Math.min(0, ...ys), hi = Math.max(1, ...ys);
  const span = hi - lo || 1;
  return ys.map((y, i) => `${i ? 'L' : 'M'}${((i / samples) * w).toFixed(1)},${(h - ((y - lo) / span) * h).toFixed(1)}`).join(' ');
}
