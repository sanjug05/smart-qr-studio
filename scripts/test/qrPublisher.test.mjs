// Tests for the QR publisher against a FAKE Hosting API. No network, no credentials.
// Run: npm run test:publisher   (Node's built-in test runner)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { GUARDS, GuardError, LIMITS, QR_HEADER_RULES, buildManifest, canonicalSha, makeClient, planRun, publishRun, rollbackRun } from '../lib/qrPublisher.mjs'
import { goodTokenInfo, makeFakeHosting } from './fakeHosting.mjs'

const CLI = fileURLToPath(new URL('../deploy-qr-hosting.mjs', import.meta.url))
const NOOP = Object.fromEntries(Object.keys(GUARDS).map((k) => [k, () => {}]))
const PV = 'qr-pv-20261109-ab12cd34'
const tmpDirs = []

function makeDist(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qr-dist-'))
  tmpDirs.push(dir)
  const dist = join(dir, 'dist')
  const all = { 'index.html': '<html>clean</html>', 'sw.js': 'self.skip=1', 'manifest.webmanifest': '{"scope":"/qr"}', 'assets/app.js': 'console.log("app")', 'assets/app.css': 'a{}', ...files }
  for (const [p, body] of Object.entries(all)) {
    mkdirSync(join(dist, p, '..'), { recursive: true })
    writeFileSync(join(dist, p), body)
  }
  const manifest = buildManifest(dist, { repository: 'sanjug05/smart-qr-studio', sourceCommit: 'a'.repeat(40), buildId: 'test-1', runId: '1' })
  const manifestPath = join(dir, 'build-manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  return { dir, dist, manifestPath, manifest }
}

/** A fresh world: fake Hosting (live = non-/qr files + an OLD /qr) and a built artifact. */
function world(extra = {}) {
  const art = makeDist(extra.dist)
  const fake = makeFakeHosting({
    nonQrFiles: { '/index.html': 'h1', '/about.html': 'h2', '/learning/index.html': 'h3', '/hq/index.html': 'h4', '/coffee/index.html': 'h5', '/404.html': 'h6' },
    qrFiles: { '/qr/index.html': 'old1', '/qr/sw.js': 'old2', '/qr/assets/app-OLD.js': 'old3' },
    nonQrHeaders: [
      { glob: '**', headers: { 'X-Frame-Options': 'SAMEORIGIN' } },
      { glob: '/learning/sw.js', headers: { 'Service-Worker-Allowed': '/learning' } }
    ],
    ...extra.fake
  })
  return { art, fake }
}

const baseOpts = (w, over = {}) => ({
  mode: 'preview', project: LIMITS.PROJECT, site: LIMITS.SITE, channel: PV, dist: w.art.dist, manifest: w.art.manifestPath,
  expectedLiveVersion: w.fake.liveId, planSha256: undefined, confirm: undefined, testedVersion: undefined, targetVersion: undefined, ...over
})
const deps = (w, over = {}) => ({ fetchImpl: w.fake.fetchImpl, token: 'test-token-not-real', env: {}, ...over })
/** Approved-plan hash for the CURRENT world state, computed with every guard off (so any scenario can be planned). */
async function approve(w, over = {}) {
  const opts = baseOpts(w, over)
  const r = await planRun(opts, { ...deps(w), guards: NOOP })
  return r.planSha256
}
async function expectRefused(promise, code) {
  await assert.rejects(promise, (e) => e instanceof GuardError && e.code === code, `expected GuardError ${code}`)
}

after_all()
function after_all() {
  process.on('exit', () => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
}

// ------------------------------------------------------------ guard scenarios
// Each scenario builds a world, may change it, optionally changes it AGAIN after the plan was approved, then publishes.
// `mutate` declares what happens when that one guard is switched off (mutation test, below).
const scenarios = [
  { name: 'wrong project', guard: 'project', code: 'WRONG_PROJECT', over: { project: 'other-project' }, mutate: 'WRITES' },
  { name: 'wrong site', guard: 'site', code: 'WRONG_SITE', over: { site: 'another-site' }, mutate: 'WRITES' },
  { name: 'unknown mode', guard: 'mode', code: 'BAD_MODE', over: { mode: 'both' }, mutate: 'BACKSTOP:LIVE_TARGETS_PREVIEW' },
  { name: 'invalid preview channel name', guard: 'channel', code: 'BAD_PREVIEW_CHANNEL', over: { channel: 'qr-pv-bad' }, mutate: 'WRITES' },
  { name: 'preview attempting to target live', guard: 'channel', code: 'PREVIEW_TARGETS_LIVE', over: { channel: 'live' }, mutate: 'BACKSTOP:CHANNEL_EXISTS' },
  { name: 'old qr-preview channel (preview mode)', guard: 'channel', code: 'PROTECTED_CHANNEL', over: { channel: 'qr-preview' }, mutate: 'BACKSTOP:CHANNEL_EXISTS' },
  { name: 'live attempting to target a preview channel', guard: 'channel', code: 'LIVE_TARGETS_PREVIEW', over: { mode: 'live', channel: PV, confirm: LIMITS.LIVE_PHRASE, testedVersion: 'a'.repeat(16) }, mutate: 'BACKSTOP:NOT_THE_TESTED_BUILD' },
  { name: 'missing build manifest', guard: 'manifestPresent', code: 'MANIFEST_MISSING', prep: (w) => unlinkSync(w.art.manifestPath), noApprove: true, mutate: 'CRASH' },
  { name: 'modified file', guard: 'artifactMatchesManifest', code: 'ARTIFACT_MODIFIED_FILE', prep: (w) => writeFileSync(join(w.art.dist, 'assets/app.js'), 'console.log("tampered")'), mutate: 'WRITES' },
  { name: 'missing file', guard: 'artifactMatchesManifest', code: 'ARTIFACT_MISSING_FILE', prep: (w) => unlinkSync(join(w.art.dist, 'assets/app.css')), noApprove: true, mutate: 'CRASH' },
  { name: 'extra file', guard: 'artifactMatchesManifest', code: 'ARTIFACT_EXTRA_FILE', prep: (w) => writeFileSync(join(w.art.dist, 'assets/extra.js'), 'x'), mutate: 'WRITES' },
  { name: 'wrong expected live version', guard: 'expectedLiveVersion', code: 'LIVE_VERSION_DRIFT', over: { expectedLiveVersion: '0123456789abcdef' }, approveWith: { expectedLiveVersion: '5840d3114ef43906' }, mutate: 'WRITES' },
  { name: 'unexpected Hosting configuration key', guard: 'configShape', code: 'UNEXPECTED_CONFIG', prep: (w) => { w.fake.state.versions.get(w.fake.liveId).config.i18n = { root: '/' } }, mutate: 'WRITES' },
  { name: 'wrong approval hash', guard: 'planApproved', code: 'PLAN_HASH_MISMATCH', hash: 'f'.repeat(64), mutate: 'WRITES' },
  { name: 'missing approval hash', guard: 'planApproved', code: 'PLAN_HASH_REQUIRED', hash: '', mutate: 'WRITES' },
  { name: 'non-QR file changed after approval', guard: 'planApproved', code: 'PLAN_HASH_MISMATCH', after: (w) => w.fake.state.versions.get(w.fake.liveId).files.set('/about.html', 'CHANGED'), mutate: 'WRITES' },
  { name: 'non-QR header changed after approval', guard: 'planApproved', code: 'PLAN_HASH_MISMATCH', after: (w) => { w.fake.state.versions.get(w.fake.liveId).config.headers[0].headers['X-Frame-Options'] = 'ALLOWALL' }, mutate: 'WRITES' },
  { name: 'non-QR file added after approval', guard: 'planApproved', code: 'PLAN_HASH_MISMATCH', after: (w) => w.fake.state.versions.get(w.fake.liveId).files.set('/new-page.html', 'NEW'), mutate: 'WRITES' },
  { name: 'wrong operator token identity', guard: 'tokenIdentity', code: 'TOKEN_WRONG_IDENTITY', tokenInfo: { ...goodTokenInfo(), email: 'sanju.gupta90@gmail.com' }, mutate: 'WRITES' },
  { name: 'expired token', guard: 'tokenExpiry', code: 'TOKEN_EXPIRED', tokenInfo: { ...goodTokenInfo(), expires_in: '0' }, mutate: 'WRITES' },
  { name: 'token that lives too long', guard: 'tokenExpiry', code: 'TOKEN_TOO_LONG_LIVED', tokenInfo: { ...goodTokenInfo(), expires_in: '3500' }, mutate: 'WRITES' },
  { name: 'token about to expire', guard: 'tokenExpiry', code: 'TOKEN_EXPIRING', tokenInfo: { ...goodTokenInfo(), expires_in: '30' }, mutate: 'WRITES' },
  { name: 'token scope too broad (cloud-platform)', guard: 'tokenScopes', code: 'TOKEN_SCOPE_TOO_BROAD', tokenInfo: { ...goodTokenInfo(), scope: 'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform' }, mutate: 'WRITES' },
  { name: 'token missing the required scope', guard: 'tokenScopes', code: 'TOKEN_SCOPE_MISSING', tokenInfo: { ...goodTokenInfo(), scope: 'https://www.googleapis.com/auth/userinfo.email' }, mutate: 'WRITES' },
  { name: 'no token (no credential fallback)', guard: 'tokenPresent', code: 'TOKEN_REQUIRED', token: '', mutate: 'WRITES' },
  { name: 'key-file credentials in the environment', guard: 'noKeyAuth', code: 'KEY_AUTH_FORBIDDEN', env: { GOOGLE_APPLICATION_CREDENTIALS: 'C:/keys/sa.json' }, mutate: 'WRITES' },
  { name: 'preview channel already exists', guard: 'previewChannelIsNew', code: 'CHANNEL_EXISTS', prep: (w) => w.fake.state.channels.set(PV, { name: `channels/${PV}`, url: 'x', version: undefined }), mutate: 'WRITES' },
  { name: 'live without the typed confirmation phrase', guard: 'livePhrase', code: 'CONFIRMATION_REQUIRED', over: { mode: 'live', channel: 'live', confirm: 'yes', testedVersion: 'a'.repeat(16) }, mutate: 'BACKSTOP:NOT_THE_TESTED_BUILD' },
  { name: 'live without a tested preview version', guard: 'testedVersionMatches', code: 'TESTED_VERSION_REQUIRED', over: { mode: 'live', channel: 'live', confirm: LIMITS.LIVE_PHRASE }, mutate: 'WRITES' },
  { name: 'live build differs from the tested preview', guard: 'testedVersionMatches', code: 'NOT_THE_TESTED_BUILD', over: { mode: 'live', channel: 'live', confirm: LIMITS.LIVE_PHRASE }, testedFrom: 'other', mutate: 'WRITES' }
]

async function runScenario(s, guards) {
  const w = world()
  s.prep?.(w)
  if (s.tokenInfo) w.fake.state.tokenInfo = s.tokenInfo
  const over = s.over ?? {}
  let hash = '0'.repeat(64)
  if (!s.noApprove) hash = await approve(w, { ...over, ...(s.approveWith ?? {}) })
  if (s.hash !== undefined) hash = s.hash
  s.after?.(w)
  let tested = over.testedVersion
  if (s.testedFrom === 'other') {
    // a "tested" preview version that is NOT what would be released now
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

describe('every guard failure produces ZERO Hosting writes and a specific refusal', () => {
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
  for (const s of scenarios) {
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
  test('plan-only is read-only and its hash is what publish checks', async () => {
    const w = world()
    const plan = await planRun(baseOpts(w), deps(w))
    assert.equal(w.fake.writes(), 0)
    assert.equal(plan.plan.nonQrChanges, 0)
    assert.equal(plan.plan.qrHeaderRulesIdenticalToLive, true)
    assert.match(plan.planSha256, /^[0-9a-f]{64}$/)
    assert.equal(plan.plan.qrChanges.removed, 1) // /qr/assets/app-OLD.js disappears
    assert.equal(canonicalSha(plan.plan), plan.planSha256)
  })

  test('a read-only client refuses every write, and DELETE / other sites are never on the allow-list', async () => {
    const w = world()
    const ro = makeClient({ fetchImpl: w.fake.fetchImpl, token: 't', project: LIMITS.PROJECT, site: LIMITS.SITE, mode: 'preview', channel: PV, readOnly: true })
    await expectRefused(ro.write('POST', `https://firebasehosting.googleapis.com/v1beta1/projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}/versions`, {}), 'READ_ONLY')
    const rw = makeClient({ fetchImpl: w.fake.fetchImpl, token: 't', project: LIMITS.PROJECT, site: LIMITS.SITE, mode: 'preview', channel: PV, readOnly: false })
    const B = 'https://firebasehosting.googleapis.com/v1beta1'
    for (const [m, u] of [
      ['DELETE', `${B}/projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}/channels/${PV}`],
      ['DELETE', `${B}/projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}/versions/abc`],
      ['POST', `${B}/projects/${LIMITS.PROJECT}/sites`],
      ['PATCH', `${B}/projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}`],
      ['POST', `${B}/projects/${LIMITS.PROJECT}/sites/other-site/versions`],
      ['POST', `${B}/projects/other/sites/${LIMITS.SITE}/versions`],
      ['POST', `${B}/projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}/channels?channelId=qr-preview`],
      ['POST', `${B}/projects/${LIMITS.PROJECT}/sites/${LIMITS.SITE}/channels/qr-preview/releases?versionName=x`]
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
    assert.ok([...fresh.files.keys()].filter((p) => p.startsWith('/qr/')).length === 5)
    assert.ok(![...fresh.files.keys()].includes('/qr/assets/app-OLD.js'))
    assert.deepEqual(fresh.config.headers.filter((h) => !h.glob.startsWith('/qr')), live.config.headers.filter((h) => !h.glob.startsWith('/qr')))
    assert.deepEqual(fresh.config.redirects, live.config.redirects)
    assert.deepEqual(fresh.config.rewrites, live.config.rewrites)
    assert.deepEqual(fresh.config.headers.filter((h) => h.glob.startsWith('/qr')), JSON.parse(JSON.stringify(QR_HEADER_RULES)))
    assert.ok(r.before.files.length > 0 && r.after.files.length > 0)
  })

  test('live: needs the tested preview, the typed phrase and the approved hash; releases once; previous version stays for rollback', async () => {
    const w = world()
    const pvHash = (await planRun(baseOpts(w), deps(w))).planSha256
    const pv = await publishRun(baseOpts(w, { planSha256: pvHash }), deps(w))
    const testedId = pv.versionName.split('/').pop()
    const liveOpts = baseOpts(w, { mode: 'live', channel: 'live', confirm: LIMITS.LIVE_PHRASE, testedVersion: testedId })
    const liveHash = (await planRun(liveOpts, deps(w))).planSha256
    assert.notEqual(liveHash, pvHash, 'live and preview plans have different hashes')
    const writesBefore = w.fake.writes()
    const r = await publishRun({ ...liveOpts, planSha256: liveHash }, deps(w))
    assert.equal(w.fake.releasesTo('live'), 1, 'exactly one release to live')
    assert.notEqual(w.fake.liveVersion(), w.fake.liveId)
    assert.equal(w.fake.liveVersion(), r.versionName.split('/').pop())
    assert.ok(w.fake.writes() > writesBefore)
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
  test('a non-/qr file missing from the new version -> no release', async () => {
    const w = world()
    const hash = await approve(w)
    w.fake.state.hooks.afterFinalize = (v) => v.files.delete('/learning/index.html')
    await expectRefused(publishRun(baseOpts(w, { planSha256: hash }), deps(w)), 'NON_QR_CHANGED')
    assert.equal(w.fake.releasesTo(PV), 0)
    assert.equal(w.fake.liveVersion(), w.fake.liveId)
  })
  test('a /qr file missing from the new version -> no release', async () => {
    const w = world()
    const hash = await approve(w)
    w.fake.state.hooks.afterFinalize = (v) => v.files.delete('/qr/index.html')
    await expectRefused(publishRun(baseOpts(w, { planSha256: hash }), deps(w)), 'QR_INCOMPLETE')
    assert.equal(w.fake.releasesTo(PV), 0)
  })
  test('configuration changed in the new version -> no release', async () => {
    const w = world()
    const hash = await approve(w)
    w.fake.state.hooks.afterFinalize = (v) => { v.config.cleanUrls = false }
    await expectRefused(publishRun(baseOpts(w, { planSha256: hash }), deps(w)), 'CONFIG_CHANGED')
    assert.equal(w.fake.releasesTo(PV), 0)
  })
  test('live changed while publishing -> no release', async () => {
    const w = world()
    const hash = await approve(w)
    w.fake.state.hooks.afterFinalize = () => {
      w.fake.state.versions.set('c'.repeat(16), { name: `projects/ais-channel-os/sites/sanjugupta-web/versions/${'c'.repeat(16)}`, status: 'FINALIZED', config: {}, files: new Map() })
      w.fake.state.channels.get('live').version = 'c'.repeat(16)
    }
    await expectRefused(publishRun(baseOpts(w, { planSha256: hash }), deps(w)), 'LIVE_CHANGED_DURING_RUN')
    assert.equal(w.fake.releasesTo(PV), 0)
  })
})

describe('rollback to the exact known previous live version', () => {
  async function liveWorld() {
    const w = world()
    const pvHash = (await planRun(baseOpts(w), deps(w))).planSha256
    const pv = await publishRun(baseOpts(w, { planSha256: pvHash }), deps(w))
    const tested = pv.versionName.split('/').pop()
    const lo = baseOpts(w, { mode: 'live', channel: 'live', confirm: LIMITS.LIVE_PHRASE, testedVersion: tested })
    const lh = (await planRun(lo, deps(w))).planSha256
    const r = await publishRun({ ...lo, planSha256: lh }, deps(w))
    w.fake.state.writes.length = 0
    return { w, newLive: r.versionName.split('/').pop(), previous: w.fake.liveId }
  }
  const ro = (w, newLive, previous, over = {}) => ({ mode: 'rollback', project: LIMITS.PROJECT, site: LIMITS.SITE, channel: 'live', expectedLiveVersion: newLive, targetVersion: previous, confirm: `ROLLBACK-QR-TO-${previous}`, ...over })

  test('re-releases exactly the previous version with exactly one write', async () => {
    const { w, newLive, previous } = await liveWorld()
    const r = await rollbackRun(ro(w, newLive, previous), deps(w))
    assert.equal(r.writes, 1)
    assert.equal(w.fake.liveVersion(), previous)
    assert.equal(w.fake.writes(), 1)
    assert.match(w.fake.state.writes[0], /channels\/live\/releases\?versionName=/)
  })
  test('wrong phrase, wrong expected version, unknown target, target already live: zero writes', async () => {
    const { w, newLive, previous } = await liveWorld()
    await expectRefused(rollbackRun(ro(w, newLive, previous, { confirm: 'ROLLBACK' }), deps(w)), 'CONFIRMATION_REQUIRED')
    await expectRefused(rollbackRun(ro(w, newLive, previous, { expectedLiveVersion: previous }), deps(w)), 'LIVE_VERSION_DRIFT')
    await expectRefused(rollbackRun(ro(w, newLive, '1111111111111111'), deps(w)), 'TARGET_NOT_FINALIZED')
    await expectRefused(rollbackRun(ro(w, newLive, newLive), deps(w)), 'TARGET_IS_LIVE')
    await expectRefused(rollbackRun(ro(w, newLive, previous, { project: 'x' }), deps(w)), 'WRONG_PROJECT')
    assert.equal(w.fake.writes(), 0)
    assert.equal(w.fake.liveVersion(), newLive)
  })
  test('a wrong token identity cannot roll back', async () => {
    const { w, newLive, previous } = await liveWorld()
    w.fake.state.tokenInfo = { ...goodTokenInfo(), email: 'someone@example.com' }
    await expectRefused(rollbackRun(ro(w, newLive, previous), deps(w)), 'TOKEN_WRONG_IDENTITY')
    assert.equal(w.fake.writes(), 0)
  })
})

describe('command line', () => {
  const run = (args, env = {}) => {
    const e = { ...process.env }
    delete e.QR_PUBLISHER_TOKEN
    delete e.GOOGLE_APPLICATION_CREDENTIALS
    return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...e, ...env } })
  }
  test('has no option for tokens, key files or the Firebase CLI', () => {
    for (const flag of ['--token', '--key-file', '--credentials', '--use-firebase-cli']) {
      const r = run(['--mode', 'preview', flag, 'x'])
      assert.notEqual(r.status, 0)
      assert.match(r.stderr, /Unknown option/)
    }
  })
  test('refuses without a token and never falls back to another credential', () => {
    const r = run(['--mode', 'preview', '--channel', PV, '--expected-live-version', '5840d3114ef43906', '--plan-only'])
    assert.equal(r.status, 3)
    assert.match(r.stderr, /TOKEN_REQUIRED/)
  })
  test('refuses key-file authentication', () => {
    const r = run(['--mode', 'preview', '--channel', PV, '--expected-live-version', '5840d3114ef43906', '--plan-only'], { GOOGLE_APPLICATION_CREDENTIALS: 'x.json', QR_PUBLISHER_TOKEN: 'abc' })
    assert.equal(r.status, 3)
    assert.match(r.stderr, /KEY_AUTH_FORBIDDEN/)
  })
  test('refuses an explicit mode that is missing', () => {
    const r = run(['--channel', PV, '--plan-only'], { QR_PUBLISHER_TOKEN: 'abc' })
    assert.equal(r.status, 3)
    assert.match(r.stderr, /BAD_MODE/)
  })
  test('the source never logs the token and has no child-process, Firebase CLI or DELETE call', async () => {
    const { readFileSync } = await import('node:fs')
    const lib = readFileSync(fileURLToPath(new URL('../lib/qrPublisher.mjs', import.meta.url)), 'utf8')
    const cli = readFileSync(CLI, 'utf8')
    const all = lib + cli
    assert.ok(!/console\.\w+\(\s*(deps\.)?token\b/.test(all), 'no console call may print the token')
    const interpolations = all.split('\n').filter((l) => /\$\{(deps\.)?token\}/.test(l))
    assert.ok(interpolations.every((l) => l.includes('Authorization')), 'the token may only be interpolated into the Authorization header')
    assert.ok(!/child_process|firebase-tools|execSync|spawn\(/.test(all), 'no shelling out and no Firebase CLI')
    assert.ok(!/method:\s*'DELETE'|write\('DELETE'/.test(all), 'no DELETE request is ever built')
  })
})
