import { defineConfig } from 'vitest/config'

// Firestore security-rules tests (need the emulator: run via `npm run test:rules`).
export default defineConfig({
  test: { environment: 'node', include: ['rules-test/**/*.test.ts'] }
})
