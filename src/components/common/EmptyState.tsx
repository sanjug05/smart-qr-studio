export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
      <h3 style={{ margin: '0 0 8px' }}>{title}</h3>
      <p style={{ color: 'var(--color-ink-muted)', maxWidth: 420, margin: '0 auto 20px' }}>{description}</p>
      {actionLabel && onAction ? (
        <button className="btn btn-accent" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
