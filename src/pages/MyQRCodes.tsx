import { useNavigate } from 'react-router-dom'
import { useProjects } from '@/hooks/useProjects'
import EmptyState from '@/components/common/EmptyState'
import ProjectCard from '@/components/common/ProjectCard'

export default function MyQRCodes() {
  const { projects, loading, remove, refresh } = useProjects()
  const navigate = useNavigate()

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>My QR Codes</h1>
      <p style={{ color: 'var(--color-ink-muted)', marginTop: -8 }}>
        Stored locally in this browser. Clearing browser data or switching devices will remove access here — export a
        backup from Settings if you need to keep it.
      </p>

      {loading ? null : projects.length === 0 ? (
        <EmptyState
          title="No QR codes yet."
          description="Create your first smart QR code and connect your customers to multiple destinations from one scan."
          actionLabel="Create QR"
          onAction={() => navigate('/create')}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onDelete={() => remove(project.id)} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}
