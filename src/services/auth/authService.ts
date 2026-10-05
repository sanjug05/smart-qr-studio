import { getFirebaseApp } from '@/services/firebase/client'
import { isCloudConfigured } from '@/services/firebase/config'

/** What the UI knows about a signed-in person. The Google access token is never exposed or stored — only Firebase Auth manages credentials. */
export interface AuthUser {
  uid: string
  displayName: string | null
  email: string | null
  photoURL: string | null
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser }

/**
 * The only way the app talks to an identity provider. The Firebase
 * implementation is below; tests use a fake. Consumers never import
 * firebase/auth directly.
 */
export interface AuthService {
  /** False when this build has no Firebase configuration (cloud features off). */
  isAvailable(): boolean
  /** Calls `listener` with the current state, then on every change. Returns an unsubscribe function. */
  subscribe(listener: (state: AuthState) => void): () => void
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
  /** A fresh, valid Firebase ID token for the backend, or null when signed out. */
  getIdToken(): Promise<string | null>
}

/** Thrown for sign-in failures worth telling the user about (cancelling the popup is not one). */
export class AuthError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

/** Maps Firebase Auth error codes to short, plain-language messages. Returns null for deliberate cancellations. */
export function describeAuthError(code: string): string | null {
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return null
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
    case 'auth/unauthorized-domain':
      return "This website isn't authorised for Google sign-in yet."
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
      return "Google sign-in isn't enabled for this app yet."
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return "Sign-in isn't configured correctly for this site."
    case 'auth/network-request-failed':
      return 'Could not reach Google. Check your connection and try again.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    default:
      return 'Sign-in failed. Please try again.'
  }
}

function toAuthUser(u: { uid: string; displayName: string | null; email: string | null; photoURL: string | null }): AuthUser {
  return { uid: u.uid, displayName: u.displayName, email: u.email, photoURL: u.photoURL }
}

class FirebaseAuthService implements AuthService {
  isAvailable(): boolean {
    return isCloudConfigured()
  }

  private authPromise: Promise<import('firebase/auth').Auth> | null = null

  private getAuthInstance() {
    if (!this.authPromise) {
      this.authPromise = Promise.all([getFirebaseApp(), import('firebase/auth')]).then(([app, mod]) => mod.getAuth(app))
    }
    return this.authPromise
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    if (!this.isAvailable()) {
      listener({ status: 'unavailable' })
      return () => undefined
    }
    listener({ status: 'loading' })
    let unsubscribe: (() => void) | null = null
    let cancelled = false

    Promise.all([this.getAuthInstance(), import('firebase/auth')])
      .then(([auth, mod]) => {
        if (cancelled) return
        // Completes a sign-in that started with a redirect (mobile / popup-blocked fallback); errors surface via the next state.
        void mod.getRedirectResult(auth).catch(() => undefined)
        unsubscribe = mod.onAuthStateChanged(
          auth,
          (user) => listener(user ? { status: 'signedIn', user: toAuthUser(user) } : { status: 'signedOut' }),
          () => listener({ status: 'signedOut' })
        )
      })
      .catch(() => listener({ status: 'unavailable' }))

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }

  async signInWithGoogle(): Promise<void> {
    const [auth, mod] = await Promise.all([this.getAuthInstance(), import('firebase/auth')])
    const provider = new mod.GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    try {
      await mod.signInWithPopup(auth, provider)
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown'
      // Popups can be blocked or unsupported (some mobile / in-app browsers) — fall back to a full-page redirect.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await mod.signInWithRedirect(auth, provider)
        return
      }
      const message = describeAuthError(code)
      if (message === null) return
      throw new AuthError(code, message)
    }
  }

  async signOut(): Promise<void> {
    const [auth, mod] = await Promise.all([this.getAuthInstance(), import('firebase/auth')])
    await mod.signOut(auth)
  }

  async getIdToken(): Promise<string | null> {
    if (!this.isAvailable()) return null
    const auth = await this.getAuthInstance()
    return auth.currentUser ? auth.currentUser.getIdToken() : null
  }
}

export const authService: AuthService = new FirebaseAuthService()
