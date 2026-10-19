/* Generates the extension PNG icons with zero dependencies. */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT = path.join(__dirname, "..", "icons");
const SIZES = [16, 32, 48, 128];
const SCALE = 4;

const ACCENT = [0x3f, 0xe0, 0xb0];
const INK = [0x03, 0x23, 0x1a];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideRoundedSquare(x, y, size) {
  const margin = 1;
  const radius = size * 0.29;
  const min = margin;
  const max = size - margin;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function colorAt(x, y, size) {
  if (!insideRoundedSquare(x, y, size)) return null;
  const center = size / 2;
  const distance = Math.hypot(x - center, y - center);
  const outer = size * 0.275;
  const inner = size * 0.195;
  if (distance <= outer && distance >= inner) return INK;
  if (distance <= size * 0.052) return INK;
  return ACCENT;
}

function render(size) {
  const width = size * SCALE;
  const rgba = Buffer.alloc(size * size * 4);
  const samples = SCALE * SCALE;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;

      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const px = x * SCALE + sx + 0.5;
          const py = y * SCALE + sy + 0.5;
          const color = colorAt(px, py, width);
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            covered += 1;
          }
        }
      }

      const offset = (y * size + x) * 4;
      if (covered === 0) {
        rgba[offset + 3] = 0;
      } else {
        rgba[offset] = Math.round(r / covered);
        rgba[offset + 1] = Math.round(g / covered);
        rgba[offset + 2] = Math.round(b / covered);
        rgba[offset + 3] = Math.round((covered / samples) * 255);
      }
    }
  }

  return png(size, size, rgba);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
