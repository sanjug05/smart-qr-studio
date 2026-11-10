// In-memory fake of the PUBLIC GitHub REST endpoints the publisher's provenance gate reads (GET only).
import { PROVENANCE } from '../lib/qrPublisher.mjs'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

/**
 * @param {{ sha: string, runId: string, zipSha256: string, workflowSha?: string }} a
 *   sha = the commit that triggered the run (GITHUB_SHA); workflowSha = the commit of the workflow file (GITHUB_WORKFLOW_SHA).
 */
export function makeFakeGitHub({ sha, runId, zipSha256, workflowSha = sha }) {
  const approvedFile = { type: 'file', path: PROVENANCE.WORKFLOW_PATH, sha: PROVENANCE.WORKFLOW_BLOB_SHA }
  const state = {
    repo: { id: PROVENANCE.REPOSITORY_ID, full_name: PROVENANCE.REPOSITORY, private: false },
    run: {
      id: Number(runId), run_attempt: 1, event: 'push', head_branch: 'main', head_sha: sha, status: 'completed', conclusion: 'success',
      path: PROVENANCE.WORKFLOW_PATH, workflow_id: PROVENANCE.WORKFLOW_ID,
      repository: { id: PROVENANCE.REPOSITORY_ID, full_name: PROVENANCE.REPOSITORY }, head_repository: { id: PROVENANCE.REPOSITORY_ID }
    },
    artifacts: [{
      name: `${PROVENANCE.ARTIFACT_PREFIX}${sha}`, expired: false, digest: `sha256:${zipSha256}`,
      workflow_run: { id: Number(runId), repository_id: PROVENANCE.REPOSITORY_ID, head_repository_id: PROVENANCE.REPOSITORY_ID, head_branch: 'main', head_sha: sha }
    }],
    // the workflow file as GitHub serves it at a given ref (absent ref = 404)
    workflowFiles: new Map([[sha, { ...approvedFile }], [workflowSha, { ...approvedFile }]]),
    // compare results by "base...head"; an unknown pair is a 404
    compares: new Map([[`${sha}...main`, { status: 'ahead' }], [`${workflowSha}...${sha}`, { status: workflowSha === sha ? 'identical' : 'ahead' }]]),
    fail: null, // 'network' | 'forbidden' | 'garbage'
    calls: []
  }
  async function fetchImpl(url, init = {}) {
    state.calls.push(`${init.method ?? 'GET'} ${url}`)
    if ((init.method ?? 'GET') !== 'GET') return json(405, {})
    if (state.fail === 'network') throw new Error('network down')
    if (state.fail === 'forbidden') return json(403, { message: 'rate limit exceeded' })
    if (state.fail === 'garbage') return { ok: true, status: 200, json: async () => { throw new Error('not json') } }
    const p = url.replace('https://api.github.com', '')
    const R = `/repos/${PROVENANCE.REPOSITORY}`
    if (p === R) return json(200, state.repo)
    if (p === `${R}/actions/runs/${runId}`) return json(200, state.run)
    if (p === `${R}/actions/runs/${runId}/artifacts`) return json(200, { total_count: state.artifacts.length, artifacts: state.artifacts })
    let m
    if ((m = p.match(new RegExp(`^${R}/compare/([^.]+)\\.\\.\\.(.+)$`)))) {
      const c = state.compares.get(`${m[1]}...${m[2]}`)
      return c ? json(200, c) : json(404, { message: 'Not Found' })
    }
    if ((m = p.match(new RegExp(`^${R}/contents/(.+)\\?ref=([0-9a-f]+)$`)))) {
      const f = m[1] === PROVENANCE.WORKFLOW_PATH ? state.workflowFiles.get(m[2]) : undefined
      return f ? json(200, f) : json(404, { message: 'Not Found' })
    }
    return json(404, { message: `fake: unhandled ${p}` })
  }
  return { state, fetchImpl }
}
