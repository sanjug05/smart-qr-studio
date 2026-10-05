import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { QRProject } from '@/types/project'
import { useLibrary } from '@/hooks/useLibrary'
import { useAuth } from '@/hooks/useAuth'
import { libraryService, hasUnsavedChanges } from '@/services/cloud'
import EmptyState from '@/components/common/EmptyState'
import ProjectCard from '@/components/common/ProjectCard'

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 } as const
const nameOf = (p: QRProject) => p.brand.companyName || 'Untitled brand'

export default function MyQRCodes() {
  const library = useLibrary()
  const { signIn, signingIn } = useAuth()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const signedIn = library.status === 'signedIn'
  const cloudAvailable = library.status !== 'unavailable'

  async function saveProjects(projects: QRProject[]) {
    setBusy(true)
    setNotice(null)
    setProblem(null)
    const result = await library.saveToCloud(projects)
    setBusy(false)
    setChoosing(false)
    setSelected(new Set())
    if (result.failed.length === 0) {
      setNotice(
        projects.length === 1 ? 'Saved to your account.' : 'Your QR codes are now available across your devices.'
      )
    } else {
      const first = result.failed[0].reason
      setProblem(
        result.saved.length > 0
          ? `Saved ${result.saved.length}, but ${result.failed.length} couldn’t be saved: ${first}`
          : `Couldn’t save: ${first}`
      )
    }
  }

  async function editCloudProject(project: QRProject) {
    setProblem(null)
    try {
      let opened = await libraryService.openForEditing(project)
      if (opened.kind === 'conflict') {
        const useCloud = window.confirm(
          `“${nameOf(project)}” has unsaved changes on this device and a newer version in your account.\n\nOK — use the newer account version (this device’s unsaved changes are discarded).\nCancel — keep this device’s version for now.`
        )
        if (!useCloud) return
        opened = await libraryService.openForEditing(project, { useCloud: true })
      }
      if (opened.kind === 'ready') navigate(`/create/${opened.project.id}`)
    } catch {
      setProblem('Couldn’t open that QR code. Please try again.')
    }
  }

  async function runSafely(action: () => Promise<void>, failure: string) {
    setProblem(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setProblem(err instanceof Error && err.message ? err.message : failure)
    }
  }

  const confirmDeleteCloud = (p: QRProject) => {
    const dynamicNote = p.qrMode === 'dynamic' ? ' The printed QR keeps working — only this entry is removed.' : ''
    return window.confirm(`Delete “${nameOf(p)}” from your account?${dynamicNote} This can’t be undone.`)
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const showMigration = signedIn && library.localOnly.length > 0 && !library.migrationDismissed

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>My QR Codes</h1>

      {!cloudAvailable ? (
        <p style={{ color: 'var(--color-ink-muted)', marginTop: -8 }}>
          Stored locally in this browser. Clearing browser data or switching devices will remove access here — export a backup from Settings if you need to
          keep it.
        </p>
      ) : null}

      {library.status === 'signedOut' ? (
        <div className="card" style={{ padding: 20, marginBottom: 20, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <p style={{ margin: 0, flex: 1, minWidth: 220 }}>Sign in with Google to save QR codes and access them across devices.</p>
          <button className="btn btn-primary" onClick={() => void signIn()} disabled={signingIn}>
            {signingIn ? 'Signing in…' : 'Continue with Google'}
          </button>
        </div>
      ) : null}

      <div role="status" aria-live="polite">
        {notice ? <p className="card" style={{ padding: 12, marginBottom: 16 }}>{notice}</p> : null}
      </div>
      {problem || library.error ? (
        <p className="error card" role="alert" style={{ padding: 12, marginBottom: 16 }}>
          {problem ?? library.error}{' '}
          {library.error ? (
            <button className="btn btn-ghost" onClick={() => void library.refresh()}>
              Retry
            </button>
          ) : null}
        </p>
      ) : null}

      {showMigration ? (
        <section className="card" style={{ padding: 20, marginBottom: 20 }} aria-labelledby="migrate-title">
          <h2 id="migrate-title" style={{ marginTop: 0, fontSize: '1.05rem' }}>
            Save your existing QR codes to your account
          </h2>
          <p style={{ color: 'var(--color-ink-muted)' }}>
            {library.localOnly.length} QR code{library.localOnly.length === 1 ? '' : 's'} on this device {library.localOnly.length === 1 ? 'isn’t' : 'aren’t'} in
            your account yet. Nothing is uploaded or removed unless you choose.
          </p>
          {choosing ? (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'grid', gap: 8 }}>
                {library.localOnly.map((p) => (
                  <li key={p.id}>
                    <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 'var(--touch-target)' }}>
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                      <span>
                        {nameOf(p)} <span style={{ color: 'var(--color-ink-muted)' }}>· {p.qrMode === 'dynamic' ? 'Dynamic' : 'Static'}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" disabled={busy || selected.size === 0} onClick={() => void saveProjects(library.localOnly.filter((p) => selected.has(p.id)))}>
                  {busy ? 'Saving…' : `Save ${selected.size || ''} selected`.trim()}
                </button>
                <button className="btn btn-ghost" onClick={() => setChoosing(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => void saveProjects(library.localOnly)}>
                {busy ? 'Saving…' : 'Save All'}
              </button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setChoosing(true)}>
                Choose QR Codes
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={library.skipMigration}>
                Skip
              </button>
            </div>
          )}
        </section>
      ) : null}

      {library.loading ? (
        <p aria-busy="true">Loading…</p>
      ) : signedIn ? (
        <>
          <section aria-labelledby="cloud-title" style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <h2 id="cloud-title" style={{ margin: 0, fontSize: '1.1rem' }}>
                Saved to your account
              </h2>
              <button className="btn btn-ghost" onClick={() => void library.refresh()}>
                Refresh
              </button>
            </div>
            {library.cloud.length === 0 ? (
              <EmptyState
                title="No QR codes in your account yet."
                description="Create a QR code and choose “Save to my account” — it will appear here on every device you sign in on."
                actionLabel="Create QR"
                onAction={() => navigate('/create')}
              />
            ) : (
              <div style={GRID}>
                {library.cloud.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onEdit={() => void editCloudProject(project)}
                    onDelete={() => {
                      if (confirmDeleteCloud(project)) void runSafely(() => library.removeCloud(project.id), 'Couldn’t delete that QR code.')
                    }}
                    badges={<span className="badge badge-success">In your account</span>}
                    extraActions={
                      project.qrMode === 'dynamic' ? null : (
                        <button className="btn btn-ghost" onClick={() => void runSafely(() => library.duplicate(project), 'Couldn’t duplicate that QR code.')}>
                          Duplicate
                        </button>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {library.localOnly.length > 0 ? (
            <section aria-labelledby="device-title">
              <h2 id="device-title" style={{ fontSize: '1.1rem', marginBottom: 4 }}>
                On this device only
              </h2>
              <p style={{ color: 'var(--color-ink-muted)', marginTop: 0 }}>Not saved to your account, so they won’t appear on your other devices.</p>
              <div style={GRID}>
                {library.localOnly.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onDelete={() => void library.removeLocal(project.id)}
                    badges={<span className="badge badge-warning">This device only</span>}
                    extraActions={
                      <button className="btn btn-ghost" disabled={busy} onClick={() => void saveProjects([project])}>
                        Save to account
                      </button>
                    }
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : library.local.length === 0 ? (
        <EmptyState
          title="No QR codes yet."
          description="Create your first smart QR code and connect your customers to multiple destinations from one scan."
          actionLabel="Create QR"
          onAction={() => navigate('/create')}
        />
      ) : (
        <div style={GRID}>
          {library.local.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={() => void library.removeLocal(project.id)}
              onChanged={() => void library.refresh()}
              badges={hasUnsavedChanges(project) && cloudAvailable ? <span className="badge badge-warning">This device only</span> : null}
            />
          ))}
        </div>
      )}
    </div>
  )
}
