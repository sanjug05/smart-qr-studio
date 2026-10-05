import type { FirebaseApp } from 'firebase/app'
import { getFirebaseConfig } from './config'

let appPromise: Promise<FirebaseApp> | null = null

/**
 * The shared Firebase app, created lazily and dynamically imported, so the
 * Firebase SDK is never part of the customer-facing landing page (a scan
 * must stay fast, and needs no sign-in) — only studio screens that actually
 * use cloud features ever load it.
 */
export function getFirebaseApp(): Promise<FirebaseApp> {
  if (!appPromise) {
    const config = getFirebaseConfig()
    if (!config) return Promise.reject(new Error('Cloud sign-in is not configured for this build.'))
    appPromise = import('firebase/app').then(({ initializeApp, getApps }) => (getApps()[0] ?? initializeApp(config)))
  }
  return appPromise
}
