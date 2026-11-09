// Tests for the QR publisher and audit against FAKE Hosting and GitHub APIs. No network, no credentials.
// Run: npm run test:publisher   (Node's built-in test runner)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  API, GUARDS, GuardError, LIMITS, PROVENANCE, QR_HEADER_RULES, READ_POLICY, WRITE_POLICY,
  canonicalSha, makeClient, manifestFilesSha, planRun, publishRun, rollbackRun, routes, sha256
} from '../lib/qrPublisher.mjs'
import { readZip, ZipError } from '../lib/zip.mjs'
import { runAudit } from '../lib/qrAudit.mjs'
import { goodTokenInfo, makeFakeHosting } from './fakeHosting.mjs'
import { makeFakeGitHub } from './fakeGitHub.mjs'
import { makeZip } from './zipTools.mjs'

const CLI = fileURLToPath(new URL('../deploy-qr-hosting.mjs', import.meta.url))
const AUDIT_CLI = fileURLToPath(new URL('../audit-qr-live.mjs', import.meta.url))
const DISCOVERY = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/hosting-discovery-subset.json', import.meta.url)), 'utf8'))
const NOOP = Object.fromEntries(Object.keys(GUARDS).map((k) => [k, () => {}]))
const PV = 'qr-pv-20261109-ab12cd34'
const SHA = 'a'.repeat(40)
const RUN = '42579403128'
const S = 'https://www.googleapis.com/auth/'
const tmpDirs = []
process.on('exit', () => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

// ----------------------------------------------------------------- fixtures
const DIST = { 'index.html': '<html>clean</html>', 'sw.js': 'self.skip=1', 'manifest.webmanifest': '{"scope":"/qr"}', 'assets/app.js': 'console.log("app")', 'assets/app.css': 'a{}' }

/** A GitHub-style artifact zip: dist/** plus build-manifest.json, with provenance metadata of a good push-to-main run. */
function makeArtifact() {
  const dir = mkdtempSync(join(tmpdir(), 'qr-art-'))
  tmpDirs.push(dir)
  const entries = new Map(Object.entries(DIST).map(([p, body]) => [`dist/${p}`, Buffer.from(body)]))
  const files = Object.entries(DIST).map(([p, body]) => ({ path: p, size: Buffer.byteLength(body), sha256: sha256(Buffer.from(body)) })).sort((a, b) => (a.path < b.path ? -1 : 1))
  const art = {
    dir,
    zipPath: join(dir, 'qr-release.zip'),
    entries,
    onSave: () => {},
    manifest: {
      schema: 1, fileCount: files.length, totalBytes: files.reduce((n, f) => n + f.size, 0), filesSha256: manifestFilesSha(files), files,
      meta: {
        repository: PROVENANCE.REPOSITORY, repositoryId: String(PROVENANCE.REPOSITORY_ID), sourceCommit: SHA, ref: PROVENANCE.REF, eventName: 'push',
        workflow: 'QR Build (CI only)', workflowRef: PROVENANCE.WORKFLOW_REF, workflowSha: SHA, runId: RUN, runAttempt: '1', buildId: `${RUN}-1-${SHA.slice(0, 12)}`
      }
    },
    save() {
      if (art.manifest) entries.set('build-manifest.json', Buffer.from(JSON.stringify(art.manifest)))
      writeFileSync(art.zipPath, makeZip([...entries]))
      art.onSave(sha256(readFileSync(art.zipPath)))
    }
  }
  art.save()
  return art
}
const makeGh = (art) => makeFakeGitHub({ sha: art.manifest?.meta?.sourceCommit ?? SHA, runId: RUN, zipSha256: sha256(readFileSync(art.zipPath)) })

/** A fresh world: fake Hosting (live = non-/qr files + an OLD /qr), a built artifact and a fake GitHub that vouches for it. */
function world() {
  const art = makeArtifact()
  const fake = makeFakeHosting({
    nonQrFiles: { '/index.html': 'h1', '/about.html': 'h2', '/learning/index.html': 'h3', '/hq/index.html': 'h4', '/coffee/index.html': 'h5', '/404.html': 'h6' },
    qrFiles: { '/qr/index.html': 'old1', '/qr/sw.js': 'old2', '/qr/assets/app-OLD.js': 'old3' },
    nonQrHeaders: [{ glob: '**', headers: { 'X-Frame-Options': 'SAMEORIGIN' } }, { glob: '/learning/sw.js', headers: { 'Service-Worker-Allowed': '/learning' } }]
  })
  const gh = makeGh(art)
  art.onSave = (zipSha) => { gh.state.artifacts[0].digest = `sha256:${zipSha}` }
  return { art, fake, gh }
}

const baseOpts = (w, over = {}) => ({ mode: 'preview', project: LIMITS.PROJECT, site: LIMITS.SITE, channel: PV, artifactZip: w.art.zipPath, expectedLiveVersion: w.fake.liveId, planSha256: undefined, confirm: undefined, testedVersion: undefined, targetVersion: undefined, ...over })
const deps = (w, over = {}) => ({ fetchImpl: w.fake.fetchImpl, githubFetch: w.gh.fetchImpl, token: 'test-token-not-real', env: {}, ...over })
/** Approved-plan hash for the CURRENT state, computed with every guard off against a clean GitHub (so any scenario can be planned). */
async function approve(w, over = {}) {
  const r = await planRun(baseOpts(w, over), { ...deps(w), githubFetch: makeGh(w.art).fetchImpl, guards: NOOP })
  return r.planSha256
}
async function expectRefused(promise, code) {
  await assert.rejects(promise, (e) => e instanceof GuardError && e.code === code, `expected GuardError ${code}`)
}
const info = (over) => ({ ...goodTokenInfo(), ...over })
const readInfo = (over) => ({ email: LIMITS.AUDIT_SA, scope: `${S}firebase.readonly ${S}userinfo.email`, expires_in: '800', ...over })

// ------------------------------------------------------------ guard scenarios
// prep(w): change the world before approval; ghPrep(w): change what GitHub says; afterSave(w): tamper with the saved zip.
// `mutate` declares what happens when that one guard is switched off (mutation test): WRITES = the run reaches Hosting
// writes, CRASH = fails some other way, BACKSTOP:CODE = a second guard still refuses, NONE = not a guard (no mutation).
const gh = (fn) => (w) => fn(w.gh.state)
const meta = (fn) => (w) => fn(w.art.manifest.meta)
const scenarios = [
  // ---- target
  { name: 'wrong project', guard: 'project', code: 'WRONG_PROJECT', over: { project: 'other-project' }, mutate: 'WRITES' },
  { name: 'wrong site', guard: 'site', code: 'WRONG_SITE', over: { site: 'another-site' }, mutate: 'WRITES' },
  { name: 'unknown mode', guard: 'mode', code: 'BAD_MODE', over: { mode: 'both' }, mutate: 'BACKSTOP:LIVE_TARGETS_PREVIEW' },
  { name: 'invalid preview channel name', guard: 'channel', code: 'BAD_PREVIEW_CHANNEL', over: { channel: 'qr-pv-bad' }, mutate: 'WRITES' },
  { name: 'preview attempting to target live', guard: 'channel', code: 'PREVIEW_TARGETS_LIVE', over: { channel: 'live' }, mutate: 'BACKSTOP:CHANNEL_EXISTS' },
  { name: 'old qr-preview channel (preview mode)', guard: 'channel', code: 'PROTECTED_CHANNEL', over: { channel: 'qr-preview' }, mutate: 'BACKSTOP:CHANNEL_EXISTS' },
  { name: 'live attempting to target a preview channel', guard: 'channel', code: 'LIVE_TARGETS_PREVIEW', over: { mode: 'live', channel: PV, confirm: LIMITS.LIVE_PHRASE, testedVersion: 'a'.repeat(16) }, mutate: 'BACKSTOP:NOT_THE_TESTED_BUILD' },
  { name: 'preview channel already exists', guard: 'previewChannelIsNew', code: 'CHANNEL_EXISTS', prep: (w) => w.fake.state.channels.set(PV, { name: `channels/${PV}`, url: 'x', version: undefined }), mutate: 'WRITES' },
  // ---- artifact integrity (the artifact is internally inconsistent but GitHub vouches for the zip it holds)
  { name: 'no artifact zip provided', guard: 'artifactPresent', code: 'ARTIFACT_MISSING', over: { artifactZip: join(tmpdir(), 'does-not-exist.zip') }, noApprove: true, mutate: 'CRASH' },
  { name: 'artifact without a build manifest', guard: 'manifestPresent', code: 'MANIFEST_MISSING', prep: (w) => { w.art.manifest = null; w.art.entries.delete('build-manifest.json') }, noApprove: true, mutate: 'CRASH' },
  { name: 'manifest that does not match its own hash', guard: 'manifestPresent', code: 'MANIFEST_SELF_HASH', prep: (w) => { w.art.manifest.filesSha256 = 'f'.repeat(64) }, mutate: 'WRITES' },
  { name: 'modified file', guard: 'artifactMatchesManifest', code: 'ARTIFACT_MODIFIED_FILE', prep: (w) => w.art.entries.set('dist/assets/app.js', Buffer.from('console.log("tampered")')), mutate: 'WRITES' },
  { name: 'missing file', guard: 'artifactMatchesManifest', code: 'ARTIFACT_MISSING_FILE', prep: (w) => w.art.entries.delete('dist/assets/app.css'), noApprove: true, mutate: 'CRASH' },
  { name: 'extra file in dist', guard: 'artifactMatchesManifest', code: 'ARTIFACT_EXTRA_FILE', prep: (w) => w.art.entries.set('dist/assets/extra.js', Buffer.from('x')), mutate: 'WRITES' },
  { name: 'extra entry outside dist/', guard: 'artifactMatchesManifest', code: 'ARTIFACT_EXTRA_FILE', prep: (w) => w.art.entries.set('evil.sh', Buffer.from('x')), mutate: 'WRITES' },
  { name: 'corrupt zip', code: 'ZIP_INVALID', afterSave: (w) => writeFileSync(w.art.zipPath, Buffer.from('this is not a zip file at all, just text')), noApprove: true, mutate: 'NONE' },
  // ---- provenance (checked against the public GitHub API, not just the artifact's own contents)
  { name: 'wrong repository (GitHub says another repo)', guard: 'provRepository', code: 'PROV_WRONG_REPOSITORY', ghPrep: gh((g) => { g.repo.full_name = 'evil/other'; g.run.repository.full_name = 'evil/other' }), mutate: 'WRITES' },
  { name: 'wrong repository (manifest claims another repo)', guard: 'provRepository', code: 'PROV_WRONG_REPOSITORY', prep: meta((m) => { m.repository = 'evil/other' }), mutate: 'WRITES' },
  { name: 'wrong immutable repository id', guard: 'provRepositoryId', code: 'PROV_WRONG_REPOSITORY_ID', ghPrep: gh((g) => { g.repo.id = 999; g.run.repository.id = 999; g.run.head_repository.id = 999 }), mutate: 'WRITES' },
  { name: 'wrong branch (run on a feature branch)', guard: 'provRef', code: 'PROV_WRONG_REF', ghPrep: gh((g) => { g.run.head_branch = 'feature/x' }), mutate: 'WRITES' },
  { name: 'wrong ref in the manifest', guard: 'provRef', code: 'PROV_WRONG_REF', prep: meta((m) => { m.ref = 'refs/heads/feature/x' }), mutate: 'WRITES' },
  { name: 'wrong workflow file', guard: 'provWorkflow', code: 'PROV_WRONG_WORKFLOW', ghPrep: gh((g) => { g.run.path = '.github/workflows/evil.yml' }), mutate: 'WRITES' },
  { name: 'wrong workflow id', guard: 'provWorkflow', code: 'PROV_WRONG_WORKFLOW', ghPrep: gh((g) => { g.run.workflow_id = 1 }), mutate: 'WRITES' },
  { name: 'wrong workflow identity in the manifest', guard: 'provWorkflow', code: 'PROV_WRONG_WORKFLOW', prep: meta((m) => { m.workflowRef = 'sanjug05/smart-qr-studio/.github/workflows/evil.yml@refs/heads/main' }), mutate: 'WRITES' },
  { name: 'pull-request build rejected for production', guard: 'provEvent', code: 'PROV_NOT_PUSH', ghPrep: gh((g) => { g.run.event = 'pull_request' }), mutate: 'WRITES' },
  { name: 'manual-run build rejected for production', guard: 'provEvent', code: 'PROV_NOT_PUSH', prep: meta((m) => { m.eventName = 'workflow_dispatch' }), mutate: 'WRITES' },
  { name: 'failed GitHub run rejected', guard: 'provRunSuccess', code: 'PROV_RUN_NOT_SUCCESSFUL', ghPrep: gh((g) => { g.run.conclusion = 'failure' }), mutate: 'WRITES' },
  { name: 'run still in progress rejected', guard: 'provRunSuccess', code: 'PROV_RUN_NOT_SUCCESSFUL', ghPrep: gh((g) => { g.run.status = 'in_progress'; g.run.conclusion = null }), mutate: 'WRITES' },
  { name: 'wrong source commit (run built another commit)', guard: 'provCommit', code: 'PROV_COMMIT_MISMATCH', ghPrep: gh((g) => { g.run.head_sha = 'b'.repeat(40) }), mutate: 'BACKSTOP:PROV_ARTIFACT_MISMATCH' },
  { name: 'wrong workflow SHA in the manifest', guard: 'provCommit', code: 'PROV_COMMIT_MISMATCH', prep: meta((m) => { m.workflowSha = 'c'.repeat(40) }), mutate: 'WRITES' },
  { name: 'source commit not on main', guard: 'provOnMain', code: 'PROV_NOT_ON_MAIN', ghPrep: gh((g) => { g.compare.status = 'diverged' }), mutate: 'WRITES' },
  { name: 'artifact expired or absent on GitHub', guard: 'provArtifactIdentity', code: 'PROV_ARTIFACT_MISSING', ghPrep: gh((g) => { g.artifacts[0].expired = true }), mutate: 'WRITES' },
  { name: 'artifact belongs to another run', guard: 'provArtifactIdentity', code: 'PROV_ARTIFACT_MISMATCH', ghPrep: gh((g) => { g.artifacts[0].workflow_run.id = 1 }), mutate: 'WRITES' },
  { name: 'wrong artifact digest', guard: 'provArtifactDigest', code: 'PROV_DIGEST_MISMATCH', ghPrep: gh((g) => { g.artifacts[0].digest = `sha256:${'0'.repeat(64)}` }), mutate: 'WRITES' },
  { name: 'GitHub unreachable: fail closed', code: 'PROV_UNVERIFIABLE', ghPrep: gh((g) => { g.fail = 'network' }), mutate: 'NONE' },
  { name: 'GitHub rate-limited: fail closed', code: 'PROV_UNVERIFIABLE', ghPrep: gh((g) => { g.fail = 'forbidden' }), mutate: 'NONE' },
  { name: 'GitHub returns garbage: fail closed', code: 'PROV_UNVERIFIABLE', ghPrep: gh((g) => { g.fail = 'garbage' }), mutate: 'NONE' },
  { name: 'manifest without a run id: fail closed', code: 'PROV_UNVERIFIABLE', prep: meta((m) => { delete m.runId }), noApprove: true, mutate: 'NONE' },
  { name: 'manifest with a short source commit: fail closed', code: 'PROV_UNVERIFIABLE', prep: meta((m) => { m.sourceCommit = 'abc123' }), noApprove: true, mutate: 'NONE' },
  // ---- live state and approval
  { name: 'wrong expected live version', guard: 'expectedLiveVersion', code: 'LIVE_VERSION_DRIFT', over: { expectedLiveVersion: '0123456789abcdef' }, approveWith: { expectedLiveVersion: '5840d3114ef43906' }, mutate: 'WRITES' },
  { name: 'unexpected Hosting configuration key', guard: 'configShape', code: 'UNEXPECTED_CONFIG', prep: (w) => { w.fake.state.versions.get(w.fake.liveId).config.i18n = { root: '/' } }, mutate: 'WRITES' },
  { name: 'wrong approval hash', guard: 'planApproved', code: 'PLAN_HASH_MISMATCH', hash: 'f'.repeat(64), mutate: 'WRITES' },
  { name: 'missing approval hash', guard: 'planApproved', code: 'PLAN_HASH_REQUIRED', hash: '', mutate: 'WRITES' },
  { name: 'non-QR file changed after approval', guard: 'planApproved', code: 'PLAN_HASH_MISMATCH', after: (w) => w.fake.state.versions.get(w.fake.liveId).files.set('/about.html', 'CHANGED'), mutate: 'WRITES' },
  { name: 'non-QR header changed after approval', guard: 'planApproved', code: 'PLAN_HASH_MISMATCH', after: (w) => { w.fake.state.versions.get(w.fake.liveId).config.headers[0].headers['X-Frame-Options'] = 'ALLOWALL' }, mutate: 'WRITES' },
  { name: 'non-QR file added after approval', guard: 'planApproved', code: 'PLAN_HASH_MISMATCH', after: (w) => w.fake.state.versions.get(w.fake.liveId).files.set('/new-page.html', 'NEW'), mutate: 'WRITES' },
  { name: 'live without the typed confirmation phrase', guard: 'livePhrase', code: 'CONFIRMATION_REQUIRED', over: { mode: 'live', channel: 'live', confirm: 'yes', testedVersion: 'a'.repeat(16) }, mutate: 'BACKSTOP:NOT_THE_TESTED_BUILD' },
  { name: 'live without a tested preview version', guard: 'testedVersionMatches', code: 'TESTED_VERSION_REQUIRED', over: { mode: 'live', channel: 'live', confirm: LIMITS.LIVE_PHRASE }, mutate: 'WRITES' },
  { name: 'live build differs from the tested preview', guard: 'testedVersionMatches', code: 'NOT_THE_TESTED_BUILD', over: { mode: 'live', channel: 'live', confirm: LIMITS.LIVE_PHRASE }, testedFrom: 'other', mutate: 'WRITES' },
  // ---- credentials, identity and scopes
  { name: 'wrong operator token identity', guard: 'tokenIdentity', code: 'TOKEN_WRONG_IDENTITY', tokenInfo: info({ email: 'sanju.gupta90@gmail.com' }), mutate: 'WRITES' },
  { name: 'a personal Owner token is not the publisher', guard: 'tokenIdentity', code: 'TOKEN_WRONG_IDENTITY', tokenInfo: info({ email: 'sanjumanager88@gmail.com' }), mutate: 'WRITES' },
  { name: 'expired token', guard: 'tokenExpiry', code: 'TOKEN_EXPIRED', tokenInfo: info({ expires_in: '0' }), mutate: 'WRITES' },
  { name: 'token that lives too long', guard: 'tokenExpiry', code: 'TOKEN_TOO_LONG_LIVED', tokenInfo: info({ expires_in: '3500' }), mutate: 'WRITES' },
  { name: 'token about to expire', guard: 'tokenExpiry', code: 'TOKEN_EXPIRING', tokenInfo: info({ expires_in: '30' }), mutate: 'WRITES' },
  { name: 'broad cloud-platform scope rejected', guard: 'tokenScopes', code: 'TOKEN_SCOPE_TOO_BROAD', tokenInfo: info({ scope: `${S}firebase ${S}cloud-platform` }), mutate: 'WRITES' },
  { name: 'cloud-platform alone rejected (missing the exact scope)', guard: 'tokenScopes', code: 'TOKEN_SCOPE_MISSING', tokenInfo: info({ scope: `${S}cloud-platform` }), mutate: 'WRITES' },
  { name: 'read-only scope cannot publish', guard: 'tokenScopes', code: 'TOKEN_SCOPE_MISSING', tokenInfo: info({ scope: `${S}firebase.readonly ${S}userinfo.email` }), mutate: 'WRITES' },
  { name: 'write scope plus read-only scope rejected', guard: 'tokenScopes', code: 'TOKEN_SCOPE_TOO_BROAD', tokenInfo: info({ scope: `${S}firebase ${S}firebase.readonly` }), mutate: 'WRITES' },
  { name: 'scope that Google\'s Hosting API does not declare (firebase.hosting) rejected', guard: 'tokenScopes', code: 'TOKEN_SCOPE_MISSING', tokenInfo: info({ scope: `${S}firebase.hosting ${S}userinfo.email` }), mutate: 'WRITES' },
  { name: 'no token (no credential fallback)', guard: 'tokenPresent', code: 'TOKEN_REQUIRED', token: '', mutate: 'WRITES' },
  { name: 'key-file credentials in the environment', guard: 'noKeyAuth', code: 'KEY_AUTH_FORBIDDEN', env: { GOOGLE_APPLICATION_CREDENTIALS: 'C:/keys/sa.json' }, mutate: 'WRITES' }
]

async function runScenario(s, guards) {
  const w = world()
  s.prep?.(w)
  w.art.save()
  s.afterSave?.(w)
  s.ghPrep?.(w)
  if (s.tokenInfo) w.fake.state.tokenInfo = s.tokenInfo
  const over = s.over ?? {}
  let hash = '0'.repeat(64)
  if (!s.noApprove) hash = await approve(w, { ...over, ...(s.approveWith ?? {}) })
  if (s.hash !== undefined) hash = s.hash
  s.after?.(w)
  let tested = over.testedVersion
  if (s.testedFrom === 'other') {
    w.fake.state.versions.set('b'.repeat(16), { name: `projects/ais-channel-os/sites/sanjugupta-web/versions/${'b'.repeat(16)}`, status: 'FINALIZED', config: {}, files: new Map([['/index.html', 'zzz']]) })
    tested = 'b'.repeat(16)
  }
  const opts = baseOpts(w, { ...over, testedVersion: tested, planSha256: hash || undefined })
  const d = deps(w, { ...(s.token !== undefined ? { token: s.token } : {}), ...(s.env ? { env: s.env } : {}), ...(guards ? { guards } : {}) })
  let outcome
  try {
    await publishRun(opts, d)
    outcome = { kind: 'PUBLISHED' }
  } catch (e) {
    outcome = { kind: e instanceof GuardError ? 'GUARD' : 'CRASH', code: e.code, message: e.message }
  }
  return { w, outcome, writes: w.fake.writes() }
}

describe('every refusal produces ZERO Hosting writes and a specific reason', () => {
  for (const s of scenarios) {
    test(s.name, async () => {
      const { outcome, writes, w } = await runScenario(s)
      assert.equal(outcome.kind, 'GUARD', `expected a guard refusal, got ${JSON.stringify(outcome)}`)
      assert.equal(outcome.code, s.code)
      assert.equal(writes, 0, 'a refused run must make no Hosting write')
      assert.equal(w.fake.liveVersion(), w.fake.liveId, 'live must be untouched')
      assert.ok(w.fake.state.channels.has('qr-preview'))
    })
  }
})

describe('mutation tests: switching a guard off changes the outcome (the guard is load-bearing)', () => {
  for (const s of scenarios.filter((x) => x.guard && x.mutate !== 'NONE')) {
    test(`${s.guard} off -> "${s.name}" no longer refused by it (${s.mutate})`, async () => {
      const guards = { ...GUARDS, [s.guard]: () => {} }
      const { outcome, writes } = await runScenario(s, guards)
      assert.notEqual(outcome.code, s.code, 'with the guard disabled the same refusal must NOT happen')
      if (s.mutate === 'WRITES') assert.ok(writes > 0 || outcome.kind === 'PUBLISHED', `expected the unguarded run to reach Hosting writes, got ${JSON.stringify(outcome)} writes=${writes}`)
      else if (s.mutate === 'CRASH') assert.equal(outcome.kind, 'CRASH', `expected a non-guard failure, got ${JSON.stringify(outcome)}`)
      else {
        assert.equal(outcome.kind, 'GUARD')
        assert.equal(outcome.code, s.mutate.split(':')[1], 'expected the declared backstop guard to catch it')
        assert.equal(writes, 0)
      }
    })
  }
})

// ---------------------------------------------------------------- happy paths
describe('successful releases', () => {
  test('plan-only is read-only and its hash is what publish checks; the plan names the provenance', async () => {
    const w = world()
    const plan = await planRun(baseOpts(w), deps(w))
    assert.equal(w.fake.writes(), 0)
    assert.equal(plan.plan.nonQrChanges, 0)
    assert.equal(plan.plan.qrHeaderRulesIdenticalToLive, true)
    assert.equal(plan.plan.qrChanges.removed, 1)
    assert.equal(plan.plan.artifact.runId, RUN)
    assert.equal(plan.plan.artifact.repositoryId, String(PROVENANCE.REPOSITORY_ID))
    assert.equal(plan.plan.artifact.sourceCommit, SHA)
    assert.equal(plan.plan.artifact.zipSha256, sha256(readFileSync(w.art.zipPath)))
    assert.equal(canonicalSha(plan.plan), plan.planSha256)
    assert.ok(w.gh.state.calls.every((c) => c.startsWith('GET ')), 'GitHub is only ever read')
  })

  test('the exact write sequence uses the canonical, documented routes (no aliases)', async () => {
    const w = world()
    const hash = (await planRun(baseOpts(w), deps(w))).planSha256
    await publishRun(baseOpts(w, { planSha256: hash }), deps(w))
    const P = `projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}`
    const norm = (x) => x.replace(/versions\/[0-9a-f]{16}/g, 'versions/<V>').replace(/versionName=[^&\s]+/, 'versionName=<V>').replace(/https:\/\/upload-firebasehosting\.googleapis\.com\/upload\/[^\s]*/, 'upload:<V>/files/<hash>')
    const writes = w.fake.state.writes.map((x) => norm(x.replace(`${API}/`, '')))
    const expected = [
      `POST ${P}/versions`,
      `POST ${P}/versions/<V>:populateFiles`,
      ...writes.filter((x) => x.includes('upload:')).map(() => 'POST upload:<V>/files/<hash>'),
      `PATCH ${P}/versions/<V>?updateMask=status`,
      `POST ${P}/channels?channelId=${PV}`,
      `POST ${P}/channels/${PV}/releases?versionName=<V>`
    ]
    assert.deepEqual(writes, expected)
    assert.ok(writes.some((x) => x.includes('upload:')), 'at least one new blob is uploaded')
  })

  test('every request made is a documented Hosting method, with documented query parameters, accepted by the scope in use', async () => {
    const w = world()
    const hash = (await planRun(baseOpts(w), deps(w))).planSha256
    await publishRun(baseOpts(w, { planSha256: hash }), deps(w))
    const templ = Object.entries(DISCOVERY.methods).map(([id, m]) => ({ id, m, re: new RegExp(`^${m.flatPath.replace(/[.+*?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/:?]+')}$`) }))
    const hosting = w.fake.state.calls.filter((c) => c.split(' ')[1].startsWith('https://firebasehosting.googleapis.com/'))
    assert.ok(hosting.length > 10)
    const used = new Set()
    for (const call of hosting) {
      const [method, url] = call.split(' ')
      const [path, query = ''] = url.replace('https://firebasehosting.googleapis.com/', '').split('?')
      const hit = templ.find((t) => t.m.httpMethod === method && t.re.test(path))
      assert.ok(hit, `no documented Hosting method for ${call}`)
      used.add(hit.id)
      for (const q of new URLSearchParams(query).keys()) assert.ok(hit.m.queryParameters.includes(q), `${call}: "${q}" is not a documented query parameter of ${hit.id} (${hit.m.queryParameters.join(', ')})`)
      assert.ok(hit.m.scopes.includes(WRITE_POLICY.requiredScope), `${hit.id} does not accept the publisher scope`)
    }
    for (const id of ['projects.sites.channels.get', 'projects.sites.versions.create', 'projects.sites.versions.populateFiles', 'projects.sites.versions.patch', 'projects.sites.versions.files.list', 'projects.sites.versions.get', 'projects.sites.channels.create', 'projects.sites.channels.releases.create']) assert.ok(used.has(id), `${id} was not exercised`)
  })

  test('Google declares exactly these OAuth scopes: ours are among them and the broader or invented ones are not used', () => {
    assert.ok(DISCOVERY.declaredScopes.includes(WRITE_POLICY.requiredScope))
    assert.ok(DISCOVERY.declaredScopes.includes(READ_POLICY.requiredScope))
    assert.equal(WRITE_POLICY.requiredScope, `${S}firebase`)
    assert.equal(READ_POLICY.requiredScope, `${S}firebase.readonly`)
    for (const invented of [`${S}firebase.hosting`, `${S}firebase.hosting.readonly`]) assert.ok(!DISCOVERY.declaredScopes.includes(invented), `${invented} would be useless: the Hosting API does not declare it`)
    for (const p of [WRITE_POLICY, READ_POLICY]) assert.ok(!p.allowedScopes.includes(`${S}cloud-platform`) && !p.allowedScopes.includes(`${S}cloud-platform.read-only`))
    // read methods used by the audit accept the read-only scope; write methods do not
    for (const [id, m] of Object.entries(DISCOVERY.methods)) {
      const isRead = m.httpMethod === 'GET'
      assert.equal(m.scopes.includes(READ_POLICY.requiredScope), isRead, `${id}: read-only scope acceptance`)
      assert.ok(m.scopes.includes(WRITE_POLICY.requiredScope), `${id}: write scope acceptance`)
    }
  })

  test('the route builders produce the project-qualified paths of the discovery document', () => {
    const P = `${API}/projects/ais-channel-os/sites/sanjugupta-web`
    assert.equal(routes.site('ais-channel-os', 'sanjugupta-web'), P)
    assert.equal(routes.channel('ais-channel-os', 'sanjugupta-web', 'live'), `${P}/channels/live`)
    assert.equal(routes.channelCreate('ais-channel-os', 'sanjugupta-web', PV), `${P}/channels?channelId=${PV}`)
    assert.equal(routes.versionCreate('ais-channel-os', 'sanjugupta-web'), `${P}/versions`)
    assert.equal(routes.versionPatchStatus('projects/p/sites/s/versions/v'), `${API}/projects/p/sites/s/versions/v?updateMask=status`)
    assert.equal(routes.versionPopulate('projects/p/sites/s/versions/v'), `${API}/projects/p/sites/s/versions/v:populateFiles`)
    assert.equal(routes.files('projects/p/sites/s/versions/v', 'tok'), `${API}/projects/p/sites/s/versions/v/files?pageSize=1000&pageToken=tok`)
    assert.equal(routes.releaseCreate('p', 's', 'live', 'projects/p/sites/s/versions/v'), `${API}/projects/p/sites/s/channels/live/releases?versionName=projects%2Fp%2Fsites%2Fs%2Fversions%2Fv`)
  })

  test('undocumented aliases are not on the write allow-list (sites/ shorthand, update_mask)', async () => {
    const w = world()
    const rw = makeClient({ fetchImpl: w.fake.fetchImpl, token: 't', project: LIMITS.PROJECT, site: LIMITS.SITE, mode: 'preview', channel: PV, readOnly: false })
    const P = `${API}/projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}`
    await expectRefused(rw.write('POST', `${API}/sites/${LIMITS.SITE}/versions`, {}), 'WRITE_NOT_ALLOWED')
    await expectRefused(rw.write('PATCH', `${P}/versions/0123456789abcdef?update_mask=status`, {}), 'WRITE_NOT_ALLOWED')
    await expectRefused(rw.write('PATCH', `${P}/versions/0123456789abcdef?updateMask=status,config`, {}), 'WRITE_NOT_ALLOWED')
    await expectRefused(rw.write('POST', `${API}/sites/${LIMITS.SITE}/channels?channelId=${PV}`, {}), 'WRITE_NOT_ALLOWED')
    assert.equal(w.fake.writes(), 0)
  })

  test('a version name that is not the canonical project-qualified form stops the run before anything is released', async () => {
    const w = world()
    const hash = (await planRun(baseOpts(w), deps(w))).planSha256
    const real = w.fake.fetchImpl
    const aliasing = async (url, init = {}) => {
      const res = await real(url, init)
      if (init.method === 'POST' && url.endsWith('/versions')) {
        const body = await res.json()
        return { ok: true, status: 200, text: async () => JSON.stringify({ name: body.name.replace('projects/ais-channel-os/', '') }), json: async () => ({ name: body.name.replace('projects/ais-channel-os/', '') }) }
      }
      return res
    }
    await expectRefused(publishRun(baseOpts(w, { planSha256: hash }), deps(w, { fetchImpl: aliasing })), 'BAD_VERSION_NAME')
    assert.equal(w.fake.writes(), 1, 'only the version creation happened')
    assert.equal(w.fake.releasesTo(PV), 0)
  })

  test('a read-only client refuses every write, and DELETE / other sites / protected channels are never allowed', async () => {
    const w = world()
    const B = `${API}/projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}`
    const ro = makeClient({ fetchImpl: w.fake.fetchImpl, token: 't', project: LIMITS.PROJECT, site: LIMITS.SITE, mode: 'preview', channel: PV, readOnly: true })
    await expectRefused(ro.write('POST', `${B}/versions`, {}), 'READ_ONLY')
    const rw = makeClient({ fetchImpl: w.fake.fetchImpl, token: 't', project: LIMITS.PROJECT, site: LIMITS.SITE, mode: 'preview', channel: PV, readOnly: false })
    for (const [m, u] of [
      ['DELETE', `${B}/channels/${PV}`], ['DELETE', `${B}/versions/abc`], ['POST', `${API}/projects/${LIMITS.PROJECT}/sites`], ['PATCH', B],
      ['POST', `${API}/projects/${LIMITS.PROJECT}/sites/other-site/versions`], ['POST', `${API}/projects/other/sites/${LIMITS.SITE}/versions`],
      ['POST', `${B}/channels?channelId=qr-preview`], ['POST', `${B}/channels/qr-preview/releases?versionName=x`]
    ]) await expectRefused(rw.write(m, u, {}), 'WRITE_NOT_ALLOWED')
    assert.equal(w.fake.writes(), 0)
  })

  test('preview: new single-use channel, live untouched, nothing outside /qr changes', async () => {
    const w = world()
    const hash = (await planRun(baseOpts(w), deps(w))).planSha256
    const r = await publishRun(baseOpts(w, { planSha256: hash }), deps(w))
    assert.equal(w.fake.liveVersion(), w.fake.liveId, 'live must not change during a preview')
    assert.ok(w.fake.state.channels.has(PV))
    assert.equal(w.fake.state.channels.get('qr-preview').version, 'e9c6bded91a2d537', 'old qr-preview is untouched')
    assert.equal(w.fake.releasesTo('live'), 0)
    assert.equal(w.fake.releasesTo('qr-preview'), 0)
    assert.ok(!w.fake.state.writes.some((x) => x.startsWith('DELETE')))
    const live = w.fake.state.versions.get(w.fake.liveId)
    const fresh = w.fake.state.versions.get(r.versionName.split('/').pop())
    for (const [p, h] of live.files) if (!p.startsWith('/qr/')) assert.equal(fresh.files.get(p), h, `${p} must be unchanged`)
    assert.equal([...fresh.files.keys()].filter((p) => p.startsWith('/qr/')).length, 5)
    assert.ok(![...fresh.files.keys()].includes('/qr/assets/app-OLD.js'))
    assert.deepEqual(fresh.config.headers.filter((h) => !h.glob.startsWith('/qr')), live.config.headers.filter((h) => !h.glob.startsWith('/qr')))
    assert.deepEqual(fresh.config.redirects, live.config.redirects)
    assert.deepEqual(fresh.config.rewrites, live.config.rewrites)
    assert.deepEqual(fresh.config.headers.filter((h) => h.glob.startsWith('/qr')), JSON.parse(JSON.stringify(QR_HEADER_RULES)))
  })

  test('live: needs the tested preview, the typed phrase and the approved hash; releases once; previous version stays for rollback', async () => {
    const w = world()
    const pvHash = (await planRun(baseOpts(w), deps(w))).planSha256
    const pv = await publishRun(baseOpts(w, { planSha256: pvHash }), deps(w))
    const liveOpts = baseOpts(w, { mode: 'live', channel: 'live', confirm: LIMITS.LIVE_PHRASE, testedVersion: pv.versionName.split('/').pop() })
    const liveHash = (await planRun(liveOpts, deps(w))).planSha256
    assert.notEqual(liveHash, pvHash)
    const r = await publishRun({ ...liveOpts, planSha256: liveHash }, deps(w))
    assert.equal(w.fake.releasesTo('live'), 1)
    assert.equal(w.fake.liveVersion(), r.versionName.split('/').pop())
    assert.ok(w.fake.state.versions.get(w.fake.liveId), 'the previous live version still exists')
    assert.equal(r.previousLive, w.fake.liveId)
    assert.ok(!w.fake.state.writes.some((x) => x.startsWith('DELETE')))
  })

  test('list pagination: the fake serves 4 files per page and the publisher reads them all', async () => {
    const w = world()
    const r = await planRun(baseOpts(w), deps(w))
    assert.equal(r.plan.liveFileCount, 9)
    assert.ok(w.fake.state.calls.filter((c) => c.includes('/files?')).length >= 3)
  })
})

describe('post-write verification stops before release', () => {
  const run = async (hook) => {
    const w = world()
    const hash = await approve(w)
    hook(w)
    return { w, p: publishRun(baseOpts(w, { planSha256: hash }), deps(w)) }
  }
  test('a non-/qr file missing from the new version -> no release', async () => {
    const { w, p } = await run((x) => { x.fake.state.hooks.afterFinalize = (v) => v.files.delete('/learning/index.html') })
    await expectRefused(p, 'NON_QR_CHANGED')
    assert.equal(w.fake.releasesTo(PV), 0)
  })
  test('a /qr file missing from the new version -> no release', async () => {
    const { w, p } = await run((x) => { x.fake.state.hooks.afterFinalize = (v) => v.files.delete('/qr/index.html') })
    await expectRefused(p, 'QR_INCOMPLETE')
    assert.equal(w.fake.releasesTo(PV), 0)
  })
  test('configuration changed in the new version -> no release', async () => {
    const { w, p } = await run((x) => { x.fake.state.hooks.afterFinalize = (v) => { v.config.cleanUrls = false } })
    await expectRefused(p, 'CONFIG_CHANGED')
    assert.equal(w.fake.releasesTo(PV), 0)
  })
  test('live changed while publishing -> no release', async () => {
    const { w, p } = await run((x) => {
      x.fake.state.hooks.afterFinalize = () => {
        x.fake.state.versions.set('c'.repeat(16), { name: `projects/ais-channel-os/sites/sanjugupta-web/versions/${'c'.repeat(16)}`, status: 'FINALIZED', config: {}, files: new Map() })
        x.fake.state.channels.get('live').version = 'c'.repeat(16)
      }
    })
    await expectRefused(p, 'LIVE_CHANGED_DURING_RUN')
    assert.equal(w.fake.releasesTo(PV), 0)
  })
})

describe('rollback to the exact known previous live version', () => {
  async function liveWorld() {
    const w = world()
    const pvHash = (await planRun(baseOpts(w), deps(w))).planSha256
    const pv = await publishRun(baseOpts(w, { planSha256: pvHash }), deps(w))
    const lo = baseOpts(w, { mode: 'live', channel: 'live', confirm: LIMITS.LIVE_PHRASE, testedVersion: pv.versionName.split('/').pop() })
    const lh = (await planRun(lo, deps(w))).planSha256
    const r = await publishRun({ ...lo, planSha256: lh }, deps(w))
    w.fake.state.writes.length = 0
    return { w, newLive: r.versionName.split('/').pop(), previous: w.fake.liveId }
  }
  const ro = (newLive, previous, over = {}) => ({ mode: 'rollback', project: LIMITS.PROJECT, site: LIMITS.SITE, channel: 'live', expectedLiveVersion: newLive, targetVersion: previous, confirm: `ROLLBACK-QR-TO-${previous}`, ...over })

  test('re-releases exactly the previous version with exactly one write, on the canonical route', async () => {
    const { w, newLive, previous } = await liveWorld()
    const r = await rollbackRun(ro(newLive, previous), deps(w))
    assert.equal(r.writes, 1)
    assert.equal(w.fake.liveVersion(), previous)
    assert.equal(w.fake.state.writes[0], `POST ${API}/projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}/channels/live/releases?versionName=${encodeURIComponent(`projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}/versions/${previous}`)}`)
  })
  test('wrong phrase, wrong expected version, unknown target, target already live, wrong project: zero writes', async () => {
    const { w, newLive, previous } = await liveWorld()
    await expectRefused(rollbackRun(ro(newLive, previous, { confirm: 'ROLLBACK' }), deps(w)), 'CONFIRMATION_REQUIRED')
    await expectRefused(rollbackRun(ro(newLive, previous, { expectedLiveVersion: previous }), deps(w)), 'LIVE_VERSION_DRIFT')
    await expectRefused(rollbackRun(ro(newLive, '1111111111111111'), deps(w)), 'TARGET_NOT_FINALIZED')
    await expectRefused(rollbackRun(ro(newLive, newLive), deps(w)), 'TARGET_IS_LIVE')
    await expectRefused(rollbackRun(ro(newLive, previous, { project: 'x' }), deps(w)), 'WRONG_PROJECT')
    assert.equal(w.fake.writes(), 0)
    assert.equal(w.fake.liveVersion(), newLive)
  })
  test('a wrong token identity, a read-only scope or a broad scope cannot roll back', async () => {
    const { w, newLive, previous } = await liveWorld()
    for (const [ti, code] of [[info({ email: 'someone@example.com' }), 'TOKEN_WRONG_IDENTITY'], [info({ scope: `${S}firebase.readonly` }), 'TOKEN_SCOPE_MISSING'], [info({ scope: `${S}firebase ${S}cloud-platform` }), 'TOKEN_SCOPE_TOO_BROAD']]) {
      w.fake.state.tokenInfo = ti
      await expectRefused(rollbackRun(ro(newLive, previous), deps(w)), code)
    }
    assert.equal(w.fake.writes(), 0)
  })
})

describe('zip reader', () => {
  const entries = [['dist/a.txt', 'hello'], ['dist/b.bin', Buffer.alloc(5000, 7)], ['build-manifest.json', '{}']]
  test('reads stored and deflate entries and verifies CRC', () => {
    const m = readZip(makeZip(entries, { deflate: ['dist/b.bin'] }))
    assert.equal(m.get('dist/a.txt').toString(), 'hello')
    assert.equal(m.get('dist/b.bin').length, 5000)
  })
  test('refuses unsafe or malformed archives', () => {
    for (const bad of ['../evil', '/abs', 'C:/x', 'dist\\x', 'dist/../x', 'dist/./x']) assert.throws(() => readZip(makeZip([[bad, 'x']])), ZipError, bad)
    assert.throws(() => readZip(makeZip([['a', 'x'], ['a', 'y']])), /duplicate/)
    const z = makeZip([['a.txt', 'hello world']])
    z[z.indexOf(Buffer.from('hello world'))] ^= 0xff
    assert.throws(() => readZip(z), /CRC/)
    assert.throws(() => readZip(Buffer.from('nope')), ZipError)
    assert.throws(() => readZip(makeZip([['a', 'x']]).subarray(0, 30)), ZipError)
  })
})

describe('read-only audit: dedicated identity, exact scope, GET only', () => {
  function auditWorld() {
    const w = world()
    const live = w.fake.state.versions.get(w.fake.liveId)
    const receipt = { kind: 'LIVE_RELEASE', timestampUtc: 'x', newVersion: w.fake.liveId, sourceCommit: SHA, after: { files: [...live.files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, hash]) => ({ path, hash })), configSha256: canonicalSha(live.config) } }
    w.fake.state.tokenInfo = readInfo()
    return { w, receipt }
  }
  const audit = (w, receipt, over = {}) => runAudit({ receipt, fetchImpl: w.fake.fetchImpl, token: 'test-token-not-real', ...over })

  test('passes when live matches the receipt, makes only GET requests and never writes', async () => {
    const { w, receipt } = auditWorld()
    const r = await audit(w, receipt)
    assert.equal(r.pass, true)
    assert.equal(r.token.email, LIMITS.AUDIT_SA)
    assert.equal(w.fake.writes(), 0)
    assert.ok(r.calls.every((c) => c.startsWith('GET ')))
    assert.ok(w.fake.state.calls.every((c) => c.startsWith('GET ') || c.startsWith('POST https://oauth2.googleapis.com/tokeninfo')))
  })
  test('reports differences and flags anything outside /qr', async () => {
    const { w, receipt } = auditWorld()
    w.fake.state.versions.get(w.fake.liveId).files.set('/about.html', 'CHANGED')
    w.fake.state.versions.get(w.fake.liveId).files.set('/qr/extra.js', 'x')
    const r = await audit(w, receipt)
    assert.equal(r.pass, false)
    assert.equal(r.outsideQr, 1)
    assert.deepEqual(r.diffs.map((d) => d[0]).sort(), ['ADDED', 'CHANGED'])
  })
  const refusals = [
    ['an Owner or personal token', readInfo({ email: 'sanjumanager88@gmail.com' }), 'TOKEN_WRONG_IDENTITY'],
    ['the publisher identity (a write identity)', readInfo({ email: LIMITS.PUBLISHER_SA }), 'TOKEN_WRONG_IDENTITY'],
    ['a write scope (firebase)', readInfo({ scope: `${S}firebase ${S}userinfo.email` }), 'TOKEN_SCOPE_MISSING'],
    ['read-only scope plus a write scope', readInfo({ scope: `${S}firebase.readonly ${S}firebase` }), 'TOKEN_SCOPE_TOO_BROAD'],
    ['cloud-platform.read-only (broader than needed)', readInfo({ scope: `${S}firebase.readonly ${S}cloud-platform.read-only` }), 'TOKEN_SCOPE_TOO_BROAD'],
    ['cloud-platform', readInfo({ scope: `${S}firebase.readonly ${S}cloud-platform` }), 'TOKEN_SCOPE_TOO_BROAD'],
    ['the invented firebase.hosting.readonly scope', readInfo({ scope: `${S}firebase.hosting.readonly` }), 'TOKEN_SCOPE_MISSING'],
    ['an expired token', readInfo({ expires_in: '0' }), 'TOKEN_EXPIRED'],
    ['a token that lives too long', readInfo({ expires_in: '3600' }), 'TOKEN_TOO_LONG_LIVED'],
    ['a token about to expire', readInfo({ expires_in: '10' }), 'TOKEN_EXPIRING']
  ]
  for (const [name, ti, code] of refusals) {
    test(`refuses ${name}`, async () => {
      const { w, receipt } = auditWorld()
      w.fake.state.tokenInfo = ti
      await expectRefused(audit(w, receipt), code)
      assert.equal(w.fake.state.calls.filter((c) => c.includes('firebasehosting')).length, 0, 'no Hosting request is made with a refused token')
    })
  }
  test('refuses a token Google rejects, and a missing token', async () => {
    const { w, receipt } = auditWorld()
    w.fake.state.tokenInfo = { __reject: true }
    await expectRefused(audit(w, receipt), 'TOKEN_INVALID')
    await expectRefused(audit(w, receipt, { token: '' }), 'TOKEN_REQUIRED')
  })
  test('each audit guard is load-bearing', async () => {
    for (const [name, ti, code] of refusals) {
      const guardOf = { TOKEN_WRONG_IDENTITY: 'tokenIdentity', TOKEN_SCOPE_MISSING: 'tokenScopes', TOKEN_SCOPE_TOO_BROAD: 'tokenScopes', TOKEN_EXPIRED: 'tokenExpiry', TOKEN_TOO_LONG_LIVED: 'tokenExpiry', TOKEN_EXPIRING: 'tokenExpiry' }[code]
      const { w, receipt } = auditWorld()
      w.fake.state.tokenInfo = ti
      const r = await audit(w, receipt, { guards: { ...GUARDS, [guardOf]: () => {} } }).catch((e) => e)
      assert.ok(!(r instanceof GuardError && r.code === code), `${name}: refused even with ${guardOf} disabled`)
    }
  })
})

describe('command line', () => {
  const run = (cli, args, env = {}) => {
    const e = { ...process.env }
    for (const k of ['QR_PUBLISHER_TOKEN', 'QR_AUDIT_TOKEN', 'QR_READ_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS']) delete e[k]
    return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...e, ...env } })
  }
  test('publisher has no option for tokens, key files, the Firebase CLI or a loose dist folder', () => {
    for (const flag of ['--token', '--key-file', '--credentials', '--use-firebase-cli', '--dist', '--manifest']) {
      const r = run(CLI, ['--mode', 'preview', flag, 'x'])
      assert.notEqual(r.status, 0)
      assert.match(r.stderr, /Unknown option/)
    }
  })
  test('publisher refuses without a token and never falls back to another credential', () => {
    const r = run(CLI, ['--mode', 'preview', '--channel', PV, '--expected-live-version', '5840d3114ef43906', '--plan-only'])
    assert.equal(r.status, 3)
    assert.match(r.stderr, /TOKEN_REQUIRED/)
  })
  test('publisher refuses key-file authentication', () => {
    const r = run(CLI, ['--mode', 'preview', '--channel', PV, '--expected-live-version', '5840d3114ef43906', '--plan-only'], { GOOGLE_APPLICATION_CREDENTIALS: 'x.json', QR_PUBLISHER_TOKEN: 'abc' })
    assert.equal(r.status, 3)
    assert.match(r.stderr, /KEY_AUTH_FORBIDDEN/)
  })
  test('publisher refuses a missing explicit mode', () => {
    const r = run(CLI, ['--channel', PV, '--plan-only'], { QR_PUBLISHER_TOKEN: 'abc' })
    assert.equal(r.status, 3)
    assert.match(r.stderr, /BAD_MODE/)
  })
  test('audit refuses without its token and ignores the old broad-token variable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qr-aud-'))
    tmpDirs.push(dir)
    writeFileSync(join(dir, 'r.json'), JSON.stringify({ after: { files: [], configSha256: 'x' } }))
    for (const env of [{}, { QR_READ_TOKEN: 'owner-token-should-be-ignored' }]) {
      const r = run(AUDIT_CLI, ['--receipt', join(dir, 'r.json')], env)
      assert.equal(r.status, 1)
      assert.match(r.stderr, /TOKEN_REQUIRED/)
      assert.ok(!r.stdout.includes('owner-token') && !r.stderr.includes('owner-token'))
    }
  })
  test('the sources never log the token and have no child-process, Firebase CLI or DELETE call', () => {
    const read = (u) => readFileSync(fileURLToPath(new URL(u, import.meta.url)), 'utf8')
    const all = ['../lib/qrPublisher.mjs', '../lib/qrAudit.mjs', '../lib/zip.mjs', '../deploy-qr-hosting.mjs', '../audit-qr-live.mjs'].map(read).join('\n')
    assert.ok(!/console\.\w+\(\s*(deps\.)?token\b/.test(all), 'no console call may print the token')
    const interpolations = all.split('\n').filter((l) => /\$\{(deps\.)?token\}/.test(l))
    assert.ok(interpolations.every((l) => l.includes('Authorization')), 'the token may only be interpolated into the Authorization header')
    assert.ok(!/child_process|firebase-tools|execSync|spawn\(/.test(all), 'no shelling out and no Firebase CLI')
    assert.ok(!/method:\s*'DELETE'|write\('DELETE'/.test(all), 'no DELETE request is ever built')
  })
})
