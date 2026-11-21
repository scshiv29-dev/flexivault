/**
 * Minimal QR code encoder: byte mode, error-correction level M, versions
 * 1–40, automatic mask selection. Zero dependencies so the server stays
 * dependency-free. Keep in sync with lib/qr/encode.ts in the mobile app.
 */

// Index 0 is unused so the tables can be indexed by version number.
const ECC_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];
// Format-info bits for level M.
const ECL_M_BITS = 0;

function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver) {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver];
}

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

function bit(value, i) {
  return ((value >>> i) & 1) !== 0;
}

function encodeData(bytes) {
  let ver = 1;
  for (; ver <= 40; ver++) {
    const ccBits = ver < 10 ? 8 : 16;
    if (bytes.length < 1 << ccBits && 4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > 40) throw new Error("Data too long for a QR code");

  const capacityBits = dataCodewords(ver) * 8;
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j];
    codewords.push(value);
  }
  return { ver, codewords };
}

function addEccAndInterleave(data, ver) {
  const numBlocks = BLOCKS_M[ver];
  const eccLen = ECC_PER_BLOCK_M[ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccLen);

  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i]);
    });
  }
  return result;
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 17 - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function maskHit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function penalty(modules) {
  const size = modules.length;
  let score = 0;
  const finderLike = (line, i) => {
    // 1:1:3:1:1 dark pattern with four light modules on one side.
    const p = [1, 0, 1, 1, 1, 0, 1];
    for (let k = 0; k < 7; k++) if (line(i + k) !== Boolean(p[k])) return false;
    const lightRun = (from) => {
      for (let k = 0; k < 4; k++) {
        const v = line(from + k);
        if (v === true) return false;
      }
      return true;
    };
    return lightRun(i - 4) || lightRun(i + 7);
  };

  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      const line = (b) =>
        b < 0 || b >= size ? undefined : pass === 0 ? modules[a][b] : modules[b][a];
      let runColor = line(0);
      let runLen = 1;
      for (let b = 1; b < size; b++) {
        const v = line(b);
        if (v === runColor) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runColor = v;
          runLen = 1;
        }
      }
      for (let b = -4; b < size; b++) if (finderLike(line, b)) score += 40;
    }
  }

  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) dark++;
      if (
        x < size - 1 &&
        y < size - 1 &&
        modules[y][x] === modules[y][x + 1] &&
        modules[y][x] === modules[y + 1][x] &&
        modules[y][x] === modules[y + 1][x + 1]
      ) {
        score += 3;
      }
    }
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * Encodes `text` (UTF-8) and returns a square boolean matrix, `true` = dark.
 * The matrix has no quiet zone; renderers should add four modules of margin.
 */
export function encodeQr(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  const { ver, codewords } = encodeData(bytes);
  const size = ver * 4 + 17;
  const base = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (grid, x, y, dark) => {
    grid[y][x] = dark;
    isFn[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(base, 6, i, i % 2 === 0);
    set(base, i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(base, x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const align = alignmentPositions(ver);
  const last = align.length - 1;
  align.forEach((ay, i) => {
    align.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(base, ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });

  const drawFormat = (grid, mask) => {
    const data = (ECL_M_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(grid, 8, i, bit(bits, i));
    set(grid, 8, 7, bit(bits, 6));
    set(grid, 8, 8, bit(bits, 7));
    set(grid, 7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) set(grid, 14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(grid, size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) set(grid, 8, size - 15 + i, bit(bits, i));
    set(grid, 8, size - 8, true);
  };
  drawFormat(base, 0);

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(base, a, b, bit(bits, i));
      set(base, b, a, bit(bits, i));
    }
  }

  const all = addEccAndInterleave(codewords, ver);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < all.length * 8) {
          base[y][x] = bit(all[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid = base.map((row) => row.slice());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFn[y][x] && maskHit(mask, x, y)) grid[y][x] = !grid[y][x];
      }
    }
    drawFormat(grid, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }
  return best;
}

/** Renders a QR matrix as a standalone SVG string with a 4-module quiet zone. */
export function qrSvg(text, { size = 256, dark = "#000", light = "#fff", label = "QR code" } = {}) {
  const modules = encodeQr(text);
  const n = modules.length + 8;
  let path = "";
  modules.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    });
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="${label}">` +
    `<rect width="${n}" height="${n}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`
  );
}
