import { Link } from 'react-router-dom'
import type { QRProject } from '@/types/project'
import { getLandingUrl } from '@/services/qr/landingUrl'
import { copyToClipboard } from '@/services/qr/qrExport'

export default function ProjectCard({ project, onDelete, onChanged }: { project: QRProject; onDelete: () => void; onChanged: () => void }) {
  const landingUrl = getLandingUrl(project)
  const enabledCount = project.destinations.filter((d) => d.enabled).length

  const handleCopy = async () => {
    const ok = await copyToClipboard(landingUrl)
    if (!ok) window.prompt('Copy this link:', landingUrl)
  }

  const handleDelete = () => {
    if (window.confirm(`Delete "${project.brand.companyName || 'Untitled'}"? This can't be undone.`)) {
      onDelete()
    }
  }

  void onChanged

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: project.brand.primaryColor,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            flexShrink: 0
          }}
        >
          {(project.brand.companyName || 'Q').charAt(0).toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.brand.companyName || 'Untitled brand'}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-ink-muted)' }}>{enabledCount} destination{enabledCount === 1 ? '' : 's'} enabled</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link to={`/create/${project.id}`} className="btn btn-secondary" style={{ flex: 1, minWidth: 100 }}>
          Edit
        </Link>
        <button className="btn btn-ghost" onClick={handleCopy}>
          Copy link
        </button>
        <button className="btn btn-ghost" onClick={handleDelete} aria-label={`Delete ${project.brand.companyName || 'project'}`}>
          Delete
        </button>
      </div>
    </div>
  )
}
