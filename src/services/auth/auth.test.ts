import { describe, it, expect, vi, afterEach } from 'vitest'
import { AuthError, describeAuthError, type AuthService, type AuthState } from './authService'
import { createAuthStore } from './authStore'

function fakeService(initial: AuthState = { status: 'signedOut' }) {
  let listener: ((s: AuthState) => void) | null = null
  const calls = { signIn: 0, signOut: 0, subscribe: 0 }
  const service: AuthService & { emit: (s: AuthState) => void; failSignInWith?: Error } = {
    isAvailable: () => true,
    subscribe(l) {
      calls.subscribe++
      listener = l
      l({ status: 'loading' })
      queueMicrotask(() => l(initial))
      return () => {
        listener = null
      }
    },
    async signInWithGoogle() {
      calls.signIn++
      if (service.failSignInWith) throw service.failSignInWith
      listener?.({ status: 'signedIn', user: { uid: 'u1', displayName: 'Ada Lovelace', email: 'ada@example.com', photoURL: null } })
    },
    async signOut() {
      calls.signOut++
      listener?.({ status: 'signedOut' })
    },
    async getIdToken() {
      return 'id-token'
    },
    emit: (s) => listener?.(s)
  }
  return { service, calls }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('auth store', () => {
  it('starts loading, then settles on the provider state (signed out)', async () => {
    const { service } = fakeService()
    const store = createAuthStore(service)
    expect(store.getState().status).toBe('loading')
    store.start()
    await flush()
    expect(store.getState().status).toBe('signedOut')
  })

  it('restores a persisted session without any user action', async () => {
    const { service } = fakeService({ status: 'signedIn', user: { uid: 'u1', displayName: 'Ada', email: null, photoURL: null } })
    const store = createAuthStore(service)
    store.start()
    await flush()
    const s = store.getState()
    expect(s.status).toBe('signedIn')
    expect(s.status === 'signedIn' && s.user.uid).toBe('u1')
  })

  it('start() is idempotent — one provider subscription however many screens mount', async () => {
    const { service, calls } = fakeService()
    const store = createAuthStore(service)
    store.start()
    store.start()
    store.start()
    expect(calls.subscribe).toBe(1)
  })

  it('sign-in signs the user in and clears the in-progress flag; sign-out returns to signed out', async () => {
    const { service } = fakeService()
    const store = createAuthStore(service)
    store.start()
    await flush()
    const seen: boolean[] = []
    store.subscribe(() => seen.push(store.getState().signingIn))
    await store.signIn()
    expect(store.getState().status).toBe('signedIn')
    expect(store.getState().signingIn).toBe(false)
    expect(seen).toContain(true)
    await store.signOut()
    expect(store.getState().status).toBe('signedOut')
  })

  it('shows a sign-in failure as a friendly message and stays signed out', async () => {
    const { service } = fakeService()
    service.failSignInWith = new AuthError('auth/unauthorized-domain', describeAuthError('auth/unauthorized-domain')!)
    const store = createAuthStore(service)
    store.start()
    await flush()
    await store.signIn()
    expect(store.getState().status).toBe('signedOut')
    expect(store.getState().error).toMatch(/isn.t authorised/)
    store.clearError()
    expect(store.getState().error).toBeNull()
  })

  it('an unexpected error becomes a generic message (never a raw error string)', async () => {
    const { service } = fakeService()
    service.failSignInWith = new Error('INTERNAL: stack trace with secrets')
    const store = createAuthStore(service)
    store.start()
    await flush()
    await store.signIn()
    expect(store.getState().error).toBe('Sign-in failed. Please try again.')
  })

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    const { service } = fakeService()
    const store = createAuthStore(service)
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.start()
    await flush()
    const n = listener.mock.calls.length
    expect(n).toBeGreaterThan(0)
    off()
    await store.signIn()
    expect(listener.mock.calls.length).toBe(n)
  })

  it('an auth state change from elsewhere (another tab signing out) is reflected', async () => {
    const { service } = fakeService({ status: 'signedIn', user: { uid: 'u1', displayName: null, email: null, photoURL: null } })
    const store = createAuthStore(service)
    store.start()
    await flush()
    service.emit({ status: 'signedOut' })
    expect(store.getState().status).toBe('signedOut')
  })
})

describe('describeAuthError', () => {
  it('cancelling the popup is silent (no error shown)', () => {
    expect(describeAuthError('auth/popup-closed-by-user')).toBeNull()
    expect(describeAuthError('auth/cancelled-popup-request')).toBeNull()
  })
  it('known failures get plain-language messages and unknown ones a generic one', () => {
    expect(describeAuthError('auth/popup-blocked')).toMatch(/pop-ups/)
    expect(describeAuthError('auth/unauthorized-domain')).toMatch(/authorised/)
    expect(describeAuthError('auth/operation-not-allowed')).toMatch(/enabled/)
    expect(describeAuthError('auth/network-request-failed')).toMatch(/connection/)
    expect(describeAuthError('auth/something-new')).toBe('Sign-in failed. Please try again.')
  })
})

describe('firebase config gating', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('without Firebase configuration, cloud features are unavailable (the app stays a local tool)', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '')
    const { isCloudConfigured } = await import('@/services/firebase/config')
    expect(isCloudConfigured()).toBe(false)
  })

  it('needs all four values', async () => {
    const { getFirebaseConfig } = await import('@/services/firebase/config')
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'k')
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'a.firebaseapp.com')
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'p')
    vi.stubEnv('VITE_FIREBASE_APP_ID', '')
    expect(getFirebaseConfig()).toBeNull()
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:2:web:3')
    expect(getFirebaseConfig()).toEqual({ apiKey: 'k', authDomain: 'a.firebaseapp.com', projectId: 'p', appId: '1:2:web:3' })
  })
})
