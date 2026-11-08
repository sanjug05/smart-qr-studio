// Neutral-branding scanner.
//
// Smart QR Studio is a general product: it must not ship another company's sample branding or sample records.
// This module finds any such reference. It is used by:
//   - src/test/neutralBranding.test.ts   (source tree + built bundle, under `npm test`)
//   - scripts/check-bundle-neutral.mjs   (run automatically after every `npm run build`, via the `postbuild` hook)
//
// The forbidden tokens are assembled from fragments on purpose, so this file (and its tests) never match themselves.
// Infrastructure identifiers that legitimately contain the same letters (the Firebase project id) are removed
// before matching and are therefore allowed.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname, relative, sep } from 'node:path'

const BRAND = ['A', 'I', 'S'].join('')

/** @type {{ id: string, re: RegExp }[]} */
export const RULES = [
  // The bare brand word, upper case. Case-sensitive so minified identifiers such as `ais` cannot trip it.
  { id: 'brand-word', re: new RegExp(`\\b${BRAND}\\b`) },
  { id: 'brand-windows', re: new RegExp(`\\b${BRAND} Windows\\b`, 'i') },
  { id: 'brand-tagline', re: new RegExp(['Smart', 'Access', 'Solutions'].join('\\s+'), 'i') },
  { id: 'sample-factory', re: new RegExp(`load[A-Za-z]*Sample${BRAND[0]}${BRAND.slice(1).toLowerCase()}[A-Za-z]*`) },
  { id: 'sample-button', re: new RegExp(`Try a sample \\(${BRAND}\\)`, 'i') }
]

/** Identifiers that are allowed to contain the brand letters. They are blanked out before matching. */
const ALLOWED = [new RegExp(`${BRAND.toLowerCase()}-channel-os`, 'gi')]

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.css', '.html', '.htm', '.json', '.webmanifest',
  '.svg', '.txt', '.md', '.xml', '.map'
])

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      walk(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
}

/**
 * Scans the given files / directories (relative to `root`) and returns every forbidden reference found.
 * Only text files are inspected; images and other binaries are not.
 * @param {string} root
 * @param {string[]} targets
 * @returns {{ file: string, line: number, rule: string, excerpt: string }[]}
 */
export function scanPaths(root, targets) {
  /** @type {string[]} */
  const files = []
  for (const target of targets) {
    const full = join(root, target)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, files)
    else if (st.isFile()) files.push(full)
  }

  const findings = []
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) continue
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      for (const allowed of ALLOWED) line = line.replace(allowed, ' ')
      for (const rule of RULES) {
        const m = rule.re.exec(line)
        if (!m) continue
        const start = Math.max(0, m.index - 30)
        findings.push({
          file: relative(root, file).split(sep).join('/'),
          line: i + 1,
          rule: rule.id,
          excerpt: line.slice(start, m.index + m[0].length + 30).trim()
        })
      }
    }
  }
  return findings
}

/** The places that make up the application source and its public documentation. */
export const SOURCE_TARGETS = ['src', 'public', 'index.html', 'README.md', '.smart-qr-automation-status.md']
