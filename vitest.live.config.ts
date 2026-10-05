import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// LIVE tests against the real Firebase project (see live-tests/live.test.ts). Not part of `npm test`.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['live-tests/**/*.test.ts'], fileParallelism: false, testTimeout: 60_000 }
})
