// Quick script to generate placeholder PNG test assets (no external deps)
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'public', 'assets');

{
  function createColorPNG(r, g, b) {
    // Minimal valid PNG: 1x1 pixel, RGBA
    const { deflateSync } = require('zlib');

    const width = 1, height = 1;
    // IHDR chunk data
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    // IDAT: raw pixel data (filter byte + RGBA)
    const raw = Buffer.from([0, r, g, b, 255]);
    const compressed = deflateSync(raw);

    // Build PNG file
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = [];

    function makeChunk(type, data) {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const typeB = Buffer.from(type, 'ascii');
      const crcData = Buffer.concat([typeB, data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(crcData), 0);
      return Buffer.concat([len, typeB, data, crc]);
    }

    // CRC32
    function crc32(buf) {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let j = 0; j < 8; j++) {
          c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
        }
      }
      return (c ^ 0xffffffff) >>> 0;
    }

    return Buffer.concat([
      signature,
      makeChunk('IHDR', ihdr),
      makeChunk('IDAT', compressed),
      makeChunk('IEND', Buffer.alloc(0))
    ]);
  }

  const states = {
    neutral_idle:      [59, 59, 92],
    neutral_speaking:  [76, 76, 122],
    happy_idle:        [45, 90, 61],
    happy_speaking:    [61, 122, 79],
    sad_idle:          [59, 74, 107],
    sad_speaking:      [74, 94, 133],
    eyes_closed:       [42, 42, 58],
  };

  for (const [name, [r, g, b]] of Object.entries(states)) {
    const filePath = path.join(assetsDir, `${name}.png`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, createColorPNG(r, g, b));
      console.log(`Created: ${name}.png`);
    } else {
      console.log(`Exists:  ${name}.png (skipped)`);
    }
  }

  console.log('\nPlaceholder assets created! These are tiny 1x1 colored pixels.');
  console.log('Replace them with your actual assets (GIF/WebM/PNG) when ready.');
}
