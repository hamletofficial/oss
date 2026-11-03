const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZE = 256;
const pixels = Buffer.alloc(SIZE * SIZE * 4);
const navy = [7, 29, 74, 255];
const white = [255, 255, 255, 255];

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  pixels[i] = color[0];
  pixels[i + 1] = color[1];
  pixels[i + 2] = color[2];
  pixels[i + 3] = color[3];
}

// Prefer Hamlet's checked-in website favicon so the desktop icon follows
// the same source of truth as the public site. Fall back to a crisp vector-like
// mark if the favicon is absent or is not a usable PNG-backed ICO.
function readPngFromIco(ico) {
  if (!Buffer.isBuffer(ico) || ico.length < 22 ||
      ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) return null;
  const count = ico.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16;
    if (offset + 16 > ico.length) break;
    const size = ico.readUInt32LE(offset + 8);
    const dataOffset = ico.readUInt32LE(offset + 12);
    if (dataOffset + size > ico.length || size < 8) continue;
    const image = ico.subarray(dataOffset, dataOffset + size);
    if (image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      const width = ico[offset] || 256;
      const height = ico[offset + 1] || 256;
      const score = Math.min(width, 256) * Math.min(height, 256);
      if (!best || score > best.score) best = { image, score };
    }
  }
  return best?.image || null;
}

function drawFallbackMark() {
  // Draw the v1.04.04 orbital-h mark in RGBA pixels so the Windows icon
  // matches the scalable SVG without requiring an image-processing dependency.
  const blue = [7, 29, 74, 255];
  const cyan = [34, 211, 238, 255];
  const royal = [20, 120, 255, 255];
  const white = [255, 255, 255, 255];

  function blend(a, b, t) {
    return a.map((value, i) => Math.round(value + (b[i] - value) * t));
  }
  function roundedRectContains(x, y, left, top, right, bottom, radius) {
    const cx = Math.max(left + radius, Math.min(x, right - radius));
    const cy = Math.max(top + radius, Math.min(y, bottom - radius));
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = Math.min(1, (x + y) / (SIZE * 1.6));
      const bg = blend([7, 60, 168, 255], blue, t);
      if (roundedRectContains(x, y, 8, 8, 248, 248, 48)) {
        setPixel(x, y, bg);
      } else {
        setPixel(x, y, [0, 0, 0, 0]);
      }
    }
  }

  // Open orbital ring with a blue-to-cyan gradient.
  const cx = 128, cy = 128, radius = 83, thickness = 7;
  for (let y = 18; y < 238; y++) {
    for (let x = 18; x < 238; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (Math.abs(dist - radius) > thickness) continue;
      const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      // Two deliberate breaks keep the orbit dynamic and legible at small sizes.
      if ((angle > 145 && angle < 166) || (angle > 35 && angle < 53)) continue;
      const t = Math.max(0, Math.min(1, (x + y) / (SIZE * 2)));
      setPixel(x, y, blend(royal, cyan, t));
    }
  }

  // White lowercase h with a substantial stem and rounded-looking arch.
  for (let y = 57; y < 199; y++) {
    for (let x = 83; x < 111; x++) setPixel(x, y, white);
  }
  for (let y = 101; y < 128; y++) {
    for (let x = 106; x < 174; x++) {
      const dx = x - 140, dy = y - 128;
      if (dx * dx + dy * dy <= 34 * 34) setPixel(x, y, white);
    }
  }
  for (let y = 119; y < 199; y++) {
    for (let x = 145; x < 173; x++) setPixel(x, y, white);
  }
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createPngFromPixels() {
  const scanlines = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    const dst = y * (SIZE * 4 + 1);
    scanlines[dst] = 0; // PNG filter: none
    pixels.copy(scanlines, dst + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function createIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256px
  entry[1] = 0; // 256px
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

drawFallbackMark();
fs.writeFileSync("icon.ico", createIco(createPngFromPixels()));
console.log("Generated Hamlet v1.04.04 orbital icon.");
