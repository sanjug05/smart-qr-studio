#!/usr/bin/env node
/**
 * Local, operator-run publisher for Smart QR Studio at https://sanjugupta.com/qr.
 *
 * It adds / replaces ONLY the /qr/** files and the /qr header rules on the existing Firebase Hosting site, by building
 * a new Hosting version from the live one. It never runs `firebase deploy` and never replaces the whole site.
 * All logic and all guards live in scripts/lib/qrPublisher.mjs (and are covered by `npm run test:publisher`).
 *
 * Credentials: ONLY a short-lived access token for the publisher service account, in the environment variable
 * QR_PUBLISHER_TOKEN of this one process. It is never accepted as an argument, never printed, and removed from the
 * environment as soon as it is read. Key files, user logins and the Firebase CLI login are NOT accepted.
 *
 * Modes (explicit; there is no default):
 *   --mode preview   --channel qr-pv-<yyyymmdd>-<id>     new single-use preview channel
 *   --mode live      (channel is always "live")           needs --tested-version and the typed confirmation phrase
 *   --mode rollback  --target-version <id>                re-releases an exact earlier version to live
 *
 * Typical use (see docs/qr-publishing.md):
 *   1. node scripts/deploy-qr-hosting.mjs --mode preview --channel qr-pv-20261109-ab12cd --dist dist --manifest build-manifest.json \
 *        --expected-live-version 5840d3114ef43906 --plan-only --plan-out plan.json      # read-only; prints PLAN_SHA256
 *   2. same command without --plan-only, plus --plan-sha256 <the printed hash>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { GuardError, LIMITS, canonicalSha, planRun, publishRun, rollbackRun, sha256 } from './lib/qrPublisher.mjs'

const VALUE_FLAGS = ['mode', 'project', 'site', 'dist', 'manifest', 'channel', 'expected-live-version', 'plan-sha256', 'plan-out', 'confirm', 'tested-version', 'target-version', 'receipt-out', 'operator']
const BOOL_FLAGS = ['plan-only']

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`Unexpected argument "${a}".`)
    const name = a.slice(2)
    if (BOOL_FLAGS.includes(name)) out[name] = true
    else if (VALUE_FLAGS.includes(name)) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`--${name} needs a value.`)
      out[name] = argv[++i]
    } else throw new Error(`Unknown option --${name}. (There is intentionally no option for tokens, key files or the Firebase CLI.)`)
  }
  return out
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  const token = process.env.QR_PUBLISHER_TOKEN
  delete process.env.QR_PUBLISHER_TOKEN
  const env = { GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS }
  const opts = {
    mode: a.mode,
    project: a.project ?? LIMITS.PROJECT,
    site: a.site ?? LIMITS.SITE,
    dist: a.dist ?? 'dist',
    manifest: a.manifest ?? 'build-manifest.json',
    channel: a.channel ?? (a.mode === 'live' || a.mode === 'rollback' ? 'live' : undefined),
    expectedLiveVersion: a['expected-live-version'],
    planSha256: a['plan-sha256'],
    confirm: a.confirm,
    testedVersion: a['tested-version'],
    targetVersion: a['target-version']
  }
  const deps = { fetchImpl: fetch, token, env }

  if (a['plan-only']) {
    if (opts.mode === 'rollback') throw new Error('--plan-only does not apply to rollback.')
    const r = await planRun(opts, deps)
    console.log(`token ok: ${r.token.email}, ${r.token.expiresIn}s left`)
    console.log(JSON.stringify(r.plan, null, 2))
    console.log(`PLAN_SHA256=${r.planSha256}`)
    if (a['plan-out']) writeFileSync(a['plan-out'], JSON.stringify(r.plan, null, 2) + '\n')
    console.log('READ-ONLY: nothing was written to Hosting.')
    return
  }

  if (opts.mode === 'rollback') {
    const r = await rollbackRun(opts, deps)
    console.log(`token ok: ${r.token.email}, ${r.token.expiresIn}s left`)
    console.log(`rolled back live ${r.from} -> ${r.to} (${r.release}); Hosting writes: ${r.writes}`)
    return
  }

  const r = await publishRun(opts, deps)
  console.log(`token ok: ${r.token.email}, ${r.token.expiresIn}s left at start`)
  console.log(`plan ${r.planSha256}`)
  console.log(`released new version ${r.versionName.split('/').pop()} to channel "${opts.channel}": ${r.url}`)
  console.log(`previous live version: ${r.previousLive}`)
  console.log(`Hosting writes made: ${r.writes}`)
  console.log(`ROLLBACK: node scripts/deploy-qr-hosting.mjs --mode rollback --target-version ${r.previousLive} --expected-live-version ${r.versionName.split('/').pop()} --confirm ROLLBACK-QR-TO-${r.previousLive}`)
  if (a['receipt-out']) {
    const receipt = {
      schema: 1,
      kind: opts.mode === 'live' ? 'LIVE_RELEASE' : 'PREVIEW_RELEASE',
      timestampUtc: new Date().toISOString(),
      operator: a.operator ?? null,
      publisherServiceAccount: r.token.email,
      sourceCommit: r.plan.artifact.sourceCommit,
      buildId: r.plan.artifact.buildId,
      artifactFilesSha256: r.plan.artifact.filesSha256,
      planSha256: r.planSha256,
      plan: r.plan,
      channel: opts.channel,
      previousVersion: r.previousLive,
      newVersion: r.versionName.split('/').pop(),
      rollbackTarget: r.previousLive,
      before: { fileCount: r.before.files.length, manifestSha256: canonicalSha(r.before.files), configSha256: canonicalSha(r.before.config), files: r.before.files, config: r.before.config },
      after: { fileCount: r.after.files.length, manifestSha256: canonicalSha(r.after.files), configSha256: canonicalSha(r.after.config), files: r.after.files, config: r.after.config },
      hostingWrites: r.writes
    }
    mkdirSync(dirname(a['receipt-out']), { recursive: true })
    writeFileSync(a['receipt-out'], JSON.stringify(receipt, null, 2) + '\n')
    console.log(`receipt written: ${a['receipt-out']} (sha256 ${sha256(JSON.stringify(receipt)).slice(0, 16)}…)`)
  }
}

main().catch((e) => {
  console.error(e instanceof GuardError ? `REFUSED: ${e.message}` : `ERROR: ${e.message}`)
  process.exit(e instanceof GuardError ? 3 : 1)
})
