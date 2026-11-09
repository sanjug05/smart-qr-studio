#!/usr/bin/env node
/**
 * READ-ONLY audit: compares the CURRENT live Hosting version of sanjugupta-web (files and configuration) with the
 * "after" state recorded in a release receipt written by scripts/deploy-qr-hosting.mjs (--receipt-out).
 *
 *   $env:QR_READ_TOKEN = (gcloud auth print-access-token)     # any identity that may read Hosting; session-only
 *   node scripts/audit-qr-live.mjs --receipt "$HOME\Downloads\QR-release-records\<receipt>.json"
 *   Remove-Item Env:QR_READ_TOKEN
 *
 * It issues GET requests only (no write code path exists in this file). Exit code 0 = live matches the receipt,
 * 2 = differences found (listed, non-/qr differences flagged loudly), 1 = error.
 */
import { readFileSync } from 'node:fs'
import { API, LIMITS, canonicalSha, isQrPath } from './lib/qrPublisher.mjs'

const args = process.argv.slice(2)
const opt = (n) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const receiptPath = opt('receipt')
const token = process.env.QR_READ_TOKEN
delete process.env.QR_READ_TOKEN
if (!receiptPath) throw new Error('Usage: --receipt <file>')
if (!token) throw new Error('Set QR_READ_TOKEN for this session (never as an argument).')

const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
const base = `projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}`

async function get(path) {
  const url = path.startsWith('http') ? path : `${API}/${path}`
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${url.replace(API, '')} -> ${res.status} ${JSON.stringify(body.error ?? body).slice(0, 200)}`)
  return body
}

const live = await get(`${base}/channels/live`)
const liveName = live.release.version.name
const liveId = liveName.split('/').pop()
const files = new Map()
let pageToken = ''
do {
  const page = await get(`${liveName}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)
  for (const f of page.files ?? []) files.set(f.path, f.hash)
  pageToken = page.nextPageToken ?? ''
} while (pageToken)

const want = new Map(receipt.after.files.map((f) => [f.path, f.hash]))
const added = [...files.keys()].filter((p) => !want.has(p))
const removed = [...want.keys()].filter((p) => !files.has(p))
const changed = [...files].filter(([p, h]) => want.has(p) && want.get(p) !== h).map(([p]) => p)
const diffs = [...added.map((p) => ['ADDED', p]), ...removed.map((p) => ['REMOVED', p]), ...changed.map((p) => ['CHANGED', p])]
const liveConfigSha = canonicalSha(live.release.version.config ?? {})
const configSame = liveConfigSha === receipt.after.configSha256

console.log(`receipt: ${receipt.kind} of ${receipt.timestampUtc}, version ${receipt.newVersion}, source ${receipt.sourceCommit}`)
console.log(`live now: version ${liveId} ; ${files.size} files (receipt: ${want.size}) ; config ${configSame ? 'IDENTICAL' : 'DIFFERENT'} (live ${liveConfigSha.slice(0, 12)}…, receipt ${receipt.after.configSha256.slice(0, 12)}…)`)
console.log(`live version ${liveId === receipt.newVersion ? 'is' : 'is NOT'} the version recorded in the receipt`)
if (diffs.length === 0 && configSame) {
  console.log('AUDIT PASS: every file and the configuration match the receipt.')
  process.exit(0)
}
const nonQr = diffs.filter(([, p]) => !isQrPath(p))
console.log(`AUDIT DIFFERENCES: ${diffs.length} file difference(s) (${nonQr.length} OUTSIDE /qr${nonQr.length ? ' — someone else released since' : ''}), config ${configSame ? 'same' : 'different'}`)
for (const [kind, p] of diffs.slice(0, 40)) console.log(`  ${kind} ${p}`)
if (diffs.length > 40) console.log(`  … ${diffs.length - 40} more`)
process.exit(2)
