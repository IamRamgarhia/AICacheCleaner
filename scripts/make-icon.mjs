// Generates build/icon.png (512px), build/icon.ico (16–256px) and
// electron/tray.png (32px) from code, so the app ships with its own icon
// instead of Electron's default. Run: node scripts/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Shape in unit coordinates (0..1). Shield: flat top with rounded shoulders,
// straight sides, curving to a point.
function shieldContains(x, y) {
  const top = 0.16, mid = 0.52, bottom = 0.88, half = 0.33;
  if (y < top || y > bottom) return false;
  const dx = Math.abs(x - 0.5);
  if (y <= mid) return dx <= half;
  const t = (y - mid) / (bottom - mid); // 0 at mid, 1 at the point
  return dx <= half * Math.cos((t * Math.PI) / 2);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function checkContains(x, y) {
  const w = 0.055;
  return distToSegment(x, y, 0.36, 0.5, 0.46, 0.61) < w || distToSegment(x, y, 0.46, 0.61, 0.65, 0.39) < w;
}

function roundedSquareContains(x, y) {
  const r = 0.2, m = 0.02;
  const cx = Math.min(Math.max(x, m + r), 1 - m - r);
  const cy = Math.min(Math.max(y, m + r), 1 - m - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

const BG = [15, 20, 28], SHIELD_TOP = [72, 199, 150], SHIELD_BOTTOM = [38, 138, 104], CHECK = [15, 20, 28];

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = (i + (si + 0.5) / ss) / size, y = (j + (sj + 0.5) / ss) / size;
          let c = null;
          if (shieldContains(x, y)) {
            if (checkContains(x, y)) c = CHECK;
            else {
              const t = (y - 0.16) / 0.72;
              c = SHIELD_TOP.map((v, k) => v + (SHIELD_BOTTOM[k] - v) * t);
            }
          } else if (roundedSquareContains(x, y)) c = BG;
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const n = ss * ss, o = (j * size + i) * 4;
      px[o] = a ? r / a : 0; px[o + 1] = a ? g / a : 0; px[o + 2] = a ? b / a : 0; px[o + 3] = (a / n) * 255;
    }
  }
  return px;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(size) {
  const raw = render(size);
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) raw.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))
  ]);
}

// ICO containing PNG-compressed images (supported since Windows Vista).
function ico(sizes) {
  const images = sizes.map(png);
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...images]);
}

fs.mkdirSync(path.join(root, 'build'), { recursive: true });
// 512px: electron-builder needs at least that to generate the macOS .icns.
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png(512));
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
fs.writeFileSync(path.join(root, 'electron', 'tray.png'), png(32));
fs.writeFileSync(path.join(root, 'public', 'app-icon.png'), png(64));
console.log('icons written');
