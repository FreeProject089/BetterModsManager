// B.MD diagrams (mermaid), drawn the same way on every surface that shows them.
//
// The palette is built from the LIVE design tokens and the drawing is resized to its real
// bounds after layout; both were written for the docs hub (docs-hub.ts) and live here so a
// second surface, a saved order list's notes, draws a diagram that looks like the docs' one
// instead of mermaid's defaults. Import-light on purpose: the vendor loader and nothing else.
//
// How a diagram is written (BMM Docs and the in-app diagrams follow the same rules, so they read
// the same in light and dark and at the docs width):
//   · `flowchart LR` for a short pipeline (≤ 6 steps), `flowchart TD` for decisions and longer
//     flows, `sequenceDiagram` for a request/response between ≤ 5 participants;
//   · ≤ ~14 nodes, grouped with `subgraph ID["Title"]` by layer or phase;
//   · labels of 2–5 words (one `<br/>` at most), edge labels of 1–3 words, the detail in prose;
//   · shapes mean something: ([start/end]) {decision} [(store)] [[Rust command / worker]];
//   · NO colours (`style`, `classDef`, `linkStyle`, hex, %%{init}%%): this theme paints them.
import { ensureMermaid } from '../ui/lazy-vendor.js';

// mermaid derives most of its palette from the few colours it is handed, using real colour
// maths. Handing it a token like --bmm-s08 — which resolves to rgba(255,255,255,0.08) — makes
// every derived shade nonsense, which is what turned the sequence diagram's lifelines purple.
// So each token is resolved and FLATTENED against the diagram card's background first.
type RGBA = [number, number, number, number];
function parseColor(c: string): RGBA | null {
  const s = c.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const at = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [at(0), at(2), at(4), h.length === 8 ? at(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every((x) => Number.isFinite(x))) {
      return [p[0], p[1], p[2], p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1];
    }
  }
  return null;
}
const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** Composite `c` over an opaque base — the only way a translucent token becomes a usable colour. */
function over(c: RGBA, base: RGBA): RGBA {
  const a = c[3];
  return [c[0] * a + base[0] * (1 - a), c[1] * a + base[1] * (1 - a), c[2] * a + base[2] * (1 - a), 1];
}
const luma = (c: RGBA) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

/** The mermaid configuration for the CURRENT theme, built from the live design tokens. */
export function mermaidTheme(securityLevel: 'loose' | 'strict' = 'loose') {
  const css = getComputedStyle(document.documentElement);
  const raw = (n: string, f: string) => (css.getPropertyValue(n) || '').trim() || f;
  // The card the diagram sits on — everything translucent flattens against this.
  const page = parseColor(raw('--bmm-bg-base', '#0a0e17')) || [10, 14, 23, 1];
  const base: RGBA = page[3] >= 0.999 ? page : over(page, [0, 0, 0, 1]);
  const col = (name: string, fallback: string) => {
    const p = parseColor(raw(name, fallback)) || parseColor(fallback) || [128, 128, 128, 1];
    const f = p[3] >= 0.999 ? p : over(p, base);
    return toHex(f[0], f[1], f[2]);
  };
  /** A tint of `name` laid over the card — for fills that must read as a colour, not a block. */
  const tint = (name: string, fallback: string, alpha: number) => {
    const p = parseColor(raw(name, fallback)) || parseColor(fallback) || [128, 128, 128, 1];
    const f = over([p[0], p[1], p[2], alpha], base);
    return toHex(f[0], f[1], f[2]);
  };

  const bg = toHex(base[0], base[1], base[2]);
  // These three are the tokens the theme editor already exposes for diagrams.
  const node = col('--bmm-diagram-node', '#161b22');
  const nodeBorder = col('--bmm-diagram-node-border', '#3b82f6');
  const nodeText = col('--bmm-diagram-node-text', '#f1f5f9');
  const line = col('--bmm-text-muted', '#7c8698');
  const soft = col('--bmm-border-hover', '#2a3242');
  // The subgraph box, barely raised off the card. --bmm-surface-* is the overlay TINT (white on
  // dark themes, black on light ones), so this stays a lift in both directions.
  const surface: RGBA = [
    Number(raw('--bmm-surface-r', '255')) || 0,
    Number(raw('--bmm-surface-g', '255')) || 0,
    Number(raw('--bmm-surface-b', '255')) || 0, 1];
  const clusterRGB = over([surface[0], surface[1], surface[2], 0.045], base);
  const cluster = toHex(clusterRGB[0], clusterRGB[1], clusterRGB[2]);
  const warn = col('--bmm-warning', '#f59e0b');
  const noteBg = tint('--bmm-warning', '#f59e0b', 0.14);      // annotations read warm on any theme

  return {
    startOnLoad: false,
    theme: 'base' as const,
    securityLevel,
    htmlLabels: true,
    // With htmlLabels, a node label is real HTML inside a foreignObject — so it INHERITS the
    // page's CSS. mermaid, though, measures it in a scratch element it appends to <body>, which
    // does not inherit .dh-content's line-height: 1.7. It therefore sized every box for 13×1.31
    // and then drew text at 13×1.7, and the second line of every two-line label was cut off.
    // Baking the line-height into the SVG's own stylesheet makes both passes agree wherever the
    // diagram ends up.
    themeCSS: '.nodeLabel,.edgeLabel,.label,.actor,.messageText,.noteText,.loopText'
      + '{line-height:1.35;} .nodeLabel p,.edgeLabel p{margin:0;}'
      // Subgraph titles read as headings, edge labels as annotations.
      + ' .cluster-label .nodeLabel,.cluster-label span{font-weight:600;} .edgeLabel{font-size:12px;}',
    // Tell mermaid which way round the surface is, so anything it still derives itself lands on
    // the readable side. Getting this wrong is how light themes ended up with white-on-white.
    darkMode: luma(base) < 0.5,
    // useMaxWidth:false — with it on, mermaid stretches/squashes the drawing to the column, and a
    // wide left-to-right flowchart got crushed to a 57px-tall strip with unreadable labels. Off,
    // it keeps its natural size and .dh-mermaid scrolls instead, exactly like the website does.
    flowchart: { curve: 'basis', nodeSpacing: 46, rankSpacing: 46, useMaxWidth: false, padding: 12, subGraphTitleMargin: { top: 6, bottom: 10 } },
    sequence: { useMaxWidth: false, mirrorActors: true, boxMargin: 8, noteMargin: 10, messageAlign: 'center' },
    themeVariables: {
      background: bg,
      fontFamily: (getComputedStyle(document.documentElement).getPropertyValue('--bmm-font-sans') || '').trim()
        || 'Inter, system-ui, sans-serif',
      fontSize: '13px',
      // flowchart / graph
      primaryColor: node, primaryTextColor: nodeText, primaryBorderColor: nodeBorder,
      secondaryColor: cluster, secondaryTextColor: nodeText, secondaryBorderColor: soft,
      tertiaryColor: bg, tertiaryTextColor: nodeText, tertiaryBorderColor: soft,
      mainBkg: node, nodeBorder, nodeTextColor: nodeText,
      lineColor: line, textColor: nodeText, titleColor: nodeText,
      clusterBkg: cluster, clusterBorder: soft,
      // Edge labels sit ON the connector and need a backing plate, or the line runs through the
      // text. Unset, mermaid paints that plate white and it punches a bright hole through every
      // dark theme. The cluster shade rather than the page shade: these labels almost always sit
      // inside a subgraph, and the page colour read as a black box floating on top of one.
      edgeLabelBackground: cluster, labelBackground: cluster, labelColor: nodeText,
      // sequenceDiagram — none of this was set before, which is why the actors, the lifelines
      // and the notes all came out in mermaid's own derived colours.
      actorBkg: node, actorBorder: nodeBorder, actorTextColor: nodeText, actorLineColor: line,
      signalColor: line, signalTextColor: nodeText,
      labelBoxBkgColor: node, labelBoxBorderColor: nodeBorder, labelTextColor: nodeText,
      loopTextColor: nodeText, activationBkgColor: cluster, activationBorderColor: nodeBorder,
      noteBkgColor: noteBg, noteBorderColor: warn, noteTextColor: nodeText,
      sequenceNumberColor: bg, altBackground: cluster,
    },
  };
}

/** Resize a rendered diagram to the box it ACTUALLY draws into.
 *
 *  mermaid computes its viewBox from the layout it planned, but the layout is planned from label
 *  sizes it measures in a scratch element — and the app's own stylesheets reach into that. Measured
 *  with every stylesheet index.html loads: 54 of the 56 bundled diagrams drew outside their own
 *  viewBox, by up to 169px, and an SVG clips at its viewBox. That is the cut-off arrows and the
 *  half-drawn decision diamonds.
 *
 *  Rather than chase which rule causes it — the answer would only hold until the next stylesheet
 *  changes — take the drawing's real bounds and make the box fit them. This is measured after
 *  layout, so it is correct whatever the ambient CSS turns out to do. */
export function fitDiagram(host: HTMLElement) {
  const svg = host.querySelector('svg') as SVGSVGElement | null;
  if (!svg) return;
  let bb: { x: number; y: number; width: number; height: number };
  try { bb = svg.getBBox(); } catch { return; }          // not laid out yet — leave it alone
  if (!(bb.width > 0) || !(bb.height > 0)) return;
  // Room for stroke widths and arrow heads, which getBBox does not fully account for.
  const pad = 10;
  const x = bb.x - pad, y = bb.y - pad, w = bb.width + pad * 2, h = bb.height + pad * 2;
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  svg.setAttribute('width', String(Math.ceil(w)));
  svg.setAttribute('height', String(Math.ceil(h)));
  svg.style.maxWidth = 'none';
}

let _drawSeq = 0;

/**
 * Draw every `.dh-mermaid` block under `host` (md-lite's output for a ```mermaid fence or a
 * `:::mermaid` block). `strict`: the source came from somebody else, so mermaid runs at
 * `securityLevel: 'strict'` (no click handlers, labels sanitised) and `scrub` sees the SVG
 * before it reaches the page. A source mermaid cannot read shows as code, never as nothing.
 *
 * Resolves with how many diagrams were drawn. A block whose host left the page while mermaid
 * was busy is skipped.
 */
export async function drawDiagrams(host: HTMLElement, opts: { strict?: boolean; scrub?: (svg: string) => string } = {}): Promise<number> {
  const blocks = [...host.querySelectorAll<HTMLElement>('.dh-mermaid:not(.ok)')];
  if (!blocks.length) return 0;
  const m = await ensureMermaid().catch(() => null);
  if (!m?.render) return 0;
  const ticket = ++_drawSeq;
  try { m.initialize(mermaidTheme(opts.strict ? 'strict' : 'loose')); } catch { /* keep the configuration in place */ }
  let drawn = 0;
  for (let n = 0; n < blocks.length; n++) {
    const el = blocks[n];
    const src = el.getAttribute('data-mermaid') || '';
    try {
      const { svg } = await m.render(`md-mmd-${ticket}-${n}`, src);
      if (!el.isConnected) continue;
      el.innerHTML = opts.scrub ? opts.scrub(svg) : svg;
      el.classList.add('ok');
      fitDiagram(el);
      drawn++;
    } catch {
      if (!el.isConnected) continue;
      const pre = document.createElement('pre');
      pre.className = 'dh-code';
      const code = document.createElement('code');
      code.textContent = src;
      pre.appendChild(code);
      el.replaceChildren(pre);
      el.classList.add('ok');
    }
  }
  return drawn;
}
