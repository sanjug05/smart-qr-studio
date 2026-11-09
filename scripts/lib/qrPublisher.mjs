// Path-preserving publisher for Smart QR Studio at https://sanjugupta.com/qr.
//
// This module holds ALL of the logic and ALL of the guards. scripts/deploy-qr-hosting.mjs is a thin command-line wrapper.
//
// Security model (read this before changing anything):
//   - It never calls `firebase deploy` and never replaces the site's release with this app's build. It builds a NEW
//     Hosting version = (the live version's files + config, minus /qr/**) + (this app's files under /qr/**) + the /qr
//     header rules, verifies that every non-/qr file is unchanged, and only then releases that version.
//   - The only credential it accepts is a short-lived access token for the dedicated publisher service account, passed
//     in the process environment variable QR_PUBLISHER_TOKEN. No key file, no user login, no Firebase CLI fallback.
//   - IAM does NOT confine firebasehosting.sites.update to one site, channel or path. Every restriction below
//     (project, site, channel, path, plan hash) is an APPLICATION-LEVEL control in this program, not an IAM boundary.
//   - Every write goes through one allow-listed function. There is no DELETE anywhere.
//   - Guards are named functions in GUARDS so tests can prove each one is load-bearing (mutation tests).

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

export const API = 'https://firebasehosting.googleapis.com/v1beta1'
export const UPLOAD_PREFIX = 'https://upload-firebasehosting.googleapis.com/'
export const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'
export const MOUNT = '/qr'

export const LIMITS = Object.freeze({
  PROJECT: 'ais-channel-os',
  SITE: 'sanjugupta-web',
  PUBLISHER_SA: 'qr-hosting-publisher-20261109@ais-channel-os.iam.gserviceaccount.com',
  LIVE_PHRASE: 'PUBLISH-CLEAN-QR-TO-LIVE',
  PREVIEW_CHANNEL_RE: /^qr-pv-\d{8}-[a-z0-9]{6,16}$/,
  PROTECTED_CHANNELS: Object.freeze(['qr-preview']),
  REQUIRED_SCOPE: 'https://www.googleapis.com/auth/firebase',
  ALLOWED_SCOPES: Object.freeze(['https://www.googleapis.com/auth/firebase', 'https://www.googleapis.com/auth/userinfo.email', 'openid']),
  MAX_TOKEN_SECONDS: 900,
  MIN_TOKEN_SECONDS: 120,
  PREVIEW_TTL: '172800s',
  ALLOWED_CONFIG_KEYS: Object.freeze(['headers', 'redirects', 'rewrites', 'cleanUrls', 'trailingSlashBehavior'])
})

export class GuardError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`)
    this.name = 'GuardError'
    this.code = code
  }
}

// ----------------------------------------------------------------- helpers
export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** Deterministic JSON: object keys sorted recursively, arrays kept in order. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
export const canonicalSha = (value) => sha256(canonical(value))

export const isQrPath = (p) => p === MOUNT || p.startsWith(`${MOUNT}/`)
export const isQrGlob = (h) => typeof h?.glob === 'string' && (h.glob === MOUNT || h.glob.startsWith(`${MOUNT}/`))
const versionId = (name) => String(name ?? '').split('/').pop()

// ------------------------------------------------------------ header rules
// Identical to the rules that are live today (5 rules). Changing them changes the plan hash.
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
const COMMON = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' }
const PERMS = 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
export const QR_HEADER_RULES = Object.freeze([
  { glob: `${MOUNT}/**`, headers: { ...COMMON, 'Content-Security-Policy': QR_CSP, 'Permissions-Policy': PERMS } },
  { glob: MOUNT, headers: { ...COMMON, 'Content-Security-Policy': QR_CSP, 'Permissions-Policy': PERMS, 'Cache-Control': 'no-cache' } },
  { glob: `${MOUNT}/@(index.html|sw.js|manifest.webmanifest)`, headers: { 'Cache-Control': 'no-cache' } },
  { glob: `${MOUNT}/sw.js`, headers: { 'Service-Worker-Allowed': MOUNT } },
  { glob: `${MOUNT}/assets/**`, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }
])

// ----------------------------------------------------------- build manifest
/** Every file under distDir as { path, size, sha256 } (raw bytes), sorted. Source maps are included (the manifest describes the folder). */
export function listDistFiles(distDir) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else {
        const bytes = readFileSync(full)
        out.push({ path: relative(distDir, full).split(sep).join('/'), size: bytes.length, sha256: sha256(bytes) })
      }
    }
  }
  walk(distDir)
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export const manifestFilesSha = (files) => canonicalSha(files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })))

export function buildManifest(distDir, meta = {}) {
  if (!existsSync(join(distDir, 'index.html'))) throw new Error(`${distDir} has no index.html — run the production build first.`)
  const files = listDistFiles(distDir)
  return { schema: 1, fileCount: files.length, totalBytes: files.reduce((n, f) => n + f.size, 0), filesSha256: manifestFilesSha(files), meta, files }
}

/** Throws GuardError when dist/ and the manifest disagree: missing manifest, modified, missing or extra files. */
export const GUARDS = {
  manifestPresent({ manifest }) {
    if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) throw new GuardError('MANIFEST_MISSING', 'No usable build manifest (build-manifest.json). Refusing to publish an unmanifested build.')
    if (manifest.schema !== 1) throw new GuardError('MANIFEST_SCHEMA', `Unsupported manifest schema ${manifest.schema}.`)
    if (manifestFilesSha(manifest.files) !== manifest.filesSha256) throw new GuardError('MANIFEST_SELF_HASH', 'The manifest does not match its own recorded hash.')
  },
  artifactMatchesManifest({ manifest, distFiles }) {
    const want = new Map(manifest.files.map((f) => [f.path, f]))
    const have = new Map(distFiles.map((f) => [f.path, f]))
    const missing = [...want.keys()].filter((p) => !have.has(p))
    if (missing.length) throw new GuardError('ARTIFACT_MISSING_FILE', `${missing.length} file(s) listed in the manifest are missing from dist/ (e.g. ${missing[0]}).`)
    const extra = [...have.keys()].filter((p) => !want.has(p))
    if (extra.length) throw new GuardError('ARTIFACT_EXTRA_FILE', `${extra.length} file(s) in dist/ are not in the manifest (e.g. ${extra[0]}).`)
    const changed = [...want].filter(([p, f]) => have.get(p).sha256 !== f.sha256 || have.get(p).size !== f.size)
    if (changed.length) throw new GuardError('ARTIFACT_MODIFIED_FILE', `${changed.length} file(s) differ from the manifest (e.g. ${changed[0][0]}).`)
  },
  project({ opts }) {
    if (opts.project !== LIMITS.PROJECT) throw new GuardError('WRONG_PROJECT', `Only project ${LIMITS.PROJECT} is allowed (got "${opts.project}").`)
  },
  site({ opts }) {
    if (opts.site !== LIMITS.SITE) throw new GuardError('WRONG_SITE', `Only Hosting site ${LIMITS.SITE} is allowed (got "${opts.site}").`)
  },
  mode({ opts }) {
    if (!['preview', 'live', 'rollback'].includes(opts.mode)) throw new GuardError('BAD_MODE', 'Mode must be exactly "preview", "live" or "rollback".')
  },
  channel({ opts }) {
    const ch = opts.channel
    if (LIMITS.PROTECTED_CHANNELS.includes(ch)) throw new GuardError('PROTECTED_CHANNEL', `Channel "${ch}" is protected and is never written.`)
    if (opts.mode === 'preview') {
      if (ch === 'live') throw new GuardError('PREVIEW_TARGETS_LIVE', 'Preview mode may not target the live channel.')
      if (!LIMITS.PREVIEW_CHANNEL_RE.test(String(ch))) throw new GuardError('BAD_PREVIEW_CHANNEL', `A preview channel must match qr-pv-<yyyymmdd>-<id> (got "${ch}").`)
    } else if (ch !== 'live') {
      throw new GuardError('LIVE_TARGETS_PREVIEW', `Mode ${opts.mode} must target exactly "live" (got "${ch}").`)
    }
  },
  expectedLiveVersion({ opts, liveVersion }) {
    if (!/^[0-9a-f]{16}$/.test(String(opts.expectedLiveVersion ?? ''))) throw new GuardError('EXPECTED_VERSION_REQUIRED', 'An expected live version id (16 hex characters) is required.')
    if (versionId(liveVersion) !== opts.expectedLiveVersion) throw new GuardError('LIVE_VERSION_DRIFT', `Live version is ${versionId(liveVersion)}, expected ${opts.expectedLiveVersion}. Nothing was written.`)
  },
  configShape({ liveConfig }) {
    const unknown = Object.keys(liveConfig ?? {}).filter((k) => !LIMITS.ALLOWED_CONFIG_KEYS.includes(k))
    if (unknown.length) throw new GuardError('UNEXPECTED_CONFIG', `The live Hosting configuration has unexpected key(s): ${unknown.join(', ')}. Review before publishing.`)
  },
  planApproved({ opts, plan }) {
    if (!/^[0-9a-f]{64}$/.test(String(opts.planSha256 ?? ''))) throw new GuardError('PLAN_HASH_REQUIRED', 'The approved plan SHA-256 (64 hex characters) is required.')
    if (canonicalSha(plan) !== opts.planSha256) throw new GuardError('PLAN_HASH_MISMATCH', `The plan computed now (${canonicalSha(plan).slice(0, 12)}…) is not the approved plan (${opts.planSha256.slice(0, 12)}…). Nothing was written.`)
  },
  livePhrase({ opts }) {
    if (opts.confirm !== LIMITS.LIVE_PHRASE) throw new GuardError('CONFIRMATION_REQUIRED', 'Live mode requires the exact typed confirmation phrase.')
  },
  rollbackPhrase({ opts }) {
    if (opts.confirm !== `ROLLBACK-QR-TO-${opts.targetVersion}`) throw new GuardError('CONFIRMATION_REQUIRED', 'Rollback requires the exact typed phrase ROLLBACK-QR-TO-<target version>.')
  },
  noKeyAuth({ env }) {
    if (env.GOOGLE_APPLICATION_CREDENTIALS) throw new GuardError('KEY_AUTH_FORBIDDEN', 'GOOGLE_APPLICATION_CREDENTIALS is set. Key-file authentication is not permitted; unset it.')
  },
  tokenPresent({ token }) {
    if (!token) throw new GuardError('TOKEN_REQUIRED', 'QR_PUBLISHER_TOKEN is not set. No other credential source is permitted.')
  },
  tokenIdentity({ info }) {
    if (info.email !== LIMITS.PUBLISHER_SA) throw new GuardError('TOKEN_WRONG_IDENTITY', `The token belongs to "${info.email ?? 'unknown'}", not the publisher service account.`)
  },
  tokenScopes({ info }) {
    const scopes = String(info.scope ?? '').split(/\s+/).filter(Boolean)
    if (!scopes.includes(LIMITS.REQUIRED_SCOPE)) throw new GuardError('TOKEN_SCOPE_MISSING', `The token lacks the required scope ${LIMITS.REQUIRED_SCOPE}.`)
    const extra = scopes.filter((s) => !LIMITS.ALLOWED_SCOPES.includes(s))
    if (extra.length) throw new GuardError('TOKEN_SCOPE_TOO_BROAD', `The token carries scope(s) beyond the allowed set: ${extra.join(' ')}.`)
  },
  tokenExpiry({ info }) {
    const left = Number(info.expires_in)
    if (!Number.isFinite(left) || left <= 0) throw new GuardError('TOKEN_EXPIRED', 'The token is expired or its lifetime is unknown.')
    if (left > LIMITS.MAX_TOKEN_SECONDS) throw new GuardError('TOKEN_TOO_LONG_LIVED', `The token has ${left}s left; at most ${LIMITS.MAX_TOKEN_SECONDS}s is allowed.`)
    if (left < LIMITS.MIN_TOKEN_SECONDS) throw new GuardError('TOKEN_EXPIRING', `The token has only ${left}s left; at least ${LIMITS.MIN_TOKEN_SECONDS}s is needed.`)
  },
  previewChannelIsNew({ channelExists }) {
    if (channelExists) throw new GuardError('CHANNEL_EXISTS', 'The preview channel already exists. A preview channel is single-use and is never overwritten.')
  },
  testedVersionMatches({ opts, newMap, newConfig, tested }) {
    if (!/^[0-9a-f]{16}$/.test(String(opts.testedVersion ?? ''))) throw new GuardError('TESTED_VERSION_REQUIRED', 'Live mode requires --tested-version: the preview version that was verified.')
    if (!tested || mapSha(newMap) !== mapSha(tested.files) || canonicalSha(newConfig) !== canonicalSha(tested.config)) {
      throw new GuardError('NOT_THE_TESTED_BUILD', `The version about to go live is not byte-identical to the tested preview version ${opts.testedVersion}.`)
    }
  },
  rollbackTarget({ opts, liveVersion, target }) {
    if (!/^[0-9a-f]{16}$/.test(String(opts.targetVersion ?? ''))) throw new GuardError('TARGET_REQUIRED', 'Rollback requires --target-version (16 hex characters).')
    if (versionId(liveVersion) === opts.targetVersion) throw new GuardError('TARGET_IS_LIVE', 'The rollback target is already live.')
    if (!target || target.status !== 'FINALIZED') throw new GuardError('TARGET_NOT_FINALIZED', 'The rollback target does not exist or is not FINALIZED.')
  },
  postVerifyNonQrUnchanged({ nonQr, newFiles }) {
    const bad = [...nonQr].filter(([p, h]) => newFiles.get(p) !== h)
    if (bad.length) throw new GuardError('NON_QR_CHANGED', `Verification failed: ${bad.length} non-/qr file(s) missing or changed (e.g. ${bad[0][0]}). Nothing was released.`)
    const stray = [...newFiles.keys()].filter((p) => !nonQr.has(p) && !isQrPath(p))
    if (stray.length) throw new GuardError('NON_QR_ADDED', `Verification failed: unexpected non-/qr file(s) (e.g. ${stray[0]}). Nothing was released.`)
  },
  postVerifyQrComplete({ qrLocal, newFiles }) {
    const bad = [...qrLocal].filter(([p, f]) => newFiles.get(p) !== f.hash)
    if (bad.length) throw new GuardError('QR_INCOMPLETE', `Verification failed: ${bad.length} /qr file(s) missing or different. Nothing was released.`)
    const extra = [...newFiles.keys()].filter((p) => isQrPath(p) && !qrLocal.has(p))
    if (extra.length) throw new GuardError('QR_EXTRA', `Verification failed: unexpected /qr file(s) (e.g. ${extra[0]}). Nothing was released.`)
  },
  postVerifyConfig({ expectedConfig, newVersionConfig }) {
    if (canonicalSha(expectedConfig) !== canonicalSha(newVersionConfig ?? {})) throw new GuardError('CONFIG_CHANGED', 'The new version’s configuration is not the planned one. Nothing was released.')
  },
  liveStillSame({ liveVersion, liveNow }) {
    if (liveNow !== liveVersion) throw new GuardError('LIVE_CHANGED_DURING_RUN', `The live release changed during this run (${versionId(liveVersion)} -> ${versionId(liveNow)}). Aborting; nothing was released.`)
  }
}

function mapSha(map) {
  return canonicalSha([...map].sort(([a], [b]) => (a < b ? -1 : 1)))
}

// ------------------------------------------------------------- HTTP client
/**
 * `read` is GET only. `write` is the ONLY way to change anything and checks an allow-list; there is no DELETE.
 * `fetchImpl` is injectable so the whole publisher can be tested against a fake Hosting API.
 */
export function makeClient({ fetchImpl, token, project, site, mode, channel, readOnly }) {
  const state = { writes: 0, log: [] }
  const base = `${API}/projects/${project}/sites/${site}`
  const headers = (extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra })
  const parse = async (res, method, url) => {
    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      json = { raw: text.slice(0, 300) }
    }
    if (!res.ok) {
      const err = new Error(`${method} ${url.replace(API, '')} -> ${res.status} ${JSON.stringify(json.error ?? json).slice(0, 300)}`)
      err.status = res.status
      throw err
    }
    return json
  }
  async function read(path) {
    const url = path.startsWith('http') ? path : `${API}/${path}`
    state.log.push(`GET ${url.replace(API, '')}`)
    return parse(await fetchImpl(url, { method: 'GET', headers: headers() }), 'GET', url)
  }
  function allowed(method, url) {
    const rel = url.startsWith(API) ? url.slice(API.length) : null
    const vers = `/projects/${project}/sites/${site}/versions/`
    const chans = `/projects/${project}/sites/${site}/channels`
    if (mode === 'rollback') return method === 'POST' && rel !== null && rel.startsWith(`${chans}/live/releases?versionName=`)
    if (method === 'POST' && rel === `/projects/${project}/sites/${site}/versions`) return true
    if (method === 'POST' && rel !== null && rel.startsWith(vers) && rel.endsWith(':populateFiles')) return true
    if (method === 'POST' && url.startsWith(UPLOAD_PREFIX)) return true
    if (method === 'PATCH' && rel !== null && rel.startsWith(vers) && rel.endsWith('?update_mask=status')) return true
    if (mode === 'preview' && method === 'POST' && rel === `${chans}?channelId=${encodeURIComponent(channel)}`) return true
    if (method === 'POST' && rel !== null && rel.startsWith(`${chans}/${channel}/releases?versionName=`)) return true
    return false
  }
  async function write(method, url, body, extraHeaders = {}) {
    if (readOnly) throw new GuardError('READ_ONLY', 'This run is read-only (--plan-only); a write was attempted and refused.')
    if (method === 'DELETE' || !allowed(method, url)) throw new GuardError('WRITE_NOT_ALLOWED', `${method} ${url.replace(API, '')} is not on the publisher's write allow-list.`)
    state.writes += 1
    state.log.push(`${method} ${url.replace(API, '').replace(UPLOAD_PREFIX, 'upload:')}`)
    const isBytes = body instanceof Uint8Array
    const res = await fetchImpl(url, {
      method,
      headers: headers({ ...(body !== undefined && !isBytes ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }),
      body: body === undefined ? undefined : isBytes ? body : JSON.stringify(body)
    })
    return parse(res, method, url)
  }
  return { read, write, base, state }
}

async function listFiles(client, versionName) {
  const files = new Map()
  let pageToken = ''
  do {
    const page = await client.read(`${versionName}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)
    for (const f of page.files ?? []) files.set(f.path, f.hash)
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return files
}

export async function verifyToken({ fetchImpl, token, guards }) {
  const res = await fetchImpl(TOKENINFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: token }).toString()
  })
  const info = await res.json().catch(() => ({}))
  if (!res.ok) throw new GuardError('TOKEN_INVALID', `The token was rejected by Google's tokeninfo (${res.status}).`)
  guards.tokenIdentity({ info })
  guards.tokenScopes({ info })
  guards.tokenExpiry({ info })
  return { email: info.email, expiresIn: Number(info.expires_in), scopes: String(info.scope).split(/\s+/) }
}

function localQrFiles(distDir, manifest) {
  const out = new Map()
  for (const f of manifest.files) {
    if (f.path.endsWith('.map')) continue // source maps are never published
    const gz = gzipSync(readFileSync(join(distDir, f.path)), { level: 9 })
    out.set(`${MOUNT}/${f.path}`, { gz, hash: sha256(gz) })
  }
  return out
}

// ----------------------------------------------------------------- planning
async function readLive(client, opts, guards) {
  const live = await client.read(`projects/${opts.project}/sites/${opts.site}/channels/live`)
  const liveVersion = live.release?.version?.name
  if (!liveVersion) throw new GuardError('NO_LIVE_RELEASE', 'The live channel has no release.')
  guards.expectedLiveVersion({ opts, liveVersion })
  const liveConfig = live.release.version.config ?? {}
  guards.configShape({ liveConfig })
  const liveFiles = await listFiles(client, liveVersion)
  return { liveVersion, liveConfig, liveFiles }
}

function composeNew({ liveConfig, liveFiles, qrLocal }) {
  const nonQr = new Map([...liveFiles].filter(([p]) => !isQrPath(p)))
  const newMap = new Map(nonQr)
  for (const [p, f] of qrLocal) newMap.set(p, f.hash)
  const nonQrHeaders = (liveConfig.headers ?? []).filter((h) => !isQrGlob(h))
  const newConfig = { ...liveConfig, headers: [...nonQrHeaders, ...QR_HEADER_RULES] }
  return { nonQr, newMap, newConfig, nonQrHeaders }
}

export function makePlan({ opts, manifest, liveVersion, liveConfig, liveFiles, qrLocal }) {
  const { nonQr, newMap, newConfig, nonQrHeaders } = composeNew({ liveConfig, liveFiles, qrLocal })
  const liveQr = new Map([...liveFiles].filter(([p]) => isQrPath(p)))
  const added = [...qrLocal.keys()].filter((p) => !liveQr.has(p)).length
  const removed = [...liveQr.keys()].filter((p) => !qrLocal.has(p)).length
  const changed = [...qrLocal].filter(([p, f]) => liveQr.has(p) && liveQr.get(p) !== f.hash).length
  const nonQrConfig = { ...liveConfig, headers: nonQrHeaders }
  const liveQrHeaders = (liveConfig.headers ?? []).filter(isQrGlob)
  return {
    schema: 1,
    project: opts.project,
    site: opts.site,
    mode: opts.mode,
    channel: opts.channel,
    liveVersion: versionId(liveVersion),
    liveFileCount: liveFiles.size,
    nonQrFileCount: nonQr.size,
    nonQrManifestSha256: mapSha(nonQr),
    nonQrConfigSha256: canonicalSha(nonQrConfig),
    artifact: {
      filesSha256: manifest.filesSha256,
      fileCount: manifest.fileCount,
      repository: manifest.meta?.repository ?? null,
      sourceCommit: manifest.meta?.sourceCommit ?? null,
      buildId: manifest.meta?.buildId ?? null,
      runId: manifest.meta?.runId ?? null
    },
    qrBlobsSha256: mapSha(new Map([...qrLocal].map(([p, f]) => [p, f.hash]))),
    newFileCount: newMap.size,
    newManifestSha256: mapSha(newMap),
    newConfigSha256: canonicalSha(newConfig),
    qrChanges: { added, changed, removed, unchanged: qrLocal.size - added - changed },
    qrHeaderRulesIdenticalToLive: canonical(liveQrHeaders) === canonical(QR_HEADER_RULES),
    nonQrChanges: 0
  }
}

// -------------------------------------------------------------------- runs
function prepare(opts, deps) {
  const guards = deps.guards ?? GUARDS
  const env = deps.env ?? {}
  guards.noKeyAuth({ env })
  guards.project({ opts })
  guards.site({ opts })
  guards.mode({ opts })
  guards.channel({ opts })
  guards.tokenPresent({ token: deps.token })
  return guards
}

function loadArtifact(opts, guards) {
  const manifestPath = resolve(opts.manifest ?? '')
  const manifest = opts.manifest && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
  guards.manifestPresent({ manifest })
  const distDir = resolve(opts.dist)
  if (!existsSync(join(distDir, 'index.html'))) throw new GuardError('ARTIFACT_MISSING', `${distDir} has no index.html.`)
  guards.artifactMatchesManifest({ manifest, distFiles: listDistFiles(distDir) })
  return { manifest, distDir, qrLocal: localQrFiles(distDir, manifest) }
}

/** Read-only: computes the plan and its SHA-256. Performs zero writes by construction (readOnly client). */
export async function planRun(opts, deps) {
  const guards = prepare(opts, deps)
  const token = await verifyToken({ fetchImpl: deps.fetchImpl, token: deps.token, guards })
  const { manifest, qrLocal } = loadArtifact(opts, guards)
  const client = makeClient({ fetchImpl: deps.fetchImpl, token: deps.token, project: opts.project, site: opts.site, mode: opts.mode, channel: opts.channel, readOnly: true })
  const live = await readLive(client, opts, guards)
  const plan = makePlan({ opts, manifest, ...live, qrLocal })
  return { plan, planSha256: canonicalSha(plan), token, client }
}

/** Publishes. Every guard runs BEFORE the first write. */
export async function publishRun(opts, deps) {
  const guards = prepare(opts, deps)
  if (opts.mode === 'live') guards.livePhrase({ opts })
  const token = await verifyToken({ fetchImpl: deps.fetchImpl, token: deps.token, guards })
  const { manifest, qrLocal } = loadArtifact(opts, guards)
  const client = makeClient({ fetchImpl: deps.fetchImpl, token: deps.token, project: opts.project, site: opts.site, mode: opts.mode, channel: opts.channel, readOnly: false })
  const live = await readLive(client, opts, guards)
  const plan = makePlan({ opts, manifest, ...live, qrLocal })
  guards.planApproved({ opts, plan })
  const { nonQr, newMap, newConfig } = composeNew({ ...live, qrLocal })

  if (opts.mode === 'preview') {
    let channelExists = true
    try {
      await client.read(`projects/${opts.project}/sites/${opts.site}/channels/${opts.channel}`)
    } catch (e) {
      if (e.status === 404) channelExists = false
      else throw e
    }
    guards.previewChannelIsNew({ channelExists })
  } else {
    const testedName = `projects/${opts.project}/sites/${opts.site}/versions/${opts.testedVersion}`
    let tested = null
    if (/^[0-9a-f]{16}$/.test(String(opts.testedVersion ?? ''))) {
      try {
        const v = await client.read(testedName)
        tested = { config: v.config ?? {}, files: await listFiles(client, testedName) }
      } catch (e) {
        if (e.status !== 404) throw e
      }
    }
    guards.testedVersionMatches({ opts, newMap, newConfig, tested })
  }

  // ---- first write happens below this line
  const siteBase = `${API}/projects/${opts.project}/sites/${opts.site}`
  const created = await client.write('POST', `${siteBase}/versions`, { config: newConfig })
  const versionName = created.name
  const allFiles = Object.fromEntries(newMap)
  const populate = await client.write('POST', `${API}/${versionName}:populateFiles`, { files: allFiles })
  if (populate.uploadUrl && !String(populate.uploadUrl).startsWith(UPLOAD_PREFIX)) throw new GuardError('UPLOAD_HOST', 'The server returned an unexpected upload host.')
  const byHash = new Map([...qrLocal.values()].map((f) => [f.hash, f.gz]))
  for (const hash of populate.uploadRequiredHashes ?? []) {
    const bytes = byHash.get(hash)
    if (!bytes) throw new GuardError('UNKNOWN_BLOB', `The server asked for blob ${hash.slice(0, 12)}…, which is not one of this app's files.`)
    await client.write('POST', `${populate.uploadUrl}/${hash}`, new Uint8Array(bytes), { 'Content-Type': 'application/octet-stream' })
  }
  await client.write('PATCH', `${API}/${versionName}?update_mask=status`, { status: 'FINALIZED' })

  const newFiles = await listFiles(client, versionName)
  guards.postVerifyNonQrUnchanged({ nonQr, newFiles })
  guards.postVerifyQrComplete({ qrLocal, newFiles })
  const created2 = await client.read(versionName)
  guards.postVerifyConfig({ expectedConfig: newConfig, newVersionConfig: created2.config })
  const liveNow = (await client.read(`projects/${opts.project}/sites/${opts.site}/channels/live`)).release?.version?.name
  guards.liveStillSame({ liveVersion: live.liveVersion, liveNow })

  if (opts.mode === 'preview') await client.write('POST', `${siteBase}/channels?channelId=${encodeURIComponent(opts.channel)}`, { ttl: LIMITS.PREVIEW_TTL })
  const release = await client.write('POST', `${siteBase}/channels/${opts.channel}/releases?versionName=${encodeURIComponent(versionName)}`, { message: `Smart QR Studio at ${MOUNT} (${manifest.meta?.sourceCommit?.slice(0, 12) ?? 'unknown'})` })
  const channelInfo = await client.read(`projects/${opts.project}/sites/${opts.site}/channels/${opts.channel}`)
  const toList = (m) => [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, hash]) => ({ path, hash }))
  return {
    plan,
    planSha256: canonicalSha(plan),
    token,
    versionName,
    release: release.name,
    previousLive: versionId(live.liveVersion),
    url: channelInfo.url,
    writes: client.state.writes,
    log: client.state.log,
    before: { files: toList(live.liveFiles), config: live.liveConfig },
    after: { files: toList(newFiles), config: created2.config ?? {} }
  }
}

/** Re-releases an exact, known, FINALIZED earlier version to live. The only write is the release call. */
export async function rollbackRun(opts, deps) {
  const guards = prepare(opts, deps)
  guards.rollbackPhrase({ opts })
  const token = await verifyToken({ fetchImpl: deps.fetchImpl, token: deps.token, guards })
  const client = makeClient({ fetchImpl: deps.fetchImpl, token: deps.token, project: opts.project, site: opts.site, mode: 'rollback', channel: 'live', readOnly: false })
  const live = (await client.read(`projects/${opts.project}/sites/${opts.site}/channels/live`)).release?.version?.name
  guards.expectedLiveVersion({ opts, liveVersion: live })
  let target = null
  if (/^[0-9a-f]{16}$/.test(String(opts.targetVersion ?? ''))) {
    try {
      target = await client.read(`projects/${opts.project}/sites/${opts.site}/versions/${opts.targetVersion}`)
    } catch (e) {
      if (e.status !== 404) throw e
    }
  }
  guards.rollbackTarget({ opts, liveVersion: live, target })
  const release = await client.write('POST', `${API}/projects/${opts.project}/sites/${opts.site}/channels/live/releases?versionName=${encodeURIComponent(target.name)}`, { message: `Rollback to ${opts.targetVersion}` })
  return { token, release: release.name, from: versionId(live), to: opts.targetVersion, writes: client.state.writes, log: client.state.log }
}
