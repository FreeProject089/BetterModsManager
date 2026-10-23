import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { renderCloseSound, writeWav } from './audio-synth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHROME   = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTML     = 'file:///' + resolve(__dirname, 'dev-pages/vhs-exit-preview.html').replace(/\\/g, '/');
const OUT_DIR  = resolve(__dirname, 'video-out');
const FFMPEG   = 'ffmpeg';

// Animation starts on load, runs ~0.93s, then holds black.
const DURATION = 2000;

const RESOLUTIONS = [
  { label: '1920x1080', w: 1920, h: 1080 },
  { label: '3440x1440', w: 3440, h: 1440 },
];

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR);

// Generate close SFX once — same audio for all resolutions
const AUDIO_PATH = join(OUT_DIR, '_close_sfx.wav');
console.log('  Synthesising close SFX...');
writeWav(AUDIO_PATH, renderCloseSound());

for (const res of RESOLUTIONS) {
  console.log(`\n▶  Recording ${res.label}...`);
  const framesDir = join(OUT_DIR, `vhs_frames_${res.label}`);
  if (existsSync(framesDir)) rmSync(framesDir, { recursive: true });
  mkdirSync(framesDir);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      `--window-size=${res.w},${res.h}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--disable-web-security',
      '--allow-file-access-from-files',
      '--allow-running-insecure-content',
      '--enable-experimental-web-platform-features', // import maps on older Chrome
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: res.w, height: res.h, deviceScaleFactor: 1 });

  const client = await page.createCDPSession();
  const frames = [];

  await client.on('Page.screencastFrame', async ({ data, sessionId }) => {
    frames.push(Buffer.from(data, 'base64'));
    await client.send('Page.screencastFrameAck', { sessionId });
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    everyNthFrame: 1,
  });

  await page.goto(HTML, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, DURATION));

  await client.send('Page.stopScreencast');
  await browser.close();

  console.log(`  Captured ${frames.length} frames`);

  frames.forEach((buf, i) => {
    writeFileSync(join(framesDir, String(i).padStart(6, '0') + '.jpg'), buf);
  });

  const outFile   = join(OUT_DIR, `vhs_exit_${res.label}.mp4`);
  const actualFps = Math.max(24, Math.round(frames.length / (DURATION / 1000)));
  console.log(`  Encoding at ~${actualFps} fps → ${outFile}`);

  execSync(
    `"${FFMPEG}" -y -framerate ${actualFps} -i "${join(framesDir, '%06d.jpg')}" ` +
    `-i "${AUDIO_PATH}" ` +
    `-c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p ` +
    `-c:a aac -af apad -shortest "${outFile}"`,
    { stdio: 'inherit' }
  );

  rmSync(framesDir, { recursive: true });
  console.log(`  ✓ Saved: ${outFile}`);
}

// Cleanup temporary audio file
unlinkSync(AUDIO_PATH);

console.log('\n✓ Done. Files in: ' + OUT_DIR);
