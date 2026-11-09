#!/usr/bin/env node
/**
 * READ-ONLY audit: compares the CURRENT live Hosting version of sanjugupta-web (files and configuration) with the
 * "after" state recorded in a release receipt written by scripts/deploy-qr-hosting.mjs (--receipt-out).
 *
 * Identity: ONLY the dedicated read-only Hosting service account (qr-canary-20261109@…) is accepted, with a token that
 * carries exactly the read-only scope https://www.googleapis.com/auth/firebase.readonly and has 120–900 s left.
 * A personal or Owner token is REFUSED. The account is kept disabled; the Owner enables it only for an explicitly
 * authorised audit window and disables it again afterwards.
 *
 *   $env:QR_AUDIT_TOKEN = '<900 s token for qr-canary-20261109, scope firebase.readonly; never typed into chat>'
 *   node scripts/audit-qr-live.mjs --receipt "$HOME\Downloads\QR-release-records\<receipt>.json"
 *   Remove-Item Env:QR_AUDIT_TOKEN
 *
 * It issues GET requests only. The token is never printed. Exit code 0 = live matches the receipt, 2 = differences
 * (non-/qr differences flagged loudly), 1 = error or refusal.
 */
import { readFileSync } from 'node:fs'
import { GuardError } from './lib/qrPublisher.mjs'
import { runAudit } from './lib/qrAudit.mjs'

try {
  const i = process.argv.indexOf('--receipt')
  const receiptPath = i >= 0 ? process.argv[i + 1] : undefined
  if (!receiptPath) throw new Error('Usage: --receipt <file>')
  const token = process.env.QR_AUDIT_TOKEN
  delete process.env.QR_AUDIT_TOKEN
  delete process.env.QR_READ_TOKEN // the old variable is not accepted
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  const r = await runAudit({ receipt, fetchImpl: fetch, token })
  console.log(`token ok: ${r.token.email}, ${r.token.expiresIn}s left, scope ${r.token.scopes.filter((s) => s.includes('firebase')).join(' ')}`)
  console.log(`receipt: ${receipt.kind} of ${receipt.timestampUtc}, version ${receipt.newVersion}, source ${receipt.sourceCommit}`)
  console.log(`live now: version ${r.liveVersion} ; ${r.files} files (receipt: ${r.receiptFiles}) ; config ${r.configSame ? 'IDENTICAL' : 'DIFFERENT'}`)
  console.log(`live version ${r.liveVersion === receipt.newVersion ? 'is' : 'is NOT'} the version recorded in the receipt`)
  if (r.pass) {
    console.log('AUDIT PASS: every file and the configuration match the receipt.')
    process.exit(0)
  }
  console.log(`AUDIT DIFFERENCES: ${r.diffs.length} file difference(s) (${r.outsideQr} OUTSIDE /qr${r.outsideQr ? ' — someone else released since' : ''}), config ${r.configSame ? 'same' : 'different'}`)
  for (const [kind, p] of r.diffs.slice(0, 40)) console.log(`  ${kind} ${p}`)
  if (r.diffs.length > 40) console.log(`  … ${r.diffs.length - 40} more`)
  process.exit(2)
} catch (e) {
  console.error(e instanceof GuardError ? `REFUSED: ${e.message}` : `ERROR: ${e.message}`)
  process.exit(1)
}
