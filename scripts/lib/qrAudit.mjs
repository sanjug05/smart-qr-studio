// Read-only audit: compares the CURRENT live Hosting version of sanjugupta-web with the "after" state recorded in a
// release receipt. GET requests only (the client is created read-only, so a write cannot even be attempted).
// The token must belong to the dedicated read-only Hosting identity and carry exactly the read-only scope.
import { GUARDS, LIMITS, READ_POLICY, canonicalSha, isQrPath, listFiles, makeClient, routes, verifyToken } from './qrPublisher.mjs'

/**
 * @param {{ receipt: object, fetchImpl: typeof fetch, token: string, guards?: typeof GUARDS }} a
 * @returns {Promise<{ pass: boolean, token: object, liveVersion: string, files: number, receiptFiles: number, configSame: boolean, diffs: [string, string][], outsideQr: number, calls: string[] }>}
 */
export async function runAudit({ receipt, fetchImpl, token, guards = GUARDS }) {
  guards.tokenPresent({ token })
  const tokenInfo = await verifyToken({ fetchImpl, token, guards, policy: READ_POLICY })
  const client = makeClient({ fetchImpl, token, project: LIMITS.PROJECT, site: LIMITS.SITE, mode: 'audit', channel: 'live', readOnly: true })
  const live = await client.read(routes.channel(LIMITS.PROJECT, LIMITS.SITE, 'live'))
  const liveName = live.release.version.name
  const files = await listFiles(client, liveName)
  const want = new Map(receipt.after.files.map((f) => [f.path, f.hash]))
  const added = [...files.keys()].filter((p) => !want.has(p))
  const removed = [...want.keys()].filter((p) => !files.has(p))
  const changed = [...files].filter(([p, h]) => want.has(p) && want.get(p) !== h).map(([p]) => p)
  const diffs = [...added.map((p) => ['ADDED', p]), ...removed.map((p) => ['REMOVED', p]), ...changed.map((p) => ['CHANGED', p])]
  const configSame = canonicalSha(live.release.version.config ?? {}) === receipt.after.configSha256
  return {
    pass: diffs.length === 0 && configSame,
    token: tokenInfo,
    liveVersion: liveName.split('/').pop(),
    files: files.size,
    receiptFiles: want.size,
    configSame,
    diffs,
    outsideQr: diffs.filter(([, p]) => !isQrPath(p)).length,
    calls: client.state.log
  }
}
