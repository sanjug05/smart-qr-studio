/**
 * The one place management-token logic is allowed to live on the frontend.
 * No other module reads or writes this token, builds an Authorization
 * header, or touches the localStorage key below — every dynamic-QR service
 * call goes through here instead (see httpDynamicQrService.ts).
 *
 * This is deliberately swappable: today's anonymous V1 scheme (a per-QR
 * secret stored locally on whichever device created it) can be replaced by
 * a real authenticated-session lookup later — e.g. "does the logged-in
 * user own this publicId" instead of "does this device have the token" —
 * by changing only this file's implementation. `publicId`, the Dynamic QR
 * URL, the public resolution API, and the database schema concept are
 * untouched by that migration (see README → "Future account migration").
 *
 * The public QR identifier is never itself authorization — a management
 * token must be presented for every write. Tokens live only in
 * localStorage (a *local draft/credential cache*, not the source of
 * truth for published content — see README → "Local storage") and are
 * never embedded in the QR artwork or the printed URL.
 */
export interface DynamicQrAuthorizationService {
  storeToken(publicId: string, token: string): void
  getToken(publicId: string): string | null
  hasToken(publicId: string): boolean
  clearToken(publicId: string): void
  /** Builds the header set a management request (create/update/status) must send. */
  authorizationHeaders(publicId: string): Record<string, string>
}

const STORAGE_KEY = 'smart-qr-studio:dynamic-qr-tokens:v1'

type TokenMap = Record<string, string>

class LocalStorageDynamicQrAuthorizationService implements DynamicQrAuthorizationService {
  private read(): TokenMap {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return {}
      const parsed: unknown = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? (parsed as TokenMap) : {}
    } catch {
      return {}
    }
  }

  private write(map: TokenMap): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    } catch {
      // Best-effort — losing the local token cache means this device can no
      // longer publish changes to this Dynamic QR, but never affects the
      // already-published content the backend serves to scanners.
    }
  }

  storeToken(publicId: string, token: string): void {
    const map = this.read()
    map[publicId] = token
    this.write(map)
  }

  getToken(publicId: string): string | null {
    return this.read()[publicId] ?? null
  }

  hasToken(publicId: string): boolean {
    return this.getToken(publicId) !== null
  }

  clearToken(publicId: string): void {
    const map = this.read()
    delete map[publicId]
    this.write(map)
  }

  authorizationHeaders(publicId: string): Record<string, string> {
    const token = this.getToken(publicId)
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
}

export const dynamicQrAuthorizationService: DynamicQrAuthorizationService = new LocalStorageDynamicQrAuthorizationService()
