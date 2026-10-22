// BMM Docs → PDF (English and French books), without WeasyPrint/GTK.
//
//   1. a private venv (tools/release/.cache/docs-venv) with the docs' hashed requirements.txt
//      (it pins mkdocs-print-site-plugin and pypdf itself now: no extra install, no --no-deps);
//   2. one single-language site per language, built by BMM Docs' OWN language_config
//      (tools/build_pdf_chrome.py, called through lang_config.py) into the cache;
//   3. headless Chrome (puppeteer-core) opens each print_page/, waits for Mermaid, and this module
//      dresses it as a book (print-style.mjs): a cover (logo, title, version, date), a table of
//      contents with page links AND page numbers, animated GIFs replaced by one still frame,
//      interactive replays replaced by a link, running header (BMM name, version) and footer
//      (page x / y), PDF bookmarks;
//   4. the page numbers of the table of contents come from the PDF's own bookmarks of a first
//      print, then the page is printed again with the numbers in (same layout, so they hold).
//
//   node tools/release/docs/pdf.mjs --version 1.0.4 [--lang en|fr] [--no-build] [--out dir]
//   (--no-build reuses the sites already in the cache: for iterating on the look)

import { existsSync, mkdirSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DOCS_DIR, ROOT, TOOL_DIR, releaseDir, fmtBytes } from '../lib/util.mjs';
import { run, capture } from '../lib/exec.mjs';
import { launch } from '../lib/browser.mjs';
import { printCss, textFor } from './print-style.mjs';

const CACHE = join(TOOL_DIR, '.cache');
const VENV = join(CACHE, 'docs-venv');
const venvPy = () => join(VENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const WORDMARK = join(ROOT, 'frontend', 'assets', 'brand', 'bmm-wordmark-light.svg');

function systemPython() {
  for (const [cmd, args] of [['py', ['-3.12']], ['py', ['-3']], ['python', []], ['python3', []]]) {
    const v = capture(cmd, [...args, '--version']);
    if (v && /Python 3\.(1[0-9])/.test(v)) return [cmd, args];
  }
  return null;
}

export async function ensureVenv(log) {
  if (!existsSync(venvPy())) {
    const py = systemPython();
    if (!py) throw new Error('Python 3.10+ not found (py / python)');
    mkdirSync(CACHE, { recursive: true });
    const r = await run(py[0], [...py[1], '-m', 'venv', VENV], { log });
    if (r.code) throw new Error('venv creation failed');
  }
  const has = capture(venvPy(), ['-c', 'import mkdocs, material, mkdocs_print_site_plugin, mkdocs_static_i18n, pypdf; print("ok")']);
  if (has === 'ok') return venvPy();
  // The docs' requirements.txt is hash-locked and complete (fonttools[woff] and the print-site
  // plugin are pinned there since BMM Docs 3e7d414): a plain install, resolver included.
  const r = await run(venvPy(), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', join(DOCS_DIR, 'requirements.txt')], { log });
  if (r.code) throw new Error('pip install -r "BMM Docs/requirements.txt" failed');
  return venvPy();
}

/** { cfg, site } for one language, from BMM Docs' own language_config. */
function languageSite(py, lang) {
  const out = capture(py, [join(TOOL_DIR, 'docs', 'lang_config.py'), DOCS_DIR, CACHE, lang]);
  const [cfg, site] = (out ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!cfg || !site) throw new Error(`lang_config.py ${lang} failed`);
  return { cfg, site };
}

/** page id (print-site: the page path with / replaced by -) → online URL, from the site's own pages. */
export function pageUrls(siteDir, siteUrl, lang) {
  const map = new Map();
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || ['print_page', 'assets', 'search', 'overrides'].includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (existsSync(join(d, e.name, 'index.html'))) map.set(r.split('/').join('-'), `${siteUrl}${lang === 'fr' ? 'fr/' : ''}${r}/`);
      walk(join(d, e.name), r);
    }
  };
  if (existsSync(siteDir)) walk(siteDir, '');
  map.set('index', `${siteUrl}${lang === 'fr' ? 'fr/' : ''}`);
  return map;
}

/** One still frame per GIF (a poster file next to it if there is one, else a frame a third in). Map(gif path → png path). */
async function gifFrames(paths, framesDir, log) {
  const out = new Map();
  if (!paths.length) return out;
  mkdirSync(framesDir, { recursive: true });
  const { findFfmpeg } = await import('../bench/run.mjs');
  const ffmpeg = findFfmpeg();
  for (const g of paths) {
    const stem = g.slice(0, -extname(g).length);
    const poster = [`${stem}-poster.png`, `${stem}-poster.jpg`, `${stem}.poster.png`, `${stem}.png`, `${stem}.jpg`].find((p) => existsSync(p));
    if (poster) { out.set(g, poster); continue; }
    if (!ffmpeg) continue; // Chrome prints the GIF's first frame by itself
    const dest = join(framesDir, `${basename(stem)}.png`);
    const probe = capture(ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', g]);
    const t = Math.max(0, (parseFloat(probe) || 0) / 3);
    let r = await run(ffmpeg, ['-y', '-v', 'error', '-ss', t.toFixed(2), '-i', g, '-frames:v', '1', dest], { quiet: true, log });
    if (r.code || !existsSync(dest)) r = await run(ffmpeg, ['-y', '-v', 'error', '-i', g, '-frames:v', '1', dest], { quiet: true, log });
    if (!r.code && existsSync(dest)) out.set(g, dest);
  }
  return out;
}

/** Runs in the page: cover, table of contents, still frames, replay links. Returns the TOC entries. */
export function dress(a) {
  const doc = document;
  const root = doc.getElementById('print-site-page');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const titleOf = (h) => { const c = h.cloneNode(true); c.querySelectorAll('.headerlink').forEach((x) => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
  // Every image loads now (no lazy loading in print).
  doc.querySelectorAll('img').forEach((i) => { i.removeAttribute('loading'); });
  // GIFs: one still frame and a line saying so.
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!/\.gif(\?|#|$)/i.test(src)) return;
    const frame = a.frames[img.src];
    if (frame) img.src = frame;
    const p = doc.createElement('p');
    p.className = 'bmm-anim';
    p.innerHTML = `${esc(a.t.anim)}: <a href="${esc(a.siteUrl)}">${esc(a.siteUrl.replace(/^https?:\/\//, ''))}</a>`;
    (img.closest('p') || img).insertAdjacentElement('afterend', p);
  });
  // Replays: a link in place of the player.
  doc.querySelectorAll('.bmm-replay').forEach((el) => {
    const page = el.closest('section.print-page[id]');
    const url = (page && a.pages[page.id]) || a.siteUrl;
    const box = doc.createElement('div');
    box.className = 'bmm-replaylink';
    box.innerHTML = `<b>${esc(a.t.replay)}${el.dataset.title ? `: ${esc(el.dataset.title)}` : ''}</b><br>${esc(a.t.replayHint)}: <a href="${esc(url)}">${esc(url.replace(/^https?:\/\//, ''))}</a>`;
    el.insertAdjacentElement('afterend', box);
    el.remove();
  });
  // Cover (the title is a div: the book's headings are its table of contents and its bookmarks).
  const cover = doc.createElement('section');
  cover.className = 'bmm-cover';
  cover.innerHTML = `<div class="brand">${a.wordmark ? `<img alt="Better Mod Manager" src="${a.wordmark}">` : ''}</div>
    <div><div class="t">${esc(a.t.doc)}</div>
    <p class="sub">${esc(a.t.edition)}</p>
    <span class="pill">${esc(a.t.version)} ${esc(a.version)}</span>
    <div class="meta">${esc(a.date)}<br>Windows · Better Mods Manager (BMM)</div></div>
    <div class="foot"><span>${esc(a.repo.replace(/^https?:\/\//, ''))}</span><span>BMM ${esc(a.version)}</span></div>`;
  root.insertBefore(cover, root.firstChild);
  const orig = doc.getElementById('print-site-cover-page'); if (orig) orig.remove();
  // Table of contents: every h1 of the book, in order.
  const heads = [...root.querySelectorAll('h1')].filter((h) => !h.closest('.bmm-cover,.bmm-toc,#print-page-toc'));
  const items = heads.map((h) => {
    const chapter = !!(h.parentElement && h.parentElement.matches('section.print-page.md-section'));
    const sec = h.closest('section[id]');
    return { title: titleOf(h), id: h.id || (sec && sec.id) || '', level: chapter ? 1 : 2, el: h };
  }).filter((x) => x.id && x.title);
  items.forEach((x) => { if (!x.el.id) x.el.id = x.id; });
  const holder = doc.getElementById('print-page-toc');
  const tocSection = holder ? holder.closest('section') : null;
  const toc = doc.createElement('section');
  toc.className = 'bmm-toc print-page';
  toc.innerHTML = `<div class="toc-title">${esc(a.t.toc)}</div><ol>${items.map((x, i) =>
    `<li class="l${x.level}"><a href="#${esc(x.id)}"><span class="t">${esc(x.title)}</span><span class="dots"></span><span class="pg" data-i="${i}">000</span></a></li>`).join('')}</ol>`;
  if (tocSection) tocSection.replaceWith(toc); else root.insertBefore(toc, cover.nextSibling);
  return items.map((x) => ({ title: x.title, id: x.id, level: x.level }));
}

/** Print the dressed page; returns the bookmarks and page count read back from the file. */
async function printPdf(page, py, file, version, lang, log) {
  await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, outline: true, tagged: true, timeout: 300000 });
  const j = capture(py, [join(TOOL_DIR, 'docs', 'outline_pages.py'), file]);
  try { return JSON.parse(j); } catch { log?.warn?.(`could not read the bookmarks of ${basename(file)}`); return { pages: null, outline: [] }; }
}

/**
 * Dress and print ONE print page. Returns { file, size, pages, tocEntries, numbered }.
 * o: { page (puppeteer page already at the print page), py, lang, version, date, file, siteDir, siteUrl, log }
 */
export async function printBook(o) {
  const { page, py, lang, version, file, siteDir, log } = o;
  const t = textFor(lang);
  const siteUrl = o.siteUrl ?? 'https://freeproject089.github.io/BMM-Docs/';
  const repo = o.repo ?? 'https://github.com/FreeProject089/BMM-Docs';
  const date = (o.date ?? new Date()).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  // Still frames for the GIFs.
  const srcs = await page.evaluate(() => [...document.querySelectorAll('img')].map((i) => i.src).filter((s) => /\.gif(\?|#|$)/i.test(s)));
  const files = new Map();
  for (const s of [...new Set(srcs)]) { try { files.set(s, fileURLToPath(s.split(/[?#]/)[0])); } catch { /* remote */ } }
  const frames = await gifFrames([...files.values()], join(CACHE, 'docs-pdf-frames', lang), log);
  const frameUrls = {};
  for (const [url, p] of files) if (frames.has(p)) frameUrls[url] = pathToFileURL(frames.get(p)).href;
  const wordmark = existsSync(WORDMARK) ? `data:image/svg+xml;base64,${readFileSync(WORDMARK).toString('base64')}` : null;
  await page.addStyleTag({ content: printCss(undefined, { version, lang }) });
  const entries = await page.evaluate(dress, { t, version, date, siteUrl, repo, wordmark, frames: frameUrls, pages: Object.fromEntries(pageUrls(siteDir, siteUrl, lang)) });
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));
  await new Promise((r) => setTimeout(r, 800));
  // Pass 1 with placeholders; pass 2 with the real page numbers (the layout does not change).
  let info = await printPdf(page, py, file, version, lang, log);
  const top = info.outline.filter((x) => x.page);
  // The bookmarks are the h1 of the book in order (the cover and the TOC have none); the TOC lists the same h1 in the same order.
  const clean = (s) => s.replace(/\s+/g, ' ').replace(/¶/g, '').trim();
  let numbered = 0;
  if (entries.length) {
    const same = top.length === entries.length; // same count: trust the order
    const nums = entries.map((e, i) => (top[i] && (same || clean(top[i].title).startsWith(clean(e.title).slice(0, 12))) ? top[i].page : null));
    numbered = nums.filter(Boolean).length;
    if (numbered) {
      await page.evaluate((n) => document.querySelectorAll('.bmm-toc .pg').forEach((el) => { const v = n[+el.dataset.i]; el.textContent = v ?? ''; }), nums);
      info = await printPdf(page, py, file, version, lang, log);
    }
  }
  if (numbered < entries.length) log?.warn?.(`${lang.toUpperCase()}: ${entries.length - numbered} of ${entries.length} table-of-contents entries have no page number (${top.length} bookmarks)`);
  return { file, size: statSync(file).size, pages: info.pages, tocEntries: entries.length, numbered };
}

/** Build the sites and print the languages. Returns [{ lang, file, size, pages, tocEntries, numbered }]. */
export async function buildDocsPdfs(version, { log, outDir = join(releaseDir(version), 'docs'), langs = ['en', 'fr'], build = true, date = new Date() } = {}) {
  if (!existsSync(join(DOCS_DIR, 'mkdocs.pdf-chrome.yml'))) throw new Error('BMM Docs/mkdocs.pdf-chrome.yml not found (is BMM Docs checked out?)');
  const py = await ensureVenv(log);
  const targets = [];
  for (const lang of langs) {
    const { cfg, site } = languageSite(py, lang);
    if (build) {
      const r = await run(py, ['-m', 'mkdocs', 'build', '-q', '-f', cfg], { cwd: DOCS_DIR, log, env: { BMM_PDF_THEME: 'light' } });
      if (r.code) throw new Error(`mkdocs build (${lang}) failed (see the log)`);
    }
    targets.push({ lang, site, page: join(site, 'print_page', 'index.html') });
  }
  mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const out = [];
  try {
    for (const t of targets) {
      if (!existsSync(t.page)) { log?.warn(`no print page for ${t.lang} (${t.page})`); continue; }
      const page = await browser.newPage();
      await page.goto(pathToFileURL(t.page).href, { waitUntil: 'networkidle0', timeout: 180000 });
      // Mermaid renders after load. Material replaces each <pre class="mermaid"> with an empty
      // <div class="mermaid"> and draws the SVG in a CLOSED shadow root (invisible to scripts):
      // a drawn diagram is a div with a height. Wait for all of them, or 90 s.
      const counts = await page.waitForFunction(() => {
        const pre = document.querySelectorAll('pre.mermaid').length;
        const divs = [...document.querySelectorAll('div.mermaid')];
        const drawn = divs.filter((d) => d.getBoundingClientRect().height > 20).length;
        return pre === 0 && drawn === divs.length ? { drawn } : false;
      }, { timeout: 90000, polling: 500 }).then((h) => h.jsonValue()).catch(() => null);
      if (!counts) log?.warn(`${t.lang.toUpperCase()}: some Mermaid diagrams did not render in time`);
      else log?.info?.(`  ${t.lang.toUpperCase()}: ${counts.drawn} Mermaid diagram(s) drawn`);
      await new Promise((res) => setTimeout(res, 1500));
      const file = join(outDir, `BMM-Docs-${t.lang.toUpperCase()}.pdf`);
      const r = await printBook({ page, py, lang: t.lang, version, date, file, siteDir: t.site, log });
      await page.close();
      if (r.size < 100_000) throw new Error(`${file} is suspiciously small (${fmtBytes(r.size)})`);
      out.push({ lang: t.lang.toUpperCase(), ...r });
    }
  } finally { await browser.close(); }
  return out;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('docs/pdf.mjs')) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const version = get('--version') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const langs = get('--lang') ? [get('--lang')] : ['en', 'fr'];
  const log = { info: console.log, warn: (s) => console.log('WARN', s), ok: console.log, line() {}, write() {} };
  const r = await buildDocsPdfs(version, { log, langs, build: !a.includes('--no-build'), outDir: get('--out') ?? undefined });
  for (const x of r) console.log(`${x.lang}: ${x.file}  ${fmtBytes(x.size)}, ${x.pages} pages, TOC ${x.numbered}/${x.tocEntries} numbered`);
}
