#!/usr/bin/env node
/**
 * Adds / replaces the Smart QR Studio app under /qr on an EXISTING Firebase
 * Hosting site, without touching anything else on that site.
 *
 * Why not `firebase deploy`: a normal Hosting deploy publishes exactly the
 * folder it is given and so REPLACES the site's whole release. sanjugupta.com
 * is one Hosting site whose release also contains the root website, /hq and
 * /learning (built and deployed elsewhere), so deploying only this app would
 * delete them. Instead this script builds a NEW version of the site:
 *
 *   new version = (live version's config + files, minus any previous /qr/**)
 *                 + this app's files under /qr/**
 *                 + the /qr header rules
 *
 * Existing blobs are referenced by hash (nothing is re-uploaded), the new
 * version is verified to still contain every non-/qr file of the live
 * version unchanged, and only then is it released. It can release to a
 * preview channel first (--channel qr-preview) and promote to `live` later.
 * Rolling back is re-releasing the previous version (printed at the end).
 *
 * Usage:
 *   node scripts/deploy-qr-hosting.mjs --site sanjugupta-web --project ais-channel-os \
 *        --dist dist --channel qr-preview [--dry-run]
 *
 * Auth (the token is kept in memory and never printed):
 *   - GOOGLE_OAUTH_ACCESS_TOKEN env var (CI: google-github-actions/auth with token_format: access_token), or
 *   - the local Firebase CLI login (run `firebase login` first).
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, relative, sep, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'

const API = 'https://firebasehosting.googleapis.com/v1beta1'
const MOUNT = '/qr'

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const site = opt('site', 'sanjugupta-web')
const project = opt('project', 'ais-channel-os')
const distDir = resolve(opt('dist', 'dist'))
const channel = opt('channel', 'qr-preview')
const dryRun = flag('dry-run')
const message = opt('message', `Smart QR Studio at ${MOUNT}`)

// -------------------------------------------------------------------- auth
async function getAccessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN
  quotaProject = project
  const candidates = [
    join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools'),
    join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'firebase-tools'),
    '/usr/local/lib/node_modules/firebase-tools',
    '/usr/lib/node_modules/firebase-tools'
  ]
  const dir = candidates.find((p) => existsSync(join(p, 'lib', 'auth.js')))
  if (!dir) throw new Error('No credentials: set GOOGLE_OAUTH_ACCESS_TOKEN, or install firebase-tools and run `firebase login`.')
  const auth = createRequire(import.meta.url)(join(dir, 'lib', 'auth.js'))
  const account = auth.getGlobalDefaultAccount()
  if (!account) throw new Error('No Firebase CLI login found. Run `firebase login`.')
  return (await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])).access_token
}

let token
let quotaProject = null // only needed for user (CLI) credentials, not for a service account's own token
async function call(method, url, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(quotaProject ? { 'x-goog-user-project': quotaProject } : {}), ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body)
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text.slice(0, 300) }
  }
  if (!res.ok) throw new Error(`${method} ${url.replace(API, '')} -> ${res.status} ${JSON.stringify(json.error ?? json).slice(0, 400)}`)
  return json
}

// ------------------------------------------------------------ local files
/** Every file under dist/, except source maps (not needed in production), as { '/qr/…': gzipped bytes }. */
function collectLocalFiles() {
  if (!existsSync(join(distDir, 'index.html'))) throw new Error(`${distDir} has no index.html — run the production build first.`)
  const out = new Map()
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (!name.endsWith('.map')) {
        const rel = relative(distDir, full).split(sep).join('/')
        const gz = gzipSync(readFileSync(full), { level: 9 })
        out.set(`${MOUNT}/${rel}`, { gz, hash: createHash('sha256').update(gz).digest('hex') })
      }
    }
  }
  walk(distDir)
  return out
}

// ------------------------------------------------------------ header rules
// CSP for the QR app: its own assets, Firebase Auth (Google sign-in popup + SDK) and Firestore, and the Dynamic QR API.
const QR_CSP = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self' https://*.googleapis.com https://*.cloudfunctions.net https://*.run.app",
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ')

const COMMON = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY'
}

const QR_HEADER_RULES = [
  { glob: `${MOUNT}/**`, headers: { ...COMMON, 'Content-Security-Policy': QR_CSP, 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()' } },
  { glob: MOUNT, headers: { ...COMMON, 'Content-Security-Policy': QR_CSP, 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()', 'Cache-Control': 'no-cache' } },
  { glob: `${MOUNT}/@(index.html|sw.js|manifest.webmanifest)`, headers: { 'Cache-Control': 'no-cache' } },
  // The worker lives at /qr/sw.js but is registered with scope "/qr" (the host redirects /qr/ -> /qr), which needs this header.
  { glob: `${MOUNT}/sw.js`, headers: { 'Service-Worker-Allowed': MOUNT } },
  { glob: `${MOUNT}/assets/**`, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }
]

const isQrGlob = (h) => typeof h.glob === 'string' && (h.glob === MOUNT || h.glob.startsWith(`${MOUNT}/`))

// -------------------------------------------------------------------- main
async function listFiles(versionName) {
  const files = new Map()
  let pageToken = ''
  do {
    const page = await call('GET', `${API}/${versionName}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)
    for (const f of page.files ?? []) files.set(f.path, f.hash)
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return files
}

async function main() {
  token = await getAccessToken()
  const siteName = `sites/${site}`

  // 1. The version currently live — the base everything else is copied from.
  const live = await call('GET', `${API}/${siteName}/channels/live`)
  const liveVersion = live.release?.version?.name
  if (!liveVersion) throw new Error('The live channel has no release.')
  const liveConfig = live.release.version.config ?? {}
  const liveFiles = await listFiles(liveVersion)
  const keptFiles = new Map([...liveFiles].filter(([p]) => !(p === MOUNT || p.startsWith(`${MOUNT}/`))))
  console.log(`live version ${liveVersion.split('/').pop()}: ${liveFiles.size} files (${liveFiles.size - keptFiles.size} already under ${MOUNT}/)`)

  // 2. This app's files and the merged config.
  const local = collectLocalFiles()
  const config = { ...liveConfig, headers: [...(liveConfig.headers ?? []).filter((h) => !isQrGlob(h)), ...QR_HEADER_RULES] }
  const allFiles = {}
  for (const [p, h] of keptFiles) allFiles[p] = h
  for (const [p, f] of local) allFiles[p] = f.hash
  console.log(`new version: ${keptFiles.size} existing files kept + ${local.size} files under ${MOUNT}/ ; header rules ${config.headers.length} (${QR_HEADER_RULES.length} for ${MOUNT})`)

  if (dryRun) {
    console.log('DRY RUN — nothing created. Target channel would be:', channel)
    return
  }

  // 3. Create the new (not yet finalized) version and attach files.
  const created = await call('POST', `${API}/${siteName}/versions`, { config })
  const versionName = created.name
  console.log('created version', versionName.split('/').pop())
  const populate = await call('POST', `${API}/${versionName}:populateFiles`, { files: allFiles })
  const needed = new Set(populate.uploadRequiredHashes ?? [])
  const byHash = new Map([...local.values()].map((f) => [f.hash, f.gz]))
  console.log(`uploading ${needed.size} new blob(s)`)
  for (const hash of needed) {
    const bytes = byHash.get(hash)
    if (!bytes) throw new Error(`The server asked for blob ${hash.slice(0, 12)}… which is not one of this app's files.`)
    await call('POST', `${populate.uploadUrl}/${hash}`, new Uint8Array(bytes), { 'Content-Type': 'application/octet-stream' })
  }
  await call('PATCH', `${API}/${versionName}?update_mask=status`, { status: 'FINALIZED' })

  // 4. Verify before releasing: every non-/qr file of the live version must be present and unchanged.
  const newFiles = await listFiles(versionName)
  const missing = [...keptFiles].filter(([p, h]) => newFiles.get(p) !== h)
  if (missing.length) throw new Error(`Verification failed: ${missing.length} existing file(s) missing or changed (e.g. ${missing[0][0]}). Nothing was released.`)
  const missingQr = [...local].filter(([p, f]) => newFiles.get(p) !== f.hash)
  if (missingQr.length) throw new Error(`Verification failed: ${missingQr.length} ${MOUNT} file(s) missing. Nothing was released.`)
  const learning = [...newFiles.keys()].filter((p) => p.startsWith('/learning/')).length
  console.log(`verified: all ${keptFiles.size} pre-existing files unchanged (including ${learning} under /learning/); ${local.size} under ${MOUNT}/`)

  // 5. Make sure the live release did not change while we worked, then release.
  const liveNow = (await call('GET', `${API}/${siteName}/channels/live`)).release?.version?.name
  if (liveNow !== liveVersion) throw new Error(`The live release changed during this deploy (${liveVersion} -> ${liveNow}). Aborting; re-run.`)

  let channelUrl = live.url
  if (channel !== 'live') {
    try {
      await call('POST', `${API}/${siteName}/channels?channelId=${encodeURIComponent(channel)}`, { ttl: '604800s' })
    } catch (e) {
      if (!/ALREADY_EXISTS|already exists|409/.test(String(e.message))) throw e
    }
  }
  const release = await call('POST', `${API}/${siteName}/channels/${channel}/releases?versionName=${encodeURIComponent(versionName)}`, { message })
  if (channel !== 'live') channelUrl = (await call('GET', `${API}/${siteName}/channels/${channel}`)).url
  console.log(`released to channel "${channel}": ${channelUrl}`)
  console.log(`release ${release.name?.split('/').pop()}`)
  console.log(`ROLLBACK (live): release ${liveVersion} again — POST ${API}/${siteName}/channels/live/releases?versionName=${liveVersion}`)
  console.log(`NEW_VERSION=${versionName}`)
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
