/**
 * Convert a PNG to a minimal .ico file.
 * ICO format: header + directory entries + embedded PNGs
 * Modern ICO files can embed PNGs directly (supported since Windows Vista).
 *
 * Usage: node png-to-ico.js input.png output.ico
 */

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error('Usage: node png-to-ico.js <input.png> <output.ico>');
  process.exit(1);
}

const pngData = fs.readFileSync(inputPath);

// Parse PNG header for dimensions
// PNG signature: 8 bytes, then IHDR chunk: 4 len + 4 type + 4 width + 4 height
const width = pngData.readUInt32BE(16);
const height = pngData.readUInt32BE(20);

// ICO files use 0 for 256px dimensions
const icoW = width >= 256 ? 0 : width;
const icoH = height >= 256 ? 0 : height;

// ICO Header: 6 bytes
//   Reserved (2) + Type 1=ICO (2) + Count (2)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);     // Reserved
header.writeUInt16LE(1, 2);     // Type: 1 = ICO
header.writeUInt16LE(1, 4);     // Image count: 1

// Directory Entry: 16 bytes
//   Width (1) + Height (1) + Colors (1) + Reserved (1)
//   + Planes (2) + BPP (2) + Size (4) + Offset (4)
const entry = Buffer.alloc(16);
entry.writeUInt8(icoW, 0);           // Width (0 = 256)
entry.writeUInt8(icoH, 1);           // Height (0 = 256)
entry.writeUInt8(0, 2);              // Color palette (0 = no palette)
entry.writeUInt8(0, 3);              // Reserved
entry.writeUInt16LE(1, 4);           // Color planes
entry.writeUInt16LE(32, 6);          // Bits per pixel
entry.writeUInt32LE(pngData.length, 8);   // Image data size
entry.writeUInt32LE(6 + 16, 12);          // Offset to image data (header + 1 entry)

// Write ICO file
const ico = Buffer.concat([header, entry, pngData]);
fs.writeFileSync(outputPath, ico);

console.log(`  ✅ Created ${path.basename(outputPath)} (${width}x${height}, ${ico.length} bytes)`);
