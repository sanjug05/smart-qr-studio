import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH lets this app be deployed under a GitHub Pages project path
// (e.g. https://user.github.io/repo-name/) without a custom domain.
// Set VITE_BASE_PATH="/repo-name/" in CI or a local .env file.
const basePath = process.env.VITE_BASE_PATH || '/'

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
        scope: basePath,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // The landing page must resolve smart-QR slugs client-side even when
        // offline/cached; keep navigation fallback but never cache-poison /q/ data.
        navigateFallbackDenylist: [/^\/api\//]
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
