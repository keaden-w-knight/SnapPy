// Generates SnapPy's app icons with no image dependencies -- Node's zlib is
// enough to emit valid PNGs, and Windows .ico files may embed PNGs directly.
// Replace with `npx tauri icon <artwork.png>` once there is real branding.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src-tauri', 'icons');

const BLUE = [0x4c, 0x97, 0xff];
const WHITE = [0xff, 0xff, 0xff];
const YELLOW = [0xff, 0xbf, 0x00];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Rounded-rectangle coverage, sampled 3x3 per pixel for cheap antialiasing. */
function roundedCoverage(px, py, x0, y0, x1, y1, r) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const x = px + (sx + 0.5) / 3;
      const y = py + (sy + 0.5) / 3;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) hits++;
    }
  }
  return hits / 9;
}

function blend(dst, i, colour, alpha) {
  for (let c = 0; c < 3; c++) {
    dst[i + c] = Math.round(dst[i + c] * (1 - alpha) + colour[c] * alpha);
  }
  dst[i + 3] = Math.round(dst[i + 3] * (1 - alpha) + 255 * alpha);
}

/** Two stacked bars on a rounded blue tile: a block stack, at any size. */
function render(size) {
  const px = Buffer.alloc(size * size * 4); // RGBA, transparent
  const s = (v) => v * size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const tile = roundedCoverage(x, y, s(0.02), s(0.02), s(0.98), s(0.98), s(0.22));
      if (tile > 0) blend(px, i, BLUE, tile);

      const top = roundedCoverage(x, y, s(0.22), s(0.26), s(0.78), s(0.46), s(0.06));
      if (top > 0) blend(px, i, WHITE, top);

      const bottom = roundedCoverage(x, y, s(0.22), s(0.54), s(0.78), s(0.74), s(0.06));
      if (bottom > 0) blend(px, i, YELLOW, bottom);
    }
  }

  // PNG scanlines are prefixed with a filter byte (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO container holding PNG images (supported since Windows Vista). */
function ico(sizes) {
  const images = sizes.map((size) => ({ size, png: render(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 means 256
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

mkdirSync(OUT, { recursive: true });
const pngs = {
  '32x32.png': 32,
  '128x128.png': 128,
  '128x128@2x.png': 256,
  'icon.png': 512,
};
for (const [name, size] of Object.entries(pngs)) {
  writeFileSync(join(OUT, name), render(size));
}
writeFileSync(join(OUT, 'icon.ico'), ico([16, 32, 48, 64, 128, 256]));
console.log(`[make-icons] wrote ${Object.keys(pngs).length} PNGs + icon.ico to src-tauri/icons`);
