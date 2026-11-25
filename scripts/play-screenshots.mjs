// Captures Google Play listing screenshots from a running Android emulator.
//
//   node scripts/play-screenshots.mjs prep phone     # 1080x1920 (9:16) display + clean status bar
//   node scripts/play-screenshots.mjs prep tablet    # native tablet display + clean status bar
//   node scripts/play-screenshots.mjs shot phone 01-till
//   node scripts/play-screenshots.mjs reset          # restore display size/density, leave demo mode
//
// Files land in store-assets/play-store/<phone|tablet>/<name>.png and are checked
// against Play's size rules. With several devices attached, set ANDROID_SERIAL.
//
// Why "prep phone" resizes: modern phones (e.g. Pixel 10 Pro 1280x2856) are taller
// than 2:1, and Play rejects screenshots whose long side is over twice the short side.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const adbPath = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');

const KINDS = {
  // Play: phone sides 320-3840px; 1080px+ needed for promotion eligibility.
  phone: { size: '1080x1920', density: '420', minSide: 320, maxSide: 3840 },
  // Play: 10" tablet sides 1080-7680px. Use the emulator's native size.
  tablet: { size: null, density: null, minSide: 1080, maxSide: 7680 },
};

function adb(args, opts = {}) {
  return execFileSync(adbPath, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
}
const sh = (...args) => adb(['shell', ...args]).toString().trim();

function demo(command, extras = {}) {
  const args = ['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', command];
  for (const [k, v] of Object.entries(extras)) args.push('-e', k, v);
  sh(...args);
}

function prep(kind) {
  const k = KINDS[kind];
  if (k.size) {
    sh('wm', 'size', k.size);
    sh('wm', 'density', k.density);
  }
  // Clean status bar: fixed time, full battery and signal, no notification icons.
  sh('settings', 'put', 'global', 'sysui_demo_allowed', '1');
  demo('enter');
  demo('clock', { hhmm: '1000' });
  demo('battery', { level: '100', plugged: 'false' });
  demo('network', { wifi: 'show', level: '4', fully: 'true' });
  demo('network', { mobile: 'show', datatype: 'none', level: '4' });
  demo('notifications', { visible: 'false' });
  console.log(`Ready for ${kind} screenshots. Display: ${sh('wm', 'size').replace(/\s+/g, ' ')}`);
  console.log('Restart the app (or reload) so it lays out for the new size, then run "shot".');
}

function reset() {
  sh('wm', 'size', 'reset');
  sh('wm', 'density', 'reset');
  demo('exit');
  console.log('Display size, density and status bar restored.');
}

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('adb did not return a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function shot(kind, name) {
  if (!name) throw new Error('Give the screenshot a name, e.g. 01-till');
  const png = adb(['exec-out', 'screencap', '-p']);
  const { width, height } = pngSize(png);
  const outDir = join(root, 'store-assets', 'play-store', kind);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${name.replace(/\.png$/i, '')}.png`);
  writeFileSync(file, png);

  const k = KINDS[kind];
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const problems = [];
  if (short < k.minSide || long > k.maxSide) problems.push(`sides must be ${k.minSide}-${k.maxSide}px`);
  if (long > short * 2) problems.push('long side is more than twice the short side');
  console.log(`${file} (${width}x${height})`);
  if (problems.length) console.warn(`  Play will reject this: ${problems.join('; ')}. Did you run "prep ${kind}"?`);
}

const [cmd, kind, name] = process.argv.slice(2);
try {
  if (cmd === 'reset') reset();
  else if ((cmd === 'prep' || cmd === 'shot') && KINDS[kind]) (cmd === 'prep' ? prep : shot)(kind, name);
  else {
    console.error('Usage: play-screenshots.mjs prep <phone|tablet> | shot <phone|tablet> <name> | reset');
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
