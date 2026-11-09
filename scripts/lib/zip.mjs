// Minimal, strict, dependency-free ZIP reader for the GitHub Actions artifact (stored or deflate entries only).
// It reads the central directory, verifies every CRC-32 and size, and refuses anything unusual: path traversal,
// absolute or drive-letter paths, backslashes, duplicate names, encrypted entries, ZIP64, other compression methods,
// too many entries or too many bytes. Everything stays in memory; nothing is written to disk.
import { inflateRawSync } from 'node:zlib'

export class ZipError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ZipError'
  }
}

const MAX_ENTRIES = 2000
const MAX_TOTAL_BYTES = 64 * 1024 * 1024

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function safeName(name) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw new ZipError(`unsafe entry name "${name}"`)
  if (name.split('/').some((p) => p === '..' || p === '.')) throw new ZipError(`unsafe entry name "${name}"`)
  return name
}

/** @returns {Map<string, Buffer>} entry name -> bytes (directory entries are skipped). */
export function readZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new ZipError('not a zip file')
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('no end-of-central-directory record')
  const total = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 is not supported')
  if (total > MAX_ENTRIES) throw new ZipError(`too many entries (${total})`)
  if (cdOffset + cdSize > eocd) throw new ZipError('corrupt central directory')
  const out = new Map()
  let p = cdOffset
  let bytes = 0
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('corrupt central directory entry')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    p += 46 + nameLen + extraLen + commentLen
    if (flags & 1) throw new ZipError(`encrypted entry "${name}"`)
    if (name.endsWith('/')) continue
    safeName(name)
    if (out.has(name)) throw new ZipError(`duplicate entry "${name}"`)
    if (csize === 0xffffffff || usize === 0xffffffff) throw new ZipError('ZIP64 is not supported')
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError(`bad local header for "${name}"`)
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
    const raw = buf.subarray(dataStart, dataStart + csize)
    if (raw.length !== csize) throw new ZipError(`truncated data for "${name}"`)
    bytes += usize
    if (bytes > MAX_TOTAL_BYTES) throw new ZipError('archive is too large')
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: usize + 1 })
    else throw new ZipError(`unsupported compression method ${method} for "${name}"`)
    if (data.length !== usize) throw new ZipError(`size mismatch for "${name}"`)
    if (crc32(data) !== crc) throw new ZipError(`CRC mismatch for "${name}"`)
    out.set(name, data)
  }
  return out
}
