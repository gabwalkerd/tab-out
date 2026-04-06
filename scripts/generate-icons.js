/**
 * generate-icons.js
 *
 * Creates valid PNG icon files at 16x16, 48x48, and 128x128 pixels
 * for the Tab Out Chrome extension.
 *
 * This script uses ZERO external npm dependencies. It builds minimal
 * but fully valid PNG files by hand using Node's built-in Buffer and zlib.
 *
 * How a PNG works (simplified):
 * - A PNG file is a sequence of "chunks". Each chunk has a type, data, and checksum.
 * - The mandatory chunks for a simple image are:
 *   1. IHDR: image header (width, height, bit depth, color type, etc.)
 *   2. IDAT: the actual pixel data, compressed with zlib (Deflate)
 *   3. IEND: marks end of file
 *
 * The icon design:
 * - Amber/orange rounded-square background (#c8713a)
 * - White arrow pointing to the upper-right (representing "tabbing out")
 *
 * Since we're drawing in raw pixels, the rounded corners and arrow are
 * drawn algorithmically (pixel by pixel).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Color palette ──────────────────────────────────────────────────────────
const AMBER  = [200, 113,  58]; // #c8713a — the warm amber background
const WHITE  = [255, 255, 255]; // #ffffff — the arrow
const TRANSP = [  0,   0,   0,   0]; // fully transparent (RGBA, alpha=0)

// ── CRC-32 table (needed for PNG chunk checksums) ──────────────────────────
// PNG uses CRC-32 to verify data integrity in each chunk.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Build a PNG chunk ──────────────────────────────────────────────────────
// Each chunk: 4-byte length | 4-byte type | data | 4-byte CRC
function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([len, typeBytes, data, crcVal]);
}

// ── Build the IHDR chunk ───────────────────────────────────────────────────
// Contains: width, height, bit depth (8), color type (6 = RGBA),
// compression (0=zlib), filter (0), interlace (0=none)
function makeIHDR(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8]  = 8; // bit depth: 8 bits per channel
  data[9]  = 6; // color type: 6 = RGBA (red + green + blue + alpha)
  data[10] = 0; // compression method (always 0)
  data[11] = 0; // filter method (always 0)
  data[12] = 0; // interlace method: 0 = none
  return makeChunk('IHDR', data);
}

// ── Build the IDAT chunk ───────────────────────────────────────────────────
// Contains the filtered + zlib-compressed pixel rows.
// PNG requires each row to start with a "filter byte" (0 = None).
function makeIDAT(pixels, width, height) {
  // Build raw row data: filter byte (0) + RGBA for each pixel
  const rowSize = 1 + width * 4; // 1 filter byte + 4 bytes per pixel (RGBA)
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    rawData[rowStart] = 0; // filter type: None (don't transform this row)
    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width + x) * 4;
      const bufIndex   = rowStart + 1 + x * 4;
      rawData[bufIndex]     = pixels[pixelIndex];     // R
      rawData[bufIndex + 1] = pixels[pixelIndex + 1]; // G
      rawData[bufIndex + 2] = pixels[pixelIndex + 2]; // B
      rawData[bufIndex + 3] = pixels[pixelIndex + 3]; // A
    }
  }

  // Compress with zlib (Deflate) — this is what PNG requires
  const compressed = zlib.deflateSync(rawData, { level: 9 });
  return makeChunk('IDAT', compressed);
}

// ── Build the IEND chunk ───────────────────────────────────────────────────
// Always empty — just signals end of file
function makeIEND() {
  return makeChunk('IEND', Buffer.alloc(0));
}

// ── PNG file signature ─────────────────────────────────────────────────────
// Every PNG starts with this exact 8-byte magic number
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ── Assemble a complete PNG ────────────────────────────────────────────────
function buildPNG(pixels, width, height) {
  return Buffer.concat([
    PNG_SIGNATURE,
    makeIHDR(width, height),
    makeIDAT(pixels, width, height),
    makeIEND()
  ]);
}

// ── Draw a pixel (RGBA) into the flat pixel array ─────────────────────────
function setPixel(pixels, width, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const i = (y * width + x) * 4;
  pixels[i]     = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

// ── Anti-aliased rounded-corner check ──────────────────────────────────────
// Returns the alpha value (0–255) for a pixel at (px, py) in a size×size
// rounded square with the given corner radius. This gives smooth edges.
function roundedSquareAlpha(px, py, size, radius) {
  const cx = px + 0.5; // pixel center X
  const cy = py + 0.5; // pixel center Y

  // Find the distance from this pixel center to the nearest corner circle center
  const cornerX = cx < radius ? radius : cx > size - radius ? size - radius : cx;
  const cornerY = cy < radius ? radius : cy > size - radius ? size - radius : cy;

  const dx = cx - cornerX;
  const dy = cy - cornerY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Inside: full alpha. Outside: zero. Near edge: anti-alias.
  if (dist < radius - 0.7) return 255;
  if (dist > radius + 0.7) return 0;
  // Blend at the boundary
  return Math.round((1 - (dist - (radius - 0.7)) / 1.4) * 255);
}

// ── Draw filled rounded square with anti-aliased corners ──────────────────
function drawRoundedSquare(pixels, size, color, radius) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const alpha = roundedSquareAlpha(x, y, size, radius);
      if (alpha > 0) {
        setPixel(pixels, size, x, y, color[0], color[1], color[2], alpha);
      }
    }
  }
}

// ── Draw the arrow ─────────────────────────────────────────────────────────
// The arrow points to the upper-right: a thick diagonal line + arrowhead.
// We scale all coordinates relative to the icon size so it looks right at
// all three resolutions (16, 48, 128).
function drawArrow(pixels, size) {
  const s = size / 128; // scale factor (128 is our "design canvas" size)

  // Helper: draw a filled circle (used for thick line segments)
  function circle(cx, cy, r) {
    const ir = Math.ceil(r);
    for (let dy = -ir; dy <= ir; dy++) {
      for (let dx = -ir; dx <= ir; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= r) {
          const alpha = dist < r - 0.5 ? 255 : Math.round((1 - (dist - (r - 0.5))) * 255);
          const px = Math.round(cx) + dx;
          const py = Math.round(cy) + dy;
          if (px >= 0 && py >= 0 && px < size && py < size) {
            const i = (py * size + px) * 4;
            // Only paint if we're inside the rounded square (alpha > 0)
            if (pixels[i + 3] > 0) {
              // Blend white over existing color
              const t = alpha / 255;
              pixels[i]     = Math.round(pixels[i]     * (1 - t) + 255 * t);
              pixels[i + 1] = Math.round(pixels[i + 1] * (1 - t) + 255 * t);
              pixels[i + 2] = Math.round(pixels[i + 2] * (1 - t) + 255 * t);
              pixels[i + 3] = 255;
            }
          }
        }
      }
    }
  }

  // Draw a thick line from (x1,y1) to (x2,y2) by stamping circles along it
  function thickLine(x1, y1, x2, y2, thickness) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      circle(x1 + dx * t, y1 + dy * t, thickness / 2);
    }
  }

  // Design coordinates on a 128×128 canvas, then scale to actual size
  // Arrow shaft: from lower-left to upper-right (center of icon)
  const shaft = {
    x1: 38 * s, y1: 88 * s,
    x2: 82 * s, y2: 44 * s,
  };

  // Arrow tail tab (a small perpendicular square on lower-left end)
  // representing an open browser tab
  const tabW = 22 * s;
  const tabH = 16 * s;
  const tabX = shaft.x1 - tabW * 0.6;
  const tabY = shaft.y1 - tabH * 0.5;

  // Draw the tab rectangle
  function fillRect(rx, ry, rw, rh, thickness) {
    for (let dy = 0; dy <= rh; dy++) {
      thickLine(rx, ry + dy, rx + rw, ry + dy, thickness);
    }
  }
  fillRect(tabX, tabY, tabW, tabH, 1.5 * s);

  // Arrow shaft
  thickLine(shaft.x1, shaft.y1, shaft.x2, shaft.y2, 10 * s);

  // Arrowhead: three lines forming a ">" pointing upper-right
  const tipX = shaft.x2;
  const tipY = shaft.y2;
  const headLen = 28 * s;
  const headAngle = Math.atan2(shaft.y1 - shaft.y2, shaft.x2 - shaft.x1); // direction of arrow
  const spread = Math.PI / 4; // 45 degrees

  // Two wings of the arrowhead
  const w1x = tipX - headLen * Math.cos(headAngle - spread);
  const w1y = tipY + headLen * Math.sin(headAngle - spread);
  const w2x = tipX - headLen * Math.cos(headAngle + spread);
  const w2y = tipY + headLen * Math.sin(headAngle + spread);

  thickLine(tipX, tipY, w1x, w1y, 10 * s);
  thickLine(tipX, tipY, w2x, w2y, 10 * s);
}

// ── Generate one icon at the given size ───────────────────────────────────
function generateIcon(size) {
  // Flat array: RGBA for each pixel, all zeroes = fully transparent initially
  const pixels = new Uint8Array(size * size * 4);

  // Corner radius: 22% of the icon size gives a nice rounded square feel
  const radius = Math.round(size * 0.22);

  // Step 1: Draw the amber rounded square background
  drawRoundedSquare(pixels, size, AMBER, radius);

  // Step 2: Draw the white arrow on top
  drawArrow(pixels, size);

  return buildPNG(pixels, size, size);
}

// ── Main: generate all three sizes ────────────────────────────────────────
const iconsDir = path.join(__dirname, '..', 'extension', 'icons');

// Make sure the icons folder exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

const sizes = [16, 48, 128];

for (const size of sizes) {
  const pngData = generateIcon(size);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, pngData);
  console.log(`✓ Generated icon${size}.png  (${pngData.length} bytes)`);
}

console.log('\nAll icons written to extension/icons/');
