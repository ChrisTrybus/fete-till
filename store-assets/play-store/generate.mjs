// Frames the raw emulator captures into Google Play phone screenshots (1440x2560, 9:16),
// in the same style as the App Store set (store-assets/app-store/ipad-13).
// Capture first:  node scripts/play-screenshots.mjs prep phone / shot phone <name>
// Then:           node store-assets/play-store/generate.mjs
// Needs Google Chrome or Microsoft Edge installed; set CHROME=<path> to override.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const html = join(here, 'html');
mkdirSync(out, { recursive: true });
mkdirSync(html, { recursive: true });

const C = {
  green: '#1f6b45',
  greenLight: '#2b8358',
  greenDark: '#154d31',
  red: '#e25a4d',
  gold: '#f4c542',
  blue: '#3d8fd0',
  pink: '#e98bb0',
  white: '#f3f6f1',
};
const FLAGS = [C.red, C.gold, C.blue, C.pink, C.white];

// Screens in listing order. Source is ./phone/<file>.png from play-screenshots.mjs.
const SCREENS = [
  { file: '01-till', title: 'Tap, total, give change', sub: 'Big buttons and a change calculator for busy stalls' },
  { file: '02-day-total', title: 'Your takings at a glance', sub: 'Cash, card and every item sold, ready to count up' },
  { file: '03-price-list', title: 'Set your prices once', sub: 'Change them any time, each item in its own colour' },
  { file: '04-event', title: 'Works with no signal', sub: 'Sales are kept safe on the phone, field or village hall' },
];

const o = { W: 1440, H: 2560, shotW: 1080, shotH: 1920, top: 470, bottom: 80, title: 92, sub: 46 };

function bunting(W, flags, size) {
  const step = W / flags;
  let tri = '';
  for (let i = 0; i < flags; i++) {
    const x = i * step + step / 2;
    tri += `<polygon points="${x - size / 2},0 ${x + size / 2},0 ${x},${size * 1.2}" fill="${FLAGS[i % FLAGS.length]}"/>`;
  }
  return `<svg class="bunting" viewBox="0 0 ${W} ${size * 1.3}" width="${W}" height="${size * 1.3}">${tri}</svg>`;
}

function page(s, img) {
  // Phone = screenshot + slim bezel, scaled to fit the space under the caption.
  const bezel = Math.round(o.W * 0.016);
  const availH = o.H - o.top - o.bottom;
  const scale = (availH - 2 * bezel) / o.shotH;
  const sw = Math.round(o.shotW * scale), sh = Math.round(o.shotH * scale);
  const dw = sw + 2 * bezel, dh = sh + 2 * bezel;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${o.W}px;height:${o.H}px;overflow:hidden}
body{background:radial-gradient(ellipse at 50% 60%, ${C.greenLight} 0%, ${C.green} 55%, ${C.greenDark} 100%);
  font-family:"Segoe UI",system-ui,sans-serif;color:#fff;position:relative}
.bunting{position:absolute;left:0;top:0}
.cap{position:absolute;left:0;right:0;top:${Math.round(o.top * 0.3)}px;text-align:center;padding:0 80px}
h1{margin:0;font-size:${o.title}px;font-weight:800;letter-spacing:-1px;line-height:1.05}
p{margin:${Math.round(o.sub * 0.5)}px 0 0;font-size:${o.sub}px;font-weight:500;opacity:.88;line-height:1.25}
.device{position:absolute;left:${(o.W - dw) / 2}px;top:${o.top}px;width:${dw}px;height:${dh}px;
  background:#111;border-radius:${bezel * 3.2}px;box-shadow:0 40px 90px rgba(0,0,0,.35), inset 0 0 0 3px #333}
.device img{position:absolute;left:${bezel}px;top:${bezel}px;width:${sw}px;height:${sh}px;border-radius:${bezel * 2.2}px;display:block}
</style></head><body>
${bunting(o.W, 17, Math.round(o.W * 0.04))}
<div class="cap"><h1>${s.title}</h1><p>${s.sub}</p></div>
<div class="device"><img src="../phone/${img}"></div>
</body></html>`;
}

const chrome = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!chrome) throw new Error('No Chrome/Edge found; set CHROME=<path>');

for (const s of SCREENS) {
  if (!existsSync(join(here, 'phone', `${s.file}.png`))) {
    console.warn('skipped (no capture):', s.file);
    continue;
  }
  const file = join(html, `phone-${s.file}.html`);
  writeFileSync(file, page(s, `${s.file}.png`));
  const png = join(out, `phone-${s.file}-${o.W}x${o.H}.png`);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${o.W},${o.H}`, '--allow-file-access-from-files',
    `--screenshot=${png}`, pathToFileURL(file).href,
  ], { stdio: 'ignore' });
  console.log('wrote', png);
}
