import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts on purpose: the PWA plugin and build
// settings there have no business running under the test runner.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // On Windows, parallel workers race on the temp file Vitest stages for the
    // shared setup module ("UNKNOWN: unknown error, open …"), which drops whole test
    // files from the run. The suite is small enough that serial is barely slower.
    fileParallelism: false
  }
})
