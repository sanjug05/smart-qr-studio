import { useRef, useState } from 'react'
import { projectRepository, isValidProject } from '@/services/storage/projectRepository'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import InstallAppPrompt from '@/components/common/InstallAppPrompt'
import { APP_VERSION } from '@/version'

export default function Settings() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const { isStandalone } = useInstallPrompt()

  const handleExport = async () => {
    const projects = await projectRepository.list()
    const blob = new Blob([JSON.stringify(projects, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'smart-qr-studio-backup.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportClick = () => fileInputRef.current?.click()

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      if (!Array.isArray(parsed)) throw new Error('Invalid file')

      // Don't trust the file just because it parsed as JSON — a hand-edited
      // or foreign JSON file can parse fine while its entries don't match
      // QRProject at all. Validate each one before it ever reaches storage.
      const valid = parsed.filter(isValidProject)
      const skipped = parsed.length - valid.length
      for (const project of valid) {
        await projectRepository.save(project)
      }

      if (valid.length === 0) {
        setMessage('Could not import this file — no entries matched the Smart QR Studio project format.')
      } else {
        setMessage(
          `Imported ${valid.length} project(s)${skipped > 0 ? ` (skipped ${skipped} entr${skipped === 1 ? 'y' : 'ies'} that didn't match the expected format)` : ''}. Refresh Dashboard / My QR Codes to see them.`
        )
      }
    } catch (err) {
      setMessage(err instanceof Error && err.message.includes('full') ? err.message : 'Could not import this file — it does not look like a Smart QR Studio backup.')
    }
  }

  const handleClearAll = async () => {
    if (!window.confirm('Delete ALL locally saved QR projects on this device? This cannot be undone.')) return
    const projects = await projectRepository.list()
    await Promise.all(projects.map((p) => projectRepository.remove(p.id)))
    setMessage('All local projects were deleted.')
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ marginTop: 0 }}>Settings</h1>

      <section className="card" style={{ padding: 24, marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>App</h2>
        {isStandalone ? (
          <p style={{ color: 'var(--color-ink-muted)' }}>
            <span className="badge badge-success" style={{ marginRight: 8 }}>
              ✓ Installed
            </span>
            You're using the installed app.
          </p>
        ) : (
          <div style={{ marginBottom: -20 }}>
            <InstallAppPrompt dismissible={false} />
          </div>
        )}
        <p style={{ color: 'var(--color-ink-muted)', fontSize: '0.85rem', margin: 0 }}>
          Smart QR Studio {APP_VERSION} — web app (PWA). Android/iOS store apps aren't published yet; installing adds
          this web app to your device in the meantime.
        </p>
      </section>

      <section className="card" style={{ padding: 24, marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Local storage</h2>
        <p style={{ color: 'var(--color-ink-muted)' }}>
          Smart QR Studio V1 stores every project in this browser's local storage — there is no account or cloud sync
          yet. Data stays on this device and this browser only. Export a backup before clearing browser data or
          switching machines.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={handleExport}>
            Export backup (JSON)
          </button>
          <button className="btn btn-secondary" onClick={handleImportClick}>
            Import backup
          </button>
          <input ref={fileInputRef} type="file" accept="application/json" className="visually-hidden" onChange={handleImportFile} />
        </div>
      </section>

      <section className="card" style={{ padding: 24, marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Danger zone</h2>
        <p style={{ color: 'var(--color-ink-muted)' }}>Permanently remove every project stored on this device.</p>
        <button className="btn" style={{ background: 'var(--color-danger)', color: '#fff' }} onClick={handleClearAll}>
          Clear all local data
        </button>
      </section>

      {message ? (
        <div className="card" role="status" style={{ padding: 16, borderColor: 'var(--color-accent)' }}>
          {message}
        </div>
      ) : null}
    </div>
  )
}
