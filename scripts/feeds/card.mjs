/**
 * Receipt card: SVG for people, PNG for OpenGraph scrapers.
 * Bitmap font is 5x7, public-domain style. Unknown glyphs draw a box.
 */
import { deflateSync } from "node:zlib";

const FONT = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x06],
  ":": [0x00, 0x06, 0x06, 0x00, 0x06, 0x06, 0x00],
  "/": [0x01, 0x02, 0x04, 0x08, 0x10, 0x00, 0x00],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x01, 0x01, 0x01, 0x01, 0x11, 0x11, 0x0e],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
};

function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fillRect(rgb, width, x, y, w, h, color) {
  const height = rgb.length / (width * 3);
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * width + xx) * 3;
      rgb[i] = color[0];
      rgb[i + 1] = color[1];
      rgb[i + 2] = color[2];
    }
  }
}

function drawText(rgb, width, text, x, y, scale, color) {
  let cursor = x;
  const upper = text.toUpperCase();
  for (const ch of upper) {
    const rows = FONT[ch] || FONT["?"];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if ((rows[r] >> (4 - c)) & 1) {
          fillRect(rgb, width, cursor + c * scale, y + r * scale, scale, scale, color);
        }
      }
    }
    cursor += 6 * scale;
  }
  return cursor;
}

export function receiptCard({ className, state, proxy, feature, hash }) {
  const width = 1200;
  const height = 630;
  const rgb = Buffer.alloc(width * height * 3);
  const bg = [20, 18, 11];
  const fg = [244, 239, 228];
  const accent = [226, 182, 87];
  fillRect(rgb, width, 0, 0, width, height, bg);
  fillRect(rgb, width, 0, 0, 16, height, accent);
  const lines = [
    ["EXTROPY ENGINE", accent, 6],
    ["RECEIPT", fg, 8],
    [`CLASS: ${className || "UNSET"}`, fg, 5],
    [`STATE: ${state || "UNSET"}`, fg, 5],
    [`PROXY: ${proxy}`, fg, 5],
    [`OK TO FEATURE: ${feature}`, fg, 5],
    [`HASH: ${hash}`, fg, 4],
  ];
  let y = 70;
  for (const [text, color, scale] of lines) {
    drawText(rgb, width, text, 56, y, scale, color);
    y += 7 * scale + 28;
  }
  return encodePng(width, height, rgb);
}

export function receiptSvg({ className, state, proxy, feature, hash, pageUrl }) {
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const rows = [
    ["Class", className || "unset"],
    ["State", state || "unset"],
    ["Entropy-reduction proxy", proxy],
    ["Ok to feature", feature],
    ["Hash", hash],
  ];
  const body = rows
    .map(
      ([k, v], i) =>
        `<text x="56" y="${210 + i * 64}" fill="#f4efe4" font-family="ui-sans-serif, system-ui, sans-serif" font-size="32">${esc(k)}: ${esc(v)}</text>`,
    )
    .join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img">
  <title>Extropy Engine receipt</title>
  <a href="${esc(pageUrl)}">
    <rect width="1200" height="630" fill="#14120b"/>
    <rect width="16" height="630" fill="#e2b657"/>
    <text x="56" y="84" fill="#e2b657" font-family="ui-sans-serif, system-ui, sans-serif" font-size="28">EXTROPY ENGINE</text>
    <text x="56" y="150" fill="#f4efe4" font-family="ui-sans-serif, system-ui, sans-serif" font-size="56">Receipt</text>
    ${body}
  </a>
</svg>
`;
}
