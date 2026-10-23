// doc-guide-ui.ts — the interactive parts of a guide page in Help & other.
//
// md-lite renders three things for our own pages and leaves them inert:
//   · `.dh-show[data-show]`      a « Show me » button (what it may do: doc-actions.ts)
//   · `ul.dh-tasks input[data-ck]` a tickable step
//   · `img.dh-gif`               an animated GIF
// This file brings them to life once the page is in the DOM, and handles their clicks.
//
// Nothing here reads a page's text as code. A button carries a NAME that doc-actions.ts maps to
// a fixed action; a tick is a hash in localStorage (a preference: every access is in try/catch,
// and the page reads fine without it); a GIF is a still until the reader presses play.

import { CHECK_STORE, readChecks, toggleCheck, runShow, type ShowDeps } from './doc-actions.js';
import { uiIcon } from '../ui/icons.js';

type L = { en: string; fr: string };
type Tr = (l: L) => string;

// ── tickable steps ───────────────────────────────────────────────────────────
function loadChecks(): Record<string, string[]> {
  try { return readChecks(localStorage.getItem(CHECK_STORE)); } catch { return {}; }
}
function saveChecks(store: Record<string, string[]>): void {
  try { localStorage.setItem(CHECK_STORE, JSON.stringify(store)); } catch { /* a preference only */ }
}

/** Which page a node belongs to: the standalone reader's path, or a full page open in an article. */
export function pageKeyOf(el: Element): string {
  const reader = el.closest('[data-reader]');
  if (reader) return reader.getAttribute('data-reader') || '';
  const art = el.closest('.dh-article') as HTMLElement | null;
  return art?.dataset.full || art?.dataset.art || '';
}

function updateCount(list: HTMLElement, tr: Tr): void {
  const boxes = [...list.querySelectorAll<HTMLInputElement>('input[data-ck]')];
  const done = boxes.filter((b) => b.checked).length;
  boxes.forEach((b) => b.closest('li')?.classList.toggle('is-done', b.checked));
  // One step needs no « 1 of 1 » line.
  if (boxes.length < 2) return;
  let c = list.previousElementSibling as HTMLElement | null;
  if (!c?.classList.contains('dh-ck-count')) {
    c = document.createElement('div');
    c.className = 'dh-ck-count';
    list.parentNode?.insertBefore(c, list);
  }
  c.textContent = done === boxes.length
    ? tr({ en: `All ${boxes.length} steps done`, fr: `Les ${boxes.length} étapes sont faites` })
    : tr({ en: `${done} of ${boxes.length} steps done`, fr: `${done} étape(s) sur ${boxes.length} faite(s)` });
  c.classList.toggle('is-done', done === boxes.length);
}

/** Restore the ticks of this page and add the « n of m » line + a Reset button. */
export function hydrateTasks(host: HTMLElement, tr: Tr): void {
  const lists = [...host.querySelectorAll<HTMLElement>('ul[data-ck-list]')];
  if (!lists.length) return;
  const store = loadChecks();
  for (const list of lists) {
    const page = pageKeyOf(list);
    const ticked = new Set(store[page] || []);
    list.querySelectorAll<HTMLInputElement>('input[data-ck]').forEach((b) => {
      b.checked = ticked.has(b.dataset.ck || '') || (ticked.size === 0 && b.hasAttribute('data-ck-default'));
    });
    updateCount(list, tr);
    if (!list.querySelector('.dh-ck-reset')) {
      const r = document.createElement('button');
      r.type = 'button';
      r.className = 'dh-ck-reset';
      r.textContent = tr({ en: 'Start over', fr: 'Recommencer' });
      r.setAttribute('data-ck-reset', '1');
      list.after(r);
    }
  }
}

/** A click on a step's box or on « Start over ». True when it was one of ours. */
export function onTaskClick(target: HTMLElement, tr: Tr): boolean {
  const reset = target.closest('[data-ck-reset]') as HTMLElement | null;
  if (reset) {
    const list = reset.previousElementSibling as HTMLElement | null;
    if (list?.matches('ul[data-ck-list]')) {
      const page = pageKeyOf(list);
      let store = loadChecks();
      list.querySelectorAll<HTMLInputElement>('input[data-ck]').forEach((b) => { b.checked = false; store = toggleCheck(store, page, b.dataset.ck || '', false); });
      saveChecks(store);
      updateCount(list, tr);
    }
    return true;
  }
  if (target instanceof HTMLInputElement && target.dataset.ck) {
    const list = target.closest('ul[data-ck-list]') as HTMLElement | null;
    if (!list) return true;
    // A page whose boxes were all ticked by default and have never been touched stores the
    // WHOLE state on the first click, so « default ticked » cannot come back after an untick.
    const page = pageKeyOf(list);
    let store = loadChecks();
    list.querySelectorAll<HTMLInputElement>('input[data-ck]').forEach((b) => { store = toggleCheck(store, page, b.dataset.ck || '', b.checked); });
    saveChecks(store);
    updateCount(list, tr);
    return true;
  }
  return false;
}

// ── « Show me » buttons ──────────────────────────────────────────────────────
/** Run a button's action. False when the name is not on the allow-list (nothing happened). */
export function onShowClick(target: HTMLElement, deps: ShowDeps): boolean {
  const b = target.closest('.dh-show') as HTMLElement | null;
  if (!b) return false;
  runShow(b.getAttribute('data-show') || '', deps);
  return true;
}

// ── GIFs: a still until you press play ───────────────────────────────────────
const STILL_FAIL = 'dh-gif-plain';

function mountGif(img: HTMLImageElement, tr: Tr): void {
  if (img.closest('.dh-gif-fig') || img.classList.contains(STILL_FAIL)) return;
  const alt = img.alt || '';
  const fig = document.createElement('figure');
  fig.className = 'dh-gif-fig';
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'dh-gifcard';
  card.setAttribute('aria-label', tr({ en: 'Play the animation', fr: 'Lancer l’animation' }) + (alt ? `: ${alt}` : ''));
  const badge = document.createElement('span');
  badge.className = 'dh-gif-badge';
  badge.innerHTML = `${uiIcon('play', 16)}<span>${tr({ en: 'Play', fr: 'Lire' })}</span>`;
  const cap = alt ? document.createElement('figcaption') : null;
  if (cap) cap.textContent = alt;

  const src = img.getAttribute('src') || '';
  let playing = false;
  const canvas = document.createElement('canvas');
  canvas.className = 'dh-gif-still';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', alt);

  const freeze = () => {
    // The current frame becomes the still, so pausing does not jump back to frame one.
    try {
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
    } catch { /* keep the old still */ }
  };
  const showStill = () => { playing = false; img.replaceWith(canvas); card.classList.remove('is-playing'); card.setAttribute('aria-pressed', 'false'); };
  const play = () => {
    playing = true;
    // Reloading the same URL restarts the animation from its first frame.
    img.src = '';
    img.src = src;
    canvas.replaceWith(img);
    card.classList.add('is-playing');
    card.setAttribute('aria-pressed', 'true');
  };
  card.addEventListener('click', (e) => {
    e.stopPropagation();
    if (playing) { freeze(); showStill(); } else play();
  });

  const draw = () => {
    try {
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
    } catch { img.classList.add(STILL_FAIL); return; }       // cannot freeze it: leave the GIF as it was
    img.replaceWith(fig);
    card.append(canvas, badge);
    fig.append(card);
    if (cap) fig.append(cap);
  };
  if (img.complete && img.naturalWidth) draw();
  else {
    img.addEventListener('load', draw, { once: true });
    img.addEventListener('error', () => img.classList.add(STILL_FAIL), { once: true });
  }
}

/** Turn every `img.dh-gif` of a page into a still with a play button. */
export function hydrateGifs(host: HTMLElement, tr: Tr): void {
  host.querySelectorAll<HTMLImageElement>('img.dh-gif').forEach((img) => {
    // `loading=lazy` would hold the load event until the image scrolls near; we want the first
    // frame as soon as the page is up, and local files are cheap.
    img.loading = 'eager';
    mountGif(img, tr);
  });
}
