/**
 * Firebase *web app* configuration. These four values are public client
 * identifiers (they ship in every Firebase web app's JavaScript and are
 * protected by Firestore rules + Auth authorized domains, not by secrecy) —
 * they are still supplied at build time rather than hard-coded, so each
 * deployment points at its own project.
 *
 * Absent or incomplete configuration means cloud features (sign-in, cloud
 * library) are simply unavailable and the app behaves as a fully local tool.
 */
export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

export function getFirebaseConfig(): FirebaseWebConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim()
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim()
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim()
  const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim()
  if (!apiKey || !authDomain || !projectId || !appId) return null
  return { apiKey, authDomain, projectId, appId }
}

export function isCloudConfigured(): boolean {
  return getFirebaseConfig() !== null
}
