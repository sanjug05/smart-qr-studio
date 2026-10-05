/**
 * Firestore security-rules test cases, defined once and run two ways:
 *   - rules-test/rules.emulator.test.ts  (emulator + @firebase/rules-unit-testing — used in CI)
 *   - scripts/run-rules-cases-remote.cjs  (Google's firebaserules test API — works without Java)
 *
 * A case: { name, expect: 'allow' | 'deny', method: 'get' | 'create' | 'update' | 'delete',
 *           uid: string | null (null = unauthenticated), path, existing?: doc | null, data?: doc }
 */
const A = 'uid-alice'
const B = 'uid-bob'
const NOW = 1790000000000 // epoch ms — cloud docs store timestamps as integers

function project(id, over = {}) {
  return {
    schemaVersion: 1,
    id,
    slug: 'abcd1234',
    qrMode: 'static',
    brand: { companyName: 'Acme', tagline: 'Hello', primaryColor: '#141417', secondaryColor: '#6D5EF9', backgroundColor: '#FFFFFF' },
    destinations: [{ id: 'd0', type: 'website', label: 'Site', url: 'https://example.com', icon: '🌐', enabled: true, order: 0 }],
    qrStyle: { moduleStyle: 'rounded', size: 480, quietZone: 16, foregroundColor: '#141417', backgroundColor: '#FFFFFF', transparentBackground: false, brandingStyle: 'none' },
    designConfig: { template: 'clean', headline: 'Scan to Explore', ctaText: 'Scan to explore' },
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...over
  }
}

const P = (uid, id) => `users/${uid}/projects/${id}`
const bigString = (n) => 'x'.repeat(n)

const cases = [
  // ---- reads ----
  { name: 'owner can read own project', expect: 'allow', method: 'get', uid: A, path: P(A, 'p1'), existing: project('p1') },
  { name: "user B cannot read user A's project", expect: 'deny', method: 'get', uid: B, path: P(A, 'p1'), existing: project('p1') },
  { name: 'unauthenticated cannot read a project', expect: 'deny', method: 'get', uid: null, path: P(A, 'p1'), existing: project('p1') },

  // ---- create ----
  { name: 'owner can create own project at version 1', expect: 'allow', method: 'create', uid: A, path: P(A, 'p2'), data: project('p2') },
  { name: 'owner can create a dynamic project (publicId only, no token)', expect: 'allow', method: 'create', uid: A, path: P(A, 'p3'), data: project('p3', { qrMode: 'dynamic', dynamicQr: { publicId: 'AbC123xyz789', createdAt: 'x' } }) },
  { name: "user B cannot create under user A's path", expect: 'deny', method: 'create', uid: B, path: P(A, 'p2'), data: project('p2') },
  { name: 'unauthenticated cannot create', expect: 'deny', method: 'create', uid: null, path: P(A, 'p2'), data: project('p2') },
  { name: 'create must start at version 1', expect: 'deny', method: 'create', uid: A, path: P(A, 'p2'), data: project('p2', { version: 7 }) },
  { name: 'document id must match the path id', expect: 'deny', method: 'create', uid: A, path: P(A, 'p2'), data: project('other') },
  { name: 'unknown fields are rejected (e.g. a management token)', expect: 'deny', method: 'create', uid: A, path: P(A, 'p3'), data: project('p3', { managementToken: 'secret' }) },
  { name: 'unknown fields are rejected (e.g. a forged ownerId)', expect: 'deny', method: 'create', uid: A, path: P(A, 'p3'), data: project('p3', { ownerId: B }) },
  { name: 'a dynamicQr block requires qrMode dynamic', expect: 'deny', method: 'create', uid: A, path: P(A, 'p3'), data: project('p3', { qrMode: 'static', dynamicQr: { publicId: 'AbC123xyz789', createdAt: NOW } }) },
  { name: 'more than 5 destinations is rejected', expect: 'deny', method: 'create', uid: A, path: P(A, 'p4'), data: project('p4', { destinations: Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, label: 'x', url: 'https://example.com', enabled: true, order: i })) }) },
  { name: 'oversized company name is rejected', expect: 'deny', method: 'create', uid: A, path: P(A, 'p4'), data: project('p4', { brand: { ...project('p4').brand, companyName: bigString(121) } }) },
  { name: 'oversized logo data URL is rejected (cost guard)', expect: 'deny', method: 'create', uid: A, path: P(A, 'p4'), data: project('p4', { brand: { ...project('p4').brand, logoDataUrl: 'data:image/png;base64,' + bigString(300001) } }) },
  { name: 'a modest logo is accepted', expect: 'allow', method: 'create', uid: A, path: P(A, 'p4'), data: project('p4', { brand: { ...project('p4').brand, logoDataUrl: 'data:image/png;base64,' + bigString(2000) } }) },
  { name: 'wrong schemaVersion is rejected', expect: 'deny', method: 'create', uid: A, path: P(A, 'p2'), data: project('p2', { schemaVersion: 2 }) },

  // ---- update ----
  { name: 'owner can update with the next version', expect: 'allow', method: 'update', uid: A, path: P(A, 'p1'), existing: project('p1'), data: project('p1', { version: 2, updatedAt: NOW + 3600000 }) },
  { name: 'a stale write (same version) is rejected — no silent overwrite', expect: 'deny', method: 'update', uid: A, path: P(A, 'p1'), existing: project('p1', { version: 3 }), data: project('p1', { version: 3 }) },
  { name: 'a write that skips versions is rejected', expect: 'deny', method: 'update', uid: A, path: P(A, 'p1'), existing: project('p1', { version: 2 }), data: project('p1', { version: 5 }) },
  { name: 'a write built on an older version than the cloud has is rejected', expect: 'deny', method: 'update', uid: A, path: P(A, 'p1'), existing: project('p1', { version: 4 }), data: project('p1', { version: 2 }) },
  { name: "user B cannot update user A's project", expect: 'deny', method: 'update', uid: B, path: P(A, 'p1'), existing: project('p1'), data: project('p1', { version: 2 }) },
  { name: 'unauthenticated cannot update', expect: 'deny', method: 'update', uid: null, path: P(A, 'p1'), existing: project('p1'), data: project('p1', { version: 2 }) },
  { name: 'createdAt is immutable', expect: 'deny', method: 'update', uid: A, path: P(A, 'p1'), existing: project('p1'), data: project('p1', { version: 2, createdAt: 1577836800000 }) },
  { name: 'id is immutable', expect: 'deny', method: 'update', uid: A, path: P(A, 'p1'), existing: project('p1'), data: project('p1', { version: 2, id: 'p9' }) },

  // ---- delete ----
  { name: 'owner can delete own project', expect: 'allow', method: 'delete', uid: A, path: P(A, 'p1'), existing: project('p1') },
  { name: "user B cannot delete user A's project", expect: 'deny', method: 'delete', uid: B, path: P(A, 'p1'), existing: project('p1') },
  { name: 'unauthenticated cannot delete', expect: 'deny', method: 'delete', uid: null, path: P(A, 'p1'), existing: project('p1') },

  // ---- everything else is denied ----
  { name: 'nobody can read a Dynamic QR record directly (Admin SDK only)', expect: 'deny', method: 'get', uid: A, path: 'dynamic_qr/AbC123xyz789', existing: { publicId: 'AbC123xyz789', tokenHash: 'h', ownerId: A } },
  { name: 'nobody can write a Dynamic QR record directly', expect: 'deny', method: 'create', uid: A, path: 'dynamic_qr/AbC123xyz789', data: { publicId: 'AbC123xyz789', tokenHash: 'h', ownerId: A } },
  { name: 'users cannot write other documents under their own uid', expect: 'deny', method: 'create', uid: A, path: `users/${A}/settings/prefs`, data: { x: 1 } },
  { name: 'users cannot write a root user document', expect: 'deny', method: 'create', uid: A, path: `users/${A}`, data: { x: 1 } },
  { name: 'arbitrary collections are denied', expect: 'deny', method: 'get', uid: A, path: 'anything/else', existing: { a: 1 } }
]

module.exports = { cases, project, A, B }
