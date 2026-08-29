import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor is not initialized (no android/ios platforms are checked in) —
 * this config is the day-one groundwork so wrapping the web build as a
 * native app later is `npx cap add android|ios`, not a rewrite. See
 * README → "Android/iOS packaging" for the full walkthrough.
 *
 * webDir points at the Vite production build. All storage/QR/generation
 * code already avoids browser-only assumptions that would break inside a
 * Capacitor WebView (see src/services/storage for the abstraction that
 * makes swapping localStorage for @capacitor/preferences a one-file change).
 */
const config: CapacitorConfig = {
  appId: 'com.smartqrstudio.app',
  appName: 'Smart QR Studio',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
}

export default config
