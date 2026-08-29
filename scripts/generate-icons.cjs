// One-off pure-Node PNG encoder (no canvas dependency) that produces the
// two raster app icons vite-plugin-pwa's manifest points at. Run once at
// setup time via `node scripts/generate-icons.cjs`; not part of the build.
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

function crc32(buf) {
  let c
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })())
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeData), 0)
  return Buffer.concat([len, typeData, crc])
}

function buildPng(size) {
  const bg = [0x14, 0x14, 0x17]
  const mark = [0x6d, 0x5e, 0xf9]
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.34

  const raw = Buffer.alloc((size * 3 + 1) * size)
  let offset = 0
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const inDiamond = Math.abs(dx) / r + Math.abs(dy) / r <= 1
      const color = inDiamond ? mark : bg
      raw[offset++] = color[0]
      raw[offset++] = color[1]
      raw[offset++] = color[2]
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idat = zlib.deflateSync(raw)
  const iend = Buffer.alloc(0)

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', iend)])
}

const outDir = path.join(__dirname, '..', 'public', 'icons')
fs.mkdirSync(outDir, { recursive: true })
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), buildPng(size))
  console.log(`wrote icons/icon-${size}.png`)
}
