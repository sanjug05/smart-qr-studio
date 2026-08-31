import { useState } from 'react'
import { usePwaUpdate } from '@/hooks/usePwaUpdate'
import './PwaUpdateBanner.css'

/**
 * Only rendered from AppShell (studio routes) — never on the customer
 * landing page, where an "app update" message would be meaningless noise
 * for someone who just scanned a QR. Docked at the top of the content
 * area specifically so it can never overlap the mobile bottom tab bar.
 */
export default function PwaUpdateBanner() {
  const { needRefresh, applyUpdate, dismiss } = usePwaUpdate()
  const [updating, setUpdating] = useState(false)

  if (!needRefresh) return null

  const handleUpdate = async () => {
    setUpdating(true)
    await applyUpdate()
    // applyUpdate reloads the page once the new service worker takes
    // control; if that hasn't happened yet for any reason, don't leave
    // the button stuck disabled forever.
    setUpdating(false)
  }

  return (
    <div className="pwa-update-banner card" role="region" aria-label="App update available">
      <div>
        <strong>Update available</strong>
        <p className="hint" style={{ margin: '2px 0 0' }}>
          A new version of Smart QR Studio is ready.
        </p>
      </div>
      <div className="pwa-update-actions">
        <button className="btn btn-accent" onClick={handleUpdate} disabled={updating}>
          {updating ? 'Updating…' : 'Update now'}
        </button>
        <button className="btn btn-ghost" onClick={dismiss} disabled={updating}>
          Later
        </button>
      </div>
    </div>
  )
}
