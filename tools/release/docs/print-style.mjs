// The print layer of the release PDFs, applied on top of BMM Docs' own pdf-print.css (which
// already forces a light palette and hides the site chrome). Everything here is about the PAGE:
// a readable measure (about 72 characters a line at 11 pt, 1.5 line height), a clear H1-H4
// hierarchy, code that is highlighted and wrapped instead of cut, tables with a repeated header
// row and zebra rows, tinted callouts with a type label, captions under the images, external
// links followed by their address, a cover and a table of contents. It lives in the release
// tool (not in BMM Docs) because it also knows the release: version, date, language.
//
// PALETTE feeds both the CSS and tests/release.test.mjs, which measures every pair: text at AA
// (4.5) or better, body text, links and the code tokens at AAA (7).

import { ratio, AA } from '../lib/contrast.mjs';

export const AAA = 7;

export const PALETTE = {
  paper: '#ffffff', ink: '#111827', ink2: '#2b3340', muted: '#4b5563', line: '#9ca3af', hair: '#d0d7de', soft: '#f3f4f6', head: '#dfe3e8',
  accent: '#b45309', accentInk: '#92400e', link: '#8a2c00', navy: '#0b0f19', navyInk: '#f4f7ff',
  codeBg: '#f6f8fa', codeInk: '#1f2328',
  // Token colours: a GitHub-light palette darkened until every token reaches AAA (7:1) on codeBg.
  hl: { comment: '#444c56', keyword: '#a1111f', string: '#0a3069', number: '#005a4f', function: '#512a97', builtin: '#6b2c00', attribute: '#7a2e00', tag: '#0b5127', operator: '#1f2328', punctuation: '#2f353d', variable: '#7a2e00', type: '#5c2a00', special: '#5b21b6' },
  diff: { delBg: '#ffebe9', delInk: '#82071e', insBg: '#dafbe1', insInk: '#0b4a1c' },
  // Callouts: [title bar, body, edge]. Body and title text stay ink; the edge, the icon and the label carry the type.
  adm: {
    note: ['#dbeafe', '#eff6ff', '#1d4ed8'], tip: ['#d1fae5', '#ecfdf5', '#047857'], warning: ['#fde68a', '#fffbeb', '#92400e'],
    danger: ['#fecaca', '#fef2f2', '#b91c1c'], example: ['#e9d5ff', '#faf5ff', '#7e22ce'], question: ['#e0e7ff', '#eef2ff', '#4338ca'], quote: ['#e5e7eb', '#f9fafb', '#4b5563'],
  },
};

/** [what, foreground, background, minimum ratio] for the test. */
export function textPairs(p = PALETTE) {
  const adm = Object.entries(p.adm).flatMap(([k, [title, body, edge]]) => [[`callout ${k} title`, p.ink, title, AA], [`callout ${k} body`, p.ink, body, AA], [`callout ${k} label`, edge, '#ffffff', AA]]);
  return [
    ['body text', p.ink, p.paper, AAA], ['secondary text', p.ink2, p.paper, AAA], ['captions, quotes, header and footer', p.muted, p.paper, AA],
    ['links', p.link, p.paper, AAA], ['accent text', p.accentInk, p.paper, AA], ['table header', p.ink, p.head, AAA], ['zebra row', p.ink, p.soft, AAA],
    ['code', p.codeInk, p.codeBg, AAA], ...Object.entries(p.hl).map(([k, v]) => [`code token ${k}`, v, p.codeBg, AAA]),
    ['diff removed', p.diff.delInk, p.diff.delBg, AAA], ['diff added', p.diff.insInk, p.diff.insBg, AAA],
    ['inline code', p.codeInk, '#eef0f3', AAA], ['cover pill', p.navyInk, p.navy, AA], ...adm,
  ].map(([what, fg, bg, min = AA]) => [what, fg, bg, min]);
}
export function paletteProblems(p = PALETTE) {
  return textPairs(p).filter(([, fg, bg, min]) => ratio(fg, bg) < min).map(([what, fg, bg, min]) => `${what}: ${fg} on ${bg} is ${ratio(fg, bg).toFixed(2)}:1 (needs ${min})`);
}

const ADM_LABELS = {
  en: { note: 'Note', tip: 'Tip', hint: 'Tip', important: 'Important', warning: 'Warning', attention: 'Warning', danger: 'Danger', error: 'Error', info: 'Info', example: 'Example', question: 'Question', help: 'Question', faq: 'Question', success: 'Success', failure: 'Failure', bug: 'Bug', abstract: 'Summary', quote: 'Quote', cite: 'Quote', caution: 'Caution', details: 'Details' },
  fr: { note: 'Note', tip: 'Astuce', hint: 'Astuce', important: 'Important', warning: 'Attention', attention: 'Attention', danger: 'Danger', error: 'Erreur', info: 'Info', example: 'Exemple', question: 'Question', help: 'Question', faq: 'Question', success: 'Succès', failure: 'Échec', bug: 'Bogue', abstract: 'Résumé', quote: 'Citation', cite: 'Citation', caution: 'Prudence', details: 'Détails' },
};
const TEXT = {
  en: { edition: 'English edition', doc: 'Documentation', version: 'Version', toc: 'Contents', anim: 'Animated in the online documentation', book: 'Better Mod.Manager · Documentation', page: 'Page', adm: ADM_LABELS.en },
  fr: { edition: 'Édition française', doc: 'Documentation', version: 'Version', toc: 'Sommaire', anim: 'Animé dans la documentation en ligne', book: 'Better Mod.Manager · Documentation', page: 'Page', adm: ADM_LABELS.fr },
};
export const textFor = (lang) => TEXT[lang] ?? TEXT.en;

const MONO = '"Cascadia Mono","Cascadia Code",Consolas,"Liberation Mono","DejaVu Sans Mono",monospace';
const SANS = '"Segoe UI",Inter,"Helvetica Neue",Arial,sans-serif';

/** Which palette entry each callout class uses. */
const ADM_GROUP = {
  note: ['note', 'info', 'abstract', 'success'], tip: ['tip', 'hint', 'important'], warning: ['warning', 'caution', 'attention'],
  danger: ['danger', 'failure', 'bug', 'error'], example: ['example'], question: ['question', 'help', 'faq'], quote: ['quote', 'cite'],
};
const admCss = (p) => Object.entries(ADM_GROUP).map(([k, cls]) => {
  const [title, body, edge] = p.adm[k];
  const sel = (suffix) => cls.map((c) => `.md-typeset .admonition.${c}${suffix}`).join(',');
  return `${sel('')}{border-left-color:${edge};background:${body}!important}${sel('>.admonition-title')}{background:${title}!important}${sel('>.admonition-title::before')}{background-color:${edge}!important}${sel('>.admonition-title .adm-type')}{color:${edge}}`;
}).join('\n');

/** Pygments classes (Material's .highlight) → token colour. */
const tokenCss = (p) => {
  const h = p.hl;
  const rule = (cls, css) => `${cls.split(' ').map((c) => `.md-typeset .highlight .${c}`).join(',')}{${css}}`;
  return [
    rule('c ch cm cp cpf c1 cs sd', `color:${h.comment};font-style:italic`),
    rule('k kc kd kn kp kr', `color:${h.keyword};font-weight:600`),
    rule('kt nc nn', `color:${h.type}`),
    rule('s sa sb sc dl s2 se sh si sx sr s1 ss', `color:${h.string}`),
    rule('m mb mf mh mi mo il', `color:${h.number}`),
    rule('na', `color:${h.attribute}`),
    rule('nb bp', `color:${h.builtin}`),
    rule('nd ni ne', `color:${h.special}`),
    rule('nf fm nl', `color:${h.function};font-weight:600`),
    rule('nt', `color:${h.tag}`),
    rule('nv vc vg vi vm no nx', `color:${h.variable}`),
    rule('o ow', `color:${h.operator}`),
    rule('p', `color:${h.punctuation}`),
    rule('gh gu', `color:${h.function};font-weight:700`),
    rule('gd', `color:${p.diff.delInk};background:${p.diff.delBg}`),
    rule('gi', `color:${p.diff.insInk};background:${p.diff.insBg}`),
    rule('ge', 'font-style:italic'), rule('gs', 'font-weight:700'),
    rule('err', `color:${h.keyword};background:transparent`),
  ].join('\n');
};

/** The stylesheet. Added AFTER the docs' own sheets, so it wins on equal specificity. */
export function printCss(p = PALETTE, { version = '', lang = 'en' } = {}) {
  const tx = textFor(lang);
  const box = `font:600 8pt ${SANS};color:${p.muted};`;
  const hl = Object.entries(p.hl).map(([k, v]) => `--md-code-hl-${k}-color:${v}`).join(';');
  return `
:root,[data-md-color-scheme]{--md-default-bg-color:${p.paper};--md-default-fg-color:${p.ink};--md-typeset-color:${p.ink};--md-typeset-a-color:${p.link};--md-code-bg-color:${p.codeBg};--md-code-fg-color:${p.codeInk};${hl};--md-default-fg-color--light:${p.muted};color-scheme:light}
/* Running header and footer as CSS page-margin boxes (Chrome 131+): they can differ on the cover.
   print-site's own @page rule (Page N, bottom right, serif) is replaced here. Side margins of 30 mm
   keep a line at about 72 characters in 11 pt. */
@page{size:A4;margin:25mm 30mm 24mm 30mm;padding:0;
  @top-left{content:"${tx.book}";${box}}
  @top-right{content:"${tx.version} ${version}";${box}}
  @bottom-left{content:"BMM ${version} · ${lang === 'fr' ? 'Français' : 'English'}";${box}}
  @bottom-center{content:none}
  @bottom-right{content:"${tx.page} " counter(page) " / " counter(pages);${box}}}
@page :first{@top-left{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-right{content:none}}
html,body{background:${p.paper}!important;color:${p.ink}!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.md-typeset{font-family:${SANS};font-size:11pt;line-height:1.5;color:${p.ink};font-kerning:normal;text-align:left;hyphens:manual}
.md-typeset p,.md-typeset li,.md-typeset td,.md-typeset dd{color:${p.ink};orphans:3;widows:3}
.md-typeset p{margin:.7em 0}
.md-typeset ul,.md-typeset ol{margin:.6em 0 .6em .2em}
.md-typeset li{margin:.28em 0}
.md-typeset li>p{margin:.35em 0}
/* Headings: a clear H1-H4 ladder, more space above than below, never left alone at a page bottom. */
.md-typeset h1,.md-typeset h2,.md-typeset h3,.md-typeset h4,.md-typeset h5{color:${p.ink};font-family:${SANS};break-after:avoid;page-break-after:avoid;break-inside:avoid;line-height:1.2}
.md-typeset h1{font-size:26pt;font-weight:800;letter-spacing:-.02em;margin:0 0 .6em;padding-bottom:.28em;border-bottom:3px solid ${p.accent}}
.md-typeset h2{font-size:17pt;font-weight:800;margin:1.9em 0 .55em;padding-bottom:.18em;border-bottom:1.5px solid ${p.line}}
.md-typeset h3{font-size:13.5pt;font-weight:700;margin:1.6em 0 .4em}
.md-typeset h4{font-size:11.5pt;font-weight:700;margin:1.4em 0 .3em;color:${p.ink2};letter-spacing:.01em}
.md-typeset h5{font-size:11pt;font-weight:700;font-style:italic;margin:1.2em 0 .3em;color:${p.ink2};text-transform:none}
.md-typeset h1+h2,.md-typeset h2+h3,.md-typeset h3+h4{margin-top:.8em}
.md-typeset a{color:${p.link};text-decoration:underline;text-decoration-thickness:.5pt;text-underline-offset:2px}
.md-typeset strong{font-weight:700;color:${p.ink}}
.md-typeset em{color:${p.ink}}
.md-typeset hr{border:0;border-top:1px solid ${p.line};margin:1.6em 0}
.md-typeset blockquote,.md-typeset blockquote *{background-image:none!important}
.md-typeset blockquote{border:1px solid ${p.hair}!important;border-left:5px solid ${p.accent}!important;border-radius:6px!important;color:${p.ink}!important;background:#fafaf9!important;padding:.4em 1.1em!important;margin:1.1em 0!important;break-inside:avoid;box-shadow:none!important}
.md-typeset blockquote p,.md-typeset blockquote li,.md-typeset blockquote em{color:${p.ink}!important}
/* External links: the address follows the text, so it survives on paper. */
.md-typeset .ext-url{font-family:${MONO};font-size:8pt;color:${p.muted};overflow-wrap:anywhere;word-break:break-all;text-decoration:none;font-weight:400;font-style:normal}
/* Inline code and keys */
.md-typeset code{font-family:${MONO};font-size:.85em;background:#eef0f3;color:${p.codeInk};border:1px solid ${p.hair};border-radius:4px;padding:.04em .32em;overflow-wrap:anywhere;word-break:normal}
.md-typeset kbd{font-family:${MONO};font-size:.82em;color:${p.codeInk};background:${p.soft};border:1px solid ${p.line};border-bottom-width:2px;border-radius:4px;padding:.03em .36em;box-shadow:none;white-space:nowrap}
/* Code blocks: light, highlighted, wrapped instead of cut, free to break across pages when long. */
.md-typeset pre,.md-typeset .highlight{background:${p.codeBg}!important;border:1px solid ${p.hair};border-left:4px solid ${p.line};border-radius:6px;margin:1em 0;break-inside:auto;page-break-inside:auto;max-width:100%;overflow:visible}
.md-typeset .highlight pre{border:0;margin:0;border-radius:0}
.md-typeset pre{padding:0;orphans:4;widows:4}
.md-typeset pre>code,.md-typeset .highlight code{background:transparent!important;border:0;border-radius:0;padding:.7em 1em;display:block;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;tab-size:4;font-size:8.6pt;line-height:1.5;color:${p.codeInk};max-width:100%}
.md-typeset pre code span,.md-typeset pre code a{font-family:inherit}
.md-typeset .highlight .filename{display:block;font:600 8.5pt ${SANS};color:${p.ink2};background:${p.head};border-bottom:1px solid ${p.hair};padding:.3em 1em}
.md-typeset .highlighttable,.md-typeset .highlighttable tbody,.md-typeset .highlighttable tr,.md-typeset .highlighttable td{display:block;width:100%;border:0;padding:0}
.md-typeset .highlight .hll{background:#fff3b0}
.md-typeset .linenos,.md-typeset .md-clipboard,.md-typeset .md-code__nav,.md-typeset .md-annotation{display:none!important}
${tokenCss(p)}
/* Tables: real borders, a darker header repeated on every page, zebra rows, never wider than the page. */
.md-typeset__scrollwrap,.md-typeset__table{overflow:visible!important;display:block;width:100%;max-width:100%;margin:0;padding:0}
.md-typeset table:not([class]){width:100%!important}
.md-typeset table:not([class]){display:table;width:100%;max-width:100%;table-layout:auto;border-collapse:collapse;font-size:9.6pt;line-height:1.4;border:1.2px solid ${p.line};box-shadow:none;margin:1.1em 0;break-inside:auto}
.md-typeset table:not([class]) thead{display:table-header-group}
.md-typeset table:not([class]) tr{break-inside:avoid;page-break-inside:avoid}
.md-typeset table:not([class]) th{background:${p.head}!important;color:${p.ink}!important;font-weight:700;text-align:left;border-bottom:2px solid ${p.ink2}}
.md-typeset table:not([class]) th,.md-typeset table:not([class]) td{border:1px solid ${p.line};padding:5px 8px;vertical-align:top;overflow-wrap:anywhere;word-break:normal;color:${p.ink}}
.md-typeset table:not([class]) td p,.md-typeset table:not([class]) td li{margin:.15em 0}
.md-typeset table:not([class]) tbody tr:nth-child(even) td{background:${p.soft}!important}
.md-typeset table:not([class]) tbody tr:nth-child(odd) td{background:${p.paper}!important}
.md-typeset table:not([class]) td code,.md-typeset table:not([class]) th code{font-size:.88em}
/* Callouts: a tinted box, a coloured edge and icon per type, the type written out before the title. */
.md-typeset .admonition,.md-typeset details{break-inside:avoid;page-break-inside:avoid;border:1px solid ${p.line};border-left:5px solid ${p.adm.note[2]};border-radius:6px;background:${p.adm.note[1]}!important;box-shadow:none!important;font-size:10.5pt;margin:1.2em 0;color:${p.ink};padding-bottom:.2em}
.md-typeset .admonition-title,.md-typeset summary{background:${p.adm.note[0]}!important;color:${p.ink}!important;font-weight:700;border:0!important}
.md-typeset .admonition-title::before,.md-typeset summary::before{background-color:${p.adm.note[2]}!important}
.md-typeset .admonition-title .adm-type{display:inline-block;font:800 7.5pt ${SANS};letter-spacing:.07em;text-transform:uppercase;margin-right:.7em;padding:.05em .55em;border:1.2px solid currentColor;border-radius:99px;background:#fff;vertical-align:.08em;color:${p.adm.note[2]}}
${admCss(p)}
.md-typeset details>summary::after{display:none}
.md-typeset details:not([open])>*:not(summary){display:block!important}
.md-typeset details{border-left-color:${p.adm.quote[2]};background:${p.adm.quote[1]}!important}
.md-typeset details>summary{background:${p.adm.quote[0]}!important}
.md-typeset details>summary::before{background-color:${p.adm.quote[2]}!important}
/* Images and diagrams: inside the page, whole, with a caption under them. */
.md-typeset img,.md-typeset svg,.md-typeset video,.md-typeset .mermaid,.md-typeset figure{max-width:100%!important;height:auto;break-inside:avoid;page-break-inside:avoid}
.md-typeset img{max-height:195mm;width:auto;object-fit:contain;border:1px solid ${p.hair};border-radius:4px;display:block;margin:.9em auto .5em}
.md-typeset img[src$=".svg"],.md-typeset .bmm-hero__logo{border:0}
.md-typeset p.fig{margin:.9em 0 .15em;text-align:center;break-after:avoid;page-break-after:avoid;break-inside:avoid}
.md-typeset p.cap{margin:.1em 6% 1.1em;text-align:center;font-size:9.5pt;line-height:1.4;color:${p.ink2};font-style:italic;break-before:avoid;page-break-before:avoid}
.md-typeset p.cap em{font-style:italic}
.md-typeset .mermaid{display:block;text-align:center;margin:1em 0}
.md-typeset .mermaid svg{max-height:215mm;width:auto!important;max-width:100%!important;height:auto!important}
.md-typeset .twemoji svg,.md-typeset .md-button svg{max-height:1.1em;width:1.1em;border:0}
/* Site-only pieces */
.bmm-hero__actions,.md-typeset .md-button,.bmm-pdf-download,.md-source-file,.md-feedback,.headerlink{display:none!important}
.bmm-hero{background:none!important;border:0!important;box-shadow:none!important;padding:0!important;margin:0 0 .6em!important;display:flex!important;gap:14pt;align-items:center}
.bmm-hero__logo{width:22mm!important;height:22mm!important}
.bmm-hero h1{border:0;margin:0;padding:0}
.bmm-hero__tagline{color:${p.ink2}!important;font-size:12pt}
/* Cover */
#print-site-cover-page{display:none!important}
.bmm-cover{box-sizing:border-box;width:100%;height:222mm;margin:0;padding:6mm 0 0 12mm;border-left:9mm solid ${p.accent};display:flex;flex-direction:column;justify-content:space-between;break-after:page;page-break-after:always;background:${p.paper}}
.bmm-cover .brand img{width:104mm;height:auto;border:0;margin:0;display:block;max-height:none}
.bmm-cover .t{font-size:44pt;line-height:1.05;font-weight:800;letter-spacing:-.03em;color:${p.ink};margin:0 0 .2em}
.bmm-cover .sub{font-size:16pt;color:${p.ink2};margin:0 0 14mm}
.bmm-cover .pill{display:inline-block;background:${p.navy};color:${p.navyInk};font-weight:700;font-size:16pt;padding:3mm 8mm;border-radius:99px;letter-spacing:.01em}
.bmm-cover .meta{margin-top:7mm;font-size:12pt;color:${p.ink2};line-height:1.7}
.bmm-cover .foot{font-size:10pt;color:${p.muted};border-top:1.2px solid ${p.line};padding-top:4mm;display:flex;justify-content:space-between;gap:10mm}
/* Table of contents */
.bmm-toc{break-before:page;break-after:page;page-break-before:always;page-break-after:always}
.bmm-toc .toc-title{font-size:26pt;font-weight:800;letter-spacing:-.02em;color:${p.ink};margin:0 0 .5em;padding-bottom:.25em;border-bottom:3px solid ${p.accent}}
.bmm-toc ol{list-style:none;margin:0;padding:0}
.bmm-toc li{margin:0}
.bmm-toc a{display:flex;align-items:baseline;gap:6px;text-decoration:none;color:${p.ink}}
.bmm-toc .l1 a{font-weight:800;font-size:12.5pt;margin-top:.9em;color:${p.ink}}
.bmm-toc .l2 a{font-size:10.5pt;padding:.12em 0 .12em 6mm;font-weight:500}
.bmm-toc .dots{flex:1;border-bottom:1.5px dotted ${p.muted};transform:translateY(-3px);min-width:8mm}
.bmm-toc .pg{font-variant-numeric:tabular-nums;color:${p.ink2};min-width:7mm;text-align:right;font-weight:600}
/* Chapter openers: each top-level section starts on a fresh sheet; pages inside keep flowing. */
section.print-page.md-section>h1{break-before:page;page-break-before:always;font-size:32pt;margin-top:30mm}
.md-typeset .print-page h1{break-before:page;page-break-before:always}
.pgmark{font-size:1px;line-height:0;color:#fff;position:absolute;opacity:1}
.bmm-anim{break-inside:avoid;page-break-inside:avoid;margin:.1em 6% 1.1em;text-align:center;font-size:9pt;color:${p.muted}}
.bmm-anim a{color:${p.link}}
`;
}

/** Header and footer templates for Chrome (inline styles only; Chrome renders them in the margin). */
export function headerHtml(version, lang) {
  const t = textFor(lang);
  return `<div style="width:100%;box-sizing:border-box;padding:0 30mm;font:600 8pt 'Segoe UI',Arial,sans-serif;color:${PALETTE.muted};display:flex;justify-content:space-between;border-bottom:.6pt solid ${PALETTE.line};padding-bottom:2mm;-webkit-print-color-adjust:exact"><span>${t.book}</span><span>${t.version} ${version}</span></div>`;
}
export function footerHtml(version, lang) {
  const t = textFor(lang);
  return `<div style="width:100%;box-sizing:border-box;padding:0 30mm;font:600 8pt 'Segoe UI',Arial,sans-serif;color:${PALETTE.muted};display:flex;justify-content:space-between;-webkit-print-color-adjust:exact"><span>BMM ${version} · ${lang === 'fr' ? 'Français' : 'English'}</span><span>${t.page} <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}
