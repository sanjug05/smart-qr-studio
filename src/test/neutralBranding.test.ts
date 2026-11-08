import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanPaths, SOURCE_TARGETS } from '../../scripts/aisScan.mjs'

// Smart QR Studio ships no third-party sample branding. Tokens are assembled from fragments so this file
// never matches its own scan.
const BRAND = ['A', 'I', 'S'].join('')
const TAGLINE = ['Smart', 'Access', 'Solutions'].join(' ')
const INFRA_ID = `${BRAND.toLowerCase()}-channel-os` // the Firebase project id: infrastructure, allowed

// vitest runs from the repository root (see vitest.config.ts); jsdom's import.meta.url is not a file: URL.
const repoRoot = process.cwd()
const tmpDirs: string[] = []
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'neutral-scan-'))
  tmpDirs.push(dir)
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  return dir
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('neutral-branding scanner (detector self-test)', () => {
  it('flags the brand word, the tagline, the sample factory and the sample button', () => {
    const dir = fixture({
      'a.js': `const x = "${BRAND}"`,
      'b.html': `<p>${TAGLINE.toLowerCase()}</p>`,
      'c.ts': `import { loadSample${BRAND[0]}${BRAND.slice(1).toLowerCase()}Project } from './x'`,
      'd.tsx': `<button>Try a sample (${BRAND})</button>`,
      'e.md': `${BRAND} Windows brochure`
    })
    const rules = scanPaths(dir, ['.']).map((f) => f.rule).sort()
    expect(rules).toEqual(expect.arrayContaining(['brand-word', 'brand-tagline', 'sample-factory', 'sample-button', 'brand-windows']))
  })

  it('reports file, line and an excerpt', () => {
    const dir = fixture({ 'assets/app.js': `var a=1;\nvar b="${BRAND} Co";\n` })
    expect(scanPaths(dir, ['assets'])).toEqual([
      expect.objectContaining({ file: 'assets/app.js', line: 2, rule: 'brand-word' })
    ])
  })

  it('allows the Firebase project id and ordinary words that contain the same letters', () => {
    const dir = fixture({
      'ok.md': `project ${INFRA_ID} chairs aisle pais "${BRAND.toLowerCase()}" ais(x)`,
      'ok.json': JSON.stringify({ project: INFRA_ID })
    })
    expect(scanPaths(dir, ['.'])).toEqual([])
  })

  it('ignores binary files and missing paths without throwing', () => {
    const dir = fixture({ 'logo.png': BRAND })
    expect(scanPaths(dir, ['logo.png', 'does-not-exist'])).toEqual([])
  })
})

describe('application source contains no sample branding', () => {
  it('src/, public/, index.html and the public docs are clean', () => {
    expect(scanPaths(repoRoot, SOURCE_TARGETS)).toEqual([])
  })

  it('the sample-project factory no longer exists', () => {
    expect(existsSync(join(repoRoot, 'src/services/storage/sampleProject.ts'))).toBe(false)
  })
})

// The built bundle only exists after `npm run build`; that step also runs this same scan automatically
// (npm `postbuild` -> scripts/check-bundle-neutral.mjs), so a build can never complete with a hit in it.
describe.skipIf(!existsSync(join(repoRoot, 'dist/index.html')))('built public bundle (dist/)', () => {
  it('contains no sample-branding references', () => {
    expect(scanPaths(repoRoot, ['dist'])).toEqual([])
  })
})
