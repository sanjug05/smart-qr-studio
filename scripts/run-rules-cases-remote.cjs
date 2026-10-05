#!/usr/bin/env node
/**
 * Runs rules-test/cases.cjs against firestore.rules using Google's
 * firebaserules `projects.test` API — a server-side rules evaluator with
 * mock auth/resources, so it needs neither Java nor the emulator.
 *
 * Auth: reuses the Firebase CLI's existing local login (`firebase login`);
 * the access token is held in memory only and never printed.
 *
 *   node scripts/run-rules-cases-remote.cjs [projectId]
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const projectId = process.argv[2] || 'smart-qr-studio-app'
const { cases } = require('../rules-test/cases.cjs')

function firebaseToolsDir() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'firebase-tools'),
    '/usr/local/lib/node_modules/firebase-tools',
    '/usr/lib/node_modules/firebase-tools'
  ]
  const found = candidates.find((p) => fs.existsSync(path.join(p, 'lib', 'auth.js')))
  if (!found) throw new Error('firebase-tools is not installed globally; install it and run `firebase login`.')
  return found
}

async function accessToken() {
  const auth = require(path.join(firebaseToolsDir(), 'lib', 'auth.js'))
  const account = auth.getGlobalDefaultAccount()
  if (!account) throw new Error('No Firebase CLI login found. Run `firebase login`.')
  const t = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])
  return t.access_token
}

const docPath = (p) => `/databases/%28default%29/documents/${p}`

function toTestCase(c) {
  const tc = {
    expectation: c.expect === 'allow' ? 'ALLOW' : 'DENY',
    request: {
      method: c.method,
      path: docPath(c.path),
      auth: c.uid ? { uid: c.uid, token: {} } : undefined
    }
  }
  if (c.data) tc.request.resource = { data: c.data }
  if (c.existing) tc.resource = { data: c.existing }
  return tc
}

async function main() {
  const token = await accessToken()
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}:test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': projectId },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: rules }] }, testSuite: { testCases: cases.map(toTestCase) } })
  })
  const body = await res.json()
  if (!res.ok) {
    console.error('API error', res.status, JSON.stringify(body.error ?? body).slice(0, 600))
    process.exit(2)
  }
  if (body.issues?.length) {
    console.error('Rules compile issues:', JSON.stringify(body.issues).slice(0, 800))
    process.exit(2)
  }
  const results = body.testResults ?? []
  let failed = 0
  results.forEach((r, i) => {
    const ok = r.state === 'SUCCESS'
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${cases[i].expect.toUpperCase().padEnd(5)} ${cases[i].name}${ok ? '' : `  [${r.state}] ${(r.debugMessages || []).join(' | ').slice(0, 200)}`}`)
  })
  console.log(`\n${results.length - failed}/${results.length} rules cases passed`)
  if (results.length !== cases.length) {
    console.error(`expected ${cases.length} results, got ${results.length}`)
    process.exit(1)
  }
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(2)
})
