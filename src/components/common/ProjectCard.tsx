import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { QRProject } from '@/types/project'
import { getQrShareUrl, DynamicQrNotProvisionedError } from '@/services/share/shareLinkService'
import { copyToClipboard } from '@/services/qr/qrExport'

/**
 * Same canonical URL the QR itself encodes (a Dynamic project's permanent
 * `d.<publicId>` link — previously this card built the static payload URL
 * for every project, which for a Dynamic QR would have copied a link that
 * embeds today's destinations and can never be updated). Empty for a
 * dynamic project that hasn't been created on the backend yet.
 */
function safeShareUrl(project: QRProject): string {
  try {
    return getQrShareUrl(project)
  } catch (err) {
    if (err instanceof DynamicQrNotProvisionedError) return ''
    throw err
  }
}

interface ProjectCardProps {
  project: QRProject
  onDelete: () => void
  onChanged?: () => void
  /** Replaces the default Edit link (e.g. a cloud project must be copied to this device before editing). */
  onEdit?: () => void
  /** Small status chips shown next to the title (cloud/device, unsaved…). */
  badges?: ReactNode
  /** Extra actions appended after Edit / Copy link / Delete (Duplicate, Save to account…). */
  extraActions?: ReactNode
}

function formatUpdated(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}

export default function ProjectCard({ project, onDelete, onChanged, onEdit, badges, extraActions }: ProjectCardProps) {
  const shareUrl = safeShareUrl(project)
  const enabledCount = project.destinations.filter((d) => d.enabled).length

  const handleCopy = async () => {
    if (!shareUrl) return
    const ok = await copyToClipboard(shareUrl)
    if (!ok) window.prompt('Copy this link:', shareUrl)
  }

  const handleDelete = () => {
    if (window.confirm(`Delete "${project.brand.companyName || 'Untitled'}"? This can't be undone.`)) {
      onDelete()
    }
  }

  void onChanged
  const isDynamic = project.qrMode === 'dynamic'

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
          <div style={{ fontSize: '0.8rem', color: 'var(--color-ink-muted)' }}>
            {isDynamic ? 'Dynamic QR' : 'Static QR'} · {enabledCount} destination{enabledCount === 1 ? '' : 's'}
            {formatUpdated(project.updatedAt) ? ` · Updated ${formatUpdated(project.updatedAt)}` : ''}
          </div>
          {badges ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{badges}</div> : null}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {onEdit ? (
          <button className="btn btn-secondary" style={{ flex: 1, minWidth: 100 }} onClick={onEdit}>
            Edit
          </button>
        ) : (
          <Link to={`/create/${project.id}`} className="btn btn-secondary" style={{ flex: 1, minWidth: 100 }}>
            Edit
          </Link>
        )}
        <button className="btn btn-ghost" onClick={handleCopy} disabled={!shareUrl}>
          Copy link
        </button>
        {extraActions}
        <button className="btn btn-ghost" onClick={handleDelete} aria-label={`Delete ${project.brand.companyName || 'project'}`}>
          Delete
        </button>
      </div>
    </div>
  )
}
