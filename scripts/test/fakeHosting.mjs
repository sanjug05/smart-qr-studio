// In-memory fake of the parts of the Firebase Hosting REST API and Google tokeninfo that the publisher uses.
// It is deliberately lenient about project and site names (it serves any), so that disabling a project/site guard in a
// mutation test lets the request through instead of being masked by a 404 from the fake.
import { randomBytes } from 'node:crypto'
import { LIMITS, QR_HEADER_RULES, UPLOAD_PREFIX, sha256 } from '../lib/qrPublisher.mjs'

const hex16 = () => randomBytes(8).toString('hex')
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body })

export const goodTokenInfo = () => ({ email: LIMITS.PUBLISHER_SA, scope: 'https://www.googleapis.com/auth/firebase.hosting https://www.googleapis.com/auth/userinfo.email', expires_in: '800', email_verified: 'true' })

export function makeFakeHosting({ liveId = '5840d3114ef43906', nonQrFiles, qrFiles = {}, nonQrHeaders, pageSize = 4, tokenInfo = goodTokenInfo() } = {}) {
  const state = {
    versions: new Map(),
    channels: new Map(),
    blobs: new Set(),
    calls: [],
    writes: [],
    tokenInfo,
    pageSize,
    hooks: {} // afterFinalize(version, state), beforeRelease(state)
  }
  const liveFiles = new Map(Object.entries({ ...nonQrFiles, ...qrFiles }))
  const liveConfig = {
    headers: [...nonQrHeaders, ...QR_HEADER_RULES.map((r) => JSON.parse(JSON.stringify(r)))],
    redirects: [{ source: '/old', destination: '/new', type: 301 }],
    rewrites: [{ glob: '/app/**', path: '/app/index.html' }],
    cleanUrls: true,
    trailingSlashBehavior: 'REMOVE'
  }
  const liveName = `projects/ais-channel-os/sites/sanjugupta-web/versions/${liveId}`
  state.versions.set(liveId, { name: liveName, status: 'FINALIZED', config: liveConfig, files: liveFiles })
  state.channels.set('live', { name: 'channels/live', url: 'https://sanjugupta.com', version: liveId })
  state.channels.set('qr-preview', { name: 'channels/qr-preview', url: 'https://preview.example/qr-preview', version: 'e9c6bded91a2d537' })
  for (const h of liveFiles.values()) state.blobs.add(h)

  const verOf = (name) => state.versions.get(String(name).split('/').pop())

  async function fetchImpl(url, init = {}) {
    const method = init.method ?? 'GET'
    state.calls.push(`${method} ${url}`)
    if (url === 'https://oauth2.googleapis.com/tokeninfo') return state.tokenInfo.__reject ? json(400, { error: 'invalid_token' }) : json(200, state.tokenInfo)
    const isUpload = url.startsWith(UPLOAD_PREFIX)
    if (method !== 'GET') state.writes.push(`${method} ${url}`)
    if (isUpload) {
      state.blobs.add(url.split('/').pop())
      return json(200, {})
    }
    const path = url.replace('https://firebasehosting.googleapis.com/v1beta1/', '')
    let m
    if (method === 'DELETE') return json(200, {})
    if (method === 'GET' && (m = path.match(/channels\/([^/?]+)$/))) {
      const c = state.channels.get(m[1])
      if (!c) return json(404, { error: { status: 'NOT_FOUND' } })
      const v = state.versions.get(c.version)
      return json(200, { name: c.name, url: c.url, release: v ? { version: { name: v.name, config: v.config } } : undefined })
    }
    if (method === 'GET' && (m = path.match(/versions\/([0-9a-f]+)\/files(?:\?(.*))?$/))) {
      const v = state.versions.get(m[1])
      if (!v) return json(404, {})
      const q = new URLSearchParams(m[2] ?? '')
      const all = [...v.files].sort(([a], [b]) => (a < b ? -1 : 1))
      const start = Number(q.get('pageToken') || 0)
      const page = all.slice(start, start + state.pageSize)
      return json(200, { files: page.map(([p, h]) => ({ path: p, hash: h, status: 'ACTIVE' })), nextPageToken: start + state.pageSize < all.length ? String(start + state.pageSize) : undefined })
    }
    if (method === 'GET' && (m = path.match(/versions\/([0-9a-f]+)$/))) {
      const v = state.versions.get(m[1])
      return v ? json(200, { name: v.name, status: v.status, config: v.config }) : json(404, {})
    }
    if (method === 'POST' && /\/versions$/.test(path)) {
      const id = hex16()
      const body = JSON.parse(init.body)
      state.versions.set(id, { name: `projects/ais-channel-os/sites/sanjugupta-web/versions/${id}`, status: 'CREATED', config: body.config, files: new Map() })
      return json(200, { name: `projects/ais-channel-os/sites/sanjugupta-web/versions/${id}` })
    }
    if (method === 'POST' && (m = path.match(/versions\/([0-9a-f]+):populateFiles$/))) {
      const v = state.versions.get(m[1])
      const files = JSON.parse(init.body).files
      v.files = new Map(Object.entries(files))
      const need = [...new Set(Object.values(files))].filter((h) => !state.blobs.has(h))
      return json(200, { uploadRequiredHashes: need, uploadUrl: `${UPLOAD_PREFIX}upload/${v.name}/files` })
    }
    if (method === 'PATCH' && (m = path.match(/versions\/([0-9a-f]+)\?updateMask=status$/))) {
      const v = state.versions.get(m[1])
      v.status = 'FINALIZED'
      state.hooks.afterFinalize?.(v, state)
      return json(200, {})
    }
    if (method === 'POST' && (m = path.match(/channels\?channelId=([^&]+)$/))) {
      const id = decodeURIComponent(m[1])
      state.channels.set(id, { name: `channels/${id}`, url: `https://sanjugupta-web--${id}.web.app`, version: undefined })
      return json(200, {})
    }
    if (method === 'POST' && (m = path.match(/channels\/([^/]+)\/releases\?versionName=(.+)$/))) {
      state.hooks.beforeRelease?.(state)
      const c = state.channels.get(m[1])
      const v = verOf(decodeURIComponent(m[2]))
      if (!c || !v) return json(404, {})
      c.version = decodeURIComponent(m[2]).split('/').pop()
      return json(200, { name: `projects/ais-channel-os/sites/sanjugupta-web/channels/${m[1]}/releases/${hex16()}` })
    }
    return json(404, { error: { message: `fake: unhandled ${method} ${path}` } })
  }
  return {
    state,
    fetchImpl,
    liveId,
    liveVersion: () => state.channels.get('live').version,
    writes: () => state.writes.length,
    releasesTo: (c) => state.writes.filter((w) => w.includes(`channels/${c}/releases`)).length,
    sha: sha256
  }
}
