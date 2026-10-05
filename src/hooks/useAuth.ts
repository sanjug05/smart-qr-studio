import { useEffect, useSyncExternalStore } from 'react'
import { authStore, signedInUser } from '@/services/auth/authStore'

/**
 * Current sign-in state for studio screens. Starts listening to Firebase
 * Auth on first use (so the SDK loads only for screens that need it, never
 * for the customer landing page) and re-renders on every change.
 */
export function useAuth() {
  useEffect(() => {
    authStore.start()
  }, [])

  const state = useSyncExternalStore(authStore.subscribe, authStore.getState, authStore.getState)
  return {
    state,
    user: signedInUser(state),
    status: state.status,
    error: state.error,
    signingIn: state.signingIn,
    signIn: authStore.signIn,
    signOut: authStore.signOut,
    clearError: authStore.clearError
  }
}
