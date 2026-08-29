export default function LoadingScreen() {
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', color: 'var(--color-ink-muted)' }}>
      Loading…
    </div>
  )
}
