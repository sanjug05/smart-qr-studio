import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

interface PwaUpdateContextValue {
  needRefresh: boolean
  applyUpdate: () => Promise<void>
  dismiss: () => void
}

const PwaUpdateContext = createContext<PwaUpdateContextValue | null>(null)

/**
 * Registers the service worker exactly once for the whole app lifetime —
 * mounted at the root, above the router, so it runs regardless of which
 * route (studio or the customer-facing /q/:slug landing page) the user
 * lands on first. That's what keeps offline support working for both.
 *
 * registerType: 'prompt' (vite.config.ts) means Workbox will never swap
 * the active service worker or reload the page on its own — a new build
 * sits "waiting" until `applyUpdate()` is called from the UI the user
 * actually sees (PwaUpdateBanner, rendered only on studio routes so a
 * customer who just scanned a QR is never shown an app-update prompt).
 */
export function PwaUpdateProvider({ children }: { children: ReactNode }) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({ immediate: true })

  const applyUpdate = useCallback(async () => {
    await updateServiceWorker(true)
    // updateServiceWorker's own reload is conditioned on workbox-window
    // reporting the *controlling* change as an update to an
    // already-controlled page — in testing this didn't always fire
    // promptly, which would otherwise leave the tab running old JS/CSS
    // against a service worker that has already swapped underneath it
    // (exactly the mixed old/new asset state this flow must avoid). This
    // fallback fires only if that reload hasn't already happened —
    // navigation clears pending timers, so it's a no-op once the page is
    // already on its way out.
    window.setTimeout(() => window.location.reload(), 1500)
  }, [updateServiceWorker])
  const dismiss = useCallback(() => setNeedRefresh(false), [setNeedRefresh])

  const value = useMemo(() => ({ needRefresh, applyUpdate, dismiss }), [needRefresh, applyUpdate, dismiss])

  return <PwaUpdateContext.Provider value={value}>{children}</PwaUpdateContext.Provider>
}

// Provider + hook are deliberately co-located — see the same note in
// useInstallPrompt.tsx.
// eslint-disable-next-line react-refresh/only-export-components
export function usePwaUpdate(): PwaUpdateContextValue {
  const ctx = useContext(PwaUpdateContext)
  if (!ctx) throw new Error('usePwaUpdate must be used within PwaUpdateProvider')
  return ctx
}
