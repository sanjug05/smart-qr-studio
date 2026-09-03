import type { QrMode } from '@/types/project'
import { useEntitlement } from '@/hooks/useEntitlement'

/**
 * QR Type = whether the QR can be updated later without reprinting.
 * Deliberately kept separate from QR Style (StyleStep.tsx), which is about
 * appearance — mixing the two would blur a decision with real backend
 * consequences into a purely visual one (see README → "Wizard UX").
 */
export default function QrTypeStep({ qrMode, onChange }: { qrMode: QrMode; onChange: (qrMode: QrMode) => void }) {
  const { allowed: dynamicQrAllowed } = useEntitlement('dynamicQr')

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>QR Type</h2>
      <p className="hint" style={{ marginBottom: 20 }}>
        This decides whether the QR can be updated later, not how it looks — QR Style (later in this wizard) covers
        appearance.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label htmlFor="qr-type-static" className="card" style={{ display: 'flex', gap: 12, padding: 16, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            id="qr-type-static"
            type="radio"
            name="qr-type"
            aria-label="Static QR"
            checked={qrMode === 'static'}
            onChange={() => onChange('static')}
            style={{ marginTop: 4 }}
          />
          <span>
            <span style={{ fontWeight: 700, display: 'block' }}>Static QR</span>
            <span className="hint">Self-contained. Works without a backend, forever — including fully offline.</span>
          </span>
        </label>

        <label
          htmlFor="qr-type-dynamic"
          className="card"
          style={{
            display: 'flex',
            gap: 12,
            padding: 16,
            alignItems: 'flex-start',
            cursor: dynamicQrAllowed ? 'pointer' : 'not-allowed',
            opacity: dynamicQrAllowed ? 1 : 0.7
          }}
        >
          <input
            id="qr-type-dynamic"
            type="radio"
            name="qr-type"
            aria-label="Dynamic QR"
            checked={qrMode === 'dynamic'}
            disabled={!dynamicQrAllowed}
            onChange={() => onChange('dynamic')}
            style={{ marginTop: 4 }}
          />
          <span>
            <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              Dynamic QR
              {!dynamicQrAllowed ? <span className="badge badge-warning">Pro</span> : null}
            </span>
            <span className="hint">Update your destinations anytime without reprinting.</span>
            {!dynamicQrAllowed ? (
              <span className="hint" style={{ display: 'block', marginTop: 4 }}>
                <strong>Upgrade to Pro</strong> to unlock Dynamic QR.
              </span>
            ) : null}
          </span>
        </label>
      </div>
    </div>
  )
}
