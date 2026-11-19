/**
 * Generates the extension icon: dark rounded square + 7-segment "1:07".
 * Pure Node (zlib only) — deterministic, no native deps.
 *
 *   node scripts/gen-icon.mts            # writes assets/icon-master.png (512)
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const SIZE = 512;
const R = 104; // corner radius
const BG = [16, 16, 20]; // #101014
const FG = [255, 255, 255]; // digits
const RED = [255, 69, 58]; // #ff453a

const px = new Uint8Array(SIZE * SIZE * 4);

function set(x: number, y: number, rgb: [number, number, number], a: number) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const alpha = a / 255;
  const prevA = px[i + 3] / 255;
  const outA = alpha + prevA * (1 - alpha);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    px[i + c] = Math.round((rgb[c] * alpha + px[i + c] * prevA * (1 - alpha)) / outA);
  }
  px[i + 3] = Math.round(outA * 255);
}

/** rounded-rect SDF: distance <= 0 means inside */
function sdRoundRect(x: number, y: number, cx: number, cy: number, hw: number, hh: number, r: number) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}

// background with 2px antialiased edge
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = sdRoundRect(x + 0.5, y + 0.5, SIZE / 2, SIZE / 2, SIZE / 2, SIZE / 2, R);
    const a = Math.min(1, Math.max(0, 0.5 - d));
    if (a > 0) set(x, y, BG, a * 255);
  }
}

// ------------------------------------------------------------------
// 7-segment renderer
// ------------------------------------------------------------------
// segment layout per digit (w x h box):
//  0 = top, 1 = top-left, 2 = top-right, 3 = middle,
//  4 = bottom-left, 5 = bottom-right, 6 = bottom
const SEVEN: Record<string, number[]> = {
  "0": [1, 1, 1, 0, 1, 1, 1],
  "1": [0, 0, 1, 0, 0, 1, 0],
  "7": [1, 1, 1, 0, 0, 1, 0],
};
const DIGIT_W = 92;
const DIGIT_H = 170;
const TH = 20; // segment thickness

function fillSeg(x0: number, y0: number, seg: number, rgb: [number, number, number]) {
  const inset = 4; // gap between segments
  const t = TH;
  const x1 = x0 + DIGIT_W;
  const y1 = y0 + DIGIT_H;
  const midY = (y0 + y1) / 2;
  const rects: Array<[number, number, number, number]> = {
    0: [x0 + inset, y0, x1 - inset, y0 + t], // top
    1: [x0, y0 + inset, x0 + t, midY - inset], // top-left
    2: [x1 - t, y0 + inset, x1, midY - inset], // top-right
    3: [x0 + inset, midY - t / 2, x1 - inset, midY + t / 2], // middle
    4: [x0, midY + inset, x0 + t, y1 - inset], // bottom-left
    5: [x1 - t, midY + inset, x1, y1 - inset], // bottom-right
    6: [x0 + inset, y1 - t, x1 - inset, y1], // bottom
  }[seg]!;
  const [rx0, ry0, rx1, ry1] = rects;
  for (let y = Math.floor(ry0); y < Math.ceil(ry1); y++) {
    for (let x = Math.floor(rx0); x < Math.ceil(rx1); x++) {
      const a =
        Math.min(1, x - rx0 + 1, rx1 - x, y - ry0 + 1, ry1 - y) > 0 ? 255 : 0;
      if (a > 0) set(x, y, rgb, 255);
    }
  }
}

function drawDigit(char: string, x0: number, y0: number, rgb: [number, number, number]) {
  const segs = SEVEN[char];
  if (!segs) return;
  segs.forEach((on, i) => {
    if (on) fillSeg(x0, y0, i, i === 0 || char === "1" ? rgb : rgb);
  });
}

// italic slant for style
function slant() {
  // apply shear: x' = x + (H - y) * k — draw via offset in set()? simpler: draw into final by adjusting x per y
  const K = 0.12;
  const SHEAR = DIGIT_H * K;
  return SHEAR;
}
const SHEAR = slant();

// layout: "1:07" centered
const colonW = 36;
const totalW = DIGIT_W * 3 + colonW + SHEAR;
const startX = (SIZE - totalW) / 2;
const startY = (SIZE - DIGIT_H) / 2;

// digits with shear
function drawDigitSheared(char: string, x0: number, rgb: [number, number, number]) {
  const segs = SEVEN[char];
  if (!segs) return;
  segs.forEach((on, i) => {
    if (!on) return;
    // re-render with per-row shear by offsetting fill: emulate by drawing into temp then shifting rows
    // simpler: draw the segment rect sheared manually
    const inset = 4;
    const t = TH;
    const x1 = x0 + DIGIT_W;
    const y0 = startY;
    const y1 = startY + DIGIT_H;
    const midY = (y0 + y1) / 2;
    const rects: Array<[number, number, number, number]> = {
      0: [x0 + inset, y0, x1 - inset, y0 + t],
      1: [x0, y0 + inset, x0 + t, midY - inset],
      2: [x1 - t, y0 + inset, x1, midY - inset],
      3: [x0 + inset, midY - t / 2, x1 - inset, midY + t / 2],
      4: [x0, midY + inset, x0 + t, y1 - inset],
      5: [x1 - t, midY + inset, x1, y1 - inset],
      6: [x0 + inset, y1 - t, x1 - inset, y1],
    }[i]!;
    const [rx0, ry0, rx1, ry1] = rects;
    for (let y = Math.floor(ry0); y < Math.ceil(ry1); y++) {
      const shift = ((y1 - y) / (y1 - y0)) * SHEAR;
      for (let x = Math.floor(rx0); x < Math.ceil(rx1); x++) {
        const sx = x + shift;
        if (sx < 0 || sx >= SIZE) continue;
        const a = Math.min(1, x - rx0 + 1, rx1 - x, y - ry0 + 1, ry1 - y) > 0 ? 255 : 0;
        if (a > 0) set(Math.round(sx), y, rgb, 255);
      }
    }
  });
}

drawDigitSheared("1", startX, FG);
// colon (red)
{
  const cx = startX + DIGIT_W + colonW / 2;
  const dotR = TH * 0.62;
  for (const cy of [startY + DIGIT_H * 0.3, startY + DIGIT_H * 0.7]) {
    for (let y = Math.floor(cy - dotR); y <= Math.ceil(cy + dotR); y++) {
      for (let x = Math.floor(cx - dotR); x <= Math.ceil(cx + dotR); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= dotR) set(x, y, RED, 255);
        else if (d <= dotR + 1) set(x, y, RED, Math.round((1 - (d - dotR)) * 255));
      }
    }
  }
}
drawDigitSheared("0", startX + DIGIT_W + colonW, FG);
drawDigitSheared("7", startX + DIGIT_W * 2 + colonW, RED);

// subtle red glow under red 7 — skip; keep flat.

// ------------------------------------------------------------------
// PNG encode (RGBA8, filter 0)
// ------------------------------------------------------------------
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
// filter type 0 per scanline
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", new Uint8Array(0)),
]);

mkdirSync(new URL("../public/icon/", import.meta.url), { recursive: true });
const out = new URL("../assets/icon-master.png", import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${png.length} bytes)`);
