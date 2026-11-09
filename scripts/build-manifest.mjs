#!/usr/bin/env node
// Writes build-manifest.json for a finished production build: a SHA-256 for every file in dist/, plus the identity of
// the build (repository, source commit, workflow, run, lockfile hash, Node/npm versions). CI-only helper: no network,
// no credentials. Usage: node scripts/build-manifest.mjs --dist dist --out build-manifest.json
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildManifest, sha256 } from './lib/qrPublisher.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const dist = resolve(opt('dist', 'dist'))
const out = resolve(opt('out', 'build-manifest.json'))
const env = process.env
const sha = env.GITHUB_SHA ?? ''
const npmVersion = (env.npm_config_user_agent ?? '').match(/npm\/(\S+)/)?.[1] ?? null // set by `npm run`; no child process needed

const meta = {
  repository: env.GITHUB_REPOSITORY ?? null,
  repositoryId: env.GITHUB_REPOSITORY_ID ?? null,
  sourceCommit: sha || null,
  ref: env.GITHUB_REF ?? null,
  workflow: env.GITHUB_WORKFLOW ?? null,
  workflowRef: env.GITHUB_WORKFLOW_REF ?? null,
  workflowSha: env.GITHUB_WORKFLOW_SHA ?? null,
  runId: env.GITHUB_RUN_ID ?? null,
  runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
  lockfileSha256: sha256(readFileSync(resolve('package-lock.json'))),
  nodeVersion: process.version,
  npmVersion,
  buildId: sha ? `${env.GITHUB_RUN_ID ?? 'local'}-${env.GITHUB_RUN_ATTEMPT ?? '0'}-${sha.slice(0, 12)}` : 'local'
}
const manifest = buildManifest(dist, meta)
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n')
console.log(`build-manifest: ${manifest.fileCount} files, ${manifest.totalBytes} bytes, filesSha256 ${manifest.filesSha256}`)
console.log(`build-manifest: buildId ${meta.buildId}; written to ${out}`)
