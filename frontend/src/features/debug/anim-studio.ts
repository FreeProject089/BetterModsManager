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
// GSAP is already vendored globally (assets/vendor/gsap.min.js) and used elsewhere via
// window.gsap; we just make sure it's loaded, then drive it. Persists to localStorage.

import { t } from '../../core/i18n.js';

type Preset = 'fadeIn' | 'slideUp' | 'slideDown' | 'pop' | 'pulse' | 'flyInLeft' | 'flyInRight' | 'stagger';
interface Anim {
  id: string;
  name: string;
  selector: string;
  preset: Preset;
  duration: number;
  delay: number;
  stagger: number;
  ease: string;
  auto: boolean;
}

const PRESETS: Record<Preset, (g: any, els: any, a: Anim) => void> = {
  fadeIn:     (g, els, a) => g.from(els, { opacity: 0, duration: a.duration, delay: a.delay, stagger: a.stagger, ease: a.ease }),
  slideUp:    (g, els, a) => g.from(els, { opacity: 0, y: 24, duration: a.duration, delay: a.delay, stagger: a.stagger, ease: a.ease }),
  slideDown:  (g, els, a) => g.from(els, { opacity: 0, y: -24, duration: a.duration, delay: a.delay, stagger: a.stagger, ease: a.ease }),
  pop:        (g, els, a) => g.from(els, { opacity: 0, scale: 0.85, duration: a.duration, delay: a.delay, stagger: a.stagger, ease: a.ease || 'back.out(1.7)' }),
  pulse:      (g, els, a) => g.fromTo(els, { scale: 1 }, { scale: 1.06, duration: a.duration || 0.25, yoyo: true, repeat: 1, delay: a.delay, stagger: a.stagger, ease: a.ease || 'power1.inOut' }),
  flyInLeft:  (g, els, a) => g.from(els, { opacity: 0, x: -40, duration: a.duration, delay: a.delay, stagger: a.stagger, ease: a.ease }),
  flyInRight: (g, els, a) => g.from(els, { opacity: 0, x: 40, duration: a.duration, delay: a.delay, stagger: a.stagger, ease: a.ease }),
  stagger:    (g, els, a) => g.from(els, { opacity: 0, y: 20, scale: 0.96, duration: a.duration || 0.5, delay: a.delay, stagger: a.stagger || 0.06, ease: a.ease || 'power2.out' }),
};
const PRESET_KEYS = Object.keys(PRESETS) as Preset[];

const LS = 'bmm_custom_anims';
function loadAnims(): Anim[] { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } }
function saveAnims(list: Anim[]) { try { localStorage.setItem(LS, JSON.stringify(list)); } catch { /* ignore */ } }

// GSAP loader (mirrors the rrweb loader). Resolves window.gsap.
function ensureGsap(): Promise<any> {
  const w = window as any;
  if (w.gsap) return Promise.resolve(w.gsap);
  if (w.__gsapLoading) return w.__gsapLoading;
  w.__gsapLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/gsap.min.js';
    s.async = true;
    s.onload = () => resolve((window as any).gsap);
    s.onerror = () => reject(new Error('gsap failed to load'));
    document.head.appendChild(s);
  });
  return w.__gsapLoading;
}

function newAnim(): Anim {
  return { id: 'a' + Date.now().toString(36), name: '', selector: '', preset: 'stagger', duration: 0.5, delay: 0, stagger: 0.06, ease: 'power2.out', auto: false };
}

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

// ── run / preview ──
function runOn(g: any, a: Anim, els: Element[]) {
  if (!els.length) return;
  try { PRESETS[a.preset]?.(g, els, a); } catch { /* ignore a bad tween */ }
}
function preview(a: Anim, setStatus: (m: string) => void) {
  const sel = a.selector || '*:not(html):not(body)';
  if (!isValidSelector(sel)) { setStatus((t('anim.badselector') || 'Not a valid CSS selector:') + ` "${a.selector}"`); return; }
  ensureGsap().then((g) => {
    const els = Array.from(document.querySelectorAll(sel));
    if (!els.length) { setStatus((t('anim.nomatch') || 'No element matches') + ` "${a.selector}"`); return; }
    els.forEach((el) => { delete (el as HTMLElement).dataset.animDone; });
    runOn(g, a, els);
    setStatus((t('anim.played') || 'Played on') + ` ${els.length}`);
  }).catch(() => setStatus(t('anim.nogsap') || 'GSAP unavailable'));
}

/** Kill anything still tweening and clear the inline styles GSAP left behind, so a preview
 *  that ended mid-flight (or a `from` that never completed) can't leave the UI stuck at
 *  opacity 0 — which is exactly how a bad tween used to make part of the app disappear. */
function resetMotion(a: Anim | null, setStatus: (m: string) => void) {
  const sel = a?.selector && isValidSelector(a.selector) ? a.selector : null;
  ensureGsap().then((g) => {
    const els = Array.from(document.querySelectorAll(sel || '[style]'));
    try { g.killTweensOf(els); } catch { /* ignore */ }
    els.forEach((el) => {
      const s = (el as HTMLElement).style;
      ['opacity', 'transform', 'translate', 'scale', 'rotate'].forEach((p) => s.removeProperty(p));
      delete (el as HTMLElement).dataset.animDone;
    });
    setStatus((t('anim.reset') || 'Motion reset on') + ` ${els.length}`);
  }).catch(() => setStatus(t('anim.nogsap') || 'GSAP unavailable'));
}

// ── auto-run: play an anim on freshly-appeared matches (so e.g. mod cards animate when the
// Library page renders). Debounced so a burst of DOM inserts animates as ONE staggered group. ──
let observer: MutationObserver | null = null;
let debounce: number | null = null;
function runAutos() {
  ensureGsap().then((g) => {
    for (const a of loadAnims().filter((x) => x.auto && x.selector)) {
      // Per-animation guard: one saved animation with a broken selector used to throw here and
      // abort the whole loop, silently killing every OTHER auto animation on the page.
      try {
        if (!isValidSelector(a.selector)) continue;
        const els = Array.from(document.querySelectorAll(a.selector)).filter((el) => !(el as HTMLElement).dataset.animDone);
        if (!els.length) continue;
        els.forEach((el) => { (el as HTMLElement).dataset.animDone = '1'; });
        runOn(g, a, els);
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
function cssSelector(el: Element): string {
  if (el.id) return '#' + el.id;
  const cn = typeof el.className === 'string' ? el.className.trim() : '';
  const cls = cn ? '.' + cn.split(/\s+/).filter((c) => c && !c.startsWith('rstudio') && !c.startsWith('anim-')).slice(0, 2).join('.') : '';
  return el.tagName.toLowerCase() + cls;
}
// A shared hover-highlight box so the user SEES what they're about to target while picking.
// Returns a controller with move()/done(). Self-contained (its own fixed overlay, no CSS dep).
function makeHighlighter() {
  const box = document.createElement('div');
  box.setAttribute('data-bmm-no-record', '1');
  Object.assign(box.style, {
    position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', border: '2px solid #3b82f6',
    background: 'rgba(59,130,246,.12)', borderRadius: '4px', transition: 'all .05s linear', display: 'none',
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

function pickElement(cb: (sel: string) => void) {
  const hi = makeHighlighter();
  const finish = () => { document.removeEventListener('click', onClick, true); document.removeEventListener('mousemove', onMove, true); document.removeEventListener('keydown', onKey, true); hi.done(); };
  const onMove = (e: MouseEvent) => { const el = e.target as Element; hi.move(el && !el.closest('.anim-panel') ? el : null); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(); status(t('anim.pickcancel') || 'Pick cancelled'); } };
  const onClick = (e: MouseEvent) => {
    const el = e.target as Element;
    if (el.closest('.anim-panel')) return; // ignore clicks on our own panel
    e.preventDefault(); e.stopPropagation();
    finish();
    cb(cssSelector(el));
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

// ── UI panel ──
let panel: HTMLElement | null = null;
let editing: Anim | null = null;

function ensureStyles() {
  if (document.getElementById('anim-studio-styles')) return;
  const s = document.createElement('style');
  s.id = 'anim-studio-styles';
  s.textContent = `
  .anim-panel{position:fixed;right:20px;bottom:20px;z-index:2147483647;isolation:isolate;pointer-events:auto;
    width:340px;max-width:94vw;max-height:70vh;overflow:auto;
    background:#161b22;color:#e6edf3;border:1px solid #2a2f3a;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.5);
    font:500 13px/1.35 system-ui,sans-serif;padding:12px;}
  .anim-panel h3{margin:0 0 8px;font-size:14px;font-weight:800;color:#3b82f6;display:flex;justify-content:space-between;align-items:center;}
  .anim-row{display:flex;align-items:center;gap:6px;padding:7px 8px;border:1px solid #2a2f3a;border-radius:10px;margin-bottom:6px;background:#0d1117;}
  .anim-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}
  .anim-row .sel{font-size:11px;opacity:.6;}
  .anim-btn{border:1px solid #2a2f3a;background:#0d1117;color:#e6edf3;border-radius:8px;padding:5px 9px;cursor:pointer;font:inherit;}
  .anim-btn:hover{background:#1c2333;border-color:#3b82f6;}
  .anim-primary{background:var(--bmm-accent,#3b82f6);border-color:var(--bmm-accent,#3b82f6);color:var(--bmm-text-on-accent);}
  .anim-primary:hover{background:#2563eb;}
  .anim-mini{padding:4px 7px;font-size:12px;}
  .anim-form{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px;padding-top:10px;border-top:1px solid #2a2f3a;}
  .anim-form label{display:flex;flex-direction:column;gap:3px;font-size:11px;opacity:.8;}
  .anim-form .wide{grid-column:1/-1;}
  .anim-form input,.anim-form select{background:#0d1117;color:#e6edf3;border:1px solid #2a2f3a;border-radius:7px;padding:5px 7px;font:inherit;}
  .anim-form .rowline{grid-column:1/-1;display:flex;gap:8px;align-items:center;justify-content:space-between;}
  .anim-status{font-size:11px;opacity:.75;margin-top:6px;min-height:14px;}
  /* The studio overlays deliberately keep their own dark chrome (they must stay readable on
     top of ANY theme, including the light ones, while a recording is running). */
  .anim-panel{--anim-warn:#f59e0b;}
  .anim-match{font-size:10.5px;opacity:.7;margin-top:3px;min-height:13px;}
  .anim-match.bad{color:var(--anim-warn);opacity:1;}
  .anim-row-bad{border-color:var(--anim-warn);}
  .anim-row-bad .sel{color:var(--anim-warn);opacity:.95;}
  .anim-toggle{display:flex;align-items:center;gap:5px;font-size:11px;}
  `;
  document.head.appendChild(s);
}

function status(msg: string) {
  const el = panel?.querySelector('.anim-status') as HTMLElement | null;
  if (el) el.textContent = msg;
}

function render() {
  if (!panel) return;
  const list = loadAnims();
  const rows = list.map((a) => {
    const bad = a.selector && !isValidSelector(a.selector);
    return `
    <div class="anim-row${bad ? ' anim-row-bad' : ''}" data-id="${esc(a.id)}">
      <div style="flex:1;min-width:0">
        <div class="nm">${esc(a.name || a.preset)}${a.auto ? ' <span data-tooltip="Auto-runs when the target appears">⟳</span>' : ''}</div>
        <div class="sel">${bad ? '⚠ ' : ''}${esc(a.selector || '—')} · ${esc(a.preset)}</div>
      </div>
      <button class="anim-btn anim-mini" data-act="play" data-id="${esc(a.id)}" data-tooltip="${t('anim.preview') || 'Preview'}">▶</button>
      <button class="anim-btn anim-mini" data-act="edit" data-id="${esc(a.id)}" data-tooltip="${t('anim.edit') || 'Edit'}">✎</button>
      <button class="anim-btn anim-mini" data-act="dup" data-id="${esc(a.id)}" data-tooltip="${t('anim.duplicate') || 'Duplicate'}">⧉</button>
      <button class="anim-btn anim-mini" data-act="del" data-id="${esc(a.id)}" data-tooltip="${t('anim.delete') || 'Delete'}">✕</button>
    </div>`;
  }).join('') || `<div style="opacity:.6;padding:8px 2px">${t('anim.none') || 'No animations yet — add one below.'}</div>`;

  const e = editing;
  const form = e ? `
    <div class="anim-form">
      <label class="wide">${t('anim.name') || 'Name'}<input data-f="name" value="${esc(e.name)}" placeholder="Library cards"></label>
      <label class="wide">${t('anim.selector') || 'Target selector'}
        <span style="display:flex;gap:6px"><input data-f="selector" value="${esc(e.selector)}" placeholder=".mod-item" style="flex:1">
        <button class="anim-btn anim-mini" data-act="pick">${t('anim.pick') || 'Pick'}</button></span>
        <span class="anim-match"></span></label>
      <label>${t('anim.preset') || 'Preset'}<select data-f="preset">${PRESET_KEYS.map((p) => `<option value="${p}" ${e.preset === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label>${t('anim.ease') || 'Ease'}<input data-f="ease" value="${esc(e.ease)}"></label>
      <label>${t('anim.duration') || 'Duration (s)'}<input data-f="duration" type="number" step="0.05" value="${e.duration}"></label>
      <label>${t('anim.delay') || 'Delay (s)'}<input data-f="delay" type="number" step="0.05" value="${e.delay}"></label>
      <label>${t('anim.stagger') || 'Stagger (s)'}<input data-f="stagger" type="number" step="0.01" value="${e.stagger}"></label>
      <label class="anim-toggle" style="align-self:end"><input type="checkbox" data-f="auto" ${e.auto ? 'checked' : ''}> ${t('anim.auto') || 'Auto-run on appear'}</label>
      <div class="rowline">
        <span><button class="anim-btn" data-act="preview-edit">${t('anim.preview') || 'Preview'}</button>
        <button class="anim-btn" data-act="reset-edit" data-tooltip="${t('anim.reset.tip') || 'Kill running tweens and clear the inline styles they left'}">${t('anim.reset.btn') || 'Reset'}</button></span>
        <span><button class="anim-btn" data-act="cancel">${t('common.cancel') || 'Cancel'}</button>
        <button class="anim-btn anim-primary" data-act="save">${t('anim.save') || 'Save'}</button></span>
      </div>
    </div>` : `<button class="anim-btn anim-primary" style="width:100%;margin-top:8px" data-act="new">＋ ${t('anim.new') || 'New animation'}</button>`;

  panel.innerHTML =
    `<h3>${t('anim.title') || 'Animation Studio'} <button class="anim-btn anim-mini" data-act="close">✕</button></h3>` +
    rows + form +
    `<div class="anim-status"></div>`;

  // Live feedback on the selector: how many elements it hits right now, or that it is invalid.
  // Without it you only found out by pressing Preview and reading an error.
  const selIn = panel.querySelector('[data-f="selector"]') as HTMLInputElement | null;
  if (selIn) { selIn.addEventListener('input', updateMatchCount); updateMatchCount(); }
}

function updateMatchCount() {
  const out = panel?.querySelector('.anim-match') as HTMLElement | null;
  const inp = panel?.querySelector('[data-f="selector"]') as HTMLInputElement | null;
  if (!out || !inp) return;
  const sel = inp.value.trim();
  if (!sel) { out.textContent = ''; out.className = 'anim-match'; return; }
  if (!isValidSelector(sel)) {
    out.textContent = '⚠ ' + (t('anim.badselector.short') || 'invalid selector');
    out.className = 'anim-match bad';
    return;
  }
  const n = document.querySelectorAll(sel).length;
  out.textContent = `${n} ${t('anim.matches') || 'match(es)'}`;
  out.className = 'anim-match' + (n === 0 ? ' bad' : '');
}

function readForm(): Anim | null {
  if (!panel || !editing) return null;
  const g = (f: string) => panel!.querySelector(`[data-f="${f}"]`) as HTMLInputElement | HTMLSelectElement | null;
  const num = (f: string, d: number) => { const v = parseFloat((g(f) as HTMLInputElement)?.value); return Number.isFinite(v) ? v : d; };
  return {
    ...editing,
    name: (g('name') as HTMLInputElement)?.value.trim() || '',
    selector: (g('selector') as HTMLInputElement)?.value.trim() || '',
    preset: ((g('preset') as HTMLSelectElement)?.value || 'stagger') as Preset,
    ease: (g('ease') as HTMLInputElement)?.value.trim() || 'power2.out',
    duration: num('duration', 0.5),
    delay: num('delay', 0),
    stagger: num('stagger', 0.06),
    auto: (g('auto') as HTMLInputElement)?.checked || false,
  };
}

function onClick(ev: Event) {
  const el = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!el) return;
  // Keep panel clicks on the panel — don't let them fall through to the app behind.
  ev.stopPropagation();
  const act = el.getAttribute('data-act');
  const id = el.getAttribute('data-id');
  const list = loadAnims();
  switch (act) {
    case 'new': editing = newAnim(); render(); break;
    case 'edit': editing = list.find((a) => a.id === id) || null; render(); break;
    case 'del': saveAnims(list.filter((a) => a.id !== id)); installAutoAnimations(); render(); break;
    case 'dup': {
      const src = list.find((a) => a.id === id);
      if (src) {
        // A duplicate never inherits `auto` — otherwise copying an animation silently doubles
        // the motion on every matching element the next time the page renders.
        const copy: Anim = { ...src, id: 'a' + Date.now().toString(36), name: (src.name || src.preset) + ' copy', auto: false };
        saveAnims([...list, copy]);
        editing = copy;
        render();
      }
      break;
    }
    case 'play': { const a = list.find((x) => x.id === id); if (a) preview(a, status); break; }
    case 'preview-edit': { const a = readForm(); if (a) preview(a, status); break; }
    case 'reset-edit': resetMotion(readForm(), status); break;
    case 'pick': pickElement((sel) => { const inp = panel?.querySelector('[data-f="selector"]') as HTMLInputElement | null; if (inp) inp.value = sel; status((t('anim.picked') || 'Picked') + ` ${sel}`); }); status(t('anim.picking') || 'Hover to highlight, click to pick — Esc to cancel'); break;
    case 'cancel': editing = null; render(); break;
    case 'save': {
      const a = readForm(); if (!a) break;
      if (!a.name) a.name = a.preset;
      const rest = list.filter((x) => x.id !== a.id);
      saveAnims([...rest, a]);
      editing = null;
      installAutoAnimations();
      render();
      status(t('anim.saved') || 'Saved.');
      break;
    }
    case 'close': closeAnimStudio(); break;
  }
}

/** Open the Animation Studio panel (from the DevTools menu). */
export function openAnimStudio() {
  ensureStyles();
  if (panel) { panel.style.display = 'block'; return; }
  panel = document.createElement('div');
  panel.className = 'anim-panel bmm-no-record';
  panel.setAttribute('data-bmm-no-record', '1');
  panel.addEventListener('click', onClick);
  document.body.appendChild(panel);
  editing = null;
  render();
}

export function closeAnimStudio() {
  panel?.remove();
  panel = null;
  editing = null;
}
