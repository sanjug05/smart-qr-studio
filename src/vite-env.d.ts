/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** Build-time plan every visitor runs as: 'free' | 'pro' | 'business'. See src/services/entitlements/entitlementService.ts. */
  readonly VITE_DEFAULT_PLAN?: string
}
