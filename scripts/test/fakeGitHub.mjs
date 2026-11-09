// In-memory fake of the PUBLIC GitHub REST endpoints the publisher's provenance gate reads (GET only).
import { PROVENANCE } from '../lib/qrPublisher.mjs'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

export function makeFakeGitHub({ sha, runId, zipSha256 }) {
  const state = {
    repo: { id: PROVENANCE.REPOSITORY_ID, full_name: PROVENANCE.REPOSITORY, private: false },
    run: {
      id: Number(runId), event: 'push', head_branch: 'main', head_sha: sha, status: 'completed', conclusion: 'success',
      path: PROVENANCE.WORKFLOW_PATH, workflow_id: PROVENANCE.WORKFLOW_ID,
      repository: { id: PROVENANCE.REPOSITORY_ID, full_name: PROVENANCE.REPOSITORY }, head_repository: { id: PROVENANCE.REPOSITORY_ID }
    },
    artifacts: [{ name: `${PROVENANCE.ARTIFACT_PREFIX}${sha}`, expired: false, digest: `sha256:${zipSha256}`, workflow_run: { id: Number(runId), head_sha: sha, head_branch: 'main' } }],
    compare: { status: 'ahead' },
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
    if (p === `/repos/${PROVENANCE.REPOSITORY}`) return json(200, state.repo)
    if (p === `/repos/${PROVENANCE.REPOSITORY}/actions/runs/${runId}`) return json(200, state.run)
    if (p === `/repos/${PROVENANCE.REPOSITORY}/actions/runs/${runId}/artifacts`) return json(200, { total_count: state.artifacts.length, artifacts: state.artifacts })
    if (p === `/repos/${PROVENANCE.REPOSITORY}/compare/${sha}...main`) return json(200, state.compare)
    return json(404, { message: `fake: unhandled ${p}` })
  }
  return { state, fetchImpl }
}
