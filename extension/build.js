// Build script for Chrome and Firefox extension packages

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const rootDir = __dirname;
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

// Clean dist folder
if (fs.existsSync(distDir)) {
  try {
    const items = fs.readdirSync(distDir);
    for (const item of items) {
      try {
        fs.rmSync(path.join(distDir, item), { recursive: true, force: true });
      } catch {}
    }
  } catch {}
} else {
  fs.mkdirSync(distDir, { recursive: true });
}

const baseManifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.base.json'), 'utf8'));

// Recursive copy helper
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.name === 'manifest.base.json') continue;

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// CRC32 lookup table for zip creation
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate zip/xpi archive
function createZipArchive(sourceDir, outputFilePath, rootPrefix = '') {
  try {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    function processDir(currentDir, relPath) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const entryRelPath = (relPath ? relPath + '/' : '') + entry.name;
        const zipPath = rootPrefix ? (rootPrefix + '/' + entryRelPath) : entryRelPath;

        if (entry.isDirectory()) {
          processDir(fullPath, entryRelPath);
        } else {
          const fileData = fs.readFileSync(fullPath);
          const crc = crc32(fileData);
          const uncompressedSize = fileData.length;
          const compressedData = zlib.deflateRawSync(fileData, { level: 9 });
          const compressedSize = compressedData.length;

          const pathBuf = Buffer.from(zipPath.replace(/\\/g, '/'), 'utf8');

          // Local file header
          const localHeader = Buffer.alloc(30 + pathBuf.length);
          localHeader.writeUInt32LE(0x04034b50, 0); // PK0304 signature
          localHeader.writeUInt16LE(20, 4);         // Version 2.0
          localHeader.writeUInt16LE(0, 6);          // General flags
          localHeader.writeUInt16LE(8, 8);          // Deflate
          localHeader.writeUInt16LE(0, 10);
          localHeader.writeUInt16LE(0, 12);
          localHeader.writeUInt32LE(crc, 14);
          localHeader.writeUInt32LE(compressedSize, 18);
          localHeader.writeUInt32LE(uncompressedSize, 22);
          localHeader.writeUInt16LE(pathBuf.length, 26);
          localHeader.writeUInt16LE(0, 28);
          pathBuf.copy(localHeader, 30);

          // Central directory header
          const centralHeader = Buffer.alloc(46 + pathBuf.length);
          centralHeader.writeUInt32LE(0x02014b50, 0); // PK0102 signature
          centralHeader.writeUInt16LE(20, 4);
          centralHeader.writeUInt16LE(20, 6);
          centralHeader.writeUInt16LE(0, 8);
          centralHeader.writeUInt16LE(8, 10);
          centralHeader.writeUInt16LE(0, 12);
          centralHeader.writeUInt16LE(0, 14);
          centralHeader.writeUInt32LE(crc, 16);
          centralHeader.writeUInt32LE(compressedSize, 20);
          centralHeader.writeUInt32LE(uncompressedSize, 24);
          centralHeader.writeUInt16LE(pathBuf.length, 28);
          centralHeader.writeUInt16LE(0, 30);
          centralHeader.writeUInt16LE(0, 32);
          centralHeader.writeUInt16LE(0, 34);
          centralHeader.writeUInt16LE(0, 36);
          centralHeader.writeUInt32LE(0, 38);
          centralHeader.writeUInt32LE(offset, 42);
          pathBuf.copy(centralHeader, 46);

          localHeaders.push(localHeader, compressedData);
          centralHeaders.push(centralHeader);

          offset += localHeader.length + compressedData.length;
        }
      }
    }

    processDir(sourceDir, '');

    const centralDirBuffer = Buffer.concat(centralHeaders);
    const centralDirSize = centralDirBuffer.length;
    const centralDirOffset = offset;
    const totalEntries = centralHeaders.length;

    // End of central directory record
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // PK0506 signature
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(totalEntries, 8);
    eocd.writeUInt16LE(totalEntries, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20);

    const finalBuffer = Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
    fs.writeFileSync(outputFilePath, finalBuffer);
    console.log(`Created package: ${path.relative(rootDir, outputFilePath)} (${(finalBuffer.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.warn(`Warning: Could not create zip archive: ${err.message}`);
  }
}

// Build Chrome / Chromium target
function buildChromium() {
  const targetDir = path.join(distDir, 'chromium');
  copyDirSync(srcDir, targetDir);

  const manifest = {
    ...baseManifest,
    background: {
      service_worker: 'background.js'
    }
  };

  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Built Chromium package: dist/chromium');

  createZipArchive(targetDir, path.join(distDir, 'thunderDM-extension-chromium.zip'));
}

// Build Firefox target
function buildFirefox() {
  const targetDir = path.join(distDir, 'firefox');
  copyDirSync(srcDir, targetDir);

  const manifest = {
    ...baseManifest,
    background: {
      scripts: ['background.js']
    },
    browser_specific_settings: {
      gecko: {
        id: 'me@showayeb.dev',
        strict_min_version: '142.0',
        data_collection_permissions: {
          required: ['none']
        }
      }
    }
  };

  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Built Firefox package: dist/firefox');

  createZipArchive(targetDir, path.join(distDir, 'thunderDM-extension-firefox.zip'));
  createZipArchive(targetDir, path.join(distDir, 'thunderDM-extension-firefox.xpi'));
}

console.log('Building ThunderDM extension packages...\n');
buildChromium();
buildFirefox();
console.log('\nExtension packages built successfully.');
