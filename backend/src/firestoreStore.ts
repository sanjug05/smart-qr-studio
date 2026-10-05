import type { Firestore } from 'firebase-admin/firestore'
import type { DynamicQrRecord } from './types'
import type { QrStore, TransactOutcome } from './store'

export const COLLECTION = 'dynamic_qr'

/** Firestore-backed QrStore. Documents live at `dynamic_qr/{publicId}`; the publicId is the document id, so uniqueness is enforced by Firestore itself. */
export function createFirestoreStore(db: Firestore): QrStore {
  const ref = (publicId: string) => db.collection(COLLECTION).doc(publicId)

  return {
    async get(publicId) {
      const snap = await ref(publicId).get()
      return snap.exists ? (snap.data() as DynamicQrRecord) : null
    },

    async create(record) {
      try {
        // create() fails with ALREADY_EXISTS rather than overwriting — a published publicId can never be reused.
        await ref(record.publicId).create(record)
        return true
      } catch (err) {
        if ((err as { code?: number | string }).code === 6 || (err as { code?: string }).code === 'already-exists') return false
        throw err
      }
    },

    async transact<T>(publicId: string, fn: (r: DynamicQrRecord) => Promise<TransactOutcome<T>>): Promise<T | null> {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(publicId))
        if (!snap.exists) return null
        const { patch, result } = await fn(snap.data() as DynamicQrRecord)
        if (patch) tx.update(ref(publicId), patch as Record<string, unknown>)
        return result
      })
    }
  }
}
