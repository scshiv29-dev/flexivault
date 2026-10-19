/**
 * Draw the FlexiVault mark as PNG app assets, without image dependencies.
 * Run: node scripts/generate-icons.js
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const OUT = path.join(__dirname, "..", "assets", "images");

const INK = [3, 35, 26];
const ACCENT = [63, 224, 176];
const BACKGROUND = [7, 12, 10];

function distanceToRoundedRect(x, y, cx, cy, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x - cx) - (halfWidth - radius);
  const qy = Math.abs(y - cy) - (halfHeight - radius);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}

function insideRoundedRect(x, y, cx, cy, halfWidth, halfHeight, radius) {
  return distanceToRoundedRect(x, y, cx, cy, halfWidth, halfHeight, radius) <= 0;
}

function markColor(x, y, cx, cy, side) {
  const half = side / 2;
  const corner = side * 0.31;
  if (!insideRoundedRect(x, y, cx, cy, half, half, corner)) return null;

  const distance = Math.hypot(x - cx, y - cy);
  const outer = side * 0.28;
  const stroke = Math.max(1.5, side * 0.075);
  const inner = outer - stroke;

  // Vault door ring.
  if (distance <= outer && distance >= inner) return INK;

  // Dial at the centre.
  if (distance <= side * 0.075) return INK;

  // Notch descending from the dial through the bottom of the door.
  const notchHalfWidth = side * 0.0375;
  const notchTop = cy + side * 0.08;
  const notchBottom = cy + side * 0.3;
  const notchCenterY = (notchTop + notchBottom) / 2;
  if (
    insideRoundedRect(
      x,
      y,
      cx,
      notchCenterY,
      notchHalfWidth,
      (notchBottom - notchTop) / 2,
      notchHalfWidth
    )
  ) {
    return INK;
  }

  return ACCENT;
}

function render({ size, background, markScale, supersample = 2, round = false }) {
  const scale = Math.max(1, Math.round(supersample));
  const large = size * scale;
  const png = new PNG({ width: size, height: size });
  const side = size * markScale;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let hits = 0;

      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const px = (x + (sx + 0.5) / scale) * (large / size);
          const py = (y + (sy + 0.5) / scale) * (large / size);
          if (round && Math.hypot(px - large / 2, py - large / 2) > large / 2) {
            continue;
          }
          const mark = markColor(px, py, large / 2, large / 2, side * scale);
          const color = mark ?? background;
          if (!color) continue;
          red += color[0];
          green += color[1];
          blue += color[2];
          hits += 1;
        }
      }

      const index = (y * size + x) * 4;
      png.data[index] = hits ? Math.round(red / hits) : 0;
      png.data[index + 1] = hits ? Math.round(green / hits) : 0;
      png.data[index + 2] = hits ? Math.round(blue / hits) : 0;
      png.data[index + 3] = Math.round((hits / (scale * scale)) * 255);
    }
  }

  return PNG.sync.write(png);
}

fs.mkdirSync(OUT, { recursive: true });

const assets = [
  ["icon.png", { size: 1024, background: BACKGROUND, markScale: 0.54 }],
  ["adaptive-icon.png", { size: 1024, background: null, markScale: 0.46 }],
  ["splash.png", { size: 1024, background: null, markScale: 0.3 }],
  ["favicon.png", { size: 64, background: BACKGROUND, markScale: 0.62 }],
];

for (const [name, options] of assets) {
  fs.writeFileSync(path.join(OUT, name), render(options));
  const stats = fs.statSync(path.join(OUT, name));
  console.log(`${name}: ${(stats.size / 1024).toFixed(1)} kB`);
}

// Keep the checked-in Android project in sync with the app icon config.
const ANDROID = path.join(__dirname, "..", "android", "app", "src", "main", "res");
const densities = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};
const androidCopies = [];

if (fs.existsSync(ANDROID)) {
  for (const [density, factor] of Object.entries(densities)) {
    const directory = path.join(ANDROID, `mipmap-${density}`);
    if (!fs.existsSync(directory)) continue;
    androidCopies.push([
      path.join(directory, "ic_launcher.png"),
      { size: Math.round(48 * factor), background: BACKGROUND, markScale: 0.54 },
    ]);
    androidCopies.push([
      path.join(directory, "ic_launcher_round.png"),
      { size: Math.round(48 * factor), background: BACKGROUND, markScale: 0.54, round: true },
    ]);
    androidCopies.push([
      path.join(directory, "ic_launcher_foreground.png"),
      { size: Math.round(108 * factor), background: null, markScale: 0.46 },
    ]);
  }

  for (const [file, options] of androidCopies) {
    fs.writeFileSync(file, render(options));
  }
  console.log(`Android launcher icons updated (${androidCopies.length} files).`);
}

console.log("Assets written to assets/images.");
