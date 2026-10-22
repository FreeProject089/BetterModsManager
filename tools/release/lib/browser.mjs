// Headless Chrome/Edge through puppeteer-core (already a devDependency of BMM: no download).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { ROOT } from './util.mjs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

export function findChrome() { return CANDIDATES.find((p) => p && existsSync(p)) ?? null; }

export function loadPuppeteer() {
  try { return createRequire(join(ROOT, 'package.json'))('puppeteer-core'); } catch { return null; }
}

/** Launch, or throw a sentence saying what is missing. */
export async function launch(opts = {}) {
  const exe = findChrome();
  const pp = loadPuppeteer();
  if (!exe) throw new Error('no Chrome/Edge found (set CHROME_PATH)');
  if (!pp) throw new Error('puppeteer-core is not installed (npm install at the repository root)');
  return pp.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars', '--allow-file-access-from-files'], ...opts });
}

/** Render an SVG string to PNG bytes at its own size. */
export async function svgToPng(browser, svg, w, h, { scale = 1, transparent = false } = {}) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: Math.ceil(w), height: Math.ceil(h), deviceScaleFactor: scale });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${transparent ? 'transparent' : '#fff'}}svg{display:block}</style></head><body>${svg}</body></html>`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode?.().catch(() => {}))));
    await page.evaluate(() => document.fonts?.ready);
    await new Promise((r) => setTimeout(r, 120));
    return await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, omitBackground: transparent, type: 'png' });
  } finally { await page.close(); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm', '.md': 'text/markdown' };

/** A static file server on 127.0.0.1 (random port) for `dir`. Resolves { url, close }. */
export function serveStatic(dir) {
  const base = resolve(dir);
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const dirPath = normalize(join(base, p));
      if (dirPath !== base && !dirPath.startsWith(base + sep)) { res.writeHead(403).end(); return; }
      if (p.endsWith('/')) {
        // A folder without index.html gets a listing, as `python -m http.server` gives: the
        // app's browser mock reads assets/builtin-themes/ that way (1.0.4).
        const names = await readdir(dirPath).catch(() => null);
        if (names && !names.includes('index.html')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><ul>${names.map((n) => `<li><a href="${encodeURIComponent(n)}">${n}</a></li>`).join('')}</ul>`);
          return;
        }
        p += 'index.html';
      }
      const f = normalize(join(base, p));
      if (f !== base && !f.startsWith(base + sep)) { res.writeHead(403).end(); return; }
      const body = await readFile(f);
      res.writeHead(200, { 'Content-Type': MIME[extname(f).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) })));
}
