import { Link, useNavigate } from 'react-router-dom'
import { useProjects } from '@/hooks/useProjects'
import EmptyState from '@/components/common/EmptyState'
import ProjectCard from '@/components/common/ProjectCard'
import { loadSampleAisProject } from '@/services/storage/sampleProject'

export default function Dashboard() {
  const { projects, loading, remove, refresh } = useProjects()
  const navigate = useNavigate()

  const handleLoadSample = async () => {
    const project = await loadSampleAisProject()
    navigate(`/create/${project.id}`)
  }

  return (
    <div>
      <section className="card" style={{ padding: 'clamp(24px, 4vw, 48px)', marginBottom: 32, textAlign: 'center' }}>
        <p style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-accent)', margin: '0 0 12px' }}>
          Smart QR Studio
        </p>
        <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.2rem)', margin: '0 0 12px' }}>Create a branded QR code that opens multiple destinations</h1>
        <p style={{ color: 'var(--color-ink-muted)', maxWidth: 520, margin: '0 auto 24px' }}>
          One scan, up to five destinations — website, location, brochure, virtual tour, and one more you define.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/create" className="btn btn-accent">
            + Create New QR
          </Link>
          <button className="btn btn-secondary" onClick={handleLoadSample}>
            Try a sample (AIS)
          </button>
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Recent QR Codes</h2>
      </div>

      {loading ? null : projects.length === 0 ? (
        <EmptyState
          title="No QR codes yet."
          description="Create your first smart QR code and connect your customers to multiple destinations from one scan."
          actionLabel="Create QR"
          onAction={() => navigate('/create')}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {projects.slice(0, 6).map((project) => (
            <ProjectCard key={project.id} project={project} onDelete={() => remove(project.id)} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}
