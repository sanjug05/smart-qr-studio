import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/** Not yet part of any TS lib — Chromium's install-prompt event. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

interface InstallPromptContextValue {
  /** True once Chromium has fired beforeinstallprompt and it hasn't been used yet. */
  canInstall: boolean
  /** iPhone/iPad — Safari never fires beforeinstallprompt, so this is UA-detected. */
  isIOS: boolean
  /** Already running as an installed app (any platform). */
  isStandalone: boolean
  promptInstall: () => Promise<InstallOutcome>
}

const InstallPromptContext = createContext<InstallPromptContextValue | null>(null)

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const displayModeStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  // iOS Safari's own long-standing (non-standard) flag for "added to home screen".
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return displayModeStandalone || iosStandalone
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIphoneOrIpod = /iPhone|iPod/.test(ua)
  // Real iPads: identify directly. iPadOS 13+ masquerades as "Macintosh" in
  // the UA string, so a Mac with touch points is the accepted heuristic for
  // "this is actually an iPad" (there's no touch-capable Mac to confuse it with).
  const isIpad = /iPad/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
  return isIphoneOrIpod || isIpad
}

/**
 * Mounted once at the app root (see App.tsx), above the router, so the
 * `beforeinstallprompt` listener is attached before the browser has any
 * chance to fire it — Chromium dispatches this event on its own schedule
 * early in the page's life, and a listener added later (e.g. only when the
 * Dashboard happens to mount) could simply miss it for that page load.
 */
export function InstallPromptProvider({ children }: { children: ReactNode }) {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(detectStandalone)
  const [isIOS] = useState(detectIOS)

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredEvent(e as BeforeInstallPromptEvent)
    }
    const onAppInstalled = () => {
      setDeferredEvent(null)
      setIsStandalone(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    const mql = window.matchMedia('(display-mode: standalone)')
    const onDisplayModeChange = (e: MediaQueryListEvent) => setIsStandalone(e.matches || detectStandalone())
    mql.addEventListener('change', onDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
      mql.removeEventListener('change', onDisplayModeChange)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    if (!deferredEvent) return 'unavailable'
    await deferredEvent.prompt()
    const choice = await deferredEvent.userChoice
    setDeferredEvent(null)
    return choice.outcome
  }, [deferredEvent])

  const value = useMemo(
    () => ({ canInstall: Boolean(deferredEvent), isIOS, isStandalone, promptInstall }),
    [deferredEvent, isIOS, isStandalone, promptInstall]
  )

  return <InstallPromptContext.Provider value={value}>{children}</InstallPromptContext.Provider>
}

// Provider + hook are deliberately co-located — they're one cohesive unit
// with no reason to exist separately. Costs only Fast Refresh granularity
// (this file remounts as a whole on edit instead of hot-swapping), never
// correctness.
// eslint-disable-next-line react-refresh/only-export-components
export function useInstallPrompt(): InstallPromptContextValue {
  const ctx = useContext(InstallPromptContext)
  if (!ctx) throw new Error('useInstallPrompt must be used within InstallPromptProvider')
  return ctx
}
