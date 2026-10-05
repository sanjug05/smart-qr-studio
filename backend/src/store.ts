import type { DynamicQrRecord } from './types'

/**
 * The only persistence surface the API uses. Two implementations: Firestore
 * (firestoreStore.ts, production) and an in-memory one (memoryStore.ts,
 * tests). Everything above this interface — routing, validation,
 * authorization, entitlement — is storage-agnostic.
 */
export interface QrStore {
  get(publicId: string): Promise<DynamicQrRecord | null>
  /** Inserts a new record. Resolves false (and writes nothing) if `publicId` already exists. */
  create(record: DynamicQrRecord): Promise<boolean>
  /**
   * Reads the record and applies `fn`'s patch in ONE atomic read-modify-write,
   * so concurrent writers serialize and a version increment is never lost.
   * `fn` may run more than once (Firestore retries contended transactions),
   * so it must be pure. Returns `fn`'s result, or `null` if no such record.
   */
  transact<T>(publicId: string, fn: (record: DynamicQrRecord) => Promise<TransactOutcome<T>>): Promise<T | null>
}

export interface TransactOutcome<T> {
  /** Fields to merge into the stored record; omit to leave it untouched (e.g. authorization failed). */
  patch?: Partial<DynamicQrRecord>
  result: T
}
