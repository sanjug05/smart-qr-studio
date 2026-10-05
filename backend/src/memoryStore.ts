import type { DynamicQrRecord } from './types'
import type { QrStore, TransactOutcome } from './store'

/** In-memory QrStore for tests — same contract as Firestore, including serialized transactions per record. */
export function createMemoryStore(): QrStore & { records: Map<string, DynamicQrRecord> } {
  const records = new Map<string, DynamicQrRecord>()
  const locks = new Map<string, Promise<unknown>>()

  return {
    records,
    async get(publicId) {
      const r = records.get(publicId)
      return r ? structuredClone(r) : null
    },
    async create(record) {
      if (records.has(record.publicId)) return false
      records.set(record.publicId, structuredClone(record))
      return true
    },
    async transact<T>(publicId: string, fn: (r: DynamicQrRecord) => Promise<TransactOutcome<T>>): Promise<T | null> {
      const prior = locks.get(publicId) ?? Promise.resolve()
      const run = prior.then(async () => {
        const current = records.get(publicId)
        if (!current) return null
        const { patch, result } = await fn(structuredClone(current))
        if (patch) records.set(publicId, { ...current, ...structuredClone(patch) })
        return result
      })
      locks.set(publicId, run.catch(() => undefined))
      return run
    }
  }
}
