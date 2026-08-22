import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { renderBootSound, writeWav } from './audio-synth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHROME   = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTML     = 'file:///' + resolve(__dirname, 'dev-pages/loader-preview.html').replace(/\\/g, '/');
const OUT_DIR  = resolve(__dirname, 'video-out');
const FFMPEG   = 'ffmpeg';
const DURATION  = 5500; // ms to record (animation completes ~3.6s + fade out buffer)
const FADE_START = 4.4;  // seconds before fade to black starts
const FADE_DUR   = 1.0;  // seconds
const FPS      = 60;

const RESOLUTIONS = [
  { label: '1920x1080', w: 1920, h: 1080 },
  { label: '3440x1440', w: 3440, h: 1440 },
];

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR);

// Generate boot SFX once — same audio for all resolutions
const AUDIO_PATH = join(OUT_DIR, '_boot_sfx.wav');
console.log('  Synthesising boot SFX...');
writeWav(AUDIO_PATH, renderBootSound());

for (const res of RESOLUTIONS) {
  console.log(`\n▶ Recording ${res.label}...`);
  const framesDir = join(OUT_DIR, `frames_${res.label}`);
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
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: res.w, height: res.h, deviceScaleFactor: 1 });

  // Collect frames via CDP screencast
  const client = await page.createCDPSession();
  const frames = [];

  await client.on('Page.screencastFrame', async ({ data, sessionId }) => {
    frames.push(Buffer.from(data, 'base64'));
    await client.send('Page.screencastFrameAck', { sessionId });
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    everyNthFrame: 1,
  });

  await page.goto(HTML, { waitUntil: 'domcontentloaded' });

  // Wait for full animation to play
  await new Promise(r => setTimeout(r, DURATION));

  await client.send('Page.stopScreencast');
  await browser.close();

  console.log(`  Captured ${frames.length} frames`);

  // Write frames to disk
  frames.forEach((buf, i) => {
    const name = String(i).padStart(6, '0') + '.jpg';
    writeFileSync(join(framesDir, name), buf);
  });

  // Encode with ffmpeg
  const outFile = join(OUT_DIR, `loader_${res.label}.mp4`);
  const actualFps = Math.round(frames.length / (DURATION / 1000));
  console.log(`  Encoding at ~${actualFps}fps → ${outFile}`);

  execSync(
    `"${FFMPEG}" -y -framerate ${actualFps} -i "${join(framesDir, '%06d.jpg')}" ` +
    `-i "${AUDIO_PATH}" ` +
    `-vf "fade=t=out:st=${FADE_START}:d=${FADE_DUR}" ` +
    `-c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p ` +
    `-c:a aac -af apad -shortest "${outFile}"`,
    { stdio: 'inherit' }
  );

  // Cleanup frames
  rmSync(framesDir, { recursive: true });
  console.log(`  ✓ Saved: ${outFile}`);
}

// Cleanup temporary audio file
unlinkSync(AUDIO_PATH);

console.log('\n✓ All done.');
