const STEPS = ['QR Type', 'Brand', 'Destinations', 'QR Style', 'Preview']

export default function StepIndicator({ step }: { step: number }) {
  return (
    <ol style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 24px', flexWrap: 'wrap' }} aria-label="Create QR steps">
      {STEPS.map((label, index) => {
        const n = index + 1
        const state = n === step ? 'current' : n < step ? 'done' : 'upcoming'
        return (
          <li key={label} aria-current={state === 'current' ? 'step' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.78rem',
                fontWeight: 700,
                background: state === 'upcoming' ? '#ecebf0' : 'var(--color-ink)',
                color: state === 'upcoming' ? 'var(--color-ink-muted)' : '#fff'
              }}
            >
              {state === 'done' ? '✓' : n}
            </span>
            <span style={{ fontSize: '0.85rem', fontWeight: state === 'current' ? 700 : 500, color: state === 'upcoming' ? 'var(--color-ink-muted)' : 'var(--color-ink)' }}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}
