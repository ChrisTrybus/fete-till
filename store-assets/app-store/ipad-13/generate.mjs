// Frames real iPad screenshots into App Store "iPad 13-inch" images.
// Portrait 2064x2752, landscape 2752x2064 (the sizes App Store Connect accepts for 13" iPads).
// Usage: node store-assets/app-store/ipad-13/generate.mjs
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

// Screens in App Store order. Source file is <orientation>-<key>.webp in ./source.
const SCREENS = [
  { key: 'till', title: 'Tap, total, give change', sub: 'Big buttons and a change calculator for busy stalls' },
  { key: 'day-total', title: 'Every till, added up live', sub: 'Takings, cash and card from all your volunteers in one place' },
  { key: 'price-list', title: 'Set your prices once', sub: 'Every till gets the same price list, in its own colours' },
  { key: 'event', title: 'Volunteers join with a code', sub: 'Share one code and their sales add into the day total' },
];

const SIZES = {
  portrait: { W: 2064, H: 2752, shotW: 1390, shotH: 2000, top: 610, bottom: 120, title: 132, sub: 62 },
  landscape: { W: 2752, H: 2064, shotW: 2000, shotH: 1390, top: 470, bottom: 90, title: 120, sub: 58 },
};

function bunting(W, flags, size) {
  const step = W / flags;
  let tri = '';
  for (let i = 0; i < flags; i++) {
    const x = i * step + step / 2;
    tri += `<polygon points="${x - size / 2},0 ${x + size / 2},0 ${x},${size * 1.2}" fill="${FLAGS[i % FLAGS.length]}"/>`;
  }
  return `<svg class="bunting" viewBox="0 0 ${W} ${size * 1.3}" width="${W}" height="${size * 1.3}">${tri}</svg>`;
}

function page(o, s, img) {
  // Device = screenshot + bezel, scaled to fit the space under the caption.
  const bezel = Math.round(o.W * 0.018);
  const availH = o.H - o.top - o.bottom;
  const availW = o.W - 2 * Math.round(o.W * 0.07);
  const scale = Math.min((availH - 2 * bezel) / o.shotH, (availW - 2 * bezel) / o.shotW);
  const sw = Math.round(o.shotW * scale), sh = Math.round(o.shotH * scale);
  const dw = sw + 2 * bezel, dh = sh + 2 * bezel;
  const dy = o.top + (availH - dh) / 2;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${o.W}px;height:${o.H}px;overflow:hidden}
body{background:radial-gradient(ellipse at 50% 60%, ${C.greenLight} 0%, ${C.green} 55%, ${C.greenDark} 100%);
  font-family:"Segoe UI",system-ui,sans-serif;color:#fff;position:relative}
.bunting{position:absolute;left:0;top:0}
.cap{position:absolute;left:0;right:0;top:${Math.round(o.top * 0.3)}px;text-align:center;padding:0 120px}
h1{margin:0;font-size:${o.title}px;font-weight:800;letter-spacing:-1px;line-height:1.05}
p{margin:${Math.round(o.sub * 0.5)}px 0 0;font-size:${o.sub}px;font-weight:500;opacity:.88;line-height:1.2}
.device{position:absolute;left:${(o.W - dw) / 2}px;top:${dy}px;width:${dw}px;height:${dh}px;
  background:#111;border-radius:${bezel * 2.4}px;box-shadow:0 40px 90px rgba(0,0,0,.35), inset 0 0 0 4px #333}
.device img{position:absolute;left:${bezel}px;top:${bezel}px;width:${sw}px;height:${sh}px;border-radius:${bezel * 1.1}px;display:block}
</style></head><body>
${bunting(o.W, 23, Math.round(o.W * 0.03))}
<div class="cap"><h1>${s.title}</h1><p>${s.sub}</p></div>
<div class="device"><img src="${img}"></div>
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

for (const [orient, o] of Object.entries(SIZES)) {
  SCREENS.forEach((s, i) => {
    const src = join(here, 'source', `${orient}-${s.key}.webp`);
    if (!existsSync(src)) return;
    const name = `${orient}-${i + 1}-${s.key}`;
    const file = join(html, `${name}.html`);
    writeFileSync(file, page(o, s, `../source/${orient}-${s.key}.webp`));
    const png = join(out, `${name}-${o.W}x${o.H}.png`);
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${o.W},${o.H}`, '--allow-file-access-from-files',
      `--screenshot=${png}`, pathToFileURL(file).href,
    ], { stdio: 'ignore' });
    console.log('wrote', png);
  });
}
