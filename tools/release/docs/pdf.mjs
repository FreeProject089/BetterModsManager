// BMM Docs → PDF (English and French), without WeasyPrint/GTK.
//
// The docs repository has a Chrome path already (BMM Docs/tools/build_pdf_chrome.py with
// mkdocs.pdf-chrome.yml: mkdocs-print-site-plugin folds the site into one /print_page/). This
// module does the same in Node so it can print BOTH languages and wait for Mermaid properly:
//   1. a private venv (tools/release/.cache/docs-venv) with the docs' hashed requirements.txt,
//      plus mkdocs-print-site-plugin, which mkdocs.pdf-chrome.yml needs but the lock does not pin;
//   2. one single-language site per language (lang_config.py), built into the cache;
//   3. headless Chrome (puppeteer-core) prints each print_page/ once Mermaid has drawn.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOCS_DIR, TOOL_DIR, releaseDir, fmtBytes } from '../lib/util.mjs';
import { run, capture } from '../lib/exec.mjs';
import { launch } from '../lib/browser.mjs';

export const PRINT_SITE_PLUGIN = 'mkdocs-print-site-plugin>=2.6,<3';
const CACHE = join(TOOL_DIR, '.cache');
const VENV = join(CACHE, 'docs-venv');
const venvPy = () => join(VENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

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
  const has = capture(venvPy(), ['-c', 'import mkdocs, material, mkdocs_print_site_plugin, mkdocs_static_i18n; print("ok")']);
  if (has === 'ok') return venvPy();
  // --no-deps: the lock already lists every transitive package with its hashes, but pip's
  // resolver also reads weasyprint's own `fonttools[woff]>=4.59.2` and refuses it in hash mode
  // (seen 2026-10-14 on Windows, Python 3.12). The PDF path here does not use WeasyPrint.
  let r = await run(venvPy(), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '--no-deps', '-r', join(DOCS_DIR, 'requirements.txt')], { log });
  if (r.code) throw new Error('pip install -r "BMM Docs/requirements.txt" failed');
  r = await run(venvPy(), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', PRINT_SITE_PLUGIN], { log });
  if (r.code) throw new Error(`pip install ${PRINT_SITE_PLUGIN} failed`);
  return venvPy();
}

/** Build the site and print both languages. Returns [{ lang, file, size, pages }]. */
export async function buildDocsPdfs(version, { log, outDir = join(releaseDir(version), 'docs') } = {}) {
  if (!existsSync(join(DOCS_DIR, 'mkdocs.pdf-chrome.yml'))) throw new Error('BMM Docs/mkdocs.pdf-chrome.yml not found (is BMM Docs checked out?)');
  const py = await ensureVenv(log);
  // One single-language site per language (lang_config.py says why: with the i18n plugin the
  // French pass overwrote the one /print_page/, so the « English » book came out French).
  const targets = [];
  for (const lang of ['en', 'fr']) {
    const cfg = capture(py, [join(TOOL_DIR, 'docs', 'lang_config.py'), DOCS_DIR, CACHE, lang]);
    if (!cfg) throw new Error(`lang_config.py ${lang} failed`);
    const r = await run(py, ['-m', 'mkdocs', 'build', '-q', '-f', cfg], { cwd: DOCS_DIR, log, env: { BMM_PDF_THEME: 'light' } });
    if (r.code) throw new Error(`mkdocs build (${lang}) failed (see the log)`);
    targets.push({ lang: lang.toUpperCase(), page: join(CACHE, `docs-site-${lang}`, 'print_page', 'index.html') });
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
      if (!counts) log?.warn(`${t.lang}: some Mermaid diagrams did not render in time`);
      else log?.info?.(`  ${t.lang}: ${counts.drawn} Mermaid diagram(s) drawn`);
      await new Promise((res) => setTimeout(res, 1500));
      await page.evaluate(() => document.fonts?.ready);
      const file = join(outDir, `BMM-Docs-${t.lang}.pdf`);
      await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, timeout: 300000 });
      const pages = await page.evaluate(() => null);
      await page.close();
      const size = statSync(file).size;
      if (size < 100_000) throw new Error(`${file} is suspiciously small (${fmtBytes(size)})`);
      out.push({ lang: t.lang, file, size, pages });
    }
  } finally { await browser.close(); }
  // Page count, when pypdf is in the venv (it is in the docs' requirements).
  for (const o of out) {
    const n = capture(py, ['-c', `from pypdf import PdfReader; print(len(PdfReader(r"${o.file}").pages))`]);
    o.pages = n ? +n : null;
  }
  return out;
}
