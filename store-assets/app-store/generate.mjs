// Generates App Store featuring artwork (Header + Search Results) for Cash Tin.
// Usage: node store-assets/app-store/generate.mjs  -> writes HTML, then render.sh screenshots them.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const C = {
  green: '#1f6b45',
  greenLight: '#2b8358',
  greenDark: '#154d31',
  red: '#e25a4d',
  redDark: '#c2463a',
  redDeep: '#9e3830',
  gold: '#f4c542',
  goldRim: '#d9a821',
  goldDeep: '#b8891a',
  blue: '#3d8fd0',
  pink: '#e98bb0',
  white: '#f3f6f1',
  ink: '#2b2200',
};
const FLAGS = [C.red, C.gold, C.blue, C.pink, C.white];

// Point/tangent on a quadratic bezier.
function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    dx: 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
    dy: 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
  };
}

function swag(x1, x2, y, sag, count, size, offset = 0, stroke = 7) {
  const p0 = { x: x1, y }, p2 = { x: x2, y };
  const p1 = { x: (x1 + x2) / 2, y: y + sag * 2 };
  let out = `<path d="M${x1} ${y} Q${p1.x} ${p1.y} ${x2} ${y}" fill="none" stroke="${C.white}" stroke-width="${stroke}" stroke-linecap="round"/>`;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const q = quad(p0, p1, p2, t);
    const ang = (Math.atan2(q.dy, q.dx) * 180) / Math.PI;
    const w = size, h = size * 1.25;
    out += `<g transform="translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) rotate(${ang.toFixed(1)})">
      <polygon points="${-w / 2},0 ${w / 2},0 0,${h}" fill="${FLAGS[(i + offset) % FLAGS.length]}"/>
    </g>`;
  }
  return out;
}

// Deterministic pseudo-random for confetti.
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function confetti(W, H, n, seed, avoid) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = H * 0.28 + r() * H * 0.72;
    if (avoid && Math.abs(x - avoid.x) < avoid.w && Math.abs(y - avoid.y) < avoid.h) continue;
    const c = FLAGS[Math.floor(r() * FLAGS.length)];
    const s = 5 + r() * 9;
    const rot = r() * 180;
    out += r() > 0.5
      ? `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(s / 2).toFixed(1)}" fill="${c}" opacity=".55"/>`
      : `<rect x="${(x - s).toFixed(0)}" y="${(y - s / 3).toFixed(0)}" width="${(s * 2).toFixed(0)}" height="${(s / 1.5).toFixed(0)}" rx="2" fill="${c}" opacity=".55" transform="rotate(${rot.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`;
  }
  return out;
}

function poundCoin(cx, cy, r) {
  const k = r / 256; // icon coin radius was 256 units
  return `<g transform="translate(${cx} ${cy}) scale(${k})">
    <circle r="256" fill="${C.gold}"/>
    <circle r="226" fill="none" stroke="${C.goldRim}" stroke-width="13"/>
    <path d="M-102 -2 H52 M-102 100 H96 M-32 100 V-64 C-32 -134 78 -154 96 -80"
      fill="none" stroke="${C.ink}" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
}

function coinStack(x, y, n, rx = 62) {
  const ry = rx * 0.32, step = rx * 0.26;
  let out = '';
  for (let i = 0; i < n; i++) {
    const yy = y - i * step;
    out += `<path d="M${x - rx} ${yy} v${step} a${rx} ${ry} 0 0 0 ${rx * 2} 0 v${-step}" fill="${C.goldDeep}"/>
      <ellipse cx="${x}" cy="${yy}" rx="${rx}" ry="${ry}" fill="${i === n - 1 ? C.gold : C.goldRim}"/>`;
  }
  const top = y - (n - 1) * step;
  out += `<ellipse cx="${x}" cy="${top}" rx="${rx * 0.78}" ry="${ry * 0.78}" fill="none" stroke="${C.goldRim}" stroke-width="5"/>`;
  return out;
}

function note(x, y, w, h, rot, fill, band) {
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="10" fill="${fill}"/>
    <rect x="${-w / 2 + 14}" y="${-h / 2 + 14}" width="${w - 28}" height="${h - 28}" rx="6" fill="none" stroke="${band}" stroke-width="5"/>
    <circle cx="${w / 4}" cy="0" r="${h / 5}" fill="${band}"/>
  </g>`;
}

// Centerpiece: open cash tin with notes, coin stacks and a big £ coin. Origin = visual centre.
function centerpiece() {
  return `
  <ellipse cx="0" cy="250" rx="520" ry="46" fill="#000" opacity=".18"/>
  <!-- lid (open, tilted back) -->
  <polygon points="-250,-10 250,-10 222,-215 -222,-215" fill="${C.redDark}"/>
  <polygon points="-220,-24 220,-24 198,-196 -198,-196" fill="${C.redDeep}"/>
  <!-- notes and coins peeking out of the tin -->
  ${note(-95, -42, 230, 120, -12, '#8fd6ad', C.green)}
  ${note(60, -52, 230, 120, 9, C.pink, '#c8628c')}
  <circle cx="175" cy="-18" r="44" fill="${C.goldRim}"/><circle cx="175" cy="-18" r="32" fill="${C.gold}"/>
  <circle cx="-185" cy="-14" r="38" fill="${C.goldRim}"/><circle cx="-185" cy="-14" r="27" fill="${C.gold}"/>
  <!-- tin body -->
  <rect x="-270" y="-14" width="540" height="250" rx="26" fill="${C.red}"/>
  <rect x="-270" y="176" width="540" height="60" rx="26" fill="${C.redDark}"/>
  <rect x="-270" y="-14" width="540" height="26" rx="13" fill="#ec7064"/>
  <!-- latch plate -->
  <rect x="-58" y="62" width="116" height="78" rx="16" fill="${C.white}"/>
  <circle cx="0" cy="92" r="13" fill="${C.ink}"/><rect x="-5" y="98" width="10" height="24" rx="4" fill="${C.ink}"/>
  <!-- coin stacks (left) -->
  ${coinStack(-380, 228, 4, 58)}
  ${coinStack(-500, 236, 2, 50)}
  <!-- big coin (right) -->
  ${poundCoin(360, 92, 165)}
  `;
}

function svg(W, H, opts) {
  const { bunting, cpScale, cpY, confettiN } = opts;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
  <defs>
    <radialGradient id="bg" cx="50%" cy="58%" r="70%">
      <stop offset="0" stop-color="${C.greenLight}"/>
      <stop offset=".6" stop-color="${C.green}"/>
      <stop offset="1" stop-color="${C.greenDark}"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${confetti(W, H, confettiN, 7, { x: W / 2, y: cpY, w: 560 * cpScale, h: 300 * cpScale })}
  ${bunting}
  <g transform="translate(${W / 2} ${cpY}) scale(${cpScale})">${centerpiece()}</g>
</svg>`;
}

function page(W, H, PX_W, PX_H, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:${C.green};overflow:hidden}
svg{display:block;width:${PX_W}px;height:${PX_H}px}</style></head>
<body>${body}</body></html>`;
}

// Header: 16:9 (5244 x 2950). Design space 1920 x 1080.
{
  const W = 1920, H = 1080;
  const bunting =
    swag(-60, 520, 40, 60, 5, 62, 0) +
    swag(480, 1000, 40, 66, 5, 62, 2) +
    swag(960, 1460, 40, 62, 5, 62, 4) +
    swag(1420, 1980, 40, 60, 5, 62, 1);
  const body = svg(W, H, { bunting, cpScale: 1.0, cpY: 600, confettiN: 90 });
  writeFileSync(join(here, 'header.html'), page(W, H, 5244, 2950, body));
}

// Search results: 3:2 (3840 x 2560). Design space 1920 x 1280.
{
  const W = 1920, H = 1280;
  const bunting =
    swag(-60, 520, 50, 70, 5, 70, 0) +
    swag(480, 1000, 50, 76, 5, 70, 2) +
    swag(960, 1460, 50, 72, 5, 70, 4) +
    swag(1420, 1980, 50, 70, 5, 70, 1);
  const body = svg(W, H, { bunting, cpScale: 1.18, cpY: 720, confettiN: 110 });
  writeFileSync(join(here, 'search-results.html'), page(W, H, 3840, 2560, body));
}

console.log('wrote header.html, search-results.html');
