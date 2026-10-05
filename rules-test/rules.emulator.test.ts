/**
 * Runs rules-test/cases.cjs against the Firestore EMULATOR with the real
 * firestore.rules. Executed in CI via `npm run test:rules`
 * (firebase emulators:exec), which needs a JDK 21+.
 */
import { readFileSync } from 'node:fs'
import { describe, it, beforeAll, afterAll } from 'vitest'
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { cases } = require('./cases.cjs') as { cases: RuleCase[] }

interface RuleCase {
  name: string
  expect: 'allow' | 'deny'
  method: 'get' | 'create' | 'update' | 'delete'
  uid: string | null
  path: string
  existing?: Record<string, unknown> | null
  data?: Record<string, unknown>
}

let env: RulesTestEnvironment

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')
  env = await initializeTestEnvironment({
    projectId: 'demo-smart-qr-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) }
  })
})

afterAll(async () => {
  await env?.cleanup()
})

describe('firestore.rules', () => {
  for (const c of cases) {
    it(`${c.expect.toUpperCase()}: ${c.name}`, async () => {
      await env.clearFirestore()
      if (c.existing) {
        await env.withSecurityRulesDisabled(async (ctx) => {
          await setDoc(doc(ctx.firestore(), c.path), c.existing as Record<string, unknown>)
        })
      }
      const db = (c.uid ? env.authenticatedContext(c.uid) : env.unauthenticatedContext()).firestore()
      const ref = doc(db, c.path)
      const op =
        c.method === 'get' ? getDoc(ref) : c.method === 'create' ? setDoc(ref, c.data!) : c.method === 'update' ? setDoc(ref, c.data!) : deleteDoc(ref)
      await (c.expect === 'allow' ? assertSucceeds(op) : assertFails(op))
    })
  }
})

