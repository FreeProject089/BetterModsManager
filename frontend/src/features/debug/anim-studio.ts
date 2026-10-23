// Animation Studio — inject GSAP animations into live BMM elements from DevTools.
//
// Two jobs:
//   1. Add motion you can RECORD: because these tweens animate the real elements' inline
//      styles/transforms, the rrweb recorder (see the Replay Studio, replay-studio.ts)
//      captures them — so triggering an animation while recording makes it play back in the
//      .bmmreplay. e.g. stagger every mod card on the Library page one-by-one during a demo.
//   2. Let users define + SAVE custom UI animations that auto-run when their target appears
//      (a light MutationObserver), effectively replacing/augmenting the built-in motion.
//
// An animation is a SEQUENCE of preset steps (each on its own selector, starting after or
// with the previous one, plus an offset), compiled to one gsap.timeline(). The model —
// presets as data, the compile, storage compatibility with the old single-preset records,
// import validation, picker selectors — is in anim-timeline-model.ts.
//
// GSAP is already vendored globally (assets/vendor/gsap.min.js) and used elsewhere via
// window.gsap; we just make sure it's loaded, then drive it. Persists to localStorage.

import { t } from '../../core/i18n.js';
import { uiIcon } from '../../ui/icons.js';
import {
  PRESET_KEYS, COMMON_EASES, LIMITS, newAnim, newId, defaultStep, withMirror, normalizeList, compileTimeline,
  moveItem, exportAnims, parseAnimImport, uniqueSelector, easeCurvePath, isPlausibleEase,
  type AnimSeq, type AnimStep, type Preset,
} from './anim-timeline-model.js';

const LS = 'bmm_custom_anims';
function loadAnims(): AnimSeq[] {
  try { return normalizeList(JSON.parse(localStorage.getItem(LS) || '[]')); } catch { return []; }
}
function saveAnims(list: AnimSeq[]): boolean {
  try { localStorage.setItem(LS, JSON.stringify(list.map(withMirror))); return true; } catch { return false; }
}

// GSAP loader (mirrors the rrweb loader). Resolves window.gsap. A failed load is forgotten,
// so the next attempt retries instead of replaying the same rejection forever.
function ensureGsap(): Promise<any> {
  const w = window as any;
  if (w.gsap) return Promise.resolve(w.gsap);
  if (w.__gsapLoading) return w.__gsapLoading;
  w.__gsapLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/gsap.min.js';
    s.async = true;
    s.onload = () => resolve((window as any).gsap);
    s.onerror = () => { w.__gsapLoading = null; s.remove(); reject(new Error('gsap failed to load')); };
    document.head.appendChild(s);
  });
  return w.__gsapLoading;
}

const reducedMotion = (): boolean => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Names/selectors are user text that goes straight into innerHTML and into value="…"
// attributes, so they have to be escaped — a name containing a quote used to break the form
// markup, and the row list rendered whatever HTML you typed.
function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// An invalid selector throws inside querySelectorAll. Validate up front so the user gets
// "that selector is not valid" instead of the misleading "GSAP unavailable" the rejected
// promise used to produce.
function isValidSelector(sel: string): boolean {
  if (!sel) return false;
  try { document.createDocumentFragment().querySelector(sel); return true; } catch { return false; }
}
/** Elements a step may animate: never the studio's own panels, never the document roots. */
function targets(sel: string): Element[] {
  if (!isValidSelector(sel)) return [];
  return Array.from(document.querySelectorAll(sel)).filter((el) =>
    el !== document.documentElement && el !== document.body && !el.closest('.anim-panel') && !el.closest('.rstudio-bar'));
}
function easeOk(e: string): boolean {
  if (!isPlausibleEase(e)) return false;
  const g = (window as any).gsap;
  if (!g?.parseEase) return true; // not loaded yet: the shape check is all we can do
  try { return typeof g.parseEase(e) === 'function'; } catch { return false; }
}

// ── run / preview ──
// Elements a preview has animated, so closing the studio can stop their tweens and clear what
// GSAP left inline. Weak, so a preview never keeps a removed element alive.
let touched = new Set<WeakRef<Element>>();
let previewTl: any = null;
// A preview over more elements than this is refused. An EMPTY selector used to mean "every
// element on the page": a `from({opacity:0})` with a stagger then set the whole app to
// opacity 0 at once and brought it back one element every 60 ms — minutes of a blank BMM.
const PREVIEW_MAX = 400;

/** Build one GSAP timeline for a sequence over the given per-step element lists. */
function buildTimeline(g: any, a: AnimSeq, els: Element[][]): any {
  const tl = g.timeline({ paused: true });
  const { ops } = compileTimeline(a, els.map((e) => e.length));
  ops.forEach((op, i) => {
    const list = els[i];
    try {
      if (!list.length) {
        // A step with nothing to animate still holds its place (an empty tween of the same
        // length), so the steps after it keep their timing.
        const len = (Number(op.vars.duration) || 0) * (op.vars.yoyo ? 2 : 1);
        tl.to({}, { duration: Math.max(0.001, len) }, op.position);
      } else if (op.method === 'fromTo') tl.fromTo(list, op.from, op.vars, op.position);
      else tl.from(list, op.vars, op.position);
    } catch (e) { console.warn('[Animation Studio] step skipped', i + 1, e); }
  });
  return tl;
}

/** Check a sequence before running it; returns the first problem as a message, or null. */
function problemOf(a: AnimSeq): string | null {
  for (let i = 0; i < a.steps.length; i++) {
    const s = a.steps[i];
    const n = a.steps.length > 1 ? `${t('anim.step') || 'Step'} ${i + 1}: ` : '';
    if (!s.selector) return n + (t('anim.needselector') || 'Pick or type a target selector first.');
    if (!isValidSelector(s.selector)) return n + (t('anim.badselector') || 'Not a valid CSS selector:') + ` "${s.selector}"`;
    if (!easeOk(s.ease)) return n + (t('anim.badease') || 'Unknown ease:') + ` "${s.ease}"`;
  }
  return null;
}

function preview(a: AnimSeq, setStatus: (m: string) => void) {
  const bad = problemOf(a);
  if (bad) { setStatus(bad); return; }
  ensureGsap().then((g) => {
    const els = a.steps.map((s) => targets(s.selector));
    const total = els.reduce((n, l) => n + l.length, 0);
    if (!total) { setStatus((t('anim.nomatch') || 'No element matches') + ` "${a.steps[0].selector}"`); return; }
    if (total > PREVIEW_MAX) { setStatus((t('anim.toomany') || 'Too many matches for a preview') + ` (${total} > ${PREVIEW_MAX})`); return; }
    stopPreview(g);
    els.flat().forEach((el) => touched.add(new WeakRef(el)));
    previewTl = buildTimeline(g, a, els);
    previewTl.play(0);
    const empty = els.findIndex((l) => !l.length);
    setStatus((t('anim.played') || 'Played on') + ` ${total}` +
      (empty >= 0 ? ` · ${t('anim.step') || 'Step'} ${empty + 1}: ${t('anim.nomatch') || 'No element matches'}` : '') +
      (reducedMotion() ? ` · ${t('anim.reduced') || 'Reduced motion is on: auto-run is paused.'}` : ''));
  }).catch(() => setStatus(t('anim.nogsap') || 'GSAP unavailable'));
}

/** Stop the running preview and put its elements back where they were. */
function stopPreview(g: any) {
  if (!previewTl) return;
  try { previewTl.progress(1).kill(); } catch { /* ignore */ }
  previewTl = null;
  void g;
}

/** Kill anything still tweening and clear the inline styles GSAP left behind, so a preview
 *  that ended mid-flight (or a `from` that never completed) can't leave the UI stuck at
 *  opacity 0 — which is exactly how a bad tween used to make part of the app disappear. */
function resetMotion(a: AnimSeq | null, setStatus: (m: string) => void) {
  ensureGsap().then((g) => {
    stopPreview(g);
    const sels = (a?.steps || []).map((s) => s.selector).filter(isValidSelector);
    const els = sels.length ? sels.flatMap((s) => targets(s)) : Array.from(document.querySelectorAll('[style]'));
    try { g.killTweensOf(els); } catch { /* ignore */ }
    els.forEach((el) => {
      const s = (el as HTMLElement).style;
      ['opacity', 'transform', 'translate', 'scale', 'rotate'].forEach((p) => s?.removeProperty(p));
    });
    autoDone.clear();
    setStatus((t('anim.reset') || 'Motion reset on') + ` ${els.length}`);
  }).catch(() => setStatus(t('anim.nogsap') || 'GSAP unavailable'));
}

// ── auto-run: play an anim on freshly-appeared matches (so e.g. mod cards animate when the
// Library page renders). Debounced so a burst of DOM inserts animates as ONE staggered group.
// Each animation remembers which elements it already played on (per animation: two saved
// animations on the same element used to share one flag, so only the first ever ran).
// Off under prefers-reduced-motion: this is motion the user did not ask for at that moment.
let observer: MutationObserver | null = null;
let debounce: number | null = null;
const autoDone = new Map<string, WeakSet<Element>>();
function runAutos() {
  if (reducedMotion()) return;
  ensureGsap().then((g) => {
    for (const a of loadAnims().filter((x) => x.auto)) {
      // Per-animation guard: one saved animation with a broken selector used to throw here and
      // abort the whole loop, silently killing every OTHER auto animation on the page.
      try {
        if (problemOf(a)) continue;
        let seen = autoDone.get(a.id);
        if (!seen) { seen = new WeakSet(); autoDone.set(a.id, seen); }
        const fresh = (sel: string) => targets(sel).filter((el) => !seen!.has(el));
        const first = fresh(a.steps[0].selector);
        if (!first.length) continue;
        const els = a.steps.map((s, i) => (i === 0 ? first : fresh(s.selector)));
        els.flat().forEach((el) => seen!.add(el));
        buildTimeline(g, a, els).play(0);
      } catch { /* skip this one, keep the rest */ }
    }
  }).catch(() => { /* ignore */ });
}
export function installAutoAnimations() {
  observer?.disconnect();
  observer = null;
  if (!loadAnims().some((a) => a.auto)) return;
  observer = new MutationObserver(() => {
    if (debounce != null) return;
    debounce = window.setTimeout(() => { debounce = null; runAutos(); }, 60);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  runAutos(); // catch anything already on screen
}

// ── element picker ──
// A shared hover-highlight box so the user SEES what they're about to target while picking.
// Returns a controller with move()/done(). Self-contained (its own fixed overlay, no CSS dep).
function makeHighlighter() {
  const box = document.createElement('div');
  box.setAttribute('data-bmm-no-record', '1');
  Object.assign(box.style, {
    position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', border: '2px solid var(--bmm-accent)',
    background: 'color-mix(in srgb, var(--bmm-accent) 12%, transparent)', borderRadius: '4px', display: 'none',
  } as any);
  document.body.appendChild(box);
  return {
    move(el: Element | null) {
      if (!el) { box.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' } as any);
    },
    done() { box.remove(); },
  };
}

// The active picker's teardown, so closing the studio mid-pick cannot leave a capture-phase
// click listener behind that swallows the app's next click.
let cancelPick: (() => void) | null = null;

function pickElement(cb: (sel: string) => void) {
  cancelPick?.();
  const hi = makeHighlighter();
  const ownUI = (el: Element) => !!(el.closest('.anim-panel') || el.closest('.rstudio-bar') || el.closest('.rstudio-frame'));
  const pickable = (el: Element | null) => !!el && el !== document.documentElement && el !== document.body && !ownUI(el);
  const finish = () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('keydown', onKey, true);
    hi.done();
    if (cancelPick === finish) cancelPick = null;
    panel?.classList.remove('anim-picking');
  };
  cancelPick = finish;
  panel?.classList.add('anim-picking');
  const onMove = (e: MouseEvent) => { const el = e.target as Element; hi.move(pickable(el) ? el : null); };
  // Esc cancels the PICK only: without stopPropagation it also reached the panel, which
  // took it as "cancel the edit" and threw the form away.
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); status(t('anim.pickcancel') || 'Pick cancelled'); } };
  const onClick = (e: MouseEvent) => {
    const el = e.target as Element;
    if (!pickable(el)) return; // our own panel, or the document roots
    e.preventDefault(); e.stopPropagation();
    finish();
    // A selector for THIS element: the old "tag + two classes" matched every sibling card,
    // and produced an invalid "div." when the only classes were the studios' own.
    cb(uniqueSelector(el as any, (s) => document.querySelectorAll(s).length));
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

// ── UI panel ──
let panel: HTMLElement | null = null;
let editing: AnimSeq | null = null;   // a working copy; saved only on Save
let editingDirty = false;
let importOpen = false;
let livePreview = false;
let liveTimer: number | null = null;
let armedDel: string | null = null;
let armTimer: number | null = null;

// Injected on first open so it costs nothing at boot. Theme tokens throughout: the panel
// follows light and dark themes, on an opaque elevated surface so it reads over anything.
function ensureStyles() {
  if (document.getElementById('anim-studio-styles')) return;
  const s = document.createElement('style');
  s.id = 'anim-studio-styles';
  s.textContent = `
  .anim-panel{position:fixed;right:20px;bottom:20px;z-index:2147483647;isolation:isolate;pointer-events:auto;
    width:400px;max-width:calc(100% - 40px);max-height:min(78%,720px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box;
    background:var(--bmm-bg-elevated);color:var(--bmm-text-primary);border:1px solid var(--bmm-border-hover);border-radius:14px;
    box-shadow:var(--bmm-shadow-modal);
    font:500 13px/1.35 var(--bmm-font-sans,system-ui),sans-serif;padding:12px;}
  /* Lifted above the Replay Studio bar when both are open, instead of under it. */
  body:has(.rstudio-bar:not(.rstudio-mini)) .anim-panel{bottom:120px;max-height:calc(100% - 150px);}
  /* The Replay editor is taller: the panel moves to the top and stops above it. */
  body:has(.rstudio-bar.rstudio-review:not(.rstudio-mini)) .anim-panel{bottom:auto;top:20px;max-height:42%;}
  .anim-panel.anim-picking{opacity:.55;}
  .anim-head{display:flex;align-items:center;gap:6px;margin:0 0 10px;}
  .anim-head h3{margin:0;flex:1;font-size:14px;font-weight:800;color:var(--bmm-accent);display:flex;align-items:center;gap:6px;}
  .anim-row{display:flex;align-items:center;gap:4px;padding:7px 8px;border:1px solid var(--bmm-border-hover);border-radius:10px;margin-bottom:6px;background:var(--bmm-bg-base);}
  .anim-row.anim-row-cur{border-color:var(--bmm-accent);}
  .anim-row-main{flex:1;min-width:0;}
  .anim-row .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;display:flex;align-items:center;gap:5px;}
  .anim-row .sel{font-size:11px;color:var(--bmm-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .anim-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:var(--bmm-s10);color:var(--bmm-text-secondary);flex:0 0 auto;}
  .anim-badge-auto{background:var(--bmm-accent-dim);color:var(--bmm-text-primary);}
  .anim-empty{color:var(--bmm-text-muted);padding:10px 4px;font-size:12px;border:1px dashed var(--bmm-border-hover);border-radius:10px;text-align:center;}
  .anim-btn{border:1px solid var(--bmm-border-hover);background:var(--bmm-bg-base);color:var(--bmm-text-primary);border-radius:8px;padding:5px 9px;cursor:pointer;font:inherit;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;}
  .anim-btn:not(:disabled):hover{background:var(--bmm-bg-hover);border-color:var(--bmm-accent);}
  .anim-btn:disabled{opacity:.4;cursor:default;}
  .anim-btn:focus-visible,.anim-form input:focus-visible,.anim-form select:focus-visible,.anim-form textarea:focus-visible{outline:2px solid var(--bmm-accent);outline-offset:2px;}
  .anim-primary{background:var(--bmm-accent);border-color:var(--bmm-accent);color:var(--bmm-text-on-accent);}
  .anim-primary:not(:disabled):hover{background:var(--bmm-accent);color:var(--bmm-text-on-accent);filter:brightness(1.1);}
  .anim-x:hover,.anim-armed{border-color:var(--bmm-danger);color:var(--bmm-danger);}
  .anim-new{width:100%;margin-top:8px;justify-content:center;}
  .anim-mini{padding:4px 6px;font-size:12px;}
  .anim-form{display:flex;flex-direction:column;gap:8px;margin-top:8px;padding-top:10px;border-top:1px solid var(--bmm-border-hover);}
  .anim-form label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--bmm-text-secondary);min-width:0;}
  .anim-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;}
  .anim-grid .wide{grid-column:1/-1;}
  .anim-selrow{display:flex;gap:6px;}
  .anim-selrow input{flex:1;min-width:0;}
  .anim-form input,.anim-form select,.anim-form textarea{background:var(--bmm-bg-base);color:var(--bmm-text-primary);border:1px solid var(--bmm-border-hover);border-radius:7px;padding:5px 7px;font:inherit;min-width:0;box-sizing:border-box;}
  .anim-form input.bad,.anim-form textarea.bad{border-color:var(--bmm-warning);}
  .anim-form textarea{width:100%;min-height:90px;resize:vertical;font:500 11.5px/1.4 var(--bmm-font-mono,ui-monospace),monospace;}
  .anim-step{border:1px solid var(--bmm-border-hover);border-radius:10px;padding:8px;background:var(--bmm-bg-base);display:flex;flex-direction:column;gap:7px;}
  .anim-step-head{display:flex;align-items:center;gap:4px;}
  .anim-step-head b{flex:1;font-size:12px;color:var(--bmm-text-secondary);}
  .anim-step input,.anim-step select{background:var(--bmm-bg-elevated);}
  .anim-ease{display:flex;gap:6px;align-items:center;}
  .anim-ease input{flex:1;}
  .anim-ease svg{flex:0 0 auto;width:56px;height:30px;border-radius:5px;background:var(--bmm-bg-elevated);border:1px solid var(--bmm-border-hover);}
  .anim-ease path{fill:none;stroke:var(--bmm-accent);stroke-width:2;vector-effect:non-scaling-stroke;}
  .anim-strip{position:relative;border:1px solid var(--bmm-border-hover);border-radius:8px;background:var(--bmm-bg-base);padding:6px 6px 16px;}
  .anim-strip-row{position:relative;height:9px;margin:3px 0;}
  .anim-strip-row i{position:absolute;top:0;bottom:0;border-radius:4px;background:var(--bmm-accent);min-width:3px;}
  .anim-strip-row.bad i{background:var(--bmm-warning);}
  .anim-strip-axis{position:absolute;left:6px;right:6px;bottom:2px;display:flex;justify-content:space-between;font:500 10px/1.2 var(--bmm-font-mono,ui-monospace),monospace;color:var(--bmm-text-muted);}
  .anim-rowline{display:flex;gap:6px;align-items:center;justify-content:space-between;flex-wrap:wrap;}
  .anim-rowline > span{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
  .anim-status{font-size:11px;color:var(--bmm-text-secondary);margin-top:6px;min-height:14px;}
  .anim-match{font-size:10.5px;color:var(--bmm-text-muted);min-height:13px;}
  .anim-match.bad{color:var(--bmm-warning);}
  .anim-row-bad{border-color:var(--bmm-warning);}
  .anim-row-bad .sel{color:var(--bmm-warning);}
  .anim-toggle{display:flex;align-items:center;gap:5px;font-size:11px;flex-direction:row !important;color:var(--bmm-text-secondary);}
  .anim-toggle input{accent-color:var(--bmm-accent);}
  .anim-import{display:flex;flex-direction:column;gap:6px;margin:0 0 8px;padding:8px;border:1px solid var(--bmm-border-hover);border-radius:10px;background:var(--bmm-bg-base);}
  .anim-import .anim-rowline input[type=file]{font-size:11px;color:var(--bmm-text-secondary);max-width:100%;}
  `;
  document.head.appendChild(s);
}

function status(msg: string) {
  const el = panel?.querySelector('.anim-status') as HTMLElement | null;
  if (el) el.textContent = msg;
}

const ib = (act: string, icon: any, tip: string, extra = '') =>
  `<button type="button" class="anim-btn anim-mini" data-anim-act="${act}"${extra} data-tooltip="${esc(tip)}" aria-label="${esc(tip)}">${uiIcon(icon, 14)}</button>`;

/** A small button with a text glyph (the icon set has no arrows). */
const gb = (act: string, glyph: string, tip: string, extra = '') =>
  `<button type="button" class="anim-btn anim-mini" data-anim-act="${act}"${extra} data-tooltip="${esc(tip)}" aria-label="${esc(tip)}"><span aria-hidden="true">${glyph}</span></button>`;

function rowsHtml(list: AnimSeq[]): string {
  return list.map((a, i) => {
    const bad = a.steps.some((s) => s.selector && !isValidSelector(s.selector));
    const n = a.steps.length;
    const id = esc(a.id);
    const armed = armedDel === a.id;
    return `
    <div class="anim-row${bad ? ' anim-row-bad' : ''}${editing?.id === a.id ? ' anim-row-cur' : ''}" data-id="${id}">
      <div class="anim-row-main">
        <div class="nm"><span>${esc(a.name || a.steps[0].preset)}</span>${n > 1 ? `<span class="anim-badge">${n} ${esc(t('anim.steps') || 'steps')}</span>` : ''}${a.auto ? `<span class="anim-badge anim-badge-auto" data-tooltip="${esc(t('anim.auto') || 'Auto-run on appear')}">${esc(t('anim.autobadge') || 'auto')}</span>` : ''}</div>
        <div class="sel">${bad ? '⚠ ' : ''}${esc(a.steps.map((s) => s.selector || '—').join(' → '))}</div>
      </div>
      ${ib('play', 'play', t('anim.preview') || 'Preview', ` data-id="${id}"`)}
      ${ib('edit', 'edit', t('anim.edit') || 'Edit', ` data-id="${id}"`)}
      ${ib('dup', 'copy', t('anim.duplicate') || 'Duplicate', ` data-id="${id}"`)}
      ${gb('up', '▲', t('anim.moveup') || 'Move up', ` data-id="${id}"${i === 0 ? ' disabled' : ''}`)}
      ${gb('down', '▼', t('anim.movedown') || 'Move down', ` data-id="${id}"${i === list.length - 1 ? ' disabled' : ''}`)}
      <button type="button" class="anim-btn anim-mini${armed ? ' anim-armed' : ''}" data-anim-act="del" data-id="${id}" data-tooltip="${esc(armed ? (t('anim.delconfirm') || 'Click again to delete') : (t('anim.delete') || 'Delete'))}" aria-label="${esc(armed ? (t('anim.delconfirm') || 'Click again to delete') : (t('anim.delete') || 'Delete'))}">${uiIcon('delete', 14)}</button>
    </div>`;
  }).join('') || `<div class="anim-empty">${esc(t('anim.none') || 'No animations yet. Add one below.')}</div>`;
}

function stepHtml(s: AnimStep, i: number, n: number): string {
  const f = (k: string) => `data-f="${k}" data-step="${i}"`;
  return `
    <div class="anim-step" data-step-card="${i}">
      <div class="anim-step-head">
        <b>${esc(t('anim.step') || 'Step')} ${i + 1}</b>
        ${gb('step-up', '▲', t('anim.moveup') || 'Move up', ` data-step="${i}"${i === 0 ? ' disabled' : ''}`)}
        ${gb('step-down', '▼', t('anim.movedown') || 'Move down', ` data-step="${i}"${i === n - 1 ? ' disabled' : ''}`)}
        ${ib('step-dup', 'copy', t('anim.duplicate') || 'Duplicate', ` data-step="${i}"${n >= LIMITS.steps ? ' disabled' : ''}`)}
        ${ib('step-del', 'delete', t('anim.step.remove') || 'Remove step', ` data-step="${i}"${n <= 1 ? ' disabled' : ''}`)}
      </div>
      <label>${esc(t('anim.selector') || 'Target selector')}
        <span class="anim-selrow"><input ${f('selector')} value="${esc(s.selector)}" placeholder="${esc(t('anim.selector.ph') || '.mod-item')}" spellcheck="false" maxlength="${LIMITS.selector}">
        <button type="button" class="anim-btn anim-mini" data-anim-act="pick" data-step="${i}">${uiIcon('search', 14)} ${esc(t('anim.pick') || 'Pick')}</button></span>
        <span class="anim-match" data-match="${i}"></span></label>
      <div class="anim-grid">
        <label>${esc(t('anim.preset') || 'Preset')}<select ${f('preset')}>${PRESET_KEYS.map((p) => `<option value="${p}" ${s.preset === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label>${esc(t('anim.ease') || 'Ease')}<span class="anim-ease"><input ${f('ease')} value="${esc(s.ease)}" list="anim-eases" spellcheck="false" maxlength="${LIMITS.ease}"><svg viewBox="0 0 56 30" aria-hidden="true" data-curve="${i}"><path d=""></path></svg></span></label>
        <label>${esc(t('anim.duration') || 'Duration (s)')}<input ${f('duration')} type="number" min="0" max="${LIMITS.duration[1]}" step="0.05" value="${s.duration}"></label>
        <label>${esc(t('anim.stagger') || 'Stagger (s)')}<input ${f('stagger')} type="number" min="0" max="${LIMITS.stagger[1]}" step="0.01" value="${s.stagger}"></label>
        ${i === 0
          ? `<label class="wide">${esc(t('anim.delay') || 'Delay (s)')}<input ${f('offset')} type="number" min="0" max="${LIMITS.offset[1]}" step="0.05" value="${Math.max(0, s.offset)}"></label>`
          : `<label>${esc(t('anim.start') || 'Starts')}<select ${f('at')}><option value="after" ${s.at === 'after' ? 'selected' : ''}>${esc(t('anim.start.after') || 'after previous')}</option><option value="with" ${s.at === 'with' ? 'selected' : ''}>${esc(t('anim.start.with') || 'with previous')}</option></select></label>
             <label>${esc(t('anim.offset') || 'Offset (s)')}<input ${f('offset')} type="number" min="${LIMITS.offset[0]}" max="${LIMITS.offset[1]}" step="0.05" value="${s.offset}"></label>`}
      </div>
    </div>`;
}

function formHtml(e: AnimSeq): string {
  return `
    <div class="anim-form">
      <div class="anim-grid">
        <label class="wide">${esc(t('anim.name') || 'Name')}<input data-f="name" value="${esc(e.name)}" placeholder="${esc(t('anim.name.ph') || 'Library cards')}" maxlength="${LIMITS.name}"></label>
      </div>
      <label class="anim-toggle"><input type="checkbox" data-f="auto" ${e.auto ? 'checked' : ''}> ${esc(t('anim.auto') || 'Auto-run on appear')}</label>
      ${e.steps.map((s, i) => stepHtml(s, i, e.steps.length)).join('')}
      <button type="button" class="anim-btn" data-anim-act="step-add" ${e.steps.length >= LIMITS.steps ? 'disabled' : ''}>${uiIcon('add', 14)} ${esc(t('anim.step.add') || 'Add step')}</button>
      <div class="anim-strip" aria-hidden="true"></div>
      <div class="anim-rowline">
        <span>
          <button type="button" class="anim-btn" data-anim-act="preview-edit">${uiIcon('play', 14)} ${esc(t('anim.preview') || 'Preview')}</button>
          <button type="button" class="anim-btn" data-anim-act="reset-edit" data-tooltip="${esc(t('anim.reset.tip') || 'Kill running tweens and clear the inline styles they left')}">${uiIcon('reset', 14)} ${esc(t('anim.reset.btn') || 'Reset')}</button>
          <label class="anim-toggle" data-tooltip="${esc(t('anim.live.tip') || 'Replay the preview after every change')}"><input type="checkbox" data-anim-live ${livePreview ? 'checked' : ''}> ${esc(t('anim.live') || 'Live')}</label>
        </span>
        <span>
          <button type="button" class="anim-btn" data-anim-act="cancel">${esc(t('common.cancel') || 'Cancel')}</button>
          <button type="button" class="anim-btn anim-primary" data-anim-act="save">${uiIcon('save', 14)} ${esc(t('anim.save') || 'Save')}</button>
        </span>
      </div>
    </div>`;
}

function importHtml(): string {
  return `
    <div class="anim-import anim-form">
      <label>${esc(t('anim.import.paste') || 'Paste exported JSON')}<textarea data-anim-import spellcheck="false"></textarea></label>
      <div class="anim-rowline">
        <input type="file" accept=".json,application/json" data-anim-file aria-label="${esc(t('anim.import.file') || 'Choose a file')}">
        <span>
          <button type="button" class="anim-btn" data-anim-act="import-cancel">${esc(t('common.cancel') || 'Cancel')}</button>
          <button type="button" class="anim-btn anim-primary" data-anim-act="import-go">${uiIcon('import', 14)} ${esc(t('anim.import') || 'Import')}</button>
        </span>
      </div>
    </div>`;
}

function render() {
  if (!panel) return;
  const list = loadAnims();
  const keepFocus = (document.activeElement as HTMLElement | null)?.getAttribute?.('data-anim-act');
  panel.innerHTML =
    `<div class="anim-head"><h3 id="anim-studio-title">${uiIcon('layers', 14)}${esc(t('anim.title') || 'Animation Studio')}</h3>` +
      ib('import-open', 'import', t('anim.import') || 'Import') +
      ib('export', 'export', t('anim.export') || 'Copy all as JSON', list.length ? '' : ' disabled') +
      `<button type="button" class="anim-btn anim-mini anim-x" data-anim-act="close" aria-label="${esc(t('common.close') || 'Close')}">${uiIcon('close', 14)}</button></div>` +
    (importOpen ? importHtml() : '') +
    rowsHtml(list) +
    (editing ? formHtml(editing) : `<button type="button" class="anim-btn anim-primary anim-new" data-anim-act="new">${uiIcon('add', 14)} ${esc(t('anim.new') || 'New animation')}</button>`) +
    `<datalist id="anim-eases">${COMMON_EASES.map((e) => `<option value="${esc(e)}"></option>`).join('')}</datalist>` +
    `<div class="anim-status" role="status" aria-live="polite"></div>`;
  if (editing) refreshDerived();
  if (keepFocus) panel.querySelector<HTMLElement>(`[data-anim-act="${keepFocus}"]`)?.focus();
}

/** Live feedback that does not need a re-render: match counts, ease curves, the strip. */
function refreshDerived() {
  if (!panel || !editing) return;
  const counts: number[] = [];
  editing.steps.forEach((s, i) => {
    const out = panel!.querySelector(`[data-match="${i}"]`) as HTMLElement | null;
    const inp = panel!.querySelector(`[data-f="selector"][data-step="${i}"]`) as HTMLInputElement | null;
    let n = 0, bad = false;
    if (!s.selector) { if (out) { out.textContent = ''; out.className = 'anim-match'; } }
    else if (!isValidSelector(s.selector)) {
      bad = true;
      if (out) { out.textContent = '⚠ ' + (t('anim.badselector.short') || 'invalid selector'); out.className = 'anim-match bad'; }
    } else {
      n = targets(s.selector).length;
      if (out) { out.textContent = `${n} ${t('anim.matches') || 'match(es)'}`; out.className = 'anim-match' + (n === 0 ? ' bad' : ''); }
    }
    inp?.classList.toggle('bad', bad);
    counts.push(n);
    // Ease curve, drawn from GSAP's own parser so what you see is what will run.
    const svg = panel!.querySelector(`[data-curve="${i}"] path`) as SVGPathElement | null;
    const easeIn = panel!.querySelector(`[data-f="ease"][data-step="${i}"]`) as HTMLInputElement | null;
    const g = (window as any).gsap;
    const ok = easeOk(s.ease);
    easeIn?.classList.toggle('bad', !ok);
    if (svg) {
      let fn: ((p: number) => number) | null = null;
      try { fn = ok && g?.parseEase ? g.parseEase(s.ease) : null; } catch { fn = null; }
      svg.setAttribute('d', fn ? easeCurvePath(fn, 56, 30, 40) : '');
    }
  });
  const strip = panel.querySelector('.anim-strip') as HTMLElement | null;
  if (strip) {
    const c = compileTimeline(editing, counts.map((n) => Math.max(1, n)));
    const total = Math.max(c.total, 0.1);
    strip.innerHTML = c.layout.map((l, i) =>
      `<div class="anim-strip-row${counts[i] ? '' : ' bad'}"><i style="left:${(l.start / total * 100).toFixed(2)}%;width:${((l.end - l.start) / total * 100).toFixed(2)}%"></i></div>`).join('') +
      `<div class="anim-strip-axis"><span>0s</span><span>${total.toFixed(2)}s</span></div>`;
  }
}

function scheduleLive() {
  if (!livePreview || !editing) return;
  if (liveTimer != null) clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => { liveTimer = null; if (editing && !problemOf(editing)) preview(editing, status); }, 450);
}

/** Two-step delete: the first click arms the button, the second (within 3 s) deletes. */
function armDelete(id: string): boolean {
  if (armedDel === id) { disarmDelete(); return true; }
  disarmDelete();
  armedDel = id;
  armTimer = window.setTimeout(() => { disarmDelete(); render(); }, 3000);
  return false;
}
function disarmDelete() {
  armedDel = null;
  if (armTimer != null) { clearTimeout(armTimer); armTimer = null; }
}

function startEdit(a: AnimSeq | null) {
  editing = a ? JSON.parse(JSON.stringify(a)) : null;
  editingDirty = false;
  render();
  if (editing) panel?.querySelector<HTMLElement>('[data-f="name"]')?.focus();
}

function onInput(ev: Event) {
  const el = ev.target as HTMLInputElement;
  if (el.hasAttribute('data-anim-live')) { livePreview = el.checked; if (livePreview) scheduleLive(); return; }
  const f = el.getAttribute('data-f');
  if (!f || !editing) return;
  editingDirty = true;
  if (f === 'name') { editing.name = el.value.slice(0, LIMITS.name); return; }
  if (f === 'auto') { editing.auto = el.checked; return; }
  const i = Number(el.getAttribute('data-step'));
  const s = editing.steps[i];
  if (!s) return;
  const num = (d: number, lo: number, hi: number) => { const v = parseFloat(el.value); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  switch (f) {
    case 'selector': s.selector = el.value.trim(); break;
    case 'preset': s.preset = (PRESET_KEYS.includes(el.value as Preset) ? el.value : 'stagger') as Preset; break;
    case 'ease': s.ease = el.value.trim(); break;
    case 'duration': s.duration = num(s.duration, LIMITS.duration[0], LIMITS.duration[1]); break;
    case 'stagger': s.stagger = num(s.stagger, LIMITS.stagger[0], LIMITS.stagger[1]); break;
    case 'offset': s.offset = num(s.offset, i === 0 ? 0 : LIMITS.offset[0], LIMITS.offset[1]); break;
    case 'at': s.at = el.value === 'with' ? 'with' : 'after'; break;
  }
  refreshDerived();
  scheduleLive();
}

async function doImport() {
  const ta = panel?.querySelector('[data-anim-import]') as HTMLTextAreaElement | null;
  const file = (panel?.querySelector('[data-anim-file]') as HTMLInputElement | null)?.files?.[0];
  let text = ta?.value.trim() || '';
  if (!text && file) {
    if (file.size > 1024 * 1024) { status(t('anim.import.big') || 'File too large (1 MB max).'); return; }
    try { text = await file.text(); } catch { status(t('anim.import.read') || 'Could not read the file.'); return; }
  }
  if (!text) { status(t('anim.import.empty') || 'Paste JSON or choose a file.'); return; }
  const list = loadAnims();
  const res = parseAnimImport(text, { existingIds: list.map((a) => a.id), isValidSelector });
  if (!res.anims.length) {
    ta?.classList.add('bad');
    status((t('anim.import.none') || 'Nothing to import.') + (res.errors.length ? ` (${res.errors.slice(0, 4).join(', ')})` : ''));
    return;
  }
  const merged = [...list, ...res.anims].slice(0, LIMITS.anims);
  if (!saveAnims(merged)) { status(t('anim.savefail') || 'Could not save (storage full?).'); return; }
  importOpen = false;
  render();
  status((t('anim.import.done') || 'Imported') + ` ${res.anims.length}` + (res.errors.length ? ` · ${t('anim.import.skipped') || 'skipped'} ${res.errors.length}` : '') + ` · ${t('anim.import.autooff') || 'auto-run off'}`);
}

async function doExport() {
  const list = loadAnims();
  if (!list.length) return;
  try {
    await navigator.clipboard.writeText(exportAnims(list));
    status((t('anim.export.done') || 'Copied to the clipboard:') + ` ${list.length}`);
  } catch {
    status(t('anim.export.fail') || 'Could not copy.');
  }
}

function onClick(ev: Event) {
  const el = (ev.target as HTMLElement).closest('[data-anim-act]') as HTMLElement | null;
  if (!el) return;
  // Keep panel clicks on the panel — don't let them fall through to the app behind.
  ev.stopPropagation();
  const act = el.getAttribute('data-anim-act');
  const id = el.getAttribute('data-id');
  const si = Number(el.getAttribute('data-step'));
  if (act !== 'del' && armedDel) { disarmDelete(); }
  const list = loadAnims();
  const idx = list.findIndex((a) => a.id === id);
  switch (act) {
    case 'new': startEdit(newAnim()); break;
    case 'edit': startEdit(list[idx] || null); break;
    case 'del':
      if (!id) break;
      if (!armDelete(id)) { render(); status(t('anim.delconfirm') || 'Click again to delete'); break; }
      saveAnims(list.filter((a) => a.id !== id));
      autoDone.delete(id);
      if (editing?.id === id) editing = null;
      installAutoAnimations();
      render();
      break;
    case 'dup': {
      const src = list[idx];
      if (src) {
        // A duplicate never inherits `auto` — otherwise copying an animation silently doubles
        // the motion on every matching element the next time the page renders.
        const copy: AnimSeq = { ...JSON.parse(JSON.stringify(src)), id: newId(), name: (src.name || src.steps[0].preset) + ' ' + (t('anim.copysuffix') || 'copy'), auto: false };
        const next = list.slice();
        next.splice(idx + 1, 0, copy);
        saveAnims(next);
        startEdit(copy);
      }
      break;
    }
    case 'up': case 'down':
      if (idx >= 0) { saveAnims(moveItem(list, idx, idx + (act === 'up' ? -1 : 1))); render(); }
      break;
    case 'play': { const a = list[idx]; if (a) preview(a, status); break; }
    case 'preview-edit': if (editing) preview(editing, status); break;
    case 'reset-edit': resetMotion(editing, status); break;
    case 'step-add':
      if (editing && editing.steps.length < LIMITS.steps) {
        const last = editing.steps[editing.steps.length - 1];
        editing.steps.push({ ...defaultStep(last?.selector || ''), preset: last?.preset || 'stagger' });
        editingDirty = true; render();
      }
      break;
    case 'step-del': if (editing && editing.steps.length > 1) { editing.steps.splice(si, 1); editingDirty = true; render(); } break;
    case 'step-dup': if (editing && editing.steps[si] && editing.steps.length < LIMITS.steps) { editing.steps.splice(si + 1, 0, { ...editing.steps[si], at: 'after' }); editingDirty = true; render(); } break;
    case 'step-up': case 'step-down':
      if (editing) { editing.steps = moveItem(editing.steps, si, si + (act === 'step-up' ? -1 : 1)); editingDirty = true; render(); }
      break;
    case 'pick':
      pickElement((sel) => {
        if (!editing || !editing.steps[si]) return;
        editing.steps[si].selector = sel;
        editingDirty = true;
        const inp = panel?.querySelector(`[data-f="selector"][data-step="${si}"]`) as HTMLInputElement | null;
        if (inp) { inp.value = sel; inp.focus(); }
        refreshDerived();
        scheduleLive();
        status((t('anim.picked') || 'Picked') + ` ${sel}`);
      });
      status(t('anim.picking') || 'Hover to highlight, click to pick, Esc to cancel');
      break;
    case 'cancel': editing = null; editingDirty = false; render(); break;
    case 'save': {
      if (!editing) break;
      const bad = problemOf(editing);
      if (bad) { status(bad); break; }
      const a = withMirror({ ...editing, name: editing.name.trim() || editing.steps[0].preset });
      const pos = list.findIndex((x) => x.id === a.id);
      const next = list.slice();
      if (pos >= 0) next[pos] = a; else next.push(a);
      if (!saveAnims(next)) { status(t('anim.savefail') || 'Could not save (storage full?).'); break; }
      editing = null;
      editingDirty = false;
      autoDone.delete(a.id);
      installAutoAnimations();
      render();
      status(t('anim.saved') || 'Saved.');
      break;
    }
    case 'import-open': importOpen = !importOpen; render(); panel?.querySelector<HTMLElement>('[data-anim-import]')?.focus(); break;
    case 'import-cancel': importOpen = false; render(); break;
    case 'import-go': void doImport(); break;
    case 'export': void doExport(); break;
    case 'close': closeAnimStudio(); break;
  }
}

/** Open the Animation Studio panel (from the DevTools menu). Idempotent. */
export function openAnimStudio() {
  ensureStyles();
  if (panel && panel.isConnected) { panel.style.display = 'block'; panel.querySelector<HTMLElement>('.anim-btn')?.focus(); return; }
  panel = document.createElement('div');
  panel.className = 'anim-panel bmm-no-record';
  panel.setAttribute('data-bmm-no-record', '1');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'anim-studio-title');
  panel.addEventListener('click', onClick);
  panel.addEventListener('input', onInput);
  panel.addEventListener('change', onInput);
  // Esc inside the panel: first closes the import box, then cancels an edit, then closes the
  // studio. An edit with changes asks for a second Esc instead of dropping them.
  let escArmed = false;
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    if (importOpen) { importOpen = false; render(); return; }
    if (editing) {
      if (editingDirty && !escArmed) {
        escArmed = true;
        window.setTimeout(() => { escArmed = false; }, 3000);
        status(t('anim.esc.confirm') || 'Unsaved changes. Press Esc again to discard.');
        return;
      }
      escArmed = false;
      editing = null; editingDirty = false; render(); panel?.querySelector<HTMLElement>('.anim-btn')?.focus();
    } else closeAnimStudio();
  });
  // In the app frame like every other overlay (on <body> it spilled over the window margin).
  (document.getElementById('app-window-outer') || document.body).appendChild(panel);
  editing = null;
  importOpen = false;
  render();
  panel.querySelector<HTMLElement>('.anim-btn')?.focus();
  // Load GSAP now so ease curves and ease validation use the real parser.
  ensureGsap().then(() => refreshDerived()).catch(() => { /* reported on first preview */ });
  if (reducedMotion()) status(t('anim.reduced') || 'Reduced motion is on: auto-run is paused.');
  document.dispatchEvent(new CustomEvent('bmm-debug-studio'));
}

export function isAnimStudioOpen(): boolean {
  return !!(panel && panel.isConnected);
}

/** Close the studio and undo what its previews did. Idempotent; every step runs even if an
 *  earlier one throws. Saved auto-run animations are NOT touched — they are the user's. */
export function closeAnimStudio() {
  const steps: Array<() => unknown> = [
    () => { cancelPick?.(); cancelPick = null; },
    () => { if (liveTimer != null) { clearTimeout(liveTimer); liveTimer = null; } },
    () => disarmDelete(),
    () => {
      // Stop preview tweens still running and clear what they left inline, so no element
      // is left half-faded or offset once the studio is gone.
      const g = (window as any).gsap;
      try { previewTl?.kill?.(); } catch { /* ignore */ }
      previewTl = null;
      const els: Element[] = [];
      for (const ref of touched) { const el = ref.deref(); if (el && el.isConnected) els.push(el); }
      touched = new Set();
      if (!els.length) return;
      try { g?.killTweensOf?.(els); } catch { /* ignore */ }
      els.forEach((el) => {
        const st = (el as HTMLElement).style;
        if (!st) return;
        ['opacity', 'transform', 'translate', 'scale', 'rotate', 'visibility'].forEach((prop) => st.removeProperty(prop));
      });
    },
    () => { panel?.remove(); },
  ];
  for (const step of steps) {
    try { step(); } catch (e) { console.warn('[Animation Studio] close step failed', e); }
  }
  panel = null;
  editing = null;
  editingDirty = false;
  importOpen = false;
  document.dispatchEvent(new CustomEvent('bmm-debug-studio'));
}
