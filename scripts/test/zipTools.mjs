// Test helper: builds ZIP files (stored, or deflate for chosen entries) the same way a real archive is laid out.
import { deflateRawSync } from 'node:zlib'
import { crc32 } from '../lib/zip.mjs'

export function makeZip(entries, { deflate = [] } = {}) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const method = deflate.includes(name) ? 8 : 0
    const body = method === 8 ? deflateRawSync(data) : data
    const nameBuf = Buffer.from(name)
    const crc = crc32(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10)
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42)
    locals.push(lh, nameBuf, body)
    centrals.push(ch, nameBuf)
    offset += lh.length + nameBuf.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length ?? entries.size, 8); eocd.writeUInt16LE(entries.length ?? entries.size, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}
