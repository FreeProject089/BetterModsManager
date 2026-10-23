// The « stage »: real BMM pages (screenshots) placed with CSS, flat or barely turned, rendered by
// headless Chrome. SVG has no perspective, so the release cards and the hero draw their windows
// here and embed the result as raster layers in their layered SVG / PSD; the background and the
// text stay vector. One stage serves three uses:
//   - one layer alone (a window), transparent, the size of the whole picture;
//   - the composite (under + windows + over);
//   - animation frames: every window floats on its own sine (amplitude, phase, tilt), so the
//     loop closes on itself (t = 0 and t = period draw the same picture).
//
// A window item: { id, label, src (data URI), srcW, srcH, crop {x,y,w,h} in source px,
//   x, y, w (box on the stage; h follows the crop's ratio), radius, rotate {x,y,z} (deg),
//   perspective (px), origin (CSS), shadow {dy, blur, alpha}, glow (CSS colour or null, behind),
//   reflect (0..1, a floor reflection), sheen (false: no soft light across the glass), float {amp (px), rot (deg), phase (0..1)} }.
//
// The stage itself: { w, h, period (s), under (SVG markup or ''), over (SVG markup or ''), items }.

import { readFileSync } from 'node:fs';
import { CANVAS } from '../screenshots/shoot.mjs';

/** Where BMM's window sits in a screenshot of shoot.mjs (1560×960 at 56,56, 14 px corners). */
export const WINDOW = { x: CANVAS.windowAt, y: CANVAS.windowAt, w: CANVAS.width - CANVAS.windowAt - CANVAS.windowEnd, h: CANVAS.height - CANVAS.windowAt - CANVAS.windowEnd, radius: 14 };

export const dataUri = (p, mime = 'image/png') => `data:${mime};base64,${readFileSync(p).toString('base64')}`;

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** The height of an item on the stage (the crop's ratio at its width). */
export const itemHeight = (it) => Math.round(it.w * (it.crop.h / it.crop.w));

/** CSS transform of an item at time t (seconds). Pure: the tests check the loop closes. */
export function itemTransform(it, t = 0, period = 6) {
  const r = it.rotate || {};
  const f = it.float || {};
  const ph = 2 * Math.PI * ((t / period) + num(f.phase));
  const dy = num(f.amp) * Math.sin(ph);
  const rz = num(f.rot) * Math.sin(ph + Math.PI / 3);
  const fx = num(f.drift) * Math.cos(ph);
  return `translate3d(${fx.toFixed(3)}px, ${dy.toFixed(3)}px, ${num(it.z)}px) rotateX(${num(r.x)}deg) rotateY(${num(r.y)}deg) rotateZ(${(num(r.z) + rz).toFixed(4)}deg)`;
}

function itemHtml(it, period) {
  const h = itemHeight(it);
  const s = it.w / it.crop.w;                        // display px per source px
  const sh = it.shadow ?? { dy: 40, blur: 70, alpha: 0.55 };
  const shadows = [
    `0 ${sh.dy}px ${sh.blur}px rgba(0,0,0,${sh.alpha})`,
    `0 ${Math.round(sh.dy / 4)}px ${Math.round(sh.blur / 4)}px rgba(0,0,0,${(sh.alpha * 0.6).toFixed(2)})`,
    it.glow ? `0 0 ${Math.round(it.w * 0.18)}px ${it.glow}` : null,
  ].filter(Boolean).join(', ');
  const reflect = it.reflect ? `-webkit-box-reflect: below ${Math.round(h * 0.02)}px linear-gradient(transparent 68%, rgba(255,255,255,${it.reflect}));` : '';
  const face = `<div class="face" data-id="${it.id}" style="border-radius:${it.radius ?? WINDOW.radius * s}px;box-shadow:${shadows};${reflect}
    background-image:url('${it.src}');background-size:${(it.srcW * s).toFixed(2)}px ${(it.srcH * s).toFixed(2)}px;background-position:${(-it.crop.x * s).toFixed(2)}px ${(-it.crop.y * s).toFixed(2)}px">${it.sheen === false ? '' : '<i class="sheen"></i>'}</div>`;
  return `<div class="item" data-item="${it.id}" style="left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${h}px;perspective:${num(it.perspective, 2400)}px">
    <div class="card" data-card="${it.id}" style="transform-origin:${it.origin ?? '50% 50%'};transform:${itemTransform(it, 0, period)}">${face}</div></div>`;
}

/** The whole stage as an HTML document. `only` = one layer id (an item, 'under' or 'over'). */
export function stageHtml(stage, { only = null } = {}) {
  const { w, h, period = 6 } = stage;
  const css = `html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  .stage{position:relative;width:${w}px;height:${h}px;overflow:hidden}
  .layer{position:absolute;inset:0}.layer>svg{display:block}
  .item{position:absolute;transform-style:preserve-3d}
  .card{position:absolute;inset:0;transform-style:preserve-3d;will-change:transform}
  .face{position:absolute;inset:0;background-repeat:no-repeat;outline:1px solid rgba(255,255,255,0.10);outline-offset:-1px;overflow:hidden}
  .sheen{position:absolute;inset:0;background:linear-gradient(118deg,rgba(255,255,255,0.10) 0%,rgba(255,255,255,0.02) 28%,rgba(255,255,255,0) 46%,rgba(255,255,255,0) 100%)}
  body.only .layer,body.only .face{visibility:hidden}
  body.only [data-id="${only ?? ''}"]{visibility:visible}`;
  const items = (stage.items || []).map((it) => itemHtml(it, period)).join('\n');
  const script = `<script>
    const ITEMS = ${JSON.stringify((stage.items || []).map((it) => ({ id: it.id, rotate: it.rotate, float: it.float, z: it.z })))};
    const PERIOD = ${period};
    ${itemTransform.toString()}
    function num(v, d = 0) { return Number.isFinite(v) ? v : d; }
    window.__setT = (t) => { for (const it of ITEMS) { const el = document.querySelector('[data-card="' + it.id + '"]'); if (el) el.style.transform = itemTransform(it, t, PERIOD); } };
    window.__only = (id) => { document.body.classList.toggle('only', !!id); document.querySelectorAll('[data-id]').forEach((e) => e.style.visibility = id ? (e.dataset.id === id ? 'visible' : 'hidden') : ''); };
  </script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body${only ? ' class="only"' : ''}><div class="stage">
  <div class="layer" data-id="under">${stage.under || ''}</div>
  ${items}
  <div class="layer" data-id="over">${stage.over || ''}</div>
  </div>${script}</body></html>`;
}

/**
 * Open the stage once in a page; returns { shot({ only, t }), close }. shot gives PNG bytes of the
 * whole stage (transparent where nothing is drawn) at `scale`.
 */
export async function openStage(browser, stage, { scale = 1 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: stage.w, height: stage.h, deviceScaleFactor: scale });
  await page.setContent(stageHtml(stage), { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts?.ready;
    const urls = new Set();
    document.querySelectorAll('.face').forEach((f) => { const m = /url\("?(.*?)"?\)/.exec(f.style.backgroundImage); if (m) urls.add(m[1]); });
    await Promise.all([...urls].map((u) => new Promise((ok) => { const i = new Image(); i.onload = i.onerror = () => ok(); i.src = u; })));
  });
  await new Promise((r) => setTimeout(r, 150));
  return {
    page,
    async shot({ only = null, t = 0 } = {}) {
      await page.evaluate((id, tt) => { window.__only(id); window.__setT(tt); }, only, t);
      return page.screenshot({ clip: { x: 0, y: 0, width: stage.w, height: stage.h }, omitBackground: true, type: 'png' });
    },
    close: () => page.close(),
  };
}

/** The layer ids of a stage, in paint order: under, each window, over. */
export function stageLayerIds(stage) {
  const ids = [];
  if (stage.under) ids.push({ id: 'under', label: 'background' });
  for (const it of stage.items || []) ids.push({ id: it.id, label: it.label || it.id });
  if (stage.over) ids.push({ id: 'over', label: 'text' });
  return ids;
}
