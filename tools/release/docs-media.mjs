// Puts the story clips (screenshots/stories.mjs) into BMM Docs: each story's GIF in
// docs/assets/gifs/, its .bmmreplay in docs/assets/replays/, and one captioned block in the
// matching page (EN and FR), at the end of the page's introduction (before its first « ## »).
// Re-running replaces the block of a story, it never adds a second one.
//
//   node tools/release/docs-media.mjs [--docs "<path to BMM Docs>"] [--stories <dir>] [--gif-max 2.4] [story …]
//
// The GIF on a page is rebuilt from the story's MP4 at 760 px and 10 fps, at most --gif-max MB
// (the in-app Help hub bundles it); one that cannot fit gets its replay only. Edits are small and targeted: a page
// somebody else is editing keeps their text.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT } from './lib/util.mjs';
import { gifFromMp4 } from './screenshots/stories.mjs';
import { ffmpegPath } from './screenshots/gifs.mjs';

const a = process.argv.slice(2);
const get = (k, d) => { const i = a.indexOf(k); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const docsRoot = get('--docs', join(ROOT, 'BMM Docs'));
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const storiesDir = get('--stories', join(ROOT, 'Release', version, 'media', 'stories'));
const gifMax = Number(get('--gif-max', 2.4)) * 1048576;   // the docs GIF: narrower than the release one, it ships inside the app
const only = a.filter((x) => !x.startsWith('--'));

const index = JSON.parse(readFileSync(join(storiesDir, 'stories.json'), 'utf8'));
const out = [];
for (const s of index.stories) {
  if (only.length && !only.includes(s.name)) continue;
  const page = (s.docs || []).find((d) => existsSync(join(docsRoot, 'docs', `${d}.md`)));
  if (!page) { out.push(`${s.name}: no docs page found among ${(s.docs || []).join(', ')}`); continue; }
  let withGif = false;
  if (existsSync(join(storiesDir, s.mp4))) {
    mkdirSync(join(docsRoot, 'docs/assets/gifs'), { recursive: true });
    const dest = join(docsRoot, 'docs/assets/gifs', s.gif);
    const r = gifFromMp4(ffmpegPath(), join(storiesDir, s.mp4), dest, { width: 760, fps: 10, maxMb: gifMax / 1048576, tries: [[760, 10, 128], [680, 9, 96], [600, 8, 64], [520, 8, 48]] });
    withGif = !r.overLimit;
    out.push(`${s.name}: docs GIF ${(r.bytes / 1048576).toFixed(2)} MB at ${r.width}px${withGif ? '' : ' (over the limit, not used)'}`);
  }
  if (s.replay && existsSync(join(storiesDir, s.replay))) {
    mkdirSync(join(docsRoot, 'docs/assets/replays'), { recursive: true });
    copyFileSync(join(storiesDir, s.replay), join(docsRoot, 'docs/assets/replays', s.replay));
  }
  // The replay embed is raw HTML read in the browser, relative to the page's URL (one folder deeper
  // than the file: the site serves /features/x/). A markdown image is resolved by mkdocs relative to
  // the FILE, so it needs one less: `mkdocs build --strict` fails on the other spelling.
  const up = '../'.repeat(page.split('/').length);
  const upImg = '../'.repeat(page.split('/').length - 1);
  for (const lang of ['en', 'fr']) {
    const file = join(docsRoot, 'docs', lang === 'en' ? `${page}.md` : `${page}.fr.md`);
    if (!existsSync(file)) { out.push(`${s.name}: ${file} missing`); continue; }
    const title = s.title[lang], desc = s.desc[lang];
    const block = [`<!-- story:${s.name} -->`,
      ...(withGif ? [`![${title}](${upImg}assets/gifs/${s.gif})`, '', `*${title}. ${desc}*`, ''] : []),
      ...(s.replay ? [`<div class="bmm-replay"`, `     data-src="${up}assets/replays/${s.replay}"`, `     data-title="${title.replace(/"/g, '&quot;')}"></div>`] : []),
      `<!-- /story:${s.name} -->`].join('\n');
    let text = readFileSync(file, 'utf8');
    const re = new RegExp(`<!-- story:${s.name} -->[\\s\\S]*?<!-- /story:${s.name} -->`);
    if (re.test(text)) text = text.replace(re, () => block);
    else {
      const m = /\n## /.exec(text);
      text = m ? `${text.slice(0, m.index)}\n\n${block}\n${text.slice(m.index)}` : `${text.replace(/\s*$/, '')}\n\n${block}\n`;
    }
    writeFileSync(file, text, 'utf8');
    out.push(`${s.name}: ${lang} ${page}${withGif ? '' : ' (replay only, GIF over the limit)'}`);
  }
}
console.log(out.join('\n'));
