import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProjectDraft } from '@/hooks/useProjectDraft'
import StepIndicator from '@/components/wizard/StepIndicator'
import BrandStep from '@/components/wizard/BrandStep'
import DestinationsStep from '@/components/wizard/DestinationsStep'
import StyleStep from '@/components/wizard/StyleStep'
import PreviewStep from '@/components/wizard/PreviewStep'
import QRPreviewPanel from '@/components/wizard/QRPreviewPanel'
import './CreateQR.css'

export default function CreateQR() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { project, ready, updateBrand, updateDestinations, updateQrStyle } = useProjectDraft(id)
  const [step, setStep] = useState(1)

  // react-router keeps this component instance mounted across /create <->
  // /create/:id transitions (same element at the same tree position), so
  // wizard step state must be reset explicitly whenever the target project
  // changes — otherwise "Create New QR" from step 4 of a previous project
  // opens straight into the preview step of a blank one.
  useEffect(() => {
    setStep(1)
  }, [id])

  if (!ready || !project) {
    return <p>Loading…</p>
  }

  const hasValidDestination = project.destinations.some((d) => d.enabled && d.url.trim())
  const canAdvanceFromDestinations = step !== 2 || hasValidDestination

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Create Smart QR</h1>
        <button className="btn btn-ghost" onClick={() => navigate('/codes')}>
          Save &amp; exit
        </button>
      </div>

      <StepIndicator step={step} />

      <div className="create-qr-layout">
        <div className="card create-qr-form">
          {step === 1 ? <BrandStep brand={project.brand} onChange={updateBrand} /> : null}
          {step === 2 ? <DestinationsStep destinations={project.destinations} onChange={updateDestinations} /> : null}
          {step === 3 ? <StyleStep qrStyle={project.qrStyle} companyName={project.brand.companyName} onChange={updateQrStyle} /> : null}
          {step === 4 ? <PreviewStep project={project} /> : null}

          <div className="create-qr-nav">
            <button className="btn btn-secondary" disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>
              Back
            </button>
            {step < 4 ? (
              <button className="btn btn-primary" disabled={!canAdvanceFromDestinations} onClick={() => setStep((s) => Math.min(4, s + 1))}>
                Next
              </button>
            ) : (
              <button className="btn btn-accent" disabled={!hasValidDestination} onClick={() => navigate('/codes')}>
                Done — go to My QR Codes
              </button>
            )}
          </div>
          {step === 2 && !hasValidDestination ? <p className="error" style={{ marginTop: 8 }}>Add at least one destination before generating the QR.</p> : null}
        </div>

        <QRPreviewPanel project={project} showDownloads={step === 4} />
      </div>
    </div>
  )
}
