// Fails the build if the built public bundle (dist/) contains another company's sample branding.
// Runs automatically after `npm run build` (npm's `postbuild` hook), so every CI and deploy build is checked
// without any workflow change. Read-only: it only reads files under dist/.

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanPaths } from './aisScan.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

if (!existsSync(join(dist, 'index.html'))) {
  console.error('check-bundle-neutral: dist/index.html not found. Run `npm run build` first; refusing to pass on an empty scan.')
  process.exit(2)
}

// Guard against a vacuous pass: the scan must actually have a JavaScript bundle to look at.
const hasScript = (function find(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory() ? find(full) : entry.name.endsWith('.js')) return true
  }
  return false
})(dist)
if (!hasScript) {
  console.error('check-bundle-neutral: no .js files under dist/. Refusing to pass on an empty scan.')
  process.exit(2)
}

const findings = scanPaths(root, ['dist'])
if (findings.length > 0) {
  console.error(`check-bundle-neutral: ${findings.length} forbidden sample-branding reference(s) in the built bundle:`)
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${f.excerpt}`)
  process.exit(1)
}
console.log('check-bundle-neutral: dist/ is clean (no sample-branding references).')
