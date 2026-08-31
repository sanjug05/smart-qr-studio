import { useState } from 'react'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import './InstallAppPrompt.css'

const DISMISS_KEY = 'smart-qr-studio:install-prompt-dismissed'

/**
 * `dismissible` distinguishes the two places this renders:
 * - Dashboard: a one-time banner ("Not now" hides it for good, persisted
 *   in localStorage — see section on not nagging every page load).
 * - Settings: a permanent, always-available install section so there's
 *   still a way to install after dismissing the banner, or to see the
 *   iOS instructions again. No dismiss control there — it's just part of
 *   the page, not an interruption.
 */
export default function InstallAppPrompt({ dismissible = true }: { dismissible?: boolean }) {
  const { canInstall, isIOS, isStandalone, promptInstall } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(() => dismissible && localStorage.getItem(DISMISS_KEY) === '1')
  const [installError, setInstallError] = useState(false)

  if (isStandalone) return null
  if (dismissible && dismissed) return null
  if (!canInstall && !isIOS) return null // no usable install path here — never show a dead-end button

  const handleDismiss = () => {
    if (!dismissible) return
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  const handleInstallClick = async () => {
    const outcome = await promptInstall()
    if (outcome === 'unavailable') {
      setInstallError(true)
      return
    }
    // 'accepted' or 'dismissed' — either way the browser's own prompt is
    // done, and appinstalled (if it fires) will flip isStandalone on its
    // own; hiding the banner now avoids it lingering on a stale state.
    handleDismiss()
  }

  return (
    <section className="install-prompt card" aria-label="Install Smart QR Studio">
      <div className="install-prompt-body">
        <h3 className="install-prompt-title">Install Smart QR Studio</h3>

        {isIOS ? (
          <>
            <p className="install-prompt-text">On your iPhone:</p>
            <ol className="install-prompt-steps">
              <li>Tap the Share button.</li>
              <li>Select "Add to Home Screen".</li>
              <li>Tap "Add".</li>
            </ol>
          </>
        ) : (
          <p className="install-prompt-text">Install the app for quicker access and a more app-like experience.</p>
        )}

        {installError ? (
          <p className="hint" role="status">
            Installation isn't available right now — your browser may not support it, or the app may already be
            installed.
          </p>
        ) : null}
      </div>

      <div className="install-prompt-actions">
        {isIOS ? (
          dismissible ? (
            <button className="btn btn-primary" onClick={handleDismiss}>
              Got it
            </button>
          ) : null
        ) : (
          <>
            <button className="btn btn-accent" onClick={handleInstallClick}>
              Install App
            </button>
            {dismissible ? (
              <button className="btn btn-ghost" onClick={handleDismiss}>
                Not now
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
