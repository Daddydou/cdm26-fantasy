// Génère public/icon-192.png et public/icon-512.png sans dépendances externes
const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

function crc32(buf) {
  if (!crc32._table) {
    crc32._table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      crc32._table[n] = c
    }
  }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crc32._table[(crc ^ buf[i]) & 0xFF]
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crcB])
}

function makePNG(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB

  const cx = size / 2, cy = size / 2
  const outerR = size * 0.40, innerR = size * 0.25

  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3)
    row[0] = 0
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy
      let r, g, b
      if (d2 <= innerR * innerR) {
        // Centre : vert vif (pelouse)
        r = 0x16; g = 0x78; b = 0x3b
      } else if (d2 <= outerR * outerR) {
        // Anneau : vert foncé
        r = 0x0a; g = 0x3d; b = 0x1f
      } else {
        // Fond : quasi-noir #0a0a0f
        r = 0x0a; g = 0x0a; b = 0x0f
      }
      row[1 + x * 3] = r
      row[2 + x * 3] = g
      row[3 + x * 3] = b
    }
    rows.push(row)
  }

  const idat = zlib.deflateSync(Buffer.concat(rows))
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

const out = path.join(__dirname, '..', 'public')
fs.writeFileSync(path.join(out, 'icon-192.png'), makePNG(192))
fs.writeFileSync(path.join(out, 'icon-512.png'), makePNG(512))
console.log('✅  icon-192.png et icon-512.png générés dans public/')
