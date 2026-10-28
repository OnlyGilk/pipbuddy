// Makes the little colour-dot icons shown next to tray menu items.
// Builds a tiny PNG by hand so it works the same on Windows, macOS and Linux.

const zlib = require('zlib');
const { nativeImage } = require('electron');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
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

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// A filled circle with a thin dark outline, anti-aliased, on transparency.
function circlePng(hex, size) {
  const [r, g, b] = hexToRgb(hex);
  const rows = [];
  const c = (size - 1) / 2;
  const radius = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // first byte = filter type 0
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const alpha = Math.max(0, Math.min(1, radius - d + 0.5));
      const outline = d > radius - size / 10;
      const i = 1 + x * 4;
      row[i] = outline ? Math.round(r * 0.55) : r;
      row[i + 1] = outline ? Math.round(g * 0.55) : g;
      row[i + 2] = outline ? Math.round(b * 0.55) : b;
      row[i + 3] = Math.round(alpha * 255);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const cache = new Map();

function swatch(hex) {
  if (!cache.has(hex)) {
    const img = nativeImage.createFromBuffer(circlePng(hex, 16));
    img.addRepresentation({ scaleFactor: 2, buffer: circlePng(hex, 32) });
    cache.set(hex, img);
  }
  return cache.get(hex);
}

module.exports = { swatch, circlePng };
