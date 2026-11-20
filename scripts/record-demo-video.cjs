// Records /demo?autoplay=1 in landscape (1920x1080) and vertical (1080x1920), then encodes MP4.
// usage: node record-video.cjs [baseUrl] [outDir]
// The demo sets window.__demoDone = true when its last step has shown; we hold the end card briefly.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || 'http://localhost:3300';
const out = process.argv[3] || path.join(__dirname, '..', 'video');
fs.mkdirSync(out, { recursive: true });

const FORMATS = [
  { name: 'landscape', width: 1920, height: 1080 },
  { name: 'vertical', width: 1080, height: 1920 },
];

async function record({ name, width, height }) {
  const browser = await chromium.launch();
  const dir = path.join(out, `raw-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, recordVideo: { dir, size: { width, height } } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const t0 = Date.now();
  await page.goto(`${base}/demo?autoplay=1`, { waitUntil: 'networkidle' });
  const lead = (Date.now() - t0) / 1000;
  await page.waitForFunction(() => window.__demoDone === true, null, { timeout: 90_000 });
  await page.waitForTimeout(2000); // hold the end card
  const total = (Date.now() - t0) / 1000;
  const video = page.video();
  await context.close();
  await browser.close();
  const webm = await video.path();
  const mp4 = path.join(out, `tradequote-demo-${name}.mp4`);
  // Skip the page-load lead-in; fade in and out; H.264 for every platform
  const dur = Math.max(1, total - lead);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', lead.toFixed(2), '-i', webm, '-t', dur.toFixed(2),
    '-vf', `fps=30,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=${Math.max(0, dur - 0.6).toFixed(2)}:d=0.6`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', '-an', mp4]);
  console.log(JSON.stringify({ name, mp4, seconds: Number(dur.toFixed(1)), leadIn: Number(lead.toFixed(1)), errors }));
}

(async () => {
  for (const f of FORMATS) await record(f);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
