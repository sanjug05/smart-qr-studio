/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** Build-time plan every visitor runs as: 'free' | 'pro' | 'business'. See src/services/entitlements/entitlementService.ts. */
  readonly VITE_DEFAULT_PLAN?: string
  /** Canonical public URL QR links are built on, e.g. https://sanjugupta.com/qr/ . See src/services/appUrl.ts. */
  readonly VITE_PUBLIC_BASE_URL?: string
  /** Firebase web app config (public identifiers, not secrets). See src/services/firebase/config.ts. */
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
}
