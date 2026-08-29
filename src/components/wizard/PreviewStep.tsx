import type { QRProject } from '@/types/project'

export default function PreviewStep({ project }: { project: QRProject }) {
  const enabled = project.destinations.filter((d) => d.enabled).sort((a, b) => a.order - b.order)

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Preview &amp; Generate</h2>
      <p className="hint" style={{ marginBottom: 20 }}>
        Review everything below. The QR on the right updates live and is automatically checked for scan reliability.
      </p>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: '0.95rem' }}>Brand</h3>
        <p style={{ margin: 0 }}>
          <strong>{project.brand.companyName || 'Untitled brand'}</strong>
          {project.brand.tagline ? ` — ${project.brand.tagline}` : ''}
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: '0.95rem' }}>Destinations ({enabled.length}/5 enabled)</h3>
        {enabled.length === 0 ? (
          <p className="error" style={{ margin: 0 }}>
            Add at least one destination before generating the QR.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {enabled.map((d) => (
              <li key={d.id}>
                {d.icon} {d.label} — <span style={{ color: 'var(--color-ink-muted)' }}>{d.url}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: '0.95rem' }}>Test it</h3>
        <p style={{ margin: 0 }} className="hint">
          Scan the QR on the right with your phone's camera, or use "Open QR link" to confirm the landing page opens
          and shows the right destinations before you download and print it.
        </p>
      </div>
    </div>
  )
}
