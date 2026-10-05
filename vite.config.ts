import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH lets this app be deployed under a GitHub Pages project path
// (e.g. https://user.github.io/repo-name/) without a custom domain.
// Set VITE_BASE_PATH="/repo-name/" in CI or a local .env file.
const basePath = process.env.VITE_BASE_PATH || '/'

// The PWA's service-worker/manifest scope. Defaults to the base path. The
// sanjugupta.com deployment sets VITE_PWA_SCOPE=/qr (no trailing slash):
// that host redirects /qr/ to /qr, and a '/qr/' scope would leave the page
// the user actually lands on outside the service worker's control. It is
// still strictly under /qr — never the site root, never /learning. A scope
// broader than the worker's directory needs the Service-Worker-Allowed
// response header, which that host's config provides for /qr/sw.js.
const pwaScope = process.env.VITE_PWA_SCOPE || basePath

export default defineConfig({
  base: basePath,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' hands control to the app's own UpdateAvailable banner
      // (src/hooks/usePwaUpdate.tsx) instead of silently swapping the
      // service worker and reloading behind the user's back. Registration
      // is done manually via `virtual:pwa-register/react`, so nothing
      // needs injecting into index.html.
      registerType: 'prompt',
      injectRegister: false,
      scope: pwaScope,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Smart QR Studio',
        short_name: 'QR Studio',
        description: 'Create branded, multi-destination QR codes.',
        theme_color: '#141417',
        // Matches the app's actual light background (--color-bg in
        // global.css), not the dark theme_color — this is what paints
        // behind the splash icon on first launch, and a dark flash before
        // a light UI reads as broken rather than premium.
        background_color: '#f6f6f8',
        display: 'standalone',
        start_url: basePath,
        scope: pwaScope,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // The landing page must resolve smart-QR slugs client-side even when
        // offline/cached; keep navigation fallback but never cache-poison /q/ data.
        // Never serve the app shell for backend or auth-handler paths. There is deliberately no
        // runtimeCaching rule: Dynamic QR API responses and Firebase/Firestore traffic (all
        // cross-origin) are never cached by the service worker.
        navigateFallbackDenylist: [/^\/api\//, /^\/__\//]
      }
    })
  ],
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  server: {
    port: 5173
  }
})
