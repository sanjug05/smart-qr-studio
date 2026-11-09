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
//   - The build must have PROVENANCE: the artifact zip must be the one GitHub says the successful push-to-main run of
//     .github/workflows/qr-build.yml in repository 1350465108 uploaded (checked live against the public GitHub API,
//     including the artifact digest). A hash stored inside the artifact itself proves nothing and is never trusted alone.
//   - IAM does NOT confine firebasehosting.sites.update to one site, channel or path. Every restriction below
//     (project, site, channel, path, plan hash) is an APPLICATION-LEVEL control in this program, not an IAM boundary.
//   - OAuth scopes: the Firebase Hosting method-level references list firebase.hosting (writes) and
//     firebase.hosting.readonly (reads) as accepted alternatives, while the generic discovery document does not declare
//     them (a documented discrepancy, recorded in scripts/test/fixtures/hosting-discovery-subset.json). The preferred,
//     narrowest policy is exactly those two scopes; they are proven against the real API by the read-only canary BEFORE
//     any publishing permission is exercised. Nothing is ever silently broadened.
//   - Every write goes through one allow-listed function. There is no DELETE anywhere.
//   - Guards are named functions in GUARDS so tests can prove each one is load-bearing (mutation tests).

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { readZip, ZipError } from './zip.mjs'

export const API = 'https://firebasehosting.googleapis.com/v1beta1'
export const UPLOAD_PREFIX = 'https://upload-firebasehosting.googleapis.com/'
export const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'
export const GITHUB_API = 'https://api.github.com'
export const MOUNT = '/qr'

const SCOPE_BASE = 'https://www.googleapis.com/auth/'
const IDENTITY_SCOPES = [`${SCOPE_BASE}userinfo.email`, 'openid'] // the only extras: they identify the caller, they grant nothing

export const LIMITS = Object.freeze({
  PROJECT: 'ais-channel-os',
  SITE: 'sanjugupta-web',
  PUBLISHER_SA: 'qr-hosting-publisher-20261109@ais-channel-os.iam.gserviceaccount.com',
  AUDIT_SA: 'qr-canary-20261109@ais-channel-os.iam.gserviceaccount.com',
  LIVE_PHRASE: 'PUBLISH-CLEAN-QR-TO-LIVE',
  PREVIEW_CHANNEL_RE: /^qr-pv-\d{8}-[a-z0-9]{6,16}$/,
  PROTECTED_CHANNELS: Object.freeze(['qr-preview']),
  MAX_TOKEN_SECONDS: 900,
  MIN_TOKEN_SECONDS: 120,
  PREVIEW_TTL: '172800s',
  ALLOWED_CONFIG_KEYS: Object.freeze(['headers', 'redirects', 'rewrites', 'cleanUrls', 'trailingSlashBehavior'])
})

/** Who may call, and with exactly which scopes. Anything else is refused (fail closed). */
export const WRITE_POLICY = Object.freeze({ email: LIMITS.PUBLISHER_SA, requiredScope: `${SCOPE_BASE}firebase.hosting`, allowedScopes: Object.freeze([`${SCOPE_BASE}firebase.hosting`, ...IDENTITY_SCOPES]) })
export const READ_POLICY = Object.freeze({ email: LIMITS.AUDIT_SA, requiredScope: `${SCOPE_BASE}firebase.hosting.readonly`, allowedScopes: Object.freeze([`${SCOPE_BASE}firebase.hosting.readonly`, ...IDENTITY_SCOPES]) })

/** Immutable identity of the one build pipeline whose artifacts may be published. */
export const PROVENANCE = Object.freeze({
  REPOSITORY: 'sanjug05/smart-qr-studio',
  REPOSITORY_ID: 1350465108,
  WORKFLOW_PATH: '.github/workflows/qr-build.yml',
  WORKFLOW_ID: 411795429,
  // REVIEWED IMMUTABLE PIN: the Git blob SHA of .github/workflows/qr-build.yml that has been reviewed and approved.
  // A deliberate workflow change makes the build ineligible until this value is updated in a reviewed change.
  // (scripts/test checks that this pin equals the blob SHA of the workflow file in the repository.)
  WORKFLOW_BLOB_SHA: 'e3bfeae39e9efc93f6cf037ea244d79277903bbb',
  WORKFLOW_REF: 'sanjug05/smart-qr-studio/.github/workflows/qr-build.yml@refs/heads/main',
  REF: 'refs/heads/main',
  BRANCH: 'main',
  EVENT: 'push',
  ARTIFACT_PREFIX: 'qr-release-'
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
const sortedMap = (map) => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
const mapSha = (map) => canonicalSha(sortedMap(map))

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

// ------------------------------------------------------------- canonical routes
// Every Hosting REST route used by this program, in the project-qualified form that Google's discovery document
// declares for the projects.sites.* methods. scripts/test checks each of these against that document.
export const routes = {
  site: (p, s) => `${API}/projects/${p}/sites/${s}`,
  channel: (p, s, c) => `${API}/projects/${p}/sites/${s}/channels/${c}`,
  channelCreate: (p, s, c) => `${API}/projects/${p}/sites/${s}/channels?channelId=${encodeURIComponent(c)}`,
  releaseCreate: (p, s, c, versionName) => `${API}/projects/${p}/sites/${s}/channels/${c}/releases?versionName=${encodeURIComponent(versionName)}`,
  versionCreate: (p, s) => `${API}/projects/${p}/sites/${s}/versions`,
  version: (versionName) => `${API}/${versionName}`,
  versionPopulate: (versionName) => `${API}/${versionName}:populateFiles`,
  versionPatchStatus: (versionName) => `${API}/${versionName}?updateMask=status`,
  files: (versionName, pageToken) => `${API}/${versionName}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
}
const versionNameRe = (p, s) => new RegExp(`^projects/${p}/sites/${s}/versions/[A-Za-z0-9_-]+$`)

// ----------------------------------------------------------- build manifest
/** Every file under distDir as { path, size, sha256 } (raw bytes), sorted. Used by the CI build. */
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

// ------------------------------------------------------------------ guards
const hex16 = (v) => /^[0-9a-f]{16}$/.test(String(v ?? ''))
const scopesOf = (info) => String(info.scope ?? '').split(/\s+/).filter(Boolean)

export const GUARDS = {
  // ---- artifact and its provenance
  artifactPresent({ zipBytes }) {
    if (!zipBytes) throw new GuardError('ARTIFACT_MISSING', 'No artifact zip was provided (--artifact-zip).')
  },
  manifestPresent({ manifest }) {
    if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) throw new GuardError('MANIFEST_MISSING', 'No usable build manifest (build-manifest.json) in the artifact. Refusing to publish an unmanifested build.')
    if (manifest.schema !== 1) throw new GuardError('MANIFEST_SCHEMA', `Unsupported manifest schema ${manifest.schema}.`)
    if (manifestFilesSha(manifest.files) !== manifest.filesSha256) throw new GuardError('MANIFEST_SELF_HASH', 'The manifest does not match its own recorded hash.')
  },
  provRepository({ manifest, github }) {
    const ok = manifest.meta?.repository === PROVENANCE.REPOSITORY && github.repo?.full_name === PROVENANCE.REPOSITORY && github.run?.repository?.full_name === PROVENANCE.REPOSITORY
    if (!ok) throw new GuardError('PROV_WRONG_REPOSITORY', `The build does not come from ${PROVENANCE.REPOSITORY}.`)
  },
  provRepositoryId({ manifest, github }) {
    const id = PROVENANCE.REPOSITORY_ID
    const ok = String(manifest.meta?.repositoryId) === String(id) && github.repo?.id === id && github.run?.repository?.id === id && github.run?.head_repository?.id === id
    if (!ok) throw new GuardError('PROV_WRONG_REPOSITORY_ID', `The build does not come from the repository with immutable id ${id}.`)
  },
  provRef({ manifest, github }) {
    if (manifest.meta?.ref !== PROVENANCE.REF || github.run?.head_branch !== PROVENANCE.BRANCH) throw new GuardError('PROV_WRONG_REF', `The build was not made from ${PROVENANCE.REF}.`)
  },
  provEvent({ manifest, github }) {
    if (manifest.meta?.eventName !== PROVENANCE.EVENT || github.run?.event !== PROVENANCE.EVENT) throw new GuardError('PROV_NOT_PUSH', 'Only a push-to-main build is production-eligible (not a pull-request or manual run).')
  },
  provWorkflow({ manifest, github }) {
    const ok = manifest.meta?.workflowRef === PROVENANCE.WORKFLOW_REF && github.run?.path === PROVENANCE.WORKFLOW_PATH && github.run?.workflow_id === PROVENANCE.WORKFLOW_ID
    if (!ok) throw new GuardError('PROV_WRONG_WORKFLOW', `The build was not made by ${PROVENANCE.WORKFLOW_PATH} (workflow id ${PROVENANCE.WORKFLOW_ID}).`)
  },
  provRunSuccess({ github }) {
    if (github.run?.status !== 'completed' || github.run?.conclusion !== 'success') throw new GuardError('PROV_RUN_NOT_SUCCESSFUL', `The GitHub Actions run is ${github.run?.status}/${github.run?.conclusion}, not completed/success.`)
  },
  provCommit({ manifest, github }) {
    // GITHUB_SHA (the commit that triggered the run) must be what GitHub says the run built. It is NOT required to equal
    // GITHUB_WORKFLOW_SHA: the workflow file's revision may legitimately be older than a later application commit.
    const sha = manifest.meta?.sourceCommit
    const ok = /^[0-9a-f]{40}$/.test(String(sha)) && github.run?.head_sha === sha && String(manifest.meta?.runId) === String(github.run?.id)
    if (!ok) throw new GuardError('PROV_COMMIT_MISMATCH', "The manifest's source commit and run id do not match the GitHub run.")
  },
  provRunAttempt({ manifest, github }) {
    const a = String(manifest.meta?.runAttempt ?? '')
    if (!/^\d+$/.test(a) || a !== String(github.run?.run_attempt)) throw new GuardError('PROV_RUN_ATTEMPT_MISMATCH', `The manifest's run attempt (${a || 'missing'}) is not the run's actual attempt (${github.run?.run_attempt}).`)
  },
  provWorkflowSha({ manifest }) {
    if (!/^[0-9a-f]{40}$/.test(String(manifest.meta?.workflowSha))) throw new GuardError('PROV_WORKFLOW_SHA_INVALID', "The manifest's workflow SHA is not a full 40-character commit SHA.")
  },
  provWorkflowFile({ github }) {
    // The approved workflow file must be byte-identical (same Git blob) at the source commit AND at the workflow revision.
    for (const [label, file] of [['the source commit', github.workflowAtSource], ['the workflow revision', github.workflowAtWorkflowSha]]) {
      if (!file || file.type !== 'file' || file.path !== PROVENANCE.WORKFLOW_PATH) throw new GuardError('PROV_WORKFLOW_FILE_MISSING', `${PROVENANCE.WORKFLOW_PATH} does not exist at ${label}.`)
      if (file.sha !== PROVENANCE.WORKFLOW_BLOB_SHA) throw new GuardError('PROV_WORKFLOW_FILE_MODIFIED', `${PROVENANCE.WORKFLOW_PATH} at ${label} is not the reviewed workflow (blob ${String(file.sha).slice(0, 12)}, approved ${PROVENANCE.WORKFLOW_BLOB_SHA.slice(0, 12)}).`)
    }
  },
  provWorkflowRevision({ github }) {
    if (!['identical', 'ahead'].includes(github.workflowToSource?.status)) throw new GuardError('PROV_WORKFLOW_REVISION_INCONSISTENT', `The workflow revision is not the source commit or one of its ancestors (compare status "${github.workflowToSource?.status}").`)
  },
  provOnMain({ github }) {
    if (!['identical', 'ahead'].includes(github.compare?.status)) throw new GuardError('PROV_NOT_ON_MAIN', `The source commit is not part of main (compare status "${github.compare?.status}").`)
  },
  provArtifactIdentity({ manifest, github }) {
    const name = `${PROVENANCE.ARTIFACT_PREFIX}${manifest.meta?.sourceCommit}`
    const a = (github.artifacts ?? []).find((x) => x.name === name)
    if (!a || a.expired) throw new GuardError('PROV_ARTIFACT_MISSING', `GitHub has no unexpired artifact named ${name} for this run.`)
    const wr = a.workflow_run
    const id = PROVENANCE.REPOSITORY_ID
    const ok = wr && wr.id === github.run.id && wr.head_sha === manifest.meta.sourceCommit && wr.head_branch === PROVENANCE.BRANCH && wr.repository_id === id && wr.head_repository_id === id
    if (!ok) throw new GuardError('PROV_ARTIFACT_MISMATCH', `GitHub's record of the artifact does not say it came from this run, this source commit, branch main and repository ${id} (a missing value is a refusal).`)
  },
  provArtifactDigest({ manifest, github, zipSha256 }) {
    const name = `${PROVENANCE.ARTIFACT_PREFIX}${manifest.meta?.sourceCommit}`
    const a = (github.artifacts ?? []).find((x) => x.name === name)
    if (!a || a.digest !== `sha256:${zipSha256}`) throw new GuardError('PROV_DIGEST_MISMATCH', 'The zip you hold is not byte-identical to the artifact GitHub recorded (digest mismatch).')
  },
  artifactMatchesManifest({ manifest, distFiles, strayEntries }) {
    if (strayEntries.length) throw new GuardError('ARTIFACT_EXTRA_FILE', `${strayEntries.length} entr(ies) outside dist/ and build-manifest.json (e.g. ${strayEntries[0]}).`)
    const want = new Map(manifest.files.map((f) => [f.path, f]))
    const have = new Map(distFiles.map((f) => [f.path, f]))
    const missing = [...want.keys()].filter((p) => !have.has(p))
    if (missing.length) throw new GuardError('ARTIFACT_MISSING_FILE', `${missing.length} file(s) listed in the manifest are missing from the artifact (e.g. ${missing[0]}).`)
    const extra = [...have.keys()].filter((p) => !want.has(p))
    if (extra.length) throw new GuardError('ARTIFACT_EXTRA_FILE', `${extra.length} file(s) in the artifact are not in the manifest (e.g. ${extra[0]}).`)
    const changed = [...want].filter(([p, f]) => have.get(p).sha256 !== f.sha256 || have.get(p).size !== f.size)
    if (changed.length) throw new GuardError('ARTIFACT_MODIFIED_FILE', `${changed.length} file(s) differ from the manifest (e.g. ${changed[0][0]}).`)
  },
  // ---- target
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
    if (!hex16(opts.expectedLiveVersion)) throw new GuardError('EXPECTED_VERSION_REQUIRED', 'An expected live version id (16 hex characters) is required.')
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
  // ---- credentials
  noKeyAuth({ env }) {
    if (env.GOOGLE_APPLICATION_CREDENTIALS) throw new GuardError('KEY_AUTH_FORBIDDEN', 'GOOGLE_APPLICATION_CREDENTIALS is set. Key-file authentication is not permitted; unset it.')
  },
  tokenPresent({ token }) {
    if (!token) throw new GuardError('TOKEN_REQUIRED', 'The access token environment variable is not set. No other credential source is permitted.')
  },
  tokenIdentity({ info, policy }) {
    if (info.email !== policy.email) throw new GuardError('TOKEN_WRONG_IDENTITY', `The token belongs to "${info.email ?? 'unknown'}", not ${policy.email}.`)
  },
  tokenScopes({ info, policy }) {
    const scopes = scopesOf(info)
    if (!scopes.includes(policy.requiredScope)) throw new GuardError('TOKEN_SCOPE_MISSING', `The token lacks the required scope ${policy.requiredScope}.`)
    const extra = scopes.filter((s) => !policy.allowedScopes.includes(s))
    if (extra.length) throw new GuardError('TOKEN_SCOPE_TOO_BROAD', `The token carries scope(s) beyond the allowed set: ${extra.join(' ')}.`)
  },
  tokenExpiry({ info }) {
    const left = Number(info.expires_in)
    if (!Number.isFinite(left) || left <= 0) throw new GuardError('TOKEN_EXPIRED', 'The token is expired or its lifetime is unknown.')
    if (left > LIMITS.MAX_TOKEN_SECONDS) throw new GuardError('TOKEN_TOO_LONG_LIVED', `The token has ${left}s left; at most ${LIMITS.MAX_TOKEN_SECONDS}s is allowed.`)
    if (left < LIMITS.MIN_TOKEN_SECONDS) throw new GuardError('TOKEN_EXPIRING', `The token has only ${left}s left; at least ${LIMITS.MIN_TOKEN_SECONDS}s is needed.`)
  },
  // ---- live state
  previewChannelIsNew({ channelExists }) {
    if (channelExists) throw new GuardError('CHANNEL_EXISTS', 'The preview channel already exists. A preview channel is single-use and is never overwritten.')
  },
  testedVersionMatches({ opts, newMap, newConfig, tested }) {
    if (!hex16(opts.testedVersion)) throw new GuardError('TESTED_VERSION_REQUIRED', 'Live mode requires --tested-version: the preview version that was verified.')
    if (!tested || mapSha(newMap) !== mapSha(tested.files) || canonicalSha(newConfig) !== canonicalSha(tested.config)) {
      throw new GuardError('NOT_THE_TESTED_BUILD', `The version about to go live is not byte-identical to the tested preview version ${opts.testedVersion}.`)
    }
  },
  rollbackTarget({ opts, liveVersion, target }) {
    if (!hex16(opts.targetVersion)) throw new GuardError('TARGET_REQUIRED', 'Rollback requires --target-version (16 hex characters).')
    if (versionId(liveVersion) === opts.targetVersion) throw new GuardError('TARGET_IS_LIVE', 'The rollback target is already live.')
    if (!target || target.status !== 'FINALIZED') throw new GuardError('TARGET_NOT_FINALIZED', 'The rollback target does not exist or is not FINALIZED.')
  },
  versionNameCanonical({ name, project, site }) {
    if (!versionNameRe(project, site).test(String(name))) throw new GuardError('BAD_VERSION_NAME', `Hosting returned a version name that is not projects/${project}/sites/${site}/versions/<id>: "${name}".`)
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

// ------------------------------------------------------------- HTTP client
/**
 * `read` is GET only. `write` is the ONLY way to change anything and checks an allow-list; there is no DELETE.
 * `fetchImpl` is injectable so the whole publisher can be tested against a fake Hosting API.
 */
export function makeClient({ fetchImpl, token, project, site, mode, channel, readOnly }) {
  const state = { writes: 0, log: [] }
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
  async function read(urlOrName) {
    const url = urlOrName.startsWith('http') ? urlOrName : `${API}/${urlOrName}`
    state.log.push(`GET ${url.replace(API, '')}`)
    return parse(await fetchImpl(url, { method: 'GET', headers: headers() }), 'GET', url)
  }
  function allowed(method, url) {
    const rel = url.startsWith(API) ? url.slice(API.length) : null
    const base = `/projects/${project}/sites/${site}`
    if (mode === 'rollback') return method === 'POST' && rel !== null && rel.startsWith(`${base}/channels/live/releases?versionName=`)
    if (method === 'POST' && rel === `${base}/versions`) return true
    if (method === 'POST' && rel !== null && rel.startsWith(`${base}/versions/`) && rel.endsWith(':populateFiles')) return true
    if (method === 'POST' && url.startsWith(UPLOAD_PREFIX)) return true
    if (method === 'PATCH' && rel !== null && rel.startsWith(`${base}/versions/`) && rel.endsWith('?updateMask=status')) return true
    if (mode === 'preview' && method === 'POST' && rel === `${base}/channels?channelId=${encodeURIComponent(channel)}`) return true
    if (method === 'POST' && rel !== null && rel.startsWith(`${base}/channels/${channel}/releases?versionName=`)) return true
    return false
  }
  async function write(method, url, body, extraHeaders = {}) {
    if (readOnly) throw new GuardError('READ_ONLY', 'This run is read-only; a write was attempted and refused.')
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
  return { read, write, state }
}

export async function listFiles(client, versionName) {
  const files = new Map()
  let pageToken = ''
  do {
    const page = await client.read(routes.files(versionName, pageToken))
    for (const f of page.files ?? []) files.set(f.path, f.hash)
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return files
}

/** Verifies who the token belongs to, its exact scopes and its remaining lifetime, against a policy. Fails closed. */
export async function verifyToken({ fetchImpl, token, guards, policy }) {
  let res
  let info = {}
  try {
    res = await fetchImpl(TOKENINFO_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ access_token: token }).toString() })
    info = await res.json()
  } catch {
    throw new GuardError('TOKEN_UNVERIFIABLE', 'Could not verify the token with Google\'s tokeninfo endpoint.')
  }
  if (!res.ok) throw new GuardError('TOKEN_INVALID', `The token was rejected by Google's tokeninfo (${res.status}).`)
  guards.tokenIdentity({ info, policy })
  guards.tokenScopes({ info, policy })
  guards.tokenExpiry({ info })
  return { email: info.email, expiresIn: Number(info.expires_in), scopes: scopesOf(info) }
}

// -------------------------------------------------------------- provenance
/** Asks the PUBLIC GitHub API about the run, repository, commit and artifact the manifest claims. Any failure = refuse. */
export async function gatherProvenance({ manifest, githubFetch }) {
  const runId = String(manifest.meta?.runId ?? '')
  const sha = String(manifest.meta?.sourceCommit ?? '')
  if (!/^\d+$/.test(runId) || !/^[0-9a-f]{40}$/.test(sha)) throw new GuardError('PROV_UNVERIFIABLE', 'The manifest has no valid run id and 40-character source commit; provenance cannot be verified.')
  const repo = PROVENANCE.REPOSITORY
  const get = async (path, { missingOk = false } = {}) => {
    let res
    try {
      res = await githubFetch(`${GITHUB_API}${path}`, { method: 'GET', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
    } catch {
      throw new GuardError('PROV_UNVERIFIABLE', `GitHub could not be reached for ${path}; provenance cannot be independently verified.`)
    }
    if (missingOk && res.status === 404) return null
    if (!res.ok) throw new GuardError('PROV_UNVERIFIABLE', `GitHub answered ${res.status} for ${path}; provenance cannot be independently verified.`)
    try {
      return await res.json()
    } catch {
      throw new GuardError('PROV_UNVERIFIABLE', `GitHub returned unreadable data for ${path}.`)
    }
  }
  const wsha = String(manifest.meta?.workflowSha ?? '')
  const wf = /^[0-9a-f]{40}$/.test(wsha)
  const file = (ref) => get(`/repos/${repo}/contents/${PROVENANCE.WORKFLOW_PATH}?ref=${ref}`, { missingOk: true })
  const [repoInfo, run, artifacts, compare, workflowAtSource, workflowAtWorkflowSha, workflowToSource] = await Promise.all([
    get(`/repos/${repo}`),
    get(`/repos/${repo}/actions/runs/${runId}`),
    get(`/repos/${repo}/actions/runs/${runId}/artifacts`),
    get(`/repos/${repo}/compare/${sha}...${PROVENANCE.BRANCH}`),
    file(sha),
    wf ? file(wsha) : null,
    wf ? get(`/repos/${repo}/compare/${wsha}...${sha}`) : null
  ])
  return { repo: repoInfo, run, artifacts: artifacts.artifacts, compare, workflowAtSource, workflowAtWorkflowSha, workflowToSource }
}

export async function loadArtifact(opts, deps, guards) {
  let zipBytes = null
  if (opts.artifactZip && existsSync(opts.artifactZip)) zipBytes = readFileSync(opts.artifactZip)
  guards.artifactPresent({ zipBytes })
  const zipSha256 = sha256(zipBytes)
  let entries
  try {
    entries = readZip(zipBytes)
  } catch (e) {
    if (e instanceof ZipError) throw new GuardError('ZIP_INVALID', `The artifact zip is not acceptable: ${e.message}.`)
    throw e
  }
  const manifestBytes = entries.get('build-manifest.json')
  let manifest = null
  if (manifestBytes) {
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8'))
    } catch {
      manifest = null
    }
  }
  guards.manifestPresent({ manifest })
  const github = await gatherProvenance({ manifest, githubFetch: deps.githubFetch })
  for (const g of ['provRepository', 'provRepositoryId', 'provRef', 'provEvent', 'provWorkflow', 'provRunSuccess', 'provCommit', 'provRunAttempt', 'provWorkflowSha', 'provWorkflowFile', 'provWorkflowRevision', 'provOnMain', 'provArtifactIdentity', 'provArtifactDigest']) guards[g]({ manifest, github, zipSha256 })
  const distFiles = []
  const strayEntries = []
  for (const [name, bytes] of entries) {
    if (name === 'build-manifest.json') continue
    if (name.startsWith('dist/')) distFiles.push({ path: name.slice(5), size: bytes.length, sha256: sha256(bytes) })
    else strayEntries.push(name)
  }
  distFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  guards.artifactMatchesManifest({ manifest, distFiles, strayEntries })
  const qrLocal = new Map()
  for (const f of manifest.files) {
    if (f.path.endsWith('.map')) continue // source maps are never published
    const gz = gzipSync(entries.get(`dist/${f.path}`), { level: 9 })
    qrLocal.set(`${MOUNT}/${f.path}`, { gz, hash: sha256(gz) })
  }
  return { manifest, qrLocal, zipSha256, github }
}

// ----------------------------------------------------------------- planning
async function readLive(client, opts, guards) {
  const live = await client.read(routes.channel(opts.project, opts.site, 'live'))
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

export function makePlan({ opts, manifest, zipSha256, liveVersion, liveConfig, liveFiles, qrLocal }) {
  const { nonQr, newMap, newConfig, nonQrHeaders } = composeNew({ liveConfig, liveFiles, qrLocal })
  const liveQr = new Map([...liveFiles].filter(([p]) => isQrPath(p)))
  const added = [...qrLocal.keys()].filter((p) => !liveQr.has(p)).length
  const removed = [...liveQr.keys()].filter((p) => !qrLocal.has(p)).length
  const changed = [...qrLocal].filter(([p, f]) => liveQr.has(p) && liveQr.get(p) !== f.hash).length
  const nonQrConfig = { ...liveConfig, headers: nonQrHeaders }
  const liveQrHeaders = (liveConfig.headers ?? []).filter(isQrGlob)
  return {
    schema: 2,
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
      zipSha256,
      filesSha256: manifest.filesSha256,
      fileCount: manifest.fileCount,
      repository: manifest.meta.repository,
      repositoryId: String(manifest.meta.repositoryId),
      sourceCommit: manifest.meta.sourceCommit,
      workflowRef: manifest.meta.workflowRef,
      workflowSha: manifest.meta.workflowSha,
      workflowBlobSha: PROVENANCE.WORKFLOW_BLOB_SHA,
      runId: String(manifest.meta.runId),
      runAttempt: String(manifest.meta.runAttempt),
      buildId: manifest.meta.buildId ?? null
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

const clientFor = (opts, deps, readOnly, mode = opts.mode, channel = opts.channel) => makeClient({ fetchImpl: deps.fetchImpl, token: deps.token, project: opts.project, site: opts.site, mode, channel, readOnly })

/** Read-only: computes the plan and its SHA-256. Performs zero writes by construction (readOnly client). */
export async function planRun(opts, deps) {
  const guards = prepare(opts, deps)
  const token = await verifyToken({ fetchImpl: deps.fetchImpl, token: deps.token, guards, policy: WRITE_POLICY })
  const art = await loadArtifact(opts, deps, guards)
  const client = clientFor(opts, deps, true)
  const live = await readLive(client, opts, guards)
  const plan = makePlan({ opts, ...art, ...live })
  return { plan, planSha256: canonicalSha(plan), token, client }
}

/** Publishes. Every guard runs BEFORE the first write. */
export async function publishRun(opts, deps) {
  const guards = prepare(opts, deps)
  if (opts.mode === 'live') guards.livePhrase({ opts })
  const token = await verifyToken({ fetchImpl: deps.fetchImpl, token: deps.token, guards, policy: WRITE_POLICY })
  const art = await loadArtifact(opts, deps, guards)
  const { manifest, qrLocal } = art
  const client = clientFor(opts, deps, false)
  const live = await readLive(client, opts, guards)
  const plan = makePlan({ opts, ...art, ...live })
  guards.planApproved({ opts, plan })
  const { nonQr, newMap, newConfig } = composeNew({ ...live, qrLocal })

  if (opts.mode === 'preview') {
    let channelExists = true
    try {
      await client.read(routes.channel(opts.project, opts.site, opts.channel))
    } catch (e) {
      if (e.status === 404) channelExists = false
      else throw e
    }
    guards.previewChannelIsNew({ channelExists })
  } else {
    let tested = null
    if (hex16(opts.testedVersion)) {
      const testedName = `projects/${opts.project}/sites/${opts.site}/versions/${opts.testedVersion}`
      try {
        const v = await client.read(routes.version(testedName))
        tested = { config: v.config ?? {}, files: await listFiles(client, testedName) }
      } catch (e) {
        if (e.status !== 404) throw e
      }
    }
    guards.testedVersionMatches({ opts, newMap, newConfig, tested })
  }

  // ---- first write happens below this line
  const created = await client.write('POST', routes.versionCreate(opts.project, opts.site), { config: newConfig })
  const versionName = created.name
  guards.versionNameCanonical({ name: versionName, project: opts.project, site: opts.site })
  const populate = await client.write('POST', routes.versionPopulate(versionName), { files: Object.fromEntries(newMap) })
  if (populate.uploadUrl && !String(populate.uploadUrl).startsWith(UPLOAD_PREFIX)) throw new GuardError('UPLOAD_HOST', 'The server returned an unexpected upload host.')
  const byHash = new Map([...qrLocal.values()].map((f) => [f.hash, f.gz]))
  for (const hash of populate.uploadRequiredHashes ?? []) {
    const bytes = byHash.get(hash)
    if (!bytes) throw new GuardError('UNKNOWN_BLOB', `The server asked for blob ${hash.slice(0, 12)}…, which is not one of this app's files.`)
    await client.write('POST', `${populate.uploadUrl}/${hash}`, new Uint8Array(bytes), { 'Content-Type': 'application/octet-stream' })
  }
  await client.write('PATCH', routes.versionPatchStatus(versionName), { status: 'FINALIZED' })

  const newFiles = await listFiles(client, versionName)
  guards.postVerifyNonQrUnchanged({ nonQr, newFiles })
  guards.postVerifyQrComplete({ qrLocal, newFiles })
  const created2 = await client.read(routes.version(versionName))
  guards.postVerifyConfig({ expectedConfig: newConfig, newVersionConfig: created2.config })
  const liveNow = (await client.read(routes.channel(opts.project, opts.site, 'live'))).release?.version?.name
  guards.liveStillSame({ liveVersion: live.liveVersion, liveNow })

  if (opts.mode === 'preview') await client.write('POST', routes.channelCreate(opts.project, opts.site, opts.channel), { ttl: LIMITS.PREVIEW_TTL })
  const release = await client.write('POST', routes.releaseCreate(opts.project, opts.site, opts.channel, versionName), { message: `Smart QR Studio at ${MOUNT} (${manifest.meta.sourceCommit.slice(0, 12)})` })
  const channelInfo = await client.read(routes.channel(opts.project, opts.site, opts.channel))
  const toList = (m) => sortedMap(m).map(([path, hash]) => ({ path, hash }))
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
  const token = await verifyToken({ fetchImpl: deps.fetchImpl, token: deps.token, guards, policy: WRITE_POLICY })
  const client = clientFor(opts, deps, false, 'rollback', 'live')
  const live = (await client.read(routes.channel(opts.project, opts.site, 'live'))).release?.version?.name
  guards.expectedLiveVersion({ opts, liveVersion: live })
  let target = null
  if (hex16(opts.targetVersion)) {
    try {
      target = await client.read(routes.version(`projects/${opts.project}/sites/${opts.site}/versions/${opts.targetVersion}`))
    } catch (e) {
      if (e.status !== 404) throw e
    }
  }
  guards.rollbackTarget({ opts, liveVersion: live, target })
  const release = await client.write('POST', routes.releaseCreate(opts.project, opts.site, 'live', `projects/${opts.project}/sites/${opts.site}/versions/${opts.targetVersion}`), { message: `Rollback to ${opts.targetVersion}` })
  return { token, release: release.name, from: versionId(live), to: opts.targetVersion, writes: client.state.writes, log: client.state.log }
}
