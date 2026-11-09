// CLI wrapper around the neutral-branding scanner for the SOURCE tree (the bundle has its own postbuild check).
// Read-only. Exits 1 on any finding. Used by the CI-only build workflow.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanPaths, SOURCE_TARGETS } from './aisScan.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const findings = scanPaths(root, SOURCE_TARGETS)
if (findings.length) {
  console.error(`check-source-neutral: ${findings.length} forbidden sample-branding reference(s):`)
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${f.excerpt}`)
  process.exit(1)
}
console.log('check-source-neutral: source tree is clean.')
