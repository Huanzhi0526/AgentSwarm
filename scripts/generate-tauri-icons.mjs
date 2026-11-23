import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PNG = path.join(REPO_ROOT, 'src-tauri', 'app-icon-source.png');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function blendPixel(rgba, idx, r, g, b, alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, Math.max(0, alpha));
  const curA = rgba[idx + 3] / 255;
  const outA = a + curA * (1 - a);
  if (outA <= 0) return;
  rgba[idx] = Math.round((r * a + rgba[idx] * curA * (1 - a)) / outA);
  rgba[idx + 1] = Math.round((g * a + rgba[idx + 1] * curA * (1 - a)) / outA);
  rgba[idx + 2] = Math.round((b * a + rgba[idx + 2] * curA * (1 - a)) / outA);
  rgba[idx + 3] = Math.round(outA * 255);
}

function renderBrandIconPng(size = 512) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const scale = size / 36;
  const pad = 1.5 * scale;
  const half = size / 2;
  const maxBox = half - pad;
  const cornerR = 10 * scale;

  const nodes = [
    { cx: 18 * scale, cy: 11.5 * scale, r: 3.6 * scale, rgb: [119, 104, 166] },
    { cx: 11 * scale, cy: 23.5 * scale, r: 3.3 * scale, rgb: [149, 133, 193] },
    { cx: 25 * scale, cy: 23.5 * scale, r: 3.3 * scale, rgb: [91, 169, 123] },
  ];
  const segments = [
    [16.2 * scale, 14.5 * scale, 12.6 * scale, 20.6 * scale],
    [19.8 * scale, 14.5 * scale, 23.4 * scale, 20.6 * scale],
    [14.3 * scale, 23.5 * scale, 21.7 * scale, 23.5 * scale],
  ];
  const strokeRadius = 1.05 * scale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      // Signed distance to rounded background square
      const qx = Math.abs(px - half) - (maxBox - cornerR);
      const qy = Math.abs(py - half) - (maxBox - cornerR);
      const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cornerR;

      if (outDist < 1) {
        const bgAlpha = Math.min(1, Math.max(0, 1 - outDist));
        blendPixel(rgba, idx, 239, 235, 247, bgAlpha);
        // Subtle lavender border ring inside edge
        if (outDist > -1.2 * scale) {
          const borderAlpha = bgAlpha * 0.55;
          blendPixel(rgba, idx, 213, 204, 232, borderAlpha);
        }
      }

      for (const [ax, ay, bx, by] of segments) {
        const d = distToSegment(px, py, ax, ay, bx, by);
        if (d < strokeRadius + 1) {
          const a = Math.min(1, Math.max(0, strokeRadius + 0.6 - d));
          blendPixel(rgba, idx, 119, 104, 166, a);
        }
      }

      for (const n of nodes) {
        const d = Math.hypot(px - n.cx, py - n.cy);
        if (d < n.r + 1) {
          const a = Math.min(1, Math.max(0, n.r + 0.6 - d));
          blendPixel(rgba, idx, n.rgb[0], n.rgb[1], n.rgb[2], a);
        }
      }
    }
  }

  return encodeRgbaPng(size, size, rgba);
}

fs.mkdirSync(path.dirname(SOURCE_PNG), { recursive: true });
fs.writeFileSync(SOURCE_PNG, renderBrandIconPng(512));
console.log(`Generated ${SOURCE_PNG}`);
