import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div style={{ textAlign: 'center', padding: '80px 16px' }}>
      <h1>Page not found</h1>
      <p style={{ color: 'var(--color-ink-muted)' }}>The page you're looking for doesn't exist.</p>
      <Link to="/" className="btn btn-primary" style={{ marginTop: 16 }}>
        Back to Dashboard
      </Link>
    </div>
  )
}
