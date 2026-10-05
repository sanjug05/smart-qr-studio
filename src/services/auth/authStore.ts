import { authService, AuthError, type AuthService, type AuthState, type AuthUser } from './authService'

/** Auth state as the UI sees it: the provider's state plus the last sign-in error to show. */
export type AuthViewState = AuthState & { error: string | null; signingIn: boolean }

export interface AuthStore {
  getState(): AuthViewState
  subscribe(listener: () => void): () => void
  /** Begins listening to the provider (idempotent). Called once when a studio screen mounts. */
  start(): void
  signIn(): Promise<void>
  signOut(): Promise<void>
  clearError(): void
}

/**
 * A tiny external store (compatible with React's `useSyncExternalStore`)
 * over an `AuthService`. Kept free of React so the sign-in/out/restore
 * logic is unit-tested directly with a fake service.
 */
export function createAuthStore(service: AuthService): AuthStore {
  let state: AuthViewState = { status: 'loading', error: null, signingIn: false }
  const listeners = new Set<() => void>()
  let started = false

  const set = (next: Partial<AuthViewState> & { status?: AuthState['status'] }) => {
    state = { ...state, ...next } as AuthViewState
    listeners.forEach((l) => l())
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      if (started) return
      started = true
      service.subscribe((s) => {
        // A fresh provider state replaces the previous one wholesale; only the error/signingIn UI flags carry over.
        state = { ...s, error: state.error, signingIn: s.status === 'signedIn' ? false : state.signingIn } as AuthViewState
        listeners.forEach((l) => l())
      })
    },
    async signIn() {
      set({ signingIn: true, error: null })
      try {
        await service.signInWithGoogle()
      } catch (err) {
        set({ error: err instanceof AuthError ? err.message : 'Sign-in failed. Please try again.' })
      } finally {
        set({ signingIn: false })
      }
    },
    async signOut() {
      try {
        await service.signOut()
      } catch {
        set({ error: 'Could not sign out. Please try again.' })
      }
    },
    clearError: () => set({ error: null })
  }
}

export const authStore: AuthStore = createAuthStore(authService)

export function signedInUser(state: AuthViewState): AuthUser | null {
  return state.status === 'signedIn' ? state.user : null
}
