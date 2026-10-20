// The print layer of the release PDFs, applied on top of BMM Docs' own pdf-print.css (which
// already forces a light palette and hides the site chrome). Everything here is about the PAGE:
// dark text on white at WCAG AA or better, headings with a clear hierarchy, readable code,
// tables with borders, margins, nothing cut at the page edge, a cover, a table of contents.
// It lives in the release tool (not in BMM Docs) because it also knows the release: version,
// date, language.
//
// PALETTE feeds both the CSS and tests/release.test.mjs, which measures every pair.

import { ratio, AA } from '../lib/contrast.mjs';

export const PALETTE = {
  paper: '#ffffff', ink: '#111827', ink2: '#374151', muted: '#4b5563', line: '#9ca3af', soft: '#f3f4f6', head: '#e5e7eb',
  accent: '#b45309', accentInk: '#92400e', link: '#9a3412', navy: '#0b0f19', navyInk: '#f4f7ff',
  codeBg: '#f3f4f6', codeInk: '#111827',
  // Pygments token colours (Material reads them as --md-code-hl-*) darkened to AA on codeBg.
  hl: { keyword: '#6d28d9', string: '#047857', comment: '#4b5563', function: '#1d4ed8', number: '#b45309', operator: '#1f2937', punctuation: '#374151', variable: '#9a3412', constant: '#6d28d9', special: '#be123c', name: '#1f2937', generic: '#1f2937' },
  note: { bg: '#eff6ff', title: '#dbeafe', edge: '#1d4ed8' },
  warn: { bg: '#fffbeb', title: '#fef3c7', edge: '#b45309' },
};

/** [what, foreground, background] pairs that must reach AA (4.5), for the test. */
export function textPairs(p = PALETTE) {
  return [
    ['body text', p.ink, p.paper], ['secondary text', p.ink2, p.paper], ['captions, quotes, header and footer', p.muted, p.paper],
    ['links', p.link, p.paper], ['accent text', p.accentInk, p.paper], ['table header', p.ink, p.head], ['zebra row', p.ink, p.soft],
    ['code', p.codeInk, p.codeBg], ...Object.entries(p.hl).map(([k, v]) => [`code token ${k}`, v, p.codeBg]),
    ['inline code', p.codeInk, p.soft], ['cover pill', p.navyInk, p.navy],
    ['note title', p.ink, p.note.title], ['note body', p.ink, p.note.bg], ['warning title', p.ink, p.warn.title], ['warning body', p.ink, p.warn.bg],
  ];
}
export function paletteProblems(p = PALETTE) {
  return textPairs(p).filter(([, fg, bg]) => ratio(fg, bg) < AA).map(([what, fg, bg]) => `${what}: ${fg} on ${bg} is ${ratio(fg, bg).toFixed(2)}:1`);
}

const TEXT = {
  en: { edition: 'English edition', doc: 'Documentation', version: 'Version', toc: 'Contents', anim: 'Animated in the online documentation', replay: 'Interactive replay', replayHint: 'plays in the online documentation and in BMM', book: 'Better Mod.Manager · Documentation', page: 'Page' },
  fr: { edition: 'Édition française', doc: 'Documentation', version: 'Version', toc: 'Sommaire', anim: 'Animé dans la documentation en ligne', replay: 'Rejeu interactif', replayHint: 'se lit dans la documentation en ligne et dans BMM', book: 'Better Mod.Manager · Documentation', page: 'Page' },
};
export const textFor = (lang) => TEXT[lang] ?? TEXT.en;

/** The stylesheet. Added AFTER the docs' own sheets, so it wins on equal specificity. */
export function printCss(p = PALETTE, { version = '', lang = 'en' } = {}) {
  const tx = textFor(lang);
  const box = `font:600 8pt 'Segoe UI',Arial,sans-serif;color:${p.muted};`;
  const hl = Object.entries(p.hl).map(([k, v]) => `--md-code-hl-${k}-color:${v}`).join(';');
  return `
:root,[data-md-color-scheme]{--md-default-bg-color:${p.paper};--md-default-fg-color:${p.ink};--md-typeset-color:${p.ink};--md-typeset-a-color:${p.link};--md-code-bg-color:${p.codeBg};--md-code-fg-color:${p.codeInk};${hl};--md-default-fg-color--light:${p.muted};color-scheme:light}
/* Running header and footer as CSS page-margin boxes (Chrome 131+): they can differ on the cover.
   print-site's own @page rule (Page N, bottom right, serif) is replaced here. */
@page{size:A4;margin:24mm 18mm 22mm 18mm;padding:0;
  @top-left{content:"${tx.book}";${box}}
  @top-right{content:"${tx.version} ${version}";${box}}
  @bottom-left{content:"BMM ${version} · ${lang === 'fr' ? 'Français' : 'English'}";${box}}
  @bottom-center{content:none}
  @bottom-right{content:"${tx.page} " counter(page) " / " counter(pages);${box}}}
@page :first{@top-left{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-right{content:none}}
html,body{background:${p.paper}!important;color:${p.ink}!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.md-typeset{font-family:"Segoe UI",Inter,"Helvetica Neue",Arial,sans-serif;font-size:10pt;line-height:1.5;color:${p.ink}}
.md-typeset p,.md-typeset li,.md-typeset td,.md-typeset dd{color:${p.ink};orphans:3;widows:3}
.md-typeset p{margin:.55em 0}
/* Headings: one weight and size step each, the accent rule only under chapters and pages. */
.md-typeset h1,.md-typeset h2,.md-typeset h3,.md-typeset h4,.md-typeset h5{color:${p.ink};font-family:"Segoe UI",Inter,"Helvetica Neue",Arial,sans-serif;break-after:avoid;page-break-after:avoid}
.md-typeset h1{font-size:24pt;font-weight:800;letter-spacing:-.02em;margin:0 0 .5em;padding-bottom:.25em;border-bottom:3px solid ${p.accent}}
.md-typeset h2{font-size:16pt;font-weight:800;margin:1.5em 0 .45em;padding-bottom:.15em;border-bottom:1.5px solid ${p.line}}
.md-typeset h3{font-size:13pt;font-weight:700;margin:1.25em 0 .35em}
.md-typeset h4{font-size:11pt;font-weight:700;margin:1.1em 0 .3em;color:${p.ink2}}
.md-typeset h5{font-size:10.5pt;font-weight:700;margin:1em 0 .3em;color:${p.ink2};text-transform:none}
.md-typeset a{color:${p.link};text-decoration:underline;text-decoration-thickness:.5pt;text-underline-offset:2px}
.md-typeset strong{font-weight:700;color:${p.ink}}
.md-typeset em,.md-typeset figcaption,.md-typeset .caption{color:${p.ink2}}
.md-typeset hr{border:0;border-top:1px solid ${p.line};margin:1.4em 0}
.md-typeset blockquote,.md-typeset blockquote *{background-image:none!important}
.md-typeset blockquote{border:1px solid ${p.line}!important;border-left:5px solid ${p.accent}!important;border-radius:6px!important;color:${p.ink}!important;background:#fafaf9!important;padding:.4em 1em!important;margin:1em 0!important;break-inside:avoid;box-shadow:none!important}
.md-typeset blockquote p,.md-typeset blockquote li,.md-typeset blockquote em{color:${p.ink}!important}
/* Code */
.md-typeset code{font-family:"Cascadia Code",Consolas,"Liberation Mono",monospace;font-size:.86em;background:${p.soft};color:${p.codeInk};border:1px solid #d1d5db;border-radius:4px;padding:.05em .3em}
.md-typeset pre,.md-typeset .highlight{background:${p.codeBg}!important;border:1px solid ${p.line};border-radius:6px;break-inside:avoid;page-break-inside:avoid;margin:.9em 0}
.md-typeset pre>code,.md-typeset .highlight code{background:transparent!important;border:0;padding:.7em .9em;display:block;white-space:pre-wrap;overflow-wrap:anywhere;font-size:8.2pt;line-height:1.45;color:${p.codeInk}}
.md-typeset .highlight .c,.md-typeset .highlight .c1,.md-typeset .highlight .cm{font-style:italic}
.md-typeset .highlighttable td{border:0}
.md-typeset .linenos,.md-typeset .md-clipboard,.md-typeset .md-code__nav{display:none!important}
/* Tables: real borders, a grey header, zebra rows, never wider than the page. */
.md-typeset__scrollwrap,.md-typeset__table{overflow:visible!important;display:block;max-width:100%}
.md-typeset table:not([class]){display:table;width:100%;max-width:100%;table-layout:auto;border-collapse:collapse;font-size:9.2pt;border:1.2px solid ${p.line};box-shadow:none;margin:1em 0;break-inside:auto}
.md-typeset table:not([class]) thead{display:table-header-group}
.md-typeset table:not([class]) tr{break-inside:avoid;page-break-inside:avoid}
.md-typeset table:not([class]) th{background:${p.head}!important;color:${p.ink}!important;font-weight:700;text-align:left}
.md-typeset table:not([class]) th,.md-typeset table:not([class]) td{border:1px solid ${p.line};padding:5px 9px;vertical-align:top;overflow-wrap:anywhere;word-break:normal;color:${p.ink}}
.md-typeset table:not([class]) tbody tr:nth-child(even) td{background:${p.soft}!important}
/* Callouts */
.md-typeset .admonition,.md-typeset details{break-inside:avoid;page-break-inside:avoid;border:1px solid ${p.line};border-left:5px solid ${p.note.edge};border-radius:6px;background:${p.note.bg}!important;box-shadow:none!important;font-size:10pt;margin:1em 0;color:${p.ink}}
.md-typeset .admonition.warning,.md-typeset .admonition.caution,.md-typeset .admonition.danger,.md-typeset .admonition.failure,.md-typeset .admonition.bug{background:${p.warn.bg}!important;border-left-color:${p.warn.edge}}
.md-typeset .admonition-title,.md-typeset summary{background:${p.note.title}!important;color:${p.ink}!important;font-weight:700}
.md-typeset .admonition.warning>.admonition-title,.md-typeset .admonition.caution>.admonition-title,.md-typeset .admonition.danger>.admonition-title,.md-typeset .admonition.failure>.admonition-title,.md-typeset .admonition.bug>.admonition-title{background:${p.warn.title}!important}
.md-typeset .admonition-title::before,.md-typeset summary::before{background-color:${p.ink}!important}
.md-typeset details>summary::after{display:none}
.md-typeset details:not([open])>*:not(summary){display:block!important}
/* Images and diagrams: inside the page, whole. */
.md-typeset img,.md-typeset svg,.md-typeset video,.md-typeset .mermaid,.md-typeset figure{max-width:100%!important;height:auto;break-inside:avoid;page-break-inside:avoid}
.md-typeset img{max-height:205mm;width:auto;object-fit:contain;border:1px solid #d1d5db;border-radius:4px;display:block;margin:.8em auto}
.md-typeset img[src$=".svg"],.md-typeset .bmm-hero__logo{border:0}
.md-typeset .mermaid{display:block;text-align:center;margin:1em 0}
.md-typeset .mermaid svg{max-height:215mm;width:auto!important;max-width:100%!important;height:auto!important}
.md-typeset .twemoji svg,.md-typeset .md-button svg{max-height:1.1em;width:1.1em;border:0}
/* Site-only pieces */
.bmm-hero__actions,.md-typeset .md-button,.bmm-replay,.bmm-pdf-download,.md-source-file,.md-feedback,.headerlink{display:none!important}
.bmm-hero{background:none!important;border:0!important;box-shadow:none!important;padding:0!important;margin:0 0 .6em!important;display:flex!important;gap:14pt;align-items:center}
.bmm-hero__logo{width:22mm!important;height:22mm!important}
.bmm-hero h1{border:0;margin:0;padding:0}
.bmm-hero__tagline{color:${p.ink2}!important;font-size:12pt}
/* Cover */
#print-site-cover-page{display:none!important}
.bmm-cover{box-sizing:border-box;width:100%;height:222mm;margin:0;padding:6mm 0 0 12mm;border-left:9mm solid ${p.accent};display:flex;flex-direction:column;justify-content:space-between;break-after:page;page-break-after:always;background:${p.paper}}
.bmm-cover .brand img{width:110mm;height:auto;border:0;margin:0;display:block;max-height:none}
.bmm-cover .t{font-size:46pt;line-height:1.05;font-weight:800;letter-spacing:-.03em;color:${p.ink};margin:0 0 .2em}
.bmm-cover .sub{font-size:16pt;color:${p.ink2};margin:0 0 14mm}
.bmm-cover .pill{display:inline-block;background:${p.navy};color:${p.navyInk};font-weight:700;font-size:16pt;padding:3mm 8mm;border-radius:99px;letter-spacing:.01em}
.bmm-cover .meta{margin-top:7mm;font-size:12pt;color:${p.ink2};line-height:1.7}
.bmm-cover .foot{font-size:10pt;color:${p.muted};border-top:1.2px solid ${p.line};padding-top:4mm;display:flex;justify-content:space-between;gap:10mm}
/* Table of contents */
.bmm-toc{break-before:page;break-after:page;page-break-before:always;page-break-after:always}
.bmm-toc .toc-title{font-size:24pt;font-weight:800;letter-spacing:-.02em;color:${p.ink};margin:0 0 .5em;padding-bottom:.25em;border-bottom:3px solid ${p.accent}}
.bmm-toc ol{list-style:none;margin:0;padding:0}
.bmm-toc li{margin:0}
.bmm-toc a{display:flex;align-items:baseline;gap:6px;text-decoration:none;color:${p.ink}}
.bmm-toc .l1 a{font-weight:800;font-size:12.5pt;margin-top:.9em;color:${p.ink}}
.bmm-toc .l2 a{font-size:10.5pt;padding:.12em 0 .12em 6mm;font-weight:500}
.bmm-toc .dots{flex:1;border-bottom:1.5px dotted ${p.muted};transform:translateY(-3px);min-width:8mm}
.bmm-toc .pg{font-variant-numeric:tabular-nums;color:${p.ink2};min-width:7mm;text-align:right;font-weight:600}
/* Chapter openers: each top-level section starts on a fresh sheet; pages inside keep flowing. */
section.print-page.md-section>h1{break-before:page;page-break-before:always;font-size:30pt;margin-top:30mm}
.md-typeset .print-page h1{break-before:page;page-break-before:always}
.pgmark{font-size:1px;line-height:0;color:#fff;position:absolute;opacity:1}
.bmm-anim,.bmm-replaylink{break-inside:avoid;page-break-inside:avoid;margin:.5em 0 1em;font-size:9.5pt;color:${p.ink2}}
.bmm-replaylink{border:1px solid ${p.line};border-left:5px solid ${p.accent};border-radius:6px;padding:.5em .9em;background:#fafaf9}
.bmm-replaylink b{color:${p.ink}}
`;
}

/** Header and footer templates for Chrome (inline styles only; Chrome renders them in the margin). */
export function headerHtml(version, lang) {
  const t = textFor(lang);
  return `<div style="width:100%;box-sizing:border-box;padding:0 18mm;font:600 8pt 'Segoe UI',Arial,sans-serif;color:${PALETTE.muted};display:flex;justify-content:space-between;border-bottom:.6pt solid ${PALETTE.line};padding-bottom:2mm;-webkit-print-color-adjust:exact"><span>${t.book}</span><span>${t.version} ${version}</span></div>`;
}
export function footerHtml(version, lang) {
  const t = textFor(lang);
  return `<div style="width:100%;box-sizing:border-box;padding:0 18mm;font:600 8pt 'Segoe UI',Arial,sans-serif;color:${PALETTE.muted};display:flex;justify-content:space-between;-webkit-print-color-adjust:exact"><span>BMM ${version} · ${lang === 'fr' ? 'Français' : 'English'}</span><span>${t.page} <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}
