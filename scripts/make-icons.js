// Draws the app icon, Android adaptive icon layers, splash image and favicon
// into assets/. Run with `npm run icons` after changing the design.
//
// The splash image sits on a pale background, so its last flag is green, not cream.
// The artwork is a string of bunting over a pound coin, drawn from simple
// shapes so it needs no image editor or fonts.
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const GREEN = [0x1f, 0x6b, 0x45];
const SUN = [0xf5, 0xc5, 0x42];
const SUN_DARK = [0xd9, 0xa5, 0x1e];
const INK = [0x2a, 0x21, 0x00];
const CREAM = [0xf3, 0xf6, 0xf1];
const STRING = [0x8a, 0x97, 0x8d];
const FLAGS = [
  [0xe2, 0x57, 0x4c],
  [0xf5, 0xc5, 0x42],
  [0x3d, 0x8f, 0xd1],
  [0xe9, 0x8a, 0xb0],
];
const WHITE = [255, 255, 255];

// ---- shapes: each is a test "is this point inside?" in 0..1 coordinates ------
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ring = (cx, cy, r, w) => (x, y) => {
  const d = Math.hypot(x - cx, y - cy);
  return d <= r && d >= r - w;
};
const segment = (ax, ay, bx, by, w) => (x, y) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= w / 2;
};
/** Arc stroke from angle a0 to a1 (radians, clockwise on screen), with round ends. */
const arc = (cx, cy, r, a0, a1, w) => (x, y) => {
  let a = Math.atan2(y - cy, x - cx);
  while (a < a0) a += 2 * Math.PI;
  if (a <= a1) return Math.abs(Math.hypot(x - cx, y - cy) - r) <= w / 2;
  const end = (ang) => Math.hypot(x - cx - r * Math.cos(ang), y - cy - r * Math.sin(ang)) <= w / 2;
  return end(a0) || end(a1);
};
const triangle = (p, q, r) => (x, y) => {
  const side = (a, b) => (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0]);
  const d1 = side(p, q);
  const d2 = side(q, r);
  const d3 = side(r, p);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

/** The artwork as [shape, colour] layers, back to front. `mono` draws it as a single-colour stencil. */
function artwork({ stringColour = CREAM, lastFlag = CREAM, mono = false } = {}) {
  const layers = [];
  const col = (c) => (mono ? WHITE : c);

  // Bunting: a sagging string with five flags hanging from it.
  const sag = (x) => 0.12 + 0.07 * (1 - ((x - 0.5) / 0.44) ** 2);
  for (let i = 0; i < 22; i++) {
    const x0 = 0.06 + (0.88 * i) / 22;
    const x1 = 0.06 + (0.88 * (i + 1)) / 22;
    layers.push([segment(x0, sag(x0), x1, sag(x1), 0.012), col(stringColour)]);
  }
  [...FLAGS.slice(0, 4), lastFlag].forEach((colour, i) => {
    const mid = 0.16 + i * 0.17;
    const a = [mid - 0.068, sag(mid - 0.068)];
    const b = [mid + 0.068, sag(mid + 0.068)];
    layers.push([triangle(a, b, [mid, sag(mid) + 0.165]), col(colour)]);
  });

  // Pound coin.
  const cx = 0.5;
  const cy = 0.635;
  const R = 0.25;
  if (mono) layers.push([ring(cx, cy, R, 0.03), WHITE]);
  else {
    layers.push([circle(cx, cy, R), SUN]);
    layers.push([ring(cx, cy, R * 0.9, 0.012), SUN_DARK]);
  }
  const w = R * 0.17;
  const g = (dx, dy) => [cx + dx * R, cy + dy * R];
  const stroke = (a, b) => segment(...g(...a), ...g(...b), w);
  const glyph = [
    arc(...g(0.13, -0.26), R * 0.25, Math.PI, Math.PI * 1.92, w), // top hook
    stroke([-0.12, -0.26], [-0.12, 0.44]), // stem
    stroke([-0.36, 0.06], [0.2, 0.06]), // crossbar
    stroke([-0.36, 0.46], [0.38, 0.46]), // base
  ];
  for (const shape of glyph) layers.push([shape, col(INK)]);
  return layers;
}

/**
 * Renders layers to a PNG. `scale` shrinks the artwork around the centre (Android
 * adaptive icons only show the middle two-thirds). `background` null = transparent.
 */
function render(file, size, { layers, background = null, scale = 1 }) {
  const SS = 4; // 4x4 samples per pixel for smooth edges
  const png = new PNG({ width: size, height: size });
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size - 0.5) / scale + 0.5;
          const y = ((py + (sy + 0.5) / SS) / size - 0.5) / scale + 0.5;
          let c = background;
          for (const [shape, colour] of layers) if (shape(x, y)) c = colour;
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const i = (py * size + px) * 4;
      png.data[i] = a ? Math.round(r / a) : 0;
      png.data[i + 1] = a ? Math.round(g / a) : 0;
      png.data[i + 2] = a ? Math.round(b / a) : 0;
      png.data[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  // iOS rejects icons with an alpha channel, so opaque images are written as RGB.
  const out = PNG.sync.write(png, background ? { colorType: 2, inputHasAlpha: true } : {});
  fs.writeFileSync(path.join(__dirname, '..', 'assets', file), out);
  console.log(`${file} ${size}x${size}`);
}

render('icon.png', 1024, { layers: artwork(), background: GREEN });
render('android-icon-foreground.png', 1024, { layers: artwork(), scale: 0.6 });
render('android-icon-background.png', 1024, { layers: [], background: GREEN });
render('android-icon-monochrome.png', 1024, { layers: artwork({ mono: true }), scale: 0.6 });
render('splash-icon.png', 1024, { layers: artwork({ stringColour: STRING, lastFlag: GREEN }), scale: 0.94 });
render('favicon.png', 48, { layers: artwork(), background: GREEN });
