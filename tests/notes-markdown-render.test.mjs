// Every markdown file the Release Notes modal can open, rendered by the REAL modal, in a real
// browser, and measured.
//
// Why a browser and not a string test: the defects this guards were all invisible in the
// markup. The code-block "Copy" button was in the HTML, with its styles — and the sanitiser's
// overlay filter stripped its inline `position:absolute`, so it rendered as a bare native button
// under the block. A long unbreakable path in inline code pushed the whole page sideways. Both
// need layout and the cascade to see, and a string assertion would have passed over both.
//
// What it checks, for every shipped `.md` under Update/ (both languages):
//   1. no unstyled button: every <button> inside the rendered body has `appearance: none`
//      (a UA-default button keeps `auto`), and a copy button sits INSIDE its code block;
//   2. every copy button is wired: a click puts exactly that block's code on the clipboard and
//      shows the "copied" state — and when the Clipboard API refuses, the fallback still copies;
//   3. nothing is wider than the content column: the scroller does not scroll sideways, and
//      every element outside an intentional scroll box (a code block, a wide table) ends
//      inside the column.
//
// Needs a Chromium. It looks in the usual places (and BMM_TEST_BROWSER); with none, the suite
// is SKIPPED, loudly, rather than passing over nothing.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONT = join(ROOT, 'frontend');
const UPDATE = join(ROOT, 'Update');
const require = createRequire(join(ROOT, 'package.json'));

const CANDIDATES = [
  process.env.BMM_TEST_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const BROWSER = CANDIDATES.find((p) => { try { return existsSync(p); } catch { return false; } });
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch { /* not installed */ }
const SKIP = !BROWSER || !puppeteer ? `no Chromium / puppeteer-core available (set BMM_TEST_BROWSER)` : false;
if (SKIP) console.warn(`notes-markdown-render: SKIPPED — ${SKIP}`);

// ── the Update/ tree, as the Rust commands return it ──────────────────────────────────────
function tree(dir, lang) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(UPDATE, p).split(sep).join('\\');   // Windows separators, like Rust there
    if (statSync(p).isDirectory()) out.push({ name, path: rel, is_folder: true, children: tree(p, lang) });
    else if (name.endsWith(`_${lang.toUpperCase()}.md`)) out.push({ name, path: rel, is_folder: false, children: [] });
  }
  return out.sort((a, b) => (a.is_folder === b.is_folder ? a.name.localeCompare(b.name) : a.is_folder ? -1 : 1));
}
function notesIn(subDir, lang) {
  const dir = subDir ? join(UPDATE, ...String(subDir).split(/[\\/]/)) : UPDATE;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(`_${lang.toUpperCase()}.md`) && statSync(join(dir, n)).isFile())
    .map((filename) => ({ filename, content: readFileSync(join(dir, filename), 'utf8') }));
}
function allFiles(dir = UPDATE) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? allFiles(p) : n.endsWith('.md') ? [relative(UPDATE, p).split(sep).join('\\')] : [];
  });
}

const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/main.css">
<script type="importmap">{ "imports": { "/js/ui/app.js": "/__stub/app.js" } }</script>
<script src="/js/lib/marked.min.js"></script><script src="/js/lib/purify.min.js"></script>
<script>
  window.__copied = [];
  window.__clipboardFails = false;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (s) => { if (window.__clipboardFails) throw new Error('denied'); window.__copied.push(String(s)); },
  } });
  const realExec = document.execCommand.bind(document);
  document.execCommand = (cmd, ...a) => {
    if (cmd === 'copy') { const ta = document.activeElement; window.__copied.push('EXEC:' + (ta && 'value' in ta ? ta.value : '')); return true; }
    return realExec(cmd, ...a);
  };
  window.__TAURI__ = { core: { invoke: async (cmd, args) => {
    const r = await fetch('/__invoke/' + cmd, { method: 'POST', body: JSON.stringify(args || {}) });
    return r.json();
  } }, event: { listen: async () => () => {} } };
</script></head><body>
<div id="app-window-outer"></div>
<script type="module">
  const api = await import('/js/core/api.js');
  await api.loadTauri();
  const i18n = await import('/js/core/i18n.js');
  await i18n.initI18n();
  window.__notes = await import('/js/ui/update-notes.js');
  window.__ready = true;
</script></body></html>`;

let server, browser, page, base;
const LANG = { current: 'en' };

describe('Release Notes modal renders every shipped .md cleanly', { skip: SKIP }, () => {
  before(async () => {
    const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.html': 'text/html', '.png': 'image/png', '.woff2': 'font/woff2' };
    server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HARNESS); return; }
      if (url === '/__stub/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export function toast() {}'); return; }
      if (url.startsWith('/__invoke/')) {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const cmd = url.slice('/__invoke/'.length);
          const args = body ? JSON.parse(body) : {};
          let out = null;
          if (cmd === 'get_settings') out = { language: LANG.current };
          else if (cmd === 'get_available_languages') out = ['en', 'fr'];
          else if (cmd === 'get_language_content') out = readFileSync(join(FRONT, 'Lang', `${args.lang}.json`), 'utf8');
          else if (cmd === 'get_update_folder_structure') out = tree(UPDATE, args.lang || LANG.current);
          else if (cmd === 'get_update_notes') out = notesIn(args.subDir, args.lang || LANG.current);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out));
        });
        return;
      }
      const file = join(FRONT, url);
      if (!file.startsWith(FRONT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}/`;
    browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    page = await browser.newPage();
    // A modest window: the owner's report came from a normal desktop size, and a narrow one is
    // where sideways overflow shows first.
    await page.setViewport({ width: 1100, height: 760 });
  });
  after(async () => { await browser?.close(); await new Promise((r) => server ? server.close(r) : r()); });

  for (const lang of ['en', 'fr']) {
    test(`${lang}: every note — styled buttons, wired copy, no sideways overflow`, async () => {
      LANG.current = lang;
      await page.goto(base, { waitUntil: 'load' });
      await page.waitForFunction('window.__ready === true', { timeout: 20000 });
      await page.evaluate(() => window.__notes.openUpdateNotesModal());
      await page.waitForSelector('#modal-update-notes .ptb-sidebar-item');
      // Let the stylesheets the renderer links on first use arrive before anything is measured.
      await page.waitForFunction(() => [...document.styleSheets].every((s) => { try { return !!s.cssRules; } catch { return true; } }));
      const paths = await page.$$eval('#modal-update-notes .ptb-sidebar-item', (els) => els.map((e) => e.dataset.path));
      const expected = allFiles().filter((p) => p.endsWith(`_${lang.toUpperCase()}.md`));
      assert.equal(paths.length, expected.length, `the modal lists every ${lang} note`);

      const problems = [];
      let copyButtons = 0;
      for (const p of paths) {
        await page.evaluate((path) => {
          document.querySelector(`#modal-update-notes .ptb-sidebar-item[data-path="${CSS.escape(path)}"]`).click();
        }, p);
        await page.waitForFunction(() => !!document.querySelector('#update-notes-content-target .md-body'));
        await new Promise((r) => setTimeout(r, 30));
        const r = await page.evaluate(async () => {
          const out = { bad: [], copies: 0 };
          const scroller = document.querySelector('#update-notes-content-target .ptb-modal-body');
          const body = scroller.querySelector('.md-body');
          // 1. buttons
          for (const b of body.querySelectorAll('button')) {
            const cs = getComputedStyle(b);
            if (cs.appearance !== 'none' && cs.webkitAppearance !== 'none') out.bad.push(`unstyled <button> "${b.textContent.trim().slice(0, 30)}"`);
            if (b.classList.contains('md-copy-btn')) {
              const block = b.closest('.md-code-block');
              const br = b.getBoundingClientRect(), kr = block?.getBoundingClientRect();
              if (!kr || br.top < kr.top - 1 || br.bottom > kr.bottom + 1 || br.left < kr.left - 1 || br.right > kr.right + 1) out.bad.push('copy button outside its code block');
              if (cs.position !== 'absolute') out.bad.push('copy button not overlaid on its block');
            }
          }
          // 2. copy wiring
          const blocks = [...body.querySelectorAll('.md-code-block')];
          for (const [i, block] of blocks.entries()) {
            const btn = block.querySelector('.md-copy-btn');
            if (!btn) { out.bad.push(`code block #${i} has no copy button`); continue; }
            out.copies++;
            const want = block.querySelector('pre code')?.textContent ?? '';
            window.__copied = [];
            window.__clipboardFails = i === 0;   // the first block of each note exercises the fallback
            btn.scrollIntoView();
            btn.click();
            await new Promise((r) => setTimeout(r, 20));
            const got = window.__copied[0];
            const expect = i === 0 ? `EXEC:${want}` : want;
            if (got !== expect) out.bad.push(`copy #${i} put ${JSON.stringify(String(got).slice(0, 40))} on the clipboard, wanted ${JSON.stringify(expect.slice(0, 40))}`);
            if (!btn.classList.contains('is-copied')) out.bad.push(`copy #${i} shows no copied state`);
          }
          window.__clipboardFails = false;
          // 3. overflow
          if (scroller.scrollWidth > scroller.clientWidth + 1) out.bad.push(`content scrolls sideways (${scroller.scrollWidth} > ${scroller.clientWidth})`);
          const limit = body.getBoundingClientRect().right + 1;
          const scrollBox = (el) => { for (let n = el.parentElement; n && n !== body; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
          for (const el of body.querySelectorAll('*')) {
            if (scrollBox(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.width && r.right > limit) { out.bad.push(`<${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}> ends ${Math.round(r.right - limit)}px past the column`); break; }
          }
          return out;
        });
        copyButtons += r.copies;
        for (const b of r.bad) problems.push(`${p}: ${b}`);
      }
      assert.ok(copyButtons > 10, `the notes hold code blocks to test (found ${copyButtons})`);
      assert.deepEqual(problems, [], `\n${problems.slice(0, 40).join('\n')}${problems.length > 40 ? `\n… and ${problems.length - 40} more` : ''}`);
    });
  }
});
