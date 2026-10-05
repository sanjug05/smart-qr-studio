import { getFirebaseApp } from '@/services/firebase/client'
import type { CloudProjectDoc } from './cloudProject'
import { createCloudProjectRepository, type CloudProjectRepository, type DocStore } from './cloudProjectRepository'

type FirestoreModule = typeof import('firebase/firestore')

let dbPromise: Promise<{ db: import('firebase/firestore').Firestore; mod: FirestoreModule }> | null = null

/**
 * Firestore, loaded on demand (only after sign-in). The default in-memory
 * cache is deliberate: signed-in users' data is never persisted to the
 * browser's IndexedDB, and nothing here uses real-time listeners — the
 * library is read when the page asks for it, not polled.
 */
function getDb() {
  if (!dbPromise) {
    dbPromise = Promise.all([getFirebaseApp(), import('firebase/firestore')]).then(([app, mod]) => ({ db: mod.getFirestore(app), mod }))
  }
  return dbPromise
}

const firestoreDocStore: DocStore = {
  async get(path) {
    const { db, mod } = await getDb()
    const snap = await mod.getDoc(mod.doc(db, path))
    return snap.exists() ? snap.data() : null
  },
  async set(path, data: CloudProjectDoc) {
    const { db, mod } = await getDb()
    await mod.setDoc(mod.doc(db, path), data)
  },
  async remove(path) {
    const { db, mod } = await getDb()
    await mod.deleteDoc(mod.doc(db, path))
  },
  async list(collectionPath, max) {
    const { db, mod } = await getDb()
    const snap = await mod.getDocs(mod.query(mod.collection(db, collectionPath), mod.limit(max)))
    return snap.docs.map((d) => d.data())
  }
}

export const cloudProjectRepository: CloudProjectRepository = createCloudProjectRepository(firestoreDocStore)
