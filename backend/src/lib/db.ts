import type { DynamicQrRecord, Env } from '../types'

export async function getByPublicId(env: Env, publicId: string): Promise<DynamicQrRecord | null> {
  const row = await env.DB.prepare('SELECT * FROM dynamic_qr WHERE public_id = ?').bind(publicId).first<DynamicQrRecord>()
  return row ?? null
}
